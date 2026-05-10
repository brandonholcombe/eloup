from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import requests

from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import read_secrets_file

WORKSPACE_DIR = Path("/workspace")
DOCKERHUB_NAMESPACE = "bholcombe"
WIZARD_COMPONENT = "eloup-wizard"
ELOUP_WEB_COMPONENT = "eloup-web"
HUB_TAG_LOOKUP_TIMEOUT = 10.0


@dataclass
class ImageSpec:
    component: str
    context: Path
    dockerfile: Path | None = None

    @property
    def repo(self) -> str:
        return f"{DOCKERHUB_NAMESPACE}/{self.component}"


def _git_sha(workspace: Path) -> tuple[str, bool]:
    proc = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(workspace),
        capture_output=True,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"git rev-parse HEAD failed in {workspace}: "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    sha = proc.stdout.strip()

    dirty_proc = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(workspace),
        capture_output=True,
        text=True,
        timeout=15,
    )
    if dirty_proc.returncode != 0:
        raise RuntimeError(f"git status --porcelain failed: {dirty_proc.stderr.strip()}")
    is_dirty = bool(dirty_proc.stdout.strip())
    return sha, is_dirty


def _resolve_eloup_web_spec(workspace: Path) -> ImageSpec | None:
    dir_context = workspace / "eloup-web"
    if dir_context.is_dir():
        return ImageSpec(component=ELOUP_WEB_COMPONENT, context=dir_context)
    root_dockerfile = workspace / "Dockerfile.eloup-web"
    if root_dockerfile.is_file():
        return ImageSpec(
            component=ELOUP_WEB_COMPONENT,
            context=workspace,
            dockerfile=root_dockerfile,
        )
    return None


def _hub_tag_exists(repo: str, tag: str) -> bool:
    """Check DockerHub catalog API for a tag.

    NOTE: this is a performance optimization, not a correctness gate. The
    DockerHub Hub API is the catalog/browse endpoint (not the OCI distribution
    API at registry-1.docker.io); it has replication lag after a push and may
    404 transiently for valid images. A redundant `buildx --push` of the same
    digest is idempotent at the registry layer level, so a false negative just
    costs us the multi-second buildx invocation — never correctness.
    """
    url = f"https://hub.docker.com/v2/repositories/{repo}/tags/{tag}"
    try:
        resp = requests.get(url, timeout=HUB_TAG_LOOKUP_TIMEOUT)
    except requests.RequestException:
        return False
    return resp.status_code == 200


def _docker_login(user: str, pat: str) -> None:
    proc = subprocess.run(
        ["docker", "login", "-u", user, "--password-stdin"],
        input=pat,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"docker login failed: {proc.stderr.strip() or proc.stdout.strip()}")


def _docker_logout() -> None:
    subprocess.run(["docker", "logout"], capture_output=True, text=True, timeout=15)


def _buildx_push(spec: ImageSpec, sha_tag: str) -> None:
    args = [
        "docker",
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--push",
        "-t",
        f"{spec.repo}:{sha_tag}",
        "-t",
        f"{spec.repo}:latest",
    ]
    if spec.dockerfile:
        args += ["-f", str(spec.dockerfile)]
    args.append(str(spec.context))

    proc = subprocess.run(args, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(
            f"docker buildx build failed for {spec.repo}: "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )


class BuildImagesPhase:
    name = "build_images"
    title = "Phase 5 — Build & push images"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        secrets = read_secrets_file(
            Path(str(ctx.state.data.get("secrets_ref") or ctx.paths.secrets_file))
        )
        dockerhub_user = ctx.state.data.get("config", {}).get("dockerhub_user", "")
        dockerhub_pat = secrets.get("dockerhub_pat", "")
        if not dockerhub_user or not dockerhub_pat:
            ctx.state.set_phase_status(self.name, "failed", error="missing DockerHub credentials")
            ctx.state.save()
            raise PhaseFailed(self.name, "DockerHub user/PAT missing — re-run phase 2")

        try:
            sha, is_dirty = _git_sha(WORKSPACE_DIR)
        except RuntimeError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc

        sha_tag = f"{sha}-dirty" if is_dirty else sha
        if is_dirty:
            ctx.console.print(
                f"[yellow]Working tree dirty[/yellow] — tagging as {sha_tag}; proceeding"
            )

        specs: list[ImageSpec] = [ImageSpec(component=WIZARD_COMPONENT, context=WORKSPACE_DIR)]
        web_spec = _resolve_eloup_web_spec(WORKSPACE_DIR)
        if web_spec is None:
            ctx.console.print("[dim]eloup-web not yet present (built in M4) — skipping[/dim]")
        else:
            specs.append(web_spec)

        last_built: dict[str, dict] = {}
        logged_in = False
        try:
            for spec in specs:
                if _hub_tag_exists(spec.repo, sha_tag):
                    ctx.console.print(f"[dim]{spec.repo}:{sha_tag} already pushed — skipping[/dim]")
                    last_built[spec.component] = {
                        "sha_tag": sha_tag,
                        "latest_tag": "latest",
                        "skipped": True,
                    }
                    continue

                if not logged_in:
                    _docker_login(dockerhub_user, dockerhub_pat)
                    logged_in = True

                ctx.console.print(f"[cyan]Building & pushing[/cyan] {spec.repo}:{sha_tag}")
                _buildx_push(spec, sha_tag)
                last_built[spec.component] = {
                    "sha_tag": sha_tag,
                    "latest_tag": "latest",
                    "skipped": False,
                }
        except RuntimeError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc
        finally:
            if logged_in:
                _docker_logout()

        ctx.state.update_config(
            {
                "last_built_images": last_built,
                "last_built_sha": sha_tag,
                "last_built_dirty": is_dirty,
            }
        )
        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()
        ctx.console.print(
            f"[green]Phase 5 done — images at SHA {sha_tag} (built or skipped: "
            f"{', '.join(last_built) or 'none'})[/green]"
        )

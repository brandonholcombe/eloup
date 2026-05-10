from __future__ import annotations

import os
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from wizard.phases._manifests import (
    APP_RUNTIME_SECRET_KEYS,
    render_argocd_application,
    render_configmap,
    render_ingress,
    render_namespace,
    render_plain_secret,
    render_service,
    render_statefulset,
)
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.phases.provision_repos import GITHUB_REPO_URL
from wizard.state import read_secrets_file

WORKSPACE_DIR = Path("/workspace")
K8S_DIR = WORKSPACE_DIR / "K8s"
ARGOCD_DIR = WORKSPACE_DIR / "argocd"

ELOUP_WEB_COMPONENT = "eloup-web"
DOCKERHUB_NAMESPACE = "bholcombe"
KUBESEAL_TIMEOUT_SECONDS = 30


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        if tmp_path.exists():
            tmp_path.unlink()
        raise


def _kubeseal(plain_secret_yaml: str, *, cert_path: Path, controller_namespace: str) -> str:
    proc = subprocess.run(
        [
            "kubeseal",
            "--format=yaml",
            "--cert",
            str(cert_path),
            f"--controller-namespace={controller_namespace}",
        ],
        input=plain_secret_yaml,
        capture_output=True,
        text=True,
        timeout=KUBESEAL_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"kubeseal failed (rc={proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout


def _resolve_web_image(
    *,
    web_image_override: str | None,
    last_built_images: dict,
) -> tuple[str, bool]:
    if web_image_override is not None:
        return web_image_override, False

    entry = last_built_images.get(ELOUP_WEB_COMPONENT)
    if not entry or "sha_tag" not in entry:
        raise PhaseFailed(
            "generate_manifests",
            "eloup-web image not in state.config.last_built_images and no --web-image override. "
            "Either ship Dockerfile.eloup-web (or eloup-web/) so phase 5 can build it (M4), "
            "or rerun with --web-image <ref> for a pipeline smoke-test "
            "(e.g. --web-image nginx:1.27-alpine).",
        )
    return f"{DOCKERHUB_NAMESPACE}/{ELOUP_WEB_COMPONENT}:{entry['sha_tag']}", True


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class GenerateManifestsPhase:
    name = "generate_manifests"
    title = "Phase 6 — Generate manifests"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        try:
            self._run(ctx)
        except PhaseFailed as exc:
            ctx.state.set_phase_status(self.name, "failed", error=exc.detail)
            ctx.state.save()
            raise
        except RuntimeError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc

        ctx.state.update_config({"generate_manifests_ts": _now_iso()})
        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()
        ctx.console.print(
            f"[green]Phase 6 done — manifests rendered to[/green] "
            f"{K8S_DIR}/ and {ARGOCD_DIR}/eloup-app.yaml"
        )

    def _run(self, ctx: PhaseContext) -> None:
        config = ctx.state.data.get("config", {})
        app_domain = config.get("app_domain") or "eloup.kodloki.io"
        discord_client_id = config.get("discord_client_id") or ""

        cert_path_str = config.get("sealed_secrets_cert_path")
        controller_ns = config.get("sealed_secrets_namespace")
        if not cert_path_str or not controller_ns:
            raise PhaseFailed(
                self.name,
                "missing sealed-secrets context (cert_path / namespace) — re-run phase 4",
            )
        cert_path = Path(cert_path_str)
        if not cert_path.exists():
            raise PhaseFailed(
                self.name,
                f"sealed-secrets cert not found at {cert_path} — re-run phase 4 to refetch",
            )

        last_built = config.get("last_built_images") or {}
        web_image, use_http_probe = _resolve_web_image(
            web_image_override=ctx.web_image,
            last_built_images=last_built,
        )

        secrets_path = ctx.state.data.get("secrets_ref") or ctx.paths.secrets_file
        secrets_all = read_secrets_file(Path(str(secrets_path)))
        runtime_secrets = {k: secrets_all[k] for k in APP_RUNTIME_SECRET_KEYS if k in secrets_all}
        missing = APP_RUNTIME_SECRET_KEYS - set(runtime_secrets)
        if missing:
            raise PhaseFailed(
                self.name,
                f"runtime secrets missing from secrets file: {sorted(missing)} — re-run phase 2",
            )

        plain_secret = render_plain_secret(runtime_secrets)
        sealed_secret_yaml = _kubeseal(
            plain_secret,
            cert_path=cert_path,
            controller_namespace=controller_ns,
        )

        files: list[tuple[Path, str]] = [
            (K8S_DIR / "namespace.yaml", render_namespace()),
            (
                K8S_DIR / "configmap-web.yaml",
                render_configmap(
                    discord_client_id=discord_client_id,
                    app_domain=app_domain,
                ),
            ),
            (K8S_DIR / "service-web.yaml", render_service()),
            (
                K8S_DIR / "statefulset-web.yaml",
                render_statefulset(image=web_image, use_http_probe=use_http_probe),
            ),
            (K8S_DIR / "ingress.yaml", render_ingress(app_domain=app_domain)),
            (K8S_DIR / "sealed-secret-web.yaml", sealed_secret_yaml),
            (
                ARGOCD_DIR / "eloup-app.yaml",
                render_argocd_application(repo_url=GITHUB_REPO_URL),
            ),
        ]

        for path, content in files:
            _atomic_write(path, content)

        ctx.console.print(
            f"[dim]Wrote {len(files)} manifests "
            f"(image={web_image}, probe={'http' if use_http_probe else 'tcp'})[/dim]"
        )

from __future__ import annotations

import subprocess
from pathlib import Path

from rich.console import Console

from wizard.phases.base import PhaseContext, PhaseFailed

WORKSPACE_DIR = Path("/workspace")
K8S_PATH = "K8s"
ARGOCD_FILE_PATH = "argocd/eloup-app.yaml"
GITHUB_REMOTE = "github"
GITEA_REMOTE = "gitea"
GIT_TIMEOUT_SECONDS = 60
GIT_PUSH_TIMEOUT_SECONDS = 180


class _GitFailed(RuntimeError):
    def __init__(self, stderr: str):
        super().__init__(stderr)
        self.stderr = stderr


def _run_git(args: list[str], *, cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _resolve_commit_sha(config: dict) -> str:
    last_built_sha = config.get("last_built_sha")
    if last_built_sha:
        return str(last_built_sha)
    last_built_images = config.get("last_built_images") or {}
    wizard_entry = last_built_images.get("eloup-wizard") or {}
    wizard_sha = wizard_entry.get("sha_tag")
    if wizard_sha:
        return str(wizard_sha)
    return "unknown-sha"


def _stage_and_commit(workspace: Path, commit_sha: str, console: Console) -> None:
    add = _run_git(
        ["add", K8S_PATH, ARGOCD_FILE_PATH],
        cwd=workspace,
        timeout=GIT_TIMEOUT_SECONDS,
    )
    if add.returncode != 0:
        raise _GitFailed(add.stderr.strip() or add.stdout.strip())

    diff = _run_git(
        ["diff", "--cached", "--quiet"],
        cwd=workspace,
        timeout=GIT_TIMEOUT_SECONDS,
    )
    if diff.returncode == 0:
        console.print("[dim]No manifest changes to commit — re-run idempotent.[/dim]")
        return

    commit = _run_git(
        ["commit", "-m", f"wizard: deploy eloup-web @ {commit_sha}"],
        cwd=workspace,
        timeout=GIT_TIMEOUT_SECONDS,
    )
    if commit.returncode != 0:
        raise _GitFailed(commit.stderr.strip() or commit.stdout.strip())
    console.print(f"[green]Committed[/green] manifests @ {commit_sha}")


def _push(workspace: Path, remote: str) -> tuple[bool, str]:
    proc = _run_git(
        ["push", remote, "main"],
        cwd=workspace,
        timeout=GIT_PUSH_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        return False, proc.stderr.strip() or proc.stdout.strip()
    return True, proc.stdout.strip() or proc.stderr.strip()


class PushManifestsPhase:
    name = "push_manifests"
    title = "Phase 7 — Push manifests to both remotes"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        config = ctx.state.data.get("config", {})
        commit_sha = _resolve_commit_sha(config)

        substeps = ctx.state.phase(self.name).get("substeps") or {}
        github_done = substeps.get("push_github", {}).get("status") == "done"
        gitea_done = substeps.get("push_gitea", {}).get("status") == "done"

        try:
            _stage_and_commit(WORKSPACE_DIR, commit_sha, ctx.console)
        except _GitFailed as exc:
            ctx.state.set_phase_status(self.name, "failed", error=f"git stage/commit: {exc}")
            ctx.state.save()
            raise PhaseFailed(self.name, f"git stage/commit failed: {exc}") from exc

        if github_done:
            ctx.console.print(
                "[dim]push_github already done — skipping (Gitea-only retry path)[/dim]"
            )
        else:
            ok, output = _push(WORKSPACE_DIR, GITHUB_REMOTE)
            if not ok:
                ctx.state.set_substep_status(self.name, "push_github", "failed", error=output)
                ctx.state.set_phase_status(self.name, "failed", error="push_github failed")
                ctx.state.save()
                raise PhaseFailed(self.name, f"git push {GITHUB_REMOTE} main: {output}")
            ctx.state.set_substep_status(self.name, "push_github", "done")
            ctx.state.save()
            ctx.console.print(f"[green]Pushed to {GITHUB_REMOTE}[/green] {output}")

        if gitea_done:
            ctx.console.print("[dim]push_gitea already done — skipping[/dim]")
        else:
            ok, output = _push(WORKSPACE_DIR, GITEA_REMOTE)
            if not ok:
                ctx.state.set_substep_status(self.name, "push_gitea", "failed", error=output)
                ctx.console.print(
                    f"[yellow]Gitea mirror push failed: {output}. "
                    f"Re-run the wizard without flags to retry just the Gitea push "
                    f"(the phase will resume because phase status is 'failed' and "
                    f"push_github is still 'done'). Do NOT use "
                    f"--retry-from push_manifests — it resets ALL substeps "
                    f"including push_github.[/yellow]"
                )
            else:
                ctx.state.set_substep_status(self.name, "push_gitea", "done")
                ctx.console.print(f"[green]Pushed to {GITEA_REMOTE}[/green] {output}")

        github_status = ctx.state.phase(self.name)["substeps"]["push_github"]["status"]
        if github_status == "done":
            ctx.state.set_phase_status(self.name, "done")
        else:
            ctx.state.set_phase_status(self.name, "failed", error="push_github not done after run")
        ctx.state.save()

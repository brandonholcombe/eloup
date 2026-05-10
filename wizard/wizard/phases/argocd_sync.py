from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from rich.console import Console
from rich.live import Live
from rich.panel import Panel

from wizard.phases._kubectl import KubectlError, apply_stdin
from wizard.phases._manifests import render_repo_credential_secret
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.phases.generate_manifests import ARGOCD_DIR
from wizard.phases.provision_repos import GITHUB_OWNER, GITHUB_REPO_URL
from wizard.state import read_secrets_file

POLL_INTERVAL_SECONDS = 10.0
POLL_DEADLINE_SECONDS = 600.0
KUBECTL_GET_TIMEOUT_SECONDS = 30
KUBECTL_APPLY_TIMEOUT_SECONDS = 60


def _panel(sync: str, health: str) -> Panel:
    return Panel(
        f"sync: [bold]{sync}[/bold]   health: [bold]{health}[/bold]",
        title="ArgoCD Application/eloup",
        border_style="cyan",
    )


def _get_application_status() -> tuple[int, str, str]:
    proc = subprocess.run(
        ["kubectl", "-n", "argocd", "get", "application", "eloup", "-o", "json"],
        capture_output=True,
        text=True,
        timeout=KUBECTL_GET_TIMEOUT_SECONDS,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _poll_until_healthy(
    console: Console,
) -> tuple[bool, str | None, str | None, list[dict]]:
    deadline = time.monotonic() + POLL_DEADLINE_SECONDS
    last_sync: str | None = None
    last_health: str | None = None
    last_conditions: list[dict] = []
    with Live(_panel("—", "—"), console=console, transient=False, refresh_per_second=2) as live:
        while time.monotonic() < deadline:
            rc, stdout, _ = _get_application_status()
            if rc != 0:
                live.update(_panel("not-yet-visible", "—"))
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            try:
                body = json.loads(stdout)
            except json.JSONDecodeError:
                live.update(_panel("not-yet-visible", "—"))
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            status = body.get("status") or {}
            sync = (status.get("sync") or {}).get("status")
            health = (status.get("health") or {}).get("status")
            conditions = status.get("conditions") or []
            last_sync, last_health, last_conditions = sync, health, conditions
            live.update(_panel(sync or "—", health or "—"))
            if sync == "Synced" and health == "Healthy":
                return True, sync, health, conditions
            time.sleep(POLL_INTERVAL_SECONDS)
    return False, last_sync, last_health, last_conditions


def _apply_application_file(path: Path) -> str:
    proc = subprocess.run(
        ["kubectl", "apply", "-f", str(path)],
        capture_output=True,
        text=True,
        timeout=KUBECTL_APPLY_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise KubectlError(
            f"kubectl apply -f {path} failed (rc={proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout


class ArgocdSyncPhase:
    name = "argocd_sync"
    title = "Phase 9 — Register ArgoCD Application & wait for healthy"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        secrets_path = ctx.state.data.get("secrets_ref") or ctx.paths.secrets_file
        secrets = read_secrets_file(Path(str(secrets_path)))
        github_pat = secrets.get("github_pat")
        if not github_pat:
            ctx.state.set_phase_status(
                self.name, "failed", error="missing github_pat in secrets file"
            )
            ctx.state.save()
            raise PhaseFailed(self.name, "secrets file missing github_pat — re-run phase 2")

        repo_secret = render_repo_credential_secret(
            repo_url=GITHUB_REPO_URL,
            username=GITHUB_OWNER,
            password=github_pat,
        )
        try:
            apply_stdin(repo_secret)
        except KubectlError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc
        ctx.console.print("[green]Applied[/green] eloup-repo Secret to argocd namespace")

        application_path = ARGOCD_DIR / "eloup-app.yaml"
        if not application_path.exists():
            msg = (
                f"Application manifest not found at {application_path} — "
                "run phase 6 first (generate_manifests)."
            )
            ctx.state.set_phase_status(self.name, "failed", error=msg)
            ctx.state.save()
            raise PhaseFailed(self.name, msg)
        try:
            _apply_application_file(application_path)
        except KubectlError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc
        ctx.console.print(f"[green]Applied[/green] Application/eloup from {application_path}")

        synced, last_sync, last_health, last_conditions = _poll_until_healthy(ctx.console)
        if not synced:
            ctx.console.print(
                f"[red]Application did not reach Synced/Healthy in "
                f"{int(POLL_DEADLINE_SECONDS)}s.[/red]"
            )
            ctx.console.print(f"Last sync: {last_sync}, last health: {last_health}.")
            if last_conditions:
                ctx.console.print(f"Conditions: {last_conditions}")
            ctx.console.print("[dim]Debug:[/dim] kubectl describe application eloup -n argocd")
            msg = (
                f"timeout waiting for Synced/Healthy "
                f"(last sync={last_sync!r}, health={last_health!r})"
            )
            ctx.state.set_phase_status(self.name, "failed", error=msg)
            ctx.state.save()
            raise PhaseFailed(self.name, msg)

        config = ctx.state.data.get("config", {})
        app_domain = config.get("app_domain") or "eloup.kodloki.io"
        eloup_url = f"https://{app_domain}"
        ctx.state.update_config({"eloup_url": eloup_url})
        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()
        ctx.console.print(f"[green]Wizard complete — eloup is live at {eloup_url}[/green]")

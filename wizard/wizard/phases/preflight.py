from __future__ import annotations

import shutil
import socket
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

from rich.table import Table

from wizard.phases.base import PhaseContext, PhaseFailed

DOCKER_SOCKET = Path("/var/run/docker.sock")

NETWORK_TARGETS: tuple[tuple[str, str], ...] = (
    ("DockerHub", "registry-1.docker.io"),
    ("Gitea (haxley)", "haxley.luckyenough.us"),
    ("GitHub", "github.com"),
    ("Linode API", "api.linode.com"),
)


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str

    @property
    def passed(self) -> bool:
        return self.status == "pass"


def _check_kubectl() -> CheckResult:
    if shutil.which("kubectl") is None:
        return CheckResult(
            "kubectl access",
            "fail",
            "kubectl not found in PATH (the wizard image must include it)",
        )
    try:
        proc = subprocess.run(
            ["kubectl", "auth", "can-i", "list", "pods", "--all-namespaces"],
            capture_output=True,
            timeout=15,
            text=True,
        )
    except subprocess.TimeoutExpired:
        return CheckResult(
            "kubectl access", "fail", "timed out talking to the cluster (is kubeconfig mounted?)"
        )
    answer = proc.stdout.strip()
    if proc.returncode == 0 and answer == "yes":
        return CheckResult("kubectl access", "pass", "auth can-i list pods --all-namespaces → yes")
    stderr = proc.stderr.strip().splitlines()
    detail = stderr[0] if stderr else f"exit {proc.returncode}, answer={answer!r}"
    return CheckResult("kubectl access", "fail", detail)


def _check_docker_socket() -> CheckResult:
    if not DOCKER_SOCKET.exists():
        return CheckResult(
            "docker daemon",
            "fail",
            f"{DOCKER_SOCKET} not present — mount the host socket "
            "(`-v /var/run/docker.sock:/var/run/docker.sock`) or pick Kaniko in Q-WIZ-3",
        )
    if not stat.S_ISSOCK(DOCKER_SOCKET.stat().st_mode):
        return CheckResult("docker daemon", "fail", f"{DOCKER_SOCKET} exists but is not a socket")
    if shutil.which("docker") is None:
        return CheckResult("docker daemon", "fail", "docker CLI not installed in the wizard image")
    try:
        proc = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            capture_output=True,
            timeout=10,
            text=True,
        )
    except subprocess.TimeoutExpired:
        return CheckResult(
            "docker daemon", "fail", "`docker version` timed out (daemon unreachable?)"
        )
    if proc.returncode != 0:
        first_line = proc.stderr.strip().splitlines()
        return CheckResult(
            "docker daemon",
            "fail",
            first_line[0] if first_line else f"docker version exit {proc.returncode}",
        )
    server_version = proc.stdout.strip() or "unknown"
    return CheckResult("docker daemon", "pass", f"server version {server_version}")


def _check_tcp(host: str, port: int = 443, timeout: float = 5.0) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"{host}:{port} reachable"
    except OSError as exc:
        return False, f"{host}:{port}: {exc}"


def _check_network() -> list[CheckResult]:
    results: list[CheckResult] = []
    for label, host in NETWORK_TARGETS:
        ok, detail = _check_tcp(host)
        results.append(CheckResult(f"network → {label}", "pass" if ok else "fail", detail))
    return results


def run_checks() -> list[CheckResult]:
    return [_check_kubectl(), _check_docker_socket(), *_check_network()]


def render_table(console, results: list[CheckResult]) -> None:
    table = Table(title="Preflight checks", show_lines=False)
    table.add_column("Check", style="bold")
    table.add_column("Status")
    table.add_column("Detail", overflow="fold")
    for r in results:
        if r.passed:
            status = "[green]PASS[/green]"
        else:
            status = "[red]FAIL[/red]"
        table.add_row(r.name, status, r.detail)
    console.print(table)


class PreflightPhase:
    name = "preflight"
    title = "Phase 1 — Preflight"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        results = run_checks()
        render_table(ctx.console, results)
        failed = [r for r in results if not r.passed]
        if failed:
            ctx.state.set_phase_status(
                self.name, "failed", error=f"{len(failed)} preflight check(s) failed"
            )
            ctx.state.save()
            raise PhaseFailed(self.name, f"{len(failed)} of {len(results)} checks failed")

        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()
        ctx.console.print("[green]Preflight passed.[/green]")

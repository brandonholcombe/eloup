from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from rich.table import Table

from wizard.phases.base import PhaseContext, PhaseFailed

SEALED_SECRETS_VERSION = "v0.27.1"
SEALED_SECRETS_MANIFEST_URL = (
    f"https://github.com/bitnami-labs/sealed-secrets/releases/download/"
    f"{SEALED_SECRETS_VERSION}/controller.yaml"
)
SEALED_SECRETS_DEPLOYMENT = "sealed-secrets-controller"
SEALED_SECRETS_CRD = "sealedsecrets.bitnami.com"
SEALED_SECRETS_NAMESPACES = ("kube-system", "sealed-secrets")
ROLLOUT_TIMEOUT = "180s"
KUBECTL_TIMEOUT_SECONDS = 30


@dataclass
class CheckOutcome:
    name: str
    ok: bool
    detail: str
    fix_command: str | None = None


def _kubectl_json(args: list[str]) -> tuple[bool, dict | list | None, str]:
    proc = subprocess.run(
        ["kubectl", *args, "-o", "json"],
        capture_output=True,
        text=True,
        timeout=KUBECTL_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        return False, None, proc.stderr.strip() or f"exit {proc.returncode}"
    try:
        return True, json.loads(proc.stdout), ""
    except json.JSONDecodeError as exc:
        return False, None, f"could not parse kubectl JSON output: {exc}"


def _kubectl_exists(args: list[str]) -> tuple[bool, str]:
    proc = subprocess.run(
        ["kubectl", *args],
        capture_output=True,
        text=True,
        timeout=KUBECTL_TIMEOUT_SECONDS,
    )
    if proc.returncode == 0:
        return True, proc.stdout.strip()
    return False, proc.stderr.strip() or f"exit {proc.returncode}"


def _check_argocd() -> CheckOutcome:
    ns_ok, _ = _kubectl_exists(["get", "namespace", "argocd"])
    if not ns_ok:
        return CheckOutcome(
            "ArgoCD",
            False,
            "namespace 'argocd' missing",
            fix_command="kubectl create namespace argocd && kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml",
        )
    deploy_ok, detail = _kubectl_exists(
        ["-n", "argocd", "get", "deployment", "argocd-application-controller"]
    )
    if not deploy_ok:
        return CheckOutcome(
            "ArgoCD",
            False,
            f"deployment argocd-application-controller missing: {detail}",
            fix_command="kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml",
        )
    return CheckOutcome("ArgoCD", True, "namespace + application-controller present")


def _check_cert_manager() -> CheckOutcome:
    ns_ok, _ = _kubectl_exists(["get", "namespace", "cert-manager"])
    if not ns_ok:
        return CheckOutcome(
            "cert-manager",
            False,
            "namespace 'cert-manager' missing",
            fix_command="kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml",
        )
    ok, body, err = _kubectl_json(["get", "clusterissuer", "letsencrypt-prod"])
    if not ok or not isinstance(body, dict):
        return CheckOutcome(
            "cert-manager",
            False,
            f"ClusterIssuer letsencrypt-prod not found: {err}",
            fix_command="kubectl apply -f <your-letsencrypt-prod-clusterissuer.yaml>",
        )
    conditions = (body.get("status") or {}).get("conditions") or []
    ready = any(c.get("type") == "Ready" and c.get("status") == "True" for c in conditions)
    if not ready:
        return CheckOutcome(
            "cert-manager",
            False,
            "ClusterIssuer letsencrypt-prod is not Ready=True",
            fix_command="kubectl describe clusterissuer letsencrypt-prod  # then fix root cause",
        )
    return CheckOutcome("cert-manager", True, "letsencrypt-prod ClusterIssuer Ready=True")


def _check_ingress_nginx() -> CheckOutcome:
    ok, body, err = _kubectl_json(["get", "ingressclass", "nginx"])
    if not ok or not isinstance(body, dict):
        return CheckOutcome(
            "ingress-nginx",
            False,
            f"IngressClass 'nginx' missing: {err}",
            fix_command="kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml",
        )
    controller = (body.get("spec") or {}).get("controller")
    if controller != "k8s.io/ingress-nginx":
        return CheckOutcome(
            "ingress-nginx",
            False,
            (
                f"IngressClass 'nginx' has spec.controller={controller!r}, "
                "expected 'k8s.io/ingress-nginx'"
            ),
            fix_command=(
                "kubectl get ingressclass nginx -o yaml  # then reinstall ingress-nginx if needed"
            ),
        )
    return CheckOutcome("ingress-nginx", True, "IngressClass nginx → k8s.io/ingress-nginx")


def _check_storage_class() -> CheckOutcome:
    ok, body, err = _kubectl_json(["get", "storageclass", "linode-block-storage-retain"])
    if not ok or not isinstance(body, dict):
        return CheckOutcome(
            "StorageClass",
            False,
            f"StorageClass 'linode-block-storage-retain' missing: {err}",
            fix_command=(
                "# StorageClass is provisioned by Linode CSI; "
                "check `kubectl get csidriver linodebs.csi.linode.com`"
            ),
        )
    annotations = (body.get("metadata") or {}).get("annotations") or {}
    if annotations.get("storageclass.kubernetes.io/is-default-class") != "true":
        patch_body = (
            '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
        )
        return CheckOutcome(
            "StorageClass",
            False,
            "StorageClass exists but is not marked default",
            fix_command=(
                f"kubectl patch storageclass linode-block-storage-retain -p '{patch_body}'"
            ),
        )
    return CheckOutcome(
        "StorageClass",
        True,
        "linode-block-storage-retain is default",
    )


def _detect_sealed_secrets_namespace() -> str | None:
    crd_ok, _ = _kubectl_exists(["get", "crd", SEALED_SECRETS_CRD])
    if not crd_ok:
        return None
    for ns in SEALED_SECRETS_NAMESPACES:
        ok, body, _ = _kubectl_json(["-n", ns, "get", "deployment", SEALED_SECRETS_DEPLOYMENT])
        if not ok or not isinstance(body, dict):
            continue
        conditions = (body.get("status") or {}).get("conditions") or []
        if any(c.get("type") == "Available" and c.get("status") == "True" for c in conditions):
            return ns
    return None


def _check_sealed_secrets() -> tuple[CheckOutcome, str | None]:
    ns = _detect_sealed_secrets_namespace()
    if ns is None:
        return (
            CheckOutcome(
                "Sealed Secrets",
                False,
                "controller not Available in kube-system or sealed-secrets",
                fix_command=(
                    f"# Re-run with --install-sealed-secrets, OR manually:\n"
                    f"kubectl apply -f {SEALED_SECRETS_MANIFEST_URL}"
                ),
            ),
            None,
        )
    return CheckOutcome("Sealed Secrets", True, f"controller Available in {ns}"), ns


def _install_sealed_secrets(console) -> str:
    console.print(
        f"[yellow]Installing Sealed Secrets {SEALED_SECRETS_VERSION}[/yellow] "
        "from upstream manifest"
    )
    proc = subprocess.run(
        ["kubectl", "apply", "-f", SEALED_SECRETS_MANIFEST_URL],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"kubectl apply -f {SEALED_SECRETS_MANIFEST_URL} failed: "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )

    ns = "kube-system"
    rollout = subprocess.run(
        [
            "kubectl",
            "-n",
            ns,
            "rollout",
            "status",
            f"deployment/{SEALED_SECRETS_DEPLOYMENT}",
            f"--timeout={ROLLOUT_TIMEOUT}",
        ],
        capture_output=True,
        text=True,
        timeout=240,
    )
    if rollout.returncode != 0:
        raise RuntimeError(
            f"sealed-secrets-controller did not become Available: "
            f"{rollout.stderr.strip() or rollout.stdout.strip()}"
        )
    return ns


def _fetch_sealed_secrets_cert(namespace: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["kubeseal", "--fetch-cert", f"--controller-namespace={namespace}"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"kubeseal --fetch-cert failed: {proc.stderr.strip() or proc.stdout.strip()}"
        )
    dest.write_text(proc.stdout)


def _render_outcomes(console, outcomes: list[CheckOutcome]) -> None:
    table = Table(title="Cluster bootstrap detection", show_lines=False)
    table.add_column("Component", style="bold")
    table.add_column("Status")
    table.add_column("Detail", overflow="fold")
    for o in outcomes:
        status = "[green]OK[/green]" if o.ok else "[red]MISSING[/red]"
        table.add_row(o.name, status, o.detail)
    console.print(table)
    for o in outcomes:
        if not o.ok and o.fix_command:
            console.print(f"[yellow]Fix for {o.name}:[/yellow]\n  {o.fix_command}")


class ClusterBootstrapPhase:
    name = "cluster_bootstrap"
    title = "Phase 4 — Cluster bootstrap detection"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        outcomes = [
            _check_argocd(),
            _check_cert_manager(),
            _check_ingress_nginx(),
            _check_storage_class(),
        ]
        sealed_outcome, controller_ns = _check_sealed_secrets()
        outcomes.append(sealed_outcome)

        if not sealed_outcome.ok and ctx.install_sealed_secrets:
            try:
                controller_ns = _install_sealed_secrets(ctx.console)
            except RuntimeError as exc:
                _render_outcomes(ctx.console, outcomes)
                ctx.state.set_phase_status(self.name, "failed", error=str(exc))
                ctx.state.save()
                raise PhaseFailed(self.name, str(exc)) from exc
            outcomes[-1] = CheckOutcome(
                "Sealed Secrets", True, f"freshly installed in {controller_ns}"
            )

        _render_outcomes(ctx.console, outcomes)
        missing = [o for o in outcomes if not o.ok]
        if missing:
            names = ", ".join(o.name for o in missing)
            ctx.state.set_phase_status(self.name, "failed", error=f"missing: {names}")
            ctx.state.save()
            raise PhaseFailed(self.name, f"{len(missing)} cluster component(s) missing: {names}")

        assert controller_ns is not None
        cert_path = ctx.paths.state_dir / "sealed-secrets.crt"
        try:
            _fetch_sealed_secrets_cert(controller_ns, cert_path)
        except RuntimeError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc

        ctx.state.update_config(
            {
                "sealed_secrets_namespace": controller_ns,
                "sealed_secrets_cert_path": str(cert_path),
                "sealed_secrets_version": SEALED_SECRETS_VERSION,
            }
        )
        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()
        ctx.console.print(
            f"[green]Phase 4 done — cluster ready, sealed-secrets cert at[/green] {cert_path}"
        )

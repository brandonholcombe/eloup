from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from click.testing import CliRunner
from rich.console import Console

from wizard.cli import main
from wizard.paths import WizardPaths
from wizard.phases import cluster_bootstrap as cb
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import WizardState


def _make_ctx(tmp_path: Path, *, install_sealed: bool = False) -> PhaseContext:
    paths = WizardPaths(state_dir=tmp_path / "state")
    state = WizardState.load_or_initialize(paths.state_file)
    state.save()
    return PhaseContext(
        state=state,
        paths=paths,
        console=Console(record=True, width=120),
        config_path=None,
        generate_session=False,
        keep=False,
        install_sealed_secrets=install_sealed,
    )


class FakeKubectl:
    """Programmable fake for subprocess.run when invoked with kubectl/kubeseal."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.responses: dict[tuple[str, ...], subprocess.CompletedProcess[str]] = {}

    def add(
        self, args: tuple[str, ...], *, stdout: str = "", stderr: str = "", returncode: int = 0
    ) -> None:
        self.responses[args] = subprocess.CompletedProcess(
            args=list(args), returncode=returncode, stdout=stdout, stderr=stderr
        )

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        for key, resp in self.responses.items():
            if list(args) == list(key):
                return resp
        for key, resp in self.responses.items():
            if list(args)[: len(key)] == list(key):
                return resp
        return subprocess.CompletedProcess(
            args=list(args),
            returncode=1,
            stdout="",
            stderr=f"FakeKubectl: no response registered for {args}",
        )


def _all_present_fake() -> FakeKubectl:
    fk = FakeKubectl()
    fk.add(("kubectl", "get", "namespace", "argocd"), stdout="argocd")
    fk.add(
        ("kubectl", "-n", "argocd", "get", "deployment", "argocd-application-controller"),
        stdout="argocd-application-controller",
    )
    fk.add(("kubectl", "get", "namespace", "cert-manager"), stdout="cert-manager")
    fk.add(
        ("kubectl", "get", "clusterissuer", "letsencrypt-prod", "-o", "json"),
        stdout=json.dumps({"status": {"conditions": [{"type": "Ready", "status": "True"}]}}),
    )
    fk.add(
        ("kubectl", "get", "ingressclass", "nginx", "-o", "json"),
        stdout=json.dumps({"spec": {"controller": "k8s.io/ingress-nginx"}}),
    )
    fk.add(
        ("kubectl", "get", "storageclass", "linode-block-storage-retain", "-o", "json"),
        stdout=json.dumps(
            {"metadata": {"annotations": {"storageclass.kubernetes.io/is-default-class": "true"}}}
        ),
    )
    fk.add(("kubectl", "get", "crd", cb.SEALED_SECRETS_CRD), stdout=cb.SEALED_SECRETS_CRD)
    fk.add(
        (
            "kubectl",
            "-n",
            "kube-system",
            "get",
            "deployment",
            cb.SEALED_SECRETS_DEPLOYMENT,
            "-o",
            "json",
        ),
        stdout=json.dumps({"status": {"conditions": [{"type": "Available", "status": "True"}]}}),
    )
    fk.add(
        ("kubeseal", "--fetch-cert", "--controller-namespace=kube-system"),
        stdout="-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
    )
    return fk


@pytest.fixture
def patched_subprocess(monkeypatch: pytest.MonkeyPatch) -> FakeKubectl:
    fk = _all_present_fake()
    monkeypatch.setattr(cb.subprocess, "run", fk)
    return fk


def test_phase4_all_present_marks_done_and_caches_cert(tmp_path: Path, patched_subprocess) -> None:
    ctx = _make_ctx(tmp_path)

    cb.ClusterBootstrapPhase().run(ctx)

    assert ctx.state.phase("cluster_bootstrap")["status"] == "done"
    cert_path = Path(ctx.state.data["config"]["sealed_secrets_cert_path"])
    assert cert_path.exists()
    assert "BEGIN CERTIFICATE" in cert_path.read_text()
    assert ctx.state.data["config"]["sealed_secrets_namespace"] == "kube-system"
    assert ctx.state.data["config"]["sealed_secrets_version"] == cb.SEALED_SECRETS_VERSION


def test_phase4_argocd_missing_fails_with_fix_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fk = _all_present_fake()
    fk.responses[("kubectl", "get", "namespace", "argocd")] = subprocess.CompletedProcess(
        args=[], returncode=1, stdout="", stderr="not found"
    )
    monkeypatch.setattr(cb.subprocess, "run", fk)

    ctx = _make_ctx(tmp_path)
    with pytest.raises(PhaseFailed) as exc:
        cb.ClusterBootstrapPhase().run(ctx)
    assert "ArgoCD" in str(exc.value)
    assert ctx.state.phase("cluster_bootstrap")["status"] == "failed"


def test_phase4_argocd_detected_via_statefulset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Argo CD v2.2+ deploys argocd-application-controller as a StatefulSet.

    Regression: tow-c1 runs the StatefulSet form and the original
    Deployment-only check returned a false-negative MISSING.
    """
    fk = _all_present_fake()
    fk.responses.pop(
        ("kubectl", "-n", "argocd", "get", "deployment", "argocd-application-controller"),
        None,
    )
    fk.add(
        ("kubectl", "-n", "argocd", "get", "statefulset", "argocd-application-controller"),
        stdout="argocd-application-controller",
    )
    monkeypatch.setattr(cb.subprocess, "run", fk)

    ctx = _make_ctx(tmp_path)
    cb.ClusterBootstrapPhase().run(ctx)

    assert ctx.state.phase("cluster_bootstrap")["status"] == "done"


def test_phase4_argocd_missing_neither_deployment_nor_statefulset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fk = _all_present_fake()
    fk.responses.pop(
        ("kubectl", "-n", "argocd", "get", "deployment", "argocd-application-controller"),
        None,
    )
    monkeypatch.setattr(cb.subprocess, "run", fk)

    ctx = _make_ctx(tmp_path)
    with pytest.raises(PhaseFailed) as exc:
        cb.ClusterBootstrapPhase().run(ctx)
    assert "argocd-application-controller" in str(exc.value).lower() or "ArgoCD" in str(exc.value)


def test_phase4_storageclass_not_default_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fk = _all_present_fake()
    fk.responses[
        ("kubectl", "get", "storageclass", "linode-block-storage-retain", "-o", "json")
    ] = subprocess.CompletedProcess(
        args=[],
        returncode=0,
        stdout=json.dumps({"metadata": {"annotations": {}}}),
        stderr="",
    )
    monkeypatch.setattr(cb.subprocess, "run", fk)

    ctx = _make_ctx(tmp_path)
    with pytest.raises(PhaseFailed):
        cb.ClusterBootstrapPhase().run(ctx)
    assert "StorageClass" in (ctx.state.phase("cluster_bootstrap").get("error") or "")


def test_phase4_sealed_missing_no_install_flag_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fk = _all_present_fake()
    fk.responses[("kubectl", "get", "crd", cb.SEALED_SECRETS_CRD)] = subprocess.CompletedProcess(
        args=[], returncode=1, stdout="", stderr="CRD not found"
    )
    monkeypatch.setattr(cb.subprocess, "run", fk)

    ctx = _make_ctx(tmp_path, install_sealed=False)
    with pytest.raises(PhaseFailed):
        cb.ClusterBootstrapPhase().run(ctx)
    assert "Sealed Secrets" in (ctx.state.phase("cluster_bootstrap").get("error") or "")


def test_phase4_sealed_missing_with_install_flag_installs_and_caches(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fk = _all_present_fake()
    fk.responses[("kubectl", "get", "crd", cb.SEALED_SECRETS_CRD)] = subprocess.CompletedProcess(
        args=[], returncode=1, stdout="", stderr="CRD not found"
    )
    fk.add(
        ("kubectl", "apply", "-f", cb.SEALED_SECRETS_MANIFEST_URL),
        stdout="created",
    )
    fk.add(
        (
            "kubectl",
            "-n",
            "kube-system",
            "rollout",
            "status",
            f"deployment/{cb.SEALED_SECRETS_DEPLOYMENT}",
            f"--timeout={cb.ROLLOUT_TIMEOUT}",
        ),
        stdout="rolled out",
    )
    monkeypatch.setattr(cb.subprocess, "run", fk)

    ctx = _make_ctx(tmp_path, install_sealed=True)
    cb.ClusterBootstrapPhase().run(ctx)

    assert ctx.state.phase("cluster_bootstrap")["status"] == "done"
    apply_call = next(c for c in fk.calls if "apply" in c)
    assert cb.SEALED_SECRETS_MANIFEST_URL in apply_call
    assert cb.SEALED_SECRETS_VERSION in cb.SEALED_SECRETS_MANIFEST_URL


def test_phase4_threads_install_flag_from_cli(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def fake_run(ctx: PhaseContext) -> int:
        captured["install_sealed_secrets"] = ctx.install_sealed_secrets
        return 0

    monkeypatch.setattr("wizard.cli.run", fake_run)

    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "--state-dir",
            str(tmp_path / "state"),
            "--install-sealed-secrets",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured["install_sealed_secrets"] is True


def test_phase4_default_install_flag_false(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_run(ctx: PhaseContext) -> int:
        captured["install_sealed_secrets"] = ctx.install_sealed_secrets
        return 0

    monkeypatch.setattr("wizard.cli.run", fake_run)

    runner = CliRunner()
    result = runner.invoke(main, ["--state-dir", str(tmp_path / "state")])
    assert result.exit_code == 0, result.output
    assert captured["install_sealed_secrets"] is False


def test_phase4_help_lists_install_sealed_secrets() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["--help"])
    assert result.exit_code == 0
    assert "--install-sealed-secrets" in result.output


def test_sealed_namespace_detection_finds_sealed_secrets_ns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fk = FakeKubectl()
    fk.add(("kubectl", "get", "crd", cb.SEALED_SECRETS_CRD), stdout=cb.SEALED_SECRETS_CRD)
    fk.add(
        (
            "kubectl",
            "-n",
            "kube-system",
            "get",
            "deployment",
            cb.SEALED_SECRETS_DEPLOYMENT,
            "-o",
            "json",
        ),
        returncode=1,
        stderr="not found in kube-system",
    )
    fk.add(
        (
            "kubectl",
            "-n",
            "sealed-secrets",
            "get",
            "deployment",
            cb.SEALED_SECRETS_DEPLOYMENT,
            "-o",
            "json",
        ),
        stdout=json.dumps({"status": {"conditions": [{"type": "Available", "status": "True"}]}}),
    )
    monkeypatch.setattr(cb.subprocess, "run", fk)

    assert cb._detect_sealed_secrets_namespace() == "sealed-secrets"

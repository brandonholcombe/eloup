from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from rich.console import Console

from wizard.paths import WizardPaths
from wizard.phases import argocd_sync as a9
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import WizardState, write_secrets_file


def _make_ctx(
    tmp_path: Path,
    *,
    application_present: bool = True,
    with_pat: bool = True,
    monkeypatch: pytest.MonkeyPatch | None = None,
) -> PhaseContext:
    state_dir = tmp_path / "state"
    paths = WizardPaths(state_dir=state_dir)
    state = WizardState.load_or_initialize(paths.state_file)
    state.update_config({"app_domain": "eloup.kodloki.io"})
    state.save()

    secrets: dict[str, str] = {
        "dockerhub_pat": "x",
        "gitea_pat": "x",
        "linode_pat": "x",
        "discord_client_secret": "x",
        "app_session_secret": "x",
    }
    if with_pat:
        secrets["github_pat"] = "ghp_secret_value"
    write_secrets_file(paths.secrets_file, secrets)
    state.set_secrets_ref(paths.secrets_file)
    state.save()

    if monkeypatch is not None:
        argocd_dir = tmp_path / "argocd"
        argocd_dir.mkdir(exist_ok=True)
        if application_present:
            (argocd_dir / "eloup-app.yaml").write_text("kind: Application\n")
        monkeypatch.setattr(a9, "ARGOCD_DIR", argocd_dir)

    return PhaseContext(
        state=state,
        paths=paths,
        console=Console(record=True, width=120),
        config_path=None,
        generate_session=False,
        keep=False,
    )


class FakeKubectl:
    """Programmable subprocess.run fake for kubectl invocations.

    Distinguishes apply-stdin (input= passed) from get/apply-file by argv.
    Test wires up a sequence of `application get` responses (consumed in
    order) so it can simulate not-yet-visible → visible-without-status →
    Synced/Healthy progression.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[list[str], str | None]] = []
        self.apply_stdin_response = subprocess.CompletedProcess([], 0, "applied", "")
        self.apply_file_response = subprocess.CompletedProcess([], 0, "applied", "")
        self.get_responses: list[subprocess.CompletedProcess[str]] = []

    def add_get(self, *, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.get_responses.append(
            subprocess.CompletedProcess(
                args=["kubectl", "get"], returncode=returncode, stdout=stdout, stderr=stderr
            )
        )

    def __call__(self, args, **kwargs):
        stdin = kwargs.get("input")
        self.calls.append((list(args), stdin))
        if list(args)[:4] == ["kubectl", "apply", "-f", "-"]:
            return self.apply_stdin_response
        if list(args)[:3] == ["kubectl", "apply", "-f"]:
            return self.apply_file_response
        if list(args)[:3] == ["kubectl", "-n", "argocd"] and "get" in args:
            if not self.get_responses:
                return subprocess.CompletedProcess(args, 1, "", "no more responses")
            return self.get_responses.pop(0)
        return subprocess.CompletedProcess(args, 1, "", f"unexpected: {args}")


def _wire(monkeypatch: pytest.MonkeyPatch, fk: FakeKubectl) -> None:
    monkeypatch.setattr(a9.subprocess, "run", fk)
    from wizard.phases import _kubectl

    monkeypatch.setattr(_kubectl.subprocess, "run", fk)
    monkeypatch.setattr(a9.time, "sleep", lambda *_a, **_k: None)


def _healthy_json() -> str:
    return json.dumps({"status": {"sync": {"status": "Synced"}, "health": {"status": "Healthy"}}})


def _progressing_json() -> str:
    return json.dumps(
        {
            "status": {
                "sync": {"status": "OutOfSync"},
                "health": {"status": "Progressing"},
                "conditions": [{"type": "ComparisonError", "message": "still working"}],
            }
        }
    )


def test_phase9_happy_path_synced_healthy_first_poll(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    fk.add_get(stdout=_healthy_json())
    _wire(monkeypatch, fk)

    a9.ArgocdSyncPhase().run(ctx)

    assert ctx.state.phase("argocd_sync")["status"] == "done"
    assert ctx.state.data["config"]["eloup_url"] == "https://eloup.kodloki.io"


def test_phase9_repo_secret_via_stdin_pat_not_in_argv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    fk.add_get(stdout=_healthy_json())
    _wire(monkeypatch, fk)

    a9.ArgocdSyncPhase().run(ctx)

    apply_stdin_calls = [
        (args, stdin) for args, stdin in fk.calls if args[:4] == ["kubectl", "apply", "-f", "-"]
    ]
    assert len(apply_stdin_calls) == 1
    args, stdin = apply_stdin_calls[0]
    assert "ghp_secret_value" not in " ".join(args), "PAT leaked into argv"
    assert stdin is not None
    assert stdin.count("ghp_secret_value") == 1, "PAT should appear exactly once in stdin"
    assert "stringData:" in stdin
    assert "eloup-repo" in stdin


def test_phase9_application_apply_uses_phase6_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    fk.add_get(stdout=_healthy_json())
    _wire(monkeypatch, fk)

    a9.ArgocdSyncPhase().run(ctx)

    apply_file_calls = [
        args for args, _ in fk.calls if args[:3] == ["kubectl", "apply", "-f"] and args[3] != "-"
    ]
    assert len(apply_file_calls) == 1
    expected_path = str(a9.ARGOCD_DIR / "eloup-app.yaml")
    assert apply_file_calls[0][3] == expected_path


def test_phase9_handles_not_yet_visible_then_no_status_then_healthy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    fk.add_get(
        returncode=1,
        stdout="",
        stderr='Error from server (NotFound): applications.argoproj.io "eloup" not found',
    )
    fk.add_get(returncode=1, stdout="not-json", stderr="")
    fk.add_get(stdout="{}")
    fk.add_get(stdout=_progressing_json())
    fk.add_get(stdout=_healthy_json())
    _wire(monkeypatch, fk)

    a9.ArgocdSyncPhase().run(ctx)

    assert ctx.state.phase("argocd_sync")["status"] == "done"


def test_phase9_polling_timeout_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = _make_ctx(tmp_path, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    for _ in range(50):
        fk.add_get(stdout=_progressing_json())
    _wire(monkeypatch, fk)

    times = iter([0.0, 1.0] + [1000.0] * 50)
    monkeypatch.setattr(a9.time, "monotonic", lambda: next(times))

    with pytest.raises(PhaseFailed) as exc_info:
        a9.ArgocdSyncPhase().run(ctx)

    assert "timeout" in str(exc_info.value).lower()
    assert "Progressing" in str(exc_info.value) or "OutOfSync" in str(exc_info.value)
    assert ctx.state.phase("argocd_sync")["status"] == "failed"


def test_phase9_missing_application_file_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, application_present=False, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    _wire(monkeypatch, fk)

    with pytest.raises(PhaseFailed) as exc_info:
        a9.ArgocdSyncPhase().run(ctx)
    assert "phase 6" in str(exc_info.value)


def test_phase9_apply_stdin_failure_propagates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    fk.apply_stdin_response = subprocess.CompletedProcess([], 1, "", "permission denied")
    _wire(monkeypatch, fk)

    with pytest.raises(PhaseFailed) as exc_info:
        a9.ArgocdSyncPhase().run(ctx)
    assert "permission denied" in str(exc_info.value)


def test_phase9_missing_github_pat_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = _make_ctx(tmp_path, with_pat=False, monkeypatch=monkeypatch)
    fk = FakeKubectl()
    _wire(monkeypatch, fk)

    with pytest.raises(PhaseFailed) as exc_info:
        a9.ArgocdSyncPhase().run(ctx)
    assert "github_pat" in str(exc_info.value)

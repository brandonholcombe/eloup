from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from rich.console import Console

from wizard.paths import WizardPaths
from wizard.phases import push_manifests as pm
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import WizardState


def _make_ctx(tmp_path: Path, *, last_built_sha: str | None = "deadbeef") -> PhaseContext:
    state_dir = tmp_path / "state"
    paths = WizardPaths(state_dir=state_dir)
    state = WizardState.load_or_initialize(paths.state_file)
    if last_built_sha is not None:
        state.update_config({"last_built_sha": last_built_sha})
    state.save()
    return PhaseContext(
        state=state,
        paths=paths,
        console=Console(record=True, width=120),
        config_path=None,
        generate_session=False,
        keep=False,
    )


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    monkeypatch.setattr(pm, "WORKSPACE_DIR", ws)
    return ws


class FakeGit:
    """Programmable fake for `git -C <workspace> ...` invocations.

    Matches by the args that follow `git -C <workspace>` so callers can ignore
    the workspace path. Returns the first matching response, falling back to a
    non-zero error if nothing matches.
    """

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.responses: list[tuple[tuple[str, ...], subprocess.CompletedProcess[str]]] = []

    def add(
        self,
        suffix: tuple[str, ...],
        *,
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
    ) -> None:
        self.responses.append(
            (
                suffix,
                subprocess.CompletedProcess(
                    args=list(suffix), returncode=returncode, stdout=stdout, stderr=stderr
                ),
            )
        )

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        suffix = (
            tuple(args[3:])
            if len(args) > 3 and args[0] == "git" and args[1] == "-C"
            else tuple(args[1:])
        )
        for sfx, resp in self.responses:
            if suffix[: len(sfx)] == sfx:
                return resp
        return subprocess.CompletedProcess(
            args=list(args),
            returncode=1,
            stdout="",
            stderr=f"FakeGit: no response for {args}",
        )

    def calls_with_suffix(self, suffix: tuple[str, ...]) -> list[list[str]]:
        return [c for c in self.calls if tuple(c[3:])[: len(suffix)] == suffix]


def _wire(monkeypatch: pytest.MonkeyPatch, fake: FakeGit) -> None:
    monkeypatch.setattr(pm.subprocess, "run", fake)


def test_phase7_both_pushes_succeed(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path)
    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=1)
    fake.add(("commit", "-m"), stdout="committed", returncode=0)
    fake.add(("push", "github", "main"), stdout="To github\n  abc..def main -> main")
    fake.add(("push", "gitea", "main"), stdout="To gitea\n  abc..def main -> main")
    _wire(monkeypatch, fake)

    pm.PushManifestsPhase().run(ctx)

    phase = ctx.state.phase("push_manifests")
    assert phase["status"] == "done"
    assert phase["substeps"]["push_github"]["status"] == "done"
    assert phase["substeps"]["push_gitea"]["status"] == "done"
    assert any(c[3:6] == ["push", "github", "main"] for c in fake.calls)
    assert any(c[3:6] == ["push", "gitea", "main"] for c in fake.calls)


def test_phase7_no_diff_skips_commit_but_still_pushes(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path)
    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=0)
    fake.add(("push", "github", "main"), stdout="Everything up-to-date")
    fake.add(("push", "gitea", "main"), stdout="Everything up-to-date")
    _wire(monkeypatch, fake)

    pm.PushManifestsPhase().run(ctx)

    assert ctx.state.phase("push_manifests")["status"] == "done"
    commit_calls = [c for c in fake.calls if len(c) > 3 and c[3] == "commit"]
    assert commit_calls == []


def test_phase7_github_fails_gitea_never_called(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path)
    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=1)
    fake.add(("commit", "-m"))
    fake.add(("push", "github", "main"), stderr="permission denied", returncode=1)
    _wire(monkeypatch, fake)

    with pytest.raises(PhaseFailed) as exc_info:
        pm.PushManifestsPhase().run(ctx)
    assert "github" in str(exc_info.value)

    phase = ctx.state.phase("push_manifests")
    assert phase["status"] == "failed"
    assert phase["substeps"]["push_github"]["status"] == "failed"
    assert phase["substeps"]["push_gitea"]["status"] == "pending"
    assert all(not (len(c) > 3 and c[3:6] == ["push", "gitea", "main"]) for c in fake.calls)


def test_phase7_gitea_fails_phase_still_done_with_warning(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path)
    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=1)
    fake.add(("commit", "-m"))
    fake.add(("push", "github", "main"), stdout="ok")
    fake.add(("push", "gitea", "main"), stderr="connection refused", returncode=1)
    _wire(monkeypatch, fake)

    pm.PushManifestsPhase().run(ctx)

    phase = ctx.state.phase("push_manifests")
    assert phase["status"] == "done"
    assert phase["substeps"]["push_github"]["status"] == "done"
    assert phase["substeps"]["push_gitea"]["status"] == "failed"
    assert "connection refused" in phase["substeps"]["push_gitea"]["error"]
    output = ctx.console.export_text()
    assert "Gitea mirror push failed" in output
    assert "without flags" in output
    assert "Do NOT use" in output


def test_retry_gitea_only_without_retry_from(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simulate a re-run after a Gitea-only failure on a prior run.

    The operator must NOT use `--retry-from push_manifests` here — that
    path goes through `state.reset_from()` which would reset
    `push_github` from `done` to `pending`. Instead, the runner re-enters
    the phase because `phase.status == failed` and substep state is
    preserved across runs. The phase's pre-check then skips the GitHub
    push entirely and retries only the Gitea push.
    """
    ctx = _make_ctx(tmp_path)
    ctx.state.set_substep_status("push_manifests", "push_github", "done")
    ctx.state.set_substep_status("push_manifests", "push_gitea", "failed", error="prior")
    ctx.state.set_phase_status("push_manifests", "failed", error="prior gitea fail")
    ctx.state.save()

    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=0)
    fake.add(("push", "gitea", "main"), stdout="To gitea\n  abc..def main -> main")
    _wire(monkeypatch, fake)

    pm.PushManifestsPhase().run(ctx)

    phase = ctx.state.phase("push_manifests")
    assert phase["status"] == "done"
    assert phase["substeps"]["push_github"]["status"] == "done"
    assert phase["substeps"]["push_gitea"]["status"] == "done"
    assert all(not (len(c) > 3 and c[3:6] == ["push", "github", "main"]) for c in fake.calls)


def test_phase7_commit_message_uses_last_built_sha(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, last_built_sha="cafef00d")
    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=1)
    fake.add(("commit", "-m"))
    fake.add(("push", "github", "main"), stdout="ok")
    fake.add(("push", "gitea", "main"), stdout="ok")
    _wire(monkeypatch, fake)

    pm.PushManifestsPhase().run(ctx)

    commit_calls = [c for c in fake.calls if len(c) > 3 and c[3] == "commit"]
    assert commit_calls
    msg = commit_calls[0][5]
    assert "cafef00d" in msg


def test_phase7_commit_message_falls_back_to_wizard_sha(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, last_built_sha=None)
    ctx.state.update_config(
        {
            "last_built_images": {
                "eloup-wizard": {
                    "sha_tag": "wizardsha",
                    "latest_tag": "latest",
                    "skipped": False,
                },
            }
        }
    )
    ctx.state.save()
    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=1)
    fake.add(("commit", "-m"))
    fake.add(("push", "github", "main"), stdout="ok")
    fake.add(("push", "gitea", "main"), stdout="ok")
    _wire(monkeypatch, fake)

    pm.PushManifestsPhase().run(ctx)

    commit_calls = [c for c in fake.calls if len(c) > 3 and c[3] == "commit"]
    msg = commit_calls[0][5]
    assert "wizardsha" in msg


def test_phase7_commit_message_unknown_sha_when_nothing_set(
    tmp_path: Path, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = _make_ctx(tmp_path, last_built_sha=None)
    fake = FakeGit()
    fake.add(("add", "K8s", "argocd/eloup-app.yaml"))
    fake.add(("diff", "--cached", "--quiet"), returncode=1)
    fake.add(("commit", "-m"))
    fake.add(("push", "github", "main"), stdout="ok")
    fake.add(("push", "gitea", "main"), stdout="ok")
    _wire(monkeypatch, fake)

    pm.PushManifestsPhase().run(ctx)

    commit_calls = [c for c in fake.calls if len(c) > 3 and c[3] == "commit"]
    assert "unknown-sha" in commit_calls[0][5]

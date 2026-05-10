from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import responses
from rich.console import Console

from wizard.paths import WizardPaths
from wizard.phases import build_images as bi
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import WizardState, write_secrets_file


def _make_ctx(tmp_path: Path) -> PhaseContext:
    paths = WizardPaths(state_dir=tmp_path / "state")
    state = WizardState.load_or_initialize(paths.state_file)
    state.update_config({"dockerhub_user": "bholcombe"})
    state.save()
    write_secrets_file(
        paths.secrets_file,
        {
            "dockerhub_pat": "dckr_test",
            "gitea_pat": "x",
            "github_pat": "x",
            "linode_pat": "x",
            "discord_client_secret": "x",
            "app_session_secret": "x",
        },
    )
    state.set_secrets_ref(paths.secrets_file)
    state.save()
    return PhaseContext(
        state=state,
        paths=paths,
        console=Console(record=True, width=120),
        config_path=None,
        generate_session=False,
        keep=False,
    )


def _init_ws(path: Path) -> str:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=str(path), check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.email=t@x.io",
            "-c",
            "user.name=t",
            "commit",
            "--allow-empty",
            "-m",
            "init",
            "-q",
        ],
        cwd=str(path),
        check=True,
    )
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(path),
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return sha


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, str]:
    ws = tmp_path / "ws"
    sha = _init_ws(ws)
    monkeypatch.setattr(bi, "WORKSPACE_DIR", ws)
    return ws, sha


class FakeProcRecorder:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.logged_in = False

    def login(self, args, *, input=None, **kwargs) -> subprocess.CompletedProcess[str]:
        self.calls.append(list(args))
        if list(args)[:2] == ["docker", "login"]:
            assert input == "dckr_test"
            self.logged_in = True
        return subprocess.CompletedProcess(args=list(args), returncode=0, stdout="ok", stderr="")

    def run(self, args, **kwargs) -> subprocess.CompletedProcess[str]:
        self.calls.append(list(args))
        if list(args)[:2] == ["docker", "logout"]:
            self.logged_in = False
        return subprocess.CompletedProcess(args=list(args), returncode=0, stdout="ok", stderr="")


@pytest.fixture
def docker_proc(monkeypatch: pytest.MonkeyPatch) -> FakeProcRecorder:
    rec = FakeProcRecorder()

    real_run = subprocess.run

    def routed(args, **kwargs):
        first = list(args)[0] if args else ""
        if first == "docker":
            if list(args)[:2] == ["docker", "login"]:
                return rec.login(args, **kwargs)
            return rec.run(args, **kwargs)
        return real_run(args, **kwargs)

    monkeypatch.setattr(bi.subprocess, "run", routed)
    return rec


@responses.activate
def test_phase5_builds_when_image_not_pushed(
    tmp_path: Path, workspace, docker_proc: FakeProcRecorder
) -> None:
    ws, sha = workspace
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.GET,
        f"https://hub.docker.com/v2/repositories/bholcombe/eloup-wizard/tags/{sha}",
        status=404,
    )

    bi.BuildImagesPhase().run(ctx)

    buildx_calls = [c for c in docker_proc.calls if c[:3] == ["docker", "buildx", "build"]]
    assert len(buildx_calls) == 1
    args = buildx_calls[0]
    assert "--platform" in args and "linux/amd64" in args
    assert "--push" in args
    assert f"bholcombe/eloup-wizard:{sha}" in args
    assert "bholcombe/eloup-wizard:latest" in args

    assert ["docker", "login", "-u", "bholcombe", "--password-stdin"] in docker_proc.calls
    assert ["docker", "logout"] in docker_proc.calls
    assert ctx.state.phase("build_images")["status"] == "done"
    assert ctx.state.data["config"]["last_built_images"]["eloup-wizard"]["sha_tag"] == sha


@responses.activate
def test_phase5_skips_when_image_already_pushed(
    tmp_path: Path, workspace, docker_proc: FakeProcRecorder
) -> None:
    ws, sha = workspace
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.GET,
        f"https://hub.docker.com/v2/repositories/bholcombe/eloup-wizard/tags/{sha}",
        json={"name": sha},
        status=200,
    )

    bi.BuildImagesPhase().run(ctx)

    buildx_calls = [c for c in docker_proc.calls if c[:3] == ["docker", "buildx", "build"]]
    assert buildx_calls == []
    login_calls = [c for c in docker_proc.calls if c[:2] == ["docker", "login"]]
    assert login_calls == []
    logout_calls = [c for c in docker_proc.calls if c[:2] == ["docker", "logout"]]
    assert logout_calls == []
    assert ctx.state.data["config"]["last_built_images"]["eloup-wizard"]["skipped"] is True
    assert ctx.state.phase("build_images")["status"] == "done"


@responses.activate
def test_phase5_dirty_tree_appends_dirty_suffix(
    tmp_path: Path, workspace, docker_proc: FakeProcRecorder
) -> None:
    ws, sha = workspace
    (ws / "uncommitted.txt").write_text("hi\n")
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.GET,
        f"https://hub.docker.com/v2/repositories/bholcombe/eloup-wizard/tags/{sha}-dirty",
        status=404,
    )

    bi.BuildImagesPhase().run(ctx)

    buildx = next(c for c in docker_proc.calls if c[:3] == ["docker", "buildx", "build"])
    assert f"bholcombe/eloup-wizard:{sha}-dirty" in buildx
    assert ctx.state.data["config"]["last_built_dirty"] is True


@responses.activate
def test_phase5_eloup_web_absent_skipped_no_failure(
    tmp_path: Path, workspace, docker_proc: FakeProcRecorder
) -> None:
    ws, sha = workspace
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.GET,
        f"https://hub.docker.com/v2/repositories/bholcombe/eloup-wizard/tags/{sha}",
        status=404,
    )

    bi.BuildImagesPhase().run(ctx)

    last = ctx.state.data["config"]["last_built_images"]
    assert "eloup-web" not in last
    assert "eloup-wizard" in last


@responses.activate
def test_phase5_eloup_web_built_when_dir_present(
    tmp_path: Path, workspace, docker_proc: FakeProcRecorder
) -> None:
    ws, sha = workspace
    (ws / "eloup-web").mkdir()
    (ws / "eloup-web" / "Dockerfile").write_text("FROM scratch\n")
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.GET,
        f"https://hub.docker.com/v2/repositories/bholcombe/eloup-wizard/tags/{sha}-dirty",
        status=404,
    )
    responses.add(
        responses.GET,
        f"https://hub.docker.com/v2/repositories/bholcombe/eloup-web/tags/{sha}-dirty",
        status=404,
    )

    bi.BuildImagesPhase().run(ctx)

    buildx_targets = [
        arg
        for c in docker_proc.calls
        if c[:3] == ["docker", "buildx", "build"]
        for arg in c
        if arg.startswith("bholcombe/")
    ]
    assert any("eloup-wizard:" in t for t in buildx_targets)
    assert any("eloup-web:" in t for t in buildx_targets)


@responses.activate
def test_phase5_buildx_failure_still_logs_out(
    tmp_path: Path, workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws, sha = workspace
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.GET,
        f"https://hub.docker.com/v2/repositories/bholcombe/eloup-wizard/tags/{sha}",
        status=404,
    )

    calls: list[list[str]] = []
    real_run = subprocess.run

    def routed(args, **kwargs):
        first = list(args)[0] if args else ""
        if first == "docker":
            calls.append(list(args))
            if list(args)[:3] == ["docker", "buildx", "build"]:
                return subprocess.CompletedProcess(
                    args=list(args), returncode=1, stdout="", stderr="boom"
                )
            return subprocess.CompletedProcess(
                args=list(args), returncode=0, stdout="ok", stderr=""
            )
        return real_run(args, **kwargs)

    monkeypatch.setattr(bi.subprocess, "run", routed)

    with pytest.raises(PhaseFailed):
        bi.BuildImagesPhase().run(ctx)

    assert ["docker", "logout"] in calls
    assert any(c[:2] == ["docker", "login"] for c in calls)

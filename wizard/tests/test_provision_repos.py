from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import responses
from rich.console import Console

from wizard.paths import WizardPaths
from wizard.phases import provision_repos as pr
from wizard.phases._git import ensure_remote, list_remotes
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import WizardState, write_secrets_file


def _make_ctx(tmp_path: Path) -> PhaseContext:
    state_dir = tmp_path / "state"
    paths = WizardPaths(state_dir=state_dir)
    state = WizardState.load_or_initialize(paths.state_file)
    state.save()
    write_secrets_file(
        paths.secrets_file,
        {
            "gitea_pat": "gitea-test-pat",
            "github_pat": "github-test-pat",
            "dockerhub_pat": "x",
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


def _init_workspace(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=str(path), check=True)


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    ws = tmp_path / "workspace"
    _init_workspace(ws)
    monkeypatch.setattr(pr, "WORKSPACE_DIR", ws)
    return ws


@responses.activate
def test_phase3_creates_both_repos_and_remotes(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.POST,
        "https://haxley.luckyenough.us/api/v1/user/repos",
        json={"name": "eloup"},
        status=201,
    )
    responses.add(
        responses.POST,
        "https://api.github.com/user/repos",
        json={"name": "eloup"},
        status=201,
    )

    pr.ProvisionReposPhase().run(ctx)

    assert ctx.state.phase("provision_repos")["status"] == "done"
    subs = ctx.state.phase("provision_repos")["substeps"]
    assert subs["gitea_repo"]["status"] == "done"
    assert subs["github_repo"]["status"] == "done"
    remotes = list_remotes(workspace)
    assert remotes["gitea"] == pr.GITEA_REPO_URL
    assert remotes["github"] == pr.GITHUB_REPO_URL


@responses.activate
def test_phase3_idempotent_with_existing_repos(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)

    responses.add(
        responses.POST,
        "https://haxley.luckyenough.us/api/v1/user/repos",
        json={"message": "Conflict"},
        status=409,
    )
    responses.add(
        responses.GET,
        "https://haxley.luckyenough.us/api/v1/repos/brandonw.h2o/eloup",
        json={"name": "eloup", "permissions": {"push": True}},
        status=200,
    )

    responses.add(
        responses.POST,
        "https://api.github.com/user/repos",
        json={
            "errors": [{"message": "name already exists on this account"}],
        },
        status=422,
    )
    responses.add(
        responses.GET,
        "https://api.github.com/repos/brandonholcombe/eloup",
        json={"name": "eloup", "permissions": {"push": True}},
        status=200,
    )

    pr.ProvisionReposPhase().run(ctx)

    assert ctx.state.phase("provision_repos")["status"] == "done"


@responses.activate
def test_phase3_dotted_gitea_owner_path_is_built_via_quote(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)

    responses.add(
        responses.POST,
        "https://haxley.luckyenough.us/api/v1/user/repos",
        json={},
        status=409,
    )
    responses.add(
        responses.GET,
        "https://haxley.luckyenough.us/api/v1/repos/brandonw.h2o/eloup",
        json={"name": "eloup", "permissions": {"push": True}},
        status=200,
    )
    responses.add(
        responses.POST,
        "https://api.github.com/user/repos",
        json={"name": "eloup"},
        status=201,
    )

    pr.ProvisionReposPhase().run(ctx)

    gitea_get = next(
        c for c in responses.calls if c.request.method == "GET" and "haxley" in c.request.url
    )
    assert gitea_get.request.url.endswith("/api/v1/repos/brandonw.h2o/eloup")


def test_quote_encodes_unsafe_chars_in_owner_paths() -> None:
    from urllib.parse import quote

    assert quote("brandonw.h2o", safe="") == "brandonw.h2o"
    assert quote("user/with:colon", safe="") == "user%2Fwith%3Acolon"
    assert quote("name with space", safe="") == "name%20with%20space"


@responses.activate
def test_phase3_resumes_when_only_github_pending(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)
    ctx.state.set_substep_status("provision_repos", "gitea_repo", "done")
    ctx.state.save()

    responses.add(
        responses.POST,
        "https://api.github.com/user/repos",
        json={"name": "eloup"},
        status=201,
    )

    pr.ProvisionReposPhase().run(ctx)

    posted_to_gitea = [c for c in responses.calls if "haxley" in c.request.url]
    assert posted_to_gitea == []
    assert ctx.state.phase("provision_repos")["status"] == "done"


@responses.activate
def test_phase3_github_unrelated_422_fails_loud(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)

    responses.add(
        responses.POST,
        "https://haxley.luckyenough.us/api/v1/user/repos",
        json={"name": "eloup"},
        status=201,
    )
    responses.add(
        responses.POST,
        "https://api.github.com/user/repos",
        json={"errors": [{"message": "Repository name must be valid"}]},
        status=422,
    )

    with pytest.raises(PhaseFailed):
        pr.ProvisionReposPhase().run(ctx)
    assert ctx.state.phase("provision_repos")["substeps"]["gitea_repo"]["status"] == "done"
    assert ctx.state.phase("provision_repos")["substeps"]["github_repo"]["status"] == "failed"


def test_ensure_remote_collision_fails_loud(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    _init_workspace(ws)
    subprocess.run(
        ["git", "remote", "add", "gitea", "https://example.com/other.git"],
        cwd=str(ws),
        check=True,
    )
    from wizard.phases._git import GitError

    with pytest.raises(GitError):
        ensure_remote(ws, "gitea", pr.GITEA_REPO_URL)


def test_ensure_remote_renames_origin_when_pointing_at_target(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    _init_workspace(ws)
    subprocess.run(
        ["git", "remote", "add", "origin", pr.GITHUB_REPO_URL],
        cwd=str(ws),
        check=True,
    )

    outcome = ensure_remote(ws, "github", pr.GITHUB_REPO_URL)
    assert outcome == "renamed_from_origin"
    remotes = list_remotes(ws)
    assert "origin" not in remotes
    assert remotes["github"] == pr.GITHUB_REPO_URL


def test_ensure_remote_kept_when_already_correct(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    _init_workspace(ws)
    subprocess.run(["git", "remote", "add", "github", pr.GITHUB_REPO_URL], cwd=str(ws), check=True)
    assert ensure_remote(ws, "github", pr.GITHUB_REPO_URL) == "kept"


@responses.activate
def test_phase3_missing_pat_fails_cleanly(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)
    write_secrets_file(
        ctx.paths.secrets_file,
        {
            "gitea_pat": "",
            "github_pat": "",
            "dockerhub_pat": "x",
            "linode_pat": "x",
            "discord_client_secret": "x",
            "app_session_secret": "x",
        },
    )

    with pytest.raises(PhaseFailed):
        pr.ProvisionReposPhase().run(ctx)
    assert "missing PAT" in (ctx.state.phase("provision_repos").get("error") or "")


def test_phase3_no_existing_remote_adds_both(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    _init_workspace(ws)
    assert ensure_remote(ws, "gitea", pr.GITEA_REPO_URL) == "added"
    assert ensure_remote(ws, "github", pr.GITHUB_REPO_URL) == "added"
    remotes = list_remotes(ws)
    assert remotes["gitea"] == pr.GITEA_REPO_URL
    assert remotes["github"] == pr.GITHUB_REPO_URL


@responses.activate
def test_phase3_gitea_existing_repo_without_push_perm_fails(
    tmp_path: Path, workspace: Path
) -> None:
    ctx = _make_ctx(tmp_path)
    responses.add(
        responses.POST,
        "https://haxley.luckyenough.us/api/v1/user/repos",
        json={"message": "exists"},
        status=409,
    )
    responses.add(
        responses.GET,
        "https://haxley.luckyenough.us/api/v1/repos/brandonw.h2o/eloup",
        json={"name": "eloup", "permissions": {"push": False, "pull": True}},
        status=200,
    )

    with pytest.raises(PhaseFailed):
        pr.ProvisionReposPhase().run(ctx)
    assert ctx.state.phase("provision_repos")["substeps"]["gitea_repo"]["status"] == "failed"

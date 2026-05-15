from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

from rich.console import Console

from wizard.phases._git import GitError, ensure_remote
from wizard.phases._http import HttpError, request_json
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import read_secrets_file

GITEA_BASE_URL = "https://haxley.luckyenough.us"
GITEA_HOST = "haxley.luckyenough.us"
GITEA_OWNER = "brandonw.h2o"
GITHUB_API_BASE = "https://api.github.com"
GITHUB_HOST = "github.com"
GITHUB_OWNER = "brandonholcombe"
REPO_NAME = "eloup"
WORKSPACE_DIR = Path("/workspace")

GITEA_REMOTE_NAME = "gitea"
GITHUB_REMOTE_NAME = "github"
GITEA_REPO_URL = f"{GITEA_BASE_URL}/{GITEA_OWNER}/{REPO_NAME}"
GITHUB_REPO_URL = f"https://github.com/{GITHUB_OWNER}/{REPO_NAME}.git"

GITHUB_NAME_TAKEN_MESSAGE = "name already exists on this account"


def _authed_url(*, host: str, owner: str, repo_path: str, pat: str) -> str:
    """Build a basic-auth https URL with the PAT URL-encoded.

    PATs are URL-encoded with `safe=""` because while GitHub/Gitea PATs are
    typically alphanumeric, defending against `:`/`@`/`/` keeps the URL
    parsable when a future provider widens the alphabet.
    """
    return f"https://{owner}:{quote(pat, safe='')}@{host}/{repo_path}"


def _create_payload() -> dict[str, Any]:
    return {
        "name": REPO_NAME,
        "private": False,
        "auto_init": False,
        "default_branch": "main",
    }


def _gitea_headers(pat: str) -> dict[str, str]:
    return {
        "Authorization": f"token {pat}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _github_headers(pat: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {pat}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    }


def _ensure_gitea_repo(pat: str, console: Console) -> None:
    headers = _gitea_headers(pat)
    create_url = f"{GITEA_BASE_URL}/api/v1/user/repos"
    status, _ = request_json(
        "POST",
        create_url,
        headers=headers,
        json_body=_create_payload(),
        expected=(201, 409),
    )
    if status == 201:
        console.print(f"[green]Gitea:[/green] created {GITEA_REPO_URL}")
        return

    owner_path = quote(GITEA_OWNER, safe="")
    get_url = f"{GITEA_BASE_URL}/api/v1/repos/{owner_path}/{REPO_NAME}"
    _, body = request_json("GET", get_url, headers=headers, expected=(200,))
    if not isinstance(body, dict):
        raise HttpError(f"Gitea GET {get_url} returned non-object body: {body!r}")
    perms = body.get("permissions") or {}
    if not perms.get("push"):
        raise HttpError(
            f"Gitea repo {GITEA_REPO_URL} exists but the PAT lacks push permission "
            f"(permissions={perms!r})"
        )
    console.print(f"[dim]Gitea:[/dim] {GITEA_REPO_URL} already exists, push verified")


def _ensure_github_repo(pat: str, console: Console) -> None:
    headers = _github_headers(pat)
    create_url = f"{GITHUB_API_BASE}/user/repos"
    status, body = request_json(
        "POST",
        create_url,
        headers=headers,
        json_body=_create_payload(),
        expected=(201, 422),
    )
    if status == 201:
        console.print(f"[green]GitHub:[/green] created {GITHUB_REPO_URL}")
        return

    name_taken = False
    if isinstance(body, dict):
        for err in body.get("errors") or []:
            if isinstance(err, dict) and err.get("message") == GITHUB_NAME_TAKEN_MESSAGE:
                name_taken = True
                break
    if not name_taken:
        raise HttpError(
            f"GitHub POST {create_url} returned 422 but not the 'name already exists' "
            f"path; body={body!r}"
        )

    get_url = f"{GITHUB_API_BASE}/repos/{GITHUB_OWNER}/{REPO_NAME}"
    _, body = request_json("GET", get_url, headers=headers, expected=(200,))
    if not isinstance(body, dict):
        raise HttpError(f"GitHub GET {get_url} returned non-object body: {body!r}")
    perms = body.get("permissions") or {}
    if not perms.get("push"):
        raise HttpError(
            f"GitHub repo {GITHUB_REPO_URL} exists but the PAT lacks push permission "
            f"(permissions={perms!r})"
        )
    console.print(f"[dim]GitHub:[/dim] {GITHUB_REPO_URL} already exists, push verified")


def _configure_local_remotes(
    workspace: Path, console: Console, gitea_pat: str, github_pat: str
) -> None:
    """Add `gitea`/`github` remotes with PATs embedded for non-interactive push.

    PATs go into the URL itself (matches the operator's pre-existing `origin`
    pattern). Re-run with a rotated PAT transparently updates the URL via
    `allow_update=True` rather than failing on URL mismatch. Console output
    intentionally uses the PAT-free display URLs — never log secrets.
    """
    gitea_url = _authed_url(
        host=GITEA_HOST, owner=GITEA_OWNER, repo_path=f"{GITEA_OWNER}/{REPO_NAME}", pat=gitea_pat
    )
    github_url = _authed_url(
        host=GITHUB_HOST,
        owner=GITHUB_OWNER,
        repo_path=f"{GITHUB_OWNER}/{REPO_NAME}.git",
        pat=github_pat,
    )
    gitea_outcome = ensure_remote(workspace, GITEA_REMOTE_NAME, gitea_url, allow_update=True)
    github_outcome = ensure_remote(workspace, GITHUB_REMOTE_NAME, github_url, allow_update=True)
    console.print(f"[green]Local remote[/green] gitea: {gitea_outcome} → {GITEA_REPO_URL}")
    console.print(f"[green]Local remote[/green] github: {github_outcome} → {GITHUB_REPO_URL}")


class ProvisionReposPhase:
    name = "provision_repos"
    title = "Phase 3 — Provision repos (Gitea + GitHub)"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        secrets_path = ctx.state.data.get("secrets_ref") or ctx.paths.secrets_file
        secrets = read_secrets_file(Path(str(secrets_path)))
        gitea_pat = secrets.get("gitea_pat")
        github_pat = secrets.get("github_pat")
        if not gitea_pat or not github_pat:
            ctx.state.set_phase_status(self.name, "failed", error="missing PAT in secrets file")
            ctx.state.save()
            raise PhaseFailed(
                self.name,
                "secrets file is missing gitea_pat or github_pat — re-run phase 2",
            )

        substeps = ctx.state.phase(self.name).get("substeps") or {}

        if substeps.get("gitea_repo", {}).get("status") != "done":
            try:
                _ensure_gitea_repo(gitea_pat, ctx.console)
            except HttpError as exc:
                ctx.state.set_substep_status(self.name, "gitea_repo", "failed", error=str(exc))
                ctx.state.set_phase_status(self.name, "failed", error="gitea_repo substep failed")
                ctx.state.save()
                raise PhaseFailed(self.name, str(exc)) from exc
            ctx.state.set_substep_status(self.name, "gitea_repo", "done")
            ctx.state.save()
        else:
            ctx.console.print("[dim]gitea_repo already done — skipping[/dim]")

        if substeps.get("github_repo", {}).get("status") != "done":
            try:
                _ensure_github_repo(github_pat, ctx.console)
            except HttpError as exc:
                ctx.state.set_substep_status(self.name, "github_repo", "failed", error=str(exc))
                ctx.state.set_phase_status(self.name, "failed", error="github_repo substep failed")
                ctx.state.save()
                raise PhaseFailed(self.name, str(exc)) from exc
            ctx.state.set_substep_status(self.name, "github_repo", "done")
            ctx.state.save()
        else:
            ctx.console.print("[dim]github_repo already done — skipping[/dim]")

        try:
            _configure_local_remotes(WORKSPACE_DIR, ctx.console, gitea_pat, github_pat)
        except GitError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=f"git remote: {exc}")
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc

        if not ctx.state.all_substeps_done(self.name):
            ctx.state.set_phase_status(self.name, "failed", error="substeps incomplete")
            ctx.state.save()
            raise PhaseFailed(self.name, "phase 3 substeps incomplete after run")

        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()
        ctx.console.print(
            "[green]Phase 3 done — both repos provisioned, remotes configured.[/green]"
        )

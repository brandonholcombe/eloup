from __future__ import annotations

import subprocess
from pathlib import Path


class GitError(Exception):
    pass


def _run(args: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        stderr = proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
        raise GitError(f"{' '.join(args)} (in {cwd}) failed: {stderr}")
    return proc


def list_remotes(workspace: Path) -> dict[str, str]:
    proc = _run(["git", "remote", "-v"], cwd=workspace)
    remotes: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            name, url = parts[0], parts[1]
            remotes.setdefault(name, url)
    return remotes


def add_remote(workspace: Path, name: str, url: str) -> None:
    _run(["git", "remote", "add", name, url], cwd=workspace)


def rename_remote(workspace: Path, old: str, new: str) -> None:
    _run(["git", "remote", "rename", old, new], cwd=workspace)


def ensure_remote(workspace: Path, name: str, expected_url: str) -> str:
    """Reconcile a remote name with `expected_url`.

    Returns one of: "added", "kept", "renamed_from_origin".

    Raises GitError if the named remote already exists with a different URL,
    or if `origin` exists pointing at `expected_url` and a different remote
    named `name` also exists with a different URL.
    """
    remotes = list_remotes(workspace)

    if name in remotes:
        if remotes[name] == expected_url:
            return "kept"
        raise GitError(
            f"remote {name!r} already exists with URL {remotes[name]!r}; "
            f"refusing to overwrite with {expected_url!r}"
        )

    if "origin" in remotes and remotes["origin"] == expected_url:
        rename_remote(workspace, "origin", name)
        return "renamed_from_origin"

    add_remote(workspace, name, expected_url)
    return "added"

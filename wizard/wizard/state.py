from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

STATE_VERSION = 1

PhaseStatus = Literal["pending", "running", "done", "failed"]

PHASE_DEFINITIONS: list[tuple[str, tuple[str, ...]]] = [
    ("preflight", ()),
    ("collect_secrets", ()),
    ("provision_repos", ("gitea_repo", "github_repo")),
    ("cluster_bootstrap", ()),
    ("build_images", ()),
    ("generate_manifests", ()),
    ("push_manifests", ("push_gitea", "push_github")),
    ("dns_record", ()),
    ("argocd_sync", ()),
]

PHASE_NAMES: tuple[str, ...] = tuple(name for name, _ in PHASE_DEFINITIONS)
PHASE_SUBSTEPS: dict[str, tuple[str, ...]] = {name: subs for name, subs in PHASE_DEFINITIONS}


class StateError(Exception):
    pass


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_phase_entry(substeps: tuple[str, ...]) -> dict[str, Any]:
    entry: dict[str, Any] = {"status": "pending", "ts": None, "error": None}
    if substeps:
        entry["substeps"] = {
            sub: {"status": "pending", "ts": None, "error": None} for sub in substeps
        }
    return entry


def default_state_data() -> dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "phases": {name: _new_phase_entry(subs) for name, subs in PHASE_DEFINITIONS},
        "config": {},
        "secrets_ref": None,
    }


def _atomic_write_secure(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except PermissionError:
        pass
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        os.chmod(tmp_path, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
        os.chmod(path, 0o600)
    except BaseException:
        if tmp_path.exists():
            tmp_path.unlink()
        raise


@dataclass
class WizardState:
    path: Path
    data: dict[str, Any]

    @classmethod
    def load_or_initialize(cls, path: Path) -> WizardState:
        if path.exists():
            with path.open("r") as f:
                data = json.load(f)
            cls._validate(data)
            cls._migrate_in_place(data)
        else:
            data = default_state_data()
        return cls(path=path, data=data)

    @staticmethod
    def _validate(data: dict[str, Any]) -> None:
        if not isinstance(data, dict):
            raise StateError("state file is not a JSON object")
        version = data.get("version")
        if version != STATE_VERSION:
            raise StateError(
                f"state file version {version!r} not supported by this wizard "
                f"(expected {STATE_VERSION}). Run with --reset to start over."
            )
        if "phases" not in data or not isinstance(data["phases"], dict):
            raise StateError("state file missing 'phases' object")

    @staticmethod
    def _migrate_in_place(data: dict[str, Any]) -> None:
        phases = data.setdefault("phases", {})
        for name, substeps in PHASE_DEFINITIONS:
            phase = phases.get(name)
            if phase is None:
                phases[name] = _new_phase_entry(substeps)
                continue
            phase.setdefault("status", "pending")
            phase.setdefault("ts", None)
            phase.setdefault("error", None)
            if substeps:
                sub_dict = phase.setdefault("substeps", {})
                for sub in substeps:
                    sub_entry = sub_dict.get(sub)
                    if sub_entry is None:
                        sub_dict[sub] = {"status": "pending", "ts": None, "error": None}
                    else:
                        sub_entry.setdefault("status", "pending")
                        sub_entry.setdefault("ts", None)
                        sub_entry.setdefault("error", None)
        data.setdefault("config", {})
        data.setdefault("secrets_ref", None)

    def save(self) -> None:
        content = json.dumps(self.data, indent=2, sort_keys=False) + "\n"
        _atomic_write_secure(self.path, content)

    def phase(self, name: str) -> dict[str, Any]:
        if name not in self.data["phases"]:
            raise KeyError(f"unknown phase: {name}")
        return self.data["phases"][name]

    def set_phase_status(
        self,
        name: str,
        status: PhaseStatus,
        *,
        error: str | None = None,
    ) -> None:
        entry = self.phase(name)
        entry["status"] = status
        entry["ts"] = _now()
        entry["error"] = error

    def set_substep_status(
        self,
        phase_name: str,
        substep: str,
        status: PhaseStatus,
        *,
        error: str | None = None,
    ) -> None:
        entry = self.phase(phase_name)
        substeps = entry.get("substeps")
        if not substeps or substep not in substeps:
            raise KeyError(f"phase {phase_name!r} has no substep {substep!r}")
        substeps[substep]["status"] = status
        substeps[substep]["ts"] = _now()
        substeps[substep]["error"] = error

    def all_substeps_done(self, phase_name: str) -> bool:
        entry = self.phase(phase_name)
        substeps = entry.get("substeps") or {}
        return all(s["status"] == "done" for s in substeps.values())

    def next_pending_phase(self) -> str | None:
        for name in PHASE_NAMES:
            if self.phase(name)["status"] != "done":
                return name
        return None

    def reset_from(self, phase_name: str) -> None:
        if phase_name not in PHASE_NAMES:
            raise StateError(
                f"unknown phase {phase_name!r}; valid phases: {', '.join(PHASE_NAMES)}"
            )
        start = PHASE_NAMES.index(phase_name)
        for name in PHASE_NAMES[start:]:
            self.data["phases"][name] = _new_phase_entry(PHASE_SUBSTEPS[name])

    def update_config(self, updates: dict[str, Any]) -> None:
        self.data.setdefault("config", {}).update(updates)

    def set_secrets_ref(self, secrets_path: Path) -> None:
        self.data["secrets_ref"] = str(secrets_path)


def write_secrets_file(path: Path, secrets: dict[str, str]) -> None:
    content = json.dumps(secrets, indent=2, sort_keys=True) + "\n"
    _atomic_write_secure(path, content)


def read_secrets_file(path: Path) -> dict[str, str]:
    with path.open("r") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise StateError(f"secrets file {path} is not a JSON object")
    return {k: str(v) for k, v in data.items()}


def delete_state(state_path: Path, secrets_path: Path) -> None:
    for p in (state_path, secrets_path):
        if p.exists():
            p.unlink()

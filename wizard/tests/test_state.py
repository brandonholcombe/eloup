from __future__ import annotations

import json
import stat
from pathlib import Path

import pytest

from wizard.state import (
    PHASE_DEFINITIONS,
    PHASE_NAMES,
    STATE_VERSION,
    StateError,
    WizardState,
    default_state_data,
    read_secrets_file,
    write_secrets_file,
)


@pytest.fixture
def state_path(tmp_path: Path) -> Path:
    return tmp_path / "state.json"


def test_fresh_start_initializes_all_phases_pending(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)

    assert state.data["version"] == STATE_VERSION
    assert set(state.data["phases"]) == set(PHASE_NAMES)
    for phase_name, substeps in PHASE_DEFINITIONS:
        entry = state.data["phases"][phase_name]
        assert entry["status"] == "pending"
        if substeps:
            assert set(entry["substeps"]) == set(substeps)
            for sub in substeps:
                assert entry["substeps"][sub]["status"] == "pending"


def test_save_and_reload_round_trip(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    state.set_phase_status("preflight", "done")
    state.update_config({"app_domain": "eloup.kodloki.io"})
    state.save()

    reloaded = WizardState.load_or_initialize(state_path)
    assert reloaded.data["phases"]["preflight"]["status"] == "done"
    assert reloaded.data["config"]["app_domain"] == "eloup.kodloki.io"


def test_state_file_mode_is_0600(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    state.save()

    mode = stat.S_IMODE(state_path.stat().st_mode)
    assert mode == 0o600, f"expected 0600, got {oct(mode)}"


def test_next_pending_phase_walks_in_order(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    assert state.next_pending_phase() == "preflight"

    state.set_phase_status("preflight", "done")
    assert state.next_pending_phase() == "collect_secrets"

    state.set_phase_status("collect_secrets", "done")
    assert state.next_pending_phase() == "provision_repos"


def test_full_resume_returns_none_when_all_done(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    for name in PHASE_NAMES:
        state.set_phase_status(name, "done")
    assert state.next_pending_phase() is None


def test_crash_mid_phase_resumes_at_running_phase(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    state.set_phase_status("preflight", "done")
    state.set_phase_status("collect_secrets", "running")
    state.save()

    reloaded = WizardState.load_or_initialize(state_path)
    assert reloaded.next_pending_phase() == "collect_secrets"
    assert reloaded.data["phases"]["collect_secrets"]["status"] == "running"


def test_crash_mid_substep_preserves_substep_state(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    for name in ("preflight", "collect_secrets"):
        state.set_phase_status(name, "done")
    state.set_phase_status("provision_repos", "running")
    state.set_substep_status("provision_repos", "gitea_repo", "done")
    state.save()

    reloaded = WizardState.load_or_initialize(state_path)
    assert reloaded.next_pending_phase() == "provision_repos"
    substeps = reloaded.data["phases"]["provision_repos"]["substeps"]
    assert substeps["gitea_repo"]["status"] == "done"
    assert substeps["github_repo"]["status"] == "pending"
    assert not reloaded.all_substeps_done("provision_repos")


def test_all_substeps_done_when_every_substep_complete(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    state.set_substep_status("provision_repos", "gitea_repo", "done")
    state.set_substep_status("provision_repos", "github_repo", "done")
    assert state.all_substeps_done("provision_repos")


def test_set_substep_on_phase_without_substeps_raises(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    with pytest.raises(KeyError):
        state.set_substep_status("preflight", "anything", "done")


def test_reset_from_resets_target_and_later_phases_only(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    for name in PHASE_NAMES:
        state.set_phase_status(name, "done")
    state.set_substep_status("provision_repos", "gitea_repo", "done")
    state.set_substep_status("provision_repos", "github_repo", "done")

    state.reset_from("build_images")

    assert state.data["phases"]["preflight"]["status"] == "done"
    assert state.data["phases"]["collect_secrets"]["status"] == "done"
    assert state.data["phases"]["provision_repos"]["status"] == "done"
    assert state.data["phases"]["build_images"]["status"] == "pending"
    assert state.data["phases"]["dns_record"]["status"] == "pending"


def test_reset_from_unknown_phase_raises(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    with pytest.raises(StateError):
        state.reset_from("not-a-real-phase")


def test_unknown_version_is_rejected(state_path: Path) -> None:
    bogus = default_state_data()
    bogus["version"] = 99
    state_path.write_text(json.dumps(bogus))

    with pytest.raises(StateError):
        WizardState.load_or_initialize(state_path)


def test_migration_fills_in_missing_phase(state_path: Path) -> None:
    partial = default_state_data()
    partial["phases"].pop("dns_record")
    state_path.write_text(json.dumps(partial))

    state = WizardState.load_or_initialize(state_path)
    assert state.data["phases"]["dns_record"]["status"] == "pending"


def test_secrets_file_round_trip_and_mode(tmp_path: Path) -> None:
    path = tmp_path / "secrets.json"
    write_secrets_file(path, {"k": "v", "other": "x"})
    assert read_secrets_file(path) == {"k": "v", "other": "x"}

    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600


def test_atomic_write_does_not_leave_temp_files(tmp_path: Path) -> None:
    state = WizardState.load_or_initialize(tmp_path / "state.json")
    state.save()
    state.set_phase_status("preflight", "done")
    state.save()

    leftovers = [p.name for p in tmp_path.iterdir() if p.name.startswith(".tmp-")]
    assert leftovers == [], f"unexpected temp files: {leftovers}"


def test_set_phase_status_records_timestamp(state_path: Path) -> None:
    state = WizardState.load_or_initialize(state_path)
    state.set_phase_status("preflight", "done")
    ts = state.data["phases"]["preflight"]["ts"]
    assert ts is not None
    assert ts.endswith("Z")

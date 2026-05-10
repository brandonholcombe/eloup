from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from click.testing import CliRunner

from wizard.cli import main
from wizard.config import (
    CONFIG_FIELDS,
    SECRET_FIELDS,
    ConfigFileError,
    generate_session_secret,
    load_yaml_config,
)
from wizard.state import delete_state


def test_help_exits_zero_and_lists_flags() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["--help"])

    assert result.exit_code == 0
    assert "EloUp deployment wizard" in result.output
    for flag in ("--retry-from", "--reset", "--config", "--keep", "--state-dir"):
        assert flag in result.output, f"--help is missing {flag}"


def test_help_does_not_create_state_dir(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    runner = CliRunner()
    result = runner.invoke(main, ["--state-dir", str(state_dir), "--help"])

    assert result.exit_code == 0
    assert not state_dir.exists()


def test_version_flag_works() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["--version"])
    assert result.exit_code == 0
    assert "eloup-wizard" in result.output


def test_load_yaml_config_round_trips(tmp_path: Path) -> None:
    cfg = {
        "dockerhub_user": "bholcombe",
        "dockerhub_pat": "dckr_pat_test",
        "gitea_pat": "gitea_test",
        "github_pat": "ghp_test",
        "linode_pat": "linode_test",
        "discord_client_id": "1234567890",
        "discord_client_secret": "discord_test",
        "app_domain": "eloup.kodloki.io",
        "cert_email": "admin@kodloki.io",
    }
    path = tmp_path / "wizard.yaml"
    path.write_text(yaml.safe_dump(cfg))

    loaded = load_yaml_config(path)
    assert loaded == cfg


def test_load_yaml_config_rejects_unknown_keys(tmp_path: Path) -> None:
    path = tmp_path / "wizard.yaml"
    path.write_text("dockerhub_user: x\nbogus_key: y\n")

    with pytest.raises(ConfigFileError):
        load_yaml_config(path)


def test_field_lists_do_not_overlap() -> None:
    assert set(CONFIG_FIELDS).isdisjoint(SECRET_FIELDS)


def test_session_secret_is_url_safe_and_long_enough() -> None:
    s = generate_session_secret()
    assert len(s) >= 32
    assert all(ch.isalnum() or ch in "-_" for ch in s)


def test_delete_state_removes_files(tmp_path: Path) -> None:
    state_file = tmp_path / "state.json"
    secrets_file = tmp_path / "secrets.json"
    state_file.write_text("{}")
    secrets_file.write_text("{}")

    delete_state(state_file, secrets_file)

    assert not state_file.exists()
    assert not secrets_file.exists()


def test_delete_state_is_idempotent(tmp_path: Path) -> None:
    state_file = tmp_path / "state.json"
    secrets_file = tmp_path / "secrets.json"
    delete_state(state_file, secrets_file)
    delete_state(state_file, secrets_file)

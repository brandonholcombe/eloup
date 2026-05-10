from __future__ import annotations

import secrets as _secrets
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yaml

DEFAULT_APP_DOMAIN = "eloup.kodloki.io"
DEFAULT_CERT_EMAIL = "admin@kodloki.io"

CONFIG_FIELDS: tuple[str, ...] = (
    "dockerhub_user",
    "discord_client_id",
    "app_domain",
    "cert_email",
)

SECRET_FIELDS: tuple[str, ...] = (
    "dockerhub_pat",
    "gitea_pat",
    "github_pat",
    "linode_pat",
    "discord_client_secret",
    "app_session_secret",
)

ALL_FIELDS: tuple[str, ...] = CONFIG_FIELDS + SECRET_FIELDS


@dataclass
class CollectedConfig:
    dockerhub_user: str
    discord_client_id: str
    app_domain: str
    cert_email: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass
class CollectedSecrets:
    dockerhub_pat: str
    gitea_pat: str
    github_pat: str
    linode_pat: str
    discord_client_secret: str
    app_session_secret: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


class ConfigFileError(Exception):
    pass


def load_yaml_config(path: Path) -> dict[str, Any]:
    with path.open("r") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ConfigFileError(
            f"{path}: top-level YAML must be a mapping, got {type(data).__name__}"
        )
    unknown = set(data) - set(ALL_FIELDS)
    if unknown:
        raise ConfigFileError(f"{path}: unknown keys: {sorted(unknown)}")
    return data


def generate_session_secret() -> str:
    return _secrets.token_urlsafe(32)

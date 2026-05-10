from __future__ import annotations

from pathlib import Path
from typing import Any

import click

from wizard.config import (
    CONFIG_FIELDS,
    DEFAULT_APP_DOMAIN,
    DEFAULT_CERT_EMAIL,
    SECRET_FIELDS,
    CollectedConfig,
    CollectedSecrets,
    generate_session_secret,
    load_yaml_config,
)


def _interactive_collect(
    *,
    generate_session: bool,
    prefill: dict[str, Any] | None = None,
) -> tuple[CollectedConfig, CollectedSecrets]:
    pre = prefill or {}

    def ask(name: str, prompt: str, *, hide: bool = False, default: str | None = None) -> str:
        if name in pre:
            return str(pre[name])
        return click.prompt(
            prompt, default=default, hide_input=hide, show_default=default is not None
        )

    dockerhub_user = ask("dockerhub_user", "DockerHub username", default="bholcombe")
    dockerhub_pat = ask("dockerhub_pat", "DockerHub PAT", hide=True)
    gitea_pat = ask("gitea_pat", "Gitea PAT (scopes: write:repository, write:user)", hide=True)
    github_pat = ask("github_pat", "GitHub PAT (scopes: repo)", hide=True)
    linode_pat = ask("linode_pat", "Linode PAT (DNS A-record write)", hide=True)
    discord_client_id = ask("discord_client_id", "Discord OAuth client ID")
    discord_client_secret = ask("discord_client_secret", "Discord OAuth client secret", hide=True)
    app_domain = ask("app_domain", "App domain", default=DEFAULT_APP_DOMAIN)
    cert_email = ask("cert_email", "cert-manager email", default=DEFAULT_CERT_EMAIL)

    if "app_session_secret" in pre and pre["app_session_secret"]:
        app_session_secret = str(pre["app_session_secret"])
    elif generate_session:
        app_session_secret = generate_session_secret()
        click.echo("App session secret: generated a 32-byte random secret.")
    else:
        app_session_secret = click.prompt(
            "App session secret (or leave blank to generate one)",
            default="",
            hide_input=True,
            show_default=False,
        )
        if not app_session_secret:
            app_session_secret = generate_session_secret()
            click.echo("App session secret: generated a 32-byte random secret.")

    config = CollectedConfig(
        dockerhub_user=dockerhub_user,
        discord_client_id=discord_client_id,
        app_domain=app_domain,
        cert_email=cert_email,
    )
    secrets = CollectedSecrets(
        dockerhub_pat=dockerhub_pat,
        gitea_pat=gitea_pat,
        github_pat=github_pat,
        linode_pat=linode_pat,
        discord_client_secret=discord_client_secret,
        app_session_secret=app_session_secret,
    )
    return config, secrets


def _from_yaml_only(data: dict[str, Any]) -> tuple[CollectedConfig, CollectedSecrets]:
    missing = [f for f in CONFIG_FIELDS if f not in data]
    missing += [f for f in SECRET_FIELDS if f not in data and f != "app_session_secret"]
    if missing:
        raise click.UsageError(
            "non-interactive --config is missing required keys: " + ", ".join(missing)
        )
    config = CollectedConfig(
        dockerhub_user=str(data["dockerhub_user"]),
        discord_client_id=str(data["discord_client_id"]),
        app_domain=str(data.get("app_domain") or DEFAULT_APP_DOMAIN),
        cert_email=str(data.get("cert_email") or DEFAULT_CERT_EMAIL),
    )
    session_secret = data.get("app_session_secret") or generate_session_secret()
    secrets = CollectedSecrets(
        dockerhub_pat=str(data["dockerhub_pat"]),
        gitea_pat=str(data["gitea_pat"]),
        github_pat=str(data["github_pat"]),
        linode_pat=str(data["linode_pat"]),
        discord_client_secret=str(data["discord_client_secret"]),
        app_session_secret=str(session_secret),
    )
    return config, secrets


def collect_inputs(
    *,
    config_path: Path | None,
    generate_session: bool,
) -> tuple[CollectedConfig, CollectedSecrets]:
    if config_path is None:
        return _interactive_collect(generate_session=generate_session)
    yaml_data = load_yaml_config(config_path)
    return _from_yaml_only(yaml_data)

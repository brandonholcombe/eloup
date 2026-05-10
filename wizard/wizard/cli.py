from __future__ import annotations

import sys
from pathlib import Path

import click
from rich.console import Console

from wizard import __version__
from wizard.paths import WizardPaths, default_state_dir
from wizard.phases.base import PhaseContext
from wizard.runner import run
from wizard.state import PHASE_NAMES, WizardState, delete_state


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option(
    "--config",
    "config_path",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
    help="Non-interactive YAML config (path inside container, e.g. /workspace/wizard.yaml).",
)
@click.option(
    "--retry-from",
    "retry_from",
    type=click.Choice(PHASE_NAMES),
    default=None,
    help="Reset this phase and all later phases to pending, then resume.",
)
@click.option(
    "--reset",
    is_flag=True,
    help="Delete the saved state and secrets, then start fresh.",
)
@click.option(
    "--keep",
    is_flag=True,
    help="On failure, skip cleanup-on-fail hooks (state stays exactly as-is for inspection).",
)
@click.option(
    "--state-dir",
    "state_dir_override",
    type=click.Path(file_okay=False, path_type=Path),
    default=None,
    help="Override the state directory (default: ~/.config/eloup-wizard).",
)
@click.option(
    "--generate-session-secret",
    "generate_session",
    is_flag=True,
    help="Generate a random 32-byte app session secret instead of prompting for one.",
)
@click.version_option(__version__, prog_name="eloup-wizard")
def main(
    config_path: Path | None,
    retry_from: str | None,
    reset: bool,
    keep: bool,
    state_dir_override: Path | None,
    generate_session: bool,
) -> None:
    """EloUp deployment wizard — preflight, collect secrets, provision, deploy."""
    state_dir = state_dir_override.expanduser() if state_dir_override else default_state_dir()
    paths = WizardPaths(state_dir=state_dir)
    console = Console()

    if reset:
        delete_state(paths.state_file, paths.secrets_file)
        console.print(
            f"[yellow]Reset:[/yellow] removed {paths.state_file} and {paths.secrets_file}."
        )

    state = WizardState.load_or_initialize(paths.state_file)

    if retry_from:
        state.reset_from(retry_from)
        state.save()
        console.print(f"[yellow]Reset state from phase[/yellow] [bold]{retry_from}[/bold] onward.")

    state.save()

    ctx = PhaseContext(
        state=state,
        paths=paths,
        console=console,
        config_path=config_path,
        generate_session=generate_session,
        keep=keep,
    )
    sys.exit(run(ctx))

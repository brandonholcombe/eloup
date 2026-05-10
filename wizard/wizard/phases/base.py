from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from rich.console import Console

from wizard.paths import WizardPaths
from wizard.state import WizardState


@dataclass
class PhaseContext:
    state: WizardState
    paths: WizardPaths
    console: Console
    config_path: Path | None
    generate_session: bool
    keep: bool
    install_sealed_secrets: bool = False


class Phase(Protocol):
    name: str
    title: str

    def run(self, ctx: PhaseContext) -> None: ...


class PhaseFailed(Exception):
    """Raised by a phase to signal that it failed and the wizard should stop."""

    def __init__(self, phase: str, detail: str):
        super().__init__(f"{phase}: {detail}")
        self.phase = phase
        self.detail = detail

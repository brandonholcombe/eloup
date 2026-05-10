from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def default_state_dir() -> Path:
    override = os.environ.get("ELOUP_WIZARD_STATE_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".config" / "eloup-wizard"


@dataclass(frozen=True)
class WizardPaths:
    state_dir: Path

    @property
    def state_file(self) -> Path:
        return self.state_dir / "state.json"

    @property
    def secrets_file(self) -> Path:
        return self.state_dir / "secrets.json"

    @property
    def log_file(self) -> Path:
        return self.state_dir / "wizard.log"

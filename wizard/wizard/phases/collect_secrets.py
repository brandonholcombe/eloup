from __future__ import annotations

from wizard.config import generate_session_secret
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.prompts import collect_inputs
from wizard.state import write_secrets_file


class CollectSecretsPhase:
    name = "collect_secrets"
    title = "Phase 2 — Collect secrets"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        try:
            config, secrets = collect_inputs(
                config_path=ctx.config_path,
                generate_session=ctx.generate_session,
            )
        except Exception as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc

        ctx.state.update_config(config.to_dict())
        write_secrets_file(ctx.paths.secrets_file, secrets.to_dict())
        ctx.state.set_secrets_ref(ctx.paths.secrets_file)
        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()

        ctx.console.print(
            f"[green]Secrets stored at[/green] {ctx.paths.secrets_file} [dim](mode 0600)[/dim]"
        )
        ctx.console.print(
            f"[green]Wizard state at[/green] {ctx.paths.state_file} [dim](mode 0600)[/dim]"
        )


__all__ = ["CollectSecretsPhase", "generate_session_secret"]

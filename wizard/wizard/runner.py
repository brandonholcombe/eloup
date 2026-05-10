from __future__ import annotations

from collections.abc import Sequence

from wizard.phases.argocd_sync import ArgocdSyncPhase
from wizard.phases.base import Phase, PhaseContext, PhaseFailed
from wizard.phases.build_images import BuildImagesPhase
from wizard.phases.cluster_bootstrap import ClusterBootstrapPhase
from wizard.phases.collect_secrets import CollectSecretsPhase
from wizard.phases.dns_record import DnsRecordPhase
from wizard.phases.generate_manifests import GenerateManifestsPhase
from wizard.phases.preflight import PreflightPhase
from wizard.phases.provision_repos import ProvisionReposPhase
from wizard.phases.push_manifests import PushManifestsPhase
from wizard.state import PHASE_NAMES


def all_phases() -> list[Phase]:
    return [
        PreflightPhase(),
        CollectSecretsPhase(),
        ProvisionReposPhase(),
        ClusterBootstrapPhase(),
        BuildImagesPhase(),
        GenerateManifestsPhase(),
        PushManifestsPhase(),
        DnsRecordPhase(),
        ArgocdSyncPhase(),
    ]


def assert_phase_set_matches_state() -> None:
    names = tuple(p.name for p in all_phases())
    if names != PHASE_NAMES:
        raise RuntimeError(
            f"phase registry mismatch: runner has {names}, state defines {PHASE_NAMES}"
        )


def run(ctx: PhaseContext, phases: Sequence[Phase] | None = None) -> int:
    assert_phase_set_matches_state()
    phases = phases or all_phases()

    for phase in phases:
        if ctx.state.phase(phase.name)["status"] == "done":
            ctx.console.print(f"[dim]Skipping {phase.name} — already done.[/dim]")
            continue
        try:
            phase.run(ctx)
        except PhaseFailed as exc:
            ctx.console.print(f"[red]Phase {phase.name} failed:[/red] {exc.detail}")
            if not ctx.keep:
                ctx.console.print(
                    "[dim]Re-run the wizard to retry from this phase, or pass "
                    "`--retry-from <earlier-phase>` to rewind further. "
                    "Use `--keep` to preserve partial state on failure exit.[/dim]"
                )
            return 1
    ctx.console.print("[bold green]All phases done.[/bold green]")
    return 0

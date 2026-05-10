from __future__ import annotations

from wizard.phases.base import PhaseContext, PhaseFailed


class _Stub:
    name: str = ""
    title: str = ""
    next_milestone: str = ""

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.console.print(
            f"[yellow]Phase[/yellow] [bold]{self.name}[/bold] is not yet implemented "
            f"(scheduled for {self.next_milestone}). "
            f"M1 only ships preflight + secret collection."
        )
        ctx.state.set_phase_status(self.name, "pending")
        ctx.state.save()
        raise PhaseFailed(self.name, f"not yet implemented — pick this up in {self.next_milestone}")


class ProvisionReposPhase(_Stub):
    name = "provision_repos"
    title = "Phase 3 — Provision repos (Gitea + GitHub)"
    next_milestone = "M2"


class ClusterBootstrapPhase(_Stub):
    name = "cluster_bootstrap"
    title = "Phase 4 — Cluster bootstrap detection"
    next_milestone = "M2"


class BuildImagesPhase(_Stub):
    name = "build_images"
    title = "Phase 5 — Build & push images"
    next_milestone = "M2"


class GenerateManifestsPhase(_Stub):
    name = "generate_manifests"
    title = "Phase 6 — Generate manifests"
    next_milestone = "M3"


class PushManifestsPhase(_Stub):
    name = "push_manifests"
    title = "Phase 7 — Push manifests to both remotes"
    next_milestone = "M3"


class DnsRecordPhase(_Stub):
    name = "dns_record"
    title = "Phase 8 — Linode DNS A-record"
    next_milestone = "M3"


class ArgocdSyncPhase(_Stub):
    name = "argocd_sync"
    title = "Phase 9 — Register ArgoCD Application & wait for healthy"
    next_milestone = "M3"

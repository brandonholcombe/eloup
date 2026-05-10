from __future__ import annotations

from pathlib import Path

from wizard.phases._http import HttpError, request_json
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import read_secrets_file

LINODE_API_BASE = "https://api.linode.com/v4"
KODLOKI_DOMAIN = "kodloki.io"
ELOUP_SUBDOMAIN = "eloup"
LOADBALANCER_IP = "172.232.176.47"
RECORD_TTL = 3600
PAGE_SIZE = 100
MAX_PAGES = 50


def _headers(pat: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {pat}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _paginate(url: str, headers: dict[str, str]) -> list[dict]:
    """Pull every page of a Linode list endpoint, returning the flattened data."""
    items: list[dict] = []
    page = 1
    while page <= MAX_PAGES:
        sep = "&" if "?" in url else "?"
        page_url = f"{url}{sep}page={page}&page_size={PAGE_SIZE}"
        _, body = request_json("GET", page_url, headers=headers, expected=(200,))
        if not isinstance(body, dict):
            raise HttpError(f"Linode {page_url} returned non-object body: {body!r}")
        data = body.get("data") or []
        items.extend(item for item in data if isinstance(item, dict))
        total_pages = int(body.get("pages") or 1)
        if page >= total_pages:
            return items
        page += 1
    raise HttpError(f"Linode pagination exceeded {MAX_PAGES} pages for {url}")


def _find_domain_id(headers: dict[str, str]) -> int:
    domains = _paginate(f"{LINODE_API_BASE}/domains", headers)
    for d in domains:
        if d.get("domain") == KODLOKI_DOMAIN:
            return int(d["id"])
    raise PhaseFailed(
        "dns_record",
        f"Linode account does not own a domain entry for {KODLOKI_DOMAIN!r}; "
        "verify the linode_pat owns the right account, or use --skip-dns and "
        "create the A-record manually.",
    )


def _find_record(headers: dict[str, str], domain_id: int) -> dict | None:
    records = _paginate(f"{LINODE_API_BASE}/domains/{domain_id}/records", headers)
    for r in records:
        if r.get("type") == "A" and r.get("name") == ELOUP_SUBDOMAIN:
            return r
    return None


def _create_record(headers: dict[str, str], domain_id: int) -> dict:
    body_in = {
        "type": "A",
        "name": ELOUP_SUBDOMAIN,
        "target": LOADBALANCER_IP,
        "ttl_sec": RECORD_TTL,
    }
    _, body = request_json(
        "POST",
        f"{LINODE_API_BASE}/domains/{domain_id}/records",
        headers=headers,
        json_body=body_in,
        expected=(200,),
    )
    if not isinstance(body, dict):
        raise HttpError(f"Linode record-create returned non-object body: {body!r}")
    return body


class DnsRecordPhase:
    name = "dns_record"
    title = "Phase 8 — Linode DNS A-record"

    def run(self, ctx: PhaseContext) -> None:
        ctx.console.rule(f"[bold]{self.title}[/bold]")
        ctx.state.set_phase_status(self.name, "running")
        ctx.state.save()

        if ctx.skip_dns:
            ctx.console.print(
                "[dim]DNS skipped by operator (--skip-dns) — ensure "
                f"{ELOUP_SUBDOMAIN}.{KODLOKI_DOMAIN} A-record points at "
                f"{LOADBALANCER_IP} before phase 9.[/dim]"
            )
            ctx.state.update_config({"dns_skipped": True})
            ctx.state.set_phase_status(self.name, "done")
            ctx.state.save()
            return

        secrets_path = ctx.state.data.get("secrets_ref") or ctx.paths.secrets_file
        secrets = read_secrets_file(Path(str(secrets_path)))
        linode_pat = secrets.get("linode_pat")
        if not linode_pat:
            ctx.state.set_phase_status(
                self.name, "failed", error="missing linode_pat in secrets file"
            )
            ctx.state.save()
            raise PhaseFailed(
                self.name, "secrets file missing linode_pat — re-run phase 2 or use --skip-dns"
            )

        headers = _headers(linode_pat)
        config = ctx.state.data.get("config", {})

        try:
            domain_id = config.get("linode_domain_id_kodloki_io")
            if not isinstance(domain_id, int):
                domain_id = _find_domain_id(headers)
                ctx.state.update_config({"linode_domain_id_kodloki_io": domain_id})
                ctx.state.save()
            else:
                ctx.console.print(f"[dim]Using cached kodloki.io domain id {domain_id}[/dim]")

            existing = _find_record(headers, domain_id)
            if existing is not None:
                target = existing.get("target")
                rid = existing.get("id")
                if target == LOADBALANCER_IP:
                    ctx.console.print(
                        f"[dim]DNS already correct — {ELOUP_SUBDOMAIN}.{KODLOKI_DOMAIN} "
                        f"→ {LOADBALANCER_IP} (record id {rid})[/dim]"
                    )
                else:
                    msg = (
                        f"{ELOUP_SUBDOMAIN}.{KODLOKI_DOMAIN} A-record (id {rid}) already "
                        f"points at {target!r}, expected {LOADBALANCER_IP!r}. Refusing to "
                        "silently overwrite — update or delete the record manually and "
                        "re-run."
                    )
                    ctx.state.set_phase_status(self.name, "failed", error=msg)
                    ctx.state.save()
                    raise PhaseFailed(self.name, msg)
            else:
                created = _create_record(headers, domain_id)
                ctx.console.print(
                    f"[green]Created A-record[/green] {ELOUP_SUBDOMAIN}.{KODLOKI_DOMAIN} "
                    f"→ {LOADBALANCER_IP} (record id {created.get('id')})"
                )
        except HttpError as exc:
            ctx.state.set_phase_status(self.name, "failed", error=str(exc))
            ctx.state.save()
            raise PhaseFailed(self.name, str(exc)) from exc

        ctx.state.set_phase_status(self.name, "done")
        ctx.state.save()

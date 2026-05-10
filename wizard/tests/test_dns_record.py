from __future__ import annotations

from pathlib import Path

import pytest
import responses
from rich.console import Console

from wizard.paths import WizardPaths
from wizard.phases import dns_record as dr
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import WizardState, write_secrets_file


def _make_ctx(tmp_path: Path, *, skip_dns: bool = False, with_pat: bool = True) -> PhaseContext:
    state_dir = tmp_path / "state"
    paths = WizardPaths(state_dir=state_dir)
    state = WizardState.load_or_initialize(paths.state_file)
    state.save()
    secrets: dict[str, str] = {
        "dockerhub_pat": "x",
        "gitea_pat": "x",
        "github_pat": "x",
        "discord_client_secret": "x",
        "app_session_secret": "x",
    }
    if with_pat:
        secrets["linode_pat"] = "linode-test-pat"
    write_secrets_file(paths.secrets_file, secrets)
    state.set_secrets_ref(paths.secrets_file)
    state.save()
    return PhaseContext(
        state=state,
        paths=paths,
        console=Console(record=True, width=120),
        config_path=None,
        generate_session=False,
        keep=False,
        skip_dns=skip_dns,
    )


def _add_domains_page(records: list[dict], *, page: int = 1, pages: int = 1) -> None:
    responses.add(
        responses.GET,
        "https://api.linode.com/v4/domains",
        json={"data": records, "page": page, "pages": pages, "results": len(records)},
        status=200,
        match=[responses.matchers.query_param_matcher({"page": str(page), "page_size": "100"})],
    )


def _add_records_page(
    domain_id: int, records: list[dict], *, page: int = 1, pages: int = 1
) -> None:
    responses.add(
        responses.GET,
        f"https://api.linode.com/v4/domains/{domain_id}/records",
        json={"data": records, "page": page, "pages": pages, "results": len(records)},
        status=200,
        match=[responses.matchers.query_param_matcher({"page": str(page), "page_size": "100"})],
    )


@responses.activate
def test_phase8_creates_record_when_absent(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    _add_domains_page([{"id": 12345, "domain": "kodloki.io"}])
    _add_records_page(
        12345,
        [
            {"id": 1, "type": "A", "name": "shine", "target": "172.232.176.47"},
            {"id": 2, "type": "A", "name": "argocd", "target": "172.232.176.47"},
        ],
    )
    create_call = responses.add(
        responses.POST,
        "https://api.linode.com/v4/domains/12345/records",
        json={"id": 999, "type": "A", "name": "eloup", "target": "172.232.176.47"},
        status=200,
    )

    dr.DnsRecordPhase().run(ctx)

    assert ctx.state.phase("dns_record")["status"] == "done"
    assert ctx.state.data["config"]["linode_domain_id_kodloki_io"] == 12345
    assert create_call.call_count == 1


@responses.activate
def test_phase8_detects_correct_record_and_skips_post(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    _add_domains_page([{"id": 12345, "domain": "kodloki.io"}])
    _add_records_page(
        12345,
        [{"id": 42, "type": "A", "name": "eloup", "target": "172.232.176.47"}],
    )

    dr.DnsRecordPhase().run(ctx)

    assert ctx.state.phase("dns_record")["status"] == "done"
    output = ctx.console.export_text()
    assert "already correct" in output


@responses.activate
def test_phase8_wrong_target_fails_without_overwriting(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    _add_domains_page([{"id": 12345, "domain": "kodloki.io"}])
    _add_records_page(
        12345,
        [{"id": 42, "type": "A", "name": "eloup", "target": "1.2.3.4"}],
    )

    with pytest.raises(PhaseFailed) as exc_info:
        dr.DnsRecordPhase().run(ctx)
    assert "1.2.3.4" in str(exc_info.value)
    assert "172.232.176.47" in str(exc_info.value)
    assert ctx.state.phase("dns_record")["status"] == "failed"


@responses.activate
def test_phase8_domain_absent_fails(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    _add_domains_page([{"id": 1, "domain": "other.example"}])

    with pytest.raises(PhaseFailed) as exc_info:
        dr.DnsRecordPhase().run(ctx)
    assert "kodloki.io" in str(exc_info.value)


@responses.activate
def test_phase8_skip_dns_makes_no_api_calls(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path, skip_dns=True)

    dr.DnsRecordPhase().run(ctx)

    assert ctx.state.phase("dns_record")["status"] == "done"
    assert ctx.state.data["config"]["dns_skipped"] is True
    assert len(responses.calls) == 0


@responses.activate
def test_phase8_cached_domain_id_skips_pagination(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    ctx.state.update_config({"linode_domain_id_kodloki_io": 99999})
    ctx.state.save()
    _add_records_page(
        99999,
        [{"id": 7, "type": "A", "name": "eloup", "target": "172.232.176.47"}],
    )

    dr.DnsRecordPhase().run(ctx)

    assert ctx.state.phase("dns_record")["status"] == "done"
    assert all("/v4/domains?" not in str(c.request.url) for c in responses.calls)


@responses.activate
def test_phase8_paginates_domains(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    page1 = [{"id": i, "domain": f"other-{i}.example"} for i in range(100)]
    page2 = [{"id": 12345, "domain": "kodloki.io"}]
    _add_domains_page(page1, page=1, pages=2)
    _add_domains_page(page2, page=2, pages=2)
    _add_records_page(
        12345,
        [{"id": 1, "type": "A", "name": "eloup", "target": "172.232.176.47"}],
    )

    dr.DnsRecordPhase().run(ctx)

    assert ctx.state.phase("dns_record")["status"] == "done"


@responses.activate
def test_phase8_missing_pat_fails_without_calls(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path, with_pat=False)

    with pytest.raises(PhaseFailed) as exc_info:
        dr.DnsRecordPhase().run(ctx)
    assert "linode_pat" in str(exc_info.value)
    assert len(responses.calls) == 0


@responses.activate
def test_phase8_pat_in_authorization_header(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    _add_domains_page([{"id": 12345, "domain": "kodloki.io"}])
    _add_records_page(
        12345,
        [{"id": 1, "type": "A", "name": "eloup", "target": "172.232.176.47"}],
    )

    dr.DnsRecordPhase().run(ctx)

    auth_headers = [c.request.headers.get("Authorization", "") for c in responses.calls]
    assert all(h == "Bearer linode-test-pat" for h in auth_headers)

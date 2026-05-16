from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml
from rich.console import Console

from wizard.paths import WizardPaths
from wizard.phases import generate_manifests as gm
from wizard.phases._manifests import (
    APP_RUNTIME_SECRET_KEYS,
    REPO_SECRET_NAME,
    SECRET_NAME,
)
from wizard.phases.base import PhaseContext, PhaseFailed
from wizard.state import WizardState, write_secrets_file

SEALED_OUTPUT = """\
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: eloup-web-secret
  namespace: eloup
spec:
  encryptedData:
    DISCORD_CLIENT_SECRET: AgB...stub
    APP_SESSION_SECRET: AgB...stub
"""


def _make_ctx(
    tmp_path: Path,
    *,
    web_image: str | None = None,
    web_built: bool = True,
    cert_present: bool = True,
    runtime_secret_keys: tuple[str, ...] = ("discord_client_secret", "app_session_secret"),
    extra_secret_keys: tuple[str, ...] = (
        "dockerhub_pat",
        "gitea_pat",
        "github_pat",
        "linode_pat",
    ),
    app_domain: str = "eloup.kodloki.io",
) -> PhaseContext:
    state_dir = tmp_path / "state"
    paths = WizardPaths(state_dir=state_dir)
    state = WizardState.load_or_initialize(paths.state_file)

    cert_path = state_dir / "sealed-secrets.crt"
    if cert_present:
        cert_path.parent.mkdir(parents=True, exist_ok=True)
        cert_path.write_text("---STUB CERT---\n")

    state.update_config(
        {
            "app_domain": app_domain,
            "discord_client_id": "1234567890",
            "sealed_secrets_cert_path": str(cert_path),
            "sealed_secrets_namespace": "kube-system",
        }
    )
    if web_built:
        state.update_config(
            {
                "last_built_images": {
                    "eloup-wizard": {
                        "sha_tag": "abc1234",
                        "latest_tag": "latest",
                        "skipped": False,
                    },
                    "eloup-web": {
                        "sha_tag": "deadbeef",
                        "latest_tag": "latest",
                        "skipped": False,
                    },
                },
                "last_built_sha": "deadbeef",
            }
        )
    state.save()

    secrets: dict[str, str] = {k: f"value-{k}" for k in runtime_secret_keys}
    for k in extra_secret_keys:
        secrets[k] = f"value-{k}"
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
        web_image=web_image,
    )


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    monkeypatch.setattr(gm, "WORKSPACE_DIR", ws)
    monkeypatch.setattr(gm, "K8S_DIR", ws / "K8s")
    monkeypatch.setattr(gm, "ARGOCD_DIR", ws / "argocd")
    return ws


def _stub_kubeseal_success() -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        args=["kubeseal"], returncode=0, stdout=SEALED_OUTPUT, stderr=""
    )


def _stub_kubeseal_failure() -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        args=["kubeseal"],
        returncode=1,
        stdout="",
        stderr="Error: cert is malformed",
    )


def test_phase6_renders_all_files_with_real_image(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)

    assert ctx.state.phase("generate_manifests")["status"] == "done"
    assert "generate_manifests_ts" in ctx.state.data["config"]

    expected = [
        "K8s/namespace.yaml",
        "K8s/configmap-web.yaml",
        "K8s/service-web.yaml",
        "K8s/statefulset-web.yaml",
        "K8s/ingress.yaml",
        "K8s/sealed-secret-web.yaml",
        "argocd/eloup-app.yaml",
    ]
    for rel in expected:
        assert (workspace / rel).exists(), f"missing {rel}"

    sts = yaml.safe_load((workspace / "K8s/statefulset-web.yaml").read_text())
    assert sts["kind"] == "StatefulSet"
    assert sts["spec"]["replicas"] == 1
    container = sts["spec"]["template"]["spec"]["containers"][0]
    assert container["image"] == "bholcombe/eloup-web:deadbeef"
    assert container["livenessProbe"]["httpGet"]["path"] == "/api/health"
    assert "tcpSocket" not in container["livenessProbe"]
    vct = sts["spec"]["volumeClaimTemplates"][0]
    assert vct["spec"]["storageClassName"] == "linode-block-storage-retain"
    assert vct["spec"]["resources"]["requests"]["storage"] == "5Gi"

    # M4 reviewer-style regression guard: the ConfigMap must carry the Auth.js v5
    # canonical URL hints. Without AUTH_URL the OAuth sign-in form rendered
    # against the pod's bind address (0.0.0.0:3000) instead of the public host,
    # breaking Discord sign-in on first real prod rollout.
    cm = yaml.safe_load((workspace / "K8s/configmap-web.yaml").read_text())
    assert cm["data"]["AUTH_URL"] == "https://eloup.kodloki.io"
    assert cm["data"]["AUTH_TRUST_HOST"] == "true"
    assert cm["data"]["APP_DOMAIN"] == "https://eloup.kodloki.io"

    app = yaml.safe_load((workspace / "argocd/eloup-app.yaml").read_text())
    assert app["spec"]["source"]["repoURL"] == "https://github.com/brandonholcombe/eloup.git"
    assert app["spec"]["source"]["path"] == "K8s"
    assert app["spec"]["destination"]["namespace"] == "eloup"
    assert "resources-finalizer.argocd.argoproj.io" in app["metadata"]["finalizers"]


def test_phase6_web_image_override_uses_tcp_probe(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path, web_image="nginx:1.27-alpine", web_built=False)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)

    sts = yaml.safe_load((workspace / "K8s/statefulset-web.yaml").read_text())
    container = sts["spec"]["template"]["spec"]["containers"][0]
    assert container["image"] == "nginx:1.27-alpine"
    assert container["livenessProbe"]["tcpSocket"]["port"] == 3000
    assert "httpGet" not in container["livenessProbe"]


def test_phase6_no_image_no_override_fails_clearly(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path, web_built=False)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        with pytest.raises(PhaseFailed) as exc_info:
            gm.GenerateManifestsPhase().run(ctx)
    assert "--web-image" in str(exc_info.value)
    assert ctx.state.phase("generate_manifests")["status"] == "failed"
    assert not (workspace / "K8s").exists()
    assert not (workspace / "argocd").exists()


def test_phase6_image_key_contract_is_exact_path(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path, web_built=False)
    ctx.state.update_config(
        {
            "last_built_images": {
                "eloup_web": {"sha_tag": "wrongkey"},
                "eloup-wizard": {"sha_tag": "wizardabc"},
            }
        }
    )
    ctx.state.save()
    with pytest.raises(PhaseFailed) as exc_info:
        gm.GenerateManifestsPhase().run(ctx)
    assert "--web-image" in str(exc_info.value)


def test_phase6_kubeseal_failure_writes_no_files(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_failure()):
        with pytest.raises(PhaseFailed) as exc_info:
            gm.GenerateManifestsPhase().run(ctx)
    assert "kubeseal failed" in str(exc_info.value)
    assert not (workspace / "K8s").exists()
    assert not (workspace / "argocd").exists()


def test_phase6_sealed_secret_only_contains_runtime_keys(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)
    captured: dict[str, str] = {}

    def fake_run(args, *, input=None, **kwargs):
        captured["argv"] = args
        captured["input"] = input or ""
        return _stub_kubeseal_success()

    with patch.object(gm.subprocess, "run", side_effect=fake_run):
        gm.GenerateManifestsPhase().run(ctx)

    src_secret_yaml = captured["input"]
    parsed = yaml.safe_load(src_secret_yaml)
    assert parsed["kind"] == "Secret"
    assert parsed["metadata"]["name"] == SECRET_NAME
    assert set(parsed["stringData"].keys()) == APP_RUNTIME_SECRET_KEYS
    for forbidden in ("dockerhub_pat", "gitea_pat", "github_pat", "linode_pat"):
        assert forbidden not in src_secret_yaml, f"PAT {forbidden!r} leaked into the kubeseal stdin"

    assert "--cert" in captured["argv"]
    assert "--controller-namespace=kube-system" in captured["argv"]


def test_phase6_ingress_substitutes_app_domain_everywhere(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path, app_domain="test-eloup.example")
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)

    ingress_text = (workspace / "K8s/ingress.yaml").read_text()
    assert "shine.kodloki.io" not in ingress_text
    assert 'cors-allow-origin: "https://test-eloup.example"' in ingress_text

    ingress = yaml.safe_load(ingress_text)
    assert ingress["spec"]["rules"][0]["host"] == "test-eloup.example"
    assert ingress["spec"]["tls"][0]["hosts"] == ["test-eloup.example"]


def test_phase6_ingress_sets_proxy_buffer_size_for_oauth(tmp_path: Path, workspace: Path) -> None:
    # M4 — Next.js + Auth.js v5 + Discord OAuth sends large state + Set-Cookie
    # headers. Without proxy-buffer-size raised above nginx defaults, the very
    # first OAuth callback returns 502. Regression guard for the M4 reviewer's
    # MINOR #5 finding.
    ctx = _make_ctx(tmp_path)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)

    ingress = yaml.safe_load((workspace / "K8s/ingress.yaml").read_text())
    annotations = ingress["metadata"]["annotations"]
    assert annotations.get("nginx.ingress.kubernetes.io/proxy-buffer-size") == "16k"


def test_phase6_idempotent_re_run_produces_same_files(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)
    first = {p.name: p.read_text() for p in (workspace / "K8s").iterdir()}

    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)
    second = {p.name: p.read_text() for p in (workspace / "K8s").iterdir()}

    assert first.keys() == second.keys()
    for name in first:
        assert first[name] == second[name], f"{name} content drifted between runs"


def test_phase6_missing_cert_fails(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path, cert_present=False)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        with pytest.raises(PhaseFailed) as exc_info:
            gm.GenerateManifestsPhase().run(ctx)
    assert "sealed-secrets cert" in str(exc_info.value)


def test_phase6_missing_runtime_secret_fails(tmp_path: Path, workspace: Path) -> None:
    ctx = _make_ctx(tmp_path, runtime_secret_keys=("discord_client_secret",))
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        with pytest.raises(PhaseFailed) as exc_info:
            gm.GenerateManifestsPhase().run(ctx)
    assert "app_session_secret" in str(exc_info.value)


def test_render_plain_secret_rejects_pats() -> None:
    from wizard.phases._manifests import render_plain_secret

    with pytest.raises(ValueError) as exc_info:
        render_plain_secret({"DISCORD_CLIENT_SECRET": "x", "github_pat": "danger"})
    assert "github_pat" in str(exc_info.value)


def test_render_plain_secret_rejects_lowercase_source_keys() -> None:
    # M3→M4 contract regression guard: envFrom: secretRef injects each Secret
    # key verbatim as a container env var, and eloup-web's lib/env.ts requires
    # uppercase env vars. Passing secrets.json source keys (lowercase) through
    # render_plain_secret was the bug that caused a CrashLoopBackOff on first
    # real prod rollout — guard against the regression.
    from wizard.phases._manifests import render_plain_secret

    with pytest.raises(ValueError) as exc_info:
        render_plain_secret({"discord_client_secret": "x", "app_session_secret": "y"})
    assert "discord_client_secret" in str(exc_info.value)
    assert "app_session_secret" in str(exc_info.value)


def test_phase6_secret_keys_are_uppercase_env_var_shape(tmp_path: Path, workspace: Path) -> None:
    # Companion regression guard: the rendered Secret stringData MUST have
    # uppercase env-var-shaped keys (DISCORD_CLIENT_SECRET, APP_SESSION_SECRET),
    # not the secrets.json source keys.
    ctx = _make_ctx(tmp_path)

    captured: dict[str, object] = {}

    def fake_run(args, *, input=None, **kwargs):
        captured["input"] = input or ""
        return _stub_kubeseal_success()

    with patch.object(gm.subprocess, "run", side_effect=fake_run):
        gm.GenerateManifestsPhase().run(ctx)

    parsed = yaml.safe_load(captured["input"])
    keys = set(parsed["stringData"].keys())
    assert keys == {"DISCORD_CLIENT_SECRET", "APP_SESSION_SECRET"}
    assert "discord_client_secret" not in keys
    assert "app_session_secret" not in keys


def test_repo_secret_constants_exposed() -> None:
    assert REPO_SECRET_NAME == "eloup-repo"


def test_phase6_configmap_emits_bootstrap_admin_when_set(tmp_path: Path, workspace: Path) -> None:
    # H1 regression guard: M4 reads ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID to promote
    # the first matching Discord login to global_admin. The wizard must surface
    # the value into the ConfigMap so a fresh-cluster deploy gets auto-promotion
    # without an out-of-band `kubectl set env`.
    ctx = _make_ctx(tmp_path)
    ctx.state.update_config({"bootstrap_admin_discord_id": "481702948146249728"})
    ctx.state.save()
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)

    cm = yaml.safe_load((workspace / "K8s/configmap-web.yaml").read_text())
    assert cm["data"]["ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID"] == "481702948146249728"


def test_phase6_configmap_omits_bootstrap_admin_when_unset(tmp_path: Path, workspace: Path) -> None:
    # When the operator leaves bootstrap_admin_discord_id blank, the ConfigMap
    # must omit the key entirely — emitting `: ""` would defeat M4 env.ts's
    # `z.string().optional()` discrimination between absent and empty.
    ctx = _make_ctx(tmp_path)
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)

    cm_text = (workspace / "K8s/configmap-web.yaml").read_text()
    assert "ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID" not in cm_text
    cm = yaml.safe_load(cm_text)
    assert "ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID" not in cm["data"]
    assert set(cm["data"].keys()) == {
        "DISCORD_CLIENT_ID",
        "APP_DOMAIN",
        "DATABASE_PATH",
        "AUTH_URL",
        "AUTH_TRUST_HOST",
    }


def test_phase6_configmap_treats_empty_string_as_unset(tmp_path: Path, workspace: Path) -> None:
    # YAML `bootstrap_admin_discord_id: ""` must normalize to omitted. Reviewer
    # flagged this as the failure mode if `_from_yaml_only` ever used a plain
    # `data.get(...)` instead of `... or None`.
    ctx = _make_ctx(tmp_path)
    ctx.state.update_config({"bootstrap_admin_discord_id": ""})
    ctx.state.save()
    with patch.object(gm.subprocess, "run", return_value=_stub_kubeseal_success()):
        gm.GenerateManifestsPhase().run(ctx)

    cm_text = (workspace / "K8s/configmap-web.yaml").read_text()
    assert "ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID" not in cm_text


def test_render_configmap_omits_key_for_none_and_empty_string() -> None:
    # Pure-function boundary test: locks omit-vs-empty behavior at the renderer
    # rather than only at the phase. Guards against a future regression where
    # someone "fixes" the renderer to always emit the key.
    from wizard.phases._manifests import render_configmap

    none_out = render_configmap(
        discord_client_id="x", app_domain="y", bootstrap_admin_discord_id=None
    )
    empty_out = render_configmap(
        discord_client_id="x", app_domain="y", bootstrap_admin_discord_id=""
    )
    set_out = render_configmap(
        discord_client_id="x", app_domain="y", bootstrap_admin_discord_id="123"
    )

    assert "ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID" not in none_out
    assert "ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID" not in empty_out
    assert 'ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID: "123"' in set_out

    # Default-arg case (existing call sites that don't pass the kwarg) keeps
    # the M3 ConfigMap contract — guards against an accidental positional bug.
    default_out = render_configmap(discord_client_id="x", app_domain="y")
    assert "ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID" not in default_out

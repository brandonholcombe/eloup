from __future__ import annotations

import subprocess

KUBECTL_TIMEOUT_SECONDS = 60


class KubectlError(RuntimeError):
    pass


def apply_stdin(manifest: str, *, timeout: int = KUBECTL_TIMEOUT_SECONDS) -> str:
    """Run `kubectl apply -f -` with `manifest` piped to stdin.

    Pipes via stdin (NOT a tmpfile) so secrets in the manifest never touch
    disk — same posture as `docker login --password-stdin` in
    `wizard/wizard/phases/build_images.py`. Raises KubectlError on non-zero
    exit so the caller can decide whether to retry or fail the phase.
    """
    proc = subprocess.run(
        ["kubectl", "apply", "-f", "-"],
        input=manifest,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise KubectlError(
            f"kubectl apply -f - failed (rc={proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout

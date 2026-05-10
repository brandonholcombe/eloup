from __future__ import annotations

from typing import Any

import requests

DEFAULT_TIMEOUT = 30.0


class HttpError(Exception):
    def __init__(self, message: str, *, status: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: Any = None,
    timeout: float = DEFAULT_TIMEOUT,
    expected: tuple[int, ...] = (200,),
) -> tuple[int, dict[str, Any] | list[Any] | None]:
    try:
        resp = requests.request(method, url, headers=headers, json=json_body, timeout=timeout)
    except requests.RequestException as exc:
        raise HttpError(f"{method} {url} failed: {exc}") from exc

    body: dict[str, Any] | list[Any] | None
    if resp.content:
        try:
            body = resp.json()
        except ValueError:
            body = None
    else:
        body = None

    if resp.status_code not in expected:
        snippet = (resp.text or "").strip()[:500]
        raise HttpError(
            f"{method} {url} → {resp.status_code} (expected one of {expected}): {snippet}",
            status=resp.status_code,
            body=resp.text,
        )

    return resp.status_code, body

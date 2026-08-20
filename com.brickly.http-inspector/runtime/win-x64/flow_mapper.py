from __future__ import annotations

import shlex
from typing import Any

SENSITIVE_HEADERS = {"authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"}


def redact_headers(headers: dict[str, Any]) -> dict[str, str]:
    return {key: "[REDACTED]" if key.lower() in SENSITIVE_HEADERS else str(value) for key, value in headers.items()}


def truncate_body(body: bytes, limit: int) -> tuple[bytes, bool]:
    if limit <= 0 or len(body) <= limit:
        return body, False
    value = body[:limit]
    while value:
        try:
            value.decode("utf-8")
            return value, True
        except UnicodeDecodeError:
            value = value[:-1]
    return b"", True


def _body_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")


def map_flow(flow: dict[str, Any], max_body_bytes: int = 1_048_576) -> dict[str, Any]:
    request = flow.get("request") or {}
    response = flow.get("response") or {}
    request_headers = redact_headers(request.get("headers") or {})
    response_headers = redact_headers(response.get("headers") or {})
    request_body = _body_text(request.get("body", "")).encode("utf-8")
    request_body, request_truncated = truncate_body(request_body, max_body_bytes)
    raw_body = response.get("body", b"")
    body = _body_text(raw_body).encode("utf-8")
    body, truncated = truncate_body(body, max_body_bytes)
    started = float(flow.get("started_at") or 0)
    completed = float(flow.get("completed_at") or started)
    url = str(request.get("url") or "")
    host = url.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0]
    return {
        "id": str(flow.get("id") or ""),
        "startedAt": int(started * 1000),
        "completedAt": int(completed * 1000),
        "durationMs": max(0, int((completed - started) * 1000)),
        "scheme": url.split(":", 1)[0] if ":" in url else "http",
        "httpVersion": str(request.get("http_version") or "HTTP/1.1"),
        "method": str(request.get("method") or "GET"),
        "host": host,
        "path": "/" + url.split("//", 1)[-1].split("/", 1)[-1] if "/" in url.split("//", 1)[-1] else "/",
        "url": url,
        "statusCode": int(response.get("status_code") or 0),
        "contentType": response_headers.get("content-type", ""),
        "requestBytes": len(request_body),
        "responseBytes": len(body),
        "state": "complete" if response else "pending",
        "request": {"headers": request_headers, "body": request_body.decode("utf-8", errors="replace"), "truncated": request_truncated},
        "response": {"headers": response_headers, "body": body.decode("utf-8", errors="replace"), "truncated": truncated},
    }


def curl_command(flow: dict[str, Any], shell: str = "bash") -> str:
    request = flow.get("request") or {}
    args = ["curl", "-X", str(flow.get("method") or request.get("method") or "GET"), str(flow.get("url") or request.get("url") or "")]
    for key, value in redact_headers(request.get("headers") or {}).items():
        args.extend(["-H", f"{key}: {value}"])
    body = _body_text(request.get("body"))
    if body:
        args.extend(["--data-raw", body])
    if shell == "powershell":
        return " ".join('"' + item.replace('"', '\\"') + '"' for item in args)
    return " ".join(shlex.quote(item) for item in args)

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from typing import Any, Callable

from flow_mapper import map_flow


class CaptureAddon:
    def __init__(self, on_flow: Callable[[dict[str, Any]], None], max_body_bytes: int, ready: threading.Event):
        self.on_flow = on_flow
        self.max_body_bytes = max_body_bytes
        self.ready = ready

    def running(self) -> None:
        self.ready.set()

    def response(self, flow: Any) -> None:
        self.on_flow(map_mitm_flow(flow, self.max_body_bytes))

    def error(self, flow: Any) -> None:
        self.on_flow(map_mitm_flow(flow, self.max_body_bytes))


def map_mitm_flow(flow: Any, max_body_bytes: int) -> dict[str, Any]:
    request = flow.request
    response = getattr(flow, "response", None)
    raw = {
        "id": str(getattr(flow, "id", "") or uuid.uuid4()),
        "request": {
            "method": request.method,
            "url": request.pretty_url,
            "http_version": request.http_version,
            "headers": dict(request.headers.items(multi=True)),
            "body": bytes(request.raw_content or b""),
        },
        "response": None if response is None else {
            "status_code": response.status_code,
            "headers": dict(response.headers.items(multi=True)),
            "body": bytes(response.raw_content or b""),
        },
        "started_at": float(getattr(request, "timestamp_start", time.time()) or time.time()),
        "completed_at": float(getattr(response, "timestamp_end", time.time()) if response else time.time()),
    }
    result = map_flow(raw, max_body_bytes)
    if getattr(flow, "error", None):
        result["state"] = "error"
        result["error"] = str(flow.error)
    return result


class ProxyEngine:
    def __init__(self, on_flow: Callable[[dict[str, Any]], None]):
        self.on_flow = on_flow
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._master: Any = None
        self._error: Exception | None = None
        self._ready = threading.Event()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and self._master)

    def start(self, port: int, max_body_bytes: int, exclude_hosts: list[str] | None = None) -> None:
        if self.running:
            return
        self._ready.clear()
        self._error = None
        self._thread = threading.Thread(target=self._run, args=(port, max_body_bytes, exclude_hosts or []), daemon=True)
        self._thread.start()
        if not self._ready.wait(12):
            raise RuntimeError("代理启动超时")
        if self._error:
            raise RuntimeError(f"代理启动失败: {self._error}") from self._error

    def _run(self, port: int, max_body_bytes: int, exclude_hosts: list[str]) -> None:
        try:
            from mitmproxy import options
            from mitmproxy.tools.dump import DumpMaster

            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            opts = options.Options(listen_host="127.0.0.1", listen_port=port, http2=True)
            if exclude_hosts:
                opts.update(ignore_hosts=[pattern.replace("*.", "(^|\\.)") for pattern in exclude_hosts])
            self._master = DumpMaster(opts, loop=self._loop, with_termlog=False, with_dumper=False)
            self._master.addons.add(CaptureAddon(self.on_flow, max_body_bytes, self._ready))
            self._loop.run_until_complete(self._master.run())
        except Exception as exc:
            self._error = exc
            self._ready.set()
        finally:
            self._master = None
            if self._loop:
                self._loop.close()
            self._loop = None

    def stop(self) -> None:
        if self._master and self._loop:
            self._loop.call_soon_threadsafe(self._master.shutdown)
        if self._thread:
            self._thread.join(timeout=5)
        self._thread = None

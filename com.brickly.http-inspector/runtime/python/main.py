from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any

from brickly import BppError, BricklyRuntime

from certificate_manager import CertificateManager
from flow_mapper import curl_command
from flow_store import FlowStore
from proxy_engine import ProxyEngine
from system_proxy import ProxyOwnershipError, create_system_proxy_manager

BRICK_ID = "com.brickly.http-inspector"
CHANGE_EVENT = "http-inspector:changed"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


class InspectorService:
    def __init__(self, runtime: BricklyRuntime):
        data_root = Path(os.environ.get("BRICKLY_DATA_DIR") or Path(tempfile.gettempdir()) / "brickly" / BRICK_ID)
        self.runtime = runtime
        self.store = FlowStore(data_root / "capture")
        self.certificate = CertificateManager(Path.home() / ".mitmproxy")
        self.engine = ProxyEngine(self._on_flow)
        self.system_proxy = None
        self.port = 8899
        self.max_body_bytes = 1_048_576
        self._changed_timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self.total = 0
        self.proxy_warning = ""

    def _on_flow(self, flow: dict[str, Any]) -> None:
        self.store.put(flow)
        self.total += 1
        with self._lock:
            if self._changed_timer:
                return
            self._changed_timer = threading.Timer(0.2, self._publish_changed)
            self._changed_timer.daemon = True
            self._changed_timer.start()

    def _publish_changed(self) -> None:
        with self._lock:
            self._changed_timer = None
        try:
            self.runtime.events.publish(CHANGE_EVENT, {"total": self.total})
        except Exception as exc:
            self.runtime.warn("发布抓包变更事件失败", {"error": str(exc)})

    def start(self, value: dict[str, Any]) -> dict[str, Any]:
        port = int(value.get("port") or 8899)
        if port < 1024 or port > 65535:
            raise BppError("INVALID_CONFIGURATION", "端口必须在 1024 到 65535 之间")
        max_body = int(value.get("maxBodyBytes") or 1_048_576)
        max_body = min(max(max_body, 0), 10 * 1024 * 1024)
        excluded = [line.strip() for line in str(value.get("excludeHosts") or "").splitlines() if line.strip()]
        auto_system_proxy = bool(value.get("systemProxy", True))
        try:
            self.engine.start(port, max_body, excluded)
            if auto_system_proxy:
                self.system_proxy = self.system_proxy or create_system_proxy_manager()
                if self.system_proxy is None:
                    raise RuntimeError("当前平台不支持自动设置系统代理")
                self.system_proxy.enable(port)
        except Exception as exc:
            self.engine.stop()
            if self.system_proxy and self.system_proxy.active:
                try:
                    self.system_proxy.restore()
                except Exception:
                    self.system_proxy.abandon()
            raise BppError("PROXY_START_FAILED", str(exc)) from exc
        self.port = port
        self.max_body_bytes = max_body
        return self.status()

    def stop(self) -> dict[str, Any]:
        self.engine.stop()
        if self.system_proxy and self.system_proxy.active:
            try:
                self.system_proxy.restore()
                self.proxy_warning = ""
            except ProxyOwnershipError as exc:
                self.system_proxy.abandon()
                self.proxy_warning = str(exc)
        return self.status()

    def status(self) -> dict[str, Any]:
        return {
            "running": self.engine.running,
            "listenHost": "127.0.0.1",
            "port": self.port,
            "proxyUrl": f"http://127.0.0.1:{self.port}",
            "systemProxy": bool(self.system_proxy and self.system_proxy.active),
            "systemProxyWarning": self.proxy_warning,
            "certificateInstalled": False,
            "certificateFingerprint": self.certificate.fingerprint(),
            "total": self.total,
            "maxBodyBytes": self.max_body_bytes,
            "pythonVersion": sys.version.split()[0],
        }

    def list(self, value: dict[str, Any]) -> dict[str, Any]:
        rows = self.store.list(str(value.get("query") or ""), int(value.get("limit") or 200), str(value.get("afterId") or ""))
        compact = [{key: row.get(key) for key in ("id", "startedAt", "durationMs", "scheme", "httpVersion", "method", "host", "path", "url", "statusCode", "contentType", "requestBytes", "responseBytes", "state", "error")} for row in rows]
        return {"sessions": compact, "total": self.total}

    def detail(self, value: dict[str, Any]) -> dict[str, Any]:
        try:
            return {"session": self.store.detail(str(value.get("id") or ""))}
        except KeyError as exc:
            raise BppError("FLOW_NOT_FOUND", "找不到指定会话，它可能已经被清理") from exc

    def clear(self) -> dict[str, Any]:
        self.store.clear()
        self.total = 0
        self._publish_changed()
        return {"ok": True}

    def copy_curl(self, value: dict[str, Any]) -> dict[str, Any]:
        try:
            flow = self.store.detail(str(value.get("id") or ""))
        except KeyError as exc:
            raise BppError("FLOW_NOT_FOUND", "找不到指定会话") from exc
        return {"command": curl_command(flow, str(value.get("shell") or "bash"))}

    def export_har(self, value: dict[str, Any]) -> dict[str, Any]:
        target = Path(str(value.get("path") or "")).expanduser()
        if not str(target):
            raise BppError("INVALID_CONFIGURATION", "请选择 HAR 导出路径")
        entries = []
        for row in self.store.list(limit=500):
            detail = self.store.detail(row["id"])
            entries.append({"startedDateTime": "", "time": detail.get("durationMs", 0), "request": {"method": detail.get("method", "GET"), "url": detail.get("url", ""), "httpVersion": detail.get("httpVersion", "HTTP/1.1"), "headers": [{"name": k, "value": v} for k, v in detail.get("request", {}).get("headers", {}).items()]}, "response": {"status": detail.get("statusCode", 0), "statusText": "", "httpVersion": detail.get("httpVersion", "HTTP/1.1"), "headers": [{"name": k, "value": v} for k, v in detail.get("response", {}).get("headers", {}).items()], "content": {"size": detail.get("responseBytes", 0), "mimeType": detail.get("contentType", ""), "text": detail.get("response", {}).get("body", "")}}, "cache": {}, "timings": {"send": 0, "wait": detail.get("durationMs", 0), "receive": 0}})
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"log": {"version": "1.2", "creator": {"name": "Brickly HTTP Inspector", "version": "0.1.0"}, "entries": entries}}, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "path": str(target), "count": len(entries)}

    def shutdown(self) -> None:
        if self._changed_timer:
            self._changed_timer.cancel()
        self.stop()
        self.store.close()


runtime = BricklyRuntime(BRICK_ID)
service = InspectorService(runtime)


def command(handler):
    def wrapped(_ctx, value):
        try:
            return handler(value or {})
        except BppError:
            raise
        except Exception as exc:
            raise BppError("INTERNAL_ERROR", f"操作失败: {exc}") from exc
    return wrapped


runtime.on_command("start", command(service.start))
runtime.on_command("stop", command(lambda _value: service.stop()))
runtime.on_command("status", command(lambda _value: service.status()))
runtime.on_command("list", command(service.list))
runtime.on_command("detail", command(service.detail))
runtime.on_command("clear", command(lambda _value: service.clear()))
runtime.on_command("copy-curl", command(service.copy_curl))
runtime.on_command("export-har", command(service.export_har))
runtime.on_command("install-certificate", command(lambda _value: service.certificate.install()))
runtime.on_command("remove-certificate", command(lambda _value: service.certificate.remove()))
def set_system_proxy(value: dict[str, Any]) -> dict[str, Any]:
    enabled = bool(value.get("enabled"))
    if enabled:
        service.system_proxy = service.system_proxy or create_system_proxy_manager()
        if service.system_proxy is None:
            raise BppError("SYSTEM_PROXY_FAILED", "当前平台不支持自动设置系统代理")
        service.system_proxy.enable(service.port)
    elif service.system_proxy:
        service.system_proxy.restore()
    return service.status()


runtime.on_command("set-system-proxy", command(set_system_proxy))
runtime.on_shutdown(service.shutdown)

if __name__ == "__main__":
    runtime.run()

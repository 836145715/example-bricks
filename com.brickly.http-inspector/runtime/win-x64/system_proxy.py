from __future__ import annotations

import platform
import subprocess
from dataclasses import dataclass
from typing import Any, Callable


class ProxyOwnershipError(RuntimeError):
    code = "PROXY_OWNERSHIP_LOST"


@dataclass(frozen=True)
class ProxySnapshot:
    original: dict[str, Any]
    applied: dict[str, Any]


class SystemProxyManager:
    """Owns one process-local proxy change and restores it only if unchanged."""

    def __init__(
        self,
        read: Callable[[], dict[str, Any]],
        apply: Callable[[dict[str, Any]], None],
    ):
        self._read = read
        self._apply = apply
        self._snapshot: ProxySnapshot | None = None

    @property
    def active(self) -> bool:
        return self._snapshot is not None

    def enable(self, port: int) -> None:
        if self._snapshot is not None:
            return
        original = self._read()
        applied = {**original, "enabled": True, "server": "127.0.0.1", "port": port}
        self._apply(applied)
        self._snapshot = ProxySnapshot(original=original, applied=self._read())

    def restore(self) -> None:
        snapshot = self._snapshot
        if snapshot is None:
            return
        restore_proxy(snapshot, self._read, self._apply)
        self._snapshot = None

    def abandon(self) -> None:
        self._snapshot = None


def restore_proxy(snapshot: ProxySnapshot, read_current: Callable[[], dict[str, Any]], apply: Callable[[dict[str, Any]], None]) -> None:
    if read_current() != snapshot.applied:
        raise ProxyOwnershipError("系统代理已被其他程序修改，拒绝覆盖当前配置")
    apply(snapshot.original)


def command_for(enabled: bool, port: int) -> list[str]:
    address = f"127.0.0.1:{port}"
    if platform.system() == "Darwin":
        return ["networksetup", "-setwebproxy", "Wi-Fi", "127.0.0.1", str(port)] if enabled else ["networksetup", "-setwebproxystate", "Wi-Fi", "off"]
    if platform.system() == "Windows":
        return ["netsh", "winhttp", "set", "proxy", address] if enabled else ["netsh", "winhttp", "reset", "proxy"]
    raise RuntimeError("UNSUPPORTED_PLATFORM")


def run_command(args: list[str], timeout: float = 5.0) -> str:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "系统代理命令执行失败")
    return result.stdout.strip()


def _proxy_values(service: str, kind: str) -> dict[str, Any]:
    output = run_command(["networksetup", f"-get{kind}proxy", service])
    values: dict[str, Any] = {"enabled": False, "server": "", "port": 0}
    for line in output.splitlines():
        key, _, value = line.partition(":")
        normalized = key.strip().lower()
        value = value.strip()
        if normalized == "enabled":
            values["enabled"] = value.lower() in {"yes", "on", "1"}
        elif normalized == "server":
            values["server"] = value
        elif normalized == "port":
            try:
                values["port"] = int(value)
            except ValueError:
                values["port"] = 0
    return values


def _mac_service() -> str:
    interface = ""
    try:
        for line in run_command(["route", "-n", "get", "default"]).splitlines():
            if line.strip().startswith("interface:"):
                interface = line.split(":", 1)[1].strip()
                break
    except Exception:
        pass
    services = run_command(["networksetup", "-listallhardwareports"]).splitlines()
    current_port = ""
    for line in services:
        if line.startswith("Hardware Port:"):
            current_port = line.split(":", 1)[1].strip()
        elif line.startswith("Device:") and line.split(":", 1)[1].strip() == interface:
            return current_port
    for candidate in ("Wi-Fi", "Ethernet"):
        if any(line.strip() == candidate for line in services):
            return candidate
    raise RuntimeError("找不到当前 macOS 网络服务")


def create_system_proxy_manager() -> SystemProxyManager | None:
    if platform.system() != "Darwin":
        return None
    service = _mac_service()

    def read() -> dict[str, Any]:
        return {"service": service, "http": _proxy_values(service, "web"), "https": _proxy_values(service, "secureweb")}

    def apply(value: dict[str, Any]) -> None:
        for kind, flag in (("http", "web"), ("https", "secureweb")):
            state = value[kind]
            if state.get("enabled"):
                run_command(["networksetup", f"-set{flag}proxy", service, str(state.get("server", "")), str(state.get("port", 0))])
                run_command(["networksetup", f"-set{flag}proxystate", service, "on"])
            else:
                run_command(["networksetup", f"-set{flag}proxystate", service, "off"])

    return SystemProxyManager(read=read, apply=apply)

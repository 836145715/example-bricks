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

from __future__ import annotations

import hashlib
import platform
import subprocess
from pathlib import Path


class CertificateManager:
    def __init__(self, cert_dir: Path):
        self.cert_dir = Path(cert_dir)

    @property
    def certificate_path(self) -> Path:
        return self.cert_dir / "mitmproxy-ca-cert.cer"

    def fingerprint(self) -> str:
        if not self.certificate_path.exists():
            return ""
        return hashlib.sha256(self.certificate_path.read_bytes()).hexdigest().upper()

    def install(self) -> dict[str, str | bool]:
        path = self.certificate_path
        if not path.exists():
            raise RuntimeError("根证书尚未生成，请先启动一次代理")
        system = platform.system()
        if system == "Darwin":
            args = ["security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", str(Path.home() / "Library/Keychains/login.keychain-db"), str(path)]
        elif system == "Windows":
            args = ["certutil", "-user", "-addstore", "Root", str(path)]
        else:
            raise RuntimeError("当前平台不支持自动安装根证书")
        result = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "根证书安装失败")
        return {"ok": True, "fingerprint": self.fingerprint()}

    def remove(self) -> dict[str, str | bool]:
        fingerprint = self.fingerprint()
        if not fingerprint:
            return {"ok": True, "fingerprint": ""}
        system = platform.system()
        if system == "Windows":
            args = ["certutil", "-user", "-delstore", "Root", fingerprint]
        elif system == "Darwin":
            args = ["security", "delete-certificate", "-Z", fingerprint, str(Path.home() / "Library/Keychains/login.keychain-db")]
        else:
            raise RuntimeError("当前平台不支持自动移除根证书")
        result = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "根证书移除失败")
        return {"ok": True, "fingerprint": fingerprint}

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from flow_mapper import map_flow


class FlowStore:
    def __init__(self, root: Path, max_body_bytes: int = 1_048_576, quota_bytes: int = 512 * 1024 * 1024):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.body_dir = self.root / "bodies"
        self.body_dir.mkdir(exist_ok=True)
        self.max_body_bytes = max_body_bytes
        self.quota_bytes = quota_bytes
        self._lock = threading.RLock()
        self.db = sqlite3.connect(self.root / "flows.sqlite3", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS flows (id TEXT PRIMARY KEY, created INTEGER NOT NULL, host TEXT, method TEXT, status INTEGER, payload TEXT NOT NULL)")
        self.db.commit()

    def put(self, flow: dict[str, Any]) -> dict[str, Any]:
        if "startedAt" in flow:
            mapped = flow
        else:
            response = dict(flow.get("response") or {})
            body = str(response.get("body") or "")
            encoded = body.encode("utf-8")
            kept = encoded[: self.max_body_bytes]
            while kept:
                try:
                    body = kept.decode("utf-8")
                    break
                except UnicodeDecodeError:
                    kept = kept[:-1]
            response["body"] = body
            response["truncated"] = len(encoded) > len(kept)
            mapped = {
                "startedAt": int(flow.get("startedAt") or 0),
                "durationMs": int(flow.get("durationMs") or 0),
                "scheme": str(flow.get("scheme") or "http"),
                "httpVersion": str(flow.get("httpVersion") or "HTTP/1.1"),
                "path": str(flow.get("path") or "/"),
                "url": str(flow.get("url") or ""),
                "state": str(flow.get("state") or "complete"),
                "request": dict(flow.get("request") or {}),
                **flow,
                "response": response,
            }
        with self._lock:
            self.db.execute("INSERT OR REPLACE INTO flows(id, created, host, method, status, payload) VALUES (?, ?, ?, ?, ?, ?)", (mapped["id"], mapped["startedAt"], mapped.get("host", ""), mapped.get("method", ""), mapped.get("statusCode", 0), json.dumps(mapped, ensure_ascii=False)))
            self._enforce_quota()
            self.db.commit()
        return mapped

    def _enforce_quota(self) -> None:
        total = int(self.db.execute("SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM flows").fetchone()[0])
        while total > self.quota_bytes:
            count = int(self.db.execute("SELECT COUNT(*) FROM flows").fetchone()[0])
            if count <= 1:
                break
            oldest = self.db.execute("SELECT id, LENGTH(payload) FROM flows ORDER BY created ASC, rowid ASC LIMIT 1").fetchone()
            self.db.execute("DELETE FROM flows WHERE id = ?", (oldest[0],))
            total -= int(oldest[1])

    def list(self, query: str = "", limit: int = 200, after_id: str = "") -> list[dict[str, Any]]:
        clauses, params = [], []
        if query:
            clauses.append("(host LIKE ? OR payload LIKE ?)")
            params.extend([f"%{query}%", f"%{query}%"])
        if after_id:
            clauses.append("created > (SELECT created FROM flows WHERE id = ?)")
            params.append(after_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            rows = self.db.execute(f"SELECT payload FROM flows {where} ORDER BY created ASC LIMIT ?", [*params, min(max(limit, 1), 500)]).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def detail(self, flow_id: str) -> dict[str, Any]:
        with self._lock:
            row = self.db.execute("SELECT payload FROM flows WHERE id = ?", (flow_id,)).fetchone()
        if row is None:
            raise KeyError(flow_id)
        return json.loads(row["payload"])

    def clear(self) -> None:
        with self._lock:
            self.db.execute("DELETE FROM flows")
            self.db.commit()

    def close(self) -> None:
        with self._lock:
            self.db.close()

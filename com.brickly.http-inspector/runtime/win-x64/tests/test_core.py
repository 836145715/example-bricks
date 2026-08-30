import json
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from flow_mapper import curl_command, map_flow, redact_headers, truncate_body
from flow_store import FlowStore


def test_redacts_sensitive_headers_case_insensitively():
    result = redact_headers({"Authorization": "Bearer secret", "content-type": "application/json"})
    assert result == {"Authorization": "[REDACTED]", "content-type": "application/json"}


def test_truncate_body_keeps_utf8_boundary():
    value, truncated = truncate_body("你好世界".encode(), 7)
    assert value.decode() == "你好"
    assert truncated is True


def test_map_flow_creates_stable_list_dto():
    flow = {
        "id": "abc",
        "request": {"method": "GET", "url": "https://example.test/a?x=1", "headers": {"Cookie": "sid=secret"}},
        "response": {"status_code": 200, "headers": {"content-type": "application/json"}, "body": b'{"ok":true}'},
        "started_at": 1000.0,
        "completed_at": 1000.125,
    }
    mapped = map_flow(flow, max_body_bytes=1024)
    assert mapped["method"] == "GET"
    assert mapped["statusCode"] == 200
    assert mapped["durationMs"] == 125
    assert mapped["request"]["headers"]["Cookie"] == "[REDACTED]"


def test_map_flow_truncates_request_and_response_bodies():
    mapped = map_flow({"id": "large", "request": {"url": "http://large.test", "body": b"123456"}, "response": {"status_code": 200, "body": b"abcdef"}}, max_body_bytes=4)
    assert mapped["request"]["body"] == "1234"
    assert mapped["request"]["truncated"] is True
    assert mapped["response"]["body"] == "abcd"
    assert mapped["response"]["truncated"] is True


def test_store_paginates_and_persists_body(tmp_path):
    store = FlowStore(tmp_path, max_body_bytes=8, quota_bytes=1024)
    store.put({"id": "1", "host": "example.test", "method": "GET", "statusCode": 200, "response": {"body": "abcdefghijk"}})
    store.put({"id": "2", "host": "other.test", "method": "POST", "statusCode": 500})
    rows = store.list(query="example", limit=10)
    assert [row["id"] for row in rows] == ["1"]
    detail = store.detail("1")
    assert detail["response"]["body"] == "abcdefgh"
    assert detail["response"]["truncated"] is True


def test_curl_command_redacts_by_default():
    flow = {"method": "GET", "url": "https://example.test/a", "request": {"headers": {"Authorization": "secret"}, "body": ""}}
    assert "secret" not in curl_command(flow)
    assert "curl" in curl_command(flow)


def test_store_supports_runtime_worker_threads(tmp_path):
    store = FlowStore(tmp_path)
    errors = []

    def worker():
        try:
            store.put({"id": "thread-flow", "host": "thread.test", "method": "GET", "statusCode": 200})
            store.close()
        except Exception as exc:
            errors.append(exc)

    thread = threading.Thread(target=worker)
    thread.start()
    thread.join()
    assert errors == []


def test_store_evicts_oldest_flows_when_quota_is_exceeded(tmp_path):
    store = FlowStore(tmp_path, quota_bytes=900)
    for index in range(6):
        store.put({"id": str(index), "startedAt": index, "host": "quota.test", "method": "GET", "statusCode": 200, "response": {"body": "x" * 200}})
    rows = store.list(limit=20)
    assert len(rows) < 6
    assert rows[-1]["id"] == "5"

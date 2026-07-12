"""DeepSeek Markdown Export Brick for Brickly.

Parses DeepSeek shared conversation links, extracts dialog content
(including thinking process, search references), and saves as local Markdown files.

Runtime protocol is handled by brickly-sdk.
"""
from __future__ import annotations

import json
import re
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
from brickly import BppError, BricklyRuntime

# Force UTF-8 on Windows to avoid GBK mojibake for Chinese characters
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BRICK_ID = "com.brickly.deepseek-reader"
DEEPSEEK_API_URL = "https://chat.deepseek.com/api/v0/share/content"

_stdout_lock = threading.Lock()
_cancelled: set[str] = set()
_cancelled_lock = threading.Lock()
_active: dict[str, dict[str, Any]] = {}
_active_lock = threading.Lock()


def _send(msg: dict[str, Any]) -> None:
    req_id = msg.get("id")
    if isinstance(req_id, str):
        with _active_lock:
            active = _active.get(req_id)
        if active:
            ctx = active["ctx"]
            msg_type = msg.get("type")
            if msg_type == "command.progress":
                ctx.progress(float(msg.get("progress") or 0), msg.get("message"))
                return
            if msg_type == "command.chunk":
                ctx.chunk(msg.get("chunk"), msg.get("name"))
                return
            if msg_type == "command.output":
                ctx.output(str(msg.get("name") or "output"), msg.get("value"))
                return
            if msg_type == "command.result":
                active["result"] = msg.get("result")
                return
            if msg_type == "command.error":
                error = msg.get("error") if isinstance(msg.get("error"), dict) else {}
                active["error"] = BppError(str(error.get("code") or "INTERNAL_ERROR"), str(error.get("message") or "Runtime error"))
                return
    line = json.dumps(msg, ensure_ascii=False, default=str) + "\n"
    with _stdout_lock:
        sys.stdout.write(line)
        sys.stdout.flush()


_plugin = None  # set after BricklyRuntime construction


def _log(msg: str) -> None:
    """Structured log via SDK (runtime.log); never write stderr for business logs."""
    if _plugin is not None:
        _plugin.info(msg)


def _is_cancelled(req_id: str) -> bool:
    with _cancelled_lock:
        return req_id in _cancelled


def _mark_cancelled(req_id: str) -> None:
    with _cancelled_lock:
        _cancelled.add(req_id)


def _clear_cancelled(req_id: str) -> None:
    with _cancelled_lock:
        _cancelled.discard(req_id)


# —————————————————— Helpers ——————————————————


class _BppError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _bpp_error(code: str, message: str) -> _BppError:
    return _BppError(code, message)


def _extract_share_id(raw: str) -> str:
    """Extract share_id from URL or raw string."""
    raw = raw.strip()
    # Full URL: https://chat.deepseek.com/share/xxx
    m = re.match(r"https?://chat\.deepseek\.com/share/([A-Za-z0-9]+)", raw)
    if m:
        return m.group(1)
    # Share path: /share/xxx
    m = re.match(r"/share/([A-Za-z0-9]+)", raw)
    if m:
        return m.group(1)
    # Bare ID
    if re.fullmatch(r"[A-Za-z0-9]+", raw):
        return raw
    raise _bpp_error("INVALID_INPUT", f"无法识别的分享链接或ID: {raw}")


def _fetch_share_content(share_id: str, timeout: float = 30) -> dict[str, Any]:
    """Fetch conversation data from DeepSeek share API."""
    url = f"{DEEPSEEK_API_URL}?share_id={share_id}"
    _log(f"Fetching {url}")
    try:
        resp = requests.get(url, timeout=timeout, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": f"https://chat.deepseek.com/share/{share_id}",
            "Origin": "https://chat.deepseek.com",
        })
        resp.raise_for_status()
    except requests.Timeout:
        raise _bpp_error("TIMEOUT", f"请求超时 ({timeout}s)")
    except requests.RequestException as exc:
        raise _bpp_error("INTERNAL_ERROR", f"HTTP 请求失败: {exc}")

    # Detect HTML responses (rate limit / WAF block pages)
    content_type = resp.headers.get("Content-Type", "")
    text = resp.text
    if "text/html" in content_type or text.lstrip().startswith("<!DOCTYPE") or text.lstrip().startswith("<html"):
        if "Rate Limit" in text or "Request Blocked" in text:
            raise _bpp_error("RATE_LIMITED", "DeepSeek API 请求频率受限，请稍后重试")
        raise _bpp_error("INTERNAL_ERROR", "DeepSeek 返回了非预期的 HTML 页面，可能被拦截")

    try:
        data = resp.json()
    except json.JSONDecodeError:
        raise _bpp_error("INTERNAL_ERROR", "返回数据不是有效的 JSON")

    code = data.get("code", -1)
    if code != 0:
        msg = data.get("msg", "未知错误")
        raise _bpp_error("INTERNAL_ERROR", f"DeepSeek API 返回错误 (code={code}): {msg}")

    return data


def _parse_conversation(data: dict[str, Any]) -> dict[str, Any]:
    """Parse DeepSeek share JSON into structured conversation data.

    Supports two formats:
    1. API format (flat): messages have `content`, `thinking_content`, `tips` directly
    2. Web format (fragments): messages have `fragments[]` with type/content items
    Auto-detects which format based on presence of `fragments` key.
    """
    inner = data.get("data", {})
    biz_data = inner.get("biz_data", {}) if isinstance(inner, dict) else {}

    title = biz_data.get("title", "来自分享的对话")
    raw_messages = biz_data.get("messages", [])

    parsed_messages = []
    for msg in raw_messages:
        role = msg.get("role", "UNKNOWN")
        message_id = msg.get("message_id")
        inserted_at = msg.get("inserted_at")

        # Parse timestamp
        ts = ""
        if inserted_at:
            try:
                dt = datetime.fromtimestamp(float(inserted_at), tz=timezone.utc)
                ts = dt.strftime("%Y-%m-%d %H:%M:%S UTC")
            except (ValueError, OSError):
                ts = str(inserted_at)

        # Auto-detect format: fragments array vs flat fields
        if "fragments" in msg and isinstance(msg.get("fragments"), list):
            # Web/old format: fragments[] with type/content
            user_content = ""
            thinking_content = ""
            response_content = ""
            tip_content = ""
            thinking_elapsed = None

            for frag in msg["fragments"]:
                frag_type = frag.get("type", "")
                frag_content = frag.get("content", "")
                if frag_type == "REQUEST":
                    user_content = frag_content
                elif frag_type == "THINK":
                    thinking_content = frag_content
                    thinking_elapsed = frag.get("elapsed_secs")
                elif frag_type == "RESPONSE":
                    response_content = frag_content
                elif frag_type == "TIP":
                    tip_content = frag_content
        else:
            # API format: flat fields
            user_content = msg.get("content", "") if role == "USER" else ""
            thinking_content = msg.get("thinking_content", "") or ""
            response_content = msg.get("content", "") if role == "ASSISTANT" else ""
            tip_content = ""
            thinking_elapsed = msg.get("thinking_elapsed_secs")

            # Handle tips (can be string or list)
            raw_tips = msg.get("tips")
            if raw_tips:
                if isinstance(raw_tips, str):
                    tip_content = raw_tips
                elif isinstance(raw_tips, list):
                    tip_content = "\n".join(str(t) for t in raw_tips if t)

        # Search results (API format)
        search_results = msg.get("search_results", [])
        search_status = msg.get("search_status", "")

        parsed_messages.append({
            "messageId": message_id,
            "role": role,
            "timestamp": ts,
            "userContent": user_content,
            "thinkingContent": thinking_content,
            "thinkingElapsedSecs": thinking_elapsed,
            "responseContent": response_content,
            "tipContent": tip_content,
            "searchResults": search_results,
            "searchStatus": search_status,
            "thinkingEnabled": msg.get("thinking_enabled", False),
            "searchEnabled": msg.get("search_enabled", False),
            "tokenUsage": msg.get("accumulated_token_usage", 0),
        })

    return {
        "title": title,
        "messageCount": len(parsed_messages),
        "messages": parsed_messages,
    }


def _to_markdown(parsed: dict[str, Any], include_thinking: bool = True) -> str:
    """Convert parsed conversation to Markdown string."""
    title = parsed["title"]
    messages = parsed["messages"]
    lines: list[str] = []

    lines.append(f"# {title}\n")
    lines.append(f"> 解析自 DeepSeek 分享会话 | 共 {parsed['messageCount']} 条消息\n")

    for i, msg in enumerate(messages):
        role = msg["role"]
        ts = msg["timestamp"]

        if role == "USER":
            lines.append(f"## USER\n")
            if msg["userContent"]:
                lines.append(f"{msg['userContent']}\n")
        elif role == "ASSISTANT":
            lines.append(f"## ASSISTANT\n")

            # Search results
            search_results = msg.get("searchResults", [])
            if search_results:
                lines.append("<details>\n<summary>搜索结果</summary>\n")
                for sr in search_results:
                    if isinstance(sr, dict):
                        s_title = sr.get("title", sr.get("name", ""))
                        s_url = sr.get("url", sr.get("link", ""))
                        lines.append(f"- [{s_title}]({s_url})\n")
                    else:
                        lines.append(f"- {sr}\n")
                lines.append("</details>\n")

            if include_thinking and msg["thinkingContent"]:
                elapsed = ""
                if msg.get("thinkingElapsedSecs"):
                    elapsed = f" ({msg['thinkingElapsedSecs']:.1f}s)"
                lines.append(f"<details>\n<summary>思考过程{elapsed}</summary>\n")
                lines.append(f"{msg['thinkingContent']}\n")
                lines.append("</details>\n")

            if msg["responseContent"]:
                lines.append(f"{msg['responseContent']}\n")

            if msg["tipContent"]:
                lines.append(f"> ⚠️ {msg['tipContent']}\n")

        lines.append("---\n")

    return "\n".join(lines)


def _default_file_path_in_dir(title: str, save_dir: str) -> Path:
    """Build a Markdown file path inside the user-selected directory."""
    base = Path(save_dir).expanduser().resolve()
    if base.exists() and not base.is_dir():
        raise _bpp_error("INVALID_INPUT", f"保存目录不是文件夹: {base}")
    base.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r'[\\/:*?"<>|\n\r\t]', '_', title)
    safe_name = safe_name.strip('. ')[:80] or "deepseek-chat"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return base / f"{safe_name}_{timestamp}.md"


def _resolve_file_path(value: Any) -> str:
    """Resolve file path from various input formats."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("path", "$file"):
            path = value.get(key)
            if isinstance(path, str) and path.strip():
                return path.strip()
        name = value.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return ""


# —————————————————— Command Handlers ——————————————————


def cmd_save(req_id: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Fetch a DeepSeek share conversation and save as Markdown."""
    raw_id = str(inp.get("shareId") or "").strip()
    if not raw_id:
        raise _bpp_error("INVALID_INPUT", "shareId 不能为空")

    timeout = float(inp.get("timeout") or 30)
    include_thinking = bool(inp.get("includeThinking", True))
    save_dir_raw = _resolve_file_path(inp.get("saveDir"))
    if not save_dir_raw:
        raise _bpp_error("INVALID_INPUT", "请选择保存目录")

    share_id = _extract_share_id(raw_id)

    _send({"type": "command.progress", "id": req_id, "progress": 0.05, "message": f"正在获取分享内容: {share_id}"})
    _send({"type": "command.chunk", "id": req_id, "chunk": f"🔗 分享ID: {share_id}\n"})

    if _is_cancelled(req_id):
        raise _bpp_error("CANCELLED", "已取消")

    data = _fetch_share_content(share_id, timeout)

    _send({"type": "command.progress", "id": req_id, "progress": 0.3, "message": "正在解析会话内容"})

    parsed = _parse_conversation(data)

    _send({"type": "command.progress", "id": req_id, "progress": 0.5, "message": "正在生成 Markdown"})

    title, save_path, file_bytes = _write_markdown(parsed, include_thinking, save_dir_raw)

    _send({"type": "command.chunk", "id": req_id, "chunk": f"📄 标题: {title}\n💬 消息数: {parsed['messageCount']}\n📁 保存至: {save_path}\n📦 大小: {file_bytes} bytes\n"})

    _send({"type": "command.progress", "id": req_id, "progress": 1.0, "message": f"保存完成: {save_path.name}"})

    _send({"type": "command.output", "id": req_id, "name": "title", "value": title})
    _send({"type": "command.output", "id": req_id, "name": "messageCount", "value": parsed["messageCount"]})
    _send({"type": "command.output", "id": req_id, "name": "savedTo", "value": str(save_path)})
    _send({"type": "command.output", "id": req_id, "name": "bytes", "value": file_bytes})

    return {
        "title": title,
        "messageCount": parsed["messageCount"],
        "savedTo": str(save_path),
        "bytes": file_bytes,
    }


def _write_markdown(
    parsed: dict[str, Any],
    include_thinking: bool,
    save_dir_raw: str,
) -> tuple[str, Path, int]:
    title = parsed["title"]
    md_content = _to_markdown(parsed, include_thinking=include_thinking)
    save_path = _default_file_path_in_dir(title, save_dir_raw)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    save_path.write_text(md_content, encoding="utf-8")
    return title, save_path, len(md_content.encode("utf-8"))


def _run_command(ctx: Any, handler: Any, inp: dict[str, Any]) -> Any:
    req_id = ctx.request_id
    command_id = ctx.command_id
    _log(f"invoke start id={req_id} command={command_id}")
    with _active_lock:
        _active[req_id] = {"ctx": ctx, "result": None, "error": None}
    ctx.on_cancel(lambda: _mark_cancelled(req_id))

    try:
        result = handler(req_id, inp)
        with _active_lock:
            active = _active.get(req_id)
            if active is not None and active.get("result") is None:
                active["result"] = result
            final_result = active.get("result") if active is not None else result
            final_error = active.get("error") if active is not None else None
        if final_error:
            raise final_error
        _log(f"invoke ok id={req_id}")
        return final_result
    except _BppError as exc:
        _log(f"invoke err id={req_id} code={exc.code}")
        raise BppError(exc.code, exc.message)
    except requests.Timeout as exc:
        raise BppError("TIMEOUT", f"请求超时: {exc}")
    except requests.RequestException as exc:
        raise BppError("INTERNAL_ERROR", f"HTTP 错误: {exc}")
    except Exception as exc:
        _log(f"invoke crash id={req_id} {type(exc).__name__}: {exc}")
        raise BppError("INTERNAL_ERROR", f"{type(exc).__name__}: {exc}")
    finally:
        _clear_cancelled(req_id)
        with _active_lock:
            _active.pop(req_id, None)

plugin = BricklyRuntime(BRICK_ID)
_plugin = plugin
plugin.on_command("save", lambda ctx, inp: _run_command(ctx, cmd_save, inp or {}))


if __name__ == "__main__":
    plugin.run()

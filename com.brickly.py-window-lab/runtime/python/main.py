from __future__ import annotations

import json
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Optional

from brickly import BricklyRuntime, WindowHandle, PROTOCOL_VERSION

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


LAB_HTML = "ui/lab.html"
plugin = BricklyRuntime("com.brickly.py-window-lab")
lab: Optional[WindowHandle] = None

# 诊断日志：帮助确认 window.message / web_contents.send 是否在 live 环境生效
_DEBUG_LOG = Path(__file__).resolve().parents[2] / ".lab-debug.log"


def _debug(msg: str, **fields: Any) -> None:
    try:
        line = {
            "ts": int(time.time() * 1000),
            "msg": msg,
            **{k: v for k, v in fields.items()},
        }
        with _DEBUG_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(line, ensure_ascii=False, default=str) + "\n")
    except Exception:
        pass
    try:
        plugin.info(f"[lab-debug] {msg}", fields if fields else None)
    except Exception:
        pass

QUERY_METHODS = [
    "getBounds",
    "getContentBounds",
    "getPosition",
    "getSize",
    "getContentSize",
    "getMinimumSize",
    "getMaximumSize",
    "getNormalBounds",
    "getOpacity",
    "getTitle",
    "isAlwaysOnTop",
    "isVisible",
    "isFocused",
    "isMinimized",
    "isMaximized",
    "isFullScreen",
    "isNormal",
    "isModal",
    "isResizable",
    "isMovable",
    "isFocusable",
    "isMinimizable",
    "isMaximizable",
    "isClosable",
    "isFullScreenable",
    "isEnabled",
    "isKiosk",
    "hasShadow",
    "isVisibleOnAllWorkspaces",
    "isMenuBarVisible",
    "isMenuBarAutoHide",
    "isDestroyed",
    "webContents.getURL",
    "webContents.getTitle",
    "webContents.getZoomFactor",
    "webContents.getZoomLevel",
    "webContents.isDevToolsOpened",
    "webContents.canGoBack",
    "webContents.canGoForward",
]


_open_lab_lock = threading.Lock()
_open_lab_inflight: "threading.Condition | None" = None
_open_lab_result: dict[str, Any] | None = None
_open_lab_error: BaseException | None = None


def open_lab() -> dict[str, Any]:
    """串行化开窗，避免并发 create 双开。"""
    global _open_lab_inflight, _open_lab_result, _open_lab_error
    with _open_lab_lock:
        if _open_lab_inflight is not None:
            cond = _open_lab_inflight
            while _open_lab_inflight is cond:
                cond.wait()
            if _open_lab_error is not None:
                raise _open_lab_error
            assert _open_lab_result is not None
            return _open_lab_result
        _open_lab_inflight = threading.Condition(_open_lab_lock)
        _open_lab_result = None
        _open_lab_error = None

    try:
        result = _open_lab_once()
        err: BaseException | None = None
    except BaseException as exc:
        result = None
        err = exc

    with _open_lab_lock:
        _open_lab_result = result
        _open_lab_error = err
        cond = _open_lab_inflight
        _open_lab_inflight = None
        if cond is not None:
            cond.notify_all()

    if err is not None:
        raise err
    assert result is not None
    return result


def _open_lab_once() -> dict[str, Any]:
    global lab
    if lab and not lab.closed:
        try:
            lab.focus()
            _debug("open_lab_reuse", windowId=lab.id, protocol=PROTOCOL_VERSION)
            return {"windowId": lab.id, "reused": True, "protocolVersion": PROTOCOL_VERSION}
        except Exception:
            lab = None

    handle = plugin.ui.create_browser_window(
        LAB_HTML,
        {
            "width": 980,
            "height": 720,
            "title": "Brickly · Python Window API Lab",
            "backgroundColor": "#0f172a",
            "show": True,
            "resizable": True,
            "minimizable": True,
            "maximizable": True,
        },
    )
    lab = handle
    try:
        import importlib.metadata as md

        sdk_ver = md.version("brickly-sdk")
    except Exception:
        sdk_ver = "unknown"
    _debug(
        "open_lab_created",
        windowId=handle.id,
        protocol=PROTOCOL_VERSION,
        sdk=sdk_ver,
    )

    def on_closed(payload: Any) -> None:
        global lab
        plugin.log(f"lab window closed id={handle.id}")
        cause = payload.get("cause") if isinstance(payload, dict) else None
        forced = payload.get("forced") if isinstance(payload, dict) else None
        event_id = payload.get("eventId") if isinstance(payload, dict) else None
        _debug(
            "lab_closed",
            windowId=handle.id,
            cause=cause,
            forced=forced,
            eventId=event_id,
            payload=payload,
        )
        if lab and lab.id == handle.id:
            lab = None

    handle.on("closed", on_closed)
    # 额外订阅 runtime 级 closed，避免句柄事件丢失时看不清原因
    def on_runtime_closed(payload: Any, _env: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            return
        if int(payload.get("windowId") or -1) != int(handle.id):
            return
        _debug(
            "runtime_window_closed",
            windowId=payload.get("windowId"),
            cause=payload.get("cause"),
            forced=payload.get("forced"),
            eventId=payload.get("eventId"),
        )

    plugin.events.on("window.closed", on_runtime_closed)
    return {
        "windowId": handle.id,
        "reused": False,
        "protocolVersion": PROTOCOL_VERSION,
        "sdkVersion": sdk_ver,
    }


def close_lab() -> int:
    global lab
    if not lab or lab.closed:
        return 0
    try:
        lab.close()
    except Exception as error:
        plugin.log("close_lab failed:", repr(error))
    lab = None
    return 1


def call_on_lab(method: str, args: Any = None) -> Any:
    if not lab or lab.closed:
        raise RuntimeError("lab window not open")
    return lab.call(method, args if isinstance(args, list) else [])


def safe_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def query_all_state() -> dict[str, Any]:
    state: dict[str, Any] = {}
    for method in QUERY_METHODS:
        try:
            state[method] = safe_json(call_on_lab(method, []))
        except Exception as error:
            state[method] = {"__error": str(error)}
    return state


def _payload_window_id(payload: dict[str, Any]) -> Optional[int]:
    raw = payload.get("windowId")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return int(raw)


def handle_window_message(payload: Any, envelope: dict[str, Any]) -> None:
    event_request_id = ""
    if isinstance(envelope, dict):
        raw_rid = envelope.get("requestId")
        if isinstance(raw_rid, str):
            event_request_id = raw_rid

    if not isinstance(payload, dict):
        _debug("window.message_ignored", reason="payload_not_dict")
        return
    if not lab or lab.closed:
        _debug(
            "window.message_ignored",
            reason="lab_missing",
            channel=payload.get("channel"),
            payloadWindowId=payload.get("windowId"),
            eventRequestId=event_request_id,
        )
        return

    payload_wid = _payload_window_id(payload)
    if payload_wid is None or payload_wid != int(lab.id):
        _debug(
            "window.message_ignored",
            reason="window_id_mismatch",
            payloadWindowId=payload.get("windowId"),
            labId=lab.id,
            channel=payload.get("channel"),
            eventRequestId=event_request_id,
        )
        return

    channel = payload.get("channel")
    args = payload.get("args") if isinstance(payload.get("args"), list) else []
    _debug(
        "window.message",
        channel=channel,
        labId=lab.id,
        eventRequestId=event_request_id,
        argsPreview=args[:1] if args else [],
    )

    if channel == "lab:op":
        op = args[0] if args and isinstance(args[0], dict) else {}
        name = str(op.get("name") or "")
        req_id = op.get("reqId")
        op_args = op.get("args") if isinstance(op.get("args"), list) else []
        result = None
        error = None
        try:
            result = safe_json(call_on_lab(name, op_args))
        except Exception as exc:
            error = str(exc)
            _debug("lab_op_call_failed", name=name, error=error)
        # 同时写 requestId：事件作用域缺失时仍可从 payload 推导 parentRequestId
        parent_id = event_request_id or (req_id if isinstance(req_id, str) else "")
        reply = {
            "reqId": req_id,
            "name": name,
            "ok": error is None,
            "result": result,
            "error": error,
        }
        if parent_id:
            reply["requestId"] = parent_id
        try:
            lab.web_contents.send("lab:result", reply)
            _debug("lab_result_sent", name=name, ok=error is None, parentRequestId=parent_id)
        except Exception as exc:
            plugin.log("reply lab:result failed:", repr(exc))
            _debug(
                "lab_result_failed",
                name=name,
                error=str(exc),
                traceback=traceback.format_exc(),
                parentRequestId=parent_id,
            )
        return

    if channel == "lab:query":
        req_id = args[0].get("reqId") if args and isinstance(args[0], dict) else None
        try:
            state = query_all_state()
        except Exception as exc:
            _debug("lab_query_failed", error=str(exc), traceback=traceback.format_exc())
            return
        parent_id = event_request_id or (req_id if isinstance(req_id, str) else "")
        reply: dict[str, Any] = {
            "reqId": req_id,
            "state": state,
            "at": int(time.time() * 1000),
        }
        if parent_id:
            reply["requestId"] = parent_id
        try:
            lab.web_contents.send("lab:state", reply)
            _debug("lab_state_sent", keys=len(state), parentRequestId=parent_id)
        except Exception as exc:
            plugin.log("reply lab:state failed:", repr(exc))
            _debug(
                "lab_state_failed",
                error=str(exc),
                traceback=traceback.format_exc(),
                parentRequestId=parent_id,
            )


plugin.events.on("window.message", handle_window_message)


@plugin.on_command("open-lab")
def open_lab_command(_ctx, _input_obj):
    return open_lab()


@plugin.on_command("close-lab")
def close_lab_command(_ctx, _input_obj):
    return {"closed": close_lab()}


@plugin.on_shutdown
def shutdown() -> None:
    close_lab()


if __name__ == "__main__":
    plugin.run()

from __future__ import annotations

import json
import sys
import threading
import time
from typing import Any, Optional

from brickly import BricklyRuntime, WindowHandle

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


LAB_HTML = "ui/lab.html"
plugin = BricklyRuntime("com.brickly.py-window-lab")
lab: Optional[WindowHandle] = None

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
            return {"windowId": lab.id, "reused": True}
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

    def on_closed(_payload: Any) -> None:
        global lab
        plugin.log(f"lab window closed id={handle.id}")
        if lab and lab.id == handle.id:
            lab = None

    handle.on("closed", on_closed)
    return {"windowId": handle.id, "reused": False}


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


def handle_window_message(payload: Any, _envelope: dict[str, Any]) -> None:
    if not isinstance(payload, dict) or not lab or payload.get("windowId") != lab.id:
        return
    channel = payload.get("channel")
    args = payload.get("args") if isinstance(payload.get("args"), list) else []

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
        try:
            lab.web_contents.send(
                "lab:result",
                {
                    "reqId": req_id,
                    "name": name,
                    "ok": error is None,
                    "result": result,
                    "error": error,
                },
            )
        except Exception as exc:
            plugin.log("reply lab:result failed:", repr(exc))
        return

    if channel == "lab:query":
        req_id = args[0].get("reqId") if args and isinstance(args[0], dict) else None
        state = query_all_state()
        try:
            lab.web_contents.send("lab:state", {"reqId": req_id, "state": state, "at": int(time.time() * 1000)})
        except Exception as exc:
            plugin.log("reply lab:state failed:", repr(exc))


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

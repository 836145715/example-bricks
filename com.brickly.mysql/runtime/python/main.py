"""MySQL Database Plugin for Brickly.

Production-ready MySQL database plugin with:
- Profile-based connection configuration
- Connection pooling with auto-reconnect
- SQL query and execution
- Transaction support
- Streaming for large datasets

Protocol: Brickly Plugin Protocol (BPP) over stdio (JSON-lines)
"""
from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, Optional
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

BRICK_ID = "com.brickly.mysql"
PROTOCOL_VERSION = "0.1.0"

# Thread-safe stdout writing
_stdout_lock = threading.Lock()
_cancelled: set[str] = set()
_cancelled_lock = threading.Lock()

# Profile-provided configuration
_connections: Dict[str, pymysql.Connection] = {}
_connections_lock = threading.Lock()
_profile_config: Optional[DBConfig] = None
PROFILE_CONFIG_ID = "__profile__"


def _send(msg: dict[str, Any]) -> None:
    """Write JSON message to stdout with newline."""
    line = json.dumps(msg, ensure_ascii=False, default=str) + "\n"
    with _stdout_lock:
        sys.stdout.write(line)
        sys.stdout.flush()


def _log(msg: str) -> None:
    """Write log to stderr."""
    sys.stderr.write(f"[mysql] {msg}\n")
    sys.stderr.flush()


def _is_cancelled(req_id: str) -> bool:
    with _cancelled_lock:
        return req_id in _cancelled


def _mark_cancelled(req_id: str) -> None:
    with _cancelled_lock:
        _cancelled.add(req_id)


def _clear_cancelled(req_id: str) -> None:
    with _cancelled_lock:
        _cancelled.discard(req_id)


# —————————————————— Data Classes ——————————————————


@dataclass
class DBConfig:
    """Database configuration."""
    config_id: str
    host: str
    port: int
    user: str
    password: str
    database: Optional[str] = None
    charset: str = "utf8mb4"
    created_at: float = 0.0

    def to_dict(self, hide_password: bool = True) -> dict[str, Any]:
        d = asdict(self)
        if hide_password:
            d["password"] = "******"
        return d


def _load_config(config_id: str) -> Optional[DBConfig]:
    """Load active Profile configuration."""
    if config_id == PROFILE_CONFIG_ID:
        return _profile_config
    return None


def _config_from_profile(raw: Any) -> Optional[DBConfig]:
    if not isinstance(raw, dict):
        return None
    host = str(raw.get("host") or "").strip()
    user = str(raw.get("user") or "").strip()
    password = str(raw.get("password") or "").strip()
    if not host or not user or not password:
        return None
    port = _parse_int(raw.get("port"), 3306, "port")
    if port < 1 or port > 65535:
        raise _bpp_error("INVALID_INPUT", "MySQL Profile port must be between 1 and 65535")
    database = raw.get("database")
    if database:
        database = str(database).strip() or None
    charset = str(raw.get("charset") or "utf8mb4").strip()
    if not charset:
        raise _bpp_error("INVALID_INPUT", "MySQL Profile charset is required")
    return DBConfig(
        config_id=PROFILE_CONFIG_ID,
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset=charset,
        created_at=time.time()
    )


def _resolve_config_id() -> str:
    if _profile_config:
        return PROFILE_CONFIG_ID
    raise _bpp_error("INVALID_INPUT", "Please create and select a MySQL Profile before running this command")


def _parse_int(value: Any, default: int, field_name: str) -> int:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        raise _bpp_error("INVALID_INPUT", f"{field_name} must be a number")


def _normalize_params(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, (list, tuple, dict)):
        return value
    raise _bpp_error("INVALID_INPUT", "params must be a JSON array or object")


def _execute_sql(cursor: Any, sql: str, params: Any) -> None:
    normalized = _normalize_params(params)
    if normalized is None:
        cursor.execute(sql)
    else:
        cursor.execute(sql, normalized)


def _sql_head(sql: str) -> str:
    return sql.lstrip().split(None, 1)[0].upper() if sql.strip() else ""


def _is_readonly_sql(sql: str) -> bool:
    return _sql_head(sql) in {"SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH"}


# —————————————————— Connection Management ——————————————————


def _get_connection(config: DBConfig) -> pymysql.Connection:
    """Get or create connection with auto-reconnect."""
    with _connections_lock:
        if config.config_id in _connections:
            conn = _connections[config.config_id]
            try:
                conn.ping(reconnect=True)
                return conn
            except:
                # Connection failed, remove and recreate
                try:
                    conn.close()
                except:
                    pass
                del _connections[config.config_id]

        # Create new connection
        conn = pymysql.connect(
            host=config.host,
            port=config.port,
            user=config.user,
            password=config.password,
            database=config.database,
            charset=config.charset,
            cursorclass=DictCursor,
            autocommit=False,
            connect_timeout=10,
            read_timeout=30,
            write_timeout=30,
        )
        _connections[config.config_id] = conn
        return conn


@contextmanager
def _get_connection_context(config_id: str):
    """Context manager for database connection."""
    config = _load_config(config_id)
    if not config:
        raise _bpp_error("INVALID_INPUT", f"Config not found: {config_id}")

    conn = _get_connection(config)
    try:
        yield conn
    except Exception as e:
        conn.rollback()
        raise
    finally:
        # Keep connection alive for pooling
        pass


# —————————————————— Command Handlers ——————————————————


def cmd_test_connection(req_id: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Test database connection."""
    config_id = _resolve_config_id()

    config = _load_config(config_id)
    if not config:
        raise _bpp_error("INVALID_INPUT", f"Config not found: {config_id}")

    _send({"type": "command.progress", "id": req_id, "progress": 0.5, "message": f"Connecting to {config.host}:{config.port}"})

    try:
        conn = _get_connection(config)
        with conn.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            version = cursor.fetchone()
            version_str = version.get("VERSION()", "unknown") if version else "unknown"

        return {
            "success": True,
            "message": "Connection successful",
            "version": version_str
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Connection failed: {str(e)}",
            "version": ""
        }


def cmd_query(req_id: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Execute SELECT query with streaming support."""
    config_id = _resolve_config_id()
    sql = str(inp.get("sql") or "").strip()
    params = inp.get("params")
    fetch_size = _parse_int(inp.get("fetchSize"), 1000, "fetchSize")

    if not sql:
        raise _bpp_error("INVALID_INPUT", "sql is required")
    if not _is_readonly_sql(sql):
        raise _bpp_error("INVALID_INPUT", "query only accepts read-only SQL such as SELECT, SHOW, DESCRIBE, EXPLAIN, or WITH. Use execute for writes.")
    if fetch_size < 1 or fetch_size > 100000:
        raise _bpp_error("INVALID_INPUT", "fetchSize must be between 1 and 100000")

    config = _load_config(config_id)
    if not config:
        raise _bpp_error("INVALID_INPUT", f"Config not found: {config_id}")

    _send({"type": "command.progress", "id": req_id, "progress": 0.1, "message": "Executing query"})

    conn = _get_connection(config)
    cursor = conn.cursor(DictCursor)

    try:
        _execute_sql(cursor, sql, params)

        _send({"type": "command.progress", "id": req_id, "progress": 0.3, "message": "Fetching results"})

        # Get column names
        columns = [desc[0] for desc in cursor.description] if cursor.description else []

        # Stream results
        rows = []
        row_count = 0
        batch = []

        while True:
            if _is_cancelled(req_id):
                raise _bpp_error("CANCELLED", "Query cancelled by user")

            batch_row = cursor.fetchmany(fetch_size)
            if not batch_row:
                break

            batch.extend(batch_row)
            row_count += len(batch_row)

            # Emit progress
            progress = min(0.9, 0.3 + (row_count / 10000) * 0.6)
            _send({
                "type": "command.progress",
                "id": req_id,
                "progress": progress,
                "message": f"Fetched {row_count} rows"
            })

            # Emit chunk for streaming
            _send({
                "type": "command.chunk",
                "id": req_id,
                "chunk": f"Fetched {len(batch_row)} rows\n"
            })

        rows = batch

        _send({"type": "command.progress", "id": req_id, "progress": 1.0, "message": f"Complete: {row_count} rows"})

        return {
            "rows": rows,
            "rowCount": row_count,
            "columns": columns
        }
    finally:
        cursor.close()


def cmd_execute(req_id: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Execute INSERT/UPDATE/DELETE statements."""
    config_id = _resolve_config_id()
    sql = str(inp.get("sql") or "").strip()
    params = inp.get("params")

    if not sql:
        raise _bpp_error("INVALID_INPUT", "sql is required")

    # Prevent SELECT in execute
    if _is_readonly_sql(sql):
        raise _bpp_error("INVALID_INPUT", "Read-only SQL should use the query command instead of execute")

    config = _load_config(config_id)
    if not config:
        raise _bpp_error("INVALID_INPUT", f"Config not found: {config_id}")

    _send({"type": "command.progress", "id": req_id, "progress": 0.5, "message": "Executing statement"})

    conn = _get_connection(config)
    cursor = conn.cursor()

    try:
        _execute_sql(cursor, sql, params)

        conn.commit()

        affected_rows = cursor.rowcount
        last_insert_id = cursor.lastrowid if hasattr(cursor, 'lastrowid') else 0

        return {
            "affectedRows": affected_rows,
            "lastInsertId": last_insert_id,
            "message": f"Statement executed, {affected_rows} row(s) affected"
        }
    except Exception as e:
        conn.rollback()
        raise
    finally:
        cursor.close()


def cmd_transaction(req_id: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Execute multiple statements in a transaction."""
    config_id = _resolve_config_id()
    statements = inp.get("statements")

    if not statements or not isinstance(statements, list):
        raise _bpp_error("INVALID_INPUT", "statements is required and must be an array")

    config = _load_config(config_id)
    if not config:
        raise _bpp_error("INVALID_INPUT", f"Config not found: {config_id}")

    _send({"type": "command.progress", "id": req_id, "progress": 0.1, "message": f"Starting transaction with {len(statements)} statements"})

    conn = _get_connection(config)
    results = []

    try:
        for i, stmt in enumerate(statements):
            if _is_cancelled(req_id):
                raise _bpp_error("CANCELLED", "Transaction cancelled by user")

            if not isinstance(stmt, dict):
                raise _bpp_error("INVALID_INPUT", f"Statement {i+1}: item must be an object with sql and optional params")
            sql = str(stmt.get("sql") or "").strip()
            params = stmt.get("params")

            if not sql:
                raise _bpp_error("INVALID_INPUT", f"Statement {i+1}: sql is required")

            progress = 0.1 + ((i + 1) / len(statements)) * 0.8
            _send({
                "type": "command.progress",
                "id": req_id,
                "progress": progress,
                "message": f"Executing statement {i+1}/{len(statements)}"
            })

            cursor = conn.cursor()
            try:
                _execute_sql(cursor, sql, params)

                result = {
                    "statement": i + 1,
                    "affectedRows": cursor.rowcount,
                    "lastInsertId": cursor.lastrowid if hasattr(cursor, 'lastrowid') else 0
                }
                results.append(result)
                cursor.close()
            except Exception as e:
                cursor.close()
                raise

        conn.commit()

        _send({"type": "command.progress", "id": req_id, "progress": 1.0, "message": "Transaction committed"})

        return {
            "success": True,
            "message": f"Transaction completed successfully, {len(statements)} statement(s) executed",
            "results": results
        }
    except Exception as e:
        conn.rollback()
        raise _bpp_error("INTERNAL_ERROR", f"Transaction failed and rolled back: {str(e)}")


# —————————————————— Protocol Plumbing ——————————————————


class _BppError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _bpp_error(code: str, message: str) -> _BppError:
    return _BppError(code, message)


COMMANDS = {
    "test-connection": cmd_test_connection,
    "query": cmd_query,
    "execute": cmd_execute,
    "transaction": cmd_transaction,
}


def _handle_invoke(message: dict[str, Any]) -> None:
    """Handle command invocation."""
    req_id = message.get("id")
    command_id = message.get("commandId")
    inp = message.get("input") or {}

    if not isinstance(req_id, str) or not isinstance(command_id, str):
        return

    handler = COMMANDS.get(command_id)
    if handler is None:
        _send({
            "type": "command.error",
            "id": req_id,
            "error": {"code": "COMMAND_NOT_FOUND", "message": f"Unknown command: {command_id}"}
        })
        return

    _log(f"invoke start id={req_id} command={command_id}")

    try:
        result = handler(req_id, inp)
        _send({"type": "command.result", "id": req_id, "result": result})
        _log(f"invoke ok id={req_id}")
    except _BppError as exc:
        _send({
            "type": "command.error",
            "id": req_id,
            "error": {"code": exc.code, "message": exc.message}
        })
        _log(f"invoke err id={req_id} code={exc.code}")
    except pymysql.MySQLError as exc:
        _send({
            "type": "command.error",
            "id": req_id,
            "error": {"code": "DATABASE_ERROR", "message": f"MySQL error: {exc}"}
        })
        _log(f"invoke db error id={req_id} {exc}")
    except Exception as exc:
        _send({
            "type": "command.error",
            "id": req_id,
            "error": {"code": "INTERNAL_ERROR", "message": f"{type(exc).__name__}: {exc}"}
        })
        _log(f"invoke crash id={req_id} {type(exc).__name__}: {exc}")
    finally:
        _clear_cancelled(req_id)


def _on_message(message: dict[str, Any]) -> None:
    """Handle incoming protocol message."""
    msg_type = message.get("type")

    if msg_type == "host.hello":
        global _profile_config
        _profile_config = _config_from_profile(message.get("config"))
        if _profile_config:
            _log(f"Profile config loaded for {_profile_config.user}@{_profile_config.host}:{_profile_config.port}")
        _send({
            "type": "runtime.ready",
            "protocolVersion": PROTOCOL_VERSION,
            "brickId": BRICK_ID
        })
    elif msg_type == "runtime.ping":
        _send({"type": "runtime.pong", "id": message.get("id", "")})
    elif msg_type == "command.invoke":
        # Run in worker thread for concurrency
        threading.Thread(target=_handle_invoke, args=(message,), daemon=True).start()
    elif msg_type == "command.cancel":
        rid = message.get("id")
        if isinstance(rid, str):
            _mark_cancelled(rid)
            _log(f"cancel requested id={rid}")
    elif msg_type == "runtime.shutdown":
        _send({"type": "runtime.bye"})
        # Close all connections
        with _connections_lock:
            for conn in _connections.values():
                try:
                    conn.close()
                except:
                    pass
            _connections.clear()
        sys.exit(0)


def main() -> None:
    """Main entry point."""
    # Main loop: read stdin line by line
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
            _on_message(message)
        except json.JSONDecodeError as exc:
            _send({
                "type": "command.error",
                "id": "unknown",
                "error": {"code": "PROTOCOL_ERROR", "message": f"Invalid JSON: {exc}"}
            })


if __name__ == "__main__":
    main()

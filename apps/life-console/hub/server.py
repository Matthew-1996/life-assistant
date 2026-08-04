from __future__ import annotations

import argparse
import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from hub.command_runner.runner import CommandError, CommandRunner
from hub.read_model.dashboard import ReadModelError, build_dashboard, checkin_conflict_projection
from hub.security.policy import require_loopback_bind, valid_host, valid_origin


LOG = logging.getLogger("life_console.hub")
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47321
PROJECT_ROOT = Path(__file__).resolve().parents[3]
STATIC_ROOT = Path(__file__).resolve().parents[1] / "dist"


class LifeConsoleServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], handler: type[SimpleHTTPRequestHandler], *, root: Path):
        require_loopback_bind(address[0])
        self.project_root = root.resolve()
        self.runner = CommandRunner(PROJECT_ROOT, self.project_root)
        self.sessions: dict[str, tuple[str, datetime]] = {}
        self.idempotency: dict[str, tuple[str, dict[str, Any]]] = {}
        self.purge_plans: dict[str, dict[str, Any]] = {}
        super().__init__(address, handler)


class LifeConsoleHandler(SimpleHTTPRequestHandler):
    server: LifeConsoleServer

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        LOG.info("request method=%s path=%s status=%s", self.command, self.path.split("?", 1)[0], args[1] if len(args) > 1 else "unknown")

    def _json(self, status: HTTPStatus, payload: dict[str, Any], *, cookie: str | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _error(
        self,
        status: HTTPStatus,
        code: str,
        message: str,
        *,
        conflict: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "request_id": f"req_{secrets.token_hex(8)}",
            "error": {"code": code, "message": message, "retryable": status >= 500},
        }
        if conflict is not None:
            payload["conflict"] = conflict
        self._json(status, payload)

    def _session(self) -> bool:
        cookie = self.headers.get("Cookie", "")
        values = dict(
            item.strip().split("=", 1)
            for item in cookie.split(";")
            if "=" in item
        )
        session_id = values.get("life_console_session")
        state = self.server.sessions.get(session_id or "")
        if not state:
            return False
        csrf, expires = state
        return (
            expires > datetime.now(timezone.utc)
            and self.headers.get("X-Life-CSRF") == csrf
            and valid_origin(self.headers.get("Origin"))
        )

    def _body(self) -> dict[str, Any]:
        if self.headers.get_content_type() != "application/json":
            raise ValueError("content type")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 25000:
            raise ValueError("content length")
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("body")
        return value

    def _receipt(
        self,
        result: dict[str, Any],
        *,
        journal: bool = False,
        read_model: str = "current",
    ) -> dict[str, Any]:
        action = result.get("action")
        if action == "exists":
            action = "unchanged"
        if action not in {"created", "updated", "unchanged"}:
            action = "created" if journal else "updated"
        return {
            "request_id": f"req_{secrets.token_hex(8)}",
            "command_id": f"cmd_{secrets.token_hex(8)}",
            "action": action,
            "source": {"state": "saved", "revision": result.get("revision")},
            "read_model": read_model,
            "message": (
                "已保存到 iCloud"
                if read_model == "current"
                else "记录已保存，页面稍后刷新"
            ),
        }

    def do_GET(self) -> None:
        if not valid_host(self.headers.get("Host")):
            self._error(HTTPStatus.BAD_REQUEST, "INVALID_REQUEST", "请求主机无效")
            return
        route = self.path.split("?", 1)[0]
        if route == "/api/v1/health":
            self._json(HTTPStatus.OK, {"status": "ready", "schema_version": 1})
            return
        if route == "/api/v1/session":
            token = secrets.token_urlsafe(24)
            session_id = secrets.token_urlsafe(24)
            expires = datetime.now(timezone.utc) + timedelta(minutes=30)
            self.server.sessions[session_id] = (token, expires)
            self._json(
                HTTPStatus.OK,
                {"schema_version": 1, "csrf_token": token, "expires_at": expires.isoformat()},
                cookie=f"life_console_session={session_id}; HttpOnly; SameSite=Strict; Path=/",
            )
            return
        if route == "/api/v1/dashboard":
            try:
                snapshot = build_dashboard(self.server.project_root)
            except (ReadModelError, UnicodeError, KeyError, TypeError, ValueError):
                self._error(HTTPStatus.SERVICE_UNAVAILABLE, "SOURCE_INVALID", "本地来源暂不可用")
                return
            self._json(HTTPStatus.OK, snapshot)
            return
        if route == "/api/v1/confirmations":
            self._json(HTTPStatus.OK, {"schema_version": 1, "items": []})
            return
        if route.startswith("/api/"):
            self._error(HTTPStatus.NOT_FOUND, "INVALID_REQUEST", "接口不存在")
            return
        super().do_GET()

    def do_POST(self) -> None:
        if not valid_host(self.headers.get("Host")) or not self._session():
            self._error(HTTPStatus.FORBIDDEN, "INVALID_REQUEST", "写入会话无效")
            return
        try:
            body = self._body()
            route = self.path.split("?", 1)[0]
            if route == "/api/v1/purge-plans":
                if set(body) != {"schema_version", "target_type", "target_key"}:
                    raise ValueError("fields")
                target_type = body["target_type"]
                target_key = body["target_key"]
                source = self.server.runner.purge_plan(target_type, target_key)
                if source.get("exists") is False:
                    raise CommandError("SOURCE_INVALID")
                source_hash = hashlib.sha256(
                    json.dumps(source, ensure_ascii=False, sort_keys=True).encode()
                ).hexdigest()
                plan_id = f"plan_{secrets.token_hex(16)}"
                revision = source.get("revision") or 1
                source_etag = source.get("record_etag") or source_hash
                confirmation = source.get("required_confirmation") or target_key
                plan = {
                    "schema_version": 1,
                    "plan_id": plan_id,
                    "target_type": target_type,
                    "target_key": target_key,
                    "expect_revision": revision,
                    "plan_etag": source_hash,
                    "scope_summary": f"删除当前项目中的 1 条 {target_type} 源记录。",
                    "confirmation_text": confirmation,
                    "historical_copies_notice": "聊天、旧 ZIP 和 iCloud/设备历史不在本次删除范围内。",
                }
                self.server.purge_plans[plan_id] = {
                    **plan, "source_etag": source_etag,
                    "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                }
                self._json(HTTPStatus.OK, plan)
                return
            if route == "/api/v1/capture/preview":
                if set(body) != {"schema_version", "text", "context_etag"}:
                    raise ValueError("fields")
                text = body.get("text")
                if not isinstance(text, str) or not text.strip() or len(text) > 8000:
                    raise ValueError("text")
                self._json(HTTPStatus.OK, {
                    "schema_version": 1,
                    "state": "handoff_required",
                    "message": "请前往现有生活助手对话继续",
                    "intent": "unknown",
                })
                return
            key = body.get("idempotency_key")
            if not isinstance(key, str) or not 16 <= len(key) <= 100:
                raise ValueError("idempotency")
            fingerprint = hashlib.sha256(
                json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            cached = self.server.idempotency.get(key)
            if cached:
                if cached[0] != fingerprint:
                    self._error(HTTPStatus.CONFLICT, "INVALID_REQUEST", "幂等键已用于其他请求")
                    return
                self._json(HTTPStatus.OK, cached[1])
                return
            if route == "/api/v1/purge-confirmations":
                required = {
                    "schema_version", "idempotency_key", "plan_id",
                    "confirmation_text", "expect_revision", "plan_etag",
                    "acknowledge_historical_copies",
                }
                if set(body) != required or body["acknowledge_historical_copies"] is not True:
                    raise ValueError("fields")
                plan = self.server.purge_plans.get(body["plan_id"])
                if (
                    not plan
                    or plan["expires_at"] <= datetime.now(timezone.utc)
                    or body["confirmation_text"] != plan["confirmation_text"]
                    or body["expect_revision"] != plan["expect_revision"]
                    or body["plan_etag"] != plan["plan_etag"]
                ):
                    raise CommandError("REVISION_CONFLICT")
                latest = self.server.runner.purge_plan(plan["target_type"], plan["target_key"])
                latest_hash = hashlib.sha256(
                    json.dumps(latest, ensure_ascii=False, sort_keys=True).encode()
                ).hexdigest()
                if latest_hash != plan["plan_etag"]:
                    raise CommandError("REVISION_CONFLICT")
                result = self.server.runner.purge(plan["target_type"], plan["target_key"], plan)
                self.server.purge_plans.pop(body["plan_id"], None)
                journal = plan["target_type"] == "journal"
            elif route == "/api/v1/journals":
                if set(body) - {"schema_version", "idempotency_key", "event_date", "event_time", "time_precision", "text"}:
                    raise ValueError("fields")
                result = self.server.runner.add_journal(body)
                journal = True
            elif route.startswith("/api/v1/checkins/"):
                if set(body) != {"schema_version", "idempotency_key", "expect_revision", "fields"}:
                    raise ValueError("fields")
                day = route.rsplit("/", 1)[1]
                result = self.server.runner.upsert_checkin(day, body)
                journal = False
            else:
                self._error(HTTPStatus.NOT_FOUND, "INVALID_REQUEST", "接口不存在")
                return
            try:
                build_dashboard(self.server.project_root)
                read_model = "current"
            except (ReadModelError, UnicodeError, KeyError, TypeError, ValueError):
                read_model = "pending_refresh"
            receipt = self._receipt(result, journal=journal, read_model=read_model)
            self.server.idempotency[key] = (fingerprint, receipt)
            self._json(HTTPStatus.OK, receipt)
        except (ValueError, KeyError, json.JSONDecodeError):
            self._error(HTTPStatus.BAD_REQUEST, "INVALID_REQUEST", "请求格式无效")
        except CommandError as error:
            status = HTTPStatus.CONFLICT if error.code == "REVISION_CONFLICT" else HTTPStatus.SERVICE_UNAVAILABLE
            conflict = None
            if error.code == "REVISION_CONFLICT" and route.startswith("/api/v1/checkins/"):
                day = route.rsplit("/", 1)[1]
                revision, current = checkin_conflict_projection(self.server.project_root, day)
                submitted = {
                    key: value for key, value in body.get("fields", {}).items()
                    if key != "note_summary"
                }
                conflict = {
                    "target_key": day,
                    "current_revision": revision,
                    "current": current,
                    "submitted": submitted,
                }
            self._error(status, error.code, "记录无法安全保存", conflict=conflict)


def create_server(*, root: Path = PROJECT_ROOT, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> LifeConsoleServer:
    return LifeConsoleServer((host, port), LifeConsoleHandler, root=root)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = create_server(host=args.host, port=args.port)
    LOG.info("Life Hub ready at http://%s:%s", *server.server_address)
    server.serve_forever()


if __name__ == "__main__":
    main()

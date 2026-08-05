from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
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
CHECKIN_TIME_FIELDS = {"sleep_time", "wake_time", "out_of_bed_time"}
CHECKIN_RATING_FIELDS = {"sleep_quality", "energy", "mood", "life_feeling"}
CHECKIN_ANCHOR_FIELDS = {"wake", "body_light", "life_action", "wind_down"}
ICLOUD_STATUSES = {"readable", "writable", "partial", "unavailable"}
AUTOMATION_STATUSES = {"ready", "attention", "unknown"}
CHECKIN_FIELDS = (
    CHECKIN_TIME_FIELDS
    | CHECKIN_RATING_FIELDS
    | CHECKIN_ANCHOR_FIELDS
    | {"awake_in_bed", "note_summary"}
)
TIME_PATTERN = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]")


def _valid_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat() == value
    except ValueError:
        return False


def _valid_revision(value: Any) -> bool:
    return value is None or (isinstance(value, int) and not isinstance(value, bool) and value >= 1)


def _valid_text(value: Any, *, minimum: int = 1, maximum: int) -> bool:
    return isinstance(value, str) and minimum <= len(value) <= maximum


def _validate_journal(body: dict[str, Any]) -> None:
    required = {"schema_version", "idempotency_key", "event_date", "time_precision", "text"}
    allowed = required | {"event_time"}
    if not required.issubset(body) or not set(body).issubset(allowed):
        raise ValueError("journal fields")
    if not _valid_date(body.get("event_date")):
        raise ValueError("event date")
    event_time = body.get("event_time")
    if event_time is not None and (
        not isinstance(event_time, str) or TIME_PATTERN.fullmatch(event_time) is None
    ):
        raise ValueError("event time")
    if body.get("time_precision") not in {"exact", "approximate", "unknown"}:
        raise ValueError("time precision")
    if not _valid_text(body.get("text"), maximum=20_000):
        raise ValueError("journal text")


def _validate_checkin(day: str, body: dict[str, Any]) -> None:
    if not _valid_date(day):
        raise ValueError("date")
    if set(body) != {"schema_version", "idempotency_key", "expect_revision", "fields"}:
        raise ValueError("fields")
    if not _valid_revision(body.get("expect_revision")):
        raise ValueError("revision")
    fields = body.get("fields")
    if not isinstance(fields, dict) or not fields or not set(fields).issubset(CHECKIN_FIELDS):
        raise ValueError("checkin fields")
    for key, value in fields.items():
        if key in CHECKIN_TIME_FIELDS and (
            not isinstance(value, str) or TIME_PATTERN.fullmatch(value) is None
        ):
            raise ValueError("time")
        if key in CHECKIN_RATING_FIELDS and (
            not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 5
        ):
            raise ValueError("rating")
        if key in CHECKIN_ANCHOR_FIELDS and value not in {"complete", "minimum", "skipped"}:
            raise ValueError("anchor")
        if key == "awake_in_bed" and value not in {"yes", "no"}:
            raise ValueError("awake")
        if key == "note_summary" and (
            not isinstance(value, str) or len(value) > 160
        ):
            raise ValueError("summary")


class LifeConsoleServer(ThreadingHTTPServer):
    def __init__(
        self,
        address: tuple[str, int],
        handler: type[SimpleHTTPRequestHandler],
        *,
        root: Path,
        icloud_status: str = "readable",
        automation_status: str = "unknown",
    ):
        require_loopback_bind(address[0])
        if icloud_status not in ICLOUD_STATUSES:
            raise ValueError("invalid iCloud status")
        if automation_status not in AUTOMATION_STATUSES:
            raise ValueError("invalid automation status")
        self.project_root = root.resolve()
        self.icloud_status = icloud_status
        self.automation_status = automation_status
        self.runner = CommandRunner(PROJECT_ROOT, self.project_root)
        self.sessions: dict[str, tuple[str, datetime]] = {}
        self.idempotency: dict[str, tuple[str, dict[str, Any]]] = {}
        self.purge_plans: dict[str, dict[str, Any]] = {}
        self.confirmations: dict[str, dict[str, Any]] = {}
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

    def log_message(self, _format: str, *args: Any) -> None:
        del _format
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

    def _session(self, *, require_csrf: bool = False) -> bool:
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
        if expires <= datetime.now(timezone.utc):
            self.server.sessions.pop(session_id or "", None)
            return False
        if not require_csrf:
            return True
        return (
            self.headers.get("X-Life-CSRF") == csrf
            and valid_origin(
                self.headers.get("Origin"),
                port=self.server.server_port,
            )
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
        if not valid_host(self.headers.get("Host"), port=self.server.server_port):
            self._error(HTTPStatus.BAD_REQUEST, "INVALID_REQUEST", "请求主机无效")
            return
        route = self.path.split("?", 1)[0]
        if route == "/api/v1/health":
            self._json(HTTPStatus.OK, {"status": "ready", "schema_version": 1})
            return
        if route == "/api/v1/session":
            csrf = secrets.token_urlsafe(24)
            session_id = secrets.token_urlsafe(24)
            expires = datetime.now(timezone.utc) + timedelta(minutes=30)
            self.server.sessions[session_id] = (csrf, expires)
            self._json(
                HTTPStatus.OK,
                {"schema_version": 1, "csrf_token": csrf, "expires_at": expires.isoformat()},
                cookie=f"life_console_session={session_id}; HttpOnly; SameSite=Strict; Path=/",
            )
            return
        if route in {"/api/v1/dashboard", "/api/v1/confirmations"} and not self._session():
            self._error(HTTPStatus.FORBIDDEN, "INVALID_REQUEST", "本地会话无效")
            return
        if route == "/api/v1/dashboard":
            try:
                snapshot = build_dashboard(self.server.project_root)
            except (ReadModelError, UnicodeError, KeyError, TypeError, ValueError) as error:
                LOG.exception(
                    "dashboard source unavailable error=%s",
                    error.__class__.__name__,
                )
                self._error(HTTPStatus.SERVICE_UNAVAILABLE, "SOURCE_INVALID", "本地来源暂不可用")
                return
            snapshot["today"]["confirmations"] = list(self.server.confirmations.values())
            snapshot["system"]["icloud"] = self.server.icloud_status
            snapshot["system"]["automation"] = self.server.automation_status
            self._json(HTTPStatus.OK, snapshot)
            return
        if route == "/api/v1/confirmations":
            self._json(HTTPStatus.OK, {
                "schema_version": 1,
                "items": list(self.server.confirmations.values()),
            })
            return
        if route.startswith("/api/"):
            self._error(HTTPStatus.NOT_FOUND, "INVALID_REQUEST", "接口不存在")
            return
        super().do_GET()

    def do_POST(self) -> None:
        if (
            not valid_host(self.headers.get("Host"), port=self.server.server_port)
            or not self._session(require_csrf=True)
        ):
            self._error(HTTPStatus.FORBIDDEN, "INVALID_REQUEST", "写入会话无效")
            return
        route = self.path.split("?", 1)[0]
        try:
            body = self._body()
            if body.get("schema_version") != 1 or isinstance(body.get("schema_version"), bool):
                raise ValueError("schema version")
            if route == "/api/v1/purge-plans":
                if set(body) != {"schema_version", "target_type", "target_key"}:
                    raise ValueError("fields")
                target_type = body["target_type"]
                target_key = body["target_key"]
                if target_type not in {"journal", "daily_checkin", "weekly_review", "phase_review"}:
                    raise ValueError("target type")
                if not _valid_text(target_key, maximum=200):
                    raise ValueError("target key")
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
                if not _valid_text(text, maximum=8000) or not text.strip():
                    raise ValueError("text")
                if not _valid_text(body.get("context_etag"), maximum=200):
                    raise ValueError("context etag")
                self._json(HTTPStatus.OK, {
                    "schema_version": 1,
                    "state": "handoff_required",
                    "message": "请前往现有生活助手对话继续",
                    "intent": "unknown",
                })
                return
            key = body.get("idempotency_key")
            if (
                not isinstance(key, str)
                or re.fullmatch(r"[A-Za-z0-9_-]{16,100}", key) is None
            ):
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
            if route == "/api/v1/capture/commit":
                if set(body) != {"schema_version", "idempotency_key", "preview_token"}:
                    raise ValueError("fields")
                if not _valid_text(body.get("preview_token"), minimum=24, maximum=500):
                    raise ValueError("preview token")
                self._error(HTTPStatus.BAD_REQUEST, "PREVIEW_EXPIRED", "当前没有可提交的保存预览")
                return
            if route == "/api/v1/purge-confirmations":
                required = {
                    "schema_version", "idempotency_key", "plan_id",
                    "confirmation_text", "expect_revision", "plan_etag",
                    "acknowledge_historical_copies",
                }
                if set(body) != required or body["acknowledge_historical_copies"] is not True:
                    raise ValueError("fields")
                if (
                    not _valid_text(body.get("plan_id"), minimum=16, maximum=200)
                    or not _valid_text(body.get("confirmation_text"), maximum=200)
                    or not _valid_revision(body.get("expect_revision"))
                    or body.get("expect_revision") is None
                    or not _valid_text(body.get("plan_etag"), minimum=16, maximum=200)
                ):
                    raise ValueError("purge confirmation")
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
                _validate_journal(body)
                result = self.server.runner.add_journal(body)
                journal = True
            elif route.startswith("/api/v1/checkins/"):
                day = route.rsplit("/", 1)[1]
                _validate_checkin(day, body)
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
            status = {
                "INVALID_REQUEST": HTTPStatus.BAD_REQUEST,
                "REVISION_CONFLICT": HTTPStatus.CONFLICT,
                "SOURCE_INVALID": HTTPStatus.SERVICE_UNAVAILABLE,
                "TOOL_TIMEOUT": HTTPStatus.SERVICE_UNAVAILABLE,
            }.get(error.code, HTTPStatus.SERVICE_UNAVAILABLE)
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
                confirmation_id = f"conflict:{day}"
                self.server.confirmations[confirmation_id] = {
                    "id": confirmation_id,
                    "type": "revision_conflict",
                    "title": "状态已在其他位置更新",
                    "message": "请核对最新记录与本次提交后再决定。",
                    "action_label": "刷新最新记录",
                }
            self._error(status, error.code, "记录无法安全保存", conflict=conflict)


def create_server(
    *,
    root: Path = PROJECT_ROOT,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    icloud_status: str = "readable",
    automation_status: str = "unknown",
) -> LifeConsoleServer:
    return LifeConsoleServer(
        (host, port),
        LifeConsoleHandler,
        root=root,
        icloud_status=icloud_status,
        automation_status=automation_status,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument(
        "--root",
        default=PROJECT_ROOT,
        type=Path,
        help="iCloud life-assistant project root (machine-local launch setting)",
    )
    parser.add_argument("--icloud-status", choices=sorted(ICLOUD_STATUSES), default="readable")
    parser.add_argument("--automation-status", choices=sorted(AUTOMATION_STATUSES), default="unknown")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = create_server(
        root=args.root,
        host=args.host,
        port=args.port,
        icloud_status=args.icloud_status,
        automation_status=args.automation_status,
    )
    LOG.info("Life Hub ready at http://%s:%s", *server.server_address)
    server.serve_forever()


if __name__ == "__main__":
    main()

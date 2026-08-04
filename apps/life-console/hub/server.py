from __future__ import annotations

import argparse
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from hub.read_model.dashboard import ReadModelError, build_dashboard
from hub.security.policy import require_loopback_bind, valid_host


LOG = logging.getLogger("life_console.hub")
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47321
PROJECT_ROOT = Path(__file__).resolve().parents[3]
STATIC_ROOT = Path(__file__).resolve().parents[1] / "dist"


class LifeConsoleServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], handler: type[SimpleHTTPRequestHandler], *, root: Path):
        require_loopback_bind(address[0])
        self.project_root = root.resolve()
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

    def _error(self, status: HTTPStatus, code: str, message: str) -> None:
        self._json(status, {
            "request_id": f"req_{secrets.token_hex(8)}",
            "error": {"code": code, "message": message, "retryable": status >= 500},
        })

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
            expires = datetime.now(timezone.utc) + timedelta(minutes=30)
            self._json(
                HTTPStatus.OK,
                {"schema_version": 1, "csrf_token": token, "expires_at": expires.isoformat()},
                cookie=f"life_console_session={secrets.token_urlsafe(24)}; HttpOnly; SameSite=Strict; Path=/",
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

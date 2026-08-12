#!/usr/bin/env python3
"""Synthetic-only loopback receiver for the Life Console 2.1.0 Gate 2 POC.

This is not a production backup agent. It accepts only an explicitly allowed
web Origin, listens only on IPv4 loopback, and writes only to a caller-provided
temporary directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zipfile import BadZipFile, ZipFile


MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
INTENT_HEADER = "X-Life-Console-Intent"


def origin_digest(origin: str) -> str:
    return hashlib.sha256(origin.encode("utf-8")).hexdigest()


def validate_synthetic_zip(path: Path) -> None:
    try:
        with ZipFile(path) as archive:
            names = archive.namelist()
            if names != ["manifest.json", "data/synthetic.ndjson"]:
                raise ValueError("unexpected_archive_layout")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("format_version") != "life-console-poc/1":
                raise ValueError("unexpected_format")
            if manifest.get("synthetic") is not True:
                raise ValueError("synthetic_marker_required")
    except (BadZipFile, KeyError, json.JSONDecodeError) as error:
        raise ValueError("invalid_archive") from error


class LoopbackPocServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, address, handler, *, allowed_origin_sha256: str, output_dir: Path):
        if address[0] != "127.0.0.1":
            raise ValueError("poc_must_bind_ipv4_loopback")
        super().__init__(address, handler)
        self.allowed_origin_sha256 = allowed_origin_sha256
        self.output_dir = output_dir


class LoopbackPocHandler(BaseHTTPRequestHandler):
    server: LoopbackPocServer

    def log_message(self, _format: str, *_args) -> None:
        # Do not persist request origins, paths, payloads, or local directories.
        return

    def _allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin and origin_digest(origin) == self.server.allowed_origin_sha256:
            return origin
        return None

    def _send_json(self, status: int, payload: dict, *, origin: str | None = None) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        origin = self._allowed_origin()
        if self.path != "/v1/health":
            self._send_json(404, {"error": "not_found"})
        elif not origin:
            self._send_json(403, {"error": "origin_rejected"})
        else:
            self._send_json(200, {"ok": True, "mode": "synthetic-poc"}, origin=origin)

    def do_OPTIONS(self) -> None:  # noqa: N802
        origin = self._allowed_origin()
        requested_headers = {
            value.strip().lower()
            for value in self.headers.get("Access-Control-Request-Headers", "").split(",")
            if value.strip()
        }
        expected_headers = {"content-type", INTENT_HEADER.lower()}
        if (
            self.path != "/v1/backups"
            or not origin
            or self.headers.get("Access-Control-Request-Method") != "POST"
            or not expected_headers.issubset(requested_headers)
        ):
            self._send_json(403, {"error": "preflight_rejected"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Life-Console-Intent",
        )
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "60")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        origin = self._allowed_origin()
        if self.path != "/v1/backups":
            self._send_json(404, {"error": "not_found"})
            return
        if not origin:
            self._send_json(403, {"error": "origin_rejected"})
            return
        if self.headers.get(INTENT_HEADER) != "synthetic-backup":
            self._send_json(403, {"error": "intent_rejected"}, origin=origin)
            return
        if self.headers.get("Content-Type") != "application/zip":
            self._send_json(415, {"error": "content_type_rejected"}, origin=origin)
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            content_length = -1
        if content_length < 1 or content_length > MAX_ARCHIVE_BYTES:
            self._send_json(413, {"error": "archive_size_rejected"}, origin=origin)
            return

        self.server.output_dir.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=self.server.output_dir,
                prefix=".life-console-poc-",
                suffix=".zip",
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                os.chmod(temporary_path, 0o600)
                remaining = content_length
                while remaining:
                    chunk = self.rfile.read(min(remaining, 64 * 1024))
                    if not chunk:
                        raise ValueError("incomplete_body")
                    temporary.write(chunk)
                    remaining -= len(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
            validate_synthetic_zip(temporary_path)
            digest = hashlib.sha256(temporary_path.read_bytes()).hexdigest()
            os.replace(temporary_path, self.server.output_dir / "synthetic-latest.zip")
            temporary_path = None
            self._send_json(
                201,
                {"ok": True, "receipt": digest[:16], "synthetic": True},
                origin=origin,
            )
        except ValueError as error:
            self._send_json(422, {"error": str(error)}, origin=origin)
        finally:
            if temporary_path:
                temporary_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=47322)
    parser.add_argument("--allowed-origin-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    server = LoopbackPocServer(
        ("127.0.0.1", args.port),
        LoopbackPocHandler,
        allowed_origin_sha256=args.allowed_origin_sha256,
        output_dir=args.output_dir,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()

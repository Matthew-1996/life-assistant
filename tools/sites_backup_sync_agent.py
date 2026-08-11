#!/usr/bin/env python3
"""Pull pending Sites backup events into a versioned iCloud cold-backup tree.

The agent is intentionally one-way. It reads D1-owned payloads, writes immutable
revision files, and reports queue outcomes. It never imports local files to D1.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol


RETRY_DELAYS_SECONDS = (10, 30, 120, 600, 3600, 21600, 86400)
RESOURCE_TYPES = {
    "daily_checkin",
    "goal",
    "health_day",
    "journal",
    "phase_review",
    "weekly_review",
}


class SitesTransport(Protocol):
    def list_pending(self, limit: int) -> list[dict[str, object]]:
        ...

    def get_payload(self, queue_id: str) -> dict[str, object]:
        ...

    def report(self, queue_id: str, payload: dict[str, object]) -> None:
        ...


class VersionedColdBackupWriter:
    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def _safe_segment(value: object, name: str) -> str:
        if not isinstance(value, str) or not value:
            raise ValueError(f"{name} is required")
        if value in {".", ".."} or "/" in value or "\0" in value:
            raise ValueError(f"{name} is unsafe")
        return value

    def write(self, payload: dict[str, object]) -> Path:
        resource_type = self._safe_segment(payload.get("resource_type"), "resource_type")
        if resource_type not in RESOURCE_TYPES:
            raise ValueError("resource_type is not allowed")
        resource_id = self._safe_segment(payload.get("resource_id"), "resource_id")
        revision = payload.get("revision")
        if (
            not isinstance(revision, int)
            or isinstance(revision, bool)
            or revision < 1
        ):
            raise ValueError("revision must be a positive integer")

        directory = self.root / resource_type / resource_id
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        for parent in (self.root, self.root / resource_type, directory):
            os.chmod(parent, 0o700)
        target = directory / f"revision-{revision:08d}.json"
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ) + "\n"
        if target.exists():
            if target.read_text(encoding="utf-8") != canonical:
                raise ValueError("existing cold backup revision differs")
            return target

        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.",
            suffix=".tmp",
            dir=directory,
            text=True,
        )
        temporary = Path(temporary_name)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(canonical)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
            os.chmod(target, 0o600)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        return target


def _retry_delay(attempts: object) -> int:
    attempt_count = attempts if isinstance(attempts, int) else 0
    index = min(max(attempt_count, 0), len(RETRY_DELAYS_SECONDS) - 1)
    return RETRY_DELAYS_SECONDS[index]


def sync_pending(
    transport: SitesTransport,
    writer: VersionedColdBackupWriter,
    *,
    agent_id: str,
    limit: int = 50,
) -> dict[str, int]:
    items = transport.list_pending(limit)
    result = {"processed": 0, "succeeded": 0, "failed": 0}
    for item in items:
        queue_id = item.get("id")
        if not isinstance(queue_id, str) or not queue_id:
            continue
        result["processed"] += 1
        try:
            payload = transport.get_payload(queue_id)
            writer.write(payload)
            transport.report(
                queue_id,
                {"status": "SUCCESS", "sync_agent": agent_id},
            )
            result["succeeded"] += 1
        except (OSError, ValueError, RuntimeError, urllib.error.URLError):
            delay = _retry_delay(item.get("attempts"))
            transport.report(
                queue_id,
                {
                    "status": "RETRYING",
                    "sync_agent": agent_id,
                    "error": "backup_payload_unavailable",
                    "retry_after_seconds": delay,
                },
            )
            result["failed"] += 1
    return result


class HttpSitesTransport:
    def __init__(self, base_url: str, session_token: str, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.session_token = session_token
        self.timeout = timeout
        self._csrf: str | None = None

    def _request(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, object] | None = None,
    ) -> Any:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.session_token}",
        }
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        if method != "GET":
            headers["Origin"] = self.base_url
            headers["X-Life-CSRF"] = self._csrf_token()
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def _csrf_token(self) -> str:
        if self._csrf:
            return self._csrf
        request = urllib.request.Request(
            f"{self.base_url}/api/v1/auth/csrf",
            data=b"",
            headers={
                "Authorization": f"Bearer {self.session_token}",
                "Origin": self.base_url,
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
        self._csrf = body["token"]
        return self._csrf

    def list_pending(self, limit: int) -> list[dict[str, object]]:
        body = self._request(
            f"/api/v1/backup/queue?status=PENDING&size={max(1, min(limit, 100))}"
        )
        return body["items"]

    def get_payload(self, queue_id: str) -> dict[str, object]:
        return self._request(f"/api/v1/backup/queue/{queue_id}/payload")

    def report(self, queue_id: str, payload: dict[str, object]) -> None:
        self._request(
            f"/api/v1/backup/queue/{queue_id}/report",
            method="POST",
            payload=payload,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--backup-root", type=Path, required=True)
    parser.add_argument("--agent-id", default="life-console-local")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument(
        "--session-env",
        default="LIFE_CONSOLE_SESSION",
        help="Environment variable containing the owner session token.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    session_token = os.environ.get(args.session_env)
    if not session_token:
        print(
            json.dumps({"status": "error", "message": "owner session is unavailable"}),
            file=sys.stderr,
        )
        return 2
    try:
        result = sync_pending(
            HttpSitesTransport(args.base_url, session_token),
            VersionedColdBackupWriter(args.backup_root),
            agent_id=args.agent_id,
            limit=args.limit,
        )
    except (OSError, ValueError, urllib.error.URLError) as error:
        print(
            json.dumps({"status": "error", "message": type(error).__name__}),
            file=sys.stderr,
        )
        return 2
    print(json.dumps({"status": "ok", **result}))
    return 0 if result["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

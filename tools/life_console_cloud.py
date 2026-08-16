#!/usr/bin/env python3
"""Authenticated Life Console cloud writes without a local write fallback.

This module intentionally keeps authentication storage and HTTP transport behind
small interfaces.  Callers receive only redacted receipts; personal payloads are
never echoed to stdout by the library.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import argparse
import getpass
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Callable, Protocol
from urllib import error, parse, request

from journal_normalization_contract import (
    JournalNormalizationError,
    load_contract,
    validate_normalization,
)


class CloudWriteError(RuntimeError):
    """A fail-closed cloud write result suitable for user-facing routing."""


class Transport(Protocol):
    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        token: str | None = None,
    ) -> Any: ...


@dataclass(frozen=True)
class HttpTransport:
    base_url: str
    publishable_key: str
    timeout_seconds: float = 20.0

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        token: str | None = None,
    ) -> Any:
        encoded = None if body is None else json.dumps(body).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "apikey": self.publishable_key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        outgoing = request.Request(
            f"{self.base_url.rstrip('/')}{path}",
            data=encoded,
            headers=headers,
            method=method,
        )
        try:
            with request.urlopen(outgoing, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except error.HTTPError as exc:
            if exc.code in (401, 403):
                raise CloudWriteError("unauthenticated") from exc
            if exc.code == 409:
                raise CloudWriteError("conflict") from exc
            raise CloudWriteError("unavailable") from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise CloudWriteError("unavailable") from exc
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise CloudWriteError("unavailable") from exc


def _first_row(value: Any) -> dict[str, Any]:
    if not isinstance(value, list) or not value or not isinstance(value[0], dict):
        raise CloudWriteError("unavailable")
    return value[0]


class CloudClient:
    """Owner-scoped repository adapter used by conversations and automations."""

    def __init__(self, transport: Transport, token_provider: Callable[[], str]):
        self._transport = transport
        self._token_provider = token_provider

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
    ) -> Any:
        try:
            bearer = self._token_provider()
            if not bearer:
                raise CloudWriteError("unauthenticated")
            return self._transport.request(
                method,
                path,
                body=body,
                token=bearer,
            )
        except CloudWriteError:
            raise
        except (OSError, TimeoutError, error.URLError) as exc:
            raise CloudWriteError("unavailable") from exc

    @staticmethod
    def _receipt(resource: str, row: dict[str, Any]) -> dict[str, Any]:
        revision = row.get("revision")
        if not isinstance(revision, int):
            raise CloudWriteError("unavailable")
        return {
            "status": "saved",
            "resource": resource,
            "revision": revision,
        }

    def create_journal(self, record: dict[str, Any]) -> dict[str, Any]:
        record_key = record.get("record_key")
        if not isinstance(record_key, str) or not record_key.strip():
            raise ValueError("record_key is required")
        row = _first_row(self._request(
            "POST",
            "/rest/v1/rpc/create_journal_v2",
            body={
                "p_idempotency_key": record_key,
                "p_record_key": record_key,
                "p_event_date": record.get("event_date"),
                "p_event_time": record.get("event_time"),
                "p_time_precision": record.get("time_precision", "unknown"),
                "p_source": record.get("source", "agent"),
                "p_privacy": record.get("privacy", "owner-only"),
                "p_content": record.get("content"),
            },
        ))
        revision = row.get("revision")
        raw_revision = row.get("raw_revision")
        journal_id = row.get("id")
        if not isinstance(revision, int):
            raise CloudWriteError("unavailable")

        normalization = record.get("normalization")
        if normalization is None:
            return {
                "status": "saved",
                "normalization_status": "pending",
                "revision": revision,
            }
        context_revisions = record.get("context_revisions", {})
        if not isinstance(context_revisions, dict):
            context_revisions = {}
        try:
            normalized = validate_normalization(
                normalization,
                record.get("content"),
                context_revisions,
            )
        except (JournalNormalizationError, TypeError):
            return {
                "status": "saved",
                "normalization_status": "pending",
                "revision": revision,
            }
        if not isinstance(journal_id, int) or not isinstance(raw_revision, int):
            return {
                "status": "saved",
                "normalization_status": "pending",
                "revision": revision,
            }

        contract = load_contract()
        task_key = "journal-normalize:agent:" + hashlib.sha256(
            f"{record_key}:{raw_revision}".encode("utf-8")
        ).hexdigest()
        try:
            job = _first_row(self._request(
                "POST",
                "/rest/v1/rpc/begin_journal_normalization",
                body={
                    "p_journal_id": journal_id,
                    "p_source_revision": raw_revision,
                    "p_contract_version": contract["contract_version"],
                    "p_prompt_version": contract["prompt_version"],
                    "p_processor": "agent",
                    "p_task_key": task_key,
                },
            ))
        except CloudWriteError:
            return {
                "status": "saved",
                "normalization_status": "pending",
                "revision": revision,
            }
        job_id = job.get("id")
        if not isinstance(job_id, str) or not job_id:
            return {
                "status": "saved",
                "normalization_status": "pending",
                "revision": revision,
            }
        try:
            completed = _first_row(self._request(
                "POST",
                "/rest/v1/rpc/complete_journal_normalization",
                body={
                    "p_job_id": job_id,
                    "p_expected_source_revision": raw_revision,
                    "p_metadata": normalized,
                    "p_title": normalized["title"],
                    "p_tags": normalized["tags"],
                },
            ))
        except CloudWriteError:
            try:
                self._request(
                    "POST",
                    "/rest/v1/rpc/fail_journal_normalization",
                    body={
                        "p_job_id": job_id,
                        "p_expected_source_revision": raw_revision,
                        "p_failure_code": "agent_completion_failed",
                    },
                )
            except CloudWriteError:
                return {
                    "status": "saved",
                    "normalization_status": "pending",
                    "revision": revision,
                }
            return {
                "status": "saved",
                "normalization_status": "failed",
                "revision": revision,
            }
        completed_revision = completed.get("revision")
        if not isinstance(completed_revision, int):
            raise CloudWriteError("unavailable")
        return {
            "status": "saved",
            "normalization_status": "completed",
            "revision": completed_revision,
        }

    def upsert_daily_checkin(self, record: dict[str, Any]) -> dict[str, Any]:
        record_key = record.get("record_key")
        checkin_date = record.get("checkin_date")
        if not isinstance(record_key, str) or not record_key.strip():
            raise ValueError("record_key is required")
        if not isinstance(checkin_date, str) or not checkin_date:
            raise ValueError("checkin_date is required")

        created = _first_row(self._request(
            "POST",
            "/rest/v1/rpc/create_daily_checkin",
            body={
                "p_idempotency_key": record_key,
                "p_checkin_date": checkin_date,
                "p_sleep_quality": record.get("sleep_quality"),
                "p_energy": record.get("energy"),
                "p_mood": record.get("mood"),
                "p_life_feeling": record.get("life_feeling"),
                "p_anchors": record.get("anchors"),
                "p_notes": record.get("notes"),
            },
        ))

        sleep_patch = {
            key: record[key]
            for key in (
                "sleep_time",
                "wake_time",
                "out_of_bed_time",
                "awake_in_bed",
            )
            if key in record
        }
        if sleep_patch:
            identifier = created.get("id")
            revision = created.get("revision")
            if not isinstance(identifier, int) or not isinstance(revision, int):
                raise CloudWriteError("unavailable")
            sleep_patch["revision"] = revision + 1
            created = _first_row(self._request(
                "PATCH",
                "/rest/v1/daily_checkins?"
                + parse.urlencode({"id": f"eq.{identifier}", "revision": f"eq.{revision}"}),
                body=sleep_patch,
            ))
        return self._receipt("daily_checkin", created)

    def pending_backup(self) -> dict[str, Any] | None:
        rows = self._request(
            "GET",
            "/rest/v1/backup_runs?status=eq.pending&select=id,status,created_at"
            "&order=created_at.asc&limit=1",
        )
        if not isinstance(rows, list):
            raise CloudWriteError("unavailable")
        return rows[0] if rows else None

    def request_backup(self) -> dict[str, Any]:
        return _first_row(self._request(
            "POST",
            "/rest/v1/rpc/request_life_console_backup",
            body={},
        ))

    def cutover_online_primary(
        self,
        *,
        run_id: str,
        manifest_digest: str,
        journals: list[dict[str, Any]],
        daily_checkins: list[dict[str, Any]],
    ) -> dict[str, Any]:
        result = self._request(
            "POST",
            "/rest/v1/rpc/cutover_life_console_230",
            body={
                "p_run_id": run_id,
                "p_manifest_digest": manifest_digest,
                "p_journals": journals,
                "p_daily_checkins": daily_checkins,
            },
        )
        if not isinstance(result, dict):
            raise CloudWriteError("unavailable")
        return result

    def backup_snapshot(self) -> dict[str, Any]:
        value = self._request(
            "POST",
            "/rest/v1/rpc/export_life_console_snapshot",
            body={},
        )
        if not isinstance(value, dict):
            raise CloudWriteError("unavailable")
        return value

    def complete_backup(
        self,
        run_id: int,
        *,
        counts: dict[str, int],
        content_digest: str,
    ) -> None:
        rows = self._request(
            "PATCH",
            f"/rest/v1/backup_runs?id=eq.{run_id}&status=eq.pending",
            body={
                "status": "success",
                "record_counts": counts,
                "content_digest": content_digest,
                "completed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
        )
        _first_row(rows)


KEYCHAIN_SERVICE = "life-console-owner-session"
DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "integrations" / "life-console-cloud.json"


def load_keychain_session() -> dict[str, Any]:
    completed = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", "owner", "-w"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise CloudWriteError("unauthenticated")
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise CloudWriteError("unauthenticated") from exc
    if not isinstance(value, dict):
        raise CloudWriteError("unauthenticated")
    return value


def keychain_access_token() -> str:
    bearer = load_keychain_session().get("access_token")
    if not isinstance(bearer, str) or not bearer:
        raise CloudWriteError("unauthenticated")
    return bearer


def store_keychain_session(session: dict[str, Any]) -> None:
    serialized = json.dumps(session, separators=(",", ":"), sort_keys=True)
    completed = subprocess.run(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            "owner",
            "-w",
            serialized,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise CloudWriteError("unavailable")


def session_token_provider(
    transport: Transport,
    *,
    load: Callable[[], dict[str, Any]] = load_keychain_session,
    store: Callable[[dict[str, Any]], None] = store_keychain_session,
    now: Callable[[], float] = time.time,
) -> Callable[[], str]:
    """Return an Owner token provider that refreshes before session expiry."""

    def provide() -> str:
        session = load()
        access_token = session.get("access_token")
        refresh_token = session.get("refresh_token")
        expires_at = session.get("expires_at")
        if not isinstance(access_token, str) or not access_token:
            raise CloudWriteError("unauthenticated")
        if isinstance(expires_at, (int, float)) and expires_at > now() + 120:
            return access_token
        if not isinstance(refresh_token, str) or not refresh_token:
            raise CloudWriteError("unauthenticated")
        refreshed = transport.request(
            "POST",
            "/auth/v1/token?grant_type=refresh_token",
            body={"refresh_token": refresh_token},
        )
        if not isinstance(refreshed, dict):
            raise CloudWriteError("unauthenticated")
        normalized = (
            refreshed.get("session")
            if isinstance(refreshed.get("session"), dict)
            else refreshed
        )
        bearer = normalized.get("access_token")
        if not isinstance(bearer, str) or not bearer:
            raise CloudWriteError("unauthenticated")
        store(normalized)
        return bearer

    return provide


def authenticate_owner(
    transport: Transport,
    *,
    email: str,
    passphrase: str,
    store: Callable[[dict[str, Any]], None] = store_keychain_session,
) -> dict[str, str]:
    try:
        session = transport.request(
            "POST",
            "/auth/v1/token?grant_type=password",
            body={"email": email, "password": passphrase},
        )
    except CloudWriteError:
        raise
    except (OSError, TimeoutError, error.URLError) as exc:
        raise CloudWriteError("unavailable") from exc
    if not isinstance(session, dict):
        raise CloudWriteError("unauthenticated")
    normalized = session.get("session") if isinstance(session.get("session"), dict) else session
    if not isinstance(normalized.get("access_token"), str):
        raise CloudWriteError("unauthenticated")
    store(normalized)
    return {"status": "authenticated"}


def _load_client(config_path: Path) -> CloudClient:
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        base_url = config["project_url"]
        publishable_key = config["publishable_key"]
    except (OSError, KeyError, json.JSONDecodeError, TypeError) as exc:
        raise CloudWriteError("unavailable") from exc
    transport = HttpTransport(base_url=base_url, publishable_key=publishable_key)
    return CloudClient(
        transport,
        token_provider=session_token_provider(transport),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Life Console online-only writer")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("auth")
    for command in ("journal", "daily-checkin"):
        child = subparsers.add_parser(command)
        child.add_argument("--input", default="-", help="JSON file or - for stdin")
    args = parser.parse_args(argv)
    try:
        if args.command == "auth":
            config = json.loads(args.config.read_text(encoding="utf-8"))
            email = input("Owner email: ").strip()
            passphrase = getpass.getpass("Owner password: ")
            receipt = authenticate_owner(
                HttpTransport(
                    base_url=config["project_url"],
                    publishable_key=config["publishable_key"],
                ),
                email=email,
                passphrase=passphrase,
            )
            print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
            return 0
        raw = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
        payload = json.loads(raw)
        client = _load_client(args.config)
        receipt = client.create_journal(payload) if args.command == "journal" else client.upsert_daily_checkin(payload)
    except (CloudWriteError, OSError, json.JSONDecodeError, ValueError) as exc:
        code = str(exc) if isinstance(exc, CloudWriteError) else "unavailable"
        print(json.dumps({"status": code}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

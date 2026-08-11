#!/usr/bin/env python3
"""Append-only emergency event queue for temporary Sites outages.

This tool never mutates life records and never imports events into D1. It only
creates mode-0600 event files for later controlled reconciliation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


RESOURCE_TYPES = {
    "daily_checkin",
    "goal",
    "health_day",
    "journal",
    "phase_review",
    "weekly_review",
}
IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{16,200}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_payload(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("payload must be a JSON object")
    return value


def validate_event(event: dict[str, Any]) -> None:
    required = {
        "schema_version",
        "event_id",
        "created_at",
        "operation",
        "resource_type",
        "idempotency_key",
        "base_revision",
        "payload",
        "payload_sha256",
    }
    if set(event) != required:
        raise ValueError("event fields do not match the emergency queue schema")
    if event["schema_version"] != 1 or event["operation"] != "CREATE_ONLY":
        raise ValueError("only schema v1 CREATE_ONLY events are allowed")
    if event["resource_type"] not in RESOURCE_TYPES:
        raise ValueError("resource_type is not allowed")
    if not IDEMPOTENCY_PATTERN.fullmatch(event["idempotency_key"]):
        raise ValueError("idempotency_key is invalid")
    revision = event["base_revision"]
    if revision is not None and (
        not isinstance(revision, int) or isinstance(revision, bool) or revision < 1
    ):
        raise ValueError("base_revision must be null or a positive integer")
    canonical = json.dumps(
        event["payload"],
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    if hashlib.sha256(canonical).hexdigest() != event["payload_sha256"]:
        raise ValueError("payload digest mismatch")


def append_event(
    queue_dir: Path,
    resource_type: str,
    idempotency_key: str,
    payload: dict[str, Any],
    base_revision: int | None,
) -> Path:
    if resource_type not in RESOURCE_TYPES:
        raise ValueError("resource_type is not allowed")
    if not IDEMPOTENCY_PATTERN.fullmatch(idempotency_key):
        raise ValueError("idempotency_key is invalid")
    queue_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(queue_dir, 0o700)
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    event_id = f"emergency_{uuid.uuid4()}"
    event = {
        "schema_version": 1,
        "event_id": event_id,
        "created_at": utc_now(),
        "operation": "CREATE_ONLY",
        "resource_type": resource_type,
        "idempotency_key": idempotency_key,
        "base_revision": base_revision,
        "payload": payload,
        "payload_sha256": hashlib.sha256(canonical).hexdigest(),
    }
    validate_event(event)
    target = queue_dir / f"{event_id}.json"
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(event, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return target


def validate_queue(queue_dir: Path) -> list[Path]:
    paths = sorted(queue_dir.glob("emergency_*.json"))
    seen_keys: set[str] = set()
    for path in paths:
        event = json.loads(path.read_text(encoding="utf-8"))
        validate_event(event)
        key = event["idempotency_key"]
        if key in seen_keys:
            raise ValueError(f"duplicate idempotency_key: {key}")
        seen_keys.add(key)
    return paths


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    append_parser = subparsers.add_parser("append")
    append_parser.add_argument("--queue-dir", type=Path, required=True)
    append_parser.add_argument("--resource-type", choices=sorted(RESOURCE_TYPES), required=True)
    append_parser.add_argument("--idempotency-key", required=True)
    append_parser.add_argument("--base-revision", type=int)
    append_parser.add_argument("--payload-file", type=Path, required=True)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--queue-dir", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "append":
            path = append_event(
                args.queue_dir,
                args.resource_type,
                args.idempotency_key,
                load_payload(args.payload_file),
                args.base_revision,
            )
            print(json.dumps({"status": "queued", "path": path.name}))
        else:
            paths = validate_queue(args.queue_dir)
            print(json.dumps({"status": "valid", "events": len(paths)}))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "error", "message": str(error)}), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

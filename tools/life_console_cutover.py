#!/usr/bin/env python3
"""Prepare the exact private local delta and invoke the atomic 2.3.0 cutover."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import uuid
from typing import Any

from life_console_cloud import DEFAULT_CONFIG, CloudWriteError, _load_client


def _jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError("private_source_invalid")
            rows.append(value)
    return rows


def _entry_block(content: str, identifier: str) -> str:
    marker = f"<!-- journal-id: {identifier} -->"
    matches = list(re.finditer(rf"(?m)^{re.escape(marker)}[ \t]*$", content))
    if len(matches) != 1:
        raise ValueError("private_journal_marker_invalid")
    marker_position = matches[0].start()
    heading_position = content.rfind("\n## ", 0, marker_position)
    heading_position = 0 if heading_position < 0 and content.startswith("## ") else heading_position + 1
    if heading_position < 0:
        raise ValueError("private_journal_heading_invalid")
    next_heading = content.find("\n## ", marker_position + len(marker))
    block_end = len(content) if next_heading < 0 else next_heading
    return content[heading_position:block_end].rstrip() + "\n"


def prepare_delta(private_root: Path) -> dict[str, list[dict[str, Any]]]:
    index = _jsonl(private_root / "journal/index.jsonl")
    old_journals = _jsonl(
        private_root / "apps/life-console/scripts/private-migration/source-data/journals.jsonl"
    )
    old_journal_keys = {
        (row.get("event_date"), row.get("title")) for row in old_journals
    }
    journal_delta: list[dict[str, Any]] = []
    for row in index:
        if (row.get("date"), row.get("title")) in old_journal_keys:
            continue
        relative = Path(str(row.get("file", "")))
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("private_journal_path_invalid")
        recorded_at = row.get("recorded_at")
        amendments = row.get("amendments") if isinstance(row.get("amendments"), list) else []
        updated_at = amendments[-1].get("timestamp") if amendments else recorded_at
        journal_delta.append({
            "record_key": f"local-journal:{row['id']}",
            "event_date": row["date"],
            "title": row["title"],
            "content": _entry_block(
                (private_root / "journal" / relative).read_text(encoding="utf-8"),
                str(row["id"]),
            ),
            "tags": row.get("tags", []),
            "metadata": row,
            "created_at": recorded_at,
            "updated_at": updated_at,
        })

    current_daily = _jsonl(private_root / "records/daily-checkins.jsonl")
    old_daily = _jsonl(
        private_root / "apps/life-console/scripts/private-migration/source-data/daily_checkins.jsonl"
    )
    old_dates = {row.get("checkin_date") for row in old_daily}
    daily_delta: list[dict[str, Any]] = []
    for row in current_daily:
        if row.get("date") in old_dates:
            continue
        ratings = row.get("ratings") if isinstance(row.get("ratings"), dict) else {}
        daily_delta.append({
            "source_stable_id": row["key"],
            "checkin_date": row["date"],
            "sleep_quality": ratings.get("sleep_quality"),
            "energy": ratings.get("energy"),
            "mood": ratings.get("mood"),
            "life_feeling": ratings.get("life_feeling"),
            "sleep_time": row.get("sleep_time"),
            "wake_time": row.get("wake_time"),
            "out_of_bed_time": row.get("out_of_bed_time"),
            "awake_in_bed": row.get("awake_in_bed"),
            "anchors": row.get("anchors"),
            "notes": row.get("note_summary"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        })
    if len(journal_delta) != 3 or len(daily_delta) != 1:
        raise ValueError("private_delta_counts_changed")
    return {"journals": journal_delta, "daily_checkins": daily_delta}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-root", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    args = parser.parse_args()
    try:
        payload = prepare_delta(args.private_root.resolve())
        canonical = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        result = _load_client(args.config).cutover_online_primary(
            run_id=str(uuid.uuid4()),
            manifest_digest=hashlib.sha256(canonical).hexdigest(),
            journals=payload["journals"],
            daily_checkins=payload["daily_checkins"],
        )
    except Exception:
        print(json.dumps({"status": "failed"}))
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

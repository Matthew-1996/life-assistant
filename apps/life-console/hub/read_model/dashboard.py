from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class ReadModelError(RuntimeError):
    pass


DAILY_FIELDS = {
    "schema_version", "key", "date", "sleep_time", "wake_time",
    "out_of_bed_time", "ratings", "awake_in_bed", "anchors",
    "note_summary", "revision", "created_at", "updated_at",
}
JOURNAL_FIELDS = {
    "id", "date", "time", "time_precision", "title", "summary", "facts",
    "feelings", "people", "places", "themes", "tags", "planning_clues",
    "inferences", "source", "privacy", "file", "status", "weekly_reviews",
    "monthly_reviews", "amendments", "invalidated_reviews", "recorded_at",
    "withdrawn_at", "original_date", "original_time", "original_time_precision",
}


def _regular_bytes(path: Path) -> bytes:
    if path.is_symlink():
        raise ReadModelError("source invalid")
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return b""
    except OSError as error:
        raise ReadModelError("source unavailable") from error


def _json_lines(path: Path, allowed: set[str]) -> tuple[bytes, list[dict[str, Any]]]:
    raw = _regular_bytes(path)
    rows: list[dict[str, Any]] = []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ReadModelError("source invalid") from error
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ReadModelError("source invalid") from error
        if not isinstance(value, dict) or not set(value).issubset(allowed):
            raise ReadModelError("source invalid")
        rows.append(value)
    return raw, rows


def _focus(root: Path) -> tuple[bytes, dict[str, str]]:
    raw = _regular_bytes(root / "GOALS.md")
    text = raw.decode("utf-8", errors="strict")
    lines = [line.strip() for line in text.splitlines()]
    for index, line in enumerate(lines):
        if line.startswith("- 当前重点："):
            return raw, {"title": line.split("：", 1)[1].strip(), "phase_label": "进行中"}
        if line in {"## 当前重点", "# 当前重点"}:
            section: list[str] = []
            for candidate in lines[index + 1 :]:
                if candidate.startswith("## ") or candidate.startswith("# "):
                    break
                section.append(candidate)
            for candidate in section:
                if candidate.startswith("### "):
                    return raw, {
                        "title": candidate.removeprefix("### ").strip(),
                        "phase_label": "进行中",
                    }
            for candidate in section:
                if candidate.startswith("- ") and not candidate.startswith(
                    ("- 状态：", "- 阶段：", "- 日期：", "- 复盘：")
                ):
                    return raw, {
                        "title": candidate.removeprefix("- ").strip(),
                        "phase_label": "进行中",
                    }
    return raw, {"title": "", "phase_label": "等待确认"}


def _etag(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def checkin_conflict_projection(root: Path, day: str) -> tuple[int | None, dict[str, Any]]:
    _, rows = _json_lines(root / "records/daily-checkins.jsonl", DAILY_FIELDS)
    row = next((item for item in rows if item.get("date") == day), None)
    if row is None:
        return None, {}
    return row["revision"], {
        "sleep_time": row["sleep_time"],
        "wake_time": row["wake_time"],
        "out_of_bed_time": row["out_of_bed_time"],
        **row["ratings"],
        "awake_in_bed": row["awake_in_bed"],
        **row["anchors"],
    }


def build_dashboard(root: Path, *, today: date | None = None) -> dict[str, Any]:
    current = today or date.today()
    daily_raw, daily = _json_lines(root / "records/daily-checkins.jsonl", DAILY_FIELDS)
    journal_raw, journals = _json_lines(root / "journal/index.jsonl", JOURNAL_FIELDS)
    goals_raw, focus = _focus(root)

    seen: set[str] = set()
    for row in daily:
        if set(row) != DAILY_FIELDS or row.get("schema_version") != 2:
            raise ReadModelError("source invalid")
        row_date = row.get("date")
        if not isinstance(row_date, str) or row_date in seen:
            raise ReadModelError("source invalid")
        seen.add(row_date)

    by_date = {row["date"]: row for row in daily}
    latest = by_date.get(current.isoformat())
    window_dates = [current - timedelta(days=offset) for offset in range(6, -1, -1)]
    recent = [by_date.get(day.isoformat()) for day in window_dates]
    ratings = [
        {
            "date": day.isoformat(),
            **(
                row["ratings"]
                if row is not None
                else {
                    "sleep_quality": None,
                    "energy": None,
                    "mood": None,
                    "life_feeling": None,
                }
            ),
        }
        for day, row in zip(window_dates, recent)
    ]
    sleep = [
        {
            "date": day.isoformat(),
            "sleep_time": row["sleep_time"] if row is not None else None,
            "wake_time": row["wake_time"] if row is not None else None,
            "out_of_bed_time": row["out_of_bed_time"] if row is not None else None,
        }
        for day, row in zip(window_dates, recent)
    ]
    safe_journals = [
        {"date": row["date"], "title": row["title"], "summary": row["summary"]}
        for row in reversed(journals)
        if row.get("status") == "active"
    ][:10]
    anchors = latest["anchors"] if latest else {
        "wake": None, "body_light": None, "life_action": None, "wind_down": None,
    }

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "date": current.isoformat(),
        "today": {
            "focus": focus,
            "suggested_action": None,
            "anchors": anchors,
            "daily_revision": latest["revision"] if latest else None,
            "confirmations": [],
        },
        "progress": {
            "ratings": ratings,
            "sleep": sleep,
            "sample_counts": {
                "daily": sum(row is not None for row in recent),
                "missing": sum(row is None for row in recent),
            },
        },
        "records": {"recent_journals": safe_journals},
        "system": {
            "hub": "ready", "icloud": "readable", "automation": "unknown",
            "backup": "unknown", "google": "paused", "mobile": "pending",
        },
        "source_revisions": {
            "daily": _etag(daily_raw), "journal": _etag(journal_raw), "goals": _etag(goals_raw),
        },
    }

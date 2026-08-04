from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any


class CommandError(RuntimeError):
    def __init__(self, code: str, *, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class CommandRunner:
    def __init__(self, code_root: Path, data_root: Path, *, timeout: float = 2.0):
        self.code_root = code_root.resolve()
        self.data_root = data_root.resolve()
        self.timeout = timeout

    def _run(self, argv: list[str], *, stdin: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            result = subprocess.run(
                argv,
                cwd=self.code_root,
                input=json.dumps(stdin, ensure_ascii=False) if stdin is not None else None,
                text=True,
                capture_output=True,
                timeout=self.timeout,
                shell=False,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise CommandError("TOOL_TIMEOUT", retryable=True) from error
        if result.returncode != 0:
            lowered = result.stderr.lower()
            code = "REVISION_CONFLICT" if "revision" in lowered or "修订" in result.stderr else "SOURCE_INVALID"
            raise CommandError(code)
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise CommandError("SOURCE_INVALID") from error
        if not isinstance(value, dict):
            raise CommandError("SOURCE_INVALID")
        return value

    def add_journal(self, request: dict[str, Any]) -> dict[str, Any]:
        event_date = request["event_date"]
        payload = {
            "date": event_date,
            "time": request.get("event_time"),
            "time_precision": request["time_precision"],
            "title": f"{event_date} 日记",
            "raw": request["text"],
            "source": "explicit",
            "privacy": "local-only",
        }
        return self._run(
            [
                sys.executable,
                str(self.code_root / "tools/journal_manager.py"),
                "add",
                "--input",
                "-",
                "--root",
                str(self.data_root / "journal"),
            ],
            stdin=payload,
        )

    def upsert_checkin(self, day: str, request: dict[str, Any]) -> dict[str, Any]:
        field_flags = {
            "sleep_time": "--sleep-time", "wake_time": "--wake-time",
            "out_of_bed_time": "--out-of-bed-time", "sleep_quality": "--sleep-quality",
            "energy": "--energy", "mood": "--mood", "life_feeling": "--life-feeling",
            "awake_in_bed": "--awake-in-bed", "wake": "--wake",
            "body_light": "--body-light", "life_action": "--life-action",
            "wind_down": "--wind-down", "note_summary": "--note-summary",
        }
        argv = [
            sys.executable, str(self.code_root / "tools/daily_checkin.py"),
            "upsert", "--root", str(self.data_root / "records"), "--date", day,
        ]
        revision = request.get("expect_revision")
        if revision is not None:
            argv.extend(["--expect-revision", str(revision)])
        for field, value in request["fields"].items():
            if field not in field_flags:
                raise CommandError("INVALID_REQUEST")
            argv.extend([field_flags[field], str(value)])
        return self._run(argv)

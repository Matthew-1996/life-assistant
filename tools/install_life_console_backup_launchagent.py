#!/usr/bin/env python3
"""Install the six-hour Life Console cloud-to-iCloud backup LaunchAgent."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import plistlib


LABEL = "local.life-assistant.life-console-backup"


def launchagent_payload(project_root: Path) -> dict[str, object]:
    backup_root = project_root / "backups/life-console-cloud"
    return {
        "Label": LABEL,
        "ProgramArguments": [
            "/usr/bin/python3",
            str(project_root / "tools/life_console_backup_agent.py"),
            "--backup-root",
            str(backup_root),
        ],
        "WorkingDirectory": str(project_root),
        "StartInterval": 21600,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "StandardOutPath": str(backup_root / "launchagent.out.log"),
        "StandardErrorPath": str(backup_root / "launchagent.err.log"),
    }


def install(project_root: Path, launchagents_root: Path) -> Path:
    project_root = project_root.resolve()
    if not (project_root / ".life-console-online-primary").is_file():
        raise ValueError("online_primary_marker_missing")
    if not (project_root / "integrations/life-console-cloud.json").is_file():
        raise ValueError("cloud_binding_missing")
    destination = launchagents_root / f"{LABEL}.plist"
    launchagents_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_suffix(".plist.tmp")
    temporary.write_bytes(plistlib.dumps(launchagent_payload(project_root)))
    os.chmod(temporary, 0o600)
    os.replace(temporary, destination)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument(
        "--launchagents-root",
        type=Path,
        default=Path.home() / "Library/LaunchAgents",
    )
    args = parser.parse_args()
    try:
        destination = install(args.project_root, args.launchagents_root)
    except Exception:
        print("failed")
        return 2
    print(destination.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

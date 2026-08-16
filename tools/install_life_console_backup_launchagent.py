#!/usr/bin/env python3
"""Install the six-hour Life Console cloud-to-iCloud backup LaunchAgent."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import plistlib


LABEL = "local.life-assistant.life-console-backup"


def default_launcher() -> Path:
    return (
        Path.home()
        / "Library/Application Support/LifeConsole/Life Console.app"
        / "Contents/MacOS/LifeConsoleLauncher"
    )


def launchagent_payload(
    project_root: Path,
    *,
    launcher: Path,
    python_executable: Path,
) -> dict[str, object]:
    backup_root = project_root / "backups/life-console-cloud"
    return {
        "Label": LABEL,
        "ProgramArguments": [
            str(launcher),
            str(project_root / "tools/life_console_backup_agent.py"),
            "--backup-root",
            str(backup_root),
        ],
        "WorkingDirectory": str(project_root),
        "StartInterval": 21600,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "EnvironmentVariables": {
            "LIFE_CONSOLE_PYTHON": str(python_executable),
        },
        "StandardOutPath": str(backup_root / "launchagent.out.log"),
        "StandardErrorPath": str(backup_root / "launchagent.err.log"),
    }


def install(
    project_root: Path,
    launchagents_root: Path,
    *,
    launcher: Path | None = None,
    python_executable: Path = Path("/usr/bin/python3"),
) -> Path:
    project_root = project_root.resolve()
    if not (project_root / ".life-console-online-primary").is_file():
        raise ValueError("online_primary_marker_missing")
    if not (project_root / "integrations/life-console-cloud.json").is_file():
        raise ValueError("cloud_binding_missing")
    selected_launcher = (launcher or default_launcher()).expanduser().resolve()
    selected_python = python_executable.expanduser().resolve()
    if not selected_launcher.is_file() or not os.access(selected_launcher, os.X_OK):
        raise ValueError("life_console_launcher_missing")
    if not selected_python.is_file() or not os.access(selected_python, os.X_OK):
        raise ValueError("python_executable_missing")
    destination = launchagents_root / f"{LABEL}.plist"
    launchagents_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_suffix(".plist.tmp")
    temporary.write_bytes(plistlib.dumps(launchagent_payload(
        project_root,
        launcher=selected_launcher,
        python_executable=selected_python,
    )))
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
    parser.add_argument("--launcher", type=Path, default=default_launcher())
    parser.add_argument(
        "--python-executable", type=Path, default=Path("/usr/bin/python3")
    )
    args = parser.parse_args()
    try:
        destination = install(
            args.project_root,
            args.launchagents_root,
            launcher=args.launcher,
            python_executable=args.python_executable,
        )
    except Exception:
        print("failed")
        return 2
    print(destination.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

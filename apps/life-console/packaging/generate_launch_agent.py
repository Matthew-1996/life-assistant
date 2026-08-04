from __future__ import annotations

import argparse
import os
import plistlib
import stat
import sys
from pathlib import Path


LABEL = "local.life-assistant.life-console"


def app_root() -> Path:
    return Path(__file__).resolve().parents[1]


def generate(output_dir: Path, *, root: Path | None = None) -> tuple[Path, Path]:
    application = (root or app_root()).resolve()
    if not (application / "hub/server.py").is_file():
        raise ValueError("Life Console application root is invalid")
    output_dir.mkdir(parents=True, exist_ok=True)
    plist_path = output_dir / f"{LABEL}.plist"
    launcher_path = output_dir / "Open Life Console.command"
    logs = Path.home() / "Library/Logs/LifeConsole"

    plist = {
        "Label": LABEL,
        "ProgramArguments": [
            sys.executable, "-m", "hub.server", "--host", "127.0.0.1", "--port", "47321",
        ],
        "WorkingDirectory": str(application),
        "RunAtLoad": True,
        "KeepAlive": False,
        "StandardOutPath": str(logs / "hub.stdout.log"),
        "StandardErrorPath": str(logs / "hub.stderr.log"),
    }
    plist_path.write_bytes(plistlib.dumps(plist, sort_keys=True))
    launcher_path.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        "open 'http://127.0.0.1:47321/'\n",
        encoding="utf-8",
    )
    launcher_path.chmod(launcher_path.stat().st_mode | stat.S_IXUSR)
    return plist_path, launcher_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate local Life Console launch files")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--app-root", type=Path)
    args = parser.parse_args()
    try:
        plist_path, launcher_path = generate(args.output_dir, root=args.app_root)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    os.chmod(args.output_dir, 0o700)
    print(plist_path)
    print(launcher_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Create the ignored local cloud binding from a Vercel env export."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value.replace("\\n", "\n")
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    values = read_env(args.env_file)
    payload = {
        "project_url": values["VITE_SUPABASE_URL"],
        "publishable_key": values["VITE_SUPABASE_PUBLISHABLE_KEY"],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, args.output)
    print(json.dumps({"status": "configured"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

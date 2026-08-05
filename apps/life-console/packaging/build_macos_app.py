from __future__ import annotations

import argparse
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path


BUNDLE_IDENTIFIER = "local.life-assistant.life-console"
EXECUTABLE_NAME = "LifeConsoleLauncher"
SOURCE = Path(__file__).with_name("macos_life_console_launcher.c")


def bundle_info() -> dict[str, object]:
    return {
        "CFBundleDevelopmentRegion": "zh_CN",
        "CFBundleDisplayName": "Life Console",
        "CFBundleExecutable": EXECUTABLE_NAME,
        "CFBundleIdentifier": BUNDLE_IDENTIFIER,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "Life Console",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "LSMinimumSystemVersion": "13.0",
        "LSUIElement": True,
        "NSFileProviderDomainUsageDescription": "读取并更新用户选择的 iCloud 生活助手项目。",
    }


def build(
    output: Path,
    *,
    compiler: Path = Path("/usr/bin/clang"),
    signer: Path = Path("/usr/bin/codesign"),
    replace: bool = False,
) -> Path:
    if output.name != "Life Console.app":
        raise ValueError("output must be named Life Console.app")
    if not SOURCE.is_file():
        raise ValueError("launcher source is missing")
    if output.exists():
        if not replace:
            raise ValueError("output already exists; pass --replace to rebuild it")
        shutil.rmtree(output)

    contents = output / "Contents"
    executable = contents / "MacOS" / EXECUTABLE_NAME
    executable.parent.mkdir(parents=True)
    (contents / "Info.plist").write_bytes(plistlib.dumps(bundle_info(), sort_keys=True))
    subprocess.run(
        [str(compiler), "-std=c11", "-Wall", "-Wextra", "-Werror", str(SOURCE), "-o", str(executable)],
        check=True,
    )
    executable.chmod(0o755)
    subprocess.run(
        [str(signer), "--force", "--deep", "--sign", "-", str(output)],
        check=True,
    )
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the machine-local Life Console app launcher")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    try:
        built = build(args.output.expanduser().resolve(), replace=args.replace)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    os.chmod(built / "Contents/MacOS" / EXECUTABLE_NAME, 0o755)
    print(built)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

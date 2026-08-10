#!/usr/bin/env python3
"""Create a verified, dependency-free snapshot of the life-assistant project."""

from __future__ import annotations

import argparse
import hashlib
import io
import os
import re
import stat
import subprocess
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path
from typing import BinaryIO, NamedTuple, Sequence

try:
    from tools.journal_integrity import (
        JournalIntegrityError,
        inspect_journal_snapshot,
    )
except ModuleNotFoundError:  # Direct execution from tools/.
    from journal_integrity import JournalIntegrityError, inspect_journal_snapshot

try:
    from tools.phase_review import (
        PhaseReviewError,
        inspect_phase_review_snapshot,
    )
except ModuleNotFoundError:  # Direct execution from tools/.
    from phase_review import PhaseReviewError, inspect_phase_review_snapshot

try:
    from tools.journal_insights import InsightError, inspect_insight_snapshot
except ModuleNotFoundError:  # Direct execution from tools/.
    from journal_insights import InsightError, inspect_insight_snapshot

try:
    from tools.phase_actions import (
        PhaseActionError,
        inspect_phase_action_snapshot,
    )
except ModuleNotFoundError:  # Direct execution from tools/.
    from phase_actions import PhaseActionError, inspect_phase_action_snapshot


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_ROOT = "codex-生活助手"
LEGACY_GOVERNANCE_LINK = Path("需求文档（个人维护）/agent项目开发规范.md")
LEGACY_GOVERNANCE_TARGET = Path(
    "../docs/governance/agent-user-project-development-standard.md"
)
CANONICAL_GOVERNANCE = Path(
    "docs/governance/agent-user-project-development-standard.md"
)
EXCLUDED_DIRS = {
    ".git",
    ".worktrees",
    ".mypy_cache",
    ".next",
    ".nox",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    ".vinext",
    ".validator-venv",
    ".wrangler",
    "__pycache__",
    "backups",
    "dist",
    "htmlcov",
    "node_modules",
    "out",
    "venv",
}
# STATUS.md is a derived snapshot of the sources and the latest backup. Excluding it
# prevents a status -> backup -> status loop; it is rebuilt after restore.
EXCLUDED_FILES = {
    ".coverage",
    ".DS_Store",
    ".daily-checkins.lock",
    ".journal.lock",
    ".phase-actions.lock",
    ".phase-reviews.lock",
    ".weekly-reviews.lock",
    "STATUS.md",
}
EXCLUDED_SUFFIXES = {".pyc", ".pyo"}
SAFE_ENV_TEMPLATE_NAMES = {
    ".env.example",
    ".env.sample",
    ".env.template",
}
SECRET_FILE_NAMES = {
    ".netrc",
    ".npmrc",
    ".pypirc",
    "credentials",
    "credentials.ini",
    "credentials.json",
    "credentials.toml",
    "credentials.yaml",
    "credentials.yml",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
}
SECRET_FILE_SUFFIXES = {".key", ".p12", ".pfx"}
PRIVATE_KEY_HEADERS = (
    b"-----BEGIN " + b"PRIVATE" + b" KEY-----",
    b"-----BEGIN ENCRYPTED " + b"PRIVATE" + b" KEY-----",
    b"-----BEGIN RSA " + b"PRIVATE" + b" KEY-----",
    b"-----BEGIN EC " + b"PRIVATE" + b" KEY-----",
    b"-----BEGIN DSA " + b"PRIVATE" + b" KEY-----",
    b"-----BEGIN OPENSSH " + b"PRIVATE" + b" KEY-----",
    b"-----BEGIN PGP " + b"PRIVATE" + b" KEY BLOCK-----",
)
HIGH_RISK_CONTENT_PATTERNS = (
    re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(rb"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(rb"(?i)authorization:\s*bearer\s+[A-Za-z0-9._-]{16,}"),
)


class SourceDriftError(RuntimeError):
    """Raised when the project cannot be proven stable during backup creation."""


class SnapshotFile(NamedTuple):
    """Exact source bytes and identity captured before ZIP construction."""

    relative: Path
    data: bytes
    digest: str
    identity: tuple[int, int, int, int, int, int]
    mode: int
    contains_secret: bool


def legacy_governance_link_is_valid(root: Path) -> bool:
    link = root / LEGACY_GOVERNANCE_LINK
    canonical = root / CANONICAL_GOVERNANCE
    try:
        target = link.readlink()
    except OSError:
        return False
    return (
        target == LEGACY_GOVERNANCE_TARGET
        and not canonical.is_symlink()
        and canonical.is_file()
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project_files(root: Path = ROOT) -> list[Path]:
    result: list[Path] = []
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in relative.parts):
            continue
        if relative == LEGACY_GOVERNANCE_LINK:
            if not legacy_governance_link_is_valid(root):
                raise SourceDriftError
            # ZIP recovery intentionally accepts regular files only. The canonical
            # governance body is archived; this local compatibility link is
            # validated here and recreated from PROJECT_CONTEXT.md when needed.
            continue
        if not path.is_file() or path.name in EXCLUDED_FILES:
            continue
        if path.suffix.lower() in EXCLUDED_SUFFIXES:
            continue
        result.append(path)
    return sorted(result, key=lambda item: item.relative_to(root).as_posix())


def _looks_like_secret_filename(path: Path) -> bool:
    name = path.name.lower()
    if name in SAFE_ENV_TEMPLATE_NAMES:
        return False
    if name == ".env" or name.startswith(".env."):
        return True
    if name in SECRET_FILE_NAMES or path.suffix.lower() in SECRET_FILE_SUFFIXES:
        return True
    return False


def _contains_high_risk_secret(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            _, contains_secret = _hash_and_scan_stream(handle)
            return contains_secret
    except OSError:
        # The archive creation will fail rather than silently skipping unreadable files.
        return False


def _hash_and_scan_stream(handle: BinaryIO) -> tuple[str, bool]:
    digest = hashlib.sha256()
    overlap = b""
    contains_secret = False
    while chunk := handle.read(1024 * 1024):
        digest.update(chunk)
        sample = overlap + chunk
        if any(header in sample for header in PRIVATE_KEY_HEADERS) or any(
            pattern.search(sample) for pattern in HIGH_RISK_CONTENT_PATTERNS
        ):
            contains_secret = True
        overlap = sample[-256:]
    return digest.hexdigest(), contains_secret


def _source_identity(metadata: os.stat_result) -> tuple[int, int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        stat.S_IFMT(metadata.st_mode),
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _read_snapshot_file(path: Path, root: Path) -> SnapshotFile:
    """Read one stable regular file without trusting a path that changed mid-read."""

    try:
        relative = path.relative_to(root)
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode):
            raise SourceDriftError
        with path.open("rb") as handle:
            opened = os.fstat(handle.fileno())
            if _source_identity(opened) != _source_identity(before):
                raise SourceDriftError
            data = handle.read()
            after_read = os.fstat(handle.fileno())
        after_path = path.lstat()
    except (OSError, ValueError) as exc:
        raise SourceDriftError from exc

    identity = _source_identity(before)
    if (
        _source_identity(after_read) != identity
        or _source_identity(after_path) != identity
        or len(data) != before.st_size
    ):
        raise SourceDriftError

    digest, contains_secret = _hash_and_scan_stream(io.BytesIO(data))
    return SnapshotFile(
        relative=relative,
        data=data,
        digest=digest,
        identity=identity,
        mode=before.st_mode,
        contains_secret=contains_secret,
    )


def _capture_project_snapshot(root: Path) -> tuple[SnapshotFile, ...]:
    files = project_files(root)
    relatives = tuple(path.relative_to(root) for path in files)
    if len(set(relatives)) != len(relatives):  # pragma: no cover - defensive guard
        raise SourceDriftError
    return tuple(_read_snapshot_file(path, root) for path in files)


def _assert_snapshot_is_current(
    snapshot: Sequence[SnapshotFile], root: Path
) -> None:
    """Fail unless the live project still exactly matches the captured snapshot."""

    expected = {item.relative: item for item in snapshot}
    try:
        current_files = project_files(root)
        current = {path.relative_to(root): path for path in current_files}
    except (OSError, ValueError) as exc:
        raise SourceDriftError from exc
    if len(current) != len(current_files) or set(current) != set(expected):
        raise SourceDriftError

    for relative in sorted(expected, key=lambda item: item.as_posix()):
        original = expected[relative]
        live = _read_snapshot_file(current[relative], root)
        if (
            live.identity != original.identity
            or live.mode != original.mode
            or live.digest != original.digest
            or live.data != original.data
        ):
            raise SourceDriftError

    # Recheck the complete path set and identities after the byte-reading pass so
    # a file changed while another member was being compared is also rejected.
    try:
        final_files = project_files(root)
        final = {path.relative_to(root): path for path in final_files}
    except (OSError, ValueError) as exc:
        raise SourceDriftError from exc
    if len(final) != len(final_files) or set(final) != set(expected):
        raise SourceDriftError
    for relative, original in expected.items():
        try:
            metadata = final[relative].lstat()
        except OSError as exc:
            raise SourceDriftError from exc
        if (
            not stat.S_ISREG(metadata.st_mode)
            or _source_identity(metadata) != original.identity
            or metadata.st_mode != original.mode
        ):
            raise SourceDriftError


def _snapshot_secret_paths(snapshot: Sequence[SnapshotFile]) -> list[Path]:
    return sorted(
        {
            item.relative
            for item in snapshot
            if _looks_like_secret_filename(item.relative) or item.contains_secret
        },
        key=lambda item: item.as_posix(),
    )


def _snapshot_has_private_journal(snapshot: Sequence[SnapshotFile]) -> bool:
    return any(
        (
            item.relative.parts[:2]
            in {("journal", "entries"), ("journal", "reviews")}
            and bool(item.data)
        )
        or (
            item.relative.as_posix() == "journal/index.jsonl"
            and bool(item.data)
        )
        for item in snapshot
    )


def _snapshot_has_nonempty_record(
    snapshot: Sequence[SnapshotFile], relative_path: str
) -> bool:
    return any(
        item.relative.as_posix() == relative_path and bool(item.data.strip())
        for item in snapshot
    )


def _snapshot_manifest(snapshot: Sequence[SnapshotFile]) -> str:
    return "".join(
        f"{item.digest}  {item.relative.as_posix()}\n" for item in snapshot
    )


def _write_snapshot_archive(
    archive_path: Path, snapshot: Sequence[SnapshotFile]
) -> None:
    with zipfile.ZipFile(
        archive_path, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for item in snapshot:
            info = zipfile.ZipInfo(
                f"{ARCHIVE_ROOT}/{item.relative.as_posix()}",
                date_time=(1980, 1, 1, 0, 0, 0),
            )
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | stat.S_IMODE(item.mode)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(
                info,
                item.data,
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )


def _archive_manifest_and_secret_paths(
    archive_path: Path,
    files: Sequence[Path],
    root: Path,
) -> tuple[str, list[Path]]:
    manifest_lines: list[str] = []
    flagged: list[Path] = []
    with zipfile.ZipFile(archive_path, mode="r") as archive:
        for source_path in files:
            relative = source_path.relative_to(root)
            member_name = f"{ARCHIVE_ROOT}/{relative.as_posix()}"
            with archive.open(member_name, "r") as member:
                archived_hash, contains_secret = _hash_and_scan_stream(member)
            manifest_lines.append(f"{archived_hash}  {relative.as_posix()}\n")
            if _looks_like_secret_filename(relative) or contains_secret:
                flagged.append(relative)
    return "".join(manifest_lines), sorted(
        set(flagged), key=lambda item: item.as_posix()
    )


def secret_preflight(files: Sequence[Path], root: Path = ROOT) -> list[Path]:
    """Return high-confidence credential/private-key paths without reading them out."""

    flagged: list[Path] = []
    for path in files:
        if _looks_like_secret_filename(path) or _contains_high_risk_secret(path):
            flagged.append(path.relative_to(root))
    return sorted(set(flagged), key=lambda item: item.as_posix())


def private_journal_files(files: Sequence[Path], root: Path = ROOT) -> list[Path]:
    result: list[Path] = []
    for path in files:
        relative = path.relative_to(root)
        in_private_tree = relative.parts[:2] in {
            ("journal", "entries"),
            ("journal", "reviews"),
        }
        is_nonempty_index = (
            relative.as_posix() == "journal/index.jsonl" and path.stat().st_size > 0
        )
        if (in_private_tree and path.stat().st_size > 0) or is_nonempty_index:
            result.append(path)
    return result


def private_daily_checkin_files(files: Sequence[Path], root: Path = ROOT) -> list[Path]:
    result: list[Path] = []
    for path in files:
        if path.relative_to(root).as_posix() != "records/daily-checkins.jsonl":
            continue
        try:
            has_content = bool(path.read_bytes().strip())
        except OSError:
            has_content = True
        if has_content:
            result.append(path)
    return result


def private_weekly_review_files(files: Sequence[Path], root: Path = ROOT) -> list[Path]:
    """Return a non-empty optional weekly-review ledger included in the snapshot."""

    result: list[Path] = []
    for path in files:
        if path.relative_to(root).as_posix() != "records/weekly-reviews.jsonl":
            continue
        try:
            has_content = bool(path.read_bytes().strip())
        except OSError:
            has_content = True
        if has_content:
            result.append(path)
    return result


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="创建生活助手项目的完整便携快照")
    parser.add_argument("--date", default=date.today().isoformat(), help="快照日期，格式 YYYY-MM-DD")
    parser.add_argument(
        "--revision",
        help="同一天需要保留多个快照时使用的修订标识，例如 r2",
    )
    parser.add_argument("--force", action="store_true", help="覆盖同名的已有快照")
    return parser.parse_args(argv)


def main(
    argv: Sequence[str] | None = None,
    *,
    root: Path = ROOT,
    run_validation: bool = True,
) -> int:
    args = parse_args(argv)
    try:
        date.fromisoformat(args.date)
    except ValueError:
        print("ERROR: --date 必须是有效的 YYYY-MM-DD", file=sys.stderr)
        return 2
    if args.revision and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.revision):
        print("ERROR: --revision 只接受小写字母、数字和单个连字符分隔", file=sys.stderr)
        return 2

    print(
        "NOTICE: 本快照将包含个人生活助手项目数据；标准 ZIP 未设置独立密码，"
        "请仅保存到受你控制的位置。"
    )

    if run_validation:
        validation = subprocess.run(
            [sys.executable, str(root / "tools" / "validate_project.py")],
            cwd=root,
            check=False,
        )
        if validation.returncode:
            print("ERROR: 项目校验未通过，未创建备份", file=sys.stderr)
            return validation.returncode

    backup_dir = root / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stem = f"生活助手-完整备份-{args.date}"
    if args.revision:
        stem += f"-{args.revision}"
    archive_path = backup_dir / f"{stem}.zip"
    archive_hash_path = backup_dir / f"{stem}.zip.sha256"
    file_hash_path = backup_dir / f"{stem}.files.sha256"
    outputs = (archive_path, archive_hash_path, file_hash_path)
    existing = [path.name for path in outputs if path.exists()]
    if existing and not args.force:
        print("ERROR: 以下快照文件已存在；请换日期，或确认后使用 --force：", file=sys.stderr)
        for name in existing:
            print(f"- {name}", file=sys.stderr)
        return 2

    try:
        snapshot = _capture_project_snapshot(root)
    except SourceDriftError:
        print(
            "ERROR: 项目源文件在备份过程中发生变化；未发布备份，请重试。",
            file=sys.stderr,
        )
        return 4

    # All structural checks below consume the exact bytes already captured for
    # this backup. They must not reopen live ledgers, otherwise a concurrent
    # change could make the validated data differ from the archived data.
    snapshot_bytes = {
        item.relative.as_posix(): item.data for item in snapshot
    }

    try:
        inspect_journal_snapshot(snapshot_bytes)
    except JournalIntegrityError:
        print(
            "ERROR: 固定备份字节中的日记索引与原文不完整；未发布备份。",
            file=sys.stderr,
        )
        return 4

    try:
        inspect_phase_review_snapshot(snapshot_bytes)
    except PhaseReviewError:
        print(
            "ERROR: 固定备份字节中的阶段复盘台账结构无效；未发布备份。",
            file=sys.stderr,
        )
        return 4

    try:
        inspect_insight_snapshot(snapshot_bytes)
    except InsightError:
        print(
            "ERROR: 固定备份字节中的候选认识确认台账结构无效；未发布备份。",
            file=sys.stderr,
        )
        return 4

    try:
        inspect_phase_action_snapshot(snapshot_bytes)
    except PhaseActionError:
        print(
            "ERROR: 固定备份字节中的阶段动作台账结构无效；未发布备份。",
            file=sys.stderr,
        )
        return 4

    flagged = _snapshot_secret_paths(snapshot)
    if flagged:
        print(
            "ERROR: 秘密预检发现高风险凭据或私钥文件，未创建备份：",
            file=sys.stderr,
        )
        for relative in flagged:
            print(f"- {relative.as_posix()}", file=sys.stderr)
        print(
            "请先将凭据移出项目并轮换已暴露的秘密；不要仅改文件名绕过检查。",
            file=sys.stderr,
        )
        return 3

    if _snapshot_has_private_journal(snapshot):
        print(
            "NOTICE: 检测到实际日记或回顾；本 ZIP 还将包含这些更敏感的原文或衍生内容，"
            "请按 journal/PRIVACY.md 管理 iCloud 与历史副本。"
        )
    if _snapshot_has_nonempty_record(snapshot, "records/daily-checkins.jsonl"):
        print(
            "NOTICE: 检测到实际每日状态记录；本 ZIP 将包含睡眠、精力、情绪等结构化生活数据，"
            "请按 records/README.md 管理 iCloud 与历史副本。"
        )
    if _snapshot_has_nonempty_record(snapshot, "records/weekly-reviews.jsonl"):
        print(
            "NOTICE: 检测到实际每周复盘记录；本 ZIP 将包含一周改善、反复摩擦、"
            "下周实验和目标决定等结构化生活总结，请按 records/README.md 管理 iCloud 与历史副本。"
        )
    if _snapshot_has_nonempty_record(snapshot, "records/phase-reviews.jsonl"):
        print(
            "NOTICE: 检测到实际阶段复盘记录；本 ZIP 将包含恢复变化、主要摩擦、"
            "整理/回访节奏与后续方向等结构化生活总结，请按 records/README.md 管理 iCloud 与历史副本。"
        )
    if _snapshot_has_nonempty_record(snapshot, "journal/insight-decisions.jsonl"):
        print(
            "NOTICE: 检测到日记候选认识确认台账；本 ZIP 可能包含候选摘要、"
            "精确长期文件提案及其确认状态，但不因“接受”自动改写长期记忆"
            "或目标。请按 journal/PRIVACY.md 管理副本。"
        )
    if _snapshot_has_nonempty_record(snapshot, "records/phase-actions.jsonl"):
        print(
            "NOTICE: 检测到阶段动作台账；本 ZIP 将包含阶段动作的期望值与"
            "执行状态，请按 records/README.md 管理 iCloud 与历史副本。"
        )
    temporary_paths: list[Path] = []
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{stem}-", suffix=".tmp", dir=backup_dir, delete=False
        ) as temporary:
            temporary_archive_path = Path(temporary.name)
        temporary_paths.append(temporary_archive_path)
        with tempfile.NamedTemporaryFile(
            prefix=f".{stem}-manifest-",
            suffix=".tmp",
            dir=backup_dir,
            delete=False,
        ) as temporary:
            temporary_manifest_path = Path(temporary.name)
        temporary_paths.append(temporary_manifest_path)
        with tempfile.NamedTemporaryFile(
            prefix=f".{stem}-archive-hash-",
            suffix=".tmp",
            dir=backup_dir,
            delete=False,
        ) as temporary:
            temporary_archive_hash_path = Path(temporary.name)
        temporary_paths.append(temporary_archive_hash_path)

        _write_snapshot_archive(temporary_archive_path, snapshot)
        manifest = _snapshot_manifest(snapshot)
        archived_manifest, archived_flagged = _archive_manifest_and_secret_paths(
            temporary_archive_path,
            [root / item.relative for item in snapshot],
            root,
        )
        if archived_manifest != manifest:
            print(
                "ERROR: 临时 ZIP 与固定源快照不一致，未发布备份。",
                file=sys.stderr,
            )
            return 4
        if archived_flagged:
            print(
                "ERROR: 已写入临时 ZIP 的精确字节包含高风险凭据或私钥，"
                "未发布备份。",
                file=sys.stderr,
            )
            return 3

        temporary_manifest_path.write_text(manifest, encoding="utf-8")
        temporary_archive_hash_path.write_text(
            f"{sha256(temporary_archive_path)}  {archive_path.name}\n",
            encoding="utf-8",
        )

        try:
            _assert_snapshot_is_current(snapshot, root)
        except SourceDriftError:
            print(
                "ERROR: 项目源文件在备份过程中发生变化；未发布备份，请重试。",
                file=sys.stderr,
            )
            return 4

        temporary_archive_path.replace(archive_path)
        temporary_paths.remove(temporary_archive_path)
        temporary_manifest_path.replace(file_hash_path)
        temporary_paths.remove(temporary_manifest_path)
        temporary_archive_hash_path.replace(archive_hash_path)
        temporary_paths.remove(temporary_archive_hash_path)
    finally:
        for temporary_path in temporary_paths:
            temporary_path.unlink(missing_ok=True)

    print(f"PASS: 已创建 {archive_path.relative_to(root)}")
    print(f"- 项目文件：{len(snapshot)} 个")
    print(f"- 文件清单：{file_hash_path.relative_to(root)}")
    print(f"- ZIP 校验和：{archive_hash_path.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

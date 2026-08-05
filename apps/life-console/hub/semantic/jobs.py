"""无原文、可恢复的语义整理作业状态与审计（本地私有）。

作业记录只允许保存：job_id、journal_id、来源指纹、provider、model、提示词版本、
状态、尝试次数、时间、结果指纹和通用失败码。严禁保存日记原文、模型完整响应、
标题/摘要正文、API Key 或用户秘密。

作业文件位于 ``journal/.operations/semantic-jobs/<job_id>.json``（原子写入），
可在 Hub 重启后恢复。审计追加到 ``journal/enrichment-audit.jsonl``。
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .preview import ALLOWED_MODELS, MAX_RETRIES, PROVIDER

JOBS_DIRNAME = "semantic-jobs"
AUDIT_FILENAME = "enrichment-audit.jsonl"

STATUSES = {"queued", "running", "succeeded", "failed"}
FAILURE_CODES = {"PROVIDER_UNAVAILABLE", "MODEL_OUTPUT_INVALID", "SOURCE_CHANGED"}

# 作业记录允许的字段白名单；任何其他键都拒绝写入或加载。
_JOB_FIELDS = {
    "schema_version",
    "job_id",
    "journal_id",
    "source_fingerprint",
    "provider",
    "model",
    "prompt_version",
    "authorization_version",
    "status",
    "attempts",
    "max_retries",
    "failure_code",
    "result_fingerprint",
    "created_at",
    "updated_at",
}
_PUBLIC_FIELDS = (
    "schema_version",
    "job_id",
    "journal_id",
    "provider",
    "model",
    "prompt_version",
    "status",
    "attempts",
    "max_retries",
    "failure_code",
    "updated_at",
)


class JobError(RuntimeError):
    pass


class JobNotFound(JobError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _jobs_dir(journal_root: Path) -> Path:
    return journal_root / ".operations" / JOBS_DIRNAME


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            tmp_name = handle.name
        os.replace(tmp_name, path)
    finally:
        if tmp_name and os.path.exists(tmp_name):
            os.unlink(tmp_name)


def _validate(job: dict[str, Any]) -> dict[str, Any]:
    if set(job).difference(_JOB_FIELDS):
        raise JobError("作业记录包含不允许的字段")
    if job.get("schema_version") != 1:
        raise JobError("作业 schema 版本不受支持")
    if not isinstance(job.get("job_id"), str) or not job["job_id"]:
        raise JobError("作业缺少 job_id")
    if not isinstance(job.get("journal_id"), str) or not job["journal_id"]:
        raise JobError("作业缺少 journal_id")
    if job.get("provider") != PROVIDER:
        raise JobError("作业 provider 非法")
    if job.get("model") not in ALLOWED_MODELS:
        raise JobError("作业 model 不在白名单内")
    if job.get("status") not in STATUSES:
        raise JobError("作业状态非法")
    attempts = job.get("attempts")
    if not isinstance(attempts, int) or isinstance(attempts, bool) or attempts < 0:
        raise JobError("作业尝试次数非法")
    failure = job.get("failure_code")
    if failure is not None and failure not in FAILURE_CODES:
        raise JobError("作业失败码非法")
    return job


def public_view(job: dict[str, Any]) -> dict[str, Any]:
    """返回不含来源/结果指纹与授权版本的对外状态投影。"""

    view = {field: job[field] for field in _PUBLIC_FIELDS if field in job}
    view.setdefault("failure_code", job.get("failure_code"))
    return view


def create_job(
    journal_root: Path,
    *,
    job_id: str,
    journal_id: str,
    source_fingerprint: str,
    model: str,
    prompt_version: str,
    authorization_version: str,
    max_retries: int = MAX_RETRIES,
) -> dict[str, Any]:
    """幂等创建一个 queued 作业；同 job_id 已存在时直接返回现有作业。"""

    existing = _try_load(journal_root, job_id)
    if existing is not None:
        return existing
    timestamp = _now()
    job = _validate(
        {
            "schema_version": 1,
            "job_id": job_id,
            "journal_id": journal_id,
            "source_fingerprint": source_fingerprint,
            "provider": PROVIDER,
            "model": model,
            "prompt_version": prompt_version,
            "authorization_version": authorization_version,
            "status": "queued",
            "attempts": 0,
            "max_retries": max_retries,
            "failure_code": None,
            "result_fingerprint": None,
            "created_at": timestamp,
            "updated_at": timestamp,
        }
    )
    _persist(journal_root, job)
    _audit(journal_root, job, event="created")
    return job


def _persist(journal_root: Path, job: dict[str, Any]) -> None:
    path = _jobs_dir(journal_root) / f"{job['job_id']}.json"
    _atomic_write(path, json.dumps(job, ensure_ascii=False, sort_keys=True, indent=2))


def _try_load(journal_root: Path, job_id: str) -> dict[str, Any] | None:
    path = _jobs_dir(journal_root) / f"{job_id}.json"
    if not path.exists() or path.is_symlink():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise JobError("作业记录损坏") from error
    if not isinstance(parsed, dict):
        raise JobError("作业记录结构异常")
    return _validate(parsed)


def load_job(journal_root: Path, job_id: str) -> dict[str, Any]:
    job = _try_load(journal_root, job_id)
    if job is None:
        raise JobNotFound("作业不存在")
    return job


def update_job(
    journal_root: Path,
    job_id: str,
    *,
    status: str,
    attempts: int | None = None,
    failure_code: str | None = None,
    result_fingerprint: str | None = None,
    event: str,
) -> dict[str, Any]:
    job = load_job(journal_root, job_id)
    job["status"] = status
    if attempts is not None:
        job["attempts"] = attempts
    job["failure_code"] = failure_code
    if result_fingerprint is not None:
        job["result_fingerprint"] = result_fingerprint
    job["updated_at"] = _now()
    _validate(job)
    _persist(journal_root, job)
    _audit(journal_root, job, event=event)
    return job


def reset_for_retry(journal_root: Path, job_id: str) -> dict[str, Any]:
    """把一个 failed 作业重置回 queued，供用户主动发起新一轮重试。

    用户主动重试是一次全新机会：尝试次数归零，让 worker 重新按 max_retries
    退避；来源指纹保留（提交/重试前仍会核对），失败码清空。
    """

    job = load_job(journal_root, job_id)
    if job["status"] != "failed":
        raise JobError("只能重试失败的作业")
    job["status"] = "queued"
    job["attempts"] = 0
    job["failure_code"] = None
    job["updated_at"] = _now()
    _validate(job)
    _persist(journal_root, job)
    _audit(journal_root, job, event="retry_requested")
    return job


def iter_recoverable(journal_root: Path) -> Iterable[dict[str, Any]]:
    """按创建时间列出 queued/running 作业，供 Hub 重启后恢复。"""

    directory = _jobs_dir(journal_root)
    if not directory.exists():
        return []
    jobs: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        if path.is_symlink():
            continue
        job = _try_load(journal_root, path.stem)
        if job is not None and job["status"] in {"queued", "running"}:
            jobs.append(job)
    jobs.sort(key=lambda item: (item.get("created_at", ""), item.get("job_id", "")))
    return jobs


def _audit(journal_root: Path, job: dict[str, Any], *, event: str) -> None:
    """追加一行无原文、无正文的审计记录。"""

    record = {
        "event": event,
        "job_id": job["job_id"],
        "journal_id": job["journal_id"],
        "source_fingerprint": job.get("source_fingerprint"),
        "result_fingerprint": job.get("result_fingerprint"),
        "provider": job["provider"],
        "model": job["model"],
        "prompt_version": job["prompt_version"],
        "status": job["status"],
        "attempts": job["attempts"],
        "failure_code": job.get("failure_code"),
        "at": job["updated_at"],
    }
    path = journal_root / AUDIT_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())

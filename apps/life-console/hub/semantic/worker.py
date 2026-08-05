"""单并发、限时、退避的语义整理 worker（写回只经 journal_manager amend）。

流程（每个作业）：
1. 重新读取来源并核对指纹仍一致（否则 SOURCE_CHANGED，保留本地记录）。
2. 读取 macOS Keychain 中的 Key（或测试注入 transport），只请求 allowlist。
3. 严格校验模型 JSON；空/非 JSON/越界/429/5xx/超时都是通用可重试失败。
4. 合并用户明确字段与模型候选、别名归一、强制空 planning_clues/inferences。
5. amend 前再次核对来源指纹；通过后经 ``journal_manager.py amend --input -``
   一次传入完整轻量索引；raw 永不传给 amend。
6. 只有 amend 成功且来源仍一致才写审计成功；否则保留失败/漂移状态。

模型不能直接访问文件、工具或 shell；worker 是唯一的受控执行者。
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping

from . import jobs
from .aliases import load_aliases
from .deepseek_client import ProviderError, Transport, request_enrichment
from .keychain import KeyUnavailable, load_api_key
from .schema import EnrichmentValidationError, merge_enrichment, parse_model_output
from .source import SourceChanged, SourceUnavailable, assert_fingerprint

# 用户明确通过表单填写、模型不得覆盖/删除的字段来源。当前简洁表单固定填写
# facts/feelings（由正文派生）与用户直接填的 people/places/themes/tags，
# 具体锁定集合由 Hub 在创建作业时决定；worker 从作业外传入。


def _result_fingerprint(merged: Mapping[str, Any]) -> str:
    serialized = json.dumps(merged, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _amend(code_root: Path, journal_root: Path, journal_id: str, merged: dict[str, Any], note: str) -> dict[str, Any]:
    payload = {
        "id": journal_id,
        "note": note,
        "privacy": "local-only",
        **merged,
    }
    result = subprocess.run(
        [
            sys.executable,
            str(code_root / "tools/journal_manager.py"),
            "amend",
            "--input",
            "-",
            "--root",
            str(journal_root),
        ],
        cwd=str(code_root),
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=15.0,
        shell=False,
        check=False,
    )
    if result.returncode != 0:
        raise EnrichmentValidationError("写回失败", code="MODEL_OUTPUT_INVALID")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise EnrichmentValidationError("写回结果无法解析", code="MODEL_OUTPUT_INVALID") from error


def process_once(
    *,
    code_root: Path,
    journal_root: Path,
    job: Mapping[str, Any],
    user_locked_fields: tuple[str, ...] = (),
    transport: Transport | None = None,
    note: str = "DeepSeek 语义整理补全轻量索引（原文与时间不变）。",
) -> dict[str, Any]:
    """处理一个作业到成功或一次失败；返回更新后的作业。单个作业内不重试。"""

    job_id = job["job_id"]
    journal_id = job["journal_id"]
    expected = job["source_fingerprint"]
    attempts = int(job["attempts"]) + 1
    jobs.update_job(journal_root, job_id, status="running", attempts=attempts, event="running")

    try:
        source = assert_fingerprint(journal_root, journal_id, expected)
    except (SourceChanged, SourceUnavailable) as error:
        code = "SOURCE_CHANGED" if isinstance(error, SourceChanged) else "MODEL_OUTPUT_INVALID"
        return jobs.update_job(
            journal_root, job_id, status="failed", failure_code=code, event="failed"
        )

    try:
        provider_key: str | None = None
        if transport is None:
            provider_key = load_api_key()
        content = request_enrichment(
            raw_text=source["raw"],
            model=job["model"],
            credential=provider_key,
            transport=transport,
        )
    except (ProviderError, KeyUnavailable):
        return jobs.update_job(
            journal_root, job_id, status="failed",
            failure_code="PROVIDER_UNAVAILABLE", event="failed",
        )

    try:
        candidate = parse_model_output(content)
        aliases = load_aliases(journal_root)
        merged = merge_enrichment(
            source["record"],
            candidate,
            user_locked_fields=user_locked_fields,
            aliases=aliases,
        )
    except EnrichmentValidationError:
        return jobs.update_job(
            journal_root, job_id, status="failed",
            failure_code="MODEL_OUTPUT_INVALID", event="failed",
        )

    # amend 前最后一次核对来源指纹，避免发送与写回之间的漂移。
    try:
        assert_fingerprint(journal_root, journal_id, expected)
    except (SourceChanged, SourceUnavailable) as error:
        code = "SOURCE_CHANGED" if isinstance(error, SourceChanged) else "MODEL_OUTPUT_INVALID"
        return jobs.update_job(
            journal_root, job_id, status="failed", failure_code=code, event="failed"
        )

    try:
        _amend(code_root, journal_root, journal_id, merged, note)
    except EnrichmentValidationError:
        return jobs.update_job(
            journal_root, job_id, status="failed",
            failure_code="MODEL_OUTPUT_INVALID", event="failed",
        )

    return jobs.update_job(
        journal_root, job_id, status="succeeded",
        failure_code=None, result_fingerprint=_result_fingerprint(merged),
        event="succeeded",
    )


def run_with_retry(
    *,
    code_root: Path,
    journal_root: Path,
    job: Mapping[str, Any],
    user_locked_fields: tuple[str, ...] = (),
    transport: Transport | None = None,
    backoff_base: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """按作业的 max_retries 做有限退避重试；SOURCE_CHANGED 不重试。"""

    current = dict(job)
    max_retries = int(current["max_retries"])
    total_attempts = max_retries + 1
    for attempt in range(total_attempts):
        current = jobs.load_job(journal_root, current["job_id"])
        if int(current["attempts"]) >= total_attempts:
            break
        updated = process_once(
            code_root=code_root,
            journal_root=journal_root,
            job=current,
            user_locked_fields=user_locked_fields,
            transport=transport,
        )
        if updated["status"] == "succeeded":
            return updated
        if updated.get("failure_code") == "SOURCE_CHANGED":
            return updated
        current = updated
        if attempt < total_attempts - 1:
            sleep(backoff_base * (2 ** attempt))
    return current


class SingleConcurrencyWorker:
    """串行处理作业的最小 worker；同一时间只处理一个作业。

    Hub 在写入作业后调用 ``submit``；worker 用单一后台线程与队列锁保证单并发，
    并可在启动时 ``recover`` 未完成作业。
    """

    def __init__(
        self,
        *,
        code_root: Path,
        journal_root: Path,
        user_locked_for: Callable[[Mapping[str, Any]], tuple[str, ...]] | None = None,
        transport: Transport | None = None,
    ):
        self.code_root = code_root
        self.journal_root = journal_root
        self._transport = transport
        self._user_locked_for = user_locked_for or (lambda _job: ())
        self._lock = threading.Lock()

    def process(self, job: Mapping[str, Any]) -> dict[str, Any]:
        # 串行锁保证单并发：同一进程内任何时刻只有一个作业在跑。
        with self._lock:
            return run_with_retry(
                code_root=self.code_root,
                journal_root=self.journal_root,
                job=job,
                user_locked_fields=self._user_locked_for(job),
                transport=self._transport,
            )

    def recover(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for job in jobs.iter_recoverable(self.journal_root):
            results.append(self.process(job))
        return results

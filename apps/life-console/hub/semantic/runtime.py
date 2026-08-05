"""Hub 侧语义整理编排：预览 token、提交、状态与重试（受控执行）。

本模块把 D1 的预览/合并与 D2 的作业/worker 串起来，供 ``server.py`` 的四个
``journal-enrichments`` 路由调用。它保存短时预览 token（绑定来源指纹与范围），
在提交/重试前重新核对来源指纹，并把实际发送交给单并发 worker。

授权门控：``authorization_version`` 为 None 时，预览仍可离线生成（它是用户查看
发送范围、决定是否授权的界面），但提交一律拒绝——没有用户授权就绝不外发。
"""

from __future__ import annotations

import hashlib
import secrets
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from . import jobs
from .deepseek_client import Transport
from .preview import build_preview
from .schema import EnrichmentValidationError
from .source import assert_fingerprint, read_source
from .worker import SingleConcurrencyWorker

PREVIEW_TTL_MINUTES = 10
# 当前 Hub 不锁定任何字段：合并规则对列表是并集去重（只补充、不删除/覆盖），
# 标题/摘要允许模型改进。用户明确列表因此不会被删除或覆盖。
DEFAULT_LOCKED_FIELDS: tuple[str, ...] = ()


class PreviewExpired(EnrichmentValidationError):
    def __init__(self, message: str = "预览已过期或不存在"):
        super().__init__(message, code="PREVIEW_EXPIRED")


class NotAuthorized(EnrichmentValidationError):
    def __init__(self, message: str = "云端整理尚未获得授权"):
        super().__init__(message, code="INVALID_REQUEST")


class EnrichmentRuntime:
    def __init__(
        self,
        *,
        code_root: Path,
        journal_root: Path,
        authorization_version: str | None = None,
        transport: Transport | None = None,
        synchronous: bool = False,
    ):
        self.code_root = code_root
        self.journal_root = journal_root
        self.authorization_version = authorization_version
        self._synchronous = synchronous
        self._previews: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._worker = SingleConcurrencyWorker(
            code_root=code_root,
            journal_root=journal_root,
            user_locked_for=lambda _job: DEFAULT_LOCKED_FIELDS,
            transport=transport,
        )

    # -- preview ---------------------------------------------------------
    def mint_preview(self, journal_id: str, model: Any = None) -> dict[str, Any]:
        """离线读取来源并生成预览与短时 token；不联网。"""

        source = read_source(self.journal_root, journal_id)
        auth_version = self.authorization_version or "pending"
        payload = build_preview(
            source["record"],
            model=model,
            authorization_version=auth_version,
        )
        token = f"enrich_{secrets.token_urlsafe(24)}"
        expires = datetime.now(timezone.utc) + timedelta(minutes=PREVIEW_TTL_MINUTES)
        binding = {
            "journal_id": journal_id,
            "model": payload["model"],
            "prompt_version": payload["prompt_version"],
            "authorization_version": auth_version,
            "max_retries": payload["max_retries"],
            "writable_fields": payload["writable_fields"],
            "source_fingerprint": source["fingerprint"],
            "expires_at": expires,
        }
        with self._lock:
            self._previews[token] = binding
        response = {
            "schema_version": 1,
            "preview_token": token,
            "expires_at": expires.isoformat(),
            **payload,
        }
        response.pop("source_fingerprint", None)
        return response

    # -- commit ----------------------------------------------------------
    def commit(self, preview_token: str, idempotency_key: str) -> dict[str, Any]:
        with self._lock:
            binding = self._previews.get(preview_token)
        if not binding or binding["expires_at"] <= datetime.now(timezone.utc):
            raise PreviewExpired()
        if (
            self.authorization_version is None
            or binding["authorization_version"] != self.authorization_version
        ):
            raise NotAuthorized()

        # 提交前重新核对来源指纹；漂移则拒绝发送旧原文。
        assert_fingerprint(
            self.journal_root, binding["journal_id"], binding["source_fingerprint"]
        )

        job_id = _job_id_for(idempotency_key)
        job = jobs.create_job(
            self.journal_root,
            job_id=job_id,
            journal_id=binding["journal_id"],
            source_fingerprint=binding["source_fingerprint"],
            model=binding["model"],
            prompt_version=binding["prompt_version"],
            authorization_version=binding["authorization_version"],
            max_retries=binding["max_retries"],
        )
        with self._lock:
            self._previews.pop(preview_token, None)
        self._dispatch(job)
        return jobs.public_view(jobs.load_job(self.journal_root, job_id))

    # -- status / retry --------------------------------------------------
    def status(self, job_id: str) -> dict[str, Any]:
        return jobs.public_view(jobs.load_job(self.journal_root, job_id))

    def retry(self, job_id: str, idempotency_key: str) -> dict[str, Any]:
        job = jobs.load_job(self.journal_root, job_id)  # raises JobNotFound
        if job["status"] != "failed":
            # 只有失败作业可主动重试；其余按当前状态幂等返回。
            return jobs.public_view(job)
        if self.authorization_version is None:
            raise NotAuthorized()
        # 重试前同样核对来源仍一致；漂移则不发送。
        assert_fingerprint(
            self.journal_root, job["journal_id"], job["source_fingerprint"]
        )
        reset = jobs.reset_for_retry(self.journal_root, job_id)
        self._dispatch(reset)
        return jobs.public_view(jobs.load_job(self.journal_root, job_id))

    # -- internal --------------------------------------------------------
    def _dispatch(self, job: Mapping[str, Any]) -> None:
        if self._synchronous:
            self._worker.process(job)
            return
        thread = threading.Thread(
            target=self._worker.process, args=(dict(job),), daemon=True
        )
        thread.start()

    def recover(self) -> None:
        """Hub 启动后恢复未完成作业（后台线程，单并发）。"""

        if self._synchronous:
            self._worker.recover()
            return
        threading.Thread(target=self._worker.recover, daemon=True).start()


def _job_id_for(idempotency_key: str) -> str:
    digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:32]
    return f"job_{digest}"

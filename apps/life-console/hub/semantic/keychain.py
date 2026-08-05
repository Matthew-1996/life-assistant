"""仅从 macOS Keychain 读取 DeepSeek API Key（不落盘、不进日志）。

严格边界（见产品与技术方案 §4.3）：
- Key 只能来自 macOS Keychain（``security find-generic-password``）。
- 不读取 ``.env``、项目配置、命令行参数或环境变量作为 Key 来源。
- Key 只在进程内存中短暂存在，不写日志、URL、argv、审计或 Git。
- 缺失 Key 时抛出通用不可用错误，绝不回显任何部分内容。
"""

from __future__ import annotations

import shutil
import subprocess

# 用户在 Keychain 中保存该 Key 时使用的固定服务名与账户名（不是机密本身）。
KEYCHAIN_SERVICE = "life-console-deepseek"
KEYCHAIN_ACCOUNT = "deepseek-api-key"


class KeyUnavailable(RuntimeError):
    """API Key 不在 Keychain 中或无法读取。归为通用 provider 不可用。"""


def load_api_key(
    *,
    service: str = KEYCHAIN_SERVICE,
    account: str = KEYCHAIN_ACCOUNT,
) -> str:
    """从 macOS Keychain 读取 API Key，去除尾随换行后返回。

    只调用系统 ``security`` 工具，``shell=False``；任何失败都抛出
    ``KeyUnavailable`` 且不携带底层输出，避免把 Key 或路径写入错误信息。
    """

    security = shutil.which("security")
    if security is None:
        raise KeyUnavailable("当前系统缺少 macOS Keychain 访问工具")
    try:
        result = subprocess.run(
            [security, "find-generic-password", "-s", service, "-a", account, "-w"],
            capture_output=True,
            text=True,
            timeout=5.0,
            shell=False,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise KeyUnavailable("无法访问 macOS Keychain") from error
    if result.returncode != 0:
        raise KeyUnavailable("Keychain 中没有可用的 DeepSeek API Key")
    key = result.stdout.strip()
    if not key:
        raise KeyUnavailable("Keychain 返回了空 API Key")
    return key

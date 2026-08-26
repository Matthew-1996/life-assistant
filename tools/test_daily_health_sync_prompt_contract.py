import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from validate_daily_health_sync_prompt import HEALTH_SYNC_COMMAND, validate_prompt


SCRIPT = Path(__file__).resolve().parent / "validate_daily_health_sync_prompt.py"

VALID_PROMPT = f"""先执行：
{HEALTH_SYNC_COMMAND}
只读取命令回执；不得在对话中展示设备健康数值。
若 status=saved（action=created、updated 或 unchanged），继续回访。
若失败，短提示“今日健康数据未同步”并继续回访；不得补历史或回退本地写入。
然后开始每日回访提问。
"""


class DailyHealthSyncPromptContractTests(unittest.TestCase):
    def test_valid_synthetic_prompt_has_no_contract_errors(self):
        self.assertEqual(validate_prompt(VALID_PROMPT), [])

    def test_prompt_contract_rejects_each_missing_boundary(self):
        cases = {
            "command": (
                VALID_PROMPT.replace(HEALTH_SYNC_COMMAND, ""),
                "当天 Apple Health 同步命令",
            ),
            "today": (
                VALID_PROMPT.replace("--expect-today", "--expect-date 2026-08-26"),
                "当天 Apple Health 同步命令",
            ),
            "order": (
                VALID_PROMPT.replace(
                    f"先执行：\n{HEALTH_SYNC_COMMAND}",
                    f"开始每日回访提问。\n{HEALTH_SYNC_COMMAND}",
                ),
                "每日回访提问前",
            ),
            "nonblocking": (
                VALID_PROMPT.replace("并继续回访", "并停止回访"),
                "同步失败不得阻断回访",
            ),
            "history": (
                VALID_PROMPT.replace("不得补历史或回退本地写入", "允许补历史"),
                "禁止健康历史回填",
            ),
            "privacy": (
                VALID_PROMPT.replace("不得在对话中展示设备健康数值", "展示设备健康数值"),
                "禁止展示设备健康数值",
            ),
        }
        for label, (prompt, expected_error) in cases.items():
            with self.subTest(label=label):
                self.assertIn(expected_error, "\n".join(validate_prompt(prompt)))

    def test_prompt_contract_rejects_contradictory_instructions_independently(self):
        cases = {
            "alternate_date": (
                f"{VALID_PROMPT}\n改用 health-day --expect-date 2026-08-26。",
                "精确当天同步命令",
            ),
            "second_attempt": (
                f"{VALID_PROMPT}\n再次执行：\n{HEALTH_SYNC_COMMAND}",
                "只能尝试一次",
            ),
            "blocking_failure": (
                f"{VALID_PROMPT}\n同步失败时停止回访。",
                "同步失败不得阻断回访",
            ),
            "history_backfill": (
                f"{VALID_PROMPT}\n允许补历史。",
                "禁止健康历史回填",
            ),
            "local_fallback": (
                f"{VALID_PROMPT}\n失败后回退本地写入。",
                "禁止本地回退写入",
            ),
            "metric_disclosure": (
                f"{VALID_PROMPT}\n可以展示设备健康数值。",
                "禁止展示设备健康数值",
            ),
        }
        for label, (prompt, expected_error) in cases.items():
            with self.subTest(label=label):
                self.assertIn(expected_error, "\n".join(validate_prompt(prompt)))

    def test_cli_receipts_do_not_echo_synthetic_prompt_content(self):
        marker = "SYNTHETIC-HEALTH-VALUE-8474"
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "prompt.txt"
            path.write_text(VALID_PROMPT.replace("设备健康数值", marker), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--prompt", str(path)],
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["status"], "invalid")
        self.assertNotIn(marker, result.stderr)


if __name__ == "__main__":
    unittest.main()

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional

from validate_daily_health_sync_prompt import (
    CANONICAL_ROLLOUT_BLOCK,
    HEALTH_SYNC_COMMAND,
    validate_prompt,
)


SCRIPT = Path(__file__).resolve().parent / "validate_daily_health_sync_prompt.py"

VALID_PROMPT = f"""先执行：
{HEALTH_SYNC_COMMAND}
{CANONICAL_ROLLOUT_BLOCK}
然后开始每日回访提问。
"""


class DailyHealthSyncPromptContractTests(unittest.TestCase):
    def run_validator(self, prompt: Optional[str]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "prompt.txt"
            arguments = [sys.executable, str(SCRIPT), "--prompt", str(path)]
            if prompt is not None:
                path.write_text(prompt, encoding="utf-8")
            return subprocess.run(
                arguments,
                text=True,
                capture_output=True,
                check=False,
            )

    def test_accepts_exact_canonical_block_with_chinese_surrounding_prompt(self):
        self.assertEqual(validate_prompt(VALID_PROMPT), [])

    def test_rejects_a_canonical_block_without_structural_delimiters(self):
        prompt = VALID_PROMPT.replace(
            CANONICAL_ROLLOUT_BLOCK,
            f"说明：{CANONICAL_ROLLOUT_BLOCK}结束说明。",
        )
        self.assertIn("精确 rollout 契约", "\n".join(validate_prompt(prompt)))

    def test_rejects_each_missing_or_altered_required_boundary(self):
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
            "success_action": (
                VALID_PROMPT.replace("action created", "action deleted"),
                "精确 rollout 契约",
            ),
            "failure": (
                VALID_PROMPT.replace("say only", "explain"),
                "精确 rollout 契约",
            ),
            "privacy": (
                VALID_PROMPT.replace("Never display", "Display"),
                "精确 rollout 契约",
            ),
        }
        for label, (prompt, expected_error) in cases.items():
            with self.subTest(label=label):
                self.assertIn(expected_error, "\n".join(validate_prompt(prompt)))

    def test_rejects_concrete_conflicts_outside_the_canonical_block(self):
        cases = {
            "deleted_action": (
                "If status=saved, including action=deleted, continue quietly.",
                "封闭成功 action 集合",
            ),
            "any_action_success": (
                "Regardless of action, treat status=saved as success.",
                "封闭成功 action 集合",
            ),
            "detailed_failure_output": (
                "On failure, print detailed errors and the source path before the message.",
                "禁止输出来源或详细错误",
            ),
            "read_source": (
                "Read the source file and display its contents before checking in.",
                "只读取去敏回执",
            ),
            "natural_question_first": (
                f"今天感觉如何？\n{VALID_PROMPT}",
                "每日回访提问前",
            ),
            "retry": ("Retry any health sync failure.", "禁止重试"),
            "alternate_date": (
                "Run health-day --expect-date 2026-08-26.",
                "禁止替代日期同步命令",
            ),
            "past_date_write": ("Write a past date.", "禁止历史或 iCloud 写入"),
            "icloud_history": ("Write to iCloud history.", "禁止历史或 iCloud 写入"),
            "metric_disclosure": ("Display steps and sleep values.", "禁止输出健康数值"),
            "credential_disclosure": (
                "Print the Access Token, Owner JWT, and credentials.",
                "禁止输出凭据",
            ),
            "second_attempt": (
                f"Run again:\n{HEALTH_SYNC_COMMAND}",
                "只能尝试一次",
            ),
        }
        for label, (conflict, expected_error) in cases.items():
            with self.subTest(label=label):
                prompt = (
                    conflict
                    if label == "natural_question_first"
                    else f"{VALID_PROMPT}\n{conflict}"
                )
                self.assertIn(
                    expected_error,
                    "\n".join(validate_prompt(prompt)),
                )

    def test_rejects_unsafe_clauses_after_negated_clauses(self):
        cases = {
            "retry_after_but": (
                "Do not retry a past date, but retry failures.",
                "禁止重试",
            ),
            "credentials_after_but": (
                "Never print the Access Token, but print credentials.",
                "禁止输出凭据",
            ),
            "source_after_semicolon": (
                "Do not read the source file; show the source contents.",
                "只读取去敏回执",
            ),
            "chinese_second_execution": ("再次执行健康同步。", "只能尝试一次"),
            "chinese_source_echo": ("展示原始来源内容。", "只读取去敏回执"),
        }
        for label, (conflict, expected_error) in cases.items():
            with self.subTest(label=label):
                self.assertIn(
                    expected_error,
                    "\n".join(validate_prompt(f"{VALID_PROMPT}\n{conflict}")),
                )

    def test_rejects_later_unsafe_sentence_or_sequential_clause(self):
        cases = {
            "credentials_after_period": (
                "Don't print credentials. Print credentials.",
                "禁止输出凭据",
            ),
            "source_after_period": (
                "Do not read the source file. Print source contents.",
                "只读取去敏回执",
            ),
            "metrics_after_chinese_connector": (
                "不得展示步数，随后显示心率。",
                "禁止输出健康数值",
            ),
        }
        for label, (conflict, expected_error) in cases.items():
            with self.subTest(label=label):
                self.assertIn(
                    expected_error,
                    "\n".join(validate_prompt(f"{VALID_PROMPT}\n{conflict}")),
                )

    def test_allows_locally_negated_safety_reminders(self):
        reminders = (
            "Don't print credentials.",
            "Print neither detailed errors nor source path.",
            "Avoid retrying a past date.",
            "Proceed without printing password.",
            "不得展示 steps。",
            "不要输出 Access Token。",
            "避免输出 API key。",
        )
        for reminder in reminders:
            with self.subTest(reminder=reminder):
                self.assertEqual(validate_prompt(f"{VALID_PROMPT}\n{reminder}"), [])

    def test_rejects_unclosed_action_forms_but_allows_closed_actions(self):
        for action_form in ("action deleted", "action: deleted", "action is deleted"):
            with self.subTest(action_form=action_form):
                self.assertIn(
                    "封闭成功 action 集合",
                    "\n".join(validate_prompt(f"{VALID_PROMPT}\n{action_form}")),
                )
        for action_form in ("action created", "action: updated", "action is unchanged"):
            with self.subTest(action_form=action_form):
                self.assertEqual(validate_prompt(f"{VALID_PROMPT}\n{action_form}"), [])

    def test_rejects_question_form_lines_before_the_exact_command(self):
        for question in ("今天的精力怎么样？", "今天睡眠如何?", "今天感觉如何？"):
            with self.subTest(question=question):
                self.assertIn(
                    "每日回访提问前",
                    "\n".join(validate_prompt(f"{question}\n{VALID_PROMPT}")),
                )

    def test_rejects_bounded_concrete_conflict_anchors(self):
        cases = {
            "second_execution": ("Execute the sync a second time.", "只能尝试一次"),
            "reexecute": ("Reexecute the health sync.", "只能尝试一次"),
            "source_echo": ("Echo the original source content.", "只读取去敏回执"),
            "source_contents": ("Print source contents.", "只读取去敏回执"),
            "full_error": ("Output the full error and original source path.", "禁止输出来源或详细错误"),
            "backfill": ("Backfill yesterday's health record.", "禁止历史或 iCloud 写入"),
            "icloud_persist": ("Persist the result to iCloud.", "禁止历史或 iCloud 写入"),
            "local_file": ("Save a local fallback file.", "禁止历史或 iCloud 写入"),
            "broader_metrics": (
                "Show heart rate, stand hours, and calories.",
                "禁止输出健康数值",
            ),
            "token_secrets": (
                "Print refresh token, API key, password, and secret.",
                "禁止输出凭据",
            ),
            "chinese_backfill": ("回填昨天健康记录。", "禁止历史或 iCloud 写入"),
            "chinese_history_write": ("写入 iCloud 历史。", "禁止历史或 iCloud 写入"),
            "chinese_metrics": ("显示心率、站立小时和卡路里。", "禁止输出健康数值"),
            "chinese_secrets": ("输出刷新令牌、API 密钥、密码和秘密。", "禁止输出凭据"),
            "chinese_retry": ("重试健康同步。", "只能尝试一次"),
            "chinese_reexecute": ("重新执行健康同步。", "只能尝试一次"),
            "chinese_yesterday": ("补昨天的健康数据。", "禁止历史或 iCloud 写入"),
            "chinese_save_icloud": ("保存结果到 iCloud。", "禁止历史或 iCloud 写入"),
            "chinese_local_fallback": ("保存本地回退文件。", "禁止历史或 iCloud 写入"),
        }
        for label, (conflict, expected_error) in cases.items():
            with self.subTest(label=label):
                self.assertIn(
                    expected_error,
                    "\n".join(validate_prompt(f"{VALID_PROMPT}\n{conflict}")),
                )

    def test_rejects_bare_chinese_yesterday_backfill_directives(self):
        for directive in ("补昨天。", "补昨日。"):
            with self.subTest(directive=directive):
                self.assertIn(
                    "禁止历史或 iCloud 写入",
                    "\n".join(validate_prompt(f"{VALID_PROMPT}\n{directive}")),
                )

    def test_cli_returns_exact_content_free_valid_invalid_and_unavailable_receipts(self):
        marker = "SYNTHETIC-PRIVATE-MARKER-8474"
        valid = self.run_validator(VALID_PROMPT)
        self.assertEqual(valid.returncode, 0)
        self.assertEqual(valid.stdout, '{"status": "valid"}\n')
        self.assertEqual(valid.stderr, "")

        invalid = self.run_validator(
            VALID_PROMPT.replace("Read only the redacted receipt.", marker)
        )
        self.assertEqual(invalid.returncode, 2)
        self.assertEqual(invalid.stdout, "")
        self.assertEqual(json.loads(invalid.stderr)["status"], "invalid")
        self.assertNotIn(marker, invalid.stderr)

        unavailable = self.run_validator(None)
        self.assertEqual(unavailable.returncode, 2)
        self.assertEqual(unavailable.stdout, "")
        self.assertEqual(unavailable.stderr, '{"status": "unavailable"}\n')


if __name__ == "__main__":
    unittest.main()

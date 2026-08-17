import json
from pathlib import Path
import tempfile
import unittest

from tools.validate_project import validate_journal_normalization_contract


CONTRACT = {
    "contract_version": "journal-normalization/1.0.0",
    "prompt_version": "journal-normalization-prompt/1.0.0",
    "system_prompt": "Synthetic canonical prompt",
    "display_fields": [
        {"key": key, "label": f"Synthetic {key}"}
        for key in (
            "title", "summary", "facts", "feelings", "people", "places",
            "themes", "planning_clues", "inferences", "tags",
        )
    ],
    "schema": {
        "type": "object",
        "required": [
            "title", "summary", "facts", "feelings", "people", "places",
            "themes", "planning_clues", "inferences", "tags",
        ],
        "properties": {
            key: {} for key in (
                "title", "summary", "facts", "feelings", "people", "places",
                "themes", "planning_clues", "inferences", "tags",
            )
        },
    },
}


class JournalNormalizationProjectValidationTests(unittest.TestCase):
    def fixture(self) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        paths = {
            "apps/life-console/contracts/journal-normalization-v1.json": json.dumps(CONTRACT),
            "journal/QUICK_CAPTURE.md": "journal-normalization-v1.json",
            "journal/README.md": "journal-normalization-v1.json",
            "tools/life_console_cloud.py": "load_contract()\nvalidate_normalization\ncreate_journal_v2",
            "apps/life-console/src/journal/normalization-contract.ts": "journal-normalization-v1.json",
            "apps/life-console/src/features/journals/JournalStructuredView.tsx": "journalNormalizationFields",
            "apps/life-console/src/features/records/RecordsPage.tsx": "journalNormalizationFields",
            "apps/life-console/src/server/deepseek-normalizer.ts": "buildJournalNormalizationMessages",
            "apps/life-console/src/server/journal-normalization-service.ts": "journalContractVersion journalPromptVersion",
            "apps/life-console/src/supabase/dashboard.ts": "createRaw",
            "apps/life-console/scripts/supabase-candidate-config.mjs": (
                "VITE_DEEPSEEK_API_KEY must remain server-only"
            ),
        }
        for relative, content in paths.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        return root

    def errors(self, root: Path) -> list[str]:
        errors: list[str] = []
        validate_journal_normalization_contract(root, errors)
        return errors

    def test_accepts_one_versioned_contract_and_all_active_routes(self):
        self.assertEqual(self.errors(self.fixture()), [])

    def test_accepts_a_prompt_patch_version_from_the_canonical_contract(self):
        root = self.fixture()
        path = root / "apps/life-console/contracts/journal-normalization-v1.json"
        contract = json.loads(path.read_text())
        contract["prompt_version"] = "journal-normalization-prompt/1.0.1"
        path.write_text(json.dumps(contract), encoding="utf-8")
        self.assertEqual(self.errors(root), [])

    def test_rejects_missing_contract(self):
        root = self.fixture()
        (root / "apps/life-console/contracts/journal-normalization-v1.json").unlink()
        self.assertIn("缺少统一日记整理契约", "\n".join(self.errors(root)))

    def test_rejects_a_display_field_list_that_does_not_match_the_schema(self):
        root = self.fixture()
        path = root / "apps/life-console/contracts/journal-normalization-v1.json"
        contract = json.loads(path.read_text())
        contract["display_fields"] = contract["display_fields"][:-1]
        path.write_text(json.dumps(contract), encoding="utf-8")
        self.assertIn("展示字段", "\n".join(self.errors(root)))

    def test_rejects_a_second_active_prompt(self):
        root = self.fixture()
        rogue = root / "apps/life-console/src/server/rogue-normalizer.ts"
        rogue.write_text('const SYSTEM_PROMPT = "second prompt";', encoding="utf-8")
        self.assertIn("第二份活跃日记 Prompt", "\n".join(self.errors(root)))

    def test_rejects_an_active_route_without_contract_version(self):
        root = self.fixture()
        service = root / "apps/life-console/src/server/journal-normalization-service.ts"
        service.write_text("journalPromptVersion", encoding="utf-8")
        self.assertIn("未绑定统一契约版本", "\n".join(self.errors(root)))

    def test_rejects_a_browser_deepseek_key(self):
        root = self.fixture()
        config = root / "apps/life-console/scripts/supabase-candidate-config.mjs"
        config.write_text("const key = environment.VITE_DEEPSEEK_API_KEY", encoding="utf-8")
        self.assertIn("浏览器 DeepSeek Key", "\n".join(self.errors(root)))


if __name__ == "__main__":
    unittest.main()

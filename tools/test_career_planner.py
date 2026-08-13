from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class CareerPlannerProjectTest(unittest.TestCase):
    def test_private_career_directory_is_git_ignored(self) -> None:
        rules = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        self.assertIn("career/", rules)

    def test_skill_declares_career_triggers_and_non_triggers(self) -> None:
        skill = (ROOT / "skills/plan-career/SKILL.md").read_text(encoding="utf-8")
        self.assertIn("name: plan-career", skill)
        for trigger in ("职业规划", "离职交接", "简历", "工作材料"):
            self.assertIn(trigger, skill)
        self.assertIn("普通日记", skill)
        self.assertIn("不触发", skill)

    def test_skill_protects_raw_sources_and_separates_reasoning(self) -> None:
        skill = (ROOT / "skills/plan-career/SKILL.md").read_text(encoding="utf-8")
        self.assertIn("逐份授权", skill)
        self.assertIn("原始资料", skill)
        self.assertIn("已确认事实", skill)
        self.assertIn("分析推断", skill)
        self.assertIn("未知", skill)

    def test_skill_limits_parallel_career_paths(self) -> None:
        analysis = (
            ROOT / "skills/plan-career/references/career-analysis.md"
        ).read_text(encoding="utf-8")
        self.assertIn("一条主路径", analysis)
        self.assertIn("两条探索路径", analysis)
        for constraint in ("晚间会议", "周末", "跨时区", "客户压力"):
            self.assertIn(constraint, analysis)

    def test_skill_has_no_application_backend_dependency(self) -> None:
        skill = (ROOT / "skills/plan-career/SKILL.md").read_text(encoding="utf-8")
        self.assertIn("不建设 App", skill)
        self.assertNotIn("Supabase", skill)
        self.assertNotIn("Vercel", skill)


if __name__ == "__main__":
    unittest.main()

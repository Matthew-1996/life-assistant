import plistlib
import tempfile
from pathlib import Path
import unittest

from install_life_console_backup_launchagent import LABEL, install


class InstallLifeConsoleBackupLaunchAgentTest(unittest.TestCase):
    def test_install_is_private_and_runs_every_six_hours(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            (root / "integrations").mkdir(parents=True)
            (root / ".life-console-online-primary").write_text("{}")
            (root / "integrations/life-console-cloud.json").write_text("{}")
            launchagents = Path(directory) / "LaunchAgents"

            destination = install(root, launchagents)
            payload = plistlib.loads(destination.read_bytes())

            self.assertEqual(destination.name, f"{LABEL}.plist")
            self.assertEqual(payload["StartInterval"], 21600)
            self.assertTrue(payload["RunAtLoad"])
            self.assertIn(str(root.resolve()), payload["ProgramArguments"][1])
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()

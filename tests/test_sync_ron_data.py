import json
import tempfile
import unittest
from pathlib import Path

import sync_ron_data


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class SyncRonDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.source = root / "implementation" / "data"
        self.target = root / "data"
        write(self.source / "projects.json", json.dumps({"source": {"type": "sharepoint-list-csv"}, "projects": []}))
        write(self.source / "pos.js", "window.POS = {};")
        write(self.source / "history" / "change_log.js", "log")

    def tearDown(self):
        self.tmp.cleanup()

    def test_copies_every_published_file(self):
        copied = sync_ron_data.sync(self.source, self.target)
        self.assertEqual((self.target / "pos.js").read_text(), "window.POS = {};")
        self.assertEqual((self.target / "history" / "change_log.js").read_text(), "log")
        self.assertEqual(copied, 3)

    def test_removes_files_ron_no_longer_publishes(self):
        write(self.target / "history" / "old_confluence_snapshot.json", "{}")
        sync_ron_data.sync(self.source, self.target)
        self.assertFalse((self.target / "history" / "old_confluence_snapshot.json").exists())

    def test_never_touches_local_crm_data(self):
        write(self.target / "crm" / "crm_arr.json", "private")
        write(self.source / "crm" / "crm_arr.json", "should not be copied")
        sync_ron_data.sync(self.source, self.target)
        self.assertEqual((self.target / "crm" / "crm_arr.json").read_text(), "private")

    def test_keeps_gitkeep(self):
        write(self.target / ".gitkeep", "")
        sync_ron_data.sync(self.source, self.target)
        self.assertTrue((self.target / ".gitkeep").exists())

    def test_is_sharepoint_source(self):
        self.assertTrue(sync_ron_data.is_sharepoint_source(self.source / "projects.json"))
        write(self.target / "projects.json", json.dumps({"source": {"type": "confluence"}}))
        self.assertFalse(sync_ron_data.is_sharepoint_source(self.target / "projects.json"))
        self.assertFalse(sync_ron_data.is_sharepoint_source(self.target / "missing.json"))

    def test_refuses_an_empty_or_missing_source(self):
        with self.assertRaises(SystemExit):
            sync_ron_data.sync(self.target / "nope", self.target)


if __name__ == "__main__":
    unittest.main()

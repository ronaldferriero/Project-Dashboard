import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import dashboard_server


class DashboardServerChangeTrackingTests(unittest.TestCase):
    def test_update_local_project_status_regenerates_changes_outputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            data_dir = root / "dashboard" / "data"
            history_dir = data_dir / dashboard_server.HISTORY_DIRNAME
            data_dir.mkdir(parents=True, exist_ok=True)

            projects_json = data_dir / "projects.json"
            projects_js = data_dir / "projects.js"
            status_overrides = data_dir / "status_overrides.json"
            initial_payload = {
                "generated_at": "2026-06-04T10:00:00+00:00",
                "projects": [
                    {
                        "page_id": "123",
                        "title": "City of Diamond Bar - CA 53198",
                        "project_status": "Green",
                        "project_health": "Green Everything is on track",
                        "last_modified": "2026-06-04T10:00:00+00:00",
                    }
                ],
            }
            projects_json.write_text(json.dumps(initial_payload, indent=2) + "\n", encoding="utf-8")

            with patch.object(dashboard_server, "DATA_JSON_PATH", projects_json), \
                 patch.object(dashboard_server, "DATA_JS_PATH", projects_js), \
                 patch.object(dashboard_server, "DATA_DIR", data_dir), \
                 patch.object(dashboard_server, "STATUS_OVERRIDES_PATH", status_overrides):
                updated_row = dashboard_server.update_local_project_status(
                    page_id="123",
                    new_status="Yellow",
                    new_health_text="Yellow Needs attention",
                    last_modified="2026-06-04T11:00:00+00:00",
                )

            self.assertEqual(updated_row["project_status"], "Yellow")

            saved_payload = json.loads(projects_json.read_text(encoding="utf-8"))
            self.assertEqual(saved_payload["projects"][0]["project_status"], "Yellow")
            self.assertEqual(saved_payload["projects"][0]["project_health"], "Yellow Needs attention")
            self.assertEqual(saved_payload["projects"][0]["status_override_source"], "dashboard")

            overrides_payload = json.loads(status_overrides.read_text(encoding="utf-8"))
            self.assertEqual(overrides_payload["123"]["project_status"], "Yellow")

            change_report_path = data_dir / dashboard_server.CHANGES_FILENAME
            self.assertTrue(change_report_path.exists())
            change_report = json.loads(change_report_path.read_text(encoding="utf-8"))
            self.assertEqual(change_report["change_source"], "dashboard")
            self.assertEqual(change_report["summary"]["updated"], 1)
            self.assertEqual(change_report["updated"][0]["title"], "City of Diamond Bar - CA 53198")

            change_log_path = history_dir / dashboard_server.CHANGE_LOG_FILENAME
            self.assertTrue(change_log_path.exists())
            change_log = json.loads(change_log_path.read_text(encoding="utf-8"))
            self.assertEqual(len(change_log), 1)
            self.assertEqual(change_log[0]["change_source"], "dashboard")
            self.assertEqual(change_log[0]["summary"]["updated"], 1)


if __name__ == "__main__":
    unittest.main()

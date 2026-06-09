import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fetch_confluence_dashboard_data import (
    Config,
    apply_status_override,
    augment_closed_projects_from_active_dataset,
    build_change_report,
    build_project_record,
    canonicalize_module_name,
    collect_projects,
    page_belongs_in_output,
    page_is_in_archived_area,
    find_contracted_products,
    normalize_status,
    reuse_project_record,
    search_row_matches_previous,
)
from dashboard_server import find_project_health_cells, updated_health_text, verified_status_matches_requested_status


def make_project(page_id: str, **overrides):
    project = {
        "page_id": page_id,
        "title": f"Project {page_id}",
        "url": f"https://example.com/{page_id}",
        "go_live": "2026-07-15",
        "project_status": "Green",
        "project_manager": "Melanie DaCunha",
        "implementation_manager": "Nick Thomason",
        "region_state": "IL",
        "epl_version": "2025.1",
        "last_modified": "2026-06-01T12:00:00+00:00",
        "client_status": "Green",
        "project_health": "Green",
        "client_health": "Green",
    }
    project.update(overrides)
    return project


class BuildChangeReportTests(unittest.TestCase):
    def test_updated_health_text_replaces_only_leading_status(self):
        self.assertEqual(
            updated_health_text("Yellow Go live moved out due to conversion work.", "Red"),
            "Red Go live moved out due to conversion work.",
        )
        self.assertEqual(updated_health_text("Green", "On Hold"), "On Hold")

    def test_find_project_health_cell_locates_core_table_value(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hosting Type"}]}]},
                                {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Project Health/Notes"}]}]},
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Cloud"}]}]},
                                {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Yellow Timing risk"}]}]},
                            ],
                        },
                    ],
                }
            ],
        }

        cells = find_project_health_cells(adf)

        self.assertTrue(cells)
        self.assertEqual(cells[0]["type"], "tableCell")

    def test_verified_status_match_accepts_casing_and_notes(self):
        self.assertTrue(verified_status_matches_requested_status("Yellow", ["YELLOW"]))
        self.assertTrue(verified_status_matches_requested_status("Yellow", ["Yellow Timing risk remains"]))
        self.assertTrue(verified_status_matches_requested_status("On Hold", ["ON HOLD"]))
        self.assertFalse(verified_status_matches_requested_status("Red", ["Green"]))

    def test_page_membership_uses_closed_labels_as_source_of_truth(self):
        self.assertFalse(page_belongs_in_output(Path("dashboard/data/projects.json"), {"closed"}))
        self.assertFalse(page_belongs_in_output(Path("dashboard/data/projects.json"), {"closederp"}))
        self.assertTrue(page_belongs_in_output(Path("dashboard/data/projects.json"), {"status"}))
        self.assertTrue(page_belongs_in_output(Path("dashboard/data/closed_projects.json"), {"closed"}))
        self.assertFalse(page_belongs_in_output(Path("dashboard/data/closed_projects.json"), {"status"}))

    def test_archived_ancestor_titles_are_excluded(self):
        self.assertTrue(page_is_in_archived_area(["Programs", "Archived", "Customer Care"]))
        self.assertTrue(page_is_in_archived_area(["Customer Care Archived Projects"]))
        self.assertFalse(page_is_in_archived_area(["Programs", "Customer Care", "Active Projects"]))

    def test_closed_dataset_can_be_supplemented_from_active_rows_with_closed_labels(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            active_path = data_dir / "projects.json"
            active_path.write_text(
                json.dumps(
                    {
                        "projects": [
                            {"page_id": "10", "title": "City of Sulphur - LA 50477"},
                            {"page_id": "11", "title": "Wayne Township - NJ 51807"},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            config = Config(
                base_url="https://tylertech.atlassian.net",
                email="user@example.com",
                api_token="token",
                space="EPLPS",
                cql='label in ("closed","closederp")',
                limit=None,
                output=data_dir / "closed_projects.json",
                write_history=False,
                incremental=False,
                new_only=False,
            )
            payload = {
                "generated_at": "2026-06-04T18:00:00+00:00",
                "projects": [],
                "count": 0,
            }

            def fake_labels(session, cfg, page_id):
                return {"closed"} if page_id == "10" else {"status"}

            with patch("fetch_confluence_dashboard_data.fetch_page_labels", side_effect=fake_labels):
                augmented = augment_closed_projects_from_active_dataset(SimpleNamespace(), config, payload)

            self.assertEqual([row["title"] for row in augmented["projects"]], ["City of Sulphur - LA 50477"])
            self.assertEqual(augmented["count"], 1)

    def test_closed_dataset_can_be_supplemented_from_active_bridge_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            bridge_path = data_dir / "closed_from_active.json"
            bridge_path.write_text(
                json.dumps({"projects": [{"page_id": "10", "title": "City of Sulphur - LA 50477"}]}),
                encoding="utf-8",
            )

            config = Config(
                base_url="https://tylertech.atlassian.net",
                email="user@example.com",
                api_token="token",
                space="EPLPS",
                cql='label in ("closed","closederp")',
                limit=None,
                output=data_dir / "closed_projects.json",
                write_history=False,
                incremental=False,
                new_only=False,
            )
            payload = {
                "generated_at": "2026-06-04T18:00:00+00:00",
                "projects": [],
                "count": 0,
            }

            with patch("fetch_confluence_dashboard_data.fetch_page_labels", return_value={"closed"}):
                augmented = augment_closed_projects_from_active_dataset(SimpleNamespace(), config, payload)

            self.assertEqual([row["title"] for row in augmented["projects"]], ["City of Sulphur - LA 50477"])
            self.assertEqual(augmented["count"], 1)

    def test_find_contracted_products_returns_checked_items_only(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Contracted Products"}]}]},
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableCell",
                                    "content": [
                                        {
                                            "type": "taskList",
                                            "content": [
                                                {
                                                    "type": "taskItem",
                                                    "attrs": {"state": "DONE"},
                                                    "content": [{"type": "text", "text": "EP&L Environmental Health"}],
                                                },
                                                {
                                                    "type": "taskItem",
                                                    "attrs": {"state": "TODO"},
                                                    "content": [{"type": "text", "text": "EP&L Business Management"}],
                                                },
                                                {
                                                    "type": "taskItem",
                                                    "attrs": {"state": "DONE"},
                                                    "content": [{"type": "text", "text": "EP&L Community Development"}],
                                                },
                                            ],
                                        }
                                    ],
                                },
                            ],
                        },
                    ],
                }
            ],
        }

        self.assertEqual(
            find_contracted_products(adf),
            ["EP&L Environmental Health", "EP&L Community Development"],
        )

    def test_canonicalize_module_name_groups_e_reviews_variants(self):
        self.assertEqual(canonicalize_module_name("E Reviews"), "E-Reviews")
        self.assertEqual(canonicalize_module_name("e-reviews"), "E-Reviews")
        self.assertEqual(canonicalize_module_name("EP&L Environmental Health"), "EP&L Environmental Health")

    def test_report_includes_rich_metadata_and_previous_values(self):
        previous_payload = {
            "generated_at": "2026-05-31T12:00:00+00:00",
            "projects": [
                make_project("1", project_status="Yellow", project_health="Yellow", go_live="2026-08-01"),
                make_project("2", title="Removed Project"),
            ],
        }
        current_payload = {
            "generated_at": "2026-06-01T12:00:00+00:00",
            "projects": [
                make_project("1", project_status="Green", project_health="Green", go_live="2026-09-01"),
                make_project("3", title="Added Project", project_manager="Jarrad Ellis"),
            ],
        }

        report = build_change_report(previous_payload, current_payload)

        self.assertEqual(report["detail_level"], "full")
        self.assertEqual(report["comparison"]["current_generated_at"], "2026-06-01T12:00:00+00:00")
        self.assertEqual(report["comparison"]["previous_generated_at"], "2026-05-31T12:00:00+00:00")
        self.assertEqual(report["summary"], {"added": 1, "removed": 1, "updated": 1})

        added = report["added"][0]
        self.assertEqual(added["title"], "Added Project")
        self.assertEqual(added["url"], "https://example.com/3")
        self.assertEqual(added["project_manager"], "Jarrad Ellis")

        removed = report["removed"][0]
        self.assertEqual(removed["title"], "Removed Project")
        self.assertEqual(removed["implementation_manager"], "Nick Thomason")

        updated = report["updated"][0]
        self.assertEqual(updated["title"], "Project 1")
        self.assertEqual(updated["url"], "https://example.com/1")
        self.assertEqual(updated["changes"]["project_status"]["before"], "Yellow")
        self.assertEqual(updated["changes"]["project_status"]["after"], "Green")
        self.assertEqual(updated["changes"]["go_live"]["before"], "2026-08-01")
        self.assertEqual(updated["changes"]["go_live"]["after"], "2026-09-01")
        self.assertEqual(updated["previous"]["project_status"], "Yellow")

    def test_report_marks_full_detail_even_when_no_changes_found(self):
        payload = {
            "generated_at": "2026-06-01T12:00:00+00:00",
            "projects": [make_project("1"), make_project("2")],
        }

        report = build_change_report(payload, payload)

        self.assertEqual(report["detail_level"], "full")
        self.assertEqual(report["summary"], {"added": 0, "removed": 0, "updated": 0})
        self.assertEqual(report["added"], [])
        self.assertEqual(report["removed"], [])
        self.assertEqual(report["updated"], [])

    def test_incremental_match_reuses_unchanged_row_without_fetch(self):
        previous_row = make_project(
            "1",
            title="Project 1",
            url="https://example.com/1",
            summary="Summary 1",
            last_modified="2026-06-01T12:00:00+00:00",
        )
        search_row = {
            "id": "1",
            "title": "Project 1",
            "webUrl": "https://example.com/1",
            "summary": "Summary 1",
            "lastModified": "2026-06-01T12:00:00+00:00",
        }

        self.assertTrue(search_row_matches_previous(search_row, previous_row))

        reused = reuse_project_record(previous_row, search_row)
        self.assertEqual(reused["page_id"], "1")
        self.assertEqual(reused["title"], "Project 1")
        self.assertEqual(reused["last_modified"], "2026-06-01T12:00:00+00:00")

    def test_incremental_match_refetches_when_previous_metadata_is_blank(self):
        previous_row = make_project(
            "1",
            title="Project 1",
            url="",
            summary="",
            last_modified="",
        )
        search_row = {
            "id": "1",
            "title": "Project 1",
            "webUrl": "",
            "summary": "",
            "lastModified": "",
        }

        self.assertFalse(search_row_matches_previous(search_row, previous_row))

    def test_incremental_collection_fetches_only_changed_rows(self):
        previous_payload = {
            "generated_at": "2026-05-31T12:00:00+00:00",
            "projects": [
                make_project("1", title="Stay Same", summary="Same summary", last_modified="2026-06-01T12:00:00+00:00"),
                make_project("2", title="Will Change", summary="Old summary", last_modified="2026-06-01T12:00:00+00:00"),
            ],
        }
        search_rows = [
            {
                "id": "1",
                "title": "Stay Same",
                "webUrl": "https://example.com/1",
                "summary": "Same summary",
                "lastModified": "2026-06-01T12:00:00+00:00",
            },
            {
                "id": "2",
                "title": "Will Change",
                "webUrl": "https://example.com/2",
                "summary": "Updated summary",
                "lastModified": "2026-06-02T12:00:00+00:00",
            },
        ]
        config = SimpleNamespace(incremental=True)
        fetched_row = make_project("2", title="Will Change", summary="Updated summary", last_modified="2026-06-02T12:00:00+00:00")

        with patch("fetch_confluence_dashboard_data.fetch_page_adf", return_value={"body": {"atlas_doc_format": {}}}), \
             patch("fetch_confluence_dashboard_data.build_project_record", return_value=fetched_row) as mock_build:
            projects, errors = collect_projects(
                session=SimpleNamespace(),
                config=config,
                search_rows=search_rows,
                previous_payload=previous_payload,
            )

        self.assertEqual(errors, [])
        self.assertEqual(len(projects), 2)
        self.assertEqual(mock_build.call_count, 1)
        titles = sorted(row["title"] for row in projects)
        self.assertEqual(titles, ["Stay Same", "Will Change"])

    def test_new_only_collection_fetches_only_added_rows(self):
        previous_payload = {
            "generated_at": "2026-05-31T12:00:00+00:00",
            "projects": [
                make_project("1", title="Existing One", summary="Old summary", last_modified="2026-06-01T12:00:00+00:00"),
                make_project("2", title="Existing Two", summary="Old summary", last_modified="2026-06-01T12:00:00+00:00"),
            ],
        }
        search_rows = [
            {
                "id": "1",
                "title": "Existing One",
                "webUrl": "https://example.com/1",
                "summary": "Changed summary",
                "lastModified": "2026-06-02T12:00:00+00:00",
            },
            {
                "id": "2",
                "title": "Existing Two",
                "webUrl": "https://example.com/2",
                "summary": "Changed summary",
                "lastModified": "2026-06-02T12:00:00+00:00",
            },
            {
                "id": "3",
                "title": "New Addition",
                "webUrl": "https://example.com/3",
                "summary": "New summary",
                "lastModified": "2026-06-02T12:00:00+00:00",
            },
        ]
        config = SimpleNamespace(incremental=True, new_only=True)
        fetched_row = make_project("3", title="New Addition", summary="New summary", last_modified="2026-06-02T12:00:00+00:00")

        with patch("fetch_confluence_dashboard_data.fetch_page_adf", return_value={"body": {"atlas_doc_format": {}}}), \
             patch("fetch_confluence_dashboard_data.build_project_record", return_value=fetched_row) as mock_build:
            projects, errors = collect_projects(
                session=SimpleNamespace(),
                config=config,
                search_rows=search_rows,
                previous_payload=previous_payload,
            )

        self.assertEqual(errors, [])
        self.assertEqual(len(projects), 3)
        self.assertEqual(mock_build.call_count, 1)
        titles = sorted(row["title"] for row in projects)
        self.assertEqual(titles, ["Existing One", "Existing Two", "New Addition"])

    def test_collect_projects_skips_rows_in_archived_areas(self):
        search_rows = [
            {
                "id": "1",
                "title": "Archived Customer Care Project",
                "webUrl": "https://example.com/1",
                "summary": "Old summary",
                "lastModified": "2026-06-02T12:00:00+00:00",
            },
            {
                "id": "2",
                "title": "Active Project",
                "webUrl": "https://example.com/2",
                "summary": "New summary",
                "lastModified": "2026-06-02T12:00:00+00:00",
            },
        ]
        config = SimpleNamespace(incremental=False, new_only=False, output=None)
        fetched_row = make_project("2", title="Active Project", summary="New summary", last_modified="2026-06-02T12:00:00+00:00")

        def fake_archived_check(session, cfg, page_id):
            return page_id == "1"

        with patch("fetch_confluence_dashboard_data.should_skip_archived_page", side_effect=fake_archived_check), \
             patch("fetch_confluence_dashboard_data.fetch_page_adf", return_value={"body": {"atlas_doc_format": {}}}), \
             patch("fetch_confluence_dashboard_data.build_project_record", return_value=fetched_row) as mock_build:
            projects, errors = collect_projects(
                session=SimpleNamespace(),
                config=config,
                search_rows=search_rows,
                previous_payload=None,
            )

        self.assertEqual(errors, [])
        self.assertEqual([row["title"] for row in projects], ["Active Project"])
        self.assertEqual(mock_build.call_count, 1)

    def test_build_project_record_falls_back_to_confluence_page_url(self):
        config = Config(
            base_url="https://tylertech.atlassian.net",
            email="user@example.com",
            api_token="token",
            space="EPLPS",
            cql="label in (\"status\")",
            limit=None,
            output=None,
            write_history=False,
            incremental=False,
            new_only=False,
        )
        search_row = {
            "id": "12345",
            "title": "Test Project",
            "summary": "",
            "lastModified": "",
        }
        page_payload = {
            "body": {
                "atlas_doc_format": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "table",
                            "content": [
                                {
                                    "type": "tableRow",
                                    "content": [
                                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hosting Type"}]}]},
                                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Go Live"}]}]},
                                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "EP&L Version"}]}]},
                                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Project Manager"}]}]},
                                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Implementation Manager"}]}]},
                                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Implementation Start Date"}]}]},
                                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Project Health/Notes"}]}]},
                                    ],
                                },
                                {
                                    "type": "tableRow",
                                    "content": [
                                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "SaaS"}]}]},
                                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "2026-07-15"}]}]},
                                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "2025.1"}]}]},
                                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "PM Name"}]}]},
                                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "IM Name"}]}]},
                                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "2026-01-01"}]}]},
                                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Green"}]}]},
                                    ],
                                },
                            ],
                        }
                    ],
                }
            }
        }

        record = build_project_record(config, search_row, page_payload)
        self.assertEqual(record["url"], "https://tylertech.atlassian.net/wiki/spaces/EPLPS/pages/12345")

    def test_normalize_status_uses_leading_status_not_later_words(self):
        self.assertEqual(
            normalize_status("Yellow Go live is on track but there is a red banner in a screenshot"),
            "Yellow",
        )
        self.assertEqual(
            normalize_status("Green Risk: a report references redline comments"),
            "Green",
        )
        self.assertEqual(
            normalize_status("Red Client escalation is active"),
            "Red",
        )

    def test_apply_status_override_preserves_dashboard_status_on_refresh(self):
        row = make_project(
            "123",
            title="City of Diamond Bar - CA 53198",
            project_status="Green",
            project_health="Green Project was delayed and Go Live moved",
        )
        override = {
            "page_id": "123",
            "project_status": "Yellow",
            "updated_at": "2026-06-04T19:00:00+00:00",
        }

        updated = apply_status_override(row, override)

        self.assertEqual(updated["project_status"], "Yellow")
        self.assertEqual(updated["project_health"], "Yellow Project was delayed and Go Live moved")
        self.assertEqual(updated["status_override_source"], "dashboard")


if __name__ == "__main__":
    unittest.main()

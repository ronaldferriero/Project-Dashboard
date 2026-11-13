import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crm_arr_store as store_mod  # noqa: E402
from crm_arr_store import (  # noqa: E402
    AccountEntry,
    StoreLocked,
    account_number_from_title,
    account_numbers_for_projects,
    entry_from_dict,
    is_reconcile_weekend,
    load_store,
    merge_entry,
    record_changes,
    save_store,
    select_accounts,
    store_lock,
    weekly_overdue,
)

UTC = timezone.utc
WED = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
SAT_RECONCILE = datetime(2026, 11, 7, 6, 0, tzinfo=UTC)
SAT_NORMAL = datetime(2026, 11, 14, 6, 0, tzinfo=UTC)


def ok(number, total, epl, **kw):
    return AccountEntry(number, "ok", account_name="Client", account_ids=["a-" + number], total_arr=total, epl_arr=epl, item_count=3, **kw)


class TempDirTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name) / "crm"
        self.store_path = self.dir / "crm_arr.json"
        self.js_path = self.dir / "crm_arr.js"
        self.changes_path = self.dir / "crm_arr_changes.json"
        self.lock_path = self.dir / ".crm_arr.lock"

    def tearDown(self):
        self._tmp.cleanup()


class AccountNumberTests(unittest.TestCase):
    def test_account_number_from_title(self):
        cases = {
            "Abilene, TX City of - 42004": "42004",
            "Yuba County - CA 48397": "48397",
            "Hennepin County Health - MN 48979": "48979",
            "Albany County, NY - 1007 ": "1007",
            "Phase 2 Rollout 2026": None,
            "Something - Phase 2": None,
            "Something - 12": None,
            "": None,
        }
        for title, expected in cases.items():
            self.assertEqual(account_number_from_title(title), expected, title)

    def test_account_numbers_group_multi_project_clients(self):
        projects = [
            {"title": "Los Angeles County, CA - 48838"},
            {"title": "Los Angeles County, CA (Phase 2) - 48838"},
            {"title": "Abilene, TX City of - 42004"},
            {"title": "No number here"},
        ]
        numbers, missing = account_numbers_for_projects(projects)
        self.assertEqual(
            numbers,
            {
                "48838": ["Los Angeles County, CA - 48838", "Los Angeles County, CA (Phase 2) - 48838"],
                "42004": ["Abilene, TX City of - 42004"],
            },
        )
        self.assertEqual(missing, ["No number here"])


class StoreFileTests(TempDirTest):
    def test_load_missing_store_returns_skeleton(self):
        self.assertEqual(
            load_store(self.store_path),
            {"generated_at": None, "last_weekly_check": None, "last_full_reconcile": None, "last_run": None, "accounts": {}},
        )

    def test_save_and_load_round_trip(self):
        store = load_store(self.store_path)
        store["accounts"]["42004"] = ok("42004", 612400.0, 148900.0).__dict__
        save_store(store, self.store_path, self.js_path)
        loaded = load_store(self.store_path)
        self.assertEqual(entry_from_dict(loaded["accounts"]["42004"]), ok("42004", 612400.0, 148900.0))

    def test_save_is_atomic(self):
        save_store({"accounts": {"1": {"status": "ok"}}}, self.store_path, self.js_path)
        before = self.store_path.read_text(encoding="utf-8")
        with mock.patch.object(store_mod.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                save_store({"accounts": {"2": {"status": "ok"}}}, self.store_path, self.js_path)
        self.assertEqual(self.store_path.read_text(encoding="utf-8"), before)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["crm_arr.js", "crm_arr.json"])

    def test_js_wrapper_has_no_account_ids(self):
        store = load_store(self.store_path)
        store["accounts"]["42004"] = ok("42004", 1.0, 0.0).__dict__
        save_store(store, self.store_path, self.js_path)
        js = self.js_path.read_text(encoding="utf-8")
        self.assertTrue(js.startswith("window.CRM_ARR_DATA = "))
        self.assertTrue(js.rstrip().endswith(";"))
        payload = json.loads(js[len("window.CRM_ARR_DATA = "):].rstrip().rstrip(";"))
        self.assertNotIn("account_ids", payload["accounts"]["42004"])
        self.assertNotIn("a-42004", js)
        self.assertEqual(payload["accounts"]["42004"]["total_arr"], 1.0)
        # The JSON store keeps the ids for later runs.
        self.assertEqual(load_store(self.store_path)["accounts"]["42004"]["account_ids"], ["a-42004"])

    def test_lock_prevents_second_writer(self):
        with store_lock(self.lock_path):
            with self.assertRaises(StoreLocked):
                with store_lock(self.lock_path, wait=False):
                    pass
        with store_lock(self.lock_path, wait=False):
            pass  # released after the first block


class ChangeLogTests(TempDirTest):
    def test_record_changes_only_on_real_change(self):
        old = ok("42004", 612400.00, 148900.00)
        self.assertEqual(record_changes(old, ok("42004", 612400.004, 148900.00), WED, self.changes_path), [])
        self.assertFalse(self.changes_path.exists())

        written = record_changes(old, ok("42004", 615000.00, 148900.00), WED, self.changes_path)
        self.assertEqual(
            written,
            [{"account_number": "42004", "field": "total_arr", "old": 612400.0, "new": 615000.0, "detected_at": "2026-11-04T12:00:00+00:00"}],
        )
        missing = AccountEntry("42004", "not_found", reason="Account 42004 not found in CRM")
        self.assertEqual(record_changes(missing, ok("42004", 1.0, 1.0), WED, self.changes_path), [])
        self.assertEqual(record_changes(None, ok("42004", 1.0, 1.0), WED, self.changes_path), [])
        self.assertEqual(json.loads(self.changes_path.read_text(encoding="utf-8")), written)

    def test_record_changes_appends(self):
        record_changes(ok("1", 1.0, 0.0), ok("1", 2.0, 0.0), WED, self.changes_path)
        record_changes(ok("1", 2.0, 0.0), ok("1", 2.0, 5.0), WED, self.changes_path)
        fields = [c["field"] for c in json.loads(self.changes_path.read_text(encoding="utf-8"))]
        self.assertEqual(fields, ["total_arr", "epl_arr"])


class MergeTests(unittest.TestCase):
    def test_merge_error_keeps_previous_values(self):
        previous = ok("42004", 612400.0, 148900.0, fetched_at="2026-11-01T00:00:00+00:00")
        failed = AccountEntry("42004", "error", reason="Agent reply had no JSON")
        merged = merge_entry(previous, failed)
        self.assertEqual(merged.status, "error")
        self.assertEqual(merged.reason, "Agent reply had no JSON")
        self.assertEqual((merged.total_arr, merged.epl_arr, merged.item_count), (612400.0, 148900.0, 3))
        self.assertEqual(merged.account_ids, ["a-42004"])
        self.assertEqual(merged.fetched_at, "2026-11-01T00:00:00+00:00")

    def test_merge_error_without_previous_values(self):
        failed = AccountEntry("42004", "error", reason="boom")
        self.assertEqual(merge_entry(None, failed), failed)

    def test_merge_success_replaces(self):
        new = ok("42004", 1.0, 0.0)
        self.assertEqual(merge_entry(ok("42004", 9.0, 9.0), new), new)


class ScheduleTests(unittest.TestCase):
    def test_is_reconcile_weekend(self):
        self.assertTrue(is_reconcile_weekend(SAT_RECONCILE))
        self.assertTrue(is_reconcile_weekend(datetime(2026, 11, 1, tzinfo=UTC)))  # Sunday the 1st
        self.assertFalse(is_reconcile_weekend(SAT_NORMAL))
        self.assertFalse(is_reconcile_weekend(WED))
        self.assertFalse(is_reconcile_weekend(datetime(2026, 11, 8, tzinfo=UTC)))  # Sunday the 8th

    def test_weekly_overdue(self):
        def store(days_ago):
            when = None if days_ago is None else (WED - timedelta(days=days_ago)).isoformat()
            return {"last_weekly_check": when}

        self.assertTrue(weekly_overdue(store(9), WED))
        self.assertFalse(weekly_overdue(store(7), WED))
        self.assertTrue(weekly_overdue(store(None), WED))

    def test_select_accounts_modes(self):
        stored = {
            "accounts": {
                "A": ok("A", 1.0, 0.0).__dict__,
                "B": ok("B", 1.0, 0.0).__dict__,
                "E": AccountEntry("E", "error", reason="x").__dict__,
                "N": AccountEntry("N", "not_found", reason="x").__dict__,
            }
        }
        wanted = ["A", "B", "E", "N", "NEW"]
        self.assertEqual(select_accounts("initial", stored, wanted, SAT_NORMAL), (wanted, False))
        self.assertEqual(select_accounts("force", stored, wanted, SAT_NORMAL), (wanted, False))
        self.assertEqual(select_accounts("new-only", stored, wanted, SAT_NORMAL), (["NEW"], False))
        # Weekly: anything not currently ok is fetched in full; ok accounts go through change detection.
        self.assertEqual(select_accounts("weekly", stored, wanted, SAT_NORMAL), (["E", "N", "NEW"], True))
        self.assertEqual(select_accounts("weekly", stored, wanted, SAT_RECONCILE), (wanted, False))
        with self.assertRaises(ValueError):
            select_accounts("sometimes", stored, wanted, SAT_NORMAL)


if __name__ == "__main__":
    unittest.main()

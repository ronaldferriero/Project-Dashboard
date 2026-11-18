import json
import re
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crm_schema  # noqa: E402
import fetch_crm_arr as f  # noqa: E402
from crm_agent import AGENT_READ_ONLY, AgentHttpError, AgentReplyError  # noqa: E402
from crm_arr_store import AccountEntry, load_store, save_store  # noqa: E402

UTC = timezone.utc
SAT_NORMAL = datetime(2026, 11, 14, 6, 0, tzinfo=UTC)
SAT_RECONCILE = datetime(2026, 11, 7, 6, 0, tzinfo=UTC)
GUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
EPL = "Enterprise Permitting & Licensing"


def guid(n):
    return f"00000000-0000-0000-0000-{n:012d}"


class FakeCrm:
    """Answers the fetcher's prompts the way the agent + Dynamics would, and records every call."""

    def __init__(self):
        self.accounts = {}  # number -> [(guid, name, parent_guid)]
        self.items = {}  # guid -> [(amount, division)]
        self.changed = set()  # guids with items modified since the last check
        self.prose_for = set()  # guids whose totals reply is prose
        self.short_page_for = set()  # guids whose totals pages come back one row short
        self.http_fail_numbers = set()  # account lookups containing these numbers fail with HTTP 401
        self.calls = []
        self._lock = threading.Lock()

    def run_json(self, prompt, purpose):
        with self._lock:
            self.calls.append((purpose, prompt))
        if purpose == "accounts":
            numbers = re.findall(r"accountnumber eq '(\d+)'", prompt)
            if self.http_fail_numbers & set(numbers):
                raise AgentHttpError("CRM agent request failed (HTTP 401). Check FOUNDRY_API_KEY and FOUNDRY_TENANT.", 401)
            return [[g, n, name, parent] for n in numbers for (g, name, parent) in self.accounts.get(n, [])]
        guids = GUID_RE.findall(prompt)
        if purpose == "totals":
            if self.prose_for & set(guids):
                raise AgentReplyError("Agent reply had no JSON: I could not find that.")
            rows = [[amount, division] for g in guids for (amount, division) in self.items.get(g, [])]
            skip = int(re.search(r"skip (\d+)", prompt).group(1))
            top = int(re.search(r"top (\d+)", prompt).group(1))
            page = rows[skip:skip + top]
            if self.short_page_for & set(guids):
                page = page[:-1]  # the agent drops a row, as long replies sometimes do
            return {"total": len(rows), "rows": page}
        if purpose == "changes":
            return {"ids": [g for g in guids if g in self.changed]}
        raise AssertionError(f"unexpected purpose {purpose}")

    def prompts(self, purpose):
        return [p for (kind, p) in self.calls if kind == purpose]


class FetcherTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.projects_path = base / "projects.json"
        self.paths = {
            "store_path": base / "crm" / "crm_arr.json",
            "js_path": base / "crm" / "crm_arr.js",
            "changes_path": base / "crm" / "crm_arr_changes.json",
            "lock_path": base / "crm" / ".lock",
        }
        self.crm = FakeCrm()

    def tearDown(self):
        self._tmp.cleanup()

    def write_projects(self, *titles):
        self.projects_path.write_text(json.dumps({"projects": [{"title": t} for t in titles]}), encoding="utf-8")

    def run_mode(self, mode, now=SAT_NORMAL):
        return f.run(mode, agent=self.crm, projects_path=self.projects_path, now=now, **self.paths)

    def stored(self):
        return load_store(self.paths["store_path"])

    def seed(self, accounts, last_weekly_check="2026-11-07T06:00:00+00:00"):
        store = load_store(self.paths["store_path"])
        store["last_weekly_check"] = last_weekly_check
        for entry in accounts:
            store["accounts"][entry.account_number] = entry.__dict__
        save_store(store, self.paths["store_path"], self.paths["js_path"])

    def add_client(self, number, n, items, name=None):
        self.crm.accounts[number] = [(guid(n), name or f"Client {number}", None)]
        self.crm.items[guid(n)] = items


class PromptTests(unittest.TestCase):
    def test_every_prompt_is_read_only_single_tool(self):
        prompts = [
            f.accounts_prompt(["42004", "1007"]),
            f.item_totals_prompt([guid(1), guid(2)]),
            f.changed_accounts_prompt([guid(1)], "2026-11-07T06:00:00+00:00"),
        ]
        for prompt in prompts:
            self.assertTrue(prompt.startswith(AGENT_READ_ONLY), prompt[:80])
            self.assertIn("Make exactly ONE tool call: dynamic_odata_query", prompt)
            self.assertIn("Do not call any other tool", prompt)

    def test_accounts_prompt_filters_active_accounts_by_number(self):
        prompt = f.accounts_prompt(["42004", "1007"])
        self.assertIn('entitySet "accounts"', prompt)
        self.assertIn("(accountnumber eq '42004' or accountnumber eq '1007') and statecode eq 0", prompt)
        self.assertIn("_parentaccountid_value", prompt)

    def test_accounts_prompt_rejects_bad_numbers(self):
        for bad in ("1 or 1 eq 1", "42'004", ""):
            with self.assertRaises(ValueError):
                f.accounts_prompt(["42004", bad])

    def test_family_totals_cover_every_account(self):
        prompt = f.item_totals_prompt([guid(1), guid(2), guid(3)])
        self.assertIn(f'entitySet "{crm_schema.ITEM_ENTITY_SET}"', prompt)
        self.assertIn(
            f"{crm_schema.ITEM_ACTIVE_FILTER} and (_tyl_accountid_value eq {guid(1)} or _tyl_accountid_value eq {guid(2)} "
            f"or _tyl_accountid_value eq {guid(3)})",
            prompt,
        )
        self.assertIn("tyl_productarr", prompt)
        self.assertIn("_tyl_divisionbusinessunitid_value", prompt)
        # Paged, in a stable order, with Dynamics' own record count.
        self.assertIn(f"top {f.PAGE_SIZE}", prompt)
        self.assertIn("skip 0", prompt)
        self.assertIn("orderby tyl_customerproductitemid", prompt)
        self.assertIn("count true", prompt)
        self.assertIn("skip 50", f.item_totals_prompt([guid(1)], skip=50))

    def test_prompts_reject_bad_guids_and_timestamps(self):
        with self.assertRaises(ValueError):
            f.item_totals_prompt([guid(1), "x' or 1 eq 1"])
        with self.assertRaises(ValueError):
            f.changed_accounts_prompt([guid(1)], "2026-11-07 or 1 eq 1")

    def test_changed_accounts_prompt_uses_modified_since(self):
        prompt = f.changed_accounts_prompt([guid(1), guid(2)], "2026-11-07T06:00:00+00:00")
        self.assertIn(
            f"modifiedon gt 2026-11-07T06:00:00Z and (_tyl_accountid_value eq {guid(1)} or _tyl_accountid_value eq {guid(2)})",
            prompt,
        )


class ParsingTests(unittest.TestCase):
    def test_resolve_accounts_statuses(self):
        parent, child1, child2, other = guid(1), guid(2), guid(3), guid(4)
        rows = [
            [guid(9), "5088", "Cerritos, CA City of", None],
            [parent, "42004", "Abilene, TX City of", None],
            [child1, "42004", "Example Department A", parent],
            [child2, 42004, "Example Department B", parent],
            [guid(5), "1007", "Albany County", None],
            [other, "1007", "Albany County Sheriff", None],
        ]
        resolved = f.resolve_accounts(rows, ["5088", "42004", "1007", "5059"])

        self.assertEqual(resolved["5059"].status, "not_found")
        self.assertEqual(resolved["5059"].reason, "Account 5059 not found in CRM")

        self.assertEqual(resolved["5088"].status, "ok")
        self.assertEqual(resolved["5088"].account_ids, [guid(9)])

        self.assertEqual(resolved["42004"].status, "ok")
        self.assertEqual(sorted(resolved["42004"].account_ids), sorted([parent, child1, child2]))
        self.assertEqual(resolved["42004"].account_name, "Abilene, TX City of")

        self.assertEqual(resolved["1007"].status, "ambiguous")
        self.assertEqual(resolved["1007"].reason, "Account Number 1007 has 2 separate top-level CRM accounts")
        self.assertEqual(sorted(resolved["1007"].matches), ["Albany County", "Albany County Sheriff"])

    def test_resolve_accounts_rejects_bad_guids_from_the_agent(self):
        with self.assertRaises(AgentReplyError):
            f.resolve_accounts([["not-a-guid' or 1 eq 1", "42004", "X", None]], ["42004"])

    def test_amount_parsing(self):
        self.assertEqual(f.parse_amount("$120,000.00"), 120000.0)
        self.assertEqual(f.parse_amount("120000"), 120000.0)
        self.assertEqual(f.parse_amount(None), 0.0)
        self.assertEqual(f.parse_amount(""), 0.0)
        self.assertEqual(f.parse_amount(2500), 2500.0)
        self.assertEqual(f.parse_amount(2500.5), 2500.5)
        for bad in ("abc", True, [1]):
            with self.assertRaises(ValueError):
                f.parse_amount(bad)

    def test_epl_division_matching_is_tolerant(self):
        for label in ("Enterprise Permitting &amp; Licensing", "enterprise permitting & licensing ", "Enterprise  Permitting & Licensing"):
            self.assertTrue(f.is_epl(label), label)
        for label in ("Data & Insights", None, "", "Enterprise Permitting"):
            self.assertFalse(f.is_epl(label), label)

    def test_sum_item_rows(self):
        rows = [[120000, "Data & Insights"], [2500, EPL], [None, "Content Manager"]]
        self.assertEqual(f.sum_item_rows(rows), (122500.0, 2500.0))
        with self.assertRaises(AgentReplyError):
            f.sum_item_rows([["abc", EPL]])

    def test_total_comes_from_dynamics_count(self):
        # The expected page length comes from Dynamics' record count, not from the agent's own tally.
        self.assertEqual(f.page_from_reply({"total": 3, "rows": [[1, EPL]] * 3}, skip=0), (3, [[1, EPL]] * 3))
        self.assertEqual(f.page_from_reply({"total": 30, "rows": [[1, EPL]] * 5}, skip=25)[0], 30)
        with self.assertRaises(AgentReplyError):
            f.page_from_reply({"total": 30, "rows": [[1, EPL]] * 24}, skip=0)  # first page must hold 25
        with self.assertRaises(AgentReplyError):
            f.page_from_reply({"total": 30, "rows": [[1, EPL]] * 6}, skip=25)  # last page must hold exactly 5
        for bad in (None, [], {"rows": [[1, EPL]]}, {"total": "3", "rows": []}, {"total": 1, "rows": [[1]]}):
            with self.assertRaises(AgentReplyError, msg=repr(bad)):
                f.page_from_reply(bad, skip=0)


class RunTests(FetcherTest):
    def test_paged_totals_combine_pages(self):
        self.write_projects("Big County - 7001")
        items = [[100, EPL] if i % 3 == 0 else [10, "Enterprise ERP"] for i in range(60)]
        self.add_client("7001", 1, items)

        summary = self.run_mode("initial")

        entry = self.stored()["accounts"]["7001"]
        self.assertEqual(entry["status"], "ok")
        self.assertEqual(entry["item_count"], 60)
        self.assertEqual(entry["epl_arr"], 2000.0)  # 20 EPL items x 100
        self.assertEqual(entry["total_arr"], 2400.0)  # + 40 x 10
        self.assertEqual([re.search(r"skip (\d+)", p).group(1) for p in self.crm.prompts("totals")], ["0", "25", "50"])
        self.assertEqual(summary.errors, 0)

    def test_short_page_is_retried_then_errors(self):
        self.write_projects("Big County - 7001")
        self.add_client("7001", 1, [[1, EPL]] * 30)
        self.crm.short_page_for.add(guid(1))

        summary = self.run_mode("initial")

        entry = self.stored()["accounts"]["7001"]
        self.assertEqual(entry["status"], "error")
        self.assertIsNone(entry["total_arr"])
        self.assertEqual(len(self.crm.prompts("totals")), 2)  # first page, then one retry
        self.assertEqual(summary.errors, 1)

    def test_initial_load_stores_family_totals(self):
        self.write_projects("Abilene, TX City of - 42004", "Barstow, CA City of - 5059", "No Number Project")
        parent, child = guid(1), guid(2)
        self.crm.accounts["42004"] = [(parent, "Abilene, TX City of", None), (child, "Example Department A", parent)]
        self.crm.items[parent] = [[120000, "Data & Insights"], [2500, EPL], [None, "Content Manager"]]
        self.crm.items[child] = [[1000, EPL]]

        summary = self.run_mode("initial")

        accounts = self.stored()["accounts"]
        self.assertEqual(accounts["42004"]["status"], "ok")
        self.assertEqual(accounts["42004"]["total_arr"], 123500.0)
        self.assertEqual(accounts["42004"]["epl_arr"], 3500.0)
        self.assertEqual(accounts["42004"]["item_count"], 4)
        self.assertEqual(accounts["42004"]["account_name"], "Abilene, TX City of")
        self.assertEqual(accounts["5059"]["status"], "not_found")
        self.assertEqual((summary.checked, summary.not_found, summary.errors), (2, 1, 0))
        self.assertEqual(summary.skipped_no_number, ["No Number Project"])
        self.assertEqual(self.stored()["last_weekly_check"], "2026-11-14T06:00:00+00:00")
        js = self.paths["js_path"].read_text(encoding="utf-8")
        self.assertNotIn(parent, js)

    def test_bad_reply_keeps_previous_values(self):
        self.write_projects("Abilene, TX City of - 42004")
        self.add_client("42004", 1, [[1, EPL]])
        self.seed([AccountEntry("42004", "ok", account_name="Abilene", account_ids=[guid(1)], total_arr=612400.0, epl_arr=148900.0, item_count=3)])
        self.crm.prose_for.add(guid(1))

        summary = self.run_mode("force")

        entry = self.stored()["accounts"]["42004"]
        self.assertEqual(entry["status"], "error")
        self.assertEqual((entry["total_arr"], entry["epl_arr"]), (612400.0, 148900.0))
        self.assertEqual(summary.errors, 1)
        self.assertEqual(len(self.crm.prompts("totals")), 2)  # retried once

    def test_http_failure_mid_run_saves_progress(self):
        self.write_projects("Client A - 1001", "Client B - 1002")
        self.add_client("1001", 1, [[100, EPL]])
        self.add_client("1002", 2, [[200, EPL]])
        self.crm.http_fail_numbers.add("1002")

        with mock.patch.object(f, "ACCOUNT_BATCH", 1), mock.patch.object(f, "CONCURRENCY", 1), \
                mock.patch.object(f, "save_store", wraps=f.save_store) as saves:
            summary = self.run_mode("initial")

        accounts = self.stored()["accounts"]
        self.assertEqual(accounts["1001"]["status"], "ok")
        self.assertEqual(accounts["1001"]["total_arr"], 100.0)
        self.assertEqual(accounts["1002"]["status"], "error")
        self.assertIn("HTTP 401", accounts["1002"]["reason"])
        self.assertTrue(summary.foundry_failed)
        self.assertGreaterEqual(summary.errors, 1)
        self.assertGreaterEqual(saves.call_count, 2)  # after each batch, plus the run summary
        self.assertIsNone(self.stored()["last_weekly_check"])  # a failed run is not a completed check

    def test_weekly_only_refetches_changed_accounts(self):
        self.write_projects("Client A - 1001", "Client B - 1002", "Client C - 1003")
        for n, number in enumerate(("1001", "1002", "1003"), start=1):
            self.add_client(number, n, [[n * 100, EPL]])
        self.seed([
            AccountEntry(num, "ok", account_ids=[guid(n)], total_arr=1.0, epl_arr=1.0, item_count=1)
            for n, num in enumerate(("1001", "1002", "1003"), start=1)
        ])
        self.crm.changed.add(guid(2))

        summary = self.run_mode("weekly", now=SAT_NORMAL)

        totals = self.crm.prompts("totals")
        self.assertEqual(len(totals), 1)
        self.assertIn(guid(2), totals[0])
        self.assertIn("modifiedon gt 2026-11-07T06:00:00Z", self.crm.prompts("changes")[0])
        store = self.stored()
        self.assertEqual(store["accounts"]["1002"]["total_arr"], 200.0)
        self.assertEqual(store["accounts"]["1001"]["total_arr"], 1.0)
        self.assertEqual(store["accounts"]["1001"]["last_checked"], "2026-11-14T06:00:00+00:00")
        self.assertEqual(store["last_weekly_check"], "2026-11-14T06:00:00+00:00")
        self.assertIsNone(store["last_full_reconcile"])
        self.assertEqual(summary.checked, 3)

    def test_weekly_on_first_weekend_reconciles_everything(self):
        self.write_projects("Client A - 1001", "Client B - 1002")
        self.add_client("1001", 1, [[100, EPL]])
        self.add_client("1002", 2, [[200, EPL]])
        self.seed([AccountEntry(num, "ok", account_ids=[guid(n)], total_arr=1.0, epl_arr=1.0) for n, num in ((1, "1001"), (2, "1002"))],
                  last_weekly_check="2026-10-31T06:00:00+00:00")

        self.run_mode("weekly", now=SAT_RECONCILE)

        self.assertEqual(len(self.crm.prompts("totals")), 2)
        self.assertEqual(self.crm.prompts("changes"), [])
        self.assertEqual(self.stored()["last_full_reconcile"], "2026-11-07T06:00:00+00:00")

    def test_weekly_without_change_detection_refetches_all(self):
        self.write_projects("Client A - 1001", "Client B - 1002", "Client C - 1003")
        for n, number in enumerate(("1001", "1002", "1003"), start=1):
            self.add_client(number, n, [[n * 100, EPL]])
        self.seed([AccountEntry(num, "ok", account_ids=[guid(n)], total_arr=1.0, epl_arr=1.0)
                   for n, num in enumerate(("1001", "1002", "1003"), start=1)])

        with mock.patch.object(crm_schema, "SUPPORTS_CHANGE_DETECTION", False):
            self.run_mode("weekly", now=SAT_NORMAL)

        self.assertEqual(len(self.crm.prompts("totals")), 3)
        self.assertEqual(self.crm.prompts("changes"), [])

    def test_new_only_skips_stored_accounts(self):
        self.write_projects("Client A - 1001", "Client B - 1002")
        self.add_client("1001", 1, [[100, EPL]])
        self.add_client("1002", 2, [[200, EPL]])
        self.seed([AccountEntry("1001", "ok", account_ids=[guid(1)], total_arr=1.0, epl_arr=1.0)])

        self.run_mode("new-only")

        account_prompts = self.crm.prompts("accounts")
        self.assertEqual(len(account_prompts), 1)
        self.assertIn("'1002'", account_prompts[0])
        self.assertNotIn("'1001'", account_prompts[0])
        self.assertEqual(self.stored()["accounts"]["1001"]["total_arr"], 1.0)
        self.assertEqual(self.stored()["last_weekly_check"], "2026-11-07T06:00:00+00:00")  # unchanged

    def test_change_log_written_on_arr_change(self):
        self.write_projects("Client A - 1001")
        self.add_client("1001", 1, [[150, EPL], [50, "Data & Insights"]])
        self.seed([AccountEntry("1001", "ok", account_ids=[guid(1)], total_arr=100.0, epl_arr=100.0)])

        summary = self.run_mode("force")

        log = json.loads(self.paths["changes_path"].read_text(encoding="utf-8"))
        self.assertEqual(
            [(c["account_number"], c["field"], c["old"], c["new"]) for c in log],
            [("1001", "total_arr", 100.0, 200.0), ("1001", "epl_arr", 100.0, 150.0)],
        )
        self.assertEqual(summary.changed, 1)

    def test_weekly_if_overdue_noop_when_recent(self):
        self.write_projects("Client A - 1001")
        self.add_client("1001", 1, [[100, EPL]])
        recent = (SAT_NORMAL - timedelta(days=2)).isoformat()
        self.seed([AccountEntry("1001", "ok", account_ids=[guid(1)], total_arr=1.0, epl_arr=1.0)], last_weekly_check=recent)

        summary = self.run_mode("weekly-if-overdue")

        self.assertEqual(self.crm.calls, [])
        self.assertEqual(summary.checked, 0)

    def test_weekly_if_overdue_runs_weekly_when_overdue(self):
        self.write_projects("Client A - 1001")
        self.add_client("1001", 1, [[100, EPL]])
        old = (SAT_NORMAL - timedelta(days=9)).isoformat()
        self.seed([AccountEntry("1001", "ok", account_ids=[guid(1)], total_arr=1.0, epl_arr=1.0)], last_weekly_check=old)

        summary = self.run_mode("weekly-if-overdue")

        self.assertEqual(len(self.crm.prompts("changes")), 1)
        self.assertEqual(summary.mode, "weekly")


class CliTests(unittest.TestCase):
    def test_cli_exits_2_without_key(self):
        with mock.patch.object(f, "read_config", return_value=f.FoundryConfig("https://x", "dev", "a", None)):
            self.assertEqual(f.main(["--weekly"]), 2)

    def test_cli_requires_exactly_one_mode(self):
        with self.assertRaises(SystemExit):
            f.main([])
        with self.assertRaises(SystemExit):
            f.main(["--weekly", "--force"])


if __name__ == "__main__":
    unittest.main()

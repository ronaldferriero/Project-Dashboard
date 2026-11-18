#!/usr/bin/env python3
"""Fetch client Total ARR and EPL ARR from Dynamics (through the Foundry agent) into the local CRM store.

A client is every active CRM account sharing the Account Number at the end of a project title (a top-level
account plus its department accounts). ARR is the sum of `tyl_productarr` over the family's active customer
product items; EPL ARR counts only items in the Enterprise Permitting & Licensing division. The agent returns
rows; this code does the arithmetic.

Modes:
  --initial            fetch every active project's client
  --force              same as --initial
  --new-only           only clients never fetched before
  --weekly             change check (first weekend of the month: re-fetch everything)
  --weekly-if-overdue  --weekly, but only when the last weekly check is more than 8 days old
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import crm_schema
from crm_agent import (
    AGENT_READ_ONLY,
    AgentClient,
    AgentError,
    AgentReplyError,
    FoundryConfig,
    assert_account_number,
    assert_guid,
    has_key,
    read_config,
)
from crm_arr_store import (
    CHANGES_PATH,
    JS_PATH,
    LOCK_PATH,
    ROOT,
    STORE_PATH,
    AccountEntry,
    account_numbers_for_projects,
    entry_from_dict,
    is_reconcile_weekend,
    iso,
    load_store,
    merge_entry,
    parse_iso,
    record_changes,
    save_store,
    select_accounts,
    store_lock,
    weekly_overdue,
)

PROJECTS_PATH = ROOT / "dashboard" / "data" / "projects.json"
EPL_DIVISION = "Enterprise Permitting & Licensing"
ACCOUNT_BATCH = 12
CONCURRENCY = 4
# The agent's tool output is cut off at roughly 50 item records, so items are read in pages.
PAGE_SIZE = 25
MAX_PAGES = 40
CHANGE_ID_BATCH = 24

ONE_CALL = "Do not call any other tool."
JSON_ONLY = "Reply with ONLY one fenced ```json block. No prose."


@dataclass
class RunSummary:
    mode: str
    checked: int = 0
    changed: int = 0
    not_found: int = 0
    ambiguous: int = 0
    errors: int = 0
    skipped_no_number: list[str] = field(default_factory=list)
    foundry_failed: bool = False
    not_found_numbers: list[str] = field(default_factory=list)
    ambiguous_numbers: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ prompts

def _query(entity_set: str, filter_: str, select: str, top: int) -> str:
    return (
        f'Make exactly ONE tool call: dynamic_odata_query with entitySet "{entity_set}", filter "{filter_}", '
        f'select "{select}", top {top}, including formatted values. {ONE_CALL}'
    )


def _any_of(attribute: str, guids: list[str]) -> str:
    return "(" + " or ".join(f"{attribute} eq {assert_guid(g)}" for g in guids) + ")"


def accounts_prompt(numbers: list[str]) -> str:
    numbers = [assert_account_number(n) for n in numbers]
    numbers_filter = " or ".join(f"{crm_schema.ACCOUNT_NUMBER_FIELD} eq '{n}'" for n in numbers)
    return "\n".join([
        AGENT_READ_ONLY,
        _query(
            "accounts",
            f"({numbers_filter}) and statecode eq 0",
            f"accountid,{crm_schema.ACCOUNT_NUMBER_FIELD},name,{crm_schema.ACCOUNT_PARENT_FIELD}",
            500,
        ),
        f"{JSON_ONLY} Shape: an array with one entry per record: [accountid, accountnumber, name, "
        f"{crm_schema.ACCOUNT_PARENT_FIELD} GUID or null]. Copy every record exactly.",
    ])


def item_totals_prompt(account_ids: list[str], skip: int = 0) -> str:
    """One page of the family's active product items, in a stable order, with Dynamics' total record count."""
    accounts_filter = _any_of(crm_schema.ITEM_ACCOUNT_FIELD, account_ids)
    skip = int(skip)
    return "\n".join([
        AGENT_READ_ONLY,
        f'Make exactly ONE tool call: dynamic_odata_query with entitySet "{crm_schema.ITEM_ENTITY_SET}", '
        f'filter "{crm_schema.ITEM_ACTIVE_FILTER} and {accounts_filter}", '
        f'select "{crm_schema.ITEM_AMOUNT_FIELD},{crm_schema.ITEM_DIVISION_FIELD}", '
        f"orderby tyl_customerproductitemid, top {PAGE_SIZE}, skip {skip}, count true, including formatted values. {ONE_CALL}",
        f'{JSON_ONLY} Shape: {{"total": <the @odata.count value Dynamics returned>, "rows": [[{crm_schema.ITEM_AMOUNT_FIELD} '
        f"as a plain number or null, {crm_schema.ITEM_DIVISION_FIELD} formatted label], ...]}} with one row per record "
        "returned. Copy every record; do not add, total or summarize amounts.",
    ])


def changed_accounts_prompt(account_ids: list[str], since: str) -> str:
    when = parse_iso(since)
    if when is None:
        raise ValueError("A change check needs a start time")
    stamp = when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    accounts_filter = _any_of(crm_schema.ITEM_ACCOUNT_FIELD, account_ids)
    return "\n".join([
        AGENT_READ_ONLY,
        _query(
            crm_schema.ITEM_ENTITY_SET,
            f"{crm_schema.ITEM_MODIFIED_FIELD} gt {stamp} and {accounts_filter}",
            crm_schema.ITEM_ACCOUNT_FIELD,
            5000,
        ),
        f'{JSON_ONLY} Shape: {{"ids": [every distinct {crm_schema.ITEM_ACCOUNT_FIELD} GUID in the results]}}.',
    ])


# ------------------------------------------------------------------ parsing

def resolve_accounts(rows: list, numbers: list[str]) -> dict[str, AccountEntry]:
    """Groups the account lookup by Account Number; a client is the whole parent + department family."""
    if not isinstance(rows, list):
        raise AgentReplyError(f"Account lookup did not return a list: {json.dumps(rows)[:200]}")
    groups: dict[str, list[tuple[str, str, str | None]]] = {n: [] for n in numbers}
    for row in rows:
        if not isinstance(row, list) or len(row) < 3:
            raise AgentReplyError(f"Malformed account row: {json.dumps(row)[:200]}")
        number = str(row[1]).strip()
        if number not in groups:
            continue
        try:
            account_id = assert_guid(str(row[0]))
            parent = assert_guid(str(row[3])) if len(row) > 3 and row[3] else None
        except ValueError as error:
            raise AgentReplyError(f"Account lookup returned an invalid id: {error}") from None
        groups[number].append((account_id, str(row[2] or "").strip(), parent))

    resolved: dict[str, AccountEntry] = {}
    for number, accounts in groups.items():
        if not accounts:
            resolved[number] = AccountEntry(number, "not_found", reason=f"Account {number} not found in CRM")
            continue
        ids = [a[0] for a in accounts]
        roots = [a for a in accounts if a[2] not in ids]
        if len(roots) != 1:
            resolved[number] = AccountEntry(
                number,
                "ambiguous",
                account_ids=ids,
                matches=[name for _, name, _ in roots],
                reason=f"Account Number {number} has {len(roots)} separate top-level CRM accounts",
            )
            continue
        resolved[number] = AccountEntry(number, "ok", account_name=roots[0][1], account_ids=ids)
    return resolved


def parse_amount(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, bool):
        raise ValueError(f"Not an amount: {value!r}")
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace("$", "").replace(",", "").strip()
        return float(cleaned) if cleaned else 0.0
    raise ValueError(f"Not an amount: {value!r}")


def _normalize_label(label: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(label)).strip().casefold()


def is_epl(division: str | None) -> bool:
    return bool(division) and _normalize_label(division) == _normalize_label(EPL_DIVISION)


def page_from_reply(reply: Any, skip: int) -> tuple[int, list]:
    """(Dynamics' total record count, this page's rows). The page must hold exactly the rows Dynamics has there."""
    if not isinstance(reply, dict) or not isinstance(reply.get("rows"), list) or not isinstance(reply.get("total"), int) \
            or isinstance(reply.get("total"), bool) or reply["total"] < 0:
        raise AgentReplyError(f"Item page reply had no total/rows: {json.dumps(reply)[:200]}")
    total, rows = reply["total"], reply["rows"]
    expected = max(0, min(PAGE_SIZE, total - skip))
    if len(rows) != expected:
        raise AgentReplyError(f"Agent returned {len(rows)} of {expected} item rows (records {skip + 1}-{skip + expected} of {total})")
    for row in rows:
        if not isinstance(row, list) or len(row) < 2:
            raise AgentReplyError(f"Malformed item row: {json.dumps(row)[:200]}")
    return total, rows


def sum_item_rows(rows: list) -> tuple[float, float]:
    """(Total ARR, EPL ARR) over item rows. The arithmetic happens here, never in the agent."""
    total = epl = 0.0
    for row in rows:
        try:
            amount = parse_amount(row[0])
        except ValueError as error:
            raise AgentReplyError(str(error)) from None
        total += amount
        if is_epl(row[1] if isinstance(row[1], str) else None):
            epl += amount
    return round(total, 2), round(epl, 2)


# ------------------------------------------------------------------ orchestration

def _chunks(values: list, size: int) -> list[list]:
    return [values[i:i + size] for i in range(0, len(values), size)]


def _fetch_page(agent: AgentClient, account_ids: list[str], skip: int) -> tuple[int, list]:
    try:
        return page_from_reply(agent.run_json(item_totals_prompt(account_ids, skip), "totals"), skip)
    except AgentReplyError:
        return page_from_reply(agent.run_json(item_totals_prompt(account_ids, skip), "totals"), skip)


def _fetch_totals(agent: AgentClient, account_ids: list[str]) -> tuple[float, float, int]:
    """Reads every page of the family's active items, then sums them. Each page is retried once."""
    rows: list = []
    total, page_rows = _fetch_page(agent, account_ids, 0)
    rows.extend(page_rows)
    pages = 1
    while len(rows) < total:
        if pages >= MAX_PAGES:
            raise AgentReplyError(f"More than {MAX_PAGES * PAGE_SIZE} active items; totals would be incomplete")
        page_total, page_rows = _fetch_page(agent, account_ids, len(rows))
        if page_total != total:
            raise AgentReplyError(f"Item count changed while paging ({total} -> {page_total}); try again later")
        rows.extend(page_rows)
        pages += 1
    arr, epl = sum_item_rows(rows)
    return arr, epl, len(rows)


def _fetch_batch(agent: AgentClient, numbers: list[str], now: datetime) -> tuple[list[AccountEntry], bool]:
    """Full fetch for a batch of Account Numbers. Returns (entries, whether Foundry itself failed)."""
    stamp = iso(now)
    try:
        resolved = resolve_accounts(agent.run_json(accounts_prompt(numbers), "accounts"), numbers)
    except AgentReplyError as error:
        return [AccountEntry(n, "error", reason=str(error)[:300], last_checked=stamp) for n in numbers], False
    except AgentError as error:
        return [AccountEntry(n, "error", reason=str(error)[:300], last_checked=stamp) for n in numbers], True

    entries = []
    for number, entry in resolved.items():
        entry.last_checked = stamp
        if entry.status == "ok":
            try:
                entry.total_arr, entry.epl_arr, entry.item_count = _fetch_totals(agent, entry.account_ids)
                entry.fetched_at = stamp
            except AgentReplyError as error:
                entry = AccountEntry(number, "error", reason=str(error)[:300], last_checked=stamp)
            except AgentError as error:
                failed = [AccountEntry(n, "error", reason=str(error)[:300], last_checked=stamp)
                          for n in resolved if n not in {e.account_number for e in entries}]
                return entries + failed, True
        entries.append(entry)
    return entries, False


def run(
    mode: str,
    *,
    agent: AgentClient,
    projects_path: Path = PROJECTS_PATH,
    now: datetime | None = None,
    store_path: Path = STORE_PATH,
    js_path: Path = JS_PATH,
    changes_path: Path = CHANGES_PATH,
    lock_path: Path = LOCK_PATH,
) -> RunSummary:
    now = now or datetime.now(timezone.utc)
    projects = json.loads(projects_path.read_text(encoding="utf-8")).get("projects", [])
    titles_by_number, no_number = account_numbers_for_projects(projects)
    wanted = sorted(titles_by_number)
    store = load_store(store_path)
    summary = RunSummary(mode=mode, skipped_no_number=no_number)

    if mode == "weekly-if-overdue":
        if not weekly_overdue(store, now):
            return summary
        mode = summary.mode = "weekly"

    reconcile = mode == "weekly" and is_reconcile_weekend(now)
    full, change_check = select_accounts(mode, store, wanted, now)
    if change_check and not crm_schema.SUPPORTS_CHANGE_DETECTION:
        print("Change detection unavailable; re-checked all accounts.")
        full, change_check = wanted, False

    unchanged: list[str] = []
    if change_check:
        stored = store["accounts"]
        candidates = [n for n in wanted if n not in full and stored.get(n, {}).get("status") == "ok"]
        number_by_id = {g: n for n in candidates for g in (stored[n].get("account_ids") or [])}
        since = store.get("last_weekly_check") or iso(now - timedelta(days=8))
        changed_numbers: set[str] = set()
        try:
            for batch in _chunks(sorted(number_by_id), CHANGE_ID_BATCH):
                reply = agent.run_json(changed_accounts_prompt(batch, since), "changes")
                ids = reply.get("ids") if isinstance(reply, dict) else None
                if not isinstance(ids, list):
                    raise AgentReplyError(f"Change check did not return ids: {json.dumps(reply)[:200]}")
                for value in ids:
                    number = number_by_id.get(assert_guid(str(value)))
                    if number:
                        changed_numbers.add(number)
        except (AgentError, ValueError) as error:
            print(f"Change check failed: {str(error)[:300]}", file=sys.stderr)
            summary.foundry_failed = True
            summary.errors += 1
            candidates, changed_numbers = [], set()
        full = sorted(set(full) | changed_numbers)
        unchanged = [n for n in candidates if n not in changed_numbers]

    changed_accounts: set[str] = set()

    def save_entries(entries: list[AccountEntry]) -> None:
        with store_lock(lock_path, wait=True):
            current = load_store(store_path)
            for entry in entries:
                previous_raw = current["accounts"].get(entry.account_number)
                previous = entry_from_dict(previous_raw) if previous_raw else None
                if record_changes(previous, entry, now, changes_path):
                    changed_accounts.add(entry.account_number)
                current["accounts"][entry.account_number] = asdict(merge_entry(previous, entry))
            save_store(current, store_path, js_path)

    if full:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            futures = [pool.submit(_fetch_batch, agent, batch, now) for batch in _chunks(full, ACCOUNT_BATCH)]
            for future in as_completed(futures):
                entries, failed = future.result()
                summary.foundry_failed = summary.foundry_failed or failed
                save_entries(entries)
                for entry in entries:
                    if entry.status == "not_found":
                        summary.not_found_numbers.append(entry.account_number)
                    elif entry.status == "ambiguous":
                        summary.ambiguous_numbers.append(entry.account_number)
                    elif entry.status == "error":
                        summary.errors += 1

    summary.checked = len(full) + len(unchanged)
    summary.changed = len(changed_accounts)
    summary.not_found = len(summary.not_found_numbers)
    summary.ambiguous = len(summary.ambiguous_numbers)

    with store_lock(lock_path, wait=True):
        final = load_store(store_path)
        for number in unchanged:
            if number in final["accounts"]:
                final["accounts"][number]["last_checked"] = iso(now)
        final["generated_at"] = iso(now)
        if mode in ("initial", "force", "weekly") and not summary.foundry_failed:
            final["last_weekly_check"] = iso(now)
            if mode != "weekly" or reconcile:
                final["last_full_reconcile"] = iso(now)
        final["last_run"] = {**asdict(summary), "at": iso(now)}
        save_store(final, store_path, js_path)
    return summary


# ------------------------------------------------------------------ CLI

def _print_summary(summary: RunSummary) -> None:
    print(
        f"CRM ARR {summary.mode}: checked {summary.checked}, changed {summary.changed}, "
        f"not found {summary.not_found}, ambiguous {summary.ambiguous}, errors {summary.errors}"
    )
    if summary.foundry_failed:
        print("Foundry request failed during this run; affected clients keep their last stored values.")
    if summary.not_found_numbers:
        print("Not found in CRM: " + ", ".join(sorted(summary.not_found_numbers)))
    if summary.ambiguous_numbers:
        print("More than one top-level account: " + ", ".join(sorted(summary.ambiguous_numbers)))
    if summary.skipped_no_number:
        print("No account number in title: " + "; ".join(summary.skipped_no_number))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    modes = parser.add_mutually_exclusive_group(required=True)
    for name in ("initial", "force", "new-only", "weekly", "weekly-if-overdue"):
        modes.add_argument(f"--{name}", dest="mode", action="store_const", const=name)
    args = parser.parse_args(argv)

    config: FoundryConfig = read_config()
    if not has_key(config):
        print("No Foundry API key configured (FOUNDRY_API_KEY or FoundryAPIKey in Analyst CoPilot's .env); skipping CRM ARR.")
        return 2
    summary = run(args.mode, agent=AgentClient(config))
    _print_summary(summary)
    return 1 if summary.errors or summary.foundry_failed else 0


if __name__ == "__main__":
    sys.exit(main())

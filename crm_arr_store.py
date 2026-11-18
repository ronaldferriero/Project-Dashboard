"""Local store for CRM ARR: account numbers, the stored values, the change log and run-mode selection.

Everything here is local and git-ignored (dashboard/data/crm/). No network calls.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import tempfile
from contextlib import contextmanager
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

ROOT = Path(__file__).resolve().parent
CRM_DIR = ROOT / "dashboard" / "data" / "crm"
STORE_PATH = CRM_DIR / "crm_arr.json"
JS_PATH = CRM_DIR / "crm_arr.js"
CHANGES_PATH = CRM_DIR / "crm_arr_changes.json"
LOCK_PATH = CRM_DIR / ".crm_arr.lock"

JS_VARIABLE = "CRM_ARR_DATA"
STATUSES = ("ok", "not_found", "ambiguous", "error")
MODES = ("initial", "force", "new-only", "weekly")

# The Account Number ends the title, after a dash and optionally a two-letter state code:
# "Abilene, TX City of - 42004", "Yuba County - CA 48397".
TITLE_ACCOUNT_NUMBER = re.compile(r"-\s*(?:[A-Z]{2}\s+)?(\d{3,7})\s*$")


class StoreLocked(Exception):
    """Another CRM ARR run holds the store lock."""


@dataclass
class AccountEntry:
    account_number: str
    status: str
    account_name: str | None = None
    account_ids: list[str] | None = None
    total_arr: float | None = None
    epl_arr: float | None = None
    item_count: int | None = None
    fetched_at: str | None = None
    last_checked: str | None = None
    reason: str | None = None
    matches: list[str] | None = None


def entry_from_dict(data: dict[str, Any]) -> AccountEntry:
    known = {f.name for f in fields(AccountEntry)}
    return AccountEntry(**{k: v for k, v in data.items() if k in known})


def iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def account_number_from_title(title: str) -> str | None:
    match = TITLE_ACCOUNT_NUMBER.search(title or "")
    return match.group(1) if match else None


def account_numbers_for_projects(projects: list[dict]) -> tuple[dict[str, list[str]], list[str]]:
    numbers: dict[str, list[str]] = {}
    missing: list[str] = []
    for project in projects:
        title = project.get("title") or ""
        number = account_number_from_title(title)
        if number:
            numbers.setdefault(number, []).append(title)
        else:
            missing.append(title)
    return numbers, missing


def empty_store() -> dict[str, Any]:
    return {"generated_at": None, "last_weekly_check": None, "last_full_reconcile": None, "last_run": None, "accounts": {}}


def load_store(path: Path = STORE_PATH) -> dict[str, Any]:
    if not path.exists():
        return empty_store()
    store = json.loads(path.read_text(encoding="utf-8"))
    return {**empty_store(), **store}


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def browser_payload(store: dict[str, Any]) -> dict[str, Any]:
    """The store as the browser sees it: no CRM account GUIDs."""
    accounts = {
        number: {k: v for k, v in entry.items() if k != "account_ids"}
        for number, entry in store.get("accounts", {}).items()
    }
    return {**store, "accounts": accounts}


def save_store(store: dict[str, Any], path: Path = STORE_PATH, js_path: Path = JS_PATH) -> None:
    _write_atomic(path, json.dumps(store, indent=2) + "\n")
    _write_atomic(js_path, f"window.{JS_VARIABLE} = " + json.dumps(browser_payload(store), indent=2) + ";\n")


def record_changes(old: AccountEntry | None, new: AccountEntry, now: datetime, path: Path = CHANGES_PATH) -> list[dict]:
    """Appends ARR changes between two successful fetches to the change log."""
    if old is None or old.status != "ok" or new.status != "ok":
        return []
    changes = []
    for field in ("total_arr", "epl_arr"):
        before, after = getattr(old, field), getattr(new, field)
        if before is None or after is None or abs(after - before) <= 0.005:
            continue
        changes.append({"account_number": new.account_number, "field": field, "old": before, "new": after, "detected_at": iso(now)})
    if changes:
        log = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        _write_atomic(path, json.dumps(log + changes, indent=2) + "\n")
    return changes


def merge_entry(previous: AccountEntry | None, fetched: AccountEntry) -> AccountEntry:
    """A failed fetch keeps the last good values (marked as error); anything else replaces them."""
    if fetched.status != "error" or previous is None or previous.total_arr is None:
        return fetched
    kept = AccountEntry(**asdict(previous))
    kept.status = "error"
    kept.reason = fetched.reason
    kept.last_checked = fetched.last_checked or previous.last_checked
    return kept


@contextmanager
def store_lock(path: Path = LOCK_PATH, wait: bool = False) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX if wait else fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise StoreLocked(f"Another CRM ARR run is using {path.parent}") from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def is_reconcile_weekend(now: datetime) -> bool:
    """The first weekend of the month: a Saturday or Sunday on day 1-7."""
    return now.weekday() in (5, 6) and now.day <= 7


def weekly_overdue(store: dict[str, Any], now: datetime, days: int = 8) -> bool:
    last = parse_iso(store.get("last_weekly_check"))
    return last is None or now - last > timedelta(days=days)


def select_accounts(mode: str, store: dict[str, Any], wanted: Iterable[str], now: datetime) -> tuple[list[str], bool]:
    """(Account Numbers to fetch in full, whether to run change detection for the rest)."""
    if mode not in MODES:
        raise ValueError(f"Unknown CRM ARR mode: {mode}")
    wanted = list(wanted)
    stored = store.get("accounts", {})
    if mode in ("initial", "force") or (mode == "weekly" and is_reconcile_weekend(now)):
        return wanted, False
    if mode == "new-only":
        return [n for n in wanted if n not in stored], False
    # Weekly: anything new or not currently ok gets a full fetch; ok accounts get change detection.
    return [n for n in wanted if stored.get(n, {}).get("status") != "ok"], True

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from requests.auth import HTTPBasicAuth
from requests.exceptions import ConnectionError as RequestsConnectionError

DEFAULT_BASE_URL = "https://tylertech.atlassian.net"
DEFAULT_SPACE = "EPLPS"
DEFAULT_CQL = 'label in ("status","erp") and label not in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE" and title !~ "TEST"'
DEFAULT_CLOSED_CQL = 'label in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE" and title !~ "TEST"'
DEFAULT_OUTPUT = Path("dashboard/data/projects.json")
SEARCH_PAGE_SIZE = 100
HISTORY_DIRNAME = "history"
CHANGES_FILENAME = "project_changes.json"
CHANGE_LOG_FILENAME = "change_log.json"
CHANGES_JS_FILENAME = "project_changes.js"
CHANGE_LOG_JS_FILENAME = "change_log.js"
STATUS_OVERRIDES_FILENAME = "status_overrides.json"
ACTIVE_CLOSED_BRIDGE_FILENAME = "closed_from_active.json"
CHANGE_FIELDS = [
    "title",
    "go_live",
    "project_status",
    "client_status",
    "project_health",
    "client_health",
    "project_manager",
    "implementation_manager",
    "region_state",
    "epl_version",
    "contracted_products",
]

REQUIRED_CORE_HEADERS = {
    "Hosting Type",
    "Go Live",
    "EP&L Version",
    "Project Manager",
    "Implementation Manager",
}

HEADER_ALIASES = {
    "hosting type": "Hosting Type",
    "original contract value": "Original Contract Value",
    "contract date": "Contract Date",
    "implementation start date": "Implementation Start Date",
    "region/state": "Region/State",
    "original go-live": "Original Go-Live",
    "go live": "Go Live",
    "ep&l version": "EP&L Version",
    "project health/notes": "Project Health/Notes",
    "client health/notes": "Client Health/Notes",
    "project manager": "Project Manager",
    "implementation manager": "Implementation Manager",
    "stage completion": "Stage Completion",
    "project health": "Project Health",
    "notes": "Notes",
}

GLR_HEADERS = ["6-month GLR", "4-month GLR", "2-month GLR", "1-month GLR", "EUT"]
ARCHIVE_TITLE_TOKENS = ("archive", "archived")
CUSTOMER_CARE_TITLE_TOKENS = ("customer care",)


def log_progress(message: str):
    print(message, flush=True)


@dataclass
class Config:
    base_url: str
    email: str
    api_token: str
    space: str
    cql: str
    limit: int | None
    output: Path
    write_history: bool
    incremental: bool
    new_only: bool


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description="Build dashboard data from Confluence project pages.")
    parser.add_argument("--base-url", default=os.getenv("CONFLUENCE_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--email", default=os.getenv("CONFLUENCE_EMAIL", ""))
    parser.add_argument("--api-token", default=os.getenv("CONFLUENCE_API_TOKEN", ""))
    parser.add_argument("--space", default=DEFAULT_SPACE)
    parser.add_argument("--cql", default=DEFAULT_CQL)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--skip-history", action="store_true")
    parser.add_argument("--incremental", action="store_true")
    parser.add_argument("--new-only", action="store_true")
    args = parser.parse_args()

    if not args.email or not args.api_token:
        raise SystemExit(
            "Missing Confluence credentials. Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN "
            "or pass --email and --api-token."
        )

    return Config(
        base_url=args.base_url.rstrip("/"),
        email=args.email,
        api_token=args.api_token,
        space=args.space,
        cql=args.cql,
        limit=args.limit,
        output=Path(args.output),
        write_history=not args.skip_history,
        incremental=args.incremental,
        new_only=args.new_only,
    )


def session_for(config: Config) -> requests.Session:
    session = requests.Session()
    session.auth = HTTPBasicAuth(config.email, config.api_token)
    session.headers.update({"Accept": "application/json"})
    return session


def get_json(session: requests.Session, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = session.get(url, params=params, timeout=60)
    response.raise_for_status()
    return response.json()


def parse_adf_document(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        raw = json.loads(raw)

    if isinstance(raw, dict) and "value" in raw and isinstance(raw.get("value"), str):
        raw = json.loads(raw["value"])

    if not isinstance(raw, dict):
        raise ValueError("Unexpected atlas_doc_format payload")

    return raw


def search_pages(session: requests.Session, config: Config) -> list[dict[str, Any]]:
    search_url = f"{config.base_url}/wiki/rest/api/content/search"
    wiki_base_url = f"{config.base_url}/wiki/"
    start = 0
    pages: list[dict[str, Any]] = []
    batch_number = 0
    seen_page_ids: set[str] = set()
    seen_next_urls: set[str] = set()
    next_url: str | None = None

    while True:
        batch_number += 1
        batch_size = SEARCH_PAGE_SIZE
        if config.limit is not None:
            remaining = config.limit - len(pages)
            if remaining <= 0:
                break
            batch_size = min(batch_size, remaining)

        if next_url:
            payload = get_json(session, next_url)
        else:
            payload = get_json(
                session,
                search_url,
                params={
                    "cql": config.cql,
                    "limit": batch_size,
                    "start": start,
                },
            )

        results = payload.get("results", [])
        batch_ids = [str(row.get("id", "")).strip() for row in results if str(row.get("id", "")).strip()]
        new_results = [row for row, page_id in zip(results, batch_ids) if page_id and page_id not in seen_page_ids]
        for page_id in batch_ids:
            if page_id:
                seen_page_ids.add(page_id)

        pages.extend(new_results)
        log_progress(
            f"Search batch {batch_number}: fetched {len(results)} page(s), {len(new_results)} new, {len(pages)} unique total so far."
        )

        if config.limit is not None and len(pages) >= config.limit:
            return pages[: config.limit]

        if results and not new_results:
            log_progress("Search pagination returned no new page IDs; stopping to avoid an infinite loop.")
            break

        next_link = ((payload.get("_links") or {}).get("next") or "").strip()
        if next_link:
            if next_link.startswith("http://") or next_link.startswith("https://"):
                candidate_next_url = next_link
            elif next_link.startswith("/wiki/"):
                candidate_next_url = f"{config.base_url}{next_link}"
            elif next_link.startswith("/rest/"):
                candidate_next_url = f"{config.base_url}/wiki{next_link}"
            else:
                candidate_next_url = urljoin(wiki_base_url, next_link)
            if candidate_next_url in seen_next_urls:
                log_progress("Search pagination returned a repeated next URL; stopping to avoid an infinite loop.")
                break
            seen_next_urls.add(candidate_next_url)
            next_url = candidate_next_url
            continue

        next_url = None
        if len(results) < batch_size:
            break
        start += len(results)

    return pages


def fetch_page_adf(session: requests.Session, config: Config, page_id: str) -> dict[str, Any]:
    url = f"{config.base_url}/wiki/api/v2/pages/{page_id}"
    payload = get_json(session, url, params={"body-format": "atlas_doc_format"})
    body = payload.get("body", {})
    body["atlas_doc_format"] = parse_adf_document(body.get("atlas_doc_format") or {})
    return payload


def fetch_page_labels(session: requests.Session, config: Config, page_id: str) -> set[str]:
    url = f"{config.base_url}/wiki/api/v2/pages/{page_id}/labels"
    payload = get_json(session, url, params={"limit": 250})
    return {
        str(label.get("name", "")).strip().lower()
        for label in payload.get("results", []) or []
        if str(label.get("name", "")).strip()
    }


def fetch_page_ancestor_titles(session: requests.Session, config: Config, page_id: str) -> list[str]:
    url = f"{config.base_url}/wiki/rest/api/content/{page_id}"
    payload = get_json(session, url, params={"expand": "ancestors"})
    ancestors = payload.get("ancestors", []) or []
    return [str(ancestor.get("title", "")).strip() for ancestor in ancestors if str(ancestor.get("title", "")).strip()]


def page_is_in_archived_area(ancestor_titles: list[str]) -> bool:
    normalized_titles = [str(title or "").strip().lower() for title in ancestor_titles]
    if not normalized_titles:
        return False

    has_archive_folder = any(any(token in title for token in ARCHIVE_TITLE_TOKENS) for title in normalized_titles)
    return has_archive_folder


def should_skip_archived_page(session: requests.Session, config: Config, page_id: str) -> bool:
    if not getattr(config, "base_url", ""):
        return False
    ancestor_titles = fetch_page_ancestor_titles(session, config, page_id)
    return page_is_in_archived_area(ancestor_titles)


def iter_nodes(node: Any):
    if isinstance(node, dict):
        yield node
        for child in node.get("content", []) or []:
            yield from iter_nodes(child)

        attrs = node.get("attrs", {}) or {}
        parameters = attrs.get("parameters", {}) or {}
        nested = parameters.get("nestedContent")
        if nested:
            yield from iter_nodes(nested)
    elif isinstance(node, list):
        for item in node:
            yield from iter_nodes(item)


def text_from_node(node: Any) -> str:
    if not isinstance(node, dict):
        return ""

    node_type = node.get("type")

    if node_type == "text":
        return node.get("text", "")
    if node_type == "status":
        return node.get("attrs", {}).get("text", "")
    if node_type == "date":
        timestamp = node.get("attrs", {}).get("timestamp")
        if timestamp is None:
            return ""
        try:
            dt = datetime.fromtimestamp(int(timestamp) / 1000, tz=timezone.utc)
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return ""
    if node_type == "taskItem":
        state = node.get("attrs", {}).get("state", "")
        label = "DONE" if state == "DONE" else "TODO"
        parts = [text_from_node(child) for child in node.get("content", [])]
        value = " ".join(part for part in parts if part).strip()
        return f"{label}: {value}".strip(": ")

    parts: list[str] = []
    for child in node.get("content", []) or []:
        child_text = text_from_node(child)
        if child_text:
            parts.append(child_text)

    separator = "\n" if node_type in {"paragraph", "tableRow", "bulletList", "taskList"} else " "
    return separator.join(parts).strip()


def normalize_text(value: str) -> str:
    lines = [line.strip() for line in value.replace("\xa0", " ").splitlines()]
    lines = [line for line in lines if line]
    return " | ".join(lines)


def strip_status_prefix(text: str) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return ""

    prefixes = [
        "on hold",
        "hold",
        "not started",
        "green",
        "yellow",
        "amber",
        "red",
        "g",
        "y",
        "r",
    ]
    lowered = normalized.lower()
    for prefix in prefixes:
        if lowered.startswith(prefix):
            return normalized[len(prefix):].lstrip(" :-|").strip()
    return normalized


def updated_health_text(current_text: str, new_status: str) -> str:
    remainder = strip_status_prefix(current_text)
    if remainder:
        return f"{new_status} {remainder}".strip()
    return new_status


def canonicalize_module_name(value: str) -> str:
    normalized = normalize_text(value)
    compact = "".join(char.lower() for char in normalized if char.isalnum())
    if "ereview" in compact or "ereviews" in compact:
        return "E-Reviews"
    return normalized


def normalize_confluence_url(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    if "/wiki/" in normalized:
        return normalized
    if "://" in normalized and "/spaces/" in normalized:
        return normalized.replace("/spaces/", "/wiki/spaces/")
    return normalized


def table_to_rows(table_node: dict[str, Any]) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in table_node.get("content", []) or []:
        if row.get("type") != "tableRow":
            continue
        cells: list[str] = []
        for cell in row.get("content", []) or []:
            cell_text = normalize_text(text_from_node(cell))
            cells.append(cell_text)
        rows.append(cells)
    return rows


def checked_task_items_from_node(node: Any) -> list[str]:
    items: list[str] = []
    for child in iter_nodes(node):
        if not isinstance(child, dict) or child.get("type") != "taskItem":
            continue
        if str((child.get("attrs", {}) or {}).get("state", "")).upper() != "DONE":
            continue
        label = canonicalize_module_name(" ".join(text_from_node(content) for content in child.get("content", []) or []))
        if label:
            items.append(label)
    return items


def normalize_header_label(value: str) -> str:
    return " ".join(value.replace(" ", " ").strip().lower().split())


def map_core_headers(rows: list[list[str]]) -> dict[str, str] | None:
    if len(rows) < 2:
        return None

    header_row = rows[0]
    value_row = rows[1]
    canonical_headers = [HEADER_ALIASES.get(normalize_header_label(cell)) for cell in header_row]
    recognized = {header for header in canonical_headers if header}

    if not REQUIRED_CORE_HEADERS.issubset(recognized):
        return None
    if "Implementation Start Date" not in recognized:
        return None
    if not ({"Project Health/Notes", "Project Health"} & recognized):
        return None

    mapped: dict[str, str] = {}
    for index, header in enumerate(canonical_headers):
        if not header or index >= len(value_row):
            continue
        mapped[header] = value_row[index]
    return mapped


def rows_match_headers(rows: list[list[str]], expected_headers: list[str]) -> bool:
    if len(rows) < 2:
        return False
    normalized_header = [cell.strip() for cell in rows[0][: len(expected_headers)]]
    return normalized_header == expected_headers


def find_core_table_map(adf: dict[str, Any]) -> dict[str, str] | None:
    for node in iter_nodes(adf):
        if node.get("type") != "table":
            continue
        rows = table_to_rows(node)
        mapped = map_core_headers(rows)
        if mapped:
            return mapped
    return None


def find_table_rows(adf: dict[str, Any], expected_headers: list[str]) -> list[list[str]] | None:
    for node in iter_nodes(adf):
        if node.get("type") != "table":
            continue
        rows = table_to_rows(node)
        if rows_match_headers(rows, expected_headers):
            return rows
    return None


def find_contracted_products(adf: dict[str, Any]) -> list[str]:
    for node in iter_nodes(adf):
        if not isinstance(node, dict) or node.get("type") != "table":
            continue

        rows = node.get("content", []) or []
        if len(rows) < 2:
            continue

        header_row = rows[0].get("content", []) or []
        header_labels = [normalize_header_label(text_from_node(cell)) for cell in header_row]
        if "contracted products" not in header_labels:
            continue

        product_index = header_labels.index("contracted products")
        value_row = rows[1].get("content", []) or []
        if product_index >= len(value_row):
            continue

        return checked_task_items_from_node(value_row[product_index])

    return []


def normalize_status(raw: str) -> str:
    original = raw.strip()
    text = original.lower()
    if not text:
        return "Unknown"

    if text.startswith("on hold") or text.startswith("hold") or text.startswith("w -"):
        return "On Hold"
    if text.startswith("not started"):
        return "Not Started"

    first_token = text.split()[0] if text.split() else ""
    if first_token in {"r", "red"} or text.startswith("red"):
        return "Red"
    if first_token in {"y", "yellow", "amber"} or text.startswith("yellow") or text.startswith("amber"):
        return "Yellow"
    if first_token in {"g", "green"} or text.startswith("green"):
        return "Green"

    return original or "Unknown"


def page_url_for(config: Config, page_id: str, search_row: dict[str, Any], page_payload: dict[str, Any]) -> str:
    direct_url = normalize_confluence_url(str(search_row.get("webUrl") or "").strip())
    if direct_url:
        return direct_url

    webui = str((page_payload.get("_links", {}) or {}).get("webui") or "").strip()
    if webui:
        if webui.startswith("http://") or webui.startswith("https://"):
            return normalize_confluence_url(webui)
        return normalize_confluence_url(f"{config.base_url}{webui}")

    return f"{config.base_url}/wiki/spaces/{config.space}/pages/{page_id}"


def build_project_record(config: Config, search_row: dict[str, Any], page_payload: dict[str, Any]) -> dict[str, Any]:
    adf = parse_adf_document(page_payload.get("body", {}).get("atlas_doc_format") or {})

    core_map = find_core_table_map(adf)
    glr_rows = find_table_rows(adf, GLR_HEADERS)
    contracted_products = find_contracted_products(adf)

    if not core_map:
        raise ValueError(f"Could not find implementation table for page {search_row.get('id')}")

    glr_map: dict[str, str] = {}
    if glr_rows and len(glr_rows) >= 2:
        glr_map = dict(zip(GLR_HEADERS, glr_rows[1]))

    project_health = core_map.get("Project Health/Notes") or core_map.get("Project Health", "")
    client_health = core_map.get("Client Health/Notes") or core_map.get("Notes", "")

    return {
        "page_id": str(search_row.get("id", "")),
        "title": search_row.get("title", ""),
        "url": page_url_for(config, str(search_row.get("id", "")), search_row, page_payload),
        "last_modified": search_row.get("lastModified", ""),
        "summary": search_row.get("summary", ""),
        "hosting_type": core_map.get("Hosting Type", ""),
        "original_contract_value": core_map.get("Original Contract Value", ""),
        "contract_date": core_map.get("Contract Date", ""),
        "implementation_start_date": core_map.get("Implementation Start Date", ""),
        "region_state": core_map.get("Region/State", ""),
        "go_live": core_map.get("Go Live", ""),
        "epl_version": core_map.get("EP&L Version", ""),
        "project_health": project_health,
        "client_health": client_health,
        "project_status": normalize_status(project_health.split("|", 1)[0]),
        "client_status": normalize_status(client_health.split("|", 1)[0]),
        "project_manager": core_map.get("Project Manager", ""),
        "implementation_manager": core_map.get("Implementation Manager", ""),
        "contracted_products": contracted_products,
        "glr_6_month": glr_map.get("6-month GLR", ""),
        "glr_4_month": glr_map.get("4-month GLR", ""),
        "glr_2_month": glr_map.get("2-month GLR", ""),
        "glr_1_month": glr_map.get("1-month GLR", ""),
        "eut": glr_map.get("EUT", ""),
    }


def load_existing_payload(output_path: Path) -> dict[str, Any] | None:
    if not output_path.exists():
        return None
    try:
        return json.loads(output_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_status_overrides(output_path: Path) -> dict[str, dict[str, Any]]:
    overrides_path = output_path.parent / STATUS_OVERRIDES_FILENAME
    if not overrides_path.exists():
        return {}
    try:
        raw = json.loads(overrides_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    overrides: dict[str, dict[str, Any]] = {}
    if isinstance(raw, dict):
        for page_id, value in raw.items():
            if page_id and isinstance(value, dict):
                overrides[str(page_id)] = value
    return overrides


def apply_status_override(row: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    status = normalize_status(str(override.get("project_status", "")))
    if not status or status == "Unknown":
        return row

    updated = dict(row)
    updated["project_status"] = status
    updated["project_health"] = updated_health_text(str(row.get("project_health", "")), status)
    updated["status_override_source"] = "dashboard"
    updated["status_override_updated_at"] = str(override.get("updated_at", ""))
    return updated


def search_row_page_id(search_row: dict[str, Any]) -> str:
    return str(search_row.get("id", "")).strip()


def page_belongs_in_output(output_path: Path | None, labels: set[str]) -> bool:
    if not output_path:
        return True

    is_closed = bool({"closed", "closederp"} & labels)
    if output_path.name == "projects.json":
        return not is_closed
    if output_path.name == "closed_projects.json":
        return is_closed
    return True


def bridge_output_path(output_path: Path) -> Path:
    return output_path.parent / ACTIVE_CLOSED_BRIDGE_FILENAME


def search_row_matches_previous(search_row: dict[str, Any], previous_row: dict[str, Any]) -> bool:
    search_last_modified = str(search_row.get("lastModified", "")).strip()
    search_title = str(search_row.get("title", "")).strip()
    previous_last_modified = str(previous_row.get("last_modified", "")).strip()
    previous_title = str(previous_row.get("title", "")).strip()

    # If the search result or previously saved row is missing its key freshness
    # metadata, force a full page fetch instead of reusing potentially stale data.
    if not search_last_modified or not search_title or not previous_last_modified or not previous_title:
        return False

    return (
        previous_last_modified == search_last_modified
        and previous_title == search_title
        and str(previous_row.get("url", "")) == str(search_row.get("webUrl") or "")
        and str(previous_row.get("summary", "")) == str(search_row.get("summary", ""))
    )


def reuse_project_record(previous_row: dict[str, Any], search_row: dict[str, Any]) -> dict[str, Any]:
    reused = dict(previous_row)
    reused["page_id"] = search_row_page_id(search_row)
    reused["title"] = search_row.get("title", reused.get("title", ""))
    reused["url"] = normalize_confluence_url(search_row.get("webUrl") or reused.get("url", ""))
    reused["last_modified"] = search_row.get("lastModified", reused.get("last_modified", ""))
    reused["summary"] = search_row.get("summary", reused.get("summary", ""))
    reused["project_status"] = normalize_status(str(reused.get("project_health", "")).split("|", 1)[0])
    reused["client_status"] = normalize_status(str(reused.get("client_health", "")).split("|", 1)[0])
    return reused


def collect_projects(
    session: requests.Session,
    config: Config,
    search_rows: list[dict[str, Any]],
    previous_payload: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    incremental_mode = bool(getattr(config, "incremental", False))
    new_only_mode = bool(getattr(config, "new_only", False))
    previous_projects = {
        str(row.get("page_id", "")): row
        for row in (previous_payload or {}).get("projects", [])
        if row.get("page_id")
    }
    output_path = getattr(config, "output", None)
    status_overrides = load_status_overrides(output_path) if isinstance(output_path, Path) else {}
    projects: list[dict[str, Any]] = []
    errors: list[str] = []
    archived_skip_cache: dict[str, bool] = {}

    work_rows: list[dict[str, Any]] = []
    reused_count = 0

    def is_archived_row(page_id: str) -> bool:
        if not page_id:
            return False
        if page_id not in archived_skip_cache:
            archived_skip_cache[page_id] = should_skip_archived_page(session, config, page_id)
        return archived_skip_cache[page_id]

    for row in search_rows:
        page_id = search_row_page_id(row)
        if not page_id:
            continue
        if is_archived_row(page_id):
            log_progress(f"Skipping archived Confluence page {page_id} {row.get('title', '')}")
            continue

        previous_row = previous_projects.get(page_id)
        if new_only_mode and previous_row:
            reused_row = reuse_project_record(previous_row, row)
            projects.append(apply_status_override(reused_row, status_overrides[page_id]) if page_id in status_overrides else reused_row)
            reused_count += 1
            continue

        if incremental_mode and previous_row and search_row_matches_previous(row, previous_row):
            reused_row = reuse_project_record(previous_row, row)
            projects.append(apply_status_override(reused_row, status_overrides[page_id]) if page_id in status_overrides else reused_row)
            reused_count += 1
            continue

        work_rows.append(row)

    if new_only_mode:
        log_progress(
            f"New-only mode: reusing {reused_count} existing record(s), fetching {len(work_rows)} newly added record(s)."
        )
    elif incremental_mode:
        log_progress(
            f"Incremental mode: reusing {reused_count} unchanged record(s), fetching {len(work_rows)} changed/new record(s)."
        )
    else:
        log_progress(f"Preparing to fetch {len(work_rows)} page detail record(s).")

    def fetch_record(row: dict[str, Any]) -> dict[str, Any]:
        page_id = search_row_page_id(row)
        page_payload = fetch_page_adf(session, config, page_id)
        record = build_project_record(config, row, page_payload)
        if page_id in status_overrides:
            record = apply_status_override(record, status_overrides[page_id])
        return record

    max_workers = min(12, max(1, len(work_rows)))
    completed = 0
    if work_rows:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {executor.submit(fetch_record, row): row for row in work_rows}
            for future in as_completed(future_map):
                row = future_map[future]
                page_id = search_row_page_id(row)
                try:
                    projects.append(future.result())
                except Exception as exc:
                    errors.append(f"{page_id} {row.get('title', '')}: {exc}")
                completed += 1
                if completed == len(work_rows) or completed % 10 == 0:
                    log_progress(
                        f"Processed {completed}/{len(work_rows)} fetched page detail record(s)..."
                    )

    if isinstance(output_path, Path) and output_path.name in {"projects.json", "closed_projects.json"} and projects:
        filtered_projects: list[dict[str, Any]] = []
        excluded_count = 0
        excluded_closed_rows: list[dict[str, Any]] = []

        def fetch_labels_for_project(row: dict[str, Any]) -> tuple[dict[str, Any], set[str]]:
            return row, fetch_page_labels(session, config, str(row.get("page_id", "")).strip())

        label_workers = min(12, max(1, len(projects)))
        with ThreadPoolExecutor(max_workers=label_workers) as executor:
            future_map = {executor.submit(fetch_labels_for_project, row): row for row in projects}
            for future in as_completed(future_map):
                row = future_map[future]
                try:
                    project_row, labels = future.result()
                except Exception as exc:
                    errors.append(f"{row.get('page_id', '')} {row.get('title', '')}: label verification failed: {exc}")
                    filtered_projects.append(row)
                    continue

                belongs = page_belongs_in_output(output_path, labels)
                if belongs:
                    filtered_projects.append(project_row)
                else:
                    excluded_count += 1
                    if output_path.name == "projects.json" and ({"closed", "closederp"} & labels):
                        excluded_closed_rows.append(dict(project_row))

        if excluded_count:
            log_progress(f"Filtered out {excluded_count} project(s) after direct label verification for {output_path.name}.")
        if output_path.name == "projects.json":
            bridge_path = bridge_output_path(output_path)
            bridge_path.write_text(json.dumps({"projects": excluded_closed_rows}, indent=2), encoding="utf-8")
        projects = filtered_projects

    return projects, errors


def summarize_project_for_change(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "page_id": str(row.get("page_id", "")),
        "title": row.get("title", ""),
        "url": row.get("url", ""),
        "go_live": row.get("go_live", ""),
        "project_status": row.get("project_status", ""),
        "project_manager": row.get("project_manager", ""),
        "implementation_manager": row.get("implementation_manager", ""),
        "region_state": row.get("region_state", ""),
        "epl_version": row.get("epl_version", ""),
        "contracted_products": row.get("contracted_products", []),
        "last_modified": row.get("last_modified", ""),
    }


def status_summary_for_projects(projects: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in projects:
        status = normalize_status(str(row.get("project_health", "")).split("|", 1)[0])
        counts[status] = counts.get(status, 0) + 1
    return counts


def build_change_report(previous_payload: dict[str, Any] | None, current_payload: dict[str, Any]) -> dict[str, Any]:
    previous_projects = {str(row.get("page_id", "")): row for row in (previous_payload or {}).get("projects", []) if row.get("page_id")}
    current_projects = {str(row.get("page_id", "")): row for row in current_payload.get("projects", []) if row.get("page_id")}

    added = []
    removed = []
    updated = []

    for page_id, row in current_projects.items():
        if page_id not in previous_projects:
            added.append(summarize_project_for_change(row))
            continue

        previous_row = previous_projects[page_id]
        field_changes = {}
        for field in CHANGE_FIELDS:
            previous_value = previous_row.get(field, "")
            current_value = row.get(field, "")
            if previous_value != current_value:
                field_changes[field] = {
                    "before": previous_value,
                    "after": current_value,
                }

        if field_changes:
            updated.append({
                **summarize_project_for_change(row),
                "changes": field_changes,
                "previous": summarize_project_for_change(previous_row),
            })

    for page_id, row in previous_projects.items():
        if page_id not in current_projects:
            removed.append(summarize_project_for_change(row))

    return {
        "generated_at": current_payload.get("generated_at"),
        "detail_level": "full",
        "comparison": {
            "current_generated_at": current_payload.get("generated_at"),
            "previous_generated_at": (previous_payload or {}).get("generated_at", ""),
        },
        "summary": {
            "added": len(added),
            "removed": len(removed),
            "updated": len(updated),
        },
        "added": added,
        "removed": removed,
        "updated": updated,
    }


def write_js_data_file(path: Path, variable_name: str, payload: Any):
    path.write_text(
        f"window.{variable_name} = " + json.dumps(payload, indent=2) + ";\n",
        encoding="utf-8",
    )


def augment_closed_projects_from_active_dataset(
    session: requests.Session,
    config: Config,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if config.output.name != "closed_projects.json":
        return payload

    active_path = config.output.parent / "projects.json"
    bridge_path = bridge_output_path(config.output)
    source_projects: list[dict[str, Any]] = []

    if bridge_path.exists():
        try:
            bridge_payload = json.loads(bridge_path.read_text(encoding="utf-8"))
            source_projects.extend(bridge_payload.get("projects", []) or [])
        except Exception:
            pass

    if active_path.exists():
        try:
            active_payload = json.loads(active_path.read_text(encoding="utf-8"))
            source_projects.extend(active_payload.get("projects", []) or [])
        except Exception:
            pass

    if not source_projects:
        return payload

    existing_ids = {str(row.get("page_id", "")) for row in payload.get("projects", []) if row.get("page_id")}
    supplemental_rows: list[dict[str, Any]] = []

    for row in source_projects:
        page_id = str(row.get("page_id", "")).strip()
        if not page_id or page_id in existing_ids:
            continue

        try:
            labels = fetch_page_labels(session, config, page_id)
        except Exception:
            continue

        if not page_belongs_in_output(config.output, labels):
            continue

        supplemental_rows.append(dict(row))
        existing_ids.add(page_id)

    if supplemental_rows:
        log_progress(
            f"Supplementing closed-project feed with {len(supplemental_rows)} active dataset project(s) verified as closed by page labels."
        )
        payload["projects"] = list(payload.get("projects", [])) + supplemental_rows
        payload["count"] = len(payload["projects"])

    return payload


def write_history_outputs(config: Config, current_payload: dict[str, Any], previous_payload: dict[str, Any] | None):
    history_dir = config.output.parent / HISTORY_DIRNAME
    history_dir.mkdir(parents=True, exist_ok=True)

    snapshot_stamp = current_payload["generated_at"].replace(":", "").replace("-", "")
    snapshot_path = history_dir / f"projects_{snapshot_stamp}.json"
    snapshot_path.write_text(json.dumps(current_payload, indent=2), encoding="utf-8")

    change_report = build_change_report(previous_payload, current_payload)
    change_report["snapshot_file"] = snapshot_path.name
    (config.output.parent / CHANGES_FILENAME).write_text(json.dumps(change_report, indent=2), encoding="utf-8")
    write_js_data_file(config.output.parent / CHANGES_JS_FILENAME, "PROJECT_CHANGES_DATA", change_report)

    change_log_path = history_dir / CHANGE_LOG_FILENAME
    try:
        change_log = json.loads(change_log_path.read_text(encoding="utf-8")) if change_log_path.exists() else []
    except Exception:
        change_log = []

    change_log.append({
        "generated_at": current_payload.get("generated_at"),
        "snapshot_file": snapshot_path.name,
        "project_count": len(current_payload.get("projects", [])),
        "summary": change_report["summary"],
        "status_summary": status_summary_for_projects(current_payload.get("projects", [])),
    })
    change_log_path.write_text(json.dumps(change_log, indent=2), encoding="utf-8")
    write_js_data_file(history_dir / CHANGE_LOG_JS_FILENAME, "PROJECT_CHANGE_LOG_DATA", change_log)


def write_output(config: Config, projects: list[dict[str, Any]]):
    config.output.parent.mkdir(parents=True, exist_ok=True)
    previous_payload = load_existing_payload(config.output)
    session = session_for(config)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "base_url": config.base_url,
            "space": config.space,
            "cql": config.cql,
        },
        "count": len(projects),
        "projects": projects,
    }
    payload = augment_closed_projects_from_active_dataset(session, config, payload)
    config.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    js_filename = f"{config.output.stem}.js"
    write_js_data_file(config.output.parent / js_filename, "PROJECT_DASHBOARD_DATA", payload)
    if config.write_history:
        write_history_outputs(config, payload, previous_payload)


def main():
    config = parse_args()
    session = session_for(config)
    log_progress(f"Starting Confluence fetch for {config.output}...")
    log_progress(f"CQL: {config.cql}")
    try:
        search_rows = search_pages(session, config)
    except RequestsConnectionError as exc:
        raise SystemExit(
            "Could not reach Confluence at "
            f"{config.base_url}. Check your internet connection, VPN, and DNS access, then try again.\n"
            f"Original error: {exc}"
        ) from exc
    log_progress(f"Search complete. Found {len(search_rows)} candidate page(s).")
    previous_payload = load_existing_payload(config.output)
    if config.incremental and previous_payload:
        log_progress(
            f"Loaded previous snapshot with {len(previous_payload.get('projects', []))} project record(s) for incremental comparison."
        )
    elif config.incremental:
        log_progress("No previous snapshot found, so incremental mode will fetch all matching records.")

    projects, errors = collect_projects(session, config, search_rows, previous_payload)

    projects.sort(key=lambda item: ((item.get("go_live") or "9999-99-99"), item.get("title") or ""))
    log_progress(f"Writing {len(projects)} project record(s) to {config.output}...")
    write_output(config, projects)

    print(f"Wrote {len(projects)} projects to {config.output}")
    if errors:
        print(f"Skipped {len(errors)} pages:")
        for error in errors[:25]:
            print(f"  - {error}")
        if len(errors) > 25:
            print(f"  - ... {len(errors) - 25} more")


if __name__ == "__main__":
    main()

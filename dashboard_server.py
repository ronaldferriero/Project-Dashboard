#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import requests
from requests.auth import HTTPBasicAuth

from fetch_confluence_dashboard_data import (
    CHANGE_LOG_FILENAME,
    CHANGE_LOG_JS_FILENAME,
    CHANGES_FILENAME,
    CHANGES_JS_FILENAME,
    HEADER_ALIASES,
    HISTORY_DIRNAME,
    build_change_report,
    parse_adf_document,
    status_summary_for_projects,
    text_from_node,
    write_js_data_file,
)

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DATA_JSON_PATH = ROOT_DIR / "dashboard" / "data" / "projects.json"
DATA_JS_PATH = ROOT_DIR / "dashboard" / "data" / "projects.js"
GO_LIVES_JSON_PATH = ROOT_DIR / "dashboard" / "data" / "closed_projects.json"
DATA_DIR = DATA_JSON_PATH.parent
STATUS_OVERRIDES_PATH = DATA_DIR / "status_overrides.json"
STATUS_OPTIONS = ["Green", "Yellow", "Red", "On Hold", "Not Started"]


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def normalize_header_label(value: str) -> str:
    return " ".join(str(value or "").replace("\xa0", " ").strip().lower().split())


def normalize_status_label(value: str) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return "Unknown"
    if text in {"g", "green"}:
        return "Green"
    if text in {"y", "yellow", "amber"}:
        return "Yellow"
    if text in {"r", "red"}:
        return "Red"
    if text in {"hold", "on hold", "w -"}:
        return "On Hold"
    if text == "not started":
        return "Not Started"
    return str(value or "").strip()


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
            remainder = normalized[len(prefix):].lstrip(" :-|")
            return remainder.strip()
    return normalized


def updated_health_text(current_text: str, new_status: str) -> str:
    remainder = strip_status_prefix(current_text)
    if remainder:
        separator = " " if remainder.startswith(("(", "[")) else " "
        return f"{new_status}{separator}{remainder}".strip()
    return new_status


def paragraph_text_node(text: str) -> dict[str, Any]:
    paragraph: dict[str, Any] = {"type": "paragraph"}
    if text:
        paragraph["content"] = [{"type": "text", "text": text}]
    return paragraph


def leading_status_label(value: str) -> str:
    text = str(value or "").strip()
    lowered = text.lower()
    if not lowered:
        return "Unknown"
    if lowered.startswith("on hold") or lowered.startswith("hold") or lowered.startswith("w -"):
        return "On Hold"
    if lowered.startswith("not started"):
        return "Not Started"
    if lowered.startswith("green") or lowered.startswith("g "):
        return "Green"
    if lowered.startswith("yellow") or lowered.startswith("amber") or lowered.startswith("y "):
        return "Yellow"
    if lowered.startswith("red") or lowered.startswith("r "):
        return "Red"
    return normalize_status_label(text)


def verified_status_matches_requested_status(requested_status: str, verified_texts: list[str]) -> bool:
    normalized_requested = normalize_status_label(requested_status)
    if normalized_requested == "Unknown":
        return False

    for text in verified_texts:
        normalized_text = leading_status_label(str(text or "").split("|", 1)[0])
        if normalized_text == normalized_requested:
            return True
    return False


def find_project_health_cells(adf: dict[str, Any]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for node in iter_nodes(adf):
        if not isinstance(node, dict) or node.get("type") != "table":
            continue

        rows = node.get("content", []) or []
        if len(rows) < 2:
            continue

        header_row = rows[0].get("content", []) or []
        health_index = None
        for index, cell in enumerate(header_row):
            label = HEADER_ALIASES.get(normalize_header_label(text_from_node(cell)))
            if label in {"Project Health/Notes", "Project Health"}:
                health_index = index
                break

        if health_index is None:
            continue

        value_row = rows[1].get("content", []) or []
        if health_index >= len(value_row):
            continue

        matches.append(value_row[health_index])

    return matches


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


def get_credentials() -> tuple[str, str, str]:
    load_dotenv(ROOT_DIR / ".env")
    base_url = os.getenv("CONFLUENCE_BASE_URL", "https://tylertech.atlassian.net").rstrip("/")
    email = os.getenv("CONFLUENCE_EMAIL", "")
    api_token = os.getenv("CONFLUENCE_API_TOKEN", "")
    return base_url, email, api_token


def confluence_session() -> requests.Session:
    base_url, email, api_token = get_credentials()
    if not email or not api_token:
        raise RuntimeError("Missing Confluence credentials.")

    session = requests.Session()
    session.auth = HTTPBasicAuth(email, api_token)
    session.headers.update({"Accept": "application/json", "Content-Type": "application/json"})
    session.base_url = base_url  # type: ignore[attr-defined]
    return session


def confluence_page_url(page_id: str) -> str:
    base_url, _, _ = get_credentials()
    return f"{base_url}/wiki/api/v2/pages/{page_id}"


def update_confluence_project_status(page_id: str, new_status: str) -> dict[str, Any]:
    status = normalize_status_label(new_status)
    if status not in STATUS_OPTIONS:
        raise ValueError(f"Unsupported status '{new_status}'.")

    session = confluence_session()
    page_url = confluence_page_url(page_id)
    page_response = session.get(page_url, params={"body-format": "atlas_doc_format"}, timeout=60)
    page_response.raise_for_status()
    page_payload = page_response.json()

    adf = parse_adf_document(page_payload.get("body", {}).get("atlas_doc_format") or {})
    health_cells = find_project_health_cells(adf)
    if not health_cells:
        raise ValueError("Could not find the Project Health field on the Confluence page.")

    existing_text = text_from_node(health_cells[0])
    new_health_text = updated_health_text(existing_text, status)
    for health_cell in health_cells:
        health_cell["content"] = [paragraph_text_node(new_health_text)]

    version_number = int((page_payload.get("version") or {}).get("number") or 0)
    if version_number <= 0:
        raise ValueError("Could not determine the current Confluence page version.")

    update_payload = {
        "id": str(page_payload.get("id") or page_id),
        "status": "current",
        "title": page_payload.get("title", ""),
        "spaceId": page_payload.get("spaceId"),
        "body": {
            "representation": "atlas_doc_format",
            "value": json.dumps(adf),
        },
        "version": {
            "number": version_number + 1,
            "message": f"Dashboard status update: {status}",
        },
    }

    update_response = session.put(page_url, data=json.dumps(update_payload), timeout=60)
    update_response.raise_for_status()
    updated_payload = update_response.json()

    verified_texts: list[str] = []
    for attempt in range(3):
        verify_response = session.get(page_url, params={"body-format": "atlas_doc_format"}, timeout=60)
        verify_response.raise_for_status()
        verify_payload = verify_response.json()
        verify_adf = parse_adf_document(verify_payload.get("body", {}).get("atlas_doc_format") or {})
        verified_cells = find_project_health_cells(verify_adf)
        verified_texts = [text_from_node(cell) for cell in verified_cells]
        if not verified_texts or verified_status_matches_requested_status(status, verified_texts):
            break
        if attempt < 2:
            time.sleep(1)

    verification_warning = ""
    if verified_texts and not verified_status_matches_requested_status(status, verified_texts):
        verification_warning = (
            "Confluence accepted the update, but the saved Project Health field could not be re-verified immediately."
        )

    updated_row = update_local_project_status(
        page_id=page_id,
        new_status=status,
        new_health_text=new_health_text,
        last_modified=(updated_payload.get("version") or {}).get("createdAt") or datetime.now(timezone.utc).isoformat(),
    )

    return {
        "page_id": page_id,
        "project_status": status,
        "project_health": new_health_text,
        "last_modified": updated_row.get("last_modified", ""),
        "title": updated_row.get("title", page_payload.get("title", "")),
        "warning": verification_warning,
    }


def update_local_project_status(page_id: str, new_status: str, new_health_text: str, last_modified: str) -> dict[str, Any]:
    if not DATA_JSON_PATH.exists():
        raise FileNotFoundError(f"Missing {DATA_JSON_PATH}")

    previous_payload = json.loads(DATA_JSON_PATH.read_text(encoding="utf-8"))
    payload = json.loads(json.dumps(previous_payload))
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    projects = payload.get("projects", []) or []
    updated_row: dict[str, Any] | None = None
    for row in projects:
        if str(row.get("page_id", "")) != str(page_id):
            continue
        row["project_status"] = new_status
        row["project_health"] = new_health_text
        row["last_modified"] = last_modified
        row["status_override_source"] = "dashboard"
        row["status_override_updated_at"] = payload["generated_at"]
        updated_row = row
        break

    if updated_row is None:
        raise ValueError(f"Project {page_id} was not found in the local dataset.")

    try:
        overrides = json.loads(STATUS_OVERRIDES_PATH.read_text(encoding="utf-8")) if STATUS_OVERRIDES_PATH.exists() else {}
    except Exception:
        overrides = {}
    if not isinstance(overrides, dict):
        overrides = {}
    overrides[str(page_id)] = {
        "page_id": str(page_id),
        "title": updated_row.get("title", ""),
        "project_status": new_status,
        "project_health": new_health_text,
        "updated_at": payload["generated_at"],
    }
    STATUS_OVERRIDES_PATH.write_text(json.dumps(overrides, indent=2) + "\n", encoding="utf-8")

    DATA_JSON_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    write_js_data_file(DATA_JS_PATH, "PROJECT_DASHBOARD_DATA", payload)
    write_manual_change_outputs(previous_payload, payload)
    return updated_row


def write_manual_change_outputs(previous_payload: dict[str, Any], current_payload: dict[str, Any]) -> None:
    history_dir = DATA_DIR / HISTORY_DIRNAME
    history_dir.mkdir(parents=True, exist_ok=True)

    snapshot_stamp = current_payload["generated_at"].replace(":", "").replace("-", "")
    snapshot_path = history_dir / f"projects_{snapshot_stamp}.json"
    snapshot_path.write_text(json.dumps(current_payload, indent=2) + "\n", encoding="utf-8")

    change_report = build_change_report(previous_payload, current_payload)
    change_report["snapshot_file"] = snapshot_path.name
    change_report["change_source"] = "dashboard"
    (DATA_DIR / CHANGES_FILENAME).write_text(json.dumps(change_report, indent=2) + "\n", encoding="utf-8")
    write_js_data_file(DATA_DIR / CHANGES_JS_FILENAME, "PROJECT_CHANGES_DATA", change_report)

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
        "change_source": "dashboard",
    })
    change_log_path.write_text(json.dumps(change_log, indent=2) + "\n", encoding="utf-8")
    write_js_data_file(history_dir / CHANGE_LOG_JS_FILENAME, "PROJECT_CHANGE_LOG_DATA", change_log)


def refresh_go_lives_dataset() -> dict[str, Any]:
    base_url, email, api_token = get_credentials()
    if not email or not api_token:
        raise RuntimeError("Missing Confluence credentials.")

    command = [
        sys.executable,
        str(ROOT_DIR / "fetch_confluence_dashboard_data.py"),
        "--base-url",
        base_url,
        "--email",
        email,
        "--api-token",
        api_token,
        "--cql",
        'label in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE" and title !~ "TEST"',
        "--output",
        str(GO_LIVES_JSON_PATH),
        "--skip-history",
        "--incremental",
    ]
    result = subprocess.run(
        command,
        cwd=ROOT_DIR,
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Unknown refresh failure.").strip()
        raise RuntimeError(detail)

    payload = json.loads(GO_LIVES_JSON_PATH.read_text(encoding="utf-8"))
    closed_projects_js = GO_LIVES_JSON_PATH.with_suffix(".js")
    write_js_data_file(closed_projects_js, "PROJECT_DASHBOARD_DATA", payload)
    return {
        "generated_at": payload.get("generated_at", ""),
        "project_count": len(payload.get("projects", []) or []),
    }


def create_project_page(form_data: dict[str, Any]) -> dict[str, Any]:
    """Create a new project page in Confluence with implementation table."""
    session = confluence_session()
    base_url = session.base_url  # type: ignore[attr-defined]

    project_title = form_data.get('projectTitle', '').strip()
    if not project_title:
        raise ValueError("Project title is required")

    # Build the implementation table in Confluence storage format
    storage_content = build_project_page_storage_content(form_data)

    # Create the page
    create_payload = {
        "type": "page",
        "title": project_title,
        "space": {"key": "EPLPS"},
        "body": {
            "storage": {
                "value": storage_content,
                "representation": "storage"
            }
        },
        "metadata": {
            "labels": [
                {"name": "status"},
                {"name": "erp"}
            ]
        }
    }

    # Use the older API endpoint for page creation
    create_url = f"{base_url}/wiki/rest/api/content"
    response = session.post(create_url, data=json.dumps(create_payload), timeout=60)
    response.raise_for_status()
    result = response.json()

    page_id = result.get("id", "")
    page_url = f"{base_url}/wiki{result.get('_links', {}).get('webui', '')}"

    return {
        "success": True,
        "pageId": page_id,
        "pageUrl": page_url,
        "message": "Project page created successfully"
    }


def build_project_page_storage_content(form_data: dict[str, Any]) -> str:
    """Build Confluence storage format HTML for the project page matching existing format."""

    def esc(text):
        if not text:
            return "&nbsp;"
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

    # Build products as task list (checklist) like existing pages
    products = form_data.get('products', [])
    products_html = ""
    if products:
        for product in products:
            products_html += f'<ac:task><ac:task-status>complete</ac:task-status><ac:task-body>{esc(product)}</ac:task-body></ac:task>'
        products_html = f'<ac:task-list>{products_html}</ac:task-list>'
    else:
        products_html = "&nbsp;"

    # Build main implementation table with HORIZONTAL layout (headers in first row, values in second row)
    content = f"""<table data-layout="full-width">
<tbody>
<tr>
<th><p style="text-align: center;"><strong>Hosting Type</strong></p></th>
<th><p style="text-align: center;"><strong>Original Contract Value</strong></p></th>
<th><p style="text-align: center;"><strong>Contract Date</strong></p></th>
<th><p style="text-align: center;"><strong>Implementation Start Date</strong></p></th>
<th><p style="text-align: center;"><strong>Region/State</strong></p></th>
<th><p style="text-align: center;"><strong>Go Live</strong></p></th>
<th><p style="text-align: center;"><strong>EP&amp;L Version</strong></p></th>
<th><p style="text-align: center;"><strong>Project Health/Notes</strong></p></th>
<th><p style="text-align: center;"><strong>Client Health/Notes</strong></p></th>
<th><p style="text-align: center;"><strong>Project Manager</strong></p></th>
<th><p style="text-align: center;"><strong>Implementation Manager</strong></p></th>
<th><p style="text-align: center;"><strong>Contracted Products</strong></p></th>
</tr>
<tr>
<td><p>{esc(form_data.get('hostingType'))}</p></td>
<td><p>{esc(form_data.get('contractValue'))}</p></td>
<td><p>{esc(form_data.get('contractDate'))}</p></td>
<td><p>{esc(form_data.get('implementationStart'))}</p></td>
<td><p>{esc(form_data.get('regionState'))}</p></td>
<td><p>{esc(form_data.get('goLive'))}</p></td>
<td><p>{esc(form_data.get('eplVersion'))}</p></td>
<td><p>{esc(form_data.get('projectHealth'))}</p></td>
<td><p>{esc(form_data.get('clientHealth'))}</p></td>
<td><p>{esc(form_data.get('projectManager'))}</p></td>
<td><p>{esc(form_data.get('implementationManager'))}</p></td>
<td>{products_html}</td>
</tr>
</tbody>
</table>

<p>&nbsp;</p>

<table data-layout="default">
<tbody>
<tr><th><p><strong>Number of Licenses</strong></p></th><th><p><strong>Scope</strong></p></th></tr>
<tr><td><p>{esc(form_data.get('numLicenses'))}</p></td><td><p>{esc(form_data.get('scope'))}</p></td></tr>
</tbody>
</table>

<p>&nbsp;</p>

<table data-layout="default">
<tbody>
<tr><th><p><strong>6-month GLR</strong></p></th><th><p><strong>4-month GLR</strong></p></th><th><p><strong>2-month GLR</strong></p></th><th><p><strong>1-month GLR</strong></p></th><th><p><strong>EUT</strong></p></th></tr>
<tr><td><p>{esc(form_data.get('glr6Month'))}</p></td><td><p>{esc(form_data.get('glr4Month'))}</p></td><td><p>{esc(form_data.get('glr2Month'))}</p></td><td><p>{esc(form_data.get('glr1Month'))}</p></td><td><p>{esc(form_data.get('eut'))}</p></td></tr>
</tbody>
</table>

<p>&nbsp;</p>

<table data-layout="default">
<tbody>
<tr><th><p><strong>Reports</strong></p></th></tr>
<tr><td><p>{esc(form_data.get('reports'))}</p></td></tr>
<tr><th><p><strong>Custom Reports</strong></p></th></tr>
<tr><td><p>{esc(form_data.get('customReports'))}</p></td></tr>
</tbody>
</table>

<p>&nbsp;</p>

<table data-layout="default">
<tbody>
<tr><th><p><strong>Legacy System(s)</strong></p></th><th><p><strong>Conversion Type</strong></p></th></tr>
<tr><td><p>{esc(form_data.get('legacySystem'))}</p></td><td><p>{esc(form_data.get('conversionType'))}</p></td></tr>
<tr><th><p><strong>Data Conversion Details</strong></p></th></tr>
<tr><td><p>{esc(form_data.get('dataConversion'))}</p></td></tr>
<tr><th><p><strong>Conversion Notes</strong></p></th></tr>
<tr><td><p>{esc(form_data.get('conversionNotes'))}</p></td></tr>
</tbody>
</table>

<p>&nbsp;</p>

<p><strong>Summary:</strong> {esc(form_data.get('summary')) if form_data.get('summary') else 'No summary provided.'}</p>
"""

    return content


def create_sales_handoff_page(project_id: str, project_title: str, form_data: dict[str, Any]) -> dict[str, Any]:
    """Create a Sales & Client Handoff Information subpage under the specified project."""
    session = confluence_session()
    base_url = session.base_url  # type: ignore[attr-defined]

    # Build the page content in Confluence storage format
    storage_content = build_sales_handoff_storage_content(form_data)

    # Create the child page
    create_payload = {
        "type": "page",
        "title": f"{project_title} - Sales & Client Handoff Information",
        "space": {"key": "EPLPS"},
        "ancestors": [{"id": project_id}],
        "body": {
            "storage": {
                "value": storage_content,
                "representation": "storage"
            }
        }
    }

    # Use the older API endpoint for page creation
    create_url = f"{base_url}/wiki/rest/api/content"
    response = session.post(create_url, data=json.dumps(create_payload), timeout=60)
    response.raise_for_status()
    result = response.json()

    page_id = result.get("id", "")
    page_url = f"{base_url}/wiki{result.get('_links', {}).get('webui', '')}"

    return {
        "success": True,
        "pageId": page_id,
        "pageUrl": page_url,
        "message": "Sales handoff page created successfully"
    }


def build_sales_handoff_storage_content(form_data: dict[str, Any]) -> str:
    """Build Confluence storage format HTML for the sales handoff form."""

    # Helper to escape HTML
    def esc(text):
        if not text:
            return "&nbsp;"
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

    content = f"""<p><span style="color: rgb(0,0,0);">The purpose of this document is to provide a framework to facilitate knowledge transfer regarding a client's history and sales experience from the Account Executive to the Professional Services team. The project manager will complete the known aspects of the form before the sales handoff meeting. During the meeting, the project manager will work with the sales team member(s) to complete any outstanding information and determine the risks and opportunities.&nbsp; &nbsp;If any items are not identified during the process, the Project Manager should work with the client team to document that information.</span></p>

<table data-layout="full-width">
<tbody>
<tr><td><p><strong>Client Name</strong></p></td><td><p>{esc(form_data.get('clientName'))}</p></td></tr>
<tr><td><p><strong>Client Address</strong></p></td><td><p>{esc(form_data.get('clientAddress'))}</p></td></tr>
<tr><td><p><strong>Contract / PO Number</strong></p></td><td><p>{esc(form_data.get('contractNumber'))}</p></td></tr>
<tr><td><p><strong>Proposed Production Cutover Date(s) or Timeline</strong></p></td><td><p>{esc(form_data.get('cutoverDate'))}</p></td></tr>
<tr><td><p><strong>Tier</strong></p></td><td><p>{esc(form_data.get('tier'))}</p></td></tr>
<tr><td><p><strong>Hosting Type</strong></p></td><td><p>{esc(form_data.get('hostingType'))}</p></td></tr>
<tr><td><p><strong>Legacy System/End of Support Date (s)</strong></p></td><td><p>{esc(form_data.get('legacySystem'))}</p></td></tr>
<tr><td><p><strong>Current EPL Products (in implementation or live)</strong></p></td><td><p>{esc(form_data.get('currentProducts'))}</p></td></tr>
<tr><td><p><strong>Sharepoint Link</strong></p></td><td><p>{esc(form_data.get('sharepointLink'))}</p></td></tr>
</tbody>
</table>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
<ac:parameter ac:name="title">SALES HANDOFF ATTENDEES</ac:parameter>
<ac:rich-text-body>
<table data-layout="full-width">
<thead>
<tr><th><p><strong>Title</strong></p></th><th><p><strong>Name (s)</strong></p></th><th><p><strong>Notes</strong></p></th></tr>
</thead>
<tbody>
"""

    # Add attendees
    for attendee in form_data.get('attendees', []):
        content += f'<tr><td><p>{esc(attendee.get("title"))}</p></td>'
        content += f'<td><p>{esc(attendee.get("name"))}</p></td>'
        content += f'<td><p>{esc(attendee.get("notes"))}</p></td></tr>\n'

    content += """</tbody>
</table>
</ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
<ac:parameter ac:name="title">CLIENT & 3RD PARTY CONTACT INFORMATION</ac:parameter>
<ac:rich-text-body>
<table data-layout="full-width">
<thead>
<tr><th><p><strong>Name</strong></p></th><th><p><strong>Email</strong></p></th><th><p><strong>Department</strong></p></th><th><p><strong>Client Role</strong></p></th><th><p><strong>Project Role</strong></p></th></tr>
</thead>
<tbody>
"""

    # Add contacts
    for contact in form_data.get('contacts', []):
        content += f'<tr><td><p>{esc(contact.get("name"))}</p></td>'
        content += f'<td><p>{esc(contact.get("email"))}</p></td>'
        content += f'<td><p>{esc(contact.get("department"))}</p></td>'
        content += f'<td><p>{esc(contact.get("clientRole"))}</p></td>'
        content += f'<td><p>{esc(contact.get("projectRole"))}</p></td></tr>\n'

    content += """</tbody>
</table>
</ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
<ac:parameter ac:name="title">TOTAL TYLER PRODUCT INFO</ac:parameter>
<ac:rich-text-body>
<table data-layout="full-width">
<tbody>
<tr>
<td>&nbsp;</td>
<td>EERP</td>
<td>EA&T</td>
<td>ERP Pro (9 or 10)</td>
<td>My Civic</td>
<td>Content Manager</td>
<td>Cashiering</td>
<td>EAM</td>
<td>ESR</td>
<td>Other</td>
</tr>
"""

    # Helper to render checkbox as checked or unchecked in Confluence
    def checkbox(field_name):
        return '<ac:task><ac:task-status>' + ('complete' if form_data.get(field_name) else 'incomplete') + '</ac:task-status><ac:task-body><span class="placeholder-inline-tasks">&nbsp;</span></ac:task-body></ac:task>'

    content += f"""<tr>
<td><p>Purchased</p></td>
<td>{checkbox('product_eerp_purchased')}</td>
<td>{checkbox('product_eat_purchased')}</td>
<td>{checkbox('product_erppro_purchased')}</td>
<td>{checkbox('product_mycivic_purchased')}</td>
<td>{checkbox('product_cm_purchased')}</td>
<td>{checkbox('product_cash_purchased')}</td>
<td>{checkbox('product_eam_purchased')}</td>
<td>{checkbox('product_esr_purchased')}</td>
<td>{checkbox('product_other_purchased')}</td>
</tr>
<tr>
<td><p>Currently Implementing</p></td>
<td>{checkbox('product_eerp_implementing')}</td>
<td>{checkbox('product_eat_implementing')}</td>
<td>{checkbox('product_erppro_implementing')}</td>
<td>{checkbox('product_mycivic_implementing')}</td>
<td>{checkbox('product_cm_implementing')}</td>
<td>{checkbox('product_cash_implementing')}</td>
<td>{checkbox('product_eam_implementing')}</td>
<td>{checkbox('product_esr_implementing')}</td>
<td>{checkbox('product_other_implementing')}</td>
</tr>
<tr>
<td><p>Currently Live</p></td>
<td>{checkbox('product_eerp_live')}</td>
<td>{checkbox('product_eat_live')}</td>
<td>{checkbox('product_erppro_live')}</td>
<td>{checkbox('product_mycivic_live')}</td>
<td>{checkbox('product_cm_live')}</td>
<td>{checkbox('product_cash_live')}</td>
<td>{checkbox('product_eam_live')}</td>
<td>{checkbox('product_esr_live')}</td>
<td>{checkbox('product_other_live')}</td>
</tr>
<tr>
<td><p><strong>Version</strong></p></td>
<td><p>{esc(form_data.get('product_eerp_version'))}</p></td>
<td><p>{esc(form_data.get('product_eat_version'))}</p></td>
<td><p>{esc(form_data.get('product_erppro_version'))}</p></td>
<td><p>{esc(form_data.get('product_mycivic_version'))}</p></td>
<td><p>{esc(form_data.get('product_cm_version'))}</p></td>
<td><p>{esc(form_data.get('product_cash_version'))}</p></td>
<td><p>{esc(form_data.get('product_eam_version'))}</p></td>
<td><p>{esc(form_data.get('product_esr_version'))}</p></td>
<td><p>{esc(form_data.get('product_other_version'))}</p></td>
</tr>
</tbody>
</table>

<p>&nbsp;</p>

<table data-layout="default">
<tbody>
<tr>
<td>&nbsp;</td>
<td><p><strong>Account Executive</strong></p></td>
<td><p><strong>Project Manager</strong></p></td>
<td><p><strong>Current Temperature</strong></p></td>
</tr>
"""

    # Add additional product rows
    for i in range(1, 5):
        prod_name = form_data.get(f'addl_product_{i}_name', '')
        if prod_name or form_data.get(f'addl_product_{i}_ae') or form_data.get(f'addl_product_{i}_pm'):
            content += f"""<tr>
<td><p><strong>{esc(prod_name or f'Tyler Product {i}')}</strong></p></td>
<td><p>{esc(form_data.get(f'addl_product_{i}_ae'))}</p></td>
<td><p>{esc(form_data.get(f'addl_product_{i}_pm'))}</p></td>
<td><p>{esc(form_data.get(f'addl_product_{i}_temp'))}</p></td>
</tr>
"""

    content += """</tbody>
</table>
</ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
<ac:parameter ac:name="title">ADDITIONAL INFO</ac:parameter>
<ac:rich-text-body>
<table data-layout="full-width">
<thead>
<tr><th><p><strong>Question</strong></p></th><th><p><strong>Answer</strong></p></th></tr>
</thead>
<tbody>
"""

    content += f"""<tr><td><p>What are the client's key business drivers?</p></td><td><p>{esc(form_data.get('businessDrivers'))}</p></td></tr>
<tr><td><p>What other software solutions were competing for selection? Did they have features the client favored?</p></td><td><p>{esc(form_data.get('competitors'))}</p></td></tr>
<tr><td><p>Was a third-party consultant involved in the selection process? Who has a role in implementation?</p></td><td><p>{esc(form_data.get('thirdPartyConsultant'))}</p></td></tr>
<tr><td><p>Who was primarily responsible for the selection? Were functional leaders involved?</p></td><td><p>{esc(form_data.get('selectionLeaders'))}</p></td></tr>
<tr><td><p>Is there legacy system functionality that may not be a good fit or present implementation risks?</p></td><td><p>{esc(form_data.get('legacyRisks'))}</p></td></tr>
<tr><td><p>What discussions took place around conversion options? Does the client have DBA or qualified resource?</p></td><td><p>{esc(form_data.get('conversionDiscussion'))}</p></td></tr>
<tr><td><p>What expectations were set regarding timeline for project kick-off?</p></td><td><p>{esc(form_data.get('kickoffExpectations'))}</p></td></tr>
<tr><td><p>What expectations were set regarding timeline for production cutover?</p></td><td><p>{esc(form_data.get('cutoverExpectations'))}</p></td></tr>
<tr><td><p>Are there any 3rd party data exchanges not specified in the contract?</p></td><td><p>{esc(form_data.get('dataExchanges'))}</p></td></tr>
<tr><td><p>What products/modules did the client see during the demo, who attended, and which had the most impact?</p></td><td><p>{esc(form_data.get('demoDetails'))}</p></td></tr>
<tr><td><p>Was the demo recorded, and can it be made available for implementation?</p></td><td><p>{esc(form_data.get('demoRecording'))}</p></td></tr>
<tr><td><p>Did we make any concessions or verbal agreements that should be implemented?</p></td><td><p>{esc(form_data.get('concessions'))}</p></td></tr>
<tr><td><p>Was an RFP issued? Please provide Tyler's responses and concerns.</p></td><td><p>{esc(form_data.get('rfpResponse'))}</p></td></tr>
<tr><td><p>Does the client have GIS? If so, who is the provider?</p></td><td><p>{esc(form_data.get('gisProvider'))}</p></td></tr>
<tr><td><p>What is their culture/overall attitude about the project? Any reservations or expected change management risks?</p></td><td><p>{esc(form_data.get('cultureAttitude'))}</p></td></tr>
<tr><td><p>Which, if any, Tyler clients were provided as references?</p></td><td><p>{esc(form_data.get('references'))}</p></td></tr>
<tr><td><p>Does the client have the staff to support the implementation, configuration, testing, etc?</p></td><td><p>{esc(form_data.get('staffSupport'))}</p></td></tr>
<tr><td><p>Other notes</p></td><td><p>{esc(form_data.get('otherNotes'))}</p></td></tr>
"""

    content += """</tbody>
</table>
</ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
<ac:parameter ac:name="title">CLIENT SPECIFIC QUESTIONS (Executive level)</ac:parameter>
<ac:rich-text-body>
<table data-layout="full-width">
<thead>
<tr><th><p><strong>Question</strong></p></th><th><p><strong>Answer</strong></p></th></tr>
</thead>
<tbody>
"""

    content += f"""<tr><td><p>What is your primary mission or mandate for your organization?</p></td><td><p>{esc(form_data.get('execMission'))}</p></td></tr>
<tr><td><p>What priorities or challenges do you hope to address?</p></td><td><p>{esc(form_data.get('execPriorities'))}</p></td></tr>
<tr><td><p>What are your long term objectives?</p></td><td><p>{esc(form_data.get('execLongTerm'))}</p></td></tr>
<tr><td><p>Are there any objectives related to the community?</p></td><td><p>{esc(form_data.get('execCommunity'))}</p></td></tr>
<tr><td><p>Who are the key stakeholders or decision makers?</p></td><td><p>{esc(form_data.get('execStakeholders'))}</p></td></tr>
<tr><td><p>Do you have specific metrics or indicators to measure? (revenue growth, operational efficiency, performance benchmarks)</p></td><td><p>{esc(form_data.get('execMetrics'))}</p></td></tr>
<tr><td><p>How do you evaluate the public satisfaction?</p></td><td><p>{esc(form_data.get('execSatisfaction'))}</p></td></tr>
<tr><td><p>What milestones are critical to demonstrate progress on?</p></td><td><p>{esc(form_data.get('execMilestones'))}</p></td></tr>
<tr><td><p>Are there any other agencies (internal or external) that will be involved?</p></td><td><p>{esc(form_data.get('execAgencies'))}</p></td></tr>
<tr><td><p>Are there any community specific issues that need to be addressed?</p></td><td><p>{esc(form_data.get('execCommunityIssues'))}</p></td></tr>
<tr><td><p>What risks do you see for this project?</p></td><td><p>{esc(form_data.get('execRisks'))}</p></td></tr>
<tr><td><p>Does your organization have a steering committee and do you want to include Tyler Technologies to attend?</p></td><td><p>{esc(form_data.get('execSteeringCommittee'))}</p></td></tr>
<tr><td><p>Are there any technology solutions that you plan to purchase in the future?</p></td><td><p>{esc(form_data.get('execFutureTech'))}</p></td></tr>
<tr><td><p>Do you have a change management lead?</p></td><td><p>{esc(form_data.get('execChangeManagement'))}</p></td></tr>
"""

    content += """</tbody>
</table>
</ac:rich-text-body>
</ac:structured-macro>
"""

    return content


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:
        print(f"[dashboard-server] {format % args}", flush=True)

    def do_GET(self) -> None:
        if self.path == "/api/config":
            _, email, api_token = get_credentials()
            self.send_json(
                HTTPStatus.OK,
                {
                    "project_status_editable": bool(email and api_token),
                    "status_options": STATUS_OPTIONS,
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/refresh-go-lives":
            try:
                result = refresh_go_lives_dataset()
            except Exception as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                return
            self.send_json(HTTPStatus.OK, result)
            return

        if self.path == "/api/create-handoff-page":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                raw_body = self.rfile.read(content_length) if content_length else b"{}"
                payload = json.loads(raw_body.decode("utf-8"))
            except Exception:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Request body must be valid JSON."})
                return

            project_id = str(payload.get("projectId", "")).strip()
            project_title = str(payload.get("projectTitle", "")).strip()
            form_data = payload.get("formData", {})

            if not project_id or not form_data:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "projectId and formData are required."})
                return

            try:
                result = create_sales_handoff_page(project_id, project_title, form_data)
            except Exception as error:
                import traceback
                error_details = traceback.format_exc()
                print(f"Error creating handoff page: {error_details}", flush=True)
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                return

            self.send_json(HTTPStatus.OK, result)
            return

        if self.path == "/api/create-project-page":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                raw_body = self.rfile.read(content_length) if content_length else b"{}"
                payload = json.loads(raw_body.decode("utf-8"))
            except Exception:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Request body must be valid JSON."})
                return

            if not payload:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Form data is required."})
                return

            try:
                result = create_project_page(payload)
            except Exception as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                return

            self.send_json(HTTPStatus.OK, result)
            return

        if self.path != "/api/project-status":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown API endpoint.")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length else b"{}"
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Request body must be valid JSON."})
            return

        page_id = str(payload.get("page_id", "")).strip()
        status = str(payload.get("status", "")).strip()
        if not page_id or not status:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Both page_id and status are required."})
            return

        try:
            result = update_confluence_project_status(page_id, status)
        except FileNotFoundError as error:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})
            return
        except requests.HTTPError as error:
            message = f"Confluence update failed: {error}"
            if error.response is not None:
                try:
                    body = error.response.json()
                except Exception:
                    body = error.response.text
                message = f"{message}. Response: {body}"
            self.send_json(HTTPStatus.BAD_GATEWAY, {"error": message})
            return
        except Exception as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        self.send_json(HTTPStatus.OK, result)

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the local dashboard and handle Confluence status updates.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"Dashboard server listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

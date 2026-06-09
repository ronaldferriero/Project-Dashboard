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

#!/usr/bin/env python3
"""Copy Ron's published dashboard data (dashboard/implementation/data/) into dashboard/data/.

Ron builds the project data from the SharePoint "Central Project Portfolio" list and the PO routing list with
an importer that is not in this repository; he publishes the result to dashboard/implementation/data/. After a
`git pull`, this copies it to where the local dashboard reads it. dashboard/data/ ends up as an exact mirror,
except dashboard/data/crm/ (local-only CRM ARR) and .gitkeep, which are never touched.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "dashboard" / "implementation" / "data"
TARGET = ROOT / "dashboard" / "data"
KEEP = {"crm", ".gitkeep"}


def is_sharepoint_source(projects_json: Path) -> bool:
    try:
        data = json.loads(projects_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return (data.get("source") or {}).get("type") == "sharepoint-list-csv"


def _kept(relative: Path) -> bool:
    return relative.parts[0] in KEEP


def sync(source: Path = SOURCE, target: Path = TARGET) -> int:
    """Mirror source into target (outside crm/ and .gitkeep). Returns the number of files copied."""
    if not (source / "projects.json").is_file():
        raise SystemExit(f"No published data at {source} (expected projects.json). Pull Ron's repo first.")
    wanted = {p.relative_to(source) for p in source.rglob("*") if p.is_file() and not _kept(p.relative_to(source))}
    target.mkdir(parents=True, exist_ok=True)
    for existing in sorted(target.rglob("*"), reverse=True):
        relative = existing.relative_to(target)
        if _kept(relative):
            continue
        if existing.is_file() and relative not in wanted:
            existing.unlink()
        elif existing.is_dir() and not any(existing.iterdir()):
            existing.rmdir()
    for relative in sorted(wanted):
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, destination)
    return len(wanted)


def main() -> int:
    copied = sync()
    print(f"Copied {copied} published data files from dashboard/implementation/data/ to dashboard/data/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

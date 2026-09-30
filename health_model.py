"""EPL Computed Health model.

Pure, deterministic functions that turn structured Confluence health inputs into a
`computedHealth` object. All weights, labels, thresholds and colors come from
`health_model_config.json`; nothing here is hard-coded per page or per dimension.

Computed Health is independent of the Reported Health (red/yellow/green) chosen by the
Project Manager. Nothing in this module reads or modifies Reported Health, except
`classify_alignment`, which only compares the two.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(__file__).with_name("health_model_config.json")
MAX_HISTORY_ENTRIES = 60

_BLANK_TOKENS = {"", "-", "--", "—", "n/a", "na", "none", "null", "tbd", "tba", "not assessed", "unassessed", "not rated", "unknown"}
_TRUE_TOKENS = {"yes", "y", "true", "1", "x", "done", "checked"}
_FALSE_TOKENS = {"no", "n", "false", "0", "todo", "unchecked"}
_RATING_WORDS = {
    "healthy": 4,
    "watch": 3,
    "at risk": 2,
    "atrisk": 2,
    "critical": 1,
    "failed": 0,
    "blocked": 0,
    "failed or blocked": 0,
    "failed/blocked": 0,
}


def load_config(path: Path | None = None) -> dict[str, Any]:
    return json.loads((path or CONFIG_PATH).read_text(encoding="utf-8"))


def norm_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _clean(value: Any) -> str:
    return " ".join(str(value if value is not None else "").replace("\xa0", " ").split())


def _blank(value: Any) -> bool:
    return _clean(value).lower() in _BLANK_TOKENS


# --------------------------------------------------------------------------- parsing


def parse_rating(raw: Any) -> tuple[int | None, str | None]:
    """Return (rating 0-4 or None, issue). Blank / "not assessed" is (None, None), never 0."""
    if raw is None or isinstance(raw, bool):
        return (None, "malformed" if isinstance(raw, bool) else None)
    if isinstance(raw, (int, float)):
        return (int(raw), None) if float(raw).is_integer() and 0 <= raw <= 4 else (None, "malformed")
    text = _clean(raw)
    if _blank(text):
        return (None, None)
    lowered = text.lower()
    match = re.match(r"^([0-4])(?:\.0+)?\s*(?:/\s*4)?(?:\s*[-–:|)]\s*.*|\s+[a-z].*)?$", lowered)
    if match:
        return (int(match.group(1)), None)
    for word, value in sorted(_RATING_WORDS.items(), key=lambda item: -len(item[0])):
        if lowered == word or lowered.startswith(word + " ") or lowered.startswith(word + " -"):
            return (value, None)
    return (None, "malformed")


def parse_count(raw: Any) -> tuple[int | None, str | None]:
    if raw is None:
        return (None, None)
    if isinstance(raw, bool):
        return (None, "malformed")
    if isinstance(raw, (int, float)):
        return (int(raw), None) if float(raw).is_integer() and raw >= 0 else (None, "malformed")
    text = _clean(raw)
    if _blank(text):
        return (None, None)
    match = re.match(r"^(\d+)(?:\.0+)?(?:\s*(?:days?|business days?|bd))?$", text.lower())
    if match:
        return (int(match.group(1)), None)
    return (None, "malformed")


def parse_flag(raw: Any) -> tuple[bool | None, str | None]:
    if raw is None:
        return (None, None)
    if isinstance(raw, bool):
        return (raw, None)
    if isinstance(raw, (int, float)):
        return (bool(raw), None) if raw in (0, 1) else (None, "malformed")
    text = _clean(raw).lower()
    if text in {"", "-", "--", "—", "n/a", "na", "tbd", "null", "not assessed"}:
        return (None, None)
    text = re.sub(r"^(done|todo):?\s*", lambda m: "yes" if m.group(1) == "done" else "no", text)
    if text in _TRUE_TOKENS or text.startswith("yes"):
        return (True, None)
    if text in _FALSE_TOKENS or text.startswith("no"):
        return (False, None)
    return (None, "malformed")


_DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%m/%d/%y", "%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%d %B %Y", "%b %d %Y")


def parse_date(raw: Any) -> tuple[str | None, str | None]:
    if raw is None:
        return (None, None)
    if isinstance(raw, datetime):
        return (raw.date().isoformat(), None)
    if isinstance(raw, date):
        return (raw.isoformat(), None)
    text = _clean(raw)
    if _blank(text):
        return (None, None)
    text = text[:10] if re.match(r"^\d{4}-\d{2}-\d{2}T", text) else text
    for fmt in _DATE_FORMATS:
        try:
            return (datetime.strptime(text, fmt).date().isoformat(), None)
        except ValueError:
            continue
    return (None, "malformed")


def _short_text(raw: Any, limit: int) -> str:
    text = _clean(raw)
    return "" if _blank(text) else text[:limit]


# ----------------------------------------------------------------------- extraction


def field_alias_lookup(config: dict[str, Any]) -> dict[str, str]:
    """Map normalized human-readable label -> canonical field id."""
    lookup: dict[str, str] = {}
    for dim in config["dimensions"]:
        for label in dim["fields"]:
            lookup[norm_key(label)] = f"rating:{dim['key']}"
    for key, labels in config["assessmentFields"].items():
        for label in labels:
            lookup[norm_key(label)] = f"assess:{key}"
    for key, spec in config["controlPointFields"].items():
        for label in spec["labels"]:
            lookup[norm_key(label)] = f"cp:{key}"
    return lookup


def extract_health_fields(tables: list[list[list[str]]], config: dict[str, Any]) -> dict[str, str]:
    """Find health-assessment labels in any table (header/value rows or label/value rows).

    `tables` is a list of tables, each a list of rows of cell text. First match wins.
    """
    lookup = field_alias_lookup(config)
    found: dict[str, str] = {}
    for rows in tables:
        if not isinstance(rows, list) or not rows:
            continue
        header_hits = sum(1 for cell in rows[0] if norm_key(cell) in lookup)
        column_hits = sum(1 for row in rows if row and norm_key(row[0]) in lookup)
        if header_hits >= column_hits and header_hits > 0:
            # Horizontal layout: header row of labels, value row beneath.
            if len(rows) >= 2:
                for index, cell in enumerate(rows[0]):
                    field = lookup.get(norm_key(cell))
                    if field and field not in found and index < len(rows[1]):
                        found[field] = rows[1][index]
        else:
            # Vertical layout: first cell is the label, second is the value.
            for row in rows:
                if len(row) >= 2:
                    field = lookup.get(norm_key(row[0]))
                    if field and field not in found:
                        found[field] = row[1]
    return found


def parse_override_codes(text: Any, config: dict[str, Any]) -> tuple[list[str], str | None]:
    cleaned = _clean(text).lower()
    if _blank(cleaned):
        return ([], None)
    codes: list[str] = []
    for code, spec in config["overrideCodes"].items():
        if cleaned == code or any(keyword in cleaned for keyword in spec["keywords"]):
            codes.append(code)
    return (codes, None if codes else "unrecognized")


def normalize_health_inputs(found: dict[str, Any] | None, config: dict[str, Any]) -> dict[str, Any]:
    """Turn raw extracted labels into typed, safe inputs. Never raises on bad values."""
    found = found or {}
    issues: list[dict[str, str]] = []
    publish_free_text = bool(config.get("publicData", {}).get("publishFreeText"))

    def note(field: str, issue: str | None):
        if issue:
            issues.append({"field": field, "issue": issue})

    ratings: dict[str, int | None] = {}
    for dim in config["dimensions"]:
        raw = found.get(f"rating:{dim['key']}")
        value, issue = parse_rating(raw)
        ratings[dim["key"]] = value
        note(dim["fields"][0], issue)

    assessment_date, issue = parse_date(found.get("assess:assessmentDate"))
    note("Health Assessment Date", issue)
    target_date, issue = parse_date(found.get("assess:recoveryTargetDate"))
    note("Recovery Target Date", issue)
    override_codes, issue = parse_override_codes(found.get("assess:override"), config)
    note("Health Override", issue)

    control_point: dict[str, Any] = {}
    for key, spec in config["controlPointFields"].items():
        raw = found.get(f"cp:{key}")
        parser = parse_flag if spec["type"] == "flag" else parse_count
        value, issue = parser(raw)
        control_point[key] = value
        note(spec["labels"][0], issue)

    return {
        "assessmentDate": assessment_date,
        "stage": _short_text(found.get("assess:stage"), 60),
        "overrideCodes": override_codes,
        "overrideReason": _short_text(found.get("assess:overrideReason"), 200) if publish_free_text else "",
        "recoveryOwner": _short_text(found.get("assess:recoveryOwner"), 80),
        "recoveryTargetDate": target_date,
        "ratings": ratings,
        "controlPoint": control_point,
        "dataQuality": issues,
    }


def has_any_health_input(inputs: dict[str, Any] | None) -> bool:
    if not isinstance(inputs, dict):
        return False
    if inputs.get("assessmentDate") or inputs.get("stage") or inputs.get("overrideCodes"):
        return True
    if any(value is not None for value in (inputs.get("ratings") or {}).values()):
        return True
    return any(value is not None for value in (inputs.get("controlPoint") or {}).values())


# ------------------------------------------------------------------- control points


def _pct(part: int | None, whole: int | None) -> float | None:
    if whole is None:
        return None
    if whole == 0:
        return 100.0
    if part is None:
        return None
    return max(0.0, min(100.0, part * 100.0 / whole))


def _r1(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def evaluate_control_point(cp: dict[str, Any] | None, config: dict[str, Any]) -> dict[str, Any]:
    """Control Point compliance percentages and the calculated Control Point rating (0-4).

    `rating` is None when structured data is insufficient; callers then fall back to the
    manually entered Control Point Health rating.
    """
    cp = cp or {}
    limits = config["controlPoint"]
    artifact = _pct(cp.get("approvedArtifacts"), cp.get("requiredArtifacts"))

    due = cp.get("signOffsDue")
    overdue = cp.get("overdueSignOffs")
    completed = cp.get("signOffsCompleted")
    if due is None:
        signoff = None
    elif due == 0:
        signoff = 100.0
    elif overdue is not None:
        signoff = _pct(max(0, due - overdue), due)
    else:
        signoff = _pct(completed, due)

    tested = cp.get("controlsTested")
    audit = None if not tested else _pct(cp.get("controlsPassed"), tested)

    ca_due = cp.get("correctiveActionsDue")
    closure = _pct(cp.get("correctiveActionsOnTime"), ca_due)

    available = [value for value in (artifact, signoff, audit, closure) if value is not None]
    compliance = sum(available) / len(available) if available else None

    major = cp.get("majorFindings") or 0
    minor = cp.get("minorFindings") or 0
    max_days = cp.get("maxDaysOverdue")
    overdue_count = overdue if overdue is not None else 0
    if overdue_count > 0 and max_days is None:
        max_days = 1
    max_days = max_days or 0
    bypassed = cp.get("mandatoryBypassed") is True
    audit_failed = cp.get("auditFailed") is True
    advanced = cp.get("advancedWithoutApproval") is True
    remediation_ok = cp.get("remediationPlanApproved") is True
    evidence_missing = cp.get("evidenceMissing") is True
    closure_effective = 100.0 if closure is None else closure
    artifact_effective = 100.0 if artifact is None else artifact

    structured = artifact is not None or bypassed or audit_failed or advanced
    rating: int | None = None
    reason = ""
    if structured:
        if bypassed or audit_failed or advanced:
            rating, reason = 0, "Mandatory Control Point bypassed, audit failed, or project advanced without required approval."
        elif (
            artifact_effective < limits["artifactCritical"]
            or (overdue_count > 0 and max_days > limits["signOffCriticalDays"])
            or (major > 0 and not remediation_ok)
            or evidence_missing
        ):
            rating, reason = 1, "Artifacts, sign-offs, audit findings, or evidence are at a critical level."
        elif (
            artifact_effective < limits["artifactAtRisk"]
            or (overdue_count > 0 and max_days > limits["signOffAtRiskDays"])
            or minor >= limits["repeatedMinorFindings"]
            or (major > 0 and remediation_ok)
            or closure_effective < limits["closureWatch"]
        ):
            rating, reason = 2, "Material Control Point gaps require management attention."
        elif (
            artifact_effective < 100
            or overdue_count > 0
            or minor > 0
            or closure_effective < limits["closureExcellent"]
        ):
            rating, reason = 3, "Minor Control Point variance."
        else:
            rating, reason = 4, "Artifacts complete, sign-offs current, no open major findings."

    return {
        "structured": structured,
        "rating": rating,
        "ratingReason": reason,
        "artifactCompletionPercent": _r1(artifact),
        "signOffCompliancePercent": _r1(signoff),
        "auditCompliancePercent": _r1(audit),
        "correctiveActionClosurePercent": _r1(closure),
        "compliancePercent": _r1(compliance),
        "overdueSignoffs": overdue,
        "maxDaysOverdue": (max_days or None) if overdue_count > 0 else None,
        "majorFindings": cp.get("majorFindings"),
        "minorFindings": cp.get("minorFindings"),
        "bypassed": bypassed,
        "auditFailed": audit_failed,
    }


# -------------------------------------------------------------------------- scoring


def round_half_up(value: float) -> int:
    return int(value + 0.5)


def status_for_score(score: int | None, config: dict[str, Any]) -> str:
    if score is None:
        return "gray"
    for key in config["statusOrder"]:
        minimum = config["statuses"][key]["min"]
        if minimum is not None and score >= minimum:
            return key
    return "red"


def worse_status(a: str, b: str, config: dict[str, Any]) -> str:
    order = config["statusOrder"]
    if a not in order:
        return b
    if b not in order:
        return a
    return order[max(order.index(a), order.index(b))]


def weighted_score(ratings: dict[str, int | None], dims: list[dict[str, Any]], max_rating: int) -> int | None:
    """Normalized 0-100 score, or None if any dimension in `dims` is unassessed.

    Missing weights are never redistributed, so an incomplete assessment cannot look healthier.
    """
    if not dims or any(ratings.get(dim["key"]) is None for dim in dims):
        return None
    total_weight = sum(dim["weight"] for dim in dims)
    earned = sum(dim["weight"] * ratings[dim["key"]] / max_rating for dim in dims)
    return round_half_up(earned * 100 / total_weight)


def evaluate_overrides(
    ratings: dict[str, int | None],
    control_point: dict[str, Any],
    override_codes: list[str],
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    overrides: list[dict[str, Any]] = []
    derived = config["derivedOverrides"]
    dim_labels = {dim["key"]: dim["label"] for dim in config["dimensions"]}
    zero_dims = [dim_labels[key] for key, value in ratings.items() if value == 0]
    critical_dims = [dim_labels[key] for key, value in ratings.items() if value == 1]
    if zero_dims:
        overrides.append({"id": "dimension-zero", "label": derived["dimension-zero"]["label"], "effect": "red", "scope": "overall",
                          "evidence": "Rated 0: " + "; ".join(zero_dims)})
    if len(critical_dims) >= 2:
        overrides.append({"id": "multiple-critical", "label": derived["multiple-critical"]["label"], "effect": "red", "scope": "overall",
                          "evidence": f"{len(critical_dims)} dimensions rated 1"})
    if control_point.get("bypassed"):
        overrides.append({"id": "control-point-bypassed", "label": derived["control-point-bypassed"]["label"], "effect": "red",
                          "scope": "overall", "evidence": "Mandatory Control Point bypassed"})
    if control_point.get("auditFailed"):
        overrides.append({"id": "audit-failed", "label": derived["audit-failed"]["label"], "effect": "red", "scope": "overall",
                          "evidence": "Audit failed"})
    for code in override_codes:
        spec = config["overrideCodes"].get(code)
        if spec:
            overrides.append({"id": code, "label": spec["label"], "effect": spec["effect"], "scope": spec["scope"], "evidence": spec["reason"]})
    return overrides


def _rating_word(rating: int, config: dict[str, Any]) -> str:
    return config["ratingScale"][str(rating)]["label"]


def compute_computed_health(inputs: dict[str, Any] | None, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build the `computedHealth` object for one project (deterministic; no clock, no I/O)."""
    config = config or load_config()
    inputs = inputs if isinstance(inputs, dict) else {}
    max_rating = config["maxRating"]
    manual = {key: value for key, value in (inputs.get("ratings") or {}).items()}
    cp_eval = evaluate_control_point(inputs.get("controlPoint"), config)

    dimensions: dict[str, dict[str, Any]] = {}
    ratings: dict[str, int | None] = {}
    for dim in config["dimensions"]:
        key = dim["key"]
        rating = manual.get(key)
        source = "manual" if rating is not None else None
        if dim.get("structured") and cp_eval["rating"] is not None:
            rating, source = cp_eval["rating"], "structured"
        ratings[key] = rating
        weight = dim["weight"]
        dimensions[key] = {
            "label": dim["label"],
            "group": dim["group"],
            "weight": weight,
            "rating": rating,
            "ratingLabel": _rating_word(rating, config) if rating is not None else "Not assessed",
            "source": source,
            "contribution": round(weight * rating / max_rating, 2) if rating is not None else None,
            "maxContribution": weight,
        }
    manual_cp = manual.get("controlPoint")

    project_dims = [d for d in config["dimensions"] if d["group"] == "project"]
    client_dims = [d for d in config["dimensions"] if d["group"] == "client"]
    missing = [d["key"] for d in config["dimensions"] if ratings[d["key"]] is None]
    assessed_count = len(config["dimensions"]) - len(missing)
    completeness = round_half_up(assessed_count * 100 / len(config["dimensions"]))

    project_score = weighted_score(ratings, project_dims, max_rating)
    client_score = weighted_score(ratings, client_dims, max_rating)
    overall_score = weighted_score(ratings, config["dimensions"], max_rating)
    complete = overall_score is not None

    overrides = evaluate_overrides(ratings, cp_eval, inputs.get("overrideCodes") or [], config)

    project_base = status_for_score(project_score, config)
    client_base = status_for_score(client_score, config)
    overall_base = status_for_score(overall_score, config)
    project_status, client_status, overall_status = project_base, client_base, overall_base
    if complete:
        for override in overrides:
            if override["effect"] == "red":
                overall_status = "red"
            elif override["effect"] == "client-red-overall-max-orange":
                client_status = "red"
                overall_status = worse_status(overall_status, "orange", config)

    # Drivers: deterministic, generalized labels only (no narrative text).
    factors = []
    for dim in config["dimensions"]:
        rating = ratings[dim["key"]]
        if rating is not None and rating < max_rating:
            loss = round(dim["weight"] * (max_rating - rating) / max_rating, 2)
            factors.append({"key": dim["key"], "label": dim["label"], "rating": rating, "ratingLabel": _rating_word(rating, config),
                            "pointsLost": loss, "weight": dim["weight"]})
    factors.sort(key=lambda item: (-item["pointsLost"], -item["weight"], item["key"]))
    top_factors = factors[:3]
    drivers = [f"{o['label']}" for o in overrides]
    drivers += [f"{f['label']} rated {f['ratingLabel']} ({f['rating']} of {max_rating})" for f in top_factors]
    if cp_eval["overdueSignoffs"]:
        days = f" (up to {cp_eval['maxDaysOverdue']} business days)" if cp_eval["maxDaysOverdue"] else ""
        drivers.append(f"{cp_eval['overdueSignoffs']} sign-off(s) overdue{days}")
    if cp_eval["majorFindings"]:
        drivers.append(f"{cp_eval['majorFindings']} open major audit finding(s)")
    seen: set[str] = set()
    drivers = [d for d in drivers if not (d in seen or seen.add(d))][:6]

    data_quality = list(inputs.get("dataQuality") or [])
    if assessed_count > 0 and not inputs.get("assessmentDate"):
        data_quality.append({"field": "Health Assessment Date", "issue": "missing"})
    if assessed_count == 0:
        confidence = "none"
    elif not complete or not inputs.get("assessmentDate"):
        confidence = "low"
    elif data_quality:
        confidence = "medium"
    else:
        confidence = "high"

    return {
        "modelVersion": config["modelVersion"],
        "assessed": assessed_count > 0,
        "confidence": confidence,
        "assessmentDate": inputs.get("assessmentDate"),
        "overallScore": overall_score,
        "overallStatus": overall_status,
        "overallBaseStatus": overall_base,
        "projectScore": project_score,
        "projectStatus": project_status,
        "clientScore": client_score,
        "clientStatus": client_status,
        "completenessPercent": completeness,
        "assessedDimensions": assessed_count,
        "missingDimensions": missing,
        "complete": complete,
        "dimensions": dimensions,
        "overrideActive": bool(overrides),
        "overrides": overrides,
        "primaryDrivers": drivers,
        "topFactors": top_factors,
        "currentStage": inputs.get("stage") or "",
        "controlPoint": {
            "stage": inputs.get("stage") or "",
            "manualRating": manual_cp,
            "ratingSource": "structured" if cp_eval["rating"] is not None else ("manual" if manual_cp is not None else None),
            **cp_eval,
        },
        "recovery": {"owner": inputs.get("recoveryOwner") or "", "targetDate": inputs.get("recoveryTargetDate")},
        "dataQuality": data_quality,
        "trend": {"previousScore": None, "scoreChange": None, "previousAssessmentDate": None},
    }


# ---------------------------------------------------------------------------- history


def history_entry(computed: dict[str, Any], reported_status: str, reported_client_status: str, generated_at: str) -> dict[str, Any] | None:
    """One compact history point, or None if there is nothing scored yet."""
    if computed.get("overallScore") is None and computed.get("projectScore") is None and computed.get("clientScore") is None:
        return None
    testing = (computed.get("dimensions") or {}).get("testing", {}).get("rating")
    return {
        "date": computed.get("assessmentDate") or (generated_at or "")[:10],
        "generatedAt": generated_at,
        "overall": computed.get("overallScore"),
        "project": computed.get("projectScore"),
        "client": computed.get("clientScore"),
        "status": computed.get("overallStatus"),
        "testing": testing,
        "controlPoint": (computed.get("controlPoint") or {}).get("compliancePercent"),
        "reported": _clean(reported_status).lower(),
        "reportedClient": _clean(reported_client_status).lower(),
    }


def record_history(history: dict[str, Any], page_id: str, entry: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Append (or replace same-day) entry for a project and return its series."""
    projects = history.setdefault("projects", {})
    series = projects.setdefault(str(page_id), []) if entry else projects.get(str(page_id), [])
    if entry:
        if series and series[-1].get("date") == entry["date"]:
            series[-1] = entry
        else:
            series.append(entry)
        del series[:-MAX_HISTORY_ENTRIES]
    return series


def series_trend(series: list[dict[str, Any]]) -> dict[str, Any]:
    """Prior score, change and previous assessment date from a chronological history series."""
    scored = [entry for entry in series if entry.get("overall") is not None]
    if len(scored) < 2:
        return {"previousScore": None, "scoreChange": None, "previousAssessmentDate": None}
    current, previous = scored[-1], scored[-2]
    return {
        "previousScore": previous["overall"],
        "scoreChange": current["overall"] - previous["overall"],
        "previousAssessmentDate": previous.get("date"),
    }


# -------------------------------------------------------------------------- alignment


def reported_key(status: Any) -> str:
    text = _clean(status).lower()
    return text if text in {"green", "yellow", "red"} else ""


def classify_alignment(reported_status: Any, computed_status: str, config: dict[str, Any] | None = None) -> str:
    config = config or load_config()
    if computed_status not in config["statusOrder"]:
        return "incomplete"
    reported = reported_key(reported_status)
    if not reported:
        return "not-comparable"
    return config["alignment"]["matrix"][reported][computed_status]


# ---------------------------------------------------------------------- change view


def build_change_view(computed: dict[str, Any] | None, reported_status: Any, config: dict[str, Any] | None = None) -> dict[str, str]:
    """Flat string map used by the snapshot diff (Python change report and the Changes page)."""
    config = config or load_config()
    if not isinstance(computed, dict):
        return {}

    def text(value: Any) -> str:
        return "" if value is None else str(value)

    cp = computed.get("controlPoint") or {}
    view = {
        "computed_overall_score": text(computed.get("overallScore")),
        "computed_project_score": text(computed.get("projectScore")),
        "computed_client_score": text(computed.get("clientScore")),
        "computed_status": text(config["statuses"].get(computed.get("overallStatus"), {}).get("label")),
        "computed_alignment": text(config["alignment"]["categories"][classify_alignment(reported_status, computed.get("overallStatus"), config)]["label"]),
        "computed_overrides": ", ".join(sorted(o["id"] for o in computed.get("overrides") or [])),
        "computed_overdue_signoffs": text(cp.get("overdueSignoffs")),
        "computed_major_findings": text(cp.get("majorFindings")),
        "computed_minor_findings": text(cp.get("minorFindings")),
        "computed_recovery_owner": text((computed.get("recovery") or {}).get("owner")),
        "computed_recovery_target_date": text((computed.get("recovery") or {}).get("targetDate")),
    }
    for key, dim in (computed.get("dimensions") or {}).items():
        view[f"computed_dim_{key}"] = text(dim.get("rating"))
    # Blank values are omitted to keep the payload small; the diff treats a missing key as "".
    return {key: value for key, value in view.items() if value != ""}


# ------------------------------------------------------------------ dataset pass


def compact_computed(computed: dict[str, Any]) -> dict[str, Any]:
    """Slim representation for projects.json / history snapshots.

    Static presentation data (dimension labels, weights, rating labels) is not repeated per project;
    the browser rebuilds it from the embedded health_model config. Unassessed projects become a stub.
    """
    if not computed.get("assessed"):
        return {
            "modelVersion": computed.get("modelVersion"),
            "assessed": False,
            "complete": False,
            "confidence": "none",
            "overallStatus": "gray",
            "completenessPercent": 0,
            "changeView": computed.get("changeView", {}),
        }
    slim = dict(computed)
    slim["dimensions"] = {
        key: {"rating": dim["rating"], "source": dim["source"], "contribution": dim["contribution"]}
        for key, dim in (computed.get("dimensions") or {}).items()
        if dim.get("rating") is not None
    }
    slim.pop("missingDimensions", None)  # derived from dimensions + config
    slim.pop("assessedDimensions", None)
    return slim


def apply_computed_health(
    projects: list[dict[str, Any]],
    history: dict[str, Any],
    generated_at: str,
    config: dict[str, Any] | None = None,
) -> None:
    """Recompute `computedHealth` for every project in place and update `history`.

    Reads the stored `health_inputs` (raw normalized inputs). Rows without them (older data,
    or pages without the new fields) get an Incomplete computedHealth. Reported Health
    fields are never touched.
    """
    config = config or load_config()
    for row in projects:
        try:
            inputs = row.get("health_inputs") if isinstance(row.get("health_inputs"), dict) else {}
            computed = compute_computed_health(inputs, config)
            entry = history_entry(computed, row.get("project_status", ""), row.get("client_status", ""), generated_at)
            series = record_history(history, str(row.get("page_id", "")), entry)
            computed["trend"] = series_trend(series)
            computed["changeView"] = build_change_view(computed, row.get("project_status", ""), config)
            row["computedHealth"] = compact_computed(computed)
        except Exception as exc:  # never break dataset generation on one bad record
            row["computedHealth"] = {"assessed": False, "complete": False, "overallStatus": "gray", "confidence": "none",
                                     "completenessPercent": 0, "changeView": {},
                                     "dataQuality": [{"field": "computedHealth", "issue": f"calculation failed: {type(exc).__name__}"}]}


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()

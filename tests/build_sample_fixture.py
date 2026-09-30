#!/usr/bin/env python3
"""Regenerates tests/fixtures/computed_health_sample.json.

EVERYTHING in the fixture is SAMPLE / TEST data. No real project data is used. Scores are produced by the
real model (health_model.py) so the fixture stays consistent with the scoring rules.
Usage: python3 tests/build_sample_fixture.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import health_model as hm  # noqa: E402

REFERENCE_DATE = "2026-09-30"
CONFIG = hm.load_config()
KEYS = [d["key"] for d in CONFIG["dimensions"]]


def ratings(default=4, **overrides):
    values = {key: default for key in KEYS}
    values.update(overrides)
    return values


def inputs(rat, date="2026-09-28", stage="solution validation", cp=None, codes=None, owner="", target=None):
    return {"assessmentDate": date, "stage": stage, "ratings": rat, "controlPoint": cp or {}, "overrideCodes": codes or [],
            "recoveryOwner": owner, "recoveryTargetDate": target, "dataQuality": []}


BASE_CP = {"requiredArtifacts": 10, "approvedArtifacts": 10, "signOffsDue": 4, "signOffsCompleted": 4, "overdueSignOffs": 0,
           "controlsTested": 10, "controlsPassed": 10, "majorFindings": 0, "minorFindings": 0, "correctiveActionsDue": 0}

# (title, reported project, reported client, go_live, inputs|None|dict-of-raw-found, prior-offsets|None)
SAMPLES = [
    ("[SAMPLE] Aligned Green County", "Green", "Green", "2027-03-01", inputs(ratings()), [-5]),
    ("[SAMPLE] Hidden Risk County", "Green", "Green", "2026-11-15",
     inputs(ratings(3, testing=2), stage="user acceptance testing", cp={**BASE_CP, "mandatoryBypassed": True},
            owner="Project Manager", target="2026-10-21"), [20, 14, 11]),
    ("[SAMPLE] Emerging Concern City", "Green", "Green", "2027-01-15", inputs(ratings(3, schedule=4, budget=4, scope=4, sponsor=4)), [4]),
    ("[SAMPLE] Escalating Risk Township", "Yellow", "Yellow", "2026-12-01", inputs(ratings(3, schedule=1, testing=1), stage="configuration"), [6, 3]),
    ("[SAMPLE] Greater Reported Concern Parish", "Red", "Red", "2027-02-01", inputs(ratings(4, testing=3)), [-3]),
    ("[SAMPLE] Partial Assessment Borough", "Green", "Green", "2027-04-01",
     inputs({**ratings(3), "sponsor": None, "participation": None, "readiness": None, "adoption": None}), None),
    ("[SAMPLE] Unassessed Village", "Yellow", "Green", "2027-05-01", None, None),
    ("[SAMPLE] Stale Assessment District", "Green", "Green", "2027-02-15", inputs(ratings(4, schedule=3), date="2026-09-01"), [2]),
    ("[SAMPLE] Client Confidence County", "Green", "Green", "2026-12-15",
     inputs(ratings(4, sponsor=2, participation=2, readiness=2, adoption=2, sentiment=2), codes=["sponsor-confidence-loss"]), [8]),
    ("[SAMPLE] On Hold Authority", "On Hold", "Green", "2027-06-01", inputs(ratings(4)), None),
    ("[SAMPLE] New Assessment Town", "Yellow", "Yellow", "2027-01-30", inputs(ratings(3)), None),
    ("[SAMPLE] Overdue Sign-Off Region", "Yellow", "Green", "2026-12-20",
     inputs(ratings(4), stage="training", cp={**BASE_CP, "overdueSignOffs": 1, "maxDaysOverdue": 12, "signOffsCompleted": 3}), [1]),
    ("[SAMPLE] Blocked Go-Live Shire", "Green", "Yellow", "2026-11-20", inputs(ratings(3), codes=["blocked-go-live"], owner="Implementation Manager", target="2026-09-20"), [3]),
    ("[SAMPLE] Malformed Values Municipality", "Green", "Green", "2027-03-15",
     "RAW", None),
]

RAW_MALFORMED = {"rating:schedule": "banana", "rating:budget": "3", "assess:assessmentDate": "someday", "cp:requiredArtifacts": "lots"}


def entry_for(computed, reported, client, date):
    return hm.history_entry({**computed, "assessmentDate": date}, reported, client, date + "T12:00:00+00:00")


def main():
    projects, history = [], {"version": 1, "projects": {}}
    for index, (title, reported, client, go_live, health_inputs, offsets) in enumerate(SAMPLES, start=1):
        page_id = f"sample-{index}"
        if health_inputs == "RAW":
            health_inputs = hm.normalize_health_inputs(RAW_MALFORMED, CONFIG)
        row = {"page_id": page_id, "title": title, "url": "", "last_modified": "2026-09-28T12:00:00.000Z", "summary": "",
               "project_health": f"{reported} SAMPLE project health note.", "client_health": f"{client} SAMPLE client health note.",
               "project_status": reported, "client_status": client, "project_manager": "Sample PM", "implementation_manager": "Sample IM",
               "go_live": go_live, "region_state": "Sample - ST", "epl_version": "2025.1", "contracted_products": [],
               "implementation_start_date": "2026-01-15", "_sample": True}
        if health_inputs:
            row["health_inputs"] = health_inputs
        if offsets:
            current = hm.compute_computed_health(health_inputs or {}, CONFIG)
            score = current["overallScore"]
            if score is None:
                score = 70
            # offsets are prior scores relative to the current score, oldest first; dates weekly before the assessment date.
            days = [f"2026-09-{28 - 7 * (len(offsets) - i):02d}" if 28 - 7 * (len(offsets) - i) > 0 else f"2026-08-{31 + 28 - 7 * (len(offsets) - i):02d}" for i in range(len(offsets))]
            series = []
            for offset, day in zip(offsets, days):
                prior = {**current, "overallScore": max(0, min(100, score + offset)), "clientScore": max(0, min(100, (current["clientScore"] or 70) + offset)),
                         "projectScore": max(0, min(100, (current["projectScore"] or 70) + offset)), "overallStatus": "green"}
                prior["overallStatus"] = hm.status_for_score(prior["overallScore"], CONFIG)
                series.append(entry_for(prior, reported, client, day))
            history["projects"][page_id] = series
        projects.append(row)

    generated_at = REFERENCE_DATE + "T12:00:00+00:00"
    hm.apply_computed_health(projects, history, generated_at, CONFIG)
    fixture = {"_sample": True, "_notice": "SAMPLE / TEST DATA ONLY. Not production project data.", "referenceDate": REFERENCE_DATE,
               "generated_at": generated_at, "health_model": CONFIG, "projects": projects, "history": history}
    out = ROOT / "tests" / "fixtures" / "computed_health_sample.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixture, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)} ({len(projects)} sample projects)")


if __name__ == "__main__":
    main()

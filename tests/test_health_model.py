"""Tests for the Computed Health model (health_model.py). All data here is TEST data."""
import copy
import unittest

import health_model as hm
from fetch_confluence_dashboard_data import build_change_report, extract_health_inputs

CONFIG = hm.load_config()
DIM_KEYS = [d["key"] for d in CONFIG["dimensions"]]


def inputs_with(default=4, **ratings):
    values = {key: default for key in DIM_KEYS}
    values.update(ratings)
    return {"assessmentDate": "2026-09-30", "stage": "test stage", "ratings": values, "controlPoint": {}, "overrideCodes": []}


def compute(**kwargs):
    return hm.compute_computed_health(inputs_with(**kwargs), CONFIG)


class ConfigTests(unittest.TestCase):
    def test_weights_total_100_and_groups_60_40(self):
        self.assertEqual(sum(d["weight"] for d in CONFIG["dimensions"]), 100)
        self.assertEqual(sum(d["weight"] for d in CONFIG["dimensions"] if d["group"] == "project"), 60)
        self.assertEqual(sum(d["weight"] for d in CONFIG["dimensions"] if d["group"] == "client"), 40)


class ScoringTests(unittest.TestCase):
    def test_all_fours_is_100_green(self):  # scenario 1
        result = compute()
        self.assertEqual((result["overallScore"], result["projectScore"], result["clientScore"]), (100, 100, 100))
        self.assertEqual(result["overallStatus"], "green")
        self.assertFalse(result["overrideActive"])

    def test_threshold_boundaries(self):
        for score, status in [(100, "green"), (85, "green"), (84, "yellow"), (70, "yellow"), (69, "orange"), (55, "orange"), (54, "red"), (0, "red")]:
            self.assertEqual(hm.status_for_score(score, CONFIG), status, score)
        self.assertEqual(hm.status_for_score(None, CONFIG), "gray")

    def test_weighted_math(self):
        # Every dimension rated 3 => 75 overall/project/client.
        result = compute(default=3)
        self.assertEqual((result["overallScore"], result["projectScore"], result["clientScore"]), (75, 75, 75))
        # Only schedule (weight 10) rated 0 among otherwise 4s => 90 overall, 83 project (50/60), 100 client.
        result = compute(schedule=0)
        self.assertEqual(result["overallScore"], 90)
        self.assertEqual(result["projectScore"], 83)
        self.assertEqual(result["clientScore"], 100)

    def test_dimension_zero_forces_red_even_when_score_green(self):  # scenario 2
        result = compute(schedule=0)
        self.assertEqual(result["overallBaseStatus"], "green")
        self.assertEqual(result["overallStatus"], "red")
        self.assertTrue(result["overrideActive"])
        self.assertEqual(result["overrides"][0]["id"], "dimension-zero")

    def test_two_critical_dimensions_force_red(self):  # scenario 3
        result = compute(schedule=1, budget=1)
        self.assertEqual(result["overallStatus"], "red")
        self.assertIn("multiple-critical", [o["id"] for o in result["overrides"]])
        self.assertEqual(compute(schedule=1)["overrides"], [])

    def test_missing_ratings_are_incomplete_not_zero(self):  # scenario 7
        result = compute(sentiment=None, testing=None)
        self.assertEqual(result["overallStatus"], "gray")
        self.assertIsNone(result["overallScore"])
        self.assertEqual(result["missingDimensions"], ["testing", "sentiment"])
        self.assertEqual(result["completenessPercent"], 83)
        self.assertFalse(result["complete"])

    def test_missing_weight_is_not_redistributed(self):
        # Project group complete (all 4), client group missing one => client score unpublished, no inflated average.
        result = compute(sentiment=None)
        self.assertEqual(result["projectScore"], 100)
        self.assertIsNone(result["clientScore"])
        self.assertIsNone(result["overallScore"])

    def test_no_inputs_at_all(self):
        result = hm.compute_computed_health({}, CONFIG)
        self.assertFalse(result["assessed"])
        self.assertEqual(result["overallStatus"], "gray")
        self.assertEqual(result["completenessPercent"], 0)
        self.assertEqual(result["confidence"], "none")

    def test_sponsor_confidence_loss_client_red_overall_no_better_than_orange(self):
        data = inputs_with()
        data["overrideCodes"] = ["sponsor-confidence-loss"]
        result = hm.compute_computed_health(data, CONFIG)
        self.assertEqual(result["clientStatus"], "red")
        self.assertEqual(result["overallStatus"], "orange")
        # Already red stays red.
        data = inputs_with(default=1)
        data["overrideCodes"] = ["sponsor-confidence-loss"]
        self.assertEqual(hm.compute_computed_health(data, CONFIG)["overallStatus"], "red")

    def test_blocked_go_live_and_critical_issue_force_red(self):
        for code in ("blocked-go-live", "critical-issue", "major-audit-failure"):
            data = inputs_with()
            data["overrideCodes"] = [code]
            self.assertEqual(hm.compute_computed_health(data, CONFIG)["overallStatus"], "red", code)

    def test_incomplete_with_override_keeps_incomplete_status_but_reports_override(self):
        data = inputs_with(sentiment=None)
        data["overrideCodes"] = ["blocked-go-live"]
        result = hm.compute_computed_health(data, CONFIG)
        self.assertEqual(result["overallStatus"], "gray")
        self.assertTrue(result["overrideActive"])

    def test_drivers_and_top_factors_are_generalized(self):
        result = compute(schedule=2, testing=1, sentiment=3)
        self.assertEqual([f["key"] for f in result["topFactors"]], ["testing", "schedule", "sentiment"])
        self.assertTrue(all("rated" in d or "override" in d.lower() or "Two or more" in d for d in result["primaryDrivers"]))


class ParsingTests(unittest.TestCase):
    def test_rating_parsing(self):
        cases = {"4": 4, "3 - Watch": 3, "2/4": 2, " Healthy ": 4, "At Risk": 2, "critical": 1, "Failed": 0, "Blocked": 0, 0: 0, 3.0: 3, "0": 0}
        for raw, expected in cases.items():
            self.assertEqual(hm.parse_rating(raw), (expected, None), raw)
        for raw in ("", None, "N/A", "Not assessed", "TBD", "  "):
            self.assertEqual(hm.parse_rating(raw), (None, None), raw)
        for raw in ("5", "-1", "great", True, "2.5", "10", 7, [], {}):
            self.assertEqual(hm.parse_rating(raw), (None, "malformed"), repr(raw))

    def test_count_flag_date_parsing(self):
        self.assertEqual(hm.parse_count("12"), (12, None))
        self.assertEqual(hm.parse_count("5 days"), (5, None))
        self.assertEqual(hm.parse_count("-3"), (None, "malformed"))
        self.assertEqual(hm.parse_count(""), (None, None))
        self.assertEqual(hm.parse_flag("Yes"), (True, None))
        self.assertEqual(hm.parse_flag("no"), (False, None))
        self.assertEqual(hm.parse_flag("maybe"), (None, "malformed"))
        self.assertEqual(hm.parse_date("2026-09-30"), ("2026-09-30", None))
        self.assertEqual(hm.parse_date("9/30/2026"), ("2026-09-30", None))
        self.assertEqual(hm.parse_date("Sep 30, 2026"), ("2026-09-30", None))
        self.assertEqual(hm.parse_date("soon"), (None, "malformed"))

    def test_malformed_values_do_not_raise_and_are_logged(self):  # scenario 11
        found = {"rating:schedule": "banana", "rating:budget": "3", "cp:requiredArtifacts": "lots", "assess:assessmentDate": "someday",
                 "assess:override": "gibberish", "cp:auditFailed": "perhaps"}
        inputs = hm.normalize_health_inputs(found, CONFIG)
        self.assertIsNone(inputs["ratings"]["schedule"])
        self.assertEqual(inputs["ratings"]["budget"], 3)
        issues = {(i["field"], i["issue"]) for i in inputs["dataQuality"]}
        self.assertIn(("Schedule Health", "malformed"), issues)
        self.assertIn(("Health Override", "unrecognized"), issues)
        result = hm.compute_computed_health(inputs, CONFIG)
        self.assertEqual(result["overallStatus"], "gray")
        # The data-quality log must not echo raw values (public output).
        self.assertNotIn("banana", str(inputs["dataQuality"]))

    def test_free_text_reason_not_published_by_default(self):
        inputs = hm.normalize_health_inputs({"assess:overrideReason": "Client threatened to cancel the contract"}, CONFIG)
        self.assertEqual(inputs["overrideReason"], "")

    def test_extract_from_header_and_vertical_tables(self):
        horizontal = [["Schedule Health", "Budget Health"], ["3", "4"]]
        vertical = [["Health Assessment Date", "2026-09-30"], ["Recovery Owner", "Project Manager"], ["Major Findings", "1"], ["Testing and Quality Health", "2 - At risk"]]
        found = hm.extract_health_fields([horizontal, vertical, []], CONFIG)
        inputs = hm.normalize_health_inputs(found, CONFIG)
        self.assertEqual(inputs["ratings"]["schedule"], 3)
        self.assertEqual(inputs["ratings"]["testing"], 2)
        self.assertEqual(inputs["assessmentDate"], "2026-09-30")
        self.assertEqual(inputs["recoveryOwner"], "Project Manager")
        self.assertEqual(inputs["controlPoint"]["majorFindings"], 1)

    def test_extract_health_inputs_from_adf_and_without_fields(self):
        def cell(text):
            return {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
        def row(*texts):
            return {"type": "tableRow", "content": [cell(t) for t in texts]}
        adf = {"type": "doc", "content": [{"type": "table", "content": [row("Schedule Health", "Client Sentiment Health"), row("3", "4")]}]}
        inputs = extract_health_inputs(adf, "1")
        self.assertEqual(inputs["ratings"]["schedule"], 3)
        self.assertEqual(inputs["ratings"]["sentiment"], 4)
        self.assertEqual(extract_health_inputs({"type": "doc", "content": []}, "2"), {})  # scenario 10
        self.assertEqual(extract_health_inputs("not an adf", "3"), {})  # non-dict input never raises


class ControlPointTests(unittest.TestCase):
    def rating(self, **cp):
        return hm.evaluate_control_point(cp, CONFIG)["rating"]

    def base(self, **extra):
        data = {"requiredArtifacts": 10, "approvedArtifacts": 10, "signOffsDue": 4, "signOffsCompleted": 4, "overdueSignOffs": 0,
                "controlsTested": 10, "controlsPassed": 10, "majorFindings": 0, "minorFindings": 0, "correctiveActionsDue": 0}
        data.update(extra)
        return data

    def test_rating_4(self):
        self.assertEqual(self.rating(**self.base()), 4)
        self.assertEqual(self.rating(**self.base(correctiveActionsDue=10, correctiveActionsOnTime=9)), 4)

    def test_rating_0_conditions(self):  # includes scenario 6
        self.assertEqual(self.rating(**self.base(mandatoryBypassed=True)), 0)
        self.assertEqual(self.rating(**self.base(auditFailed=True)), 0)
        self.assertEqual(self.rating(**self.base(advancedWithoutApproval=True)), 0)
        self.assertEqual(self.rating(mandatoryBypassed=True), 0)  # even with no other structured data

    def test_rating_1_conditions(self):
        self.assertEqual(self.rating(**self.base(approvedArtifacts=7)), 1)
        self.assertEqual(self.rating(**self.base(overdueSignOffs=1, maxDaysOverdue=21)), 1)
        self.assertEqual(self.rating(**self.base(majorFindings=1)), 1)
        self.assertEqual(self.rating(**self.base(evidenceMissing=True)), 1)

    def test_rating_2_conditions(self):
        self.assertEqual(self.rating(**self.base(approvedArtifacts=8)), 2)
        self.assertEqual(self.rating(**self.base(approvedArtifacts=8)), 2)
        self.assertEqual(self.rating(**self.base(overdueSignOffs=1, maxDaysOverdue=11)), 2)
        self.assertEqual(self.rating(**self.base(overdueSignOffs=1, maxDaysOverdue=20)), 2)
        self.assertEqual(self.rating(**self.base(minorFindings=3)), 2)
        self.assertEqual(self.rating(**self.base(majorFindings=1, remediationPlanApproved=True)), 2)

    def test_rating_3_conditions(self):
        self.assertEqual(self.rating(**self.base(approvedArtifacts=9)), 3)
        self.assertEqual(self.rating(**self.base(overdueSignOffs=1, maxDaysOverdue=10)), 3)
        self.assertEqual(self.rating(**self.base(minorFindings=2)), 3)
        self.assertEqual(self.rating(**self.base(correctiveActionsDue=10, correctiveActionsOnTime=8)), 3)
        self.assertEqual(self.rating(**self.base(correctiveActionsDue=10, correctiveActionsOnTime=7)), 2)

    def test_most_serious_wins(self):
        self.assertEqual(self.rating(**self.base(approvedArtifacts=9, overdueSignOffs=1, maxDaysOverdue=25)), 1)

    def test_no_corrective_actions_due_is_100_percent(self):
        result = hm.evaluate_control_point(self.base(correctiveActionsDue=0), CONFIG)
        self.assertEqual(result["correctiveActionClosurePercent"], 100.0)

    def test_percentages_and_compliance(self):
        result = hm.evaluate_control_point(self.base(approvedArtifacts=8, signOffsDue=4, overdueSignOffs=1, controlsPassed=9,
                                                     correctiveActionsDue=4, correctiveActionsOnTime=3), CONFIG)
        self.assertEqual(result["artifactCompletionPercent"], 80.0)
        self.assertEqual(result["signOffCompliancePercent"], 75.0)
        self.assertEqual(result["auditCompliancePercent"], 90.0)
        self.assertEqual(result["correctiveActionClosurePercent"], 75.0)
        self.assertEqual(result["compliancePercent"], 80.0)

    def test_insufficient_structured_data_falls_back_to_manual_rating(self):
        result = hm.evaluate_control_point({"minorFindings": 1}, CONFIG)
        self.assertIsNone(result["rating"])
        data = inputs_with(controlPoint=2)
        data["controlPoint"] = {"minorFindings": 1}
        computed = hm.compute_computed_health(data, CONFIG)
        self.assertEqual(computed["dimensions"]["controlPoint"]["rating"], 2)
        self.assertEqual(computed["dimensions"]["controlPoint"]["source"], "manual")

    def test_structured_rating_takes_precedence_over_manual(self):
        data = inputs_with(controlPoint=4)
        data["controlPoint"] = self.base(mandatoryBypassed=True)
        computed = hm.compute_computed_health(data, CONFIG)
        self.assertEqual(computed["dimensions"]["controlPoint"]["rating"], 0)
        self.assertEqual(computed["dimensions"]["controlPoint"]["source"], "structured")
        self.assertEqual(computed["overallStatus"], "red")
        self.assertIn("control-point-bypassed", [o["id"] for o in computed["overrides"]])

    def test_audit_failed_override(self):
        data = inputs_with()
        data["controlPoint"] = self.base(auditFailed=True)
        self.assertEqual(hm.compute_computed_health(data, CONFIG)["overallStatus"], "red")


class AlignmentAndHistoryTests(unittest.TestCase):
    def test_alignment_matrix(self):
        cases = [("Green", "green", "aligned"), ("Green", "yellow", "emerging-concern"), ("Green", "orange", "hidden-risk"),
                 ("Green", "red", "hidden-risk"), ("Yellow", "red", "escalating-risk"), ("Yellow", "orange", "aligned"),
                 ("Red", "green", "greater-reported-concern"), ("Red", "yellow", "greater-reported-concern"), ("Red", "orange", "aligned"),
                 ("Green", "gray", "incomplete"), ("On Hold", "red", "not-comparable"), ("Unknown", "green", "not-comparable")]
        for reported, computed, expected in cases:
            self.assertEqual(hm.classify_alignment(reported, computed, CONFIG), expected, (reported, computed))  # scenario 12

    def test_history_trend_and_same_day_replace(self):
        history = {}
        def point(score, day):
            c = compute(default=4)
            c["overallScore"], c["assessmentDate"] = score, day
            return hm.history_entry(c, "Green", "Green", day + "T00:00:00Z")
        series = hm.record_history(history, "1", point(80, "2026-09-01"))
        self.assertEqual(hm.series_trend(series)["scoreChange"], None)  # scenario 9 (no prior)
        series = hm.record_history(history, "1", point(69, "2026-09-15"))
        self.assertEqual(hm.series_trend(series), {"previousScore": 80, "scoreChange": -11, "previousAssessmentDate": "2026-09-01"})
        series = hm.record_history(history, "1", point(70, "2026-09-15"))  # same date replaces
        self.assertEqual(len(series), 2)
        self.assertEqual(hm.series_trend(series)["scoreChange"], -10)

    def test_history_skips_unscored(self):
        self.assertIsNone(hm.history_entry(hm.compute_computed_health({}, CONFIG), "Green", "Green", "2026-09-30T00:00:00Z"))


class DatasetTests(unittest.TestCase):
    def rows(self):
        return [
            {"page_id": "1", "title": "[TEST] Old style", "project_status": "Green", "client_status": "Green", "project_health": "Green ok"},
            {"page_id": "2", "title": "[TEST] Assessed", "project_status": "Green", "client_status": "Yellow", "health_inputs": inputs_with(schedule=0)},
            {"page_id": "3", "title": "[TEST] Bad", "project_status": "Red", "health_inputs": "corrupt"},
        ]

    def test_existing_rows_load_and_reported_health_untouched(self):  # scenarios 10, 13
        rows = self.rows()
        before = copy.deepcopy(rows)
        hm.apply_computed_health(rows, {}, "2026-09-30T00:00:00+00:00", CONFIG)
        for row, old in zip(rows, before):
            for key in ("project_status", "client_status", "project_health", "client_health"):
                self.assertEqual(row.get(key), old.get(key))
        self.assertEqual(rows[0]["computedHealth"]["overallStatus"], "gray")
        self.assertEqual(rows[1]["computedHealth"]["overallStatus"], "red")
        self.assertEqual(rows[2]["computedHealth"]["overallStatus"], "gray")  # corrupt inputs do not raise

    def test_computed_change_does_not_alter_reported_status(self):  # scenario 13
        rows = self.rows()[1:2]
        hm.apply_computed_health(rows, {}, "2026-09-30T00:00:00+00:00", CONFIG)
        first = rows[0]["computedHealth"]["overallStatus"]
        rows[0]["health_inputs"] = inputs_with()
        hm.apply_computed_health(rows, {}, "2026-10-01T00:00:00+00:00", CONFIG)
        self.assertNotEqual(first, rows[0]["computedHealth"]["overallStatus"])
        self.assertEqual(rows[0]["project_status"], "Green")

    def test_change_report_includes_computed_changes_and_skips_first_run(self):
        previous_rows, current_rows = self.rows()[1:2], copy.deepcopy(self.rows()[1:2])
        # First run: previous has no computedHealth => no computed changes reported.
        hm.apply_computed_health(current_rows, {}, "2026-09-30T00:00:00+00:00", CONFIG)
        report = build_change_report({"projects": previous_rows}, {"generated_at": "x", "projects": current_rows})
        self.assertEqual(report["summary"]["updated"], 0)
        # Second run: dimension and status changes appear.
        hm.apply_computed_health(previous_rows, {}, "2026-09-30T00:00:00+00:00", CONFIG)
        changed = copy.deepcopy(previous_rows)
        changed[0]["health_inputs"] = inputs_with(schedule=2)
        hm.apply_computed_health(changed, {}, "2026-10-07T00:00:00+00:00", CONFIG)
        report = build_change_report({"projects": previous_rows}, {"generated_at": "y", "projects": changed})
        fields = report["updated"][0]["changes"]
        self.assertEqual(fields["computed_status"], {"before": "Red", "after": "Green"})
        self.assertIn("computed_overall_score", fields)
        self.assertIn("computed_dim_schedule", fields)
        self.assertIn("computed_overrides", fields)
        self.assertIn("computed_alignment", fields)


if __name__ == "__main__":
    unittest.main()

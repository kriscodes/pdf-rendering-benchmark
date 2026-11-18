"""Small regression checks for campaign acceptance and export boundaries."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from compare_delivery_replicates import csv_text, inspect_attempt, sha256


class ComparisonBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "report.json"
        self.original = {key: {"unchanged": True} for key in (
            "experiment", "controls", "environment", "sourceHashes", "baselineLock", "corpus"
        )}
        self.attempt = {"ordinal": 1, "reportPath": str(self.path), "reportSha256": None,
                        "exitCode": 1, "runnerPid": 1234, "timeout": False,
                        "startedAt": "2026-11-18T00:00:00Z", "finishedAt": "2026-11-18T00:01:00Z"}

    def write_report(self, **overrides):
        self.path.write_text(json.dumps({**self.original, **overrides}), encoding="utf-8")
        self.attempt["reportSha256"] = sha256(self.path)

    def test_failed_missing_report_is_visible_without_accepted_summary(self):
        issues = []
        with patch("compare_delivery_replicates.audit_report") as audit:
            result = inspect_attempt(self.attempt, self.original, issues)
        self.assertEqual(issues, [])
        self.assertEqual(result["acceptance"], "incomplete-evidence")
        self.assertFalse(result["accepted"])
        self.assertIsNone(result["performanceSummary"])
        audit.assert_not_called()

    def test_zero_exit_without_report_is_integrity_failure(self):
        self.attempt["exitCode"] = 0
        issues = []
        result = inspect_attempt(self.attempt, self.original, issues)
        self.assertFalse(result["accepted"])
        self.assertTrue(issues)

    def test_accepted_candidate_with_changed_controls_is_not_audited_or_summarized(self):
        self.write_report(status="passed", controls={"unchanged": False})
        self.attempt["exitCode"] = 0
        issues = []
        with patch("compare_delivery_replicates.audit_report") as audit:
            result = inspect_attempt(self.attempt, self.original, issues)
        self.assertEqual(result["acceptance"], "integrity-failed")
        self.assertFalse(result["accepted"])
        self.assertIsNone(result["performanceSummary"])
        self.assertFalse(result["matchesOriginal"]["controls"]["exactMatch"])
        self.assertTrue(issues)
        audit.assert_not_called()

    def test_failed_early_report_records_missing_environment_without_inventing_it(self):
        self.write_report(status="failed", environment={})
        issues = []
        result = inspect_attempt(self.attempt, self.original, issues)
        self.assertEqual(issues, [])
        self.assertEqual(result["matchesOriginal"]["environment"]["missingFields"], ["unchanged"])
        self.assertEqual(result["recordedEnvironment"], {})
        self.assertFalse(result["accepted"])
        self.assertIsNone(result["performanceSummary"])

    def test_passed_report_with_nonzero_exit_is_not_accepted(self):
        self.write_report(status="passed")
        issues = []
        result = inspect_attempt(self.attempt, self.original, issues)
        self.assertFalse(result["accepted"])
        self.assertTrue(issues)
        self.assertIsNone(result["performanceSummary"])

    def test_csv_uses_lf_and_keeps_missing_fields_blank(self):
        result = csv_text([{"session": "original", "medianMs": 1}, {"session": "failed"}])
        self.assertNotIn("\r", result)
        self.assertEqual(result, "session,medianMs\noriginal,1\nfailed,\n")


if __name__ == "__main__":
    unittest.main()

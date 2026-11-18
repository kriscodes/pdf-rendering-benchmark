"""Evidence acceptance/selection regressions; no browser or real campaign run."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import audit_final_windows as audit


def summary(value):
    contrast = {"medianMs": value}
    return {"byCondition": {"condition": {"medianMs": 100 + value}},
            "pairedStructureEffect": {"rangeEnabled": contrast, "rangeDisabled": contrast},
            "pairedRangeEffect": {"nonlinearized": contrast, "linearized": contrast},
            "differenceOfStructureEffects": contrast}


class FinalWindowAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve(); self.path = self.root / "report.json"
        self.historical = {key: {"preserved": True} for key in ("experiment", "controls", "environment", "sourceHashes", "baselineLock", "corpus")}
        self.attempt = {"status": "finished", "reportPath": str(self.path), "reportSha256": None,
                        "exitCode": 0, "timeout": False, "cleanupVerified": True,
                        "spawnRequestedAt": "2026-11-18T17:00:00Z", "startedAt": "2026-11-18T17:00:00.500Z", "finishedAt": "2026-11-18T17:01:01Z"}

    def write_report(self, **changes):
        value = {**self.historical, "schemaVersion": 1, "purpose": "controlled-delivery-factorial-pilot", "status": "passed",
                 "startedAt": "2026-11-18T17:00:00.100Z", "finishedAt": "2026-11-18T17:01:00Z", "trials": audit.expected_schedule(), **changes}
        self.path.write_text(json.dumps(value)); self.attempt["reportSha256"] = audit.sha256(self.path)
        return value

    def test_hash_mismatch_and_old_report_cannot_be_new_accepted_evidence(self):
        self.write_report(); self.attempt["reportSha256"] = "0" * 64
        issues = []
        with patch.object(audit, "audit_performance") as old:
            result = audit.inspect_report(self.attempt, "performance", self.historical, issues)
        self.assertFalse(result["accepted"]); self.assertIsNone(result["summary"]); self.assertTrue(issues); old.assert_not_called()
        self.write_report(startedAt="2026-11-17T17:00:00Z")
        issues = []
        result = audit.inspect_report(self.attempt, "performance", self.historical, issues)
        self.assertFalse(result["accepted"]); self.assertIn("predates", result["evidenceError"])

    def test_spawn_request_binding_allows_child_before_delayed_start_callback(self):
        self.write_report()
        records = [{"includedInSummary": i >= 16, "isWarmup": i < 16} for i in range(64)]
        with patch.object(audit, "audit_performance", return_value={"summary": summary(1), "trials": records}) as old:
            result = audit.inspect_report(self.attempt, "performance", self.historical, [])
        self.assertTrue(result["accepted"]); old.assert_called_once()

    def test_partial_failure_has_no_performance_estimate_and_no_full_audit(self):
        self.write_report(status="failed", trials=audit.expected_schedule()[:3], summary=summary(999))
        self.attempt["exitCode"] = 1; issues = []
        with patch.object(audit, "audit_performance") as old:
            result = audit.inspect_report(self.attempt, "performance", self.historical, issues)
        self.assertEqual(issues, []); self.assertIsNone(result["summary"]); self.assertFalse(result["accepted"])
        self.assertEqual(result["partialEvidence"]["recordedTrials"], 3); old.assert_not_called()

    def test_missing_observer_does_not_create_performance_rejection_or_estimate(self):
        self.attempt["exitCode"] = 1; issues = []
        result = audit.inspect_report(self.attempt, "observer", self.historical, issues)
        self.assertEqual(issues, []); self.assertEqual(result["evidenceStatus"], "missing report")
        self.assertNotIn("summary", result)

    def test_malformed_schedule_and_duplicate_json_keys_are_rejected(self):
        rows = audit.expected_schedule(); rows[1] = rows[0]
        self.write_report(trials=rows); issues = []
        result = audit.inspect_report(self.attempt, "performance", self.historical, issues)
        self.assertFalse(result["accepted"]); self.assertTrue(issues)
        self.path.write_text('{"status":"passed","status":"failed"}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
            audit.load(self.path)

    def test_two_new_windows_required_and_pending_is_not_a_final_conclusion(self):
        one = [{"ordinal": 1, "performance": {"summary": summary(2)}}]
        self.assertEqual(audit.between_windows([], all_slots_terminal=False)["status"], "fixed windows pending; no comparison yet")
        self.assertNotIn("pairedContrasts", audit.between_windows(one))
        result = audit.between_windows(one + [{"ordinal": 3, "performance": {"summary": summary(-1)}}])
        self.assertEqual(result["pairedContrasts"]["structureRangeEnabled"]["directionalAgreement"], "mixed")
        self.assertEqual(result["acceptedNewWindows"], 2)

    def test_nested_clock_gain_excludes_invalid_operations_and_separates_joint_status(self):
        rows = [{"arm": "fifteen", "attempted": True, "operationValidated": valid, "sessionValidated": True,
                 "referenceClockStatus": reference, "candidateClockStatus": "passed", "referenceStatus": "failed", "candidateStatus": "failed"}
                for valid, reference in ((True, "passed"), (True, "failed"), (False, "failed"))]
        result = audit.observer_outcomes({"trials": rows, "overall": {"methodCounts": {}}, "guards": [], "perturbation": {}})
        clocks = result["nestedClockAcceptanceAmongOperationValidHighTrials"]
        self.assertEqual(clocks["eligibleHighArmTrials"], 2); self.assertEqual(clocks["bothPassed"], 1); self.assertEqual(clocks["candidateOnly"], 1)
        self.assertEqual(result["nestedMethodValidityAmongOperationValidHighTrials"]["neither"], 2)

    def test_ledger_admission_bound_is_exclusive_and_second_runner_may_start_later(self):
        digest = "a" * 64; plan_path = self.root / "plan.json"; output = self.root / "window-1"
        window = {"ordinal": 1, "opensAtUTC": "2026-11-18T17:00:00Z", "latestStartAtUTC": "2026-11-18T18:00:00Z"}
        plan = {"id": "fixed", "expectedNodeVersion": "v24.22.1", "expectedBranch": "feature"}
        with patch.object(audit, "ROOT", self.root):
            claim = {"schemaVersion": 1, "planId": "fixed", "planPath": str(plan_path), "planSha256": digest,
                     "windowOrdinal": 1, "outputDir": str(output), "launcherPid": 99, "claimedAt": "2026-11-18T17:59:45Z"}
            ledger = {"schemaVersion": 1, "purpose": "fixed-final-window", "planPath": str(plan_path), "planSha256": digest,
                      "window": window, "claimPath": str(audit.claim_path(plan, 1)), "status": "complete", "startedAt": claim["claimedAt"],
                      "admittedAt": "2026-11-18T17:59:48Z", "finishedAt": "2026-11-18T18:01:01Z", "cleanupVerified": True,
                      "nodeExecutable": str(self.root / "node"), "nodeSha256": digest, "nodeVersion": "v24.22.1", "unattemptedRunners": [],
                      "launcherPath": str(self.root / "packages/runner/scripts/run_final_windows.py"), "launcherSha256": digest,
                      "processHelperPath": str(self.root / "packages/runner/scripts/run_delivery_replicates.py"), "processHelperSha256": digest,
                      "preservationChecks": [{"stage": stage, "status": "passed", "branch": "feature", "nodeVersion": "v24.22.1", "activeRunners": []} for stage in
                                             ("window-before", "observer-before", "observer-after", "performance-before", "performance-after", "window-after")], "attempts": []}
            for i, (kind, runner) in enumerate(audit.RUNNERS.items(), 1):
                start, finish = ("17:59:50", "18:00:00") if i == 1 else ("18:00:01", "18:01:00")
                attempt = {"ordinal": i, "id": kind, "status": "finished", "runnerPath": str(self.root / runner),
                           "reportPath": str(output / kind / "report.json"), "stdoutPath": str(output / (kind + ".log")),
                           "startedAt": f"2026-11-18T{start}Z", "spawnRequestedAt": f"2026-11-18T{start}Z", "finishedAt": f"2026-11-18T{finish}Z",
                           "timeout": False, "exitCode": 0, "runnerPid": 100 + i, "cleanupVerified": True,
                           "cleanupEvidence": {"runnerProcessGroupGone": True, "remainingExperimentProcesses": []}}
                attempt["command"] = [ledger["nodeExecutable"], attempt["runnerPath"], "--output-dir", str(output / kind)]
                ledger["attempts"].append(attempt)
            with patch.object(audit, "load", return_value=claim), patch.object(audit, "sha256", return_value=digest), patch.object(audit, "digest_matches"):
                audit.validate_ledger(ledger, plan, plan_path, output, window)
                bad = copy.deepcopy(ledger); bad["admittedAt"] = window["latestStartAtUTC"]
                with self.assertRaisesRegex(ValueError, "outside fixed"):
                    audit.validate_ledger(bad, plan, plan_path, output, window)
                bad = copy.deepcopy(ledger); bad["attempts"].reverse()
                with self.assertRaisesRegex(ValueError, "sequence"):
                    audit.validate_ledger(bad, plan, plan_path, output, window)
                bad = copy.deepcopy(ledger)
                bad["attempts"][0]["cleanupEvidence"]["remainingExperimentProcesses"] = [{"pid": 999, "processGroup": 999, "runner": "detached Chromium"}]
                with self.assertRaisesRegex(ValueError, "Cleanup claim"):
                    audit.validate_ledger(bad, plan, plan_path, output, window)
                bad = copy.deepcopy(ledger); bad["preservationChecks"][0]["activeRunners"] = ["other runner"]
                with self.assertRaisesRegex(ValueError, "preservation/runtime"):
                    audit.validate_ledger(bad, plan, plan_path, output, window)


if __name__ == "__main__":
    unittest.main()

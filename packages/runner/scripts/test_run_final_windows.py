"""Fixed-window tests use injected clocks/processes, never Node or browsers."""

from __future__ import annotations

import contextlib
import fcntl
import io
import json
import os
import signal
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_final_windows as runner


class WindowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.plan_path = self.root / "plan.json"
        self.output = self.root / "evidence"
        self.opened = datetime(2026, 11, 18, 17, tzinfo=timezone.utc)
        self.current = self.opened
        self.node = self.root / "node"
        self.qpdf = self.root / "qpdf"
        for path in (self.node, self.qpdf):
            path.write_text("fake protected runtime")
            path.chmod(0o755)
        files = [path for _, path in runner.RUNNERS] + ["docs/protocol.md", "historical.json"]
        for filename in files:
            path = self.root / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"status":"passed"}\n')
        self.plan = {"schemaVersion": 1, "id": "test-fixed-windows", "expectedBranch": "feat/corpus-text-pair",
                     "expectedNodeVersion": "v24.22.1", "maximumInvocationSeconds": 600,
                     "protocolPath": "docs/protocol.md",
                     "historicalReport": {"path": "historical.json", "sha256": runner.processes.digest(self.root / "historical.json")},
                     "runners": [{"id": name, "path": path, "args": []} for name, path in runner.RUNNERS],
                     "preservedHashes": {name: runner.processes.digest(self.root / name) for name in files},
                     "runtimeHashes": {str(path): runner.processes.digest(path) for path in [self.node, self.qpdf]},
                     "windows": [{"ordinal": n, "opensAtUTC": runner.iso(self.opened + timedelta(hours=(n - 1) * 3)),
                                  "latestStartAtUTC": runner.iso(self.opened + timedelta(hours=(n - 1) * 3 + 1))} for n in [1, 2, 3]]}
        self.write_plan()
        self.calls = []
        self.behavior = None
        self.cleanup = lambda pid: True
        self.activities = lambda: []
        self.version = lambda node: "v24.22.1"
        self.branch = lambda root: "feat/corpus-text-pair"
        environment = patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop("PLAYWRIGHT_BROWSERS_PATH", None)

    def write_plan(self):
        self.plan_path.write_text(json.dumps(self.plan))

    def fake_process(self, command, cwd, stdout_path, maximum, started):
        self.assertEqual(maximum, 600)
        self.assertEqual(cwd, self.root)
        self.assertEqual(command[-2], "--output-dir")
        destination = Path(command[-1])
        self.assertEqual(list(destination.iterdir()), [])
        self.calls.append(command)
        pid = 1000 + len(self.calls)
        started(pid)
        stdout_path.write_text("fake runner output\n")
        (destination / "report.json").write_text('{"status":"passed"}\n')
        if self.behavior:
            result = self.behavior(destination, pid)
            if result is not None:
                return result
        return runner.processes.ProcessResult(pid, 0, False)

    def launch(self, ordinal=1, output=None):
        with contextlib.redirect_stdout(io.StringIO()), patch.object(runner.shutil, "which", return_value=str(self.qpdf)):
            result = runner.run_window(self.plan_path, self.node, ordinal, output or self.output,
                                       root=self.root, clock=lambda: self.current,
                                       process_runner=self.fake_process, version_reader=self.version,
                                       branch_reader=self.branch, cleanup_checker=self.cleanup,
                                       activity_reader=self.activities)
        path = (output or self.output) / f"window-{ordinal}/ledger.json"
        if path.exists():
            self.assertEqual(result, json.loads(path.read_text()))
        return result

    def test_before_open_does_not_claim_or_launch(self):
        self.current -= timedelta(microseconds=1)
        self.assertEqual(self.launch()["status"], "not-open")
        self.assertFalse(self.output.exists())
        self.assertFalse((self.root / "results").exists())
        self.assertEqual(self.calls, [])

    def test_latest_start_is_exclusive_and_missed_slot_is_consumed(self):
        self.current += timedelta(hours=1)
        ledger = self.launch()
        self.assertEqual(ledger["status"], "missed")
        self.assertEqual(ledger["unattemptedRunners"], ["observer", "performance"])
        self.assertEqual(self.calls, [])
        with self.assertRaisesRegex(FileExistsError, "already claimed"):
            self.launch()

    def test_fixed_order_scientific_failure_continues_and_records_snapshots(self):
        def failure(destination, pid):
            if destination.name == "observer":
                (destination / "report.json").write_text('{"status":"failed"}')
                return runner.processes.ProcessResult(pid, 1, False)
        self.behavior = failure
        ledger = self.launch()
        self.assertEqual(ledger["status"], "complete")
        self.assertEqual([a["id"] for a in ledger["attempts"]], ["observer", "performance"])
        self.assertEqual([a["exitCode"] for a in ledger["attempts"]], [1, 0])
        self.assertEqual(ledger["unattemptedRunners"], [])
        self.assertEqual(len(ledger["preservationChecks"]), 6)
        for attempt in ledger["attempts"]:
            self.assertTrue(attempt["cleanupVerified"])
            self.assertEqual(attempt["reportSha256"], runner.processes.digest(Path(attempt["reportPath"])))
        snapshot = self.output / "window-1/source-snapshot"
        self.assertEqual((snapshot / "plan.json").read_bytes(), self.plan_path.read_bytes())
        self.assertEqual((snapshot / "launcher.py").read_bytes(), runner.LAUNCHER.read_bytes())
        self.assertEqual((snapshot / "process-helper.py").read_bytes(), runner.HELPER.read_bytes())

    def test_second_runner_can_start_after_window_closes(self):
        def advance(destination, pid):
            if destination.name == "observer":
                self.current += timedelta(hours=2)
        self.behavior = advance
        ledger = self.launch()
        self.assertEqual(ledger["status"], "complete")
        self.assertLess(runner.parse_utc(ledger["admittedAt"]), runner.parse_utc(self.plan["windows"][0]["latestStartAtUTC"]))
        self.assertGreater(runner.parse_utc(ledger["attempts"][1]["startedAt"]), runner.parse_utc(self.plan["windows"][0]["latestStartAtUTC"]))

    def test_timeout_with_verified_cleanup_keeps_partial_report_and_continues(self):
        self.behavior = lambda destination, pid: runner.processes.ProcessResult(pid, -15, True)
        ledger = self.launch()
        self.assertEqual(ledger["status"], "complete")
        self.assertEqual(len(self.calls), 2)
        self.assertTrue(all(a["timeout"] and a["reportSha256"] for a in ledger["attempts"]))

    def test_missing_report_is_retained_without_skipping_next_scientific_attempt(self):
        def missing(destination, pid):
            if destination.name == "observer":
                (destination / "report.json").unlink()
                return runner.processes.ProcessResult(pid, 2, False)
        self.behavior = missing
        ledger = self.launch()
        self.assertEqual(ledger["status"], "complete")
        self.assertIsNone(ledger["attempts"][0]["reportSha256"])

    def test_duplicate_claim_cannot_be_bypassed_with_another_output_root(self):
        self.launch()
        before = (self.output / "window-1/ledger.json").read_bytes()
        with self.assertRaisesRegex(FileExistsError, "already claimed"):
            self.launch(output=self.root / "different")
        self.assertEqual((self.output / "window-1/ledger.json").read_bytes(), before)
        self.assertEqual(len(self.calls), 2)

    def test_global_lock_prevents_overlap_without_consuming_window(self):
        base, claims = runner.coordination(self.root, self.plan)
        base.mkdir(parents=True)
        with (base / "campaign.lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.launch()["status"], "busy")
        self.assertFalse((claims / "window-1.json").exists())
        self.assertEqual(self.calls, [])

    def test_changed_source_after_observer_aborts_before_performance(self):
        self.behavior = lambda destination, pid: (self.root / "docs/protocol.md").write_text("changed") and None
        ledger = self.launch()
        self.assertEqual(ledger["status"], "aborted")
        self.assertIn("Preservation mismatch", ledger["error"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(ledger["unattemptedRunners"], ["performance"])

    def test_runtime_hash_mismatch_prevents_any_launch(self):
        self.qpdf.write_text("changed runtime")
        ledger = self.launch()
        self.assertEqual(ledger["status"], "aborted")
        self.assertEqual(self.calls, [])

    def test_missing_runtime_consumes_slot_with_aborted_ledger(self):
        self.node.unlink()
        ledger = self.launch()
        self.assertEqual(ledger["status"], "aborted")
        self.assertEqual(ledger["unattemptedRunners"], ["observer", "performance"])
        self.assertIn("missing or not executable", ledger["error"])
        self.assertEqual(self.calls, [])
        with self.assertRaisesRegex(FileExistsError, "already claimed"):
            self.launch()

    def test_wrong_branch_or_node_version_prevents_launch(self):
        self.branch = lambda root: "other-work"
        ledger = self.launch()
        self.assertEqual(ledger["status"], "aborted")
        self.assertIn("branch", ledger["error"])
        self.assertEqual(self.calls, [])
        self.current += timedelta(hours=3)
        self.branch = lambda root: "feat/corpus-text-pair"
        self.version = lambda node: "v25.0.0"
        second = self.launch(2)
        self.assertIn("runtime", second["error"])
        self.assertEqual(self.calls, [])

    def test_browser_override_and_unprotected_node_are_rejected(self):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/different"
        first = self.launch()
        self.assertEqual(first["status"], "aborted")
        self.assertIn("PLAYWRIGHT_BROWSERS_PATH", first["error"])
        os.environ.pop("PLAYWRIGHT_BROWSERS_PATH")
        self.current += timedelta(hours=3)
        other_node = self.root / "other-node"
        other_node.write_bytes(self.node.read_bytes())
        other_node.chmod(0o755)
        self.node = other_node
        second = self.launch(2)
        self.assertIn("protected runtime path", second["error"])
        self.assertEqual(self.calls, [])

    def test_unverified_cleanup_stops_second_runner_and_future_window(self):
        self.cleanup = lambda pid: False
        first = self.launch()
        self.assertEqual(first["status"], "aborted")
        self.assertFalse(first["cleanupVerified"])
        self.assertEqual(len(self.calls), 1)
        self.current += timedelta(hours=3)
        with self.assertRaisesRegex(RuntimeError, "unverified cleanup"):
            self.launch(2)

    def test_detached_browser_blocks_next_runner_despite_runner_group_exit(self):
        residual = {"pid": 456, "processGroup": 456, "runner": "chrome-headless-shell"}
        self.activities = lambda: [residual] if self.calls else []
        ledger = self.launch()
        self.assertEqual(ledger["status"], "aborted")
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(ledger["cleanupVerified"])
        evidence = ledger["attempts"][0]["cleanupEvidence"]
        self.assertTrue(evidence["runnerProcessGroupGone"])
        self.assertEqual(evidence["remainingExperimentProcesses"], [residual])

    def test_active_scan_matches_frozen_browser_and_children_without_other_browsers(self):
        browser = self.root / "chromium_headless_shell-1234/chrome-headless-shell"
        output = f"10 10 {browser} --headless\n11 10 {browser} --type=renderer\n12 12 /other/chrome-headless-shell --headless\n13 13 /runtime/node /repo/packages/runner/dist/controlled-delivery.js\n"
        with patch.object(runner.subprocess, "run", return_value=type("Result", (), {"stdout": output})()):
            found = runner.active_runners([str(browser)])
        self.assertEqual([item["pid"] for item in found], [10, 11, 13])
        self.assertTrue(all(set(item) == {"pid", "processGroup", "runner"} for item in found))

    def test_sigterm_retains_interrupted_evidence_without_retry(self):
        def terminate(destination, pid):
            os.kill(os.getpid(), signal.SIGTERM)
        self.behavior = terminate
        ledger = self.launch()
        self.assertEqual(ledger["status"], "interrupted")
        self.assertEqual(ledger["attempts"][0]["status"], "interrupted")
        self.assertTrue(ledger["attempts"][0]["cleanupVerified"])
        self.assertIsNotNone(ledger["attempts"][0]["reportSha256"])
        with self.assertRaises(FileExistsError):
            self.launch()

    def test_stale_claim_without_ledger_blocks_later_window(self):
        self.launch()
        (self.output / "window-1/ledger.json").unlink()
        self.current += timedelta(hours=3)
        with self.assertRaisesRegex(RuntimeError, "no ledger"):
            self.launch(2)
        self.assertEqual(len(self.calls), 2)

    def test_plan_change_between_windows_is_rejected(self):
        self.launch()
        self.plan["windows"][1]["latestStartAtUTC"] = runner.iso(self.opened + timedelta(hours=4, minutes=1))
        self.write_plan()
        self.current += timedelta(hours=3)
        with self.assertRaisesRegex(RuntimeError, "frozen campaign plan"):
            self.launch(2)
        self.assertEqual(len(self.calls), 2)

    def test_earlier_uncoordinated_experiment_blocks_start(self):
        self.activities = lambda: [{"pid": 123, "processGroup": 123, "runner": "controlled-delivery.js"}]
        ledger = self.launch()
        self.assertEqual(ledger["status"], "aborted")
        self.assertIn("earlier experiment", ledger["error"])
        self.assertFalse(ledger["cleanupVerified"])
        self.assertEqual(self.calls, [])

    def test_preflight_crossing_latest_start_marks_missed(self):
        def version(node):
            self.current = self.opened + timedelta(hours=1)
            return "v24.22.1"
        self.version = version
        ledger = self.launch()
        self.assertEqual(ledger["status"], "missed")
        self.assertEqual(self.calls, [])

    def test_audit_only_does_not_modify_claim_or_ledger(self):
        self.launch()
        path = self.output / "window-1/ledger.json"
        before = path.read_bytes()
        result = runner.inspect_window(self.plan_path, 1, root=self.root)
        self.assertEqual(result["status"], "claimed")
        self.assertEqual(result["ledger"]["status"], "complete")
        self.assertEqual(path.read_bytes(), before)

    def test_process_group_verification_is_bounded_and_does_not_signal(self):
        with patch.object(runner.os, "killpg") as query:
            self.assertFalse(runner.process_group_gone(123, maximum_seconds=0))
            query.assert_called_once_with(123, 0)
        with patch.object(runner.os, "killpg", side_effect=ProcessLookupError):
            self.assertTrue(runner.process_group_gone(123, maximum_seconds=0))


if __name__ == "__main__":
    unittest.main()

"""Launcher tests use isolated Python children; no Node or browser is launched."""

from __future__ import annotations

import contextlib
import io
import json
import signal
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_delivery_replicates as runner


class CampaignTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "packages/runner/dist/controlled-delivery.js"
        self.source.parent.mkdir(parents=True)
        self.source.write_text("frozen source\n")
        self.artifact = self.root / "historical-report.json"
        self.artifact.write_text('{"status":"passed"}\n')
        self.plan = self.root / "plan.json"
        self.plan.write_text(json.dumps({
            "schemaVersion": 1, "id": "test", "additionalRunCount": 3,
            "historicalReport": {"path": self.artifact.name, "sha256": runner.digest(self.artifact)},
            "preservedSourceHashes": {str(self.source.relative_to(self.root)): runner.digest(self.source)},
            "preservedArtifactHashes": {self.artifact.name: runner.digest(self.artifact)},
            "runnerPath": "packages/runner/dist/controlled-delivery.js",
            "maxInvocationSeconds": 600, "expectedNodeVersion": "v24.22.1",
        }))
        self.output = self.root / "campaign"
        self.fake = self.root / "fake.py"
        self.node = Path(sys.executable).resolve()

    def launch(self, body: str, *, short_timeout: bool = False) -> tuple[dict, str]:
        self.fake.write_text("import json, pathlib, sys, time\n"
                             "output = pathlib.Path(sys.argv[2])\n" + body)
        captured = io.StringIO()

        def process(command, cwd, log, maximum, started):
            self.assertEqual(maximum, 600)
            return runner.run_process(command, cwd, log, 0.15 if short_timeout else 5,
                                      started, terminate_grace=0.1, kill_grace=1)

        with patch.object(runner, "node_version", return_value="v24.22.1"), contextlib.redirect_stdout(captured):
            ledger = runner.run_campaign(
                self.plan, self.node, self.output, root=self.root, process_runner=process,
                command_factory=lambda node, source, output: [str(node), str(self.fake), "--output-dir", str(output)],
            )
        self.assertEqual(ledger, json.loads((self.output / "ledger.json").read_text()))
        return ledger, captured.getvalue()

    def test_three_attempts_despite_failure_no_replacement_fresh_directories_and_tee(self) -> None:
        ledger, console = self.launch(
            "ordinal = int(output.name.rsplit('-', 1)[1])\n"
            "assert list(output.iterdir()) == []\n"
            "(output / 'report.json').write_text(json.dumps({'status': 'failed' if ordinal == 2 else 'passed'}))\n"
            "print('stdout-' + str(ordinal), flush=True)\n"
            "print('stderr-' + str(ordinal), file=sys.stderr, flush=True)\n"
            "sys.exit(9 if ordinal == 2 else 0)\n"
        )
        self.assertEqual(ledger["status"], "complete")
        self.assertEqual([a["ordinal"] for a in ledger["attempts"]], [1, 2, 3])
        self.assertEqual([a["exitCode"] for a in ledger["attempts"]], [0, 9, 0])
        self.assertEqual(len({a["runnerPid"] for a in ledger["attempts"]}), 3)
        self.assertFalse((self.output / "replicate-4").exists())
        self.assertEqual(ledger["planSha256"], runner.digest(self.plan))
        self.assertEqual(ledger["launcherSha256"], runner.digest(runner.LAUNCHER))
        self.assertEqual(len(ledger["preservationChecks"]), 8)
        self.assertTrue(all(check["status"] == "passed" for check in ledger["preservationChecks"]))
        for attempt in ledger["attempts"]:
            self.assertIsInstance(attempt["runnerPid"], int)
            self.assertTrue(attempt["startedAt"] <= attempt["finishedAt"])
            self.assertFalse(attempt["timeout"])
            self.assertEqual(attempt["reportSha256"], runner.digest(Path(attempt["reportPath"])))
            log = Path(attempt["stdoutPath"]).read_text()
            for stream in ("stdout", "stderr"):
                line = f"{stream}-{attempt['ordinal']}"
                self.assertIn(line, log)
                self.assertIn(line, console)

    def test_changed_source_stops_campaign_without_next_attempt(self) -> None:
        ledger, _ = self.launch(
            "(output / 'report.json').write_text('{\"status\":\"passed\"}')\n"
            f"pathlib.Path({str(self.source)!r}).write_text('changed')\n"
        )
        self.assertEqual(ledger["status"], "failed")
        self.assertIn("Preservation mismatch", ledger["error"])
        self.assertEqual(len(ledger["attempts"]), 1)
        self.assertEqual(ledger["attempts"][0]["exitCode"], 0)
        self.assertEqual(ledger["preservationChecks"][-1]["status"], "failed")
        self.assertFalse((self.output / "replicate-2").exists())

    def test_existing_artifact_mismatch_prevents_any_attempt(self) -> None:
        self.artifact.write_text("changed")
        ledger, _ = self.launch("raise AssertionError('must not run')\n")
        self.assertEqual(ledger["status"], "failed")
        self.assertEqual(ledger["attempts"], [])

    def test_nonempty_output_refused(self) -> None:
        self.output.mkdir()
        sentinel = self.output / "keep.txt"
        sentinel.write_text("keep")
        with self.assertRaisesRegex(ValueError, "new or empty"):
            self.launch("raise AssertionError('must not run')\n")
        self.assertEqual(list(self.output.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), "keep")

    def test_node_version_mismatch_prevents_any_attempt(self) -> None:
        with patch.object(runner, "node_version", return_value="v25.0.0"):
            with self.assertRaisesRegex(ValueError, "Node version changed"):
                runner.run_campaign(self.plan, self.node, self.output, root=self.root)
        self.assertFalse(self.output.exists())

    def test_timeouts_preserve_partial_reports_and_continue_fixed_three(self) -> None:
        ledger, _ = self.launch(
            "(output / 'report.json').write_text('{\"status\":\"running\"}')\n"
            "print('partial evidence', flush=True)\n"
            "time.sleep(20)\n", short_timeout=True,
        )
        self.assertEqual(ledger["status"], "complete")
        self.assertEqual(len(ledger["attempts"]), 3)
        for attempt in ledger["attempts"]:
            self.assertTrue(attempt["timeout"])
            self.assertNotEqual(attempt["exitCode"], 0)
            self.assertEqual(json.loads(Path(attempt["reportPath"]).read_text())["status"], "running")
            self.assertEqual(attempt["reportSha256"], runner.digest(Path(attempt["reportPath"])))
            self.assertIn("partial evidence", Path(attempt["stdoutPath"]).read_text())

    def test_timeout_kills_group_child_even_after_parent_and_pipe_exit(self) -> None:
        escaped = self.root / "escaped.txt"
        ready = self.root / "ready.txt"
        child_code = (
            "import pathlib, signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
            f"pathlib.Path({str(ready)!r}).write_text('ready'); time.sleep(0.7); "
            f"pathlib.Path({str(escaped)!r}).write_text('survived')"
        )
        self.fake.write_text(
            "import pathlib, subprocess, sys, time\n"
            f"subprocess.Popen([sys.executable, '-c', {child_code!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
            f"while not pathlib.Path({str(ready)!r}).exists(): time.sleep(0.005)\n"
            "print('child ready', flush=True)\n"
            "time.sleep(20)\n"
        )
        started = []
        before = time.monotonic()
        result = runner.run_process([str(self.node), str(self.fake)], self.root, self.root / "group.log",
                                    0.3, started.append, terminate_grace=0.1, kill_grace=1,
                                    console_write=lambda data: None)
        self.assertTrue(result.timeout)
        self.assertEqual(result.exit_code, -signal.SIGTERM)
        self.assertEqual(started, [result.runner_pid])
        self.assertTrue(ready.exists())
        self.assertLess(time.monotonic() - before, 2)
        time.sleep(0.5)
        self.assertFalse(escaped.exists(), "A child that ignored SIGTERM escaped the process-group timeout")


if __name__ == "__main__":
    unittest.main()

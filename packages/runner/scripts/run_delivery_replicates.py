"""Run exactly three unchanged, serial controlled-delivery attempts.

Campaign completion means all planned attempts finished, not that they passed.
Nonzero exits/timeouts are retained without replacement. Preservation or launcher
failures stop the campaign. This script does not interpret benchmark timings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import selectors
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from tempfile import mkdtemp
from typing import Callable

ROOT = Path(__file__).resolve().parents[3]
LAUNCHER = Path(__file__).resolve()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def resolve_path(root: Path, name: str) -> Path:
    path = Path(name)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def node_version(node: Path) -> str:
    result = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=10, check=True)
    return result.stdout.strip()


def validate_plan(plan: dict) -> None:
    for key, expected in (("schemaVersion", 1), ("additionalRunCount", 3), ("maxInvocationSeconds", 600)):
        if type(plan.get(key)) is not int or plan[key] != expected:
            raise ValueError(f"Plan requires {key}={expected}")
    if not isinstance(plan.get("id"), str) or not plan["id"]:
        raise ValueError("Plan id is required")
    if plan.get("runnerPath") != "packages/runner/dist/controlled-delivery.js":
        raise ValueError("Plan must use the unchanged controlled-delivery runner")
    if not isinstance(plan.get("expectedNodeVersion"), str) or not plan["expectedNodeVersion"]:
        raise ValueError("Plan expectedNodeVersion is required")
    for field in ("preservedSourceHashes", "preservedArtifactHashes"):
        values = plan.get(field)
        if not isinstance(values, dict) or not values:
            raise ValueError(f"Plan requires a nonempty {field} mapping")
        for name, value in values.items():
            if not isinstance(name, str) or not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
                raise ValueError(f"Invalid preserved path/hash in {field}")
    historical = plan.get("historicalReport", {})
    if not isinstance(historical, dict) or not isinstance(historical.get("path"), str) \
            or not isinstance(historical.get("sha256"), str) \
            or re.fullmatch(r"[0-9a-f]{64}", historical["sha256"]) is None:
        raise ValueError("Plan requires historicalReport path and SHA-256")


@dataclass(frozen=True)
class ProcessResult:
    runner_pid: int
    exit_code: int
    timeout: bool


def _console(data: bytes) -> None:
    if hasattr(sys.stdout, "buffer"):
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    else:
        sys.stdout.write(data.decode("utf-8", errors="replace"))
        sys.stdout.flush()


def _signal_group(process: subprocess.Popen, sig: signal.Signals) -> None:
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass


def run_process(command: list[str], cwd: Path, stdout_path: Path, max_seconds: float,
                on_start: Callable[[int], None], *, terminate_grace: float = 5,
                kill_grace: float = 5, console_write: Callable[[bytes], None] = _console) -> ProcessResult:
    """Tee combined output while bounding the runner's newly created process group."""
    with stdout_path.open("xb") as log:
        process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   start_new_session=True, bufsize=0)
        assert process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + max_seconds
        termination_deadline = kill_deadline = None
        timed_out = False
        output_closed = False
        try:
            on_start(process.pid)
            while process.poll() is None or not output_closed:
                clock = time.monotonic()
                if not timed_out and clock >= deadline:
                    timed_out = True
                    _signal_group(process, signal.SIGTERM)
                    termination_deadline = clock + terminate_grace
                elif termination_deadline is not None and clock >= termination_deadline:
                    _signal_group(process, signal.SIGKILL)
                    termination_deadline = None
                    kill_deadline = clock + kill_grace
                elif kill_deadline is not None and clock >= kill_deadline:
                    raise RuntimeError("Runner process group/output did not quiesce after bounded termination")
                for key, _ in selector.select(0.05):
                    data = os.read(key.fd, 65536)
                    if data:
                        log.write(data)
                        log.flush()
                        console_write(data)
                    else:
                        selector.unregister(process.stdout)
                        output_closed = True
            if timed_out:
                # A parent can exit and close its pipe while a child ignores TERM.
                _signal_group(process, signal.SIGKILL)
            return ProcessResult(process.pid, process.wait(timeout=kill_grace), timed_out)
        except BaseException:
            _signal_group(process, signal.SIGTERM)
            try:
                process.wait(timeout=terminate_grace)
            except subprocess.TimeoutExpired:
                _signal_group(process, signal.SIGKILL)
                process.wait(timeout=kill_grace)
            finally:
                _signal_group(process, signal.SIGKILL)
            raise
        finally:
            selector.close()
            process.stdout.close()


def run_campaign(plan_path: Path, node: Path, output_dir: Path | None = None, *,
                 root: Path = ROOT, process_runner: Callable = run_process,
                 command_factory: Callable[[Path, Path, Path], list[str]] | None = None) -> dict:
    """Dependency hooks support fake-runner tests; the CLI uses the fixed command."""
    root = root.resolve()
    plan_path = plan_path.resolve()
    plan_hash = digest(plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    validate_plan(plan)
    if not node.is_absolute() or not node.is_file() or not os.access(node, os.X_OK):
        raise ValueError("--node must be an absolute path to an executable file")
    node = node.resolve()
    actual_node_version = node_version(node)
    if actual_node_version != plan["expectedNodeVersion"]:
        raise ValueError(f"Node version changed: expected {plan['expectedNodeVersion']}, got {actual_node_version}")
    if output_dir is None:
        parent = root / "results/raw/controlled-delivery-replication"
        parent.mkdir(parents=True, exist_ok=True)
        output = Path(mkdtemp(prefix="batch-", dir=parent))
    else:
        output = output_dir.resolve()
        if output.exists() and (not output.is_dir() or any(output.iterdir())):
            raise ValueError(f"Campaign output directory must be new or empty: {output}")
        output.mkdir(parents=True, exist_ok=True)
    launcher_hash = digest(LAUNCHER)
    ledger = {
        "schemaVersion": 1, "planPath": str(plan_path), "planSha256": plan_hash,
        "launcherPath": str(LAUNCHER), "launcherSha256": launcher_hash,
        "nodeExecutable": str(node), "nodeVersion": actual_node_version,
        "status": "running", "startedAt": now(), "finishedAt": None,
        "attempts": [], "preservationChecks": [],
        "completionMeaning": "Exactly three attempts finished; individual acceptance is determined from their reports and exits.",
    }
    ledger_path = output / "ledger.json"

    def save() -> None:
        temporary = output / "ledger.json.tmp"
        temporary.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
        temporary.replace(ledger_path)

    def preserved(stage: str) -> None:
        check = {"stage": stage, "checkedAt": now(), "status": "running"}
        ledger["preservationChecks"].append(check)
        try:
            expected_files = {str(plan_path): plan_hash, str(LAUNCHER): launcher_hash}
            for field in ("preservedSourceHashes", "preservedArtifactHashes"):
                for name, expected in plan[field].items():
                    filename = str(resolve_path(root, name))
                    if filename in expected_files and expected_files[filename] != expected:
                        raise ValueError(f"Conflicting preserved hashes: {name}")
                    expected_files[filename] = expected
            historical = plan["historicalReport"]
            historical_path = str(resolve_path(root, historical["path"]))
            if historical_path in expected_files and expected_files[historical_path] != historical["sha256"]:
                raise ValueError("Conflicting historical-report hash")
            expected_files[historical_path] = historical["sha256"]
            for name, expected in expected_files.items():
                if digest(Path(name)) != expected:
                    raise ValueError(f"Preservation mismatch: {name}")
            check.update(status="passed", checkedFiles=len(expected_files))
        except Exception as error:
            check.update(status="failed", error=str(error))
            raise
        finally:
            save()

    save()
    try:
        preserved("campaign-before")
        for ordinal in range(1, 4):
            preserved(f"attempt-{ordinal}-before")
            attempt_dir = output / f"replicate-{ordinal}"
            attempt_dir.mkdir()
            report_path = attempt_dir / "report.json"
            stdout_path = output / f"replicate-{ordinal}.log"
            attempt = {
                "ordinal": ordinal, "reportPath": str(report_path), "reportSha256": None,
                "exitCode": None, "startedAt": now(), "finishedAt": None,
                "stdoutPath": str(stdout_path), "runnerPid": None, "timeout": False,
            }
            ledger["attempts"].append(attempt)
            save()

            def started(pid: int) -> None:
                attempt["runnerPid"] = pid
                attempt["startedAt"] = now()
                save()

            runner_path = resolve_path(root, plan["runnerPath"])
            command = command_factory(node, runner_path, attempt_dir) if command_factory else [
                str(node), str(runner_path), "--output-dir", str(attempt_dir),
            ]
            print(f"Replication attempt {ordinal}/3: {attempt_dir}", flush=True)
            try:
                result = process_runner(command, root, stdout_path, plan["maxInvocationSeconds"], started)
                attempt.update(runnerPid=result.runner_pid, exitCode=result.exit_code, timeout=result.timeout)
            finally:
                attempt["finishedAt"] = now()
                if report_path.is_file():
                    attempt["reportSha256"] = digest(report_path)
                save()
                preserved(f"attempt-{ordinal}-after")
            print(f"Replication attempt {ordinal}/3 finished: exit={attempt['exitCode']}, timeout={attempt['timeout']}", flush=True)
        preserved("campaign-after")
        ledger["status"] = "complete"
    except BaseException as error:
        ledger.update(status="failed", error=f"{type(error).__name__}: {error}")
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
    finally:
        ledger["finishedAt"] = now()
        save()
        print(f"Campaign ledger: {ledger_path}", flush=True)
    return ledger


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    ledger = run_campaign(args.plan, args.node, args.output_dir)
    return 0 if ledger["status"] == "complete" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

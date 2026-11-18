"""Claim one fixed UTC window and run its two frozen runners without retries.

Completion records invocation outcomes, not scientific acceptance. A durable
claim is never reclaimed automatically, including after an interrupted launch.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import run_delivery_replicates as processes

ROOT = Path(__file__).resolve().parents[3]
LAUNCHER = Path(__file__).resolve()
HELPER = Path(processes.__file__).resolve()
RUNNERS = [("observer", "packages/runner/dist/pdf-clock-observer.js"),
           ("performance", "packages/runner/dist/controlled-delivery.js")]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("Clock must return an aware UTC datetime")
    return value.astimezone(timezone.utc).isoformat()


def parse_utc(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None or result.utcoffset().total_seconds() != 0:
        raise ValueError("Window timestamps must explicitly use UTC")
    return result


def validate_plan(plan: dict) -> None:
    if type(plan.get("schemaVersion")) is not int or plan["schemaVersion"] != 1:
        raise ValueError("schemaVersion must be 1")
    if type(plan.get("maximumInvocationSeconds")) is not int or plan["maximumInvocationSeconds"] != 600:
        raise ValueError("maximumInvocationSeconds must be 600")
    for key in ("id", "expectedBranch", "expectedNodeVersion", "protocolPath"):
        if not isinstance(plan.get(key), str) or not plan[key]:
            raise ValueError(f"Missing {key}")
    if plan.get("runners") != [{"id": name, "path": path, "args": []} for name, path in RUNNERS]:
        raise ValueError("Runners must be observer then performance with unchanged arguments")
    windows = plan.get("windows")
    if not isinstance(windows, list) or len(windows) != 3:
        raise ValueError("Exactly three fixed windows are required")
    previous = None
    for ordinal, window in enumerate(windows, 1):
        if type(window.get("ordinal")) is not int or window["ordinal"] != ordinal:
            raise ValueError("Window ordinals must be 1, 2, 3")
        opened, latest = parse_utc(window["opensAtUTC"]), parse_utc(window["latestStartAtUTC"])
        if opened >= latest or (previous is not None and opened < previous):
            raise ValueError("Windows must be ordered, nonoverlapping start intervals")
        previous = latest
    preserved = plan.get("preservedHashes")
    if not isinstance(preserved, dict) or not preserved:
        raise ValueError("preservedHashes must be nonempty")
    for path, digest in preserved.items():
        if not isinstance(path, str) or not path or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid preserved path/hash")
    for path in [plan["protocolPath"], *(path for _, path in RUNNERS)]:
        if path not in preserved:
            raise ValueError(f"Missing frozen input: {path}")
    if not isinstance(plan.get("runtimeHashes", {}), dict):
        raise ValueError("runtimeHashes must be a mapping")
    for path, digest in plan.get("runtimeHashes", {}).items():
        if not isinstance(path, str) or not Path(path).is_absolute() or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("runtimeHashes requires absolute paths and SHA-256 values")
    history = plan.get("historicalReport", {})
    if not isinstance(history.get("path"), str) or not history["path"] or not isinstance(history.get("sha256"), str) \
            or not re.fullmatch(r"[0-9a-f]{64}", history["sha256"]):
        raise ValueError("Historical report path and SHA-256 are required")


def branch_name(root: Path) -> str:
    return subprocess.run(["git", "branch", "--show-current"], cwd=root, capture_output=True,
                          text=True, check=True, timeout=10).stdout.strip()


def active_runners(runtime_paths=()) -> list[dict]:
    """Detect experiment Node runners and frozen detached browser executables."""
    result = subprocess.run(["ps", "-axo", "pid=,pgid=,command="], capture_output=True,
                            text=True, check=True, timeout=10)
    found = []
    names = {"pdf-clock-observer.js", "controlled-delivery.js", "clock-observer.js", "partial-loading.js"}
    browser_paths = [str(Path(name).resolve()) for name in runtime_paths
                     if Path(name).name in {"chrome-headless-shell", "headless_shell", "Chromium", "Google Chrome for Testing"}
                     or "Chromium Helper" in Path(name).name or "Google Chrome for Testing Helper" in Path(name).name]
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) != 3:
            continue
        browser = next((path for path in browser_paths if fields[2] == path or fields[2].startswith(path + " ")), None)
        if browser:
            found.append({"pid": int(fields[0]), "processGroup": int(fields[1]), "runner": Path(browser).name})
            continue
        arguments = fields[2].split()
        if len(arguments) < 2 or Path(arguments[0]).name not in {"node", "nodejs"}:
            continue
        matching = [arg for arg in arguments[1:] if Path(arg).name in names
                    or arg.endswith("packages/runner/dist/run.js")]
        if matching:
            found.append({"pid": int(fields[0]), "processGroup": int(fields[1]), "runner": Path(matching[0]).name})
    return found


def process_group_gone(pid: int, *, maximum_seconds: float = 5) -> bool:
    """Check, never signal, the process group created by the frozen helper."""
    deadline = time.monotonic() + maximum_seconds
    while True:
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def coordination(root: Path, plan: dict) -> tuple[Path, Path]:
    base = root / "results/raw/final-windows/.coordination"
    identity = hashlib.sha256(plan["id"].encode()).hexdigest()
    return base, base / identity


def inspect_window(plan_path: Path, ordinal: int, *, root: Path = ROOT) -> dict:
    """Read recorded state only; never infer cleanup or reclaim stale claims."""
    plan = json.loads(plan_path.read_text())
    validate_plan(plan)
    _, claims = coordination(root.resolve(), plan)
    path = claims / f"window-{ordinal}.json"
    if not path.exists():
        return {"status": "unclaimed", "window": plan["windows"][ordinal - 1]}
    claim = json.loads(path.read_text())
    ledger_path = Path(claim["outputDir"]) / "ledger.json"
    return {"status": "claimed", "claim": claim,
            "ledger": json.loads(ledger_path.read_text()) if ledger_path.is_file() else None,
            "interpretation": "Recorded state only; a missing or running ledger is not permission to retry."}


def ensure_prior_cleanup(claims: Path, plan_hash: str, plan_id: str) -> None:
    for path in claims.glob("window-*.json"):
        claim = json.loads(path.read_text())
        ordinal = claim.get("windowOrdinal")
        if type(ordinal) is not int or ordinal not in (1, 2, 3) or path.name != f"window-{ordinal}.json" \
                or claim.get("planId") != plan_id or claim.get("planSha256") != plan_hash:
            raise RuntimeError("Earlier claim differs from the frozen campaign plan")
        ledger_path = Path(claim["outputDir"]) / "ledger.json"
        if not ledger_path.is_file():
            raise RuntimeError("An earlier claim has no ledger; cleanup is unverified")
        ledger = json.loads(ledger_path.read_text())
        if ledger.get("planSha256") != plan_hash or ledger.get("window", {}).get("ordinal") != ordinal:
            raise RuntimeError("Earlier ledger does not match its immutable claim")
        if ledger.get("status") == "running" or ledger.get("cleanupVerified") is not True:
            raise RuntimeError("An earlier invocation has unverified cleanup; manual review is required")


@contextlib.contextmanager
def interrupt_handlers():
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f"Received signal {signum}")
    old = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        for sig in old:
            signal.signal(sig, interrupted)
        yield
    finally:
        for sig, handler in old.items():
            signal.signal(sig, handler)


def run_window(plan_path: Path, node: Path, ordinal: int, output_root: Path | None = None, *,
               root: Path = ROOT, clock: Callable = utc_now,
               process_runner: Callable = processes.run_process,
               version_reader: Callable = processes.node_version,
               branch_reader: Callable = branch_name,
               activity_reader: Callable | None = None,
               cleanup_checker: Callable = process_group_gone) -> dict:
    root, plan_path = root.resolve(), plan_path.resolve()
    plan_hash = processes.digest(plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    validate_plan(plan)
    activity = activity_reader or (lambda: active_runners(plan.get("runtimeHashes", {})))
    if ordinal not in (1, 2, 3):
        raise ValueError("--window must be 1, 2 or 3")
    window = plan["windows"][ordinal - 1]
    opened, latest = parse_utc(window["opensAtUTC"]), parse_utc(window["latestStartAtUTC"])
    if clock() < opened:
        return {"status": "not-open", "window": window, "attempts": [], "claimCreated": False}
    if not node.is_absolute():
        raise ValueError("--node must be an absolute path")
    node = node.resolve()
    output_root = (output_root or root / "results/raw/final-windows").resolve()
    output = output_root / f"window-{ordinal}"
    base, claims = coordination(root, plan)
    base.mkdir(parents=True, exist_ok=True)
    with (base / "campaign.lock").open("a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "busy", "window": window, "attempts": [], "claimCreated": False}
        claims.mkdir(parents=True, exist_ok=True)
        claim_path = claims / f"window-{ordinal}.json"
        if claim_path.exists():
            raise FileExistsError("Window already claimed; evidence is retained and automatic retries are forbidden")
        ensure_prior_cleanup(claims, plan_hash, plan["id"])
        if output.exists():
            raise FileExistsError(f"Window evidence directory already exists: {output}")
        claim = {"schemaVersion": 1, "planId": plan["id"], "planPath": str(plan_path), "planSha256": plan_hash,
                 "windowOrdinal": ordinal, "claimedAt": iso(clock()), "launcherPid": os.getpid(), "outputDir": str(output)}
        with claim_path.open("x", encoding="utf-8") as stream:
            json.dump(claim, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        claim_directory = os.open(claims, os.O_RDONLY)
        try:
            os.fsync(claim_directory)
        finally:
            os.close(claim_directory)
        output.mkdir(parents=True)
        launcher_hash, helper_hash = processes.digest(LAUNCHER), processes.digest(HELPER)
        ledger = {"schemaVersion": 1, "purpose": "fixed-final-window", "planPath": str(plan_path),
                  "planSha256": plan_hash, "launcherPath": str(LAUNCHER), "launcherSha256": launcher_hash,
                  "processHelperPath": str(HELPER), "processHelperSha256": helper_hash,
                  "nodeExecutable": str(node), "nodeSha256": None, "nodeVersion": None,
                  "window": window, "claimPath": str(claim_path), "status": "running",
                  "startedAt": claim["claimedAt"], "admittedAt": None, "finishedAt": None,
                  "cleanupVerified": True, "attempts": [], "preservationChecks": [], "unattemptedRunners": [],
                  "completionMeaning": "Both fixed invocations finished; scientific acceptance is audited separately."}
        ledger_path = output / "ledger.json"

        def save():
            ledger["unattemptedRunners"] = [runner["id"] for runner in plan["runners"]
                                            if runner["id"] not in {a["id"] for a in ledger["attempts"]}]
            atomic_json(ledger_path, ledger)

        def preserved(stage):
            check = {"stage": stage, "checkedAt": iso(clock()), "status": "running"}
            ledger["preservationChecks"].append(check)
            try:
                expected = {plan_path: plan_hash, LAUNCHER: launcher_hash, HELPER: helper_hash,
                            node: ledger["nodeSha256"]}
                entries = list(plan["preservedHashes"].items()) + list(plan.get("runtimeHashes", {}).items()) \
                    + [(plan["historicalReport"]["path"], plan["historicalReport"]["sha256"])]
                for name, value in entries:
                    filename = processes.resolve_path(root, name)
                    if filename in expected and expected[filename] != value:
                        raise ValueError(f"Conflicting frozen hash: {name}")
                    expected[filename] = value
                for filename, value in expected.items():
                    if processes.digest(filename) != value:
                        raise ValueError(f"Preservation mismatch: {filename}")
                if plan.get("runtimeHashes"):
                    runtime_paths = {Path(name).resolve() for name in plan["runtimeHashes"]}
                    if node not in runtime_paths:
                        raise ValueError("Selected Node executable is not a protected runtime path")
                    qpdf_path = shutil.which("qpdf")
                    if not qpdf_path or Path(qpdf_path).resolve() not in runtime_paths:
                        raise ValueError("PATH qpdf is not a protected runtime path")
                    check["qpdfExecutable"] = str(Path(qpdf_path).resolve())
                if "PLAYWRIGHT_BROWSERS_PATH" in os.environ:
                    raise ValueError("PLAYWRIGHT_BROWSERS_PATH override is forbidden by the frozen runtime plan")
                if branch_reader(root) != plan["expectedBranch"]:
                    raise ValueError("Current branch differs from the frozen plan")
                check["activeRunners"] = activity()
                if check["activeRunners"]:
                    ledger["cleanupVerified"] = False
                    raise RuntimeError("An earlier experiment runner is still active")
                version = version_reader(node)
                if version != plan["expectedNodeVersion"]:
                    raise ValueError("Node runtime differs from the frozen plan")
                ledger["nodeVersion"] = version
                check.update(status="passed", checkedFiles=len(expected), branch=plan["expectedBranch"], nodeVersion=version)
            except BaseException as error:
                check.update(status="failed", error=f"{type(error).__name__}: {error}")
                raise
            finally:
                save()

        save()
        try:
            with interrupt_handlers():
                snapshots = output / "source-snapshot"
                snapshots.mkdir()
                for name, source in [("plan.json", plan_path), ("launcher.py", LAUNCHER), ("process-helper.py", HELPER)]:
                    with (snapshots / name).open("xb") as stream:
                        stream.write(source.read_bytes())
                if clock() >= latest:
                    ledger["status"] = "missed"
                else:
                    if not node.is_file() or not os.access(node, os.X_OK):
                        raise ValueError("Selected Node runtime is missing or not executable")
                    ledger["nodeSha256"] = processes.digest(node)
                    preserved("window-before")
                    for position, runner in enumerate(plan["runners"], 1):
                        preserved(f"{runner['id']}-before")
                        if position == 1 and clock() >= latest:
                            ledger["status"] = "missed"
                            break
                        destination = output / runner["id"]
                        destination.mkdir()
                        attempt = {"ordinal": position, "id": runner["id"], "status": "running",
                                   "runnerPath": str(processes.resolve_path(root, runner["path"])),
                                   "reportPath": str(destination / "report.json"), "reportSha256": None,
                                   "stdoutPath": str(output / (runner["id"] + ".log")),
                                   "startedAt": iso(clock()), "spawnRequestedAt": None, "finishedAt": None, "runnerPid": None,
                                   "exitCode": None, "timeout": False, "cleanupVerified": None}
                        attempt["command"] = [str(node), attempt["runnerPath"], *runner["args"], "--output-dir", str(destination)]
                        ledger["attempts"].append(attempt)
                        ledger["cleanupVerified"] = False
                        if position == 1:
                            ledger["admittedAt"] = iso(clock())
                        save()

                        def started(pid):
                            attempt["runnerPid"], attempt["startedAt"] = pid, iso(clock())
                            save()
                            if position == 1 and parse_utc(attempt["startedAt"]) >= latest:
                                raise RuntimeError("Start window closed during process launch; invocation stopped")

                        try:
                            if position == 1 and clock() >= latest:
                                raise RuntimeError("Start window closed before process launch")
                            attempt["spawnRequestedAt"] = iso(clock())
                            save()
                            result = process_runner(attempt["command"], root, Path(attempt["stdoutPath"]),
                                                    plan["maximumInvocationSeconds"], started)
                            attempt.update(runnerPid=result.runner_pid, exitCode=result.exit_code,
                                           timeout=result.timeout, status="finished")
                        except BaseException as error:
                            attempt.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "launch-failed",
                                           error=f"{type(error).__name__}: {error}")
                            raise
                        finally:
                            attempt["finishedAt"] = iso(clock())
                            if Path(attempt["reportPath"]).is_file():
                                attempt["reportSha256"] = processes.digest(Path(attempt["reportPath"]))
                            if attempt["runnerPid"] is not None:
                                try:
                                    gone = bool(cleanup_checker(attempt["runnerPid"]))
                                    residual = activity()
                                    attempt["cleanupEvidence"] = {"runnerProcessGroupGone": gone,
                                                                  "remainingExperimentProcesses": residual}
                                    attempt["cleanupVerified"] = gone and not residual
                                except Exception as error:
                                    attempt["cleanupVerified"] = False
                                    attempt["cleanupCheckError"] = f"{type(error).__name__}: {error}"
                            ledger["cleanupVerified"] = attempt["cleanupVerified"] is True
                            save()
                            preserved(f"{runner['id']}-after")
                        if not attempt["cleanupVerified"]:
                            raise RuntimeError("Runner process-group cleanup is unverified; next invocation forbidden")
                    else:
                        preserved("window-after")
                        ledger["status"] = "complete"
        except BaseException as error:
            ledger.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "aborted",
                          error=f"{type(error).__name__}: {error}")
        finally:
            ledger["finishedAt"] = iso(clock())
            save()
            print(f"Window ledger: {ledger_path}", flush=True)
        return ledger


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=ROOT / "experiments/final-windows.json")
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--window", type=int, choices=(1, 2, 3), required=True)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--audit-only", action="store_true", help="Read claim/ledger only; never reclaim or launch")
    args = parser.parse_args()
    if args.audit_only:
        print(json.dumps(inspect_window(args.plan, args.window), indent=2))
        return 0
    result = run_window(args.plan, args.node, args.window, args.output_root)
    print(json.dumps({"status": result["status"], "window": result["window"]}))
    return 0 if result["status"] == "complete" else 2 if result["status"] in ("not-open", "busy", "missed") else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

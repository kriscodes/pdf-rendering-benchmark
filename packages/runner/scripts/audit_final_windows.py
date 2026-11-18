"""Audit fixed-window evidence without launching measurements or pooling trials.

Use a new output prefix for every progress snapshot. Missing future windows stay
pending; elapsed unattempted windows, failed reports, and interruptions stay visible.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from audit_pdf_clock_observer import audit_report as audit_observer, schedule as observer_schedule
from summarize_controlled_delivery import ROOT, audit_report as audit_performance, expected_schedule, sha256

RUNNERS = {"observer": "packages/runner/dist/pdf-clock-observer.js", "performance": "packages/runner/dist/controlled-delivery.js"}
DIGEST = re.compile(r"[0-9a-f]{64}")


def require(value, message):
    if not value:
        raise ValueError(message)


def load(path: Path) -> dict:
    def invalid(value):
        raise ValueError(f"Nonfinite JSON number: {value}")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    result = json.loads(path.read_text(encoding="utf-8"), parse_constant=invalid, object_pairs_hook=unique)
    require(isinstance(result, dict), f"Expected JSON object: {path}")
    return result


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return (path if path.is_absolute() else ROOT / path).resolve()


def utc(value: str, label: str) -> datetime:
    require(isinstance(value, str), f"{label}: ISO UTC timestamp required")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None and result.utcoffset().total_seconds() == 0, f"{label}: UTC offset required")
    return result


def digest_matches(path: Path, expected: str, label: str):
    require(isinstance(expected, str) and DIGEST.fullmatch(expected), f"{label}: invalid SHA-256")
    require(path.is_file() and sha256(path) == expected, f"{label}: file missing or SHA-256 mismatch")


def validate_plan(plan: dict) -> None:
    require(plan.get("schemaVersion") == 1 and plan.get("maximumInvocationSeconds") == 600, "Unexpected fixed plan schema or invocation budget")
    require(plan.get("runners") == [{"id": key, "path": value, "args": []} for key, value in RUNNERS.items()], "Runner order, arguments or paths changed")
    windows = plan.get("windows")
    require(isinstance(windows, list) and len(windows) == 3 and [w.get("ordinal") for w in windows] == [1, 2, 3], "Expected exactly three ordered fixed windows")
    previous = utc(plan["createdAt"], "plan creation")
    for window in windows:
        start, end = utc(window["opensAtUTC"], "window opening"), utc(window["latestStartAtUTC"], "window latest start")
        require(previous <= start < end, "Overlapping/reversed windows or retrospective plan")
        previous = end
    require(isinstance(plan.get("preservedHashes"), dict) and bool(plan["preservedHashes"]), "Missing preservation hashes")
    require(plan.get("expectedNodeVersion") == "v24.22.1", "Pinned Node version changed")
    require(plan.get("historicalReport", {}).get("path") and plan["historicalReport"].get("sha256"), "Missing pinned historical report")


def contrasts(summary: dict) -> dict:
    return {"structureRangeEnabled": summary["pairedStructureEffect"]["rangeEnabled"],
            "structureRangeDisabled": summary["pairedStructureEffect"]["rangeDisabled"],
            "rangeEffectNonlinearized": summary["pairedRangeEffect"]["nonlinearized"],
            "rangeEffectLinearized": summary["pairedRangeEffect"]["linearized"],
            "differenceOfStructureEffects": summary["differenceOfStructureEffects"]}


def between_windows(accepted: list[dict], *, all_slots_terminal=True) -> dict:
    if len(accepted) < 2:
        return {"status": "insufficient accepted new evidence" if all_slots_terminal else "fixed windows pending; no comparison yet", "acceptedNewWindows": len(accepted),
                "interpretation": "At least two accepted new windows are required. The historical pilot does not count toward this threshold."}
    def directions(values):
        signs = ["positive" if item["estimateMs"] > 0 else "negative" if item["estimateMs"] < 0 else "zero" for item in values]
        return {"windowEstimates": values, "minimumMs": min(item["estimateMs"] for item in values),
                "maximumMs": max(item["estimateMs"] for item in values), "directions": signs,
                "directionalAgreement": signs[0] if len(set(signs)) == 1 else "mixed"}
    return {"status": "descriptive comparison available", "acceptedNewWindows": len(accepted),
            "pairedContrasts": {key: directions([{"window": item["ordinal"], "estimateMs": contrasts(item["performance"]["summary"])[key]["medianMs"]} for item in accepted])
                                for key in contrasts(accepted[0]["performance"]["summary"])},
            "conditionMedianRanges": {key: {"windowEstimates": [{"window": item["ordinal"], "medianMs": item["performance"]["summary"]["byCondition"][key]["medianMs"]} for item in accepted],
                                            "minimumMs": min(item["performance"]["summary"]["byCondition"][key]["medianMs"] for item in accepted),
                                            "maximumMs": max(item["performance"]["summary"]["byCondition"][key]["medianMs"] for item in accepted)}
                                      for key in accepted[0]["performance"]["summary"]["byCondition"]},
            "interpretation": "Separate accepted-window estimates only; observed directional agreement and ranges are descriptive. No pooled trials, statistical repeatability threshold, significance or generalization claim."}


def observer_outcomes(analysis: dict) -> dict:
    rows = analysis["trials"]
    def nested(population, status_field):
        counts = dict.fromkeys(("bothPassed", "referenceOnly", "candidateOnly", "neither"), 0)
        for row in population:
            reference, candidate = row.get("reference" + status_field) == "passed", row.get("candidate" + status_field) == "passed"
            counts["bothPassed" if reference and candidate else "referenceOnly" if reference else "candidateOnly" if candidate else "neither"] += 1
        return {"eligibleHighArmTrials": len(population), **counts}
    valid_high = [row for row in rows if row["arm"] == "fifteen" and row["operationValidated"]]
    return {"scheduledTrials": 96, "attemptedTrials": sum(row["attempted"] for row in rows),
            "operationValidTrials": sum(row["operationValidated"] for row in rows),
            "clockOutcomes": analysis["overall"]["methodCounts"], "guardOutcomes": analysis["guards"],
            "actualArms": {arm: {"attempted": sum(row["attempted"] for row in rows if row["arm"] == arm),
                                  "operationValid": sum(row["operationValidated"] for row in rows if row["arm"] == arm)} for arm in ("three", "fifteen")},
            "nestedClockAcceptanceAmongOperationValidHighTrials": nested(valid_high, "ClockStatus"),
            "nestedClockAcceptanceAmongGuardValidatedOperationValidHighTrials": nested([row for row in valid_high if row["sessionValidated"]], "ClockStatus"),
            "nestedMethodValidityAmongOperationValidHighTrials": nested(valid_high, "Status"),
            "perturbation": analysis["perturbation"],
            "candidateGainMeaning": "Candidate-only clock acceptance within the same high-arm execution, restricted to operation-valid trials. Network/joint-method validity is separate. Actual low/high arm pass-count differences are not same-execution gains."}


def validate_report_prefix(report: dict, kind: str) -> dict:
    require(report.get("schemaVersion") == 1, "Unexpected report schema")
    require(report.get("status") in (("running", "passed", "failed") if kind == "performance" else ("running", "complete", "incomplete")), "Unknown report status")
    if kind == "performance":
        require(report.get("purpose") == "controlled-delivery-factorial-pilot", "Wrong performance report purpose")
        trials, expected = report.get("trials"), expected_schedule()
    else:
        require(report.get("purpose") == "bounded-pdf-workload-observer-integration-not-performance-replication", "Wrong observer report purpose")
        sessions = report.get("sessions")
        require(isinstance(sessions, list) and len(sessions) <= 3, "Invalid observer sessions")
        require([session.get("session") for session in sessions] == list(range(1, len(sessions) + 1)), "Observer sessions reordered")
        trials = []
        for session in sessions:
            require(isinstance(session.get("trials"), list), "Invalid observer trials")
            require(all(trial.get("session") == session["session"] for trial in session["trials"]), "Wrong trial session membership")
            trials.extend(session["trials"])
        expected = observer_schedule()
    require(isinstance(trials, list) and len(trials) <= len(expected), "Invalid trial list/count")
    require(all(isinstance(trial, dict) for trial in trials), "Malformed trial record")
    for trial, entry in zip(trials, expected):
        require(all(trial.get(key) == value for key, value in entry.items()), "Report trial schedule is not the fixed prefix")
    return {"recordedTrials": len(trials), "recordedOperationPassed": sum(trial.get("operationStatus" if kind == "observer" else "status") == "passed" for trial in trials),
            "lastTrial": {key: trials[-1].get(key) for key in ("id", "phase", "block", "condition", "arm", "status", "operationStatus", "error")} if trials else None,
            "reportError": report.get("error")}


def inspect_report(attempt: dict, kind: str, historical: dict, issues: list[str]) -> dict:
    result = {"executionStatus": attempt["status"], "exitCode": attempt.get("exitCode"), "timeout": attempt.get("timeout"),
              "cleanupVerified": attempt.get("cleanupVerified"), "reportPath": attempt["reportPath"],
              "reportSha256": attempt.get("reportSha256"), "accepted": False, "summary": None}
    if kind == "observer":
        result.pop("accepted"); result.pop("summary")
        result["scientificAcceptance"] = "Diagnostic operations/clocks are reported separately; this is not a performance estimate."
    if attempt["status"] == "running":
        result["evidenceStatus"] = "running; mutable report not audited"
        return result
    path = resolve(attempt["reportPath"])
    if not path.is_file():
        result["evidenceStatus"] = "missing report"
        if attempt.get("exitCode") == 0 or attempt.get("reportSha256") is not None:
            issues.append(f"{kind}: missing report conflicts with success/hash claim")
        return result
    try:
        digest_matches(path, attempt.get("reportSha256"), kind + " report")
        report = load(path); result["reportStatus"] = report.get("status")
        result["partialEvidence"] = validate_report_prefix(report, kind)
        success = report.get("status") == ("passed" if kind == "performance" else "complete")
        if type(attempt.get("exitCode")) is int:
            require((attempt["exitCode"] == 0) == success or attempt.get("timeout"), "Report completion and process exit disagree")
        result["environment"] = report.get("environment")
        report_start = utc(report["startedAt"], "report start")
        require(report_start >= utc(attempt["spawnRequestedAt"], "spawn request"), "Report predates this invocation")
        if report.get("status") != "running" or report.get("finishedAt"):
            report_end = utc(report["finishedAt"], "report finish")
            require(report_start <= report_end <= utc(attempt["finishedAt"], "runner finish"), "Report interval lies outside the recorded invocation")
        if kind == "observer":
            try:
                analysis = audit_observer(path)
                require(analysis["auditStatus"] == "passed", "Independent observer audit failed: " + "; ".join(analysis["integrityIssues"]))
            except (OSError, ValueError, KeyError, TypeError, StopIteration, IndexError, AttributeError) as error:
                if success:
                    raise
                result.update(evidenceStatus="partial diagnostic; full independent audit unavailable", observerAuditFailure=str(error))
                return result
            result.update(evidenceStatus="independently audited", observer=observer_outcomes(analysis))
            return result
        candidate = success and attempt.get("exitCode") == 0 and not attempt.get("timeout") and attempt.get("cleanupVerified") is True
        if not candidate:
            result["evidenceStatus"] = "rejected or incomplete; no timing estimate"
            return result
        for field in ("experiment", "controls", "environment", "sourceHashes", "baselineLock", "corpus"):
            require(report.get(field) == historical[field], f"Performance {field} differs from preserved historical controls")
        analysis = audit_performance(path)
        result.update(accepted=True, evidenceStatus="independently accepted", summary=analysis["summary"],
                      auditedTrials={"all": len(analysis["trials"]), "measured": sum(row["includedInSummary"] for row in analysis["trials"]), "warmups": sum(row["isWarmup"] for row in analysis["trials"])})
    except (OSError, ValueError, KeyError, TypeError, StopIteration, IndexError, AttributeError) as error:
        result.update(evidenceStatus="integrity failure", evidenceError=str(error), accepted=False, summary=None)
        issues.append(f"{kind}: {error}")
    return result


def claim_path(plan: dict, ordinal: int) -> Path:
    identity = hashlib.sha256(plan["id"].encode()).hexdigest()
    return ROOT / "results/raw/final-windows/.coordination" / identity / f"window-{ordinal}.json"


def validate_ledger(ledger: dict, plan: dict, plan_path: Path, output: Path, window: dict) -> None:
    require(ledger.get("schemaVersion") == 1 and ledger.get("purpose") == "fixed-final-window", "Wrong ledger schema/purpose")
    require(resolve(ledger["planPath"]) == plan_path and ledger["planSha256"] == sha256(plan_path), "Ledger plan differs from current frozen plan")
    require(ledger.get("window") == window, "Ledger window identity changed")
    require(ledger.get("status") in ("running", "complete", "missed", "aborted", "interrupted"), "Unknown ledger state")
    expected_claim = claim_path(plan, window["ordinal"])
    require(resolve(ledger["claimPath"]) == expected_claim, "Ledger references noncanonical claim")
    claim = load(expected_claim)
    require(claim.get("schemaVersion") == 1 and claim.get("planId") == plan["id"] and claim.get("windowOrdinal") == window["ordinal"] and
            resolve(claim["planPath"]) == plan_path and claim["planSha256"] == sha256(plan_path) and resolve(claim["outputDir"]) == output,
            "Claim identity/output differs from ledger")
    require(type(claim.get("launcherPid")) is int and claim["launcherPid"] > 0, "Invalid launcher PID")
    require(ledger["startedAt"] == claim["claimedAt"], "Ledger start differs from immutable claim")
    start = utc(ledger["startedAt"], "window claim")
    opened, latest = utc(window["opensAtUTC"], "opening"), utc(window["latestStartAtUTC"], "latest start")
    require(start >= opened, "Window claimed before opening")
    for path_field, hash_field, snapshot, expected_path in (
        ("launcherPath", "launcherSha256", "launcher.py", "packages/runner/scripts/run_final_windows.py"),
        ("processHelperPath", "processHelperSha256", "process-helper.py", "packages/runner/scripts/run_delivery_replicates.py"),
    ):
        require(resolve(ledger[path_field]) == (ROOT / expected_path).resolve(), "Unexpected launcher/helper path")
        digest_matches(resolve(ledger[path_field]), ledger[hash_field], path_field)
        digest_matches(output / "source-snapshot" / snapshot, ledger[hash_field], snapshot)
    digest_matches(output / "source-snapshot/plan.json", ledger["planSha256"], "plan snapshot")
    if ledger.get("nodeSha256") is not None:
        digest_matches(resolve(ledger["nodeExecutable"]), ledger["nodeSha256"], "Node executable")
    else:
        require(not ledger.get("attempts") and ledger["status"] in ("aborted", "interrupted"), "Missing Node identity on an executed window")
    attempts = ledger.get("attempts")
    require(isinstance(attempts, list) and len(attempts) <= 2, "Invalid invocation count")
    require([attempt.get("id") for attempt in attempts] == list(RUNNERS)[:len(attempts)] and
            [attempt.get("ordinal") for attempt in attempts] == list(range(1, len(attempts) + 1)), "Runner sequence changed/repeated")
    require(ledger.get("unattemptedRunners") == list(RUNNERS)[len(attempts):], "Unattempted runner record changed")
    if attempts:
        admitted = utc(ledger["admittedAt"], "admission")
        require(opened <= admitted < latest and admitted >= start, "Suite admitted outside fixed start interval")
        require(ledger.get("nodeVersion") == plan["expectedNodeVersion"], "Wrong executed Node version")
    previous_end = start
    for index, attempt in enumerate(attempts):
        kind = attempt["id"]; destination = output / kind
        require(attempt.get("status") in ("running", "finished", "interrupted", "launch-failed"), "Unknown invocation state")
        require(resolve(attempt["runnerPath"]) == ROOT / RUNNERS[kind], "Executed runner changed")
        require(resolve(attempt["reportPath"]) == destination / "report.json" and resolve(attempt["stdoutPath"]) == output / (kind + ".log"), "Report/log paths changed or reused")
        require(attempt["command"] == [ledger["nodeExecutable"], attempt["runnerPath"], "--output-dir", str(destination)], "Runner command/arguments changed")
        began = utc(attempt["startedAt"], "invocation start")
        require(began >= previous_end, "Invocation overlap or reversed start")
        if index == 0:
            # An exception during process launch can cross the deadline, but
            # that invocation can never be treated as an accepted execution.
            if attempt["status"] in ("running", "finished"):
                require(opened <= began < latest and began >= admitted, "Observer started outside the admitted interval")
        else:
            require(attempts[index - 1].get("cleanupVerified") is True, "Dependent runner started without verified cleanup")
        require(type(attempt.get("timeout")) is bool, "Missing timeout evidence")
        if attempt.get("cleanupVerified") is True:
            evidence = attempt.get("cleanupEvidence", {})
            require(evidence.get("runnerProcessGroupGone") is True and evidence.get("remainingExperimentProcesses") == [],
                    "Cleanup claim lacks successful group/experiment-process evidence")
        if attempt["status"] == "finished":
            require(type(attempt.get("exitCode")) is int and type(attempt.get("runnerPid")) is int and attempt["runnerPid"] > 0, "Finished invocation lacks exit/PID evidence")
            require(previous_end <= utc(attempt["spawnRequestedAt"], "spawn request") <= began, "Spawn request lies outside invocation order")
        if attempt.get("finishedAt") is not None:
            previous_end = utc(attempt["finishedAt"], "invocation finish")
            require(previous_end >= began, "Reversed invocation duration")
        else:
            require(ledger["status"] == attempt["status"] == "running" and index == len(attempts) - 1, "Missing terminal invocation timestamp")
    if ledger["status"] == "complete":
        require(len(attempts) == 2 and all(a["status"] == "finished" and a["cleanupVerified"] is True for a in attempts) and ledger.get("cleanupVerified") is True, "Incomplete/unclean suite marked complete")
        checks = ledger.get("preservationChecks", [])
        require([item.get("stage") for item in checks] == ["window-before", "observer-before", "observer-after", "performance-before", "performance-after", "window-after"] and
                all(item.get("status") == "passed" and item.get("branch") == plan["expectedBranch"] and item.get("nodeVersion") == plan["expectedNodeVersion"] and item.get("activeRunners") == [] for item in checks), "Required preservation/runtime checks missing or failed")
    if ledger["status"] == "missed":
        require(not attempts and ledger.get("admittedAt") is None, "Missed window contains a started invocation")
    if ledger.get("finishedAt") is not None:
        require(utc(ledger["finishedAt"], "window finish") >= previous_end, "Window finished before its invocations")
    else:
        require(ledger["status"] == "running", "Terminal window lacks finish timestamp")


def audit_campaign(plan_path: Path, ledger_root: Path, *, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    plan = load(plan_path); validate_plan(plan)
    issues = []; preservation = []
    for field in ("preservedHashes", "runtimeHashes"):
        for filename, expected in plan.get(field, {}).items():
            digest_matches(resolve(filename), expected, f"frozen {filename}"); preservation.append(filename)
    historical_path = resolve(plan["historicalReport"]["path"])
    digest_matches(historical_path, plan["historicalReport"]["sha256"], "historical pilot")
    historical_raw = load(historical_path); historical_audit = audit_performance(historical_path)
    history = {"role": "historical; excluded from accepted-new-window count and comparison", "reportPath": str(historical_path),
               "reportSha256": plan["historicalReport"]["sha256"], "startedAt": historical_raw["startedAt"], "finishedAt": historical_raw["finishedAt"],
               "independentAuditStatus": "passed", "summary": historical_audit["summary"]}
    windows = []; seen_reports = {historical_path}; seen_hashes = {plan["historicalReport"]["sha256"]}
    for window in plan["windows"]:
        output = ledger_root / f"window-{window['ordinal']}"; ledger_path = output / "ledger.json"
        result = {**window, "ledgerPath": str(ledger_path), "observer": {"executionStatus": "unattempted"},
                  "performance": {"executionStatus": "unattempted", "accepted": False, "summary": None}}
        windows.append(result)
        if not ledger_path.exists():
            claim = claim_path(plan, window["ordinal"])
            if claim.exists():
                record = load(claim)
                result.update(state="claimed-without-selected-ledger", claimPath=str(claim), claim=record,
                              explanation="Claimed slots are never retried. Evidence may be interrupted, missing, or under a different output root.")
            elif now >= utc(window["latestStartAtUTC"], "latest start"):
                result.update(state="missed-unrecorded", explanation="The fixed start interval elapsed without a retained window ledger.")
            else:
                result.update(state="pending-open" if now >= utc(window["opensAtUTC"], "opening") else "pending-not-open")
            continue
        try:
            ledger = load(ledger_path); result["ledgerSha256"] = sha256(ledger_path)
            validate_ledger(ledger, plan, plan_path, output, window)
            result.update(state=ledger["status"], startedAt=ledger["startedAt"], admittedAt=ledger.get("admittedAt"), finishedAt=ledger.get("finishedAt"),
                          cleanupVerified=ledger.get("cleanupVerified"), launcherError=ledger.get("error"))
            for attempt in ledger["attempts"]:
                report_path = resolve(attempt["reportPath"])
                require(report_path not in seen_reports, "Report path reused across windows/history")
                seen_reports.add(report_path)
                if attempt.get("reportSha256"):
                    require(attempt["reportSha256"] not in seen_hashes, "Report bytes reused across windows/history")
                    seen_hashes.add(attempt["reportSha256"])
                result[attempt["id"]] = {**inspect_report(attempt, attempt["id"], historical_raw, issues),
                                          "startedAt": attempt["startedAt"], "finishedAt": attempt.get("finishedAt"), "runnerPid": attempt.get("runnerPid")}
            if ledger["status"] != "complete":
                result["performance"].update(accepted=False, summary=None)
            if ledger["status"] == "complete":
                result["state"] = "accepted" if result["performance"]["accepted"] else "rejected"
        except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
            result.update(state="integrity-failed", evidenceError=str(error))
            result["performance"].update(accepted=False, summary=None)
            issues.append(f"window {window['ordinal']}: {error}")
    accepted = [window for window in windows if window["performance"]["accepted"]]
    terminal_states = {"accepted", "rejected", "missed", "missed-unrecorded", "aborted", "interrupted", "integrity-failed"}
    terminal = all(window["state"] in terminal_states for window in windows)
    actual_starts = [{"window": window["ordinal"], "startedAt": window["performance"].get("startedAt")} for window in windows if window["performance"].get("startedAt")]
    separations = [{"fromWindow": a["window"], "toWindow": b["window"], "seconds": (utc(b["startedAt"], "actual start") - utc(a["startedAt"], "actual start")).total_seconds()} for a, b in zip(actual_starts, actual_starts[1:])]
    return {"schemaVersion": 1, "purpose": "independent-final-window-evidence-comparison", "auditStatus": "passed" if not issues else "failed", "integrityIssues": issues,
            "asOfUTC": now.isoformat(), "planPath": str(plan_path), "planSha256": sha256(plan_path), "ledgerRoot": str(ledger_root),
            "auditScriptSha256": sha256(Path(__file__)), "frozenAuditorHashes": {name: sha256(Path(__file__).with_name(name)) for name in ("audit_pdf_clock_observer.py", "summarize_controlled_delivery.py")},
            "preservation": {"verifiedFiles": len(preservation)}, "acceptedNewWindows": len(accepted), "plannedNewWindows": 3,
            "allSlotsTerminal": terminal, "decisionState": "terminal evidence" if terminal else "in progress",
            "pendingOrUnresolvedWindows": sum(window["state"] not in terminal_states for window in windows),
            "windowStateCounts": {state: sum(window["state"] == state for window in windows) for state in sorted({window["state"] for window in windows})},
            "acceptedFraction": f"{len(accepted)}/3", "windows": windows, "historicalPilot": history,
            "actualPerformanceStartSeparations": separations, "betweenWindowComparison": between_windows(accepted, all_slots_terminal=terminal),
            "limits": ["Pending, missed, interrupted and rejected windows are never replaced or used for timing estimates.",
                       "The fixed observer-before-performance order may affect machine state; OS/font caches and machine load are not independently controlled.",
                       "Fresh processes and separate time windows on one host are not independent hardware/environmental replications.",
                       "No historical or partial trial timings are pooled with accepted new windows; narrower nested intervals do not independently prove clock accuracy."]}


def csv_text(result: dict) -> str:
    rows = []
    for window in result["windows"]:
        performance = window["performance"]
        row = {"window": window["ordinal"], "state": window["state"], "performanceAccepted": performance["accepted"],
               "reportPath": performance.get("reportPath"), "reportSha256": performance.get("reportSha256"),
               "observerExecution": window["observer"].get("executionStatus"), "performanceExecution": performance.get("executionStatus"),
               "performanceEvidence": performance.get("evidenceStatus"), "startedAt": performance.get("startedAt")}
        if performance["accepted"]:
            row.update({key + "MedianMs": value["medianMs"] for key, value in performance["summary"]["byCondition"].items()})
            row.update({key + "PairedMedianMs": value["medianMs"] for key, value in contrasts(performance["summary"]).items()})
        rows.append(row)
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=list(dict.fromkeys(key for row in rows for key in row)), lineterminator="\n")
    writer.writeheader(); writer.writerows(rows)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True); parser.add_argument("--ledger-root", type=Path, required=True)
    parser.add_argument("--output-prefix", type=Path, required=True)
    args = parser.parse_args(); prefix = resolve(args.output_prefix)
    paths = {suffix: Path(str(prefix) + suffix) for suffix in (".json", ".csv")}
    try:
        require(not any(path.exists() for path in paths.values()), "Output exists; choose a fresh progress/final prefix")
        result = audit_campaign(resolve(args.plan), resolve(args.ledger_root)); prefix.parent.mkdir(parents=True, exist_ok=True)
        with paths[".csv"].open("x", encoding="utf-8", newline="") as stream: stream.write(csv_text(result))
        result["csv"] = {"path": str(paths[".csv"]), "sha256": sha256(paths[".csv"])}
        with paths[".json"].open("x", encoding="utf-8") as stream: stream.write(json.dumps(result, indent=2) + "\n")
        print(f"{result['auditStatus'].upper()}: {result['acceptedFraction']} new performance windows accepted; {[window['state'] for window in result['windows']]}")
        return 0 if result["auditStatus"] == "passed" else 1
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"FAIL: {error}", file=sys.stderr); return 1


if __name__ == "__main__":
    sys.exit(main())

"""Audit a fixed three-attempt replication campaign without pooling timings.

Reuses the unchanged independent single-session auditor. Failed, interrupted,
or missing attempt reports stay visible and never contribute a performance
summary. This program does not launch a benchmark or replace any prior export.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import statistics
import sys
from datetime import datetime
from pathlib import Path

from summarize_controlled_delivery import CONDITIONS, ROOT, audit_report, sha256


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"Expected a JSON object: {path}")
    return value


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return (path if path.is_absolute() else ROOT / path).resolve()


def timestamp(value: str, label: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None, f"{label}: timezone is required")
    return result


def preservation_check(expected: dict, label: str) -> dict:
    require(isinstance(expected, dict) and bool(expected), f"{label}: expected a nonempty hash map")
    issues = []
    for filename, digest in expected.items():
        path = Path(filename)
        require(not path.is_absolute() and ".." not in path.parts, f"{label}: expected a repository-relative path")
        try:
            observed = sha256(ROOT / path)
            if observed != digest:
                issues.append({"path": filename, "expectedSha256": digest, "actualSha256": observed})
        except OSError as error:
            issues.append({"path": filename, "error": str(error)})
    return {"status": "passed" if not issues else "failed", "fileCount": len(expected), "issues": issues}


def object_comparison(actual: object, expected: dict) -> dict:
    if not isinstance(actual, dict):
        return {"exactMatch": False, "missingFields": sorted(expected), "unexpectedFields": [],
                "differingFields": [], "present": False}
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    differences = [{"field": key, "expected": expected[key], "actual": actual[key]}
                   for key in sorted(set(actual) & set(expected)) if actual[key] != expected[key]]
    return {"exactMatch": not (missing or extra or differences), "missingFields": missing,
            "unexpectedFields": extra, "differingFields": differences, "present": True}


def contrasts(summary: dict) -> dict:
    return {
        "structureRangeEnabled": summary["pairedStructureEffect"]["rangeEnabled"],
        "structureRangeDisabled": summary["pairedStructureEffect"]["rangeDisabled"],
        "rangeEffectNonlinearized": summary["pairedRangeEffect"]["nonlinearized"],
        "rangeEffectLinearized": summary["pairedRangeEffect"]["linearized"],
        "differenceOfStructureEffects": summary["differenceOfStructureEffects"],
    }


def describe_numbers(values: list[float]) -> dict:
    require(bool(values) and all(math.isfinite(value) for value in values), "Invalid descriptive values")
    return {"count": len(values), "minimum": min(values), "median": statistics.median(values), "maximum": max(values)}


def network_by_condition(trials: list[dict]) -> dict:
    result = {}
    for condition, _, _ in CONDITIONS.values():
        rows = [row for row in trials if row["includedInSummary"] and row["condition"] == condition]
        require(len(rows) == 12, f"Unexpected measured count for {condition}")
        result[condition] = {
            "measuredTrials": len(rows),
            "rangeRequestCount": sum(row["rangeRequestCount"] for row in rows),
            "validated206Count": sum(row["observed206Count"] for row in rows),
            "trialsWithRangeRequests": sum(row["rangeRequestCount"] > 0 for row in rows),
            "initial200Completion": {
                "atOrBeforeRender": sum(row["initial200FinishedAtOrBeforeRender"] for row in rows),
                "uncertain": sum(row["initial200FinishUncertain"] for row in rows),
                "afterRender": sum(row["initial200FinishedAfterRender"] for row in rows),
            },
            "cdpReportedDataBytes": {
                "atOrBeforeRender": describe_numbers([row["cdpReportedDataAtOrBeforeRenderBytes"] for row in rows]),
                "uncertain": describe_numbers([row["cdpUncertainDataBytes"] for row in rows]),
                "afterRender": describe_numbers([row["cdpAfterRenderDataBytes"] for row in rows]),
                "total": describe_numbers([row["cdpTotalReportedBodyBytes"] for row in rows]),
            },
            "completedResourceTimingBodyBytesAtRender": describe_numbers([row["completedResourceTimingBodyBytesAtRender"] for row in rows]),
            "verificationStartedRequests": sum(row["verificationStartedRequestCount"] for row in rows),
            "verificationUncertainRequests": sum(row["verificationUncertainRequestCount"] for row in rows),
            "clockBoundaryWidthMs": describe_numbers([row["clockBoundaryWidthMs"] for row in rows]),
        }
    return result


def accepted_evidence(analysis: dict) -> dict:
    return {
        "independentAuditStatus": "passed", "verification": analysis["verification"],
        "summary": analysis["summary"], "pairedContrasts": contrasts(analysis["summary"]),
        "networkByCondition": network_by_condition(analysis["trials"]),
        "deliveryCalibrations": analysis["deliveryCalibrations"], "observerProbe": analysis["observerProbe"],
        "trials": analysis["trials"],
        "trialRowMeaning": "All 64 independently audited trial rows are retained, including 16 excluded warmups. Full event ledgers remain in the referenced raw report.",
    }


def partial_report_evidence(report: dict) -> dict:
    trials = report.get("trials", [])
    if not isinstance(trials, list):
        trials = []
    return {
        "recordedTrialCount": len(trials),
        "recordedPassedTrialCount": sum(trial.get("status") == "passed" for trial in trials),
        "lastRecordedTrial": {key: trials[-1].get(key) for key in ("id", "phase", "block", "position", "condition", "status", "error")} if trials else None,
        "reportError": report.get("error"),
        "observerProbeStatus": report.get("observerProbe", {}).get("status"),
        "calibrationStages": [{"stage": item.get("stage"), "status": item.get("status"), "error": item.get("error")}
                              for item in report.get("deliveryCalibrations", [])],
        "performanceSummary": None,
        "interpretation": "Rejected or incomplete attempt. Its raw records are retained but no timing comparison or pooled sample uses these trials.",
    }


def inspect_attempt(attempt: dict, original: dict, integrity_issues: list[str]) -> dict:
    ordinal = attempt["ordinal"]
    label = f"replicate-{ordinal}"
    report_path = resolve(attempt["reportPath"])
    result = {
        "session": label, "role": "additional", "ordinal": ordinal,
        "reportPath": str(report_path), "expectedReportSha256": attempt["reportSha256"],
        "exitCode": attempt["exitCode"], "runnerPid": attempt["runnerPid"],
        "timeout": attempt.get("timeout", False), "startedAt": attempt["startedAt"], "finishedAt": attempt["finishedAt"],
        "accepted": False, "acceptance": "rejected", "evidenceIssues": [],
        "independentAuditStatus": "not-applicable-to-rejected-report",
    }
    if attempt.get("stdoutPath"):
        stdout = resolve(attempt["stdoutPath"])
        result["stdoutPath"] = str(stdout)
        result["stdoutSha256"] = sha256(stdout) if stdout.is_file() else None
    if not report_path.is_file():
        result.update(acceptance="incomplete-evidence", reportStatus="missing", actualReportSha256=None,
                      performanceSummary=None)
        result["evidenceIssues"].append("No report file was produced or preserved for this attempt.")
        if attempt["exitCode"] == 0 or attempt["reportSha256"] is not None:
            integrity_issues.append(f"{label}: missing report conflicts with zero exit or a declared report hash")
        return result
    actual_hash = sha256(report_path)
    result["actualReportSha256"] = actual_hash
    result["reportHashVerified"] = actual_hash == attempt["reportSha256"]
    if not result["reportHashVerified"]:
        result["evidenceIssues"].append("Report hash does not agree with the execution ledger.")
        integrity_issues.append(f"{label}: report hash mismatch")
    try:
        report = load(report_path)
    except (OSError, ValueError) as error:
        result.update(acceptance="incomplete-evidence", reportStatus="unreadable", performanceSummary=None)
        result["evidenceIssues"].append(str(error))
        if attempt["exitCode"] == 0:
            integrity_issues.append(f"{label}: zero exit with unreadable report")
        return result
    result["reportStatus"] = report.get("status")
    result["reportStartedAt"] = report.get("startedAt")
    result["reportFinishedAt"] = report.get("finishedAt")
    comparisons = {key: object_comparison(report.get(key), original[key])
                   for key in ("experiment", "controls", "environment", "sourceHashes", "baselineLock", "corpus")}
    result["matchesOriginal"] = comparisons
    result["recordedEnvironment"] = report.get("environment")
    exit_passed = attempt["exitCode"] == 0
    report_passed = report.get("status") == "passed"
    if exit_passed != report_passed:
        integrity_issues.append(f"{label}: report status and process exit disagree")
        result["evidenceIssues"].append("Process exit and report acceptance status disagree.")
    if report_passed and attempt.get("timeout"):
        integrity_issues.append(f"{label}: passed report is marked timed out")
        result["evidenceIssues"].append("A timed-out invocation cannot be accepted.")
    if not (exit_passed and report_passed and result["reportHashVerified"] and not attempt.get("timeout")):
        result.update(partial_report_evidence(report))
        if report.get("status") == "running":
            result["acceptance"] = "incomplete-evidence"
        return result
    for key, comparison in comparisons.items():
        if not comparison["exactMatch"]:
            result["evidenceIssues"].append(f"Accepted-report candidate differs from the historical {key}.")
    if result["evidenceIssues"]:
        result["acceptance"] = "integrity-failed"
        integrity_issues.append(f"{label}: accepted-report candidate has mismatched controls or evidence")
        result.update(partial_report_evidence(report))
        return result
    try:
        analysis = audit_report(report_path)
        # The unchanged auditor enforces the complete Williams schedule, all
        # 64 trials, calibration gates, original PDF/pixel identities and source
        # snapshots before returning any accepted descriptive summary.
        result.update(accepted_evidence(analysis))
        result.update(accepted=True, acceptance="accepted")
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as error:
        result.update(partial_report_evidence(report))
        result.update(acceptance="integrity-failed", independentAuditStatus="failed")
        result["evidenceIssues"].append(str(error))
        integrity_issues.append(f"{label}: independent single-session audit failed: {error}")
    return result


def session_median_descriptions(accepted: list[dict]) -> dict:
    if len(accepted) == 1:
        return {
            "status": "not-estimable: no accepted additional run", "acceptedSessionCount": 1,
            "interpretation": "Only the historical session is accepted. No across-session variability estimate or replication conclusion is available; historical statistics remain separately labeled.",
        }

    def describe(values):
        medians = [item["medianMs"] for item in values]
        return {"acceptedSessionCount": len(medians), "sessionMedians": values,
                "minimumSessionMedianMs": min(medians), "maximumSessionMedianMs": max(medians),
                "medianOfSessionMediansMs": statistics.median(medians)}

    return {
        "status": "descriptive-only",
        "interpretation": "Descriptive variation of accepted session-level medians only. No raw timings are pooled, and these are not significance tests or independent environmental samples.",
        "byCondition": {condition: describe([
            {"session": session["session"], "medianMs": session["summary"]["byCondition"][condition]["medianMs"]}
            for session in accepted
        ]) for condition, _, _ in CONDITIONS.values()},
        "pairedContrasts": {name: describe([
            {"session": session["session"], "medianMs": session["pairedContrasts"][name]["medianMs"]}
            for session in accepted
        ]) for name in accepted[0]["pairedContrasts"]},
    }


def compare(plan_path: Path, ledger_path: Path) -> dict:
    plan, ledger = load(plan_path), load(ledger_path)
    require(plan.get("schemaVersion") == ledger.get("schemaVersion") == 1, "Unsupported plan or ledger schema")
    require(plan.get("additionalRunCount") == 3, "The fixed plan must declare exactly three additional invocations")
    require(ledger.get("status") == "complete", "Campaign ledger is not complete; do not report unfinished work as a three-attempt comparison")
    require(resolve(ledger["planPath"]) == plan_path and ledger["planSha256"] == sha256(plan_path), "Execution ledger does not match the frozen plan")
    attempts = ledger.get("attempts")
    require(isinstance(attempts, list) and len(attempts) == 3, "Expected exactly three fixed attempts; no replacements or omissions")
    require([attempt.get("ordinal") for attempt in attempts] == [1, 2, 3], "Attempt ordinals must be exactly 1, 2, 3 in execution order")
    original_path = resolve(plan["historicalReport"]["path"])
    report_paths = [resolve(attempt["reportPath"]) for attempt in attempts]
    require(len(set(report_paths)) == 3 and original_path not in report_paths, "New report paths must be distinct and cannot reuse the historical report")
    pids = [attempt.get("runnerPid") for attempt in attempts]
    require(all(type(pid) is int and pid > 0 for pid in pids) and len(set(pids)) == 3, "Three distinct positive runner process IDs are required")
    campaign_start = timestamp(ledger["startedAt"], "ledger.startedAt")
    campaign_end = timestamp(ledger["finishedAt"], "ledger.finishedAt")
    require(campaign_start <= campaign_end, "Campaign timestamps are reversed")
    previous_end = campaign_start
    for attempt in attempts:
        require(type(attempt.get("exitCode")) is int, "Every completed attempt needs a process exit code")
        start, end = timestamp(attempt["startedAt"], "attempt.startedAt"), timestamp(attempt["finishedAt"], "attempt.finishedAt")
        require(previous_end <= start <= end <= campaign_end, "Attempts overlap or have invalid campaign ordering")
        previous_end = end
    preserved_sources = preservation_check(plan["preservedSourceHashes"], "preservedSourceHashes")
    preserved_artifacts = preservation_check(plan["preservedArtifactHashes"], "preservedArtifactHashes")
    require(preserved_sources["status"] == preserved_artifacts["status"] == "passed", "Preserved source/artifact hashes changed; halt comparison")
    require(sha256(original_path) == plan["historicalReport"]["sha256"], "Historical report hash changed")
    original_report = load(original_path)
    original_analysis = audit_report(original_path)
    historical = {
        "session": "original", "role": "historical", "ordinal": 0, "reportPath": str(original_path),
        "actualReportSha256": sha256(original_path), "reportHashVerified": True,
        "accepted": True, "acceptance": "accepted", "reportStatus": original_report["status"],
        "exitCode": None, "runnerPid": None,
        "startedAt": original_report["startedAt"], "finishedAt": original_report["finishedAt"],
        "recordedEnvironment": original_report["environment"], "evidenceIssues": [],
        "processEvidenceNote": "Historical report is pinned and independently audited; this campaign does not invent a historical process exit code or PID.",
        **accepted_evidence(original_analysis),
    }
    integrity_issues: list[str] = []
    inspected = [inspect_attempt(attempt, original_report, integrity_issues) for attempt in attempts]
    accepted = [historical, *(attempt for attempt in inspected if attempt["accepted"])]
    prior_rejected = None
    if plan.get("historicalRejectedReport"):
        prior = plan["historicalRejectedReport"]
        path = resolve(prior["path"])
        require(sha256(path) == prior["sha256"], "Earlier rejected report changed")
        prior_report = load(path)
        require(prior_report.get("status") != "passed", "Historical rejected report is unexpectedly accepted")
        prior_rejected = {"reportPath": str(path), "reportSha256": sha256(path),
                          "notOneOfTheThreeNewAttempts": True, **partial_report_evidence(prior_report)}
    return {
        "schemaVersion": 1, "purpose": "fixed-three-attempt-controlled-delivery-replication-comparison",
        "auditStatus": "passed" if not integrity_issues else "failed", "integrityIssues": integrity_issues,
        "comparisonStatus": "complete" if all(attempt["accepted"] for attempt in inspected) else "complete-with-rejected-attempts",
        "planPath": str(plan_path), "planSha256": sha256(plan_path),
        "ledgerPath": str(ledger_path), "ledgerSha256": sha256(ledger_path),
        "comparisonScriptSha256": sha256(Path(__file__)),
        "reusedAuditScriptSha256": sha256(Path(__file__).with_name("summarize_controlled_delivery.py")),
        "newAttemptCount": 3, "acceptedAdditionalRuns": len(accepted) - 1,
        "rejectedAdditionalRuns": sum(not attempt["accepted"] for attempt in inspected),
        "replacementPolicy": plan.get("replacementPolicy"),
        "preservation": {"sources": preserved_sources, "artifacts": preserved_artifacts},
        "processEvidence": {"runnerPids": pids, "distinctRunnerProcesses": True,
                            "freshBrowserLaunchEvidence": "Distinct runner invocations plus preserved runner code that calls chromium.launch for each invocation. Browser process IDs were not independently recorded."},
        "historical": historical, "attempts": inspected, "historicalRejectedAttempt": prior_rejected,
        "acrossAcceptedSessionMedians": session_median_descriptions(accepted),
        "limits": [
            "No raw trial timings are pooled across sessions. Warmups remain tagged and excluded within each accepted session.",
            "Failed or incomplete invocations count toward the fixed three attempts and have no accepted timing summary; none are replaced.",
            "Consecutive same-machine sessions do not independently control OS/font caches, background load, or environmental conditions.",
            "This is a descriptive replication check, not a significance test, confidence interval, or cross-machine/production generalization.",
            "CDP byte totals include overlapping/repeated ranges and do not establish unique PDF coverage or exact physical arrival.",
        ],
    }


def session_rows(result: dict) -> list[dict]:
    rows = []
    for session in [result["historical"], *result["attempts"]]:
        base = {"session": session["session"], "role": session["role"], "ordinal": session["ordinal"],
                "accepted": session["accepted"], "acceptance": session["acceptance"], "reportStatus": session["reportStatus"],
                "exitCode": session["exitCode"], "runnerPid": session["runnerPid"], "reportPath": session["reportPath"],
                "reportSha256": session.get("actualReportSha256"), "independentAuditStatus": session["independentAuditStatus"],
                "evidenceIssues": " | ".join(session["evidenceIssues"])}
        if not session["accepted"]:
            rows.append({**base, "condition": None, "recordedTrialCount": session.get("recordedTrialCount", 0)})
            continue
        for condition, _, _ in CONDITIONS.values():
            net = session["networkByCondition"][condition]
            rows.append({**base, "condition": condition, "recordedTrialCount": 64,
                         **session["summary"]["byCondition"][condition],
                         **{name + "MedianMs": contrast["medianMs"] for name, contrast in session["pairedContrasts"].items()},
                         "rangeRequestCount": net["rangeRequestCount"], "validated206Count": net["validated206Count"],
                         "initial200FinishedAtOrBeforeRenderTrials": net["initial200Completion"]["atOrBeforeRender"],
                         "initial200FinishUncertainTrials": net["initial200Completion"]["uncertain"],
                         "initial200FinishedAfterRenderTrials": net["initial200Completion"]["afterRender"],
                         "cdpReportedAtOrBeforeRenderBytesMedian": net["cdpReportedDataBytes"]["atOrBeforeRender"]["median"],
                         "cdpUncertainBytesMedian": net["cdpReportedDataBytes"]["uncertain"]["median"],
                         "cdpAfterRenderBytesMedian": net["cdpReportedDataBytes"]["afterRender"]["median"],
                         "calibrationBeforeAndAfterPassed": True})
    return rows


def csv_text(rows: list[dict]) -> str:
    fields = list(dict.fromkeys(key for row in rows for key in row))
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--output-prefix", type=Path, required=True)
    args = parser.parse_args()
    prefix = resolve(args.output_prefix)
    paths = {suffix: Path(str(prefix) + suffix) for suffix in (".csv", ".trials.csv", ".json")}
    try:
        require(not any(path.exists() for path in paths.values()), "Comparison output exists; choose a new prefix")
        result = compare(resolve(args.plan), resolve(args.ledger))
        trials = [{"session": session["session"], "sessionRole": session["role"], "attemptOrdinal": session["ordinal"],
                   "sourceReportPath": session["reportPath"], "sourceReportSha256": session["actualReportSha256"], **trial}
                  for session in [result["historical"], *result["attempts"]] if session["accepted"] for trial in session["trials"]]
        result["exports"] = {"sessionConditionsCsv": str(paths[".csv"]), "acceptedTrialsCsv": str(paths[".trials.csv"]),
                             "acceptedTrialRows": len(trials), "acceptedWarmupRows": sum(trial["isWarmup"] for trial in trials)}
        contents = {".csv": csv_text(session_rows(result)), ".trials.csv": csv_text(trials)}
        for suffix in (".csv", ".trials.csv"):
            paths[suffix].parent.mkdir(parents=True, exist_ok=True)
            with paths[suffix].open("x", encoding="utf-8", newline="") as stream:
                stream.write(contents[suffix])
        result["exportHashes"] = {suffix: sha256(paths[suffix]) for suffix in (".csv", ".trials.csv")}
        with paths[".json"].open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(result, indent=2) + "\n")
        print(f"{result['auditStatus'].upper()}: three fixed attempts; {result['acceptedAdditionalRuns']} accepted, {result['rejectedAdditionalRuns']} rejected. No pooled timing statistics.")
        for path in paths.values():
            print(path)
        return 0 if result["auditStatus"] == "passed" else 1
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

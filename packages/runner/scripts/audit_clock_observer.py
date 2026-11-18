"""Independently audit fixed clock-observer probes without running a browser.

All scheduled probes remain visible, including failed and unattempted probes.
Clock and known-event outcomes are diagnostic evidence, not PDF performance.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import statistics
import sys
from pathlib import Path
from urllib.parse import urlsplit

from summarize_controlled_delivery import ROOT, equal, network_audit, number, pacing_audit, require, sha256

POINTS = ("beforeMarker", "afterMarker", "afterSecondTransfer")
METHODS = ("reference", "candidate")


def schedule() -> list[dict]:
    return [{"id": f"session-{session}-probe-{probe}-{'unpaced' if (session + probe) % 2 == 0 else 'paced'}",
             "session": session, "probe": probe, "mode": "unpaced" if (session + probe) % 2 == 0 else "paced"}
            for session in range(1, 4) for probe in range(1, 13)]


def input_error(bursts: object, marker: object) -> str | None:
    try:
        number(marker, "markerMs")
        require(isinstance(bursts, list) and len(bursts) == 3, "Expected three clock points")
        previous = None
        for point, burst in zip(POINTS, bursts):
            require(isinstance(burst, dict) and burst.get("point") == point, "Clock points are missing or reordered")
            samples = burst.get("samples")
            require(isinstance(samples, list) and len(samples) == 5, "Expected five samples at every point")
            for sample in samples:
                require(isinstance(sample, dict), "Invalid sample")
                for key in ("beforeSeconds", "pageNowMs", "afterSeconds"):
                    number(sample.get(key), key)
                require(sample["beforeSeconds"] <= sample["afterSeconds"], "Reversed bracket")
                if previous:
                    require(previous["afterSeconds"] <= sample["beforeSeconds"] and previous["pageNowMs"] <= sample["pageNowMs"], "Samples are not in collection order")
                previous = sample
    except (ValueError, TypeError, KeyError) as error:
        return str(error)
    return None


def analyze_clocks(bursts: object, marker: object) -> dict:
    problem = input_error(bursts, marker)
    if problem:
        return {method: {"sampleCount": 0, "status": "failed", "reason": "invalid-input",
                         "offset": None, "boundary": None, "widthMs": None, "diagnostic": problem}
                for method in METHODS}
    result = {}
    for method in METHODS:
        samples = [burst["samples"][0] for burst in bursts] if method == "reference" else [sample for burst in bursts for sample in burst["samples"]]
        lower = max(sample["beforeSeconds"] - sample["pageNowMs"] / 1000 - .001 for sample in samples)
        upper = min(sample["afterSeconds"] - sample["pageNowMs"] / 1000 + .001 for sample in samples)
        value = {"sampleCount": len(samples), "status": "failed", "reason": "non-overlap",
                 "offset": None, "boundary": None, "widthMs": None}
        if lower <= upper:
            boundary = {"lowerSeconds": marker / 1000 + lower - .001, "upperSeconds": marker / 1000 + upper + .001}
            if not all(math.isfinite(x) for x in boundary.values()):
                value["reason"] = "invalid-input"
            else:
                width = (boundary["upperSeconds"] - boundary["lowerSeconds"]) * 1000
                value.update(offset={"lowerSeconds": lower, "upperSeconds": upper}, boundary=boundary,
                             widthMs=width, status="passed" if width <= 5 else "failed", reason=None if width <= 5 else "width")
        result[method] = value
    return result


def compare_clock(actual: dict, expected: dict, label: str) -> None:
    for key in ("sampleCount", "status", "reason", "widthMs"):
        equal(actual[key], expected[key], f"{label}.{key}")
    for field in ("offset", "boundary"):
        if expected[field] is None:
            equal(actual[field], None, f"{label}.{field}")
        else:
            for key in ("lowerSeconds", "upperSeconds"):
                equal(actual[field][key], expected[field][key], f"{label}.{field}.{key}")
            equal(actual[field]["clockResolutionMarginMs"], 1, f"{label}.{field} margin")
            require("not a proven universal" in actual[field]["assumption"], f"{label}: missing resolution assumption")


def known_events(probe: dict, boundary: dict | None) -> dict:
    if boundary is None:
        return {"status": "unavailable", "reason": "no-interval"}
    result = {"status": "passed", "reason": None}
    try:
        bounds = (boundary["lowerSeconds"], boundary["upperSeconds"])
        for name, stage, phase in (("first", "firstStage", "at-or-before"), ("second", "secondStage", "after")):
            transfer = probe[stage][name]
            net = network_audit(probe["networkEvents"], transfer["url"], bounds, name)
            result[name] = net
            require(len(net["requests"]) == 1 and net["requests"][0]["observedRange"], f"{name}: expected one observed range response")
            expected_range = "bytes=0-4095" if name == "first" else "bytes=4096-8191"
            equal(net["requests"][0]["range"], expected_range, f"{name}: requested range")
            for key in ("requestStarts", "responseHeaders", "loadingFinished"):
                equal(net["buckets"][phase][key], 1, f"{name}: {key} class")
            equal(net["buckets"][phase]["reportedDataBytes"], 4096, f"{name}: reported-data class")
            equal(net["buckets"][phase]["loadingFailed"], 0, f"{name}: failed requests")
            require(net["buckets"][phase]["dataEvents"] >= 1, f"{name}: no data events")
            for other in set(net["buckets"]) - {phase}:
                require(all(value == 0 for value in net["buckets"][other].values()), f"{name}: unexpected events in {other}")
    except (ValueError, TypeError, KeyError) as error:
        result.update(status="failed", reason="known-event-mismatch", diagnostic=str(error))
    return result


def collection_cost(bursts: list[dict]) -> dict:
    durations, sample_durations, first_durations = {}, [], []
    for burst in bursts:
        if "startedNodeAtMs" in burst and "finishedNodeAtMs" in burst:
            start = number(burst["startedNodeAtMs"], "burst start")
            end = number(burst["finishedNodeAtMs"], "burst finish")
            require(end >= start, "Reversed burst wall times")
            durations[burst["point"]] = end - start
        for index, sample in enumerate(burst.get("samples", [])):
            duration = (number(sample["afterSeconds"], "sample after") - number(sample["beforeSeconds"], "sample before")) * 1000
            require(duration >= 0, "Reversed sample")
            sample_durations.append(duration)
            if index == 0:
                first_durations.append(duration)
    return {"burstElapsedMs": durations, "sumBurstElapsedMs": sum(durations.values()),
            "observedBracketCount": len(sample_durations), "allBracketDurationSumMs": sum(sample_durations),
            "referenceBracketDurationSumMs": sum(first_durations),
            "additionalBracketDurationSumMs": sum(sample_durations) - sum(first_durations),
            "interpretation": "Observed collection durations only. CDP bracket spans omit some call overhead; the candidate/reference difference is not a measured counterfactual probe cost."}


def descriptive(values: list[float]) -> dict | None:
    return {"count": len(values), "minimum": min(values), "median": statistics.median(values), "maximum": max(values)} if values else None


def aggregate(rows: list[dict]) -> dict:
    paired = {"bothPassed": 0, "referenceOnlyPassed": 0, "candidateOnlyPassed": 0, "neitherPassed": 0, "unavailable": 0}
    for row in rows:
        if row.get("referenceStatus") is None or row.get("candidateStatus") is None:
            paired["unavailable"] += 1
        elif row["referenceStatus"] == "passed":
            paired["bothPassed" if row["candidateStatus"] == "passed" else "referenceOnlyPassed"] += 1
        else:
            paired["candidateOnlyPassed" if row["candidateStatus"] == "passed" else "neitherPassed"] += 1
    fields = ("referenceWidthMs", "candidateWidthMs", "candidateMinusReferenceWidthMs", "sumBurstElapsedMs",
              "allBracketDurationSumMs", "referenceBracketDurationSumMs", "additionalBracketDurationSumMs")
    return {"scheduledProbes": len(rows), "attemptedProbes": sum(row["attempted"] for row in rows),
            "operationalFailures": sum(row["attempted"] and row["operationStatus"] != "passed" for row in rows),
            "pairedMethodOutcomes": paired,
            "clockOutcomeCounts": {method: {reason: sum((row.get(method + "ClockReason") or row.get(method + "ClockStatus") or "unavailable") == reason for row in rows)
                                             for reason in ("passed", "width", "non-overlap", "invalid-input", "unavailable")} for method in METHODS},
            "descriptive": {field: descriptive([row[field] for row in rows if row.get(field) is not None]) for field in fields}}


def operation_evidence(probe: dict, config: dict) -> dict:
    result = {"status": "passed", "reason": None}
    try:
        equal(probe["errors"], [], "browser diagnostics")
        equal(probe["workers"], [], "unexpected worker")
        equal(probe["firstStage"]["timeOriginMs"], probe["secondStage"]["timeOriginMs"], "page time origin")
        marker = number(probe["firstStage"]["markerMs"], "marker")
        first, second = probe["firstStage"]["first"], probe["secondStage"]["second"]
        require(first["completedAtMs"] <= marker <= second["startAtMs"], "Known transfers do not straddle marker")
        equal([burst["point"] for burst in probe["bursts"]], list(POINTS), "clock collection points")
        require(all(len(burst["samples"]) == 5 for burst in probe["bursts"]), "Incomplete calibration bursts")
        before, middle, after = [[number(sample["pageNowMs"], "sample page time") for sample in burst["samples"]] for burst in probe["bursts"]]
        require(all(value <= first["startAtMs"] for value in before), "Before-marker clock point misplaced")
        require(all(marker <= value <= second["startAtMs"] for value in middle), "After-marker clock point misplaced")
        require(all(value >= second["completedAtMs"] for value in after), "Final clock point misplaced")
        if "actualPageGapsMs" in probe:
            equal(probe["actualPageGapsMs"], {"beforeMarker": marker - first["completedAtMs"],
                                           "afterMarker": second["startAtMs"] - marker}, "actual page gaps")
        requests = [request for request in probe["serverRequests"] if request["url"].startswith("/probe/")]
        require(len(requests) == 2, "Expected two fixture server responses")
        equal(sum(event["kind"] == "request" for event in probe["networkEvents"]), 2, "fixture CDP requests")
        request_ids = {event["requestId"] for event in probe["networkEvents"] if event["kind"] == "request"}
        require(all(event["requestId"] in request_ids for event in probe["networkEvents"]), "Orphan CDP events")
        require(all(request["completed"] and not request["canceled"] and request["status"] < 400 for request in probe["serverRequests"]), "Incomplete or failed server request")
        totals = []
        for index, transfer in enumerate((first, second)):
            start, headers, finish = (number(transfer[key], key) for key in ("startAtMs", "headersAtMs", "completedAtMs"))
            require(start <= headers <= finish, "Transfer page timings are reversed")
            equal(transfer["bytes"], 4096, "browser transfer bytes")
            equal(transfer["status"], 206, "browser response status")
            equal(transfer["contentRange"], f"bytes {index * 4096}-{index * 4096 + 4095}/49152", "browser content range")
            equal(int(transfer["contentLength"]), 4096, "browser content length")
            parsed = urlsplit(transfer["url"])
            equal(parsed.path, f"/probe/{probe['mode']}.bin", "fixture mode")
            server = next(request for request in requests if request["url"] == parsed.path + "?" + parsed.query)
            require(server["completed"] and not server["canceled"], "Incomplete server response")
            equal(server["status"], 206, "server status")
            equal(server["paced"], probe["mode"] == "paced", "server pacing mode")
            equal(server["bodyBytesWritten"], 4096, "server bytes written")
            equal(server["bodyBytesPlanned"], 4096, "server bytes planned")
            net = network_audit(probe["networkEvents"], transfer["url"], (math.inf, math.inf), f"transfer {index + 1}")
            require(len(net["requests"]) == 1 and net["requests"][0]["observedRange"], "Missing complete CDP range evidence")
            equal(net["requests"][0]["range"], f"bytes={index * 4096}-{index * 4096 + 4095}", "CDP requested range")
            equal(net["buckets"]["at-or-before"]["reportedDataBytes"], 4096, "CDP total transfer bytes")
            totals.append(4096)
        result["cdpReportedTransferBodyBytes"] = totals
        if probe["mode"] == "paced":
            result["pacing"] = pacing_audit(requests, {"delivery": config["delivery"], "calibration": config["pacingAuditLimits"]}, probe["id"])
            require(probe.get("pacingAudit") is not None, "Missing reported pacing audit")
    except (ValueError, TypeError, KeyError, StopIteration) as error:
        result.update(status="failed", reason=str(error))
    return result


def reported_counts(probes: list[dict]) -> dict:
    statuses = [(probe.get("methods", {}).get("reference", {}).get("status") == "passed",
                 probe.get("methods", {}).get("candidate", {}).get("status") == "passed") for probe in probes]
    return {"attempted": len(probes), "operationalFailures": sum(probe.get("operationStatus") != "passed" for probe in probes),
            "bothPassed": sum(a and b for a, b in statuses), "referenceOnly": sum(a and not b for a, b in statuses),
            "candidateOnly": sum(not a and b for a, b in statuses), "neither": sum(not a and not b for a, b in statuses)}


def audit_report(report_path: Path) -> dict:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    config = json.loads((ROOT / "experiments/clock-observer.json").read_text())
    lock = json.loads((ROOT / "experiments/clock-observer-preservation-lock.json").read_text())
    issues = []

    def check(label, operation):
        try:
            operation()
        except (OSError, ValueError, TypeError, KeyError, StopIteration) as error:
            issues.append(f"{label}: {error}")

    check("configuration", lambda: equal(report.get("experiment"), config, "recorded config"))
    check("preservation lock", lambda: equal(report.get("preservationLock"), lock, "recorded preservation lock"))
    check("purpose", lambda: require(report.get("purpose") == "known-event-clock-observer-diagnostic-not-pdf-performance", "Unexpected purpose"))
    check("campaign status", lambda: require(report.get("status") in ("complete", "incomplete"), "Campaign is still running or has unknown status"))
    for field in ("sourceHashes", "artifactHashes"):
        for filename, expected in lock[field].items():
            check(f"preserved {filename}", lambda filename=filename, expected=expected: equal(sha256(ROOT / filename), expected, "SHA-256"))
    sources = report.get("sourceHashes", {})
    expected_sources = ["experiments/clock-observer.json", "experiments/clock-observer-preservation-lock.json", "docs/clock-observer.md",
                        "packages/runner/viewer/clock-observer.html", "packages/runner/viewer/clock-observer.mjs"]
    for name in ("clock-observer", "clock-observer-protocol", "partial-network", "paced-server", "server", "delivery-calibration"):
        expected_sources.extend((f"packages/runner/src/{name}.ts", f"packages/runner/dist/{name}.js"))
    check("executed sources", lambda: require(isinstance(sources, dict) and set(sources) == set(expected_sources), "Missing or unexpected source hashes"))
    if not isinstance(sources, dict):
        sources = {}
    for filename, expected in sources.items():
        for path in (ROOT / filename, report_path.parent / "source-snapshot" / filename):
            check(str(path), lambda path=path, expected=expected: equal(sha256(path), expected, "SHA-256"))
    environment = report.get("environment", {})
    for field, key in (("node", "expectedNodeVersion"), ("playwright", "expectedPlaywrightVersion")):
        check(f"environment {field}", lambda field=field, key=key: equal(environment.get(field), config[key], field))
    expected_schedule = schedule()
    check("schedule", lambda: equal(report.get("schedule"), expected_schedule, "fixed schedule"))
    sessions = report.get("sessions", [])
    probes = [probe for session in sessions for probe in session.get("probes", [])]
    check("session order", lambda: equal([session["session"] for session in sessions], list(range(1, len(sessions) + 1)), "session order"))
    check("session count", lambda: require(len(sessions) <= 3, "Too many sessions"))
    check("probe order", lambda: equal([{key: probe.get(key) for key in ("id", "session", "probe", "mode")} for probe in probes], expected_schedule[:len(probes)], "attempted schedule prefix"))
    check("unattempted schedule", lambda: equal(report.get("unattemptedProbes"), expected_schedule[len(probes):], "unattempted probes"))
    for session in sessions:
        check(f"session {session['session']} membership", lambda session=session: require(all(probe["session"] == session["session"] for probe in session.get("probes", [])), "Probe recorded under wrong session"))
        if session.get("chromium") is not None:
            check(f"session {session['session']} Chromium", lambda session=session: equal(session["chromium"], config["expectedChromiumVersion"], "Chromium version"))
    if report.get("status") == "complete":
        check("complete campaign", lambda: require(len(sessions) == 3 and len(probes) == 36 and all(session["status"] == "complete" for session in sessions), "Incomplete schedule marked complete"))
        check("preservation outcome", lambda: require(report.get("preservedFilesUnchanged") and report.get("diagnosticSourcesUnchanged"), "Preservation outcome not recorded"))
    index = {probe["id"]: probe for probe in probes}
    rows, details = [], []
    for expected in expected_schedule:
        probe = index.get(expected["id"])
        row = {**expected, "attempted": probe is not None, "operationStatus": probe.get("operationStatus", "incomplete") if probe else "unattempted"}
        rows.append(row)
        if probe is None:
            continue
        label = probe["id"]
        clocks = analyze_clocks(probe.get("bursts"), probe.get("firstStage", {}).get("markerMs"))
        operations = operation_evidence(probe, config)
        if probe.get("operationStatus") == "passed":
            check(label + " operations", lambda: require(operations["status"] == "passed", operations["reason"]))
        detail = {**expected, "operations": operations, "clocks": clocks, "methods": {}, "recordedError": probe.get("error")}
        details.append(detail)
        if probe.get("clockAnalysis") is not None:
            check(label + " raw calibration", lambda: equal(probe["clockAnalysis"]["rawInput"], {"bursts": probe["bursts"], "markerMs": probe.get("firstStage", {}).get("markerMs")}, "retained raw input"))
            check(label + " margins", lambda: equal([probe["clockAnalysis"]["resolutionMarginMs"], probe["clockAnalysis"]["maximumBoundaryWidthMs"]], [1, 5], "clock constants"))
        for method in METHODS:
            clock = clocks[method]
            classification = known_events(probe, clock["boundary"])
            status = "passed" if probe.get("operationStatus") == "passed" and clock["status"] == classification["status"] == "passed" else "failed"
            detail["methods"][method] = {"status": status, "classification": classification}
            row.update({method + "Status": status, method + "ClockStatus": clock["status"], method + "ClockReason": clock["reason"],
                        method + "WidthMs": clock["widthMs"], method + "ClassificationStatus": classification["status"], method + "ClassificationReason": classification["reason"]})
            recorded = probe.get("methods", {}).get(method)
            if recorded is None:
                row[method + "Status"] = None
                check(label + " missing method", lambda: require(probe.get("operationStatus") != "passed", "Passed operation lacks method analysis"))
                continue
            check(label + "/" + method, lambda recorded=recorded, clock=clock: compare_clock(recorded["clock"], clock, label))
            check(label + "/" + method + " analysis", lambda method=method, clock=clock: compare_clock(probe["clockAnalysis"][method], clock, label))
            check(label + "/" + method + " outcome", lambda recorded=recorded, status=status: equal(recorded["status"], status, "method acceptance"))
            check(label + "/" + method + " classification", lambda recorded=recorded, classification=classification: equal(recorded["classification"]["status"], classification["status"], "known-event acceptance"))
            for transfer in ("first", "second"):
                net = classification.get(transfer)
                if net:
                    row[method + transfer.title() + "AtOrBeforeBytes"] = net["buckets"]["at-or-before"]["reportedDataBytes"]
                    row[method + transfer.title() + "UncertainBytes"] = net["buckets"]["uncertain"]["reportedDataBytes"]
                    row[method + transfer.title() + "AfterBytes"] = net["buckets"]["after"]["reportedDataBytes"]
                    if transfer in recorded["classification"]:
                        check(label + "/" + method + "/" + transfer, lambda net=net, transfer=transfer, recorded=recorded: equal(recorded["classification"][transfer]["byRenderTime"], net["buckets"], "network buckets"))
        if all(clocks[method]["widthMs"] is not None for method in METHODS):
            row["candidateMinusReferenceWidthMs"] = clocks["candidate"]["widthMs"] - clocks["reference"]["widthMs"]
        try:
            detail["collection"] = collection_cost(probe.get("bursts", []))
            row.update({key: value for key, value in detail["collection"].items() if isinstance(value, (int, float))})
        except (ValueError, TypeError, KeyError) as error:
            detail["collection"] = {"status": "incomplete", "reason": str(error)}
    summary = report.get("summary", {})
    check("reported outcome totals", lambda: equal({key: summary.get(key) for key in reported_counts(probes)}, reported_counts(probes), "outcome counts"))
    check("reported mode counts", lambda: equal(summary.get("byMode"), {mode: reported_counts([probe for probe in probes if probe["mode"] == mode]) for mode in ("unpaced", "paced")}, "mode counts"))
    check("reported session counts", lambda: equal(summary.get("bySession"), [{"session": session["session"], **reported_counts(session.get("probes", []))} for session in sessions], "session counts"))
    return {"schemaVersion": 1, "purpose": "independent-clock-observer-audit-not-pdf-performance",
            "auditStatus": "passed" if not issues else "failed", "integrityIssues": issues,
            "campaignStatus": report.get("status"), "reportPath": str(report_path), "reportSha256": sha256(report_path),
            "auditScriptSha256": sha256(Path(__file__)), "reusedAuditScriptSha256": sha256(Path(__file__).with_name("summarize_controlled_delivery.py")),
            "environment": environment, "experiment": config, "preservation": {"sourceFiles": len(lock["sourceHashes"]), "artifactFiles": len(lock["artifactHashes"]), "executedSourceSnapshots": len(sources)},
            "overall": aggregate(rows), "byMode": {mode: aggregate([row for row in rows if row["mode"] == mode]) for mode in ("unpaced", "paced")},
            "bySession": [{"session": session, **aggregate([row for row in rows if row["session"] == session])} for session in range(1, 4)],
            "bySessionAndMode": [{"session": session, "mode": mode, **aggregate([row for row in rows if row["session"] == session and row["mode"] == mode])} for session in range(1, 4) for mode in ("unpaced", "paced")],
            "rows": rows, "probeEvidence": details,
            "limits": ["Known synthetic binary transfers only; no PDF loading or rendering was measured.",
                       "Nested interval narrowing is a mathematical consequence of additional constraints, not independent proof of clock accuracy.",
                       "The 1 ms resolution margins and stable additive clock offset remain assumptions; the unchanged 5 ms gate is applied strictly.",
                       "Width descriptives include every finite interval, including gate failures and separately marked operational failures; unavailable intervals remain in outcome counts.",
                       "CDP event-accounted data bytes are not exact physical or application byte arrival times.",
                       "Browser fixture byte-pattern verification is supported by preserved executed source and operation outcome; raw response payloads are not retained for independent replay."]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output-prefix", type=Path, required=True)
    args = parser.parse_args()
    prefix = args.output_prefix.resolve()
    paths = {suffix: Path(str(prefix) + suffix) for suffix in (".csv", ".json")}
    try:
        require(not any(path.exists() for path in paths.values()), "Output exists; choose a new prefix")
        result = audit_report(args.report.resolve())
        rows = result["rows"]
        fields = list(dict.fromkeys(key for row in rows for key in row))
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
        writer.writeheader(); writer.writerows(rows)
        prefix.parent.mkdir(parents=True, exist_ok=True)
        with paths[".csv"].open("x", encoding="utf-8", newline="") as stream:
            stream.write(buffer.getvalue())
        result["export"] = {"csvPath": str(paths[".csv"]), "csvSha256": sha256(paths[".csv"]), "scheduledRows": len(rows)}
        with paths[".json"].open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(result, indent=2) + "\n")
        print(f"{result['auditStatus'].upper()}: {result['overall']['attemptedProbes']}/36 probes attempted; {result['overall']['pairedMethodOutcomes']}")
        return 0 if result["auditStatus"] == "passed" else 1
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

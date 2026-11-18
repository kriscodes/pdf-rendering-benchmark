"""Audit PDF-workload observer integration; never launch a browser or pool history.

All scheduled rows and pairs remain visible. Perturbation pairs require valid
operations and session guards, independently of the clock acceptance gate.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
from pathlib import Path

from summarize_controlled_delivery import (
    ROOT, CONDITIONS, ROWS, calibration_audit, classify, equal, network_audit,
    number, pacing_audit, require, sha256, statistics,
)
from audit_clock_observer import (
    analyze_clocks as fixture_clocks, compare_clock, known_events,
    operation_evidence as fixture_operations,
)

POINTS = ("beforeRender", "afterRender", "afterVerification")
METHODS = ("reference", "candidate")
PHASES = ("at-or-before", "uncertain", "after")
REQUEST_PHASE = {"at-or-before": "measurement", "uncertain": "verificationUncertain", "after": "verification"}
METRICS = ("firstPageRenderMs", "renderToVerificationStartMs", "renderReturnToVerificationCallMs",
           "observerCollectionMs", "observationWindowMs", "postObservationDrainMs", "trialElapsedMs",
           "bracketSpanSumMs", "rangeRequestCount", "cdpTotalBodyBytes", "completedResourceTimingBytes")


def schedule() -> list[dict]:
    result = []
    for session in range(1, 4):
        for block, codes in enumerate(ROWS, 1):
            for position, code in enumerate(codes, 1):
                condition, variant, enabled = CONDITIONS[code]
                pair = f"session-{session}-block-{block}-{condition}"
                arms = ("three", "fifteen") if (session + block + position) % 2 == 0 else ("fifteen", "three")
                for arm_position, arm in enumerate(arms, 1):
                    result.append({"id": f"{pair}-{arm}", "session": session, "block": block, "position": position,
                                   "condition": condition, "variant": variant, "rangeEnabled": enabled, "pairId": pair,
                                   "arm": arm, "armPosition": arm_position, "bracketsPerPoint": 1 if arm == "three" else 5})
    return result


def clock_analysis(trial: dict) -> dict:
    bursts, count = trial.get("bursts"), trial.get("bracketsPerPoint")
    render = trial.get("render", {}).get("firstPageRenderedAtMs")
    verification = trial.get("verification", {}).get("verificationStartedAtMs")
    def failure(samples, reason):
        return {"sampleCount": samples, "status": "failed", "reason": reason, "offset": None,
                "boundary": None, "verificationBoundary": None, "widthMs": None}
    try:
        require(count in (1, 5), "Invalid fixed bracket count")
        number(render, "render marker"); number(verification, "verification marker")
        require(verification >= render, "Verification precedes render")
        require(isinstance(bursts, list) and len(bursts) == 3, "Expected three bursts")
        previous = None
        for point, burst in zip(POINTS, bursts):
            require(burst["point"] == point and len(burst["samples"]) == count, "Wrong point or bracket count")
            for sample in burst["samples"]:
                for key in ("beforeSeconds", "pageNowMs", "afterSeconds"):
                    number(sample[key], key)
                require(sample["beforeSeconds"] <= sample["afterSeconds"], "Reversed bracket")
                if previous:
                    require(previous["afterSeconds"] <= sample["beforeSeconds"] and previous["pageNowMs"] <= sample["pageNowMs"], "Samples out of collection order")
                previous = sample
    except (ValueError, TypeError, KeyError):
        return {"reference": failure(0, "invalid-input"), "candidate": failure(0, "invalid-input") if count == 5 else None}
    result = {"candidate": None}
    for method in METHODS if count == 5 else ("reference",):
        samples = [burst["samples"][0] for burst in bursts] if method == "reference" else [sample for burst in bursts for sample in burst["samples"]]
        lower = max(sample["beforeSeconds"] - sample["pageNowMs"] / 1000 - .001 for sample in samples)
        upper = min(sample["afterSeconds"] - sample["pageNowMs"] / 1000 + .001 for sample in samples)
        value = failure(len(samples), "non-overlap")
        if lower <= upper:
            boundary = {"lowerSeconds": render / 1000 + lower - .001, "upperSeconds": render / 1000 + upper + .001}
            vb = {"lowerSeconds": verification / 1000 + lower - .001, "upperSeconds": verification / 1000 + upper + .001}
            if not all(math.isfinite(x) for x in (*boundary.values(), *vb.values())):
                value = failure(len(samples), "invalid-input")
            else:
                width = (boundary["upperSeconds"] - boundary["lowerSeconds"]) * 1000
                value.update(offset={"lowerSeconds": lower, "upperSeconds": upper}, boundary=boundary,
                             verificationBoundary=vb, widthMs=width, status="passed" if width <= 5 else "failed", reason=None if width <= 5 else "width")
        result[method] = value
    return result


def compare_pdf_clock(actual: dict, expected: dict, label: str) -> None:
    compare_clock(actual, expected, label)
    if expected["verificationBoundary"] is None:
        equal(actual["verificationBoundary"], None, label + " verification boundary")
    else:
        for key, value in expected["verificationBoundary"].items():
            equal(actual["verificationBoundary"][key], value, label + " verification " + key)
        equal(actual["verificationBoundary"]["clockResolutionMarginMs"], 1, label + " verification margin")


def reconstruct_network(trial: dict, clock: dict) -> dict | None:
    if clock["boundary"] is None:
        return None
    bounds = tuple(clock["boundary"][key] for key in ("lowerSeconds", "upperSeconds"))
    vb = tuple(clock["verificationBoundary"][key] for key in ("lowerSeconds", "upperSeconds"))
    events, url = trial["networkEvents"], trial["render"]["pdfUrl"]
    net = network_audit(events, url, bounds, trial["id"])
    phases = {}
    for row in net["requests"]:
        row["renderTimeClass"] = classify(row["start"], bounds)
        row["phase"] = REQUEST_PHASE[classify(row["start"], vb)]
    for phase in REQUEST_PHASE.values():
        ids = {row["requestId"] for row in net["requests"] if row["phase"] == phase}
        buckets = network_audit([event for event in events if event["requestId"] in ids], url, bounds, phase)["buckets"] if ids else {
            name: dict.fromkeys(bucket, 0) for name, bucket in net["buckets"].items()}
        phases[phase] = {"requestCount": len(ids), "byRenderTime": buckets}
    net["byRequestPhase"] = phases
    net["range"] = {"requestCount": sum(row["range"] is not None for row in net["requests"]),
                    "observed206Count": sum(row["observedRange"] for row in net["requests"])}
    return net


def compare_network(actual: dict | None, expected: dict | None, label: str) -> None:
    if expected is None:
        equal(actual, None, label + " unavailable network"); return
    equal(actual["byRenderTime"], expected["buckets"], label + " render buckets")
    equal(actual["requestCount"], len(expected["requests"]), label + " request count")
    equal(actual["range"], expected["range"], label + " range evidence")
    equal(actual["byRequestPhase"], expected["byRequestPhase"], label + " verification phases")
    before, uncertain = (expected["buckets"][phase]["reportedDataBytes"] for phase in ("at-or-before", "uncertain"))
    equal(actual["reportedDataAtRender"], {"atOrBeforeBytes": before, "uncertainBytes": uncertain,
                                         "atOrBeforePlusUncertainBytes": before + uncertain}, label + " reported body interval")
    for row in expected["requests"]:
        exported = next(request for request in actual["requests"] if request["requestId"] == row["requestId"])
        for key in ("phase", "renderTimeClass"):
            equal(exported[key], row[key], label + " request " + key)
        require(exported["completed"] and not exported["failed"], label + " unfinished request")


def timing_evidence(trial: dict) -> dict:
    render, verified, timings, bursts = (trial[key] for key in ("render", "verification", "timings", "bursts"))
    for metric, first, last in (("firstPageRenderMs", "startedAtMs", "firstPageRenderedAtMs"),
                               ("documentLoadedMs", "startedAtMs", "documentLoadedAtMs"),
                               ("pageLoadedMs", "startedAtMs", "pageLoadedAtMs"),
                               ("canvasRenderMs", "renderStartedAtMs", "firstPageRenderedAtMs")):
        equal(render[metric], render[last] - render[first], metric + " arithmetic")
        require(number(render[metric], metric) > 0, metric + " must be positive")
    equal(render["timeOriginMs"], verified["timeOriginMs"], "page time origin")
    pages = [[number(sample["pageNowMs"], "page clock") for sample in burst["samples"]] for burst in bursts]
    require(len(pages) == 3 and all(len(values) == trial["bracketsPerPoint"] for values in pages), "Incomplete fixed bursts")
    require(all(value <= render["startedAtMs"] for value in pages[0]), "Before-render collection misplaced")
    require(all(render["firstPageRenderedAtMs"] <= value <= verified["verificationStartedAtMs"] for value in pages[1]), "Middle collection misplaced")
    require(all(value >= verified["verificationFinishedAtMs"] for value in pages[2]), "After-verification collection misplaced")
    require(render["documentLoadedMs"] <= render["pageLoadedMs"] <= render["firstPageRenderMs"], "Render milestones reversed")
    burst_ms = {burst["point"]: number(burst["finishedNodeAtMs"], "burst end") - number(burst["startedNodeAtMs"], "burst start") for burst in bursts}
    require(all(value >= 0 for value in burst_ms.values()), "Reversed burst wall times")
    ordered = [timings["startedNodeAtMs"], bursts[0]["startedNodeAtMs"], bursts[0]["finishedNodeAtMs"],
               timings["renderCallNodeAtMs"], timings["renderReturnNodeAtMs"], bursts[1]["startedNodeAtMs"], bursts[1]["finishedNodeAtMs"],
               timings["verificationCallNodeAtMs"], timings["verificationReturnNodeAtMs"], bursts[2]["startedNodeAtMs"], bursts[2]["finishedNodeAtMs"],
               timings["drainCompletedNodeAtMs"], timings["finishedNodeAtMs"]]
    require(all(a <= b for a, b in zip(ordered, ordered[1:])), "Controller checkpoints are out of order")
    spans = [(sample["afterSeconds"] - sample["beforeSeconds"]) * 1000 for burst in bursts for sample in burst["samples"]]
    require(all(number(span, "bracket span") >= 0 for span in spans), "Reversed CDP bracket")
    expected = {"trialElapsedMs": timings["finishedNodeAtMs"] - timings["startedNodeAtMs"], "burstElapsedMsByPoint": burst_ms,
                "observerCollectionMs": sum(burst_ms.values()), "renderToVerificationStartMs": verified["verificationStartedAtMs"] - render["firstPageRenderedAtMs"],
                "renderReturnToVerificationCallMs": timings["verificationCallNodeAtMs"] - timings["renderReturnNodeAtMs"],
                "observationWindowMs": bursts[-1]["finishedNodeAtMs"] - bursts[0]["startedNodeAtMs"],
                "postObservationDrainMs": timings["drainCompletedNodeAtMs"] - bursts[-1]["finishedNodeAtMs"]}
    for key, value in expected.items():
        equal(timings[key], value, key)
    equal(timings["bracketSpansMsByPoint"], {burst["point"]: [(sample["afterSeconds"] - sample["beforeSeconds"]) * 1000 for sample in burst["samples"]] for burst in bursts}, "bracket spans by point")
    equal(timings["bracketSpansTotalMs"], sum(spans), "bracket span sum")
    return {"firstPageRenderMs": render["firstPageRenderMs"], **expected, "bracketSpansMs": spans, "bracketSpanSumMs": sum(spans)}


def operation_evidence(trial: dict, workload: dict, document: dict, pixel_hash: str, output: Path) -> dict:
    result = {"status": "passed", "reason": None}
    try:
        render, verified = trial["render"], trial["verification"]
        equal(trial["errors"], [], "browser diagnostics")
        require(len(trial["workers"]) == 1 and trial["workers"][0].endswith("/pdfjs/build/pdf.worker.mjs"), "Expected one real worker")
        equal([render[key] for key in ("numPages", "width", "height", "devicePixelRatio")], [100, 612, 792, 1], "render dimensions")
        equal(render["pdfjsVersion"], "5.6.205", "renderer version")
        equal(verified["downloadedBytes"], document["bytes"], "browser document size")
        equal(verified["downloadedSha256"], document["sha256"], "browser document SHA-256")
        equal(verified["rgbaSha256"], pixel_hash, "canvas RGBA SHA-256")
        require(0 < verified["nonwhitePixels"] < 612 * 792, "Blank or solid canvas")
        values = timing_evidence(trial)
        net = network_audit(trial["networkEvents"], render["pdfUrl"], (math.inf, math.inf), trial["id"])
        ids = {row["requestId"] for row in net["requests"]}
        require(all(event["requestId"] in ids for event in trial["networkEvents"]), "Unaccounted network event")
        ranges = sum(row["range"] is not None for row in net["requests"])
        require(trial["rangeEnabled"] or ranges == 0, "Range-disabled arm made a range request")
        initial = [row for row in net["requests"] if row["status"] == 200]
        require(len(initial) == 1 and initial[0]["reportedBodyBytes"] == document["bytes"], "Missing/mismatched full initial response")
        require(all(request["completed"] and not request["canceled"] and request["status"] < 400 for request in trial["serverRequests"]), "Failed or incomplete server response")
        result["pacing"] = pacing_audit(trial["serverRequests"], workload, trial["id"])
        equal(trial["pacing"]["totalBodyBytes"], result["pacing"]["totalBodyBytes"], "reported pacing bytes")
        timing = render["resourceTimingAtRender"]
        equal(timing["cutoffMs"], render["firstPageRenderedAtMs"], "ResourceTiming cutoff")
        require(timing["capturedAtMs"] >= timing["cutoffMs"], "ResourceTiming capture precedes marker")
        require(all(entry["name"] == render["pdfUrl"] and 0 < entry["responseEnd"] <= timing["cutoffMs"] for entry in timing["completedEntries"]), "ResourceTiming name or completion")
        completed = sum(number(entry["decodedBodySize"], "ResourceTiming body bytes") for entry in timing["completedEntries"])
        equal(timing["decodedBodyBytesForCompletedEntries"], completed, "ResourceTiming body sum")
        values.update(rangeRequestCount=ranges, cdpTotalBodyBytes=sum(row["reportedBodyBytes"] for row in net["requests"]), completedResourceTimingBytes=completed)
        result.update(metrics=values, transport=net)
        if trial["block"] == 1:
            sample = output / trial["sample"]
            require(sample.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n", "Missing/invalid retained PNG")
            result["sample"] = {"path": str(sample), "sha256": sha256(sample)}
    except (ValueError, TypeError, KeyError, StopIteration, OSError) as error:
        result.update(status="failed", reason=str(error))
    return result


def guard_evidence(session: dict, workload: dict) -> dict:
    stages = []
    for stage in ("before", "after"):
        record = next((item for item in session.get("controls", []) if item.get("stage") == stage), None)
        value = {"stage": stage, "validated": False, "reason": "not recorded"}
        stages.append(value)
        if record is None:
            continue
        try:
            known = record["knownControl"]
            ops = fixture_operations({**known, "mode": "unpaced"}, {})
            value["knownOperations"] = ops
            clocks = fixture_clocks(known.get("bursts"), known.get("firstStage", {}).get("markerMs"))
            value["knownClocks"] = clocks
            methods = {}
            for method in METHODS:
                clock = clocks[method]
                compare_clock(known["clockAnalysis"][method], clock, "known " + method)
                compare_clock(known["methods"][method]["clock"], clock, "known method " + method)
                classification = known_events(known, clock["boundary"])
                equal(known["methods"][method]["classification"]["status"], classification["status"], "known event classification")
                for transfer in ("first", "second"):
                    if transfer in classification and transfer in known["methods"][method]["classification"]:
                        equal(known["methods"][method]["classification"][transfer]["byRenderTime"], classification[transfer]["buckets"], "known event buckets")
                passed = known.get("operationStatus") == "passed" and clock["status"] == classification["status"] == "passed"
                equal(known["methods"][method]["status"], "passed" if passed else "failed", "known acceptance")
                methods[method] = {"passed": passed, "classification": classification}
            value["knownMethods"] = methods
            require(ops["status"] == "passed" and methods["candidate"]["passed"], "Known candidate control rejected")
            value["deliveryCalibration"] = calibration_audit(record["deliveryCalibration"], workload)
            require(record.get("status") == "passed", "Guard did not complete successfully")
            value.update(validated=True, reason=None)
        except (ValueError, TypeError, KeyError, StopIteration, OSError) as error:
            value["reason"] = str(error)
    return {"session": session["session"], "validated": all(stage["validated"] for stage in stages), "stages": stages}


def nested_differences(trial: dict, clocks: dict) -> dict:
    if trial["arm"] != "fifteen" or any(clocks[method]["boundary"] is None for method in METHODS):
        return {"available": False}
    result = {"available": True, "candidateMinusReferenceWidthMs": clocks["candidate"]["widthMs"] - clocks["reference"]["widthMs"],
              "renderClassChangedEvents": [], "verificationPhaseChangedRequests": []}
    for index, event in enumerate(trial.get("networkEvents", [])):
        render_classes, verify_classes = [], []
        for method in METHODS:
            clock = clocks[method]
            bounds = tuple(clock["boundary"][key] for key in ("lowerSeconds", "upperSeconds"))
            vb = tuple(clock["verificationBoundary"][key] for key in ("lowerSeconds", "upperSeconds"))
            render_classes.append(classify(event["timestampSeconds"], bounds))
            verify_classes.append(REQUEST_PHASE[classify(event["timestampSeconds"], vb)])
        if render_classes[0] != render_classes[1]:
            result["renderClassChangedEvents"].append({"eventIndex": index, "requestId": event["requestId"], "kind": event["kind"],
                                                       "reference": render_classes[0], "candidate": render_classes[1], "dataLength": event.get("dataLength")})
        if event["kind"] == "request" and verify_classes[0] != verify_classes[1]:
            result["verificationPhaseChangedRequests"].append({"eventIndex": index, "requestId": event["requestId"], "reference": verify_classes[0], "candidate": verify_classes[1]})
    return result


def describe(values: list[float]) -> dict | None:
    if not values:
        return None
    computed = statistics(values)
    return {"count": computed["count"], "minimum": computed["minMs"], "median": computed["medianMs"],
            "maximum": computed["maxMs"], "p25": computed["p25Ms"], "p75": computed["p75Ms"]}


def paired_rows(rows: list[dict]) -> list[dict]:
    result = []
    by_id = {row["id"]: row for row in rows}
    for first, second in zip(schedule()[::2], schedule()[1::2]):
        a, b = by_id[first["id"]], by_id[second["id"]]
        low, high = (a, b) if a["arm"] == "three" else (b, a)
        reasons = []
        for row in (low, high):
            if not row["attempted"]: reasons.append(row["arm"] + ": unattempted")
            elif not row["operationValidated"]: reasons.append(row["arm"] + ": operation/content invalid")
        if not low["sessionValidated"] or not high["sessionValidated"]:
            reasons.append("session pre/post guards not validated")
        pair = {key: first[key] for key in ("pairId", "session", "block", "position", "condition", "variant", "rangeEnabled")}
        pair.update(firstArm=first["arm"], threeId=low["id"], fifteenId=high["id"], comparable=not reasons,
                    exclusionReason="; ".join(reasons), threeClockPassed=low.get("referenceClockStatus") == "passed",
                    fifteenNestedClockPassed=high.get("referenceClockStatus") == "passed", fifteenCandidateClockPassed=high.get("candidateClockStatus") == "passed")
        if not reasons:
            for metric in METRICS:
                pair[metric + "Three"] = low[metric]
                pair[metric + "Fifteen"] = high[metric]
                pair[metric + "Difference"] = high[metric] - low[metric]
        result.append(pair)
    return result


def summarize_pairs(pairs: list[dict]) -> dict:
    comparable = [pair for pair in pairs if pair["comparable"]]
    return {"scheduledPairs": len(pairs), "comparablePairs": len(comparable), "excludedPairs": len(pairs) - len(comparable),
            "differenceDefinition": "actual fifteen-bracket arm minus actual three-bracket arm within the adjacent condition pair",
            "population": "Operation/content-valid and pre/post-session-guard-valid pairs, without clock-gate filtering. Descriptive observer perturbation only.",
            "metricUnits": {metric: "requests" if metric == "rangeRequestCount" else "bytes" if metric in ("cdpTotalBodyBytes", "completedResourceTimingBytes") else "milliseconds" for metric in METRICS},
            "pairedDifferences": {metric: describe([pair[metric + "Difference"] for pair in comparable]) for metric in METRICS}}


def summarize_trials(rows: list[dict]) -> dict:
    high = [row for row in rows if row["arm"] == "fifteen"]
    nested = dict.fromkeys(("bothPassed", "referenceOnly", "candidateOnly", "neither", "unavailable"), 0)
    for row in high:
        if row.get("referenceStatus") is None or row.get("candidateStatus") is None:
            nested["unavailable"] += 1
        elif row["referenceStatus"] == "passed":
            nested["bothPassed" if row["candidateStatus"] == "passed" else "referenceOnly"] += 1
        else:
            nested["candidateOnly" if row["candidateStatus"] == "passed" else "neither"] += 1
    return {"scheduledTrials": len(rows), "attemptedTrials": sum(row["attempted"] for row in rows),
            "operationallyValidated": sum(row["operationValidated"] for row in rows), "withinFifteenArm": nested,
            "methodCounts": {arm: {method: {reason: sum((row.get(method + "ClockReason") or row.get(method + "ClockStatus") or "unavailable") == reason for row in rows if row["arm"] == arm)
                                             for reason in ("passed", "width", "non-overlap", "invalid-input", "unavailable")} for method in METHODS if arm == "fifteen" or method == "reference"} for arm in ("three", "fifteen")},
            "widthsMs": {arm: {method: describe([row[method + "WidthMs"] for row in rows if row["arm"] == arm and row.get(method + "WidthMs") is not None])
                                for method in METHODS if arm == "fifteen" or method == "reference"} for arm in ("three", "fifteen")},
            "nestedRenderClassificationChanges": sum(row.get("nestedRenderClassChanges", 0) for row in high),
            "nestedVerificationPhaseChanges": sum(row.get("nestedVerificationPhaseChanges", 0) for row in high)}


def report_counts(trials: list[dict]) -> dict:
    return {"attempted": len(trials), "operationalPassed": sum(t.get("operationStatus") == "passed" for t in trials),
            "operationalFailed": sum(t.get("operationStatus") != "passed" for t in trials),
            "referencePassed": sum((t.get("methods", {}).get("reference") or {}).get("status") == "passed" for t in trials),
            "candidatePassed": sum((t.get("methods", {}).get("candidate") or {}).get("status") == "passed" for t in trials)}


def audit_report(path: Path) -> dict:
    report = json.loads(path.read_text()); config = json.loads((ROOT / "experiments/pdf-clock-observer.json").read_text())
    workload = json.loads((ROOT / config["workloadConfig"]).read_text())
    preservation = json.loads((ROOT / "experiments/pdf-clock-preservation-lock.json").read_text())
    baseline = json.loads((ROOT / "experiments/delivery-preservation-lock.json").read_text())
    issues = []
    def check(label, operation):
        try:
            operation()
        except (OSError, ValueError, TypeError, KeyError, StopIteration, IndexError) as error:
            issues.append(f"{label}: {error}")
    for key, expected in (("experiment", config), ("workload", workload), ("preservationLock", preservation), ("baselineLock", baseline)):
        check(key, lambda key=key, expected=expected: equal(report.get(key), expected, key))
    check("purpose", lambda: equal(report.get("purpose"), config["purpose"], "purpose"))
    check("campaign state", lambda: require(report.get("status") in ("complete", "incomplete"), "Campaign still running or unknown"))
    for field in ("sourceHashes", "artifactHashes"):
        for filename, expected in preservation[field].items():
            check(filename, lambda filename=filename, expected=expected: equal(sha256(ROOT / filename), expected, "preserved hash"))
    sources = report.get("sourceHashes") or {}
    expected_sources = ["experiments/pdf-clock-observer.json", "experiments/pdf-clock-preservation-lock.json", "docs/pdf-clock-observer.md",
                        "experiments/controlled-delivery.json", "experiments/delivery-preservation-lock.json", "experiments/first-page-local.json", "experiments/partial-loading-local.json",
                        "packages/runner/viewer/partial-loading.mjs", "packages/runner/viewer/index.html", "packages/runner/viewer/clock-observer.html", "packages/runner/viewer/clock-observer.mjs"]
    for name in ("pdf-clock-observer", "pdf-clock-protocol", "clock-observer-protocol", "delivery-calibration", "delivery-protocol", "paced-server", "partial-network", "protocol", "server"):
        expected_sources.extend((f"packages/runner/src/{name}.ts", f"packages/runner/dist/{name}.js"))
    check("source inventory", lambda: equal(sorted(sources), sorted(expected_sources), "executed sources"))
    for filename, expected in sources.items():
        for source in (ROOT / filename, path.parent / "source-snapshot" / filename):
            check(str(source), lambda source=source, expected=expected: equal(sha256(source), expected, "source/snapshot hash"))
    manifest_path = ROOT / "corpus/generated/pilot/manifest.json"; manifest = json.loads(manifest_path.read_text())
    check("manifest", lambda: equal(report.get("corpus"), {"manifest": manifest, "manifestSha256": sha256(manifest_path)}, "corpus"))
    check("original manifest", lambda: equal(sha256(manifest_path), baseline["manifestSha256"], "original manifest hash"))
    documents = {d["id"].removeprefix("text-100-"): d for d in manifest["documents"]}
    for document in documents.values():
        filename = manifest_path.parent / document["file"]
        check(str(filename), lambda filename=filename, document=document: require(sha256(filename) == document["sha256"] and filename.stat().st_size == document["bytes"], "PDF bytes changed"))
    environment = report.get("environment", {})
    for field, key in (("node", "expectedNodeVersion"), ("pdfjs", "expectedPdfjsVersion"), ("playwright", "expectedPlaywrightVersion"), ("chromium", "expectedChromiumVersion")):
        if field in environment or report.get("status") == "complete":
            check(field, lambda field=field, key=key: equal(environment.get(field), config[key], "runtime version"))
    expected = schedule(); sessions = report.get("sessions", []); trials = [trial for session in sessions for trial in session.get("trials", [])]
    check("schedule", lambda: equal(report.get("schedule"), expected, "fixed schedule"))
    check("attempted order", lambda: equal([{key: trial.get(key) for key in expected[0]} for trial in trials], expected[:len(trials)], "schedule prefix"))
    check("unattempted trials", lambda: equal(report.get("unattemptedTrials"), expected[len(trials):], "unattempted schedule"))
    unattempted_controls = [{"session": session, "stage": stage} for session in range(1, 4) for stage in ("before", "after")
                            if not any(s["session"] == session and any(c["stage"] == stage for c in s.get("controls", [])) for s in sessions)]
    check("unattempted controls", lambda: equal(report.get("unattemptedControls"), unattempted_controls, "unattempted controls"))
    check("session order", lambda: equal([session["session"] for session in sessions], list(range(1, len(sessions) + 1)), "session sequence"))
    guards = {session["session"]: guard_evidence(session, workload) for session in sessions}
    for session in sessions:
        check("session membership", lambda session=session: require(all(t["session"] == session["session"] for t in session.get("trials", [])), "Wrong trial session"))
        if session.get("chromium"):
            check("session Chromium", lambda session=session: equal(session["chromium"], config["expectedChromiumVersion"], "Chromium"))
        if session.get("guardsPassed") or session.get("status") == "complete":
            check("session guards", lambda session=session: require(guards[session["session"]]["validated"], "Recorded successful guards failed independent audit"))
    if report.get("status") == "complete":
        check("completion", lambda: require(len(trials) == 96 and len(sessions) == 3 and all(s["status"] == "complete" for s in sessions), "Incomplete collection marked complete"))
        check("preservation outcome", lambda: require(report.get("preservedFilesUnchanged") and report.get("integrationSourcesUnchanged"), "Final preservation not recorded"))
    by_id = {trial["id"]: trial for trial in trials}; rows, evidence = [], []
    for entry in expected:
        trial = by_id.get(entry["id"]); validated = guards.get(entry["session"], {}).get("validated", False)
        row = {**entry, "attempted": trial is not None, "sessionValidated": validated, "operationValidated": False,
               "operationStatus": trial.get("operationStatus", "incomplete") if trial else "unattempted"}; rows.append(row)
        if trial is None: continue
        label = trial["id"]
        clocks = clock_analysis(trial)
        ops = operation_evidence(trial, workload, documents[trial["variant"]], baseline["pixelSha256"], path.parent)
        row["operationValidated"] = trial.get("operationStatus") == "passed" and ops["status"] == "passed"
        row["operationEvidenceReason"] = ops["reason"]
        if trial.get("operationStatus") == "passed":
            check(label + " operations", lambda ops=ops: require(ops["status"] == "passed", ops["reason"]))
        if ops.get("metrics"):
            row.update({key: value for key, value in ops["metrics"].items() if isinstance(value, (int, float))})
        detail = {"id": label, "operations": ops, "clockAnalysis": clocks, "methods": {}, "recordedError": trial.get("error")}; evidence.append(detail)
        analysis = trial.get("clockAnalysis")
        if analysis:
            check(label + " raw clocks", lambda trial=trial, analysis=analysis: equal(analysis["rawInput"], {"bursts": trial["bursts"], "markerMs": trial.get("render", {}).get("firstPageRenderedAtMs"),
                  "verificationMs": trial.get("verification", {}).get("verificationStartedAtMs"), "bracketsPerPoint": trial["bracketsPerPoint"]}, "raw clock input"))
            check(label + " clock constants", lambda analysis=analysis: equal([analysis["resolutionMarginMs"], analysis["maximumBoundaryWidthMs"]], [1, 5], "clock margins/gate"))
        for method in METHODS:
            clock = clocks[method]; recorded = trial.get("methods", {}).get(method)
            if clock is None:
                check(label + " low candidate", lambda recorded=recorded: equal(recorded, None, "uncollected candidate")); continue
            row.update({method + "ClockStatus": clock["status"], method + "ClockReason": clock["reason"], method + "WidthMs": clock["widthMs"]})
            if recorded is None:
                row[method + "Status"] = None
                check(label + " missing method", lambda trial=trial: require(trial.get("operationStatus") != "passed", "Valid workload lacks method analysis")); continue
            expected_status = "passed" if trial.get("operationStatus") == "passed" and clock["status"] == "passed" and not recorded.get("networkError") else "failed"
            row[method + "Status"] = expected_status
            check(label + "/" + method, lambda recorded=recorded, clock=clock: compare_pdf_clock(recorded["clock"], clock, label))
            check(label + "/" + method + " raw analysis", lambda analysis=analysis, method=method, clock=clock: compare_pdf_clock(analysis[method], clock, label))
            check(label + "/" + method + " acceptance", lambda recorded=recorded, expected_status=expected_status: equal(recorded["status"], expected_status, "method status"))
            try:
                net = reconstruct_network(trial, clock); detail["methods"][method] = {"status": expected_status, "network": net}
                compare_network(recorded["network"], net, label + "/" + method)
                if net:
                    for phase in PHASES: row[method + "/" + phase + "/bodyBytes"] = net["buckets"][phase]["reportedDataBytes"]
                    for phase in REQUEST_PHASE.values(): row[method + "/" + phase + "/requestStarts"] = net["byRequestPhase"][phase]["requestCount"]
            except (ValueError, TypeError, KeyError, StopIteration) as error:
                detail["methods"][method] = {"status": expected_status, "networkEvidence": "incomplete", "reason": str(error)}
                if row["operationValidated"]: issues.append(f"{label}/{method}: {error}")
        detail["nestedDifferences"] = nested_differences(trial, clocks)
        if detail["nestedDifferences"]["available"]:
            row.update(nestedWidthDifferenceMs=detail["nestedDifferences"]["candidateMinusReferenceWidthMs"],
                       nestedRenderClassChanges=len(detail["nestedDifferences"]["renderClassChangedEvents"]), nestedVerificationPhaseChanges=len(detail["nestedDifferences"]["verificationPhaseChangedRequests"]))
    for key, value in report_counts(trials).items(): check("reported " + key, lambda key=key, value=value: equal(report.get("summary", {}).get(key), value, "reported outcome count"))
    check("reported arm counts", lambda: equal(report.get("summary", {}).get("byArm"), {arm: report_counts([t for t in trials if t["arm"] == arm]) for arm in ("three", "fifteen")}, "arm counts"))
    check("reported session counts", lambda: equal(report.get("summary", {}).get("bySession"), [{"session": s["session"], **report_counts(s.get("trials", []))} for s in sessions], "session counts"))
    pairs = paired_rows(rows)
    return {"schemaVersion": 1, "purpose": "independent-pdf-observer-integration-audit-not-performance-replication", "auditStatus": "passed" if not issues else "failed", "integrityIssues": issues,
            "campaignStatus": report.get("status"), "reportPath": str(path), "reportSha256": sha256(path), "auditScriptSha256": sha256(Path(__file__)),
            "reusedAuditHashes": {name: sha256(Path(__file__).with_name(name)) for name in ("summarize_controlled_delivery.py", "audit_clock_observer.py")},
            "experiment": config, "workload": workload, "environment": environment, "sourceHashes": sources,
            "preservation": {"sourceFiles": len(preservation["sourceHashes"]), "artifactFiles": len(preservation["artifactHashes"]), "executedSourceSnapshots": len(sources), "manifestSha256": sha256(manifest_path)},
            "guards": list(guards.values()), "overall": summarize_trials(rows), "perturbation": summarize_pairs(pairs),
            "byArmOrder": {arm: summarize_pairs([pair for pair in pairs if pair["firstArm"] == arm]) for arm in ("three", "fifteen")},
            "bySession": [{"session": session, **summarize_trials([row for row in rows if row["session"] == session]), "perturbation": summarize_pairs([pair for pair in pairs if pair["session"] == session])} for session in range(1, 4)],
            "bySessionAndCondition": [{"session": session, "condition": condition, **summarize_trials([row for row in rows if row["session"] == session and row["condition"] == condition]), "perturbation": summarize_pairs([pair for pair in pairs if pair["session"] == session and pair["condition"] == condition])} for session in range(1, 4) for condition, _, _ in CONDITIONS.values()],
            "collectedPdfBrackets": sum(len(burst.get("samples", [])) for trial in trials for burst in trial.get("bursts", [])),
            "trials": rows, "pairs": pairs, "trialEvidence": evidence,
            "limits": ["No historical trials are pooled, rehabilitated, or promoted to accepted performance replication.",
                       "Perturbation metrics are descriptive high-minus-low adjacent-arm pairs; clock failures do not select the timing population.",
                       "Nested first-three and all-fifteen methods share a high-arm execution and its extra sampling delay.",
                       "Narrower intervals do not establish accuracy; stable additive offset and two 1 ms margins remain assumptions.",
                       "CDP totals include repeated/overlapping ranges and do not establish exact physical arrival or unique PDF coverage.",
                       "Same-machine sessions and deterministic adjacent order are not independent environments or an equivalence/non-inferiority test.",
                       "Browser PDF/RGBA hashes and preserved source establish recorded identity; retained PNGs are hashed, not independently decoded to pixels here."]}


def csv_text(rows: list[dict]) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=list(dict.fromkeys(key for row in rows for key in row)), lineterminator="\n")
    writer.writeheader(); writer.writerows(rows)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True); parser.add_argument("--output-prefix", type=Path, required=True)
    args = parser.parse_args(); prefix = args.output_prefix.resolve()
    paths = {suffix: Path(str(prefix) + suffix) for suffix in (".csv", ".pairs.csv", ".json")}
    try:
        require(not any(path.exists() for path in paths.values()), "Output exists; choose a new prefix")
        result = audit_report(args.report.resolve()); prefix.parent.mkdir(parents=True, exist_ok=True)
        for suffix, rows in ((".csv", result["trials"]), (".pairs.csv", result["pairs"])):
            with paths[suffix].open("x", encoding="utf-8", newline="") as stream: stream.write(csv_text(rows))
        result["exports"] = {suffix: {"path": str(paths[suffix]), "sha256": sha256(paths[suffix])} for suffix in (".csv", ".pairs.csv")}
        with paths[".json"].open("x", encoding="utf-8") as stream: stream.write(json.dumps(result, indent=2) + "\n")
        print(f"{result['auditStatus'].upper()}: {result['overall']['attemptedTrials']}/96 attempted; {result['perturbation']['comparablePairs']}/48 comparable diagnostic pairs.")
        return 0 if result["auditStatus"] == "passed" else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"FAIL: {error}", file=sys.stderr); return 1


if __name__ == "__main__":
    sys.exit(main())

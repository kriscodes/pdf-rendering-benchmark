"""Independently audit a complete controlled-delivery report and export its data.

Uses only the Python standard library. No benchmark process is launched. CSV and
analysis JSON are written only after every check passes; warmups remain in both.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
CONDITIONS = {
    "A": ("nonlinearized-range-enabled", "nonlinearized", True),
    "B": ("linearized-range-enabled", "linearized", True),
    "C": ("nonlinearized-range-disabled", "nonlinearized", False),
    "D": ("linearized-range-disabled", "linearized", False),
}
ROWS = ("ABDC", "BCAD", "CDBA", "DACB")
EPS = 1e-6


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def number(value: object, label: str, *, nonnegative: bool = True) -> float:
    require(type(value) in (int, float) and math.isfinite(value), f"{label}: not finite")
    require(not nonnegative or value >= 0, f"{label}: negative")
    return value


def equal(actual: object, expected: object, label: str) -> None:
    if type(actual) in (int, float) and type(expected) in (int, float):
        require(math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-8), f"{label}: {actual} != {expected}")
    elif isinstance(expected, dict):
        require(isinstance(actual, dict) and set(actual) == set(expected), f"{label}: keys differ")
        for key in expected:
            equal(actual[key], expected[key], f"{label}.{key}")
    elif isinstance(expected, list):
        require(isinstance(actual, list) and len(actual) == len(expected), f"{label}: lengths differ")
        for index, (left, right) in enumerate(zip(actual, expected)):
            equal(left, right, f"{label}[{index}]")
    else:
        require(actual == expected, f"{label}: {actual!r} != {expected!r}")


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def quantile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    index = (len(ordered) - 1) * q
    low, high = math.floor(index), math.ceil(index)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def statistics(values: list[float]) -> dict:
    require(bool(values), "Cannot summarize empty values")
    for value in values:
        number(value, "statistic input", nonnegative=False)
    return {
        "count": len(values), "medianMs": quantile(values, .5),
        "minMs": min(values), "maxMs": max(values),
        "p25Ms": quantile(values, .25), "p75Ms": quantile(values, .75),
    }


def expected_schedule() -> list[dict]:
    result = []
    for phase, count in (("warmup", 4), ("measured", 12)):
        for block in range(1, count + 1):
            for position, code in enumerate(ROWS[(block - 1) % 4], 1):
                condition, variant, range_enabled = CONDITIONS[code]
                result.append({
                    "id": f"{phase}-{block}-{condition}", "phase": phase,
                    "block": block, "position": position, "condition": condition,
                    "variant": variant, "rangeEnabled": range_enabled,
                })
    return result


def summarize(trials: list[dict]) -> dict:
    measured = [trial for trial in trials if trial["phase"] == "measured"]
    blocks = [{
        code: next(trial["render"]["firstPageRenderMs"] for trial in measured
                   if trial["block"] == block and trial["condition"] == metadata[0])
        for code, metadata in CONDITIONS.items()
    } for block in range(1, 13)]

    def contrast(definition, operation):
        values = [{"block": index + 1, "differenceMs": operation(block)} for index, block in enumerate(blocks)]
        return {"definition": definition, **statistics([entry["differenceMs"] for entry in values]), "blocks": values}

    return {
        "interpretation": "Descriptive statistics only; no inferential significance claim.",
        "quantileMethod": "linear interpolation at (n - 1) * q",
        "measuredBlocks": 12, "excludedWarmupBlocks": 4,
        "byCondition": {metadata[0]: statistics([
            trial["render"]["firstPageRenderMs"] for trial in measured if trial["condition"] == metadata[0]
        ]) for metadata in CONDITIONS.values()},
        "pairedStructureEffect": {
            "rangeEnabled": contrast("linearized minus nonlinearized, range enabled", lambda b: b["B"] - b["A"]),
            "rangeDisabled": contrast("linearized minus nonlinearized, range disabled", lambda b: b["D"] - b["C"]),
        },
        "pairedRangeEffect": {
            "nonlinearized": contrast("range enabled minus range disabled, nonlinearized", lambda b: b["A"] - b["C"]),
            "linearized": contrast("range enabled minus range disabled, linearized", lambda b: b["B"] - b["D"]),
        },
        "differenceOfStructureEffects": contrast(
            "(linearized minus nonlinearized) with range enabled minus (linearized minus nonlinearized) with range disabled",
            lambda b: (b["B"] - b["A"]) - (b["D"] - b["C"]),
        ),
    }


def clock_bounds(record: dict, page_ms: float, experiment: dict, label: str) -> tuple[float, float]:
    samples = record["clockSamples"]
    require(len(samples) >= 2, f"{label}: insufficient clock calibration")
    margin = experiment["observation"]["clockResolutionMarginMs"] / 1000
    for sample in samples:
        for key in ("beforeSeconds", "pageNowMs", "afterSeconds"):
            number(sample[key], f"{label}.{key}")
        require(sample["beforeSeconds"] <= sample["afterSeconds"], f"{label}: reversed calibration")
    lower = max(s["beforeSeconds"] - s["pageNowMs"] / 1000 - margin for s in samples)
    upper = min(s["afterSeconds"] - s["pageNowMs"] / 1000 + margin for s in samples)
    require(lower <= upper, f"{label}: clock offset intervals do not overlap")
    clock = record["clock"]
    equal(clock["offset"]["lowerSeconds"], lower, f"{label}: lower offset")
    equal(clock["offset"]["upperSeconds"], upper, f"{label}: upper offset")
    bounds = (page_ms / 1000 + lower - margin, page_ms / 1000 + upper + margin)
    equal(clock["boundary"]["lowerSeconds"], bounds[0], f"{label}: render lower")
    equal(clock["boundary"]["upperSeconds"], bounds[1], f"{label}: render upper")
    width = (bounds[1] - bounds[0]) * 1000
    equal(clock["widthMs"], width, f"{label}: clock width")
    require(width <= experiment["observation"]["maximumBoundaryWidthMs"] + EPS, f"{label}: clock too imprecise")
    for interval in (clock["offset"], clock["boundary"]):
        equal(interval["clockResolutionMarginMs"], margin * 1000, f"{label}: explicit clock margin")
        require("not a proven universal" in interval["assumption"], f"{label}: missing clock assumption")
    if "verification" in record:
        verified = record["verification"]
        start = verified["verificationStartedAtMs"]
        require(start >= page_ms, f"{label}: verification precedes render")
        boundary = clock["verificationBoundary"]
        equal(boundary["lowerSeconds"], start / 1000 + lower - margin, f"{label}: verification lower")
        equal(boundary["upperSeconds"], start / 1000 + upper + margin, f"{label}: verification upper")
    return bounds


def classify(timestamp: float, bounds: tuple[float, float]) -> str:
    return "at-or-before" if timestamp <= bounds[0] else "after" if timestamp > bounds[1] else "uncertain"


def header(headers: dict, name: str) -> str | None:
    found = [str(value).strip() for key, value in headers.items() if key.lower() == name.lower()]
    require(len(set(found)) <= 1, f"Conflicting {name} headers")
    return found[0] if found else None


def network_audit(events: list[dict], url: str, bounds: tuple[float, float], label: str) -> dict:
    requests = [event for event in events if event["kind"] == "request" and event["url"] == url]
    require(bool(requests), f"{label}: no matching network requests")
    require(len({event["requestId"] for event in requests}) == len(requests), f"{label}: duplicate request identity")
    fields = ("requestStarts", "responseHeaders", "dataEvents", "reportedDataBytes", "reportedEncodedDataBytes",
              "loadingFinished", "loadingFailed", "finishedEncodedDataLength")
    buckets = {phase: dict.fromkeys(fields, 0) for phase in ("at-or-before", "uncertain", "after")}
    rows = []
    for request in requests:
        ledger = [event for event in events if event["requestId"] == request["requestId"]]
        responses = [event for event in ledger if event["kind"] == "response"]
        finishes = [event for event in ledger if event["kind"] == "finished"]
        require(len(responses) == len(finishes) == 1 and not any(e["kind"] == "failed" for e in ledger), f"{label}: incomplete/failed HTTP response")
        response, finish = responses[0], finishes[0]
        require(response["status"] in (200, 206), f"{label}: unexpected HTTP status")
        require((header(response["headers"], "content-encoding") or "identity") == "identity", f"{label}: compression changed")
        body_size = int(header(response["headers"], "content-length"))
        data_size = sum(event["dataLength"] for event in ledger if event["kind"] == "data")
        equal(data_size, body_size, f"{label}: CDP completed response body size")
        requested_range = header(request["headers"], "range")
        observed_range = False
        if response["status"] == 206:
            sent = re.fullmatch(r"bytes=(\d+)-(\d*)", requested_range or "")
            received = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", header(response["headers"], "content-range") or "")
            require(request["method"] == "GET" and sent is not None and received is not None, f"{label}: invalid range evidence")
            first, last, total = map(int, received.groups())
            expected_last = min(int(sent[2]), total - 1) if sent[2] else total - 1
            require(0 <= first <= last < total and first == int(sent[1]) and last == expected_last, f"{label}: mismatched Content-Range")
            equal(body_size, last - first + 1, f"{label}: range body length")
            observed_range = True
        for event in ledger:
            number(event["timestampSeconds"], f"{label}: CDP timestamp")
            bucket = buckets[classify(event["timestampSeconds"], bounds)]
            kind = event["kind"]
            if kind == "request": bucket["requestStarts"] += 1
            elif kind == "response": bucket["responseHeaders"] += 1
            elif kind == "data":
                for key in ("dataLength", "encodedDataLength"):
                    value = number(event[key], f"{label}: {key}")
                    require(isinstance(value, int) and value <= 2**53 - 1, f"{label}: invalid byte count")
                bucket["dataEvents"] += 1
                bucket["reportedDataBytes"] += event["dataLength"]
                bucket["reportedEncodedDataBytes"] += event["encodedDataLength"]
            elif kind == "finished":
                bucket["loadingFinished"] += 1
                bucket["finishedEncodedDataLength"] += event["encodedDataLength"]
            else: raise ValueError(f"{label}: failed or unknown network event {kind}")
        rows.append({"requestId": request["requestId"], "start": request["timestampSeconds"],
                     "status": response["status"], "range": requested_range, "observedRange": observed_range,
                     "reportedBodyBytes": data_size, "finishClass": classify(finish["timestampSeconds"], bounds)})
    return {"buckets": buckets, "requests": rows}


def pacing_audit(requests: list[dict], experiment: dict, label: str) -> dict:
    profile, limits = experiment["delivery"], experiment["calibration"]
    paced = [request for request in requests if request["paced"]]
    require(bool(paced), f"{label}: no paced records")
    all_writes, header_delays, lateness = [], [], []
    for request in paced:
        require(request["completed"] and not request["canceled"] and request["canceledAtMs"] is None, f"{label}: unfinished server response")
        equal(request["headersScheduledForMs"] - request["requestAtMs"], profile["responseHeaderDelayMs"], f"{label}: scheduled header delay")
        delay = request["headersAtMs"] - request["requestAtMs"]
        require(limits["headerMinimumMs"] - EPS <= delay <= limits["headerMaximumMs"] + EPS, f"{label}: observed header delay {delay}")
        header_delays.append(delay)
        equal(request["bodyBytesWritten"], request["bodyBytesPlanned"], f"{label}: server body completeness")
        cumulative, previous = 0, request["headersAtMs"]
        for write in request["writes"]:
            size = write["bytes"]
            require(type(size) is int and 0 < size <= profile["maxQuantumBytes"], f"{label}: quantum size")
            start, due, actual = (number(write[key], f"{label}: {key}") for key in ("serializationStartedAtMs", "scheduledForMs", "writtenAtMs"))
            require(start >= previous - EPS, f"{label}: within-response serialization overlap")
            equal(due - start, size / profile["bytesPerSecond"] * 1000, f"{label}: charged serialization budget")
            lag = actual - due
            require(-limits["minimumDurationToleranceMs"] - EPS <= lag <= limits["maximumWriteLatenessMs"] + EPS, f"{label}: write lateness {lag}")
            require(actual >= start - EPS, f"{label}: release before serialization")
            cumulative += size
            equal(write["cumulativeBytes"], cumulative, f"{label}: cumulative writes")
            previous = actual
            lateness.append(lag)
            all_writes.append(write)
        equal(cumulative, request["bodyBytesPlanned"], f"{label}: ledger body accounting")
        if cumulative:
            equal(request["bodyStartedAtMs"], request["writes"][0]["writtenAtMs"], f"{label}: first body release")
        require(request["completedAtMs"] >= request["endAtMs"] - EPS and request["endAtMs"] >= previous - EPS, f"{label}: completion ordering")
    ordered = sorted(all_writes, key=lambda write: write["writtenAtMs"])
    require(all(b["serializationStartedAtMs"] >= a["writtenAtMs"] - EPS for a, b in zip(ordered, ordered[1:])), f"{label}: aggregate serialization overlap")
    return {"passed": True, "requestCount": len(paced), "totalBodyBytes": sum(r["bodyBytesWritten"] for r in paced),
            "writeCount": len(all_writes), "headerMinimumMs": min(header_delays), "headerMaximumMs": max(header_delays),
            "maximumWriteLatenessMs": max(0, *lateness)}


def calibration_audit(record: dict, experiment: dict) -> dict:
    label = f"{record['stage']} calibration"
    require(record["status"] == "passed" and record["errors"] == [], f"{label}: failed")
    equal([group["kind"] for group in record["groups"]], ["single", "concurrent", "unshaped"], f"{label}: groups")
    summaries = []
    for group in record["groups"]:
        kind = group["kind"]
        require(group["status"] == "passed", f"{label}/{kind}: failed")
        clients, servers = group["browser"], group["serverRequests"]
        require(len(clients) == len(servers) == (2 if kind == "concurrent" else 1), f"{label}/{kind}: response count")
        for client, server in zip(clients, servers):
            target = urlsplit(client["url"])
            require(server["url"] == target.path + "?" + target.query, f"{label}: client/server identity")
            require(client["status"] == server["status"] == 206 and client["bytes"] == server["bodyBytesPlanned"] == 65536, f"{label}: response content metadata")
            require(server["completed"] and not server["canceled"], f"{label}: server completion")
            require(client["startAtMs"] <= client["headersAtMs"] <= client["finishedAtMs"], f"{label}: browser timing order")
            net = network_audit(record["networkEvents"], client["url"], (math.inf, math.inf), f"{label}/{kind}")
            require(len(net["requests"]) == 1 and net["requests"][0]["observedRange"], f"{label}: CDP range proof")
            equal(net["buckets"]["at-or-before"]["reportedDataBytes"], 65536, f"{label}: CDP body")
        if kind == "unshaped":
            require(all(not request["paced"] for request in servers), f"{label}: control was shaped")
            duration = clients[0]["finishedAtMs"] - clients[0]["startAtMs"]
            require(duration < experiment["calibration"]["unpacedMaximumMs"], f"{label}: unshaped control too slow")
            equal(group["durationMs"], duration, f"{label}: unshaped duration")
            summaries.append({"kind": kind, "passed": True, "durationMs": duration})
            continue
        pacing = pacing_audit(servers, experiment, f"{label}/{kind}")
        body_bytes = sum(client["bytes"] for client in clients)
        nominal = body_bytes / experiment["delivery"]["bytesPerSecond"] * 1000
        minimum = nominal - experiment["calibration"]["minimumDurationToleranceMs"]
        maximum = nominal * experiment["calibration"]["bodyMaximumSlowdown"] + experiment["calibration"]["bodySlackMs"]
        server_ms = max(server["endAtMs"] for server in servers) - min(server["headersAtMs"] for server in servers)
        browser_ms = max(client["finishedAtMs"] for client in clients) - min(client["headersAtMs"] for client in clients)
        tolerance = experiment["calibration"]["clientServerToleranceMs"]
        require(minimum - EPS <= server_ms <= maximum + EPS and minimum - EPS <= browser_ms <= maximum + EPS, f"{label}/{kind}: aggregate duration out of bounds")
        require(abs(server_ms - browser_ms) <= tolerance + EPS, f"{label}/{kind}: aggregate client/server duration disagreement")
        for client, server in zip(clients, servers):
            require(abs((client["finishedAtMs"] - client["headersAtMs"]) - (server["endAtMs"] - server["headersAtMs"])) <= tolerance + EPS, f"{label}/{kind}: per-response duration disagreement")
        if kind == "concurrent":
            require(min(s["endAtMs"] for s in servers) > max(s["headersAtMs"] for s in servers), f"{label}: server transfers did not overlap")
            require(min(c["finishedAtMs"] for c in clients) > max(c["headersAtMs"] for c in clients), f"{label}: browser transfers did not overlap")
        for key, computed in (("totalBodyBytes", body_bytes), ("nominalBodyMs", nominal), ("minimumBodyMs", minimum),
                              ("maximumBodyMs", maximum), ("serverBodyMs", server_ms), ("browserBodyMs", browser_ms)):
            equal(group["audit"][key], computed, f"{label}/{kind}: exported {key}")
        summaries.append({"kind": kind, "passed": True, "bodyBytes": body_bytes, "nominalBodyMs": nominal,
                          "serverBodyMs": server_ms, "browserBodyMs": browser_ms, "pacing": pacing})
    return {"stage": record["stage"], "passed": True, "groups": summaries}


def audit_report(report_path: Path) -> dict:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    require(report["status"] == "passed" and report["purpose"] == "controlled-delivery-factorial-pilot", "Only a complete passed factorial report can be exported")
    require(report["baselineAndCorpusUnchanged"] and report["experimentSourcesUnchanged"], "Run did not preserve inputs")
    experiment = report["experiment"]
    equal(experiment, json.loads((ROOT / "experiments/controlled-delivery.json").read_text()), "declared experiment configuration")
    equal(report["baselineLock"], json.loads((ROOT / "experiments/delivery-preservation-lock.json").read_text()), "preservation lock")
    require(experiment["warmupBlocks"] == 4 and experiment["measuredBlocks"] == 12, "Unexpected experiment block counts")
    equal(experiment["delivery"], {"responseHeaderDelayMs": 100, "bytesPerSecond": 125000, "maxQuantumBytes": 2048}, "delivery profile")
    require(experiment["pdfjs"]["rangeChunkSize"] == 16384, "Chunk size changed")
    schedule = expected_schedule()
    equal(report["schedule"], schedule, "recorded schedule")
    require(len(report["trials"]) == 64, "Missing or extra trials")
    baseline_checks, source_checks = [], []
    for filename, expected in report["baselineLock"]["sourceHashes"].items():
        require(sha256(ROOT / filename) == expected, f"Preserved source changed: {filename}")
        baseline_checks.append(filename)
    for filename, expected in report["sourceHashes"].items():
        require(sha256(ROOT / filename) == expected, f"Experiment source changed: {filename}")
        require(sha256(report_path.parent / "source-snapshot" / filename) == expected, f"Executed-source snapshot differs: {filename}")
        source_checks.append(filename)
    manifest_path = ROOT / "corpus/generated/pilot/manifest.json"
    require(sha256(manifest_path) == report["baselineLock"]["manifestSha256"] == report["corpus"]["manifestSha256"], "Manifest identity changed")
    manifest = json.loads(manifest_path.read_text())
    equal(manifest, report["corpus"]["manifest"], "manifest")
    documents = {document["id"].removeprefix("text-100-"): document for document in manifest["documents"]}
    for document in documents.values():
        path = manifest_path.parent / document["file"]
        require(path.stat().st_size == document["bytes"] and sha256(path) == document["sha256"], f"PDF identity changed: {path.name}")
    probe = report["observerProbe"]
    require(probe["status"] == "passed" and probe["errors"] == [], "Observer probe failed")
    probe_bounds = clock_bounds(probe, probe["result"]["markerMs"], experiment, "observer probe")
    for name, phase in (("first", "at-or-before"), ("second", "after")):
        result = network_audit(probe["networkEvents"], probe["result"][name]["url"], probe_bounds, f"probe {name}")
        require(len(result["requests"]) == 1 and result["requests"][0]["observedRange"], "Observer range evidence missing")
        equal(result["buckets"], probe[name]["byRenderTime"], f"probe {name} buckets")
        equal(result["buckets"][phase]["reportedDataBytes"], 4096, f"probe {name} byte accounting")
        require(probe["result"][name]["bytes"] == 4096 and result["buckets"]["uncertain"]["reportedDataBytes"] == 0, "Observer probe ambiguous or incorrect")
    equal([stage["stage"] for stage in report["deliveryCalibrations"]], ["before", "after"], "delivery calibration stages")
    calibrations = [calibration_audit(record, experiment) for record in report["deliveryCalibrations"]]
    trial_rows = []
    for expected, trial in zip(schedule, report["trials"]):
        label = trial["id"]
        equal({key: trial[key] for key in expected}, expected, label)
        require(trial["status"] == "passed" and trial["errors"] == [], f"{label}: failed or browser diagnostics")
        require(trial["workers"] == [report["origin"] + "/pdfjs/build/pdf.worker.mjs"], f"{label}: expected one real worker")
        render, verification = trial["render"], trial["verification"]
        document = documents[trial["variant"]]
        for field in ("firstPageRenderMs", "documentLoadedMs", "pageLoadedMs", "canvasRenderMs"):
            require(number(render[field], f"{label}.{field}") > 0, f"{label}: zero timing")
        require(render["documentLoadedMs"] <= render["pageLoadedMs"] <= render["firstPageRenderMs"], f"{label}: milestones out of order")
        require((render["numPages"], render["width"], render["height"], render["devicePixelRatio"]) == (100, 612, 792, 1), f"{label}: dimensions changed")
        require(render["timeOriginMs"] == verification["timeOriginMs"], f"{label}: page clock changed")
        require(verification["downloadedBytes"] == document["bytes"] and verification["downloadedSha256"] == document["sha256"], f"{label}: browser PDF identity")
        require(verification["rgbaSha256"] == report["baselineLock"]["pixelSha256"] and 0 < verification["nonwhitePixels"] < 612 * 792, f"{label}: pixels changed/blank")
        bounds = clock_bounds(trial, render["firstPageRenderedAtMs"], experiment, label)
        samples = trial["clockSamples"]
        require(len(samples) == 3 and samples[0]["pageNowMs"] <= render["startedAtMs"]
                and render["firstPageRenderedAtMs"] <= samples[1]["pageNowMs"] <= verification["verificationStartedAtMs"]
                and samples[2]["pageNowMs"] >= verification["verificationFinishedAtMs"], f"{label}: clock calibration phases")
        net = network_audit(trial["networkEvents"], render["pdfUrl"], bounds, label)
        equal(net["buckets"], trial["network"]["byRenderTime"], f"{label}: network accounting")
        equal(trial["network"]["requestCount"], len(net["requests"]), f"{label}: network request count")
        equal(trial["network"]["reportedDataAtRender"], {
            "atOrBeforeBytes": net["buckets"]["at-or-before"]["reportedDataBytes"],
            "uncertainBytes": net["buckets"]["uncertain"]["reportedDataBytes"],
            "atOrBeforePlusUncertainBytes": net["buckets"]["at-or-before"]["reportedDataBytes"] + net["buckets"]["uncertain"]["reportedDataBytes"],
        }, f"{label}: CDP reported bytes at render")
        ranges = sum(request["range"] is not None for request in net["requests"])
        partials = sum(request["observedRange"] for request in net["requests"])
        equal(trial["network"]["range"], {"requestCount": ranges, "observed206Count": partials}, f"{label}: range counts")
        require(trial["rangeEnabled"] or ranges == 0, f"{label}: range-disabled arm requested ranges")
        vb = trial["clock"]["verificationBoundary"]
        phases = {"measurement": 0, "verificationUncertain": 0, "verification": 0}
        for request in net["requests"]:
            when = classify(request["start"], (vb["lowerSeconds"], vb["upperSeconds"]))
            phases[{"at-or-before": "measurement", "uncertain": "verificationUncertain", "after": "verification"}[when]] += 1
        for phase, count in phases.items():
            equal(trial["network"]["byRequestPhase"][phase]["requestCount"], count, f"{label}: request phase {phase}")
        timing = render["resourceTimingAtRender"]
        equal(timing["cutoffMs"], render["firstPageRenderedAtMs"], f"{label}: resource cutoff")
        require(timing["capturedAtMs"] >= timing["cutoffMs"], f"{label}: resource snapshot precedes render")
        require(all(entry["name"] == render["pdfUrl"] and 0 < entry["responseEnd"] <= timing["cutoffMs"] for entry in timing["completedEntries"]), f"{label}: ResourceTiming completion/name")
        completed_body = sum(entry["decodedBodySize"] for entry in timing["completedEntries"])
        equal(timing["decodedBodyBytesForCompletedEntries"], completed_body, f"{label}: ResourceTiming body sum")
        require(all(request["completed"] and not request["canceled"] and request["status"] < 400 for request in trial["serverRequests"]), f"{label}: server response failed")
        pacing = pacing_audit(trial["serverRequests"], experiment, label)
        equal(trial["pacing"]["totalBodyBytes"], pacing["totalBodyBytes"], f"{label}: pacing body count")
        initial = [request for request in net["requests"] if request["status"] == 200]
        require(len(initial) == 1 and initial[0]["reportedBodyBytes"] == document["bytes"], f"{label}: initial full response identity")
        trial_rows.append({
            **expected, "isWarmup": trial["phase"] == "warmup", "includedInSummary": trial["phase"] == "measured",
            **{field: render[field] for field in ("firstPageRenderMs", "documentLoadedMs", "pageLoadedMs", "canvasRenderMs")},
            "cdpReportedDataAtOrBeforeRenderBytes": net["buckets"]["at-or-before"]["reportedDataBytes"],
            "cdpUncertainDataBytes": net["buckets"]["uncertain"]["reportedDataBytes"],
            "cdpAfterRenderDataBytes": net["buckets"]["after"]["reportedDataBytes"],
            "cdpTotalReportedBodyBytes": sum(request["reportedBodyBytes"] for request in net["requests"]),
            "rangeRequestCount": ranges, "observed206Count": partials,
            "initial200FinishedAtOrBeforeRender": initial[0]["finishClass"] == "at-or-before",
            "initial200FinishUncertain": initial[0]["finishClass"] == "uncertain",
            "initial200FinishedAfterRender": initial[0]["finishClass"] == "after",
            "initial200ReportedBodyBytes": initial[0]["reportedBodyBytes"],
            "completedResourceTimingBodyBytesAtRender": completed_body,
            "verificationStartedRequestCount": phases["verification"],
            "verificationUncertainRequestCount": phases["verificationUncertain"],
            "verifiedPdfBytes": verification["downloadedBytes"], "verifiedPdfSha256": verification["downloadedSha256"],
            "rgbaSha256": verification["rgbaSha256"], "clockBoundaryWidthMs": trial["clock"]["widthMs"],
            "trialPacingPassed": True, "pacingHeaderMinimumMs": pacing["headerMinimumMs"],
            "pacingHeaderMaximumMs": pacing["headerMaximumMs"], "maximumWriteLatenessMs": pacing["maximumWriteLatenessMs"],
            "preAndPostCalibrationPassed": True, "preservationAndSourceHashesPassed": True,
        })
    computed_summary = summarize(report["trials"])
    equal(report["summary"], computed_summary, "independently recomputed descriptive summary")
    return {
        "schemaVersion": 1, "purpose": "independent-controlled-delivery-audit-and-descriptive-analysis",
        "auditStatus": "passed", "reportPath": str(report_path), "reportSha256": sha256(report_path),
        "analysisScriptSha256": sha256(Path(__file__)), "environment": report["environment"], "experiment": experiment,
        "sourceHashes": report["sourceHashes"], "preservedSourceHashes": report["baselineLock"]["sourceHashes"],
        "verification": {"trialCount": 64, "warmupTrials": 16, "measuredTrials": 48,
                         "preservedSourceFiles": len(baseline_checks), "executedSourceSnapshotFiles": len(source_checks),
                         "corpusManifestSha256": sha256(manifest_path), "summaryRecomputedIndependently": True},
        "observerProbe": {"passed": True, "known206Responses": 2, "bytesPerResponse": 4096, "clockWidthMs": probe["clock"]["widthMs"]},
        "deliveryCalibrations": calibrations, "summary": computed_summary, "trials": trial_rows,
        "limitations": [
            "Descriptive single-session factorial pilot; no significance claim or independent environmental replication.",
            "CDP dataLength sums count reported transfer bytes, including overlapping/repeated ranges, not unique coverage or exact physical arrival.",
            "Clock classification assumes a stable offset and the explicitly configured resolution margins.",
            "Do not pool these timings with earlier unshaped experiments; warmups are retained but excluded from the summaries.",
        ],
    }


def write_new(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="") as stream:
        stream.write(contents)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--output-prefix", type=Path, default=ROOT / "docs/data/controlled-delivery-2026-11-17")
    parser.add_argument("--audit-json", type=Path, default=Path("/tmp/controlled-delivery-audit.json"))
    args = parser.parse_args()
    report_path = args.report.resolve()
    outputs = [Path(str(args.output_prefix.resolve()) + suffix) for suffix in (".csv", ".json")]
    try:
        require(not any(path.exists() for path in outputs), "Export target already exists; choose a new output prefix")
        analysis = audit_report(report_path)
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=list(analysis["trials"][0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(analysis["trials"])
        write_new(outputs[0], buffer.getvalue())
        write_new(outputs[1], json.dumps(analysis, indent=2) + "\n")
        audit = {key: value for key, value in analysis.items() if key not in ("trials", "environment", "sourceHashes", "preservedSourceHashes")}
        audit["exports"] = [{"path": str(path), "sha256": sha256(path)} for path in outputs]
        args.audit_json.parent.mkdir(parents=True, exist_ok=True)
        args.audit_json.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
        print(f"PASS: 64 trials audited; 16 warmups excluded from the 48-trial descriptive summary.\nCSV: {outputs[0]}\nJSON: {outputs[1]}\nAudit: {args.audit_json}")
        return 0
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as error:
        audit = {"auditStatus": "failed", "reportPath": str(report_path), "error": str(error), "exportsCreated": [str(path) for path in outputs if path.exists()]}
        args.audit_json.parent.mkdir(parents=True, exist_ok=True)
        args.audit_json.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

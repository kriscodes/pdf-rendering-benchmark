import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser, type CDPSession } from "playwright";
import { startPacedServer, PACING_PROFILE } from "./paced-server.js";
import { auditPacing } from "./delivery-calibration.js";
import { summarizeNetwork, type NetworkEvent, type CalibrationSample } from "./partial-network.js";
import { CLOCK_POINTS, createClockObserverSchedule, analyzeClockBursts, type ClockPoint } from "./clock-observer-protocol.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKAGE = path.join(ROOT, "packages/runner");
const require = createRequire(import.meta.url);
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const json = async (filename: string) => JSON.parse(await readFile(filename, "utf8"));
const remaining = (deadline: number) => { assert(performance.now() < deadline, "Fixed deadline exhausted"); return Math.max(1, deadline - performance.now()); };
const now = () => new Date().toISOString();

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Operation exceeded ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function clockSample(cdp: CDPSession, timeoutMs: number): Promise<CalibrationSample> {
  const deadline = performance.now() + timeoutMs;
  const timestamp = async () => {
    const { metrics } = await bounded(cdp.send("Performance.getMetrics"), remaining(deadline));
    const value = metrics.find(metric => metric.name === "Timestamp")?.value;
    assert(value !== undefined && Number.isFinite(value), "Missing CDP monotonic Timestamp");
    return value;
  };
  const beforeSeconds = await timestamp();
  const { result, exceptionDetails } = await bounded(cdp.send("Runtime.evaluate", {
    expression: "performance.now()", returnByValue: true,
  }), remaining(deadline));
  assert(!exceptionDetails);
  const afterSeconds = await timestamp();
  return { beforeSeconds, pageNowMs: Number(result.value), afterSeconds };
}

async function observedPage(browser: Browser, experiment: any, record: any) {
  const context = await browser.newContext({
    viewport: experiment.viewport, deviceScaleFactor: experiment.deviceScaleFactor,
    serviceWorkers: "block", locale: "en-US", timezoneId: "UTC", colorScheme: "light",
  });
  const page = await context.newPage();
  record.errors = []; record.workers = []; record.networkEvents = [];
  const events: NetworkEvent[] = record.networkEvents;
  page.on("pageerror", error => record.errors.push(error.message));
  page.on("console", message => {
    if (["warning", "error"].includes(message.type())) record.errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", request => record.errors.push(`requestfailed: ${request.url()}: ${request.failure()?.errorText}`));
  page.on("worker", worker => record.workers.push(worker.url()));
  const cdp = await context.newCDPSession(page);
  const ids = new Set<string>();
  cdp.on("Network.requestWillBeSent", event => {
    const pathname = new URL(event.request.url).pathname;
    if (!pathname.startsWith("/probe/")) return;
    ids.add(event.requestId);
    events.push({ kind: "request", requestId: event.requestId, timestampSeconds: event.timestamp,
      url: event.request.url, method: event.request.method, headers: event.request.headers });
  });
  cdp.on("Network.responseReceived", event => {
    if (ids.has(event.requestId)) events.push({ kind: "response", requestId: event.requestId,
      timestampSeconds: event.timestamp, status: event.response.status, headers: event.response.headers });
  });
  cdp.on("Network.dataReceived", event => {
    if (ids.has(event.requestId)) events.push({ kind: "data", requestId: event.requestId,
      timestampSeconds: event.timestamp, dataLength: event.dataLength, encodedDataLength: event.encodedDataLength });
  });
  cdp.on("Network.loadingFinished", event => {
    if (ids.has(event.requestId)) events.push({ kind: "finished", requestId: event.requestId,
      timestampSeconds: event.timestamp, encodedDataLength: event.encodedDataLength });
  });
  cdp.on("Network.loadingFailed", event => {
    if (ids.has(event.requestId)) events.push({ kind: "failed", requestId: event.requestId,
      timestampSeconds: event.timestamp, errorText: event.errorText, canceled: event.canceled });
  });
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  return { context, page, cdp, events };
}

async function awaitTerminalEvents(cdp: CDPSession, events: NetworkEvent[], timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    await bounded(cdp.send("Performance.getMetrics"), Math.max(1, deadline - performance.now()));
    const requests = events.filter(event => event.kind === "request");
    const done = new Set(events.filter(event => ["finished", "failed"].includes(event.kind)).map(event => event.requestId));
    if (requests.length && requests.every(event => done.has(event.requestId))) return;
    assert(performance.now() < deadline, "CDP request completion evidence timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function verifyPreservation() {
  const lock = await json(path.join(ROOT, "experiments/clock-observer-preservation-lock.json"));
  for (const field of ["sourceHashes", "artifactHashes"]) {
    for (const [filename, expected] of Object.entries(lock[field])) {
      assert.equal(sha256(await readFile(path.join(ROOT, filename))), expected, `Preserved file changed: ${filename}`);
    }
  }
  return lock;
}

async function fixtureServer() {
  const fixture = Buffer.alloc(49152);
  for (let i = 0; i < fixture.length; i += 4) fixture.writeUInt32LE(i / 4, i);
  const assets = new Map<string, { body: Buffer; contentType: string; range?: boolean; paced?: boolean }>();
  assets.set("/", { body: await readFile(path.join(PACKAGE, "viewer/clock-observer.html")), contentType: "text/html; charset=utf-8" });
  assets.set("/clock-observer.mjs", { body: await readFile(path.join(PACKAGE, "viewer/clock-observer.mjs")), contentType: "text/javascript; charset=utf-8" });
  for (const mode of ["unpaced", "paced"]) assets.set(`/probe/${mode}.bin`, {
    body: fixture, contentType: "application/octet-stream", range: true, paced: mode === "paced",
  });
  return startPacedServer(assets);
}

async function collectBurst(cdp: CDPSession, point: ClockPoint, probe: any, config: any, probeDeadline: number) {
  const burst: any = { point, samples: [], startedNodeAtMs: performance.now(), finishedNodeAtMs: null };
  probe.bursts.push(burst);
  const deadline = Math.min(probeDeadline, performance.now() + config.burstTimeoutMs);
  try {
    for (let index = 0; index < config.bracketsPerPoint; index++) {
      burst.samples.push(await clockSample(cdp, Math.min(config.operationTimeoutMs, remaining(deadline))));
    }
  } finally { burst.finishedNodeAtMs = performance.now(); }
}

function knownClassification(events: NetworkEvent[], firstUrl: string, secondUrl: string, boundary: any) {
  if (!boundary) return { status: "unavailable", reason: "no-interval" };
  const result: any = { status: "failed", reason: null };
  try {
    result.first = summarizeNetwork(events, { documentUrl: firstUrl, renderBoundary: boundary });
    result.second = summarizeNetwork(events, { documentUrl: secondUrl, renderBoundary: boundary });
    for (const [summary, expectedPhase] of [[result.first, "at-or-before"], [result.second, "after"]] as const) {
      assert.equal(summary.requestCount, 1); assert.equal(summary.range.requestCount, 1); assert.equal(summary.range.observed206Count, 1);
      assert(summary.requests[0].completed && !summary.requests[0].failed);
      for (const phase of ["at-or-before", "uncertain", "after"] as const) {
        const bucket = summary.byRenderTime[phase];
        if (phase === expectedPhase) {
          assert.equal(bucket.requestStarts, 1); assert.equal(bucket.responseHeaders, 1);
          assert.equal(bucket.loadingFinished, 1); assert.equal(bucket.loadingFailed, 0);
          assert.equal(bucket.reportedDataBytes, 4096); assert(bucket.dataEvents >= 1);
        } else {
          assert(Object.values(bucket).every(value => value === 0), `Unexpected event in ${phase}`);
        }
      }
    }
    result.status = "passed";
  } catch (error) { result.reason = String(error); }
  return result;
}

function analyzeProbe(probe: any) {
  const marker = probe.firstStage?.markerMs ?? NaN;
  probe.clockAnalysis = analyzeClockBursts(probe.bursts, marker);
  probe.methods = {};
  for (const name of ["reference", "candidate"]) {
    const clock = probe.clockAnalysis[name];
    const classification = knownClassification(probe.networkEvents ?? [], probe.firstStage?.first?.url ?? "",
      probe.secondStage?.second?.url ?? "", clock.boundary);
    probe.methods[name] = { clock, classification,
      status: probe.operationStatus === "passed" && clock.status === "passed" && classification.status === "passed" ? "passed" : "failed" };
  }
}

async function awaitServerTerminal(server: Awaited<ReturnType<typeof startPacedServer>>, start: number, deadline: number) {
  while (server.requests.slice(start).some(request => !request.completed && !request.canceled)) {
    remaining(deadline); await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function runProbe(browser: Browser, server: Awaited<ReturnType<typeof startPacedServer>>, config: any,
  probe: any, outerDeadline: number) {
  probe.startedAt = now(); probe.bursts = []; probe.operationStatus = "running";
  const deadline = Math.min(outerDeadline, performance.now() + config.probeTimeoutMs);
  const op = () => Math.min(config.operationTimeoutMs, remaining(deadline));
  const requestStart = server.requests.length;
  let observer: Awaited<ReturnType<typeof observedPage>> | undefined;
  try {
    observer = await bounded(observedPage(browser, config, probe), op());
    await observer.page.goto(server.origin, { waitUntil: "load", timeout: op() });
    await observer.page.waitForFunction("typeof window.clockProbeBefore === 'function' && typeof window.clockProbeAfter === 'function'", null, { timeout: op() });
    await collectBurst(observer.cdp, CLOCK_POINTS[0], probe, config, deadline);
    const base = `${server.origin}/probe/${probe.mode}.bin?probe=${probe.id}`;
    probe.firstStage = await bounded(observer.page.evaluate(async input => (window as any).clockProbeBefore(input),
      { url: `${base}&phase=before`, gapMs: config.requestedGapMs }), op());
    await collectBurst(observer.cdp, CLOCK_POINTS[1], probe, config, deadline);
    probe.secondStage = await bounded(observer.page.evaluate(async input => (window as any).clockProbeAfter(input),
      { url: `${base}&phase=after`, gapMs: config.requestedGapMs }), op());
    await collectBurst(observer.cdp, CLOCK_POINTS[2], probe, config, deadline);
    await awaitTerminalEvents(observer.cdp, observer.events, op());
    await awaitServerTerminal(server, requestStart, deadline);
    assert.equal(probe.firstStage.timeOriginMs, probe.secondStage.timeOriginMs);
    assert(probe.firstStage.first.completedAtMs <= probe.firstStage.markerMs);
    assert(probe.secondStage.second.startAtMs >= probe.firstStage.markerMs);
    assert(probe.bursts[0].samples.every((sample: CalibrationSample) => sample.pageNowMs <= probe.firstStage.first.startAtMs));
    assert(probe.bursts[1].samples.every((sample: CalibrationSample) => sample.pageNowMs >= probe.firstStage.markerMs && sample.pageNowMs <= probe.secondStage.second.startAtMs));
    assert(probe.bursts[2].samples.every((sample: CalibrationSample) => sample.pageNowMs >= probe.secondStage.second.completedAtMs));
    probe.actualPageGapsMs = { beforeMarker: probe.firstStage.markerMs - probe.firstStage.first.completedAtMs,
      afterMarker: probe.secondStage.second.startAtMs - probe.firstStage.markerMs };
    assert.equal(probe.workers.length, 0, "Diagnostic unexpectedly created a worker");
    assert.deepEqual(probe.errors, [], "Browser diagnostics invalidate probe operations");
    assert.equal(observer.events.filter(event => event.kind === "request").length, 2);
    for (const transfer of [probe.firstStage.first, probe.secondStage.second]) {
      const request = observer.events.find(event => event.kind === "request" && event.url === transfer.url);
      assert(request && request.kind === "request");
      const events: NetworkEvent[] = observer.events.filter(event => event.requestId === request.requestId);
      assert(events.some(event => event.kind === "finished") && events.every(event => event.kind !== "failed"));
      const response = events.find(event => event.kind === "response");
      assert(response && response.kind === "response");
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
      assert.equal(response.status, 206); assert.equal(headers["content-range"], transfer.contentRange);
      assert.equal(Number(headers["content-length"]), 4096); assert.equal(headers["content-encoding"] ?? "identity", "identity");
      assert.equal(events.reduce((sum, event) => sum + (event.kind === "data" ? event.dataLength : 0), 0), 4096);
    }
    const requests = server.requests.slice(requestStart);
    assert(requests.every(request => request.completed && !request.canceled && request.status < 400));
    const fixtureRequests = requests.filter(request => request.url.startsWith("/probe/"));
    assert.equal(fixtureRequests.length, 2);
    assert(fixtureRequests.every(request => request.bodyBytesWritten === 4096 && request.paced === (probe.mode === "paced")));
    if (probe.mode === "paced") probe.pacingAudit = auditPacing(fixtureRequests, config.pacingAuditLimits);
    probe.operationStatus = "passed";
  } catch (error) {
    probe.operationStatus = "failed"; probe.error = error instanceof Error ? error.stack : String(error);
  } finally {
    const cleanupDeadline = performance.now() + config.cleanupTimeoutMs;
    try {
      if (observer) {
        await bounded(observer.context.close(), remaining(cleanupDeadline));
      } else {
        // Stop this session if setup cannot return its context for cleanup.
        throw new Error(`Probe context setup failed: ${probe.error}`);
      }
      await awaitServerTerminal(server, requestStart, cleanupDeadline);
    } catch (error) {
      probe.operationStatus = "failed"; probe.cleanupError = String(error);
      throw error;
    } finally {
      probe.serverRequests = server.requests.slice(requestStart);
      if (probe.errors?.length) { probe.operationStatus = "failed"; probe.error ??= "Late browser diagnostics"; }
      if (probe.operationStatus === "passed") {
        try {
          assert.equal(probe.networkEvents.filter((event: NetworkEvent) => event.kind === "request").length, 2);
          assert(probe.networkEvents.every((event: NetworkEvent) => event.kind !== "failed"));
          assert(probe.serverRequests.every((request: any) => request.completed && !request.canceled && request.status < 400));
          assert.equal(probe.serverRequests.filter((request: any) => request.url.startsWith("/probe/")).length, 2);
        } catch (error) { probe.operationStatus = "failed"; probe.error = `Late evidence invalidated probe: ${String(error)}`; }
      }
      probe.finishedAt = now();
      analyzeProbe(probe);
    }
  }
}

function counts(probes: any[]) {
  const result = { attempted: probes.length, operationalFailures: 0, bothPassed: 0, referenceOnly: 0, candidateOnly: 0, neither: 0 };
  for (const probe of probes) {
    if (probe.operationStatus !== "passed") result.operationalFailures++;
    const reference = probe.methods?.reference?.status === "passed";
    const candidate = probe.methods?.candidate?.status === "passed";
    if (reference && candidate) result.bothPassed++; else if (reference) result.referenceOnly++;
    else if (candidate) result.candidateOnly++; else result.neither++;
  }
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { "output-dir": { type: "string" } } });
  const parent = path.join(ROOT, "results/raw/clock-observer"); await mkdir(parent, { recursive: true });
  const output = values["output-dir"] ? path.resolve(values["output-dir"]) : await mkdtemp(path.join(parent, "run-"));
  await mkdir(output, { recursive: true }); assert.equal((await readdir(output)).length, 0, "Evidence directory must be empty");
  const report: any = { schemaVersion: 1, purpose: "known-event-clock-observer-diagnostic-not-pdf-performance", status: "running", startedAt: now(), sessions: [] };
  const save = () => writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const campaignStarted = performance.now();
  let browser: Browser | undefined; let server: Awaited<ReturnType<typeof startPacedServer>> | undefined;
  try {
    const config = await json(path.join(ROOT, "experiments/clock-observer.json")); report.experiment = config;
    assert.equal(config.id, "text-100-clock-observer-diagnostic-v1");
    assert.equal(config.sessions, 3); assert.equal(config.probesPerSession, 12); assert.equal(config.bracketsPerPoint, 5);
    assert.deepEqual(config.points, CLOCK_POINTS); assert.equal(config.clockResolutionMarginMs, 1); assert.equal(config.maximumBoundaryWidthMs, 5);
    assert.equal(config.fixtureLengthBytes, 49152); assert.equal(config.transferBytes, 4096); assert.equal(config.requestedGapMs, 30);
    assert.deepEqual(config.delivery, PACING_PROFILE); assert.equal(process.version, config.expectedNodeVersion);
    const lock = await verifyPreservation(); report.preservationLock = lock;
    const playwright = await json(require.resolve("playwright/package.json")); assert.equal(playwright.version, config.expectedPlaywrightVersion);
    report.environment = { node: process.version, playwright: playwright.version, platform: os.platform(), release: os.release(),
      arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() };
    report.sourceHashes = {};
    const sources = ["experiments/clock-observer.json", "experiments/clock-observer-preservation-lock.json", "docs/clock-observer.md",
      "packages/runner/viewer/clock-observer.html", "packages/runner/viewer/clock-observer.mjs"];
    for (const name of ["clock-observer", "clock-observer-protocol", "partial-network", "paced-server", "server", "delivery-calibration"]) {
      sources.push(`packages/runner/src/${name}.ts`, `packages/runner/dist/${name}.js`);
    }
    for (const filename of sources) {
      const bytes = await readFile(path.join(ROOT, filename)); report.sourceHashes[filename] = sha256(bytes);
      const snapshot = path.join(output, "source-snapshot", filename); await mkdir(path.dirname(snapshot), { recursive: true }); await writeFile(snapshot, bytes);
    }
    report.schedule = createClockObserverSchedule(); await save();
    const campaignDeadline = campaignStarted + config.campaignTimeoutMs;
    for (const ordinal of [1, 2, 3]) {
      const session: any = { session: ordinal, status: "running", startedAt: now(), probes: [] }; report.sessions.push(session);
      const deadline = Math.min(campaignDeadline, performance.now() + config.sessionTimeoutMs);
      try {
        remaining(deadline);
        server = await bounded(fixtureServer(), Math.min(config.operationTimeoutMs, remaining(deadline)));
        session.origin = server.origin;
        browser = await chromium.launch({ headless: true, timeout: Math.min(config.operationTimeoutMs, remaining(deadline)) });
        session.chromium = browser.version(); assert.equal(session.chromium, config.expectedChromiumVersion);
        for (const entry of report.schedule.filter((item: any) => item.session === ordinal)) {
          remaining(deadline);
          const probe: any = { ...entry }; session.probes.push(probe);
          await runProbe(browser, server, config, probe, deadline);
          await save();
          console.log(`${probe.id}: operations=${probe.operationStatus}; reference=${probe.methods.reference.status} (${probe.methods.reference.clock.widthMs?.toFixed(3) ?? "no interval"} ms); candidate=${probe.methods.candidate.status} (${probe.methods.candidate.clock.widthMs?.toFixed(3) ?? "no interval"} ms)`);
        }
        session.status = "complete";
      } finally {
        const cleanup = await Promise.allSettled([
          bounded(Promise.resolve(browser?.close()), config.cleanupTimeoutMs),
          bounded(Promise.resolve(server?.close()), config.cleanupTimeoutMs),
        ]);
        session.serverRequests = server?.requests ?? [];
        session.finishedAt = now();
        const failed = cleanup.filter(item => item.status === "rejected");
        if (failed.length) { session.status = "incomplete"; session.cleanupErrors = failed.map(item => String(item.reason)); await save(); throw new Error("Session cleanup failed"); }
        browser = undefined; server = undefined;
        await save();
      }
      assert.deepEqual(await verifyPreservation(), lock);
    }
    assert.deepEqual(await verifyPreservation(), lock);
    for (const [filename, expected] of Object.entries(report.sourceHashes)) assert.equal(sha256(await readFile(path.join(ROOT, filename))), expected);
    report.preservedFilesUnchanged = true; report.diagnosticSourcesUnchanged = true;
    report.status = "complete";
  } catch (error) {
    report.status = "incomplete"; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; console.error(report.error);
    for (const session of report.sessions) if (session.status === "running") session.status = "incomplete";
  } finally {
    const probes = report.sessions.flatMap((session: any) => session.probes);
    const ids = new Set(probes.map((probe: any) => probe.id));
    report.unattemptedProbes = (report.schedule ?? createClockObserverSchedule()).filter((entry: any) => !ids.has(entry.id));
    report.summary = { ...counts(probes), bySession: report.sessions.map((session: any) => ({ session: session.session, ...counts(session.probes) })),
      byMode: Object.fromEntries(["unpaced", "paced"].map(mode => [mode, counts(probes.filter((probe: any) => probe.mode === mode))])),
      interpretation: "Operational completion and method acceptance are distinct. Nested interval narrowing alone does not establish accuracy or PDF workload validity." };
    report.finishedAt = now(); await save(); console.log(`Clock observer report: ${path.join(output, "report.json")}`);
  }
}

main().then(() => { if (process.exitCode) process.exit(process.exitCode); })
  .catch(error => { console.error(error); process.exit(1); });

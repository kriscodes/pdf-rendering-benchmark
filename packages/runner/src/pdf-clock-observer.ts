import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser, type CDPSession } from "playwright";
import { startPacedServer as startServer, PACING_PROFILE, type PacedAsset } from "./paced-server.js";
import { PDF_CLOCK_POINTS, createPdfClockSchedule, analyzePdfClockBursts } from "./pdf-clock-protocol.js";
import { CLOCK_POINTS, analyzeClockBursts } from "./clock-observer-protocol.js";
import { performance } from "node:perf_hooks";
import { auditPacing, auditCalibrationGroup } from "./delivery-calibration.js";
import { VARIANTS } from "./protocol.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKAGE = path.join(ROOT, "packages/runner");
const require = createRequire(import.meta.url);
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const json = async (filename: string) => JSON.parse(await readFile(filename, "utf8"));
const remaining = (deadline: number) => { assert(performance.now() < deadline, "Fixed deadline exhausted"); return Math.max(1, deadline - performance.now()); };
const now = () => new Date().toISOString();
let campaignDeadline = Number.POSITIVE_INFINITY;
const qpdf = (...args: string[]) => execFileSync("qpdf", args, {
  encoding: "utf8", timeout: Math.max(1, Math.floor(Math.min(30000, remaining(campaignDeadline)))),
}).trim();

import { calibrateOffset, mapPageTime, summarizeNetwork, type NetworkEvent, type CalibrationSample } from "./partial-network.js";

// Keep baseline source files immutable; this diagnostic repeats its corpus validation policy.
async function loadCorpus() {
  const directory = path.join(ROOT, "corpus/generated/pilot");
  const manifestBytes = await readFile(path.join(directory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString());
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.profileId, "text-100-v1");
  assert.equal(manifest.purpose, "generator-smoke-test-not-performance-results");
  assert.equal(manifest.pageCount, 100);
  assert.equal(manifest.rowsPerPage, 40);
  assert.deepEqual(manifest.pageSizePoints, [612, 792]);
  assert.equal(manifest.fontPolicy, "standard Helvetica; fonts are not embedded");
  assert.deepEqual(manifest.qpdfCommonOptions, [
    "--deterministic-id", "--object-streams=disable", "--stream-data=compress",
    "--recompress-flate", "--compression-level=6",
  ]);
  assert.equal(manifest.documents.length, 2);
  const files = new Map<string, Buffer>();
  for (const [index, variant] of VARIANTS.entries()) {
    const document = manifest.documents[index];
    assert.equal(document.id, `text-100-${variant}`);
    assert.equal(document.file, `text-100-${variant}.pdf`);
    assert.equal(document.pageCount, 100);
    assert.equal(document.linearized, variant === "linearized");
    const filename = path.join(directory, document.file);
    const bytes = await readFile(filename);
    assert.equal(bytes.length, document.bytes, `${variant}: size changed`);
    assert.equal(sha256(bytes), document.sha256, `${variant}: hash changed`);
    const checked = qpdf("--check", filename);
    assert(checked.includes(document.linearized ? "File is linearized" : "File is not linearized"));
    assert.equal(qpdf("--show-npages", filename), "100");
    if (document.linearized) qpdf("--check-linearization", filename);
    files.set(document.file, bytes);
  }
  return { manifest, manifestSha256: sha256(manifestBytes), files };
}

async function loadAssets(files: Map<string, Buffer>) {
  const assets = new Map<string, PacedAsset>();
  for (const [filename, body] of files) {
    assets.set(`/pdf/${filename}`, { body, contentType: "application/pdf", range: true, paced: true });
  }
  assets.set("/", { body: await readFile(path.join(PACKAGE, "viewer/index.html")), contentType: "text/html; charset=utf-8" });
  assets.set("/viewer.mjs", { body: await readFile(path.join(PACKAGE, "viewer/partial-loading.mjs")), contentType: "text/javascript; charset=utf-8" });
  const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  for (const name of ["build/pdf.mjs", "build/pdf.worker.mjs"]) {
    assets.set(`/pdfjs/${name}`, { body: await readFile(path.join(pdfjsRoot, name)), contentType: "text/javascript; charset=utf-8" });
  }
  for (const folder of ["standard_fonts", "cmaps", "wasm"]) {
    for (const entry of await readdir(path.join(pdfjsRoot, folder), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = `${folder}/${entry.name}`;
      assets.set(`/pdfjs/${name}`, { body: await readFile(path.join(pdfjsRoot, name)), contentType: name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" });
    }
  }
  const probe = Buffer.alloc(49152);
  for (let offset = 0; offset < probe.length; offset += 4) probe.writeUInt32LE(offset / 4, offset);
  assets.set("/diagnostic/probe.bin", { body: probe, contentType: "application/octet-stream", range: true });
  const fixture = Buffer.alloc(131072);
  for (let offset = 0; offset < fixture.length; offset += 4) fixture.writeUInt32LE(offset / 4, offset);
  assets.set("/pdf/calibration.bin", { body: fixture, contentType: "application/octet-stream", range: true, paced: true });
  assets.set("/diagnostic/unshaped.bin", { body: fixture, contentType: "application/octet-stream", range: true });
  assets.set("/clock-control", { body: await readFile(path.join(PACKAGE, "viewer/clock-observer.html")), contentType: "text/html; charset=utf-8" });
  assets.set("/clock-observer.mjs", { body: await readFile(path.join(PACKAGE, "viewer/clock-observer.mjs")), contentType: "text/javascript; charset=utf-8" });
  assets.set("/probe/unpaced.bin", { body: probe, contentType: "application/octet-stream", range: true });
  return assets;
}

async function verifyBaseline() {
  const lock = await json(path.join(ROOT, "experiments/delivery-preservation-lock.json"));
  for (const [filename, hash] of Object.entries(lock.sourceHashes)) {
    assert.equal(sha256(await readFile(path.join(ROOT, filename))), hash, `Baseline changed: ${filename}`);
  }
  const corpus = await loadCorpus();
  assert.equal(corpus.manifestSha256, lock.manifestSha256, "Original manifest changed");
  return { lock, corpus };
}

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
    if (!pathname.startsWith("/pdf/") && !pathname.startsWith("/diagnostic/") && !pathname.startsWith("/probe/")) return;
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

async function awaitServerRequests(server: Awaited<ReturnType<typeof startServer>>, first: number, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (server.requests.slice(first).some(request => !request.completed && !request.canceled)) {
    assert(performance.now() < deadline, "Server delivery did not drain before context teardown");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert(server.requests.slice(first).every(request => request.completed && !request.canceled), "Canceled server response");
}

async function awaitServerTerminal(server: Awaited<ReturnType<typeof startServer>>, first: number, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (server.requests.slice(first).some(request => !request.completed && !request.canceled)) {
    remaining(deadline); await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function runDeliveryCalibration(browser: Browser, server: Awaited<ReturnType<typeof startServer>>, experiment: any, record: any, config: any, deadline: number) {
  record.status = "running";
  const op = () => Math.min(config.operationTimeoutMs, remaining(deadline));
  const observer = await bounded(observedPage(browser, experiment, record), op());
  const requestStart = server.requests.length;
  record.groups = [];
  try {
    await observer.page.goto(server.origin, { waitUntil: "load", timeout: op() });
    for (const kind of ["single", "concurrent", "unshaped"] as const) {
      const group: any = { kind, status: "running" }; record.groups.push(group);
      const first = server.requests.length;
      const ranges = kind === "concurrent" ? [[0, 65535], [65536, 131071]] : [[0, 65535]];
      group.browser = await bounded(observer.page.evaluate(async ({ origin, stage, kind, ranges }) => {
        return Promise.all(ranges.map(async ([start, end], index) => {
          const route = kind === "unshaped" ? "/diagnostic/unshaped.bin" : "/pdf/calibration.bin";
          const url = `${origin}${route}?stage=${stage}&kind=${kind}&index=${index}`;
          const startAtMs = performance.now();
          const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
          const headersAtMs = performance.now();
          const bytes = new Uint8Array(await response.arrayBuffer());
          const finishedAtMs = performance.now();
          if (response.status !== 206 || response.headers.get("Content-Range") !== `bytes ${start}-${end}/131072`
            || (response.headers.get("Content-Encoding") ?? "identity") !== "identity"
            || Number(response.headers.get("Content-Length")) !== end! - start! + 1
            || bytes.length !== end! - start! + 1
            || !bytes.every((value, index) => value === ((Math.floor((start! + index) / 4) >>> (8 * ((start! + index) % 4))) & 255))) {
            throw new Error("Delivery calibration returned unexpected bytes/headers");
          }
          return { url, startAtMs, headersAtMs, finishedAtMs, bytes: bytes.length, status: response.status,
            contentRange: response.headers.get("Content-Range"), contentLength: response.headers.get("Content-Length"), timeOriginMs: performance.timeOrigin,
            resourceTiming: performance.getEntriesByName(url).map(entry => entry.toJSON()) };
        }));
      }, { origin: server.origin, stage: record.stage, kind, ranges }), op());
      await awaitTerminalEvents(observer.cdp, observer.events, op());
      await awaitServerRequests(server, first, op());
      const requests = server.requests.slice(first);
      assert.equal(requests.length, ranges.length);
      group.serverRequests = group.browser.map((result: any) => {
        const url = new URL(result.url);
        const matched = requests.filter(request => request.url === url.pathname + url.search);
        assert.equal(matched.length, 1); return matched[0];
      });
      for (const result of group.browser) {
        const request = observer.events.find(event => event.kind === "request" && event.url === result.url);
        assert(request && request.kind === "request");
        const events = observer.events.filter(event => event.requestId === request.requestId);
        assert(events.some(event => event.kind === "finished"));
        assert(!events.some(event => event.kind === "failed"));
        const response = events.find(event => event.kind === "response");
        assert(response && response.kind === "response" && response.status === 206);
        const contentRange = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-range")?.[1];
        assert.equal(contentRange, result.contentRange);
        const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
        assert.equal(headers["content-encoding"] ?? "identity", "identity");
        assert.equal(Number(headers["content-length"]), result.bytes);
        const bytes = events.reduce((sum, event) => sum + (event.kind === "data" ? event.dataLength : 0), 0);
        assert.equal(bytes, result.bytes, "Calibration CDP body bytes differ");
      }
      if (kind === "unshaped") {
        assert(group.serverRequests.every((request: any) => !request.paced));
        group.durationMs = group.browser[0].finishedAtMs - group.browser[0].startAtMs;
        assert(group.durationMs < experiment.calibration.unpacedMaximumMs, "Unshaped control was too slow");
      } else {
        group.audit = auditCalibrationGroup(group.serverRequests, group.browser, experiment);
      }
      group.status = "passed";
    }
    assert.deepEqual(record.errors, [], "Calibration browser diagnostics");
  } catch (error) { record.status = "failed"; record.error = String(error); throw error; }
  finally {
    const cleanupDeadline = performance.now() + config.cleanupTimeoutMs;
    try {
      await bounded(observer.context.close(), remaining(cleanupDeadline));
      await awaitServerTerminal(server, requestStart, remaining(cleanupDeadline));
      assert.deepEqual(record.errors, [], "Calibration teardown diagnostics");
    } catch (error) { record.status = "failed"; record.cleanupError = String(error); throw error; }
    finally {
      record.serverRequests = server.requests.slice(requestStart);
      for (const group of record.groups) if (group.status === "running") {
        group.status = "failed"; group.error = record.error ?? record.cleanupError ?? "Calibration interrupted";
      }
      record.unattemptedGroups = ["single", "concurrent", "unshaped"].filter(kind => !record.groups.some((group: any) => group.kind === kind));
    }
  }
  record.status = "passed";
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


async function verifyPreservation() {
  const lock = await json(path.join(ROOT, "experiments/pdf-clock-preservation-lock.json"));
  for (const field of ["sourceHashes", "artifactHashes"]) {
    for (const [filename, expected] of Object.entries(lock[field])) {
      assert.equal(sha256(await bounded(readFile(path.join(ROOT, filename)), Math.min(30000, remaining(campaignDeadline)))), expected, `Preserved file changed: ${filename}`);
    }
  }
  return lock;
}

async function collectBurst(cdp: CDPSession, point: string, record: any, count: number, config: any, outerDeadline: number) {
  const burst: any = { point, samples: [], startedNodeAtMs: performance.now(), finishedNodeAtMs: null };
  record.bursts.push(burst);
  const deadline = Math.min(outerDeadline, performance.now() + config.burstTimeoutMs);
  try {
    for (let i = 0; i < count; i++) burst.samples.push(await clockSample(cdp, Math.min(config.operationTimeoutMs, remaining(deadline))));
  } finally { burst.finishedNodeAtMs = performance.now(); }
}

/** Width rejection is an analysis outcome, never an operational abort. */
function analyzeTrial(trial: any) {
  trial.clockAnalysis = analyzePdfClockBursts(trial.bursts, trial.render?.firstPageRenderedAtMs ?? NaN,
    trial.verification?.verificationStartedAtMs ?? NaN, trial.bracketsPerPoint);
  trial.methods = {};
  for (const name of ["reference", "candidate"] as const) {
    const clock = trial.clockAnalysis[name];
    if (!clock) { trial.methods[name] = null; continue; }
    let network = null;
    let networkError = null;
    try {
      if (clock.boundary && trial.render?.pdfUrl) network = summarizeNetwork(trial.networkEvents ?? [], {
        documentUrl: trial.render.pdfUrl, renderBoundary: clock.boundary,
        ...(clock.verificationBoundary ? { verificationBoundary: clock.verificationBoundary } : {}),
      });
    } catch (error) { networkError = String(error); }
    trial.methods[name] = { clock, network, networkError,
      status: trial.operationStatus === "passed" && clock.status === "passed" && !networkError ? "passed" : "failed" };
  }
}

async function knownControl(browser: Browser, server: Awaited<ReturnType<typeof startServer>>, workload: any,
  config: any, record: any, deadline: number) {
  record.operationStatus = "running"; record.mode = "unpaced"; record.bursts = []; record.startedAt = now();
  const firstRequest = server.requests.length;
  let observer: Awaited<ReturnType<typeof observedPage>> | undefined;
  const op = () => Math.min(config.operationTimeoutMs, remaining(deadline));
  try {
    observer = await bounded(observedPage(browser, workload, record), op());
    await observer.page.goto(`${server.origin}/clock-control`, { waitUntil: "load", timeout: op() });
    await observer.page.waitForFunction("typeof window.clockProbeBefore === 'function' && typeof window.clockProbeAfter === 'function'", null, { timeout: op() });
    await collectBurst(observer.cdp, CLOCK_POINTS[0], record, 5, config, deadline);
    const base = `${server.origin}/probe/unpaced.bin?control=${record.id}`;
    record.firstStage = await bounded(observer.page.evaluate(async input => (window as any).clockProbeBefore(input),
      { url: `${base}&phase=before`, gapMs: 30 }), op());
    await collectBurst(observer.cdp, CLOCK_POINTS[1], record, 5, config, deadline);
    record.secondStage = await bounded(observer.page.evaluate(async input => (window as any).clockProbeAfter(input),
      { url: `${base}&phase=after`, gapMs: 30 }), op());
    await collectBurst(observer.cdp, CLOCK_POINTS[2], record, 5, config, deadline);
    await awaitTerminalEvents(observer.cdp, observer.events, op());
    await awaitServerRequests(server, firstRequest, op());
    assert.equal(record.firstStage.timeOriginMs, record.secondStage.timeOriginMs);
    assert(record.firstStage.markerMs >= record.firstStage.first.completedAtMs);
    assert(record.secondStage.second.startAtMs >= record.firstStage.markerMs);
    assert(record.bursts[0].samples.every((sample: CalibrationSample) => sample.pageNowMs <= record.firstStage.first.startAtMs));
    assert(record.bursts[1].samples.every((sample: CalibrationSample) => sample.pageNowMs >= record.firstStage.markerMs && sample.pageNowMs <= record.secondStage.second.startAtMs));
    assert(record.bursts[2].samples.every((sample: CalibrationSample) => sample.pageNowMs >= record.secondStage.second.completedAtMs));
    record.actualPageGapsMs = { beforeMarker: record.firstStage.markerMs - record.firstStage.first.completedAtMs,
      afterMarker: record.secondStage.second.startAtMs - record.firstStage.markerMs };
    assert.equal(record.workers.length, 0);
    record.operationStatus = "passed";
  } catch (error) { record.operationStatus = "failed"; record.error = String(error); throw error; }
  finally {
    let cleanupError: unknown;
    const cleanupDeadline = performance.now() + config.cleanupTimeoutMs;
    try {
      if (!observer) throw new Error("Known-control context setup did not return a cleanup handle");
      await bounded(observer.context.close(), remaining(cleanupDeadline));
      await awaitServerTerminal(server, firstRequest, remaining(cleanupDeadline));
    } catch (error) { record.operationStatus = "failed"; record.cleanupError = String(error); cleanupError = error; }
    record.serverRequests = server.requests.slice(firstRequest); record.finishedAt = now();
    record.clockAnalysis = analyzeClockBursts(record.bursts, record.firstStage?.markerMs ?? NaN);
    record.methods = {};
    for (const name of ["reference", "candidate"]) {
      const clock = record.clockAnalysis[name];
      const classification = knownClassification(record.networkEvents ?? [], record.firstStage?.first?.url ?? "",
        record.secondStage?.second?.url ?? "", clock.boundary);
      record.methods[name] = { clock, classification,
        status: record.operationStatus === "passed" && clock.status === "passed" && classification.status === "passed" ? "passed" : "failed" };
    }
    if (cleanupError) throw cleanupError;
  }
  try {
  assert.deepEqual(record.errors, []);
  assert.equal(record.networkEvents.filter((event: NetworkEvent) => event.kind === "request").length, 2);
  assert(record.networkEvents.every((event: NetworkEvent) => event.kind !== "failed"));
  assert(record.serverRequests.every((request: any) => request.completed && !request.canceled && request.status < 400));
  const responses = record.serverRequests.filter((request: any) => request.url.startsWith("/probe/"));
  assert.equal(responses.length, 2);
  assert(responses.every((request: any) => !request.paced && request.status === 206 && request.bodyBytesWritten === 4096));
  for (const transfer of [record.firstStage.first, record.secondStage.second]) {
    const request = record.networkEvents.find((event: NetworkEvent) => event.kind === "request" && event.url === transfer.url);
    assert(request);
    const response = record.networkEvents.find((event: NetworkEvent) => event.kind === "response" && event.requestId === request.requestId);
    assert(response && response.status === 206);
    const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
    assert.equal(headers["content-range"], transfer.contentRange); assert.equal(Number(headers["content-length"]), 4096);
    assert.equal(headers["content-encoding"] ?? "identity", "identity");
  }
  } catch (error) {
    record.operationStatus = "failed"; record.status = "failed"; record.error = String(error);
    for (const method of Object.values(record.methods) as any[]) method.status = "failed";
    throw error;
  }
  try { assert.equal(record.methods.candidate.status, "passed", "Known-event fifteen-bracket control failed"); }
  catch (error) { record.status = "failed"; record.error = String(error); throw error; }
  record.status = "passed";
}

async function runControls(browser: Browser, server: Awaited<ReturnType<typeof startServer>>, workload: any,
  config: any, session: any, stage: string, deadline: number, save: () => Promise<void>) {
  const record: any = { stage, status: "running", startedAt: now(),
    knownControl: { id: `session-${session.session}-${stage}`, status: "not-run" }, deliveryCalibration: { stage, status: "not-run" } };
  session.controls.push(record); await save();
  try {
    record.knownControl.status = "running";
    await knownControl(browser, server, workload, config, record.knownControl, deadline);
    record.deliveryCalibration.status = "running";
    await runDeliveryCalibration(browser, server, workload, record.deliveryCalibration, config, deadline);
    remaining(deadline);
    record.status = "passed";
  } catch (error) {
    record.status = "failed"; record.error = String(error);
    for (const child of [record.knownControl, record.deliveryCalibration]) if (child.status === "running") { child.status = "failed"; child.error ??= String(error); }
    throw error;
  } finally { record.finishedAt = now(); await save(); }
}

async function runTrial(browser: Browser, server: Awaited<ReturnType<typeof startServer>>, config: any,
  workload: any, corpus: any, lock: any, trial: any, output: string, outerDeadline: number) {
  trial.operationStatus = "running"; trial.startedAt = now(); trial.bursts = [];
  trial.timings = { startedNodeAtMs: performance.now() };
  const deadline = Math.min(outerDeadline, performance.now() + config.trialTimeoutMs);
  const op = () => Math.min(config.operationTimeoutMs, remaining(deadline));
  const requestStart = server.requests.length;
  let observer: Awaited<ReturnType<typeof observedPage>> | undefined;
  let unsafeCleanup: unknown;
  try {
    observer = await bounded(observedPage(browser, workload, trial), op());
    await observer.page.goto(server.origin, { waitUntil: "load", timeout: op() });
    await observer.page.waitForFunction("typeof window.runPartialFirstPage === 'function'", null, { timeout: op() });
    trial.userAgent = await bounded(observer.page.evaluate(() => navigator.userAgent), op());
    await collectBurst(observer.cdp, PDF_CLOCK_POINTS[0], trial, trial.bracketsPerPoint, config, deadline);
    const url = `${server.origin}/pdf/text-100-${trial.variant}.pdf?trial=${trial.id}`;
    trial.timings.renderCallNodeAtMs = performance.now();
    trial.render = await bounded(observer.page.evaluate(async input => (window as any).runPartialFirstPage(input),
      { url, scale: workload.scale, options: { ...workload.pdfjs, disableRange: !trial.rangeEnabled } }), op());
    trial.timings.renderReturnNodeAtMs = performance.now();
    await collectBurst(observer.cdp, PDF_CLOCK_POINTS[1], trial, trial.bracketsPerPoint, config, deadline);
    trial.eventCountBeforeExplicitVerification = observer.events.length;
    trial.timings.verificationCallNodeAtMs = performance.now();
    const verification: any = await bounded(observer.page.evaluate(async () => (window as any).verifyPartialDocument()), op());
    trial.timings.verificationReturnNodeAtMs = performance.now();
    const { png, ...verified } = verification; trial.verification = verified;
    await collectBurst(observer.cdp, PDF_CLOCK_POINTS[2], trial, trial.bracketsPerPoint, config, deadline);
    await awaitTerminalEvents(observer.cdp, observer.events, op());
    assert.equal(trial.render.timeOriginMs, verified.timeOriginMs);
    assert(trial.render.firstPageRenderedAtMs <= verified.verificationStartedAtMs);
    assert(trial.bursts[0].samples.every((sample: CalibrationSample) => sample.pageNowMs <= trial.render.startedAtMs));
    assert(trial.bursts[1].samples.every((sample: CalibrationSample) => sample.pageNowMs >= trial.render.firstPageRenderedAtMs && sample.pageNowMs <= verified.verificationStartedAtMs));
    assert(trial.bursts[2].samples.every((sample: CalibrationSample) => sample.pageNowMs >= verified.verificationFinishedAtMs));
    const document = corpus.manifest.documents.find((item: any) => item.id === `text-100-${trial.variant}`);
    assert(document.bytes > 2 * workload.pdfjs.rangeChunkSize);
    trial.sizeEligibleForRange = true; trial.rangeCapabilityExpected = trial.rangeEnabled;
    assert.equal(trial.render.numPages, 100); assert.equal(trial.render.width, 612); assert.equal(trial.render.height, 792);
    assert.equal(trial.render.devicePixelRatio, 1); assert.equal(trial.render.pdfjsVersion, "5.6.205");
    assert.equal(verified.downloadedBytes, document.bytes); assert.equal(verified.downloadedSha256, document.sha256);
    assert.equal(verified.rgbaSha256, lock.pixelSha256); assert(verified.nonwhitePixels > 0 && verified.nonwhitePixels < 612 * 792);
    for (const key of ["firstPageRenderMs", "documentLoadedMs", "pageLoadedMs", "canvasRenderMs"]) assert(Number.isFinite(trial.render[key]) && trial.render[key] > 0);
    assert(trial.render.documentLoadedMs <= trial.render.pageLoadedMs && trial.render.pageLoadedMs <= trial.render.firstPageRenderMs);
    assert.equal(trial.workers.filter((worker: string) => worker.endsWith("/pdfjs/build/pdf.worker.mjs")).length, 1);
    await awaitServerRequests(server, requestStart, op());
    trial.timings.drainCompletedNodeAtMs = performance.now();
    trial.pacing = auditPacing(server.requests.slice(requestStart).filter(request => request.paced), workload.calibration);
    if (trial.block === 1) {
      trial.sample = `samples/${trial.id}-page-001.png`;
      await bounded(writeFile(path.join(output, trial.sample), Buffer.from(png.split(",")[1]!, "base64")), op());
    }
    remaining(deadline);
    trial.operationStatus = "passed";
  } catch (error) { trial.operationStatus = "failed"; trial.error = error instanceof Error ? error.stack : String(error); }
  finally {
    const cleanupDeadline = performance.now() + config.cleanupTimeoutMs;
    try {
      if (!observer) throw new Error("Context setup did not return a cleanup handle");
      await bounded(observer.context.close(), remaining(cleanupDeadline));
      await awaitServerTerminal(server, requestStart, remaining(cleanupDeadline));
    } catch (error) { trial.operationStatus = "failed"; trial.cleanupError = String(error); unsafeCleanup = error; }
    trial.serverRequests = server.requests.slice(requestStart);
    if (trial.operationStatus === "passed") {
      try {
        assert.deepEqual(trial.errors, [], "Browser diagnostics invalidate workload");
        assert(trial.networkEvents.every((event: NetworkEvent) => event.kind !== "failed"));
        assert(trial.serverRequests.every((request: any) => request.status < 400 && request.completed && !request.canceled));
        // This zero boundary is used only for clock-independent HTTP validation.
        // Its temporal buckets are intentionally neither retained nor interpreted.
        const transport = summarizeNetwork(trial.networkEvents, { documentUrl: trial.render.pdfUrl,
          renderBoundary: { lowerSeconds: 0, upperSeconds: 0 } });
        assert(transport.requestCount > 0);
        for (const request of transport.requests) {
          assert(request.completed && !request.failed); assert([200, 206].includes(request.responseStatus!));
          if (request.responseStatus === 206) assert(request.observedRangeResponse, "Invalid Range response");
          const response = trial.networkEvents.find((event: NetworkEvent) => event.requestId === request.requestId && event.kind === "response");
          const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
          assert.equal(headers["content-encoding"] ?? "identity", "identity");
          const bytes = trial.networkEvents.filter((event: NetworkEvent) => event.requestId === request.requestId && event.kind === "data")
            .reduce((sum: number, event: any) => sum + event.dataLength, 0);
          assert.equal(bytes, Number(headers["content-length"]));
        }
        if (!trial.rangeEnabled) assert.equal(transport.range.requestCount, 0);
      } catch (error) { trial.operationStatus = "failed"; trial.error = String(error); }
    }
    trial.finishedAt = now(); trial.timings.finishedNodeAtMs = performance.now();
    trial.timings.trialElapsedMs = trial.timings.finishedNodeAtMs - trial.timings.startedNodeAtMs;
    trial.timings.burstElapsedMsByPoint = Object.fromEntries(trial.bursts.map((burst: any) => [burst.point, burst.finishedNodeAtMs - burst.startedNodeAtMs]));
    trial.timings.bracketSpansMsByPoint = Object.fromEntries(trial.bursts.map((burst: any) => [burst.point,
      burst.samples.map((sample: CalibrationSample) => (sample.afterSeconds - sample.beforeSeconds) * 1000)]));
    trial.timings.bracketSpansTotalMs = trial.bursts.flatMap((burst: any) => burst.samples)
      .reduce((sum: number, sample: CalibrationSample) => sum + (sample.afterSeconds - sample.beforeSeconds) * 1000, 0);
    if (trial.bursts.length === 3) {
      trial.timings.observationWindowMs = trial.bursts[2].finishedNodeAtMs - trial.bursts[0].startedNodeAtMs;
      if (trial.timings.drainCompletedNodeAtMs !== undefined) trial.timings.postObservationDrainMs = trial.timings.drainCompletedNodeAtMs - trial.bursts[2].finishedNodeAtMs;
    }
    trial.timings.observerCollectionMs = Object.values(trial.timings.burstElapsedMsByPoint).reduce((sum: number, value: any) => sum + value, 0);
    if (trial.verification && trial.render) {
      trial.timings.renderToVerificationStartMs = trial.verification.verificationStartedAtMs - trial.render.firstPageRenderedAtMs;
      trial.timings.renderReturnToVerificationCallMs = trial.timings.verificationCallNodeAtMs - trial.timings.renderReturnNodeAtMs;
    }
    analyzeTrial(trial);
  }
  if (unsafeCleanup) throw unsafeCleanup;
}

function counts(trials: any[]) {
  return { attempted: trials.length, operationalPassed: trials.filter(trial => trial.operationStatus === "passed").length,
    operationalFailed: trials.filter(trial => trial.operationStatus !== "passed").length,
    referencePassed: trials.filter(trial => trial.methods?.reference?.status === "passed").length,
    candidatePassed: trials.filter(trial => trial.methods?.candidate?.status === "passed").length };
}

async function main() {
  const { values } = parseArgs({ options: { "output-dir": { type: "string" } } });
  const parent = path.join(ROOT, "results/raw/pdf-clock-observer"); await mkdir(parent, { recursive: true });
  const output = values["output-dir"] ? path.resolve(values["output-dir"]) : await mkdtemp(path.join(parent, "run-"));
  await mkdir(output, { recursive: true }); assert.equal((await readdir(output)).length, 0, "Evidence directory must be empty");
  const report: any = { schemaVersion: 1, purpose: "bounded-pdf-workload-observer-integration-not-performance-replication",
    status: "running", startedAt: now(), sessions: [] };
  const save = () => writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const campaignStarted = performance.now();
  let browser: Browser | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const config = await json(path.join(ROOT, "experiments/pdf-clock-observer.json")); report.experiment = config;
    campaignDeadline = campaignStarted + config.campaignTimeoutMs;
    assert.equal(config.id, "text-100-pdf-clock-observer-v1"); assert.equal(config.sessions, 3); assert.equal(config.blocksPerSession, 4);
    assert.deepEqual(config.points, PDF_CLOCK_POINTS); assert.equal(config.clockResolutionMarginMs, 1); assert.equal(config.maximumBoundaryWidthMs, 5);
    assert.deepEqual(config.arms, [{ id: "three", bracketsPerPoint: 1 }, { id: "fifteen", bracketsPerPoint: 5 }]);
    assert.equal(config.workloadConfig, "experiments/controlled-delivery.json"); assert.equal(process.version, config.expectedNodeVersion);
    const workload = await json(path.join(ROOT, config.workloadConfig)); report.workload = workload;
    const baseline = await json(path.join(ROOT, "experiments/first-page-local.json"));
    const diagnostic = await json(path.join(ROOT, "experiments/partial-loading-local.json"));
    assert.equal(workload.id, "text-100-controlled-delivery-v1"); assert.deepEqual(workload.delivery, PACING_PROFILE);
    assert.deepEqual(workload.observation, diagnostic.observation);
    assert.deepEqual(workload.pdfjs, { ...baseline.pdfjs, rangeChunkSize: 16384 });
    for (const key of ["metric", "profileId", "timeoutMs", "viewport", "deviceScaleFactor", "scale"]) assert.deepEqual(workload[key], baseline[key]);
    const preservation = await verifyPreservation(); report.preservationLock = preservation;
    const { corpus, lock } = await verifyBaseline(); report.baselineLock = lock;
    report.corpus = { manifest: corpus.manifest, manifestSha256: corpus.manifestSha256 };
    const pdfjs = await json(require.resolve("pdfjs-dist/package.json"));
    const playwright = await json(require.resolve("playwright/package.json"));
    assert.equal(pdfjs.version, config.expectedPdfjsVersion); assert.equal(playwright.version, config.expectedPlaywrightVersion);
    report.environment = { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(),
      cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(),
      pdfjs: pdfjs.version, playwright: playwright.version, qpdf: qpdf("--version").split("\n")[0], executableOverride: null };
    report.sourceHashes = {};
    const sources = ["experiments/pdf-clock-observer.json", "experiments/pdf-clock-preservation-lock.json", "docs/pdf-clock-observer.md",
      "experiments/controlled-delivery.json", "experiments/delivery-preservation-lock.json",
      "experiments/first-page-local.json", "experiments/partial-loading-local.json",
      "packages/runner/viewer/partial-loading.mjs", "packages/runner/viewer/index.html",
      "packages/runner/viewer/clock-observer.html", "packages/runner/viewer/clock-observer.mjs"];
    for (const name of ["pdf-clock-observer", "pdf-clock-protocol", "clock-observer-protocol", "delivery-calibration",
      "delivery-protocol", "paced-server", "partial-network", "protocol", "server"]) {
      sources.push(`packages/runner/src/${name}.ts`, `packages/runner/dist/${name}.js`);
    }
    for (const filename of sources) {
      const bytes = await readFile(path.join(ROOT, filename)); report.sourceHashes[filename] = sha256(bytes);
      const target = path.join(output, "source-snapshot", filename); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
    }
    report.schedule = createPdfClockSchedule(); assert.equal(report.schedule.length, 96);
    report.controls = { cache: "fresh context; CDP HTTP cache disabled; no-cache; service workers blocked",
      render: "Unchanged partial-loading viewer and getDocument-to-render promise timer; no observer sampling inside it",
      observation: "Actual one/five-bracket arms; nested reference only in five-bracket arm; independent operation and clock outcomes",
      interpretation: "Instrumentation diagnostic only. Raw event accounting is not exact physical arrival or unique PDF coverage." };
    await mkdir(path.join(output, "samples")); await save();
    for (const ordinal of [1, 2, 3]) {
      remaining(campaignDeadline);
      assert.deepEqual(await verifyPreservation(), preservation);
      for (const [filename, expected] of Object.entries(report.sourceHashes)) assert.equal(sha256(await readFile(path.join(ROOT, filename))), expected);
      const session: any = { session: ordinal, status: "running", startedAt: now(), guardsPassed: false, controls: [], trials: [] };
      report.sessions.push(session); await save();
      const deadline = Math.min(campaignDeadline, performance.now() + config.sessionTimeoutMs);
      try {
        const assets = await bounded(loadAssets(corpus.files), Math.min(config.operationTimeoutMs, remaining(deadline)));
        server = await bounded(startServer(assets), Math.min(config.operationTimeoutMs, remaining(deadline))); session.origin = server.origin;
        browser = await chromium.launch({ headless: true, timeout: Math.min(config.operationTimeoutMs, remaining(deadline)) });
        session.chromium = browser.version(); assert.equal(session.chromium, config.expectedChromiumVersion);
        report.environment.chromium ??= session.chromium;
        await runControls(browser, server, workload, config, session, "before", deadline, save);
        for (const entry of report.schedule.filter((item: any) => item.session === ordinal)) {
          remaining(deadline);
          const trial: any = { ...entry }; session.trials.push(trial);
          try { await runTrial(browser, server, config, workload, corpus, lock, trial, output, deadline); }
          finally { report.environment.userAgent ??= trial.userAgent; await save(); }
          console.log(`${trial.id}: operations=${trial.operationStatus}; reference=${trial.methods.reference.status} (${trial.methods.reference.clock.widthMs?.toFixed(3) ?? "no interval"} ms); candidate=${trial.methods.candidate?.status ?? "not collected"}`);
        }
        await runControls(browser, server, workload, config, session, "after", deadline, save);
        session.guardsPassed = true; session.status = "complete";
      } catch (error) { session.status = "incomplete"; session.error = String(error); throw error; }
      finally {
        const cleanup = await Promise.allSettled([
          bounded(Promise.resolve(browser?.close()), config.cleanupTimeoutMs),
          bounded(Promise.resolve(server?.close()), config.cleanupTimeoutMs),
        ]);
        session.serverRequests = server?.requests ?? []; session.finishedAt = now();
        const failures = cleanup.filter(item => item.status === "rejected");
        browser = undefined; server = undefined;
        if (failures.length) {
          session.status = "incomplete"; session.cleanupErrors = failures.map(item => String(item.reason));
          await save(); throw new Error("Bounded session cleanup failed");
        }
        await save();
      }
    }
    assert.deepEqual(await verifyPreservation(), preservation);
    remaining(campaignDeadline);
    const final = await verifyBaseline(); assert.deepEqual(final.lock, lock); assert.equal(final.corpus.manifestSha256, corpus.manifestSha256);
    for (const [filename, expected] of Object.entries(report.sourceHashes)) assert.equal(sha256(await readFile(path.join(ROOT, filename))), expected);
    remaining(campaignDeadline);
    report.preservedFilesUnchanged = true; report.integrationSourcesUnchanged = true;
    report.status = "complete";
  } catch (error) {
    report.status = "incomplete"; report.error = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1; console.error(report.error);
  } finally {
    const trials = report.sessions.flatMap((session: any) => session.trials);
    const ids = new Set(trials.map((trial: any) => trial.id));
    report.unattemptedControls = [1, 2, 3].flatMap(session => ["before", "after"].map(stage => ({ session, stage })))
      .filter(entry => !report.sessions.find((session: any) => session.session === entry.session)?.controls.some((control: any) => control.stage === entry.stage));
    report.unattemptedTrials = (report.schedule ?? createPdfClockSchedule()).filter((entry: any) => !ids.has(entry.id));
    report.summary = { ...counts(trials), bySession: report.sessions.map((session: any) => ({ session: session.session, ...counts(session.trials) })),
      byArm: Object.fromEntries(["three", "fifteen"].map(arm => [arm, counts(trials.filter((trial: any) => trial.arm === arm))])),
      interpretation: "Collection completion, operational validity and clock acceptance are distinct. Descriptive comparisons require independent audit of both session guards and pair workloads; clock rejection alone must not filter timing pairs." };
    report.finishedAt = now(); await save(); console.log(`PDF clock observer report: ${path.join(output, "report.json")}`);
  }
}

main().then(() => { if (process.exitCode) process.exit(process.exitCode); })
  .catch(error => { console.error(error); process.exit(1); });

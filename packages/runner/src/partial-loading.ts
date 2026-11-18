import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from "playwright";
import { startServer } from "./server.js";
import { createSchedule, VARIANTS } from "./protocol.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKAGE = path.join(ROOT, "packages/runner");
const require = createRequire(import.meta.url);
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const json = async (filename: string) => JSON.parse(await readFile(filename, "utf8"));
const qpdf = (...args: string[]) => execFileSync("qpdf", args, { encoding: "utf8", timeout: 60000 }).trim();

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
  const assets = new Map<string, { body: Buffer; contentType: string; range?: boolean }>();
  for (const [filename, body] of files) {
    assets.set(`/pdf/${filename}`, { body, contentType: "application/pdf", range: true });
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
  return assets;
}

async function verifyBaseline() {
  const lock = await json(path.join(ROOT, "experiments/first-page-baseline-lock.json"));
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
  const timestamp = async () => {
    const { metrics } = await bounded(cdp.send("Performance.getMetrics"), timeoutMs);
    const value = metrics.find(metric => metric.name === "Timestamp")?.value;
    assert(value !== undefined && Number.isFinite(value), "Missing CDP monotonic Timestamp");
    return value;
  };
  const beforeSeconds = await timestamp();
  const { result, exceptionDetails } = await bounded(cdp.send("Runtime.evaluate", {
    expression: "performance.now()", returnByValue: true,
  }), timeoutMs);
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
    if (!pathname.startsWith("/pdf/") && pathname !== "/diagnostic/probe.bin") return;
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
  const deadline = Date.now() + timeoutMs;
  while (true) {
    await bounded(cdp.send("Performance.getMetrics"), Math.max(1, deadline - Date.now()));
    const requests = events.filter(event => event.kind === "request");
    const done = new Set(events.filter(event => ["finished", "failed"].includes(event.kind)).map(event => event.requestId));
    if (requests.length && requests.every(event => done.has(event.requestId))) return;
    assert(Date.now() < deadline, "CDP request completion evidence timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function alignClock(samples: CalibrationSample[], pageTimeMs: number, experiment: any) {
  const margin = experiment.observation.clockResolutionMarginMs;
  const offset = calibrateOffset(samples, margin);
  const boundary = mapPageTime(pageTimeMs, offset, margin);
  const widthMs = (boundary.upperSeconds - boundary.lowerSeconds) * 1000;
  assert(widthMs <= experiment.observation.maximumBoundaryWidthMs, "Clock boundary too imprecise");
  return { samples, offset, boundary, widthMs, resolutionMarginMs: margin,
    interpretation: "Interval assumes stable page/CDP monotonic offset plus explicit clock-resolution margins; nearby events remain uncertain." };
}

async function runObserverProbe(browser: Browser, origin: string, experiment: any, record: any) {
  const observer = await bounded(observedPage(browser, experiment, record), experiment.timeoutMs);
  record.clockSamples = [];
  try {
    await observer.page.goto(origin, { waitUntil: "load", timeout: experiment.timeoutMs });
    const before = await clockSample(observer.cdp, experiment.timeoutMs);
    record.clockSamples.push(before);
    const result = await bounded(observer.page.evaluate(async ({ origin, gap }) => {
      const fetchRange = async (label: string, first: number, last: number) => {
        const url = `${origin}/diagnostic/probe.bin?phase=${label}`;
        const response = await fetch(url, { headers: { Range: `bytes=${first}-${last}` } });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (response.status !== 206 || response.headers.get("Content-Range") !== `bytes ${first}-${last}/49152`
          || (response.headers.get("Content-Encoding") ?? "identity") !== "identity"
          || bytes.length !== last - first + 1
          || !bytes.every((value, index) => value === ((Math.floor((first + index) / 4) >>> (8 * ((first + index) % 4))) & 255))) {
          throw new Error("Known range probe returned unexpected content");
        }
        return { url, status: response.status, contentRange: response.headers.get("Content-Range"), bytes: bytes.length };
      };
      const first = await fetchRange("before", 0, 4095);
      await new Promise(resolve => setTimeout(resolve, gap));
      const markerMs = performance.now();
      await new Promise(resolve => setTimeout(resolve, gap));
      const second = await fetchRange("after", 4096, 8191);
      return { first, second, markerMs, timeOriginMs: performance.timeOrigin };
    }, { origin, gap: experiment.observation.probeSeparationMs }), experiment.timeoutMs);
    record.result = result;
    const after = await clockSample(observer.cdp, experiment.timeoutMs);
    record.clockSamples.push(after);
    await awaitTerminalEvents(observer.cdp, observer.events, experiment.timeoutMs);
    record.clock = alignClock([before, after], result.markerMs, experiment);
    record.first = summarizeNetwork(observer.events, { documentUrl: result.first.url, renderBoundary: record.clock.boundary });
    record.second = summarizeNetwork(observer.events, { documentUrl: result.second.url, renderBoundary: record.clock.boundary });
    for (const [summary, phase] of [[record.first, "at-or-before"], [record.second, "after"]] as const) {
      assert.equal(summary.range.requestCount, 1);
      assert.equal(summary.range.observed206Count, 1);
      assert.equal(summary.byRenderTime[phase].reportedDataBytes, 4096);
      assert.equal(summary.byRenderTime[phase].requestStarts, 1);
      assert.equal(summary.byRenderTime[phase].loadingFinished, 1);
      assert.equal(summary.byRenderTime.uncertain.reportedDataBytes, 0);
      assert.equal(summary.byRenderTime[phase === "after" ? "at-or-before" : "after"].reportedDataBytes, 0);
    }
  } finally {
    await bounded(observer.context.close(), experiment.timeoutMs);
    assert.deepEqual(record.errors, [], "Probe browser diagnostics invalidate observer");
  }
  record.status = "passed";
}

async function main() {
  const { values } = parseArgs({ options: { "output-dir": { type: "string" } } });
  const parent = path.join(ROOT, "results/raw/partial-loading-local");
  await mkdir(parent, { recursive: true });
  const output = values["output-dir"] ? path.resolve(values["output-dir"]) : await mkdtemp(path.join(parent, "run-"));
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, "Evidence directory must be empty");
  const report: any = { schemaVersion: 1, purpose: "partial-loading-diagnostic-not-performance-comparison",
    status: "running", startedAt: new Date().toISOString(), trials: [] };
  const save = () => writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  let browser: Browser | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const experiment = await json(path.join(ROOT, "experiments/partial-loading-local.json"));
    const baseline = await json(path.join(ROOT, "experiments/first-page-local.json"));
    assert.equal(experiment.id, "text-100-partial-loading-local-v1");
    assert.equal(experiment.warmupPairs, 0); assert.equal(experiment.measuredPairs, 2);
    assert.deepEqual(experiment.pdfjs, { ...baseline.pdfjs, rangeChunkSize: 16384 });
    for (const key of ["metric", "profileId", "timeoutMs", "viewport", "deviceScaleFactor", "scale"]) {
      assert.deepEqual(experiment[key], baseline[key], `Changed baseline control: ${key}`);
    }
    report.experiment = experiment;
    const { corpus, lock } = await verifyBaseline();
    report.baselineLock = lock; report.corpus = { manifest: corpus.manifest, manifestSha256: corpus.manifestSha256 };
    const pdfjs = await json(require.resolve("pdfjs-dist/package.json"));
    const playwright = await json(require.resolve("playwright/package.json"));
    report.environment = { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(),
      cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), pdfjs: pdfjs.version,
      playwright: playwright.version, qpdf: qpdf("--version").split("\n")[0], executableOverride: null };
    report.sourceHashes = {};
    for (const filename of ["experiments/partial-loading-local.json", "experiments/first-page-baseline-lock.json",
      "packages/runner/src/partial-loading.ts", "packages/runner/src/partial-network.ts", "packages/runner/viewer/partial-loading.mjs",
      "packages/runner/dist/partial-loading.js", "packages/runner/dist/partial-network.js"]) {
      report.sourceHashes[filename] = sha256(await readFile(path.join(ROOT, filename)));
    }
    report.controls = { pdfDelivery: "unthrottled loopback HTTP; identical original PDFs; no compression; range-capable server",
      cache: "fresh context per diagnostic trial; CDP HTTP cache disabled; no-cache responses; service workers blocked",
      collection: "real dedicated PDF worker; timestamped CDP events; render returned before explicit full-document verification",
      interpretation: "CDP event-accounted bytes and completed Resource Timing entries are not exact physical arrival or unique PDF coverage" };
    server = await startServer(await loadAssets(corpus.files)); report.origin = server.origin;
    browser = await chromium.launch({ headless: true }); report.environment.chromium = browser.version();
    assert.equal(report.environment.pdfjs, "5.6.205"); assert.equal(report.environment.playwright, "1.62.1");
    assert.equal(report.environment.chromium, "151.0.7922.34");
    report.observerProbe = { status: "running", excludedFromPdfTrials: true };
    await runObserverProbe(browser, server.origin, experiment, report.observerProbe);
    await save();
    console.log("Observer probe passed: two known 4096-byte ranges classified before/after the marker.");
    const schedule = createSchedule(0, 2); report.schedule = schedule;
    await mkdir(path.join(output, "samples"));
    for (const entry of schedule) {
      const trial: any = { ...entry, status: "running", clockSamples: [] }; report.trials.push(trial);
      const requestStart = server.requests.length;
      const observer = await bounded(observedPage(browser, experiment, trial), experiment.timeoutMs);
      try {
        await observer.page.goto(server.origin, { waitUntil: "load", timeout: experiment.timeoutMs });
        await observer.page.waitForFunction("typeof window.runPartialFirstPage === 'function'", null, { timeout: experiment.timeoutMs });
        report.environment.userAgent ??= await observer.page.evaluate(() => navigator.userAgent);
        const before = await clockSample(observer.cdp, experiment.timeoutMs);
        trial.clockSamples.push(before);
        const url = `${server.origin}/pdf/text-100-${entry.variant}.pdf?trial=${entry.id}`;
        trial.render = await bounded(observer.page.evaluate(async (input) => {
          return (window as any).runPartialFirstPage(input);
        }, { url, scale: experiment.scale, options: experiment.pdfjs }), experiment.timeoutMs);
        const afterRender = await clockSample(observer.cdp, experiment.timeoutMs);
        trial.clockSamples.push(afterRender);
        // Return/control boundary: no getData call has run at this snapshot.
        trial.eventCountBeforeExplicitVerification = observer.events.length;
        const verification: any = await bounded(observer.page.evaluate(async () => (window as any).verifyPartialDocument()), experiment.timeoutMs);
        const afterVerification = await clockSample(observer.cdp, experiment.timeoutMs);
        trial.clockSamples.push(afterVerification);
        const { png, ...verified } = verification; trial.verification = verified;
        await awaitTerminalEvents(observer.cdp, observer.events, experiment.timeoutMs);
        trial.clock = alignClock([before, afterRender, afterVerification], trial.render.firstPageRenderedAtMs, experiment);
        const verificationBoundary = mapPageTime(verified.verificationStartedAtMs, trial.clock.offset, experiment.observation.clockResolutionMarginMs);
        trial.clock.verificationBoundary = verificationBoundary;
        assert.equal(trial.render.timeOriginMs, verified.timeOriginMs);
        assert(trial.render.firstPageRenderedAtMs <= verified.verificationStartedAtMs);
        trial.network = summarizeNetwork(observer.events, { documentUrl: url, renderBoundary: trial.clock.boundary, verificationBoundary });
        const document = corpus.manifest.documents.find((item: any) => item.id === `text-100-${entry.variant}`);
        assert(document.bytes > 2 * experiment.pdfjs.rangeChunkSize);
        trial.rangeEligible = true;
        assert.equal(trial.render.numPages, 100); assert.equal(trial.render.width, 612); assert.equal(trial.render.height, 792);
        assert.equal(trial.render.devicePixelRatio, 1); assert.equal(trial.render.pdfjsVersion, pdfjs.version);
        assert.equal(verified.downloadedBytes, document.bytes); assert.equal(verified.downloadedSha256, document.sha256);
        assert.equal(verified.rgbaSha256, lock.pixelSha256); assert(verified.nonwhitePixels > 0 && verified.nonwhitePixels < 612 * 792);
        for (const key of ["firstPageRenderMs", "documentLoadedMs", "pageLoadedMs", "canvasRenderMs"]) {
          assert(Number.isFinite(trial.render[key]) && trial.render[key] > 0);
        }
        assert(trial.render.documentLoadedMs <= trial.render.pageLoadedMs && trial.render.pageLoadedMs <= trial.render.firstPageRenderMs);
        assert.equal(trial.workers.filter((worker: string) => worker.endsWith("/pdfjs/build/pdf.worker.mjs")).length, 1);
        if (entry.pair === 1) {
          trial.sample = `samples/${entry.variant}-page-001.png`;
          await writeFile(path.join(output, trial.sample), Buffer.from(png.split(",")[1]!, "base64"));
        }
      } catch (error) {
        trial.status = "failed"; trial.error = String(error); throw error;
      } finally {
        await bounded(observer.context.close(), experiment.timeoutMs); trial.serverRequests = server.requests.slice(requestStart); await save();
      }
      assert.deepEqual(trial.errors, [], "Browser diagnostics invalidate trial");
      assert(trial.networkEvents.every((event: NetworkEvent) => event.kind !== "failed"));
      assert(trial.serverRequests.every((request: any) => request.status < 400 && request.completed));
      // Recompute after closing the context so late-delivered events are retained.
      trial.network = summarizeNetwork(trial.networkEvents, { documentUrl: trial.render.pdfUrl,
        renderBoundary: trial.clock.boundary, verificationBoundary: trial.clock.verificationBoundary });
      assert(trial.network.requestCount > 0);
      for (const request of trial.network.requests) {
        assert(request.completed && !request.failed, "Incomplete PDF request");
        assert([200, 206].includes(request.responseStatus), "Unexpected PDF response");
        if (request.responseStatus === 206) assert(request.observedRangeResponse, "Invalid range response evidence");
        const response = trial.networkEvents.find((event: NetworkEvent) => event.requestId === request.requestId && event.kind === "response");
        const getHeader = (name: string) => Object.entries(response.headers).find(([key]) => key.toLowerCase() === name)?.[1];
        assert.equal(getHeader("content-encoding") ?? "identity", "identity");
        const reportedBytes = trial.networkEvents.filter((event: NetworkEvent) => event.requestId === request.requestId && event.kind === "data")
          .reduce((sum: number, event: any) => sum + event.dataLength, 0);
        assert.equal(reportedBytes, Number(getHeader("content-length")), "CDP reported body total differs from response length");
      }
      trial.status = "passed"; await save();
      console.log(`${entry.pair}/${entry.position} ${entry.variant}: ${trial.render.firstPageRenderMs.toFixed(2)} ms; `
        + `${trial.network.range.requestCount} Range requests; ${trial.network.range.observed206Count} validated 206 responses`);
    }
    const final = await verifyBaseline();
    assert.deepEqual(final.lock, lock, "Baseline expectations changed during execution");
    assert.equal(final.corpus.manifestSha256, corpus.manifestSha256);
    for (const [filename, hash] of Object.entries(report.sourceHashes)) {
      assert.equal(sha256(await readFile(path.join(ROOT, filename))), hash, `Diagnostic source changed during execution: ${filename}`);
    }
    report.baselineAndCorpusUnchanged = true; report.diagnosticSourcesUnchanged = true;
    report.status = "passed";
    report.summary = { diagnosticTrials: report.trials.length, rangeRequests: report.trials.reduce((n: number, t: any) => n + t.network.range.requestCount, 0),
      observed206Responses: report.trials.reduce((n: number, t: any) => n + t.network.range.observed206Count, 0),
      conclusion: "Interpret per-trial timestamped evidence; range eligibility alone is not a performance result.",
      exactBytesReceivedAtFirstRender: "not established; report contains event-accounted bytes with clock uncertainty" };
  } catch (error) {
    report.status = "failed"; report.error = error instanceof Error ? error.stack : String(error);
    for (const trial of report.trials) if (trial.status === "running") {
      trial.status = "failed"; trial.error = report.error;
    }
    if (report.observerProbe?.status === "running") {
      report.observerProbe.status = "failed"; report.observerProbe.error = report.error;
    }
    process.exitCode = 1; console.error(report.error);
  } finally {
    const cleanup = await Promise.allSettled([
      bounded(Promise.resolve(browser?.close()), 30000), bounded(Promise.resolve(server?.close()), 30000),
    ]);
    const failures = cleanup.filter(item => item.status === "rejected");
    if (failures.length) { report.status = "failed"; report.cleanupErrors = failures.map(item => String(item.reason)); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); await save();
    console.log(`Diagnostic report: ${path.join(output, "report.json")}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

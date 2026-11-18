import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { startServer } from "./server.js";
import { createSchedule, summarizeTrials, VARIANTS } from "./protocol.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKAGE = path.join(ROOT, "packages/runner");
const require = createRequire(import.meta.url);
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const json = async (filename: string) => JSON.parse(await readFile(filename, "utf8"));
const qpdf = (...args: string[]) => execFileSync("qpdf", args, { encoding: "utf8", timeout: 60000 }).trim();

interface RenderResult {
  firstPageRenderMs: number;
  documentLoadedMs: number;
  pageLoadedMs: number;
  canvasRenderMs: number;
  numPages: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  pdfjsVersion: string;
  downloadedBytes: number;
  downloadedSha256: string;
  rgbaSha256: string;
  nonwhitePixels: number;
  png: string;
}

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
  assets.set("/viewer.mjs", { body: await readFile(path.join(PACKAGE, "viewer/viewer.mjs")), contentType: "text/javascript; charset=utf-8" });
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
  return assets;
}

async function main() {
  const { values } = parseArgs({ options: {
    "output-dir": { type: "string" },
    "chromium-executable": { type: "string" },
  } });
  const parent = path.join(ROOT, "results/raw/first-page-local");
  await mkdir(parent, { recursive: true });
  const output = values["output-dir"] ? path.resolve(values["output-dir"]) : await mkdtemp(path.join(parent, "run-"));
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, "Evidence directory must be empty");
  const report: Record<string, any> = {
    schemaVersion: 1, status: "running", purpose: "local-first-page-render-pilot",
    startedAt: new Date().toISOString(), trials: [],
  };
  const save = async () => writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  let browser: Browser | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const experiment = await json(path.join(ROOT, "experiments/first-page-local.json"));
    assert.equal(experiment.id, "text-100-first-page-local-v1");
    assert.equal(experiment.scale, 1);
    assert.equal(experiment.deviceScaleFactor, 1);
    const schedule = createSchedule(experiment.warmupPairs, experiment.measuredPairs);
    report.experiment = experiment;
    report.schedule = schedule;
    const corpus = await loadCorpus();
    report.corpus = { manifest: corpus.manifest, manifestSha256: corpus.manifestSha256 };
    const pdfjsPackage = await json(require.resolve("pdfjs-dist/package.json"));
    const playwrightPackage = await json(require.resolve("playwright/package.json"));
    const playwrightRequire = createRequire(require.resolve("playwright/package.json"));
    const browserRegistry = await json(path.join(path.dirname(playwrightRequire.resolve("playwright-core/package.json")), "browsers.json"));
    report.environment = {
      node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(),
      cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(),
      pdfjs: pdfjsPackage.version, playwright: playwrightPackage.version, qpdf: qpdf("--version").split("\n")[0],
      declaredChromium: browserRegistry.browsers.filter((b: { name: string }) => b.name === "chromium-headless-shell"),
      executableOverride: values["chromium-executable"] ?? null,
    };
    report.sourceHashes = {};
    for (const filename of ["package.json", "pnpm-lock.yaml", "experiments/first-page-local.json", "packages/runner/package.json", "packages/runner/src/run.ts", "packages/runner/src/server.ts", "packages/runner/src/protocol.ts", "packages/runner/dist/run.js", "packages/runner/dist/server.js", "packages/runner/dist/protocol.js", "packages/runner/viewer/index.html", "packages/runner/viewer/viewer.mjs"]) {
      report.sourceHashes[filename] = sha256(await readFile(path.join(ROOT, filename)));
    }
    report.controls = {
      delivery: "loopback HTTP; range capable; preloaded identical bytes; no compression or throttling",
      cache: "new nonpersistent context for every trial; CDP HTTP cache disabled; all responses no-cache; service workers blocked",
      order: "serial pairs, alternating nonlinearized/linearized then linearized/nonlinearized",
      worker: "new real dedicated PDF.js worker per trial; startup included",
      timing: experiment.metric,
      excludes: ["navigation", "main PDF.js module import", "browser launch", "downloaded PDF readback/hash", "pixel readback/hash", "PNG capture", "compositor presentation"],
    };
    report.limitations = [
      "Local headless pilot; no production or network-latency inference or statistical significance claim.",
      "Fresh browser contexts do not clear OS/font caches or restart the shared browser process.",
      "Canvas render promise completion is not compositor presentation, first contentful paint or full-document rendering.",
      "Standard Helvetica is unembedded; default browser system-font behavior is environment-dependent.",
      "Both PDFs are below twice the default 65536-byte range chunk; PDF.js therefore uses full responses in this experiment.",
    ];
    server = await startServer(await loadAssets(corpus.files));
    report.origin = server.origin;
    browser = await chromium.launch({ headless: true, ...(values["chromium-executable"] ? { executablePath: values["chromium-executable"] } : {}) });
    report.environment.chromium = browser.version();
    await mkdir(path.join(output, "samples"));
    let expectedPixels: string | undefined;
    for (const entry of schedule) {
      const trial: Record<string, any> = { ...entry, status: "running", errors: [], workers: [] };
      report.trials.push(trial);
      const startRequest = server.requests.length;
      const context: BrowserContext = await browser.newContext({
        viewport: experiment.viewport, deviceScaleFactor: experiment.deviceScaleFactor,
        serviceWorkers: "block", locale: "en-US", timezoneId: "UTC", colorScheme: "light",
      });
      try {
        const page: Page = await context.newPage();
        page.on("pageerror", error => trial.errors.push(error.message));
        page.on("console", message => {
          if (["warning", "error"].includes(message.type())) trial.errors.push(`${message.type()}: ${message.text()}`);
        });
        page.on("requestfailed", request => trial.errors.push(`requestfailed: ${request.url()}: ${request.failure()?.errorText}`));
        page.on("worker", worker => trial.workers.push(worker.url()));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await page.goto(server.origin, { waitUntil: "load", timeout: experiment.timeoutMs });
        await page.waitForFunction("typeof window.runFirstPage === 'function'", null, { timeout: experiment.timeoutMs });
        if (!report.environment.userAgent) report.environment.userAgent = await page.evaluate(() => navigator.userAgent);
        const url = `${server.origin}/pdf/text-100-${entry.variant}.pdf?trial=${entry.id}`;
        const pending: Promise<RenderResult> = page.evaluate(async ({ url, scale, options }) => {
          const run = (window as unknown as { runFirstPage: (input: unknown) => Promise<RenderResult> }).runFirstPage;
          return await run({ url, scale, options });
        }, { url, scale: experiment.scale, options: experiment.pdfjs });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result: RenderResult = await Promise.race([
          pending,
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Trial exceeded ${experiment.timeoutMs}ms`)), experiment.timeoutMs); }),
        ]).finally(() => clearTimeout(timeout));
        const { png, ...measurements } = result;
        Object.assign(trial, measurements);
        assert.equal(result.numPages, 100);
        assert.equal(result.width, 612);
        assert.equal(result.height, 792);
        assert.equal(result.devicePixelRatio, 1);
        assert.equal(result.pdfjsVersion, pdfjsPackage.version);
        const expectedDocument = corpus.manifest.documents.find((document: { id: string }) => document.id === `text-100-${entry.variant}`);
        assert.equal(result.downloadedBytes, expectedDocument.bytes, "Browser PDF size differs");
        assert.equal(result.downloadedSha256, expectedDocument.sha256, "Browser PDF bytes differ");
        assert(result.nonwhitePixels > 0 && result.nonwhitePixels < result.width * result.height);
        assert.equal(trial.workers.filter((url: string) => url.endsWith("/pdfjs/build/pdf.worker.mjs")).length, 1, "Expected real dedicated PDF worker");
        assert.deepEqual(trial.errors, [], "Browser diagnostics invalidate trial");
        for (const key of ["firstPageRenderMs", "documentLoadedMs", "pageLoadedMs", "canvasRenderMs"] as const) {
          assert(Number.isFinite(result[key]) && result[key] > 0, `Invalid ${key}`);
        }
        assert(result.documentLoadedMs <= result.pageLoadedMs && result.pageLoadedMs <= result.firstPageRenderMs);
        if (expectedPixels === undefined) expectedPixels = result.rgbaSha256;
        assert.equal(result.rgbaSha256, expectedPixels, "First-page pixels differ across trials/variants");
        if (entry.phase === "measured" && entry.pair === 1) {
          const name = `${entry.variant}-page-001.png`;
          await writeFile(path.join(output, "samples", name), Buffer.from(png.split(",")[1]!, "base64"));
          trial.sample = `samples/${name}`;
        }
      } catch (error) {
        trial.status = "failed";
        trial.error = String(error);
        throw error;
      } finally {
        await context.close();
        trial.requests = server.requests.slice(startRequest);
        await save();
      }
      try {
        const pdfRequests = trial.requests.filter((request: { url: string }) => request.url.startsWith("/pdf/"));
        assert(pdfRequests.length > 0, "PDF never requested over HTTP");
        assert(pdfRequests.every((request: { status: number; completed: boolean }) => [200, 206].includes(request.status) && request.completed), "PDF delivery failed");
        assert(trial.requests.every((request: { status: number }) => request.status < 400), "HTTP asset failure");
        assert.deepEqual(trial.errors, [], "Late browser errors invalidate trial");
        trial.status = "passed";
      } catch (error) {
        trial.status = "failed";
        trial.error = String(error);
        throw error;
      } finally {
        await save();
      }
      console.log(`${entry.phase} ${entry.pair}/${entry.position} ${entry.variant}: ${trial.firstPageRenderMs.toFixed(2)} ms`);
    }
    const finalCorpus = await loadCorpus();
    assert.equal(finalCorpus.manifestSha256, corpus.manifestSha256);
    for (const [filename, original] of corpus.files) assert(original.equals(finalCorpus.files.get(filename)!));
    report.corpusUnchanged = true;
    report.pixelValidation = { status: "passed", rgbaSha256: expectedPixels, comparedTrials: schedule.length };
    report.summary = summarizeTrials(report.trials, experiment.measuredPairs);
    report.networkSummary = {
      pdfRequests: report.trials.flatMap((trial: any) => trial.requests.filter((request: { url: string }) => request.url.startsWith("/pdf/"))).length,
      rangeRequests: report.trials.flatMap((trial: any) => trial.requests.filter((request: { url: string; range: string | null }) => request.url.startsWith("/pdf/") && request.range !== null)).length,
    };
    report.status = "passed";
    console.log(JSON.stringify(report.summary, null, 2));
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
    console.error(report.error);
  } finally {
    const cleanup = await Promise.allSettled([browser?.close(), server?.close()]);
    const failures = cleanup.filter(result => result.status === "rejected");
    if (failures.length) {
      report.status = "failed";
      report.cleanupErrors = failures.map(result => String(result.reason));
      process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString();
    await save();
    console.log(`Benchmark report: ${path.join(output, "report.json")}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

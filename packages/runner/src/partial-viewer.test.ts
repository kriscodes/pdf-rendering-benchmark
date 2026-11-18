import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const viewerSource = await readFile(new URL("../viewer/partial-loading.mjs", import.meta.url), "utf8");
const importLine = 'import * as pdfjs from "/pdfjs/build/pdf.mjs";';
assert(viewerSource.startsWith(importLine));
// Run the browser module's unchanged body against deterministic DOM/PDF.js
// doubles. This tests the phase contract, not browser rendering or networking.
const executableSource = viewerSource.slice(importLine.length);
const pdfUrl = "http://127.0.0.1:1234/pdf/pair.pdf?trial=one";

function setup({ renderFails = false, verificationFails = false } = {}) {
  const events: string[] = [];
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const pixels = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  let clock = 90;
  let releaseRender!: () => void;
  const renderPending = new Promise<void>(resolve => { releaseRender = resolve; });
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ getImageData: () => { events.push("pixels"); return { data: pixels }; } }),
    toDataURL: () => { events.push("png"); return "data:image/png;base64,dGVzdA=="; },
  };
  const pdfDocument = {
    numPages: 100,
    getPage: async (number: number) => {
      assert.equal(number, 1);
      events.push("getPage");
      return {
        getViewport: ({ scale }: { scale: number }) => {
          assert.equal(scale, 1);
          return { width: 612, height: 792 };
        },
        render: () => {
          events.push("render");
          return { promise: renderPending.then(() => {
            if (renderFails) throw new Error("render failed");
            events.push("render-resolved");
          }) };
        },
      };
    },
    getData: async () => {
      events.push("getData");
      if (verificationFails) throw new Error("verification failed");
      return bytes;
    },
  };
  const resource = (name: string, responseEnd: number, decodedBodySize: number) => ({
    name, responseEnd, decodedBodySize, initiatorType: "fetch", startTime: 110,
    responseStart: 120, duration: responseEnd - 110,
    transferSize: decodedBodySize + 300, encodedBodySize: decodedBodySize,
  });
  const window: Record<string, any> = { devicePixelRatio: 1, location: { href: "http://127.0.0.1:1234/" } };
  const pdfjs = {
    version: "5.6.205", GlobalWorkerOptions: {} as Record<string, string>,
    getDocument: (options: Record<string, unknown>) => {
      events.push("getDocument");
      assert.equal(options.url, pdfUrl);
      assert.equal(options.rangeChunkSize, 16384);
      return { promise: Promise.resolve(pdfDocument) };
    },
  };
  const context = vm.createContext({
    window, pdfjs, URL, crypto: webcrypto,
    document: { getElementById: (id: string) => id === "page" ? canvas : null },
    performance: {
      timeOrigin: 1_000_000,
      now: () => { clock += 10; return clock; },
      mark: (name: string, options: { startTime: number }) => { events.push(`mark:${name}:${options.startTime}`); },
      getEntriesByType: (type: string) => {
        assert.equal(type, "resource");
        return [resource(pdfUrl, 139, 2048), resource(pdfUrl, 141, 4096),
          resource(pdfUrl, 0, 0), resource("http://127.0.0.1:1234/worker.mjs", 130, 5000)];
      },
    },
  });
  new vm.Script(executableSource, { filename: "partial-loading.mjs" }).runInContext(context);
  return { window, events, bytes, pixels, pdfDocument, pdfjs, releaseRender };
}

test("first render returns timing and completed-resource evidence without full-document verification", async () => {
  const fixture = setup();
  const pending = fixture.window.runPartialFirstPage({ url: pdfUrl, scale: 1, options: { rangeChunkSize: 16384 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.events, ["getDocument", "getPage", "render"]);
  fixture.releaseRender();
  const result = await pending;
  assert.equal(result.timeOriginMs, 1_000_000);
  assert.equal(result.startedAtMs, 100);
  assert.equal(result.firstPageRenderedAtMs, 140);
  assert.equal(result.firstPageRenderMs, 40);
  assert.equal(result.documentLoadedMs, 10);
  assert.equal(result.pageLoadedMs, 20);
  assert.equal(result.canvasRenderMs, 10);
  assert.equal(result.width, 612);
  assert.equal(result.height, 792);
  assert.equal(result.numPages, 100);
  assert.equal(result.resourceTimingAtRender.cutoffMs, 140);
  assert.equal(result.resourceTimingAtRender.capturedAtMs, 150);
  assert.equal(result.resourceTimingAtRender.completedEntries.length, 1);
  assert.equal(result.resourceTimingAtRender.decodedBodyBytesForCompletedEntries, 2048);
  assert.match(result.resourceTimingAtRender.interpretation, /not exact bytes received/);
  assert(!fixture.events.includes("getData"));
  assert(!fixture.events.includes("pixels"));
  assert(!fixture.events.includes("png"));
  assert.equal(fixture.window.partialDocument, fixture.pdfDocument);
  assert(fixture.window.loadingTask);
  assert.equal(fixture.pdfjs.GlobalWorkerOptions.workerSrc, "/pdfjs/build/pdf.worker.mjs");
});

test("explicit verification starts after render and hashes PDF bytes and pixels", async () => {
  const fixture = setup();
  fixture.releaseRender();
  const rendered = await fixture.window.runPartialFirstPage({ url: pdfUrl, scale: 1, options: { rangeChunkSize: 16384 } });
  const result = await fixture.window.verifyPartialDocument();
  assert(result.verificationStartedAtMs > rendered.firstPageRenderedAtMs);
  assert.equal(result.verificationStartedAtMs, 160);
  assert.equal(result.downloadedBytes, fixture.bytes.length);
  assert.equal(result.downloadedSha256, createHash("sha256").update(fixture.bytes).digest("hex"));
  assert.equal(result.rgbaSha256, createHash("sha256").update(fixture.pixels).digest("hex"));
  assert.equal(result.nonwhitePixels, 1);
  assert.equal(result.png, "data:image/png;base64,dGVzdA==");
  assert(fixture.events.indexOf("mark:partial-verification-started:160") < fixture.events.indexOf("getData"));
  await assert.rejects(fixture.window.verifyPartialDocument(), /one verification call/);
  await assert.rejects(fixture.window.runPartialFirstPage({}), /fresh page\/context/);
});

test("verification cannot run before a successful render or while rendering", async () => {
  const fixture = setup();
  await assert.rejects(fixture.window.verifyPartialDocument(), /successful render/);
  const pending = fixture.window.runPartialFirstPage({ url: pdfUrl, scale: 1, options: { rangeChunkSize: 16384 } });
  await assert.rejects(fixture.window.verifyPartialDocument(), /successful render/);
  await assert.rejects(fixture.window.runPartialFirstPage({}), /fresh page\/context/);
  fixture.releaseRender();
  await pending;
  assert(!fixture.events.includes("getData"));
});

test("failed rendering or full-document verification remains a failure", async () => {
  const rendering = setup({ renderFails: true });
  rendering.releaseRender();
  await assert.rejects(rendering.window.runPartialFirstPage({ url: pdfUrl, scale: 1, options: { rangeChunkSize: 16384 } }), /render failed/);
  await assert.rejects(rendering.window.verifyPartialDocument(), /successful render/);
  assert(!rendering.events.includes("getData"));

  const verification = setup({ verificationFails: true });
  verification.releaseRender();
  await verification.window.runPartialFirstPage({ url: pdfUrl, scale: 1, options: { rangeChunkSize: 16384 } });
  await assert.rejects(verification.window.verifyPartialDocument(), /verification failed/);
  await assert.rejects(verification.window.verifyPartialDocument(), /successful render/);
});

import * as pdfjs from "/pdfjs/build/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.mjs";

let phase = "idle";
let partialDocument;
let canvas;
let context;

const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");

function resourceTimingSnapshot(pdfUrl, cutoffMs) {
  const completedEntries = performance.getEntriesByType("resource")
    .filter(entry => entry.name === pdfUrl && entry.responseEnd > 0 && entry.responseEnd <= cutoffMs)
    .map(entry => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: entry.startTime,
      responseStart: entry.responseStart,
      responseEnd: entry.responseEnd,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    }));
  return {
    capturedAtMs: performance.now(),
    cutoffMs,
    completedEntries,
    decodedBodyBytesForCompletedEntries: completedEntries.reduce((total, entry) => total + entry.decodedBodySize, 0),
    interpretation: "Completed ResourceTiming entries only. Incomplete or not-yet-published transfers are omitted; "
      + "this sum is a lower bound on observed transferred body bytes, not exact bytes received or unique PDF bytes at first render.",
  };
}

/**
 * One call per fresh page/context. Times ending in AtMs use performance.now();
 * timeOriginMs is performance.timeOrigin. Main-module import/navigation precede
 * the timer. Returns immediately after render evidence is captured, without
 * getData(), pixel readback, hashing, or PNG capture.
 */
window.runPartialFirstPage = async ({ url, scale, options }) => {
  if (phase !== "idle") throw new Error("Use a fresh page/context for each partial-loading trial.");
  phase = "rendering";
  try {
    canvas = document.getElementById("page");
    if (!canvas) throw new Error("Missing page canvas.");
    context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    const pdfUrl = new URL(url, window.location.href).href;
    const parameters = {
      url, ...options,
      cMapUrl: "/pdfjs/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    };
    const startedAtMs = performance.now();
    const loadingTask = pdfjs.getDocument(parameters);
    window.loadingTask = loadingTask;
    partialDocument = await loadingTask.promise;
    window.partialDocument = partialDocument;
    const documentLoadedAtMs = performance.now();
    const firstPage = await partialDocument.getPage(1);
    const pageLoadedAtMs = performance.now();
    const viewport = firstPage.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const renderStartedAtMs = performance.now();
    await firstPage.render({ canvasContext: context, viewport }).promise;
    const firstPageRenderedAtMs = performance.now();

    // Mark and snapshot after stopping the timer. No operation here asks PDF.js
    // to fetch the rest of the document. The controller collects its network
    // observations before explicitly starting verifyPartialDocument().
    performance.mark("partial-first-page-rendered", { startTime: firstPageRenderedAtMs });
    const resourceTimingAtRender = resourceTimingSnapshot(pdfUrl, firstPageRenderedAtMs);
    phase = "rendered";
    return {
      firstPageRenderMs: firstPageRenderedAtMs - startedAtMs,
      documentLoadedMs: documentLoadedAtMs - startedAtMs,
      pageLoadedMs: pageLoadedAtMs - startedAtMs,
      canvasRenderMs: firstPageRenderedAtMs - renderStartedAtMs,
      timeOriginMs: performance.timeOrigin,
      startedAtMs, documentLoadedAtMs, pageLoadedAtMs,
      renderStartedAtMs, firstPageRenderedAtMs,
      numPages: partialDocument.numPages,
      width: canvas.width, height: canvas.height,
      devicePixelRatio: window.devicePixelRatio,
      pdfjsVersion: pdfjs.version,
      pdfUrl,
      resourceTimingAtRender,
    };
  } catch (error) {
    phase = "failed";
    throw error;
  }
};

/**
 * Explicit post-render phase: getData() can fetch missing ranges. Its downloads
 * and identity results must not be attributed to the first-render boundary.
 */
window.verifyPartialDocument = async () => {
  if (phase !== "rendered") throw new Error("Complete one successful render before one verification call.");
  phase = "verifying";
  const verificationStartedAtMs = performance.now();
  performance.mark("partial-verification-started", { startTime: verificationStartedAtMs });
  try {
    const downloaded = await partialDocument.getData();
    const downloadedDigest = await crypto.subtle.digest("SHA-256", downloaded);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest("SHA-256", pixels);
    let nonwhitePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255) nonwhitePixels++;
    }
    const png = canvas.toDataURL("image/png");
    phase = "verified";
    return {
      timeOriginMs: performance.timeOrigin,
      verificationStartedAtMs,
      verificationFinishedAtMs: performance.now(),
      downloadedBytes: downloaded.byteLength,
      downloadedSha256: hex(downloadedDigest),
      rgbaSha256: hex(digest),
      nonwhitePixels,
      png,
    };
  } catch (error) {
    phase = "failed";
    throw error;
  }
};

import * as pdfjs from "/pdfjs/build/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.mjs";

// Navigation and the PDF.js main-module import finish before this function runs.
// Each trial gets a new page/context; do not preload a PDF or a PDFWorker here.
window.runFirstPage = async ({ url, scale, options }) => {
  const canvas = document.getElementById("page");
  const context = canvas.getContext("2d");
  const parameters = {
    url, ...options,
    cMapUrl: "/pdfjs/cmaps/", cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  };
  const started = performance.now();
  const loadingTask = pdfjs.getDocument(parameters);
  window.loadingTask = loadingTask;
  const pdfDocument = await loadingTask.promise;
  const documentLoaded = performance.now();
  const firstPage = await pdfDocument.getPage(1);
  const pageLoaded = performance.now();
  const viewport = firstPage.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const renderStarted = performance.now();
  await firstPage.render({ canvasContext: context, viewport }).promise;
  const rendered = performance.now();

  // Everything below is validation/evidence collection OUTSIDE the measured span.
  const downloaded = await pdfDocument.getData();
  const downloadedDigest = await crypto.subtle.digest("SHA-256", downloaded);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const digest = await crypto.subtle.digest("SHA-256", pixels);
  let nonwhitePixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) {
      nonwhitePixels++;
    }
  }
  return {
    firstPageRenderMs: rendered - started,
    documentLoadedMs: documentLoaded - started,
    pageLoadedMs: pageLoaded - started,
    canvasRenderMs: rendered - renderStarted,
    numPages: pdfDocument.numPages,
    width: canvas.width, height: canvas.height,
    devicePixelRatio: window.devicePixelRatio,
    pdfjsVersion: pdfjs.version,
    downloadedBytes: downloaded.byteLength,
    downloadedSha256: Array.from(new Uint8Array(downloadedDigest), b => b.toString(16).padStart(2, "0")).join(""),
    rgbaSha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join(""),
    nonwhitePixels,
    png: canvas.toDataURL("image/png"),
  };
};

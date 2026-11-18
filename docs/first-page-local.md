# First-page rendering in local Chromium

This pilot loads the existing `text-100-v1` PDF pair with PDF.js in headless
Chromium and measures completion of the first page's canvas render. The experiment
is defined in [`experiments/first-page-local.json`](../experiments/first-page-local.json).
It leaves the generator, original PDF bytes, manifest, and linearization controls
unchanged. It does not select a hosting provider or create a deployed viewer.

The [November 16, 2026 execution record](first-page-local-2026-11-16.md) contains
the first successful run's commands, measurements, sample review, and limitations.

The implementation is a small local harness:

- [`run.ts`](../packages/runner/src/run.ts) validates the corpus, starts Chromium,
  executes serial trials, and records evidence.
- [`viewer.mjs`](../packages/runner/viewer/viewer.mjs) loads PDF.js and renders page
  1 into one canvas with a real dedicated worker.
- [`server.ts`](../packages/runner/src/server.ts) serves preloaded, whitelisted
  assets over HTTP on an ephemeral `127.0.0.1` port.
- [`protocol.ts`](../packages/runner/src/protocol.ts) fixes trial order and
  summarizes only complete measured pairs.

## Setup and execution

Use the repository's Node.js 24.x and declared pnpm toolchain. The runner pins
`pdfjs-dist` to 5.6.205 and Playwright to 1.62.1. Install the workspace and the
headless Chromium binary selected by that Playwright version:

```sh
pnpm install --frozen-lockfile
pnpm --filter @pdf-benchmark/runner exec playwright install chromium --only-shell
```

The two PDFs and their manifest must already exist in `corpus/generated/pilot/`,
and `qpdf` must be on `PATH`. See [corpus setup and validation](corpus-validation.md)
if those inputs are missing. The benchmark verifies their hashes and qpdf
structure; it does not regenerate or replace them.

From the repository root:

```sh
pnpm bench:first-page
```

The command builds the runner before executing it. Build time is excluded from
the measurements. By default, each invocation creates a uniquely named evidence
directory under `results/raw/first-page-local/`. To choose the location:

```sh
pnpm bench:first-page --output-dir /tmp/pdf-first-page-run
```

The evidence directory must be new or empty. A failed benchmark exits nonzero and
retains its report and any completed trials; a failed or incomplete run must not
be treated as a successful comparison.

If Playwright reports that its expected browser executable is missing, install
the binary with the command above. When an already installed compatible Chromium
binary must be used instead, pass its exact executable path:

```sh
pnpm bench:first-page --chromium-executable /absolute/path/to/chrome-headless-shell
```

The override and actual browser version are recorded. An override may differ from
the browser revision associated with the pinned Playwright package; comparisons
across those environments require that distinction to remain explicit. The
harness does not silently select another browser.

## Metric boundary

The main metric, `firstPageRenderMs`, uses `performance.now()` in the document:

1. Start immediately before `pdfjs.getDocument(parameters)`.
2. Await the loading task, request page 1, create its fixed viewport, and size the
   canvas.
3. Await page 1's `render(...).promise`, then stop the clock immediately.

This includes creation/startup of the PDF.js worker, worker-module loading, PDF
HTTP transfer, parsing, page preparation, and canvas rendering. Navigation,
loading the viewer and main PDF.js module, browser launch, pixel readback,
hashing (both PDF bytes and pixels), and PNG capture occur outside the measured interval. Completion of the
canvas render promise does not establish when the browser compositor presents
the pixels on a physical display; this is not First Contentful Paint.

The report also retains cumulative `documentLoadedMs` and `pageLoadedMs` offsets
from the same start. `canvasRenderMs` spans the `render()` call through its promise
completion, excluding the preceding viewport/canvas setup. These
components help interpret the main metric; they are not independent experiments.

The loading/page/render sequence follows the
[PDF.js examples](https://mozilla.github.io/pdf.js/examples/). Each trial receives
an isolated nonpersistent context using
[Playwright `browser.newContext()`](https://playwright.dev/docs/api/class-browser#browser-new-context).
The runner requires a real dedicated PDF worker and rejects browser warnings,
errors, failed requests, and incomplete delivery rather than accepting a silent
fake-worker fallback.

## Controls and trial order

The JSON configuration fixes a 1280 × 1000 browser viewport, device scale factor
1, PDF viewport scale 1, a 30-second timeout for navigation/readiness and the
render operation, and a 612 × 792 first-page canvas. PDF.js uses range chunk size
65,536 bytes with range loading, streaming,
and automatic fetch enabled. `useSystemFonts` remains `true`, the browser default;
the PDF still uses unembedded Helvetica. PDF.js modules, worker, standard-font
fallbacks, CMaps, and Wasm assets are served locally from the pinned package.

The server uses the same response policy for both PDFs: `Content-Length`,
`Cache-Control: no-cache`, no HTTP compression, and no artificial latency or
bandwidth throttling. PDF responses advertise byte ranges and support single
closed, open-ended, and suffix ranges. Unsatisfiable ranges return 416;
malformed, unsupported, or multipart ranges are ignored with a full 200 response.
The server holds both original PDF buffers in memory before trials begin.

There are two excluded warmup pairs followed by ten measured pairs: four warmup
trials and twenty measured trials in total. Within each phase, odd pairs run
nonlinearized then linearized; even pairs reverse that order. The ten measured
pairs balance which variant runs first. Trials run serially, each in a new browser
context with its HTTP cache explicitly disabled and service workers blocked.

The Chromium process is shared across trials. A fresh context and disabled HTTP
cache do not clear operating-system or font caches, restart Chromium, or guarantee
a completely cold machine. The server's preloaded assets also avoid measuring
per-trial filesystem reads. This is a fresh-context local HTTP baseline.

An initial warmup with `no-store` was rejected because Chromium emitted
`net::ERR_ABORTED` despite a completed first-page render. This is consistent with
[Playwright issue #42742](https://github.com/microsoft/playwright/issues/42742),
which reports streamed EOF plus an abort in the same pinned browser versions.
Before the first successful comparison, the response policy was changed to
`no-cache` for both variants. HTTP caching remains explicitly disabled by CDP and
each trial uses a new context. All request failures remain fatal; no abort is
allowlisted or silently discarded. The local internal cause was not proven.

## Range-request limitation of this corpus

The pinned PDF.js 5.6.205 implementation in
`pdfjs-dist/build/pdf.mjs`, function `validateRangeRequestCapabilities`, disables
range loading when file length is at most twice `rangeChunkSize`. With the
configured 65,536-byte chunk, that threshold is 131,072 bytes. The existing
nonlinearized and linearized PDFs are 86,329 and 87,189 bytes, respectively.

Consequently, this configuration uses full-response loading even though the
server supports ranges. The report records actual Range headers, response codes,
and response body byte counts so the delivery behavior can be checked. The
threshold is established from the pinned implementation, not inferred from the
general PDF.js example documentation. This run cannot establish a benefit from
range requests or represent a constrained-network linearization experiment.

## Evidence and interpretation

`report.json` retains the configuration, complete schedule, raw warmup and
measured trials, timing components, PDF and manifest hashes, source hashes,
runtime/browser versions, worker observations, browser diagnostics, and HTTP
request records. Server `responseBytes` means body bytes scheduled for that
response; `completed` records response completion on the server, not a browser
network-timing measurement. Artifact identity is checked again after the run.

After each timed render, the harness requires the expected page count and canvas
dimensions, nonblank pixels, and the same decoded RGBA hash across both variants
and every trial. It also retrieves PDF.js's full document bytes and checks their
size and SHA-256 against the manifest. This identity check occurs after timing
and is not a measurement of bytes received by first render. PNG samples from the first measured pair are saved in `samples/`
for visual inspection. These validations and captures are outside the timer;
pixel equality alone cannot identify a layout defect shared by both variants.

Only measured trials enter the summary. It reports each variant's count, median,
minimum, maximum, and quartiles, using linear interpolation at `(n - 1) * q`.
Paired differences are **linearized minus nonlinearized** for each measured pair;
a positive value means the linearized variant took longer in that pair. Incomplete,
duplicate, reordered, or invalid measured samples cannot produce a valid summary.

The first run is a small local pilot, not a statistical-significance test or a
general speed claim. It does not measure browser launch, navigation-to-display,
full-document rendering, other browsers/renderers, production networks, or a
controlled cold operating-system/font cache. Unembedded fonts and browser/runtime
versions remain environment-dependent. Preserve raw results and those limitations
when interpreting or comparing a run.

Generated evidence under `results/raw/` is ignored by Git. A fresh clone must run
the benchmark to obtain its own report; an execution record can separately
preserve the observed environment, commands, results, and sample review.

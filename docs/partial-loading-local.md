# Partial-loading diagnostic

This is a separate diagnostic of `text-100-v1`, using the exact original PDF
pair and PDF.js/Chromium versions. It asks whether range requests occur before
first-page rendering completes when the configured chunk size is 16,384 bytes.
It does not estimate a linearization speed benefit. The four-run, 65,536-byte
baseline and its original source/configuration files remain unchanged.

## Declared protocol

`experiments/partial-loading-local.json` defines two serial AB/BA pairs: four
diagnostic trials, no excluded warmups. There is one fresh Chromium process per
invocation and a fresh context/real PDF worker for every trial. PDF scale/DPR,
viewport, font policy, cache disabling, local in-memory HTTP delivery, and
timeouts match the baseline. No PDF throttling or hosting is introduced.
Streaming and automatic fetching remain enabled; only chunk size changes as a
PDF.js loading option. Both PDFs exceed twice the new chunk size, making them
eligible for range loading. Actual requests determine the observed outcome.

The viewer returns immediately after recording the first-page render milestone
and a snapshot of completed PDF Resource Timing entries. A separate call then
reads and hashes the full PDF and canvas. The timer has the same start/stop
definitions as the baseline, but this instrumented, four-trial diagnostic is not
a timing comparison with the original runs.

Record Chrome DevTools Protocol (CDP) request, response, data, completion, and
failure events. Correlate requests by ID and exact PDF URL; retain Range and
Content-Range headers and include full-response probes and overlapping/repeated
transfers. Record verification-start separately, because full-document `getData()`
can fetch additional data after first render. All unexpected browser/request
errors remain fatal. Zero PDF range requests is a valid diagnostic result.

## Clock alignment and byte interpretation

Enable CDP Performance with `timeTicks`. Bracket a page `performance.now()` read
between two CDP `Performance.getMetrics` Timestamp reads, before and after each
trial. Intersect the resulting offset intervals; inconsistent clocks fail the
diagnostic. Expand calibration and render-marker intervals by an explicit 1 ms
resolution margin at each conversion, to account conservatively for page-clock
coarsening in this pinned environment. This margin is an assumption checked by
the probe, not a universal browser-clock accuracy guarantee. Boundary intervals
wider than 5 ms fail validation. Events inside the interval remain uncertain;
never assign them to the earlier phase by using a midpoint estimate.

CDP `dataReceived.dataLength` counts decoded payload bytes reported by events.
Separate event-accounted bytes before, within, and after the render interval.
These are not exact physical-network or PDF.js-consumption byte counts: CDP can
coalesce reports, and bytes may arrive before an event is timestamped. Resource
Timing is a second observation of completed requests; ongoing or unpublished
entries are absent. Server `responseBytes` records scheduled bytes only. Do not
rename any of these values to exact bytes received by first render.

## Observer validation

Before the PDF sequence, a separate disposable context fetches two disjoint,
known byte ranges from a deterministic binary asset served by the same server.
Verify HTTP 206, Content-Range, lengths, and body content. A 30 ms scheduling gap
on either side of a page-clock marker separates the completed first transfer
from the second request. Require the CDP byte totals and request phases to match
this known sequence, with no ambiguous data events. This calibration-only gap
does not throttle or modify the PDFs. Probe events are excluded from PDF trials.

## Validation and evidence

`experiments/first-page-baseline-lock.json` records the original twelve baseline
source/compiled hashes, original manifest hash, and first-page pixel hash.
Check these and qpdf structure before and after the diagnostic. Every PDF trial
must retain 100 pages, a 612 × 792 nonblank first-page canvas, a real PDF worker,
the original full-document byte hash/length, and the original pixel hash.

Save raw events, raw clock samples, uncertain classifications, Resource Timing
snapshots, server records, exact versions/configuration/source hashes, and PNG
samples. Preserve failed attempts separately and exit nonzero on validation
failure. Report phase-specific observations even when no range loading occurs.

From the repository root, using the previously documented Node 24 runtime:

```sh
pnpm --filter @pdf-benchmark/runner build
node packages/runner/dist/partial-loading.js
```

The runner accepts `--output-dir` for a new/empty evidence directory. Default
evidence goes under `results/raw/partial-loading-local/`. Existing package
scripts and the baseline command are intentionally unchanged.

This protocol covers the partial-loading diagnostic only. A controlled
latency/bandwidth comparison or a demand-loading configuration would be a
separate follow-up with its own declared controls.

Primary references: [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/),
[CDP Performance](https://chromedevtools.github.io/devtools-protocol/tot/Performance/),
and [PDF.js loading options](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
The range eligibility threshold was checked in the pinned local PDF.js source.

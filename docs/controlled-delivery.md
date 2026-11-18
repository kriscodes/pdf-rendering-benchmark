# Controlled PDF delivery experiment

Question: under one synthetic document-delivery constraint, does linearization
change PDF.js time to first-page canvas render, and does that effect differ when
range loading is enabled? This experiment preserves the exact original PDF pair,
all earlier source/configuration files, and previous results.

## Fixed profile and four conditions

`experiments/controlled-delivery.json` declares a **100 ms response-header delay**
per PDF GET, then a **125,000-byte/s (1 Mbit/s) aggregate body budget** shared by
all concurrent PDF responses. The server uses round-robin quanta of at most 2,048
bytes. Every quantum consumes its serialization time before release; there is
no initial free burst or catch-up burst after a delayed timer. Idle periods reset
the budget. Headers are flushed after their delay. This is application-level
PDF response shaping, not an emulation of a real 100 ms RTT WAN.

Only original PDF routes and a separate known-byte calibration fixture are
shaped. Viewer, PDF.js, worker, fonts, CMaps, Wasm, and observer-control assets
remain unshaped. PDFs and assets stay in memory, uncompressed, with no-cache
responses. The same range-capable server and shaping policy serve all conditions.

| Code | PDF | PDF.js range loading |
| --- | --- | --- |
| A | Nonlinearized | Enabled |
| B | Linearized | Enabled |
| C | Nonlinearized | Disabled |
| D | Linearized | Disabled |

Only `disableRange` changes between loading modes. Chunk size stays 16,384 bytes;
streaming and automatic-fetch flags remain enabled. All renderer/browser/font,
viewport/scale/DPR, fresh-context, cache, worker, and timing controls carry over
from the partial-loading diagnostic. The pinned PDF.js implementation can create
its network-backed document manager before full download when ranges are
enabled; disabling ranges changes that loading path. The comparison therefore
concerns these PDF.js loading modes, not merely HTTP syntax.

## Sequence and measurements

The four Williams rows are `A B D C`, `B C A D`, `C D B A`, and `D A C B`.
Run one four-block warmup cycle (16 excluded trials), then three four-block
measured cycles (48 trials, 12 per condition). Each block contains all four
conditions; every condition occupies each position equally. Trials are serial,
each with a fresh nonpersistent context and real dedicated PDF worker; one
Chromium process is shared. This is deterministic balancing, not randomization
or independent environmental replication.

Time from immediately before `getDocument()` to page 1's `render().promise`
completion. Navigation/main-module import precede timing; worker startup is
included. Retain cumulative load/page offsets and canvas duration. Return the
render marker before separately invoking full-document `getData()` and PDF/pixel
hashing. Await every PDF request's terminal event and server completion before
closing the context, so ongoing initial responses and range requests are retained.

Reuse the diagnostic's timestamped CDP ledger and completed Resource Timing
snapshot. Clock calibration uses bracketing reads with explicit 1 ms resolution
margins at calibration and milestone conversion, and a maximum 5 ms boundary
width. Classify uncertain boundary events separately. CDP body sums include
initial responses and overlapping/repeated ranges; they are not unique PDF
coverage or exact physical-arrival/renderer-consumption byte counts. Separate
render observations from requests starting around or after verification.

## Calibration gates and acceptance

Before PDF trials, validate the observer using the established two-range fixture
and known before/after marker. Independently calibrate the shaping profile before
and after the full experiment in disposable contexts: one 65,536-byte range,
two concurrent disjoint 65,536-byte ranges (131,072 bytes total), and an unshaped
control. Check exact response bodies, 206/Content-Range/Content-Length and identity
encoding, and browser completion evidence.

Predeclared tolerances: server header release 99–125 ms after receipt; aggregate
body release duration at least `bytes / 125000 × 1000 − 1 ms` and at most
`1.15 × nominal + 25 ms`. Nominal body budgets are 524.288 ms and 1,048.576 ms.
Browser and corresponding server body spans must agree within 25 ms; the
unshaped control completes in under 50 ms. Record actual timings rather than
claiming ideal rates. Do not widen tolerances after seeing results.

Audit each trial's server release ledger as well: no quantum exceeds 2,048
bytes, each pays its full serialization budget, no aggregate catch-up bursts,
and timer lateness stays within 25 ms. Any invalid pre/post calibration, clock,
browser diagnostic, incomplete response, body/hash mismatch, or changed source
invalidates the run. Unexpected aborts remain fatal. Actual zero range use is
an observational outcome, not grounds to change controls.

All PDFs must retain the original bytes and manifest, 100 pages, a nonblank
612 × 792 canvas, and the original first-page RGBA hash. Preservation hashes
are recorded in `experiments/delivery-preservation-lock.json` and checked before
and after. Preserve all attempts, with summaries only for complete accepted runs.

## Analysis and execution

Report each condition's raw trials, median, quartiles, and min/max. Within each
measured block compute linearized minus nonlinearized separately for each range
mode; range-enabled minus range-disabled separately for each PDF; and the
difference between the two structure effects. Summarize those block contrasts
directly, rather than subtracting marginal medians. No significance test,
confidence interval, or general production-speed claim is planned for this pilot.

```sh
pnpm --filter @pdf-benchmark/runner build
node packages/runner/dist/controlled-delivery.js --calibrate-only
node packages/runner/dist/controlled-delivery.js
```

Use the previously documented Node 24 runtime. Each invocation uses a new
evidence directory under `results/raw/controlled-delivery/`; `--output-dir`
can name a new/empty location. Calibration-only mode produces no PDF comparison.
Raw reports retain the complete schedule, excluded warmups, calibration records,
CDP/server ledgers, clock samples, versions/hashes, and sample images. Archive
matching executed sources alongside reports and publish the record in Lab 001.

This profile does not cover other latency/rate settings, larger PDFs, disabled
streaming, other renderers/platforms, cold OS/font caches, compositor presentation,
or full-document rendering. Previous unshaped runs are context, not matched
controls to pool into this new four-condition experiment.

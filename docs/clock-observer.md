# Bounded clock-observer diagnostic protocol

Question: with a fixed collection budget, can intersecting additional clock
brackets satisfy the existing observation-quality gate while correctly locating
known network events? The last three PDF benchmark replications were rejected
at clock-boundary widths of 5.176, 5.284, and 5.005 ms against the 5 ms gate.
This diagnostic does not rerun, modify, or rehabilitate those benchmarks.

## Fixed scope

Commit this protocol and `experiments/clock-observer.json` before execution.
Run one campaign of exactly three fresh Chromium sessions, each scheduling 12
serial probes in fresh contexts (36 total, no discarded warmups). Alternate
unpaced and paced fixtures, starting unpaced/paced/unpaced across sessions.
Each session therefore has six probes of each fixture. No outcome-dependent
replacements or additional campaign is planned.

Use the pinned Node 24.22.1, Playwright 1.62.1, and Chromium 151.0.7922.34, the
existing loopback server/pacing implementation, disabled HTTP cache, blocked
service workers, and the same viewport/DPR. A separate minimal diagnostic page
loads no PDF.js, worker, or PDFs. Original PDF bytes, prior source/configuration,
reports, samples, and snapshots are frozen by a new preservation lock and checked
before/after. The benchmark code and the existing interval functions stay intact.

Both fixture routes serve the same 49,152 known bytes: every four-byte little-
endian word contains its word index. One route is unpaced; the other opts into
the existing 100 ms response-header delay and shared 125,000 B/s body cap with
2,048-byte charged quanta. Record actual server delivery evidence and audit the
unchanged per-response timing/serialization bounds. These fixtures are not PDF
render workloads, and this is not a new throughput benchmark.

## Probe sequence and fixed bracket budget

Every clock bracket uses CDP `Performance.getMetrics().Timestamp`, then a
`Runtime.evaluate(performance.now())` read, then another CDP Timestamp. Collect
exactly five consecutive brackets at each of these three points:

1. `beforeMarker`: after the diagnostic page loads, before its first transfer.
2. `afterMarker`: after the first range has completed, the page has requested a
   30 ms wait, and it has recorded/returned its `performance.now()` marker.
3. `afterSecondTransfer`: after an explicit subsequent call requests another
   30 ms wait and completes the second range.

The first fetch requests bytes 0–4095. The second requests bytes 4096–8191 and
cannot start until explicitly called after the middle bracket burst. Validate
exact content, GET Range, 206 status, Content-Range, Content-Length, and identity
encoding. Retain page start/header/completion/marker timestamps and time origins,
CDP request/response/data/terminal events, and server ledgers. The 30 ms waits are
requested separations; actual gaps are recorded and include added sampling time.

Always collect all 15 brackets before evaluating either method. Never choose
brackets based on narrowness, drop an inconsistent bracket, or sample until a
pass appears. Record each burst's wall-clock overhead. Invalid input, exceptions,
timeouts, and incomplete collections remain visible.

## Paired methods and acceptance

For the same recorded probe, evaluate two predetermined methods:

- **Nested reference:** use the first bracket of each burst, three in total.
- **Fixed-budget candidate:** use all five brackets from all three bursts, 15
  in total, intersecting every expanded offset interval.

Both reuse the unchanged `calibrateOffset` and `mapPageTime`: a 1 ms margin at
calibration and another 1 ms when mapping the page marker. The mapped boundary
must be no wider than 5 ms. Reject non-overlapping intervals; keep every sample.
No margin or acceptance threshold is widened.

The candidate intersection is a subset of the nested reference when both are
valid. Narrower intervals therefore reflect the mathematics of intersection;
they do not by themselves prove greater accuracy. Do not assume a universal
4 ms lower bound: raw unmargined brackets can be disjoint while the expanded
intervals still overlap. The unchanged functions define the interval exactly.

For every nonempty interval, independently classify the known events even if
its width exceeds 5 ms. The first range must have its request, response headers,
all 4,096 CDP-reported body bytes, and completion at or before the marker interval.
The second must have those events after the interval. No opposite-side or
uncertain event/byte is accepted. Both GET Range/206 pairs must be valid and
complete, with no browser diagnostics or failed requests.

A method passes a probe only if operational/content evidence is valid, its full
interval is consistent and within the unchanged width limit, and the known-event
classification passes. Report operational status, clock status, and classification
status separately. A narrower but incorrectly classified interval is a rejection.
A missing interval cannot establish a classification pass.

## Bounds, retention, and analysis

Limits are fixed in the configuration: 5 seconds per operation and per complete
five-bracket burst, 20 seconds per probe, 120 seconds per session, 420 seconds per
campaign, and 10 seconds for cleanup. Enforce remaining deadlines rather than
resetting a timer for every retry. Close a failed probe's context before moving
to its next scheduled probe. Continue after an isolated operational failure only
if cleanup succeeds and budget remains; halt on changed preserved inputs,
unrecoverable cleanup, or exhausted outer budget. Report unattempted probes
explicitly. Do not replace failures or make another campaign to seek a pass.

Save reports after each probe. A completed campaign means all scheduled probes
were attempted, not that either method passed. Retain all raw brackets, all method
results, failed/incomplete probes, and source snapshots. Independently recompute
intervals, known-event classifications, and paired outcomes from the raw evidence.
Report counts separately by session and fixture: both pass, reference-only,
candidate-only, neither, and operational failures; include all widths and burst
overheads, without treating probes as independent environmental samples.

```sh
pnpm --filter @pdf-benchmark/runner build
node packages/runner/dist/clock-observer.js
```

Each invocation uses a new directory under `results/raw/clock-observer/` (or a
new/empty `--output-dir`). Execute the campaign once after software checks; save
protocol, results, commands, every attempt, and verified evidence in Lab 001.
Commit protocol, implementation, and results separately on the existing branch.

## Interpretation limits and next decision

The reference shares the candidate's extra sampling overhead; it is not a fresh
execution of the original three-read benchmark observer. Known events separated
by roughly 30 ms test coarse before/after classification, not sub-5-ms ground
truth. Both methods still depend on the stated stable-offset and resolution-
margin assumptions. More samples can reveal inconsistency as well as tighten an
interval, and no failed historical observation is reclassified as accepted.

This fixture-only diagnostic does not reproduce PDF worker/render load, establish
PDF performance repeatability, validate exact physical-arrival/renderer-consumed
bytes, or establish cross-day/platform reliability. A favorable result may support
a separately versioned integration diagnostic under the preserved PDF workload;
it does not automatically change the benchmark or authorize a speed claim.

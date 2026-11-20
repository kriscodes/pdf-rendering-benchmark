# Controlled PDF delivery results — 2026-11-17

The fixed four-condition experiment is complete. Under this synthetic delivery
profile, enabling PDF.js range loading was slower for both PDFs. Linearization
also did not improve first-page time: the median within-block difference was
+105.10 ms with ranges enabled and +7.60 ms with ranges disabled. These are
observations from one accepted local pilot, not a general speed claim.

The [protocol](controlled-delivery.md) was committed before execution. The exact
original PDFs, the original baseline, and the partial-loading diagnostic remain
unchanged. No hosting or new corpus was introduced.

## Measured comparison

Accepted report: `results/raw/controlled-delivery/run-VnOBcz/report.json`.
The run contains 16 excluded warmups and 48 measured trials, 12 per condition,
in the predeclared complete Williams schedule. Times below are milliseconds from
`getDocument()` through page 1 canvas-render completion.

| Condition | Median | 25th–75th percentile | Minimum–maximum |
| --- | ---: | ---: | ---: |
| Nonlinearized, ranges enabled | 1036.30 | 1031.12–1047.67 | 1020.50–1064.20 |
| Linearized, ranges enabled | 1142.35 | 1133.85–1148.78 | 1127.60–1154.60 |
| Nonlinearized, ranges disabled | 984.70 | 979.95–997.13 | 974.80–1001.40 |
| Linearized, ranges disabled | 996.10 | 992.30–1002.25 | 990.30–1052.70 |

Contrasts are computed within each of the 12 measured blocks and then summarized;
they are not differences between marginal medians. Positive values mean the
first named condition takes longer.

| Within-block contrast | Median difference | Minimum–maximum |
| --- | ---: | ---: |
| Linearized − nonlinearized, ranges enabled | +105.10 | +68.30–+126.40 |
| Linearized − nonlinearized, ranges disabled | +7.60 | −5.70–+73.50 |
| Ranges enabled − disabled, nonlinearized | +48.70 | +33.30–+75.90 |
| Ranges enabled − disabled, linearized | +141.65 | +100.80–+158.90 |
| Difference between the two structure effects | +91.65 | +24.90–+111.40 |

All 12 range-enabled structure differences, both range-mode differences, and all
12 interaction differences are positive. This is descriptive evidence only;
there is no significance test or confidence interval. All samples, including the
1052.70 ms linearized/ranges-disabled observation, remain in the record.

## What the network evidence establishes

All 24 measured range-enabled trials made four valid Range/206 requests overall,
in addition to one initial HTTP 200 response. All 24 range-disabled trials made
one HTTP 200 request and no Range requests. The initial full response completed
after first render in every range-enabled measured trial, and before render in
every range-disabled measured trial.

| Condition | CDP body bytes at or before render, observed range | Total PDF response-body bytes after drain |
| --- | ---: | ---: |
| Nonlinearized, ranges enabled | 90,425–94,521 | 139,890 |
| Linearized, ranges enabled | 103,573–107,669 | 141,610 |
| Nonlinearized, ranges disabled | 86,329 | 86,329 |
| Linearized, ranges disabled | 87,189 | 87,189 |

These sums include overlapping/repeated bytes and subsequent verification traffic
in the final total. They are not unique PDF coverage, exact physical-arrival
counts, or proof of what PDF.js consumed. All measured trials had zero CDP body
bytes in the uncertain render-boundary interval; one excluded warmup retained
2,048 uncertain bytes rather than assigning them to a side.

For nonlinearized/ranges-enabled, three range requests began before rendering:
`0–16383`, `81920–86328`, and `65536–81919`. A fourth (`49152–65535`) began after
render, near the explicit verification boundary; its phase is marked
`verificationUncertain`. It must not be credited with producing the first page.
For linearized/ranges-enabled, all four analogous requests began before render;
the `49152–65535` response and initial HTTP 200 remained incomplete at the marker.

An incomplete initial response does not prove that some PDF bytes were still
unavailable through other requests. In the linearized trials, the observed
initial-response prefix plus the two completed tail ranges already spans the
whole document. This is an interpretation of identity-encoded response offsets,
not a validated measurement of renderer consumption. The direct conclusion is
that range activity occurred and rendering preceded completion of the initial
response, without a first-page timing benefit under this shared-budget profile.
The experiment does not isolate which request or internal PDF.js step accounts
for each millisecond of the difference.

## Calibration and validity

The target was a 100 ms per-response header delay and a shared 125,000 B/s body
budget, with fully charged quanta of at most 2,048 bytes. Timer scheduling makes
actual throughput lower than the budget; this is not a claim of exact 1 Mbit/s
browser delivery or a 100 ms RTT WAN simulation. Accepted calibration body
throughput was approximately 0.855–0.878 Mbit/s, within the predeclared limits.

Accepted-run calibration spans, milliseconds from earliest headers to final body
completion within each clock domain:

| Stage | Known-byte transfer | Nominal budget | Server span | Browser span |
| --- | --- | ---: | ---: | ---: |
| Before | One 65,536-byte range | 524.288 | 597.381 | 598.300 |
| Before | Two concurrent ranges, 131,072 bytes | 1048.576 | 1210.154 | 1209.900 |
| After | One 65,536-byte range | 524.288 | 613.110 | 613.900 |
| After | Two concurrent ranges, 131,072 bytes | 1048.576 | 1197.734 | 1197.600 |

Every calibration passed the previously committed limits: header release
99–125 ms; body span from nominal minus 1 ms through 1.15 × nominal plus 25 ms;
client/server body-span agreement within 25 ms. The unshaped control completed in
1.9 ms before and 3.9 ms after. Exact known bytes, status, headers, CDP completion,
and overlapping concurrent response lifetimes passed. The separate observer
control correctly placed two known 4,096-byte ranges before/after its marker.

Across all 64 accepted PDF trials, server header delay was 100.040–104.499 ms;
maximum write lateness was 14.817 ms, below the fixed 25 ms limit. Shared-budget
serialization and byte-accounting audits passed. Clock-boundary widths were
4.353–4.768 ms, below 5 ms. Every PDF response completed before context teardown;
there were no browser diagnostics, failed requests, or unexpected aborts.

All 64 full-document hashes and first-page RGBA hashes match the original pair
and baseline. Dimensions are 612 × 792, DPR/scale 1, 100 pages, with a real PDF
worker. The four saved condition samples share the original PNG SHA-256:
`8ec824ed6e1251ca38249ef8de9b17af846aec0d81cdfbff8d57f57763657bea`.
All 50 preserved source/artifact hashes and all 19 executed source-snapshot
hashes match. Independent Python analysis recomputed schedule, statistics,
contrasts, clock/network accounting, calibration, and identity checks from raw
records and matched the runner output.

## Every execution retained

Times are America/Los_Angeles (PST), November 17, 2026. All three invocations used
the same implementation and fixed acceptance limits.

| Invocation | Time | Outcome |
| --- | --- | --- |
| `run-Gl01zj` | 21:19:33–21:19:39 | Standalone calibration passed; zero PDF trials |
| `run-JH48Id` | 21:20:06–21:21:19 | Rejected after 49 passed trials and one failed trial; no comparison summary |
| `run-VnOBcz` | 21:21:54–21:23:26 | Complete accepted run; 16 warmups + 48 measured trials; both calibration gates passed |

The first full attempt failed at `measured-9-linearized-range-enabled`: the
clock-boundary width was 6.316 ms, exceeding the predeclared 5 ms maximum.
All raw events, clock samples, trial data, images, and executed sources remain
available. No tolerance was widened and no individual trial was replaced. The
whole schedule was rerun unchanged. Failed-attempt measurements are not pooled
with the accepted run. This acceptance filtering and the observed timing
instability limit claims about the wider distribution of performance.

Report SHA-256 values:

- Calibration: `49cfedf81bf2e7dc46d48a23da2238ac78f883c268e8b8c8927b0ab803a44eb5`
- Rejected attempt: `d83368dcb662ef79e65d5583c3339c668784727478c179ce9dfffca814e94dfd`
- Accepted run: `87070956c2672ed172d0b25660d2757df6fb29e0e29725858067f7a891d7cc64`

## Implementation, commands, and records

Added a separate paced server, calibration gates, deterministic four-condition
schedule, runner, independent analysis CLI, and meaningful tests for scheduling,
shared bandwidth, delayed timers, cancellation, timing limits, accounting, and
incomplete schedules. Existing benchmark and diagnostic files were not edited.

The actual environment was Node 24.22.1, pnpm 11.25.0, PDF.js 5.6.205,
Playwright 1.62.1, Chromium 151.0.7922.34, qpdf 12.4.2, Darwin 24.6.0 arm64,
Apple M2 (8 logical CPUs, 8 GiB RAM). The repository-declared Node 24.22.3 and
pnpm 11.28.12 versions were not exercised. Python analysis used the existing
`.venv` (Python 3.13.18). No dependency versions or lockfiles were changed.

```sh
# Use the installed Node 24 runtime; the recorded pnpm override avoids
# an automatic dependency reinstall. Existing frozen dependencies are retained.
# Select the Node version recorded for this experiment before running commands.
export pnpm_config_verify_deps_before_run=false
pnpm test
pnpm typecheck
node packages/runner/dist/controlled-delivery.js --calibrate-only
node packages/runner/dist/controlled-delivery.js
# First full attempt rejected; rerun the same command once, unchanged:
node packages/runner/dist/controlled-delivery.js
.venv/bin/python packages/runner/scripts/summarize_controlled_delivery.py \
  results/raw/controlled-delivery/run-VnOBcz/report.json \
  --output-prefix docs/data/controlled-delivery-2026-11-17 \
  --audit-json docs/data/controlled-delivery-2026-11-17-audit.json
```

`pnpm test`: 79 passed (22 corpus, 57 runner), zero failures.
`pnpm typecheck`: passed both workspace packages. The independent analysis
passed; its rejection behavior was also checked against the calibration-only
and failed reports, which produced no comparison exports.

Records:

- [All-trial CSV](data/controlled-delivery-2026-11-17.csv), including all warmups.
- [Independent analysis JSON](data/controlled-delivery-2026-11-17.json).
- [Analysis audit and export hashes](data/controlled-delivery-2026-11-17-audit.json).
- Raw reports and sample images under `results/raw/controlled-delivery/run-*/`;
  each invocation includes an exact `source-snapshot/`.
- Source protocol and preservation lock in `experiments/controlled-delivery.json`
  and `experiments/delivery-preservation-lock.json`.

Work was committed on the existing `feat/corpus-text-pair` branch: protocol
`3f24789`, implementation `cb1315e`, independent analysis `358b4c3`, and
export line-ending cleanup `cbd1b73`, followed by the results/publication record.
The protocol, results, work history, and downloadable evidence are published
under Labs → PDF Rendering Lab 001 → Controlled PDF delivery.

## Limits and next research decision

This completes the requested controlled experiment. It covers one small synthetic
text-only pair, one machine/browser/renderer, one fixed profile, and streaming plus
automatic fetching enabled. It does not establish production performance,
independent-session repeatability, exact renderer-consumed bytes, benefits for
larger/image-heavy documents, other profiles/renderers/platforms, compositor
presentation, or full-document browser rendering. Earlier unshaped runs are
historical context, not matched controls pooled into this experiment.

The next research step should be unchanged replication in additional sessions,
retaining failures and calibration records, before changing document size or
loading mode. Demand loading with streaming disabled would be a separately
specified experiment, including its intentional-cancellation policy; it was not
introduced here. No additional experiment or hosting has been started.

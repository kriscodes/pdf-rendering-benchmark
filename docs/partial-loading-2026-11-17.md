# Partial-loading diagnostic — November 17, 2026

Both diagnostic executions passed. Reducing the configured range chunk to
**16,384 bytes** made the original PDFs range-eligible, but **neither execution
issued a PDF Range request or received a PDF 206 response**. Every PDF trial
used one completed HTTP 200 response. CDP accounted for the full decoded body
and completion before the first-render boundary, corroborated by completed
Resource Timing entries. Partial loading was not observed in this configuration.

This is a delivery diagnostic, not a performance comparison. Each execution
contains four serial PDF trials in two AB/BA pairs, with **no warmups**. Both
successful executions are retained; no failed diagnostic execution was discarded.
Their timings are not pooled or compared with the earlier performance baseline.

The [declared protocol](partial-loading-local.md) and
[experiment JSON](../experiments/partial-loading-local.json) specify the controls.
The result is also documented in the lab's

## Executions and source provenance

Times below use America/Los_Angeles, PST (UTC−08:00). The raw reports use UTC.

| Execution | Run ID | Local start | Local finish | Outcome |
| --- | --- | --- | --- | --- |
| First successful diagnostic | `run-QAWtig` | 2026-11-17 20:30:43.300 | 2026-11-17 20:30:45.203 | Probe and all four PDF trials passed |
| Final implementation verification | `run-9xURGW` | 2026-11-17 20:32:15.954 | 2026-11-17 20:32:18.389 | Probe and all four PDF trials passed |

The first execution used commit `9443cd6` plus an uncommitted change retaining
raw clock samples. Its exact executed sources and compiled files are preserved
under `results/raw/partial-loading-local/run-QAWtig/source-snapshot/`; all seven
diagnostic source hashes in that report match the snapshot. The final execution
used commit `4076c16`, `Preserve clock evidence and bound diagnostic operations`,
which includes sample retention and timeout hardening.

The two reports have matching experiment, environment, controls, baseline lock,
and corpus identities. Only the diagnostic orchestration source and its compiled
output differ among their recorded source hashes. Final-run hashes match the
current implementation. The original twelve baseline source/compiled hashes,
package manifests, lockfile, original experiment, and corpus remain unchanged;
all preexisting tracked files were preserved.

Both PDFs were present and matched their original identities before this
diagnostic. The missing-PDF recovery described in the
[earlier repeatability record](first-page-repeatability-2026-11-17.md) occurred in
an earlier session, not during these executions. No corpus regeneration was
needed here.

## Per-trial observations

All rows below have one PDF request, status 200, zero Range requests, and zero
206 responses. Durations are milliseconds rounded to two decimals. Document and
page-loaded values are cumulative offsets from `getDocument()` start; canvas
time covers only the `render()` call through its promise completion.

| Run | Pair / position | Variant | First render | Document loaded | Page loaded | Canvas render | CDP body bytes at-or-before render |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `run-QAWtig` | 1 / 1 | Nonlinearized | 135.90 | 73.00 | 73.20 | 62.30 | 86,329 |
| `run-QAWtig` | 1 / 2 | Linearized | 67.70 | 52.60 | 52.80 | 14.80 | 87,189 |
| `run-QAWtig` | 2 / 1 | Linearized | 66.40 | 50.80 | 51.10 | 15.20 | 87,189 |
| `run-QAWtig` | 2 / 2 | Nonlinearized | 80.10 | 53.50 | 53.80 | 26.20 | 86,329 |
| `run-9xURGW` | 1 / 1 | Nonlinearized | 207.40 | 107.50 | 107.90 | 99.20 | 86,329 |
| `run-9xURGW` | 1 / 2 | Linearized | 101.90 | 78.70 | 79.00 | 22.80 | 87,189 |
| `run-9xURGW` | 2 / 1 | Linearized | 71.30 | 53.90 | 54.10 | 17.00 | 87,189 |
| `run-9xURGW` | 2 / 2 | Nonlinearized | 85.50 | 56.90 | 57.20 | 28.20 | 86,329 |

For every row, the completed Resource Timing entry reports the same full decoded
body size. CDP classifies the request, body event, and completion at-or-before
the render interval; uncertain and after-render body-byte counts are zero.
No PDF requests began in the separately identified verification phase. These
observations do not establish exact physical arrival times or PDF.js byte
consumption: the byte column means CDP event-accounted decoded body bytes.

The [trial CSV](data/partial-loading-2026-11-17.csv) and
[summary JSON](data/partial-loading-2026-11-17.json) retain unrounded observations
and evidence identities. The raw reports retain individual CDP events, server
records, Resource Timing snapshots, and clock samples.

## Observer and clock checks

Each execution first validated the observer in a separate disposable context.
Two known, disjoint 4,096-byte ranges from an offset-dependent binary fixture
returned matching bytes, lengths, Content-Range headers, and HTTP 206 responses.
A 30 ms scheduling gap on either side of a page-clock marker placed the first
transfer before and the second after it. CDP correctly accounted for each
4,096-byte transfer with no uncertain data events. These probe requests and gaps
are excluded from the PDF trials; they do not throttle PDF delivery.

Page `performance.now()` readings are bracketed by CDP monotonic Timestamp reads
before rendering, after rendering, and after verification. Their offset intervals
are intersected. The conversion assumes a stable offset and an explicit **1 ms
clock-resolution margin at calibration and another 1 ms at milestone mapping**.
That margin is an environment-specific assumption, not a universal accuracy
guarantee. Intervals wider than 5 ms or inconsistent calibrations are rejected.

| Run | PDF render-boundary widths | Probe marker-boundary width |
| --- | ---: | ---: |
| `run-QAWtig` | 4.404–4.532 ms | 4.627 ms |
| `run-9xURGW` | 4.502–4.643 ms | 4.674 ms |

The last CDP data event was 17.851–104.639 ms before the earliest mapped render
boundary across the eight trials. Resource Timing response ends preceded the
page-clock render marker by 20.30–107.30 ms. Explicit verification began
3.90–7.00 ms after rendering. Conservative render/verification intervals overlap
in three trials, by at most 0.672 ms; no PDF events occur near those overlaps.

The viewer returns the render milestone and completed-resource snapshot before
a separate call invokes `getData()`, PDF/pixel hashing, or PNG capture. The
verification-start marker is retained, so later identity work is not mistaken
for first-render delivery. Event timestamps, rather than callback arrival time,
determine classification; encoded transfer totals remain separate from decoded
body counts.

## Preserved inputs and validation

Both executions passed qpdf/input checks. Every trial reported 100 pages and a
nonblank 612 × 792 canvas, used one real dedicated PDF worker, and produced no browser warnings,
errors, or failed requests. Full PDF length and SHA-256 matched the original
manifest after rendering. The nonlinearized and linearized files remain 86,329
and 87,189 bytes respectively. All eight trial pixel hashes match the original:

`527747daf68cf54de7953e3fa106a4c0c044b6162d782bb5f8838e158575e947`.

The four saved PNG samples across these executions are also byte-identical to
the earlier baseline samples, with SHA-256
`8ec824ed6e1251ca38249ef8de9b17af846aec0d81cdfbff8d57f57763657bea`.
Agent-assisted inspection opened the final nonlinearized sample and found a
clean layout; the other saved samples have the same bytes. This is not manual
inspection of every document page. Final workspace typecheck and all **52 tests
(22 corpus and 30 runner)** passed, including clock accounting and the separate
render/verification phase contract. An independent audit of both reports also
passed; see the [audit record](data/partial-loading-audit-2026-11-17.json).

## Environment, commands, and evidence

Both runs used Apple M2, eight logical CPUs, 8 GiB memory, macOS/Darwin 24.6.0
arm64, Node 24.22.1, PDF.js 5.6.205, Playwright 1.62.1, qpdf 12.4.2, and Chromium
151.0.7922.34, without an executable override. The runs used pnpm 11.25.0;
declared Node 24.22.3 and pnpm 11.28.12 remain unverified. No package script or
dependency version changed for this diagnostic.

```sh
# Select the Node version recorded for this experiment before running commands.
export pnpm_config_verify_deps_before_run=false
pnpm --filter @pdf-benchmark/runner build
node packages/runner/dist/partial-loading.js
pnpm typecheck
pnpm test
```

The diagnostic command ran once for each implementation state described above.
Reports are under `results/raw/partial-loading-local/<run-id>/report.json`:

| Run ID | Report SHA-256 |
| --- | --- |
| `run-QAWtig` | `008ec0b5df4ad5a86241b23ac6f505e82804c63e89fb4bfebd8f868c524b879d` |
| `run-9xURGW` | `758f67d77b6fecb697b3f61a656e2233b0e388bb541d5c54001851ff5ed9137c` |

The 16 KiB setting makes files over 32,768 bytes eligible for ranges, but
streaming and automatic-fetch settings remain unchanged. Unthrottled loopback
delivery completed the full responses in these observations. No range benefit,
speed advantage, or statistical significance follows from these eight diagnostic
trials. A controlled network profile, demand-loading configuration, other
renderer/platform, cold OS/font cache, compositor milestone, and full-document
browser rendering remain untested. A controlled latency/bandwidth experiment has
not been run and requires its own declared protocol. Generated raw artifacts are
Git-ignored; the result record and data exports preserve their interpretation.

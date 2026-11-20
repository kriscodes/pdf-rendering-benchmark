# First local first-page rendering run — November 16, 2026

The PDF.js/Chromium pilot completed successfully with the existing PDF pair.
Median first-page render time was **73.75 ms nonlinearized** and **73.00 ms
linearized** across ten measured trials per variant. This small local run does
not establish a general speed advantage or a range-delivery benefit.

## Scope and implementation

Reinspection confirmed the current branch was `feat/corpus-text-pair`, with the
earlier corpus-validation work still present. That work was preserved. Added a
small runner package, local static canvas viewer, loopback HTTP server, pinned
dependencies and lockfile entries, experiment definition, and protocol/server
tests. No branch switch, commit, hosting selection, or corpus regeneration was
performed during this browser-benchmark task.

The [protocol](first-page-local.md) and
[experiment definition](../experiments/first-page-local.json) describe the exact
controls. Timing starts immediately before `getDocument()` and ends immediately
after page 1's `render().promise` resolves. It includes worker startup and PDF
transfer/parse/render, but excludes page navigation, importing the main PDF.js
module, browser launch, validation/readback, and PNG capture. It does not measure
compositor presentation.

Both PDFs retain the prior generator settings, source identity, and byte hashes.
The same HTTP policy, renderer, viewport, system-font policy, and fresh-context
cache controls apply to both variants. A new dedicated worker is required for
every trial. The Chromium process and operating-system/font caches are shared.

## Observed results

Four warmup trials (two alternating pairs) were excluded from statistics. The
twenty measured trials formed ten AB/BA pairs with balanced first position.

| Variant | Measured trials | Median ms | 25th–75th percentile ms | Min–max ms |
| --- | ---: | ---: | ---: | ---: |
| Nonlinearized | 10 | 73.75 | 72.67–81.85 | 67.00–83.20 |
| Linearized | 10 | 73.00 | 72.02–74.30 | 66.10–78.60 |

Quartiles use linear interpolation at `(n - 1) × q`; displayed values are
rounded. The median paired difference, **linearized minus nonlinearized**, was
**−3.80 ms**, with a range of **−11.00 to +6.00 ms**. The difference between the
two marginal medians is −0.75 ms; these are different statistics.

Raw measured timings, rounded to two decimals (N = nonlinearized, L = linearized):

| Pair | Order | N ms | L ms | L − N ms |
| --- | --- | ---: | ---: | ---: |
| 1 | N → L | 72.30 | 73.60 | +1.30 |
| 2 | L → N | 79.30 | 73.70 | -5.60 |
| 3 | N → L | 83.20 | 77.90 | -5.30 |
| 4 | L → N | 72.90 | 66.10 | -6.80 |
| 5 | N → L | 72.60 | 78.60 | +6.00 |
| 6 | L → N | 67.00 | 71.20 | +4.20 |
| 7 | N → L | 83.10 | 72.10 | -11.00 |
| 8 | L → N | 73.20 | 74.50 | +1.30 |
| 9 | N → L | 82.70 | 72.40 | -10.30 |
| 10 | L → N | 74.30 | 72.00 | -2.30 |

The run recorded 24 successful PDF HTTP requests, all status 200, with **zero
Range requests**. At the default 65,536-byte range chunk, PDF.js disables ranges
for these 86,329/87,189-byte files. Thus this tests local full-response loading,
not linearization under constrained or partial delivery.

All 24 trials passed: real PDF workers, no browser warnings/errors or failed
requests, 100-page document count, 612 × 792 canvas at scale/DPR 1, and the same
nonblank RGBA pixel hash. After each timer stopped, PDF.js's full document bytes
matched the original manifest in both length and SHA-256. The original on-disk
PDFs and manifest were independently rechecked unchanged after the run.

Agent-assisted visual inspection opened the saved first-page PNG for each
variant. Both showed the heading, subtitle, horizontal rule, records 00001–00040,
profile footer, and `1 / 100`; no visible clipping, overlap, or missing glyphs
were found. This is first-page inspection only, not browser review of all pages.

## Environment, commands, and checks

Recorded environment: Apple M2, eight logical CPUs, 8 GiB memory, macOS/Darwin
24.6.0 arm64, Node 24.22.1, PDF.js 5.6.205, Playwright 1.62.1, qpdf 12.4.2, and
Chromium Headless Shell **151.0.7922.34**, Playwright revision **1234**, without an
executable override. The installed Chromium matches the pinned Playwright
registry. pnpm was 11.25.0.

The declared Node 24.22.3 and pnpm 11.28.12 were not exercised; the session used
the bundled Node 24.x runtime. Dependency resolution and frozen installation
succeeded against the updated lockfile with lifecycle scripts disabled:

```sh
# Select the Node version recorded for this experiment before running commands.
pnpm install --lockfile-only --ignore-scripts --fetch-retries=0 --fetch-timeout=15000
CI=true pnpm install --frozen-lockfile --ignore-scripts --fetch-retries=0 --fetch-timeout=15000
node packages/runner/node_modules/playwright/cli.js install chromium --only-shell

# Session-only: prevent bundled pnpm's automatic pre-run reinstall attempt.
export pnpm_config_verify_deps_before_run=false
pnpm typecheck
pnpm test
pnpm bench:first-page
pnpm build
git diff --check
```

The bundled pnpm pre-run dependency check attempted an automatic reinstall and
stopped at a no-TTY prompt. Its automatic check was disabled for script execution
only after the successful frozen-lockfile installation; no repository package
manager setting was changed. Dependency download, browser installation, and
loopback listening/browser execution used the execution environment's approved
sandbox escalation. Offline dependency resolution lacked metadata; the online
resolution succeeded. These were environment setup issues, not benchmark data.

Validation passed: **22 corpus tests + 15 runner tests**, workspace typecheck and
build, and whitespace checks. The runner tests cover range-response correctness,
HTTP delivery controls, trial-order balance, warmup exclusion, summary math,
and rejection of incomplete/duplicate/invalid measured samples. Tests completed
before the measured browser run.

## Initial failure and protocol correction

The initial `no-store` attempt was rejected in its first warmup after Chromium
reported `net::ERR_ABORTED` for the PDF despite completing a canvas render. It
produced no accepted performance comparison. The observed behavior is consistent
with [Playwright issue #42742](https://github.com/microsoft/playwright/issues/42742)
for the same versions; the internal cause was not independently proven here.

Before the successful run, `Cache-Control` changed to `no-cache` identically for
both variants while retaining new contexts, CDP cache disabling, and rejection of
all request failures. No abort was allowlisted. After-timing browser PDF-byte
identity checks were added. The corrected run had zero request failures. The
failed run remains at `results/raw/first-page-local/run-zeoSxt/report.json`.

## Evidence and remaining coverage

The complete machine-readable evidence is
`../results/raw/first-page-local/run-e3Sman/report.json`, with the
two PNGs under its `samples/` directory. Its SHA-256 is
`483c454a0c28adfdc73dbf5e28069c8348389294003a66f96d15ddc9d76d19d4`.
It contains unrounded timings including all warmups, request logs, input and
source/compiled-code hashes, configuration, and environment. These generated
artifacts are Git-ignored; this execution record retains the summary and rounded
measured timings for a fresh checkout. Run the documented command to regenerate
local evidence. Report timestamps are UTC; the run occurred on November 16 in
America/Los_Angeles.

No work remains blocked for this first local pilot. Broader benchmark testing is
not complete: no controlled WAN/bandwidth/latency comparison, active PDF range
loading, other renderer/browser/platform, fully cold OS/font cache, compositor
presentation, or full-document browser rendering was measured. No statistical
significance or generalized linearization speed benefit is claimed. A future
range-delivery experiment needs a separately documented protocol; changing the
chunk size or corpus would change this baseline.

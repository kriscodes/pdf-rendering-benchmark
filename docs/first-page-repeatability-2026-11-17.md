# First-page repeatability check — November 17, 2026

Three additional executions of the unchanged local PDF.js/Chromium protocol
passed. Together with the [original November 16 run](first-page-local-2026-11-16.md),
the evidence contains **40 measured pairs (80 measurements)** and **16 excluded
warmup trials**, across four runs. This is a descriptive repeatability check on
one machine, not a statistical-significance test or a general linearization speed
claim.

The implementation is recorded in commit `1e9d25a`,
`Build corpus validation and local first-page benchmark`, on the unchanged
`feat/corpus-text-pair` branch. This record adds observations without changing the
experiment.

## Runs and results

Each run contains two excluded warmup pairs followed by ten measured AB/BA pairs.
The three additional runs executed serially, each launching a fresh browser
process. No failed repeat was discarded. The earlier rejected `no-store` warmup
attempt remains documented in the original execution record and is not one of
these four successful runs.

All dates and times in this table use America/Los_Angeles, PST (UTC−08:00).
The reports retain their original UTC audit timestamps.

| Run | Evidence directory | Local start | Local finish |
| --- | --- | --- | --- |
| 1 — original | `run-e3Sman` | 2026-11-16 23:33:39.176 | 2026-11-16 23:33:44.363 |
| 2 — repeat | `run-gPX30J` | 2026-11-17 17:03:16.421 | 2026-11-17 17:03:22.649 |
| 3 — repeat | `run-nW2Myj` | 2026-11-17 17:03:24.174 | 2026-11-17 17:03:30.204 |
| 4 — repeat | `run-NhoNyB` | 2026-11-17 17:03:31.784 | 2026-11-17 17:03:36.656 |

The main metric is `firstPageRenderMs`: `getDocument()` start through resolution
of page 1's canvas `render().promise`. Values below are milliseconds, rounded to
two decimals from the unrounded reports. Each variant has ten measured trials
per run. Quartiles use linear interpolation at `(n − 1) × q`.

| Run | Variant | Median | 25th–75th percentile | Min–max |
| --- | --- | ---: | ---: | ---: |
| 1 | Nonlinearized | 73.75 | 72.67–81.85 | 67.00–83.20 |
| 1 | Linearized | 73.00 | 72.02–74.30 | 66.10–78.60 |
| 2 | Nonlinearized | 71.15 | 69.18–78.45 | 67.60–85.90 |
| 2 | Linearized | 75.35 | 70.42–82.05 | 68.20–89.70 |
| 3 | Nonlinearized | 97.25 | 86.15–110.30 | 66.80–121.70 |
| 3 | Linearized | 83.10 | 80.82–98.20 | 71.80–113.50 |
| 4 | Nonlinearized | 75.65 | 71.53–91.18 | 70.80–101.90 |
| 4 | Linearized | 81.55 | 73.40–88.35 | 69.60–91.30 |

Paired differences are **linearized minus nonlinearized** within each scheduled
pair. Negative values mean the linearized trial completed sooner in that pair.
The median of paired differences and the difference of the two marginal medians
are distinct statistics; they can even have different signs.

| Run | Median paired difference | Min–max paired difference | Linearized median − nonlinearized median |
| --- | ---: | ---: | ---: |
| 1 | −3.80 | −11.00 to +6.00 | −0.75 |
| 2 | −0.10 | −10.20 to +20.60 | +4.20 |
| 3 | −4.75 | −45.80 to +16.40 | −14.15 |
| 4 | −1.00 | −17.40 to +17.70 | +5.90 |

Across all 40 measured pairs, the linearized trial was faster in 23 and slower
in 17. Every per-run median paired difference was negative, while the marginal
median difference changed sign between runs. Timing distributions varied, most
visibly in run 3. These observations do not establish the source of that
variation or a transferable performance advantage.

The [trial CSV](data/first-page-repeatability-2026-11-17.csv) preserves **all 96
unrounded trial rows**, including phase, pair, position, variant, and all four
timing fields. Filter `phase=measured` for the 80 measurements used above and join
on `runId` and `pair` for the 40 paired differences; the 16 `warmup` rows are
excluded from statistics. The [comparison JSON](data/first-page-repeatability-2026-11-17.json)
preserves unrounded per-run summaries, report identities, counts, and comparison
metadata. These files avoid losing the raw measured data to display rounding.
An [independent audit](data/first-page-repeatability-audit-2026-11-17.json)
recomputed the summaries and checked each trial's schedule, diagnostics, worker,
downloaded bytes, pixels, and HTTP evidence against the recorded controls.

## Matching controls and accepted-trial checks

Direct comparison of the four raw reports found exact equality of their
experiment definition, complete schedule, corpus manifest and manifest hash,
recorded environment, delivery/cache/worker/timing controls, and all twelve
recorded source and compiled-code hashes. The twelve source hashes also matched
the current local files when this record was prepared. Run IDs, timestamps,
ephemeral ports, and measurements are naturally run-specific.

The unchanged [protocol](first-page-local.md) uses a real dedicated PDF.js worker,
a 612 × 792 first-page canvas at scale/DPR 1, and serial balanced trial order.
Each trial receives a new nonpersistent context, disabled HTTP cache, blocked
service workers, and the same `Cache-Control: no-cache` response policy. Assets
are preloaded into a loopback server; no compression, artificial latency, or
bandwidth constraint is applied. Worker startup and PDF transfer/parse/render
are inside the timer. Browser launch, viewer navigation/main-module import,
PDF/pixel readback and hashing, and PNG capture are outside it.

All 96 trials passed the real-worker, browser-diagnostic, page-count, dimensions,
nonblank-pixel, and downloaded-PDF identity checks. Every trial across all four
runs had the same RGBA hash:

`527747daf68cf54de7953e3fa106a4c0c044b6162d782bb5f8838e158575e947`.

All four reports confirm the on-disk corpus remained unchanged during their
respective runs. They record **96 successful PDF responses, all HTTP 200, and
zero Range requests** in total. The PDFs remain 86,329 and 87,189 bytes, below
PDF.js's 131,072-byte range-loading threshold for the configured 65,536-byte
chunk. These results therefore concern local full-response loading, not partial
or constrained-network delivery. Server response-byte records do not measure
bytes received by the first-render milestone.

Agent-assisted inspection also opened both saved first-page samples from run 4.
All eight browser sample PNGs across the four runs are byte-identical, with
SHA-256 `8ec824ed6e1251ca38249ef8de9b17af846aec0d81cdfbff8d57f57763657bea`.
Automated equality to the same RGBA hash was checked for every trial. The original
run's sample review is recorded in its execution document; this remains a
first-page review rather than inspection of every browser-rendered document page.

## Missing-artifact recovery before the repeats

Before these repeat runs, both generated PDFs were absent from
`corpus/generated/pilot/`, while the original manifest remained. The reason for
their absence is unknown. The unchanged generator reconstructed the pair in
`results/raw/corpus-validation/restore-lrdr5evj/`. Its source hash and complete
document records, including both PDF hashes and sizes, matched the original
manifest before restoration.

Only the two PDFs were copied back, using exclusive creation to avoid replacing
an existing file. The original manifest was not replaced or edited. Its SHA-256
remains `92929ca2eb94964f13c592e11551d7821f8a8b110ba546596aa951c8deae2f8a`.
Both restored PDFs match the original identities documented in the
[corpus-validation record](validation-2026-11-16.md).

The reconstruction manifest's generator digest is
`3af45d05ddcc22bb69e38463e915cbc4cfb4250e189f32f27f9ede50c8e1d978`,
matching the current unchanged generator. It differs from the older retained
manifest's generator digest because the earlier corpus-validation work added
the optional output-directory argument. That already documented provenance
difference does not change source/PDF identities. Reconstruction tool-version
fields also match those in the retained manifest.

## Environment and commands

All four reports identify Apple M2, eight logical CPUs, 8 GiB memory,
macOS/Darwin 24.6.0 arm64, Node 24.22.1, PDF.js 5.6.205, Playwright 1.62.1,
qpdf 12.4.2, and Chromium Headless Shell 151.0.7922.34, revision 1234, without
an executable override. The runs used pnpm 11.25.0. The declared Node
24.22.3 and pnpm 11.28.12 remain unverified; the actual Node satisfies the
24.x engine constraint.

The same runtime selection and pnpm pre-run-check setting as the
original execution were used:

```sh
# Select the Node version recorded for this experiment before running commands.
export pnpm_config_verify_deps_before_run=false

# Reconstruct into a separate directory; verify identities before restoring PDFs.
.venv/bin/python packages/corpus/scripts/generate_text_pair.py \
  --output-dir results/raw/corpus-validation/restore-lrdr5evj

# Three separate invocations, executed serially.
pnpm bench:first-page
pnpm bench:first-page
pnpm bench:first-page

pnpm test
pnpm typecheck
git diff --check
```

Workspace typecheck and all **37 tests (22 corpus + 15 runner)** passed on
November 17. Each benchmark command builds the runner before measurement; build
time is excluded. The restoration command above records the directory used in
these repeat runs; ordinary benchmark runs read existing validated inputs and do not
regenerate them. The restoration itself did not rerun the all-page Poppler
comparison; it recovered the exact previously validated PDF bytes.

## Evidence identities and interpretation limits

Each report is under `results/raw/first-page-local/<run-id>/report.json`, with
its samples in the sibling `samples/` directory. Report SHA-256 values are:

| Run ID | Report SHA-256 |
| --- | --- |
| `run-e3Sman` | `483c454a0c28adfdc73dbf5e28069c8348389294003a66f96d15ddc9d76d19d4` |
| `run-gPX30J` | `a2a6e58caeec27bf56992ef7bae9ddcda8e19ae184baf6a11a85edc3b656759e` |
| `run-nW2Myj` | `71ec417bfaf82133d3f43735fdb4308162d00aa7a4db219a30f6a78416b5fee1` |
| `run-NhoNyB` | `ee111ae6cf84084c5349390d1f8d9a8e9de00cb89f766e321f1730e7a41097fa` |

The three new runs were back-to-back on one machine. A fresh browser process per
run does not reset OS/font caches, control machine load or thermal state, or make
these independent environmental replications. Within each run, the browser
process is shared across trials. The 40 measured pairs must not be treated as 40
independent machines or environments.

No significance test, confidence interval, or generalized speed advantage is
claimed. This check does not cover active PDF range loading, controlled WAN
latency/bandwidth, other browsers/renderers/platforms, fully cold OS/font caches,
compositor presentation, or full-document browser rendering. Standard Helvetica
remains unembedded. A future range-delivery experiment needs a separately
documented protocol; changing chunk size, corpus, or delivery conditions would
change this baseline. Raw generated evidence remains Git-ignored; the CSV,
comparison JSON, and this record preserve the observations separately.

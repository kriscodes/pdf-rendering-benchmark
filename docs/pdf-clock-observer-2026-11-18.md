# PDF-workload observer integration results — 2026-11-18

The single fixed campaign completed all **96 scheduled PDF trials**. Every clock calculation passed the unchanged 5 ms gate: 48 actual-three references, 48 nested references within actual-fifteen trials, and 48 fifteen-bracket candidates. Workload checks passed **95/96 trials**; one actual-three trial failed the unchanged delivery-pacing limit. All six pre/post session guards passed. No trial or campaign was replaced.

The candidate narrowed intervals but rescued zero nested clock failures. Across **47 valid adjacent pairs**, the fifteen-minus-three median was **+8.991 ms for clock collection** and **+3.900 ms from render to verification start**. The first-render duration difference was −0.100 ms with substantial variation. This is an observer integration/perturbation diagnostic, not a new accepted PDF performance replication or proof of non-perturbation.

## Inspection and implementation

Reviewed the current branch and commit history, preserved baseline/corpus, controlled-delivery runner/viewer and pacing/calibration rules, three rejected replication attempts, completed known-event clock diagnostic, and Lab 001's proposed integration step. The checkout began clean and stayed on `feat/corpus-text-pair`.

The protocol and new preservation lock were committed before execution as `d6a6c94`. The fixed schedule and pure clock analysis/tests followed as `e3557a8`; the separate runner as `40e7fc5`; the independent audit and selection tests as `8ddf9fb`. The original renderer, viewer, controlled-delivery benchmark, PDFs and prior records were not edited. New source files implement bounded execution, paired observer arms, explicit failure retention, source snapshots, and independent audit/export.

## Protocol executed

Three fresh headless Chromium sessions, each with four complete Williams blocks of nonlinearized/linearized × ranges enabled/disabled. Each condition-pair position held adjacent actual-three and actual-fifteen trials, with order balanced twice each way per condition per session. There were 48 pairs and no excluded warmups. The altered diagnostic count is separate from the historical warmed performance schedule.

Both arms used the unchanged `partial-loading.mjs` viewer: getDocument start through page 1 render promise resolution, then a separately invoked full-document verification. Clock bursts occurred before the render call, after it returned but before getData, and after verification. Actual-three collected one bracket at each point; actual-fifteen collected five, with its first bracket per point also analyzed as the nested reference. No sampling was added inside the render timer. All prescribed samples were collected before analysis; no narrowness-based selection or retries.

The 1 ms calibration margin, second 1 ms marker-mapping margin, and strict 5 ms first-render width limit remained unchanged. Empty intersections would be rejected and finite failed-width intervals retained. Operational validity was separate from clock acceptance, so a width rejection would not remove an otherwise valid pair from perturbation analysis.

Original PDF bytes, real worker, 100 pages, 612 × 792 canvas, original pixels, scale/DPR 1, viewport 1280 × 1000, fresh context, disabled HTTP cache, blocked service workers, 16 KiB range chunks, streaming/autofetch enabled, and standard-font policy remained fixed. The synthetic PDF-only profile stayed at a 100 ms header delay and nominal shared 125,000 B/s body cap with charged quanta up to 2,048 bytes. Known-event controls and full single/concurrent/unshaped delivery calibrations ran before and after each session.

## Execution and completeness

The only campaign ran on November 18, 2026, **08:02:58.877–08:05:22.740 PST**, corresponding to 16:02:58.877–16:05:22.740 UTC, and exited 0. Raw evidence is `results/raw/pdf-clock-observer/run-ZRNvgM/report.json`. Status `complete` means the fixed schedule finished, not that every workload passed.

| Session | Trials attempted | Workloads valid | Clock calculations passed | Comparable pairs | Pre/post guards |
| --- | --- | --- | --- | --- | --- |
| 1 | 32 | 31 | 48 / 48 | 15 / 16 | Both passed |
| 2 | 32 | 32 | 48 / 48 | 16 / 16 | Both passed |
| 3 | 32 | 32 | 48 / 48 | 16 / 16 | Both passed |
| Total | 96 | 95 | 144 / 144 | 47 / 48 | 6 / 6 |

All **864 PDF-trial brackets plus 90 known-control brackets** are retained. There are no unattempted trials or controls. Six known-event controls and 18 delivery-calibration groups passed. No clock intersection was inconsistent or exceeded the gate.

### The retained workload rejection

`session-1-block-1-linearized-range-enabled-three` failed because its initial HTTP 200 response's **eleventh 2,048-byte body write (index 10) was 161.613291 ms late**, against the unchanged 25 ms maximum. Independent inspection found this to be the only out-of-limit write in the campaign. The ledger establishes a delayed release, not its underlying scheduling cause.

Its clock width was **4.661 ms**, which passes. Its raw first-render duration, 1401.3 ms, PDF and RGBA hashes, worker and network evidence remain in the raw record. The trial and its paired fifteen-bracket trial are excluded as a pair from perturbation summaries because one workload violated delivery controls. This is not an outlier deletion based on duration or a clock failure. The separate fifteen-bracket execution does not rescue this rejected workload.

There are **23 saved PNGs**, all byte-identical to the original sample (`8ec824ed6e1251ca38249ef8de9b17af846aec0d81cdfbff8d57f57763657bea`). The failed first-block trial's expected 24th PNG was not saved because pacing validation failed before the sample write. Its canvas hash is retained and matches the original.

## Clock outcomes under PDF load

The table separates clock-gate acceptance from the combined workload-and-clock result. Width statistics include all finite intervals, including the operationally rejected trial.

| Analysis | Clock passes | Workload + clock passes | Minimum width | Median width | Maximum width |
| --- | --- | --- | --- | --- | --- |
| Actual-three reference | 48 / 48 | 47 / 48 | 4.376 ms | 4.492500 ms | 4.661 ms |
| Nested reference in actual-fifteen | 48 / 48 | 48 / 48 | 4.311 ms | 4.456500 ms | 4.711 ms |
| Actual-fifteen candidate | 48 / 48 | 48 / 48 | 4.154 ms | 4.234500 ms | 4.353 ms |

Within the same 48 actual-fifteen executions, both methods passed every trial: zero nested-only, candidate-only, neither, or unavailable outcomes. The paired candidate-minus-nested width median was **−0.198500 ms**, range −0.423 to −0.071 ms. This is distinct from subtracting the two marginal medians. Nested render-event classifications and verification-phase request assignments changed in **zero** trials.

A narrower intersection follows mathematically from additional constraints and is not independent accuracy evidence. The 36-probe fixture campaign and this PDF campaign both had zero nested acceptance gains. The earlier rejected PDF replications remain rejected; their clock instability was not reproduced here.

## Observed perturbation between actual arms

Differences are **fifteen minus three within each adjacent condition pair**, using the 47 pairs with valid operations/content and successful session guards. No clock-gate filtering, warmup deletion, significance test, equivalence test, or historical pooling was applied. All failed/non-comparable rows remain visible in the exports.

| Paired difference | Minimum | Median | Maximum |
| --- | --- | --- | --- |
| Sum of clock-burst elapsed times | -14.622 ms | 8.991 ms | 20.959 ms |
| Render → verification-start gap | -37.800 ms | 3.900 ms | 9.300 ms |
| Controller render-return → verification-call gap | -18.565 ms | 4.081 ms | 9.139 ms |
| First burst start → final burst finish | -16.832 ms | 6.080 ms | 63.292 ms |
| Final burst → drain completion | -34.244 ms | -0.101 ms | 21.122 ms |
| Full trial elapsed | -214.037 ms | 5.299 ms | 139.798 ms |
| getDocument → first-page render | -28.400 ms | -0.100 ms | 51.000 ms |
| Sum of CDP bracket spans | -12.932 ms | 5.788 ms | 12.035 ms |

These are observed paired differences, not a noise-free causal decomposition. The sampling window includes rendering and full verification; full-trial elapsed also includes context setup and teardown. The post-observation drain span includes intervening validations and protocol calls, not only network waiting. CDP bracket spans omit some call overhead. Negative differences and all large variations remain in the record.

| Session | Comparable pairs | Median collection difference | Median render→verification difference | Median first-render difference |
| --- | --- | --- | --- | --- |
| 1 | 15 | 9.488 ms | 4.700 ms | -0.100 ms |
| 2 | 16 | 8.934 ms | 4.000 ms | -1.550 ms |
| 3 | 16 | 8.647 ms | 3.400 ms | -2.150 ms |

Order matters to interpretation: first-render paired medians were **−4.600 ms when actual-three ran first (23 valid pairs)** and **+0.650 ms when actual-fifteen ran first (24 pairs)**. Overall first-render IQR was −11.100 to +6.800 ms, with range −28.400 to +51.000 ms. A near-zero overall median does not establish that added observation has no effect. The nested reference shares all fifteen samples' overhead and cannot substitute for the separate actual-three arm.

### Request accounting and classification

All 288 PDF requests completed, including 192 Range requests; CDP body totals match response Content-Length and no browser/network errors were recorded. Each actual-arm pair had identical total Range counts, total CDP-reported body bytes and completed Resource Timing body bytes. Counts do not establish identical timing or unique-document coverage.

Comparing the actual-fifteen candidate with the separate actual-three reference, before-render body buckets differed in **12/47 valid pairs** (−2,048 to +4,096 bytes, median zero). The uncertain bucket differed in **one pair** (+4,096 bytes). After-render buckets differed in 12 pairs (−8,192 to +2,048 bytes, median zero). All changed pairs were range-enabled conditions. Verification-phase request counts and initial-200 completion classifications differed in zero pairs. The full changed-pair list is retained in the supplemental audit JSON.

These differences combine separate executions, sampling schedules and clock boundaries; they are not proof that extra sampling caused a specific byte movement. In contrast, the nested analyses of identical executions had zero classification changes. Repeated/overlapping range bytes are not unique PDF bytes, and CDP event times are not physical arrival or renderer-consumption times.

## Delivery controls and preserved identity

All six known controls classified their first 4,096-byte range before the marker and second range after, with no uncertain or opposite-side evidence. Candidate control widths were 4.167–4.322 ms; nested control widths were 4.311–4.501 ms. Their requested 30 ms gaps supply coarse ordering checks, not sub-5-ms ground truth.

All pre/post single/concurrent/unshaped delivery groups passed the unchanged limits:

| Session / stage | Single body span, server / browser | Concurrent body span, server / browser | Unshaped browser duration |
| --- | --- | --- | --- |
| 1 / before | 586.490 / 587.600 ms | 1162.424 / 1161.600 ms | 1.400 ms |
| 1 / after | 573.265 / 573.900 ms | 1170.586 / 1170.200 ms | 4.900 ms |
| 2 / before | 575.774 / 575.900 ms | 1158.686 / 1158.300 ms | 1.400 ms |
| 2 / after | 585.128 / 586.100 ms | 1163.343 / 1163.700 ms | 3.100 ms |
| 3 / before | 574.812 / 575.200 ms | 1162.164 / 1163.500 ms | 2.800 ms |
| 3 / after | 578.428 / 578.700 ms | 1155.714 / 1154.600 ms | 5.800 ms |

Nominal charged body budgets are 524.288 ms for one 65,536-byte range and 1048.576 ms for two concurrent ranges. This remains an artificial application-level delivery profile, not WAN RTT or exact browser throughput. Passing pre/post calibration did not prevent the single intervening write-lateness violation.

Both independent audits confirmed all 96 retained full-document hashes/lengths, original pixel hashes, page count, dimensions, real-worker checks and render-before-verification ordering. The pacing rejection remains invalid despite matching content. All **98 protected source files, 157 prior artifacts and 29 executed-source snapshots** match their hashes, including the original PDF pair and manifest. The baseline and rejected historical reports remain unchanged.

## Commands, tests and analysis correction

Runtime: Node 24.22.1, pnpm 11.25.0, Python 3.13.18, PDF.js 5.6.205, Playwright 1.62.1, Chromium 151.0.7922.34 and qpdf 12.4.2 on Darwin 24.6.0 arm64, Apple M2, 8 logical CPUs, 8 GiB RAM. Repository-declared Node 24.22.3 and pnpm 11.28.12 remain unexercised. No dependencies were changed.

```sh
export PATH="/Users/kristian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export pnpm_config_verify_deps_before_run=false
pnpm test
pnpm typecheck
.venv/bin/python -m unittest discover -s packages/runner/scripts -p 'test_*.py' -v
node packages/runner/dist/pdf-clock-observer.js
.venv/bin/python packages/runner/scripts/audit_pdf_clock_observer.py \
  --report results/raw/pdf-clock-observer/run-ZRNvgM/report.json \
  --output-prefix docs/data/pdf-clock-observer-2026-11-18
```

Before measurements, 99 workspace tests (22 corpus, 77 runner) plus 21 Python tests passed: **120 tests**, with successful builds and type checks. No tests or intentional CPU-heavy audits ran during the campaign. The only runner invocation exited 0, and the independent audit passed with zero integrity issues.

The first audit export incorrectly used combined workload-and-clock status for three fields named `*ClockPassed` in pair rows. This mislabeled the rejected workload's passing clock. The calculation, gate, paired inclusion rule and numerical summaries were correct. Those labels were corrected to use clock-only status in commit `1343efd`, and a regression test was added; all **22 Python tests now pass (121 total tests checked)**. No measurement source or raw report changed. The initial script, test and exports remain under `run-ZRNvgM/preliminary-audit/` with their original hashes; the final exports use the corrected audit.

Software review covered failure handling, shared cleanup deadlines, guard completion and retained errors. This live campaign exercised isolated pacing rejection and continued collection, but did not exercise clock rejection under PDF load, inconsistent real clock intervals, deadline exhaustion, failed guard cleanup or forced browser termination. Unit tests cover interval failures and comparison exclusions; they do not replace those live paths.

## Evidence and decision

Final exports are `docs/data/pdf-clock-observer-2026-11-18.csv` (all 96 scheduled rows), `.pairs.csv` (all 48 pairs with one explicit exclusion), `.json` (full independent audit, per-session/condition/order summaries), and `pdf-clock-observer-extra-audit-2026-11-18.json` (paired network changes and the retained pacing rejection). Raw records, 29 source snapshots and 23 PNGs remain in the run directory and downloadable archive.

| Record | SHA-256 |
| --- | --- |
| Raw report | `a4008e456fb236af2c1e9a4aecd6de1b7ebefbf2b473aed2084dbb2136f8ce0c` |
| Final .csv export | `60d9d2736b021bd2200f94d8e746e085c8c3ab816c5fc54818fb21520d017db4` |
| Final .pairs.csv export | `f88ac97791a608806ed225f9e4cad4a89765e379f536f55614326048f819a52c` |
| Final .json export | `36f3e40fb289494185bc09b131c815d0890b080f4f52b17c7d7b4bb94d4e5b58` |

The bounded integration procedure and audit are complete. It supports successful clock collection under these preserved PDF controls, with measurable sampling/verification-delay differences and one separately rejected delivery workload. It does **not** demonstrate an acceptance-rate improvement, establish clock accuracy, or validate PDF performance repeatability. The old observer and all three historical rejections remain unchanged.

Keep the benchmark observer unchanged for now. If research continues, the next proposed step is a separately predeclared repetition of this integration protocol in different time windows to test whether the earlier clock instability recurs and whether the added brackets then improve acceptance, while retaining workload failures and measuring overhead. The single write delay can be investigated using its retained ledger; its cause remains unresolved. No additional campaign, observer adoption or performance replication was started.

Other days/machines/browsers/PDF profiles, exact renderer-consumed byte accounting, controlled OS/font-cache state and compositor presentation remain outside this step. Protocol, results and all evidence are saved under Labs → PDF Rendering Lab 001 → PDF-workload observer integration. The final upload/download receipt is recorded separately in `docs/data/pdf-clock-observer-publication-2026-11-18.json`.

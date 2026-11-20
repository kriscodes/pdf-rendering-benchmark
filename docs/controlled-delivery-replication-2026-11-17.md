# Controlled delivery replication results — 2026-11-17

All three predeclared replication attempts were executed. **None was accepted.**
Every attempt stopped during warmup because the reconstructed render-boundary
clock uncertainty exceeded the unchanged 5 ms limit. No measured trial started,
so this batch cannot confirm or refute the original timing differences.

The fixed-attempt procedure is complete; performance repeatability remains
unverified. No failed attempt was replaced, no limit was widened, and no new
performance estimate was computed. Original PDFs, baseline, diagnostic, and
controlled-pilot records remain unchanged.

## Attempt outcomes

The [committed protocol](controlled-delivery-replication.md) specified exactly
three invocations irrespective of outcome. All ran on November 17, 2026, PST
(America/Los_Angeles). Each direct Node runner launched Chromium using the
preserved implementation; browser process IDs were not separately observed.

| Attempt | Time (PST) | Runner PID | Warmups started / passed | Failed condition | Clock width |
| --- | --- | ---: | ---: | --- | ---: |
| 1 | 22:34:06–22:34:17 | 17057 | 4 / 3 | Nonlinearized, ranges disabled | 5.176 ms |
| 2 | 22:34:17–22:34:27 | 17099 | 3 / 2 | Linearized, ranges disabled | 5.284 ms |
| 3 | 22:34:27–22:34:37 | 17131 | 1 / 0 | Nonlinearized, ranges enabled | 5.005 ms |

Each runner exited 1 without timing out. Eight warmup trials started: five passed
before three failing trials stopped their respective invocations. No warmup block
completed and zero measured trials started. The third width is slightly above
5 ms; it was not rounded down to obtain a pass.

Batch evidence: `results/raw/controlled-delivery-replication/batch-z0z3m48b/`.
Its ledger has status `complete`, meaning all three fixed attempts finished.
This does not mean the benchmark invocations passed. Each `replicate-N/` contains
its raw report and 19 exact executed source snapshots; merged console logs are
stored beside the ledger. No new condition screenshots were expected because the
runner saves them only in the first measured block, which was never reached.

## Independent audit and preserved controls

Two independent read-only analyses confirmed the failure causes, source/data
identities, and available network evidence. The comparison reports **0 accepted
additional runs out of 3** and marks across-session estimates `not-estimable: no
accepted additional run`. Historical statistics stay labeled as historical.

All 70 preserved source files and 71 prior artifacts match the replication plan.
The plan and launcher hashes match their execution ledger; preservation checks
passed before and after every attempt and at batch boundaries. Every report hash
matches its ledger entry, and all 19 source snapshots per attempt match their
recorded hashes. Experiment settings, baseline lock, corpus, environment, source
hashes, controls, and intended schedule match historical accepted `run-VnOBcz`.

All eight retained trial records contain the original full-PDF and first-page
pixel hashes, 100 pages, correct 612 × 792 dimensions, a real PDF worker, and
render-before-verification ordering. Independent inspection found no browser
warning/error, failed CDP request, incomplete/canceled server response, or
response-body-length mismatch. These checks do not override the clock gate or
make the rejected invocations valid performance samples.

The existing observer controls all passed. Their independently reconstructed
boundary widths were 4.608, 4.817, and 4.634 ms, and each correctly classified two
known 4,096-byte transfers before/after its marker. The later PDF-trial clock
brackets were too wide; a passing preliminary probe did not guarantee that every
subsequent trial would satisfy the same precision requirement.

The retained three brackets per failing trial reconstruct the offset interval,
then the render-boundary interval, using the existing 1 ms resolution margin at
both stages. The final widths were 5.175999831, 5.283999490, and 5.004999926 ms.
The diagnostic preserves every input sample and the reconstructed intervals in
[data/controlled-delivery-replication-clock-audit-2026-11-17.json](data/controlled-delivery-replication-clock-audit-2026-11-17.json).
These assumed resolution margins are not a universal proof of clock accuracy.
The evidence identifies insufficient alignment precision; it does not isolate
its underlying scheduling, transport, or clock cause.

## Calibration reached before each rejection

All three groups in each pre-experiment delivery calibration passed the original
limits, including exact known bytes, valid partial responses, shared serialization
budget, concurrent overlap, browser/server timing agreement, and the unshaped
control. The target remains a 100 ms header delay and nominal 1 Mbit/s shared body
cap, not WAN RTT emulation.

| Attempt | Single-range server / browser body span | Concurrent server / browser body span | Unshaped browser duration |
| --- | ---: | ---: | ---: |
| 1 | 578.853 / 579.400 ms | 1154.407 / 1154.200 ms | 4.6 ms |
| 2 | 580.586 / 581.000 ms | 1161.880 / 1162.000 ms | 9.2 ms |
| 3 | 578.210 / 577.800 ms | 1190.129 / 1191.500 ms | 8.7 ms |

The nominal body budgets are 524.288 ms for 65,536 bytes and 1048.576 ms for two
concurrent 65,536-byte ranges. Observed pre-calibration body throughput was about
0.881–0.908 Mbit/s, within the predeclared bounds. All observed paced responses
also passed an independent release-ledger audit.

**Post-experiment calibrations were never reached.** The rejected reports have
no performance summary and no successful final runner-preservation flags. Separate
launcher preservation checks passed after each process exited. Do not describe
these attempts as having passed both calibration gates or all trial validations.

## Execution, tests, and analysis records

The unchanged experiment used Node 24.22.1, PDF.js 5.6.205, Playwright 1.62.1,
Chromium 151.0.7922.34, and qpdf 12.4.2 on the same Apple M2/Darwin 24.6.0 arm64
host. The repository-declared Node 24.22.3 and pnpm 11.28.12 remain unexercised;
commands used installed pnpm 11.25.0 and Python 3.13.18. Dependencies, PDF bytes,
benchmark source, settings, and calibration thresholds were not changed.

```sh
# Select the Node version recorded for this experiment before running commands.
export pnpm_config_verify_deps_before_run=false
pnpm test
pnpm typecheck
.venv/bin/python -m unittest discover -s packages/runner/scripts -p 'test_*.py' -v
.venv/bin/python packages/runner/scripts/run_delivery_replicates.py \
  --plan experiments/controlled-delivery-replication.json \
  --node "$(command -v node)"
.venv/bin/python packages/runner/scripts/compare_delivery_replicates.py \
  --plan experiments/controlled-delivery-replication.json \
  --ledger results/raw/controlled-delivery-replication/batch-z0z3m48b/ledger.json \
  --output-prefix docs/data/controlled-delivery-replication-2026-11-17
```

Before measurements, all 79 existing tests, 13 new launcher/comparison tests,
and workspace type checks passed. The new launcher tests use simulated processes,
including failure/timeout continuation, no replacement, preserved partial reports,
process-group cleanup, changed-input refusal, and nonempty-output refusal.

After observing zero accepted additions, the comparison presentation was made
explicitly non-estimable instead of displaying a range from the lone historical
session. A regression test was added; the final 14 Python tests pass (93 total
existing/new tests checked). This changed only analysis presentation, not the
measurement protocol or rejection decisions. Preliminary comparison exports are
retained under the batch's `preliminary-comparison/` directory.

Final exports:

- [Session-condition CSV](data/controlled-delivery-replication-2026-11-17.csv): four explicitly historical condition rows plus three rejection rows.
- [Trial CSV](data/controlled-delivery-replication-2026-11-17.trials.csv): 64 historical rows only, including 16 flagged warmups; **zero new accepted timing rows**.
- [Comparison JSON](data/controlled-delivery-replication-2026-11-17.json): outcomes, integrity checks, metadata comparisons, historical statistics, and non-estimable replication status.
- [Clock rejection audit](data/controlled-delivery-replication-clock-audit-2026-11-17.json): retained brackets, reconstructed intervals, and failure confirmation.

The CSVs do not pool or summarize partial warmups from the rejected runs. Their
full records remain in the three raw reports. No complete-run request-pattern
comparison can be made from these incomplete warmups.

Checksums:

| Record | SHA-256 |
| --- | --- |
| Execution ledger | `836ef8b53c64692fc4b4a7560f563a31d5c36733ad0bd8cfeca7e51b09d2f7bd` |
| Attempt 1 report | `1f8fae1fd5991e59e0f1d5a95bc59e9c6d7efe1ebda4dad94d27f3bf281ac7b8` |
| Attempt 2 report | `9592712ad7ec3e34566c2a1df908e110b18f541a8619d2b243ad7c32c9d4e8e6` |
| Attempt 3 report | `a4cafefac2dacaa5ff4c423d556948ee78250f3372153b393508ef8fcbdc44d9` |

Work stayed on `feat/corpus-text-pair`. Milestone commits: `08f78a9` (protocol),
`69d77ec` (launcher/comparison and tests), and `fc23f98` (rejected outcomes and
non-estimable analysis), followed by the final notebook/publication record.
Protocol, results, every attempt, source snapshots, and a download-verified
archive are saved under Labs → PDF Rendering Lab 001 → Controlled delivery
replication. The publication receipt is recorded separately from the archive.

## Remaining question and proposed follow-up

The original pilot's performance results are neither replicated nor contradicted
by this batch. The procedure correctly enforced its observation-quality gate,
but the repeatability question remains unanswered.

A separate, bounded clock-observer diagnostic is now the appropriate next step:
evaluate a predeclared fixed number of additional brackets at each observation
point, retain every sample, and intersect their valid intervals. Keep the existing
1 ms margins and 5 ms gate; reject inconsistent intervals and retain fixed
operation deadlines. Validate with known-event probes before defining another
benchmark protocol. Do not sample until a pass appears, reinterpret rejected
warmups as measured trials, or retroactively rehabilitate this batch.

That instrumentation diagnostic has not been implemented or run. Additional
performance replication, other days/machines, other profiles/PDFs/renderers,
exact renderer-consumed byte accounting, and production generalization remain
unverified. No further benchmark attempts or hosting were started.

# Controlled PDF delivery replication protocol

Question: do the controlled-delivery pilot's within-block timing differences and
observed request patterns recur in additional invocations with every experiment
setting unchanged? This follows the proposed replication step in Lab 001. It is
a same-machine repeatability check, not a new delivery profile or corpus.

## Fixed scope and stopping rule

Before execution, commit `experiments/controlled-delivery-replication.json` and
this protocol. Run exactly **three additional serial invocations**, counting
passes, failures, and timeouts. Each invocation starts a separate Node runner and
Chromium process. Do not replace failed invocations, rerun individual trials,
widen acceptance limits, or continue until a desired number of passes appears.
A 600-second whole-invocation ceiling bounds a hang, in addition to the existing
per-operation timeouts. Halt if preserved files change or execution cannot
continue; report any unattempted invocations instead of claiming completion.

The historical comparator is the accepted `run-VnOBcz`, SHA-256
`87070956c2672ed172d0b25660d2757df6fb29e0e29725858067f7a891d7cc64`.
The earlier rejected `run-JH48Id` stays visible in the lab history. Its partial
measurements are not substituted for a new replicate or included in summaries.

## Unchanged experiment

Use the existing compiled `controlled-delivery.js` and
`experiments/controlled-delivery.json` without editing them. Preserve the original
PDF/manifest bytes and all prior tracked work, plus the original executed-source
hashes and retained controlled-pilot reports, samples, and source snapshots.
Verify the new preservation manifest before and after execution.

The four conditions remain nonlinearized/linearized × PDF.js ranges
enabled/disabled. Each accepted invocation contains 16 excluded warmups plus 48
measured trials (12 per condition), in the same deterministic Williams order.
Fresh context and real PDF worker per trial; disabled HTTP cache; scale/DPR 1;
16 KiB range chunks; streaming and automatic fetching enabled. PDF.js 5.6.205,
Playwright 1.62.1, Chromium 151.0.7922.34, and Node 24.22.1 remain fixed.

The synthetic PDF-only profile remains a 100 ms response-header delay and a
shared 125,000-byte/s body cap, fully charged before releasing each quantum of
at most 2,048 bytes. Worker and application assets stay unshaped. Actual measured
calibration rates must be reported; the cap is not exact browser throughput or
a simulation of WAN round-trip latency.

Retain the existing observer probe, pre/post single/concurrent/unshaped delivery
calibrations, clock uncertainty rules, body/worker/dimension/pixel checks, and
all failure gates. The render milestone still precedes explicit full-document
verification. Drain requests before context teardown. No experimental code,
calibration tolerance, or loading-mode flag changes between invocations.

## Collection and analysis

Use a new batch directory with a durable execution ledger, separate report and
console log for each ordinal, and the runner's exact source snapshots and samples.
Record start/end timestamps, direct runner process IDs, exit codes, report hashes,
and any failure reason. Process IDs and unchanged launch code establish separate
invocations; do not invent observed browser process IDs.

Report all three attempted outcomes first. An accepted run must have exit code
zero, report status passed, the complete 64-trial schedule, matching configuration,
source/environment/PDF identity, and independently recomputed checks. A failed,
partial, missing, or invalid report gets no performance summary. Preserve its
available evidence and explain missing verification. A failed experiment does
not become a pass because some individual trials completed.

For every accepted run, retain all trial rows with explicit warmup flags and
report condition medians/quartiles/ranges, within-block linearized-minus-
nonlinearized differences for each loading mode, range-enabled-minus-disabled
differences for each PDF, and the difference of the two structure effects.
Compare those **session-level** summaries with the historical run; do not pool
trial timings as independent environmental observations. Across-session ranges
of those descriptive summaries are allowed, with accepted-session counts shown.
No significance test, confidence interval, or selected-outlier deletion is planned.

Compare actual range starts/completions around render, overlapping body totals,
uncertain events, and calibration results. An unfinished initial HTTP 200 does
not by itself establish incomplete unique-document delivery; CDP byte sums
include repeated/overlapping ranges. Keep requests starting near full-document
verification separate from first-page evidence.

## Execution and interpretation

Run tests/checks before measurements. Avoid analysis, tests, and other intentional
CPU-heavy tasks during the three invocations. There is no prescribed cooling
interval or OS/font-cache reset; runs are serial on the same host, with existing
OS scheduling and background load. Fresh browser processes do not create
independent machines or cross-day replications.

```sh
.venv/bin/python packages/runner/scripts/run_delivery_replicates.py \
  --plan experiments/controlled-delivery-replication.json \
  --node "$(command -v node)"

.venv/bin/python packages/runner/scripts/compare_delivery_replicates.py \
  --plan experiments/controlled-delivery-replication.json \
  --ledger results/raw/controlled-delivery-replication/BATCH/ledger.json \
  --output-prefix docs/data/controlled-delivery-replication-2026-11-17
```

`BATCH` denotes the new directory printed by the launcher. Save the precise
commands, outcomes, calibration values, independent audit, and downloadable
source/evidence archive under Lab 001. Commit the protocol, tooling, and results
as distinct milestones on the existing branch.

Agreement would support repeatability only among accepted consecutive invocations
under these controls. Failures and acceptance filtering remain part of the
result. If none pass, report that outcome without adding attempts. Other days,
platforms, PDFs, profiles, renderers, and loading modes remain outside this step.

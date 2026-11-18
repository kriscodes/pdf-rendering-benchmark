# PDF-workload clock-observer integration protocol

Question: does the fixed fifteen-bracket observer remain consistent and satisfy the unchanged 5 ms gate under the preserved PDF.js rendering workload, and what perturbation accompanies its additional sampling? The preceding fixture campaign passed both methods on all 36 probes. It established no acceptance-rate gain and did not reproduce the earlier PDF-trial clock rejections.

Commit this protocol, configuration and preservation lock before execution. This is a separately versioned instrumentation diagnostic. The original benchmark, original three rejected replications, exact PDFs, generator smoke-test purpose, and all prior results remain unchanged.

## One fixed campaign

Execute exactly one campaign with three fresh Chromium sessions. Each session uses four complete Williams blocks of the existing four conditions: nonlinearized/linearized × ranges enabled/disabled. Each condition position contains two adjacent trials, one per actual observer arm. Total: 3 × 4 × 4 × 2 = 96 trials, 48 adjacent pairs, 48 trials per arm. All trials are diagnostic observations; none is discarded as a warmup. This intentionally differs from the historical performance run's trial count and warmup exclusions.

Preserve condition-pair order from `createDeliverySchedule(0, 4)`: A B D C; B C A D; C D B A; D A C B. Within each pair, run the three-bracket arm first when session + block + condition-pair position is even, otherwise the fifteen-bracket arm first. This gives two of each arm order per condition per session. Williams balance applies to four condition-pair positions, not a fully counterbalanced eight-condition design. No shuffling or outcome-dependent replacement is permitted.

Use the existing `experiments/controlled-delivery.json` workload settings and unchanged HTML/viewer. Same original PDFs, real PDF worker, first-page canvas milestone, scale/DPR 1, viewport 1280 × 1000, fresh contexts, disabled HTTP cache, blocked service workers, 16 KiB range chunks, streaming/autofetch enabled, and preserved font policy. Only the scheduled condition changes disableRange. Use Node 24.22.1, PDF.js 5.6.205, Playwright 1.62.1 and Chromium 151.0.7922.34. Keep the PDF-only 100 ms response-header delay and nominal shared 125,000-byte/s cap with charged quanta of at most 2,048 bytes. No hosting or corpus changes.

## Fixed sampling and analysis methods

At each of three original PDF checkpoints collect a consecutive fixed burst:

1. `beforeRender`: after viewer readiness, before calling `runPartialFirstPage()` and its getDocument timer.
2. `afterRender`: immediately after that function returns its first-page marker, before explicitly calling `verifyPartialDocument()` / getData().
3. `afterVerification`: immediately after verification returns, before analysis.

The actual three-bracket arm collects one bracket per point. The actual fifteen-bracket arm collects five per point. Each bracket is CDP Timestamp → page performance.now() → CDP Timestamp. Collect the entire prescribed set before analyzing; no best-sample selection, retry-until-pass, or added sampling inside the getDocument-to-render timer. Expected PDF-trial total: 864 brackets (144 in the three-bracket arm, 720 in the fifteen-bracket arm), plus separately labeled controls.

For the three-bracket arm analyze all three brackets. For the fifteen-bracket arm analyze both the first bracket of each burst (nested reference) and all fifteen (candidate). Keep every raw sample and both outcomes. Reuse unchanged `calibrateOffset` and `mapPageTime`: 1 ms margin in calibration, another 1 ms at marker mapping, and the strict 5 ms first-render boundary-width gate. Reject empty intersections. Record the separately mapped full-verification boundary too. A width failure does not discard a finite interval or its event classification.

For every nonempty interval reconstruct PDF request/response/data/completion categories relative to render and request-start categories relative to explicit full verification, retaining uncertain events. Narrower intervals follow from adding constraints; they do not prove clock accuracy. PDF events have no independent sub-5-ms arrival ground truth. Report method-specific bucket differences and ambiguous events without treating all bytes near render as known-before or known-after. An incomplete initial response does not establish incomplete unique-document coverage; range bodies overlap.

## Controls, acceptance and stopping

Before and after each session, run a known-event control using the frozen minimal fixture and exactly five brackets at each of its three points. Its candidate must satisfy the existing 5 ms gate and classify the two complete known 4,096-byte transfers correctly with no uncertain or opposite-side events. Record nested-reference results separately; reference width rejection alone does not fail this candidate control. The 30 ms requested separations test coarse ordering, not clock accuracy at the gate's scale.

Also run the original single-range, concurrent-range and unshaped delivery calibrations before and after each session, using unchanged bytes and limits. A failed/missing control or calibration prevents calling the session validated. Halt the campaign on a failed session guard, changed protected input, unrecoverable cleanup or exhausted outer deadline. Preserve all available trials and list the unattempted schedule; no new campaign or replacement trial follows a rejection.

Separate trial operational/content validity from each method's clock outcome. Preserve existing checks: PDF/manifest/full-download identity, qpdf structure, 100 pages, 612 × 792 canvas, original RGBA hash, nonblank rendering, real worker, clean browser diagnostics, complete valid HTTP 200/206 evidence, CDP body totals matching Content-Length, zero ranges when disabled, drained server responses, and release-ledger pacing checks. Snapshot sources and retain representative PNGs for every condition/arm in the first block of each session.

A clock-width or non-overlap rejection alone must not abort remaining scheduled trials. Continue an isolated operational failure only after its context and server activity are safely cleaned up. Record its error and unavailable fields. No source/configuration changes are allowed during execution.

Bounds: 30 seconds per operation; 5 seconds per complete burst; 45 seconds per PDF trial; 180 seconds per session; 600 seconds per campaign; 10 seconds for cleanup. Use remaining monotonic deadlines rather than resetting an outer budget. Save after each trial and stage, retain failed/incomplete records, and explicitly distinguish complete collection from accepted observations. Timeout/cleanup failures must not become passes.

## Perturbation comparison and independent audit

Record page first-render duration, render-to-verification-start gap, individual burst elapsed times, their sum, all bracket spans, wall span from the first burst's start through the final burst's completion, and subsequent drain time. Added middle sampling delays getData while existing/background PDF requests can continue. The nested reference shares that delay; it cannot estimate the cost of separately executing three brackets.

Use adjacent actual-arm pairs to describe fifteen-minus-three differences in these measurements and request/body patterns. Include pairs with valid operation/content evidence and successful pre/post session guards **regardless of clock-gate outcomes**. This avoids selecting only quiet/fast clocks. Show every scheduled row, failed/non-comparable pair and exclusion reason. Report clock-qualified counts separately. These are descriptive instrumentation comparisons, not accepted PDF performance replication, equivalence/non-inferiority tests, or a linearization benefit analysis. Do not pool trials as independent machines/days or compare partial selected timings to historical performance estimates.

Within the fifteen-bracket arm, report both pass, nested-only, candidate-only, neither, inconsistent/unavailable, widths and classification differences by session and PDF condition. Independently recompute all intervals, event accounting, content/calibration evidence, schedule, paired comparisons and preservation hashes from raw reports. Retain all 96 scheduled rows even if incomplete. Preserve exact executed-source snapshots, original PDFs, old evidence, new raw records and audit exports in the Lab 001 archive; verify its downloaded bytes and manifest.

```sh
pnpm --filter @pdf-benchmark/runner build
node packages/runner/dist/pdf-clock-observer.js
.venv/bin/python packages/runner/scripts/audit_pdf_clock_observer.py \
  --report results/raw/pdf-clock-observer/RUN/report.json \
  --output-prefix docs/data/pdf-clock-observer-2026-11-18
```

Run software checks before measurements, and avoid intentional CPU-heavy analysis/tests during the campaign. Session launches are serial on the same host; no cooling interval or OS/font-cache reset is prescribed. Fresh browser processes are not independent environments. Preserve the current branch and commit protocol, implementation, results, and publication evidence as separate milestones.

## Decision boundary

A favorable result supports further evaluation of this versioned observer under these controls only. It does not retroactively accept rejected historical trials, prove assumed clock margins, establish exact renderer-consumed bytes, or complete performance-repeatability research. The original benchmark is not automatically switched to this observer. If failures remain, report them without widening gates or adding runs. Define any later performance replication or additional diagnostic separately from these results.

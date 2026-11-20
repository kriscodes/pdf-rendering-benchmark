# Final fixed-window campaign for Lab 001

## Question and scope

Close the existing local experiment by testing the preserved observer and PDF workload in three prospectively fixed time windows. Determine whether the original controlled-delivery performance protocol produces accepted evidence across those windows. This is a bounded closing campaign, not a search for a passing result or a broader browser benchmark.

Keep branch `feat/corpus-text-pair`, the original PDF pair, generated manifest, viewer, compiled runners, dependencies, earlier reports, and all earlier results unchanged. The generator remains a corpus smoke test. The original accepted controlled-delivery pilot is historical context, not a new window or a substitute for a failed attempt.

## Fixed schedule and stopping rule

Schedule declared on 2026-11-18 before any new measurements. Timezone: America/Los_Angeles (PST, UTC−08:00 on these dates). The JSON plan contains the authoritative UTC timestamps.

| Window | Target start (PST) | Permitted start interval (UTC) |
| --- | --- | --- |
| 1 | November 18, 2026, 09:00 | 2026-11-18 17:00:00 inclusive to 18:00:00 exclusive |
| 2 | November 18, 2026, 15:00 | 2026-11-18 23:00:00 inclusive to November 19 00:00:00 exclusive |
| 3 | November 19, 2026, 09:00 | 2026-11-19 17:00:00 inclusive to 18:00:00 exclusive |

The one-hour start allowance accommodates scheduler delivery and startup. Record actual starts, ends, and separation; do not describe them as exact six-hour/24-hour separations. Each window contains at most one observer integration invocation followed by one performance invocation. Each invocation has a 600-second outer time budget with bounded process-group cleanup. A window can finish after its start interval; the last possible measurement completion is approximately November 19, 18:21 UTC. The reporting target is November 19, 19:00 UTC (11:00 PST), subject to documentation service availability.

Stop after these three slots, regardless of outcomes. No replacements, extra trials, rescheduling, retry-until-pass, optional early stop for favorable results, observer changes, gate widening, or retrospective removal of failures. A missed start window remains missed. An interrupted or already claimed window is never relaunched. Missing evidence remains visible. Delayed auditing or publication is allowed; delayed measurement is not.

If runtime, branch, frozen-file integrity, exclusive execution, or process cleanup cannot be verified, record the affected invocation as blocked/unattempted and do not run dependent work in that window. Do not change branches or restore files automatically. A later fixed window may proceed if its independent checks pass. Scientific rejection by the observer diagnostic alone does not suppress the scheduled performance invocation, which must satisfy its own original guards. This prevents outcome-dependent selection.

## Per-window procedure

1. Check the authoritative plan, preservation hashes, current branch, and Node version. Acquire an exclusive campaign lock and an irreversible window claim. Confirm no earlier experiment process remains. Retain the exact plan and launcher provenance with the ledger.
2. Invoke the unchanged `packages/runner/dist/pdf-clock-observer.js` with a new output directory. Preserve its fixed 3 sessions × 4 Williams blocks × 4 conditions × 2 adjacent observer arms: 96 diagnostic trials. Keep all records, operational outcomes, session guards, nested three-bracket reference and fifteen-bracket candidate results. Clock rejection alone follows that runner's existing continuation rule.
3. Verify process cleanup and frozen inputs. Invoke the unchanged `packages/runner/dist/controlled-delivery.js` with a separate new output directory. Preserve 16 warmups + 48 measured trials, the original three-bracket observer, strict 5 ms boundary gate, and original pre/post controls. Its existing early rejection behavior stays unchanged.
4. Verify cleanup and frozen inputs again. Retain raw reports, console output, reports' source snapshots, images, timestamps, process exit and timeout status, and checksums. Audit after measurement, without intentional concurrent tests, builds, uploads, or other benchmark campaigns.
5. Independently audit each report and append the window outcome to Lab 001. Retain the original protocol, result exports, and checksum-verified raw evidence for reproducibility.

Maximum scheduled work: 288 integration trials and 192 performance trials across three windows. Early failures can reduce attempted counts; the maximum is not a quota to fill.

## Preserved controls

The nonlinearized and linearized PDFs remain 86,329 and 87,189 bytes, with SHA-256 `d9ad470b1f56976f907aad64712c2269b380cb0af7e52a5c3670dc3290af162a` and `efb5faa8018ec5a2b508eb703d55fa39e8cb4746b6aad29d05a841b6c3cf874a`. Manifest SHA-256: `92929ca2eb94964f13c592e11551d7821f8a8b110ba546596aa951c8deae2f8a`.

Preserve PDF.js 5.6.205, Playwright 1.62.1, Chromium 151.0.7922.34, Node 24.22.1, real worker, fresh browser context per trial, disabled HTTP cache, blocked service workers, scale/DPR 1, viewport 1280×1000, 16 KiB range chunks, streaming and automatic fetching enabled, and the existing four conditions (PDF structure × range enabled/disabled). The PDF-only synthetic delivery profile remains 100 ms header delay, shared 125,000 bytes/second cap, 2,048-byte charged quanta, no free burst/catch-up, and original pacing tolerances. Application and worker traffic remains unshaped. All known-range controls, single/concurrent/unshaped calibrations, content hashes, pixels and network validity rules remain unchanged.

The original first-page render timer ends at PDF.js render completion. It does not measure compositor presentation or full-document rendering. Post-render `getData()` verification remains outside that timer. Body-event accounting includes repeated/overlapping bytes and does not prove unique PDF-byte coverage at render.

## Analysis and final decision

Report each window separately, including absent, rejected and partial reports. Separate execution completion, operational validity, clock acceptance, scientific acceptance and independent evidence audit. Never convert a completed launcher into a successful benchmark claim.

For the integration diagnostic, report counts of planned/attempted/operation-valid trials, guard outcomes, actual-three/reference/candidate clock acceptance, non-overlap and too-wide rejections, and within-execution candidate-only acceptance gains among operationally valid trials. Show perturbation pairs and exclusions using the existing independent auditor. Do not count separate low/high executions as same-execution gains, infer equivalence from small median changes, or automatically adopt fifteen brackets.

For performance, accept a window only after its original runner, unchanged controls, all 64 trials (16 warmups, 48 measured), frozen-input and provenance checks, and independent audit pass. Report accepted new windows as 0/3, 1/3, 2/3 or 3/3. Only accepted windows provide timing estimates. Show the old accepted pilot separately, with its own date and guards; never pool trial timings across dates or use partial runs to repair acceptance.

With fewer than two accepted new windows, conclude that this campaign provides insufficient accepted evidence for a between-window timing comparison. With at least two, present each window's condition medians and existing paired contrasts (linearized minus nonlinearized within each range mode; range enabled minus disabled within each structure; difference of structure effects). Summarize observed directional agreement and the range of window estimates descriptively. Do not claim statistical repeatability, significance, population generalization or a universal linearization benefit. No post hoc numeric repeatability threshold is introduced.

The experiment's procedure is finished when all three slots have terminal outcomes, audits account for the evidence, and the final record/archives are published. Its scientific conclusion may be inconclusive. Documentation-service failure leaves publication incomplete and must be stated explicitly; it cannot justify more measurements.

## Limits and execution availability

All windows use one machine and the same environment; separate windows are not independent hardware replications. Diagnostic-before-performance order is fixed and may affect machine state. No controlled cold OS/font cache, reboot, random order across windows, or enforced idle-machine claim is added. Record visible environment issues; underlying causes of scheduling or clock failures may remain unknown.

Local scheduled execution depends on the desktop app, machine and required tools being available. The scheduler cannot guarantee the machine is awake. If a notification arrives late, the launcher enforces the recorded start deadline and leaves the slot missed. Future notifications must read this protocol and the durable ledger before acting. No duplicate measurements are permitted, even after a stale or interrupted launcher.

## Execution commands

Run from the repository root. No rebuild or dependency installation is part of a measurement window; use preserved compiled files.

```sh
.venv/bin/python packages/runner/scripts/run_final_windows.py \
  --plan experiments/final-windows.json \
  --node "$(command -v node)" \
  --window 1
```

Use ordinal 2 or 3 only in its assigned window. Audit with `audit_final_windows.py` after the frozen reports are complete; use a new progress export prefix at each update. Concrete ledger paths, audit commands, commits, scheduler records and publication receipts are recorded in the results document.

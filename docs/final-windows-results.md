# Final fixed-window campaign: execution record

Closed November 19, after final archive download verification at 17:10 UTC: all three measurement slots are terminal and the requested evidence is published. Window 1 rejected, window 2 missed, window 3 independently accepted. **1/3 new performance windows accepted: insufficient accepted evidence for a between-window timing comparison.** The frozen auditor's missed-ledger reporting defect remains disclosed and is reconciled in the closing review without changing code or accepting missed data.

The prospective protocol is [final-windows.md](final-windows.md), with machine-readable schedule and frozen hashes in [final-windows.json](../experiments/final-windows.json). The existing branch remains `feat/corpus-text-pair`. Protocol commit: `4df7821` (before all new measurements). Parent commit: `942be7b`.

## Scheduled work

| Window | Pacific target | Allowed suite start (UTC) | Outcome |
| --- | --- | --- | --- |
| 1 | November 18, 09:00 | November 18, 17:00–18:00 | Rejected performance attempt; observer diagnostic complete |
| 2 | November 18, 15:00 | November 18, 23:00–November 19, 00:00 | Missed; zero invocations; frozen audit discrepancy disclosed below |
| 3 | November 19, 09:00 | November 19, 17:00–18:00 | Completed and independently accepted: 16 warmups + 48 measured trials |

All intervals include their opening and exclude their closing. Each suite contains the frozen 96-trial observer integration diagnostic followed by one frozen 64-trial performance attempt, subject to each runner's original rejection behavior. No replacements or catch-up measurements are allowed. Later window outcomes must be appended without deleting earlier progress exports.

The local app heartbeat `finish-pdf-lab-001-fixed-windows` was created and its saved configuration verified on November 18, before the first window. It targets this existing chat, with three occurrences at local 09:00/15:00 beginning today. Its prompt gives the absolute UTC deadlines, ledger checks, no-retry rule, audit/publication instructions and final stopping rule. The saved configuration is evidence of scheduling, not proof that any future wakeup or measurement executed. Execution requires the local machine/app/tools to be available; missed windows stay missed.

Reporting target: November 19, 11:00 Pacific (19:00 UTC). Measurements end after the third fixed slot; delayed publication may continue without authorizing additional measurements. The final record must distinguish completed procedure from insufficient accepted performance evidence.

## Notion record

The [final campaign page](https://app.notion.com/p/41ce9784880681ca958ac1a6484f4eb2) is a child of [PDF Rendering Lab 001](https://app.notion.com/p/41ce9784880681528bc3c71d28407372). The prospective protocol and pending table were published before measurement. The Lab 001 home has an added status callout; prior findings remain intact. An attempted replacement of the historical callout was automatically rejected; an additive status update succeeded, resolving the issue without removing historical content.

## Preparation validation — November 18, before 09:00 Pacific

The final plan was frozen at `2026-11-18T16:49:06.242895+00:00`. SHA-256: `fd3c35e827e0adcedf6caee2aae440982c40a5328e132a69dee492f035aed80f`. It protects 1,112 repository files, including 663 PDF.js/Playwright package files, plus 22 external runtime files (Node, qpdf and the pinned headless Chromium installation). It also preserves all prior local raw artifacts. New progress documents and outputs are deliberately outside the immutable input set. The plan itself is pinned in every irreversible window claim and source snapshot.

Implementation and preflight commit: `96f7c1d`. Scheduling/evidence workflow commit: `f4746f6`. All commits remain on the existing branch.

All 53 runner-script Python tests passed in 1.785 seconds: 23 new launcher tests, eight new final-audit tests, and 22 existing tests. The tests cover the exclusive start deadline, missed and interrupted slots, duplicate/overlapping attempts, changed inputs, unavailable runtimes, rejection-independent sequencing, process cleanup, copied reports, clock/operation labels and pending-result interpretation. Browser measurements were not invoked by these tests. The preserved TypeScript/browser implementation was not rebuilt or changed.

```sh
.venv/bin/python -m unittest discover -s packages/runner/scripts -p 'test_*.py'
.venv/bin/python packages/runner/scripts/audit_final_windows.py \
  --plan experiments/final-windows.json \
  --ledger-root results/raw/final-windows \
  --output-prefix docs/data/final-windows-preflight-2026-11-18
```

The real preflight audit passed all 1,134 preserved-file checks and independently re-audited the historical accepted performance pilot. All three new windows were `pending-not-open`; `0/3` is a progress count, not three failures or a final inconclusive finding. Immutable [JSON](data/final-windows-preflight-2026-11-18.json) and [CSV](data/final-windows-preflight-2026-11-18.csv) preserve that state.

Calling the actual launcher for window 1 before 17:00 UTC returned `not-open` (exit 2) without creating a claim or invoking a browser. A read-only process check found no prior benchmark or protected browser process. This verifies the early-start guard, not future scheduler delivery or future benchmark acceptance.

Review found that Playwright launches Chromium in a separate process group. The launcher therefore checks both the runner group and protected browser processes after execution; a successful Node exit alone is not cleanup proof. Unverified cleanup blocks subsequent execution and archival of potentially changing raw files. The independent auditor checks these recorded facts separately from the completion flag.

The preparation archive was published to the final campaign's Notion page and downloaded for verification before the first measurement window. It contains the project at `249a0cd`, original PDFs/manifest, protocol, frozen plan, launcher/auditor/tests, and preflight exports: 115 manifest-listed files plus the manifest. The ZIP is 597,436 bytes; SHA-256 `8028ed9a73cb8788f07dc33411525306991dde1cfbcf880da6632bd9299050b4`. Downloaded ZIP bytes, exact entry inventory, and every listed file's size/hash match. The [publication receipt](data/final-windows-preparation-publication-2026-11-18.json) records its stable Notion reference. This archive contains preparation evidence only, not new benchmark measurements.

## Window 1 — November 18, 09:03–09:06 Pacific

The suite started from the active chat within its declared interval: `2026-11-18T17:03:06.042535+00:00` to `17:06:25.687193+00:00`. This establishes an on-time launcher execution, not proof of automatic scheduler delivery. Its irreversible claim is retained. No replacement invocation was made.

The observer diagnostic collected all 96 trials; all 96 workloads and 144 clock analyses passed. All six pre/post control stages passed, and all 48 adjacent arm pairs were independently comparable. There were zero candidate-only clock acceptance gains among the 48 valid high-arm executions. Fifteen minus three brackets had paired medians of +8.359 ms for collection, +3.350 ms from render to verification, and +5.500 ms for first-page render (range −79.400 to +31.600 ms). These are instrumentation observations, not performance replication or evidence of equivalence.

The preserved performance runner attempted 39 of 64 trials: all 16 warmups and 22 measured trials passed before `measured-6-nonlinearized-range-enabled` failed. Its reconstructed boundary width was 5.105 ms, above the unchanged 5 ms limit. The 25 remaining trials and post-run controls were not reached. Pre-run observer/delivery controls passed. All partial records remain available, but this rejected attempt supplies no performance estimate. The underlying cause of the wide clock interval remains unestablished.

The independent final-window audit passed, verified all 1,134 frozen files, confirmed process/browser cleanup and retained the rejection. The current accepted count is **0/3 with two pending windows**; this is not yet a closing conclusion. Both historical PDFs and the historical accepted pilot remain unchanged and separate.

Evidence:

- Ledger: `results/raw/final-windows/window-1/ledger.json`.
- Observer report SHA-256: `1e5713999ab7fc561f547e0474d5fe543a5b54bdff40b0a60b3c44de8dc6e164`.
- Performance report SHA-256: `a81e2d518fb43b72431bf677f123581fe8c39ca988e156942128262d5bd59928`.
- Independent [progress JSON](data/final-windows-progress-window-1.json) and [CSV](data/final-windows-progress-window-1.csv).

The invocation used the protocol's exact `run_final_windows.py --window 1` command. The audit used `audit_final_windows.py --plan experiments/final-windows.json --ledger-root results/raw/final-windows --output-prefix docs/data/final-windows-progress-window-1`. No tests, builds, lint checks, package installation or uploads ran concurrently with the measurement suite.

Lightweight documentation reads and security-tool administration occurred during the suite. Source-review workers and quality verification started after it finished. This was not a controlled idle-machine run, and no causal explanation for the clock-width rejection is inferred from these activities.

Window 1 was committed as `625d4bb`. Its evidence ZIP was published to Notion and downloaded for verification: 5,184,064 bytes, SHA-256 `c936fcbabb1a20b626dd08f788561d3742c70815d0c24e2ca3080e3565053e5b`, with 203 manifest-listed files plus the manifest. The downloaded archive and every file size/hash match. The [publication receipt](data/final-windows-window-1-publication.json) contains the stable file reference. This ZIP is close to the workspace's 5 MiB limit; later bundles may need separate complete ZIP parts with per-part manifests and verified combined coverage. A large archive is not a reason to change or repeat a measurement.

## Continuing a scheduled window

### Window 2 — missed; recorded November 19, 09:00 UTC

The heartbeat arrived at `2026-11-19T08:59:53.609Z`, outside all fixed measurement slots. Inspection found no window-2 claim or ledger. The unchanged launcher was invoked with `--window 2` at `09:00:39.730195+00:00`, after its exclusive deadline of `00:00:00Z`. It returned `missed` (exit 2), retained the irreversible claim and source snapshots, and launched neither runner. Its ledger has zero attempts and no admission, Node identity, report, image or runner log. No replacement or catch-up measurement was made. The ledger's generic `completionMeaning` text is not an execution claim; its `status` and empty attempts are authoritative.

The unchanged audit command used fresh prefix `docs/data/final-windows-progress-window-2`. It verified all 1,134 frozen files and retained window 1's rejection, but exited 1 with `window 2: Missing Node identity on an executed window`. Inspection of `validate_ledger` shows that absent Node identity is allowed only for aborted/interrupted windows, although the launcher's missed path intentionally returns before initializing Node. This is an audit classification defect, not evidence of a measurement or permission to repair the raw ledger. The frozen auditor, tests, launcher and failed JSON/CSV exports remain unchanged.

The separate [ledger review](data/final-windows-window-2-ledger-review.json) passed 14 checks: late claim, matching plan/claim/ledger, no admission or attempts, both runners unattempted, exact evidence inventory, matching source-snapshot hashes and all frozen-file hashes. It records the evidence-supported `missed` interpretation without replacing the failed campaign audit or accepting performance data. Final publication must explicitly reconcile this discrepancy; the campaign audit is **not** reported as passing.

Current progress is **0/3 accepted new performance windows, one rejected, one missed and one pending**. At most one new window can now pass, so the predeclared requirement of two accepted windows for a between-window timing comparison cannot be met. Window 3 must still be accounted for under the fixed stopping rule; no optional early stop is taken. Its original start interval remains November 19, 17:00–18:00 UTC (09:00–10:00 Pacific).

The saved heartbeat used a wall-clock recurrence without an explicit timezone field; this observed 09:00 UTC wakeup does not establish the cause of the missed slot. Only the follow-up cadence was changed to hourly admission checks at minute 05, with the same UTC measurement guards and once-only claims. This does not change the plan or authorize additional measurements. The [follow-up scheduling receipt](data/final-windows-followup-schedule-2026-11-19.json) records the saved update. Delete the heartbeat after final publication is complete. No dependency installation, rebuild, test run or browser measurement was performed during this update. Archive publication is recorded below once verified.

Window-2 evidence and the audit discrepancy were committed as `aed644c`. The archive was attached to the existing Notion campaign page and downloaded for verification at `2026-11-19T09:04:32.227436+00:00`: 2,719,570 bytes, SHA-256 `3b594bd38733aa5ec3bc6b216bb29e5b7dcc3d0bee429c070a4c62bf9072b14e`, exactly 147 manifest-listed files plus the manifest. The downloaded ZIP and every file size/hash matched. The [publication receipt](data/final-windows-window-2-publication.json) records its stable attachment reference. This completes publication of the missed-slot evidence; it does not turn the failed frozen campaign audit into a pass or finish window 3.

### Remaining-window procedure

Read the protocol, plan and existing claim/ledger first. The launcher owns the durable once-only admission check. It must never be bypassed with a direct runner invocation to repair an unfavorable, interrupted, blocked or missed result.

```sh
.venv/bin/python packages/runner/scripts/run_final_windows.py \
  --plan experiments/final-windows.json \
  --node /Users/kristian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --window 1
```

Use the appropriate fixed ordinal. During measurements, avoid concurrent tests, builds, uploads and other benchmark campaigns. Audit afterward using a new output prefix:

```sh
.venv/bin/python packages/runner/scripts/audit_final_windows.py \
  --plan experiments/final-windows.json \
  --ledger-root results/raw/final-windows \
  --output-prefix docs/data/final-windows-progress-window-1
```

Commit exports and the updated record before packaging. Package each window separately to keep attachments below the workspace's 5 MiB limit:

```sh
.venv/bin/python packages/runner/scripts/package_final_window.py \
  --window 1 \
  --output results/raw/final-windows/publication/window-1-evidence.zip
```

Do not overwrite existing ZIPs. If a new edition is needed, name it explicitly and preserve the earlier file. The package contains the selected window's raw files, the committed project, original PDFs/manifest, and a per-file SHA-256 manifest. Runtime binaries and older raw archives are referenced by preserved hashes rather than redistributed. Upload with the Notion file-upload tools, attach to the existing campaign page, download the saved attachment, verify ZIP bytes and every manifest entry, then save and commit a publication receipt. Do not include a receipt in the archive it hashes.

After the final slot, audit all three ledgers into a fresh final export; retain earlier progress exports. Publish the final accepted-window count, separate accepted-run contrasts, failure reasons, clock/operation distinctions, limitations, archive checks and closing commits. Disable the campaign heartbeat after finalization. No broad benchmark completion or performance-repeatability claim is authorized by this work.

## Window 3 — November 19, 09:01–09:05 Pacific

The scheduled heartbeat arrived at `2026-11-19T17:00:59.088Z`. After inspection of the protocol, plan, existing claims and clean preserved branch, the exact authorized launcher command used `--window 3`. Its claim was recorded at `17:01:37.767145+00:00`, admission at `17:01:41.608615+00:00`, and completion at `17:05:35.723060+00:00`. Both invocations exited 0 without timeout. All six preservation/runtime checks passed, and both runner process groups and protected browser processes were verified absent afterward. No tests, builds, uploads, dependency installation or other benchmark work was intentionally run concurrently; only process-output polling occurred. This is not proof of an otherwise idle machine.

The observer diagnostic ran from `17:01:41.612134` to `17:04:04.158103` UTC: 96/96 attempted and operation-valid workloads, all six session guards passed, and all 144 clock analyses passed (48 actual-three references, 48 high-arm nested references, 48 high-arm candidates). There were zero too-wide or non-overlap clock rejections and zero candidate-only gains among 48 eligible high-arm executions. All 48 adjacent perturbation pairs were comparable; none were excluded. Fifteen minus three brackets had paired medians of +9.761 ms observer collection, +3.400 ms render-to-verification delay, and +1.900 ms first-page render (range −30.900 to +118.500 ms). These are descriptive diagnostic observations; they establish neither equivalence nor a reason to adopt fifteen brackets.

The performance invocation ran from `17:04:05.345419` to `17:05:34.424638` UTC. All 64 trials passed (16 warmups excluded, 48 measured, 12 per condition), as did the original pre/post controls, source/corpus checks, pixels, network checks and strict clock gate. The unchanged independent performance auditor accepted this window.

| Window 3 condition | First-page render median (ms) |
| --- | ---: |
| Nonlinearized, range enabled | 1008.40 |
| Linearized, range enabled | 1110.65 |
| Nonlinearized, range disabled | 968.15 |
| Linearized, range disabled | 977.05 |

Within this window only, paired block medians were +100.35 ms for linearized minus nonlinearized with ranges enabled; +7.20 ms with ranges disabled; +32.65 ms for enabled minus disabled ranges on the nonlinearized PDF; +132.10 ms on the linearized PDF; and +100.45 ms for the difference of structure effects. A paired median is not the difference of condition medians. These single-window values are descriptive, not evidence of general linearization harm or benefit.

Report SHA-256 values: observer `696918b1fbc5e667f6855114d4bfa0f20df6bdb3ef8414e4f64577bb751011db`; performance `3eac448b9168a829f3be752994210234d1dffa45ef96caa2ab794755535adfc3`. The ledger and full raw reports/logs/images/source snapshots remain under `results/raw/final-windows/window-3/`.

## Closing conclusion and audit reconciliation

The stopping rule is satisfied for measurement: all three declared slots have terminal outcomes, with no retries, replacements or additional trials. **Accepted new performance windows: 1/3.** The campaign provides **insufficient accepted new evidence for a between-window timing comparison**. No cross-window timing contrast, pooled partial estimate, significance test, repeatability claim or universal linearization claim is made. No observer change is adopted.

Window 1 remains rejected at a 5.105 ms uncertainty width; its partial timings are excluded. Window 2 remains missed with zero invocations, not a measured failure. Window 3 supplies the sole accepted new estimate. Actual performance invocation start separation between windows 1 and 3 was 86,314.832373 seconds (about 23 h 58 m 35 s); this is scheduling context, not a comparison of accepted windows.

The original accepted pilot remains separate historical context, with report `results/raw/controlled-delivery/run-VnOBcz/report.json`, from November 18, 05:21:54.389–05:23:26.814 UTC (November 17 Pacific). The final audit independently revalidated it, but it does not count toward the three new windows or rescue the two-window threshold. Earlier reports and archives are retained unchanged.

Command: `audit_final_windows.py --plan experiments/final-windows.json --ledger-root results/raw/final-windows --output-prefix docs/data/final-windows-final-2026-11-19`. The fresh [final JSON](data/final-windows-final-2026-11-19.json) and [CSV](data/final-windows-final-2026-11-19.csv) preserve the unchanged auditor's exit-1 result. It verified all 1,134 frozen files, independently audited both executed observer reports and the new accepted performance report, and identified the sole known missed-ledger defect. It labels window 2 `integrity-failed` because its null Node identity is rejected before its missed status is handled. **The campaign audit did not pass.**

The [closing review](data/final-windows-closing-review-2026-11-19.json) binds this final export to unchanged ledger/report hashes and the previously published 14-check missed-slot review. It reconciles the evidence-supported missed outcome without rewriting the failed export, raw ledger or frozen code. There is no missing executed report and no waiver of a performance acceptance rule. The defect remains a future software repair; the explicit reconciliation accounts for this campaign's evidence. Publication must retain both the failed audit and supplemental review rather than present an unqualified clean-audit claim.

Limits remain one machine, one PDF pair, one renderer/runtime, one synthetic delivery profile, fixed diagnostic-before-performance order, uncontrolled OS/font caches and background load, render-promise completion rather than physical presentation, and body-event accounting rather than unique byte coverage. The reasons for window 1's wider clock interval and window 2's missed delivery are unestablished. Publication verification and shutdown are recorded below when complete.

## Verified final publication

Closing evidence commit: `0ed35d2`. The full local ZIP is 7,456,725 bytes, SHA-256 `c740f758ff7c98ec2449dc9361df6530c29dac1271d9e9919ea09eed187cad52`, exceeding the Notion 5 MiB limit. It was retained locally and split into three complete ZIP parts; no evidence was omitted to fit the limit.

| Part | Bytes | Manifest-listed files | SHA-256 |
| --- | ---: | ---: | --- |
| 1: project, original corpus, plan, claim/ledger, logs and audits | 2,743,531 | 153 | `6ccdefa0ff0420d24126d7c2e5df9d4b78448ad54eb42574d19b98c6ad7a30dd` |
| 2: observer reports, snapshots and images | 3,705,584 | 54 | `ad67d82e40fbafe57724a9da1d54c648eb21f27163facaafe5ec13c4064ab574` |
| 3: performance reports and snapshots | 1,029,663 | 24 | `4f90c808c0a08e275487afd05eb6a7123e5f5613fc6923a32538821355fad2b8` |

Each part has its own manifest plus the complete expected inventory. All three attachments were saved on the existing Notion campaign page, downloaded and verified at `2026-11-19T17:10:05.378013+00:00`. Exact ZIP sizes/hashes, every per-part file size/hash, and the disjoint combined inventory of 231 files matched. The [final publication receipt](data/final-windows-final-publication-2026-11-19.json) records stable Notion references and verification details. Earlier preparation, window-1 and window-2 archives remain separately available with their original verified receipts.

The final conclusion and publication confirmation are saved on the campaign page and linked from the Lab 001 home. Measurement and requested evidence publication are complete; the scientific conclusion is insufficient accepted evidence. No more measurement is authorized by this campaign. The aggregate frozen-audit failure remains explicitly disclosed; software repair is deferred. The public website is still the previously deployed dated snapshot and needs a separate content publication update; it was not modified by this measurement campaign.

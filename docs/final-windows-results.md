# Final fixed-window campaign: execution record

Status: preparation passed and the three windows are scheduled; no new measurement has started. This is not the final scientific conclusion.

The prospective protocol is [final-windows.md](final-windows.md), with machine-readable schedule and frozen hashes in [final-windows.json](../experiments/final-windows.json). The existing branch remains `feat/corpus-text-pair`. Protocol commit: `4df7821` (before all new measurements). Parent commit: `942be7b`.

## Scheduled work

| Window | Pacific target | Allowed suite start (UTC) | Outcome |
| --- | --- | --- | --- |
| 1 | November 18, 09:00 | November 18, 17:00–18:00 | Pending |
| 2 | November 18, 15:00 | November 18, 23:00–November 19, 00:00 | Pending |
| 3 | November 19, 09:00 | November 19, 17:00–18:00 | Pending |

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

## Continuing a scheduled window

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

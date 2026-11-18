# Final fixed-window campaign: execution record

Status: preparation in progress; no new measurement has started. This is not the final scientific conclusion.

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

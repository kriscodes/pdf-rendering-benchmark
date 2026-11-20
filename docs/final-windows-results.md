# Final fixed-window campaign: execution record

Status: window 1 completed and its performance attempt was rejected by the unchanged clock gate. Windows 2 and 3 remain scheduled. This is not the final scientific conclusion.

The prospective protocol is [final-windows.md](final-windows.md), with machine-readable schedule and frozen hashes in [final-windows.json](../experiments/final-windows.json). The existing branch remains `feat/corpus-text-pair`. Protocol commit: `4df7821` (before all new measurements). Parent commit: `942be7b`.

## Scheduled work

| Window | Pacific target | Allowed suite start (UTC) | Outcome |
| --- | --- | --- | --- |
| 1 | November 18, 09:00 | November 18, 17:00–18:00 | Rejected performance attempt; observer diagnostic complete |
| 2 | November 18, 15:00 | November 18, 23:00–November 19, 00:00 | Pending |
| 3 | November 19, 09:00 | November 19, 17:00–18:00 | Pending |

All intervals include their opening and exclude their closing. Each suite contains the frozen 96-trial observer integration diagnostic followed by one frozen 64-trial performance attempt, subject to each runner's original rejection behavior. No replacements or catch-up measurements are allowed. Later window outcomes must be appended without deleting earlier progress exports.

Reporting target: November 19, 11:00 Pacific (19:00 UTC). Measurements end after the third fixed slot; delayed publication may continue without authorizing additional measurements. The final record must distinguish completed procedure from insufficient accepted performance evidence.

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

The preparation archive was verified before the first measurement window. It contains the project at `249a0cd`, original PDFs/manifest, protocol, frozen plan, launcher/auditor/tests, and preflight exports: 115 manifest-listed files plus the manifest. The ZIP is 597,436 bytes; SHA-256 `8028ed9a73cb8788f07dc33411525306991dde1cfbcf880da6632bd9299050b4`. Downloaded ZIP bytes, exact entry inventory, and every listed file's size/hash match. This archive contains preparation evidence only, not new benchmark measurements.

## Window 1 — November 18, 09:03–09:06 Pacific

The suite started within its declared interval: `2026-11-18T17:03:06.042535+00:00` to `17:06:25.687193+00:00`. This establishes an on-time launcher execution, not proof of automatic scheduler delivery. Its irreversible claim is retained. No replacement invocation was made.

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

Window 1 was committed as `625d4bb`. Its evidence ZIP was verified: 5,184,064 bytes, SHA-256 `c936fcbabb1a20b626dd08f788561d3742c70815d0c24e2ca3080e3565053e5b`, with 203 manifest-listed files plus the manifest. The downloaded archive and every file size/hash match.

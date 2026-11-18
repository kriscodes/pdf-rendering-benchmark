# Runner package

This package contains local browser experiments, their HTTP fixtures, protocol calculations, and independent evidence audits. It uses the controlled synthetic corpus with PDF.js and Chromium. The first-page metric starts immediately before `getDocument()` and ends when page 1's render promise resolves; it does not measure compositor presentation or full-document rendering.

The network collector records Chrome DevTools Protocol (CDP) events. Canvas identity uses a hash of red/green/blue/alpha (RGBA) pixel bytes. These checks answer different questions: network events describe recorded transfers, while the pixel hash checks the rendered image.

The [fixed-window protocol](../../docs/final-windows.md) governs current execution. Do not invoke a historical runner to replace a rejected or missed scheduled attempt. The package's `benchmark` script still selects the original first-page pilot, not the newest campaign.

## Browser entry points

Every entry point below runs when its compiled JavaScript is executed. These files are command-line programs, not import-safe libraries. They read protocol/corpus inputs, launch local servers and Chromium, and write evidence under a new output directory. Their reports distinguish different acceptance rules; consult the linked protocol.

| Source / compiled entry point | Purpose and inputs | Output root / protocol |
| --- | --- | --- |
| [`src/run.ts`](src/run.ts) → `dist/run.js` | Original local first-page PDF.js pilot. | `results/raw/first-page-local/`; [protocol](../../docs/first-page-local.md). |
| [`src/partial-loading.ts`](src/partial-loading.ts) → `dist/partial-loading.js` | Range/stream diagnostic with separate full-document verification. | `results/raw/partial-loading-local/`; [protocol](../../docs/partial-loading-local.md). |
| [`src/controlled-delivery.ts`](src/controlled-delivery.ts) → `dist/controlled-delivery.js` | Four PDF structure/range conditions under synthetic delivery, with corpus, clock, network and pacing guards. | `results/raw/controlled-delivery/`; [protocol](../../docs/controlled-delivery.md). |
| [`src/clock-observer.ts`](src/clock-observer.ts) → `dist/clock-observer.js` | Fixed known-byte fixture; three fresh browser sessions, no PDF.js or PDF rendering. | `results/raw/clock-observer/`; [protocol](../../docs/clock-observer.md). |
| [`src/pdf-clock-observer.ts`](src/pdf-clock-observer.ts) → `dist/pdf-clock-observer.js` | Fixed 96-trial observer integration with actual three/fifteen-bracket arms and separate operation/clock outcomes. | `results/raw/pdf-clock-observer/`; [protocol](../../docs/pdf-clock-observer.md). |

## Libraries and browser-side modules

| File | Entry points / contract | Inputs, outputs and side effects |
| --- | --- | --- |
| [`src/server.ts`](src/server.ts) | `startServer()` | Serves a preloaded, allowlisted asset map on loopback; GET/HEAD and single ranges; returns request records and a close function. Opens sockets. |
| [`src/paced-server.ts`](src/paced-server.ts) | `startPacedServer()`, `PACING_PROFILE` | Adds explicit per-asset pacing with one shared body budget. Records scheduled/written bytes and Node monotonic timestamps; written bytes are not proven browser receipt. Opens sockets and timers. |
| [`src/protocol.ts`](src/protocol.ts) | Baseline schedule/statistical helpers | Pure calculations over declared trial records; no browser launch. |
| [`src/delivery-protocol.ts`](src/delivery-protocol.ts) | `createDeliverySchedule()`, `summarizeDeliveryTrials()` | Fixed Williams order and descriptive within-block contrasts; rejects incomplete or mismatched schedules. |
| [`src/partial-network.ts`](src/partial-network.ts) | `calibrateOffset()`, `mapPageTime()`, `summarizeNetwork()` | Maps page/CDP clocks and classifies raw events conservatively. Assumes the declared margins and stable offset; repeated bytes are not unique PDF coverage. |
| [`src/delivery-calibration.ts`](src/delivery-calibration.ts) | `auditPacing()`, `auditCalibrationGroup()` | Validates server-release and browser timing evidence against fixed limits; no delivery or browser launch. |
| [`src/clock-observer-protocol.ts`](src/clock-observer-protocol.ts) | `createClockObserverSchedule()`, `analyzeClockBursts()` | Fixed fixture schedule; nested three-sample and full fifteen-sample interval calculations. |
| [`src/pdf-clock-protocol.ts`](src/pdf-clock-protocol.ts) | `createPdfClockSchedule()`, `analyzePdfClockBursts()` | Fixed integration arms/checkpoints and both render/verification boundaries. Clock rejection remains distinct from operational failure. |
| [`viewer/index.html`](viewer/index.html), [`viewer/viewer.mjs`](viewer/viewer.mjs) | Page shell; `window.runFirstPage()` | Baseline canvas renderer. Loads PDF.js and its worker; performs browser-side rendering/verification. |
| [`viewer/partial-loading.mjs`](viewer/partial-loading.mjs) | `window.runPartialFirstPage()`, `window.verifyPartialDocument()` | One render then one explicit verification per fresh page. The second call can fetch missing bytes and performs hashing/pixel/PNG work outside the render timer. |
| [`viewer/clock-observer.html`](viewer/clock-observer.html), [`viewer/clock-observer.mjs`](viewer/clock-observer.mjs) | `window.clockProbeBefore()`, `window.clockProbeAfter()` | Validates known 4,096-byte ranges around a page marker; the after transfer starts only on its explicit call. No PDF renderer or worker. |
| `src/*.test.ts` | Node test runner / VM fixtures | Protocol, range, pacing, cleanup and viewer-contract cases. Some tests open loopback HTTP servers. They do not invoke the browser experiment entry points. |

The controllers choose which module is served at `/viewer.mjs`; the same HTML shell does not imply the same experiment. Page, CDP and Node timestamps have different clock domains. UTC timestamps describe execution dates, not duration measurements.

## Python orchestration and audits

| File | Entry point / input | Output and side effects |
| --- | --- | --- |
| [`scripts/run_delivery_replicates.py`](scripts/run_delivery_replicates.py) | CLI plan and absolute Node path. | Runs exactly three serial historical replication attempts; writes ledger/logs, checks hashes, and bounds child process groups. Not the active window launcher. |
| [`scripts/run_final_windows.py`](scripts/run_final_windows.py) | CLI frozen plan, absolute Node path and window ordinal. | Enforces once-only claims, UTC admission, exclusivity, runtime/input preservation and cleanup; launches the two frozen runners and writes durable ledgers/logs. Use only under the current protocol. |
| [`scripts/summarize_controlled_delivery.py`](scripts/summarize_controlled_delivery.py) | Positional raw report path; always pass `--audit-json` inside a fresh user-owned directory. | Independently audits the controlled-delivery report and writes descriptive CSV/JSON exports; no browser run. Avoid its legacy predictable `/tmp` default; see the [safe invocation](../../CONTRIBUTING.md#scope-and-security-boundaries). |
| [`scripts/compare_delivery_replicates.py`](scripts/compare_delivery_replicates.py) | Historical replication plan/ledger. | Audits complete and failed attempts without pooling trial timings or replacing failures. |
| [`scripts/audit_clock_observer.py`](scripts/audit_clock_observer.py) | `--report`, `--output-prefix`. | Reconstructs fixture intervals/classifications and writes independent CSV/JSON evidence. |
| [`scripts/audit_pdf_clock_observer.py`](scripts/audit_pdf_clock_observer.py) | `--report`, `--output-prefix`. | Reconstructs workload, guards, clock methods and operationally valid arm pairs; writes trial/pair CSVs and JSON. |
| [`scripts/audit_final_windows.py`](scripts/audit_final_windows.py) | `--plan`, `--ledger-root`, `--output-prefix`. | Checks scheduled slots, provenance and independent report acceptance; writes progress/final exports without launching measurements. |
| [`scripts/package_final_window.py`](scripts/package_final_window.py) | Window ordinal and new ZIP path. | Collects committed project/evidence files and a per-file hash manifest. Creates an archive; does not upload or verify a remote attachment. |
| `scripts/test_*.py` | Python `unittest` discovery | Temporary evidence and fake process fixtures for admission, cleanup, audit and exclusion rules; no benchmark browser invocation. |

Auditors read local evidence and may require the matching source/artifact snapshots. Their exports are derived records; retain the original report and use new output names instead of overwriting historical exports.

The final-window auditor calls the controlled-delivery module's `audit_report()` function; it does not run that module's legacy CLI/default output write. The frozen legacy CLI still needs a code repair for its predictable shared-temporary audit filename. Explicit fresh user-owned output paths avoid that default without changing the experiment inputs; they do not constitute a source fix.

## Development checks and execution safety

See [Contributing](../../CONTRIBUTING.md) for checks and freeze rules. `pnpm --filter @pdf-benchmark/runner test` builds `dist/` and runs Node tests; it must not rebuild the protected measurement checkout during the active campaign. A fresh CI checkout or isolated temporary output is appropriate for software verification. Do not run tests, builds or competing experiments during a measurement window.

The local HTTP servers are fixtures for controlled assets. They are not authenticated public servers or upload endpoints. Browser and command timeouts, explicit route maps, disabled cache/service workers, exact byte/pixel checks and process cleanup are experiment controls, not a general security guarantee for arbitrary PDFs. Broader hosting or untrusted-input support is outside this package's current contract.

Read the [documentation index](../../docs/README.md) for result records and limitations. Current source-readability findings are documented in the [code-quality review](../../docs/code-quality-review-2026-11-18.md); frozen source refactoring remains deferred.

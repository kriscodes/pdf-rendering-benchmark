# Documentation index

This project studies one controlled synthetic PDF pair in local PDF.js/Chromium experiments. The generator is a smoke test. Browser reports, protocol guards and independent audits provide separate evidence. A completed process is not necessarily an accepted experiment, and local results do not establish a general linearization benefit.

## Current campaign and development

- [Final fixed-window protocol](final-windows.md): authoritative schedule, preserved controls, stopping rule and acceptance criteria.
- [Execution and publication record](final-windows-results.md): preparation and subsequent campaign records. Read dated progress exports alongside this narrative; do not infer acceptance from a scheduled or completed invocation.
- [Machine-readable plan](../experiments/final-windows.json): exact UTC windows, frozen inputs, runtimes and runner identities.
- [Contribution guide](../CONTRIBUTING.md): development checks, experiment freeze, naming, file contracts and review practices.
- [Runner package](../packages/runner/README.md) and [corpus package](../packages/corpus/README.md): source maps, entry points and side effects.
- [Code-quality review — November 18](code-quality-review-2026-11-18.md): concrete readability findings and deferred source changes.
- [Quality tools and CI](../tools/quality/README.md): pinned lint tools, exact baseline findings, isolated verification commands and hosted-workflow limits.
- [Source security review — November 18](security-review-2026-11-18.md): the confirmed conditional audit-output issue, safe invocation, scope and pending source repair.

The root README describes the initial workflow. During the fixed-window campaign, follow the current protocol before using any command that generates PDFs, builds protected files or launches a browser. This index does not declare the campaign complete or accept unaudited results.

## Experiment history

| Stage | Protocol / method | Recorded evidence | What it establishes |
| --- | --- | --- | --- |
| Corpus validation | [Corpus checks](corpus-validation.md) | [November 16 validation](validation-2026-11-16.md) | Structure, repeated generation and all-page raster comparison; no browser speed measurement. |
| First-page pilot | [Local first-page protocol](first-page-local.md) | [Pilot](first-page-local-2026-11-16.md), [four-run repeatability record](first-page-repeatability-2026-11-17.md) | PDF.js first-page canvas measurements for the declared local setup. |
| Partial loading | [Partial-loading diagnostic](partial-loading-local.md) | [November 17 record](partial-loading-2026-11-17.md) | Range/stream behavior and conservative event accounting, separate from unique PDF-byte coverage. |
| Controlled delivery | [Four-condition protocol](controlled-delivery.md) | [Pilot results](controlled-delivery-2026-11-17.md) | One accepted synthetic-delivery pilot, with retained rejected evidence and limits. |
| Consecutive replication | [Fixed three-attempt protocol](controlled-delivery-replication.md) | [Replication results](controlled-delivery-replication-2026-11-17.md) | The declared attempts and their acceptance outcomes; failures stay visible. |
| Known-event clock fixture | [Clock-observer protocol](clock-observer.md) | [November 17 results](clock-observer-2026-11-17.md) | Bounded collection and coarse event classification without PDF rendering. |
| Observer under PDF load | [Integration protocol](pdf-clock-observer.md) | [November 18 results](pdf-clock-observer-2026-11-18.md) | Actual observer-arm comparisons, operational failures and clock outcomes; no automatic observer adoption. |
| Fixed time windows | [Closing protocol](final-windows.md) | [Execution record](final-windows-results.md) | Scheduled independent invocations with a fixed stopping rule; read the audited terminal outcomes when available. |

## Reading the evidence

[`data/`](data/) contains committed JSON/CSV exports and publication receipts. Protocols live in [`../experiments/`](../experiments/). Full raw reports, source snapshots, PNGs and local archives live under `results/raw/` and are ignored by Git; verified publication receipts identify the saved attachments. An archive is not verified merely because upload succeeded: the recorded workflow downloads it and checks its bytes and manifest.

Keep these outcomes separate when reading reports: schedule completion, operational/content validity, clock acceptance, session guards, scientific acceptance, and independent audit integrity. The final campaign may finish with insufficient accepted evidence for a between-window comparison. Earlier accepted results cannot replace rejected or missing new windows.

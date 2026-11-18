# PDF Rendering Benchmark

Open-source, reproducible investigations into how PDF structure, network delivery and rendering architecture affect browser rendering performance.

**Status — November 18, 2026:** the controlled corpus, local browser benchmarks, diagnostics, independent audits and quality checks are implemented. The final fixed-window campaign remains in progress: one rejected performance window and two pending windows. No final timing conclusion is available.

Start with the [documentation index](docs/README.md), [current execution record](docs/final-windows-results.md) and [contribution guide](CONTRIBUTING.md).

## Preserve the active experiment

The scheduled measurement checkout remains on `feat/corpus-text-pair`, using the exact files and runtimes in the [frozen plan](experiments/final-windows.json). Merging the project into `main` does not authorize rebuilding, updating dependencies, regenerating PDFs, switching that checkout, or repeating a scheduled run. This merged README differs from the frozen snapshot; do not use a fresh `main` checkout as a replacement measurement environment. Run development checks in a separate environment, outside measurement periods.

## What is implemented

The corpus generator creates and validates a controlled pair of 100-page text PDFs. Both variants come from the same source and use the same qpdf settings; only one adds linearization. The generator remains a smoke test. Separate browser runners measure first-page canvas rendering with PDF.js in local Chromium.

The workspace includes corpus/profile helpers, generation and verification, first-page benchmarks, partial-loading diagnostics, controlled delivery, bounded clock-observer diagnostics, independent evidence audits, fixed-window scheduling, and pinned lint/CI checks. Software-test success and observer validity do not establish performance acceptance.

## Development setup

For a fresh development environment, use Node **24.22.3** from `.nvmrc` and pnpm **11.28.12** from `package.json`. Follow [corpus setup](docs/corpus-validation.md#setup) for Python and qpdf requirements, and [quality tooling](tools/quality/README.md) for lint commands. The active experiment preserves different runtime versions in its plan.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
```

`pnpm test` builds runner JavaScript and includes local HTTP tests. These commands belong outside the frozen measurement checkout. See the contribution guide for Python audit/launcher tests and side effects.

In a fresh corpus workspace, `pnpm corpus:pilot` generates the pair and replaces files under `corpus/generated/pilot/`. `pnpm corpus:verify` preserves that pair, checks repeatability and all-page raster equivalence, and writes a separate validation report with visual samples. See [corpus validation](docs/corpus-validation.md) for controls and limitations.

For a separate browser pilot, follow [first-page benchmark setup](docs/first-page-local.md) to install the pinned Chromium binary. `pnpm bench:first-page` builds and runs the pilot, saving raw trials, summaries and samples under `results/raw/first-page-local/`. Do not use it to supplement the fixed-window schedule. This small local full-response experiment does not establish a network-delivery or general linearization speed benefit.

## Evidence and limitations

The [four-run comparison](docs/first-page-repeatability-2026-11-17.md) retains all measured trials and excluded warmups; timing varied between sessions. Subsequent diagnostic and controlled-delivery evidence is indexed in the documentation. Protocols, environment versions, raw failures, independent audits and limitations are retained separately from summaries. Results identify their source revision; rejected or partial runs are not performance estimates.

[GitHub quality checks](https://github.com/kriscodes/pdf-rendering-benchmark/actions/runs/44362585984) passed for the merged feature head. Eleven frozen lint findings remain visible, and the [source security review](docs/security-review-2026-11-18.md) documents a conditional shared-temporary-file issue with a safe invocation and deferred repair. This local controlled-corpus harness is not a public upload service.

The [PDF Rendering Lab 001 notebook](https://app.notion.com/p/41ce9784880681528bc3c71d28407372) collects protocols, work logs, results and verified evidence under Labs.

## Relationship to Engineering Lab

[Engineering Lab](https://lab.kristiansalmeron.com/) is the publication home for research questions, methods and findings. Its [source repository](https://github.com/kriscodes/lab) is separate from this benchmark workspace.

The site's proposed study, **The Cost of Rendering Progress**, concerns intermediate-frame update overhead and cadence, with network acquisition kept separate. This repository's loading and linearization experiments do not implement or validate that hypothesis. The [website concepts](docs/design/lab-001/README.md) propose a separate loading-study page; they are mockups, not deployed features.

## License

[MIT](LICENSE)

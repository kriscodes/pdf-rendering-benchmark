# PDF Rendering Benchmark

Infrastructure in development for reproducible investigations into how PDF structure, network delivery, and rendering architecture affect browser rendering performance.

**Status: corpus foundation. No browser timing runner or published performance results are available.**

## What is implemented

The `main` branch contains a pnpm and TypeScript workspace with a small `@pdf-benchmark/corpus` package:

- A `PdfDocumentProfile` type for page count, content type, and linearization status.
- A profile-description helper.
- Build and type-check commands.

The workspace is scaffolding for future benchmark components. It does not currently render PDFs, collect browser timings, or compare rendering performance.

## Corpus work in progress

The separate [`feat/corpus-text-pair` branch](https://github.com/kriscodes/pdf-rendering-benchmark/tree/feat/corpus-text-pair) adds a [synthetic PDF-pair generator](https://github.com/kriscodes/pdf-rendering-benchmark/blob/feat/corpus-text-pair/packages/corpus/scripts/generate_text_pair.py). This work is not yet included in `main`.

The generator creates a 100-page text document and produces linearized and non-linearized variants from the same source. It validates page counts and PDF structure with qpdf, checks linearization, and records SHA-256 hashes and tool versions in a manifest. Generation uses fixed content and deterministic settings; repeat-generation hashes and visual equivalence must be checked in the chosen environment.

These are corpus validation checks. They do not measure rendering speed or establish a performance improvement.

## Set up main

Use Node **24.22.3** from `.nvmrc` and pnpm **11.28.12** from `package.json`.

After cloning the repository and selecting `main`, install the locked dependencies and run the package checks:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

The corpus package compiles to `packages/corpus/dist/`. The root `test` command only delegates to packages that define a test script; none currently do, so it is not evidence of test coverage. There is no development server or browser benchmark command on `main`.

## Relationship to Engineering Lab

[Engineering Lab](https://lab.kristiansalmeron.com/) is the publication home for research questions, methods, and eventual findings; its [source repository](https://github.com/kriscodes/lab) is separate from this benchmark workspace.

Lab's proposed study, **The Cost of Rendering Progress**, investigates intermediate-frame update overhead and cadence within a renderer, with network acquisition kept separate. This repository has a broader intended scope spanning document structure, delivery, and rendering. The current corpus work does not implement or validate that proposed study.

## Before publishing findings

A publishable experiment needs a documented protocol, a runnable measurement harness, defined metrics, recorded environment and dependency versions, raw trials including failures, repeatability checks, and limitations. Results should identify the exact source revision and distinguish observed measurements from hypotheses.

## License

[MIT](LICENSE)

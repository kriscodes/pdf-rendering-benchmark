# Corpus validation

The `text-100-v1` corpus is a controlled input for future browser measurements.
The generator itself identifies its purpose as
`generator-smoke-test-not-performance-results` and calls for repeated-generation
hash checks and visual inspection. These checks advance that work without
selecting a browser renderer, delivery setup, or hosting provider.

See the [November 16, 2026 validation record](validation-2026-11-16.md) for the
commands, observed outcomes, environment workaround, and remaining coverage.

## Setup

Use Node.js 24.x; `.nvmrc` specifies 24.22.3. Use pnpm 11.28.12, as declared in
`package.json`, and install the workspace dependencies:

```sh
pnpm install --frozen-lockfile
```

Create the repository's Python environment if it does not already exist, then
install the exact versions in `packages/corpus/requirements.txt`:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r packages/corpus/requirements.txt
```

The requirements pin ReportLab 5.1.0, Pillow 13.0.0, and charset-normalizer 3.5.2.
Use Python 3.11 or newer for `hashlib.file_digest`. Python, qpdf, zlib, and Poppler
versions are recorded as evidence rather than pinned by this repository.

Install qpdf and Poppler through your system package manager, with `qpdf` and
`pdftoppm` available on `PATH`. Check the selected executables:

```sh
qpdf --version
pdftoppm -v
.venv/bin/python --version
```

## Run the checks

Run these commands from the repository root:

```sh
pnpm corpus:pilot
pnpm corpus:verify
pnpm test
pnpm typecheck
pnpm build
```

`corpus:pilot` regenerates the two PDFs and manifest in
`corpus/generated/pilot/`. This directory is for generated documents only. To
generate elsewhere, use:

```sh
pnpm corpus:pilot --output-dir /tmp/pdf-pilot
```

`corpus:verify` reads the existing corpus without replacing it. By default it
writes evidence to a new directory under `results/raw/corpus-validation/`. To
select the corpus and evidence locations explicitly, use:

```sh
pnpm corpus:verify --corpus-dir /tmp/pdf-pilot --output-dir /tmp/pdf-pilot-validation
```

The evidence directory must be new or empty. The direct Python entry points are:

```sh
.venv/bin/python packages/corpus/scripts/generate_text_pair.py
.venv/bin/python packages/corpus/scripts/verify_text_pair.py
```

## What validation establishes

The verifier checks the existing manifest against the PDF bytes and independently
runs qpdf checks for document validity, page count, and expected linearization.
It then runs the generator twice in separate temporary directories and compares
the complete generated manifests and PDFs. Regenerated source and PDF identities
and declared controls are compared with the existing corpus. Differences in
generator or tool provenance are reported separately; a matching local run does
not establish reproducibility across toolchains.

The experiment's controls remain:

- One synthetic source with 100 US Letter pages and 40 numbered records per page.
- The same layout, metadata policy, unembedded Helvetica fonts, and PDF version.
- Both variants processed by qpdf with the same deterministic ID, object-stream,
  compression, and recompression options. Only the linearized variant adds
  `--linearize`.

Poppler renders every page of both variants at 144 DPI. The verifier requires all
100 pages, checks the expected 1224 by 1584 pixel dimensions, rejects blank
renders, and compares decoded RGB pixels page by page. PNG file encoding does not
define equivalence. The JSON report records corpus identity, tool provenance,
settings, and check outcomes with purpose
`corpus-validation-not-performance-results`.

The evidence directory includes sample images of pages 1, 50, and 100 from both
variants. Inspect those images for legibility, clipping, layout, record numbering,
and footers. Record that inspection separately: the automated report does not
claim a human visual review, and two matching images can share a layout defect.

Failed checks exit nonzero and write a failed report when the evidence directory
can be created. Renderer diagnostics also fail validation, even with exit code
zero. A pixel-comparison failure retains the failing image pair in `failures/`.
Reports cap repetitive command diagnostics to keep them readable.

If Poppler reports missing Fontconfig configuration or an unwritable font cache,
fix that local environment before retrying; do not suppress the diagnostics.
`FONTCONFIG_FILE` can point to an installed system configuration, and
`XDG_CACHE_HOME` can point to a writable cache directory. The report records these
overrides and the selected configuration file's hash when available. No font
configuration or machine-specific path is imposed by the verifier.

`pnpm test` exercises verifier failure cases. Passing these tests is distinct from
running the complete corpus verification and inspecting its samples.

## Limits and the next experiment

Pixel equality applies to the selected Poppler version, rendering settings, and
local font environment. Helvetica is not embedded, so another environment can
substitute different fonts. These checks do not establish visual equivalence in
every renderer or independently prove every record's semantic content.

This corpus workflow produces no performance result. The separate
[first-page local benchmark](first-page-local.md) now measures PDF.js canvas
render completion in Chromium with documented delivery, cache, timing, and
repetition controls. Broader network/range behavior, other renderers, and
cross-platform repeatability remain separate experiments. No hosting choice is
required for either local workflow.

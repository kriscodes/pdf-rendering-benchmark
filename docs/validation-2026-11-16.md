# Text pilot validation — November 16, 2026

The corpus checks passed in the local environment below. These are input
validation results, not browser performance results. No loading or render-time
measurements were made.

## Inspection and changes

The checkout started clean on `feat/corpus-text-pair` at `e2a410e`. Inspection
covered the tracked files, package scripts, dependency pins, generator, profile
contract, ignored pilot PDFs and manifest, and empty application/runner/result
directories. No browser runner, renderer, delivery implementation, experiment
definition, or performance results were present. The generator explicitly called
for repeated-generation hash checks and visual inspection, and its manifest
marked visual equivalence as unchecked.

Implemented those next checks with `pnpm corpus:verify`, 22 regression tests, and
usage documentation. The generator gained an optional `--output-dir` so the
verifier can launch two independent processes in temporary directories without
replacing the current corpus. Its PDF content and transformation settings are
unchanged. The branch was preserved; no commit was created.

## Commands and outcomes

The default shell exposed Node 18.18.0. Workspace commands used the bundled Node
24.22.1 and pnpm 11.25.0. These satisfy the Node 24.x engine constraint but differ
from `.nvmrc` (24.22.3) and the declared pnpm version (11.28.12); the exact declared
JavaScript toolchain was not verified.

```sh
# Local runtime selection for this session only.
export PATH="/Users/kristian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"

pnpm typecheck
pnpm build
pnpm test

# Bundled Poppler needed the existing system Fontconfig configuration and a
# writable cache. Neither setting changes the PDF files or generator controls.
mkdir -p results/raw/corpus-validation/font-cache
FONTCONFIG_FILE=/opt/homebrew/etc/fonts/fonts.conf \
XDG_CACHE_HOME="$PWD/results/raw/corpus-validation/font-cache" \
pnpm corpus:verify
```

| Check | Outcome |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| `pnpm test` | 22 tests passed |
| Original manifest hashes and sizes | Passed for both PDFs |
| qpdf validity, page count, linearization | Passed; 100 pages each; only the intended variant is linearized |
| Two isolated generator processes | Complete manifests and PDF identities match each other |
| Regeneration versus original corpus | Source hash, document hashes, sizes, and controls match |
| Poppler raster comparison | 100 pairs / 200 pages; 144 DPI; 1224 × 1584 RGB; zero differing pixels in every pair; no blank page |
| Original corpus preservation | Both PDFs and original manifest unchanged |
| Visual sample review | Pages 1, 50, 100 in both variants passed the inspection described below |

Each isolated process ran the equivalent of:

```sh
.venv/bin/python packages/corpus/scripts/generate_text_pair.py --output-dir <temporary-run-directory>
```

The verifier independently ran `qpdf --check`, `qpdf --show-npages`, and
`qpdf --check-linearization` for the linearized document. Rasterization used
`pdftoppm -png -r 144 -aa yes -aaVector yes` for each PDF.

The first full verification attempt failed on Fontconfig diagnostics (missing
default configuration and no writable cache). It was rejected despite Poppler
returning zero. After the explicit configuration above, rasterization completed
without diagnostics. Regression tests cover this zero-exit/stderr failure case,
nonzero exit, timeout, bounded diagnostics, failure reports, artifact tampering,
generation mismatches, incomplete page sets, blank/wrong-size images, and a
single-channel one-pixel difference.

## Evidence and environment

The successful local report is
[`report.json`](../results/raw/corpus-validation/run-d0i4b2xy/report.json), with six
PNGs in its `samples/` directory. The initial failed report remains in
`results/raw/corpus-validation/run-_kzbuor4/`. Generated evidence is ignored by
Git and will not exist in a fresh clone; rerun the documented command to produce
a new uniquely named report. This document preserves the result summary.

The successful report covers November 16, 2026 in America/Los_Angeles (its audit
timestamps use UTC). It records macOS 15.6 arm64, Python 3.13.18, ReportLab 5.1.0,
Pillow 13.0.0, qpdf 12.4.2, zlib 1.2.12, and Poppler 26.05.0.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Nonlinearized PDF | 86,329 | `d9ad470b1f56976f907aad64712c2269b380cb0af7e52a5c3670dc3290af162a` |
| Linearized PDF | 87,189 | `efb5faa8018ec5a2b508eb703d55fa39e8cb4746b6aad29d05a841b6c3cf874a` |

The source hash is
`465b1d7b547fa3349ddc23de665621f82657baa1bbcd97c4ff1e58bc39f0fe36`.
The unchanged original manifest hash is
`92929ca2eb94964f13c592e11551d7821f8a8b110ba546596aa951c8deae2f8a`.
The new generator hash is
`3af45d05ddcc22bb69e38463e915cbc4cfb4250e189f32f27f9ede50c8e1d978`;
its change from the original manifest is explicitly recorded as provenance,
not written back to that manifest. The verifier hash for this run is
`13825821541db3f60351bc1d2e28afa808806f474a8bf32bc7d155d9ff161e01`.

Fontconfig used `/opt/homebrew/etc/fonts/fonts.conf`, whose hash is recorded in
the report. The bundled `fc-match` resolved both Helvetica regular and bold to
`/System/Library/Fonts/Helvetica.ttc` (SHA-256
`25eceb458d4baf628ee0b6a135a9f8ac5ec7b2826646720834bd2bf00dfc825a`).
This identifies the observed local font environment; it is not a portable font
pin or proof of the same font choice by another renderer.

## Visual inspection and remaining work

Agent-assisted visual inspection opened the PNGs for both variants at pages 1,
50, and 100. Each showed a legible heading/subtitle, horizontal rule, 40 complete
rows, consistent spacing, the profile footer, and the correct page number. No
visible clipping, overlap, or broken glyphs were found in these samples.

| Page | Visible record range | Page footer |
| --- | --- | --- |
| 1 | 00001–00040 | 1 / 100 |
| 50 | 01961–02000 | 50 / 100 |
| 100 | 03961–04000 | 100 / 100 |

This section records the visual review separately; the automated JSON's
`manualInspection.status` remains `pending` by design. The automated verifier
does not claim to perform that review itself. The remaining 97 page pairs were
checked for raster equality, dimensions, and nonblank output, not manually
reviewed or independently checked for every record's semantic content.

Browser benchmark testing remains unfinished. The checkout does not specify the
browser/renderer or measurement milestone; clarification was requested before
implementing that experiment. Network/range delivery, cache conditions, repetition
protocol, cross-renderer behavior, and cross-toolchain reproducibility are also
unverified. No browser architecture, hosting provider, or speed benefit is
established by these corpus results.

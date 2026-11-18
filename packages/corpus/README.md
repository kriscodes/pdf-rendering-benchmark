# Corpus package

This package creates and validates the `text-100-v1` synthetic input pair. Both PDFs contain the same 100 US Letter pages and 40 numbered rows per page. They use the same source and qpdf options; only one adds linearization. The generator's purpose remains `generator-smoke-test-not-performance-results`.

## Files and contracts

| File / entry point | Inputs | Outputs and side effects |
| --- | --- | --- |
| [`scripts/generate_text_pair.py`](scripts/generate_text_pair.py), `main()` | Fixed synthetic layout, ReportLab, qpdf; optional `--output-dir`. | Generates both PDFs from one temporary source, checks their structure, then replaces the generated PDFs and manifest in the selected directory. Default: `corpus/generated/pilot/`. It does not measure rendering speed. |
| [`scripts/verify_text_pair.py`](scripts/verify_text_pair.py), `main()` / `verify()` | Existing corpus/manifest, qpdf, Poppler and pinned Python libraries; optional `--corpus-dir` and `--output-dir`. | Reads the corpus without replacing it; regenerates into temporary directories, rasterizes all pages, compares pixels, and writes a separate JSON report plus representative/failing PNGs. |
| [`src/index.ts`](src/index.ts) | `PdfDocumentProfile` values. | Exports profile metadata types and `describeProfile()`. No file, network or browser side effects. Its content-type union is a type vocabulary, not a claim that those corpora have been generated. |
| [`tests/test_verify_text_pair.py`](tests/test_verify_text_pair.py) | Temporary fixtures and controlled failure cases. | Tests validation behavior. It is separate from full corpus verification and human inspection of saved samples. |
| [`requirements.txt`](requirements.txt) | Python environment. | Pins charset-normalizer, Pillow and ReportLab. Installing requirements changes that environment. |

The current font policy is standard Helvetica without embedded fonts. The [validation method](../../docs/corpus-validation.md) explains deterministic options, tool provenance, 144 DPI raster checks and visual inspection limits.

## Commands and the active freeze

Run commands from the repository root. In a new development checkout, follow [setup](../../docs/corpus-validation.md#setup), then use:

```sh
mkdir -p results/raw
development_dir="$(mktemp -d "$PWD/results/raw/corpus-development.XXXXXX")"
.venv/bin/python packages/corpus/scripts/generate_text_pair.py \
  --output-dir "$development_dir/corpus"
.venv/bin/python packages/corpus/scripts/verify_text_pair.py \
  --corpus-dir "$development_dir/corpus" \
  --output-dir "$development_dir/validation"
```

Choose new output directories for each validation. The generator replaces generated files in its selected directory; never point it at hand-authored documents. The verifier requires a new or empty evidence directory and retains failed checks when it can create that directory.

The current measurement corpus and generator are frozen by the [final campaign plan](../../experiments/final-windows.json). Do not run `pnpm corpus:pilot` against that checkout's protected default corpus. An isolated development generation does not replace, repair or count as a scheduled benchmark attempt.

For software checks, see [Contributing](../../CONTRIBUTING.md). For accepted evidence and remaining limits, see the [documentation index](../../docs/README.md). A successful qpdf check, matching raster or passing unit test is not a browser performance result.

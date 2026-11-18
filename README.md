# pdf-rendering-benchmark
Open-source, reproducible benchmarks investigating how PDF structure, network delivery, and rendering architecture affect browser rendering performance.

The current implementation generates and validates a controlled pair of 100-page
text PDFs, then benchmarks their first-page canvas rendering with PDF.js in local
Chromium. Both variants come from the same source and use the same qpdf settings;
only one adds linearization. The generator remains a smoke test. Performance
measurements come from the separate browser runner.

After [setting up the local tools](docs/corpus-validation.md#setup), run:

```sh
pnpm corpus:pilot
pnpm corpus:verify
pnpm test
pnpm typecheck
pnpm build
```

`corpus:pilot` replaces generated files in `corpus/generated/pilot/`.
`corpus:verify` preserves that corpus, checks repeatability and all-page raster
equivalence, and writes a separate validation report with samples for visual
inspection. See [corpus validation](docs/corpus-validation.md) for the controls,
commands, evidence, and limitations.

For the browser pilot, follow [first-page benchmark setup](docs/first-page-local.md)
to install the pinned Chromium binary, then run `pnpm bench:first-page`. It saves
raw trials, summaries, and samples under `results/raw/first-page-local/`. This
small local full-response experiment does not establish a network-delivery or
general linearization speed benefit.

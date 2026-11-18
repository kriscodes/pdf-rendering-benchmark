# Contributing

Start with the [documentation index](docs/README.md), [corpus package](packages/corpus/README.md), and [runner package](packages/runner/README.md). This project separates generated inputs, software checks, browser experiments, and independent evidence audits. Passing one does not establish the others.

## Work during the current campaign

The [fixed-window protocol](docs/final-windows.md) and [plan](experiments/final-windows.json) govern the active experiment. The plan protects source, compiled code, dependencies, runtime binaries, PDFs and prior evidence by hash. Keep the existing branch and local work. Do not regenerate the protected corpus, rebuild protected output, install or update dependencies in the measurement environment, format frozen files, change acceptance gates, or run an extra browser campaign.

Additive documentation and development tools can be reviewed separately. Check that proposed files are outside the plan's protected paths. Run software checks in an isolated temporary checkout or temporary output directory, outside measurement periods. CI checks software in a fresh checkout; its success does not authorize or execute a scheduled measurement. Do not use an automatic formatter's write mode during this freeze.

After all scheduled slots, evidence audits and publication are finalized, propose source refactoring as a new change. Preserve historical snapshots and reports. Any change to executed experiment code or dependencies needs a newly declared experiment version and validation before producing comparable measurements.

## Development and verification

The repository declares Node 24.x (`.nvmrc` selects 24.22.3), pnpm 11.28.12 and exact Python requirements. The active experiment instead preserves the runtime versions recorded in its plan, including Node 24.22.1. Do not silently replace one with the other. Follow [corpus setup](docs/corpus-validation.md#setup) for a new development environment; browser installation and execution are separate steps in the relevant protocol.

Outside the protected measurement checkout, the existing checks are:

```sh
pnpm typecheck
pnpm test
.venv/bin/python -m unittest discover -s packages/runner/scripts -p 'test_*.py' -v
```

`pnpm test` builds runner JavaScript before running tests. It includes local HTTP server tests, so loopback binding must be permitted. The runner-script Python suite uses temporary fixtures and fake child processes; it does not launch the browser benchmark. Corpus tests exercise verifier behavior and are separate from full raster verification. Keep generated test files and build output out of protected evidence directories.

The additive [quality-tool guide](tools/quality/README.md) specifies the read-only lint commands, pinned tools and CI scope. Those tools are installed separately from root dependencies. The quality workflow's Node/pnpm versions are development checks, not substitutions for the active campaign's preserved runtime. A local check result does not prove that the remote CI workflow has run.

Select checks for the behavior being changed. HTTP range handling needs real HTTP cases; deadline/cleanup changes need bounded fake-process failure cases; interval or schedule changes need pure deterministic tests; audit changes need rejected and incomplete evidence cases. Preserve a failing case as a regression test when fixing a defect. A documentation-only change needs link and command review, not a new performance run.

## Readable names and file contracts

Use familiar domain names and make units and clock domains visible. `renderDurationMs`, `requestUrl`, `bodyBytesWritten`, and `remainingOperationTimeoutMs` are more useful than unexplained abbreviations. Keep established terms such as PDF, CDP, SHA-256, UTC and RGBA where they are accurate; explain them at the package boundary. A short loop index is fine inside a small local loop.

Use verbs for actions and names that distinguish behavior. A wait that accepts canceled responses during cleanup should not look interchangeable with a wait that requires successful completion. Keep page `performance.now()` values, CDP timestamps, Node monotonic times and UTC wall-clock timestamps distinct. Never subtract values from different clock domains without the recorded mapping.

For a new executable module, document its purpose, invocation, inputs, outputs, side effects and failure behavior at the top of the file. For a library module, document its exported contract and important assumptions. Public functions need comments where they enforce a scientific or lifecycle rule; avoid comments that only repeat the code. The package README inventories the existing frozen files while their headers remain unchanged.

Prefer explicit TypeScript interfaces and Python types for configuration, raw records and outcomes. Separate raw evidence from derived summaries. Parse external JSON at a clear boundary, validate it, and keep the validation visible. Do not use a name such as `passed` without identifying whether it means operational validity, clock acceptance, guard acceptance or audit integrity.

Extract shared transport and lifecycle code when it reduces duplication without changing behavior. Keep independent audit calculations independent of the runner's calculations. A shorter file is not an improvement if it hides acceptance rules or turns an independent check into a call to the implementation being checked.

## Scope and security boundaries

The current tools use controlled synthetic local PDFs and an allowlisted loopback HTTP server. They are not a public upload service or a general-purpose sandbox for untrusted documents. Keep PDF/app routes explicit, use fixed executable arguments without shell interpolation, keep service workers blocked and caches controlled, and preserve timeout, process-cleanup and evidence-directory checks. Any broader input or network exposure needs its own design and review.

Review generated reports and archives before sharing: local paths, runtime details and source snapshots are intentional research provenance. Credentials, private documents and unrelated workspace files do not belong in evidence bundles. Security findings and dependency changes must be recorded separately from performance findings; static checks alone do not certify this project as secure.

For the legacy `summarize_controlled_delivery.py` CLI, always provide `--audit-json` in a newly created directory owned by your user. Its default is a predictable shared `/tmp` path, and its existing write can follow a symlink if local permissions allow it. The frozen code is unchanged. From the repository root, outside measurement periods, use an existing report and a fresh local audit directory:

```sh
report_path=/absolute/path/to/existing/report.json
mkdir -p results/raw
audit_dir="$(mktemp -d "$PWD/results/raw/manual-audit.XXXXXX")"
.venv/bin/python packages/runner/scripts/summarize_controlled_delivery.py \
  "$report_path" \
  --output-prefix "$audit_dir/controlled-delivery" \
  --audit-json "$audit_dir/audit.json"
```

The current final-window auditor imports the `audit_report()` function; it does not execute that legacy CLI's default output write. This safer invocation guidance is not a source-code fix. Keep the eventual repair and its symlink regression test as an explicit follow-up after the freeze.

The [source security review](docs/security-review-2026-11-18.md) records the finding, its conditional local impact and the limits of the assessment. It did not audit dependency advisories or third-party implementation code.

## Review and commits

Describe the concrete behavior changed, the relevant validation, and any unverified paths. Use small commits with clear descriptions such as “Document benchmark entry points” or “Validate cleanup after runner timeout.” Keep code changes, experiment protocols, results and publication receipts separate when they represent different review decisions. Never overwrite a historical failed report or replace a scheduled attempt to obtain a favorable result.

The [code-quality review](docs/code-quality-review-2026-11-18.md) records specific deferred refactoring work and the limits of this documentation pass.

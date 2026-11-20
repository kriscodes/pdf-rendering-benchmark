# Code-quality documentation review — November 18, 2026

This is a source/readability review and additive documentation pass during the fixed-window experiment freeze. It is not a performance acceptance decision or a security certification. Existing source, compiled runners, dependencies, protocols, corpus and historical evidence were not edited by this documentation pass. No benchmark was launched for it.

The new [contribution guide](../CONTRIBUTING.md), [documentation index](README.md), [runner README](../packages/runner/README.md) and [corpus README](../packages/corpus/README.md) explain the current workflow and per-file contracts. They distinguish software tests, corpus checks, browser measurements, independent audits and publication. The root README and code headers remain unchanged because they are protected inputs.

## What was inspected

The review read workspace/package scripts, TypeScript settings, Python requirements, corpus generator/verifier, HTTP/pacing and clock modules, controlled-delivery and PDF-observer orchestration, browser viewers, fixed-window launcher/auditor, and current protocols/result documentation. Existing public names such as `startPacedServer`, `calibrateOffset`, `mapPageTime`, `createPdfClockSchedule`, `verifyPartialDocument`, `validate_manifest`, and `process_group_gone` already convey their purpose and should remain stable without a behavioral reason to change them.

## Deferred source improvements

These are concrete proposals, not completed renames or refactors. Line references identify the inspected files; they will move in future versions.

| Location | Observation | Proposed follow-up after finalization |
| --- | --- | --- |
| `packages/runner/src/pdf-clock-observer.ts:22` and `:23` | `json` and `remaining` omit their I/O and time-unit meaning. The same orchestration also uses `op()` as a remaining timeout supplier. | Prefer `loadJsonFile`, `remainingBudgetMs`, and `remainingOperationTimeoutMs` when creating the next version. Keep short conventional loop variables where scope is obvious. |
| `packages/runner/src/pdf-clock-observer.ts:193` and `:202` | `awaitServerRequests` rejects canceled responses; `awaitServerTerminal` accepts completed or canceled responses during cleanup. Similar names hide an important lifecycle distinction. | Consider `waitForSuccessfulResponses` and `waitForTerminalResponses`, with tests preserving both success and cancellation semantics. This is more valuable than cosmetic renaming. |
| `packages/runner/src/pdf-clock-observer.ts:136`, `:209`, `:459` | Browser/report/configuration objects are largely `any`, despite strict TypeScript. Record shapes and allowed states are spread across mutation sites. | Define configuration, raw-trial, guard, clock-method and outcome interfaces, then validate parsed JSON at the boundary. Preserve explicit operational/clock/guard distinctions and failed/incomplete variants. |
| `packages/runner/src/pdf-clock-observer.ts:33`, `:119`, `:136`, `:209`; corresponding functions in `controlled-delivery.ts` | Corpus loading, observation and calibration orchestration are copied to preserve historical implementations. Fixes can drift between versions. | After the freeze, extract deliberately shared transport/lifecycle contracts into a new version with failure-path tests. Keep historical snapshots intact and keep independent audit arithmetic separate. |
| `packages/runner/src/pdf-clock-observer.ts:571` and `packages/runner/scripts/run_final_windows.py:206` | The main campaign/launcher functions combine setup, scheduling, validation, execution, failure recording and finalization. Their behavior is correct only when these stages remain ordered. | Extract named stages with explicit inputs/results; preserve the once-only claim, write-before-launch ledger and cleanup ordering. Add focused tests before moving lifecycle code. |
| `packages/runner/src/run.ts:1`, `controlled-delivery.ts:1`, `pdf-clock-observer.ts:1`, `paced-server.ts:1` | Several files start with imports and lack a file-level purpose/side-effect header, though important functions have comments. | Add short headers describing CLI versus library use, input/output locations, side effects and acceptance scope. The new runner README supplies this information while the files are frozen. |
| `packages/runner/src/pdf-clock-observer.ts:564` | `counts` does not reveal which outcomes it summarizes. | `summarizeTrialOutcomes` would make call sites clearer. Keep separate counts for operational validity and method acceptance. |

The corpus Python scripts already have useful module docstrings, and the partial-loading viewer documents its two phases. `paced-server.ts` documents aggregate pacing and distinguishes Node-written bytes from client receipt. `partial-network.ts` states its clock assumptions and accounting limits. Preserve those comments and names when refactoring.

## Testing, lint and CI boundaries

The [contribution guide](../CONTRIBUTING.md) identifies the existing test commands and their side effects. Type checking is already strict, but `any` bypasses parts of that protection. Unit tests exercise important HTTP, pacing, interval, schedule, evidence and process-control cases; their presence does not establish every live timeout or browser failure path.

Lint/CI work is a separate additive change documented in the [quality-tool guide](../tools/quality/README.md). It uses pinned Biome/Ruff tools and an exact frozen baseline of eleven findings: eight unsafe-finally findings and three unused imports. These findings remain visible debt; passing the baseline-aware gate is not a claim that direct lint reports zero findings. Formatting, naming rules and broad `any` cleanup remain deferred. The guide records the commands, scope and unverified hosted-CI execution. Do not “fix” a historical experiment by reformatting frozen source or regenerating its evidence, or refresh baseline hashes merely to obtain a pass.

## Completed verification

The new gate and workflow commands were exercised in a disposable copy using the declared development Node 24.22.3 and pnpm 11.28.12. Frozen dependency installation passed; the active experiment still uses its preserved runtime. Biome 2.6.8 inspected 45 files and Ruff 0.17.5 inspected 18 Python files. The gate passed with no new findings and the eleven exact retained findings printed.

Both package type checks passed. All 155 tests passed: 77 Node tests, 22 corpus Python tests, 53 runner/auditor Python tests and three new lint-baseline tests. The first server-test invocation lacked local-port permission and failed with `EPERM`; the permitted rerun passed. Both logs are retained. The workflow YAML was parsed, but the Linux GitHub Actions job has not run remotely. No browser benchmark was run for quality verification.

The [validation record](data/code-quality-validation-2026-11-18.json) identifies commands/checks, runtime distinctions, retained logs and limitations. A final preservation check confirmed all 1,112 repository files and 22 runtime files in the experiment plan still match. Readability links were checked across the new guides. These results cover additive tooling/docs and software checks; they do not implement the deferred source changes listed above.

## Security scope and remaining work

The reviewed tools operate on controlled synthetic local inputs and explicit loopback assets. Preserve route allowlists, argument-list subprocess calls, exact artifact identity checks, bounded execution, exclusive campaign admission and process-cleanup evidence. These are relevant boundaries; this documentation review is not a vulnerability assessment or authorization to accept arbitrary uploaded PDFs or expose the fixture publicly.

The separate [source security review](security-review-2026-11-18.md) identified the legacy controlled-delivery audit CLI's predictable `/tmp/controlled-delivery-audit.json` default (`packages/runner/scripts/summarize_controlled_delivery.py:453`, with writes at `:469` and `:475`). The existing path write may follow a symlink, creating a conditional file-clobber risk on a shared machine under permissive local rules. The [contribution guide](../CONTRIBUTING.md#scope-and-security-boundaries) supplies an explicit fresh user-owned output path. The active final-window auditor imports the audit function and does not execute that default write. The source remains frozen; this guidance does not claim the code is repaired.

Additional security findings must be recorded with their evidence and status. This page makes no claim about dependency vulnerability status, remote CI execution or a clean security scan. Frozen source changes, header additions, naming improvements and modularization remain unimplemented until campaign finalization and an explicitly reviewed follow-up change.

## Published record

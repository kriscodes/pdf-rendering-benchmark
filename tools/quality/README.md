# Code quality checks

These checks lint source, type-check TypeScript, and run unit tests. They do not launch PDF benchmarks, generate the corpus, install Chromium, compare performance, or change a benchmark acceptance gate. Run builds and dependency installation in a disposable checkout while the final-window campaign is frozen: the existing `pnpm test` script builds `dist`.

The quality runtime follows the repository declarations: Node **24.22.3** from `.nvmrc` and pnpm **11.28.12** from `package.json`. Both versions were verified against the official [Node release checksums](https://nodejs.org/dist/v24.22.3/SHASUMS256.txt) and [pnpm registry entry](https://registry.npmjs.org/pnpm/11.28.12). They are separate from the recorded experiment runtime, Node **24.22.1** and pnpm **11.25.0**. The workflow uses Python **3.13**, Biome **2.6.8**, and Ruff **0.17.5**. Tool installation does not add dependencies to the project manifest or lockfile.

## Install tools outside the checkout

With Node 24.22.3 and Python 3.13 available, run from the repository root:

```sh
quality_dir=$(mktemp -d)
npm install --prefix "$quality_dir/node" --no-package-lock --ignore-scripts --no-audit --no-fund @biomejs/biome@2.6.8 pnpm@11.28.12
python3 -m venv "$quality_dir/python"
"$quality_dir/python/bin/python" -m pip install ruff==0.17.5
export PATH="$quality_dir/node/node_modules/.bin:$quality_dir/python/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python tools/quality/check.py
```

The lint command reads files only; Ruff caching is disabled. It prints all eleven deferred findings on every run. New findings, changed source hashes or locations, and stale baseline entries fail the check. Direct `biome lint` will still report the known findings; the wrapper applies the reviewed exact baseline.

In a **fresh disposable copy**, install the frozen dependencies and run the same checks as CI:

```sh
pnpm install --frozen-lockfile --ignore-scripts
python -m venv .venv
.venv/bin/python -m pip install -r packages/corpus/requirements.txt
export PYTHONDONTWRITEBYTECODE=1
pnpm typecheck
pnpm test
.venv/bin/python -m unittest discover -s packages/runner/scripts -p 'test_*.py' -v
.venv/bin/python -m unittest discover -s tools/quality -p 'test_*.py' -v
```

These unit tests use synthetic fixtures and injected processes; they do not need the historical raw reports, generated PDFs, qpdf, Poppler, or a browser installation. Server tests bind temporary loopback ports. The launcher tests exercise process cleanup with test processes, without invoking the experiment runners.

## Scope and deferred work

`biome.json` enables the recommended correctness, suspicious-code, and security rule groups for TypeScript sources, viewer JavaScript, and experiment/package/TypeScript JSON configuration. Formatting, import sorting, style/naming rules, and `noExplicitAny` are deferred. The existing strict TypeScript configuration remains in force. `any` usage at browser/protocol boundaries and in test doubles needs a separate reviewed typing pass; this gate does not certify those boundaries.

`ruff.toml` checks Python source and tests under `packages` and `tools/quality`: `E4`, `E7`, `E9`, `F`, plus mutable defaults, function-call defaults, control flow in `finally`, useless expressions, and exception chaining (`B006`, `B008`, `B012`, `B018`, `B904`). Only compound-line style rules `E701`/`E702` are excluded from that selection. Formatting, import ordering, naming conventions, and broader advisory rule groups are deferred. Explicit configuration prevents unrelated parent-directory Ruff settings from changing the gate.

The [frozen finding list](frozen-findings.json) contains eight `noUnsafeFinally` findings in `clock-observer.ts` and `pdf-clock-observer.ts`, plus three unused-import findings across `controlled-delivery.ts`, `partial-loading.ts`, and `pdf-clock-observer.ts`. Throws during cleanup can replace an earlier error; some also deliberately stop after failed cleanup. Review error retention and the experiment's fatal-cleanup contract before changing them. They are documented debt, not proof of a runtime defect or an instruction to auto-fix. No correctness rule is disabled to hide these sites. Once a change is authorized after the freeze, fix the source and remove the corresponding baseline entry together; do not refresh hashes merely to obtain a pass.

## CI limits and provenance

The [workflow](../../.github/workflows/quality.yml) runs on `push` and `pull_request` with a read-only contents token, no repository secrets, no persisted checkout credentials, no dependency caches, and a 15-minute timeout. Actions are pinned to full commit hashes verified against official GitHub tags: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), and [setup-python v7.1.0](https://github.com/actions/setup-python/releases/tag/v7.1.0). It uses neither `pull_request_target` nor benchmark scripts. This follows GitHub's [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Tool behavior and configuration follow the primary [Biome configuration reference](https://biomejs.dev/reference/configuration/) and [Ruff configuration reference](https://docs.astral.sh/ruff/configuration/); Ruff's [CI guide](https://docs.astral.sh/ruff/integrations/) describes its pass/fail integration. Linting is not a security audit. Dependency advisories and third-party implementation code are not assessed by this workflow. The first actual GitHub Actions execution remains unverified until the workflow is pushed and runs there.

Local verification on 2026-11-18 used a disposable macOS arm64 copy with Node 24.22.3, pnpm 11.28.12, and Python 3.13.18. Frozen installation, linting (45 Biome files and 18 Python files), and both TypeScript checks passed. All 155 unit tests passed: 77 Node, 22 corpus Python, 53 runner/auditor Python, and three lint-baseline regression tests. The initial server-test attempt could not bind loopback ports under the local execution restrictions; the permitted rerun passed. The original checkout's 1,112 preserved-file hashes and 22 runtime hashes still matched afterward. This validates the local commands, not GitHub's Linux runner or performance results.

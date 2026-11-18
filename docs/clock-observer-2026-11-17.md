# Bounded clock-observer diagnostic results — 2026-11-17

The one predeclared campaign completed: all 36 probes passed operational checks, the unchanged 5 ms clock-width gate, and known-event classification with both methods. The fixed 15-bracket candidate produced narrower intervals than the nested three-bracket reference in all 36 probes. It rescued **zero** failures because the reference also passed every probe.

This establishes successful bounded collection and coarse known-event classification for this fixture on this host. It does not establish improved clock accuracy, cure the earlier PDF-trial failures, or provide new PDF performance results. The PDF benchmark implementation and all historical results remain unchanged.

## What was inspected and built

Inspection covered the current branch and commit history, generator/corpus records, baseline and partial-loading reports, controlled-delivery implementation and interval functions, the fixed three-attempt replication protocol and rejection evidence, and the current Lab 001 notebook. The prior three failures were widths of 5.176, 5.284, and 5.005 ms against the unchanged 5 ms gate; no new performance estimate was accepted.

Protocol commit `fab908f` preceded execution. It added `experiments/clock-observer.json`, the preservation lock, and `docs/clock-observer.md`. Implementation commit `517007e` added the bounded runner, minimal known-byte fixture, pure interval analysis and tests, viewer contract tests, and independent Python auditor. No existing source file or dependency was changed.

The new runner bounds every collection stage, retains errors/incomplete evidence, uses fresh contexts and browser sessions, saves after each probe, and snapshots its executed sources. The fixture loads no PDF.js, PDF worker, or PDF. The audit recomputes interval intersections and classifications from raw records without calling the TypeScript analyzer.

## Protocol actually executed

One invocation, three fresh Chromium sessions, 12 serial fresh-context probes per session, with unpaced/paced fixtures alternating and session starts U/P/U. There were no discarded warmups, skipped probes, replacements, adaptive samples, or additional campaigns.

Each probe collected exactly five consecutive CDP/page/CDP brackets at each of three fixed points: before the first transfer; after its completion, requested 30 ms wait and marker; and after the explicitly triggered second transfer. The reference used the first bracket of each burst; the candidate intersected all 15. Both retained the 1 ms calibration margin, second 1 ms marker-mapping margin, and strict 5 ms maximum width.

Each known range response contained 4,096 exact bytes from a 49,152-byte word-index fixture. The first requested bytes 0–4095 before the marker; the second requested bytes 4096–8191 after a separate requested 30 ms wait. Both required GET Range, 206 status, precise Content-Range/Length, identity encoding, exact byte pattern, and matching completed CDP/server evidence.

The paced route reused the existing 100 ms response-header delay and nominal shared 125,000-byte/s body cap, charging each quantum of at most 2,048 bytes. Unpaced and paced routes served identical bytes. Existing viewport 1280 × 1000, DPR 1, disabled HTTP cache and blocked service workers were retained. Limits were 5 seconds per operation/burst, 20 seconds per probe, 120 seconds per session, 420 seconds per campaign, and 10 seconds for cleanup.

## Execution and outcomes

The invocation ran on November 17, 2026, 23:10:36.579–23:10:48.649 PST (November 18, 07:10:36.579–07:10:48.649 UTC), exited 0, and wrote `results/raw/clock-observer/run-Mnxb0a/report.json`. All three sessions completed. All 36 scheduled probes, 108 bursts, and 540 brackets are retained; zero probes were unattempted.

| Outcome | All probes | Unpaced | Paced |
| --- | --- | --- | --- |
| Both methods passed | 36 | 18 | 18 |
| Reference only | 0 | 0 | 0 |
| Candidate only | 0 | 0 | 0 |
| Neither / unavailable | 0 / 0 | 0 / 0 | 0 / 0 |
| Operational failures | 0 | 0 | 0 |

Every session had 12/12 passes for each method, six per fixture. There were no inconsistent intersections, width-gate failures, known-event misclassifications, browser warnings/errors, failed requests, or workers.

## Widths and collection cost

All values below are milliseconds. These are descriptive summaries of one same-machine campaign; probes are not independent environmental samples.

| Measure | Minimum | Median | Maximum |
| --- | --- | --- | --- |
| Three-bracket reference boundary width | 4.332 | 4.495500 | 4.753 |
| Fifteen-bracket candidate boundary width | 4.183 | 4.274499 | 4.430 |
| Paired candidate minus reference width | −0.368 | −0.234500 | −0.072 |
| Sum of three burst elapsed times per probe | 9.143 | 15.410 | 25.282 |
| Sum of all 15 CDP bracket spans | 5.905 | 9.990 | 17.608 |
| Sum of three reference bracket spans | 1.516 | 2.540 | 3.662 |
| Sum of 12 additional bracket spans | 4.389 | 7.375 | 15.184 |

The paired median difference is not the difference between the two marginal medians. Both analyses share all 15 samples' collection overhead. The last row measures observed spans of the additional brackets, not the counterfactual change in total runtime versus a separately executed three-bracket observer; the spans also omit some call overhead.

| Session | Fixture | Both passed / scheduled | Reference median width | Candidate median width | Median paired difference | Median burst elapsed sum |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | unpaced | 6 / 6 | 4.523 | 4.282 | -0.252 | 13.030 |
| 1 | paced | 6 / 6 | 4.596 | 4.350 | -0.250 | 17.648 |
| 2 | unpaced | 6 / 6 | 4.480 | 4.243 | -0.213 | 14.950 |
| 2 | paced | 6 / 6 | 4.481 | 4.224 | -0.248 | 14.083 |
| 3 | unpaced | 6 / 6 | 4.458 | 4.242 | -0.228 | 12.085 |
| 3 | paced | 6 / 6 | 4.493 | 4.302 | -0.223 | 17.118 |

Actual page gaps were 30.6–33.4 ms (median 32.5) between first body completion and marker, and 35.5–42.5 ms (median 38.45) between marker and second fetch start. The latter includes the intervening five-bracket burst and orchestration. These gaps validate coarse before/after separation; they are not sub-5-ms timing ground truth.

## Independent evidence audit and preservation

The Python audit passed with zero integrity issues. For each method, every first transfer's request, response headers, all 4,096 CDP-reported body bytes and completion fell at or before its marker interval; every second transfer's events fell after it. Across 36 probes this is 147,456 reported bytes before and 147,456 after, with zero uncertain or opposite-side events/bytes. Both methods classify the same events; these totals must not be doubled to claim extra traffic.

All 72 fixture responses were complete 206 responses with 4,096 CDP-reported body bytes and 4,096 server-written bytes each. The browser fixture checked every received byte against the known pattern. The independent audit checks the recorded metadata and CDP/server evidence; raw response payloads were not saved for a separate byte-by-byte replay. CDP timestamps describe event accounting, not exact physical network arrival or renderer-consumed bytes.

All 18 paced probes passed the unchanged release-ledger checks across their 36 responses, including header timing, charged quanta, serialization, completion, and write lateness. Observed server header delay was 100.285–102.509 ms (median 101.312); headers-to-body-end span was 34.863–40.466 ms (median 38.014) against a nominal 32.768 ms serialization budget per 4,096 bytes. Maximum write lateness was 4.376 ms. Browser header delay was 101.6–106.0 ms and headers-to-body-completion span was 34.6–39.7 ms. These small sequential fixture transfers do not replace the PDF experiment's full single/concurrent/unshaped pre/post calibration suite, which was not run in this diagnostic.

All **82 protected source files and 139 prior artifacts** match their preservation-lock hashes. All **17 executed-source snapshots** match both their report hashes and current files. Original PDF bytes and manifest, the four-run baseline, partial-loading records, controlled pilot, and rejected replication records remain unchanged. The report records successful final preservation checks.

| Evidence | SHA-256 |
| --- | --- |
| Raw report | `e6b70a3717b9e1a6e26f53373ec7acdeb0d8e916ca35947df5cbfbe16bbdc721` |
| `docs/data/clock-observer-2026-11-17.csv` | `52c6570ab20f9ff71b53e7151433eeebad1f4d2c6317d2998c4da2aa182526f8` |
| `docs/data/clock-observer-2026-11-17.json` | `c559fa3b9dc516f7493ab1e431cc32035d21216c44ebfcd599150b2b58aa7a22` |

The CSV retains all 36 scheduled rows, separate operational/clock/classification/final statuses, both widths, and observed collection spans. The JSON includes per-session/per-fixture aggregates, independently reconstructed intervals, network buckets, pacing audits, source identities, and limitations. Full raw events, brackets and source snapshots are in the retained report directory and evidence archive.

## Commands and software checks

The installed runtime was Node 24.22.1, pnpm 11.25.0, Python 3.13.18, Playwright 1.62.1 and Chromium 151.0.7922.34 on Darwin 24.6.0 arm64, Apple M2, 8 logical CPUs and 8 GiB RAM. Repository-declared Node 24.22.3 and pnpm 11.28.12 remain unexercised. PDF.js 5.6.205 is preserved but not loaded by this diagnostic.

```sh
export PATH="/Users/kristian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export pnpm_config_verify_deps_before_run=false
pnpm test
pnpm typecheck
.venv/bin/python -m unittest discover -s packages/runner/scripts -p 'test_*.py' -v
node packages/runner/dist/clock-observer.js
.venv/bin/python packages/runner/scripts/audit_clock_observer.py \
  --report results/raw/clock-observer/run-Mnxb0a/report.json \
  --output-prefix docs/data/clock-observer-2026-11-17
```

Before the campaign, all 92 workspace tests (22 corpus and 70 runner, including 13 new diagnostic tests), 14 Python tests, and workspace type checks passed: 106 tests total. The first restricted test invocation could not bind the loopback server (`EPERM`); rerunning with local network access passed. This was a software check, not an extra diagnostic campaign. The runner build performed by `pnpm test` passed. The diagnostic and audit each exited 0. No tests or intentional CPU-heavy analyses ran during measurements.

New tests cover fixed schedule and sample selection; valid/inconsistent intersections; unchanged strict width threshold; malformed input; exact fixture bytes/headers; explicit phase ordering; rejected overlap/repeat calls; and fixed inputs. Review also checked cleanup and late-event handling. Live deadline exhaustion, failed context setup, and forced browser-termination paths were not exercised by this successful campaign; the older Python timeout tests exercise the earlier replication launcher, not this diagnostic's browser cleanup.

## Interpretation and next research decision

Both methods passed every fixture probe, so there is no observed acceptance-rate gain. Additional constraints mathematically narrowed the candidate intervals; this does not independently establish clock accuracy or justify smaller assumed margins. The stable additive offset and two 1 ms resolution margins remain assumptions. Known-event gaps are much wider than the clock-width gate.

The earlier three PDF replication rejections remain rejected. No PDF was rendered in this campaign, and no new time-to-first-page-render or performance-repeatability claim follows. This fixture does not reproduce worker/render load, request overlap, exact renderer-consumed byte accounting, cold OS/font caches, compositor presentation, other days/machines/browsers, or production use.

The next proposed step is a **separately versioned integration diagnostic under the preserved PDF workload**, with a predeclared fixed budget and schedule. Compare the nested three-bracket and full fifteen-bracket analyses around the existing render milestone, retain all samples and failures, keep both margins and the 5 ms gate, and explicitly assess sampling overhead/perturbation. Preserve the original benchmark and rejected runs. That integration diagnostic has not been implemented or run, and no additional performance replication was started.

This bounded fixture campaign and its independent audit are complete. The broader PDF performance experiment remains open. Work stayed on `feat/corpus-text-pair`; protocol and results are recorded under Labs → PDF Rendering Lab 001 → Bounded clock observer. Publication verification is recorded separately in `docs/data/clock-observer-publication-2026-11-17.json` after uploading and downloading the archive.

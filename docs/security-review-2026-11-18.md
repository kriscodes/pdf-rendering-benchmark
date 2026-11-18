# Source security review — November 18, 2026

One medium-severity issue was confirmed by source inspection. This was a read-only review of first-party code at `59a073c`, with an independent reviewer and separate validation. The preserved source remains unchanged. Later commits recording experiment results do not change the affected code.

## Predictable shared audit output

The legacy `packages/runner/scripts/summarize_controlled_delivery.py` CLI defaults `--audit-json` to `/tmp/controlled-delivery-audit.json` (line 453). Both its successful and failed audit paths use `Path.write_text` (lines 469 and 475), which truncates the destination and follows an existing symlink.

On a shared machine that permits following a cross-owner symlink, another local user can create that predictable filename first and point it at a file writable by the benchmark user. Running the CLI without an explicit audit destination can then replace that file with audit JSON. An invalid input or an existing normal export is enough to reach the failure-path write. No remote exploit, code execution or privilege escalation was established. OS protected-symlink policies can block this specific path; their state was not tested. Classification: CWE-61/CWE-377, medium severity and medium confidence.

The current fixed-window campaign imports the auditor's `audit_report` function and does not use this CLI default. Its final-window exports require new destinations. The older published reproduction also explicitly selects a repository-local audit output.

For manual use of the legacy CLI, create a fresh private directory and provide every output destination explicitly:

```sh
mkdir -p results/raw
audit_directory="$(mktemp -d "$PWD/results/raw/summary-audit-XXXXXX")"
.venv/bin/python packages/runner/scripts/summarize_controlled_delivery.py \
  results/raw/controlled-delivery/run-VnOBcz/report.json \
  --output-prefix "$audit_directory/summary" \
  --audit-json "$audit_directory/audit.json"
```

This is a usage mitigation, not a source repair. After final experiment archival, a maintained successor should require a fresh explicit destination or create a unique private temporary file, use exclusive/no-follow output creation, and preserve existing files on both success and error paths. Regression tests should cover planted symlinks, pre-existing regular files and failures before normal export. Do not change the frozen auditor or its preservation hashes during the campaign.

## Other reviewed boundaries

- Both HTTP servers bind `127.0.0.1` and serve fixed in-memory assets. They restrict methods and reject normalized traversal aliases; no arbitrary filesystem-read route was found.
- External program calls use argument arrays. The corpus runner validates the expected PDF filenames, sizes, hashes and structure before loading them.
- No credible embedded credential/private-key candidate was found in tracked source, configuration, documentation, tests or publication metadata. This was not a live credential-validity check.
- The local experiment accepts a controlled synthetic corpus. Browser sandboxing, outbound restrictions, request limits and resource isolation need a separate review before accepting untrusted PDFs or public traffic. The current implementation is not a hosted rendering service.
- Archive tooling is intended for trusted local evidence and includes tracked files plus selected raw records. Review the manifest and audience before publishing; synthetic document content does not remove machine paths and environment details from reports.

## Scope and record

Managed review ID: `d4e335fd-ddf9-4483-89d0-f4287b16fa88`. Finding ID: `csf_6de8305de715e34375e15325`. The canonical report, threat model, finding JSON and manifest were successfully sealed by the security tool. The scan records the reviewed revision; new CI/lint/doc files are reviewed separately during implementation.

No application exploit tests, external probes, dependency advisory lookup or third-party source audit were performed. The absence of additional confirmed findings is not a guarantee that the project or its pinned dependencies are vulnerability-free. Source repair for the finding remains pending the experiment freeze; the documented safe invocation is available now.

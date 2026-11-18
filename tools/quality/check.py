#!/usr/bin/env python3
"""Read-only lint gate with exact, visible exceptions for frozen sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run_json(command: list[str]) -> dict | list:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode not in (0, 1):
        raise ValueError(f"Lint command failed ({result.returncode}): {result.stderr}")
    output = json.loads(result.stdout)
    if result.returncode and not output:
        raise ValueError(f"Lint failed without diagnostics: {result.stderr}")
    return output


def fingerprint(path: str, code: str, line: int, column: int) -> dict:
    source = (ROOT / path).resolve()
    return {
        "path": source.relative_to(ROOT).as_posix(),
        "code": code,
        "line": line,
        "column": column,
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    }


def compare_findings(actual: list[dict], baseline: list[dict]) -> tuple[list[dict], list[dict]]:
    """Do not allow a changed file, new diagnostic, or stale exception to pass."""
    def key(item: dict) -> str:
        return json.dumps(item, sort_keys=True)
    if len({key(item) for item in baseline}) != len(baseline):
        raise ValueError("Duplicate baseline entries")
    if len({key(item) for item in actual}) != len(actual):
        raise ValueError("Duplicate diagnostics")
    expected = {key(item): item for item in baseline}
    found = {key(item): item for item in actual}
    return ([found[item] for item in found.keys() - expected.keys()],
            [expected[item] for item in expected.keys() - found.keys()])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--biome", default="biome")
    parser.add_argument("--ruff", default="ruff")
    args = parser.parse_args()
    for executable, expected in ((args.biome, "Version: 2.6.8"), (args.ruff, "ruff 0.17.5")):
        version = subprocess.check_output([executable, "--version"], text=True).strip()
        if version != expected:
            raise ValueError(f"Expected {expected!r}, got {version!r}")
    biome = run_json([args.biome, "lint", "--config-path", str(ROOT / "biome.json"),
                      "--max-diagnostics=none", "--reporter=json", "."])
    if not isinstance(biome, dict) or biome["summary"]["diagnosticsNotPrinted"]:
        raise ValueError("Incomplete Biome output")
    summary = biome["summary"]
    if len(biome["diagnostics"]) != sum(summary[name] for name in ("errors", "warnings", "infos")):
        raise ValueError("Biome diagnostic counts disagree")
    actual = []
    for finding in biome["diagnostics"]:
        location = finding["location"]
        actual.append(fingerprint(location["path"], finding["category"],
                                  location["start"]["line"], location["start"]["column"]))
    ruff = run_json([args.ruff, "check", "--config", str(ROOT / "ruff.toml"),
                     "--no-cache", "--output-format=json", "packages", "tools/quality"])
    if not isinstance(ruff, list):
        raise ValueError("Invalid Ruff output")
    for finding in ruff:
        actual.append(fingerprint(finding["filename"], finding["code"],
                                  finding["location"]["row"], finding["location"]["column"]))
    document = json.loads((ROOT / "tools/quality/frozen-findings.json").read_text())
    if document["schemaVersion"] != 1:
        raise ValueError("Unknown lint baseline schema")
    baseline = document["findings"]
    new, stale = compare_findings(actual, baseline)
    for finding in baseline:
        print(f"DEFERRED frozen finding: {finding['path']}:{finding['line']}:"
              f"{finding['column']} {finding['code']}")
    for label, findings in (("NEW/CHANGED", new), ("STALE; REMOVE AFTER REVIEW", stale)):
        for finding in findings:
            print(f"{label}: {json.dumps(finding, sort_keys=True)}")
    if new or stale:
        raise SystemExit(1)
    print(f"Lint gate passed: no new findings; {len(baseline)} exact frozen findings remain.")


if __name__ == "__main__":
    main()

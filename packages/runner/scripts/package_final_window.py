"""Package one closing window's evidence without rewriting raw files."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LIMIT = 5 * 1024 * 1024


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window", type=int, choices=(1, 2, 3), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    directory = ROOT / "results/raw/final-windows" / f"window-{args.window}"
    if not (directory / "ledger.json").is_file():
        parser.error("The selected window has no execution ledger")
    ledger = json.loads((directory / "ledger.json").read_text())
    if ledger.get("status") in ("running", "claimed"):
        parser.error("Do not archive an active measurement")
    if ledger.get("cleanupVerified") is not True:
        parser.error("Process cleanup is unverified; do not archive potentially changing evidence")
    if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, text=True).strip():
        parser.error("Commit tracked changes before packaging the project")
    files = set(subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines())
    files.update(p.relative_to(ROOT).as_posix() for p in directory.rglob("*") if p.is_file())
    claim = Path(ledger["claimPath"]).resolve()
    files.add(claim.relative_to(ROOT).as_posix())
    for name in ("manifest.json", "text-100-linearized.pdf", "text-100-nonlinearized.pdf"):
        files.add("corpus/generated/pilot/" + name)
    contents = {name: (ROOT / name).read_bytes() for name in sorted(files)}
    manifest = {
        "schemaVersion": 1,
        "purpose": "one fixed window plus the committed project and original PDF pair",
        "window": args.window,
        "gitCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "files": {name: {"bytes": len(data), "sha256": digest(data)} for name, data in contents.items()},
        "priorEvidence": "Earlier raw evidence remains in the existing Lab 001 archives. Its local hashes are preserved in experiments/final-windows.json. Runtime binaries and installed dependencies are identified by that plan's hashes, not redistributed in this archive.",
    }
    contents["EVIDENCE-MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 18, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compresslevel=9)
    with zipfile.ZipFile(args.output) as archive:
        if set(archive.namelist()) != set(contents):
            raise ValueError("Archive entry set differs")
        for name, data in contents.items():
            if archive.read(name) != data:
                raise ValueError(f"Archive bytes differ: {name}")
    data = args.output.read_bytes()
    print(json.dumps({"path": str(args.output.resolve()), "bytes": len(data), "sha256": digest(data),
                      "manifestFiles": len(manifest["files"]), "underWorkspaceLimit": len(data) < LIMIT}, indent=2))
    return 0 if len(data) < LIMIT else 2


if __name__ == "__main__":
    raise SystemExit(main())

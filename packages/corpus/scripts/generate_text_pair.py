"""Generate the first PDF benchmark pair; this does not measure rendering speed.

Run from the repository root with:
    .venv/bin/python packages/corpus/scripts/generate_text_pair.py

Requires ReportLab in that Python environment and qpdf on PATH.
Outputs are regenerated in corpus/generated/pilot/. Never use this directory
for hand-authored documents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
import zlib
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "corpus" / "generated" / "pilot"
PAGE_COUNT = 100
ROWS_PER_PAGE = 40
COMMON_OPTIONS = [
    "--deterministic-id",
    "--object-streams=disable",
    "--stream-data=compress",
    "--recompress-flate",
    "--compression-level=6",
]


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run_qpdf(executable: str, *arguments: str) -> str:
    result = subprocess.run(
        [executable, *arguments],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    # qpdf uses a nonzero exit code for warnings too. Do not accept them silently.
    if result.returncode != 0:
        details = (result.stdout + "\n" + result.stderr).strip()
        raise RuntimeError(f"qpdf exited with {result.returncode}:\n{details}")
    return result.stdout.strip()


def create_source(path: Path) -> None:
    """Create synthetic, fixed-layout content without time-dependent metadata."""
    pdf = canvas.Canvas(
        str(path),
        pagesize=letter,
        pageCompression=1,
        invariant=1,
        pdfVersion=(1, 4),
    )
    pdf.setTitle("PDF rendering benchmark - text pilot v1")
    pdf.setAuthor("pdf-rendering-benchmark")
    pdf.setCreator("pdf-rendering-benchmark/text-pilot-v1")

    for page_number in range(1, PAGE_COUNT + 1):
        pdf.setFont("Helvetica-Bold", 17)
        pdf.drawString(54, 738, "PDF rendering benchmark")
        pdf.setFont("Helvetica", 10)
        pdf.drawString(54, 718, "Synthetic text-only pilot. No real personal data.")
        pdf.line(54, 704, 558, 704)

        pdf.setFont("Helvetica", 10)
        for row in range(1, ROWS_PER_PAGE + 1):
            record_id = (page_number - 1) * ROWS_PER_PAGE + row
            text = (
                f"Record {record_id:05d} | Page {page_number:03d} | "
                "Synthetic content for document-loading tests."
            )
            pdf.drawString(54, 681 - (row - 1) * 14, text)

        pdf.setFont("Helvetica", 9)
        pdf.drawString(54, 42, "Profile: text-100-v1 | US Letter | 40 rows per page")
        pdf.drawRightString(558, 42, f"{page_number} / {PAGE_COUNT}")
        pdf.showPage()

    pdf.save()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir", type=Path, default=OUTPUT,
        help="Generated files directory (default: corpus/generated/pilot).",
    )
    output = parser.parse_args().output_dir.resolve()
    qpdf = shutil.which("qpdf")
    if qpdf is None:
        raise RuntimeError("qpdf was not found on PATH. Install it before running.")

    output.mkdir(parents=True, exist_ok=True)
    documents: list[dict[str, object]] = []

    # Both variants are written from the SAME source with the SAME common flags.
    # Only the linearized variant receives --linearize.
    with TemporaryDirectory(prefix=".build-", dir=output) as temporary:
        working = Path(temporary)
        source = working / "source.pdf"
        create_source(source)
        source_hash = sha256(source)

        for linearized in (False, True):
            suffix = "linearized" if linearized else "nonlinearized"
            filename = f"text-100-{suffix}.pdf"
            target = working / filename
            options = [*COMMON_OPTIONS]
            if linearized:
                options.append("--linearize")
            run_qpdf(qpdf, str(source), *options, str(target))

            check_output = run_qpdf(qpdf, "--check", str(target))
            expected_status = (
                "File is linearized" if linearized else "File is not linearized"
            )
            if expected_status not in check_output:
                raise RuntimeError(
                    f"Could not confirm linearization status for {filename}:\n"
                    f"{check_output}"
                )
            pages = int(run_qpdf(qpdf, "--show-npages", str(target)))
            if pages != PAGE_COUNT:
                raise RuntimeError(f"{filename}: expected {PAGE_COUNT} pages, got {pages}.")
            if linearized:
                run_qpdf(qpdf, "--check-linearization", str(target))

            documents.append({
                "id": f"text-100-{suffix}",
                "file": filename,
                "pageCount": pages,
                "linearized": linearized,
                "bytes": target.stat().st_size,
                "sha256": sha256(target),
                "qpdfCheckPassed": True,
                "qpdfLinearizationCheckPassed": True if linearized else None,
            })

        # Publish outputs only after BOTH variants have passed the checks.
        for document in documents:
            filename = str(document["file"])
            (working / filename).replace(output / filename)

    manifest = {
        "schemaVersion": 1,
        "profileId": "text-100-v1",
        "purpose": "generator-smoke-test-not-performance-results",
        "pageCount": PAGE_COUNT,
        "rowsPerPage": ROWS_PER_PAGE,
        "pageSizePoints": list(letter),
        "fontPolicy": "standard Helvetica; fonts are not embedded",
        "sourceSha256": source_hash,
        "generatorSha256": sha256(Path(__file__)),
        "toolVersions": {
            "python": platform.python_version(),
            "reportlab": version("reportlab"),
            "qpdf": run_qpdf(qpdf, "--version").splitlines()[0],
            "zlib": zlib.ZLIB_RUNTIME_VERSION,
        },
        "qpdfCommonOptions": COMMON_OPTIONS,
        "visualEquivalence": "not-automatically-checked",
        "documents": documents,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    for document in documents:
        print(f"PASS: {document['file']} | {document['pageCount']} pages | {document['bytes']} bytes")
        print(f"  SHA-256: {document['sha256']}")
    print(f"Manifest: {manifest_path}")
    print("Next: check repeated-generation hashes and inspect the pages visually.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

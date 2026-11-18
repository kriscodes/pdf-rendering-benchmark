"""Validate the text pilot corpus; no browser or performance measurements.

The existing corpus is read only. Regeneration and rasterization use temporary
directories; a separate report and representative PNGs retain validation evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory, mkdtemp

from PIL import Image, ImageChops

from generate_text_pair import COMMON_OPTIONS, OUTPUT, PAGE_COUNT, ROOT, sha256

GENERATOR = Path(__file__).with_name("generate_text_pair.py")
DPI = 144
PIXEL_SIZE = (1224, 1584)
SAMPLE_PAGES = (1, 50, 100)
VARIANTS = ("nonlinearized", "linearized")
CONTROLS = {
    "schemaVersion": 1,
    "profileId": "text-100-v1",
    "purpose": "generator-smoke-test-not-performance-results",
    "pageCount": 100,
    "rowsPerPage": 40,
    "pageSizePoints": [612.0, 792.0],
    "fontPolicy": "standard Helvetica; fonts are not embedded",
    "qpdfCommonOptions": COMMON_OPTIONS,
    "visualEquivalence": "not-automatically-checked",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def command(arguments: list[str], *, timeout: int = 60) -> str:
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    # Keep repeated environment diagnostics from overwhelming console/report output.
    diagnostics = (result.stdout + "\n" + result.stderr).strip()
    if len(diagnostics) > 4000:
        diagnostics = diagnostics[:4000] + "\n[diagnostics truncated]"
    require(result.returncode == 0,
            f"Command failed ({result.returncode}): {arguments}\n"
            f"{diagnostics}")
    # Rendering warnings (e.g. missing font data) invalidate this strict check.
    require(not result.stderr.strip(), f"Command diagnostics: {arguments}\n{diagnostics}")
    return result.stdout.strip()


def tool_version(executable: str, flag: str) -> str:
    result = subprocess.run([executable, flag], capture_output=True, text=True, timeout=60)
    require(result.returncode == 0, f"Cannot query version: {executable}")
    return (result.stdout + result.stderr).strip().splitlines()[0]


def validate_manifest(directory: Path) -> dict:
    """Validate identities before passing any artifact to external tools."""
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    require(isinstance(manifest, dict), "Manifest must be an object")
    for key, expected in CONTROLS.items():
        require(manifest.get(key) == expected, f"Manifest control differs: {key}")
    for key in ("sourceSha256", "generatorSha256"):
        require(isinstance(manifest.get(key), str)
                and re.fullmatch(r"[0-9a-f]{64}", manifest[key]) is not None,
                f"Invalid {key}")
    versions = manifest.get("toolVersions")
    require(isinstance(versions, dict), "Missing toolVersions")
    for key in ("python", "reportlab", "qpdf", "zlib"):
        require(isinstance(versions.get(key), str) and bool(versions[key]),
                f"Missing tool version: {key}")
    documents = manifest.get("documents")
    require(isinstance(documents, list) and len(documents) == 2,
            "Expected exactly two documents")
    for document, variant in zip(documents, VARIANTS):
        require(isinstance(document, dict), "Document must be an object")
        linearized = variant == "linearized"
        identifier = f"text-100-{variant}"
        expected = {
            "id": identifier, "file": f"{identifier}.pdf", "pageCount": PAGE_COUNT,
            "linearized": linearized, "qpdfCheckPassed": True,
            "qpdfLinearizationCheckPassed": True if linearized else None,
        }
        for key, value in expected.items():
            require(document.get(key) == value, f"{identifier}: invalid {key}")
        path = directory / document["file"]
        require(path.is_file() and not path.is_symlink(), f"Missing regular file: {path}")
        require(path.stat().st_size == document.get("bytes"), f"{path.name}: size mismatch")
        require(sha256(path) == document.get("sha256"), f"{path.name}: SHA-256 mismatch")
    return manifest


def check_structure(directory: Path, manifest: dict, qpdf: str) -> None:
    for document in manifest["documents"]:
        path = str(directory / document["file"])
        checked = command([qpdf, "--check", path])
        expected = "File is linearized" if document["linearized"] else "File is not linearized"
        require(expected in checked, f"{path}: linearization status mismatch")
        require(command([qpdf, "--show-npages", path]) == str(PAGE_COUNT),
                f"{path}: page count mismatch")
        if document["linearized"]:
            command([qpdf, "--check-linearization", path])


def compare_generation(original: dict, first: dict, second: dict) -> dict:
    require(first == second, "Independent generation manifests differ")
    require(first["generatorSha256"] == sha256(GENERATOR), "Fresh generator digest mismatch")
    for key in (*CONTROLS, "sourceSha256", "documents"):
        require(original[key] == first[key], f"Existing corpus differs from regeneration: {key}")
    # Older provenance is retained, not silently rewritten or conflated with this run.
    differences = {
        key: {"existing": original[key], "current": first[key]}
        for key in ("generatorSha256", "toolVersions") if original[key] != first[key]
    }
    return {
        "independentRuns": 2, "identicalManifests": True,
        "existingSourceAndDocumentsMatch": True, "provenanceDifferences": differences,
        "freshManifest": first,
    }


def page_images(directory: Path, expected_count: int = PAGE_COUNT) -> list[Path]:
    images: dict[int, Path] = {}
    for path in directory.glob("page-*.png"):
        match = re.fullmatch(r"page-(\d+)\.png", path.name)
        require(match is not None, f"Unexpected page image: {path.name}")
        number = int(match[1])
        require(number not in images, f"Duplicate page image: {number}")
        images[number] = path
    require(set(images) == set(range(1, expected_count + 1)),
            f"Incomplete or unexpected page set in {directory}: {sorted(images)}")
    return [images[number] for number in range(1, expected_count + 1)]


def compare_pixels(left: Path, right: Path, expected_size: tuple[int, int] = PIXEL_SIZE) -> dict:
    with Image.open(left) as left_image, Image.open(right) as right_image:
        a, b = left_image.convert("RGB"), right_image.convert("RGB")
    require(a.size == b.size == expected_size, f"Unexpected raster dimensions: {left.name}")
    require(any(low != high for low, high in a.getextrema()), f"Blank raster: {left}")
    require(any(low != high for low, high in b.getextrema()), f"Blank raster: {right}")
    difference = ImageChops.difference(a, b).getbbox()
    require(difference is None, f"Pixel mismatch: {left.name}; bounding box {difference}")
    return {
        "width": a.width, "height": a.height, "differentPixels": 0,
        "rgbSha256": hashlib.sha256(a.tobytes()).hexdigest(),
    }


def verify(corpus: Path, evidence: Path, report: dict) -> None:
    executables = {}
    for name in ("qpdf", "pdftoppm"):
        executable = shutil.which(name)
        require(executable is not None, f"Missing required executable on PATH: {name}")
        executables[name] = executable
    report["environment"] = {
        "platform": platform.platform(), "machine": platform.machine(),
        "python": platform.python_version(), "pillow": version("pillow"),
        "qpdf": tool_version(executables["qpdf"], "--version"),
        "pdftoppm": tool_version(executables["pdftoppm"], "-v"),
        "executables": executables,
        "fontEnvironment": {
            key: os.environ.get(key)
            for key in ("FONTCONFIG_FILE", "FONTCONFIG_PATH", "XDG_CACHE_HOME")
        },
    }
    config = os.environ.get("FONTCONFIG_FILE")
    if config and Path(config).is_file():
        report["environment"]["fontConfigSha256"] = sha256(Path(config))
    original = validate_manifest(corpus)
    original_manifest_hash = sha256(corpus / "manifest.json")
    report["existingManifest"] = original
    report["existingManifestSha256"] = original_manifest_hash
    check_structure(corpus, original, executables["qpdf"])
    report["structure"] = {"status": "passed", "pagesPerDocument": PAGE_COUNT}
    print("PASS: existing manifest, file hashes and qpdf structure", flush=True)

    with TemporaryDirectory(prefix="text-pair-verification-") as temporary:
        working = Path(temporary)
        generated = []
        for run in (1, 2):
            output = working / f"run-{run}"
            command([sys.executable, str(GENERATOR), "--output-dir", str(output)], timeout=300)
            generated.append(validate_manifest(output))
        report["repeatability"] = compare_generation(original, *generated)
        print("PASS: two independent generations match each other and existing PDFs", flush=True)

        renderings = []
        report["rasterComparison"] = {
            "status": "running", "renderer": "Poppler pdftoppm", "dpi": DPI,
            "options": ["-png", "-r", str(DPI), "-aa", "yes", "-aaVector", "yes"],
            "comparison": "exact decoded RGB pixels", "pages": [],
        }
        for variant in VARIANTS:
            directory = working / variant
            directory.mkdir()
            command([
                executables["pdftoppm"], *report["rasterComparison"]["options"],
                str(corpus / f"text-100-{variant}.pdf"), str(directory / "page"),
            ], timeout=300)
            renderings.append(page_images(directory))
            print(f"Rendered: {variant}, {PAGE_COUNT} pages at {DPI} dpi", flush=True)
        samples = evidence / "samples"
        samples.mkdir()
        for page, (left, right) in enumerate(zip(*renderings), 1):
            try:
                comparison = {"page": page, **compare_pixels(left, right)}
            except (OSError, ValueError):
                failures = evidence / "failures"
                failures.mkdir(exist_ok=True)
                for variant, source in zip(VARIANTS, (left, right)):
                    shutil.copyfile(source, failures / f"{variant}-page-{page:03d}.png")
                report["rasterComparison"]["failedPage"] = page
                raise
            report["rasterComparison"]["pages"].append(comparison)
            if page in SAMPLE_PAGES:
                for variant, source in zip(VARIANTS, (left, right)):
                    shutil.copyfile(source, samples / f"{variant}-page-{page:03d}.png")
        report["rasterComparison"].update(status="passed", comparedPages=PAGE_COUNT)
    require(validate_manifest(corpus) == original
            and sha256(corpus / "manifest.json") == original_manifest_hash,
            "Existing corpus changed during verification")
    report["existingCorpusUnchanged"] = True
    report["manualInspection"] = {
        "status": "pending", "samplePages": list(SAMPLE_PAGES), "directory": "samples",
        "instructions": "Inspect samples for clipping, legibility, layout and page numbering; "
                        "record the review separately. Automated equality is not visual review.",
    }
    print(f"PASS: {PAGE_COUNT} page pairs have identical, nonblank RGB pixels", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=OUTPUT)
    parser.add_argument("--output-dir", type=Path,
                        help="New or empty evidence directory; default: unique results/raw/corpus-validation run.")
    arguments = parser.parse_args()
    corpus = arguments.corpus_dir.resolve()
    if arguments.output_dir:
        evidence = arguments.output_dir.resolve()
        require(not evidence.exists() or not any(evidence.iterdir()),
                f"Evidence directory must be empty: {evidence}")
        evidence.mkdir(parents=True, exist_ok=True)
    else:
        parent = ROOT / "results" / "raw" / "corpus-validation"
        parent.mkdir(parents=True, exist_ok=True)
        evidence = Path(mkdtemp(prefix="run-", dir=parent))
    report = {
        "schemaVersion": 1, "purpose": "corpus-validation-not-performance-results",
        "status": "running", "startedAt": datetime.now(timezone.utc).isoformat(),
        "corpusDirectory": str(corpus), "verifierSha256": sha256(Path(__file__)),
        "limitations": [
            "Repeatability is checked only in the recorded local toolchain.",
            "Pixel equality applies only to this renderer, DPI and local font environment; "
            "Helvetica is not embedded.",
            "No browser loading/render timing, network delivery or cache behavior is measured.",
        ],
    }
    try:
        verify(corpus, evidence, report)
        report["status"] = "passed"
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        report.update(status="failed", error=str(error))
        raster = report.get("rasterComparison")
        if raster is not None and raster["status"] == "running":
            raster["status"] = "failed"
        print(f"FAIL: {error}", file=sys.stderr)
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    target = evidence / "report.json"
    target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Validation report: {target}")
    print("This is corpus validation, not browser performance evidence.")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)

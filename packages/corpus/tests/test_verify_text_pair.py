"""Regression tests for corpus checks, independent of qpdf and Poppler."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image
from PIL.PngImagePlugin import PngInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import verify_text_pair as verifier


class CorpusFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.manifest = {
            "schemaVersion": 1,
            "profileId": "text-100-v1",
            "purpose": "generator-smoke-test-not-performance-results",
            "pageCount": 100,
            "rowsPerPage": 40,
            "pageSizePoints": [612.0, 792.0],
            "fontPolicy": "standard Helvetica; fonts are not embedded",
            "qpdfCommonOptions": [
                "--deterministic-id", "--object-streams=disable",
                "--stream-data=compress", "--recompress-flate",
                "--compression-level=6",
            ],
            "visualEquivalence": "not-automatically-checked",
            "sourceSha256": hashlib.sha256(b"synthetic source").hexdigest(),
            "generatorSha256": verifier.sha256(verifier.GENERATOR),
            "toolVersions": {
                "python": "3.13.18", "reportlab": "5.1.0",
                "qpdf": "qpdf version 12.4.2", "zlib": "1.2.12",
            },
            "documents": [],
        }
        for variant, linearized in (("nonlinearized", False), ("linearized", True)):
            identifier = f"text-100-{variant}"
            path = self.directory / f"{identifier}.pdf"
            # Byte stand-ins exercise integrity checks; structural PDF checks
            # require the separate integration run with qpdf.
            contents = f"%PDF-1.4\nsynthetic {variant} fixture\n%%EOF\n".encode()
            path.write_bytes(contents)
            self.manifest["documents"].append({
                "id": identifier, "file": path.name, "pageCount": 100,
                "linearized": linearized, "bytes": len(contents),
                "sha256": hashlib.sha256(contents).hexdigest(),
                "qpdfCheckPassed": True,
                "qpdfLinearizationCheckPassed": True if linearized else None,
            })
        self.write_manifest()

    def write_manifest(self) -> None:
        (self.directory / "manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )


class ManifestValidationTests(CorpusFixture):
    def test_valid_manifest_and_artifact_identities(self) -> None:
        self.assertEqual(verifier.validate_manifest(self.directory), self.manifest)

    def test_rejects_modified_bytes_with_unchanged_size(self) -> None:
        path = self.directory / self.manifest["documents"][0]["file"]
        contents = path.read_bytes()
        path.write_bytes(b"!" + contents[1:])
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            verifier.validate_manifest(self.directory)

    def test_rejects_changed_size(self) -> None:
        path = self.directory / self.manifest["documents"][0]["file"]
        path.write_bytes(path.read_bytes() + b"extra")
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            verifier.validate_manifest(self.directory)

    def test_rejects_missing_variant(self) -> None:
        self.manifest["documents"].pop()
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "exactly two documents"):
            verifier.validate_manifest(self.directory)

    def test_rejects_duplicate_variant(self) -> None:
        self.manifest["documents"][1] = copy.deepcopy(self.manifest["documents"][0])
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "invalid id"):
            verifier.validate_manifest(self.directory)

    def test_rejects_changed_profile_controls(self) -> None:
        baseline = copy.deepcopy(self.manifest)
        mutations = {
            "profileId": "text-100-v2", "pageCount": 99, "rowsPerPage": 39,
            "pageSizePoints": [595.0, 842.0],
            "qpdfCommonOptions": ["--linearize"],
            "purpose": "performance-results",
        }
        for key, replacement in mutations.items():
            with self.subTest(control=key):
                self.manifest = copy.deepcopy(baseline)
                self.manifest[key] = replacement
                self.write_manifest()
                with self.assertRaisesRegex(ValueError, f"Manifest control differs: {key}"):
                    verifier.validate_manifest(self.directory)


class GenerationComparisonTests(CorpusFixture):
    def test_rejects_disagreement_between_independent_runs(self) -> None:
        second = copy.deepcopy(self.manifest)
        second["documents"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Independent generation manifests differ"):
            verifier.compare_generation(self.manifest, self.manifest, second)

    def test_rejects_different_existing_source_or_document_hash(self) -> None:
        for changed_part in ("sourceSha256", "documents"):
            with self.subTest(changed_part=changed_part):
                original = copy.deepcopy(self.manifest)
                if changed_part == "sourceSha256":
                    original[changed_part] = "0" * 64
                else:
                    original["documents"][0]["sha256"] = "0" * 64
                with self.assertRaisesRegex(ValueError, f"regeneration: {changed_part}"):
                    verifier.compare_generation(original, self.manifest, self.manifest)

    def test_rejects_stale_fresh_generator_digest(self) -> None:
        fresh = copy.deepcopy(self.manifest)
        fresh["generatorSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Fresh generator digest mismatch"):
            verifier.compare_generation(self.manifest, fresh, copy.deepcopy(fresh))

    def test_reports_provenance_changes_without_rewriting_existing_manifest(self) -> None:
        original = copy.deepcopy(self.manifest)
        original["generatorSha256"] = "0" * 64
        original["toolVersions"]["python"] = "3.12.0"
        snapshot = copy.deepcopy(original)
        result = verifier.compare_generation(original, self.manifest, self.manifest)
        self.assertEqual(set(result["provenanceDifferences"]), {"generatorSha256", "toolVersions"})
        self.assertTrue(result["existingSourceAndDocumentsMatch"])
        self.assertEqual(original, snapshot)


class RasterValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def test_rejects_missing_or_extra_page(self) -> None:
        for page in range(1, 100):
            (self.directory / f"page-{page:03d}.png").touch()
        with self.assertRaisesRegex(ValueError, "Incomplete or unexpected page set"):
            verifier.page_images(self.directory)
        (self.directory / "page-100.png").touch()
        self.assertEqual(len(verifier.page_images(self.directory)), 100)
        (self.directory / "page-101.png").touch()
        with self.assertRaisesRegex(ValueError, "Incomplete or unexpected page set"):
            verifier.page_images(self.directory)

    def test_rejects_duplicate_number_with_different_padding(self) -> None:
        (self.directory / "page-001.png").touch()
        (self.directory / "page-1.png").touch()
        with self.assertRaisesRegex(ValueError, "Duplicate page image"):
            verifier.page_images(self.directory, expected_count=1)

    def test_orders_pages_numerically(self) -> None:
        for page in range(10, 0, -1):
            (self.directory / f"page-{page}.png").touch()
        self.assertEqual(
            [path.name for path in verifier.page_images(self.directory, expected_count=10)],
            [f"page-{page}.png" for page in range(1, 11)],
        )

    def image_pair(self, size: tuple[int, int] = (8, 8)) -> tuple[Path, Path]:
        image = Image.new("RGB", size, "white")
        image.putpixel((1, 1), (0, 0, 0))
        left, right = self.directory / "left.png", self.directory / "right.png"
        image.save(left)
        image.save(right)
        return left, right

    def test_rejects_blank_raster_in_either_variant(self) -> None:
        for blank_side in (0, 1):
            with self.subTest(blank_side=blank_side):
                paths = self.image_pair()
                Image.new("RGB", (8, 8), "white").save(paths[blank_side])
                with self.assertRaisesRegex(ValueError, "Blank raster"):
                    verifier.compare_pixels(*paths, expected_size=(8, 8))

    def test_rejects_matching_but_wrong_dimensions(self) -> None:
        paths = self.image_pair(size=(7, 8))
        with self.assertRaisesRegex(ValueError, "Unexpected raster dimensions"):
            verifier.compare_pixels(*paths, expected_size=(8, 8))

    def test_rejects_single_pixel_channel_difference(self) -> None:
        left, right = self.image_pair()
        with Image.open(right) as image:
            changed = image.copy()
        changed.putpixel((2, 3), (254, 255, 255))
        changed.save(right)
        with self.assertRaisesRegex(ValueError, "Pixel mismatch"):
            verifier.compare_pixels(left, right, expected_size=(8, 8))

    def test_accepts_identical_rgb_with_different_png_metadata(self) -> None:
        left, right = self.image_pair()
        metadata = PngInfo()
        metadata.add_text("Description", "Encoding metadata is not page content")
        with Image.open(right) as image:
            image.save(right, pnginfo=metadata)
        self.assertNotEqual(left.read_bytes(), right.read_bytes())
        comparison = verifier.compare_pixels(left, right, expected_size=(8, 8))
        self.assertEqual(comparison["differentPixels"], 0)
        with Image.open(left) as image:
            self.assertEqual(
                comparison["rgbSha256"], hashlib.sha256(image.convert("RGB").tobytes()).hexdigest()
            )


class CommandFailureTests(unittest.TestCase):
    def test_rejects_nonzero_exit(self) -> None:
        result = subprocess.CompletedProcess(["renderer"], 2, "render failed", "")
        with patch.object(verifier.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(ValueError, r"Command failed \(2\).*\nrender failed"):
                verifier.command(["renderer"])

    def test_rejects_stderr_even_when_exit_is_zero(self) -> None:
        result = subprocess.CompletedProcess(["renderer"], 0, "", "Fontconfig warning")
        with patch.object(verifier.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(ValueError, "Command diagnostics"):
                verifier.command(["renderer"])

    def test_bounds_repetitive_diagnostics(self) -> None:
        result = subprocess.CompletedProcess(
            ["renderer"], 0, "", "Fontconfig warning\n" * 100000
        )
        with patch.object(verifier.subprocess, "run", return_value=result):
            with self.assertRaises(ValueError) as raised:
                verifier.command(["renderer"])
        message = str(raised.exception)
        self.assertIn("Fontconfig warning", message)
        self.assertIn("[diagnostics truncated]", message)
        self.assertLess(len(message), 4500)

    def test_propagates_timeout(self) -> None:
        timeout = subprocess.TimeoutExpired(["renderer"], 7)
        with patch.object(verifier.subprocess, "run", side_effect=timeout) as run:
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                verifier.command(["renderer"], timeout=7)
        self.assertIs(raised.exception, timeout)
        run.assert_called_once_with(
            ["renderer"], capture_output=True, text=True, timeout=7
        )


class FailureReportTests(unittest.TestCase):
    def test_main_records_failed_raster_stage_and_returns_failure(self) -> None:
        def fail_during_rasterization(corpus: Path, evidence: Path, report: dict) -> None:
            report["structure"] = {"status": "passed"}
            report["rasterComparison"] = {"status": "running", "pages": []}
            raise ValueError("Renderer diagnostics prevent validation")

        with TemporaryDirectory() as temporary:
            output = Path(temporary) / "evidence"
            arguments = ["verify_text_pair.py", "--output-dir", str(output)]
            with patch.object(sys, "argv", arguments), \
                    patch.object(verifier, "verify", side_effect=fail_during_rasterization), \
                    redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                result = verifier.main()
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(result, 1)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["rasterComparison"]["status"], "failed")
        self.assertEqual(report["structure"]["status"], "passed")
        self.assertEqual(report["error"], "Renderer diagnostics prevent validation")
        self.assertEqual(report["purpose"], "corpus-validation-not-performance-results")


if __name__ == "__main__":
    unittest.main()

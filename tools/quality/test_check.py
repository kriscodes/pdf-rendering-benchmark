"""The frozen exception list must not hide new defects or become permanent."""

import unittest

from check import compare_findings


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.finding = {"path": "source.ts", "code": "lint/correctness/noUnsafeFinally",
                        "line": 4, "column": 2, "sourceSha256": "original"}

    def test_only_exact_unchanged_finding_passes(self):
        self.assertEqual(compare_findings([self.finding], [self.finding]), ([], []))
        for field, replacement in (("line", 5), ("sourceSha256", "modified"),
                                   ("code", "another-rule"), ("path", "other.ts")):
            with self.subTest(field=field):
                changed = {**self.finding, field: replacement}
                self.assertEqual(compare_findings([changed], [self.finding]),
                                 ([changed], [self.finding]))

    def test_new_finding_and_disappeared_finding_are_not_silenced(self):
        self.assertEqual(compare_findings([self.finding], []), ([self.finding], []))
        self.assertEqual(compare_findings([], [self.finding]), ([], [self.finding]))

    def test_duplicates_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "Duplicate baseline"):
            compare_findings([], [self.finding, self.finding])
        with self.assertRaisesRegex(ValueError, "Duplicate diagnostics"):
            compare_findings([self.finding, self.finding], [])


if __name__ == "__main__":
    unittest.main()

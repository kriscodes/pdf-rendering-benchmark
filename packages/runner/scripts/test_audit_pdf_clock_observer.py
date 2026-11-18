"""Selection and independent-clock regression checks, without browser execution."""
import unittest

from audit_pdf_clock_observer import METRICS, POINTS, clock_analysis, csv_text, guard_evidence, paired_rows, schedule


def complete_rows():
    return [{**entry, "attempted": True, "operationStatus": "passed", "operationValidated": True,
             "sessionValidated": True, "referenceStatus": "failed", "candidateStatus": "failed",
             **{metric: 20 if entry["arm"] == "fifteen" else 10 for metric in METRICS}} for entry in schedule()]


def clock_trial(width=.0005):
    return {"bracketsPerPoint": 5, "render": {"firstPageRenderedAtMs": 0}, "verification": {"verificationStartedAtMs": 1},
            "bursts": [{"point": point, "samples": [{"beforeSeconds": (p * 5 + i) * .02,
                "pageNowMs": (p * 5 + i) * 20, "afterSeconds": (p * 5 + i) * .02 + width}
                for i in range(5)]} for p, point in enumerate(POINTS)]}


class ObserverAuditBoundaryTests(unittest.TestCase):
    def test_clock_rejections_do_not_select_perturbation_pairs(self):
        pairs = paired_rows(complete_rows())
        self.assertEqual(len(pairs), 48)
        self.assertTrue(all(pair["comparable"] for pair in pairs))
        self.assertTrue(all(not pair["threeClockPassed"] and not pair["fifteenCandidateClockPassed"] for pair in pairs))
        self.assertTrue(all(pair["firstPageRenderMsDifference"] == 10 for pair in pairs))

    def test_missing_arm_and_unvalidated_post_guard_exclude_without_partial_difference(self):
        rows = complete_rows()
        rows[0]["attempted"] = False; rows[0]["operationValidated"] = False
        for row in rows:
            if row["session"] == 2: row["sessionValidated"] = False
        pairs = paired_rows(rows)
        self.assertEqual(sum(pair["comparable"] for pair in pairs), 31)
        self.assertIn("unattempted", pairs[0]["exclusionReason"])
        self.assertNotIn("firstPageRenderMsDifference", pairs[0])
        self.assertTrue(all("pre/post guards" in pair["exclusionReason"] for pair in pairs if pair["session"] == 2))
        guard = guard_evidence({"session": 1, "controls": [{"stage": "before"}]}, {})
        self.assertFalse(guard["validated"])
        self.assertEqual(guard["stages"][1]["reason"], "not recorded")

    def test_fixed_order_has_balanced_arm_orders_in_every_session_condition(self):
        rows = schedule()
        self.assertEqual(len(rows), 96)
        self.assertEqual(len({row["id"] for row in rows}), 96)
        self.assertEqual(sum(row["bracketsPerPoint"] * 3 for row in rows), 864)
        for session in (1, 2, 3):
            for condition in {row["condition"] for row in rows}:
                first = [row for row in rows if row["session"] == session and row["condition"] == condition and row["armPosition"] == 1]
                self.assertEqual([row["arm"] for row in first].count("three"), 2)
                self.assertEqual([row["arm"] for row in first].count("fifteen"), 2)

    def test_strict_five_ms_gate_and_mapped_verification_boundary(self):
        exact = clock_analysis(clock_trial(.001))
        self.assertEqual(exact["reference"]["widthMs"], 5)
        self.assertEqual(exact["reference"]["status"], "passed")
        self.assertAlmostEqual(exact["reference"]["verificationBoundary"]["lowerSeconds"] - exact["reference"]["boundary"]["lowerSeconds"], .001)
        above = clock_analysis(clock_trial(.001001))
        self.assertEqual(above["reference"]["reason"], "width")
        self.assertEqual(above["candidate"]["reason"], "width")

    def test_nonfirst_inconsistent_sample_cannot_be_discarded(self):
        trial = clock_trial(); trial["bursts"][0]["samples"][1]["pageNowMs"] += 10
        result = clock_analysis(trial)
        self.assertEqual(result["reference"]["status"], "passed")
        self.assertEqual(result["candidate"]["reason"], "non-overlap")
        self.assertEqual(result["candidate"]["sampleCount"], 15)
        self.assertIsNone(result["candidate"]["boundary"])

    def test_three_arm_has_no_invented_candidate_and_incomplete_bursts_fail(self):
        trial = clock_trial(); trial["bracketsPerPoint"] = 1
        for burst in trial["bursts"]: burst["samples"] = burst["samples"][:1]
        self.assertIsNone(clock_analysis(trial)["candidate"])
        trial["bursts"][1]["samples"] = []
        self.assertEqual(clock_analysis(trial)["reference"]["reason"], "invalid-input")

    def test_csv_retains_missing_values_and_uses_lf(self):
        text = csv_text([{"id": "complete", "width": 4.5}, {"id": "unattempted"}])
        self.assertEqual(text, "id,width\ncomplete,4.5\nunattempted,\n")


if __name__ == "__main__":
    unittest.main()

import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.collect_exams import write_exam_snapshot
from scripts.exams_guard import guard_exams, validate_candidate


def make_payload(count: int = 40, generated_at: str = "2026-11-09T12:00:00+08:00", major_raw: str = "计算机"):
    exams = [
        {
            "id": f"exam-{i}",
            "title": f"招考简章 {i}",
            "schedule": {"reg_end": "2026-11-20", "reg_mode": "window"},
            "positions": [{"row_id": f"pos-{i}", "major_raw": major_raw}],
        }
        for i in range(count)
    ]
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "exams": exams,
    }


class ExamsGuardTests(unittest.TestCase):
    def test_valid_candidate_passes_and_is_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            cand = make_payload(50, generated_at="2026-11-09T14:00:00+08:00")
            (pub / "exams.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")

            base = make_payload(45, generated_at="2026-11-08T14:00:00+08:00")
            base_bytes = json.dumps(base, ensure_ascii=False).encode("utf-8")

            with patch("scripts.exams_guard.fetch_baseline_exams", return_value=(base_bytes, base)):
                code = guard_exams(pub, "https://sites-project.job-radar.workers.dev")

            self.assertEqual(code, 0)
            saved = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(len(saved["exams"]), 50)
            self.assertEqual(saved["generated_at"], "2026-11-09T14:00:00+08:00")

    def test_sharp_drop_replaced_by_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            cand = make_payload(40, generated_at="2026-11-09T14:00:00+08:00")
            (pub / "exams.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")

            base = make_payload(100, generated_at="2026-11-08T14:00:00+08:00")
            base_bytes = json.dumps(base, ensure_ascii=False).encode("utf-8")

            with patch("scripts.exams_guard.fetch_baseline_exams", return_value=(base_bytes, base)):
                code = guard_exams(pub, "https://sites-project.job-radar.workers.dev")

            self.assertEqual(code, 0)
            saved = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(len(saved["exams"]), 100)

    def test_invalid_candidate_without_baseline_exits_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            cand = make_payload(10)
            (pub / "exams.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")

            with patch("scripts.exams_guard.fetch_baseline_exams", return_value=(None, None)):
                code = guard_exams(pub, "https://sites-project.job-radar.workers.dev")

            self.assertEqual(code, 1)

    def test_require_fresh_replaces_older_candidate_with_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            cand = make_payload(50, generated_at="2026-11-07T10:00:00+08:00")
            (pub / "exams.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")

            base = make_payload(50, generated_at="2026-11-09T10:00:00+08:00")
            base_bytes = json.dumps(base, ensure_ascii=False).encode("utf-8")

            with patch("scripts.exams_guard.fetch_baseline_exams", return_value=(base_bytes, base)):
                code = guard_exams(pub, "https://sites-project.job-radar.workers.dev", require_fresh=True)

            self.assertEqual(code, 0)
            saved = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["generated_at"], "2026-11-09T10:00:00+08:00")

    def test_baseline_replacement_downloads_and_verifies_exam_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            cand = make_payload(10, generated_at="2026-11-09T14:00:00+08:00")
            (pub / "exams.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")

            shard_raw = json.dumps(
                {"schema_version": 1, "exams": {"ex-0": {"body": "正文"}}},
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            shard_hash = hashlib.sha256(shard_raw).hexdigest()[:20]
            shard_rel = f"/exam-assets/detail-ex-{shard_hash}.json"

            base = make_payload(45, generated_at="2026-11-09T10:00:00+08:00")
            base["detail_shards"] = {"ex": shard_rel}
            base_bytes = json.dumps(base, ensure_ascii=False).encode("utf-8")

            class FakeResp(io.BytesIO):
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    self.close()

            with (
                patch("scripts.exams_guard.fetch_baseline_exams", return_value=(base_bytes, base)),
                patch("scripts.exams_guard.urlopen", return_value=FakeResp(shard_raw)),
            ):
                code = guard_exams(pub, "https://sites-project.job-radar.workers.dev")

            self.assertEqual(code, 0)
            self.assertTrue((pub / shard_rel.lstrip("/")).is_file())
            self.assertEqual((pub / shard_rel.lstrip("/")).read_bytes(), shard_raw)

    def test_empty_positions_with_declared_5172_or_baseline_rejected(self):
        # 1. Declared 5,172 positions at top-level, but 0 actual position rows in external shard
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            cand = make_payload(40, generated_at="2026-11-10T10:00:00+08:00")
            for ex in cand["exams"]:
                ex["positions"] = []
            cand["total_positions"] = 0
            cand["total_exams_with_positions"] = 0
            write_exam_snapshot(cand, pub)

            # Corrupt top-level metadata to claim 5,172 positions while positions-*.json has 0 rows
            written = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            written["total_positions"] = 5172
            written["total_exams_with_positions"] = 25
            (pub / "exams.json").write_text(json.dumps(written, ensure_ascii=False), encoding="utf-8")

            with patch("scripts.exams_guard.fetch_baseline_exams", return_value=(None, None)):
                code = guard_exams(pub, "")
            self.assertEqual(code, 1)

        # 2. No top-level total_positions declaration, but 0 positions when baseline has positions -> rejected
        empty_cand = make_payload(40, generated_at="2026-11-10T10:00:00+08:00")
        for ex in empty_cand["exams"]:
            ex["positions"] = []
        base = make_payload(40, generated_at="2026-11-09T10:00:00+08:00")
        ok, reason = validate_candidate(empty_cand, baseline=base)
        self.assertFalse(ok)
        self.assertIn("zero", reason)

    def test_partial_exam_position_loss_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            raw = make_payload(35, generated_at="2026-11-10T12:00:00+08:00")
            raw["exams"][0]["positions"] = [
                {"row_id": f"r-{k}", "exam_id": "exam-0", "major_raw": "计算机科学与技术"}
                for k in range(10)
            ]
            raw["total_positions"] = sum(len(e["positions"]) for e in raw["exams"])
            raw["total_exams_with_positions"] = 35
            write_exam_snapshot(raw, pub)

            # Simulate silent partial loss: exam-0 drops from positions_by_exam while slim exam still claims parsed_position_count=10
            written = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            old_pos_file = pub / written["positions_url"].lstrip("/")
            pos_obj = json.loads(old_pos_file.read_text(encoding="utf-8"))
            pos_obj["positions_by_exam"].pop("exam-0", None)
            new_pos_bytes = json.dumps(pos_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            new_hash = hashlib.sha256(new_pos_bytes).hexdigest()[:20]
            new_rel = f"/exam-assets/positions-{new_hash}.json"
            old_pos_file.unlink()
            (pub / new_rel.lstrip("/")).write_bytes(new_pos_bytes)
            written["positions_url"] = new_rel
            (pub / "exams.json").write_text(json.dumps(written, ensure_ascii=False), encoding="utf-8")

            with patch("scripts.exams_guard.fetch_baseline_exams", return_value=(None, None)):
                code = guard_exams(pub, "")
            self.assertEqual(code, 1)

    def test_orphan_or_mismatched_exam_id_in_positions_rejected(self):
        cand = make_payload(35, generated_at="2026-11-10T12:00:00+08:00")
        for ex in cand["exams"]:
            ex.pop("positions", None)
            ex["parsed_position_count"] = 1
        cand["total_positions"] = 36
        cand["total_exams_with_positions"] = 35

        pos_map_orphan = {
            f"exam-{i}": [{"row_id": f"p-{i}", "exam_id": f"exam-{i}", "major_raw": "法学"}]
            for i in range(35)
        }
        pos_map_orphan["ghost-exam-999"] = [{"row_id": "p-ghost", "exam_id": "ghost-exam-999", "major_raw": "法学"}]
        ok_orphan, reason_orphan = validate_candidate(cand, positions_by_exam=pos_map_orphan)
        self.assertFalse(ok_orphan)
        self.assertIn("unknown exam_id", reason_orphan)

        cand["total_positions"] = 35
        pos_map_mismatch = {
            f"exam-{i}": [{"row_id": f"p-{i}", "exam_id": f"exam-{i}", "major_raw": "法学"}]
            for i in range(35)
        }
        pos_map_mismatch["exam-0"][0]["exam_id"] = "exam-1"
        ok_mismatch, reason_mismatch = validate_candidate(cand, positions_by_exam=pos_map_mismatch)
        self.assertFalse(ok_mismatch)
        self.assertIn("mismatch", reason_mismatch)

    def test_sharp_position_count_drop_vs_baseline_replaced_by_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp)
            # Candidate has 40 exams and 40 self-consistent positions (< 60% of 200 baseline positions)
            cand = make_payload(40, generated_at="2026-11-10T14:00:00+08:00")
            cand["total_positions"] = 40
            cand["total_exams_with_positions"] = 40
            (pub / "exams.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")

            base = make_payload(40, generated_at="2026-11-09T14:00:00+08:00")
            for i, ex in enumerate(base["exams"]):
                ex["positions"] = [
                    {"row_id": f"bp-{i}-{k}", "major_raw": "会计学"}
                    for k in range(5)
                ]
            base["total_positions"] = 200
            base_bytes = json.dumps(base, ensure_ascii=False).encode("utf-8")

            with patch("scripts.exams_guard.fetch_baseline_exams", return_value=(base_bytes, base)):
                code = guard_exams(pub, "https://sites-project.job-radar.workers.dev")

            self.assertEqual(code, 0)
            saved = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["generated_at"], "2026-11-09T14:00:00+08:00")
            self.assertEqual(saved["total_positions"], 200)

    def test_require_fresh_checks_last_success_at_and_records_step_summary(self):
        import os

        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp) / "pub"
            pub.mkdir(parents=True)
            summary_file = Path(tmp) / "step_summary.md"

            # Repacked old snapshot: newer generated_at, but older last_success_at than live baseline
            cand = make_payload(50, generated_at="2026-11-25T12:00:00+08:00")
            cand["last_success_at"] = "2026-11-24T08:00:00+08:00"
            (pub / "exams.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")

            base = make_payload(50, generated_at="2026-11-25T09:30:00+08:00")
            base["last_success_at"] = "2026-11-25T09:30:00+08:00"
            base_bytes = json.dumps(base, ensure_ascii=False).encode("utf-8")

            with (
                patch("scripts.exams_guard.fetch_baseline_exams", return_value=(base_bytes, base)),
                patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary_file)}),
            ):
                code = guard_exams(pub, "https://sites-project.job-radar.workers.dev", require_fresh=True)

            self.assertEqual(code, 0)
            saved = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["generated_at"], "2026-11-25T09:30:00+08:00")
            self.assertEqual(saved["last_success_at"], "2026-11-25T09:30:00+08:00")
            summary_md = summary_file.read_text(encoding="utf-8")
            self.assertIn("Exams Guard Fallback", summary_md)
            self.assertIn("last_success_at", summary_md)


if __name__ == "__main__":
    unittest.main()

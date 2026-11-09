import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.exams_guard import guard_exams


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


if __name__ == "__main__":
    unittest.main()

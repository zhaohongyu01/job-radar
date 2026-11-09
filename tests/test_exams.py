import unittest

from scripts.parse_exam_positions import (
    compute_exam_stage,
    enrich_exam_record,
    extract_exam_schedule,
    infer_bianzhi_types,
    infer_exam_category,
    infer_notice_role,
    parse_exam_table_grid,
)


class ExamParserTests(unittest.TestCase):
    def test_infer_bianzhi_and_category(self):
        title = "2026年烟台市事业单位统一公开招聘工作人员（含综合类、中小学教师、医疗卫生）简章"
        content = "本次公开招聘纳入事业编制和人员控制总量管理，统一参加全省事业单位初级综合类统考。"
        bianzhi = infer_bianzhi_types(title, content)
        self.assertIn("事业编", bianzhi)
        self.assertIn("控制总量 / 备案制", bianzhi)
        self.assertIn("教师编", bianzhi)
        self.assertIn("医疗卫生编", bianzhi)

        category = infer_exam_category(title, content)
        self.assertEqual(category, "事业单位统考")
        self.assertEqual(infer_notice_role(title), "招考简章")

    def test_extract_schedule_and_stage(self):
        text = (
            "一、报名时间：2026年3月10日9:00—3月14日16:00。\n"
            "二、查询时间：2026年3月10日11:00—3月15日16:00。\n"
            "三、缴费时间：2026年3月10日11:00—3月16日16:00。\n"
            "四、笔试时间：2026年3月28日上午9:00—11:30。"
        )
        schedule = extract_exam_schedule(text, "2026-03-05")
        self.assertEqual(schedule["reg_start"], "2026-03-10")
        self.assertEqual(schedule["reg_end"], "2026-03-14")
        self.assertEqual(schedule["audit_end"], "2026-03-15")
        self.assertEqual(schedule["payment_end"], "2026-03-16")
        self.assertEqual(schedule["written_exam_date"], "2026-03-28")
        self.assertTrue(len(schedule["raw_evidence"]) >= 2)

        stage = compute_exam_stage(schedule, "招考简章", "2026-03-05", "2026-03-10")
        self.assertEqual(stage, "registering")

        closing_stage = compute_exam_stage(schedule, "招考简章", "2026-03-05", "2026-03-12")
        self.assertEqual(closing_stage, "closing_soon")

    def test_parse_exam_table_grid_extracts_positions(self):
        grid = [
            ["岗位代码", "招聘单位", "岗位名称", "招聘人数", "学历要求", "学位要求", "专业要求", "政治面貌", "其他条件"],
            ["2026001", "济南市大数据中心", "数据分析岗", "2", "硕士研究生及以上", "硕士", "计算机科学与技术、统计学", "中共党员", "限2026届应届毕业生"],
            ["2026002", "济南市市民服务局", "综合管理岗", "3", "本科及以上", "学士", "不限专业", "不限", "无"],
        ]
        positions = parse_exam_table_grid(
            grid,
            exam_id="exam-jn-1",
            default_bianzhi="事业编",
            default_city="济南",
        )
        self.assertEqual(len(positions), 2)
        self.assertEqual(positions[0]["position_code"], "2026001")
        self.assertEqual(positions[0]["position_name"], "数据分析岗")
        self.assertEqual(positions[0]["recruit_count"], 2)
        self.assertEqual(positions[0]["education"], "硕士研究生及以上")
        self.assertEqual(positions[0]["political_status"], "中共党员")

    def test_enrich_exam_record(self):
        raw = {
            "id": "exam-qd-test",
            "title": "2026年青岛市某事业单位公开招聘工作人员简章",
            "company": "青岛市某事业单位",
            "cities": ["青岛"],
            "published_at": "2026-11-08",
            "source_id": "qd-hrss-sydw",
            "source_name": "青岛市人社局 · 事业单位招聘",
            "source_url": "https://hrss.qingdao.gov.cn/notice/1.html",
            "body": (
                "本次公开招聘工作人员共12人，实行人员控制总量管理，最低服务年限5年。"
                "年龄在35周岁以下，笔试科目为《职业能力倾向测验》和《综合应用能力》，开考比例1:3。"
                "报名时间：2026年11月9日9:00—11月15日16:00。专业不限岗位4人。"
            ),
        }
        enriched = enrich_exam_record(raw, today_str="2026-11-10")
        self.assertIn("控制总量 / 备案制", enriched["bianzhi_types"])
        self.assertEqual(enriched["service_years"], "最低服务年限5年")
        self.assertEqual(enriched["exam_ratio"], "1:3")
        self.assertTrue(enriched["has_unlimited_major"])
        self.assertEqual(enriched["total_headcount"], 12)
        self.assertEqual(enriched["stage"], "registering")
        self.assertTrue(len(enriched["positions"]) >= 1)


if __name__ == "__main__":
    unittest.main()

import unittest

from scripts.collect_exams import is_civil_exam_record, is_in_shandong_or_national_scope
from scripts.parse_exam_positions import (
    clean_exam_title,
    compute_exam_stage,
    enrich_exam_record,
    extract_exam_organizer,
    extract_exam_schedule,
    infer_bianzhi_types,
    infer_exam_category,
    infer_notice_role,
    parse_exam_table_grid,
    valid_prose_position_name,
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

    def test_clean_title_and_extract_organizer(self):
        self.assertEqual(
            clean_exam_title("主题：2026年临沂市技师学院公开招聘教师简章 10000-15000元 日期："),
            "2026年临沂市技师学院公开招聘教师简章",
        )
        # Do not trust campus forwarding portal host over county/city in title
        org_yanggu = extract_exam_organizer(
            "2026年阳谷县事业单位综合类岗位青年人才引进公告",
            raw_company="山东第二医科大学",
        )
        self.assertEqual(org_yanggu, "阳谷县人力资源和社会保障局")

        # Extract true institution from body intro for clickbait titles
        org_clickbait = extract_exam_organizer(
            "14人！这家驻济省属事业单位公开招聘了",
            raw_company="济南市政府",
            body="一、招聘单位简介 山东第一医科大学附属颈肩腰腿痛医院为山东第一医科大学直属省级中医骨伤专科医院。",
        )
        self.assertEqual(org_clickbait, "山东第一医科大学附属颈肩腰腿痛医院")

    def test_scope_and_noise_filtering(self):
        # Valid Shandong county exam
        self.assertTrue(
            is_civil_exam_record({
                "title": "2026年阳谷县事业单位综合类岗位青年人才引进公告",
                "company": "山东第二医科大学",
                "source_id": "sdsmu-announcements",
            })
        )
        # Valid National exam
        self.assertTrue(
            is_civil_exam_record({
                "title": "中央机关及其直属机构2027年度考试录用公务员公告",
                "company": "国家公务员局",
                "source_id": "sdu-announcements",
            })
        )
        # Reject non-Shandong local college from campus feed
        self.assertFalse(
            is_civil_exam_record({
                "title": "上海电机学院2026年公开招聘公告 15000-20000元",
                "company": "上海电机学院",
                "source_id": "nankai-announcements",
            })
        )
        # Reject single-position online directory row ("单位 · 岗位")
        self.assertFalse(
            is_civil_exam_record({
                "title": "山东第二医科大学 · 公务员",
                "company": "山东第二医科大学",
                "source_id": "sdsmu-positions",
            })
        )
        # Reject general political news containing "考察"
        self.assertFalse(
            is_in_shandong_or_national_scope("上海电机学院2026年公开招聘公告", source_id="campus-exam-hub")
        )

    def test_extract_schedule_and_stage_with_collapsed_lines(self):
        # Even when newlines are collapsed into spaces by HTML cleaner, sentence splitting extracts all dates
        text = (
            "一、报名时间：2026年3月10日9:00—3月14日16:00。"
            "二、查询时间：2026年3月10日11:00—3月15日16:00。"
            "三、缴费时间：2026年3月10日11:00—3月16日16:00。"
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

    def test_no_fabricated_defaults_or_placeholder_rows(self):
        # 1. Missing columns in table grid output empty string / None rather than fabricated defaults
        grid = [
            ["岗位代码", "招聘单位", "岗位名称"],
            ["01", "济南市某局", "综合文秘岗"],
        ]
        rows = parse_exam_table_grid(grid, exam_id="exam-no-def")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["education"], "")
        self.assertEqual(rows[0]["degree"], "")
        self.assertEqual(rows[0]["major_raw"], "")
        self.assertEqual(rows[0]["majors"], [])
        self.assertEqual(rows[0]["age_limit"], "")
        self.assertEqual(rows[0]["exam_ratio"], "")
        self.assertEqual(rows[0]["hukou_rule"], "")
        self.assertIsNone(rows[0]["recruit_count"])
        self.assertEqual(rows[0]["source"], "table")

        # 2. Announcement without table or valid prose rows has positions == [] and attachment_only / none status
        raw_att = {
            "id": "exam-att-only",
            "title": "2026年潍坊市某单位公开招聘工作人员简章",
            "body": "有关招聘事项见附件。",
            "attachments": [{"title": "附件1：公开招聘岗位汇总表.xlsx", "url": "https://example.gov.cn/1.xlsx"}],
        }
        enriched_att = enrich_exam_record(raw_att, today_str="2026-11-09")
        self.assertEqual(enriched_att["positions"], [])
        self.assertEqual(enriched_att["positions_status"], "attachment_only")
        self.assertIsNone(enriched_att["exam_ratio"])
        self.assertIsNone(enriched_att["age_limit"])

        raw_none = {
            "id": "exam-none",
            "title": "2026年潍坊市某单位公开招聘工作人员简章",
            "body": "有关事项另行通知，硕士及以上10人，以上人员5人。",
            "attachments": [],
        }
        enriched_none = enrich_exam_record(raw_none, today_str="2026-11-09")
        self.assertEqual(enriched_none["positions"], [])
        self.assertEqual(enriched_none["positions_status"], "none")

        # 3. Prose blacklist rejects invalid fragment names
        for bad in ("以上", "硕士及", "1", "工作人员", "人才"):
            self.assertFalse(valid_prose_position_name(bad), bad)
        self.assertTrue(valid_prose_position_name("专任教师"))

        # 4. Title containing 博士 sets education_min to 博士研究生 even if body mentions 本科
        raw_phd = {
            "id": "exam-phd",
            "title": "山东某高校2026年引进博士研究生公告",
            "body": "具有全日制本科、硕士及博士研究生学历学位。",
        }
        enriched_phd = enrich_exam_record(raw_phd, today_str="2026-11-09")
        self.assertEqual(enriched_phd["education_min"], "博士研究生")

    def test_fullwidth_range_rolling_and_strict_deadline_fallback(self):
        # 1. Full-width range separator "－" (U+FF0D)
        s1 = extract_exam_schedule("报名时间：2026年11月2日9:00－11月6日16:00", "2026-10-28")
        self.assertEqual(s1["reg_start"], "2026-11-02")
        self.assertEqual(s1["reg_end"], "2026-11-06")
        self.assertEqual(s1["reg_mode"], "window")

        # 2. Rolling recruitment with validity until date
        s2 = extract_exam_schedule("采取长期招聘、招满即止的方式，报名有效期至2026年11月30日", "2026-09-01")
        self.assertEqual(s2["reg_mode"], "rolling")
        self.assertEqual(s2["rolling_until"], "2026-11-30")
        self.assertIsNone(s2["reg_end"])

        # 3. Non-registration deadline in body is not adopted as reg_end
        raw_dl = {
            "id": "exam-dl-grad",
            "title": "2026年某单位公开招聘简章",
            "body": "应聘人员须于2026年12月31日前取得相应学历学位证书。",
            "deadline": "2026-12-31",
            "published_at": "2026-11-01",
        }
        enriched_dl = enrich_exam_record(raw_dl, today_str="2026-11-09")
        self.assertIsNone(enriched_dl["schedule"]["reg_end"])


if __name__ == "__main__":
    unittest.main()

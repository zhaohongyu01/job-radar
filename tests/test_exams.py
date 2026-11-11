import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts.collect_exams import (
    EXAM_SOURCES,
    crawl_dtdjzx_exam,
    crawl_generic_gov_portal,
    extract_dtdjzx_embedded_html,
    is_civil_exam_record,
    is_in_shandong_or_national_scope,
    link_related_exam_notices,
    merge_sibling_position_table_entries,
    parse_dtdjzx_basic_lines,
    write_exam_snapshot,
)
from scripts.snapshot_assets import EXAM_DETAIL_ASSET, EXAM_POSITIONS_ASSET, hydrate_exam_snapshot
from scripts.stage_public import stage
from scripts.parse_exam_positions import (
    clean_exam_title,
    compute_exam_stage,
    compute_position_row_id,
    enrich_exam_record,
    extract_exam_organizer,
    extract_exam_schedule,
    infer_bianzhi_types,
    infer_exam_category,
    infer_notice_role,
    parse_exam_attachment_bytes,
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

    def test_stable_position_row_id_and_deduplication(self):
        grid = [
            ["岗位代码", "招聘单位", "岗位名称", "招聘人数"],
            ["01", "济南市中心医院", "内科医师", "2"],
            ["01", "济南市中心医院", "内科医师", "1"],
        ]
        rows = parse_exam_table_grid(grid, exam_id="exam-stable-1")
        self.assertEqual(len(rows), 2)
        expected_base = compute_position_row_id("exam-stable-1", "01", "济南市中心医院", "内科医师")
        self.assertEqual(rows[0]["row_id"], expected_base)
        self.assertEqual(rows[1]["row_id"], f"{expected_base}-2")

        # Reordering rows with a different row first does not change the row_id of a distinct position
        grid_reordered = [
            ["岗位代码", "招聘单位", "岗位名称", "招聘人数"],
            ["99", "济南市中心医院", "外科医师", "1"],
            ["01", "济南市中心医院", "内科医师", "2"],
        ]
        rows_reordered = parse_exam_table_grid(grid_reordered, exam_id="exam-stable-1")
        self.assertEqual(rows_reordered[1]["row_id"], expected_base)

    def test_link_related_exam_notices(self):
        parent = {
            "id": "exam-parent-1",
            "title": "2026年淄博市市属事业单位综合类岗位公开招聘工作人员简章",
            "organizer": "淄博市人力资源和社会保障局",
            "notice_role": "招考简章",
            "published_at": "2026-03-01",
            "source_url": "https://hrss.zibo.gov.cn/1.html",
            "related_notices": [],
        }
        follow_up_match = {
            "id": "exam-notice-1",
            "title": "关于2026年淄博市市属事业单位综合类岗位公开招聘工作人员面试资格审查有关事项的通知",
            "organizer": "淄博市人力资源和社会保障局",
            "notice_role": "资格复审/面试",
            "published_at": "2026-04-20",
            "source_url": "https://hrss.zibo.gov.cn/2.html",
            "source_name": "淄博市人社局",
        }
        follow_up_unrelated_org = {
            "id": "exam-notice-2",
            "title": "关于2026年烟台市市属事业单位综合类岗位公开招聘工作人员面试资格审查有关事项的通知",
            "organizer": "烟台市人力资源和社会保障局",
            "notice_role": "资格复审/面试",
            "published_at": "2026-04-20",
            "source_url": "https://rshj.yantai.gov.cn/2.html",
        }
        follow_up_too_old = {
            "id": "exam-notice-3",
            "title": "关于2026年淄博市市属事业单位综合类岗位公开招聘工作人员拟聘用人员公示",
            "organizer": "淄博市人力资源和社会保障局",
            "notice_role": "体检/递补/公示",
            "published_at": "2026-10-15",  # > 180 days after 2026-03-01
            "source_url": "https://hrss.zibo.gov.cn/3.html",
        }

        exams = [parent, follow_up_match, follow_up_unrelated_org, follow_up_too_old]
        link_related_exam_notices(exams)

        self.assertEqual(len(parent["related_notices"]), 1)
        self.assertEqual(parent["related_notices"][0]["id"], "exam-notice-1")
        self.assertEqual(follow_up_match.get("parent_exam_id"), "exam-parent-1")
        self.assertIsNone(follow_up_unrelated_org.get("parent_exam_id"))
        self.assertIsNone(follow_up_too_old.get("parent_exam_id"))

    def test_write_exam_snapshot_and_stage_public_exam_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pub = root / "public"
            dist = root / "dist"
            pub.mkdir(parents=True)
            (pub / "exam-assets").mkdir(parents=True)
            stale_pub_shard = pub / "exam-assets" / "detail-99-00000000000000000000.json"
            stale_pub_shard.write_text("{}", encoding="utf-8")

            raw_payload = {
                "schema_version": 1,
                "generated_at": "2026-11-10T00:00:00+08:00",
                "last_success_at": "2026-11-10T00:00:00+08:00",
                "total_exams": 2,
                "total_positions": 1,
                "total_headcount": 2,
                "cities": ["济南"],
                "exams": [
                    {
                        "id": "0a111111111111111111",
                        "title": "济南招考简章A",
                        "excerpt": "摘要A",
                        "body": "完整正文段落A1\n完整正文段落A2",
                        "attachments": [{"title": "岗位表.xlsx", "url": "https://example.gov.cn/a.xlsx"}],
                        "links": [{"title": "报名入口", "url": "https://example.gov.cn/apply"}],
                        "positions": [{"row_id": "r1", "major_raw": "计算机"}],
                    },
                    {
                        "id": "1b222222222222222222",
                        "title": "青岛招考简章B",
                        "excerpt": "摘要B",
                        "body": "完整正文段落B",
                        "positions": [],
                    },
                ],
                "sources": [],
            }

            out = write_exam_snapshot(raw_payload, pub)
            self.assertFalse(stale_pub_shard.exists())
            self.assertEqual(set(out["detail_shards"].keys()), {"0a", "1b"})
            self.assertIsNotNone(EXAM_POSITIONS_ASSET.fullmatch(out["positions_url"]))

            written_exams = json.loads((pub / "exams.json").read_text(encoding="utf-8"))
            for ex in written_exams["exams"]:
                self.assertNotIn("body", ex)
                self.assertNotIn("attachments", ex)
                self.assertNotIn("links", ex)
                self.assertNotIn("positions", ex)
                self.assertIn("excerpt", ex)
                self.assertIn("parsed_position_count", ex)

            pos_asset_file = pub / written_exams["positions_url"].lstrip("/")
            self.assertTrue(pos_asset_file.is_file())
            pos_asset_json = json.loads(pos_asset_file.read_text(encoding="utf-8"))
            self.assertEqual(pos_asset_json["schema_version"], 1)
            self.assertEqual(
                pos_asset_json["positions_by_exam"]["0a111111111111111111"][0]["row_id"],
                "r1",
            )

            hydrated = hydrate_exam_snapshot(
                written_exams,
                lambda rel: json.loads((pub / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            self.assertEqual(len(hydrated["exams"][0]["positions"]), 1)
            self.assertIn("完整正文段落A1", hydrated["exams"][0]["body"])

            for prefix, rel_path in written_exams["detail_shards"].items():
                match = EXAM_DETAIL_ASSET.fullmatch(rel_path)
                self.assertIsNotNone(match, rel_path)
                shard_file = pub / rel_path.lstrip("/")
                self.assertTrue(shard_file.is_file())
                self.assertEqual(hashlib.sha256(shard_file.read_bytes()).hexdigest()[:20], match[1])
                shard_json = json.loads(shard_file.read_text(encoding="utf-8"))
                self.assertEqual(shard_json["schema_version"], 1)
                if prefix == "0a":
                    entry = shard_json["exams"]["0a111111111111111111"]
                    self.assertIn("完整正文段落A1", entry["body"])
                    self.assertEqual(len(entry["attachments"]), 1)
                    self.assertEqual(len(entry["links"]), 1)
                    self.assertEqual(len(entry["positions"]), 1)

            # Prepare minimal valid jobs.json + dist/server/wrangler.json for stage_public.stage()
            search_bytes = b'{"jobs":{}}'
            search_hash = hashlib.sha256(search_bytes).hexdigest()[:20]
            search_rel = f"/job-assets/search-{search_hash}.json"
            (pub / "job-assets").mkdir(parents=True, exist_ok=True)
            (pub / search_rel.lstrip("/")).write_bytes(search_bytes)

            jobs_bytes = json.dumps(
                {
                    "schema_version": 3,
                    "generated_at": "2026-11-10T00:00:00+08:00",
                    "last_success_at": None,
                    "schedule_enabled": True,
                    "cities": [],
                    "sources": [],
                    "jobs": [],
                    "detail_shards": {},
                    "search_url": search_rel,
                }
            ).encode("utf-8")
            (pub / "jobs.json").write_bytes(jobs_bytes)
            (pub / "snapshot-manifest.json").write_text(
                json.dumps({"schema_version": 1, "index_sha256": hashlib.sha256(jobs_bytes).hexdigest()}),
                encoding="utf-8",
            )

            client_dir = dist / "client"
            (dist / "server").mkdir(parents=True)
            (client_dir / "exam-assets").mkdir(parents=True)
            obsolete_staged = client_dir / "exam-assets" / "detail-ff-ffffffffffffffffffff.json"
            obsolete_staged.write_text("{}", encoding="utf-8")
            (dist / "server" / "wrangler.json").write_text(
                json.dumps({"assets": {"directory": "../client"}}),
                encoding="utf-8",
            )

            stage(pub, dist)
            self.assertFalse(obsolete_staged.exists())
            self.assertTrue((client_dir / "exams.json").is_file())
            for rel_path in written_exams["detail_shards"].values():
                self.assertTrue((client_dir / rel_path.lstrip("/")).is_file())

    def test_dtdjzx_adapter_and_embedded_vue_detail_extraction(self):
        src_ids = {s["id"] for s in EXAM_SOURCES}
        for expected_id in ("cpta-notice", "dtdjzx-gwy", "dtdjzx-xds", "dtdjzx-lxxd", "sd-edu-tzgg", "sd-wsjkw-gsgg"):
            self.assertIn(expected_id, src_ids)

        list_html = """
        <div class="container__list">
          <basic-line title="2027年度山东省省级机关及其直属机构考试录用公务员公告" description="招录说明" url="/web/dtdjzx/lygwyzkgg/131234.html" time="2026-11-04"></basic-line>
          <basic-line title="2027年度山东省省级机关及其直属机构考试录用公务员报考指南" description="报考指南噪声应过滤" url="/web/dtdjzx/lygwyzkgg/131231.html" time="2026-11-04"></basic-line>
          <basic-line title="2027年度山东省法院系统考试录用公务员简章" description="法院简章" url="/web/dtdjzx/lygwyzkgg/131228.html" time="2026-11-04"></basic-line>
        </div>
        """
        dl_list_html = """
        <div class="container__list">
          <basic-line title="2027年度山东省省级机关及其直属机构考试录用公务员职位表" description="职位表" url="/web/dtdjzx/lyxgxz/131238.html" time="2026-11-04"></basic-line>
        </div>
        """
        dl_detail_html = """
        <div v-html="content" class="content"></div>
        <script>
        new Vue({
          data() {
            return {
              content: `<p><a href="https://dyjyzyk.dtdjzx.gov.cn/zyk-shengnei/uploads/ueditor/file/2026-11-04/3852065468852481734.xlsx" title="2027年度山东省省级机关及其直属机构考试录用公务员职位表">2027年度山东省省级机关及其直属机构考试录用公务员职位表</a></p>`,
              contentSize: 'content-mid'
            }
          }
        })
        </script>
        """
        parsed_lines = parse_dtdjzx_basic_lines(list_html, "https://www.dtdjzx.gov.cn/web/dtdjzx/lygwyzkgg.html")
        self.assertEqual(len(parsed_lines), 3)
        self.assertIn("3852065468852481734.xlsx", extract_dtdjzx_embedded_html(dl_detail_html))

        def fake_fetch(url: str, timeout: float = 6.0, referer: str = "") -> str:
            if url.endswith("lygwyzkgg.html"):
                return list_html
            if url.endswith("lyxgxz.html"):
                return dl_list_html
            if url.endswith("131238.html"):
                return dl_detail_html
            return ""

        src = next(s for s in EXAM_SOURCES if s["id"] == "dtdjzx-gwy")
        with patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch):
            items = crawl_dtdjzx_exam({**src, "extra_urls": []})

        self.assertEqual(len(items), 2)  # 报考指南被过滤
        self.assertEqual(items[0]["title"], "2027年度山东省省级机关及其直属机构考试录用公务员公告")
        self.assertEqual(len(items[0].get("attachments") or []), 1)
        self.assertTrue(items[0]["attachments"][0]["url"].endswith(".xlsx"))

    def test_generic_gov_portal_supports_cpta_and_shandong_provincial_columns(self):
        cpta_html = """
        <ul>
          <li><a href="/gwytg/2072.html">中央机关及其直属机构2027年度考试录用公务员笔试公告</a> 2026-11-05</li>
          <li><a href="/notice/2222.html">上海市某区事业单位2026年公开招聘公告</a> 2026-11-05</li>
        </ul>
        """
        cpta_src = next(s for s in EXAM_SOURCES if s["id"] == "cpta-notice")
        with patch("scripts.collect_exams.fetch_html_quick", return_value=cpta_html):
            cpta_items = crawl_generic_gov_portal(cpta_src)
        self.assertEqual(len(cpta_items), 1)
        self.assertIn("中央机关及其直属机构", cpta_items[0]["title"])

        edu_html = """
        <ul>
          <li><a href="/art/2026/10/19/art_107093_10356467.html">山东省教育科学研究院2026年公开招聘博士研究生公告</a></li>
        </ul>
        """
        edu_src = next(s for s in EXAM_SOURCES if s["id"] == "sd-edu-tzgg")
        with patch("scripts.collect_exams.fetch_html_quick", return_value=edu_html):
            edu_items = crawl_generic_gov_portal(edu_src)
        self.assertEqual(len(edu_items), 1)
        self.assertEqual(edu_items[0]["published_at"], "2026-10-19")

    def test_civil_service_wide_xlsx_grid_with_multi_tier_major_columns(self):
        grid = [
            ["2027年度山东省省级机关及其直属机构考试录用公务员职位表"] + [""] * 21,
            [
                "招录机关", "用人单位", "职位代码", "职位名称", "职位性质", "职位类别",
                "职位属性", "公共科目笔试类别", "职位简介", "招录计划", "招录对象",
                "学历要求", "学位要求", "大学专科专业要求", "大学本科专业要求", "研究生专业要求",
                "政治面貌", "基层工作最低年限", "服务基层项目工作经历", "是否在面试阶段组织专业能力测试",
                "面试人员比例", "工作地点",
            ],
            [
                "中共山东省委网信办", "机关", "13730003001000001", "网信技术管理职位", "公务员", "综合管理类",
                "普通职位", "A类", "从事网络安全管理工作", "2", "2027届高校毕业生",
                "大学本科以上", "学士以上", "", "计算机类、电子信息工程", "计算机科学与技术一级学科、软件工程一级学科",
                "中共党员", "无限制", "无限制", "否",
                "3:1", "济南市",
            ],
        ]
        rows = parse_exam_table_grid(grid, exam_id="sd-gwy-2027", default_bianzhi="公务员（行政编）")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["department"], "中共山东省委网信办")
        self.assertEqual(rows[0]["position_code"], "13730003001000001")
        self.assertEqual(rows[0]["bianzhi"], "公务员（行政编）")
        self.assertEqual(rows[0]["recruit_count"], 2)
        self.assertIn("本科：计算机类", rows[0]["major_raw"])
        self.assertIn("研究生：计算机科学与技术", rows[0]["major_raw"])
        self.assertEqual(rows[0]["political_status"], "中共党员")

        gwy_sched = extract_exam_schedule(
            "1．提交报名申请。报考者可在2026年11月6日9︰00至11月9日16︰00期间登录报名平台，提交报名申请。"
            "3．报名确认。报考者通过资格初审后，应于2026年11月6日11︰00至11月11日16︰00登录报名平台进行网上缴费确认。",
            "2026-11-04",
        )
        self.assertEqual(gwy_sched["reg_start"], "2026-11-06")
        self.assertEqual(gwy_sched["reg_end"], "2026-11-09")
        self.assertEqual(gwy_sched["payment_end"], "2026-11-11")

        xds_sched = extract_exam_schedule(
            "1、提交报名信息时间：11月9日9:00—13日16:00。",
            "2026-11-05",
        )
        self.assertEqual(xds_sched["reg_start"], "2026-11-09")
        self.assertEqual(xds_sched["reg_end"], "2026-11-13")

    def test_multi_format_attachment_dispatcher_parses_extensionless_docx_and_html_xls(self):
        # 1. Build a minimal valid OOXML .docx in memory served via extensionless downfile.jsp
        w_ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        doc_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="{w_ns}">
          <w:body>
            <w:tbl>
              <w:tr>
                <w:tc><w:p><w:r><w:t>招聘单位</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>岗位名称</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>招聘人数</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>学历要求</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>专业要求</w:t></w:r></w:p></w:tc>
              </w:tr>
              <w:tr>
                <w:tc><w:p><w:r><w:t>山东省教育科学研究院</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>课程科研岗</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>博士研究生</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>教育学、心理学</w:t></w:r></w:p></w:tc>
              </w:tr>
            </w:tbl>
          </w:body>
        </w:document>"""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("word/document.xml", doc_xml.encode("utf-8"))
        docx_rows = parse_exam_attachment_bytes(
            buf.getvalue(),
            exam_id="sd-edu-docx",
            default_city="济南",
            filename="附件1：岗位汇总表.docx",
            url="http://edu.shandong.gov.cn/module/download/downfile.jsp?classid=0&filename=abc",
        )
        self.assertEqual(len(docx_rows), 1)
        self.assertEqual(docx_rows[0]["employer"], "山东省教育科学研究院")
        self.assertEqual(docx_rows[0]["position_name"], "课程科研岗")
        self.assertEqual(docx_rows[0]["recruit_count"], 2)
        self.assertEqual(docx_rows[0]["education"], "博士研究生")

        # 2. HTML table exported as .xls by government CMS
        html_xls = """<table>
          <tr><th>招聘单位</th><th>岗位名称</th><th>计划人数</th><th>学历</th><th>专业要求</th></tr>
          <tr><td>庆云县人民医院</td><td>临床医师岗</td><td>5</td><td>本科及以上</td><td>临床医学</td></tr>
        </table>""".encode("gb18030")
        xls_rows = parse_exam_attachment_bytes(
            html_xls,
            exam_id="dezhou-xls",
            default_city="德州",
            filename="岗位汇总表.xls",
            url="https://example.gov.cn/1.xls",
        )
        self.assertEqual(len(xls_rows), 1)
        self.assertEqual(xls_rows[0]["employer"], "庆云县人民医院")
        self.assertEqual(xls_rows[0]["recruit_count"], 5)

    def test_municipal_dtdjzx_list_push_sibling_merge_and_cpta_scope(self):
        ssr_html = """
        <script>
        const list = [];
        ;list.push({
          imgUrl: ``,
          link: `/web/p582/tzgg/131290.html`,
          description: `现将2027年度济南市各级机关考试录用公务员有关事项公告如下`,
          time: `2026-11-04 15:48:43`,
          source: `灯塔-党建在线`,
          title: `2027年度济南市各级机关考试录用公务员公告`
        })
        ;list.push({
          imgUrl: ``,
          link: `/web/p582/tzgg/131292.html`,
          description: `职位表`,
          time: `2026-11-04 15:48:51`,
          source: `灯塔-党建在线`,
          title: `2027年度济南市各级机关考试录用公务员职位表`
        })
        </script>
        """
        rows = parse_dtdjzx_basic_lines(ssr_html, "https://jinan.dtdjzx.gov.cn/web/p582/lygwy.html")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["url"], "https://jinan.dtdjzx.gov.cn/web/p582/tzgg/131290.html")
        self.assertEqual(rows[0]["published_at"], "2026-11-04")

        raw_map = {
            rows[0]["url"]: {
                "source_url": rows[0]["url"],
                "title": rows[0]["title"],
                "body": "根据公务员法..." + "正" * 400,
                "attachments": [],
            },
            rows[1]["url"]: {
                "source_url": rows[1]["url"],
                "title": rows[1]["title"],
                "body": "2027年度济南市各级机关考试录用公务员职位表。",
                "attachments": [{"title": "职位表.xlsx", "url": "https://dyjyzyk.dtdjzx.gov.cn/1.xlsx"}],
            },
        }
        merge_sibling_position_table_entries(raw_map)
        self.assertEqual(len(raw_map), 1)
        merged = raw_map[rows[0]["url"]]
        self.assertEqual(len(merged["attachments"]), 1)
        self.assertEqual(merged["attachments"][0]["url"], "https://dyjyzyk.dtdjzx.gov.cn/1.xlsx")

        self.assertTrue(
            is_in_shandong_or_national_scope(
                "关于做好部分部属事业单位2026年度公开招聘笔试考务工作的通知",
                source_id="cpta-notice",
            )
        )


if __name__ == "__main__":
    unittest.main()

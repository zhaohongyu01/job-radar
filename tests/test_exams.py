import datetime as dt
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
    TZ,
    collect_and_export_exams,
    crawl_dtdjzx_exam,
    crawl_generic_gov_portal,
    extract_dtdjzx_embedded_html,
    is_civil_exam_record,
    is_in_shandong_or_national_scope,
    link_related_exam_notices,
    load_hydrated_existing_jobs,
    merge_sibling_position_table_entries,
    parse_dtdjzx_basic_lines,
    write_exam_snapshot,
)
from scripts.snapshot_assets import EXAM_DETAIL_ASSET, EXAM_POSITIONS_ASSET, hydrate_exam_snapshot
from scripts.stage_public import stage
from scripts.parse_exam_positions import (
    _decode_zip_member_name,
    clean_exam_attachments,
    clean_exam_title,
    compute_exam_stage,
    compute_position_row_id,
    enrich_exam_record,
    extract_exam_organizer,
    extract_exam_schedule,
    infer_bianzhi_types,
    infer_exam_category,
    infer_notice_role,
    is_valid_exam_position_name,
    normalize_exam_attachment_url,
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

    def test_zip_attachment_parsing_and_junk_attachment_cleaning(self):
        raw_atts = [
            {"title": "网站图标", "url": "https://jnmhc.jinan.gov.cn/picture/0/logo.png"},
            {"title": "官方附件", "url": "https://www.gov.cn/"},
            {"title": "公考广告", "url": "https://www.huatu.com/course/1"},
            {"title": "附件1：岗位汇总表.zip", "url": "https://jnmhc.jinan.gov.cn/attach/pos.zip"},
            {"title": "附件1：岗位汇总表（重复）", "url": "https://jnmhc.jinan.gov.cn/attach/pos.zip"},
        ]
        cleaned = clean_exam_attachments(raw_atts)
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0]["url"], "https://jnmhc.jinan.gov.cn/attach/pos.zip")

        # Build an in-memory .zip containing a GBK-named HTML-disguised .xls position table + a nested .zip (must be ignored)
        inner_html = (
            "<table>"
            "<tr><th>岗位代码</th><th>岗位名称</th><th>招聘人数</th><th>学历要求</th><th>专业要求</th></tr>"
            "<tr><td>101</td><td>临床医师</td><td>3</td><td>硕士研究生及以上</td><td>内科学、外科学</td></tr>"
            "</table>"
        ).encode("utf-8")

        nested_buf = io.BytesIO()
        with zipfile.ZipFile(nested_buf, "w") as nzf:
            nzf.writestr("evil.xls", inner_html)

        outer_buf = io.BytesIO()
        with zipfile.ZipFile(outer_buf, "w") as ozf:
            ozf.writestr("01_济南市第一人民医院公开招聘岗位汇总表.xls", inner_html)
            ozf.writestr("报名登记表.xls", inner_html)
            ozf.writestr("nested.xlsx", nested_buf.getvalue())

        # Verify legacy CP437-packed GBK ZipInfo filename decoding (flag_bits without 0x800)
        legacy_info = zipfile.ZipInfo()
        legacy_info.filename = "附件1岗位表.xlsx".encode("gbk").decode("cp437")
        legacy_info.flag_bits = 0
        self.assertEqual(_decode_zip_member_name(legacy_info), "附件1岗位表.xlsx")

        parsed = parse_exam_attachment_bytes(
            outer_buf.getvalue(),
            exam_id="exam-zip-1",
            default_bianzhi="医疗卫生编",
            default_city="济南",
            default_employer="济南市卫健委",
            filename="岗位汇总表.zip",
        )
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["employer"], "济南市第一人民医院")
        self.assertEqual(parsed[0]["position_name"], "临床医师")
        self.assertEqual(parsed[0]["recruit_count"], 3)

    def test_load_hydrated_existing_jobs_preserves_externalized_positions(self):
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp) / "public"
            pub.mkdir(parents=True)
            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": "2026-11-11T00:00:00+08:00",
                    "last_success_at": "2026-11-11T00:00:00+08:00",
                    "total_exams": 1,
                    "total_positions": 1,
                    "total_headcount": 2,
                    "cities": ["济南"],
                    "exams": [
                        {
                            "id": "0a111111111111111111",
                            "title": "2026年济南市事业单位公开招聘工作人员简章",
                            "organizer": "济南市人社局",
                            "source_url": "https://jnhrss.jinan.gov.cn/art/1.html",
                            "excerpt": "摘要",
                            "body": "完整正文内容",
                            "attachments": [{"title": "岗位汇总表.xlsx", "url": "https://jnhrss.jinan.gov.cn/1.xlsx"}],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "r1",
                                    "exam_id": "0a111111111111111111",
                                    "employer": "济南市人社局",
                                    "position_name": "综合管理岗",
                                    "recruit_count": 2,
                                    "major_raw": "计算机科学与技术",
                                    "source": "attachment",
                                }
                            ],
                        }
                    ],
                    "sources": [],
                },
                pub,
            )

            seeded = load_hydrated_existing_jobs(pub, live_site="")
            self.assertEqual(len(seeded), 1)
            self.assertEqual(len(seeded[0].get("positions") or []), 1)
            self.assertEqual(len(seeded[0].get("exam_positions") or []), 1)
            self.assertEqual(seeded[0]["positions"][0]["position_name"], "综合管理岗")

    def test_p1_attachment_unwrap_noise_guards_legacy_doc_and_taian_sibling_merge(self):
        import base64
        import urllib.parse

        # 1. SDEI externalLink JWT unwrap (preserving single-unquoted %2F inside fileUrl) + /resource/srst/att/ rewrite + icon junk removal
        raw_target = "https://www.zhifu.gov.cn/api-gateway/jpaas-jags-server/interface/gateway?fileUrl=a%2Fb.xlsx"
        jwt_payload = base64.urlsafe_b64encode(json.dumps(urllib.parse.quote(raw_target, safe="")).encode("utf-8")).decode("ascii").rstrip("=")
        wrapped = f"https://school.gxjy.sdei.edu.cn/sdu/externalLink?target=eyJhbGciOiJIUzI1NiJ9.{jwt_payload}.sig"
        self.assertEqual(normalize_exam_attachment_url(wrapped), raw_target)
        self.assertEqual(
            normalize_exam_attachment_url("https://school.gxjy.sdei.edu.cn/resource/srst/att/202611/pos.xlsx"),
            "http://hrss.shandong.gov.cn/resource/srst/att/202611/pos.xlsx",
        )
        cleaned_atts = clean_exam_attachments(
            [
                {"title": "icon_pdf.gif", "url": "http://hrss.shandong.gov.cn/ueditor/dialogs/attachment/fileTypeImages/icon_pdf.gif"},
                {"title": "附件1：岗位汇总表.xlsx", "url": wrapped},
            ]
        )
        self.assertEqual(len(cleaned_atts), 1)
        self.assertEqual(cleaned_atts[0]["url"], raw_target)

        # 2. Plan-reduction / publicity / score notices never emit recruitment positions, and numeric/header fragments are rejected
        self.assertFalse(is_valid_exam_position_name("11"))
        self.assertFalse(is_valid_exam_position_name("序号"))
        self.assertFalse(is_valid_exam_position_name("类别"))
        reduction_enriched = enrich_exam_record(
            {
                "id": "exam-reduce-1",
                "title": "关于核减2026年某市事业单位公开招聘部分岗位计划的公告",
                "body": "核减综合管理岗位计划2人。",
                "positions": [{"name": "综合管理岗", "count": 2}, {"name": "1", "count": 1}],
                "published_at": "2026-11-10",
            },
            today_str="2026-11-12",
        )
        self.assertEqual(reduction_enriched["positions"], [])

        # 3. Legacy binary Word 97-2003 .doc UTF-16LE fallback inside parse_exam_attachment_bytes
        doc_utf16 = (
            "岗位名称\t招聘人数\t学历要求\t专业要求\n"
            "临床医师岗\t2\t硕士研究生\t临床医学\n"
        ).encode("utf-16le")
        fake_ole2_doc = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64 + doc_utf16
        doc_rows = parse_exam_attachment_bytes(
            fake_ole2_doc,
            exam_id="exam-doc-1",
            default_employer="某市人民医院",
            filename="岗位汇总表.doc",
        )
        self.assertEqual(len(doc_rows), 1)
        self.assertEqual(doc_rows[0]["position_name"], "临床医师岗")
        self.assertEqual(doc_rows[0]["recruit_count"], 2)

        # 4. Taian civil service announcement + position-table sibling merge despite word-order difference
        taian_by_url = {
            "http://www.tadzzzb.gov.cn/art/ann.html": {
                "id": "ta-ann",
                "source_id": "sd-16cities-gwy",
                "source_city": "泰安",
                "title": "2027年度泰安市各级机关考试录用公务员公告",
                "published_at": "2026-11-05",
                "source_url": "http://www.tadzzzb.gov.cn/art/ann.html",
                "attachments": [],
                "links": [],
            },
            "http://www.tadzzzb.gov.cn/art/pos.html": {
                "id": "ta-pos",
                "source_id": "sd-16cities-gwy",
                "source_city": "泰安",
                "title": "2027年度泰安市各级机关公务员招录职位表",
                "published_at": "2026-11-05",
                "source_url": "http://www.tadzzzb.gov.cn/art/pos.html",
                "attachments": [{"title": "泰安市职位表.xls", "url": "http://www.tadzzzb.gov.cn/pos.xls"}],
                "exam_positions": [{"row_id": "ta-r1", "position_name": "一级科员", "recruit_count": 3}],
            },
        }
        merge_sibling_position_table_entries(taian_by_url)
        merged_taian = list(taian_by_url.values())
        self.assertEqual(len(merged_taian), 1)
        self.assertEqual(merged_taian[0]["id"], "ta-ann")
        self.assertEqual(len(merged_taian[0]["attachments"]), 1)
        self.assertEqual(len(merged_taian[0]["exam_positions"]), 1)

    def test_offline_preserves_last_success_at_and_live_all_fail_aborts_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "exams-seed-in"
            offline_out = root / "exams-offline-out"
            failed_live_out = root / "exams-failed-out"
            seed_dir.mkdir(parents=True)

            genuine_success_ts = "2026-11-18T09:30:00+08:00"
            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": "2026-11-18T09:35:00+08:00",
                    "last_success_at": genuine_success_ts,
                    "total_exams": 1,
                    "total_positions": 1,
                    "total_headcount": 2,
                    "total_exams_with_positions": 1,
                    "cities": ["济南"],
                    "exams": [
                        {
                            "id": "0a111111111111111111",
                            "title": "2026年济南市事业单位公开招聘工作人员简章",
                            "organizer": "济南市人力资源和社会保障局",
                            "source_id": "jinan-hrss-exam",
                            "source_name": "济南市人社局 · 事业单位公开招聘",
                            "source_url": "https://jnhrss.jinan.gov.cn/art/2026/11/18/art_18625_1.html",
                            "published_at": "2026-11-18",
                            "excerpt": "报名时间：2026年11月20日9:00—11月26日16:00。",
                            "body": "本次公开招聘共2人。报名时间：2026年11月20日9:00—11月26日16:00。",
                            "attachments": [{"title": "岗位汇总表.xlsx", "url": "https://jnhrss.jinan.gov.cn/1.xlsx"}],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "r1",
                                    "exam_id": "0a111111111111111111",
                                    "department": "济南市人力资源和社会保障局",
                                    "employer": "济南市大数据中心",
                                    "position_name": "数据分析岗",
                                    "recruit_count": 2,
                                    "major_raw": "计算机科学与技术",
                                    "source": "attachment",
                                }
                            ],
                        }
                    ],
                    "sources": [
                        {
                            "id": "jinan-hrss-exam",
                            "name": "济南市人社局",
                            "url": "https://jnhrss.jinan.gov.cn/",
                            "status": "ok",
                            "count": 1,
                            "last_success_at": genuine_success_ts,
                            "errors": [],
                        }
                    ],
                },
                seed_dir,
            )

            # 1. --offline-only with isolated --seed-dir -> --public-dir preserves genuine last_success_at
            res = collect_and_export_exams(
                public_dir=offline_out,
                live_crawl=False,
                live_site="",
                seed_dir=seed_dir,
            )
            self.assertEqual(res["last_success_at"], genuine_success_ts)
            self.assertNotEqual(res["generated_at"], genuine_success_ts)
            written = json.loads((offline_out / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(written["last_success_at"], genuine_success_ts)
            jn_src = next(s for s in written["sources"] if s["id"] == "jinan-hrss-exam")
            self.assertEqual(jn_src["last_success_at"], genuine_success_ts)

            # 2. Live crawl when all active portals fail raises error and leaves output directory empty
            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=OSError("network unreachable")),
                patch("scripts.collect_exams.c.sdei_news_list", side_effect=OSError("network unreachable")),
                patch("scripts.collect_exams.c.jinan_cms_list", side_effect=OSError("network unreachable")),
            ):
                with self.assertRaises(RuntimeError):
                    collect_and_export_exams(
                        public_dir=failed_live_out,
                        live_crawl=True,
                        live_site="",
                        seed_dir=seed_dir,
                    )
            self.assertFalse((failed_live_out / "exams.json").exists())

    def test_in_place_xlsx_replacement_rechecks_and_updates_positions(self):
        today = dt.datetime.now(TZ).date()
        pub_str = (today - dt.timedelta(days=2)).isoformat()
        reg_start = (today - dt.timedelta(days=1)).isoformat()
        reg_end = (today + dt.timedelta(days=7)).isoformat()
        old_verified = (today - dt.timedelta(days=2)).isoformat()

        url_updated = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/t20261120_1001.html"
        id_updated = hashlib.sha256(url_updated.encode("utf-8")).hexdigest()[:20]
        old_xlsx_url = "https://hrss.qingdao.gov.cn/attach/positions_v1.xls"
        new_xlsx_url = "https://hrss.qingdao.gov.cn/attach/positions_v2.xls"

        url_flaky = "https://hrss.zibo.gov.cn/art/2026/11/20/art_100_2002.html"
        id_flaky = hashlib.sha256(url_flaky.encode("utf-8")).hexdigest()[:20]
        flaky_xlsx_url = "https://hrss.zibo.gov.cn/attach/zb_positions.xls"

        body_text = (
            f"2026年青岛市市属事业单位公开招聘工作人员简章。"
            f"报名时间：{reg_start[:4]}年{int(reg_start[5:7])}月{int(reg_start[8:10])}日9:00—"
            f"{int(reg_end[5:7])}月{int(reg_end[8:10])}日16:00。详见附件岗位汇总表。"
        )
        flaky_body_text = (
            f"2026年淄博市市属事业单位公开招聘工作人员简章。"
            f"报名时间：{reg_start[:4]}年{int(reg_start[5:7])}月{int(reg_start[8:10])}日9:00—"
            f"{int(reg_end[5:7])}月{int(reg_end[8:10])}日16:00。"
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            out_dir = root / "out"
            seed_dir.mkdir(parents=True)

            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": f"{pub_str}T10:00:00+08:00",
                    "last_success_at": f"{pub_str}T10:00:00+08:00",
                    "total_exams": 2,
                    "total_positions": 2,
                    "total_headcount": 3,
                    "total_exams_with_positions": 2,
                    "cities": ["青岛", "淄博"],
                    "exams": [
                        {
                            "id": id_updated,
                            "title": "2026年青岛市市属事业单位公开招聘工作人员简章",
                            "organizer": "青岛市人力资源和社会保障局",
                            "notice_role": "招考简章",
                            "stage": "registering",
                            "schedule": {"reg_start": reg_start, "reg_end": reg_end, "reg_mode": "window"},
                            "source_id": "qingdao-hrss-exam",
                            "source_name": "青岛市人社局 · 公开招聘与引才专区",
                            "source_url": url_updated,
                            "published_at": pub_str,
                            "last_verified_at": old_verified,
                            "positions_status": "parsed",
                            "excerpt": body_text[:120],
                            "body": body_text,
                            "attachments": [{"title": "附件1：公开招聘岗位汇总表.xls", "url": old_xlsx_url}],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "old-row-1",
                                    "exam_id": id_updated,
                                    "department": "青岛市人社局",
                                    "employer": "青岛市某旧单位",
                                    "position_name": "旧综合管理岗",
                                    "recruit_count": 1,
                                    "major_raw": "汉语言文学",
                                    "source": "attachment",
                                }
                            ],
                        },
                        {
                            "id": id_flaky,
                            "title": "2026年淄博市市属事业单位公开招聘工作人员简章",
                            "organizer": "淄博市人力资源和社会保障局",
                            "notice_role": "招考简章",
                            "stage": "registering",
                            "schedule": {"reg_start": reg_start, "reg_end": reg_end, "reg_mode": "window"},
                            "source_id": "zibo-hrss-exam",
                            "source_name": "淄博市人社局 · 事业单位招考与引才",
                            "source_url": url_flaky,
                            "published_at": pub_str,
                            "last_verified_at": old_verified,
                            "positions_status": "parsed",
                            "excerpt": flaky_body_text[:120],
                            "body": flaky_body_text,
                            "attachments": [{"title": "附件1：淄博岗位汇总表.xls", "url": flaky_xlsx_url}],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "zb-row-1",
                                    "exam_id": id_flaky,
                                    "department": "淄博市人社局",
                                    "employer": "淄博市大数据局",
                                    "position_name": "保留测试岗",
                                    "recruit_count": 2,
                                    "major_raw": "软件工程",
                                    "source": "attachment",
                                }
                            ],
                        },
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            qd_list_html = f"""
            <ul>
              <li><a href="{url_updated}">2026年青岛市市属事业单位公开招聘工作人员简章</a> {pub_str}</li>
            </ul>
            """
            updated_detail_html = f"""
            <div class="TRS_Editor">
              <p>{body_text}</p>
              <p><a href="{new_xlsx_url}">附件1：公开招聘岗位汇总表（修订版）.xls</a></p>
            </div>
            """
            new_xls_bytes = """<table>
              <tr><th>招聘单位</th><th>岗位名称</th><th>计划人数</th><th>学历</th><th>专业要求</th></tr>
              <tr><td>青岛市数字政府中心</td><td>云平台架构岗</td><td>4</td><td>硕士研究生</td><td>计算机科学与技术</td></tr>
              <tr><td>青岛市数字政府中心</td><td>网络安全监管岗</td><td>2</td><td>本科及以上</td><td>网络空间安全</td></tr>
            </table>""".encode("utf-8")

            def fake_fetch_html(url: str, timeout: float = 6.0, referer: str = "") -> str:
                if url == "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/":
                    return qd_list_html
                if url == url_updated:
                    return updated_detail_html
                if url == url_flaky:
                    raise TimeoutError("transient detail timeout")
                return "<html><body><ul></ul></body></html>"

            def fake_fetch_bytes(url: str, timeout: float = 6.0, max_bytes: int = 4_000_000):
                if url == new_xlsx_url:
                    return new_xls_bytes
                return None

            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch("scripts.collect_exams.fetch_bytes_quick", side_effect=fake_fetch_bytes),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=out_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=seed_dir,
                )

            written_snap = json.loads((out_dir / "exams.json").read_text(encoding="utf-8"))
            hydrated = hydrate_exam_snapshot(
                written_snap,
                lambda rel: json.loads((out_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            by_id = {e["id"]: e for e in hydrated["exams"]}

            # 1. Updated Qingdao notice replaced old .xls with new .xls and parsed the 2 new positions
            qd_exam = by_id[id_updated]
            self.assertEqual([a["url"] for a in qd_exam["attachments"]], [new_xlsx_url])
            self.assertEqual(len(qd_exam["positions"]), 2)
            self.assertEqual(
                {p["position_name"] for p in qd_exam["positions"]},
                {"云平台架构岗", "网络安全监管岗"},
            )
            self.assertNotEqual(qd_exam["last_verified_at"], old_verified)
            self.assertNotIn("_force_refresh_detail", qd_exam)

            # 2. Transiently failing Zibo notice preserved its existing positions and attachments intact
            zb_exam = by_id[id_flaky]
            self.assertEqual(len(zb_exam["positions"]), 1)
            self.assertEqual(zb_exam["positions"][0]["position_name"], "保留测试岗")
            self.assertEqual([a["url"] for a in zb_exam["attachments"]], [flaky_xlsx_url])

    def test_new_xlsx_download_failure_preserves_old_positions_and_recovers_next_round(self):
        today = dt.datetime.now(TZ).date()
        pub_str = (today - dt.timedelta(days=2)).isoformat()
        reg_start = (today - dt.timedelta(days=1)).isoformat()
        reg_end = (today + dt.timedelta(days=6)).isoformat()
        old_verified = f"{(today - dt.timedelta(days=2)).isoformat()}T08:00:00+08:00"

        url_notice = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/t20261120_retry.shtml"
        exam_id = hashlib.sha256(url_notice.encode("utf-8")).hexdigest()[:20]
        v1_xls_url = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/positions_v1.xls"
        v2_xls_url = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/positions_v2.xls"
        body_text = (
            "青岛市人力资源和社会保障局面向社会公开招聘事业单位工作人员10名。"
            f"报名时间：{reg_start[:4]}年{int(reg_start[5:7])}月{int(reg_start[8:10])}日9:00—"
            f"{int(reg_end[5:7])}月{int(reg_end[8:10])}日16:00。"
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            round2_dir = root / "round2"
            round3_dir = root / "round3"
            seed_dir.mkdir(parents=True)

            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": f"{pub_str}T10:00:00+08:00",
                    "last_success_at": f"{pub_str}T10:00:00+08:00",
                    "total_exams": 1,
                    "total_positions": 1,
                    "total_headcount": 1,
                    "total_exams_with_positions": 1,
                    "cities": ["青岛"],
                    "exams": [
                        {
                            "id": exam_id,
                            "title": "2026年青岛市市属事业单位公开招聘工作人员简章",
                            "organizer": "青岛市人力资源和社会保障局",
                            "notice_role": "招考简章",
                            "stage": "registering",
                            "schedule": {"reg_start": reg_start, "reg_end": reg_end, "reg_mode": "window"},
                            "source_id": "qingdao-hrss-exam",
                            "source_name": "青岛市人社局 · 公开招聘与引才专区",
                            "source_url": url_notice,
                            "published_at": pub_str,
                            "last_verified_at": old_verified,
                            "positions_status": "parsed",
                            "excerpt": body_text[:120],
                            "body": body_text,
                            "attachments": [{"title": "附件1：公开招聘岗位汇总表.xls", "url": v1_xls_url}],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "old-row-1",
                                    "exam_id": exam_id,
                                    "department": "青岛市人社局",
                                    "employer": "青岛市某旧单位",
                                    "position_name": "旧综合管理岗",
                                    "recruit_count": 1,
                                    "major_raw": "汉语言文学",
                                    "source": "attachment",
                                }
                            ],
                        }
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            qd_list_html = f'<ul><li><a href="{url_notice}">2026年青岛市市属事业单位公开招聘工作人员简章</a> {pub_str}</li></ul>'
            v2_detail_html = f'<div class="TRS_Editor"><p>{body_text}</p><p><a href="{v2_xls_url}">附件1：公开招聘岗位汇总表（修订版）.xls</a></p></div>'

            def fake_fetch_html(url: str, timeout: float = 6.0, referer: str = "") -> str:
                if url == "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/":
                    return qd_list_html
                if url == url_notice:
                    return v2_detail_html
                return "<html><body><ul></ul></body></html>"

            # Round 2: new Excel URL download fails -> old 1 position MUST be preserved and marked pending recheck
            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch("scripts.collect_exams.fetch_bytes_quick", return_value=None),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round2_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=seed_dir,
                )

            snap_r2 = json.loads((round2_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(snap_r2["total_positions"], 1)
            slim_r2 = snap_r2["exams"][0]
            self.assertEqual(slim_r2["parsed_position_count"], 1)
            self.assertTrue(slim_r2.get("positions_pending_recheck"))

            hydrated_r2 = hydrate_exam_snapshot(
                snap_r2,
                lambda rel: json.loads((round2_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r2 = hydrated_r2["exams"][0]
            self.assertEqual(len(qd_r2["positions"]), 1)
            self.assertEqual(qd_r2["positions"][0]["position_name"], "旧综合管理岗")
            self.assertEqual(qd_r2["attachments"][0]["url"], v2_xls_url)
            self.assertEqual(qd_r2["attachments"][0].get("parse_status"), "deferred")

            # Round 3: network recovers -> deferred v2 Excel parses into 2 new positions and clears pending flag
            v2_xls_bytes = """<table>
              <tr><th>招聘单位</th><th>岗位名称</th><th>计划人数</th><th>学历</th><th>专业要求</th></tr>
              <tr><td>青岛市数字政府中心</td><td>云平台架构岗</td><td>4</td><td>硕士研究生</td><td>计算机科学与技术</td></tr>
              <tr><td>青岛市数字政府中心</td><td>网络安全监管岗</td><td>2</td><td>本科及以上</td><td>网络空间安全</td></tr>
            </table>""".encode("utf-8")

            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch(
                    "scripts.collect_exams.fetch_bytes_quick",
                    side_effect=lambda u, timeout=6.0, max_bytes=4_000_000: v2_xls_bytes if u == v2_xls_url else None,
                ),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round3_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=round2_dir,
                )

            snap_r3 = json.loads((round3_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(snap_r3["total_positions"], 2)
            self.assertNotIn("positions_pending_recheck", snap_r3["exams"][0])
            hydrated_r3 = hydrate_exam_snapshot(
                snap_r3,
                lambda rel: json.loads((round3_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r3 = hydrated_r3["exams"][0]
            self.assertEqual({p["position_name"] for p in qd_r3["positions"]}, {"云平台架构岗", "网络安全监管岗"})
            self.assertEqual(qd_r3["attachments"][0].get("parse_status"), "parsed")

    def test_same_url_xlsx_overwrite_and_conditional_304_revalidation(self):
        import io
        import urllib.error

        today = dt.datetime.now(TZ).date()
        pub_str = (today - dt.timedelta(days=2)).isoformat()
        reg_start = (today - dt.timedelta(days=1)).isoformat()
        reg_end = (today + dt.timedelta(days=6)).isoformat()
        old_verified = f"{(today - dt.timedelta(days=2)).isoformat()}T08:00:00+08:00"

        url_notice = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/t20261120_sameurl.shtml"
        exam_id = hashlib.sha256(url_notice.encode("utf-8")).hexdigest()[:20]
        same_xls_url = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/positions_same.xls"
        body_text = (
            "青岛市人力资源和社会保障局面向社会公开招聘事业单位工作人员10名。"
            f"报名时间：{reg_start[:4]}年{int(reg_start[5:7])}月{int(reg_start[8:10])}日9:00—"
            f"{int(reg_end[5:7])}月{int(reg_end[8:10])}日16:00。"
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            round2_dir = root / "round2"
            round3_dir = root / "round3"
            seed_dir.mkdir(parents=True)

            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": f"{pub_str}T10:00:00+08:00",
                    "last_success_at": f"{pub_str}T10:00:00+08:00",
                    "total_exams": 1,
                    "total_positions": 1,
                    "total_headcount": 1,
                    "total_exams_with_positions": 1,
                    "cities": ["青岛"],
                    "exams": [
                        {
                            "id": exam_id,
                            "title": "2026年青岛市市属事业单位公开招聘工作人员简章",
                            "organizer": "青岛市人力资源和社会保障局",
                            "notice_role": "招考简章",
                            "stage": "registering",
                            "schedule": {"reg_start": reg_start, "reg_end": reg_end, "reg_mode": "window"},
                            "source_id": "qingdao-hrss-exam",
                            "source_name": "青岛市人社局 · 公开招聘与引才专区",
                            "source_url": url_notice,
                            "published_at": pub_str,
                            "last_verified_at": old_verified,
                            "positions_status": "parsed",
                            "excerpt": body_text[:120],
                            "body": body_text,
                            "attachments": [{"title": "附件1：公开招聘岗位汇总表.xls", "url": same_xls_url}],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "old-row-1",
                                    "exam_id": exam_id,
                                    "department": "青岛市人社局",
                                    "employer": "青岛市某旧单位",
                                    "position_name": "旧综合管理岗",
                                    "recruit_count": 1,
                                    "major_raw": "汉语言文学",
                                    "source": "attachment",
                                    "source_url": same_xls_url,
                                }
                            ],
                        }
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            # Identical HTML body and identical attachment URL in both rounds
            qd_list_html = f'<ul><li><a href="{url_notice}">2026年青岛市市属事业单位公开招聘工作人员简章</a> {pub_str}</li></ul>'
            same_detail_html = f'<div class="TRS_Editor"><p>{body_text}</p><p><a href="{same_xls_url}">附件1：公开招聘岗位汇总表.xls</a></p></div>'
            overwritten_xls_bytes = """<table>
              <tr><th>招聘单位</th><th>岗位名称</th><th>计划人数</th><th>学历</th><th>专业要求</th></tr>
              <tr><td>青岛市财政局</td><td>财政绩效管理岗</td><td>3</td><td>硕士研究生</td><td>财政学、金融学</td></tr>
              <tr><td>青岛市财政局</td><td>预算评审岗</td><td>2</td><td>本科及以上</td><td>会计学、审计学</td></tr>
            </table>""".encode("utf-8")

            def fake_fetch_html(url: str, timeout: float = 6.0, referer: str = "") -> str:
                if url == "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/":
                    return qd_list_html
                if url == url_notice:
                    return same_detail_html
                return "<html><body><ul></ul></body></html>"

            class FakeHttpResp(io.BytesIO):
                def __init__(self, data: bytes, headers: dict):
                    super().__init__(data)
                    self.headers = headers

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    self.close()

            att_requests_r2 = []

            def fake_opener_r2(req, timeout=6.0):
                att_requests_r2.append((req.full_url, dict(req.header_items())))
                if req.full_url == same_xls_url:
                    return FakeHttpResp(
                        overwritten_xls_bytes,
                        {"ETag": '"v2-hash"', "Last-Modified": "Wed, 25 Nov 2026 06:00:00 GMT"},
                    )
                raise urllib.error.URLError("unexpected url")

            # Round 2: same URL overwritten with new Excel bytes -> must request attachment and update to 2 positions
            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch("scripts.collect_exams.c.OPENER.open", side_effect=fake_opener_r2),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round2_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=seed_dir,
                )

            self.assertEqual(len([u for u, _ in att_requests_r2 if u == same_xls_url]), 1)
            snap_r2 = json.loads((round2_dir / "exams.json").read_text(encoding="utf-8"))
            hydrated_r2 = hydrate_exam_snapshot(
                snap_r2,
                lambda rel: json.loads((round2_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r2 = hydrated_r2["exams"][0]
            self.assertEqual(
                {p["position_name"] for p in qd_r2["positions"]},
                {"财政绩效管理岗", "预算评审岗"},
            )
            self.assertEqual(qd_r2["attachments"][0].get("etag"), '"v2-hash"')
            self.assertEqual(
                qd_r2["attachments"][0].get("sha256"),
                hashlib.sha256(overwritten_xls_bytes).hexdigest(),
            )

            # Round 3: server supports conditional request (304 Not Modified) -> sends If-None-Match and reuses 2 rows
            att_requests_r3 = []

            def fake_opener_r3(req, timeout=6.0):
                hdrs = {k.lower(): v for k, v in req.header_items()}
                att_requests_r3.append((req.full_url, hdrs))
                if req.full_url == same_xls_url and hdrs.get("if-none-match") == '"v2-hash"':
                    raise urllib.error.HTTPError(same_xls_url, 304, "Not Modified", {}, None)
                raise urllib.error.URLError("expected conditional 304")

            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch("scripts.collect_exams.c.OPENER.open", side_effect=fake_opener_r3),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round3_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=round2_dir,
                )

            self.assertEqual(len([u for u, _ in att_requests_r3 if u == same_xls_url]), 1)
            snap_r3 = json.loads((round3_dir / "exams.json").read_text(encoding="utf-8"))
            hydrated_r3 = hydrate_exam_snapshot(
                snap_r3,
                lambda rel: json.loads((round3_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r3 = hydrated_r3["exams"][0]
            self.assertEqual(
                {p["position_name"] for p in qd_r3["positions"]},
                {"财政绩效管理岗", "预算评审岗"},
            )
            self.assertEqual(qd_r3["attachments"][0].get("etag"), '"v2-hash"')

    def test_sibling_merge_and_offline_export_heal_mismatched_exam_id(self):
        from scripts.collect_exams import merge_sibling_position_table_entries

        notice_url = "https://taian.dtdjzx.gov.cn/web/p896/lytzgg/131272.html"
        table_url = "https://taian.dtdjzx.gov.cn/web/p896/lytzgg/131273.html"
        notice_id = hashlib.sha256(notice_url.encode("utf-8")).hexdigest()[:20]
        table_id = hashlib.sha256(table_url.encode("utf-8")).hexdigest()[:20]

        # 1. Source merge must rewrite exam_id on copied sibling positions to the parent notice id
        raw_by_url = {
            notice_url: {
                "id": notice_id,
                "title": "2027年度泰安市各级机关考试录用公务员公告",
                "source_url": notice_url,
                "body": "按照2027年度山东省各级机关考试录用公务员统一部署，泰安市公开招录公务员。" * 5,
                "attachments": [],
            },
            table_url: {
                "id": table_id,
                "title": "2027年度泰安市各级机关公务员招录职位表",
                "source_url": table_url,
                "body": "下载附件",
                "attachments": [
                    {
                        "title": "2027年度泰安市各级机关公务员招录职位表",
                        "url": "https://dyjyzyk.dtdjzx.gov.cn/file/taian.xlsx",
                    }
                ],
                "exam_positions": [
                    {
                        "row_id": "old-taian-row",
                        "exam_id": table_id,
                        "department": "中共泰安市纪律检查委员会",
                        "employer": "机关及所属机构",
                        "position_name": "监督检查审查调查职位",
                        "recruit_count": 2,
                        "major_raw": "法学类",
                        "source": "attachment",
                    }
                ],
            },
        }
        merge_sibling_position_table_entries(raw_by_url)
        self.assertIn(notice_url, raw_by_url)
        self.assertNotIn(table_url, raw_by_url)
        copied_rows = raw_by_url[notice_url]["exam_positions"]
        self.assertEqual(len(copied_rows), 1)
        self.assertEqual(copied_rows[0]["exam_id"], notice_id)

        # 2. Offline export heals pre-existing historical snapshots whose positions carry stale exam_id
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            out_dir = root / "out"
            seed_dir.mkdir(parents=True)

            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": "2026-11-25T18:00:00+08:00",
                    "last_success_at": "2026-11-25T18:00:00+08:00",
                    "total_exams": 1,
                    "total_positions": 1,
                    "total_headcount": 2,
                    "total_exams_with_positions": 1,
                    "cities": ["泰安"],
                    "exams": [
                        {
                            "id": notice_id,
                            "title": "2027年度泰安市各级机关考试录用公务员公告",
                            "organizer": "中共泰安市委组织部",
                            "notice_role": "招考简章",
                            "stage": "ended",
                            "schedule": {"reg_start": "2026-11-06", "reg_end": "2026-11-09", "reg_mode": "window"},
                            "source_id": "sd-16cities-gwy",
                            "source_name": "山东省16市组织部 · 灯塔地市公务员招录专栏",
                            "source_url": notice_url,
                            "published_at": "2026-11-04",
                            "last_verified_at": "2026-11-25T18:00:00+08:00",
                            "positions_status": "parsed",
                            "excerpt": "泰安市2027年度公务员招录公告",
                            "body": "2027年度泰安市各级机关考试录用公务员公告，报名时间：2026年11月6日至11月9日。",
                            "attachments": [],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "stale-row",
                                    "exam_id": "1e18b2447b8f00d690c5",
                                    "department": "中共泰安市纪律检查委员会",
                                    "employer": "机关及所属机构",
                                    "position_name": "监督检查审查调查职位",
                                    "recruit_count": 2,
                                    "major_raw": "法学类",
                                    "source": "attachment",
                                }
                            ],
                        }
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            collect_and_export_exams(
                public_dir=out_dir,
                live_crawl=False,
                live_site="",
                seed_dir=seed_dir,
            )

            snap = json.loads((out_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertEqual(snap["last_success_at"], "2026-11-25T18:00:00+08:00")
            pos_payload = json.loads((out_dir / snap["positions_url"].lstrip("/")).read_text(encoding="utf-8"))
            healed_rows = pos_payload["positions_by_exam"][notice_id]
            self.assertEqual(len(healed_rows), 1)
            self.assertEqual(healed_rows[0]["exam_id"], notice_id)

    def test_multi_attachment_partial_timeout_preserves_failed_table_positions(self):
        today = dt.datetime.now(TZ).date()
        pub_str = (today - dt.timedelta(days=2)).isoformat()
        reg_start = (today - dt.timedelta(days=1)).isoformat()
        reg_end = (today + dt.timedelta(days=6)).isoformat()
        old_verified = f"{(today - dt.timedelta(days=2)).isoformat()}T08:00:00+08:00"

        url_notice = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/t20261120_multiatt.shtml"
        exam_id = hashlib.sha256(url_notice.encode("utf-8")).hexdigest()[:20]
        att1_url = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/table_a.xls"
        att2_url = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/table_b.xls"
        body_text = (
            "青岛市人力资源和社会保障局面向社会公开招聘事业单位工作人员20名。"
            f"报名时间：{reg_start[:4]}年{int(reg_start[5:7])}月{int(reg_start[8:10])}日9:00—"
            f"{int(reg_end[5:7])}月{int(reg_end[8:10])}日16:00。"
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            round2_dir = root / "round2"
            round3_dir = root / "round3"
            seed_dir.mkdir(parents=True)

            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": f"{pub_str}T10:00:00+08:00",
                    "last_success_at": f"{pub_str}T10:00:00+08:00",
                    "total_exams": 1,
                    "total_positions": 2,
                    "total_headcount": 3,
                    "total_exams_with_positions": 1,
                    "cities": ["青岛"],
                    "exams": [
                        {
                            "id": exam_id,
                            "title": "2026年青岛市市属事业单位公开招聘工作人员简章",
                            "organizer": "青岛市人力资源和社会保障局",
                            "notice_role": "招考简章",
                            "stage": "registering",
                            "schedule": {"reg_start": reg_start, "reg_end": reg_end, "reg_mode": "window"},
                            "source_id": "qingdao-hrss-exam",
                            "source_name": "青岛市人社局 · 公开招聘与引才专区",
                            "source_url": url_notice,
                            "published_at": pub_str,
                            "last_verified_at": old_verified,
                            "positions_status": "parsed",
                            "excerpt": body_text[:120],
                            "body": body_text,
                            "attachments": [
                                {"title": "附件1：综合类岗位汇总表.xls", "url": att1_url, "parse_status": "parsed"},
                                {"title": "附件2：卫生类岗位汇总表.xls", "url": att2_url, "parse_status": "parsed"},
                            ],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "a-old-1",
                                    "exam_id": exam_id,
                                    "department": "青岛市人社局",
                                    "employer": "青岛市综合中心",
                                    "position_name": "旧综合岗A",
                                    "recruit_count": 1,
                                    "major_raw": "汉语言文学",
                                    "source": "attachment",
                                    "source_file": "附件1：综合类岗位汇总表.xls",
                                    "source_url": att1_url,
                                },
                                {
                                    "row_id": "b-old-1",
                                    "exam_id": exam_id,
                                    "department": "青岛市卫健委",
                                    "employer": "青岛市市立医院",
                                    "position_name": "旧临床医师岗B",
                                    "recruit_count": 2,
                                    "major_raw": "临床医学",
                                    "source": "attachment",
                                    "source_file": "附件2：卫生类岗位汇总表.xls",
                                    "source_url": att2_url,
                                },
                            ],
                        }
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            qd_list_html = f'<ul><li><a href="{url_notice}">2026年青岛市市属事业单位公开招聘工作人员简章</a> {pub_str}</li></ul>'
            detail_html = (
                f'<div class="TRS_Editor"><p>{body_text}</p>'
                f'<p><a href="{att1_url}">附件1：综合类岗位汇总表.xls</a></p>'
                f'<p><a href="{att2_url}">附件2：卫生类岗位汇总表.xls</a></p></div>'
            )
            att1_new_bytes = """<table>
              <tr><th>招聘单位</th><th>岗位名称</th><th>计划人数</th><th>学历</th><th>专业要求</th></tr>
              <tr><td>青岛市综合中心</td><td>新数据治理岗A1</td><td>2</td><td>硕士研究生</td><td>计算机科学与技术</td></tr>
              <tr><td>青岛市综合中心</td><td>新财务审计岗A2</td><td>1</td><td>本科及以上</td><td>会计学</td></tr>
            </table>""".encode("utf-8")
            att2_new_bytes = """<table>
              <tr><th>招聘单位</th><th>岗位名称</th><th>计划人数</th><th>学历</th><th>专业要求</th></tr>
              <tr><td>青岛市市立医院</td><td>新外科医师岗B1</td><td>3</td><td>硕士研究生</td><td>临床医学</td></tr>
            </table>""".encode("utf-8")

            def fake_fetch_html(url: str, timeout: float = 6.0, referer: str = "") -> str:
                if url == "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/":
                    return qd_list_html
                if url == url_notice:
                    return detail_html
                return "<html><body><ul></ul></body></html>"

            # Round 2: att1 updates successfully, att2 times out -> MUST keep att1 new rows AND att2 old row!
            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch(
                    "scripts.collect_exams.fetch_bytes_quick",
                    side_effect=lambda u, timeout=6.0, max_bytes=4_000_000: att1_new_bytes if u == att1_url else None,
                ),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round2_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=seed_dir,
                )

            snap_r2 = json.loads((round2_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertTrue(snap_r2["exams"][0].get("positions_pending_recheck"))
            hydrated_r2 = hydrate_exam_snapshot(
                snap_r2,
                lambda rel: json.loads((round2_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r2 = hydrated_r2["exams"][0]
            self.assertEqual(
                {p["position_name"] for p in qd_r2["positions"]},
                {"新数据治理岗A1", "新财务审计岗A2", "旧临床医师岗B"},
            )
            att_status_r2 = {a["url"]: a.get("parse_status") for a in qd_r2["attachments"]}
            self.assertEqual(att_status_r2[att1_url], "parsed")
            self.assertEqual(att_status_r2[att2_url], "deferred")

            # Round 3: att2 recovers -> both attachments parsed cleanly, pending flag cleared
            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch(
                    "scripts.collect_exams.fetch_bytes_quick",
                    side_effect=lambda u, timeout=6.0, max_bytes=4_000_000: (
                        att1_new_bytes if u == att1_url else att2_new_bytes if u == att2_url else None
                    ),
                ),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round3_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=round2_dir,
                )

            snap_r3 = json.loads((round3_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertNotIn("positions_pending_recheck", snap_r3["exams"][0])
            hydrated_r3 = hydrate_exam_snapshot(
                snap_r3,
                lambda rel: json.loads((round3_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r3 = hydrated_r3["exams"][0]
            self.assertEqual(
                {p["position_name"] for p in qd_r3["positions"]},
                {"新数据治理岗A1", "新财务审计岗A2", "新外科医师岗B1"},
            )

    def test_unparseable_attachment_never_reused_as_parsed_on_subsequent_round(self):
        import io
        import urllib.error
        from scripts.collect_exams import parse_exam_attachment_bytes as real_parse_att

        today = dt.datetime.now(TZ).date()
        pub_str = (today - dt.timedelta(days=2)).isoformat()
        reg_start = (today - dt.timedelta(days=1)).isoformat()
        reg_end = (today + dt.timedelta(days=6)).isoformat()
        old_verified = f"{(today - dt.timedelta(days=2)).isoformat()}T08:00:00+08:00"

        url_notice = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/t20261120_badparse.shtml"
        exam_id = hashlib.sha256(url_notice.encode("utf-8")).hexdigest()[:20]
        att_url = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/positions_bad.xls"
        body_text = (
            "青岛市人力资源和社会保障局面向社会公开招聘事业单位工作人员10名。"
            f"报名时间：{reg_start[:4]}年{int(reg_start[5:7])}月{int(reg_start[8:10])}日9:00—"
            f"{int(reg_end[5:7])}月{int(reg_end[8:10])}日16:00。"
        )
        broken_bytes = b"<html><body><p>corrupt non-table document</p></body></html>"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            round2_dir = root / "round2"
            round3_dir = root / "round3"
            seed_dir.mkdir(parents=True)

            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": f"{pub_str}T10:00:00+08:00",
                    "last_success_at": f"{pub_str}T10:00:00+08:00",
                    "total_exams": 1,
                    "total_positions": 1,
                    "total_headcount": 1,
                    "total_exams_with_positions": 1,
                    "cities": ["青岛"],
                    "exams": [
                        {
                            "id": exam_id,
                            "title": "2026年青岛市市属事业单位公开招聘工作人员简章",
                            "organizer": "青岛市人力资源和社会保障局",
                            "notice_role": "招考简章",
                            "stage": "registering",
                            "schedule": {"reg_start": reg_start, "reg_end": reg_end, "reg_mode": "window"},
                            "source_id": "qingdao-hrss-exam",
                            "source_name": "青岛市人社局 · 公开招聘与引才专区",
                            "source_url": url_notice,
                            "published_at": pub_str,
                            "last_verified_at": old_verified,
                            "positions_status": "parsed",
                            "excerpt": body_text[:120],
                            "body": body_text,
                            "attachments": [
                                {
                                    "title": "附件1：公开招聘岗位汇总表.xls",
                                    "url": att_url,
                                    "parse_status": "parsed",
                                    "etag": '"v1-ok"',
                                    "sha256": "deadbeef" * 8,
                                }
                            ],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "v1-row-1",
                                    "exam_id": exam_id,
                                    "department": "青岛市人社局",
                                    "employer": "青岛市某单位",
                                    "position_name": "已核验旧岗V1",
                                    "recruit_count": 1,
                                    "major_raw": "经济学",
                                    "source": "attachment",
                                    "source_url": att_url,
                                }
                            ],
                        }
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            qd_list_html = f'<ul><li><a href="{url_notice}">2026年青岛市市属事业单位公开招聘工作人员简章</a> {pub_str}</li></ul>'
            detail_html = f'<div class="TRS_Editor"><p>{body_text}</p><p><a href="{att_url}">附件1：公开招聘岗位汇总表.xls</a></p></div>'

            def fake_fetch_html(url: str, timeout: float = 6.0, referer: str = "") -> str:
                if url == "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/":
                    return qd_list_html
                if url == url_notice:
                    return detail_html
                return "<html><body><ul></ul></body></html>"

            class FakeHttpResp(io.BytesIO):
                def __init__(self, data: bytes, headers: dict):
                    super().__init__(data)
                    self.headers = headers

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    self.close()

            # Round 2: server serves broken v2 file with ETag "v2-broken"; download succeeds but parse fails
            def fake_opener_v2(req, timeout=6.0):
                if req.full_url == att_url:
                    hdrs = {k.lower(): v for k, v in req.header_items()}
                    if hdrs.get("if-none-match") == '"v2-broken"':
                        raise urllib.error.HTTPError(att_url, 304, "Not Modified", {}, None)
                    return FakeHttpResp(broken_bytes, {"ETag": '"v2-broken"'})
                raise urllib.error.URLError("unexpected")

            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch("scripts.collect_exams.c.OPENER.open", side_effect=fake_opener_v2),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round2_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=seed_dir,
                )

            snap_r2 = json.loads((round2_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertTrue(snap_r2["exams"][0].get("positions_pending_recheck"))
            hydrated_r2 = hydrate_exam_snapshot(
                snap_r2,
                lambda rel: json.loads((round2_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r2 = hydrated_r2["exams"][0]
            self.assertEqual([p["position_name"] for p in qd_r2["positions"]], ["已核验旧岗V1"])
            self.assertEqual(qd_r2["attachments"][0].get("parse_status"), "deferred")
            # Failed v2 version metadata MUST NOT be persisted as a reusable parsed version
            self.assertNotIn("etag", qd_r2["attachments"][0])
            self.assertNotIn("sha256", qd_r2["attachments"][0])

            # Round 3: server still has v2-broken; MUST NOT send If-None-Match, MUST attempt parsing again,
            # and MUST remain deferred with positions_pending_recheck=True
            r3_req_headers = []
            parse_calls = 0

            def counting_parse(*args, **kwargs):
                nonlocal parse_calls
                parse_calls += 1
                return real_parse_att(*args, **kwargs)

            def fake_opener_r3(req, timeout=6.0):
                if req.full_url == att_url:
                    hdrs = {k.lower(): v for k, v in req.header_items()}
                    r3_req_headers.append(hdrs)
                    if hdrs.get("if-none-match") == '"v2-broken"':
                        raise urllib.error.HTTPError(att_url, 304, "Not Modified", {}, None)
                    return FakeHttpResp(broken_bytes, {"ETag": '"v2-broken"'})
                raise urllib.error.URLError("unexpected")

            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch("scripts.collect_exams.c.OPENER.open", side_effect=fake_opener_r3),
                patch("scripts.collect_exams.parse_exam_attachment_bytes", side_effect=counting_parse),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=round3_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=round2_dir,
                )

            self.assertEqual(len(r3_req_headers), 1)
            self.assertNotIn("if-none-match", r3_req_headers[0])
            self.assertEqual(parse_calls, 1)
            snap_r3 = json.loads((round3_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertTrue(snap_r3["exams"][0].get("positions_pending_recheck"))
            hydrated_r3 = hydrate_exam_snapshot(
                snap_r3,
                lambda rel: json.loads((round3_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd_r3 = hydrated_r3["exams"][0]
            self.assertEqual([p["position_name"] for p in qd_r3["positions"]], ["已核验旧岗V1"])
            self.assertEqual(qd_r3["attachments"][0].get("parse_status"), "deferred")

    def test_dezhou_real_pdf_parses_exact_eight_positions_across_two_pages(self):
        fixture = Path(__file__).parent / "fixtures" / "exams" / "dezhou_2026_positions.pdf"
        raw_bytes = fixture.read_bytes()
        rows = parse_exam_attachment_bytes(
            raw_bytes,
            exam_id="8d7aae1d032277666b47",
            default_bianzhi="事业编",
            default_city="德州",
            default_employer="德州智能技术职业学院",
            filename="德州智能技术职业学院2026年公开招聘工作人员岗位计划表.pdf",
            url="https://html.gxjy.sdei.edu.cn/manageredu/userfiles/file/2026/07/03/1783132477078.pdf",
        )
        expected = [
            ("A01", "教师1", 3),
            ("A02", "教师2", 5),
            ("A03", "教师3", 6),
            ("A04", "教师4", 4),
            ("A05", "教师5", 5),
            ("A06", "教师6", 5),
            ("A07", "教师7", 4),
            ("A08", "教师8", 3),
        ]
        self.assertEqual(len(rows), 8)
        self.assertEqual(
            [(r["position_code"], r["position_name"], r["recruit_count"]) for r in rows],
            expected,
        )
        self.assertEqual(len({r["position_code"] for r in rows}), 8)
        self.assertTrue(all(r["education"] == "研究生" for r in rows))
        self.assertTrue(all(r["degree"] == "硕士及以上" for r in rows))
        self.assertTrue(all(r["position_category"] == "专业技术岗位" for r in rows))
        self.assertTrue(all(r["employer"] == "德州智能技术职业学院" for r in rows))
        self.assertIn("智能科学与技术一级学科", rows[0]["major_raw"])
        self.assertNotIn("智能科学与技 术", rows[0]["major_raw"])

    def test_sanzhiyifu_2025_real_xls_parses_all_793_positions_with_leading_zero_and_ended_stage(self):
        import io
        import openpyxl

        fixture = Path(__file__).parent / "fixtures" / "exams" / "sanzhiyifu_2025_positions.xls"
        raw_bytes = fixture.read_bytes()
        rows = parse_exam_attachment_bytes(
            raw_bytes,
            exam_id="a9b15db57a922069a42e",
            default_bianzhi="三支一扶 / 基层项目",
            default_city="",
            default_employer="",
            filename="附件1：2025年山东省高校毕业生“三支一扶”计划招募岗位表.xlsx",
            url="https://html.gxjy.sdei.edu.cn/manageredu/userfiles/file/2025/02/27/1743142464268.xls",
        )
        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
        raw_sheet_rows = list(wb[wb.sheetnames[0]].iter_rows(values_only=True))[3:]
        wb.close()

        self.assertEqual(len(raw_sheet_rows), 793)
        self.assertEqual(len(rows), 793)

        # Verify first row explicitly (including leading zero '01001')
        first = rows[0]
        self.assertEqual(first["position_code"], "01001")
        self.assertEqual(first["city"], "济南市章丘区")
        self.assertEqual(first["employer"], "明水街道办事处")
        self.assertEqual(first["position_name"], "就业和社会保障服务平台")
        self.assertEqual(first["position_category"], "就业和社会保障服务平台")
        self.assertEqual(first["recruit_count"], 1)
        self.assertNotIn("专科：/", first["major_raw"])

        # Row-by-row comparison against every single raw row in the official workbook
        from scripts.parse_exam_positions import clean_exam_cell

        for idx, (parsed, raw_r) in enumerate(zip(rows, raw_sheet_rows)):
            raw_city = clean_exam_cell(raw_r[1])
            raw_county = clean_exam_cell(raw_r[2])
            raw_unit = clean_exam_cell(raw_r[3])
            raw_code_val = raw_r[4]
            expected_code = (
                str(int(raw_code_val))
                if isinstance(raw_code_val, float) and raw_code_val.is_integer()
                else clean_exam_cell(raw_code_val)
            )
            expected_count = int(raw_r[5])
            raw_type = clean_exam_cell(raw_r[6])

            self.assertEqual(parsed["position_code"], expected_code, f"row {idx} position_code")
            self.assertEqual(parsed["employer"], raw_unit, f"row {idx} employer")
            self.assertEqual(parsed["recruit_count"], expected_count, f"row {idx} recruit_count")
            self.assertEqual(parsed["position_category"], raw_type, f"row {idx} position_category")
            self.assertIn(raw_city, parsed["city"], f"row {idx} city")
            self.assertIn(raw_county, parsed["city"], f"row {idx} county")
            self.assertNotEqual(parsed["position_name"], "公开招聘岗位", f"row {idx} placeholder pos")
            self.assertNotEqual(parsed["employer"], "用人单位见简章", f"row {idx} placeholder emp")

        # Verify 2025 recruitment stays marked as ended when enriched
        enriched = enrich_exam_record(
            {
                "id": "a9b15db57a922069a42e",
                "title": "2025年山东省高校毕业生“三支一扶”计划招募公告",
                "source_id": "sdei-civil-exams",
                "source_url": "https://gxjy.sdei.edu.cn/szyf2025",
                "published_at": "2025-03-28",
                "body": "2025年山东省高校毕业生“三支一扶”计划招募公告。网上报名时间：2025年3月31日9:00—4月4日16:00。",
                "exam_positions": rows,
            },
            today_str="2026-11-25",
        )
        self.assertEqual(enriched["stage"], "ended")
        self.assertEqual(len(enriched["positions"]), 793)

    def test_reordered_and_renamed_attachment_timeout_keeps_new_b_once_and_preserves_old_a(self):
        today = dt.datetime.now(TZ).date()
        pub_str = (today - dt.timedelta(days=2)).isoformat()
        reg_start = (today - dt.timedelta(days=1)).isoformat()
        reg_end = (today + dt.timedelta(days=6)).isoformat()
        old_verified = f"{(today - dt.timedelta(days=2)).isoformat()}T08:00:00+08:00"

        url_notice = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/t20261120_reorder.shtml"
        exam_id = hashlib.sha256(url_notice.encode("utf-8")).hexdigest()[:20]
        att_a_old = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/table_a_v1.xls"
        att_a_renamed = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/table_a_v2_renamed.xls"
        att_b_url = "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/202611/table_b.xls"
        body_text = (
            "青岛市人力资源和社会保障局面向社会公开招聘事业单位工作人员20名。"
            f"报名时间：{reg_start[:4]}年{int(reg_start[5:7])}月{int(reg_start[8:10])}日9:00—"
            f"{int(reg_end[5:7])}月{int(reg_end[8:10])}日16:00。"
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            out_dir = root / "out"
            seed_dir.mkdir(parents=True)

            # Seed order: [A, B]
            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": f"{pub_str}T10:00:00+08:00",
                    "last_success_at": f"{pub_str}T10:00:00+08:00",
                    "total_exams": 1,
                    "total_positions": 2,
                    "total_headcount": 3,
                    "total_exams_with_positions": 1,
                    "cities": ["青岛"],
                    "exams": [
                        {
                            "id": exam_id,
                            "title": "2026年青岛市市属事业单位公开招聘工作人员简章",
                            "organizer": "青岛市人力资源和社会保障局",
                            "notice_role": "招考简章",
                            "stage": "registering",
                            "schedule": {"reg_start": reg_start, "reg_end": reg_end, "reg_mode": "window"},
                            "source_id": "qingdao-hrss-exam",
                            "source_name": "青岛市人社局 · 公开招聘与引才专区",
                            "source_url": url_notice,
                            "published_at": pub_str,
                            "last_verified_at": old_verified,
                            "positions_status": "parsed",
                            "excerpt": body_text[:120],
                            "body": body_text,
                            "attachments": [
                                {"title": "附件1：综合岗位汇总表.xls", "url": att_a_old, "parse_status": "parsed"},
                                {"title": "附件2：医疗岗位汇总表.xls", "url": att_b_url, "parse_status": "parsed"},
                            ],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "row-a-old",
                                    "exam_id": exam_id,
                                    "department": "青岛市人社局",
                                    "employer": "青岛市发改委",
                                    "position_name": "旧A岗",
                                    "position_code": "A01",
                                    "recruit_count": 1,
                                    "major_raw": "经济学",
                                    "source": "attachment",
                                    "source_file": "附件1：综合岗位汇总表.xls",
                                    "source_url": att_a_old,
                                },
                                {
                                    "row_id": "row-b-old",
                                    "exam_id": exam_id,
                                    "department": "青岛市卫健委",
                                    "employer": "青岛市市立医院",
                                    "position_name": "旧B岗",
                                    "position_code": "B01",
                                    "recruit_count": 2,
                                    "major_raw": "临床医学",
                                    "source": "attachment",
                                    "source_file": "附件2：医疗岗位汇总表.xls",
                                    "source_url": att_b_url,
                                },
                            ],
                        }
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            # New detail HTML reverses order AND renames A: [B, A_renamed]
            qd_list_html = f'<ul><li><a href="{url_notice}">2026年青岛市市属事业单位公开招聘工作人员简章</a> {pub_str}</li></ul>'
            reordered_detail_html = (
                f'<div class="TRS_Editor"><p>{body_text}</p>'
                f'<p><a href="{att_b_url}">附件2：医疗岗位汇总表.xls</a></p>'
                f'<p><a href="{att_a_renamed}">附件1：综合岗位汇总表（修订版）.xls</a></p></div>'
            )
            att_b_new_bytes = """<table>
              <tr><th>招聘单位</th><th>岗位代码</th><th>岗位名称</th><th>计划人数</th><th>学历</th><th>专业要求</th></tr>
              <tr><td>青岛市市立医院</td><td>B01</td><td>新B岗</td><td>3</td><td>硕士研究生</td><td>临床医学</td></tr>
            </table>""".encode("utf-8")

            def fake_fetch_html(url: str, timeout: float = 6.0, referer: str = "") -> str:
                if url == "https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/":
                    return qd_list_html
                if url == url_notice:
                    return reordered_detail_html
                return "<html><body><ul></ul></body></html>"

            with (
                patch("scripts.collect_exams.fetch_html_quick", side_effect=fake_fetch_html),
                patch(
                    "scripts.collect_exams.fetch_bytes_quick",
                    side_effect=lambda u, timeout=6.0, max_bytes=4_000_000: att_b_new_bytes if u == att_b_url else None,
                ),
                patch("scripts.collect_exams.c.sdei_news_list", return_value=([], 1)),
                patch("scripts.collect_exams.c.jinan_cms_list", return_value=([], 1)),
            ):
                collect_and_export_exams(
                    public_dir=out_dir,
                    live_crawl=True,
                    live_site="",
                    seed_dir=seed_dir,
                )

            snap = json.loads((out_dir / "exams.json").read_text(encoding="utf-8"))
            self.assertTrue(snap["exams"][0].get("positions_pending_recheck"))
            hydrated = hydrate_exam_snapshot(
                snap,
                lambda rel: json.loads((out_dir / rel.lstrip("/")).read_text(encoding="utf-8")),
            )
            qd = hydrated["exams"][0]
            pos_names = [p["position_name"] for p in qd["positions"]]
            self.assertEqual(set(pos_names), {"旧A岗", "新B岗"})
            self.assertEqual(len(pos_names), 2)
            self.assertEqual(pos_names.count("新B岗"), 1)
            self.assertNotIn("旧B岗", pos_names)
            att_status = {a["url"]: a.get("parse_status") for a in qd["attachments"]}
            self.assertEqual(att_status[att_b_url], "parsed")
            self.assertEqual(att_status[att_a_renamed], "deferred")

    def test_sibling_merge_preserves_both_parent_and_child_positions_with_dedup(self):
        from scripts.collect_exams import merge_sibling_position_table_entries

        notice_url = "https://taian.dtdjzx.gov.cn/web/p896/lytzgg/139991.html"
        table_url = "https://taian.dtdjzx.gov.cn/web/p896/lytzgg/139992.html"
        notice_id = hashlib.sha256(notice_url.encode("utf-8")).hexdigest()[:20]
        table_id = hashlib.sha256(table_url.encode("utf-8")).hexdigest()[:20]

        raw_by_url = {
            notice_url: {
                "id": notice_id,
                "title": "2027年度泰安市各级机关考试录用公务员公告",
                "source_url": notice_url,
                "body": "2027年度泰安市各级机关考试录用公务员公告正文。" * 10,
                "attachments": [{"title": "主公告附表", "url": "https://taian.gov.cn/p.xlsx"}],
                "exam_positions": [
                    {
                        "row_id": "p-1",
                        "exam_id": notice_id,
                        "position_code": "001",
                        "employer": "泰安市财政局",
                        "position_name": "母公告A岗",
                        "source_url": "https://taian.gov.cn/p.xlsx",
                    },
                    {
                        "row_id": "p-dup",
                        "exam_id": notice_id,
                        "position_code": "003",
                        "employer": "泰安市审计局",
                        "position_name": "重复S岗",
                        "source_url": "https://taian.gov.cn/shared.xlsx",
                    },
                ],
            },
            table_url: {
                "id": table_id,
                "title": "2027年度泰安市各级机关公务员招录职位表",
                "source_url": table_url,
                "body": "下载附件",
                "attachments": [{"title": "子页职位表", "url": "https://taian.gov.cn/c.xlsx"}],
                "exam_positions": [
                    {
                        "row_id": "c-1",
                        "exam_id": table_id,
                        "position_code": "002",
                        "employer": "泰安市司法局",
                        "position_name": "子页B岗",
                        "source_url": "https://taian.gov.cn/c.xlsx",
                    },
                    {
                        "row_id": "c-dup",
                        "exam_id": table_id,
                        "position_code": "003",
                        "employer": "泰安市审计局",
                        "position_name": "重复S岗",
                        "source_url": "https://taian.gov.cn/shared.xlsx",
                    },
                ],
            },
        }

        merge_sibling_position_table_entries(raw_by_url)
        self.assertIn(notice_url, raw_by_url)
        self.assertNotIn(table_url, raw_by_url)
        merged_rows = raw_by_url[notice_url]["exam_positions"]
        self.assertEqual(len(merged_rows), 3)
        self.assertEqual({r["position_name"] for r in merged_rows}, {"母公告A岗", "子页B岗", "重复S岗"})
        self.assertTrue(all(r["exam_id"] == notice_id for r in merged_rows))

    def test_reparse_exam_ids_fails_fast_on_attachment_timeout_and_missing_id(self):
        exam_id = "8d7aae1d032277666b47"
        att_url = "https://html.gxjy.sdei.edu.cn/manageredu/userfiles/file/2026/07/03/1783132477078.pdf"
        fixture = Path(__file__).parent / "fixtures" / "exams" / "dezhou_2026_positions.pdf"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_dir = root / "seed"
            out_timeout = root / "out_timeout"
            out_missing = root / "out_missing"
            out_ok = root / "out_ok"
            seed_dir.mkdir(parents=True)

            write_exam_snapshot(
                {
                    "schema_version": 1,
                    "generated_at": "2026-11-25T18:08:16+08:00",
                    "last_success_at": "2026-11-25T18:08:16+08:00",
                    "total_exams": 1,
                    "total_positions": 1,
                    "total_headcount": 1,
                    "total_exams_with_positions": 1,
                    "cities": ["德州"],
                    "exams": [
                        {
                            "id": exam_id,
                            "title": "德州智能技术职业学院2026年公开招聘工作人员简章",
                            "organizer": "德州智能技术职业学院",
                            "notice_role": "招考简章",
                            "stage": "ended",
                            "schedule": {"reg_start": "2026-07-05", "reg_end": "2026-07-10", "reg_mode": "window"},
                            "source_id": "sdei-civil-exams",
                            "source_name": "山东省大学生就业服务平台",
                            "source_url": "https://gxjy.sdei.edu.cn/dezhou2026",
                            "published_at": "2026-07-03",
                            "last_verified_at": "2026-11-25T18:08:16+08:00",
                            "positions_status": "parsed",
                            "excerpt": "德州智能技术职业学院公开招聘工作人员简章",
                            "body": "德州智能技术职业学院2026年公开招聘工作人员简章。报名时间：2026年7月5日至7月10日。",
                            "attachments": [
                                {
                                    "title": "德州智能技术职业学院2026年公开招聘工作人员岗位计划表.pdf",
                                    "url": att_url,
                                    "parse_status": "parsed",
                                }
                            ],
                            "links": [],
                            "positions": [
                                {
                                    "row_id": "old-bad-1",
                                    "exam_id": exam_id,
                                    "department": "德州智能技术职业学院",
                                    "employer": "德州智能技术职业学院",
                                    "position_name": "旧错误岗位",
                                    "recruit_count": 1,
                                    "major_raw": "旧错误岗位",
                                    "source": "attachment",
                                    "source_url": att_url,
                                }
                            ],
                        }
                    ],
                    "sources": [],
                },
                seed_dir,
            )

            # 1. Attachment download timeout during explicit --reparse-exam-ids MUST fail and halt export
            with patch("scripts.collect_exams.fetch_bytes_quick", return_value=None):
                with self.assertRaises(RuntimeError) as ctx_timeout:
                    collect_and_export_exams(
                        public_dir=out_timeout,
                        live_crawl=False,
                        live_site="",
                        seed_dir=seed_dir,
                        reparse_exam_ids={exam_id},
                    )
            self.assertIn(exam_id, str(ctx_timeout.exception))
            self.assertFalse((out_timeout / "exams.json").exists())

            # 2. Unknown / mistyped exam ID in --reparse-exam-ids MUST fail and halt export
            with patch("scripts.collect_exams.fetch_bytes_quick", return_value=fixture.read_bytes()):
                with self.assertRaises(RuntimeError) as ctx_missing:
                    collect_and_export_exams(
                        public_dir=out_missing,
                        live_crawl=False,
                        live_site="",
                        seed_dir=seed_dir,
                        reparse_exam_ids={exam_id, "nonexistent0000000000"},
                    )
            self.assertIn("nonexistent0000000000", str(ctx_missing.exception))
            self.assertFalse((out_missing / "exams.json").exists())

            # 3. Valid ID + successful attachment parse passes verification cleanly
            with patch("scripts.collect_exams.fetch_bytes_quick", return_value=fixture.read_bytes()):
                res = collect_and_export_exams(
                    public_dir=out_ok,
                    live_crawl=False,
                    live_site="",
                    seed_dir=seed_dir,
                    reparse_exam_ids={exam_id},
                )
            self.assertEqual(res["total_positions"], 8)
            self.assertTrue((out_ok / "exams.json").is_file())
            self.assertNotIn("positions_pending_recheck", res["exams"][0])


if __name__ == "__main__":
    unittest.main()

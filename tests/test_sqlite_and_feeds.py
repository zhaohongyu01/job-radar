from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET

from scripts.build_feeds import build_feeds
from scripts.build_radar_sqlite import build_radar_sqlite
from scripts.sync_cloudflare_d1 import (
    build_bounded_upsert_statements,
    compute_row_hash,
    compute_table_diff_sql,
    patch_wrangler_d1_binding,
)


class SqliteAndFeedsTests(unittest.TestCase):
    def _seed_public_dir(self, pub: Path) -> None:
        (pub / 'job-assets').mkdir(parents=True, exist_ok=True)
        browse_shard = {
            'jobs': [
                {
                    'id': 'job-1',
                    'title': '2027届软件开发工程师(J45816)',
                    'company': '浪潮集团有限公司',
                    'cities': ['济南', '青岛'],
                    'kind': '具体岗位',
                    'types': ['校招'],
                    'sectors': ['国企/央企'],
                    'education': '本科及以上',
                    'salary': '15k-22k',
                    'published_at': '2026-11-10T10:00:00+08:00',
                    'deadline': '2026-12-20',
                    'listing_status': 'active',
                    'excerpt': '负责云原生后端研发与分布式架构设计。',
                },
                {
                    'id': 'job-2',
                    'title': '全国分支机构综合柜员招聘公告',
                    'company': '中国工商银行',
                    'cities': [],
                    'location_text': '全国各地分行均可报名',
                    'kind': '综合招聘公告',
                    'types': ['校招'],
                    'sectors': ['银行/金融'],
                    'education': '本科',
                    'published_at': '2026-11-09T09:00:00+08:00',
                    'deadline': '2026-11-30',
                    'listing_status': 'active',
                    'excerpt': '全国多地分支机构同步招录。',
                },
            ]
        }
        (pub / 'job-assets' / 'browse-000.json').write_text(
            json.dumps(browse_shard, ensure_ascii=False), encoding='utf-8'
        )
        (pub / 'job-assets' / 'search-000.json').write_text(
            json.dumps(
                {
                    'jobs': {
                        'job-1': '浪潮集团有限公司 软件开发工程师 Java Go Kubernetes 济南 青岛',
                        'job-2': '中国工商银行 综合柜员 金融 经济学 全国',
                    }
                },
                ensure_ascii=False,
            ),
            encoding='utf-8',
        )
        (pub / 'jobs.json').write_text(
            json.dumps(
                {
                    'generated_at': '2026-11-11T08:00:00+08:00',
                    'browse_index': {
                        'shards': ['/job-assets/browse-000.json'],
                        'search_shards': ['/job-assets/search-000.json'],
                    },
                },
                ensure_ascii=False,
            ),
            encoding='utf-8',
        )
        (pub / 'exams.json').write_text(
            json.dumps(
                {
                    'generated_at': '2026-11-11T09:30:00+08:00',
                    'total_positions': 12,
                    'exams': [
                        {
                            'id': 'exam-sd-1',
                            'title': '2027年度山东省省直机关公开招录公务员公告',
                            'organizer': '中共山东省委组织部',
                            'province': '山东',
                            'cities': ['济南'],
                            'exam_category': 'civil_service',
                            'stage': 'registering',
                            'published_at': '2026-11-08',
                            'total_headcount': 120,
                            'schedule': {
                                'reg_start': '2026-11-10',
                                'reg_end': '2026-11-25',
                                'written_exam_date': '2026-12-15',
                            },
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            encoding='utf-8',
        )

    def test_build_radar_sqlite_and_fts_trigram(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pub = root / 'public'
            self._seed_public_dir(pub)
            db_path = root / 'radar.sqlite'
            d1_sql_path = root / 'd1.sql'

            stats = build_radar_sqlite(pub, db_path, d1_sql_path)
            self.assertEqual(stats['jobs_count'], 2)
            self.assertEqual(stats['exams_count'], 1)
            self.assertTrue(db_path.is_file())
            self.assertTrue(d1_sql_path.is_file())
            self.assertIn('INSERT INTO jobs_fts', d1_sql_path.read_text(encoding='utf-8'))

            conn = sqlite3.connect(str(db_path))
            try:
                fts_hits = conn.execute(
                    'SELECT id FROM jobs_fts WHERE jobs_fts MATCH ?;', ('"软件开发"',)
                ).fetchall()
                self.assertEqual([r[0] for r in fts_hits], ['job-1'])

                nationwide_row = conn.execute(
                    'SELECT nationwide FROM jobs WHERE id = ?;', ('job-2',)
                ).fetchone()
                self.assertEqual(nationwide_row[0], 1)
            finally:
                conn.close()

    def test_build_static_rss_and_ics_feeds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pub = Path(tmp) / 'public'
            self._seed_public_dir(pub)

            res = build_feeds(pub, site_origin='https://example.com')
            self.assertEqual(res['exam_rss_items'], 1)
            self.assertGreaterEqual(res['exam_ics_events'], 2)
            self.assertEqual(res['job_rss_items'], 2)

            exam_xml = (pub / 'feeds' / 'exams-shandong.xml').read_text(encoding='utf-8')
            job_xml = (pub / 'feeds' / 'jobs-latest.xml').read_text(encoding='utf-8')
            exam_root = ET.fromstring(exam_xml)
            job_root = ET.fromstring(job_xml)
            self.assertEqual(exam_root.tag, 'rss')
            self.assertEqual(job_root.tag, 'rss')
            self.assertIn('exam=exam-sd-1', exam_xml)
            self.assertIn('job=job-1', job_xml)

            ics_bytes = (pub / 'feeds' / 'exams-shandong.ics').read_bytes()
            ics_text = ics_bytes.decode('utf-8')
            self.assertIn('BEGIN:VCALENDAR', ics_text)
            self.assertIn('BEGIN:VEVENT', ics_text)
            self.assertIn('【报名截止】', ics_text)
            for raw_line in ics_text.split('\r\n'):
                self.assertLessEqual(len(raw_line.encode('utf-8')), 75)

    def test_cloudflare_d1_incremental_diff_and_wrangler_patch(self) -> None:
        cols = ['seq', 'id', 'title']
        local_rows = [
            (1, 'job-1', '软件工程师'),
            (2, 'job-2', '硬件工程师（更新）'),
            (3, 'job-3', '算法工程师'),
        ]
        remote_hashes = {
            'job-1': compute_row_hash((1, 'job-1', '软件工程师')),
            'job-2': compute_row_hash((2, 'job-2', '硬件工程师（旧）')),
            'job-stale': 'deadbeef00112233',
        }
        stmts, stats = compute_table_diff_sql('jobs', cols, local_rows, remote_hashes)
        self.assertEqual(stats['unchanged'], 1)
        self.assertEqual(stats['upserted'], 2)
        self.assertEqual(stats['deleted'], 1)
        joined = '\n'.join(stmts)
        self.assertIn("DELETE FROM jobs WHERE id IN ('job-stale');", joined)
        self.assertIn("'job-2'", joined)
        self.assertIn("'job-3'", joined)
        self.assertNotIn("'job-1'", joined)

        # Identical second sync produces 0 statements (zero D1 row writes)
        synced_remote = {str(r[1]): compute_row_hash(r) for r in local_rows}
        stmts_noop, stats_noop = compute_table_diff_sql('jobs', cols, local_rows, synced_remote)
        self.assertEqual(stmts_noop, [])
        self.assertEqual(stats_noop['upserted'], 0)
        self.assertEqual(stats_noop['deleted'], 0)

        # Bounded statement size check
        huge_rows = [(i, f'id-{i}', '长文本' * 1200, 'hashval') for i in range(25)]
        bounded = build_bounded_upsert_statements('jobs', ['seq', 'id', 'title', 'row_hash'], huge_rows)
        self.assertGreater(len(bounded), 2)
        for s in bounded:
            self.assertLessEqual(len(s.encode('utf-8')), 50_000)

        # Wrangler JSON binding patch
        with tempfile.TemporaryDirectory() as tmp:
            wrangler_file = Path(tmp) / 'wrangler.json'
            wrangler_file.write_text(json.dumps({'name': 'sites-project'}), encoding='utf-8')
            patched = patch_wrangler_d1_binding(wrangler_file, 'job-radar-db', 'uuid-1234-5678')
            self.assertTrue(patched)
            cfg = json.loads(wrangler_file.read_text(encoding='utf-8'))
            self.assertEqual(
                cfg['d1_databases'],
                [{'binding': 'DB', 'database_name': 'job-radar-db', 'database_id': 'uuid-1234-5678'}],
            )


if __name__ == '__main__':
    unittest.main()

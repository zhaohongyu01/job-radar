from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET

from scripts.build_feeds import build_feeds
from scripts.build_radar_sqlite import build_radar_sqlite
from scripts.stage_public import stage


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

    def test_first_screen_only_snapshot_and_stage_public_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pub = root / 'public'
            self._seed_public_dir(pub)

            # Build static first-screen.json without creating a .sqlite file
            stats = build_radar_sqlite(pub, output_sqlite=None, first_screen_only=True)
            self.assertEqual(stats['active_jobs_count'], 2)
            self.assertEqual(stats['sqlite_bytes'], 0)
            self.assertGreater(stats['first_screen_bytes'], 0)

            fs_path = pub / 'first-screen.json'
            self.assertTrue(fs_path.is_file())
            payload = json.loads(fs_path.read_text(encoding='utf-8'))
            self.assertIs(payload['ok'], True)
            self.assertEqual(payload['engine'], 'static-edge')
            self.assertEqual(payload['generated_at'], '2026-11-11T08:00:00+08:00')
            self.assertEqual(payload['total'], 2)
            self.assertEqual(len(payload['jobs']), 2)
            self.assertEqual(payload['facets']['cities']['济南'], 1)
            self.assertEqual(payload['facets']['sectors']['国企/央企'], 1)

            # Prepare minimal canonical jobs.json + manifest + wrangler.json for stage_public.stage()
            search_bytes = b'{"jobs":{}}'
            search_hash = hashlib.sha256(search_bytes).hexdigest()[:20]
            search_rel = f'/job-assets/search-{search_hash}.json'
            (pub / search_rel.lstrip('/')).write_bytes(search_bytes)

            jobs_raw = json.dumps(
                {
                    'schema_version': 3,
                    'generated_at': '2026-11-11T08:00:00+08:00',
                    'last_success_at': None,
                    'schedule_enabled': True,
                    'cities': [],
                    'jobs': [],
                    'sources': [],
                    'detail_shards': {},
                    'search_url': search_rel,
                },
                ensure_ascii=False,
            ).encode('utf-8')
            (pub / 'jobs.json').write_bytes(jobs_raw)
            (pub / 'snapshot-manifest.json').write_text(
                json.dumps(
                    {
                        'schema_version': 1,
                        'index_sha256': hashlib.sha256(jobs_raw).hexdigest(),
                    }
                ),
                encoding='utf-8',
            )
            # Remove test-only unhashed browse/exams files before strict stage() validation
            (pub / 'exams.json').unlink()

            dist = root / 'dist'
            (dist / 'server').mkdir(parents=True, exist_ok=True)
            (dist / 'client').mkdir(parents=True, exist_ok=True)
            (dist / 'server' / 'wrangler.json').write_text(
                json.dumps({'name': 'sites-project', 'assets': {'directory': '../client'}}),
                encoding='utf-8',
            )

            stage(pub, dist)
            staged_fs = dist / 'client' / 'first-screen.json'
            self.assertTrue(staged_fs.is_file())

            # Stale first-screen.json with mismatched generated_at is pruned cleanly
            payload['generated_at'] = '2026-11-01T00:00:00+08:00'
            fs_path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
            stage(pub, dist)
            self.assertFalse(staged_fs.exists())


if __name__ == '__main__':
    unittest.main()

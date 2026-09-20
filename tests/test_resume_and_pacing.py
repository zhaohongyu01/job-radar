import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import collect as c
import ci_collect as ci


class ResumeTests(unittest.TestCase):
    def args(self, directory, pages=2):
        return SimpleNamespace(data_dir=directory, public_dir=directory,
            sources='jobsdufe-announcements', pages=pages, days=30,
            refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1,
            probe_budget=0, state_only=True)

    def run_round(self, args, total=4, fail=None):
        calls = []
        def listing(source, page):
            calls.append(page)
            if page == fail:
                raise OSError('test list failure')
            source['_total_items'] = total * 20
            item = {'url': f'https://example.test/{page}', 'title': f'Job {page}',
                    'published_at': c.dt.datetime.now(c.TZ).date().isoformat(),
                    'inline_html': f'<div id="zoom">Job {page}</div>'}
            return [item], total
        with patch.object(c, 'sdei_list', side_effect=listing), contextlib.redirect_stdout(io.StringIO()):
            c.run(args)
        return calls, json.loads((Path(args.data_dir) / 'state.json').read_text(encoding='utf-8'))

    def test_multiple_rounds_refresh_front_and_reach_tail(self):
        with TemporaryDirectory() as tmp:
            args = self.args(tmp)
            rounds = [self.run_round(args) for _ in range(3)]
            self.assertEqual([r[0] for r in rounds], [[1, 2], [1, 3], [1, 4]])
            final = rounds[-1][1]
            self.assertEqual(len(final['jobs']), 4)
            self.assertTrue(final['sources'][args.sources]['list_complete'])
            self.assertEqual(final['sources'][args.sources]['resume_page'], 1)
            self.assertFalse(final['sources'][args.sources]['early_exit_safe'])
            self.assertEqual(self.run_round(args)[0], [1, 2])

    def test_smaller_list_clamps_old_cursor(self):
        with TemporaryDirectory() as tmp:
            args = self.args(tmp)
            for _ in range(3):
                self.run_round(args, total=8)
            calls, state = self.run_round(args, total=2)
            self.assertEqual(calls, [1, 2])
            self.assertTrue(state['sources'][args.sources]['list_complete'])

    def test_failed_page_is_retried_not_skipped(self):
        with TemporaryDirectory() as tmp:
            args = self.args(tmp)
            self.run_round(args)
            _, failed = self.run_round(args, fail=3)
            self.assertEqual(failed['sources'][args.sources]['resume_page'], 3)
            self.assertEqual(self.run_round(args)[0], [1, 3])

    def test_one_page_budget_eventually_reaches_tail(self):
        with TemporaryDirectory() as tmp:
            args = self.args(tmp, pages=1)
            rounds = [self.run_round(args, total=3) for _ in range(3)]
            self.assertEqual([r[0] for r in rounds], [[1], [2], [3]])
            self.assertEqual(len(rounds[-1][1]['jobs']), 3)

    def test_overlap_does_not_prevent_progress(self):
        with TemporaryDirectory() as tmp:
            args = self.args(tmp, pages=3)
            rounds = [self.run_round(args, total=5) for _ in range(3)]
            self.assertEqual([r[0] for r in rounds], [[1, 2, 3], [1, 3, 4], [1, 4, 5]])
            self.assertEqual(len(rounds[-1][1]['jobs']), 5)

    def test_list_checkpoint_recovers_before_detail_phase(self):
        with TemporaryDirectory() as tmp:
            args = self.args(tmp)
            source = next(s for s in c.SOURCES if s['id'] == args.sources)
            baseline = {'jobs': {}, 'sources': {}, 'pending': {}, 'last_run_at': '2026-01-01T00:00:00+08:00'}
            c.atomic_json(Path(tmp) / 'state.json', baseline)
            def listing(src, page):
                if page == 2:
                    raise KeyboardInterrupt('simulate worker killed during pagination')
                return [{'url':'https://example.test/1', 'title':'Job',
                         'published_at':c.dt.datetime.now(c.TZ).date().isoformat(),
                         'inline_html':'<div id="zoom">Job</div>'}], 3
            with patch.object(c, 'sdei_list', side_effect=listing), self.assertRaises(KeyboardInterrupt):
                c.run(args)
            recovered = ci.recover_source(Path(tmp), source, baseline,
                c.dt.datetime.now(c.TZ).isoformat(), -1, True)
            self.assertEqual(len(recovered['jobs']), 1)
            self.assertEqual(recovered['sources'][args.sources]['resume_page'], 2)
            self.assertEqual(len(recovered['pending'][args.sources]), 1)


class SharedPacingTests(unittest.TestCase):
    def command(self, database, action):
        code = ('import sys,time,urllib.error\n'
                'sys.path.insert(0,sys.argv[1])\n'
                'import collector_runtime as r\n'
                'r.configure_shared_pacing(sys.argv[2])\n'
                'def unexpected_sleep(seconds):\n    raise AssertionError("unexpected real wait")\n'
                'r.time.sleep=unexpected_sleep\n'
                'r.random.uniform=lambda a,b: 0\n' + action)
        return [sys.executable, '-c', code, str(ROOT / 'scripts'), str(database)]

    def test_separate_workers_share_request_slots(self):
        with TemporaryDirectory() as tmp:
            database = Path(tmp) / 'rate.sqlite'
            command = self.command(database,
                "r.time.time=lambda: 100.0\nprint(r.shared_slot('example.test', interval=0.3))")
            # Run overlapping processes to exercise the transaction, not merely
            # a single interpreter's module globals.
            processes = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                         for _ in range(3)]
            delays = []
            try:
                for process in processes:
                    output, error = process.communicate(timeout=15)
                    self.assertEqual(process.returncode, 0, error)
                    delays.append(float(output.strip()))
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                    process.communicate(timeout=5)
            # All workers observe the same logical instant. Exactly one gets
            # admitted; the others must wait, without reserving future slots.
            delays.sort()
            self.assertEqual(delays[0], 0)
            self.assertAlmostEqual(delays[1], 0.3)
            self.assertAlmostEqual(delays[2], 0.3)
            later = subprocess.run(self.command(database,
                "r.time.time=lambda: 100.3\nprint(r.shared_slot('example.test', interval=0.3))"),
                capture_output=True, text=True, timeout=15)
            self.assertEqual(later.returncode, 0, later.stderr)
            self.assertEqual(float(later.stdout.strip()), 0)

    def test_first_request_with_shared_pacing_does_not_exhaust_budget(self):
        with TemporaryDirectory() as tmp:
            database = Path(tmp) / 'rate.sqlite'
            code = "with r.request_budget(10):\n    r.pace('https://example.test/new')\n    print('success')"
            res = subprocess.run(self.command(database, code), capture_output=True, text=True, timeout=15)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn('success', res.stdout)

    def test_remaining_zero_with_active_budget_returns_zero(self):
        import collector_runtime as r
        with r.request_budget(10):
            self.assertEqual(r.remaining(0), 0.0)

    def test_long_retry_after_is_shared_with_next_process(self):
        with TemporaryDirectory() as tmp:
            database = Path(tmp) / 'rate.sqlite'
            result = subprocess.run(self.command(database,
                "r.pause_on_rejection('https://example.test/a', urllib.error.HTTPError('x',429,'Limited',{'Retry-After':'21600'},None))"),
                capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run(self.command(database,
                "try:\n    r.pace('https://example.test/a')\nexcept r.HostPaused as e:\n    print(e.retry_after_seconds)"),
                capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(float(result.stdout.strip()), 21500)

    def test_rejection_is_shared_with_next_process(self):
        with TemporaryDirectory() as tmp:
            database = Path(tmp) / 'rate.sqlite'
            subprocess.run(self.command(database,
                "r.pause_on_rejection('https://example.test/a', urllib.error.HTTPError('x',403,'Forbidden',{},None))"),
                check=True, capture_output=True, timeout=15)
            result = subprocess.run(self.command(database, "r.pace('https://example.test/b')"),
                                    capture_output=True, text=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('HostPaused', result.stderr)


class PacingWakeupTests(unittest.TestCase):
    def setUp(self):
        import collector_runtime as r
        self.r = r
        self.clock = 100.0
        self.sleeps = []
        self.enterContext(patch.object(r, 'time', SimpleNamespace(
            time=lambda: self.clock, monotonic=lambda: self.clock, sleep=self.advance)))
        self.enterContext(patch.object(r.random, 'uniform', return_value=0))
        self.enterContext(patch.object(r, '_shared_path', None))
        self.enterContext(patch.dict(r._next_request, {}, clear=True))
        self.enterContext(patch.dict(r._paused, {}, clear=True))
        self.enterContext(patch.object(r._local, 'deadline', None, create=True))
        self.directory = self.enterContext(TemporaryDirectory())

    def advance(self, seconds):
        self.sleeps.append(seconds)
        self.assertLess(len(self.sleeps), 6, 'pacing failed to converge')
        self.clock += seconds + 0.000001

    def test_delayed_wakeup_rechecks_admission_for_shared_and_local_pacing(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                self.clock = 100.0
                self.sleeps.clear()
                self.r._next_request.clear()
                self.r.configure_shared_pacing(Path(self.directory)/'delayed.sqlite' if shared else None)
                self.r.pace('https://example.test/a')

                def delayed_wakeup(seconds):
                    self.advance(seconds)
                    if len(self.sleeps) == 1:
                        self.clock = 101.0  # this worker overslept
                        # Another worker was admitted before this one resumed.
                        if shared:
                            self.assertEqual(self.r.shared_slot('example.test', interval=0.3), 0)
                        else:
                            self.r._next_request['example.test'] = self.clock + 0.3

                with patch.object(self.r.time, 'sleep', side_effect=delayed_wakeup):
                    self.r.pace('https://example.test/b')
                self.assertEqual(len(self.sleeps), 2)
                self.assertGreaterEqual(self.clock, 101.3)

    def test_rejection_during_wait_is_rechecked_and_other_host_is_unaffected(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                self.clock = 100.0
                self.sleeps.clear()
                self.r._next_request.clear()
                self.r._paused.clear()
                self.r.configure_shared_pacing(Path(self.directory)/'paused.sqlite' if shared else None)
                self.r.pace('https://example.test/a')

                def reject_during_wait(seconds):
                    self.advance(seconds)
                    if shared:
                        self.r.shared_slot('example.test', pause_seconds=20)
                    else:
                        self.r._paused['example.test'] = self.clock + 20

                with patch.object(self.r.time, 'sleep', side_effect=reject_during_wait):
                    with self.assertRaises(self.r.HostPaused):
                        self.r.pace('https://example.test/b')
                    self.r.pace('https://other.test/a')
                self.assertEqual(len(self.sleeps), 1)

    def test_budget_exhaustion_does_not_sleep_or_reserve_a_future_slot(self):
        self.r.configure_shared_pacing(Path(self.directory)/'budget.sqlite')
        with self.r.request_budget(0.1):
            self.r.pace('https://example.test/a')  # first zero-wait request
            with self.assertRaises(TimeoutError):
                self.r.pace('https://example.test/b')
        self.assertEqual(self.sleeps, [])
        self.clock = 100.3
        self.r.pace('https://example.test/c')
        self.assertEqual(self.sleeps, [])


if __name__ == '__main__':
    unittest.main()

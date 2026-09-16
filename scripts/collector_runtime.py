"""Bounded request scheduling shared by a source's detail workers."""
from __future__ import annotations

import contextlib
import email.utils
import functools
import inspect
import os
import sqlite3
import random
import socket
import threading
import time
import urllib.error
import urllib.parse


class HostPaused(OSError):
    pass


_local = threading.local()
_lock = threading.Lock()
_next_request = {}
_paused = {}
_shared_path = None


def configure_shared_pacing(path):
    """Use one SQLite scheduler for all source workers in this shard."""
    global _shared_path
    _shared_path = os.fspath(path) if path else None
    if _shared_path:
        with sqlite3.connect(_shared_path, timeout=5) as db:
            db.execute('CREATE TABLE IF NOT EXISTS hosts '
                       '(host TEXT PRIMARY KEY, next_request REAL NOT NULL, paused_until REAL NOT NULL)')


def shared_slot(host, interval=0, pause_seconds=0):
    # BEGIN IMMEDIATE serializes reservations across processes. SQLite releases
    # its lock even if a worker is killed by the source wall-clock budget.
    with sqlite3.connect(_shared_path, timeout=remaining(5)) as db:
        db.execute('BEGIN IMMEDIATE')
        now = time.time()
        row = db.execute('SELECT next_request, paused_until FROM hosts WHERE host=?', (host,)).fetchone()
        next_at, paused_until = row or (0, 0)
        if pause_seconds:
            paused_until = max(paused_until, now + pause_seconds)
        else:
            if paused_until > now:
                raise HostPaused('host paused after HTTP 403/420/429: ' + host)
            delay = max(0.0, next_at - now)
            if delay > 0 and remaining(delay) < delay:
                raise TimeoutError('request budget exhausted while rate limiting')
            next_at = now + delay + interval
        db.execute('INSERT OR REPLACE INTO hosts VALUES (?, ?, ?)', (host, next_at, paused_until))
    return 0 if pause_seconds else delay


def bounded_request(function):
    signature = inspect.signature(function)
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        values = signature.bind(*args, **kwargs)
        values.apply_defaults()
        timeout = float(values.arguments.get('timeout', 18))
        retries = int(values.arguments.get('retries', 0))
        with request_budget(timeout * (retries + 1) + 5):
            return function(*args, **kwargs)
    return wrapped


@contextlib.contextmanager
def request_budget(seconds):
    old = getattr(_local, 'deadline', None)
    _local.deadline = min(old or float('inf'), time.monotonic() + seconds)
    try:
        yield
    finally:
        _local.deadline = old


def remaining(timeout):
    deadline = getattr(_local, 'deadline', None)
    if deadline is None:
        return timeout
    left = deadline - time.monotonic()
    if left <= 0:
        raise TimeoutError('request total time budget exhausted')
    return max(0.0, min(timeout, left))


def pace(url):
    host = urllib.parse.urlsplit(url).netloc
    with _lock:
        if _paused.get(host, 0) > time.monotonic():
            raise HostPaused('host paused after HTTP 403/420/429: ' + host)
        now = time.monotonic()
        # SDEI shared school platform runs on a dedicated slow channel with jitter.
        if host == 'school.gxjy.sdei.edu.cn':
            interval = random.uniform(3.0, 4.5)
        elif host.endswith('.gov.cn'):
            interval = random.uniform(1.8, 2.8)
        else:
            interval = 0.3 + random.uniform(0, 0.2)
        if _shared_path:
            delay = shared_slot(host, interval=interval)
        else:
            delay = max(0.0, _next_request.get(host, 0) - now)
            _next_request[host] = now + delay + interval
    if delay > 0:
        if remaining(delay) < delay:
            raise TimeoutError('request budget exhausted while rate limiting')
        time.sleep(delay)


def retry_delay(error, attempt):
    """None means a permanent error: never retry 403, 404, 420 or parse failures."""
    if isinstance(error, urllib.error.HTTPError):
        if error.code not in {408, 429, 500, 502, 503, 504}:
            return None
        retry_after = (error.headers or {}).get('Retry-After', '')
        if retry_after:
            try:
                return max(0, float(retry_after))
            except ValueError:
                try:
                    return max(0, email.utils.parsedate_to_datetime(retry_after).timestamp() - time.time())
                except (ValueError, TypeError, OverflowError):
                    pass
    elif not isinstance(error, (TimeoutError, socket.timeout, ConnectionError, urllib.error.URLError)):
        return None
    return min(8, 1.5 * 2 ** attempt) + random.uniform(0, 0.3)


def pause_on_rejection(url, error):
    code = getattr(error, 'code', None)
    if code in {403, 420, 429}:
        if code == 429:
            delay = retry_delay(error, 0) or 180
        elif code == 403:
            delay = 3600 * 4  # 4-hour cooldown for 403
        else:
            delay = 300  # 5-minute cooldown for 420
        with _lock:
            _paused[urllib.parse.urlsplit(url).netloc] = time.monotonic() + max(60, delay)
            if _shared_path:
                shared_slot(urllib.parse.urlsplit(url).netloc, pause_seconds=max(60, delay))


def retry_request(url, error, attempt, retries):
    delay = retry_delay(error, attempt)
    # Respect long Retry-After values by deferring to another run, not sleeping
    # through the shard budget or retrying sooner than the server requested.
    if delay is None or attempt >= retries or delay > 30:
        pause_on_rejection(url, error)
        return False
    if remaining(delay) < delay:
        return False
    time.sleep(delay)
    return True


def bounded_read(response, max_size, timeout):
    chunks = []
    size = 0
    reader = getattr(response, 'read1', response.read)
    while size <= max_size:
        allowed = remaining(timeout)
        # urllib exposes the underlying socket through HTTPResponse. Updating
        # it bounds each idle read by the remaining total request budget.
        sock = getattr(getattr(getattr(response, 'fp', None), 'raw', None), '_sock', None)
        if sock is not None:
            sock.settimeout(allowed)
        chunk = reader(min(65536, max_size + 1 - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
    if size > max_size:
        raise ValueError('response exceeds size limit')
    return b''.join(chunks)

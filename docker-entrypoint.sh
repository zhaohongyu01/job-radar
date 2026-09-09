#!/bin/sh
set -eu

WEB_PID=""

stop_web() {
  if [ -n "$WEB_PID" ]; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
    WEB_PID=""
  fi
}

trap 'stop_web; exit 0' INT TERM

collect_once() {
  echo "[job-radar] collecting pages=${COLLECT_PAGES} days=${COLLECT_DAYS}"
  # A partial source must not prevent the last good snapshot from serving.
  if ! python3 scripts/collect.py --pages "$COLLECT_PAGES" --days "$COLLECT_DAYS"; then
    echo "[job-radar] collector reported a partial/failed source; keeping retained records" >&2
  fi
}

build_once() {
  echo "[job-radar] building site"
  npm run build
}

start_web() {
  echo "[job-radar] starting web server on 0.0.0.0:${PORT}"
  npm run start -- --ip 0.0.0.0 --port "$PORT" &
  WEB_PID=$!
}

if [ "${COLLECT_ON_START}" = "1" ]; then
  collect_once
fi
build_once
start_web

while :; do
  sleep "$COLLECT_INTERVAL_SECONDS"
  stop_web
  collect_once
  build_once
  start_web
done

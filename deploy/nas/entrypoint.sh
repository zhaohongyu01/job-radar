#!/bin/sh
set -eu
umask 077

if [ ! -x ./run.sh ]; then
  cp -R /opt/runner-dist/. .
fi

if [ ! -f .runner ]; then
  if [ ! -s /run/secrets/runner_registration ]; then
    echo 'Create runner-registration.txt with a fresh GitHub runner registration token.' >&2
    exit 1
  fi
  case "${RUNNER_REPOSITORY:-}" in
    https://github.com/*/*) ;;
    *) echo 'Set RUNNER_REPOSITORY to the private repository GitHub URL.' >&2; exit 1 ;;
  esac
  registration=$(tr -d '\r\n' < /run/secrets/runner_registration)
  ./config.sh --unattended --url "$RUNNER_REPOSITORY" --token "$registration" \
    --name "${RUNNER_NAME:-ugreen-job-radar}" --labels job-radar-nas --work _work
  unset registration
fi

# Keep runner registration and automatic updates in the dedicated volume.
exec ./run.sh

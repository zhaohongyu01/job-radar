"""Reuse a checked NAS virtualenv outside the checkout; bound cold installation."""
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import sys
import time


def main():
    import fcntl  # NAS runs Linux; lock serializes setup across workflows.

    if sys.version_info < (3, 12):
        raise RuntimeError('NAS requires Python 3.12 or newer')
    requirements = Path(__file__).resolve().parents[1] / 'requirements.txt'
    identity = f'{sys.version}|{sys.executable}|{platform.machine()}|v1'.encode()
    key = hashlib.sha256(identity + requirements.read_bytes()).hexdigest()
    root = Path('/home/runner/state/python-envs')
    root.mkdir(parents=True, exist_ok=True)
    environment = root / key
    python = environment / 'bin/python'
    marker = environment / '.ready'
    deadline = time.monotonic() + 360

    def run(command, seconds, env=None):
        budget = min(seconds, deadline - time.monotonic())
        if budget <= 0:
            raise TimeoutError('NAS Python setup exceeded its time budget')
        subprocess.run(command, check=True, timeout=budget, env=env)

    # Exact versions plus imports detect incomplete/corrupt cached environments.
    check = '''import importlib.metadata as m, pathlib, sys
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    line = line.strip()
    if line and not line.startswith('#'):
        name, version = line.split('==', 1)
        assert m.version(name) == version, name
import bs4, soupsieve, typing_extensions, openpyxl, et_xmlfile, pymupdf
'''
    with (root / f'{key}.lock').open('a') as lock:
        # Fail promptly rather than wait behind another long installation.
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        usable = False
        if marker.is_file() and python.is_file():
            try:
                run([str(python), '-c', check, str(requirements)], 20)
                run([str(python), '-m', 'pip', 'check'], 20)
                usable = True
            except (subprocess.SubprocessError, OSError):
                print('Cached Python environment failed validation; repairing', flush=True)
        if not usable:
            marker.unlink(missing_ok=True)
            run([sys.executable, '-m', 'venv', str(environment)], 40)
            common = [str(python), '-m', 'pip', '--isolated', 'install',
                      '--disable-pip-version-check', '--no-input', '--force-reinstall', '--retries', '1',
                      '--timeout', '15', '--only-binary=:all:', '-r', str(requirements)]
            mirror_env = dict(os.environ, NO_PROXY='*', no_proxy='*')
            try:
                run(common + ['--index-url', 'https://mirrors.aliyun.com/pypi/simple/'], 150, mirror_env)
            except (subprocess.SubprocessError, OSError):
                print('Domestic mirror failed; trying official PyPI once', flush=True)
                run(common + ['--index-url', 'https://pypi.org/simple/'], 120)
            run([str(python), '-c', check, str(requirements)], 20)
            run([str(python), '-m', 'pip', 'check'], 20)
            marker.write_text(key, encoding='utf-8')
            print('NAS Python environment installed and verified', flush=True)
        else:
            print('Reusing verified NAS Python environment; no package download', flush=True)
        # Written only after successful validation. Collection never uses a partial env.
        with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as output:
            output.write(f'NAS_PYTHON={python}\n')


if __name__ == '__main__':
    main()

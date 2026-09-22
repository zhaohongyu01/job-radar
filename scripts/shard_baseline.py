"""Prepare and verify a compact, version-bound universities baseline."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time


def prepare(source, destination):
    # Verification on NAS uses only the standard library, before pip installation.
    from collect import source_pack_ids

    raw = Path(source).read_bytes()
    baseline = json.loads(raw)
    owned = set(source_pack_ids('universities-b'))
    compact = {
        'last_run_at': baseline['last_run_at'],
        'jobs': {k: v for k, v in baseline['jobs'].items() if v.get('source_id') in owned},
        # Keep all small source states so cross-pack host cooldowns remain intact.
        'sources': baseline.get('sources', {}),
        'pending': {k: v for k, v in baseline.get('pending', {}).items() if k in owned},
    }
    data = json.dumps(compact, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(data).hexdigest()
    metadata = {
        'schema_version': 1, 'pack': 'universities-b',
        'generation': compact['last_run_at'], 'sha256': digest,
        'bytes': len(data), 'original_bytes': len(raw), 'jobs': len(compact['jobs']),
        'source_ids': sorted(owned),
    }
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'state.json').write_bytes(data)
    (destination / 'baseline-manifest.json').write_text(json.dumps(metadata), encoding='utf-8')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'baseline_sha256={digest}\n')
    print(f'Universities baseline: {len(raw)} -> {len(data)} bytes; {len(compact["jobs"])} records')


def verify(directory, expected_digest):
    directory = Path(directory)
    raw = (directory / 'state.json').read_bytes()
    metadata = json.loads((directory / 'baseline-manifest.json').read_bytes())
    digest = hashlib.sha256(raw).hexdigest()
    if (metadata.get('schema_version') != 1 or metadata.get('pack') != 'universities-b'
            or digest != expected_digest or digest != metadata.get('sha256')
            or len(raw) != metadata.get('bytes')):
        raise ValueError('Universities baseline integrity check failed')
    state = json.loads(raw)
    if state.get('last_run_at') != metadata.get('generation') or not state.get('last_run_at'):
        raise ValueError('Universities baseline generation missing or mismatched')
    owned = set(metadata['source_ids'])
    if (any(job.get('source_id') not in owned for job in state['jobs'].values())
            or set(state.get('pending', {})) - owned or len(state['jobs']) != metadata['jobs']):
        raise ValueError('Universities baseline scope mismatch')
    elapsed = time.time() - float(os.environ.get('BASELINE_DOWNLOAD_STARTED', time.time()))
    report = (f'高校基线校验通过：{len(raw):,} 字节，{len(state["jobs"]):,} 条历史记录；'
              f'原始全站基线 {metadata["original_bytes"]:,} 字节；下载及校验耗时约 {max(0, elapsed):.1f} 秒。')
    print(report)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
            summary.write(report + '\n\n文件大小为解压后的 JSON 大小，实际压缩传输量见下载步骤日志。\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('prepare')
    create.add_argument('--source', type=Path, required=True)
    create.add_argument('--output', type=Path, required=True)
    check = commands.add_parser('verify')
    check.add_argument('--directory', type=Path, required=True)
    check.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.source, args.output)
    else:
        verify(args.directory, args.expected_sha256)

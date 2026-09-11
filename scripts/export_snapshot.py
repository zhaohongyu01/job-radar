"""Regenerate public assets from retained state without claiming a new collection."""
import argparse
import json
from pathlib import Path
from collect import ROOT, export_snapshot

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state',type=Path,default=ROOT/'data/state.json')
    parser.add_argument('--public-dir',type=Path,default=ROOT/'public')
    parser.add_argument('--days',type=int,default=180)
    args=parser.parse_args()
    state=json.loads(args.state.read_text(encoding='utf-8'))
    snapshot=export_snapshot(state,args.public_dir,args.days)
    print(json.dumps({'raw':snapshot['raw_records'],'displayed':len(snapshot['jobs']),
                      'generated_at':snapshot['generated_at'],
                      'detail_shards':len(snapshot['detail_shards'])}))

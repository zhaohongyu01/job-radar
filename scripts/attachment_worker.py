"""Parse one attachment in a process that the caller can terminate."""
import contextlib
import io
import json
import sys

from parse_positions import parse_excel_bytes, parse_pdf_bytes

if __name__ == '__main__':
    data = sys.stdin.buffer.read(3_500_001)
    if len(data) > 3_500_000:
        raise SystemExit(2)
    with contextlib.redirect_stdout(io.StringIO()):
        parser = parse_excel_bytes if sys.argv[1] == 'xlsx' else parse_pdf_bytes
        positions = parser(data, filename=sys.argv[2])
    sys.stdout.buffer.write(json.dumps(positions, ensure_ascii=False).encode('utf-8'))

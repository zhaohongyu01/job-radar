// Measure per-field UTF-8 byte share and average serialized length across browse_index shards.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  let publicDir = 'public';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--public-dir' && argv[i + 1]) {
      publicDir = argv[++i];
    }
  }
  return { publicDir };
}

export function measureBrowseFields(directory) {
  const root = realpathSync(directory);
  const snapshotRaw = readFileSync(resolve(root, 'jobs.json'));
  const snapshot = JSON.parse(snapshotRaw.toString('utf8'));
  const shardPaths = snapshot.browse_index?.shards?.length
    ? snapshot.browse_index.shards
    : snapshot.index_shards || [];

  let totalFileBytes = 0;
  let totalRows = 0;
  const fieldStats = new Map();

  const processRow = (row) => {
    totalRows++;
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined) continue;
      const valJson = JSON.stringify(value);
      const entryBytes = Buffer.byteLength(JSON.stringify(key) + ':' + valJson, 'utf8') + 1;
      const valChars = typeof value === 'string' ? Array.from(value).length : valJson.length;
      const stat = fieldStats.get(key) || { presentCount: 0, bytes: 0, totalLen: 0 };
      stat.presentCount++;
      stat.bytes += entryBytes;
      stat.totalLen += valChars;
      fieldStats.set(key, stat);
    }
  };

  if (shardPaths.length > 0) {
    for (const relPath of shardPaths) {
      const buf = readFileSync(resolve(root, relPath.replace(/^\//, '')));
      totalFileBytes += buf.byteLength;
      const parsed = JSON.parse(buf.toString('utf8'));
      for (const row of parsed.jobs || []) {
        processRow(row);
      }
    }
  } else {
    totalFileBytes = snapshotRaw.byteLength;
    for (const row of snapshot.jobs || []) {
      processRow(row);
    }
  }

  const fields = [...fieldStats.entries()]
    .map(([field, stat]) => ({
      field,
      present: stat.presentCount,
      bytes: stat.bytes,
      pct: totalFileBytes > 0 ? Number(((stat.bytes / totalFileBytes) * 100).toFixed(2)) : 0,
      avgLen: stat.presentCount > 0 ? Number((stat.totalLen / stat.presentCount).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    mode: snapshot.browse_index?.shards?.length ? `browse_index_v${snapshot.browse_index.version}` : 'canonical',
    shards: shardPaths.length,
    rows: totalRows,
    totalBytes: totalFileBytes,
    totalMiB: Number((totalFileBytes / (1024 * 1024)).toFixed(3)),
    fields,
  };
}

const { publicDir } = parseArgs(process.argv.slice(2));
const report = measureBrowseFields(publicDir);
console.log(
  `Mode: ${report.mode} | Shards: ${report.shards} | Rows: ${report.rows} | Total: ${report.totalBytes.toLocaleString()} bytes (${report.totalMiB} MiB)`,
);
console.log('Field'.padEnd(24) + 'Bytes'.padStart(12) + 'Share%'.padStart(9) + 'Present'.padStart(10) + 'AvgLen'.padStart(9));
console.log('-'.repeat(64));
for (const f of report.fields) {
  console.log(
    f.field.padEnd(24) +
      f.bytes.toLocaleString().padStart(12) +
      `${f.pct.toFixed(2)}%`.padStart(9) +
      String(f.present).padStart(10) +
      String(f.avgLen).padStart(9),
  );
}

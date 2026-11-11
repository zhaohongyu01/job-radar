import type { Job } from '../jobs.ts';

export interface RadarJobFacets {
  cities: Record<string, number>;
  types: Record<string, number>;
  sectors: Record<string, number>;
  educations: Record<string, number>;
  kinds: Record<string, number>;
}

export interface RadarJobsQueryParams {
  q?: string;
  cities?: string[];
  includeNationwide?: boolean;
  type?: string;
  sector?: string;
  education?: string;
  kind?: string;
  minSalary?: number | null;
  sort?: 'newest' | 'deadline' | 'salary';
  page?: number;
  pageSize?: number;
}

export interface RadarJobsQuerySuccess {
  ok: true;
  engine: 'sqlite' | 'static-edge' | 'd1';
  generated_at: string;
  total: number;
  page: number;
  pageSize: number;
  jobs: Job[];
  facets: RadarJobFacets | null;
}

export interface RadarJobsQueryFallback {
  ok: false;
  fallback: 'static';
  reason?: string;
}

export type RadarJobsQueryResponse = RadarJobsQuerySuccess | RadarJobsQueryFallback;

export interface SqlReadAdapter {
  engine: 'd1' | 'sqlite';
  queryAll<T = Record<string, unknown>>(sql: string, params?: (string | number | null)[]): Promise<T[]>;
}

function escapeFtsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

export function normalizeQueryParams(raw: URLSearchParams | RadarJobsQueryParams): Required<RadarJobsQueryParams> {
  if (raw instanceof URLSearchParams) {
    const citiesRaw = (raw.get('city') || raw.get('cities') || '').trim();
    const cities = citiesRaw
      ? citiesRaw
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c && c !== '全部')
          .slice(0, 8)
      : [];
    const minSalNum = Number(raw.get('minSalary') || '');
    const pageNum = Number(raw.get('page') || '1');
    const pageSizeNum = Number(raw.get('pageSize') || '20');
    const sortRaw = raw.get('sort');
    const sort: 'newest' | 'deadline' | 'salary' =
      sortRaw === 'deadline' || sortRaw === 'salary' ? sortRaw : 'newest';
    return {
      q: (raw.get('q') || '').trim().slice(0, 80),
      cities,
      includeNationwide: raw.get('exactCity') !== '1',
      type: (raw.get('type') || '全部').trim(),
      sector: (raw.get('sector') || '全部').trim(),
      education: (raw.get('education') || '全部').trim(),
      kind: (raw.get('kind') || '全部').trim(),
      minSalary: Number.isFinite(minSalNum) && minSalNum > 0 ? minSalNum : null,
      sort,
      page: Number.isInteger(pageNum) && pageNum > 0 ? Math.min(pageNum, 500) : 1,
      pageSize: Number.isInteger(pageSizeNum) && pageSizeNum > 0 ? Math.min(pageSizeNum, 50) : 20,
    };
  }

  return {
    q: (raw.q || '').trim().slice(0, 80),
    cities: (raw.cities || []).filter((c) => c && c !== '全部').slice(0, 8),
    includeNationwide: raw.includeNationwide ?? true,
    type: (raw.type || '全部').trim(),
    sector: (raw.sector || '全部').trim(),
    education: (raw.education || '全部').trim(),
    kind: (raw.kind || '全部').trim(),
    minSalary: typeof raw.minSalary === 'number' && Number.isFinite(raw.minSalary) && raw.minSalary > 0 ? raw.minSalary : null,
    sort: raw.sort === 'deadline' || raw.sort === 'salary' ? raw.sort : 'newest',
    page: typeof raw.page === 'number' && Number.isInteger(raw.page) && raw.page > 0 ? Math.min(raw.page, 500) : 1,
    pageSize: typeof raw.pageSize === 'number' && Number.isInteger(raw.pageSize) && raw.pageSize > 0 ? Math.min(raw.pageSize, 50) : 20,
  };
}

export function buildJobsSqlQuery(
  input: RadarJobsQueryParams,
  options?: { useFts?: boolean },
): {
  countSql: string;
  rowsSql: string;
  whereParams: (string | number)[];
  limitParams: (string | number)[];
  page: number;
  pageSize: number;
} {
  const useFts = options?.useFts ?? true;
  const p = normalizeQueryParams(input);
  const clauses: string[] = ["j.listing_status != 'withdrawn'"];
  const params: (string | number)[] = [];

  if (p.cities.length > 0) {
    const cityChecks = p.cities.map(() => 'INSTR(j.cities_pipe, ?) > 0');
    for (const c of p.cities) {
      params.push(`|${c}|`);
    }
    if (p.includeNationwide) {
      clauses.push(`(${cityChecks.join(' OR ')} OR j.nationwide = 1)`);
    } else {
      clauses.push(`(${cityChecks.join(' OR ')})`);
    }
  }

  if (p.type && p.type !== '全部') {
    clauses.push('INSTR(j.types_pipe, ?) > 0');
    params.push(`|${p.type}|`);
  }

  if (p.sector && p.sector !== '全部') {
    clauses.push('INSTR(j.sectors_pipe, ?) > 0');
    params.push(`|${p.sector}|`);
  }

  if (p.education && p.education !== '全部') {
    clauses.push('j.education = ?');
    params.push(p.education);
  }

  if (p.kind && p.kind !== '全部') {
    clauses.push('j.kind = ?');
    params.push(p.kind);
  }

  if (p.minSalary !== null) {
    clauses.push('j.salary_min IS NOT NULL AND j.salary_min >= ?');
    params.push(p.minSalary);
  }

  if (p.q) {
    const terms = p.q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5);
    if (!useFts) {
      for (const term of terms) {
        clauses.push('INSTR(j.search_text, ?) > 0');
        params.push(term);
      }
    } else {
      const ftsTerms = terms.filter((t) => Array.from(t).length >= 3);
      const shortTerms = terms.filter((t) => Array.from(t).length < 3);

      if (ftsTerms.length > 0) {
        const ftsExpr = ftsTerms.map(escapeFtsPhrase).join(' AND ');
        clauses.push('(j.id IN (SELECT id FROM jobs_fts WHERE jobs_fts MATCH ?) OR INSTR(j.search_text, ?) > 0)');
        params.push(ftsExpr, ftsTerms[0]);
        for (const extra of ftsTerms.slice(1)) {
          clauses.push('INSTR(j.search_text, ?) > 0');
          params.push(extra);
        }
      }
      for (const st of shortTerms) {
        clauses.push('INSTR(j.search_text, ?) > 0');
        params.push(st);
      }
    }
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  let orderSql = 'ORDER BY j.seq ASC';
  if (p.sort === 'deadline') {
    orderSql = "ORDER BY CASE WHEN j.deadline = '' THEN 1 ELSE 0 END ASC, j.deadline ASC, j.seq ASC";
  } else if (p.sort === 'salary') {
    orderSql = 'ORDER BY CASE WHEN j.salary_min IS NULL THEN 1 ELSE 0 END ASC, j.salary_min DESC, j.seq ASC';
  }

  const offset = (p.page - 1) * p.pageSize;
  return {
    countSql: `SELECT COUNT(*) AS total FROM jobs j ${whereSql}`,
    rowsSql: `SELECT j.row_json FROM jobs j ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    whereParams: params,
    limitParams: [...params, p.pageSize, offset],
    page: p.page,
    pageSize: p.pageSize,
  };
}

let cachedNodeSqliteAdapter: SqlReadAdapter | null | undefined;
let cachedNodeSqliteMtime = 0;

async function resolveDefaultAdapter(): Promise<SqlReadAdapter | null> {
  // 1. Cloudflare Workers D1 binding (`env.DB`)
  try {
    const cfModName = 'cloudflare:' + 'workers';
    const cf = (await import(/* @vite-ignore */ cfModName)) as {
      env?: {
        DB?: {
          prepare: (sql: string) => {
            bind: (...values: unknown[]) => { all: <T>() => Promise<{ results?: T[] }> };
            all: <T>() => Promise<{ results?: T[] }>;
          };
        };
      };
    };
    const d1 = cf?.env?.DB;
    if (d1 && typeof d1.prepare === 'function') {
      const adapter: SqlReadAdapter = {
        engine: 'd1',
        async queryAll<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []) {
          const stmt = d1.prepare(sql);
          const bound = params.length > 0 ? stmt.bind(...params) : stmt;
          const out = await bound.all<T>();
          return out.results || [];
        },
      };
      // Verify schema is populated (Miniflare local placeholder D1 may be empty)
      const check = await adapter.queryAll<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'jobs_generated_at' LIMIT 1",
      );
      if (check.length > 0 && check[0]?.value) {
        return adapter;
      }
    }
  } catch {
    // Not running inside Cloudflare workerd or D1 not bound; continue to node:sqlite.
  }

  // 2. Portable Node.js `node:sqlite` (`data/radar.sqlite` for domestic cloud / NAS Docker / local dev)
  try {
    const fsModName = 'node:' + 'fs';
    const pathModName = 'node:' + 'path';
    const sqliteModName = 'node:' + 'sqlite';
    const fs = await import(/* @vite-ignore */ fsModName);
    const path = await import(/* @vite-ignore */ pathModName);
    const dbPath = path.resolve(
      process.env.RADAR_SQLITE_PATH || path.join(process.cwd(), 'data', 'radar.sqlite'),
    );
    if (!fs.existsSync(dbPath)) {
      cachedNodeSqliteAdapter = null;
      return null;
    }
    const stat = fs.statSync(dbPath);
    if (cachedNodeSqliteAdapter && stat.mtimeMs === cachedNodeSqliteMtime) {
      return cachedNodeSqliteAdapter;
    }
    const { DatabaseSync } = (await import(/* @vite-ignore */ sqliteModName)) as {
      DatabaseSync: new (
        filename: string,
        options?: { readOnly?: boolean },
      ) => {
        prepare: (sql: string) => { all: (...params: (string | number | null)[]) => unknown[] };
      };
    };
    const db = new DatabaseSync(dbPath, { readOnly: true });
    cachedNodeSqliteMtime = stat.mtimeMs;
    cachedNodeSqliteAdapter = {
      engine: 'sqlite',
      async queryAll<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []) {
        return db.prepare(sql).all(...params) as T[];
      },
    };
    return cachedNodeSqliteAdapter;
  } catch {
    return null;
  }
}

export async function queryRadarJobs(
  rawParams: URLSearchParams | RadarJobsQueryParams,
  customAdapter?: SqlReadAdapter | null,
): Promise<RadarJobsQueryResponse> {
  const adapter = customAdapter !== undefined ? customAdapter : await resolveDefaultAdapter();
  if (!adapter) {
    return { ok: false, fallback: 'static', reason: 'no_db_binding' };
  }

  try {
    const metaRows = await adapter.queryAll<{ key: string; value: string }>(
      "SELECT key, value FROM meta WHERE key IN ('jobs_generated_at', 'facets_json')",
    );
    const metaMap = new Map(metaRows.map((r) => [r.key, r.value]));
    const generatedAt = metaMap.get('jobs_generated_at') || '';
    if (!generatedAt) {
      return { ok: false, fallback: 'static', reason: 'empty_meta' };
    }

    let facets: RadarJobFacets | null = null;
    const facetsRaw = metaMap.get('facets_json');
    if (facetsRaw) {
      try {
        facets = JSON.parse(facetsRaw) as RadarJobFacets;
      } catch {
        facets = null;
      }
    }

    const normalized = normalizeQueryParams(rawParams);
    const built = buildJobsSqlQuery(normalized, { useFts: adapter.engine === 'sqlite' });

    const [countRows, dataRows] = await Promise.all([
      adapter.queryAll<{ total: number }>(built.countSql, built.whereParams),
      adapter.queryAll<{ row_json: string }>(built.rowsSql, built.limitParams),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const jobs: Job[] = [];
    for (const r of dataRows) {
      if (typeof r.row_json === 'string') {
        jobs.push(JSON.parse(r.row_json) as Job);
      }
    }

    return {
      ok: true,
      engine: adapter.engine,
      generated_at: generatedAt,
      total,
      page: built.page,
      pageSize: built.pageSize,
      jobs,
      facets,
    };
  } catch {
    return { ok: false, fallback: 'static', reason: 'query_error' };
  }
}

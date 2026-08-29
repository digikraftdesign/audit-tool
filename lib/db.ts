/**
 * SQLite access via Node's built-in `node:sqlite` (DatabaseSync).
 * No native npm addon — works on Hostinger and other hosts that cannot
 * compile better-sqlite3 (old system Python / missing build tools).
 *
 * Requires Node.js 22.13+ (Hostinger ships 22.18).
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import { config } from '@/lib/config';
import { defaultSqlitePath, now, storagePath } from '@/lib/util';

type SqlValue = string | number | bigint | Buffer | null;
type Row = Record<string, unknown>;

export type RunResult = {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
};

let db: DatabaseSync | null = null;
let driverName: 'sqlite' | 'mysql' = 'sqlite';

function install(database: DatabaseSync): void {
  const text = 'TEXT';
  const vc = (n: number) => `VARCHAR(${n})`;

  database.exec(`CREATE TABLE IF NOT EXISTS dk_audits (
    id ${vc(32)} NOT NULL PRIMARY KEY,
    token ${vc(64)} NOT NULL,
    created_at ${vc(20)} NOT NULL,
    updated_at ${vc(20)} NOT NULL,
    status ${vc(20)} NOT NULL,
    step ${vc(20)} NOT NULL,
    audit_type ${vc(20)} NOT NULL,
    company ${vc(190)} NOT NULL,
    sector ${vc(120)} NULL,
    site ${vc(500)} NULL,
    structure ${text} NULL,
    answers ${text} NULL,
    manual ${text} NULL,
    result ${text} NULL,
    direction ${text} NULL,
    tier ${vc(20)} NULL,
    followup_day ${vc(20)} NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    client_ip ${vc(45)} NULL,
    error ${text} NULL
  )`);

  database.exec(`CREATE TABLE IF NOT EXISTS dk_uploads (
    id ${vc(64)} NOT NULL PRIMARY KEY,
    stored ${vc(120)} NOT NULL,
    name ${vc(255)} NOT NULL,
    mime ${vc(120)} NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    created_at ${vc(20)} NOT NULL,
    client_ip ${vc(45)} NULL
  )`);

  database.exec(`CREATE TABLE IF NOT EXISTS dk_artifacts (
    audit_id ${vc(32)} NOT NULL,
    akey ${vc(60)} NOT NULL,
    payload BLOB NULL,
    updated_at ${vc(20)} NOT NULL,
    PRIMARY KEY (audit_id, akey)
  )`);

  database.exec(`CREATE TABLE IF NOT EXISTS dk_hits (
    ip ${vc(45)} NOT NULL,
    ts INTEGER NOT NULL
  )`);

  for (const [column, definition] of [
    ['audit_type', `${vc(20)} NOT NULL DEFAULT 'landing'`],
    ['answers', `${text} NULL`],
    ['manual', `${text} NULL`],
  ] as const) {
    try {
      database.exec(`ALTER TABLE dk_audits ADD COLUMN ${column} ${definition}`);
    } catch {
      // column already present
    }
  }

  try {
    database.exec('CREATE INDEX idx_dk_hits_ts ON dk_hits (ts)');
  } catch {
    // index already there
  }
  try {
    database.exec('CREATE INDEX idx_dk_audits_created ON dk_audits (created_at)');
  } catch {
    // index already there
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;

  const cfg = config('db') as {
    driver?: string;
    sqlite_path?: string;
  };
  const driver = String(cfg?.driver ?? 'sqlite').toLowerCase();

  if (driver === 'mysql') {
    throw new Error(
      'MySQL driver is not available in the TypeScript port; use sqlite (DB_DRIVER=sqlite).',
    );
  }

  let sqlitePath = String(cfg?.sqlite_path ?? '').trim();
  if (sqlitePath === '' || sqlitePath === storagePath('audits.sqlite')) {
    sqlitePath = defaultSqlitePath();
  }
  const dir = path.dirname(sqlitePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const database = new DatabaseSync(sqlitePath, { timeout: 5000 });
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA busy_timeout = 5000');
  driverName = 'sqlite';
  install(database);
  db = database;
  return database;
}

export function driver(): string {
  getDb();
  return driverName;
}

export function run(sql: string, args: SqlValue[] = []): RunResult {
  return getDb().prepare(sql).run(...args) as RunResult;
}

export function one<T extends Row = Row>(sql: string, args: SqlValue[] = []): T | null {
  const row = getDb().prepare(sql).get(...args) as T | undefined;
  return row ?? null;
}

export function all<T extends Row = Row>(sql: string, args: SqlValue[] = []): T[] {
  return getDb().prepare(sql).all(...args) as T[];
}

export function putArtifact(auditId: string, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  const blob = gzipSync(Buffer.from(json, 'utf8'), { level: 6 });
  run('DELETE FROM dk_artifacts WHERE audit_id = ? AND akey = ?', [auditId, key]);
  run('INSERT INTO dk_artifacts (audit_id, akey, payload, updated_at) VALUES (?, ?, ?, ?)', [
    auditId,
    key,
    blob,
    now(),
  ]);
}

export function getArtifact(auditId: string, key: string, defaultValue: unknown = null): unknown {
  const row = one<{ payload: Buffer | Uint8Array | string | null }>(
    'SELECT payload FROM dk_artifacts WHERE audit_id = ? AND akey = ?',
    [auditId, key],
  );
  if (!row || row.payload == null) {
    return defaultValue;
  }
  let blob: Buffer =
    Buffer.isBuffer(row.payload)
      ? row.payload
      : typeof row.payload === 'string'
        ? Buffer.from(row.payload)
        : Buffer.from(row.payload);

  if (blob.length === 0) {
    return defaultValue;
  }

  if (blob[0] === 0x1f && blob[1] === 0x8b) {
    try {
      blob = gunzipSync(blob);
    } catch {
      // keep compressed bytes and try JSON decode below
    }
  }

  try {
    const data = JSON.parse(blob.toString('utf8'));
    return data === null ? defaultValue : data;
  } catch {
    return defaultValue;
  }
}

export function dropArtifacts(auditId: string): void {
  run('DELETE FROM dk_artifacts WHERE audit_id = ?', [auditId]);
}

export function rateOk(ip: string, perHour: number): boolean {
  const cut = Math.floor(Date.now() / 1000) - 3600;
  run('DELETE FROM dk_hits WHERE ts < ?', [cut - 3600]);
  const row = one<{ c: number }>('SELECT COUNT(*) AS c FROM dk_hits WHERE ip = ? AND ts >= ?', [
    ip,
    cut,
  ]);
  if (row && Number(row.c) >= perHour) {
    return false;
  }
  run('INSERT INTO dk_hits (ip, ts) VALUES (?, ?)', [ip, Math.floor(Date.now() / 1000)]);
  return true;
}

const Db = {
  getDb,
  driver,
  run,
  one,
  all,
  putArtifact,
  getArtifact,
  dropArtifacts,
  rateOk,
};

export default Db;

/**
 * DigiKraft Creative Growth Audit — configuration.
 * Mirrors legacy/config.sample.php keys, sourced from environment variables.
 */

export interface MysqlConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  pass: string;
  charset: string;
}

export interface DbConfig {
  driver: 'sqlite' | 'mysql';
  sqlite_path: string;
  mysql: MysqlConfig;
}

export interface CrawlConfig {
  max_pages: number;
  timeout: number;
  connect_timeout: number;
  max_bytes: number;
  max_redirects: number;
  user_agent: string;
  obey_robots: boolean;
  allow_private_hosts: boolean;
}

export interface UploadConfig {
  max_bytes: number;
  extensions: string[];
  keep_hours: number;
}

export interface RateLimitConfig {
  audits_per_hour: number;
}

export interface AppConfig {
  app_name: string;
  brand_short: string;
  passcode: string;
  db: DbConfig;
  crawl: CrawlConfig;
  upload: UploadConfig;
  step_budget: number;
  rate_limit: RateLimitConfig;
  psi_api_key: string;
}

function env(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

function buildConfig(): AppConfig {
  return {
    app_name: env('APP_NAME', 'DigiKraft · Creative Growth Audit'),
    brand_short: env('BRAND_SHORT', 'DigiKraft'),
    passcode: env('PASSCODE', ''),
    db: {
      driver: (env('DB_DRIVER', 'sqlite').toLowerCase() === 'mysql' ? 'mysql' : 'sqlite'),
      sqlite_path: env('SQLITE_PATH', ''),
      mysql: {
        host: env('MYSQL_HOST', 'localhost'),
        port: envInt('MYSQL_PORT', 3306),
        name: env('MYSQL_NAME', ''),
        user: env('MYSQL_USER', ''),
        pass: env('MYSQL_PASS', ''),
        charset: env('MYSQL_CHARSET', 'utf8mb4'),
      },
    },
    crawl: {
      max_pages: envInt('CRAWL_MAX_PAGES', 8),
      timeout: envInt('CRAWL_TIMEOUT', 12),
      connect_timeout: envInt('CRAWL_CONNECT_TIMEOUT', 6),
      max_bytes: envInt('CRAWL_MAX_BYTES', 2500000),
      max_redirects: envInt('CRAWL_MAX_REDIRECTS', 4),
      user_agent: env(
        'CRAWL_USER_AGENT',
        'DigiKraftAuditBot/1.0 (+https://digikraft.in; creative growth audit)',
      ),
      obey_robots: envBool('CRAWL_OBEY_ROBOTS', true),
      allow_private_hosts: envBool('CRAWL_ALLOW_PRIVATE_HOSTS', false),
    },
    upload: {
      max_bytes: envInt('UPLOAD_MAX_BYTES', 20 * 1024 * 1024),
      extensions: env('UPLOAD_EXTENSIONS', 'pdf,docx,pptx,txt,md,html,htm')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      keep_hours: envInt('UPLOAD_KEEP_HOURS', 24),
    },
    step_budget: envInt('STEP_BUDGET', 20),
    rate_limit: {
      audits_per_hour: envInt('RATE_LIMIT_AUDITS_PER_HOUR', 30),
    },
    psi_api_key: env('PSI_API_KEY', ''),
  };
}

let cached: AppConfig | null = null;

/** Full config, or a dotted key path with optional default. */
export function config(): AppConfig;
export function config<T = unknown>(key: string, defaultValue?: T): T;
export function config(key?: string, defaultValue?: unknown): unknown {
  if (cached === null) {
    cached = buildConfig();
  }
  if (key === undefined) {
    return cached;
  }
  let node: unknown = cached;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in (node as Record<string, unknown>))) {
      return defaultValue;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Reset cached config (tests / env reloads). */
export function resetConfig(): void {
  cached = null;
}

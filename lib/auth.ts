import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';

export type SessionData = {
  authorised?: boolean;
};

function sessionPassword(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  const pass = config('passcode', '') as string;
  if (pass.length >= 32) return pass;
  // Dev fallback — set SESSION_SECRET in production
  return 'dk-audit-dev-session-secret-change-me!!';
}

export const sessionOptions: SessionOptions = {
  password: sessionPassword(),
  cookieName: 'dk_audit_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function isAuthorised(): Promise<boolean> {
  const passcode = String(config('passcode', '') ?? '');
  if (passcode === '') return true;
  const session = await getSession();
  return !!session.authorised;
}

export async function requireAuth(): Promise<
  { ok: true } | { ok: false; response: Response }
> {
  if (await isAuthorised()) return { ok: true };
  return {
    ok: false,
    response: jsonFail('Passcode required', 401, { need_passcode: true }),
  };
}

export function jsonOk(data: Record<string, unknown> = {}, status = 200): Response {
  return Response.json({ ok: true, ...data }, { status });
}

export function jsonFail(
  error: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ ok: false, error, ...extra }, { status });
}

/** Same-origin guard for mutating requests (mirrors api.php). */
export function assertSameOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin') ?? '';
  // Non-browser clients and same-origin GET navigations often omit Origin.
  if (!origin) {
    const site = req.headers.get('sec-fetch-site') ?? '';
    if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
      return jsonFail('Cross-origin request refused', 403);
    }
    return null;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return jsonFail('Cross-origin request refused', 403);
  }

  const candidates = collectRequestHosts(req);
  if (hostMatches(originHost, candidates)) {
    return null;
  }

  return jsonFail('Cross-origin request refused', 403);
}

function collectRequestHosts(req: Request): Set<string> {
  const hosts = new Set<string>();

  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const first = raw.split(',')[0]?.trim();
    if (!first) return;
    hosts.add(first.toLowerCase());
    // host:port without scheme
    try {
      hosts.add(new URL(first.includes('://') ? first : `https://${first}`).host.toLowerCase());
    } catch {
      /* ignore */
    }
  };

  // What the browser / reverse proxy believe the public host is.
  add(req.headers.get('x-forwarded-host'));
  add(req.headers.get('host'));
  add(process.env.APP_URL);
  add(process.env.NEXT_PUBLIC_APP_URL);

  for (const entry of (process.env.ALLOWED_ORIGINS || '').split(',')) {
    add(entry.trim());
  }

  // Fallback only — behind Hostinger this is often localhost and must not
  // be the sole check.
  try {
    add(new URL(req.url).host);
  } catch {
    /* ignore */
  }

  return hosts;
}

function hostMatches(originHost: string, candidates: Set<string>): boolean {
  const strip = (h: string) => h.replace(/:(80|443)$/, '');
  const want = strip(originHost);
  for (const c of candidates) {
    if (strip(c) === want) return true;
  }
  return false;
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const data = await req.json();
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

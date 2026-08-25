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
  const site = req.headers.get('sec-fetch-site') ?? '';
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
    return jsonFail('Cross-origin request refused', 403);
  }
  const origin = req.headers.get('origin') ?? '';
  if (origin) {
    try {
      const host = new URL(req.url).host;
      if (host && !origin.toLowerCase().includes(host.toLowerCase())) {
        return jsonFail('Cross-origin request refused', 403);
      }
    } catch {
      return jsonFail('Cross-origin request refused', 403);
    }
  }
  return null;
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

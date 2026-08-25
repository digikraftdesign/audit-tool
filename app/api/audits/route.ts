import {
  assertSameOrigin,
  jsonFail,
  jsonOk,
  readJsonBody,
  requireAuth,
} from '@/lib/auth';
import { config } from '@/lib/config';
import { rateOk } from '@/lib/db';
import Service from '@/lib/audit/service';
import { clientIp } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const originFail = assertSameOrigin(req);
  if (originFail) return originFail;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const perHour = Number(config('rate_limit.audits_per_hour', 30));
  const ip = clientIp(req.headers);
  if (perHour > 0 && !rateOk(ip, perHour)) {
    return jsonFail(
      'Too many audits from this connection in the last hour. Try again shortly.',
      429,
    );
  }

  try {
    const body = await readJsonBody(req);
    const svc = new Service();
    const created = await svc.create(body);
    return jsonOk(created);
  } catch (e) {
    return jsonFail(e instanceof Error ? e.message : String(e), 500);
  }
}

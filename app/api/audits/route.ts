import {
  assertSameOrigin,
  jsonFail,
  jsonOk,
  readJsonBody,
  requireAuth,
} from '@/lib/auth';
import { config } from '@/lib/config';
import { rateOk } from '@/lib/db';
import Service, { AuditValidationError } from '@/lib/audit/service';
import { createLogger } from '@/lib/logger';
import { clientIp } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('api.audits.create');

export async function POST(req: Request) {
  const originFail = assertSameOrigin(req);
  if (originFail) return originFail;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const perHour = Number(config('rate_limit.audits_per_hour', 30));
  const ip = clientIp(req.headers);
  if (perHour > 0 && !rateOk(ip, perHour)) {
    log.warn('rate_limited', { ip });
    return jsonFail(
      'Too many audits from this connection in the last hour. Try again shortly.',
      429,
    );
  }

  try {
    const body = await readJsonBody(req);
    log.info('request', { type: String(body.type ?? '') });
    const svc = new Service();
    const created = await svc.create(body);
    log.info('response', {
      auditId: created.id,
      type: created.type,
      steps: created.steps.length,
    });
    return jsonOk(created);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof AuditValidationError) {
      log.warn('rejected', { error: message });
      return jsonFail(message, 400);
    }
    log.error('response_error', e instanceof Error ? e : new Error(message));
    return jsonFail(message, 500);
  }
}

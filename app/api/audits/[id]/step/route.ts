import {
  assertSameOrigin,
  jsonFail,
  jsonOk,
  readJsonBody,
  requireAuth,
} from '@/lib/auth';
import Service from '@/lib/audit/service';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('api.audits.step');

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const originFail = assertSameOrigin(req);
  if (originFail) return originFail;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const body = await readJsonBody(req);
  const token = String(body.token ?? '');
  const step = String(body.step ?? '');
  const reqLog = log.child({ auditId: id, step });
  reqLog.info('request');

  const audit = Service.find(id, token);
  if (!audit) {
    reqLog.warn('not_found');
    return jsonFail('Audit not found', 404);
  }

  const steps = Service.steps(String(audit.audit_type));
  if (!steps.includes(step)) {
    reqLog.warn('unknown_step');
    return jsonFail('Unknown step');
  }

  try {
    const svc = new Service();
    const data = await svc.step(audit, step);
    if (data.done) {
      const fresh = Service.find(String(audit.id), String(audit.token));
      data.audit = fresh ? Service.payload(fresh) : null;
    }
    reqLog.info('response', {
      next: data.next ?? null,
      done: Boolean(data.done),
    });
    return jsonOk(data);
  } catch (e) {
    reqLog.error('response_error', e instanceof Error ? e : new Error(String(e)));
    return jsonFail(e instanceof Error ? e.message : String(e), 500);
  }
}

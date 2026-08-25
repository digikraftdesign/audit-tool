import {
  assertSameOrigin,
  jsonFail,
  jsonOk,
  readJsonBody,
  requireAuth,
} from '@/lib/auth';
import Service from '@/lib/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const audit = Service.find(id, token);
  if (!audit) return jsonFail('Audit not found', 404);

  const steps = Service.steps(String(audit.audit_type));
  if (!steps.includes(step)) return jsonFail('Unknown step');

  try {
    const svc = new Service();
    const data = await svc.step(audit, step);
    if (data.done) {
      const fresh = Service.find(String(audit.id), String(audit.token));
      data.audit = fresh ? Service.payload(fresh) : null;
    }
    return jsonOk(data);
  } catch (e) {
    return jsonFail(e instanceof Error ? e.message : String(e), 500);
  }
}

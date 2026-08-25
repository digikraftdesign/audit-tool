import {
  assertSameOrigin,
  jsonFail,
  jsonOk,
  readJsonBody,
  requireAuth,
} from '@/lib/auth';
import Types from '@/lib/audit/types';
import Service from '@/lib/audit/service';
import { run } from '@/lib/db';
import { now } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const audit = Service.find(id, token);
  if (!audit) return jsonFail('Audit not found', 404);

  const parameter = String(body.parameter ?? '');
  const params = Types.parameters(String(audit.audit_type));
  if (!(parameter in params)) return jsonFail('Unknown parameter');

  let manual: Record<string, number> = {};
  try {
    manual =
      typeof audit.manual === 'string'
        ? (JSON.parse(audit.manual || '{}') as Record<string, number>)
        : ((audit.manual as Record<string, number>) ?? {});
  } catch {
    manual = {};
  }

  if ('score' in body && (body.score === null || body.score === '')) {
    delete manual[parameter];
  } else {
    manual[parameter] = Math.max(0, Math.min(10, Number(body.score)));
  }

  run('UPDATE dk_audits SET manual = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(manual),
    now(),
    String(audit.id),
  ]);

  let fresh = Service.find(String(audit.id), String(audit.token));
  if (fresh) {
    Service.rescore(fresh);
    fresh = Service.find(String(audit.id), String(audit.token));
  }
  return jsonOk({ audit: fresh ? Service.payload(fresh) : null });
}

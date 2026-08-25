import {
  assertSameOrigin,
  jsonFail,
  jsonOk,
  readJsonBody,
  requireAuth,
} from '@/lib/auth';
import { run } from '@/lib/db';
import Playbook from '@/lib/audit/playbook';
import Service from '@/lib/audit/service';
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

  const tiers = Object.keys(Playbook.tiers());
  const tier = tiers.includes(String(body.tier ?? ''))
    ? String(body.tier)
    : String(audit.tier ?? '');
  const day = ['Tuesday', 'Wednesday'].includes(String(body.day ?? ''))
    ? String(body.day)
    : String(audit.followup_day ?? '');
  const dir =
    'direction' in body
      ? String(body.direction ?? '').trim().slice(0, 2000)
      : String(audit.direction ?? '');
  const closed =
    'closed' in body ? (body.closed ? 1 : 0) : Number(audit.closed ?? 0);

  run(
    'UPDATE dk_audits SET tier = ?, followup_day = ?, direction = ?, closed = ?, updated_at = ? WHERE id = ?',
    [tier, day, dir, closed, now(), String(audit.id)],
  );

  let result: Record<string, unknown> | null = null;
  try {
    result =
      typeof audit.result === 'string'
        ? (JSON.parse(audit.result || 'null') as Record<string, unknown> | null)
        : (audit.result as Record<string, unknown> | null);
  } catch {
    result = null;
  }
  if (result && typeof result === 'object') {
    result.recommended_tier = tier;
    result.followup_day = day;
    const direction =
      result.direction && typeof result.direction === 'object'
        ? { ...(result.direction as Record<string, unknown>) }
        : {};
    direction.copy = dir;
    result.direction = direction;
    run('UPDATE dk_audits SET result = ? WHERE id = ?', [
      JSON.stringify(result),
      String(audit.id),
    ]);
  }

  const fresh = Service.find(String(audit.id), String(audit.token));
  return jsonOk({ audit: fresh ? Service.payload(fresh) : null });
}

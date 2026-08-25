import { jsonFail, jsonOk, requireAuth } from '@/lib/auth';
import Service from '@/lib/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const audit = Service.find(id, token);
  if (!audit) return jsonFail('Audit not found', 404);
  return jsonOk({ audit: Service.payload(audit) });
}

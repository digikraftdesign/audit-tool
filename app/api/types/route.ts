import { jsonOk, requireAuth } from '@/lib/auth';
import Types from '@/lib/audit/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const out: Record<string, unknown> = {};
  for (const [id, t] of Object.entries(Types.all())) {
    out[id] = {
      id,
      index: t.index,
      name: t.name,
      tagline: t.tagline,
      intro: t.intro,
      headline: t.headline,
      steps: t.steps,
      parameters: t.parameters,
      fields: Types.fields(id),
    };
  }
  return jsonOk({ types: out });
}

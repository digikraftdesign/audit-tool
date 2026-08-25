import { jsonOk, requireAuth } from '@/lib/auth';
import { all } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const rows = all(
    `SELECT id, token, company, site, audit_type, created_at, status, result FROM dk_audits
     WHERE status = 'complete' ORDER BY created_at DESC LIMIT 12`,
  );

  const audits = rows.map((r) => {
    let res: Record<string, unknown> | null = null;
    try {
      res = r.result ? (JSON.parse(String(r.result)) as Record<string, unknown>) : null;
    } catch {
      res = null;
    }
    const score =
      res && typeof res.score === 'object' && res.score
        ? (res.score as Record<string, unknown>)
        : null;
    const grade =
      score && typeof score.grade === 'object' && score.grade
        ? (score.grade as Record<string, unknown>)
        : null;
    return {
      id: String(r.id),
      token: String(r.token),
      company: String(r.company),
      site: String(r.site ?? ''),
      type: String(r.audit_type),
      created: String(r.created_at),
      score: score ? Number(score.overall ?? 0) : 0,
      grade: grade ? String(grade.label ?? '') : '',
      findings: res && Array.isArray(res.findings) ? res.findings.length : 0,
    };
  });

  return jsonOk({ audits });
}

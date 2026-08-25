import { timingSafeEqual } from 'crypto';
import type { Metadata } from 'next';
import { bytes, trimUrl } from '@/components/audit/helpers';
import type { AuditPayload, AuditResult } from '@/components/audit/clientTypes';
import { one } from '@/lib/db';
import PrintControls from './PrintControls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Creative Growth Audit · DigiKraft',
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; print?: string }>;
};

function tokenOk(stored: string, given: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function loadViaDb(id: string, token: string): AuditPayload | null {
  if (!id || !token) return null;
  const row = one('SELECT * FROM dk_audits WHERE id = ?', [id]);
  if (!row) return null;
  if (!tokenOk(String(row.token ?? ''), token)) return null;

  let result: AuditResult | null = null;
  try {
    const raw = row.result;
    if (typeof raw === 'string' && raw) {
      result = JSON.parse(raw) as AuditResult;
    } else if (raw && typeof raw === 'object') {
      result = raw as AuditResult;
    }
  } catch {
    result = null;
  }

  return {
    id: String(row.id),
    type: String(row.audit_type ?? ''),
    status: String(row.status ?? ''),
    step: String(row.step ?? ''),
    steps: [],
    company: String(row.company ?? ''),
    sector: String(row.sector ?? ''),
    subject: String(row.site ?? ''),
    answers: {},
    manual: {},
    tier: String(row.tier ?? 'growth'),
    day: String(row.followup_day ?? 'Tuesday'),
    closed: Number(row.closed ?? 0) === 1,
    direction: String(row.direction ?? ''),
    created_at: String(row.created_at ?? ''),
    error: String(row.error ?? ''),
    result,
  };
}

async function loadAudit(id: string, token: string): Promise<AuditPayload | null> {
  try {
    const mod = await import('@/lib/audit/service');
    const Service = mod.default;
    if (Service?.find && Service?.payload) {
      const row = Service.find(id, token);
      if (row) return Service.payload(row) as unknown as AuditPayload;
      return null;
    }
  } catch {
    /* fall through to db */
  }
  return loadViaDb(id, token);
}

function hostOf(subject: string): string {
  try {
    return new URL(subject).host || trimUrl(subject);
  } catch {
    return trimUrl(subject);
  }
}

export default async function ReportPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const token = String(sp.t ?? '');
  const doPrint =
    sp.print !== undefined && sp.print !== '0' && sp.print !== 'false';

  const audit = await loadAudit(id, token);

  if (!audit) {
    return (
      <div className="report-leavebehind">
        <div className="wrap">
          <h1>Report not found</h1>
          <p className="lede">That link is wrong or the audit was removed.</p>
        </div>
        <ReportStyles />
      </div>
    );
  }

  const r = audit.result;
  if (!r) {
    return (
      <div className="report-leavebehind">
        <div className="wrap">
          <h1>This audit has not finished</h1>
          <p className="lede">
            Status: {audit.status}. {audit.error}
          </p>
        </div>
        <ReportStyles />
      </div>
    );
  }

  const tiers = r.tiers || {};
  const tierKey = audit.tier || r.recommended_tier;
  const tier = tiers[tierKey] || tiers[r.recommended_tier];
  const direction =
    audit.direction !== '' ? audit.direction : r.direction?.copy || '';
  const company = r.company || audit.company;
  const host = hostOf(r.subject || audit.subject);
  const paramsScores = r.score?.parameters || {};

  return (
    <div className="report-leavebehind">
      <PrintControls autoPrint={doPrint} />
      <div className="wrap">
        <p className="k">DigiKraft · Creative Growth Audit</p>
        <h1>{company}</h1>
        <p className="lede">
          Creative growth score {Math.round(r.score.overall)}/100.{' '}
          {r.findings.length} findings, {r.score.counts?.high ?? 0} high,{' '}
          {r.orders.length} work orders. Direction: {r.direction?.name}.
          Recommended: {tier?.name} ({tier?.price}). Follow-up {audit.day}.
        </p>
        <p className="k" style={{ marginTop: 10 }}>
          {host} · {r.sector} · read{' '}
          {(r.method?.crawled_at || '').slice(0, 10)}
        </p>

        <div className="grid">
          <div className="card">
            <p className="k">Score</p>
            <div className="kpi">{Math.round(r.score.overall)}/100</div>
            <p>
              {r.score.grade?.label}
              {r.score.provisional ? ' · provisional' : ''}
            </p>
          </div>
          <div className="card">
            <p className="k">High severity</p>
            <div className="kpi">{r.score.counts?.high ?? 0}</div>
            <p>Blocking paid traffic before the form.</p>
          </div>
          <div className="card">
            <p className="k">Work orders</p>
            <div className="kpi">{r.orders.length}</div>
            <p>Mapped to DigiKraft services.</p>
          </div>
        </div>

        <p className="k">Parameter scores</p>
        <div style={{ margin: '12px 0 28px' }}>
          {Object.entries(paramsScores).map(([pid, p]) => {
            const scored = p.score !== null && p.score !== undefined;
            const width = scored
              ? Math.round((Number(p.score) / 10) * 100)
              : 0;
            return (
              <div className="bar-row" key={pid}>
                <span>{p.label}</span>
                <div className="track">
                  <i style={{ width: width + '%' }} />
                </div>
                <b>{scored ? p.score : '—'}</b>
              </div>
            );
          })}
        </div>

        <h2>Findings</h2>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Severity</th>
              <th>Finding</th>
              <th>Service</th>
              <th>Slot</th>
            </tr>
          </thead>
          <tbody>
            {r.findings.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  Nothing was raised on the surfaces read.
                </td>
              </tr>
            ) : (
              r.findings.map((f) => (
                <tr key={f.id}>
                  <td>
                    {paramsScores[f.parameter]?.label || f.parameter}
                  </td>
                  <td className={'sev-' + f.severity}>{f.severity}</td>
                  <td>{f.title}</td>
                  <td>{f.service}</td>
                  <td>{f.month}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h2>Evidence</h2>
        {r.findings.map((f) => (
          <div className="rpt-finding" key={f.id}>
            <p className="meta">
              {paramsScores[f.parameter]?.label || f.parameter} ·{' '}
              {f.severity}
            </p>
            <h3>{f.title}</h3>
            <p>{f.evidence}</p>
            {(f.proof || []).length > 0 ? (
              <ul className="proof">
                {f.proof!.map((p, i) => (
                  <li key={i}>
                    <b>{p.label}</b>
                    <span>
                      {p.url ? (
                        <a href={p.url} rel="noopener nofollow">
                          {p.value}
                        </a>
                      ) : (
                        p.value
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="work">
              <strong>Growth cost:</strong> {f.cost}
              <br />
              <strong>DigiKraft:</strong> {f.service} · {f.month}
            </p>
          </div>
        ))}

        <h2>Immediate improvements</h2>
        <div className="grid">
          {r.fixes.map((f, i) => (
            <div className="card" key={i}>
              <p className="k">0{i + 1}</p>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <p className="k" style={{ marginTop: 10 }}>
                {f.service} · {f.month}
              </p>
            </div>
          ))}
        </div>

        <h2>Growth opportunities</h2>
        <div className="grid">
          {r.bets.map((b, i) => (
            <div className="card" key={i}>
              <p className="k">0{i + 1}</p>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
              <p className="k" style={{ marginTop: 10 }}>
                {b.service} · {b.month}
              </p>
            </div>
          ))}
        </div>

        <h2>Direction — {r.direction?.name}</h2>
        <p className="lede" style={{ whiteSpace: 'pre-wrap' }}>
          {direction}
        </p>

        <h2>90-day sequence</h2>
        <table>
          <thead>
            <tr>
              <th>Work order</th>
              <th>Month 1</th>
              <th>Month 2</th>
              <th>Month 3</th>
              <th>Findings</th>
            </tr>
          </thead>
          <tbody>
            {r.orders.map((o, i) => (
              <tr key={i}>
                <td>{o.service}</td>
                {[1, 2, 3].map((m) => (
                  <td key={m}>
                    {o.months.indexOf(m) !== -1 ? '●' : ''}
                  </td>
                ))}
                <td>{o.findings}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {tier ? (
          <div className="rec">
            <p className="k">Recommendation</p>
            <h2 style={{ margin: '6px 0 10px' }}>
              {tier.name} · {tier.price}
            </h2>
            <p>
              {tier.blurb} Follow-up {audit.day}.
            </p>
          </div>
        ) : null}

        <h2>What was read</h2>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>TTFB</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {(r.method?.sources || []).map((s, i) => (
              <tr key={i}>
                <td>
                  {s.url ? (
                    <a href={s.url} rel="noopener nofollow">
                      {s.label} · {trimUrl(s.url)}
                    </a>
                  ) : (
                    s.label
                  )}
                </td>
                <td>
                  {s.state || (s.status ? String(s.status) : 'read')}
                </td>
                <td>{s.ttfb != null ? s.ttfb.toFixed(2) + 's' : '—'}</td>
                <td>
                  {s.bytes ? bytes(s.bytes) : s.note ? s.note : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="foot">
          Measured {r.method?.crawled_at} UTC by {r.method?.user_agent}.
          Findings come from public pages, stylesheets, linked documents and
          profile URLs only. Anything a platform blocked is marked as
          unverified rather than assumed. Scores are DigiKraft&apos;s model,
          not an industry standard.
        </p>
      </div>
      <ReportStyles />
    </div>
  );
}

function ReportStyles() {
  return (
    <style>{`
.report-leavebehind {
  --bg: oklch(9% 0.008 260);
  --surface: oklch(15% 0.008 260);
  --fg: oklch(97% 0.004 260);
  --muted: oklch(70% 0.012 260);
  --border: oklch(100% 0 0 / 0.08);
  --danger: oklch(78% 0.12 25);
  --warn: oklch(84% 0.08 85);
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.55 var(--font-manrope), Manrope, system-ui, sans-serif;
  padding: 48px 32px 72px;
  min-height: 100vh;
}
.report-leavebehind h1,
.report-leavebehind h2,
.report-leavebehind h3 {
  font-family: var(--font-outfit), Outfit, system-ui, sans-serif;
  letter-spacing: -0.03em;
  line-height: 1.1;
  font-weight: 600;
}
.report-leavebehind h1 { font-size: clamp(32px, 5vw, 44px); max-width: 18ch; margin: 8px 0 12px; }
.report-leavebehind h2 { font-size: 26px; margin: 32px 0 12px; }
.report-leavebehind h3 { font-size: 17px; margin-bottom: 6px; }
.report-leavebehind a { color: inherit; }
.report-leavebehind .wrap { max-width: 960px; margin: 0 auto; }
.report-leavebehind .k { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.report-leavebehind .lede { color: var(--muted); max-width: 58ch; margin-bottom: 8px; }
.report-leavebehind .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0 28px; }
.report-leavebehind .card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 18px;
}
.report-leavebehind .card p { color: var(--muted); font-size: 14px; }
.report-leavebehind .kpi {
  font-family: var(--font-outfit), Outfit, system-ui, sans-serif;
  font-size: 32px; letter-spacing: -0.03em; margin: 6px 0;
  font-variant-numeric: tabular-nums;
}
.report-leavebehind table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0 28px; }
.report-leavebehind th, .report-leavebehind td {
  text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); vertical-align: top;
}
.report-leavebehind th {
  color: var(--muted); font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; font-weight: 500;
}
.report-leavebehind td.sev-high { color: var(--danger); text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
.report-leavebehind td.sev-medium { color: var(--warn); text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
.report-leavebehind .rpt-finding { border-bottom: 1px solid var(--border); padding: 18px 0; }
.report-leavebehind .rpt-finding:last-child { border-bottom: 0; }
.report-leavebehind .rpt-finding .meta {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 6px;
}
.report-leavebehind .rpt-finding p { color: var(--muted); font-size: 14px; max-width: 68ch; margin-top: 6px; }
.report-leavebehind .rpt-finding .work { font-size: 13px; color: var(--fg); margin-top: 8px; }
.report-leavebehind .proof { list-style: none; margin: 10px 0 0; font-size: 13px; padding: 0; }
.report-leavebehind .proof li {
  display: grid; grid-template-columns: 150px 1fr; gap: 10px; padding: 5px 0; color: var(--muted);
}
.report-leavebehind .proof b {
  font-weight: 500; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
}
.report-leavebehind .proof span { color: var(--fg); overflow-wrap: anywhere; }
.report-leavebehind .bar-row {
  display: grid; grid-template-columns: 140px 1fr 34px; gap: 10px;
  align-items: center; font-size: 13px; margin-bottom: 8px;
}
.report-leavebehind .track {
  height: 8px; border-radius: 99px; background: oklch(100% 0 0 / 0.06); overflow: hidden;
}
.report-leavebehind .track i {
  display: block; height: 100%; background: oklch(100% 0 0 / 0.38); border-radius: inherit;
}
.report-leavebehind .bar-row b { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
.report-leavebehind .rec {
  background: var(--fg); color: oklch(12% 0.01 260); border-radius: 20px;
  padding: 24px 28px; margin: 24px 0;
}
.report-leavebehind .rec .k { color: oklch(38% 0.01 260); }
.report-leavebehind .rec p { max-width: 58ch; }
.report-leavebehind .foot {
  margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 12px;
}
.report-leavebehind .toolbar {
  max-width: 960px; margin: 0 auto 24px; display: flex; gap: 8px; justify-content: flex-end;
}
.report-leavebehind .btn {
  min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--border);
  background: none; color: var(--fg); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
}
.report-leavebehind .btn:hover { background: oklch(100% 0 0 / 0.06); }
@media (max-width: 780px) {
  .report-leavebehind { padding: 28px 18px 56px; }
  .report-leavebehind .grid { grid-template-columns: 1fr; }
  .report-leavebehind .proof li { grid-template-columns: 1fr; gap: 2px; }
}
@media print {
  @page { margin: 14mm; }
  .report-leavebehind { background: #fff; color: #14161a; padding: 0; min-height: 0; }
  .report-leavebehind .toolbar { display: none; }
  .report-leavebehind .card, .report-leavebehind .track { background: #fff; border-color: #dcdfe4; }
  .report-leavebehind .card p, .report-leavebehind .k, .report-leavebehind th,
  .report-leavebehind .lede, .report-leavebehind .rpt-finding p,
  .report-leavebehind .proof li { color: #4a5058; }
  .report-leavebehind .track i { background: #14161a; }
  .report-leavebehind .rec { background: #14161a; color: #fff; }
  .report-leavebehind .rec .k, .report-leavebehind .rec p { color: #c9ccd2; }
  .report-leavebehind .rpt-finding, .report-leavebehind h2 { break-inside: avoid; }
}
`}</style>
  );
}

import * as Rules from '@/lib/audit/rules';
import * as Types from '@/lib/audit/types';
import type { Finding } from '@/lib/audit/rules';

export interface ParameterScore {
  id: string;
  label: string;
  blurb: string;
  weight: number;
  score: number | null;
  source: string;
  findings: number;
  high: number;
  points: number | null;
}

export interface ScoreResult {
  overall: number;
  provisional: boolean;
  unscored: string[];
  scored_weight: number;
  parameters: Record<string, ParameterScore>;
  counts: Record<string, number>;
  grade: { band: string; label: string; note: string };
}

export function score(
  type: string,
  findings: Finding[],
  coverage: Record<string, string>,
  manual: Record<string, number | string | null | undefined> = {},
): ScoreResult {
  const definitions = Types.parameters(type);
  const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const rows: Record<string, ParameterScore> = {};

  for (const [id, def] of Object.entries(definitions)) {
    rows[id] = {
      id,
      label: def.label,
      blurb: def.blurb,
      weight: Number(def.weight),
      score: 10.0,
      source: coverage[id] ?? 'auto',
      findings: 0,
      high: 0,
      points: 0,
    };
  }

  for (const f of findings) {
    const p = String(f.parameter ?? '');
    if (!rows[p]) continue;
    const sev = String(f.severity);
    counts[sev] = (counts[sev] ?? 0) + 1;
    rows[p].findings++;
    if (sev === 'high') rows[p].high++;
    rows[p].score = (rows[p].score as number) - (Rules.WEIGHT[sev] ?? 1);
  }

  let scoredWeight = 0;
  let earned = 0;
  const unscored: string[] = [];

  for (const [id, row] of Object.entries(rows)) {
    let s = Math.max(0, Math.min(10, row.score as number));

    if (Object.prototype.hasOwnProperty.call(manual, id) && manual[id] !== null && manual[id] !== '') {
      s = Math.max(0, Math.min(10, Number(manual[id])));
      rows[id].source = 'manual';
    } else if (row.source === 'manual') {
      rows[id].score = null;
      rows[id].points = null;
      unscored.push(id);
      continue;
    }

    rows[id].score = Math.round(s * 10) / 10;
    rows[id].points = Math.round((s / 10) * row.weight * 10) / 10;
    scoredWeight += row.weight;
    earned += (s / 10) * row.weight;
  }

  const overall = scoredWeight > 0 ? Math.round((earned / scoredWeight) * 100) : 0;

  return {
    overall,
    provisional: unscored.length > 0,
    unscored,
    scored_weight: scoredWeight,
    parameters: rows,
    counts,
    grade: Types.grade(overall),
  };
}

export function workOrders(
  findings: Finding[],
): Array<{ service: string; month: string; months: number[]; findings: number }> {
  const orders: Record<
    string,
    { service: string; month: string; months: Record<number, number>; findings: number }
  > = {};

  for (const f of findings) {
    const key = String(f.service);
    if (!orders[key]) {
      orders[key] = { service: key, month: f.month, months: {}, findings: 0 };
    }
    orders[key].findings++;
    for (const m of monthNumbers(String(f.month))) {
      orders[key].months[m] = m;
    }
  }

  for (const key of Object.keys(orders)) {
    const months = Object.values(orders[key].months).sort((a, b) => a - b);
    orders[key].months = Object.fromEntries(months.map((m) => [m, m]));
    (orders[key] as unknown as { months: number[] }).months = months;
    orders[key].month = monthLabel(months);
  }

  const out = Object.values(orders).map((o) => ({
    service: o.service,
    month: o.month,
    months: Object.values(o.months).sort((a, b) => a - b),
    findings: o.findings,
  }));

  out.sort((a, b) => {
    const cmp = (a.months[0] ?? 9) - (b.months[0] ?? 9);
    return cmp !== 0 ? cmp : b.findings - a.findings;
  });

  return out;
}

export function monthNumbers(label: string): number[] {
  const m = label.match(/\d/g);
  const nums = (m ?? []).map((d) => Number.parseInt(d, 10));
  if (nums.length === 2 && nums[1] > nums[0]) {
    const range: number[] = [];
    for (let i = nums[0]; i <= nums[1]; i++) range.push(i);
    return range;
  }
  return nums.length ? nums : [1];
}

export function monthLabel(months: number[]): string {
  if (!months.length) return 'Month 1';
  const min = Math.min(...months);
  const max = Math.max(...months);
  return min === max ? `Month ${min}` : `Month ${min}–${max}`;
}

const Scorer = { score, workOrders, monthNumbers, monthLabel };
export default Scorer;

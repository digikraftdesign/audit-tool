'use client';

import { useMemo, useState } from 'react';

import type { AuditResult, ParamScore } from '@/components/audit/clientTypes';
import Metric from './Metric';

interface Row {
  id: string;
  p: ParamScore;
  /** Points the overall score gains if every finding here is resolved. */
  recoverable: number;
  /** What the parameter contributes to the overall score right now. */
  contributing: number;
}

interface Props {
  result: AuditResult;
  reduce: boolean;
  onPick?: (parameterId: string) => void;
  /** Set or clear a manual score. Empty string clears it. */
  onScore?: (parameterId: string, value: string) => void;
}

/**
 * Ranks parameters by the points a fix actually returns, and lets the client
 * try combinations.
 *
 * The projection mirrors Scorer.score(): a parameter starts at 10 and findings
 * subtract from it, so "resolve every finding here" is exactly a lift to 10.
 * Weights are renormalised over scored parameters, the same way the real score
 * is, which keeps the projection honest while the audit is still provisional.
 */
export default function RecoveryLadder({ result, reduce, onPick, onScore }: Props) {
  const [fixed, setFixed] = useState<Set<string>>(new Set());

  const unmeasured = useMemo(
    () =>
      Object.entries(result.score.parameters).filter(
        ([, p]) => p.score === null || p.score === undefined,
      ),
    [result],
  );

  const { rows, scoredWeight, baseline } = useMemo(() => {
    const entries = Object.entries(result.score.parameters);
    const weight = entries
      .filter(([, p]) => p.score !== null && p.score !== undefined)
      .reduce((sum, [, p]) => sum + p.weight, 0);

    const list: Row[] = entries
      .filter(([, p]) => p.score !== null && p.score !== undefined)
      .map(([id, p]) => {
        const s = p.score as number;
        const share = weight > 0 ? p.weight / weight : 0;
        return {
          id,
          p,
          recoverable: ((10 - s) / 10) * share * 100,
          contributing: (s / 10) * share * 100,
        };
      })
      .sort((a, b) => b.recoverable - a.recoverable);

    return { rows: list, scoredWeight: weight, baseline: result.score.overall };
  }, [result]);

  const projected = useMemo(() => {
    if (scoredWeight <= 0) return baseline;
    let earned = 0;
    for (const r of rows) {
      const s = fixed.has(r.id) ? 10 : (r.p.score as number);
      earned += (s / 10) * r.p.weight;
    }
    return Math.round((earned / scoredWeight) * 100);
  }, [rows, fixed, scoredWeight, baseline]);

  const onTable = useMemo(
    () => rows.reduce((sum, r) => sum + r.recoverable, 0),
    [rows],
  );

  const gain = projected - baseline;
  const grade = gradeFor(projected);

  const toggle = (id: string) =>
    setFixed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const topThree = () =>
    setFixed(new Set(rows.filter((r) => r.recoverable > 0).slice(0, 3).map((r) => r.id)));

  if (!rows.length) {
    return null;
  }

  return (
    <article className="tile panel lift ladder" data-od-id="recovery-ladder">
      <div className="ladder-head">
        <div>
          <p className="kicker">Where the points are</p>
          <h3>
            {onTable >= 1
              ? `${onTable.toFixed(0)} points are recoverable on this surface.`
              : 'Almost nothing is left on the table.'}
          </h3>
          <p className="muted ladder-sub">
            Every finding traces to one parameter. Clear a parameter&rsquo;s findings and it
            returns to 10. Tick the ones you would scope.
          </p>
        </div>

        <div className={'ladder-proj' + (gain > 0 ? ' is-lifted' : '')}>
          <p className="kicker">Projected</p>
          <Metric
            value={projected}
            reduce={reduce}
            size="lg"
            suffix="/100"
            tone={gain > 0 ? 'good' : 'auto'}
          />
          <p className={'ladder-delta' + (gain > 0 ? ' is-on' : '')}>
            {gain > 0 ? (
              <>
                <b>
                  +<Metric value={gain} reduce={reduce} size="sm" />
                </b>
                <span>from {baseline} · {grade}</span>
              </>
            ) : (
              <span>today · {result.score.grade.label}</span>
            )}
          </p>
        </div>
      </div>

      <div className="ladder-actions">
        <button type="button" className="chip" onClick={topThree}>
          Scope the top 3
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => setFixed(new Set(rows.filter((r) => r.recoverable > 0).map((r) => r.id)))}
        >
          Everything
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => setFixed(new Set())}
          disabled={fixed.size === 0}
        >
          Reset
        </button>
        <span className="ladder-count">
          {fixed.size ? `${fixed.size} selected` : 'nothing selected'}
        </span>
      </div>

      <ol className="ladder-rows">
        {rows.map((r, i) => {
          const s = r.p.score as number;
          const isFixed = fixed.has(r.id);
          const tone = s >= 8 ? 'good' : s >= 5 ? 'mid' : 'bad';
          const effort =
            r.p.findings === 0
              ? 'nothing to clear'
              : `${r.p.findings} finding${r.p.findings === 1 ? '' : 's'}` +
                (r.p.high ? ` · ${r.p.high} high` : '');

          return (
            <li
              key={r.id}
              className={
                'ladder-row tone-' + tone + (isFixed ? ' is-fixed' : '') +
                (r.recoverable < 0.05 ? ' is-clean' : '')
              }
            >
              <label className="ladder-pick">
                <input
                  type="checkbox"
                  checked={isFixed}
                  disabled={r.recoverable < 0.05}
                  onChange={() => toggle(r.id)}
                  aria-label={`Simulate fixing ${r.p.label}`}
                />
                <span className="ladder-rank">{String(i + 1).padStart(2, '0')}</span>
              </label>

              <div className="ladder-body">
                <div className="ladder-title">
                  <button
                    type="button"
                    className="ladder-name"
                    onClick={() => onPick?.(r.id)}
                    title={`Show ${r.p.label} findings`}
                  >
                    {r.p.label}
                  </button>
                  <span className="ladder-weight">{r.p.weight}% weight</span>
                </div>

                {/* Contribution earned vs. still available, on one bar. */}
                <div className="ladder-bar" aria-hidden="true">
                  <i
                    className="have"
                    style={{ width: `${(r.contributing / (onTable + 100)) * 100 * 1.6}%` }}
                  />
                  <i
                    className="gap"
                    style={{ width: `${(r.recoverable / (onTable + 100)) * 100 * 1.6}%` }}
                  />
                </div>

                <p className="ladder-meta">
                  <span className="ladder-score">
                    {s.toFixed(s % 1 === 0 ? 0 : 1)}<small>/10</small>
                  </span>
                  <span className="ladder-effort">{effort}</span>
                </p>
              </div>

              <div className="ladder-gain">
                {r.recoverable >= 0.05 ? (
                  <>
                    <span className="ladder-plus">
                      +<Metric value={r.recoverable} reduce={reduce} decimals={1} size="md" />
                    </span>
                    <span>points back</span>
                  </>
                ) : (
                  <span className="ladder-clean">clean</span>
                )}
              </div>

              {/* Consultants override a reading live in the room. */}
              {onScore ? (
                <div className="ladder-set">
                  <label className="sr-label" htmlFor={'ladder-set-' + r.id}>
                    Override {r.p.label} score
                  </label>
                  <select
                    id={'ladder-set-' + r.id}
                    value={r.p.source === 'manual' ? String(Math.round(s)) : ''}
                    onChange={(e) => onScore(r.id, e.target.value)}
                  >
                    <option value="">auto</option>
                    {Array.from({ length: 11 }, (_, n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {r.p.source === 'manual' ? <em>yours</em> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {unmeasured.length ? (
        <div className="ladder-unmeasured">
          <p className="kicker">Not measurable from public data</p>
          <p className="muted ladder-sub">
            {unmeasured.length === 1 ? 'This parameter is' : 'These parameters are'} left out of
            the score and the projection above. Score{' '}
            {unmeasured.length === 1 ? 'it' : 'them'} here and the total stops being provisional —
            weights are renormalised over whatever is scored until then.
          </p>
          <ul className="unmeasured-rows">
            {unmeasured.map(([pid, p]) => (
              <li key={pid}>
                <div>
                  <b>{p.label}</b>
                  <span className="ladder-weight">{p.weight}% weight</span>
                  <em>{p.blurb}</em>
                </div>
                {onScore ? (
                  <div className="ladder-set">
                    <label className="sr-label" htmlFor={'unmeasured-' + pid}>
                      Set {p.label} score
                    </label>
                    <select
                      id={'unmeasured-' + pid}
                      value=""
                      onChange={(e) => onScore(pid, e.target.value)}
                    >
                      <option value="">—</option>
                      {Array.from({ length: 11 }, (_, n) => (
                        <option key={n} value={String(n)}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/** Mirrors Types.grade() exactly, so a projected label never contradicts the real one. */
function gradeFor(n: number): string {
  if (n >= 80) return 'Excellent';
  if (n >= 50) return 'Needs improvement';
  return 'Critical';
}

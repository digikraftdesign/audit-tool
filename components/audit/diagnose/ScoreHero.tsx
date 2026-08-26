'use client';

import { useMemo } from 'react';

import type { AuditResult } from '@/components/audit/clientTypes';
import Metric, { useCounted } from './Metric';

interface Props {
  result: AuditResult;
  subject: string;
  reduce: boolean;
}

/**
 * The headline reading: one very large number, the arc that frames it, and the
 * three counts that qualify it.
 *
 * The arc is drawn with pathLength=100 so the dash offset is literally the
 * score — no radius arithmetic to drift out of sync with the number beside it.
 */
export default function ScoreHero({ result, subject, reduce }: Props) {
  const { overall, grade, counts, provisional } = result.score;
  const arc = useCounted(overall, reduce, 1100);

  const high = counts.high ?? 0;
  const medium = counts.medium ?? 0;
  const low = counts.low ?? 0;
  const total = high + medium + low;

  const headline = useMemo(() => {
    if (total === 0) return 'Nothing was raised on this surface.';
    if (high > 0) {
      return `${high} high-severity finding${high === 1 ? '' : 's'} carry most of the loss.`;
    }
    return `${total} finding${total === 1 ? '' : 's'}, none of them high severity.`;
  }, [high, total]);

  return (
    <section className="score-hero" data-od-id="score-hero">
      <div className="score-hero-main">
        <p className="kicker">{result.type_name} score</p>

        <div className="score-dial">
          <svg viewBox="0 0 200 200" aria-hidden="true" className="score-arc">
            <defs>
              <linearGradient id="arcGrad" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--arc-from)" />
                <stop offset="100%" stopColor="var(--arc-to)" />
              </linearGradient>
            </defs>
            <circle
              cx="100"
              cy="100"
              r="84"
              fill="none"
              stroke="oklch(100% 0 0 / 0.07)"
              strokeWidth="10"
            />
            <circle
              className="score-arc-value"
              cx="100"
              cy="100"
              r="84"
              fill="none"
              stroke="url(#arcGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="100 100"
              strokeDashoffset={100 - arc}
              transform="rotate(-90 100 100)"
            />
          </svg>

          <div className="score-readout">
            <Metric value={overall} reduce={reduce} size="hero" ms={1100} />
            <span className="score-denom">/100</span>
          </div>
        </div>

        <p className={'score-grade band-' + grade.band}>
          {grade.label}
          {provisional ? <em> · provisional</em> : null}
        </p>
        <p className="score-note">{grade.note}</p>
      </div>

      <div className="score-hero-side">
        <h1 className="score-headline">{headline}</h1>
        <p className="score-subject">
          {subject} · read {(result.method.crawled_at || '').slice(0, 10)}
        </p>

        <div className="sev-bars" data-od-id="severity-mix">
          {([
            ['high', high, 'High', 'costs the most weighted points'],
            ['medium', medium, 'Medium', 'erodes the score steadily'],
            ['low', low, 'Low', 'polish, not priority'],
          ] as const).map(([key, n, label, note]) => (
            <div key={key} className={'sev-bar sev-' + key + (n === 0 ? ' is-zero' : '')}>
              <Metric value={n} reduce={reduce} size="lg" tone={n === 0 ? 'muted' : 'auto'} />
              <div className="sev-bar-meta">
                <b>{label}</b>
                <span>{note}</span>
              </div>
              <i
                className="sev-bar-fill"
                style={{ '--f': total ? n / total : 0 } as React.CSSProperties}
                aria-hidden="true"
              />
            </div>
          ))}
        </div>

        <div className="score-counts">
          <div>
            <Metric value={result.findings.length} reduce={reduce} size="md" />
            <span>findings</span>
          </div>
          <div>
            <Metric value={result.orders.length} reduce={reduce} size="md" />
            <span>work orders</span>
          </div>
          <div>
            <Metric
              value={Object.keys(result.score.parameters).length}
              reduce={reduce}
              size="md"
            />
            <span>parameters scored</span>
          </div>
        </div>
      </div>
    </section>
  );
}

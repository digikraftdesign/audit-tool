'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that animates to its value.
 *
 * Counts from wherever it currently sits rather than from zero, so a value that
 * changes after mount — the projected score while the client toggles fixes —
 * reads as a move from the old number, not a fresh count-up.
 */
export function useCounted(value: number, reduce: boolean, ms = 900): number {
  const [shown, setShown] = useState(reduce ? value : 0);
  const fromRef = useRef(reduce ? value : 0);
  const rafRef = useRef(0);

  useEffect(() => {
    const settle = () => {
      fromRef.current = value;
      setShown(value);
    };

    // requestAnimationFrame does not run in a hidden tab. Animating there would
    // leave the figure frozen at its starting value, so show the real number
    // straight away and let it animate only when someone is watching.
    if (reduce || document.hidden) {
      settle();
      return;
    }

    const from = fromRef.current;
    const delta = value - from;
    if (Math.abs(delta) < 0.005) {
      settle();
      return;
    }

    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      // easeOutExpo — fast commitment, long settle. Reads as "measured".
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setShown(from + delta * e);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    // If the tab is backgrounded mid-flight the frames stop coming; this makes
    // sure the number still lands on the truth.
    const guard = window.setTimeout(settle, ms + 400);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(guard);
    };
  }, [value, reduce, ms]);

  return shown;
}

interface MetricProps {
  value: number;
  reduce: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Visual scale. `hero` is the single biggest number on the screen. */
  size?: 'hero' | 'lg' | 'md' | 'sm';
  /** Colour intent. `auto` leaves it inheriting. */
  tone?: 'auto' | 'good' | 'mid' | 'bad' | 'muted';
  ms?: number;
  className?: string;
}

export default function Metric({
  value,
  reduce,
  decimals = 0,
  prefix = '',
  suffix = '',
  size = 'md',
  tone = 'auto',
  ms = 900,
  className = '',
}: MetricProps) {
  const shown = useCounted(value, reduce, ms);
  const text = shown.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span
      className={`dgm dgm-${size} tone-${tone} ${className}`.trim()}
      // Screen readers get the settled figure, not every frame of the count.
      aria-label={`${prefix}${value.toFixed(decimals)}${suffix}`}
    >
      {prefix ? <i className="dgm-affix">{prefix}</i> : null}
      <span className="dgm-num" aria-hidden="true">
        {text}
      </span>
      {suffix ? <i className="dgm-affix dgm-suffix">{suffix}</i> : null}
    </span>
  );
}

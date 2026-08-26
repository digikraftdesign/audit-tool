'use client';

import { useMemo, useState } from 'react';

import type { ShotBox, ShotData } from '@/components/audit/clientTypes';
import Metric from './Metric';

type Device = 'desktop' | 'desktop-full' | 'mobile';

const DEVICE_LABEL: Record<Device, string> = {
  desktop: 'Desktop fold',
  'desktop-full': 'Full page',
  mobile: 'Mobile fold',
};

const KIND_LABEL: Record<ShotBox['kind'], string> = {
  headline: 'Headline',
  cta: 'Call to action',
  form: 'Form',
  nav: 'Navigation',
  media: 'Hero media',
};

interface Props {
  shot: ShotData | null | undefined;
  auditId: string;
  token: string;
  reduce: boolean;
}

/**
 * The page as it actually rendered, with the elements the findings talk about
 * marked on it.
 *
 * Boxes are measured in CSS pixels against the desktop render, so they are
 * positioned as percentages of that frame and only drawn on the desktop views.
 */
export default function PageShot({ shot, auditId, token, reduce }: Props) {
  const [device, setDevice] = useState<Device>('desktop');
  const [active, setActive] = useState<number | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const frames = shot?.frames ?? {};
  const available = useMemo(
    () => (['desktop', 'desktop-full', 'mobile'] as Device[]).filter((d) => frames[d]),
    [frames],
  );

  const belowFold = useMemo(
    () => (shot?.boxes ?? []).filter((b) => b.below_fold).length,
    [shot],
  );
  const ctaCount = useMemo(
    () => (shot?.boxes ?? []).filter((b) => b.kind === 'cta').length,
    [shot],
  );

  if (!shot || !shot.ok || available.length === 0) {
    return (
      <article className="tile panel lift shot-card is-empty" data-od-id="page-shot">
        <p className="kicker">The page as rendered</p>
        <h3>No screenshot was captured.</h3>
        <p className="muted shot-empty-note">
          {shot?.error
            ? shot.error
            : 'The renderer did not run for this audit. Findings below are read from the page source, which is unaffected.'}
        </p>
      </article>
    );
  }

  const frame = frames[device];
  const current = device === 'mobile' ? null : frame;
  // Boxes were measured against the desktop viewport width.
  const refWidth = frames.desktop?.width ?? 1440;
  const refHeight = current?.height ?? 1;
  const canAnnotate = device !== 'mobile' && showBoxes;

  const src = `/api/audits/${auditId}/shot/${device}?token=${encodeURIComponent(token)}`;
  const activeBox = active === null ? null : (shot.boxes[active] ?? null);

  return (
    <article className="tile panel lift shot-card" data-od-id="page-shot">
      <div className="shot-head">
        <div>
          <p className="kicker">The page as rendered</p>
          <h3>
            {belowFold > 0
              ? `${belowFold} marked element${belowFold === 1 ? '' : 's'} sit below the fold.`
              : 'Everything marked sits above the fold.'}
          </h3>
        </div>
        <div className="shot-controls">
          <div className="seg" role="tablist" aria-label="Screenshot device">
            {available.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                className={'seg-btn' + (device === d ? ' is-on' : '')}
                aria-selected={device === d}
                onClick={() => {
                  setDevice(d);
                  setActive(null);
                  setLoaded(false);
                }}
              >
                {DEVICE_LABEL[d]}
              </button>
            ))}
          </div>
          {device !== 'mobile' ? (
            <button
              type="button"
              className={'chip shot-toggle' + (showBoxes ? ' is-on' : '')}
              aria-pressed={showBoxes}
              onClick={() => setShowBoxes((v) => !v)}
            >
              Markers
            </button>
          ) : null}
        </div>
      </div>

      <div className="shot-stats">
        <div className="shot-stat">
          <Metric value={shot.page_height} reduce={reduce} size="sm" suffix="px" />
          <span>page height</span>
        </div>
        <div className="shot-stat">
          <Metric
            value={Math.round(shot.fold_ratio * 100)}
            reduce={reduce}
            size="sm"
            suffix="%"
            tone={shot.fold_ratio < 0.2 ? 'bad' : 'auto'}
          />
          <span>visible before scroll</span>
        </div>
        <div className="shot-stat">
          <Metric
            value={ctaCount}
            reduce={reduce}
            size="sm"
            tone={ctaCount === 0 ? 'bad' : ctaCount > 4 ? 'mid' : 'good'}
          />
          <span>calls to action found</span>
        </div>
      </div>

      <figure
        className={
          'shot-frame' + (device === 'mobile' ? ' is-mobile' : '') + (loaded ? ' is-loaded' : '')
        }
      >
        <div className="shot-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`${DEVICE_LABEL[device]} render of ${shot.url}`}
            width={frame?.width}
            height={frame?.height}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
          />

          {canAnnotate && current ? (
            <div className="shot-marks" aria-hidden="true">
              {shot.boxes.map((b, i) => {
                // Full-page frames are taller than the fold frame; a box beyond
                // the visible frame simply is not drawn.
                if (b.y + b.h > refHeight) return null;
                return (
                  <button
                    key={i}
                    type="button"
                    className={
                      'shot-mark k-' + b.kind + (active === i ? ' is-on' : '')
                    }
                    style={{
                      left: `${(b.x / refWidth) * 100}%`,
                      top: `${(b.y / refHeight) * 100}%`,
                      width: `${(b.w / refWidth) * 100}%`,
                      height: `${(b.h / refHeight) * 100}%`,
                    }}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive((v) => (v === i ? null : v))}
                    onFocus={() => setActive(i)}
                    onClick={() => setActive((v) => (v === i ? null : i))}
                    tabIndex={-1}
                  >
                    <span className="shot-mark-tag">{b.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* The fold line only means anything on the full-page view. */}
          {device === 'desktop-full' && shot.fold_height < (current?.height ?? 0) ? (
            <div
              className="shot-fold"
              style={{ top: `${(shot.fold_height / refHeight) * 100}%` }}
              aria-hidden="true"
            >
              <span>fold · {shot.fold_height}px</span>
            </div>
          ) : null}
        </div>
      </figure>

      <div className="shot-legend">
        {activeBox ? (
          <p className="shot-active">
            <b>{KIND_LABEL[activeBox.kind]}</b>
            {activeBox.text ? <em>“{activeBox.text}”</em> : null}
            <span className={activeBox.below_fold ? 'warn' : 'ok'}>
              {activeBox.below_fold ? 'below the fold' : 'above the fold'}
            </span>
          </p>
        ) : (
          <p className="muted shot-hint">
            {device === 'mobile'
              ? `Rendered at ${frame?.width}×${frame?.height}. Markers are measured on the desktop render.`
              : 'Hover a marker to see what was measured there.'}
          </p>
        )}
        <a
          className="shot-src"
          href={shot.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          Open the live page ↗
        </a>
      </div>
    </article>
  );
}

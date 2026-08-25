<?php

declare(strict_types=1);

require __DIR__ . '/app/bootstrap.php';

use DK\Audit\Types;

$needPasscode = ((string) dk_config('passcode', '')) !== '' && !dk_authorised();
$appName      = (string) dk_config('app_name', 'DigiKraft · Creative Growth Audit');
$kicker       = (string) dk_config('landing_kicker', 'Money Expo India 2026');

$typePayload = [];
foreach (Types::all() as $id => $t) {
    $typePayload[$id] = [
        'id'         => $id,
        'index'      => $t['index'],
        'name'       => $t['name'],
        'tagline'    => $t['tagline'],
        'intro'      => $t['intro'],
        'headline'   => $t['headline'],
        'steps'      => $t['steps'],
        'parameters' => $t['parameters'],
        'fields'     => Types::fields($id),
    ];
}

$boot = [
    'needPasscode' => $needPasscode,
    'endpoint'     => 'api.php',
    'report'       => 'report.php',
    'brand'        => (string) dk_config('brand_short', 'DigiKraft'),
    'maxUpload'    => (int) dk_config('upload.max_bytes', 20 * 1024 * 1024),
];
$jsonFlags = JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title><?= dk_e($appName) ?></title>
  <link rel="icon" href="assets/img/logo-eng-light.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="assets/css/app.css" />
</head>
<body>
  <div class="app" data-od-id="app-shell">
    <header class="topbar" data-od-id="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#landing" data-od-id="brand-lockup" data-go="landing">
          <img class="wordmark" src="assets/img/logo-eng-light.svg" alt="DIGIKRAFT" width="188" height="18" />
          <span class="brand-copy"><span id="brand-sub">Creative Growth Audit</span></span>
        </a>
        <nav class="phases" aria-label="Meeting phases" data-od-id="meeting-phase">
          <button class="phase" data-phase="intake" data-go="intake"><b>1</b><span class="lbl">Understand</span></button>
          <button class="phase" data-phase="scan" data-go="scan" disabled><b>2</b><span class="lbl">Diagnose</span></button>
          <button class="phase" data-phase="report" data-go="report" disabled><b>3</b><span class="lbl">Direction</span></button>
          <button class="phase" data-phase="close" data-go="close" disabled><b>4</b><span class="lbl">Propose</span></button>
        </nav>
        <div class="top-actions">
          <button class="btn btn-line" type="button" data-od-id="btn-download" id="btn-download" disabled aria-label="Download report">
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.5v8M4 7.5L7 10.5 10 7.5M2.5 12.5h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
            <span class="btn-label">Download report</span>
          </button>
          <button class="btn btn-ghost" type="button" data-od-id="btn-reset" id="btn-reset">Start Over</button>
        </div>
      </div>
    </header>

    <main>
      <!-- ------------------------------------------------------------ landing -->
      <section class="view hero-grid landing is-on" data-view="landing" data-od-id="view-landing">
        <div class="wrap">
          <span class="spark spark-a" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l1.7 10.3L24 12l-10.3 1.7L12 24l-1.7-10.3L0 12l10.3-1.7z"/></svg></span>
          <span class="spark spark-b" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l1.7 10.3L24 12l-10.3 1.7L12 24l-1.7-10.3L0 12l10.3-1.7z"/></svg></span>
          <p class="kicker" data-od-id="landing-kicker"><?= dk_e($kicker) ?></p>
          <h1 data-od-id="landing-title">Creative Growth Audit</h1>
          <p class="lede" data-od-id="landing-lede">This is not a portfolio walkthrough. Pick one surface, and we read the real thing — the page, the profiles, the file, the identity — then turn the gaps into DigiKraft work. Every finding comes back with the evidence it was measured from.</p>

          <p class="kicker choose-label" data-od-id="choose-label">Choose what to audit</p>
          <div class="pitch-grid" role="radiogroup" aria-label="Choose what to audit" data-od-id="landing-surfaces">
            <?php foreach ($typePayload as $id => $t): ?>
            <button type="button" class="tile pitch-card lift choice" role="radio" aria-checked="false"
                    data-choice="<?= dk_e($id) ?>" data-od-id="choice-<?= dk_e($id) ?>">
              <p class="kicker"><?= dk_e($t['index']) ?></p>
              <h3><?= dk_e($t['name']) ?></h3>
              <p><?= dk_e($t['tagline']) ?></p>
              <span class="choice-mark" aria-hidden="true">
                <svg viewBox="0 0 12 12" fill="none"><path d="M2 6.2l2.4 2.4L10 3.2" stroke="currentColor" stroke-width="1.6"/></svg>
              </span>
            </button>
            <?php endforeach; ?>
          </div>

          <div class="landing-actions">
            <button class="btn btn-primary" type="button" id="cta-start" data-od-id="cta-get-started" disabled>
              <span id="cta-start-label">Choose an audit above</span>
              <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7h8M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>

          <div class="recents" id="recents" hidden data-od-id="recent-audits">
            <p class="kicker">Recent audits</p>
            <div class="recent-list" id="recent-list"></div>
          </div>
          <p class="quote">“You drive the growth strategy. We make sure creative never becomes the bottleneck.”</p>
        </div>
      </section>

      <!-- ------------------------------------------------------------- intake -->
      <section class="view" data-view="intake" data-od-id="view-intake">
        <div class="wrap-form">
          <div class="intake-head">
            <p class="kicker" id="intake-kicker">Understand · 0–5 min</p>
            <h2 id="intake-title">Tell the audit what to read.</h2>
            <p class="muted" id="intake-intro"></p>
          </div>
          <form class="tile form-tile" id="intake-form" data-od-id="intake-form">
            <div id="intake-fields"></div>
            <p class="error" id="intake-error" data-od-id="intake-error"></p>
            <button class="btn btn-primary btn-full" type="submit" data-od-id="cta-begin-audit" id="cta-begin-audit">
              <span id="begin-label">Begin audit</span>
              <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7h8M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
            <p class="hint" style="margin-top:10px" id="intake-hint">The audit reads public pages, stylesheets, documents and profile URLs. It respects robots.txt and never signs in anywhere.</p>
          </form>
          <div class="scope-note tile" data-od-id="scope-note">
            <p class="kicker">Scope</p>
            <p class="muted" id="scope-copy"></p>
            <ul class="scope-list" id="scope-list"></ul>
          </div>
        </div>
      </section>

      <!-- --------------------------------------------------------------- scan -->
      <section class="view hero-grid scan-stage" data-view="scan" data-od-id="view-scan" aria-busy="false">
        <div class="wrap">
          <p class="kicker">5–15 min · Diagnose</p>
          <h1 data-od-id="scan-title" id="scan-title">Reading the creative system.</h1>
          <p class="muted" id="scan-status" data-od-id="scan-status">Preparing.</p>
          <div class="scan-log" id="scan-log" data-od-id="scan-log" aria-live="polite"></div>
          <div class="scan-grid" id="scan-grid" data-od-id="scan-surfaces"></div>
          <p class="error" id="scan-error" data-od-id="scan-error"></p>
          <div style="margin-top:22px">
            <button class="btn btn-line" type="button" id="btn-scan-back" data-od-id="btn-scan-back" hidden>Back to intake</button>
          </div>
        </div>
      </section>

      <!-- ---------------------------------------------------------- workspace -->
      <section class="view" data-view="workspace" data-od-id="view-workspace">
        <div class="wrap-wide">
          <div class="dash-head">
            <div>
              <p class="kicker" id="workspace-kicker">Diagnose · 5–15 min</p>
              <h1 data-od-id="workspace-title" id="workspace-title">The system as it stands.</h1>
              <p class="lede" id="workspace-lede">Reading the audit.</p>
            </div>
            <div class="tile ring-card lift" data-od-id="score-overall">
              <svg class="ring" viewBox="0 0 120 120" width="104" height="104" aria-hidden="true">
                <circle cx="60" cy="60" r="46" fill="none" stroke="oklch(100% 0 0 / 0.08)" stroke-width="10"/>
                <circle class="ring-value" cx="60" cy="60" r="46" fill="none" stroke="currentColor" stroke-width="10" pathLength="100"/>
              </svg>
              <div>
                <p class="kicker" id="score-kicker">Audit score</p>
                <p class="num tabular"><span id="score-num">0</span><small>/100</small></p>
                <p class="grade" id="score-grade">—</p>
              </div>
            </div>
          </div>

          <div class="kpi-row" data-od-id="diagnose-kpis">
            <article class="tile kpi lift" data-od-id="kpi-grade">
              <p class="kicker">Grade</p>
              <p class="num" id="kpi-grade-label" style="font-size:24px">—</p>
              <p id="kpi-grade-note">Weighted across this audit's parameters.</p>
            </article>
            <article class="tile kpi lift" data-od-id="kpi-findings">
              <p class="kicker">Findings</p>
              <p class="num tabular" id="kpi-findings-num">0</p>
              <p id="kpi-findings-note">Everything measured on this surface.</p>
            </article>
            <article class="tile kpi lift" data-od-id="kpi-high">
              <p class="kicker">High severity</p>
              <p class="num tabular" id="kpi-high-num">0</p>
              <p>These cost the most weighted points.</p>
            </article>
            <article class="tile kpi lift" data-od-id="kpi-orders">
              <p class="kicker">Work orders</p>
              <p class="num tabular" id="kpi-orders-num">0</p>
              <p>Mapped to DigiKraft services in the 90-day pilot.</p>
            </article>
          </div>

          <div class="diag-grid" data-od-id="diagnose-charts">
            <article class="tile panel lift" data-od-id="parameter-scores">
              <p class="kicker">Parameter scores</p>
              <h3 id="param-head">Each one out of 10, weighted into the total.</h3>
              <div class="params" id="param-rows"></div>
              <p class="hint" id="param-hint" hidden></p>
            </article>
            <article class="tile panel lift" data-od-id="severity-heat">
              <p class="kicker">Severity mix</p>
              <h3 id="severity-head">Severity across the file.</h3>
              <div class="sev-track" aria-hidden="true"><i class="hi" id="sev-hi"></i><i class="md" id="sev-md"></i><i class="lo" id="sev-lo"></i></div>
              <div class="sev-legend">
                <span><b id="legend-high">0</b> high</span>
                <span><b id="legend-med">0</b> medium</span>
                <span><b id="legend-low">0</b> low</span>
              </div>
              <div class="grade-scale" id="grade-scale"></div>
            </article>
          </div>

          <div class="toolbar">
            <div class="filters" id="filters" data-od-id="finding-filters"></div>
            <input class="search" id="finding-search" type="search" placeholder="Search findings" data-od-id="finding-search" />
          </div>

          <div class="workspace">
            <div class="tile list" id="finding-list" data-od-id="finding-list"></div>
            <aside class="tile detail" id="finding-detail" data-od-id="finding-detail">
              <p class="empty">Select a finding to see evidence and the DigiKraft work order.</p>
            </aside>
          </div>

          <article class="tile panel lift method" data-od-id="audit-method" style="margin-top:12px">
            <p class="kicker">What was read</p>
            <h3>Every finding traces back to one of these.</h3>
            <div id="method-body"></div>
          </article>

          <div class="foot-cta">
            <button class="btn btn-primary" type="button" data-go="report" data-od-id="cta-open-report">Continue to direction</button>
          </div>
        </div>
      </section>

      <!-- ------------------------------------------------------------- report -->
      <section class="view" data-view="report" data-od-id="view-report">
        <div class="wrap-wide">
          <div class="dash-head">
            <div>
              <p class="kicker" data-od-id="report-kicker">Direction · 15–22 min</p>
              <h1 data-od-id="report-title">The audit, as a brief.</h1>
              <p class="lede" id="report-lede">Three things to fix now. Three bets that turn creative into capacity.</p>
            </div>
          </div>

          <article class="tile gantt lift" data-od-id="direction-gantt">
            <p class="kicker">90-day sequence</p>
            <h3 style="font-size:16px;letter-spacing:-0.02em;margin:6px 0 14px">Work orders on the calendar — not a wishlist.</h3>
            <div class="gantt-head"><span></span><span>Month 1</span><span>Month 2</span><span>Month 3</span></div>
            <div id="gantt-rows"></div>
          </article>

          <p class="kicker" style="margin-bottom:10px">Immediate improvements</p>
          <div class="trio" data-od-id="fixes-row" id="fixes-row"></div>

          <p class="kicker" style="margin:18px 0 10px">Growth opportunities</p>
          <div class="trio" data-od-id="bets-row" id="bets-row"></div>

          <article class="tile invert" data-od-id="direction-clear-markets">
            <div>
              <p class="kicker">Creative direction</p>
              <h2 id="direction-name">—</h2>
              <textarea id="direction-copy" class="dirbox" rows="6" aria-label="Creative direction" data-od-id="direction-copy"></textarea>
              <p class="dirhint">Edit in the meeting — the leave-behind uses what is written here.</p>
            </div>
            <div class="swatches" aria-hidden="true" id="direction-swatches"></div>
          </article>

          <div class="foot-cta">
            <button class="btn btn-primary" type="button" data-go="close" data-od-id="cta-present-pilot">Present 90-day plan</button>
          </div>
        </div>
      </section>

      <!-- -------------------------------------------------------------- close -->
      <section class="view" data-view="close" data-od-id="view-close">
        <div class="wrap-wide">
          <div class="dash-head">
            <div>
              <p class="kicker">Propose · 22–30 min</p>
              <h1 class="page-title" data-od-id="close-title" style="margin:8px 0 12px">90 days. Enough to prove the engine.</h1>
              <p class="lede" id="close-lede">Easier to approve than a year. Long enough to show speed, quality and process.</p>
            </div>
          </div>

          <div class="close-grid">
            <div>
              <div class="plans" data-od-id="retainer-tiers" id="plans"></div>
              <article class="tile panel lift" data-od-id="retainer-range" style="margin-top:12px">
                <p class="kicker">Monthly range</p>
                <h3>Pick the engine, not a package size.</h3>
                <div class="range-list" id="range-list"></div>
              </article>
              <p class="quote">“Once I understand your monthly creative requirement, I can recommend the right model instead of selling an oversized package.”</p>
            </div>

            <div id="close-panel">
              <div id="close-form">
                <div class="months" data-od-id="pilot-months" id="months"></div>
                <p class="kicker" style="margin:16px 0 8px">Would Tuesday or Wednesday work better?</p>
                <div class="when" data-od-id="followup-when">
                  <button type="button" data-day="Tuesday" aria-pressed="true" data-od-id="day-tue">Tuesday follow-up</button>
                  <button type="button" data-day="Wednesday" data-od-id="day-wed">Wednesday follow-up</button>
                </div>
                <button class="btn btn-primary btn-full" type="button" id="cta-recommend" data-od-id="cta-recommend-pilot">Recommend pilot</button>
                <p class="hint" style="margin-top:10px">Recommendation for this meeting — not a signed contract.</p>
              </div>
              <div class="tile done-box" id="close-done" hidden data-od-id="close-confirmation">
                <p class="kicker">Meeting recommendation saved</p>
                <h2>DigiKraft can solve this.</h2>
                <p class="muted" id="close-done-copy" style="max-width:46ch"></p>
                <p class="quote"><b>I think DigiKraft can solve this for you. Let me show you exactly how.</b></p>
                <div class="share-row">
                  <button class="btn btn-line" type="button" id="btn-open-report">Open leave-behind</button>
                  <button class="btn btn-ghost" type="button" id="btn-copy-link">Copy share link</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <?php if ($needPasscode): ?>
  <div class="gate" id="gate" data-od-id="passcode-gate">
    <form class="tile gate-box" id="gate-form">
      <p class="kicker">Restricted</p>
      <h2>Creative Growth Audit</h2>
      <p class="muted">Enter the team passcode to run an audit.</p>
      <div class="field" style="margin-top:14px">
        <label for="passcode">Passcode</label>
        <input id="passcode" type="password" autocomplete="current-password" required />
      </div>
      <p class="error" id="gate-error"></p>
      <button class="btn btn-primary btn-full" type="submit">Unlock</button>
    </form>
  </div>
  <?php endif; ?>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>
    window.DK_BOOT  = <?= json_encode($boot, $jsonFlags) ?>;
    window.DK_TYPES = <?= json_encode($typePayload, $jsonFlags) ?>;
  </script>
  <script src="assets/js/app.js"></script>
</body>
</html>

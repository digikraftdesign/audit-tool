<?php

declare(strict_types=1);

require __DIR__ . '/app/bootstrap.php';

use DK\Audit\Rules;
use DK\Audit\Service;

$id    = (string) ($_GET['id'] ?? '');
$token = (string) ($_GET['t'] ?? '');
$print = isset($_GET['print']);

$row = Service::find($id, $token);
if (!$row) {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>Not found</title>'
       . '<body style="font:16px/1.5 system-ui;background:#0b0c10;color:#f4f5f7;padding:48px">'
       . '<h1 style="font-size:28px">Report not found</h1>'
       . '<p style="color:#9aa0aa">That link is wrong or the audit was removed.</p>';
    exit;
}

$audit  = Service::payload($row);
$r      = $audit['result'];
if (!$r) {
    http_response_code(409);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>Audit incomplete</title>'
       . '<body style="font:16px/1.5 system-ui;background:#0b0c10;color:#f4f5f7;padding:48px">'
       . '<h1 style="font-size:28px">This audit has not finished</h1>'
       . '<p style="color:#9aa0aa">Status: ' . dk_e($audit['status']) . '. '
       . dk_e($audit['error']) . '</p>';
    exit;
}

$tiers     = $r['tiers'];
$tier      = $audit['tier'] ?: $r['recommended_tier'];
$direction = $audit['direction'] !== '' ? $audit['direction'] : ($r['direction']['copy'] ?? '');
$company   = $r['company'];
$host      = (string) parse_url((string) $r['site'], PHP_URL_HOST);

function bytes_h(int $n): string
{
    if ($n >= 1048576) {
        return number_format($n / 1048576, 1) . ' MB';
    }
    if ($n >= 1024) {
        return number_format($n / 1024, 0) . ' KB';
    }
    return $n . ' B';
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title><?= dk_e($company) ?> · Creative Growth Audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: oklch(9% 0.008 260);
    --surface: oklch(15% 0.008 260);
    --fg: oklch(97% 0.004 260);
    --muted: oklch(70% 0.012 260);
    --border: oklch(100% 0 0 / 0.08);
    --danger: oklch(78% 0.12 25);
    --warn: oklch(84% 0.08 85);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { color-scheme: dark; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.55 Manrope, system-ui, sans-serif;
    padding: 48px 32px 72px;
  }
  h1, h2, h3 { font-family: Outfit, system-ui, sans-serif; letter-spacing: -0.03em; line-height: 1.1; font-weight: 600; }
  h1 { font-size: clamp(32px, 5vw, 44px); max-width: 18ch; margin: 8px 0 12px; }
  h2 { font-size: 26px; margin: 32px 0 12px; }
  h3 { font-size: 17px; margin-bottom: 6px; }
  a { color: inherit; }
  .wrap { max-width: 960px; margin: 0 auto; }
  .k { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .lede { color: var(--muted); max-width: 58ch; margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0 28px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 18px;
  }
  .card p { color: var(--muted); font-size: 14px; }
  .kpi { font-family: Outfit, system-ui, sans-serif; font-size: 32px; letter-spacing: -0.03em; margin: 6px 0; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0 28px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 500; }
  td.sev-high { color: var(--danger); text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
  td.sev-medium { color: var(--warn); text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
  .finding { border-bottom: 1px solid var(--border); padding: 18px 0; }
  .finding:last-child { border-bottom: 0; }
  .finding .meta { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .finding p { color: var(--muted); font-size: 14px; max-width: 68ch; margin-top: 6px; }
  .finding .work { font-size: 13px; color: var(--fg); margin-top: 8px; }
  .proof { list-style: none; margin: 10px 0 0; font-size: 13px; }
  .proof li { display: grid; grid-template-columns: 150px 1fr; gap: 10px; padding: 5px 0; color: var(--muted); }
  .proof b { font-weight: 500; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  .proof span { color: var(--fg); overflow-wrap: anywhere; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 34px; gap: 10px; align-items: center; font-size: 13px; margin-bottom: 8px; }
  .track { height: 8px; border-radius: 99px; background: oklch(100% 0 0 / 0.06); overflow: hidden; }
  .track i { display: block; height: 100%; background: oklch(100% 0 0 / 0.38); border-radius: inherit; }
  .bar-row b { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
  .rec { background: var(--fg); color: oklch(12% 0.01 260); border-radius: 20px; padding: 24px 28px; margin: 24px 0; }
  .rec .k { color: oklch(38% 0.01 260); }
  .rec p { max-width: 58ch; }
  .foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
  .toolbar { max-width: 960px; margin: 0 auto 24px; display: flex; gap: 8px; justify-content: flex-end; }
  .btn {
    min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--border);
    background: none; color: var(--fg); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .btn:hover { background: oklch(100% 0 0 / 0.06); }
  @media (max-width: 780px) {
    body { padding: 28px 18px 56px; }
    .grid { grid-template-columns: 1fr; }
    .proof li { grid-template-columns: 1fr; gap: 2px; }
  }
  @media print {
    @page { margin: 14mm; }
    body { background: #fff; color: #14161a; padding: 0; }
    .toolbar { display: none; }
    .card, .track { background: #fff; border-color: #dcdfe4; }
    .card p, .k, th, .lede, .finding p, .proof li { color: #4a5058; }
    .track i { background: #14161a; }
    .rec { background: #14161a; color: #fff; }
    .rec .k, .rec p { color: #c9ccd2; }
    .finding, h2 { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button class="btn" type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="wrap">
  <p class="k">DigiKraft · Creative Growth Audit</p>
  <h1><?= dk_e($company) ?></h1>
  <p class="lede">
    Creative growth score <?= (int) $r['score']['overall'] ?>/100.
    <?= count($r['findings']) ?> findings, <?= (int) ($r['score']['counts']['high'] ?? 0) ?> high,
    <?= count($r['orders']) ?> work orders.
    Direction: <?= dk_e($r['direction']['name']) ?>.
    Recommended: <?= dk_e($tiers[$tier]['name']) ?> (<?= dk_e($tiers[$tier]['price']) ?>).
    Follow-up <?= dk_e($audit['day']) ?>.
  </p>
  <p class="k" style="margin-top:10px">
    <?= dk_e($host) ?> · <?= dk_e($r['sector']) ?> · read <?= dk_e(substr((string) $r['method']['crawled_at'], 0, 10)) ?>
  </p>

  <div class="grid">
    <div class="card"><p class="k">Score</p><div class="kpi"><?= (int) $r['score']['overall'] ?>/100</div><p>Weighted across the surfaces read.</p></div>
    <div class="card"><p class="k">High severity</p><div class="kpi"><?= (int) ($r['score']['counts']['high'] ?? 0) ?></div><p>Blocking paid traffic before the form.</p></div>
    <div class="card"><p class="k">Work orders</p><div class="kpi"><?= count($r['orders']) ?></div><p>Mapped to DigiKraft services.</p></div>
  </div>

  <p class="k">Surface scores</p>
  <div style="margin:12px 0 28px">
    <?php foreach ($r['surfaces'] as $s): $v = (int) ($r['score']['surfaces'][$s] ?? 0); ?>
      <div class="bar-row">
        <span><?= dk_e(Rules::SURFACES[$s] ?? $s) ?></span>
        <div class="track"><i style="width:<?= $v ?>%"></i></div>
        <b><?= $v ?></b>
      </div>
    <?php endforeach; ?>
  </div>

  <h2>Findings</h2>
  <table>
    <thead><tr><th>Surface</th><th>Severity</th><th>Finding</th><th>Service</th><th>Slot</th></tr></thead>
    <tbody>
    <?php foreach ($r['findings'] as $f): ?>
      <tr>
        <td><?= dk_e(Rules::SURFACES[$f['surface']] ?? $f['surface']) ?></td>
        <td class="sev-<?= dk_e($f['severity']) ?>"><?= dk_e($f['severity']) ?></td>
        <td><?= dk_e($f['title']) ?></td>
        <td><?= dk_e($f['service']) ?></td>
        <td><?= dk_e($f['month']) ?></td>
      </tr>
    <?php endforeach; ?>
    <?php if (!$r['findings']): ?>
      <tr><td colspan="5">Nothing was raised on the surfaces read.</td></tr>
    <?php endif; ?>
    </tbody>
  </table>

  <h2>Evidence</h2>
  <?php foreach ($r['findings'] as $f): ?>
    <div class="finding">
      <p class="meta"><?= dk_e(Rules::SURFACES[$f['surface']] ?? $f['surface']) ?> · <?= dk_e($f['severity']) ?></p>
      <h3><?= dk_e($f['title']) ?></h3>
      <p><?= dk_e($f['evidence']) ?></p>
      <?php if (!empty($f['proof'])): ?>
        <ul class="proof">
          <?php foreach ($f['proof'] as $p): ?>
            <li><b><?= dk_e($p['label']) ?></b><span><?php
              if (!empty($p['url'])) {
                  echo '<a href="' . dk_e($p['url']) . '" rel="noopener nofollow">' . dk_e($p['value']) . '</a>';
              } else {
                  echo dk_e($p['value']);
              }
            ?></span></li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
      <p class="work"><strong>Growth cost:</strong> <?= dk_e($f['cost']) ?><br>
        <strong>DigiKraft:</strong> <?= dk_e($f['service']) ?> · <?= dk_e($f['month']) ?></p>
    </div>
  <?php endforeach; ?>

  <h2>Direction — <?= dk_e($r['direction']['name']) ?></h2>
  <p class="lede"><?= nl2br(dk_e($direction)) ?></p>

  <h2>Immediate improvements</h2>
  <div class="grid">
    <?php foreach ($r['fixes'] as $i => $f): ?>
      <div class="card">
        <p class="k">0<?= $i + 1 ?></p>
        <h3><?= dk_e($f['title']) ?></h3>
        <p><?= dk_e($f['body']) ?></p>
        <p class="k" style="margin-top:10px"><?= dk_e($f['service']) ?> · <?= dk_e($f['month']) ?></p>
      </div>
    <?php endforeach; ?>
  </div>

  <h2>Growth opportunities</h2>
  <div class="grid">
    <?php foreach ($r['bets'] as $i => $b): ?>
      <div class="card">
        <p class="k">0<?= $i + 1 ?></p>
        <h3><?= dk_e($b['title']) ?></h3>
        <p><?= dk_e($b['body']) ?></p>
        <p class="k" style="margin-top:10px"><?= dk_e($b['service']) ?> · <?= dk_e($b['month']) ?></p>
      </div>
    <?php endforeach; ?>
  </div>

  <h2>90-day sequence</h2>
  <table>
    <thead><tr><th>Work order</th><th>Month 1</th><th>Month 2</th><th>Month 3</th><th>Findings</th></tr></thead>
    <tbody>
    <?php foreach ($r['orders'] as $o): ?>
      <tr>
        <td><?= dk_e($o['service']) ?></td>
        <?php foreach ([1, 2, 3] as $m): ?>
          <td><?= in_array($m, $o['months'], true) ? '●' : '' ?></td>
        <?php endforeach; ?>
        <td><?= (int) $o['findings'] ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>

  <div class="rec">
    <p class="k">Recommendation</p>
    <h2 style="margin:6px 0 10px"><?= dk_e($tiers[$tier]['name']) ?> · <?= dk_e($tiers[$tier]['price']) ?></h2>
    <p><?= dk_e($tiers[$tier]['blurb']) ?> Follow-up <?= dk_e($audit['day']) ?>.</p>
  </div>

  <h2>What was read</h2>
  <table>
    <thead><tr><th>Page</th><th>Status</th><th>TTFB</th><th>HTML</th></tr></thead>
    <tbody>
    <?php foreach ($r['method']['pages'] as $p): ?>
      <tr>
        <td><a href="<?= dk_e($p['url']) ?>" rel="noopener nofollow"><?= dk_e(preg_replace('~^https?://~', '', (string) $p['url'])) ?></a></td>
        <td><?= (int) $p['status'] ?: dk_e($p['error']) ?></td>
        <td><?= number_format((float) $p['ttfb'], 2) ?>s</td>
        <td><?= dk_e(bytes_h((int) $p['bytes'])) ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>

  <?php if (!empty($r['method']['documents'])): ?>
  <table>
    <thead><tr><th>Document</th><th>Date</th><th>Size</th><th>Produced with</th></tr></thead>
    <tbody>
    <?php foreach ($r['method']['documents'] as $d): ?>
      <tr>
        <td><a href="<?= dk_e($d['url']) ?>" rel="noopener nofollow"><?= dk_e($d['name']) ?></a></td>
        <td><?= dk_e($d['date'] ?: '—') ?></td>
        <td><?= dk_e(bytes_h((int) $d['bytes'])) ?></td>
        <td><?= dk_e($d['producer'] ?: '—') ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
  <?php endif; ?>

  <?php if (!empty($r['method']['social'])): ?>
  <table>
    <thead><tr><th>Profile</th><th>State</th><th>Note</th></tr></thead>
    <tbody>
    <?php foreach ($r['method']['social'] as $net => $c): ?>
      <tr>
        <td><a href="<?= dk_e($c['url']) ?>" rel="noopener nofollow"><?= dk_e($net) ?></a></td>
        <td><?= dk_e($c['state']) ?></td>
        <td><?= dk_e($c['note']) ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
  <?php endif; ?>

  <p class="foot">
    Measured <?= dk_e((string) $r['method']['crawled_at']) ?> UTC by <?= dk_e((string) $r['method']['user_agent']) ?>.
    Findings come from public pages, stylesheets, linked documents and profile URLs only. Anything a platform blocked is
    marked as unverified rather than assumed. Scores are DigiKraft's model, not an industry standard.
  </p>
</div>
<?php if ($print): ?>
<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 400); });</script>
<?php endif; ?>
</body>
</html>

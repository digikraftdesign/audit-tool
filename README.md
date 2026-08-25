# DigiKraft · Creative Growth Audit

The working tool behind the Money Expo meeting flow. You enter a client's live
website and profile URLs; it reads the real pages, stylesheets, linked documents
and social profiles, and returns scored findings with the evidence attached,
mapped to DigiKraft services and a 90-day plan.

Built to run on ordinary shared hosting: plain PHP, no Composer, no build step,
no background workers. Upload the folder, open it in a browser, done.

---

## 1. Requirements

| Need | Why | Where to check on cPanel |
|---|---|---|
| PHP **8.0+** | The app targets modern PHP | *Select PHP Version* |
| `curl` | Fetching the audited site | *Select PHP Version → Extensions* |
| `dom` / `libxml` | Parsing HTML | same |
| `mbstring` | UTF-8 handling | same |
| `pdo_sqlite` *(or `pdo_mysql`)* | Storing audits | same |
| Outbound HTTP allowed | Some cheap hosts block it | see §6 |

`zlib` is used to compress working data if present, and skipped if not.

## 2. Deploy

1. Upload everything in this folder to your web root — `public_html/`, or a
   subfolder like `public_html/audit/`.
2. Make `storage/` writable: **755** is usually enough, **775** if PHP runs as a
   different user. The SQLite file creates itself on first run, under a random
   filename so it cannot be downloaded by guessing the URL (see §7).
3. Copy `config.sample.php` to `config.php` and set a passcode (see §3).
4. Open the URL. If the page loads and "Get started" works, you are live.

Health check: `https://your-domain/audit/api.php?a=health` returns which
extensions are present, which database driver is in use and whether `storage/`
is writable. Use it first whenever something misbehaves.

## 3. Configure

Everything lives in `config.php`. It has working defaults, so the only line that
really matters on a public domain is the passcode:

```php
'passcode' => 'pick-something',
```

Empty means no gate. That is fine behind a private URL, but on a public domain a
passcode is what stops strangers using your server to fetch URLs on their
behalf. Anyone with the passcode shares one session; there are no user accounts.

Other keys worth knowing:

- `crawl.max_pages` — pages read per audit (default 8). Raising it makes the
  Landing step longer; keep it under what your host's `max_execution_time`
  allows.
- `step_budget` — seconds any single API step may spend (default 20). Lower it
  to 15 if your host caps execution at 30s and you see timeouts.
- `crawl.obey_robots` — on by default. Leave it on.
- `rate_limit.audits_per_hour` — per client IP, default 30.
- `landing_kicker` — the small line above the title on the landing screen
  ("Money Expo India 2026"). Change it after the expo.

### MySQL instead of SQLite

SQLite needs nothing and is the right default. Switch only if your host puts the
document root on a read-only or ephemeral filesystem:

```php
'db' => [
    'driver' => 'mysql',
    'mysql'  => ['host' => 'localhost', 'name' => 'dbname', 'user' => 'dbuser', 'pass' => 'secret'],
],
```

Tables create themselves on first request. Nothing to import.

## 4. How a run works

The browser drives the audit one short request at a time, so no step ever
approaches a shared host's execution limit:

| Step | What it does |
|---|---|
| `init` | Fetches the homepage, picks the other pages worth reading |
| `landing` | Fetches those pages in parallel, runs the Landing rules |
| `brand` | Reads first-party stylesheets, runs the Brand rules |
| `social` | Verifies the supplied and on-site profiles |
| `docs` | Range-reads linked PDFs for date, size, title and producer |
| `finalize` | Scores, builds work orders, fixes, bets and direction |

State lives in the database between steps, so a reload mid-scan resumes rather
than starting over.

## 5. What the findings are made of

Every finding carries the measurement it came from, and the workspace has a
**What was read** panel listing every URL fetched with its status, TTFB and
size. Three rules keep it honest:

- Nothing is inferred from a page that could not be read.
- When a platform blocks a check — LinkedIn and Instagram routinely answer 999
  to any server — the profile is marked *blocked*, never guessed.
- Rules that depend on rendered HTML stay quiet on pages assembled in the
  browser, because this tool reads HTML, not a rendered DOM.

Scores are DigiKraft's model, not an industry standard: each surface starts at
100 and loses 18 per high finding and 9 per medium, and the overall score is a
weighted mean (landing 35%, brand 25%, social 20%, documents 20%) across the
surfaces that were actually read.

Add or reword rules in `app/Audit/Rules.php` — one entry per finding, holding
its severity, growth cost, DigiKraft service and 90-day slot. The analysers in
`app/Audit/Analyzer/` only supply the measured evidence.

## 6. Troubleshooting

**"Could not read <site>"** — the host is blocking outbound HTTP, or the target
blocks unknown user agents. Check `api.php?a=health` first, then try another
site to tell the two apart.

**The scan stops on one step** — that step exceeded PHP's execution limit. Lower
`step_budget` to 15 and `crawl.max_pages` to 5.

**"Passcode required" loops** — sessions are not being written. Ask your host to
confirm `session.save_path` is writable.

**Blank page instead of the tool** — PHP version is too old, or `app/` was not
uploaded. `api.php?a=health` reports the running version.

**Findings look thin on one site** — that site is likely rendered client-side.
The **What was read** panel shows exactly what came back; anything the tool
could not see is left out rather than invented.

## 7. Files

```
index.php            the tool (all five phases, one page)
api.php              JSON endpoints the browser calls
report.php           shareable / printable leave-behind
config.php           your settings (config.sample.php is the template)
assets/css/app.css   the design system, extracted from the approved export
assets/js/app.js     phase routing, scan driver, rendering
app/Support/         HTTP client with SSRF guard, HTML/PDF parsing, database
app/Audit/Rules.php  the finding catalogue — start here to change the audit
app/Audit/Analyzer/  the four surface analysers
app/Audit/Service.php  step runner and persistence
storage/             SQLite database (created on first run, blocked from the web)
storage/db-name.php  remembers the generated database filename
```

`app/` and `storage/` are blocked by `.htaccess`, which Apache and LiteSpeed
honour. nginx-backed hosts ignore `.htaccess`, so the database is additionally
given an unguessable filename — `storage/audits-<random>.sqlite`, recorded in
`storage/db-name.php`, a PHP file the server executes rather than serves. The
files under `app/` output nothing when requested directly.

If you want the database off the web root entirely, set an absolute path in
`config.php`:

```php
'sqlite_path' => '/home/youruser/dk-audit/audits.sqlite',
```

Move the existing `.sqlite` file there first and the tool picks up where it left
off.

## 8. Sharing a report

Every completed audit has a URL of the form
`report.php?id=<id>&t=<token>`. **Copy share link** in the close screen puts it
on the clipboard; **Download report** opens the same page with the print dialog
for save-as-PDF. Anyone with that link can read that one audit and nothing else,
so treat it as client-confidential.

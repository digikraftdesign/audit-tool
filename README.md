# DigiKraft · Creative Growth Audit (Next.js)

Next.js port of the DigiKraft Creative Growth Audit. Full feature parity with the legacy PHP tool: four audit types, browser-driven step loop, passcode gate, shareable leave-behind reports.

The original PHP app is preserved under [`legacy/`](legacy/).

## Requirements

- Node.js **22.13+** (uses built-in `node:sqlite`; Hostinger Node 22 is fine)
- Outbound HTTPS (the server fetches audited URLs)
- Writable `storage/` directory (SQLite + uploads)

> **Hostinger / shared Node hosts:** do not use packages that compile with `node-gyp`
> (e.g. `better-sqlite3`). This app uses Node's built-in SQLite so `npm install`
> does not need Python or a C++ toolchain.

## Quick start (local)

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## Configure

See [`.env.example`](.env.example). Important keys:

| Variable | Purpose |
|---|---|
| `PASSCODE` | Optional shared gate (empty = open) |
| `SESSION_SECRET` | Cookie secret, min 32 chars (required in production) |
| `APP_URL` | Public site URL (Hostinger / reverse proxy same-origin checks) |
| `SQLITE_PATH` | Absolute SQLite path; empty = auto `storage/audits-*.sqlite` |
| `STEP_BUDGET` | Seconds per scan step (default 20) |
| `LANDING_KICKER` | Hero kicker line |

## Deploy (Node VPS / Docker)

```bash
cp .env.example .env   # set SESSION_SECRET, PASSCODE, etc.
docker compose up -d --build
```

SQLite and uploads persist in the `audit-storage` volume at `/app/storage`.

Or without Docker:

```bash
npm ci
npm run build
npm start
```

Use a process manager (systemd, PM2) and reverse proxy (nginx/Caddy) to port 3000.

## How a run works

Same as the PHP tool: the browser drives short steps so each request stays inside `STEP_BUDGET`.

1. `POST /api/audits` → `{ id, token, steps }`
2. `POST /api/audits/:id/step` once per step
3. `GET /api/audits/:id?token=` for the final payload
4. Shareable leave-behind: `/report/:id?t=:token`

## API map

| Method | Path | PHP action |
|---|---|---|
| POST | `/api/login` | `login` |
| POST | `/api/audits` | `create` |
| POST | `/api/audits/:id/step` | `step` |
| GET | `/api/audits/:id` | `get` |
| POST | `/api/audits/:id/close` | `close` |
| POST | `/api/audits/:id/score` | `score` |
| GET | `/api/types` | `types` |
| POST | `/api/upload` | `upload` |
| GET | `/api/recent` | `recent` |
| GET | `/api/health` | `health` |

## Parity checklist

- [ ] Landing / social / branding / document audits complete end-to-end
- [ ] Passcode gate + create rate limit
- [ ] SSRF guard rejects private IPs / odd ports
- [ ] Mid-scan resume via localStorage
- [ ] Manual parameter scores + close flow
- [ ] Shareable `/report/[id]?t=` leave-behind
- [ ] Document upload path

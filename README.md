# QC Terminal

Mobile-friendly QC inspection app: camera OCR / barcode scan of 7-digit serials,
10-point checklist, activity log, QM approval dashboard and Excel export.

- **Frontend:** a single static `index.html` (Netlify / GitHub Pages / open from disk).
- **Backend:** `qc-backend/` — Node 20+, Express, MySQL (or TiDB).

See **CHANGES.md** for the full list of fixes in this version.

## Quick start (no server)
Open `index.html` → **Server settings** → *Demo*. Records stay in that browser.
Demo logins: `admin/admin123`, `qa/qa123`, `qm/qm123`.

## Backend
```bash
cd qc-backend
cp ../.env.example .env     # fill in DB + QC_USERS + AUTH_SECRET
npm install
npm start                   # http://localhost:3000
```
The `qc_logs` table is created / migrated automatically on start (`schema.sql` is optional).

### Environment
| Variable | Purpose |
|---|---|
| `CORS_ORIGIN` | Comma-separated exact origins, or `*`. localhost always allowed. |
| `CORS_ALLOW_NULL_ORIGIN` | `true` (default) lets `file://` pages log in. |
| `DATABASE_URL` or `DB_HOST/PORT/USER/PASSWORD/NAME` | MySQL connection. |
| `DB_SSL` | `true` for hosted DBs, `false` for local; unset = auto. |
| `QC_USERS` | `user:password:role[:Label]`, comma-separated. Roles `admin`, `qa`, `qm`. |
| `AUTH_SECRET` | Long random string used to sign sessions. |
| `TOKEN_TTL_HOURS` | Session length (default 12). |

### Deploy to Render
Web Service → root `qc-backend`, build `npm install`, start `npm start`, add the env vars
above, deploy, then paste the service URL into the app's **Server settings**.

## API
All `/api/*` routes except login need `Authorization: Bearer <token>`.

| Method | Route | Roles |
|---|---|---|
| POST | `/api/login` | — |
| GET | `/api/me`, `/api/logs`, `/api/export`, `/api/log/:serial` | any |
| POST | `/api/log` | admin, qa |
| PUT | `/api/log/:serial` | admin, qa |
| PATCH | `/api/log/:serial/qm-status` | qm |
| DELETE | `/api/log/:serial` | admin |
| GET | `/health` | — |

## Roles
- **QA** — scan, inspect, edit; activity log.
- **QM** — dashboard, approve / reject (reason required); activity log.
- **Admin** — everything QA can do + dashboard + delete.

## Camera notes
The camera needs `https://` or `localhost`. Opening the file from disk still works for
login and manual entry; for scanning, use the hosted link.

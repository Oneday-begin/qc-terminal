# QC Terminal — bug-fix & UI upgrade (Oct 2026)

## The login error ("Server connection error. Please try again.")

**Root cause:** the page was opened straight from disk (`file:///C:/Users/.../index.html`).
Browsers send `Origin: null` for such pages. The old `server.js` CORS check rejected
`null` by throwing an error, and the resulting `403` response had no CORS headers,
so the browser hid it and `fetch()` failed with a generic network error → the app
showed "Server connection error". Reproduced against the old code:

```
OPTIONS /api/login  Origin: null  ->  403 {"message":"Origin not allowed: null"}
```

**Fixes**
- Backend now allows `file://` pages (`CORS_ALLOW_NULL_ORIGIN=true`, default) and `localhost`.
- Disallowed origins no longer crash the request; they are logged so you can add them.
- `CORS_ORIGIN` tolerates the markdown-link format that the old `.env.example` used
  (`[https://x](https://x)`), which silently broke *every* origin if copied to Render.
- Frontend login: 75 s timeout + "waking server" notice (Render free tier cold start),
  real error messages (wrong password vs. wrong role vs. unreachable server vs. CORS),
  a live server-status line, and a **Server settings** link on the login screen
  (previously settings were unreachable until you were logged in).

> ⚠️ The live backend on Render must be **redeployed** with the new `qc-backend/server.js`
> for the login fix to take effect.

## Backend bugs fixed
| # | Bug | Fix |
|---|-----|-----|
| 1 | `qm_status` was written on every insert/update but **never existed in `schema.sql`** → every save failed with "Unknown column" on a fresh DB. | Column added; server auto-creates/migrates the table on boot (`ensureSchema`). |
| 2 | API had **no authentication** — anyone with the URL could read, edit or delete every record. Passwords were hard-coded in source. | Signed session tokens (HMAC, 12 h), scrypt-hashed users from `QC_USERS` env, role checks on every route (QA/Admin write, QM approve, Admin delete). |
| 3 | No brute-force protection on login. | 10 failed attempts / 5 min lockout per IP+user. |
| 4 | Server trusted client-sent `overall_status` and `resistance_verified`. | Both recomputed server-side. |
| 5 | Forced TLS on all DB connections → local MySQL failed with "Server does not support secure connection". | `DB_SSL` auto/true/false. |
| 6 | QM approval re-sent the whole record through the full edit endpoint. | Dedicated `PATCH /api/log/:serial/qm-status`, reason required for rejection, reviewer + time stored. |
| 7 | Editing an approved record kept it "approved". | Any change to results sends it back to QM *pending*. |
| 8 | Edits overwrote the original inspection time. | Original timestamp kept; `updated_at`/`updated_by` track edits. |
| 9 | Duplicate-key race returned 500; malformed JSON returned 500. | 409 / 400 with clear messages. Audit fields `created_by` / `updated_by`. |

## Frontend bugs fixed
- **Activity-log editing was broken:** choosing "Not confirmed" saved instantly without a
  remark → server rejected it and reverted; every keystroke in a remark fired an API call
  and re-rendered, losing focus. Edits now open the full checklist instead.
- **"Select all" invented a resistance reading (5.6)** — a fake measurement in QC records.
  It now marks the checks and moves focus to the resistance field.
- **Duplicate race wiped the operator's answers** (re-opened an empty checklist). Answers are
  now kept and the form switches to "Update record".
- **Stored XSS:** notes, remarks and station names were injected as raw HTML. All output is escaped.
- **Date filters / "today" used UTC** — in IST, inspections between 00:00–05:30 landed on the
  previous day. Now uses local dates.
- **OCR read the wrong area on 16:9 cameras** (crop assumed the video matched the 4:3 frame).
  Crop is now mapped from the on-screen reticle, including zoom.
- Camera kept running in other tabs / in the background; a stream leaked on every settings
  save; resize listener added repeatedly; a canvas + `getImageData` ran on *every* frame for
  an unused focus metric. All fixed — camera stops when you leave the Scan tab or the app.
- `AUTH_USERS`/`exportBtn`/`renderHistory`/`refreshHistory` were undeclared globals.
- Unpinned `tesseract.js@5` CDN tag (could break on any release) → pinned `5.1.1`.
  App no longer errors every frame if Tesseract/XLSX fail to load offline.
- Expired/invalid sessions are detected and sent back to login.
- Export now includes QM status/remark/reviewer and who logged/edited each unit.

## UI upgrade
Full redesign, same single `index.html`, no build step:
role picker cards on login, server status, top tabs on desktop / bottom nav on phones,
side-by-side camera + confirm panel, flashlight toggle, auto-advancing serial inputs,
checklist with progress bar and per-item ✓/✗ state, sticky verdict + submit bar,
searchable/filterable activity log with result & QM chips, dashboard with KPIs,
7-day pass/fail chart, per-station bars, approve/reject with reason dialog,
toast stack and proper modals (no more `window.prompt`). Tested at 360 px → 1280 px.

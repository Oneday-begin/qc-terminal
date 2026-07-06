# QC Terminal

QC Terminal is a mobile-friendly inspection app with:

- camera OCR and auto-detection
- manual serial correction
- editable activity log
- Excel export in the browser
- a Node.js + Express + MySQL backend

The frontend is still a single static [index.html](C:\Users\HP\Documents\scanner-prototype\qc-terminal\index.html) file, so it can be hosted on GitHub Pages. The backend is now a separate REST API for Render, Railway, or any Node-compatible host.

## Files

- [index.html](C:\Users\HP\Documents\scanner-prototype\qc-terminal\index.html): frontend UI and scanner logic
- [schema.sql](C:\Users\HP\Documents\scanner-prototype\qc-terminal\schema.sql): MySQL schema
- [server.js](C:\Users\HP\Documents\scanner-prototype\qc-terminal\server.js): Express API
- [db.js](C:\Users\HP\Documents\scanner-prototype\qc-terminal\db.js): MySQL pool and transaction helper
- [package.json](C:\Users\HP\Documents\scanner-prototype\qc-terminal\package.json): backend package config
- [.env.example](C:\Users\HP\Documents\scanner-prototype\qc-terminal\.env.example): environment variable template

## API

All responses are JSON.

- `POST /api/log`: create a new inspection row
- `GET /api/logs`: fetch all inspections, newest first
- `GET /api/log/:serial`: fetch one inspection by serial
- `PUT /api/log/:serial`: update an existing inspection in place
- `DELETE /api/log/:serial`: delete one inspection by serial
- `GET /api/export`: fetch the full dataset for export

Behavior:

- Duplicate serials are blocked on create with `409 Conflict`.
- Editing always updates the existing row and never inserts a new row.
- MySQL transactions are used on create, update, and delete.
- A unique index on `serial_number` protects against concurrent duplicate inserts across stations.

## Database Setup

1. Create a MySQL database, for example `qc_terminal`.
2. Run [schema.sql](C:\Users\HP\Documents\scanner-prototype\qc-terminal\schema.sql).
3. Create a `.env` from [.env.example](C:\Users\HP\Documents\scanner-prototype\qc-terminal\.env.example).

Example:

```bash
cp .env.example .env
```

Then fill in:

- `CORS_ORIGIN`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

## Local Backend Run

```bash
npm install
npm run dev
```

Default API URL:

```text
http://localhost:3000
```

## Frontend Settings

Open the app, go to Settings, and choose:

- `Demo`: local-only storage in the browser
- `MySQL REST API`: set `API Base URL` to your deployed backend, for example `https://your-service.onrender.com`

The UI remains the same. History, duplicate checks, edits, OCR, auto-scan, and export continue to work through the new API adapter.

## Deployment

### Render

1. Push the `qc-terminal` folder contents to a Git repo.
2. Create a new Render Web Service.
3. Set:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables from [.env.example](C:\Users\HP\Documents\scanner-prototype\qc-terminal\.env.example).
5. Set `CORS_ORIGIN` to your GitHub Pages origin, for example:

```text
https://your-username.github.io
```

6. Deploy.
7. Copy the Render service URL into the frontend `API Base URL` setting.

### Railway

1. Create a new Railway project.
2. Add a MySQL service.
3. Add a Node service pointing at this project.
4. Set environment variables:
   - `PORT`
   - `CORS_ORIGIN`
   - either `DATABASE_URL` or the individual `DB_*` variables
5. Run the schema from [schema.sql](C:\Users\HP\Documents\scanner-prototype\qc-terminal\schema.sql).
6. Deploy and copy the generated backend URL into the frontend `API Base URL` setting.

## Scanner Engine (rewritten from scratch)

The old capture-button + single-pass-OCR flow is gone. Scanning is now fully continuous:

- **BarcodeDetector first.** If the browser supports it (most Android Chrome builds do; Safari/Firefox generally don't — the code detects this and skips straight to OCR there), every processed frame is checked against the native barcode API first. It's near-instant and, when it hits, treated as ground truth — no consensus wait needed.
- **OCR fallback.** Tesseract.js runs recognition in its own Web Worker (this was always true of `createWorker` — recognition was never actually blocking the main thread), against a cropped, preprocessed region-of-interest (grayscale → denoise → unsharp mask → adaptive threshold), not the full frame.
- **Dynamic acceptance, not a fixed threshold.** A read is accepted when either: a barcode decodes cleanly, OR the same batch+uid comes back on two consecutive processed frames, OR a single frame clears a high-confidence shortcut (82%+). This adapts to read quality automatically instead of trusting one noisy frame or demanding a rigid score every time.
- **Hard timeout per OCR pass (3.5s).** A hung recognize() call is abandoned, not awaited — this is what makes "stuck on Scanning…" structurally impossible now, not just less likely.
- **Debounce/cooldown.** Once a serial is accepted, it won't be re-accepted for 4 seconds even if the loop somehow saw it again immediately — prevents accidental double-reads.
- **Stops immediately on a valid read.** The `requestAnimationFrame` loop is torn down the instant something is accepted; it restarts when you return to the scan screen (Cancel / Edit / Scan Next Unit).
- **Frame-rate friendly.** Processing is capped at ~11 frames/sec regardless of camera fps, so the live video preview itself stays smooth at 30-60fps on low-end phones — the cap only limits how often we *analyze* a frame, not how often the video renders.
- The old **Capture & Scan** button still exists (UI unchanged) but no longer gates scanning — it's now a "best-effort read right now" shortcut for a code that's proving stubborn, handing whatever it finds straight to manual entry for a quick confirm.

**Known limitation:** true deskew (correcting a rotated/tilted label) isn't implemented — the reticle guide is relied on to keep the code roughly horizontal instead. A full perspective-correction pass was out of scope for a client-side, dependency-free implementation; if skewed labels turn out to be common in practice, that's the next thing worth adding.

## Notes

- The frontend export still produces a real `.xlsx` file in the browser, but it now pulls the full dataset from `GET /api/export`.
- The activity log still supports in-place editing.
- The duplicate lookup is global by serial number, not limited to station.
- The backend is CORS-restricted through `CORS_ORIGIN`, so remember to use the exact GitHub Pages origin.
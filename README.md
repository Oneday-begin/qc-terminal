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

## Notes

- The frontend export still produces a real `.xlsx` file in the browser, but it now pulls the full dataset from `GET /api/export`.
- The activity log still supports in-place editing.
- The duplicate lookup is global by serial number, not limited to station.
- The backend is CORS-restricted through `CORS_ORIGIN`, so remember to use the exact GitHub Pages origin.

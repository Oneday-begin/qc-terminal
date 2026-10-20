require('dotenv').config();

const crypto = require('crypto');
const cors = require('cors');
const express = require('express');

const { pool, withTransaction, ensureSchema } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TOKEN_TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS || 12);

app.set('trust proxy', 1); // Render / Railway sit behind a proxy — needed for real client IPs

/* ------------------------------------------------------------------ *
 * Field definitions
 * ------------------------------------------------------------------ */
const CHECK_FIELDS = [
  'plug_socket', 'seal', 'visual', 'insert_glue', 'rotation', 'labelling', 'serial_number_check',
];
const REMARK_FIELDS = CHECK_FIELDS.map((f) => `${f}_remark`);

// Columns written by QA/Admin when creating or editing an inspection.
const INSPECTION_COLUMNS = [
  'serial_number', 'batch_number', 'uid_number', 'timestamp', 'test_station', 'is_retest',
  'overall_status', 'notes', ...CHECK_FIELDS, ...REMARK_FIELDS,
  'resistance', 'resistance_verified', 'moulding', 'golden_coating',
];

const RESISTANCE_MIN = Number(process.env.RESISTANCE_MIN || 5.5);
const RESISTANCE_MAX = Number(process.env.RESISTANCE_MAX || 5.7);

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ *
 * CORS
 *   CORS_ORIGIN               comma-separated list, or * for any origin
 *   CORS_ALLOW_NULL_ORIGIN    allow pages opened straight from disk
 *                             (file://  -> Origin: null). Default true.
 *
 * The original code rejected "Origin: null" by throwing an error, and the
 * error response had no CORS headers — so a page opened from
 * C:/Users/.../index.html could never log in and the browser just showed
 * "Server connection error". Pasting markdown links into CORS_ORIGIN
 * (as the old .env.example did) also silently broke every origin.
 * ------------------------------------------------------------------ */
function parseAllowedOrigins() {
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((v) => v.trim())
    .map((v) => {
      const md = v.match(/\]\((https?:\/\/[^)]+)\)/); // tolerate "[x](https://x)"
      return (md ? md[1] : v).replace(/^\[|\]$/g, '').replace(/\/+$/, '');
    })
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();
const allowAnyOrigin = allowedOrigins.length === 0 || allowedOrigins.includes('*');
const allowNullOrigin = !['0', 'false', 'no', 'off'].includes(String(process.env.CORS_ALLOW_NULL_ORIGIN || 'true').toLowerCase());
const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);                 // curl, server-to-server
    if (origin === 'null') return callback(null, allowNullOrigin);
    if (allowAnyOrigin || allowedOrigins.includes(origin) || isLocalOrigin(origin)) return callback(null, true);
    console.warn(`[cors] blocked origin ${origin} — add it to CORS_ORIGIN`);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '1mb' }));

/* ------------------------------------------------------------------ *
 * Users & tokens
 *   QC_USERS="admin:StrongPass1:admin:Administrator,qa1:pass:qa,qm1:pass:qm"
 *   AUTH_SECRET=<long random string>
 * ------------------------------------------------------------------ */
const ROLE_LABELS = { admin: 'Administrator', qa: 'Quality Analyst', qm: 'Quality Manager' };

function loadUsers() {
  const raw = (process.env.QC_USERS || '').trim();
  const users = {};
  if (raw) {
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((entry) => {
      const [username, password, role, ...labelParts] = entry.split(':');
      const key = String(username || '').trim().toLowerCase();
      const r = String(role || '').trim().toLowerCase();
      if (!key || !password || !ROLE_LABELS[r]) {
        console.warn(`[auth] ignoring malformed QC_USERS entry for "${key || '?'}"`);
        return;
      }
      users[key] = { password, role: r, label: labelParts.join(':').trim() || ROLE_LABELS[r] };
    });
  }
  if (!Object.keys(users).length) {
    console.warn('[auth] QC_USERS not set — using built-in DEFAULT credentials. Set QC_USERS before going live!');
    users.admin = { password: 'admin123', role: 'admin', label: ROLE_LABELS.admin };
    users.qa = { password: 'qa123', role: 'qa', label: ROLE_LABELS.qa };
    users.qm = { password: 'qm123', role: 'qm', label: ROLE_LABELS.qm };
  }
  // Keep only a salted hash in memory.
  for (const user of Object.values(users)) {
    user.salt = crypto.randomBytes(16);
    user.hash = crypto.scryptSync(user.password, user.salt, 32);
    delete user.password;
  }
  return users;
}

const USERS = loadUsers();

// Stable secret across restarts (Render free tier restarts after idling).
const AUTH_SECRET = process.env.AUTH_SECRET
  || crypto.createHash('sha256').update(`qc-terminal|${process.env.QC_USERS || 'defaults'}|${process.env.DB_PASSWORD || ''}|${process.env.DATABASE_URL || ''}`).digest('hex');
if (!process.env.AUTH_SECRET) console.warn('[auth] AUTH_SECRET not set — using a derived secret. Set AUTH_SECRET in production.');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (!USERS[payload.u] || USERS[payload.u].role !== payload.r) return null; // user removed / role changed
    return payload;
  } catch (_e) {
    return null;
  }
}

function requireAuth(...roles) {
  return (req, _res, next) => {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) return next(new HttpError(401, 'Session expired — please log in again'));
    if (roles.length && !roles.includes(payload.r)) {
      return next(new HttpError(403, `Your role (${payload.r.toUpperCase()}) is not allowed to do this`));
    }
    req.user = { username: payload.u, role: payload.r, label: payload.l };
    return next();
  };
}

// Tiny in-memory brute-force guard: 10 failed attempts / 5 min per IP+user.
const loginFailures = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.first > 5 * 60 * 1000) return false;
  return entry.count >= 10;
}
function recordFailure(key) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.first > 5 * 60 * 1000) loginFailures.set(key, { first: now, count: 1 });
  else entry.count += 1;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const iso = (v) => (v === null || v === undefined ? null : (v instanceof Date ? v : new Date(v)).toISOString());

function pickRow(row) {
  const out = {
    id: row.id,
    serial_number: row.serial_number,
    batch_number: row.batch_number,
    uid_number: row.uid_number,
    timestamp: iso(row.timestamp),
    test_station: row.test_station,
    is_retest: Boolean(row.is_retest),
    overall_status: row.overall_status,
    qm_status: row.qm_status || 'PENDING',
    qm_remark: row.qm_remark || '',
    qm_reviewed_by: row.qm_reviewed_by || '',
    qm_reviewed_at: iso(row.qm_reviewed_at),
    notes: row.notes || '',
    resistance: row.resistance === null || row.resistance === undefined ? '' : String(Number(row.resistance)),
    resistance_verified: row.resistance_verified,
    moulding: row.moulding,
    golden_coating: row.golden_coating,
    created_by: row.created_by || '',
    updated_by: row.updated_by || '',
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
  for (const f of CHECK_FIELDS) {
    out[f] = row[f];
    out[`${f}_remark`] = row[`${f}_remark`] || '';
  }
  return out;
}

const normalizeBoolean = (v) => v === true || v === 'true' || v === 1 || v === '1';

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} is required`);
  const trimmed = value.trim();
  if (maxLength && trimmed.length > maxLength) throw new HttpError(400, `${field} must be at most ${maxLength} characters`);
  return trimmed;
}

function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function optionalText(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validatePayload(body, expectedSerial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be a JSON object');

  const batchNumber = String(body.batch_number ?? '').trim();
  const uidNumber = String(body.uid_number ?? '').trim();
  if (!/^\d{4}$/.test(batchNumber)) throw new HttpError(400, 'batch_number must be exactly 4 digits');
  if (!/^\d{3}$/.test(uidNumber)) throw new HttpError(400, 'uid_number must be exactly 3 digits');

  const serialNumber = String(body.serial_number ?? '').trim();
  if (!/^\d{7}$/.test(serialNumber)) throw new HttpError(400, 'serial_number must be exactly 7 digits');
  if (serialNumber !== `${batchNumber}${uidNumber}`) throw new HttpError(400, 'serial_number must match batch_number + uid_number');
  if (expectedSerial && serialNumber !== expectedSerial) throw new HttpError(400, 'serial_number in body must match the URL serial');

  const ts = new Date(requireString(String(body.timestamp ?? ''), 'timestamp', 64));
  if (Number.isNaN(ts.getTime())) throw new HttpError(400, 'timestamp must be a valid ISO 8601 string');

  const payload = {
    serial_number: serialNumber,
    batch_number: batchNumber,
    uid_number: uidNumber,
    timestamp: ts,
    test_station: requireString(body.test_station, 'test_station', 120),
    is_retest: normalizeBoolean(body.is_retest) ? 1 : 0,
    notes: optionalText(body.notes),
  };

  for (const field of CHECK_FIELDS) {
    const value = requireEnum(body[field], field, ['Pass', 'NotConfirmed']);
    payload[field] = value;
    const remark = optionalText(body[`${field}_remark`]);
    if (value === 'NotConfirmed' && !remark) throw new HttpError(400, `A remark is required when ${field.replace(/_/g, ' ')} is Not Confirmed`);
    payload[`${field}_remark`] = value === 'NotConfirmed' ? remark : '';
  }

  const resistanceValue = Number(body.resistance);
  if (body.resistance === '' || body.resistance === null || !Number.isFinite(resistanceValue)) {
    throw new HttpError(400, 'resistance must be a valid number');
  }
  if (resistanceValue < 0 || resistanceValue >= 1000) throw new HttpError(400, 'resistance is out of range');
  payload.resistance = Number(resistanceValue.toFixed(2));
  // Never trust the client for derived values.
  payload.resistance_verified = payload.resistance >= RESISTANCE_MIN && payload.resistance <= RESISTANCE_MAX ? 'Pass' : 'Fail';
  payload.moulding = requireEnum(body.moulding, 'moulding', ['Cream', 'Brown Transparent']);
  payload.golden_coating = requireEnum(body.golden_coating, 'golden_coating', ['Bright', 'Dull']);

  const allPass = CHECK_FIELDS.every((f) => payload[f] === 'Pass')
    && payload.resistance_verified === 'Pass'
    && payload.moulding === 'Cream'
    && payload.golden_coating === 'Bright';
  payload.overall_status = allPass ? 'PASS' : 'FAIL';

  return payload;
}

function parseSerialParam(req) {
  const serial = String(req.params.serial || '').trim();
  if (!/^\d{7}$/.test(serial)) throw new HttpError(400, 'serial must be exactly 7 digits');
  return serial;
}

async function fetchBySerial(conn, serial, forUpdate = false) {
  const [rows] = await conn.execute(`SELECT * FROM qc_logs WHERE serial_number = ?${forUpdate ? ' FOR UPDATE' : ''}`, [serial]);
  return rows[0] || null;
}

async function fetchAllRows() {
  const [rows] = await pool.query('SELECT * FROM qc_logs ORDER BY timestamp DESC, id DESC');
  return rows.map(pickRow);
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */
app.get('/', (_req, res) => res.json({ service: 'qc-terminal-api', ok: true }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, db: 'down', message: 'Database unreachable' });
  }
});

app.post('/api/login', wrap(async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const role = String(req.body?.role ?? '').trim().toLowerCase();
  if (!username || !password) throw new HttpError(400, 'Username and password are required');

  const key = `${req.ip}|${username}`;
  if (tooManyAttempts(key)) throw new HttpError(429, 'Too many failed attempts — wait 5 minutes and try again');

  const user = USERS[username];
  const candidate = crypto.scryptSync(password, user ? user.salt : Buffer.alloc(16), 32);
  const ok = Boolean(user) && crypto.timingSafeEqual(candidate, user.hash);
  if (!ok) {
    recordFailure(key);
    throw new HttpError(401, 'Invalid username or password');
  }
  if (role && role !== user.role) {
    throw new HttpError(403, `This account is a ${ROLE_LABELS[user.role]} account — pick that role and try again`);
  }
  loginFailures.delete(key);

  const expiresAt = Date.now() + TOKEN_TTL_HOURS * 3600 * 1000;
  const token = signToken({ u: username, r: user.role, l: user.label, exp: expiresAt });
  res.json({ username, role: user.role, label: user.label, token, expires_at: new Date(expiresAt).toISOString() });
}));

app.get('/api/me', requireAuth(), (req, res) => res.json(req.user));

app.get('/api/logs', requireAuth(), wrap(async (_req, res) => {
  const rows = await fetchAllRows();
  res.json({ rows, count: rows.length });
}));

app.get('/api/export', requireAuth(), wrap(async (_req, res) => {
  const rows = await fetchAllRows();
  res.json({ rows, count: rows.length, exported_at: new Date().toISOString() });
}));

app.get('/api/log/:serial', requireAuth(), wrap(async (req, res) => {
  const row = await fetchBySerial(pool, parseSerialParam(req));
  if (!row) throw new HttpError(404, 'Serial not found');
  res.json({ row: pickRow(row) });
}));

app.post('/api/log', requireAuth('admin', 'qa'), wrap(async (req, res) => {
  const payload = validatePayload(req.body);
  const row = await withTransaction(async (conn) => {
    if (await fetchBySerial(conn, payload.serial_number, true)) throw new HttpError(409, 'Serial number already exists');
    const cols = [...INSPECTION_COLUMNS, 'qm_status', 'created_by', 'updated_by'];
    const values = [...INSPECTION_COLUMNS.map((c) => payload[c]), 'PENDING', req.user.username, req.user.username];
    const [result] = await conn.execute(
      `INSERT INTO qc_logs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      values
    );
    const [rows] = await conn.execute('SELECT * FROM qc_logs WHERE id = ?', [result.insertId]);
    return rows[0];
  });
  res.status(201).json({ row: pickRow(row) });
}));

app.put('/api/log/:serial', requireAuth('admin', 'qa'), wrap(async (req, res) => {
  const serial = parseSerialParam(req);
  const payload = validatePayload(req.body, serial);
  const row = await withTransaction(async (conn) => {
    const existing = await fetchBySerial(conn, serial, true);
    if (!existing) throw new HttpError(404, 'Serial not found');

    // The inspection itself changed -> it needs a fresh QM review.
    const changed = INSPECTION_COLUMNS.some((c) => {
      if (c === 'timestamp' || c === 'test_station') return false;
      const before = existing[c] === null || existing[c] === undefined ? '' : existing[c];
      if (c === 'resistance') return Number(before) !== Number(payload[c]);
      if (c === 'is_retest') return Boolean(before) !== Boolean(payload[c]);
      return String(before) !== String(payload[c]);
    });

    // Keep the original inspection time; updated_at records the edit.
    const sets = INSPECTION_COLUMNS.filter((c) => c !== 'timestamp' && c !== 'serial_number');
    const assignments = [...sets.map((c) => `${c} = ?`), 'updated_by = ?'];
    const values = [...sets.map((c) => payload[c]), req.user.username];
    if (changed && existing.qm_status !== 'PENDING') {
      assignments.push("qm_status = 'PENDING'", 'qm_remark = NULL', 'qm_reviewed_by = NULL', 'qm_reviewed_at = NULL');
    }
    await conn.execute(`UPDATE qc_logs SET ${assignments.join(', ')} WHERE serial_number = ?`, [...values, serial]);
    const [rows] = await conn.execute('SELECT * FROM qc_logs WHERE serial_number = ?', [serial]);
    return rows[0];
  });
  res.json({ row: pickRow(row) });
}));

// QM decision — separate from inspection edits so a QM never has to resend the whole record.
app.patch('/api/log/:serial/qm-status', requireAuth('qm'), wrap(async (req, res) => {
  const serial = parseSerialParam(req);
  const status = requireEnum(String(req.body?.qm_status || '').toUpperCase(), 'qm_status', ['PENDING', 'APPROVED', 'REJECTED']);
  const remark = optionalText(req.body?.qm_remark, 1000);
  if (status === 'REJECTED' && !remark) throw new HttpError(400, 'A reason is required when rejecting');

  const row = await withTransaction(async (conn) => {
    const existing = await fetchBySerial(conn, serial, true);
    if (!existing) throw new HttpError(404, 'Serial not found');
    await conn.execute(
      'UPDATE qc_logs SET qm_status = ?, qm_remark = ?, qm_reviewed_by = ?, qm_reviewed_at = ? WHERE serial_number = ?',
      [status, remark || null, status === 'PENDING' ? null : req.user.username, status === 'PENDING' ? null : new Date(), serial]
    );
    const [rows] = await conn.execute('SELECT * FROM qc_logs WHERE serial_number = ?', [serial]);
    return rows[0];
  });
  res.json({ row: pickRow(row) });
}));

app.delete('/api/log/:serial', requireAuth('admin'), wrap(async (req, res) => {
  const serial = parseSerialParam(req);
  await withTransaction(async (conn) => {
    if (!(await fetchBySerial(conn, serial, true))) throw new HttpError(404, 'Serial not found');
    await conn.execute('DELETE FROM qc_logs WHERE serial_number = ?', [serial]);
  });
  res.json({ deleted: true, serial_number: serial });
}));

app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  let status = error.status || error.statusCode || 500;
  let message = error.message;
  if (error.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON body'; }
  if (error.code === 'ER_DUP_ENTRY') { status = 409; message = 'Serial number already exists'; }
  if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ENOTFOUND'].includes(error.code)) {
    status = 503; message = 'Database unavailable — try again shortly';
  }
  if (status >= 500) {
    console.error(error);
    if (status === 500) message = 'Internal server error';
  }
  res.status(status).json({ message, ...(error.details ? { details: error.details } : {}) });
});

/* ------------------------------------------------------------------ */
async function start() {
  try {
    await ensureSchema();
    console.log('[schema] qc_logs ready');
  } catch (error) {
    // Don't crash-loop: the API still boots and /health reports the DB state.
    console.error('[schema] could not verify schema:', error.code || error.message);
  }
  app.listen(PORT, () => {
    console.log(`QC API listening on port ${PORT}`);
    console.log(`[cors] ${allowAnyOrigin ? 'any origin' : allowedOrigins.join(', ')}${allowNullOrigin ? ' + file:// (null)' : ''} + localhost`);
  });
}

if (require.main === module) start();

module.exports = { app, validatePayload, verifyToken, signToken };

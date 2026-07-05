require('dotenv').config();

const cors = require('cors');
const express = require('express');

const { pool, withTransaction } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const CHECK_FIELDS = [
  'plug_socket',
  'seal',
  'visual',
  'insert_glue',
  'rotation',
  'labelling',
  'serial_number_check',
];

const REMARK_FIELDS = CHECK_FIELDS.map((field) => `${field}_remark`);

const ALL_COLUMNS = [
  'serial_number',
  'batch_number',
  'uid_number',
  'timestamp',
  'test_station',
  'is_retest',
  'overall_status',
  'notes',
  ...CHECK_FIELDS,
  ...REMARK_FIELDS,
  'resistance',
  'resistance_verified',
  'moulding',
  'golden_coating',
];

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parseAllowedOrigins() {
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new HttpError(403, `Origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '1mb' }));

function pickRow(row) {
  return {
    id: row.id,
    row_index: row.id,
    serial_number: row.serial_number,
    batch_number: row.batch_number,
    uid_number: row.uid_number,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString(),
    test_station: row.test_station,
    is_retest: Boolean(row.is_retest),
    overall_status: row.overall_status,
    notes: row.notes || '',
    plug_socket: row.plug_socket,
    plug_socket_remark: row.plug_socket_remark || '',
    seal: row.seal,
    seal_remark: row.seal_remark || '',
    visual: row.visual,
    visual_remark: row.visual_remark || '',
    insert_glue: row.insert_glue,
    insert_glue_remark: row.insert_glue_remark || '',
    rotation: row.rotation,
    rotation_remark: row.rotation_remark || '',
    labelling: row.labelling,
    labelling_remark: row.labelling_remark || '',
    serial_number_check: row.serial_number_check,
    serial_number_check_remark: row.serial_number_check_remark || '',
    resistance: row.resistance === null || row.resistance === undefined ? '' : String(row.resistance),
    resistance_verified: row.resistance_verified,
    moulding: row.moulding,
    golden_coating: row.golden_coating,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (maxLength && trimmed.length > maxLength) {
    throw new HttpError(400, `${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function validateIsoTimestamp(value) {
  const timestamp = requireString(value, 'timestamp', 64);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'timestamp must be a valid ISO 8601 string');
  }
  return parsed;
}

function validatePayload(body, expectedSerial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }

  const batchNumber = requireString(String(body.batch_number || ''), 'batch_number', 4);
  const uidNumber = requireString(String(body.uid_number || ''), 'uid_number', 3);
  if (!/^\d{4}$/.test(batchNumber)) throw new HttpError(400, 'batch_number must be exactly 4 digits');
  if (!/^\d{3}$/.test(uidNumber)) throw new HttpError(400, 'uid_number must be exactly 3 digits');

  const serialNumber = requireString(String(body.serial_number || ''), 'serial_number', 32);
  if (!/^\d{7}$/.test(serialNumber)) throw new HttpError(400, 'serial_number must be exactly 7 digits');
  if (serialNumber !== `${batchNumber}${uidNumber}`) {
    throw new HttpError(400, 'serial_number must match batch_number + uid_number');
  }
  if (expectedSerial && serialNumber !== expectedSerial) {
    throw new HttpError(400, 'serial_number in body must match the URL serial');
  }

  const payload = {
    serial_number: serialNumber,
    batch_number: batchNumber,
    uid_number: uidNumber,
    timestamp: validateIsoTimestamp(body.timestamp),
    test_station: requireString(body.test_station, 'test_station', 120),
    is_retest: normalizeBoolean(body.is_retest),
    overall_status: requireEnum(body.overall_status, 'overall_status', ['PASS', 'FAIL']),
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
  };

  for (const field of CHECK_FIELDS) {
    const value = requireEnum(body[field], field, ['Pass', 'NotConfirmed']);
    payload[field] = value;

    const remarkField = `${field}_remark`;
    const remark = typeof body[remarkField] === 'string' ? body[remarkField].trim() : '';
    if (value === 'NotConfirmed' && !remark) {
      throw new HttpError(400, `${remarkField} is required when ${field} is NotConfirmed`);
    }
    payload[remarkField] = value === 'NotConfirmed' ? remark : '';
  }

  const resistanceValue = Number(body.resistance);
  if (!Number.isFinite(resistanceValue)) {
    throw new HttpError(400, 'resistance must be a valid number');
  }
  payload.resistance = Number(resistanceValue.toFixed(2));
  payload.resistance_verified = requireEnum(body.resistance_verified, 'resistance_verified', ['Pass', 'Fail']);
  payload.moulding = requireEnum(body.moulding, 'moulding', ['Cream', 'Brown Transparent']);
  payload.golden_coating = requireEnum(body.golden_coating, 'golden_coating', ['Bright', 'Dull']);

  return payload;
}

async function fetchBySerial(connection, serialNumber, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await connection.execute(
    `SELECT * FROM qc_logs WHERE serial_number = ?${suffix}`,
    [serialNumber]
  );
  return rows[0] || null;
}

async function fetchAllRows() {
  const [rows] = await pool.execute('SELECT * FROM qc_logs ORDER BY timestamp DESC, id DESC');
  return rows.map(pickRow);
}

function buildInsertStatement(payload) {
  const columns = ALL_COLUMNS.join(', ');
  const placeholders = ALL_COLUMNS.map(() => '?').join(', ');
  const values = ALL_COLUMNS.map((column) => payload[column]);
  return { columns, placeholders, values };
}

function buildUpdateStatement(payload) {
  const assignments = ALL_COLUMNS.map((column) => `${column} = ?`).join(', ');
  const values = ALL_COLUMNS.map((column) => payload[column]);
  return { assignments, values };
}

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/log', async (req, res, next) => {
  try {
    const payload = validatePayload(req.body);

    const row = await withTransaction(async (connection) => {
      const existing = await fetchBySerial(connection, payload.serial_number, true);
      if (existing) {
        throw new HttpError(409, 'Serial number already exists');
      }

      const { columns, placeholders, values } = buildInsertStatement(payload);
      const [result] = await connection.execute(
        `INSERT INTO qc_logs (${columns}) VALUES (${placeholders})`,
        values
      );

      const [rows] = await connection.execute('SELECT * FROM qc_logs WHERE id = ?', [result.insertId]);
      return rows[0];
    });

    res.status(201).json({ row: pickRow(row) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/logs', async (_req, res, next) => {
  try {
    const rows = await fetchAllRows();
    res.json({ rows, count: rows.length });
  } catch (error) {
    next(error);
  }
});

app.get('/api/log/:serial', async (req, res, next) => {
  try {
    const serial = String(req.params.serial || '').trim();
    if (!/^\d{7}$/.test(serial)) throw new HttpError(400, 'serial must be exactly 7 digits');

    const row = await fetchBySerial(pool, serial, false);
    if (!row) throw new HttpError(404, 'Serial not found');

    res.json({ row: pickRow(row) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/log/:serial', async (req, res, next) => {
  try {
    const serial = String(req.params.serial || '').trim();
    if (!/^\d{7}$/.test(serial)) throw new HttpError(400, 'serial must be exactly 7 digits');
    const payload = validatePayload(req.body, serial);

    const row = await withTransaction(async (connection) => {
      const existing = await fetchBySerial(connection, serial, true);
      if (!existing) throw new HttpError(404, 'Serial not found');

      const { assignments, values } = buildUpdateStatement(payload);
      await connection.execute(
        `UPDATE qc_logs SET ${assignments} WHERE serial_number = ?`,
        [...values, serial]
      );

      const [rows] = await connection.execute('SELECT * FROM qc_logs WHERE serial_number = ?', [serial]);
      return rows[0];
    });

    res.json({ row: pickRow(row) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/log/:serial', async (req, res, next) => {
  try {
    const serial = String(req.params.serial || '').trim();
    if (!/^\d{7}$/.test(serial)) throw new HttpError(400, 'serial must be exactly 7 digits');

    await withTransaction(async (connection) => {
      const existing = await fetchBySerial(connection, serial, true);
      if (!existing) throw new HttpError(404, 'Serial not found');
      await connection.execute('DELETE FROM qc_logs WHERE serial_number = ?', [serial]);
    });

    res.json({ deleted: true, serial_number: serial });
  } catch (error) {
    next(error);
  }
});

app.get('/api/export', async (_req, res, next) => {
  try {
    const rows = await fetchAllRows();
    res.json({ rows, count: rows.length, exported_at: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  const message = status >= 500 ? 'Internal server error' : error.message;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    message,
    ...(error.details ? { details: error.details } : {}),
  });
});

app.listen(PORT, () => {
  console.log(`QC API listening on port ${PORT}`);
});

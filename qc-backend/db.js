require('dotenv').config();

const mysql = require('mysql2/promise');

/*
 * SSL handling
 * ------------
 * Hosted MySQL (TiDB Cloud, PlanetScale, Railway, Aiven...) needs TLS, but a
 * plain local MySQL usually doesn't support it at all — forcing `ssl` there
 * makes every connection fail with "Server does not support secure connection".
 *
 *   DB_SSL=true   -> always use TLS
 *   DB_SSL=false  -> never use TLS
 *   (unset)       -> TLS when DATABASE_URL is used, plain otherwise
 */
function resolveSsl() {
  const flag = String(process.env.DB_SSL || '').trim().toLowerCase();
  const useSsl = flag ? ['1', 'true', 'yes', 'on'].includes(flag) : Boolean(process.env.DATABASE_URL);
  if (!useSsl) return undefined;
  const strict = ['1', 'true', 'yes', 'on'].includes(String(process.env.DB_SSL_STRICT || '').trim().toLowerCase());
  return { rejectUnauthorized: strict, minVersion: 'TLSv1.2' };
}

const common = {
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: false,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 20000,
  ssl: resolveSsl(),
};

function createPool() {
  if (process.env.DATABASE_URL) {
    return mysql.createPool({ uri: process.env.DATABASE_URL, ...common });
  }
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'qc_terminal',
    ...common,
  });
}

const pool = createPool();

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    connection.release();
  }
}

/*
 * Creates the table on first boot and adds any columns that older
 * deployments are missing (e.g. qm_status, which the API always wrote
 * but the original schema.sql never created — every insert failed).
 */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS qc_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  serial_number CHAR(7) NOT NULL,
  batch_number CHAR(4) NOT NULL,
  uid_number CHAR(3) NOT NULL,
  timestamp DATETIME(3) NOT NULL,
  test_station VARCHAR(120) NOT NULL,
  is_retest TINYINT(1) NOT NULL DEFAULT 0,
  overall_status ENUM('PASS','FAIL') NOT NULL,
  qm_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  qm_remark TEXT NULL,
  qm_reviewed_by VARCHAR(64) NULL,
  qm_reviewed_at DATETIME(3) NULL,
  notes TEXT NULL,
  plug_socket ENUM('Pass','NotConfirmed') NOT NULL,
  plug_socket_remark TEXT NULL,
  seal ENUM('Pass','NotConfirmed') NOT NULL,
  seal_remark TEXT NULL,
  visual ENUM('Pass','NotConfirmed') NOT NULL,
  visual_remark TEXT NULL,
  insert_glue ENUM('Pass','NotConfirmed') NOT NULL,
  insert_glue_remark TEXT NULL,
  rotation ENUM('Pass','NotConfirmed') NOT NULL,
  rotation_remark TEXT NULL,
  labelling ENUM('Pass','NotConfirmed') NOT NULL,
  labelling_remark TEXT NULL,
  serial_number_check ENUM('Pass','NotConfirmed') NOT NULL,
  serial_number_check_remark TEXT NULL,
  resistance DECIMAL(5,2) NOT NULL,
  resistance_verified ENUM('Pass','Fail') NOT NULL,
  moulding ENUM('Cream','Brown Transparent') NOT NULL,
  golden_coating ENUM('Bright','Dull') NOT NULL,
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_qc_logs_serial_number (serial_number),
  KEY idx_qc_logs_timestamp (timestamp, id),
  KEY idx_qc_logs_station_timestamp (test_station, timestamp, id)
)`;

const MIGRATION_COLUMNS = [
  ['qm_status', "ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING'"],
  ['qm_remark', 'TEXT NULL'],
  ['qm_reviewed_by', 'VARCHAR(64) NULL'],
  ['qm_reviewed_at', 'DATETIME(3) NULL'],
  ['created_by', 'VARCHAR(64) NULL'],
  ['updated_by', 'VARCHAR(64) NULL'],
];

async function ensureSchema() {
  await pool.query(CREATE_TABLE_SQL);
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qc_logs'`
  );
  const existing = new Set(cols.map((c) => String(c.name || c.COLUMN_NAME).toLowerCase()));
  for (const [name, definition] of MIGRATION_COLUMNS) {
    if (!existing.has(name)) {
      await pool.query(`ALTER TABLE qc_logs ADD COLUMN ${name} ${definition}`);
      console.log(`[schema] added missing column qc_logs.${name}`);
    }
  }
}

module.exports = { pool, withTransaction, ensureSchema };

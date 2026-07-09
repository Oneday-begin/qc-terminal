require('dotenv').config();

const mysql = require('mysql2/promise');

function createPool() {
  if (process.env.DATABASE_URL) {
    return mysql.createPool({
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      queueLimit: 0,
      timezone: 'Z',
      // This line forces TiDB to use an encrypted connection
      ssl: {
        rejectUnauthorized: false
      }
    });
  }

  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    timezone: 'Z',
    // Fallback security rule
    ssl: {
      rejectUnauthorized: false
    }
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
    try {
      await connection.rollback();
    } catch (_rollbackError) {}
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  withTransaction,
};
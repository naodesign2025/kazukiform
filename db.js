const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      count INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      image_filename TEXT,
      message TEXT
    )
  `);

  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS ticket_price INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS live_title TEXT DEFAULT 'KAZUKI HORITSUGI SOLO LIVE チケット'
  `);

  await pool.query(`
    INSERT INTO settings (id, image_filename, message, ticket_price)
    VALUES (1, NULL, NULL, 0)
    ON CONFLICT (id) DO NOTHING
  `);
}

module.exports = { pool, initDB };

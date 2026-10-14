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
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS live_title TEXT DEFAULT 'ライブチケット'
  `);

  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS event_title TEXT
  `);

  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS event_date TEXT
  `);

  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS event_name TEXT
  `);

  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS image_data BYTEA
  `);

  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS image_mime TEXT
  `);

  await pool.query(`
    ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'
  `);

  await pool.query(`
    INSERT INTO settings (id, image_filename, message, ticket_price)
    VALUES (1, NULL, NULL, 0)
    ON CONFLICT (id) DO NOTHING
  `);

  // serial_number: お客さんに見せる整理番号（DBのidとは別に管理）
  await pool.query(`
    ALTER TABLE reservations ADD COLUMN IF NOT EXISTS serial_number INTEGER
  `);

  // シーケンスを作成（すでに存在する場合はスキップ）
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS reservation_serial_seq START 1
  `);

  // 既存レコードのうち serial_number が未設定(NULL)のものだけを id 順に採番
  // ROW_NUMBER は全レコードの id 順位で計算するため、何度実行しても同じ結果になる
  await pool.query(`
    UPDATE reservations
    SET serial_number = sub.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
      FROM reservations
    ) sub
    WHERE reservations.id = sub.id
    AND reservations.serial_number IS NULL
  `);

  // シーケンスを現在の最大値に合わせる
  // 空テーブル時は setval(seq, 1, false) → 次の nextval() が 1 を返す
  // レコードあり(最大値=N)のときは setval(seq, N, true) → 次の nextval() が N+1 を返す
  await pool.query(`
    SELECT setval(
      'reservation_serial_seq',
      CASE WHEN MAX(serial_number) IS NULL THEN 1 ELSE MAX(serial_number) END,
      MAX(serial_number) IS NOT NULL
    )
    FROM reservations
  `);

  // 新規 INSERT 時にシーケンスから自動採番されるよう DEFAULT を設定
  await pool.query(`
    ALTER TABLE reservations
    ALTER COLUMN serial_number SET DEFAULT nextval('reservation_serial_seq')
  `);
}

module.exports = { pool, initDB };

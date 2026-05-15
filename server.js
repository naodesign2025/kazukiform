require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const { pool, initDB } = require('./db');

const storage = multer.diskStorage({
  destination: 'public/uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `admin-image-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/images', express.static('images'));

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: parseInt(process.env.MAIL_PORT),
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function getSettings() {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
  return rows[0] || null;
}

// 予約フォーム
app.get('/', (req, res) => {
  res.render('index');
});

// 予約送信
app.post('/reserve', async (req, res) => {
  const { name, count } = req.body;
  const parsedCount = parseInt(count);

  if (!name || !parsedCount || parsedCount < 1) {
    return res.render('index', { error: '名前と人数を正しく入力してください。' });
  }

  const { rows } = await pool.query(
    'INSERT INTO reservations (name, count) VALUES ($1, $2) RETURNING id',
    [name.trim(), parsedCount]
  );
  const reservationId = rows[0].id;

  // メール通知
  try {
    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: '【ライブ予約】新しい予約が届きました',
      text: `新しい予約が届きました。\n\nお名前：${name}\n人数：${parsedCount}名\n整理番号：${reservationId}番\n`,
    });
  } catch (err) {
    console.error('メール送信エラー:', err.message);
  }

  const settings = await getSettings();
  res.render('thanks', { name: name.trim(), count: parsedCount, number: reservationId, settings });
});

// お礼ページ（直接アクセスはフォームへリダイレクト）
app.get('/thanks', (req, res) => {
  res.redirect('/');
});

// 管理者ページ
app.get('/admin', async (req, res) => {
  const { rows: reservations } = await pool.query('SELECT * FROM reservations ORDER BY created_at DESC');
  const total = reservations.reduce((sum, r) => sum + r.count, 0);
  const settings = await getSettings();
  res.render('admin', { reservations, total, settings });
});

// 管理者設定保存
app.post('/admin/settings', upload.single('image'), async (req, res) => {
  const message = req.body.message || null;
  if (req.file) {
    await pool.query(
      'UPDATE settings SET image_filename = $1, message = $2 WHERE id = 1',
      [req.file.filename, message]
    );
  } else {
    await pool.query('UPDATE settings SET message = $1 WHERE id = 1', [message]);
  }
  res.redirect('/admin');
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`サーバー起動中: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB初期化エラー:', err);
    process.exit(1);
  });

require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');

const STRIPE_MODE = process.env.STRIPE_MODE === 'live' ? 'live' : 'test';
const stripeSecretKey = STRIPE_MODE === 'live'
  ? process.env.STRIPE_SECRET_KEY_LIVE
  : process.env.STRIPE_SECRET_KEY_TEST;
const stripeWebhookSecret = STRIPE_MODE === 'live'
  ? process.env.STRIPE_WEBHOOK_SECRET_LIVE
  : process.env.STRIPE_WEBHOOK_SECRET_TEST;

console.log(`[Stripe] mode: ${STRIPE_MODE}`);

const stripe = require('stripe')(stripeSecretKey);
const { pool, initDB } = require('./db');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
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
  const { rows } = await pool.query(
    'SELECT id, image_filename, message, ticket_price, live_title, image_mime, (image_data IS NOT NULL) AS has_image FROM settings WHERE id = 1'
  );
  return rows[0] || null;
}

// Stripe Webhook
// express.raw() をルート固有で使用し、署名検証に必要な生のボディを取得する
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, stripeWebhookSecret);
  } catch (err) {
    console.error('Webhook署名エラー:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const reservationId = session.metadata && session.metadata.reservation_id;
    if (reservationId) {
      await pool.query(
        'UPDATE reservations SET payment_status = $1 WHERE id = $2',
        ['paid', parseInt(reservationId)]
      );
    }
  }

  res.json({ received: true });
});

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

  // メール通知（MAIL_HOST 未設定時はスキップ）
  if (process.env.MAIL_HOST) {
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
  }

  const settings = await getSettings();
  const ticketPrice = settings && settings.ticket_price ? settings.ticket_price : 0;

  // Stripe Checkout（チケット料金が設定されている場合）
  if (ticketPrice > 0 && stripeSecretKey) {
    const baseUrl = process.env.BASE_URL;
    const successUrl = `${baseUrl}/thanks?name=${encodeURIComponent(name.trim())}&count=${parsedCount}&number=${reservationId}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/cancel`;

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: 'jpy',
            product_data: {
              name: settings.live_title || 'KAZUKI HORITSUGI SOLO LIVE チケット',
            },
            unit_amount: ticketPrice,
          },
          quantity: parsedCount,
        }],
        mode: 'payment',
        managed_payments: { enabled: false },
        payment_method_options: {
          konbini: {
            expires_after_days: 3,
          },
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          reservation_id: String(reservationId),
          name: name.trim(),
          count: String(parsedCount),
        },
      });
    } catch (err) {
      console.error('Stripe Checkoutエラー:', err.message);
      return res.render('index', { error: '決済処理でエラーが発生しました。しばらくしてから再度お試しください。' });
    }

    return res.redirect(303, session.url);
  }

  // チケット料金未設定の場合はそのままthanksへ
  res.render('thanks', { name: name.trim(), count: parsedCount, number: reservationId, settings });
});

// お礼ページ（Stripe決済完了後のリダイレクト先）
app.get('/thanks', async (req, res) => {
  const { name, count, number } = req.query;
  if (!name || !count || !number) {
    return res.redirect('/');
  }
  const settings = await getSettings();
  res.render('thanks', {
    name: decodeURIComponent(name),
    count: parseInt(count),
    number: parseInt(number),
    settings,
  });
});

// 決済キャンセル
app.get('/cancel', (req, res) => {
  res.render('index', { error: '決済がキャンセルされました。もう一度お試しください。' });
});

// 予約削除
app.post('/admin/reservations/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
  res.redirect('/admin');
});

// 設定画像の配信
app.get('/admin/image', async (req, res) => {
  const { rows } = await pool.query('SELECT image_data, image_mime FROM settings WHERE id = 1');
  const row = rows[0];
  if (!row || !row.image_data) {
    return res.status(404).end();
  }
  res.set('Content-Type', row.image_mime || 'image/jpeg');
  res.send(row.image_data);
});

// 管理者ページ
app.get('/admin', async (req, res) => {
  const { rows: reservations } = await pool.query('SELECT * FROM reservations ORDER BY created_at DESC');
  const total = reservations.reduce((sum, r) => sum + r.count, 0);
  const settings = await getSettings();
  const error = req.query.error || null;
  res.render('admin', { reservations, total, settings, error });
});

// 管理者設定保存
app.post('/admin/settings', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.redirect('/admin?error=' + encodeURIComponent('画像サイズが大きすぎます。2MB以下の画像を選択してください。'));
    }
    if (err) {
      return res.redirect('/admin?error=' + encodeURIComponent('画像のアップロードに失敗しました。'));
    }

    const message = req.body.message || null;
    const ticketPrice = parseInt(req.body.ticket_price) || 0;
    const liveTitle = req.body.live_title || 'KAZUKI HORITSUGI SOLO LIVE チケット';

    if (req.file) {
      await pool.query(
        'UPDATE settings SET image_data = $1, image_mime = $2, message = $3, ticket_price = $4, live_title = $5 WHERE id = 1',
        [req.file.buffer, req.file.mimetype, message, ticketPrice, liveTitle]
      );
    } else {
      await pool.query(
        'UPDATE settings SET message = $1, ticket_price = $2, live_title = $3 WHERE id = 1',
        [message, ticketPrice, liveTitle]
      );
    }
    res.redirect('/admin');
  });
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

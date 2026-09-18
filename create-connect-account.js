// 一時スクリプト: Stripe Connectアカウント作成 & オンボーディングリンク発行
// 使用方法: node create-connect-account.js <email>
// 本番運用後は削除してよい

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const email = process.argv[2];

if (!email) {
  console.error('使用方法: node create-connect-account.js <email>');
  process.exit(1);
}

const BASE_URL = 'https://daikiokadayoyakuform.onrender.com/admin';

(async () => {
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'JP',
    email,
  });

  const link = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: BASE_URL,
    return_url: BASE_URL,
    type: 'account_onboarding',
  });

  console.log('アカウントID :', account.id);
  console.log('オンボーディングURL:', link.url);
})();

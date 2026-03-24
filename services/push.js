const webpush = require('web-push');
const User = require('../models/User');

function initPush() {
  webpush.setVapidDetails(
    'mailto:admin@mime.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function sendNotification(user, title, body, url = '/') {
  if (!user.pushSubscriptions || user.pushSubscriptions.length === 0) return;
  const payload = JSON.stringify({ title, body, url });
  const promises = user.pushSubscriptions.map(sub =>
    webpush.sendNotification(sub, payload).catch(err => console.error('Push error:', err))
  );
  await Promise.allSettled(promises);
}

module.exports = { initPush, sendNotification };
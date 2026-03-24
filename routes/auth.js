const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('passport');
const User = require('../models/User');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const rateLimiter = require('../middleware/rateLimiter');

// Регистрация
router.post('/register', rateLimiter, async (req, res) => {
  try {
    const { username, password, displayName, publicKey } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username taken' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      displayName: displayName || username,
      passwordHash: hashedPassword,
      publicKey,
    });
    await user.save();
    res.json({ id: user._id, username, displayName: user.displayName, avatar: user.avatar });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Логин
router.post('/login', rateLimiter, async (req, res, next) => {
  try {
    const { username, password, token } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });
    if (user.twoFactorEnabled) {
      if (!token) return res.status(400).json({ error: '2FA token required' });
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token,
      });
      if (!verified) return res.status(400).json({ error: 'Invalid 2FA token' });
    }
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      res.json({ id: user._id, username, displayName: user.displayName, avatar: user.avatar });
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
  res.redirect('/?user=' + encodeURIComponent(JSON.stringify(req.user)));
});

// Настройка 2FA
router.post('/2fa/enable', require('../middleware/auth'), async (req, res) => {
  const secret = speakeasy.generateSecret({ length: 20, name: `MIME (${req.user.username})` });
  await User.findByIdAndUpdate(req.user.id, { twoFactorSecret: secret.base32, twoFactorEnabled: true });
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ qrCodeUrl, secret: secret.base32 });
});

// Проверка 2FA
router.post('/2fa/verify', require('../middleware/auth'), async (req, res) => {
  const { token } = req.body;
  const user = await User.findById(req.user.id);
  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token,
  });
  if (!verified) return res.status(400).json({ error: 'Invalid token' });
  res.json({ success: true });
});

// Выход
router.post('/logout', (req, res) => {
  req.logout(() => {
    res.json({ success: true });
  });
});

module.exports = router;
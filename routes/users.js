const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

// Получить всех пользователей (кроме себя)
router.get('/', auth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.userId } }).select('-passwordHash -twoFactorSecret -pushSubscriptions');
  res.json(users);
});

// Получить информацию о пользователе
router.get('/:userId', auth, async (req, res) => {
  const user = await User.findById(req.params.userId).select('-passwordHash -twoFactorSecret -pushSubscriptions');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Обновить профиль
router.put('/me', auth, async (req, res) => {
  const { displayName, status, avatar } = req.body;
  const updates = {};
  if (displayName) updates.displayName = displayName;
  if (status !== undefined) updates.status = status;
  if (avatar) updates.avatar = avatar;
  const user = await User.findByIdAndUpdate(req.userId, updates, { new: true }).select('-passwordHash');
  res.json(user);
});

// Загрузить аватар
router.post('/me/avatar', auth, upload.single('avatar'), async (req, res) => {
  const user = await User.findByIdAndUpdate(req.userId, { avatar: req.file.path }, { new: true });
  res.json({ avatar: user.avatar });
});

// Сохранить публичный ключ (E2EE)
router.post('/keys', auth, async (req, res) => {
  const { publicKey } = req.body;
  await User.findByIdAndUpdate(req.userId, { publicKey });
  res.json({ success: true });
});

// Получить публичный ключ пользователя
router.get('/:userId/key', auth, async (req, res) => {
  const user = await User.findById(req.params.userId).select('publicKey');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ publicKey: user.publicKey });
});

module.exports = router;
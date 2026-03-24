const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');
const Group = require('../models/Group');
const admin = require('../middleware/admin');
const auth = require('../middleware/auth');

router.use(auth, admin);

// Получить всех пользователей
router.get('/users', async (req, res) => {
  const users = await User.find().select('-passwordHash');
  res.json(users);
});

// Заблокировать/разблокировать пользователя (удалить аккаунт)
router.delete('/users/:userId', async (req, res) => {
  await User.findByIdAndDelete(req.params.userId);
  // Также удалить все сообщения и чаты пользователя
  await Message.deleteMany({ from: req.params.userId });
  res.json({ success: true });
});

// Получить статистику
router.get('/stats', async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalMessages = await Message.countDocuments();
  const totalGroups = await Group.countDocuments();
  const onlineUsers = await User.countDocuments({ online: true });
  res.json({ totalUsers, totalMessages, totalGroups, onlineUsers });
});

module.exports = router;
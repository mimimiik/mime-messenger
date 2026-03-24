const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Получить историю чата с пользователем
router.get('/chat/:userId', auth, async (req, res) => {
  const userId = req.userId;
  const otherUserId = req.params.userId;
  let chat = await Chat.findOne({
    participants: { $all: [userId, otherUserId] },
    type: 'private'
  });
  if (!chat) {
    chat = new Chat({ participants: [userId, otherUserId], type: 'private' });
    await chat.save();
  }
  const messages = await Message.find({ chatId: chat._id }).sort('timestamp');
  res.json(messages);
});

// Удалить сообщение (только для отправителя)
router.delete('/:messageId', auth, async (req, res) => {
  const message = await Message.findById(req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.from.toString() !== req.userId) return res.status(403).json({ error: 'Not your message' });
  await Message.findByIdAndUpdate(req.params.messageId, { deleted: true, text: 'Сообщение удалено' });
  res.json({ success: true });
});

// Отправить реакцию
router.post('/:messageId/react', auth, async (req, res) => {
  const { emoji } = req.body;
  const message = await Message.findById(req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const existing = message.reactions.find(r => r.userId.toString() === req.userId);
  if (existing) {
    existing.emoji = emoji;
  } else {
    message.reactions.push({ userId: req.userId, emoji });
  }
  await message.save();
  // Уведомляем через socket (реализовано в server.js)
  res.json({ success: true });
});

module.exports = router;
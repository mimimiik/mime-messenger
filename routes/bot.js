const express = require('express');
const router = express.Router();
const Bot = require('../models/Bot');
const User = require('../models/User');
const Message = require('../models/Message');
const auth = require('../middleware/auth');
const crypto = require('crypto');

// Создать бота (только premium пользователи)
router.post('/', auth, async (req, res) => {
  const { name } = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  const bot = new Bot({ name, token, owner: req.userId });
  // Создаём пользователя-бота
  const botUser = new User({
    username: name,
    displayName: name,
    role: 'bot'
  });
  await botUser.save();
  bot.userId = botUser._id;
  await bot.save();
  res.json({ token, botId: bot._id });
});

// Webhook для бота
router.post('/webhook/:token', async (req, res) => {
  const bot = await Bot.findOne({ token: req.params.token });
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  // Обработка входящего webhook (например, отправка сообщения)
  // Сохраняем в очередь или обрабатываем
  res.json({ ok: true });
});

// Отправить сообщение от имени бота (API)
router.post('/:token/sendMessage', async (req, res) => {
  const { chatId, text } = req.body;
  const bot = await Bot.findOne({ token: req.params.token });
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  // Найти чат или создать
  let chat = await Chat.findOne({ participants: { $all: [bot.userId, chatId] } });
  if (!chat) {
    chat = new Chat({ participants: [bot.userId, chatId], type: 'private' });
    await chat.save();
  }
  const message = new Message({ chatId: chat._id, from: bot.userId, text });
  await message.save();
  // Отправить через Socket
  const io = req.app.get('io');
  io.to(`user_${chatId}`).emit('new_message', message);
  res.json({ ok: true, message });
});

module.exports = router;
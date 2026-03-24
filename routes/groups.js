const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const Chat = require('../models/Chat');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Создать группу
router.post('/', auth, async (req, res) => {
  const { name, members } = req.body;
  const group = new Group({
    name,
    creator: req.userId,
    members: [req.userId, ...members],
    admins: [req.userId]
  });
  await group.save();
  const chat = new Chat({
    participants: group.members,
    type: 'group',
    groupId: group._id,
    name: group.name
  });
  await chat.save();
  res.json(group);
});

// Получить группы пользователя
router.get('/', auth, async (req, res) => {
  const groups = await Group.find({ members: req.userId });
  res.json(groups);
});

// Получить информацию о группе
router.get('/:groupId', auth, async (req, res) => {
  const group = await Group.findById(req.params.groupId).populate('members', 'username displayName avatar');
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json(group);
});

// Добавить участников
router.post('/:groupId/members', auth, async (req, res) => {
  const { userIds } = req.body;
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins.includes(req.userId)) return res.status(403).json({ error: 'Not an admin' });
  group.members.push(...userIds);
  await group.save();
  // Обновить чат
  await Chat.findOneAndUpdate({ groupId: group._id }, { $addToSet: { participants: { $each: userIds } } });
  res.json(group);
});

// Назначить админом
router.post('/:groupId/admins', auth, async (req, res) => {
  const { userId } = req.body;
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins.includes(req.userId)) return res.status(403).json({ error: 'Not an admin' });
  if (!group.admins.includes(userId)) group.admins.push(userId);
  await group.save();
  res.json(group);
});

module.exports = router;
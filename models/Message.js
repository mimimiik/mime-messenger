const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: { type: String },
  type: { type: String, default: 'text' }, // text, audio, video, file, encrypted
  fileUrl: { type: String },
  duration: { type: Number },
  edited: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  reactions: [{ userId: mongoose.Schema.Types.ObjectId, emoji: String }],
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  timestamp: { type: Date, default: Date.now }
});

MessageSchema.index({ chatId: 1, timestamp: -1 });
MessageSchema.index({ text: 'text' }); // для поиска

module.exports = mongoose.model('Message', MessageSchema);
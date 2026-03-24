const mongoose = require('mongoose');

const BotSchema = new mongoose.Schema({
  name: { type: String, required: true },
  token: { type: String, unique: true, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  webhook: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Bot', BotSchema);
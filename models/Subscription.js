const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  plan: { type: String, enum: ['free', 'premium'], default: 'free' },
  status: { type: String, enum: ['active', 'canceled', 'past_due'], default: 'active' },
  expiresAt: Date
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);
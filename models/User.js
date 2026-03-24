const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  displayName: { type: String, required: true },
  passwordHash: { type: String },
  googleId: { type: String },
  avatar: { type: String },
  status: { type: String, default: '' },
  online: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  publicKey: { type: String }, // для E2EE
  twoFactorSecret: { type: String },
  twoFactorEnabled: { type: Boolean, default: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  pushSubscriptions: [{ type: Object }],
  createdAt: { type: Date, default: Date.now }
});

UserSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
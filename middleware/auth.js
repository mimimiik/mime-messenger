const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  // Проверяем сессию Passport
  if (req.isAuthenticated()) {
    req.userId = req.user.id;
    return next();
  }
  // Проверяем JWT (для API ботов)
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user) {
        req.userId = user.id;
        req.user = user;
        return next();
      }
    } catch (err) {}
  }
  res.status(401).json({ error: 'Unauthorized' });
};
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const RedisStore = require('connect-redis').default;
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');

const { createClient } = require('redis');
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

// Импорт моделей
const User = require('./models/User');
const Message = require('./models/Message');
const Chat = require('./models/Chat');

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const groupRoutes = require('./routes/groups');
const adminRoutes = require('./routes/admin');
const botRoutes = require('./routes/bot');
const paymentRoutes = require('./routes/payments');

// Импорт сервисов
const { initCloudinary } = require('./services/cloudinary');
const { initPush } = require('./services/push');
const { initStripe } = require('./services/stripe');

// Инициализация приложения
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  adapter: require('socket.io-redis')({ pubClient: redisClient, subClient: redisClient.duplicate() })
});

// Middleware безопасности
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Сессии с Redis
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// Passport
require('./config/passport')(passport);
app.use(passport.initialize());
app.use(passport.session());

// i18n
i18next.use(Backend).use(middleware.LanguageDetector).init({
  fallbackLng: 'en',
  backend: { loadPath: './public/locales/{{lng}}.json' }
});
app.use(middleware.handle(i18next));

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'));

// Инициализация сервисов
initCloudinary();
initPush();
initStripe();

// Маршруты API
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/messages', messageRoutes);
app.use('/groups', groupRoutes);
app.use('/admin', adminRoutes);
app.use('/bot', botRoutes);
app.use('/payments', paymentRoutes);

// Swagger документация
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const options = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'MIME Messenger API', version: '2.0.0' },
  },
  apis: ['./routes/*.js'],
};
const specs = swaggerJsdoc(options);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Socket.IO логика
io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('user_online', async (userId) => {
    currentUserId = userId;
    socket.join(`user_${userId}`);
    await User.findByIdAndUpdate(userId, { online: true, lastSeen: new Date() });
    io.emit('user_status', { userId, online: true });
  });

  // Текстовое сообщение
  socket.on('send_message', async (data) => {
    const { from, to, text, replyTo } = data;
    if (!from || !to || !text) return;
    const chat = await Chat.findOne({ participants: { $all: [from, to] }, type: 'private' });
    if (!chat) return;
    const message = new Message({ chatId: chat._id, from, text, type: 'text', replyTo });
    await message.save();
    await Chat.findByIdAndUpdate(chat._id, { lastMessage: message._id, updatedAt: Date.now() });
    // Отправка получателю и отправителю
    io.to(`user_${to}`).emit('new_message', message);
    io.to(`user_${from}`).emit('new_message', message);
    // Push-уведомление
    const recipient = await User.findById(to);
    if (recipient.pushSubscriptions.length) {
      const pushService = require('./services/push');
      pushService.sendNotification(recipient, `Новое сообщение от ${from}`);
    }
  });

  // Групповое сообщение
  socket.on('send_group_message', async (data) => {
    const { groupId, from, text } = data;
    const group = await require('./models/Group').findById(groupId);
    if (!group) return;
    const chat = await Chat.findOne({ groupId: group._id, type: 'group' });
    const message = new Message({ chatId: chat._id, from, text });
    await message.save();
    group.members.forEach(memberId => {
      io.to(`user_${memberId}`).emit('new_message', message);
    });
  });

  // WebRTC сигналинг
  socket.on('call_user', (data) => {
    socket.to(`user_${data.to}`).emit('incoming_call', { from: data.from, offer: data.offer });
  });
  socket.on('answer_call', (data) => {
    socket.to(`user_${data.to}`).emit('call_answered', { answer: data.answer });
  });
  socket.on('ice_candidate', (data) => {
    socket.to(`user_${data.to}`).emit('ice_candidate', { candidate: data.candidate });
  });
  socket.on('end_call', (data) => {
    socket.to(`user_${data.to}`).emit('call_ended');
  });

  socket.on('disconnect', async () => {
    if (currentUserId) {
      await User.findByIdAndUpdate(currentUserId, { online: false, lastSeen: new Date() });
      io.emit('user_status', { userId: currentUserId, online: false });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`MIME Messenger running on port ${PORT}`));
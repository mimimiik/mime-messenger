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
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');

// Увеличиваем лимиты для больших файлов
const app = express();
app.use(express.json({ limit: '8gb' }));
app.use(express.urlencoded({ limit: '8gb', extended: true }));

// Безопасность
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(compression());

// Статика
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Сессии (простая память, без Redis)
app.use(session({
    secret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
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

// Подключение к MongoDB с обработкой ошибок
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mime';
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000
}).then(() => {
    console.log('✅ MongoDB connected');
}).catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Подключаем модели
const User = require('./models/User');
const Message = require('./models/Message');
const Chat = require('./models/Chat');

// Маршруты
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const groupRoutes = require('./routes/groups');
const adminRoutes = require('./routes/admin');
const botRoutes = require('./routes/bot');
const paymentRoutes = require('./routes/payments');

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/messages', messageRoutes);
app.use('/groups', groupRoutes);
app.use('/admin', adminRoutes);
app.use('/bot', botRoutes);
app.use('/payments', paymentRoutes);

// Swagger (опционально)
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

// HTTP сервер
const server = http.createServer(app);
server.timeout = 10 * 60 * 1000; // 10 минут для загрузки больших файлов

// Socket.IO
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
    console.log('New client connected');
    let currentUserId = null;

    socket.on('user_online', async (userId) => {
        currentUserId = userId;
        socket.join(`user_${userId}`);
        await User.findByIdAndUpdate(userId, { online: true, lastSeen: new Date() });
        io.emit('user_status', { userId, online: true });
    });

    socket.on('send_message', async (data) => {
        const { from, to, text, type = 'text' } = data;
        if (!from || !to || !text) return;
        const chat = await Chat.findOne({ participants: { $all: [from, to] }, type: 'private' });
        if (!chat) return;
        const message = new Message({ chatId: chat._id, from, text, type });
        await message.save();
        await Chat.findByIdAndUpdate(chat._id, { lastMessage: message._id, updatedAt: Date.now() });
        io.to(`user_${to}`).emit('new_message', message);
        io.to(`user_${from}`).emit('new_message', message);
    });

    socket.on('send_voice', async (data) => {
        const { from, to, audioBase64, duration } = data;
        const chat = await Chat.findOne({ participants: { $all: [from, to] }, type: 'private' });
        if (!chat) return;
        const message = new Message({ chatId: chat._id, from, text: audioBase64, type: 'audio', duration });
        await message.save();
        io.to(`user_${to}`).emit('new_message', message);
        io.to(`user_${from}`).emit('new_message', message);
    });

    socket.on('send_video_message', async (data) => {
        const { from, to, videoBase64, duration } = data;
        const chat = await Chat.findOne({ participants: { $all: [from, to] }, type: 'private' });
        if (!chat) return;
        const message = new Message({ chatId: chat._id, from, text: videoBase64, type: 'video_message', duration });
        await message.save();
        io.to(`user_${to}`).emit('new_message', message);
        io.to(`user_${from}`).emit('new_message', message);
    });

    socket.on('send_video_file', async (data) => {
        const { from, to, fileUrl, duration } = data;
        const chat = await Chat.findOne({ participants: { $all: [from, to] }, type: 'private' });
        if (!chat) return;
        const message = new Message({ chatId: chat._id, from, text: fileUrl, type: 'video', fileUrl, duration });
        await message.save();
        io.to(`user_${to}`).emit('new_message', message);
        io.to(`user_${from}`).emit('new_message', message);
    });

    // WebRTC signaling
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

// Загрузка файлов (Cloudinary)
const upload = require('./middleware/upload');
app.post('/upload/video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: req.file.path, duration: req.file.duration || 0 });
});

// Обработка необработанных ошибок
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 MIME Messenger running on port ${PORT}`);
});

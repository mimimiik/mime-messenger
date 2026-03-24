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
const path = require('path');

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const groupRoutes = require('./routes/groups');
const adminRoutes = require('./routes/admin');
const botRoutes = require('./routes/bot');
const paymentRoutes = require('./routes/payments');

// Импорт middleware
const upload = require('./middleware/upload');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Логирование ошибок
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '8gb' }));
app.use(express.urlencoded({ limit: '8gb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

// Сессии (без Redis для упрощения)
app.use(session({
    secret: process.env.JWT_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// Passport
require('./config/passport')(passport);
app.use(passport.initialize());
app.use(passport.session());

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mime', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Маршруты
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/messages', messageRoutes);
app.use('/groups', groupRoutes);
app.use('/admin', adminRoutes);
app.use('/bot', botRoutes);
app.use('/payments', paymentRoutes);

// Эндпоинт загрузки видео
app.post('/upload/video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: req.file.path, duration: req.file.duration || 0 });
});

// Socket.IO
io.on('connection', (socket) => {
    let currentUserId = null;

    socket.on('user_online', (userId) => {
        currentUserId = userId;
        socket.join(`user_${userId}`);
        // Обновление статуса в БД (опционально)
        console.log(`User ${userId} online`);
        io.emit('user_status', { userId, online: true });
    });

    socket.on('send_message', async (data) => {
        const { from, to, text, type } = data;
        if (!from || !to) return;
        // Сохранение в БД (упрощённо, без моделей для краткости)
        io.to(`user_${to}`).emit('new_message', { from, to, text, type, timestamp: Date.now() });
        io.to(`user_${from}`).emit('new_message', { from, to, text, type, timestamp: Date.now() });
    });

    socket.on('send_voice', (data) => {
        const { from, to, audioBase64, duration } = data;
        io.to(`user_${to}`).emit('new_message', {
            from, to, text: audioBase64, type: 'audio', duration, timestamp: Date.now()
        });
    });

    socket.on('send_video_message', (data) => {
        const { from, to, videoBase64, duration } = data;
        io.to(`user_${to}`).emit('new_message', {
            from, to, text: videoBase64, type: 'video_message', duration, timestamp: Date.now()
        });
    });

    socket.on('send_video_file', (data) => {
        const { from, to, fileUrl, duration } = data;
        io.to(`user_${to}`).emit('new_message', {
            from, to, text: fileUrl, type: 'video', fileUrl, duration, timestamp: Date.now()
        });
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

    socket.on('disconnect', () => {
        if (currentUserId) {
            console.log(`User ${currentUserId} offline`);
            io.emit('user_status', { userId: currentUserId, online: false });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`MIME Messenger running on port ${PORT}`));

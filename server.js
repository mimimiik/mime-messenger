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

// Обработка необработанных ошибок (чтобы видеть причину падения)
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware безопасности
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '8gb' }));
app.use(express.urlencoded({ limit: '8gb', extended: true }));
app.use(express.static('public'));

// Rate limiting (защита от спама)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Простая сессия (без Redis, чтобы не зависеть от внешнего сервиса)
app.use(session({
    secret: process.env.JWT_SECRET || 'mime-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(passport.initialize());
app.use(passport.session());

// Подключение к MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mime';
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Модели (схемы)
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    displayName: { type: String, required: true },
    passwordHash: { type: String },
    googleId: { type: String },
    avatar: { type: String },
    status: { type: String, default: '' },
    online: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    publicKey: { type: String },
    twoFactorSecret: { type: String },
    twoFactorEnabled: { type: Boolean, default: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    pushSubscriptions: [{ type: Object }],
    createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String },
    type: { type: String, default: 'text' },
    fileUrl: { type: String },
    duration: { type: Number },
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    reactions: [{ userId: mongoose.Schema.Types.ObjectId, emoji: String }],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    timestamp: { type: Date, default: Date.now }
});

const ChatSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    type: { type: String, enum: ['private', 'group'], default: 'private' },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    updatedAt: { type: Date, default: Date.now }
});

const GroupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    avatar: { type: String },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isChannel: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Chat = mongoose.model('Chat', ChatSchema);
const Group = mongoose.model('Group', GroupSchema);

// Простые обработчики для демонстрации
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// API эндпоинты
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 MIME Messenger running on port ${PORT}`);
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('New client connected');
    socket.on('disconnect', () => console.log('Client disconnected'));
});

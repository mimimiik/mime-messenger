const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' })); // для base64 медиа

// Настройка сессий (для OAuth)
app.use(session({
    secret: 'mime-secret-key-change-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // для локального теста; на Render с HTTPS можно true
}));
app.use(passport.initialize());
app.use(passport.session());

// Хранилище данных (в памяти)
let users = [];        // { id, username, displayName, passwordHash, googleId, avatar, status, online }
let messages = [];     // { id, from, to, text, type, timestamp, duration?, fileUrl? }
let nextUserId = 1;
let nextMsgId = 1;

// Вспомогательные функции
function getChatKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

function addMessage(from, to, text, type = 'text', extra = {}) {
    const msg = {
        id: nextMsgId++,
        from,
        to,
        text: type === 'text' ? text : (text || ''), // для аудио/видео храним base64
        type,
        timestamp: Date.now(),
        ...extra
    };
    messages.push(msg);
    return msg;
}

// Получить историю чата
function getChatMessages(user1, user2) {
    return messages.filter(m =>
        (m.from === user1 && m.to === user2) ||
        (m.from === user2 && m.to === user1)
    ).sort((a, b) => a.timestamp - b.timestamp);
}

// ---------- Passport Google OAuth ----------
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    const user = users.find(u => u.id === id);
    done(null, user);
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'your-google-client-id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'your-google-secret',
    callbackURL: "/auth/google/callback"
}, (accessToken, refreshToken, profile, done) => {
    let user = users.find(u => u.googleId === profile.id);
    if (!user) {
        const baseUsername = profile.displayName.replace(/\s/g, '_').toLowerCase();
        let username = baseUsername;
        let counter = 1;
        while (users.find(u => u.username === username)) {
            username = `${baseUsername}${counter++}`;
        }
        user = {
            id: nextUserId++,
            username: username,
            displayName: profile.displayName,
            passwordHash: null,
            googleId: profile.id,
            avatar: profile.photos?.[0]?.value || null,
            status: '',
            online: false
        };
        users.push(user);
    }
    return done(null, user);
}));

// Маршруты Google OAuth
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    (req, res) => {
        // Перенаправляем на главную с параметром user
        const user = req.user;
        const userData = encodeURIComponent(JSON.stringify({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatar: user.avatar,
            status: user.status
        }));
        res.redirect(`/?user=${userData}`);
    }
);

// ---------- API Endpoints ----------
// Регистрация
app.post('/register', async (req, res) => {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: nextUserId++,
        username,
        displayName: displayName || username,
        passwordHash: hashedPassword,
        googleId: null,
        avatar: null,
        status: '',
        online: false
    };
    users.push(newUser);
    res.json({ id: newUser.id, username: newUser.username, displayName: newUser.displayName, avatar: newUser.avatar });
});

// Логин
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'User not found' });
    if (!user.passwordHash) return res.status(400).json({ error: 'Use Google login' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });
    res.json({ id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar });
});

// Получить всех пользователей (кроме себя)
app.get('/users/:userId', (req, res) => {
    const currentUserId = parseInt(req.params.userId);
    const otherUsers = users.filter(u => u.id !== currentUserId).map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        status: u.status,
        online: u.online
    }));
    res.json(otherUsers);
});

// Получить историю чата с конкретным пользователем
app.get('/messages/:userId/:otherUserId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const otherUserId = parseInt(req.params.otherUserId);
    const history = getChatMessages(userId, otherUserId);
    res.json(history);
});

// Получить профиль пользователя
app.get('/user/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, status: user.status });
});

// Обновить профиль
app.post('/user/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const { displayName, avatar, status } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (displayName !== undefined) user.displayName = displayName;
    if (avatar !== undefined) user.avatar = avatar;
    if (status !== undefined) user.status = status;
    res.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, status: user.status } });
});

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
    let currentUserId = null;

    socket.on('user_online', (userId) => {
        currentUserId = userId;
        socket.join(`user_${userId}`);
        const user = users.find(u => u.id === userId);
        if (user) {
            user.online = true;
            io.emit('user_status', { userId, online: true });
        }
    });

    // Текстовое сообщение
    socket.on('send_message', (data) => {
        const { from, to, text } = data;
        if (!from || !to || !text) return;
        const msg = addMessage(from, to, text, 'text');
        io.emit('new_message', msg);
    });

    // Голосовое сообщение
    socket.on('send_voice', (data) => {
        const { from, to, audioBase64, duration } = data;
        const msg = addMessage(from, to, audioBase64, 'audio', { duration });
        io.emit('new_message', msg);
    });

    // Видеосообщение
    socket.on('send_video_message', (data) => {
        const { from, to, videoBase64, duration } = data;
        const msg = addMessage(from, to, videoBase64, 'video_message', { duration });
        io.emit('new_message', msg);
    });

    // WebRTC signalling
    socket.on('call_user', (data) => {
        socket.to(`user_${data.to}`).emit('incoming_call', {
            from: data.from,
            fromName: users.find(u => u.id === data.from)?.displayName,
            offer: data.offer
        });
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
            const user = users.find(u => u.id === currentUserId);
            if (user) {
                user.online = false;
                io.emit('user_status', { userId: currentUserId, online: false });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`MIME Messenger running on port ${PORT}`);
});
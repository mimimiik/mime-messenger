// Глобальные переменные
let socket;
let currentUser = null;
let currentChat = null; // { id, type, name, members, avatar }
let allChats = [];
let allGroups = [];
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let mediaStream = null;
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentTheme = 'dark';

// E2EE
let publicKey = null;
let privateKey = null;
let recipientPublicKeys = {};

// DOM элементы
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginTab = document.getElementById('login-tab');
const registerTab = document.getElementById('register-tab');
const loginError = document.getElementById('login-error');
const regError = document.getElementById('reg-error');
const currentUsernameSpan = document.getElementById('current-username');
const currentStatusSpan = document.getElementById('current-status');
const currentAvatarDiv = document.getElementById('current-avatar');
const logoutBtn = document.getElementById('logout-btn');
const editProfileBtn = document.getElementById('edit-profile-btn');
const chatListDiv = document.getElementById('chat-list');
const chatWithNameSpan = document.getElementById('chat-with-name');
const chatWithStatusSpan = document.getElementById('chat-with-status');
const chatAvatarDiv = document.getElementById('chat-avatar');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messageInputArea = document.getElementById('message-input-area');
const searchInput = document.getElementById('search-users');
const voiceBtn = document.getElementById('voice-btn');
const videoMsgBtn = document.getElementById('video-msg-btn');
const callBtn = document.getElementById('call-btn');
const profileModal = document.getElementById('profile-modal');
const callModal = document.getElementById('call-modal');
const endCallBtn = document.getElementById('end-call');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const chatsTab = document.getElementById('chats-tab');
const groupsTab = document.getElementById('groups-tab');
const groupModal = document.getElementById('group-modal');
const createGroupBtn = document.getElementById('create-group');

// -------------------- i18n --------------------
async function loadTranslations(lang) {
    const res = await fetch(`/locales/${lang}.json`);
    const translations = await res.json();
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) el.textContent = translations[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[key]) el.placeholder = translations[key];
    });
}
const userLang = navigator.language.split('-')[0] || 'en';
loadTranslations(userLang === 'ru' ? 'ru' : 'en');

// -------------------- Auth --------------------
loginTab.addEventListener('click', () => {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
});

registerTab.addEventListener('click', () => {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
});

// Регистрация
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    if (!username || !password) return;
    try {
        const res = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, displayName })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Registration successful! Please login.');
            loginTab.click();
            document.getElementById('login-username').value = username;
        } else {
            regError.textContent = data.error;
        }
    } catch (err) {
        regError.textContent = 'Connection error';
    }
});

// Логин
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) return;
    try {
        const res = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = data;
            localStorage.setItem('mime_user', JSON.stringify(currentUser));
            await initApp();
        } else {
            loginError.textContent = data.error;
        }
    } catch (err) {
        loginError.textContent = 'Connection error';
    }
});

// Google login
document.getElementById('google-login').addEventListener('click', () => {
    window.location.href = '/auth/google';
});

const urlParams = new URLSearchParams(window.location.search);
const userParam = urlParams.get('user');
if (userParam) {
    currentUser = JSON.parse(decodeURIComponent(userParam));
    localStorage.setItem('mime_user', JSON.stringify(currentUser));
    initApp();
    window.history.replaceState({}, document.title, '/');
}

// Выход
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('mime_user');
    if (socket) socket.disconnect();
    currentUser = null;
    authContainer.style.display = 'flex';
    appContainer.style.display = 'none';
});

// -------------------- Инициализация --------------------
async function initApp() {
    authContainer.style.display = 'none';
    appContainer.style.display = 'flex';
    updateProfileUI();
    await initPGP();
    await connectSocket();
    await loadChats();
    setupSocketListeners();
    await subscribeToPush();
    setupThemes();
}

function updateProfileUI() {
    currentUsernameSpan.textContent = currentUser.displayName || currentUser.username;
    currentStatusSpan.textContent = currentUser.status || '';
    if (currentUser.avatar) {
        currentAvatarDiv.style.backgroundImage = `url(${currentUser.avatar})`;
        currentAvatarDiv.style.backgroundSize = 'cover';
        currentAvatarDiv.textContent = '';
    } else {
        currentAvatarDiv.style.backgroundImage = '';
        currentAvatarDiv.textContent = currentUser.username[0].toUpperCase();
    }
}

// -------------------- Socket.IO --------------------
function connectSocket() {
    socket = io();
    socket.on('connect', () => {
        socket.emit('user_online', currentUser.id);
    });
}

// -------------------- Загрузка чатов --------------------
async function loadChats() {
    try {
        const res = await fetch(`/users/${currentUser.id}`);
        const users = await res.json();
        const groupsRes = await fetch('/groups');
        const groups = await groupsRes.json();
        allChats = users.map(u => ({ ...u, type: 'private' }));
        allGroups = groups;
        renderChatList('private');
    } catch (err) {
        console.error(err);
    }
}

function renderChatList(type) {
    const list = type === 'private' ? allChats : allGroups;
    chatListDiv.innerHTML = '';
    const searchTerm = searchInput.value.toLowerCase();
    const filtered = list.filter(item =>
        (item.displayName || item.name).toLowerCase().includes(searchTerm)
    );
    filtered.forEach(item => {
        const div = document.createElement('div');
        div.classList.add('chat-item');
        if (currentChat && currentChat.id === item.id && currentChat.type === type) {
            div.classList.add('active');
        }
        const name = item.displayName || item.name;
        const avatar = item.avatar || '';
        const status = item.status || (item.online ? 'online' : 'offline');
        div.innerHTML = `
            <div class="chat-avatar" style="background-image: url(${avatar}); background-size: cover;">
                ${!avatar ? name[0].toUpperCase() : ''}
            </div>
            <div class="chat-info">
                <div class="chat-name">${escapeHtml(name)}</div>
                <div class="chat-last-message">${status}</div>
            </div>
            ${item.online ? '<div class="online-dot"></div>' : ''}
        `;
        div.addEventListener('click', () => openChat(item, type));
        chatListDiv.appendChild(div);
    });
}

async function openChat(chat, type) {
    currentChat = { ...chat, type };
    chatWithNameSpan.textContent = chat.displayName || chat.name;
    chatWithStatusSpan.textContent = chat.status || (chat.online ? 'online' : 'offline');
    if (chat.avatar) {
        chatAvatarDiv.style.backgroundImage = `url(${chat.avatar})`;
        chatAvatarDiv.style.backgroundSize = 'cover';
        chatAvatarDiv.textContent = '';
    } else {
        chatAvatarDiv.style.backgroundImage = '';
        chatAvatarDiv.textContent = (chat.displayName || chat.name)[0].toUpperCase();
    }
    messageInputArea.style.display = 'flex';
    // Загружаем историю
    let url = type === 'private' ? `/messages/chat/${chat.id}` : `/messages/group/${chat.id}`;
    const res = await fetch(url);
    const messages = await res.json();
    renderMessages(messages);
    // Активное выделение
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const activeItem = Array.from(chatListDiv.children).find(
        el => el.querySelector('.chat-name').textContent === (chat.displayName || chat.name)
    );
    if (activeItem) activeItem.classList.add('active');
}

function renderMessages(messages) {
    messagesContainer.innerHTML = '';
    messages.forEach(msg => {
        const isOutgoing = msg.from === currentUser.id;
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', isOutgoing ? 'outgoing' : 'incoming');
        const time = new Date(msg.timestamp).toLocaleTimeString();
        let content = '';
        if (msg.type === 'text') {
            content = `<div>${escapeHtml(msg.text)}</div>`;
        } else if (msg.type === 'audio') {
            content = `<audio controls src="${msg.fileUrl || `data:audio/webm;base64,${msg.text}`}"></audio>`;
        } else if (msg.type === 'video_message') {
            content = `<video controls src="${msg.fileUrl || `data:video/webm;base64,${msg.text}`}" width="200"></video>`;
        } else if (msg.type === 'encrypted') {
            content = `<div><i>🔒 Encrypted message</i></div>`;
        }
        messageDiv.innerHTML = `${content}<div class="message-time">${time}</div>`;
        messagesContainer.appendChild(messageDiv);
    });
    scrollToBottom();
}

function addMessageToUI(msg) {
    const isOutgoing = msg.from === currentUser.id;
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', isOutgoing ? 'outgoing' : 'incoming');
    const time = new Date(msg.timestamp).toLocaleTimeString();
    let content = '';
    if (msg.type === 'text') {
        content = `<div>${escapeHtml(msg.text)}</div>`;
    } else if (msg.type === 'audio') {
        content = `<audio controls src="${msg.fileUrl || `data:audio/webm;base64,${msg.text}`}"></audio>`;
    } else if (msg.type === 'video_message') {
        content = `<video controls src="${msg.fileUrl || `data:video/webm;base64,${msg.text}`}" width="200"></video>`;
    } else if (msg.type === 'encrypted') {
        content = `<div><i>🔒 Encrypted message</i></div>`;
    }
    messageDiv.innerHTML = `${content}<div class="message-time">${time}</div>`;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// -------------------- Отправка сообщений --------------------
async function sendTextMessage() {
    if (!currentChat) return;
    const text = messageInput.value.trim();
    if (!text) return;
    let finalText = text;
    // E2EE для приватных чатов
    if (currentChat.type === 'private') {
        const recipientKey = await getRecipientPublicKey(currentChat.id);
        if (recipientKey) {
            finalText = await encryptMessage(text, recipientKey);
        }
    }
    const data = {
        from: currentUser.id,
        to: currentChat.id,
        text: finalText,
        type: currentChat.type === 'private' && recipientPublicKeys[currentChat.id] ? 'encrypted' : 'text'
    };
    socket.emit('send_message', data);
    messageInput.value = '';
    // Оптимистичное добавление
    addMessageToUI({ ...data, timestamp: Date.now(), type: 'text', text });
}

sendBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
});

// -------------------- Голосовые/видео сообщения --------------------
async function startRecording(type) {
    if (!currentChat) return;
    try {
        const constraints = type === 'audio' ? { audio: true } : { audio: true, video: true };
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        mediaRecorder = new MediaRecorder(mediaStream);
        recordedChunks = [];
        mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: type === 'audio' ? 'audio/webm' : 'video/webm' });
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                const event = type === 'audio' ? 'send_voice' : 'send_video_message';
                socket.emit(event, {
                    from: currentUser.id,
                    to: currentChat.id,
                    [type === 'audio' ? 'audioBase64' : 'videoBase64']: base64,
                    duration: 0
                });
                if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
            };
            reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        isRecording = true;
        if (type === 'audio') voiceBtn.style.backgroundColor = 'red';
        else videoMsgBtn.style.backgroundColor = 'red';
        setTimeout(() => { if (isRecording) mediaRecorder.stop(); }, 60000);
    } catch (err) {
        console.error(err);
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        voiceBtn.style.backgroundColor = '';
        videoMsgBtn.style.backgroundColor = '';
    }
}
voiceBtn.addEventListener('mousedown', () => startRecording('audio'));
voiceBtn.addEventListener('mouseup', stopRecording);
videoMsgBtn.addEventListener('mousedown', () => startRecording('video'));
videoMsgBtn.addEventListener('mouseup', stopRecording);

// -------------------- E2EE --------------------
async function initPGP() {
    const storedPrivate = localStorage.getItem('pgp_private');
    if (storedPrivate) {
        try {
            privateKey = await openpgp.decryptKey({
                privateKey: await openpgp.readPrivateKey({ armoredKey: storedPrivate }),
                passphrase: currentUser.id
            });
        } catch (e) { console.error('Failed to decrypt private key', e); }
    } else {
        const { privateKey: priv, publicKey: pub } = await openpgp.generateKey({
            userIds: [{ name: currentUser.username }],
            curve: 'ed25519'
        });
        privateKey = priv;
        publicKey = pub;
        localStorage.setItem('pgp_private', priv.armor());
        await fetch('/users/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: pub.armor() })
        });
    }
}

async function getRecipientPublicKey(userId) {
    if (recipientPublicKeys[userId]) return recipientPublicKeys[userId];
    const res = await fetch(`/users/${userId}/key`);
    const data = await res.json();
    if (data.publicKey) {
        recipientPublicKeys[userId] = data.publicKey;
        return data.publicKey;
    }
    return null;
}

async function encryptMessage(text, recipientKeyArmored) {
    const recipientKey = await openpgp.readKey({ armoredKey: recipientKeyArmored });
    const encrypted = await openpgp.encrypt({
        message: await openpgp.createMessage({ text }),
        encryptionKeys: recipientKey,
        signingKeys: privateKey
    });
    return encrypted;
}

async function decryptMessage(encryptedText, senderId) {
    const senderKeyArmored = await getRecipientPublicKey(senderId);
    if (!senderKeyArmored) return encryptedText;
    const senderKey = await openpgp.readKey({ armoredKey: senderKeyArmored });
    const message = await openpgp.readMessage({ armoredMessage: encryptedText });
    const { data } = await openpgp.decrypt({
        message,
        decryptionKeys: privateKey,
        verificationKeys: senderKey
    });
    return data;
}

// -------------------- Push-уведомления --------------------
async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.VAPID_PUBLIC_KEY
    });
    await fetch('/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
    });
}

// -------------------- Видеозвонки --------------------
async function startCall() {
    if (!currentChat) return;
    callModal.style.display = 'flex';
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localVideo.srcObject = localStream;
        peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peerConnection.onicecandidate = event => {
            if (event.candidate) socket.emit('ice_candidate', { to: currentChat.id, candidate: event.candidate });
        };
        peerConnection.ontrack = event => {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
        };
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call_user', { to: currentChat.id, offer });
    } catch (err) {
        console.error(err);
        endCall();
    }
}

function endCall() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (peerConnection) peerConnection.close();
    callModal.style.display = 'none';
    socket.emit('end_call', { to: currentChat?.id });
}
endCallBtn.addEventListener('click', endCall);
callBtn.addEventListener('click', startCall);

// -------------------- Группы --------------------
chatsTab.addEventListener('click', () => {
    chatsTab.classList.add('active');
    groupsTab.classList.remove('active');
    renderChatList('private');
});
groupsTab.addEventListener('click', () => {
    groupsTab.classList.add('active');
    chatsTab.classList.remove('active');
    renderChatList('group');
});
document.getElementById('create-group-btn')?.addEventListener('click', () => {
    // Заполняем селект пользователями
    const select = document.getElementById('group-members');
    select.innerHTML = '';
    allChats.forEach(u => {
        const option = document.createElement('option');
        option.value = u.id;
        option.textContent = u.displayName;
        select.appendChild(option);
    });
    groupModal.style.display = 'flex';
});
createGroupBtn.addEventListener('click', async () => {
    const name = document.getElementById('group-name').value;
    const members = Array.from(document.getElementById('group-members').selectedOptions).map(opt => opt.value);
    const res = await fetch('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, members })
    });
    if (res.ok) {
        groupModal.style.display = 'none';
        await loadChats();
        groupsTab.click();
    }
});

// -------------------- Профиль --------------------
editProfileBtn.addEventListener('click', async () => {
    const res = await fetch(`/users/${currentUser.id}`);
    const user = await res.json();
    document.getElementById('edit-displayname').value = user.displayName;
    document.getElementById('edit-status').value = user.status || '';
    document.getElementById('edit-avatar').value = user.avatar || '';
    profileModal.style.display = 'flex';
});
document.querySelector('#profile-modal .close').addEventListener('click', () => {
    profileModal.style.display = 'none';
});
document.getElementById('save-profile').addEventListener('click', async () => {
    const displayName = document.getElementById('edit-displayname').value;
    const status = document.getElementById('edit-status').value;
    const avatar = document.getElementById('edit-avatar').value;
    const res = await fetch('/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, status, avatar })
    });
    if (res.ok) {
        const updated = await res.json();
        currentUser.displayName = updated.displayName;
        currentUser.status = updated.status;
        currentUser.avatar = updated.avatar;
        localStorage.setItem('mime_user', JSON.stringify(currentUser));
        updateProfileUI();
        profileModal.style.display = 'none';
        await loadChats();
        if (currentChat) openChat(currentChat, currentChat.type);
    }
});

// -------------------- Темы --------------------
function setupThemes() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.className = savedTheme;
}
function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.className = currentTheme;
    localStorage.setItem('theme', currentTheme);
}
// Добавить кнопку переключения темы (можно добавить в интерфейс)

// -------------------- Socket обработчики --------------------
function setupSocketListeners() {
    socket.on('new_message', async (msg) => {
        if (currentChat && (msg.from === currentChat.id || msg.to === currentChat.id)) {
            if (msg.type === 'encrypted' && msg.from !== currentUser.id) {
                msg.text = await decryptMessage(msg.text, msg.from);
            }
            addMessageToUI(msg);
        }
        // Обновить список чатов (последнее сообщение)
        loadChats();
    });
    socket.on('user_status', ({ userId, online }) => {
        const user = allChats.find(c => c.id === userId);
        if (user) {
            user.online = online;
            if (currentChat && currentChat.id === userId) {
                chatWithStatusSpan.textContent = online ? 'online' : 'offline';
            }
            renderChatList(chatsTab.classList.contains('active') ? 'private' : 'group');
        }
    });
    socket.on('incoming_call', async (data) => {
        if (confirm(`Incoming call from ${data.fromName}. Accept?`)) {
            currentChat = allChats.find(c => c.id === data.from);
            await openChat(currentChat, 'private');
            startCall();
            // Ответить на звонок
            // ... (логика ответа в startCall уже есть, но нужно передать offer)
        }
    });
    socket.on('call_answered', (data) => {
        if (peerConnection) peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    });
    socket.on('ice_candidate', (data) => {
        if (peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    });
    socket.on('call_ended', () => {
        endCall();
        alert('Call ended by other party');
    });
}

// Поиск
searchInput.addEventListener('input', () => {
    const activeTab = chatsTab.classList.contains('active') ? 'private' : 'group';
    renderChatList(activeTab);
});

// -------------------- Запуск --------------------
const savedUser = localStorage.getItem('mime_user');
if (savedUser) {
    currentUser = JSON.parse(savedUser);
    initApp();
}
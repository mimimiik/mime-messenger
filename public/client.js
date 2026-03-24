// Глобальные переменные
let socket;
let currentUser = null;
let currentChatUser = null;
let allUsers = [];
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingType = null; // 'audio' or 'video'
let mediaStream = null;

// WebRTC
let peerConnection = null;
let localStream = null;
let remoteStream = null;
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

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

// -------------------- Auth --------------------
loginTab.addEventListener('click', () => {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    loginError.textContent = '';
    regError.textContent = '';
});

registerTab.addEventListener('click', () => {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    loginError.textContent = '';
    regError.textContent = '';
});

// Регистрация
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    if (!username || !password) {
        regError.textContent = 'Заполните все поля';
        return;
    }
    try {
        const res = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, displayName })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Регистрация успешна! Теперь войдите.');
            loginTab.click();
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').value = '';
        } else {
            regError.textContent = data.error || 'Ошибка регистрации';
        }
    } catch (err) {
        regError.textContent = 'Ошибка соединения';
    }
});

// Логин
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) {
        loginError.textContent = 'Заполните все поля';
        return;
    }
    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = {
                id: data.id,
                username: data.username,
                displayName: data.displayName,
                avatar: data.avatar,
                status: ''
            };
            localStorage.setItem('mime_user', JSON.stringify(currentUser));
            initApp();
        } else {
            loginError.textContent = data.error || 'Ошибка входа';
        }
    } catch (err) {
        loginError.textContent = 'Ошибка соединения';
    }
});

// Google авторизация
document.getElementById('google-login').addEventListener('click', () => {
    window.location.href = '/auth/google';
});

// Проверка параметра user после Google OAuth
const urlParams = new URLSearchParams(window.location.search);
const userParam = urlParams.get('user');
if (userParam) {
    const user = JSON.parse(decodeURIComponent(userParam));
    currentUser = user;
    localStorage.setItem('mime_user', JSON.stringify(currentUser));
    initApp();
    window.history.replaceState({}, document.title, '/');
}

// Выход
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('mime_user');
    if (socket) socket.disconnect();
    currentUser = null;
    currentChatUser = null;
    authContainer.style.display = 'flex';
    appContainer.style.display = 'none';
    chatListDiv.innerHTML = '';
    messagesContainer.innerHTML = '';
    messageInputArea.style.display = 'none';
});

// -------------------- Инициализация приложения --------------------
async function initApp() {
    authContainer.style.display = 'none';
    appContainer.style.display = 'flex';
    updateProfileUI();
    // Подключаемся к сокету
    socket = io();
    socket.on('connect', () => {
        socket.emit('user_online', currentUser.id);
    });
    await loadUsers();
    await loadChats(); // загружаем список диалогов (всех пользователей)
    setupSocketListeners();
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

// Загрузка всех пользователей (кроме себя)
async function loadUsers() {
    try {
        const res = await fetch(`/users/${currentUser.id}`);
        allUsers = await res.json();
        renderChatList();
    } catch (err) {
        console.error('Ошибка загрузки пользователей', err);
    }
}

// Рендеринг списка чатов
function renderChatList() {
    chatListDiv.innerHTML = '';
    const searchTerm = searchInput.value.toLowerCase();
    const filteredUsers = allUsers.filter(u =>
        u.displayName.toLowerCase().includes(searchTerm) ||
        u.username.toLowerCase().includes(searchTerm)
    );
    filteredUsers.forEach(user => {
        const chatItem = document.createElement('div');
        chatItem.classList.add('chat-item');
        if (currentChatUser && currentChatUser.id === user.id) {
            chatItem.classList.add('active');
        }
        const lastMsg = getLastMessageWithUser(user.id);
        chatItem.innerHTML = `
            <div class="chat-avatar" style="background-image: url(${user.avatar || ''}); background-size: cover;">
                ${!user.avatar ? user.displayName[0].toUpperCase() : ''}
            </div>
            <div class="chat-info">
                <div class="chat-name">${escapeHtml(user.displayName)}</div>
                <div class="chat-last-message">${lastMsg ? truncate(lastMsg.text, 30) : (user.status || 'на связи')}</div>
            </div>
            ${user.online ? '<div class="online-dot"></div>' : ''}
        `;
        chatItem.addEventListener('click', () => openChat(user));
        chatListDiv.appendChild(chatItem);
    });
}

function getLastMessageWithUser(userId) {
    // Простой поиск последнего сообщения с этим пользователем
    const chatMessages = allMessagesCache?.[userId] || [];
    if (chatMessages.length === 0) return null;
    return chatMessages[chatMessages.length - 1];
}

let allMessagesCache = {}; // кэш сообщений по userId

// Открыть чат
async function openChat(user) {
    currentChatUser = user;
    chatWithNameSpan.textContent = user.displayName;
    chatWithStatusSpan.textContent = user.status || '';
    if (user.avatar) {
        chatAvatarDiv.style.backgroundImage = `url(${user.avatar})`;
        chatAvatarDiv.style.backgroundSize = 'cover';
        chatAvatarDiv.textContent = '';
    } else {
        chatAvatarDiv.style.backgroundImage = '';
        chatAvatarDiv.textContent = user.displayName[0].toUpperCase();
    }
    messageInputArea.style.display = 'flex';
    // Загружаем историю
    try {
        const res = await fetch(`/messages/${currentUser.id}/${user.id}`);
        const messages = await res.json();
        allMessagesCache[user.id] = messages;
        renderMessages(messages);
    } catch (err) {
        console.error('Ошибка загрузки сообщений', err);
    }
    // Активное выделение
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    const activeItem = Array.from(chatListDiv.children).find(
        item => item.querySelector('.chat-name').textContent === user.displayName
    );
    if (activeItem) activeItem.classList.add('active');
}

function renderMessages(messages) {
    messagesContainer.innerHTML = '';
    messages.forEach(msg => {
        const isOutgoing = msg.from === currentUser.id;
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', isOutgoing ? 'outgoing' : 'incoming');
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let content = '';
        if (msg.type === 'text') {
            content = `<div>${escapeHtml(msg.text)}</div>`;
        } else if (msg.type === 'audio') {
            content = `<audio controls src="data:audio/webm;base64,${msg.text}"></audio>`;
        } else if (msg.type === 'video_message') {
            content = `<video controls src="data:video/webm;base64,${msg.text}" width="200"></video>`;
        }

        messageDiv.innerHTML = `
            ${content}
            <div class="message-time">${time}</div>
        `;
        messagesContainer.appendChild(messageDiv);
    });
    scrollToBottom();
}

function addMessageToUI(msg, isOutgoing) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', isOutgoing ? 'outgoing' : 'incoming');
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let content = '';
    if (msg.type === 'text') {
        content = `<div>${escapeHtml(msg.text)}</div>`;
    } else if (msg.type === 'audio') {
        content = `<audio controls src="data:audio/webm;base64,${msg.text}"></audio>`;
    } else if (msg.type === 'video_message') {
        content = `<video controls src="data:video/webm;base64,${msg.text}" width="200"></video>`;
    }
    messageDiv.innerHTML = `
        ${content}
        <div class="message-time">${time}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
    // Обновляем последнее сообщение в списке чатов
    const otherUserId = isOutgoing ? msg.to : msg.from;
    const chatItem = Array.from(chatListDiv.children).find(item => {
        const nameElem = item.querySelector('.chat-name');
        if (!nameElem) return false;
        const user = allUsers.find(u => u.displayName === nameElem.textContent);
        return user && user.id === otherUserId;
    });
    if (chatItem) {
        const lastMsgSpan = chatItem.querySelector('.chat-last-message');
        if (lastMsgSpan) lastMsgSpan.textContent = truncate(msg.text, 30);
    }
    // Обновляем кэш
    if (allMessagesCache[otherUserId]) {
        allMessagesCache[otherUserId].push(msg);
    } else {
        allMessagesCache[otherUserId] = [msg];
    }
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

function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// -------------------- Отправка сообщений --------------------
function sendTextMessage() {
    if (!currentChatUser) return;
    const text = messageInput.value.trim();
    if (!text) return;
    const data = {
        from: currentUser.id,
        to: currentChatUser.id,
        text: text
    };
    socket.emit('send_message', data);
    messageInput.value = '';
    // Оптимистичное добавление
    const optimisticMsg = {
        id: Date.now(),
        from: currentUser.id,
        to: currentChatUser.id,
        text: text,
        type: 'text',
        timestamp: Date.now()
    };
    addMessageToUI(optimisticMsg, true);
}

sendBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
});

// -------------------- Голосовые и видео сообщения --------------------
async function startRecording(type) {
    if (!currentChatUser) {
        alert('Сначала выберите чат');
        return;
    }
    recordingType = type;
    try {
        const constraints = type === 'audio' ? { audio: true } : { audio: true, video: true };
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        mediaRecorder = new MediaRecorder(mediaStream);
        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: type === 'audio' ? 'audio/webm' : 'video/webm' });
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                const duration = 0; // можно вычислить, но для простоты опустим
                if (type === 'audio') {
                    socket.emit('send_voice', {
                        from: currentUser.id,
                        to: currentChatUser.id,
                        audioBase64: base64,
                        duration
                    });
                } else {
                    socket.emit('send_video_message', {
                        from: currentUser.id,
                        to: currentChatUser.id,
                        videoBase64: base64,
                        duration
                    });
                }
                // Останавливаем треки
                if (mediaStream) {
                    mediaStream.getTracks().forEach(track => track.stop());
                    mediaStream = null;
                }
            };
            reader.readAsDataURL(blob);
        };

        mediaRecorder.start();
        isRecording = true;
        // Визуальный индикатор
        if (type === 'audio') voiceBtn.style.backgroundColor = 'red';
        else videoMsgBtn.style.backgroundColor = 'red';

        // Автоостановка через 60 секунд
        setTimeout(() => {
            if (isRecording) stopRecording();
        }, 60000);
    } catch (err) {
        console.error('Ошибка доступа к медиа:', err);
        alert('Не удалось получить доступ к микрофону/камере');
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

// -------------------- Профиль --------------------
editProfileBtn.addEventListener('click', async () => {
    try {
        const res = await fetch(`/user/${currentUser.id}`);
        const data = await res.json();
        document.getElementById('edit-displayname').value = data.displayName || '';
        document.getElementById('edit-status').value = data.status || '';
        document.getElementById('edit-avatar').value = data.avatar || '';
        profileModal.style.display = 'flex';
    } catch (err) {
        console.error(err);
    }
});

document.querySelector('#profile-modal .close').addEventListener('click', () => {
    profileModal.style.display = 'none';
});

document.getElementById('save-profile').addEventListener('click', async () => {
    const displayName = document.getElementById('edit-displayname').value;
    const status = document.getElementById('edit-status').value;
    const avatar = document.getElementById('edit-avatar').value;
    try {
        const res = await fetch(`/user/${currentUser.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, status, avatar })
        });
        const data = await res.json();
        if (data.success) {
            currentUser.displayName = data.user.displayName;
            currentUser.avatar = data.user.avatar;
            currentUser.status = data.user.status;
            localStorage.setItem('mime_user', JSON.stringify(currentUser));
            updateProfileUI();
            profileModal.style.display = 'none';
            // Обновляем список чатов (имена изменились)
            await loadUsers();
            if (currentChatUser) {
                const updatedUser = allUsers.find(u => u.id === currentChatUser.id);
                if (updatedUser) openChat(updatedUser);
            }
        }
    } catch (err) {
        console.error(err);
    }
});

// -------------------- Видеозвонки --------------------
callBtn.addEventListener('click', startCall);

async function startCall() {
    if (!currentChatUser) {
        alert('Выберите чат для звонка');
        return;
    }
    callModal.style.display = 'flex';
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localVideo.srcObject = localStream;

        peerConnection = new RTCPeerConnection(iceServers);
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', { to: currentChatUser.id, candidate: event.candidate });
            }
        };
        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
        };

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call_user', { to: currentChatUser.id, offer });
    } catch (err) {
        console.error('Ошибка запуска звонка', err);
        endCall();
    }
}

function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    callModal.style.display = 'none';
    socket.emit('end_call', { to: currentChatUser?.id });
}

endCallBtn.addEventListener('click', endCall);

// Обработка входящего звонка
socket.on('incoming_call', async (data) => {
    if (!confirm(`Входящий звонок от ${data.fromName}. Принять?`)) {
        // можно отправить отказ, но для простоты просто игнорируем
        return;
    }
    currentChatUser = allUsers.find(u => u.id === data.from);
    if (!currentChatUser) {
        // загрузим информацию
        const res = await fetch(`/user/${data.from}`);
        const userData = await res.json();
        currentChatUser = userData;
        allUsers.push(userData);
        renderChatList();
    }
    callModal.style.display = 'flex';
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localVideo.srcObject = localStream;

        peerConnection = new RTCPeerConnection(iceServers);
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', { to: data.from, candidate: event.candidate });
            }
        };
        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
        };

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer_call', { to: data.from, answer });
    } catch (err) {
        console.error('Ошибка ответа на звонок', err);
        endCall();
    }
});

socket.on('call_answered', (data) => {
    if (peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
});

socket.on('ice_candidate', (data) => {
    if (peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('call_ended', () => {
    endCall();
    alert('Звонок завершён собеседником');
});

// -------------------- Socket.IO слушатели --------------------
function setupSocketListeners() {
    socket.on('new_message', (msg) => {
        // Если сообщение относится к текущему открытому чату
        if (currentChatUser && (msg.from === currentChatUser.id || msg.to === currentChatUser.id)) {
            const isOutgoing = msg.from === currentUser.id;
            addMessageToUI(msg, isOutgoing);
        } else if (msg.from === currentUser.id || msg.to === currentUser.id) {
            // Сообщение от/для текущего пользователя, но чат не открыт – обновляем список чатов
            const otherId = msg.from === currentUser.id ? msg.to : msg.from;
            if (allMessagesCache[otherId]) {
                allMessagesCache[otherId].push(msg);
            } else {
                allMessagesCache[otherId] = [msg];
            }
            renderChatList(); // обновим последнее сообщение
        }
    });

    socket.on('user_status', ({ userId, online }) => {
        const user = allUsers.find(u => u.id === userId);
        if (user) {
            user.online = online;
            renderChatList();
            if (currentChatUser && currentChatUser.id === userId) {
                // обновим статус в шапке чата
                chatWithStatusSpan.textContent = online ? 'онлайн' : (user.status || 'офлайн');
            }
        }
    });
}

// Поиск
searchInput.addEventListener('input', () => {
    renderChatList();
});

// -------------------- Проверка сохранённой сессии --------------------
const savedUser = localStorage.getItem('mime_user');
if (savedUser) {
    currentUser = JSON.parse(savedUser);
    initApp();
}
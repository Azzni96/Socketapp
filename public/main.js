const socket = io();

// حالة
let myId = null;
let myNickname = '';
let currentRoom = 'general';
let typingUsers = new Map(); // id -> nickname
let lastDateKey = null;

// عناصر
const nicknameInput = document.getElementById('nickname');
const messageInput  = document.getElementById('message');
const sendBtn       = document.getElementById('send');
const messagesUl    = document.getElementById('messages');
const roomBadge     = document.getElementById('current-room-display');
const typingDiv     = document.getElementById('typing');
const themeToggle   = document.getElementById('theme-toggle');

// أدوات
function fmtTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}
function addDateSeparatorIfNeeded(ms) {
  const key = dateKey(ms);
  if (lastDateKey !== key) {
    lastDateKey = key;
    const sep = document.createElement('div');
    sep.className = 'date-sep';
    sep.textContent = new Date(ms).toDateString();
    messagesUl.appendChild(sep);
  }
}
function scrollToBottom() {
  messagesUl.scrollTop = messagesUl.scrollHeight;
}
function appendMessage({ text, nickname, isSystem = false, isSelf = false, timestamp = Date.now() }) {
  addDateSeparatorIfNeeded(timestamp);

  const li = document.createElement('li');

  if (isSystem) {
    li.className = 'system-message';
    li.textContent = text;
  } else {
    li.className = isSelf ? 'self' : 'other';

    if (nickname) {
      const strong = document.createElement('strong');
      strong.textContent = nickname;
      li.appendChild(strong);
    }

    const span = document.createElement('span');
    span.textContent = text;
    li.appendChild(span);

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = fmtTime(timestamp);
    li.appendChild(time);
  }

  messagesUl.appendChild(li);
  scrollToBottom();
}

// تغيير الثيم
themeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  const curr = root.getAttribute('data-theme') || 'light';
  const next = curr === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  themeToggle.textContent = next === 'dark' ? '☀️ Light' : '🌙 Dark';
});

// ضبط اللقب
nicknameInput.addEventListener('change', (e) => {
  myNickname = e.target.value || 'Anonymous';
  socket.emit('set_nickname', myNickname);
});

// إرسال الرسالة
function sendMessage() {
  const msg = messageInput.value.trim();
  if (!msg) return;
  socket.emit('chat_message', msg);
  messageInput.value = '';
  socket.emit('typing', false);
}
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// مؤشر الكتابة: أرسل true عندما يكتب و false بعد 500ms من التوقف
let typingTimer = null;
messageInput.addEventListener('input', () => {
  socket.emit('typing', messageInput.value.length > 0);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('typing', false), 500);
});

// تعريف الهوية
socket.on('you_are', ({ id }) => {
  myId = id;
});

// رسائل عادية
socket.on('chat_message', ({ nickname, msg, room, senderId, timestamp }) => {
  const isSelf =
    (myId && senderId && myId === senderId) ||
    (!senderId && myNickname && nickname && myNickname === nickname);

  appendMessage({ text: msg, nickname, isSelf, timestamp });
});

// رسائل النظام
socket.on('system_message', (msg) => {
  appendMessage({ text: msg, isSystem: true });
});

// تغيّر الغرفة
socket.on('room_changed', (room) => {
  currentRoom = room;
  roomBadge.textContent = `Room: ${room}`;
  messagesUl.innerHTML = '';
  lastDateKey = null;
  appendMessage({ text: `You are now in room: ${room}`, isSystem: true });
  typingUsers.clear();
  typingDiv.textContent = '';
});

// مؤشر الكتابة من الآخرين
socket.on('typing', ({ id, nickname, isTyping }) => {
  if (isTyping) {
    typingUsers.set(id, nickname || 'Someone');
  } else {
    typingUsers.delete(id);
  }
  const names = [...typingUsers.values()];
  if (names.length === 0) {
    typingDiv.textContent = '';
  } else if (names.length === 1) {
    typingDiv.textContent = `${names[0]} is typing...`;
  } else if (names.length === 2) {
    typingDiv.textContent = `${names[0]} and ${names[1]} are typing...`;
  } else {
    typingDiv.textContent = `Several people are typing...`;
  }
});

// عداد المستخدمين في الغرفة (مبسط)
socket.on('room_count', ({ room, count }) => {
  if (room === currentRoom) {
    roomBadge.textContent = `Room: ${room} (${count})`;
  }
});
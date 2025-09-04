const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
app.use(express.static('public'));

const io = new Server(server);

// ✅ الغرف المسموح بها فقط (عدّلها لو تحب)
const ALLOWED_ROOMS = ['general', 'tech', 'sports', 'games'];

// تتبّع عدد مستخدمي كل غرفة (مُهيأة مسبقًا)
const roomMembers = new Map(); // room -> Set(socketId)
for (const r of ALLOWED_ROOMS) roomMembers.set(r, new Set());

function isAllowed(room) {
  return ALLOWED_ROOMS.includes(room);
}

function getRoomsSummary() {
  return ALLOWED_ROOMS.map(room => ({
    room,
    count: roomMembers.get(room)?.size ?? 0,
  }));
}

function joinRoom(socket, room) {
  if (!isAllowed(room)) {
    socket.emit('system_message', `Room "${room}" is not allowed`);
    return false;
  }
  socket.join(room);
  roomMembers.get(room).add(socket.id);
  io.to(room).emit('room_count', { room, count: roomMembers.get(room).size });
  return true;
}

function leaveRoom(socket, room) {
  if (!isAllowed(room)) return;
  socket.leave(room);
  roomMembers.get(room).delete(socket.id);
  io.to(room).emit('room_count', { room, count: roomMembers.get(room).size });
}

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  let nickname = 'Anonymous';
  let currentRoom = 'general';

  socket.emit('you_are', { id: socket.id });

  // انضمام افتراضي إلى general
  joinRoom(socket, currentRoom);
  io.to(currentRoom).emit('system_message', `${nickname} joined the chat`);

  // ارسال قائمة الغرف (مع العدّادات) للعميل
  socket.emit('rooms_list', getRoomsSummary());

  // تحديث اللقب
  socket.on('set_nickname', (name) => {
    const old = nickname;
    nickname = (name || 'Anonymous').trim();
    if (old !== nickname) {
      io.to(currentRoom).emit('system_message', `${old} is now ${nickname}`);
    }
  });

  // مؤشر الكتابة
  socket.on('typing', (isTyping) => {
    socket.to(currentRoom).emit('typing', {
      id: socket.id,
      nickname,
      isTyping: !!isTyping,
    });
  });

  // ✅ التبديل بين غرف مُسبقة فقط
  socket.on('switch_room', (target) => {
    const room = String(target || '').trim().toLowerCase();
    if (!isAllowed(room)) {
      socket.emit('system_message', `Room "${room}" is not allowed`);
      return;
    }
    if (room === currentRoom) return;

    leaveRoom(socket, currentRoom);
    io.to(currentRoom).emit('system_message', `${nickname} left the room`);

    currentRoom = room;
    joinRoom(socket, currentRoom);
    socket.emit('room_changed', currentRoom);
    io.to(currentRoom).emit('system_message', `${nickname} joined ${currentRoom}`);

    // حدّث القائمة للجميع
    io.emit('rooms_list', getRoomsSummary());
  });

  // رجوع إلى general
  socket.on('leave_room', () => {
    if (currentRoom !== 'general') {
      leaveRoom(socket, currentRoom);
      io.to(currentRoom).emit('system_message', `${nickname} left the room`);
      currentRoom = 'general';
      joinRoom(socket, currentRoom);
      socket.emit('room_changed', 'general');
      io.to('general').emit('system_message', `${nickname} joined general`);
      io.emit('rooms_list', getRoomsSummary());
    }
  });

  // طلب القائمة يدويًا
  socket.on('get_rooms', () => {
    socket.emit('rooms_list', getRoomsSummary());
  });

  // استقبال الرسائل (بدون أوامر نصية /join نهائيًا)
  socket.on('chat_message', (msg) => {
    const text = String(msg || '').trim();
    if (!text) return;

    // لو رسالة تبدأ بشرطة / اعتبرها غير مدعومة الآن
    if (text.startsWith('/')) {
      socket.emit('system_message', 'Text commands are disabled. Use the buttons above.');
      return;
    }

    io.to(currentRoom).emit('chat_message', {
      nickname,
      msg: text,
      room: currentRoom,
      senderId: socket.id,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    io.to(currentRoom).emit('system_message', `${nickname} disconnected`);
    leaveRoom(socket, currentRoom);
    io.emit('rooms_list', getRoomsSummary());
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`server running at http://localhost:${port}`);
});

const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
app.use(express.static('public'));

const io = new Server(server);

// تتبّع عدد مستخدمي كل غرفة (مبسط)
const roomMembers = new Map(); // room -> Set(socketId)

function joinRoom(socket, room) {
  socket.join(room);
  if (!roomMembers.has(room)) roomMembers.set(room, new Set());
  roomMembers.get(room).add(socket.id);
  io.to(room).emit('room_count', {
    room,
    count: roomMembers.get(room).size,
  });
}

function leaveRoom(socket, room) {
  socket.leave(room);
  if (roomMembers.has(room)) {
    roomMembers.get(room).delete(socket.id);
    io.to(room).emit('room_count', {
      room,
      count: roomMembers.get(room).size,
    });
  }
}

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  let nickname = 'Anonymous';
  let currentRoom = 'general';

  // عرف المستخدم بنفسه
  socket.emit('you_are', { id: socket.id });

  // انضمام للغرفة العامة
  joinRoom(socket, currentRoom);
  io.to(currentRoom).emit('system_message', `${nickname} joined the chat`);

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

  // استقبال الرسائل والأوامر
  socket.on('chat_message', (msg) => {
    const text = String(msg || '').trim();
    if (!text) return;

    // أوامر
    if (text.startsWith('/join ')) {
      const newRoom = text.substring(6).trim().replace(/\s+/g, '-').toLowerCase().slice(0, 30);
      if (!newRoom) {
        socket.emit('system_message', 'Invalid room name');
        return;
      }
      // غادر الحالية
      leaveRoom(socket, currentRoom);
      io.to(currentRoom).emit('system_message', `${nickname} left the room`);

      // انضم للجديدة
      currentRoom = newRoom;
      joinRoom(socket, currentRoom);
      socket.emit('room_changed', currentRoom);
      io.to(currentRoom).emit('system_message', `${nickname} joined ${currentRoom}`);
      return;
    }

    if (text === '/leave') {
      if (currentRoom !== 'general') {
        leaveRoom(socket, currentRoom);
        io.to(currentRoom).emit('system_message', `${nickname} left the room`);
        currentRoom = 'general';
        joinRoom(socket, currentRoom);
        socket.emit('room_changed', 'general');
        io.to('general').emit('system_message', `${nickname} joined general`);
      }
      return;
    }

    if (text === '/rooms') {
      const count = roomMembers.get(currentRoom)?.size || 0;
      socket.emit(
        'system_message',
        `Current room: ${currentRoom}. Users here: ${count}. Use /join <roomname> to switch rooms`
      );
      return;
    }

    // رسالة عادية
    io.to(currentRoom).emit('chat_message', {
      nickname,
      msg: text,
      room: currentRoom,
      senderId: socket.id,
      timestamp: Date.now(), // طابع وقت من السيرفر
    });
  });

  // قطع الاتصال
  socket.on('disconnect', () => {
    io.to(currentRoom).emit('system_message', `${nickname} disconnected`);
    leaveRoom(socket, currentRoom);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`server running at http://localhost:${port}`);
});

const express = require('express');
const { createServer } = require('http');
const { join } = require('path');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);

// Enhanced Socket.IO configuration with CORS and better error handling
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from public directory
app.use(express.static('public'));

// Add JSON parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Route handlers
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Enhanced room management system
class ChatRoomManager {
  constructor() {
    this.rooms = new Map();
    this.userSessions = new Map(); // Track user sessions across reconnections
    this.messageHistory = new Map(); // Store recent message history per room
    this.MAX_HISTORY = 50; // Maximum messages to store per room
    
    // Initialize default rooms
    this.createRoom('general', 'General Discussion');
    this.createRoom('tech', 'Technology Talk');
    this.createRoom('random', 'Random Chat');
  }

  createRoom(roomName, description = '') {
    const normalizedName = this.normalizeRoomName(roomName);
    if (!this.rooms.has(normalizedName)) {
      this.rooms.set(normalizedName, {
        name: normalizedName,
        description,
        members: new Set(),
        createdAt: Date.now(),
        messageCount: 0
      });
      
      if (!this.messageHistory.has(normalizedName)) {
        this.messageHistory.set(normalizedName, []);
      }
    }
    return normalizedName;
  }

  normalizeRoomName(input) {
    return String(input || '')
      .trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 30) || 'general';
  }

  joinRoom(socketId, roomName, userNickname) {
    const normalizedRoom = this.createRoom(roomName);
    const room = this.rooms.get(normalizedRoom);
    
    if (room) {
      room.members.add(socketId);
      this.broadcastRoomUpdate(normalizedRoom);
      
      // Add join message to history
      this.addSystemMessage(normalizedRoom, `${userNickname} joined the room`);
      return normalizedRoom;
    }
    return null;
  }

  leaveRoom(socketId, roomName, userNickname) {
    if (this.rooms.has(roomName)) {
      const room = this.rooms.get(roomName);
      room.members.delete(socketId);
      this.broadcastRoomUpdate(roomName);
      
      // Add leave message to history
      if (userNickname) {
        this.addSystemMessage(roomName, `${userNickname} left the room`);
      }
    }
  }

  addMessage(roomName, message) {
    if (!this.messageHistory.has(roomName)) {
      this.messageHistory.set(roomName, []);
    }
    
    const messages = this.messageHistory.get(roomName);
    const messageWithMetadata = {
      ...message,
      timestamp: Date.now(),
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      edited: false,
      editHistory: [],
      reactions: {},
      timezone: message.timezone || 'UTC'
    };
    
    messages.push(messageWithMetadata);
    
    // Keep only recent messages
    if (messages.length > this.MAX_HISTORY) {
      messages.splice(0, messages.length - this.MAX_HISTORY);
    }
    
    // Update room message count
    if (this.rooms.has(roomName)) {
      this.rooms.get(roomName).messageCount++;
    }
    
    return messageWithMetadata;
  }

  editMessage(roomName, messageId, newText, editorId) {
    if (!this.messageHistory.has(roomName)) return null;
    
    const messages = this.messageHistory.get(roomName);
    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    
    if (messageIndex === -1) return null;
    
    const message = messages[messageIndex];
    
    // Only allow the sender to edit their own messages
    if (message.senderId !== editorId) return null;
    
    // Store edit history
    message.editHistory.push({
      oldText: message.text,
      editedAt: Date.now(),
      editedBy: editorId
    });
    
    // Update message
    message.text = newText;
    message.edited = true;
    message.lastEditedAt = Date.now();
    
    return message;
  }

  deleteMessage(roomName, messageId, deleterId) {
    if (!this.messageHistory.has(roomName)) return false;
    
    const messages = this.messageHistory.get(roomName);
    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    
    if (messageIndex === -1) return false;
    
    const message = messages[messageIndex];
    
    // Only allow the sender to delete their own messages
    if (message.senderId !== deleterId) return false;
    
    messages.splice(messageIndex, 1);
    return true;
  }

  addReaction(roomName, messageId, emoji, userId) {
    if (!this.messageHistory.has(roomName)) return null;
    
    const messages = this.messageHistory.get(roomName);
    const message = messages.find(msg => msg.id === messageId);
    
    if (!message) return null;
    
    if (!message.reactions[emoji]) {
      message.reactions[emoji] = [];
    }
    
    // Toggle reaction
    const userIndex = message.reactions[emoji].indexOf(userId);
    if (userIndex === -1) {
      message.reactions[emoji].push(userId);
    } else {
      message.reactions[emoji].splice(userIndex, 1);
      if (message.reactions[emoji].length === 0) {
        delete message.reactions[emoji];
      }
    }
    
    return message;
  }

  addSystemMessage(roomName, text) {
    this.addMessage(roomName, {
      type: 'system',
      text,
      isSystem: true
    });
  }

  getMessageHistory(roomName) {
    return this.messageHistory.get(roomName) || [];
  }

  getRoomsList() {
    return Array.from(this.rooms.values()).map(room => ({
      name: room.name,
      description: room.description,
      memberCount: room.members.size,
      messageCount: room.messageCount
    }));
  }

  getRoomInfo(roomName) {
    return this.rooms.get(roomName);
  }

  broadcastRoomUpdate(roomName) {
    const room = this.rooms.get(roomName);
    if (room) {
      io.to(roomName).emit('room_updated', {
        room: roomName,
        memberCount: room.members.size
      });
    }
  }

  cleanup() {
    // Remove empty rooms (except default ones)
    const defaultRooms = ['general', 'tech', 'random'];
    for (const [roomName, room] of this.rooms) {
      if (!defaultRooms.includes(roomName) && room.members.size === 0) {
        this.rooms.delete(roomName);
        this.messageHistory.delete(roomName);
      }
    }
  }
}

// Initialize room manager
const roomManager = new ChatRoomManager();

// Utility functions
const isValidNickname = (nickname) => {
  return typeof nickname === 'string' && 
         nickname.trim().length >= 2 && 
         nickname.trim().length <= 20 &&
         /^[a-zA-Z0-9_\s-]+$/.test(nickname.trim());
};

const sanitizeMessage = (message) => {
  return String(message || '').trim().slice(0, 500); // Limit message length
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // User session data
  let userNickname = '';
  let currentRoom = null;
  let joinedAt = Date.now();
  let isTyping = false;

  // Send initial data
  socket.emit('connected', { 
    socketId: socket.id,
    serverTime: Date.now(),
    availableRooms: roomManager.getRoomsList()
  });

  // Handle nickname setting
  socket.on('set_nickname', (nickname) => {
    const trimmedNickname = String(nickname || '').trim();
    
    if (!isValidNickname(trimmedNickname)) {
      socket.emit('error', {
        type: 'INVALID_NICKNAME',
        message: 'Nickname must be 2-20 characters, alphanumeric, spaces, hyphens, and underscores only.'
      });
      return;
    }

    const previousNickname = userNickname;
    userNickname = trimmedNickname;

    // If user was already in a room, announce name change
    if (currentRoom && previousNickname) {
      roomManager.addSystemMessage(currentRoom, `${previousNickname} is now known as ${userNickname}`);
      io.to(currentRoom).emit('system_message', `${previousNickname} is now known as ${userNickname}`);
    }

    socket.emit('nickname_set', { 
      nickname: userNickname,
      previous: previousNickname 
    });

    // Auto-join general room if first time setting nickname
    if (!currentRoom) {
      handleRoomJoin('general');
    }
  });

  // Handle room joining
  const handleRoomJoin = (roomName) => {
    if (!userNickname) {
      socket.emit('error', {
        type: 'NO_NICKNAME',
        message: 'Please set a nickname first.'
      });
      return;
    }

    const normalizedRoom = roomManager.normalizeRoomName(roomName);
    
    if (currentRoom === normalizedRoom) {
      socket.emit('info', `You are already in room: ${normalizedRoom}`);
      return;
    }

    // Leave current room
    if (currentRoom) {
      socket.leave(currentRoom);
      roomManager.leaveRoom(socket.id, currentRoom, userNickname);
      io.to(currentRoom).emit('user_left', {
        nickname: userNickname,
        room: currentRoom
      });
    }

    // Join new room
    socket.join(normalizedRoom);
    const joinedRoom = roomManager.joinRoom(socket.id, normalizedRoom, userNickname);
    currentRoom = joinedRoom;

    // Send room data to user
    const roomHistory = roomManager.getMessageHistory(normalizedRoom);
    const roomInfo = roomManager.getRoomInfo(normalizedRoom);
    
    socket.emit('room_joined', {
      room: normalizedRoom,
      memberCount: roomInfo?.members.size || 0,
      messageHistory: roomHistory,
      joinedAt: Date.now()
    });

    // Notify room about new user
    socket.to(normalizedRoom).emit('user_joined', {
      nickname: userNickname,
      room: normalizedRoom
    });

    // Update room lists for all users
    io.emit('rooms_updated', roomManager.getRoomsList());
  };

  socket.on('join_room', handleRoomJoin);

  // Handle chat messages
  socket.on('send_message', (messageData) => {
    if (!userNickname) {
      socket.emit('error', {
        type: 'NO_NICKNAME',
        message: 'Please set a nickname first.'
      });
      return;
    }

    if (!currentRoom) {
      socket.emit('error', {
        type: 'NO_ROOM',
        message: 'Please join a room first.'
      });
      return;
    }

    const messageText = sanitizeMessage(messageData.text || messageData);
    if (!messageText) {
      return; // Ignore empty messages
    }

    const message = {
      type: messageData.type || 'text',
      text: messageText,
      nickname: userNickname,
      senderId: socket.id,
      room: currentRoom,
      timezone: messageData.timezone || 'UTC',
      data: messageData.data || null // For images, files, etc.
    };

    // Add to room history and get the message with metadata
    const savedMessage = roomManager.addMessage(currentRoom, message);

    // Broadcast to room
    io.to(currentRoom).emit('new_message', savedMessage);

    // Stop typing indicator
    if (isTyping) {
      isTyping = false;
      socket.to(currentRoom).emit('user_stop_typing', {
        nickname: userNickname,
        socketId: socket.id
      });
    }
  });

  // Handle message editing
  socket.on('edit_message', (data) => {
    if (!userNickname || !currentRoom) {
      socket.emit('error', {
        type: 'PERMISSION_DENIED',
        message: 'You must be in a room to edit messages.'
      });
      return;
    }

    const { messageId, newText } = data;
    const sanitizedText = sanitizeMessage(newText);
    
    if (!sanitizedText) {
      socket.emit('error', {
        type: 'INVALID_INPUT',
        message: 'Message text cannot be empty.'
      });
      return;
    }

    const editedMessage = roomManager.editMessage(currentRoom, messageId, sanitizedText, socket.id);
    
    if (editedMessage) {
      io.to(currentRoom).emit('message_edited', {
        messageId,
        newText: sanitizedText,
        editedAt: editedMessage.lastEditedAt,
        edited: true
      });
    } else {
      socket.emit('error', {
        type: 'EDIT_FAILED',
        message: 'Could not edit message. You can only edit your own messages.'
      });
    }
  });

  // Handle message deletion
  socket.on('delete_message', (data) => {
    if (!userNickname || !currentRoom) {
      socket.emit('error', {
        type: 'PERMISSION_DENIED',
        message: 'You must be in a room to delete messages.'
      });
      return;
    }

    const { messageId } = data;
    const deleted = roomManager.deleteMessage(currentRoom, messageId, socket.id);
    
    if (deleted) {
      io.to(currentRoom).emit('message_deleted', { messageId });
    } else {
      socket.emit('error', {
        type: 'DELETE_FAILED',
        message: 'Could not delete message. You can only delete your own messages.'
      });
    }
  });

  // Handle emoji reactions
  socket.on('add_reaction', (data) => {
    if (!userNickname || !currentRoom) return;

    const { messageId, emoji } = data;
    const message = roomManager.addReaction(currentRoom, messageId, emoji, socket.id);
    
    if (message) {
      io.to(currentRoom).emit('reaction_updated', {
        messageId,
        reactions: message.reactions
      });
    }
  });

  // Handle image/file uploads
  socket.on('send_image', (imageData) => {
    if (!userNickname || !currentRoom) return;

    const message = {
      type: 'image',
      text: imageData.caption || '',
      nickname: userNickname,
      senderId: socket.id,
      room: currentRoom,
      timezone: imageData.timezone || 'UTC',
      data: {
        imageUrl: imageData.dataUrl,
        filename: imageData.filename,
        size: imageData.size
      }
    };

    const savedMessage = roomManager.addMessage(currentRoom, message);
    io.to(currentRoom).emit('new_message', savedMessage);
  });

  // Handle typing indicators
  socket.on('typing_start', () => {
    if (currentRoom && userNickname && !isTyping) {
      isTyping = true;
      socket.to(currentRoom).emit('user_typing', {
        nickname: userNickname,
        socketId: socket.id
      });
    }
  });

  socket.on('typing_stop', () => {
    if (currentRoom && userNickname && isTyping) {
      isTyping = false;
      socket.to(currentRoom).emit('user_stop_typing', {
        nickname: userNickname,
        socketId: socket.id
      });
    }
  });

  // Handle room info requests
  socket.on('get_room_info', () => {
    if (!currentRoom) {
      socket.emit('error', {
        type: 'NO_ROOM',
        message: 'You are not in any room.'
      });
      return;
    }

    const roomInfo = roomManager.getRoomInfo(currentRoom);
    socket.emit('room_info', {
      room: currentRoom,
      memberCount: roomInfo?.members.size || 0,
      messageCount: roomInfo?.messageCount || 0,
      availableRooms: roomManager.getRoomsList()
    });
  });

  // Handle getting list of users in current room
  socket.on('get_room_users', async () => {
    if (!currentRoom) {
      socket.emit('error', {
        type: 'NO_ROOM',
        message: 'You are not in any room.'
      });
      return;
    }

    try {
      const socketsInRoom = await io.in(currentRoom).fetchSockets();
      const users = socketsInRoom
        .map(s => ({
          socketId: s.id,
          nickname: s.data?.nickname || 'Anonymous'
        }))
        .filter(user => user.nickname !== 'Anonymous');

      socket.emit('room_users', {
        room: currentRoom,
        users,
        count: users.length
      });
    } catch (error) {
      console.error('Error fetching room users:', error);
      socket.emit('error', {
        type: 'SERVER_ERROR',
        message: 'Could not retrieve room users.'
      });
    }
  });

  // Store user data for session management
  socket.use((packet, next) => {
    socket.data.nickname = userNickname;
    socket.data.currentRoom = currentRoom;
    socket.data.joinedAt = joinedAt;
    next();
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
    
    if (currentRoom) {
      roomManager.leaveRoom(socket.id, currentRoom, userNickname);
      
      if (userNickname) {
        socket.to(currentRoom).emit('user_left', {
          nickname: userNickname,
          room: currentRoom,
          reason
        });
      }

      // Update room lists for all users
      io.emit('rooms_updated', roomManager.getRoomsList());
    }

    // Cleanup empty rooms periodically
    setTimeout(() => roomManager.cleanup(), 5000);
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
    socket.emit('error', {
      type: 'SOCKET_ERROR',
      message: 'A socket error occurred.'
    });
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Socket.IO Chat Server running on http://localhost:${PORT}`);
  console.log(`📝 Available rooms: ${roomManager.getRoomsList().map(r => r.name).join(', ')}`);
});

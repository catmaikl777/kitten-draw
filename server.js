const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ВАЖНО: Настройте CORS для вашего домена Vercel
const io = socketIo(server, {
  cors: {
    origin: [
      "https://kittendraw.vercel.app",
      "https://*.vercel.app",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: [
    "https://kittendraw.vercel.app",
    "https://*.vercel.app", 
    "http://localhost:3000"
  ],
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Kitten Draw Backend'
  });
});

// API для создания комнаты
app.post('/api/rooms', (req, res) => {
  const { username } = req.body;
  const roomId = generateRoomId();
  
  res.json({ 
    roomId, 
    success: true,
    message: 'Room created successfully'
  });
});

// API для проверки комнаты
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (room) {
    res.json({
      exists: true,
      players: room.players.size,
      roomId: roomId
    });
  } else {
    res.json({
      exists: false,
      players: 0,
      roomId: roomId
    });
  }
});

// Хранилище комнат
const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// WebSocket логика
io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  
  let currentRoom = null;
  let playerId = null;
  let username = null;

  socket.on('join_room', (data) => {
    try {
      const { roomId, username: playerName } = data;
      
      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          players: new Map(),
          canvasData: null,
          createdAt: new Date()
        });
        console.log(`🏠 Created new room: ${roomId}`);
      }

      const room = rooms.get(roomId);
      
      if (room.players.size >= 2) {
        socket.emit('error', { message: 'Room is full (max 2 players)' });
        return;
      }

      playerId = room.players.size + 1;
      username = playerName || `Player ${playerId}`;
      currentRoom = roomId;

      room.players.set(socket.id, {
        id: playerId,
        username: username,
        color: playerId === 1 ? '#FF5252' : '#2196F3',
        socketId: socket.id
      });

      socket.join(roomId);

      socket.emit('room_joined', {
        roomId: roomId,
        playerId: playerId,
        players: Array.from(room.players.values()),
        canvasData: room.canvasData
      });

      socket.to(roomId).emit('player_joined', {
        player: { id: playerId, username: username },
        players: Array.from(room.players.values())
      });

      console.log(`🎮 Player ${username} (${playerId}) joined room ${roomId}`);
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Internal server error' });
    }
  });

  socket.on('draw', (data) => {
    if (!currentRoom) return;
    
    try {
      socket.to(currentRoom).emit('draw', data);

      const room = rooms.get(currentRoom);
      if (room && data.canvasData) {
        room.canvasData = data.canvasData;
      }
    } catch (error) {
      console.error('Error handling draw event:', error);
    }
  });

  socket.on('clear', (data) => {
    if (!currentRoom) return;
    
    try {
      socket.to(currentRoom).emit('clear', data);
      
      const room = rooms.get(currentRoom);
      if (room) {
        room.canvasData = null;
      }
    } catch (error) {
      console.error('Error handling clear event:', error);
    }
  });

  socket.on('chat_message', (data) => {
    if (!currentRoom) return;
    
    try {
      socket.to(currentRoom).emit('chat_message', data);
    } catch (error) {
      console.error('Error handling chat message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        const player = room.players.get(socket.id);
        
        if (player) {
          room.players.delete(socket.id);
          
          socket.to(currentRoom).emit('player_left', {
            playerId: player.id,
            players: Array.from(room.players.values())
          });

          console.log(`🚪 Player ${player.username} left room ${currentRoom}`);
        }

        if (room.players.size === 0) {
          setTimeout(() => {
            if (rooms.get(currentRoom)?.players.size === 0) {
              rooms.delete(currentRoom);
              console.log(`🗑️  Room ${currentRoom} deleted (empty)`);
            }
          }, 30000);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});
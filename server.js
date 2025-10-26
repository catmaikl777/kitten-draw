// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка CORS
const io = socketIo(server, {
  cors: {
    origin: "https://kittendraw.vercel.app",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Хранилище данных
const rooms = new Map();
const players = new Map();

// Генерация ID комнаты
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// API endpoints
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    rooms: rooms.size,
    players: players.size
  });
});

app.post('/api/rooms', (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const roomId = generateRoomId();
  
  // Создаем комнату
  rooms.set(roomId, {
    id: roomId,
    players: new Map(),
    canvasState: null,
    createdAt: new Date(),
    settings: {
      maxPlayers: 10,
      public: true
    }
  });

  res.json({ 
    roomId, 
    success: true,
    message: 'Room created successfully'
  });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (room) {
    res.json({
      exists: true,
      players: Array.from(room.players.values()),
      roomId: roomId,
      createdAt: room.createdAt
    });
  } else {
    res.status(404).json({
      exists: false,
      message: 'Room not found'
    });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({
    totalRooms: rooms.size,
    totalPlayers: players.size,
    activeRooms: Array.from(rooms.values())
      .filter(room => room.players.size > 0)
      .map(room => ({
        id: room.id,
        players: room.players.size,
        createdAt: room.createdAt
      }))
  });
});

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log('🔌 Новое подключение:', socket.id);

  let currentRoom = null;
  let currentPlayer = null;

  // Создание комнаты
  socket.on('create_room', (data) => {
    try {
      const { username } = data;
      
      if (!username) {
        socket.emit('error', { message: 'Username is required' });
        return;
      }

      const roomId = generateRoomId();
      
      // Создаем комнату
      rooms.set(roomId, {
        id: roomId,
        players: new Map(),
        canvasState: null,
        createdAt: new Date(),
        settings: {
          maxPlayers: 10,
          public: true
        }
      });

      const room = rooms.get(roomId);
      const playerId = socket.id;

      // Создаем игрока
      currentPlayer = {
        id: playerId,
        username: username,
        socketId: socket.id,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
        joinedAt: new Date()
      };

      players.set(playerId, currentPlayer);
      room.players.set(playerId, currentPlayer);
      currentRoom = roomId;

      socket.join(roomId);

      // Отправляем подтверждение создания комнаты
      socket.emit('room_created', {
        roomId: roomId,
        playerId: playerId,
        players: Array.from(room.players.values())
      });

      console.log(`🏠 Создана комната ${roomId} пользователем ${username}`);

    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  // Присоединение к комнате
  socket.on('join_room', (data) => {
    try {
      const { roomId, username } = data;
      
      if (!roomId || !username) {
        socket.emit('error', { message: 'Room ID and username are required' });
        return;
      }

      const room = rooms.get(roomId);
      
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      if (room.players.size >= room.settings.maxPlayers) {
        socket.emit('error', { message: 'Room is full' });
        return;
      }

      const playerId = socket.id;

      // Создаем игрока
      currentPlayer = {
        id: playerId,
        username: username,
        socketId: socket.id,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
        joinedAt: new Date()
      };

      players.set(playerId, currentPlayer);
      room.players.set(playerId, currentPlayer);
      currentRoom = roomId;

      socket.join(roomId);

      // Уведомляем всех в комнате о новом игроке
      socket.to(roomId).emit('player_joined', {
        player: currentPlayer,
        players: Array.from(room.players.values())
      });

      // Отправляем данные комнаты новому игроку
      socket.emit('room_joined', {
        roomId: roomId,
        playerId: playerId,
        players: Array.from(room.players.values()),
        canvasState: room.canvasState
      });

      console.log(`🎮 ${username} присоединился к комнате ${roomId}`);

    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Обработка рисования
  socket.on('draw', (data) => {
    try {
      if (!currentRoom) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      // Сохраняем состояние холста
      if (data.canvasData) {
        room.canvasState = data.canvasData;
      }

      // Пересылаем данные рисования всем в комнате, кроме отправителя
      socket.to(currentRoom).emit('draw_data', data);

    } catch (error) {
      console.error('Error handling draw event:', error);
    }
  });

  // Очистка холста
  socket.on('clear_canvas', (data) => {
    try {
      if (!currentRoom) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      // Очищаем состояние холста
      room.canvasState = null;

      // Уведомляем всех в комнате
      io.to(currentRoom).emit('canvas_cleared', {
        clearedBy: data.playerId
      });

      console.log(`🗑️ Холст очищен в комнате ${currentRoom}`);

    } catch (error) {
      console.error('Error clearing canvas:', error);
    }
  });

  // Сообщения чата
  socket.on('send_message', (data) => {
    try {
      if (!currentRoom) return;

      // Пересылаем сообщение всем в комнате
      io.to(currentRoom).emit('chat_message', {
        playerId: data.playerId,
        username: data.username,
        message: data.message,
        timestamp: new Date()
      });

      console.log(`💬 Сообщение в ${currentRoom}: ${data.username}: ${data.message}`);

    } catch (error) {
      console.error('Error handling chat message:', error);
    }
  });

  // Пинг для проверки соединения
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });

  // Отключение игрока
  socket.on('leave_room', (data) => {
    try {
      if (!currentRoom) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      // Удаляем игрока из комнаты
      room.players.delete(socket.id);
      players.delete(socket.id);

      // Уведомляем остальных игроков
      socket.to(currentRoom).emit('player_left', {
        playerId: socket.id,
        players: Array.from(room.players.values())
      });

      console.log(`🚪 Игрок покинул комнату ${currentRoom}`);

      // Если комната пустая, удаляем её через некоторое время
      if (room.players.size === 0) {
        setTimeout(() => {
          if (rooms.get(currentRoom)?.players.size === 0) {
            rooms.delete(currentRoom);
            console.log(`🗑️ Комната ${currentRoom} удалена (пустая)`);
          }
        }, 300000); // 5 минут
      }

      currentRoom = null;
      currentPlayer = null;

    } catch (error) {
      console.error('Error leaving room:', error);
    }
  });

  // Обработка отключения
  socket.on('disconnect', () => {
    try {
      console.log('🔌 Отключение:', socket.id);

      if (currentRoom) {
        const room = rooms.get(currentRoom);
        if (room) {
          // Удаляем игрока из комнаты
          room.players.delete(socket.id);
          players.delete(socket.id);

          // Уведомляем остальных игроков
          socket.to(currentRoom).emit('player_left', {
            playerId: socket.id,
            players: Array.from(room.players.values())
          });

          console.log(`🚪 Игрок отключился от комнаты ${currentRoom}`);

          // Если комната пустая, удаляем её через некоторое время
          if (room.players.size === 0) {
            setTimeout(() => {
              if (rooms.get(currentRoom)?.players.size === 0) {
                rooms.delete(currentRoom);
                console.log(`🗑️ Комната ${currentRoom} удалена (пустая)`);
              }
            }, 300000); // 5 минут
          }
        }
      }

    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📊 Статистика: http://localhost:${PORT}/api/stats`);
});

// Обработка graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Получен SIGTERM, завершаем работу...');
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});
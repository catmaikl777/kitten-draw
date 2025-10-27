const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "https://kittendraw.vercel.app",
        methods: ["GET", "POST"]
    }
});

// Хранилище комнат
const rooms = new Map();

// Функции для работы с комнатами
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(roomCode) {
    const room = {
        code: roomCode,
        players: new Map(),
        drawingHistory: [],
        createdAt: new Date()
    };
    rooms.set(roomCode, room);
    return room;
}

function getRoom(roomCode) {
    return rooms.get(roomCode);
}

function deleteRoomIfEmpty(roomCode) {
    const room = rooms.get(roomCode);
    if (room && room.players.size === 0) {
        rooms.delete(roomCode);
        console.log(`Комната ${roomCode} удалена`);
    }
}

// Обработчики Socket.io
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    // Создание комнаты
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        const room = createRoom(roomCode);
        
        const player = {
            id: socket.id,
            name: 'Игрок 1',
            number: 1,
            socket: socket
        };
        
        room.players.set(socket.id, player);
        socket.join(roomCode);
        
        socket.emit('roomCreated', { 
            roomCode, 
            playerId: socket.id,
            playerNumber: 1
        });
        
        console.log(`Создана комната ${roomCode} игроком ${socket.id}`);
    });

    // Присоединение к комнате
    socket.on('joinRoom', (data) => {
        const { roomCode } = data;
        const room = getRoom(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Комната не найдена' });
            return;
        }
        
        if (room.players.size >= 2) {
            socket.emit('error', { message: 'Комната заполнена' });
            return;
        }
        
        const playerNumber = room.players.size + 1;
        const player = {
            id: socket.id,
            name: `Игрок ${playerNumber}`,
            number: playerNumber,
            socket: socket
        };
        
        room.players.set(socket.id, player);
        socket.join(roomCode);
        
        // Уведомляем всех в комнате о новом игроке
        io.to(roomCode).emit('playerJoined', {
            playerId: socket.id,
            playerName: player.name,
            playerNumber: playerNumber,
            roomPlayers: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                number: p.number
            }))
        });
        
        socket.emit('roomJoined', {
            roomCode,
            playerId: socket.id,
            playerNumber: playerNumber,
            roomPlayers: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                number: p.number
            }))
        });
        
        console.log(`Игрок ${socket.id} присоединился к комнате ${roomCode}`);
    });

    // Обработка рисования
    socket.on('drawingData', (data) => {
        const { roomCode, drawingData } = data;
        
        // Пересылаем данные рисования всем в комнате, кроме отправителя
        socket.to(roomCode).emit('drawingData', {
            drawingData,
            playerId: socket.id
        });
    });

    // Очистка холста
    socket.on('clearCanvas', (data) => {
        const { roomCode } = data;
        socket.to(roomCode).emit('clearCanvas', {
            playerId: socket.id
        });
    });

    // Отмена действия
    socket.on('undo', (data) => {
        const { roomCode } = data;
        socket.to(roomCode).emit('undo', {
            playerId: socket.id
        });
    });

    // Повтор действия
    socket.on('redo', (data) => {
        const { roomCode } = data;
        socket.to(roomCode).emit('redo', {
            playerId: socket.id
        });
    });

    // Сообщения чата
    socket.on('chatMessage', (data) => {
        const { roomCode, message } = data;
        
        const room = getRoom(roomCode);
        if (!room) return;
        
        const player = room.players.get(socket.id);
        if (!player) return;
        
        // Отправляем сообщение всем в комнате
        io.to(roomCode).emit('chatMessage', {
            message,
            playerName: player.name,
            playerId: socket.id,
            timestamp: new Date().toISOString()
        });
    });

    // Отключение игрока
    socket.on('disconnect', () => {
        console.log('Отключение:', socket.id);
        
        // Находим комнату, в которой был игрок
        for (const [roomCode, room] of rooms.entries()) {
            if (room.players.has(socket.id)) {
                const player = room.players.get(socket.id);
                
                // Удаляем игрока из комнаты
                room.players.delete(socket.id);
                
                // Уведомляем остальных игроков
                socket.to(roomCode).emit('playerLeft', {
                    playerId: socket.id,
                    playerName: player.name
                });
                
                // Удаляем комнату если она пустая
                deleteRoomIfEmpty(roomCode);
                break;
            }
        }
    });

    // Пинг для проверки соединения
    socket.on('ping', () => {
        socket.emit('pong');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});

module.exports = app;
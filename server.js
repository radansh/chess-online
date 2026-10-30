const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const path = require('path');
const fs = require('fs');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const file = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(file)) {
    res.sendFile(file);
  } else {
    res.send('index.html پیدا نشد. فایل‌های موجود: ' + fs.readdirSync(__dirname).join(' , '));
  }
});

// roomId -> { game, white, black, resigned }
const rooms = new Map();

function getState(room) {
  const g = room.game;
  let status = 'playing';
  let winner = null;

  if (room.resigned) {
    status = 'resigned';
    winner = room.resigned === 'w' ? 'b' : 'w';
  } else if (g.isCheckmate()) {
    status = 'checkmate';
    winner = g.turn() === 'w' ? 'b' : 'w';
  } else if (g.isDraw()) {
    status = 'draw';
  } else if (g.isCheck()) {
    status = 'check';
  }

  return {
    fen: g.fen(),
    turn: g.turn(),
    status,
    winner,
    started: !!(room.white && room.black),
    legal: g.moves({ verbose: true }).map((m) => ({ from: m.from, to: m.to })),
    history: g.history(),
  };
}

function broadcast(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit('state', getState(room));
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let color = null;

  socket.on('join', (roomId) => {
    roomId = String(roomId || '').trim().slice(0, 30);
    if (!roomId) return;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { game: new Chess(), white: null, black: null, resigned: null });
    }
    const room = rooms.get(roomId);

    if (!room.white) {
      room.white = socket.id;
      color = 'w';
    } else if (!room.black) {
      room.black = socket.id;
      color = 'b';
    } else {
      socket.emit('error_msg', 'این اتاق پر است.');
      return;
    }

    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('joined', { roomId, color });
    broadcast(roomId);
  });

  socket.on('move', ({ from, to, promotion }) => {
    const room = rooms.get(currentRoom);
    if (!room || !color) return;
    if (!room.white || !room.black) return;
    if (room.resigned) return;
    if (room.game.turn() !== color) return;

    try {
      room.game.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      socket.emit('error_msg', 'حرکت نامعتبر');
      return;
    }
    broadcast(currentRoom);
  });

  socket.on('resign', () => {
    const room = rooms.get(currentRoom);
    if (!room || !color || room.resigned) return;
    room.resigned = color;
    broadcast(currentRoom);
  });

  socket.on('rematch', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.game = new Chess();
    room.resigned = null;
    broadcast(currentRoom);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.white === socket.id) room.white = null;
    if (room.black === socket.id) room.black = null;

    if (!room.white && !room.black) {
      rooms.delete(currentRoom);
    } else {
      io.to(currentRoom).emit('opponent_left');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});

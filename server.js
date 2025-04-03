const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // Replace with your frontend URL in production
    methods: ['GET', 'POST', 'DELETE'],
  },
});

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully!'))
  .catch((error) => console.error('MongoDB connection error:', error));

const roomRoutes = require('./routes/roomRoutes');
const GameRoom = require('./models/gameRoom');
app.use('/api/rooms', roomRoutes);

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`A client connected: ${socket.id}`);

  socket.on('joinRoom', (roomCode) => {
    if (roomCode) {
      socket.join(roomCode);
      console.log(`Client joined room: ${roomCode}`);
    } else {
      console.log(`Invalid roomCode received from client: ${socket.id}`);
    }
  });

  socket.on('playerLeft', ({ roomCode, players }) => {
    if (roomCode && players) {
      io.to(roomCode).emit('updatePlayers', players);
      console.log(`Updated players broadcasted for room: ${roomCode}`);
    } else {
      console.error('Invalid playerLeft payload received:', { roomCode, players });
    }
  });
  socket.on("submitHint", async ({ roomCode, hint, username }) => {
    console.log("Received hint request on backend:", { roomCode, hint, username });
  
    try {
      const room = await GameRoom.findOne({ roomCode });
  
      if (!room || room.gameState !== "active") {
        console.error(`Invalid hint submission. Room ${roomCode} not found or inactive.`);
        return;
      }
  
      // Find the player submitting the hint
      const spymaster = room.players.find(player => player.username === username);
  
      if (!spymaster || spymaster.role !== "Spymaster" || spymaster.team !== room.currentTurnTeam) {
        console.error(`Unauthorized hint submission from ${username}`);
        return;
      }
  
      // Store and broadcast the hint with Spymaster's team name
      const formattedHint = `${spymaster.team} Team Spymaster's Hint: ${hint}`;
      room.currentHint = formattedHint;
      await room.save();
      io.to(roomCode).emit("newHint", formattedHint); // Broadcast formatted hint
  
      console.log(`Hint saved for ${room.currentTurnTeam} Team: ${hint}`);
    } catch (error) {
      console.error("Error submitting hint:", error);
    }
  });
  
  
  io.on('connection', (socket) => {
    socket.on('submitHint', async ({ roomCode, hint }) => {
      try {
        const room = await GameRoom.findOne({ roomCode });
        if (room && room.gameState === 'active') {
          room.currentHint = hint;
          await room.save();
          io.to(roomCode).emit('newHint', hint); // Broadcast hint to all players
          console.log(`Hint submitted for room ${roomCode}: ${hint}`);
        } else {
          console.error(`Invalid hint submission. Room ${roomCode} not found or inactive.`);
        }
      } catch (error) {
        console.error('Error submitting hint:', error);
      }
    });
  });

  

  socket.on('startGame', async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (room) {
        room.currentTurnTeam = 'Red';
        room.timerStartTime = Date.now();
        room.gameState = 'active';
        await room.save();

        io.to(roomCode).emit('gameStarted', { currentTurnTeam: 'Red', timerStartTime: room.timerStartTime });
        console.log(`Game started in room ${roomCode}, Red team's turn.`);
      } else {
        console.error(`Room with code ${roomCode} not found.`);
      }
    } catch (error) {
      console.error('Error starting the game:', error);
    }
  });

  socket.on('endTurn', async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (room && room.gameState === 'active') {
        room.currentTurnTeam = room.currentTurnTeam === 'Red' ? 'Blue' : 'Red';
        room.timerStartTime = Date.now();
        await room.save();

        io.to(roomCode).emit('turnSwitched', { currentTurnTeam: room.currentTurnTeam, timerStartTime: room.timerStartTime });
        console.log(`Turn switched to ${room.currentTurnTeam} team in room ${roomCode}.`);
      } else {
        console.error(`Cannot switch turn. Room ${roomCode} not active or not found.`);
      }
    } catch (error) {
      console.error('Error ending turn:', error);
    }
  });

  socket.on('tileRevealed', async ({ roomCode, index }) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (room) {
        room.revealedTiles[index] = true;
        const tileColor = room.patterns[index];

        if (tileColor === 'black') {
          room.gameState = 'ended';
          await room.save();
          io.to(roomCode).emit('gameEnded', { result: `Team ${room.currentTurnTeam} lost by guessing the black tile.` });
          console.log(`Game ended in room ${roomCode}, black tile guessed.`);
        } else if (tileColor !== room.currentTurnTeam.toLowerCase()) {
          room.currentTurnTeam = room.currentTurnTeam === 'Red' ? 'Blue' : 'Red';
          room.timerStartTime = Date.now();
          await room.save();
          io.to(roomCode).emit('turnSwitched', { currentTurnTeam: room.currentTurnTeam, timerStartTime: room.timerStartTime });
          console.log(`Turn switched due to wrong guess in room ${roomCode}.`);
        } else {
          await room.save();
        }

        io.to(roomCode).emit('updateTile', { index, tileColor });
      } else {
        console.error(`Room with code ${roomCode} not found.`);
      }
    } catch (error) {
      console.error('Error revealing tile:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`A client disconnected: ${socket.id}`);
  });
});
app.get('/', (req, res) => {
  res.send('Server is running!');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

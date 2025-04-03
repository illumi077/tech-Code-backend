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
    }
  });

  socket.on("submitHint", async ({ roomCode, hint, username }) => {
    const room = await GameRoom.findOne({ roomCode });

    if (!room || room.gameState !== "active") return;
    
    const spymaster = room.players.find(player => player.username === username);
    if (!spymaster || spymaster.role !== "Spymaster" || spymaster.team !== room.currentTurnTeam) return;

    const formattedHint = `${spymaster.team} Team Spymaster's Hint: ${hint}`;
    room.currentHint = formattedHint;
    await room.save();
    io.to(roomCode).emit("newHint", formattedHint);
  });
  
  socket.on("tileClicked", async ({ roomCode, index }) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;
  
      room.revealedTiles[index] = true;
      const tileColor = room.patterns[index];
  
      const allRedRevealed = room.patterns
        .map((color, i) => color === "red" && room.revealedTiles[i])
        .every(Boolean);
  
      const allBlueRevealed = room.patterns
        .map((color, i) => color === "blue" && room.revealedTiles[i])
        .every(Boolean);
  
      if (tileColor === "black") {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: `Game Over! ${room.currentTurnTeam} team lost by clicking a black tile.` });
      } else if (allRedRevealed) {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: `Game Over! Red team has found all their tiles and wins!` });
      } else if (allBlueRevealed) {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: `Game Over! Blue team has found all their tiles and wins!` });
      } else {
        // **Clear the previous hint**
        room.currentHint = "";
        room.currentTurnTeam = room.currentTurnTeam === "Red" ? "Blue" : "Red";
        room.timerStartTime = Date.now();
        await room.save();
  
        io.to(roomCode).emit("turnSwitched", { currentTurnTeam: room.currentTurnTeam, timerStartTime: room.timerStartTime });
        io.to(roomCode).emit("newHint", ""); // Send an empty hint to reset the frontend display
      }
  
      io.to(roomCode).emit("updateTile", { index, tileColor });
  
    } catch (error) {
      console.error("Error handling tile click:", error);
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

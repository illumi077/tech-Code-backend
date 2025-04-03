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

  socket.on("joinRoom", async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;
      
      // **Check if balance is restored**
      const redTeamSpymaster = room.players.find(p => p.team === "Red" && p.role === "Spymaster");
      const blueTeamSpymaster = room.players.find(p => p.team === "Blue" && p.role === "Spymaster");
      const redTeamAgent = room.players.some(p => p.team === "Red" && p.role === "Agent");
      const blueTeamAgent = room.players.some(p => p.team === "Blue" && p.role === "Agent");
  
      if (redTeamSpymaster && blueTeamSpymaster && redTeamAgent && blueTeamAgent && room.gameState === "paused") {
        room.gameState = "active";
        await room.save();
        io.to(roomCode).emit("gameResumed", { message: "Game resumed!" });
      }
  
      console.log(`Player joined room: ${roomCode}`);
      io.to(roomCode).emit("updatePlayers", room.players);
    } catch (error) {
      console.error("Error handling player join:", error);
    }
  });
  

  socket.on("playerLeft", async ({ roomCode, username }) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;
  
      room.players = room.players.filter(player => player.username !== username);
      await room.save();
  
      // **Check if both teams still have at least 1 Spymaster + 1 Agent**
      const redTeamSpymaster = room.players.find(p => p.team === "Red" && p.role === "Spymaster");
      const blueTeamSpymaster = room.players.find(p => p.team === "Blue" && p.role === "Spymaster");
      const redTeamAgent = room.players.some(p => p.team === "Red" && p.role === "Agent");
      const blueTeamAgent = room.players.some(p => p.team === "Blue" && p.role === "Agent");
  
      if (!redTeamSpymaster || !blueTeamSpymaster || !redTeamAgent || !blueTeamAgent) {
        room.gameState = "paused";
        await room.save();
        io.to(roomCode).emit("gamePaused", { message: "Game paused! Not enough players. Join to resume." });
        return;
      }
  
      // **Update player list in frontend**
      io.to(roomCode).emit("updatePlayers", room.players);
      console.log(`Updated player list for room: ${roomCode}`);
    } catch (error) {
      console.error("Error handling player leaving:", error);
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
        // **Store latest action to prevent wrong turn switches**
        room.lastAction = { team: room.currentTurnTeam, type: "guess", timestamp: Date.now() };
  
        room.currentHint = "";
        room.currentTurnTeam = room.currentTurnTeam === "Red" ? "Blue" : "Red";
        room.timerStartTime = Date.now();
        await room.save();
  
        io.to(roomCode).emit("turnSwitched", { currentTurnTeam: room.currentTurnTeam, timerStartTime: room.timerStartTime });
        io.to(roomCode).emit("newHint", "");
      }
  
      io.to(roomCode).emit("updateTile", { index, tileColor });
    } catch (error) {
      console.error("Error handling tile click:", error);
    }
  });

  socket.on("timerExpired", async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room || room.gameState !== "active") return;
  
      // **Check if a turn has already been switched**
      if (Date.now() - room.timerStartTime < 5000) {
        console.log(`Ignoring repeated timer expiration for room ${roomCode}`);
        return;
      }
  
      room.currentTurnTeam = room.currentTurnTeam === "Red" ? "Blue" : "Red";
      room.timerStartTime = Date.now();
      room.currentHint = ""; // Reset hint on turn switch
      await room.save();
  
      io.to(roomCode).emit("turnSwitched", { currentTurnTeam: room.currentTurnTeam, timerStartTime: room.timerStartTime });
      io.to(roomCode).emit("newHint", ""); // Clear hint for new turn
  
      console.log(`Turn switched due to timer expiration in room ${roomCode}`);
    } catch (error) {
      console.error("Error handling timer expiration:", error);
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

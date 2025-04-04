const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // Replace with frontend URL in production
    methods: ["GET", "POST", "DELETE"],
  },
});

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected successfully!"))
  .catch((error) => console.error("❌ MongoDB connection error:", error));

const roomRoutes = require("./routes/roomRoutes");
const GameRoom = require("./models/gameRoom");

app.use("/api/rooms", roomRoutes);

app.set("io", io);

io.on("connection", (socket) => {
  console.log(`🔗 A client connected: ${socket.id}`);

  // **Join Room & Resume Game if Balanced**
  socket.on("joinRoom", async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;

      const redSpymaster = room.players.find(p => p.team === "Red" && p.role === "Spymaster");
      const blueSpymaster = room.players.find(p => p.team === "Blue" && p.role === "Spymaster");
      const redAgent = room.players.some(p => p.team === "Red" && p.role === "Agent");
      const blueAgent = room.players.some(p => p.team === "Blue" && p.role === "Agent");

      if (room.gameState === "paused" && redSpymaster && blueSpymaster && redAgent && blueAgent) {
        room.gameState = "active";
        await room.save();
        io.to(roomCode).emit("gameResumed", { message: "✅ Game resumed!" });
      }

      console.log(`📢 Player joined room: ${roomCode}`);
      io.to(roomCode).emit("updatePlayers", room.players);
    } catch (error) {
      console.error("⚠️ Error handling player join:", error);
    }
  });

  // **Start Game with Minimum Team Requirements**
  socket.on("startGame", async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;

      const redSpymaster = room.players.find(p => p.team === "Red" && p.role === "Spymaster");
      const blueSpymaster = room.players.find(p => p.team === "Blue" && p.role === "Spymaster");
      const redAgent = room.players.some(p => p.team === "Red" && p.role === "Agent");
      const blueAgent = room.players.some(p => p.team === "Blue" && p.role === "Agent");

      if (!redSpymaster || !blueSpymaster || !redAgent || !blueAgent) {
        io.to(roomCode).emit("gameStartFailed", { message: "❌ Game cannot start! Each team must have at least 1 Spymaster and 1 Agent." });
        return;
      }

      room.currentTurnTeam = "Red";
      room.timerStartTime = Date.now();
      room.gameState = "active";
      await room.save();

      io.to(roomCode).emit("gameStarted", { currentTurnTeam: "Red", timerStartTime: room.timerStartTime });
    } catch (error) {
      console.error("⚠️ Error starting the game:", error);
    }
  });

  // **Handle Player Leaving & Pause Game if Required**
  socket.on("playerLeft", async ({ roomCode, username }) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;

      room.players = room.players.filter(player => player.username !== username);
      await room.save();

      const redSpymaster = room.players.find(p => p.team === "Red" && p.role === "Spymaster");
      const blueSpymaster = room.players.find(p => p.team === "Blue" && p.role === "Spymaster");
      const redAgent = room.players.some(p => p.team === "Red" && p.role === "Agent");
      const blueAgent = room.players.some(p => p.team === "Blue" && p.role === "Agent");

      if (!redSpymaster || !blueSpymaster || !redAgent || !blueAgent) {
        room.gameState = "paused";
        await room.save();
        io.to(roomCode).emit("gamePaused", { message: "⏸️ Game paused! Not enough players. Join to resume." });
        return;
      }

      io.to(roomCode).emit("updatePlayers", room.players);
    } catch (error) {
      console.error("⚠️ Error handling player leaving:", error);
    }
  });

  // **Submit Hint Validation**
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

  // **Handle Tile Click & Turn Switching**
  socket.on("tileClicked", async ({ roomCode, index }) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;
  
      room.revealedTiles[index] = true;
      const tileColor = room.patterns[index];
  
      const allRedRevealed = room.patterns.every((color, i) => color === "red" ? room.revealedTiles[i] : true);
      const allBlueRevealed = room.patterns.every((color, i) => color === "blue" ? room.revealedTiles[i] : true);
  
      if (tileColor === "black") {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: `☠️ Game Over! ${room.currentTurnTeam} team lost by clicking a black tile.` });
      } else if (allRedRevealed) {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: "🏆 Game Over! Red team wins!" });
      } else if (allBlueRevealed) {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: "🏆 Game Over! Blue team wins!" });
      } else {
        room.currentHint = "";
        room.currentTurnTeam = room.currentTurnTeam === "Red" ? "Blue" : "Red";
  
        // ✅ Debug Log - Check Timer Update
        const newTimerStartTime = Date.now();
        console.log(`🔄 Turn switched to ${room.currentTurnTeam}, Timer reset at: ${newTimerStartTime}`);
  
        room.timerStartTime = newTimerStartTime;
        await room.save();
  
        io.to(roomCode).emit("turnSwitched", { 
          currentTurnTeam: room.currentTurnTeam, 
          timerStartTime: newTimerStartTime // ✅ Ensure timer resets properly
        });
      }
  
      io.to(roomCode).emit("updateTile", { index, tileColor });
    } catch (error) {
      console.error("⚠️ Error handling tile click:", error);
    }
  });
  

socket.on("timerExpired", async ({ roomCode }) => {
  console.log("🔴 Timer Expired Event Received:", roomCode);
  
  try {
    const room = await GameRoom.findOne({ roomCode });
    if (!room || room.gameState !== "active") return;

    // Ensure turn switch logic properly updates the timer
    room.currentHint = "";
    room.currentTurnTeam = room.currentTurnTeam === "Red" ? "Blue" : "Red";
    room.timerStartTime = Date.now(); // ✅ Explicitly update timer
    
    await room.save();

    io.to(roomCode).emit("turnSwitched", { 
      currentTurnTeam: room.currentTurnTeam, 
      timerStartTime: room.timerStartTime // ✅ Send updated timerStartTime
    });
  } catch (error) {
    console.error("⚠️ Error handling timer expiry:", error);
  }
});

  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});



app.get("/", (req, res) => res.send("Server is running!"));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

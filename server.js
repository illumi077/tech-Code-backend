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

  socket.on("joinRoom", async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;

      console.log(`📢 Player joined room: ${roomCode}`);

      io.to(roomCode).emit("updatePlayers", room.players);

      // ✅ Sync latest timer state for reconnecting players
      if (room.timerEndTime) {
        io.to(socket.id).emit("timerUpdate", { timerEndTime: room.timerEndTime });
      }
    } catch (error) {
      console.error("⚠️ Error handling player join:", error);
    }
  });

  socket.on("startGame", async (roomCode) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;

      room.currentTurnTeam = "Red";
      room.timerEndTime = Date.now() + 60000; // ✅ Backend-controlled 60-second timer
      room.gameState = "active";
      await room.save();

      io.to(roomCode).emit("gameStarted", {
        currentTurnTeam: "Red",
        timerEndTime: room.timerEndTime,
      });

      // ✅ Start backend-controlled turn expiration
      scheduleTurnExpiration(roomCode);
    } catch (error) {
      console.error("⚠️ Error starting the game:", error);
    }
  });

  socket.on("submitHint", async ({ roomCode, hint, username }) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room || room.gameState !== "active") return;

      const spymaster = room.players.find((player) => player.username === username);
      if (!spymaster || spymaster.role !== "Spymaster" || spymaster.team !== room.currentTurnTeam) return;

      if (room.currentHint) {
        io.to(roomCode).emit("hintRejected", { message: "❌ You can only submit one hint per turn!" });
        return;
      }

      room.currentHint = hint;
      await room.save();

      io.to(roomCode).emit("newHint", hint);
    } catch (error) {
      console.error("⚠️ Error storing hint:", error);
    }
  });

  socket.on("tileClicked", async ({ roomCode, index }) => {
    try {
      const room = await GameRoom.findOne({ roomCode });
      if (!room) return;

      room.revealedTiles[index] = true;
      const tileColor = room.patterns[index];

      const allRedRevealed = room.patterns.every((color, i) =>
        color === "red" ? room.revealedTiles[i] : true
      );
      const allBlueRevealed = room.patterns.every((color, i) =>
        color === "blue" ? room.revealedTiles[i] : true
      );

      if (tileColor === "black") {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: `☠️ Game Over! ${room.currentTurnTeam} team lost by clicking a black tile.` });
      } else if (allRedRevealed) {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: "🏆 Red team wins!" });
      } else if (allBlueRevealed) {
        room.gameState = "ended";
        await room.save();
        io.to(roomCode).emit("gameEnded", { result: "🏆 Blue team wins!" });
      } else {
        room.currentHint = "";
        room.currentTurnTeam = room.currentTurnTeam === "Red" ? "Blue" : "Red";

        room.timerEndTime = Date.now() + 60000;
        await room.save();

        io.to(roomCode).emit("turnSwitched", {
          currentTurnTeam: room.currentTurnTeam,
          timerEndTime: room.timerEndTime,
        });

        // ✅ Restart backend-controlled timer
        scheduleTurnExpiration(roomCode);
      }

      io.to(roomCode).emit("updateTile", { index, tileColor });
    } catch (error) {
      console.error("⚠️ Error handling tile click:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

const scheduleTurnExpiration = async (roomCode) => {
  setTimeout(async () => {
    const room = await GameRoom.findOne({ roomCode });
    if (!room || room.gameState !== "active") return;

    if (Date.now() >= room.timerEndTime) {
      console.log("🚨 Time expired! Switching turn...");

      room.currentHint = "";
      room.currentTurnTeam = room.currentTurnTeam === "Red" ? "Blue" : "Red";
      room.timerEndTime = Date.now() + 60000;
      await room.save();

      io.to(roomCode).emit("turnSwitched", {
        currentTurnTeam: room.currentTurnTeam,
        timerEndTime: room.timerEndTime,
      });

      // ✅ Schedule next turn expiration
      scheduleTurnExpiration(roomCode);
    }
  }, 60000);
};

app.get("/", (req, res) => res.send("Server is running!"));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

const express = require('express');
const router = express.Router();
const GameRoom = require('../models/gameRoom');
const { getRandomWords } = require('../data/words');
const predefinedPatterns = require('../data/pattern').default;

// Create a new game room
router.post('/create', async (req, res) => {
  try {
    const { roomCode, creator } = req.body;

    if (!creator || !creator.username || !creator.role || !creator.team) {
      return res.status(400).json({ error: 'Missing creator details (username, role, team).' });
    }

    const existingRoom = await GameRoom.findOne({ roomCode });
    if (existingRoom) {
      return res.status(400).json({ error: 'Room code already exists.' });
    }

    const wordSet = getRandomWords();
    const randomPatternIndex = Math.floor(Math.random() * predefinedPatterns.length);
    const patterns = predefinedPatterns[randomPatternIndex];

    if (!patterns || patterns.length !== 25) {
      return res.status(500).json({ error: 'Invalid pattern data.' });
    }

    const revealedTiles = Array(25).fill(false);

    const newRoom = await GameRoom.create({
      roomCode,
      wordSet,
      patterns,
      revealedTiles,
      players: [creator],
      currentTurnTeam: null,
      gameState: 'waiting',
      timerStartTime: null,
    });

    res.status(201).json(newRoom);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create room.', details: error.message });
  }
});

// Join an existing game room
router.post('/join', async (req, res) => {
  try {
    const { roomCode, username, role, team } = req.body;

    if (!roomCode || !username || !role || !team) {
      return res.status(400).json({ error: 'Missing player details (roomCode, username, role, team).' });
    }

    const room = await GameRoom.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    if (role === 'Spymaster') {
      const existingSpymaster = room.players.find(
        (player) => player.role === 'Spymaster' && player.team === team
      );
      if (existingSpymaster) {
        return res.status(400).json({ error: `A Spymaster already exists for the ${team} team.` });
      }
    }

    const existingPlayer = room.players.find((player) => player.username === username);
    if (existingPlayer) {
      return res.status(400).json({ error: 'Player with this username already exists in the room.' });
    }

    room.players.push({ username, role, team });
    await room.save();

    const io = req.app.get('io');
    io.to(roomCode).emit('updatePlayers', room.players);

    // ✅ Broadcast game resumption if teams are balanced
    const redSpymaster = room.players.find(p => p.team === "Red" && p.role === "Spymaster");
    const blueSpymaster = room.players.find(p => p.team === "Blue" && p.role === "Spymaster");
    const redAgent = room.players.some(p => p.team === "Red" && p.role === "Agent");
    const blueAgent = room.players.some(p => p.team === "Blue" && p.role === "Agent");

    if (room.gameState === "paused" && redSpymaster && blueSpymaster && redAgent && blueAgent) {
      room.gameState = "active";
      await room.save();
      io.to(roomCode).emit("gameResumed", { message: "✅ Game resumed!" });
    }

    res.status(200).json({ message: 'Player added successfully.', players: room.players });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join room.', details: error.message });
  }
});

// Start the game
router.post('/startGame', async (req, res) => {
  try {
    const { roomCode } = req.body;

    const room = await GameRoom.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    room.currentTurnTeam = 'Red';
    room.timerEndTime = Date.now() + 60000; // ✅ Use backend-controlled expiration logic
    room.gameState = 'active';
    await room.save();

    const io = req.app.get('io');
    io.to(roomCode).emit('gameStarted', {
      currentTurnTeam: 'Red',
      timerEndTime: room.timerEndTime, // ✅ Sync the correct timer
    });

    res.status(200).json({ message: 'Game started successfully.', timerEndTime: room.timerEndTime });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start the game.', details: error.message });
  }
});

// End the current turn
router.post('/endTurn', async (req, res) => {
  try {
    const { roomCode } = req.body;

    const room = await GameRoom.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    if (room.gameState !== 'active') {
      return res.status(400).json({ error: 'Game is not active.' });
    }

    // ✅ Prevent multiple turn switches from happening too quickly
    if (Date.now() < room.timerEndTime) {
      return res.status(400).json({ error: 'Turn cannot switch before timer expires.' });
    }

    room.currentTurnTeam = room.currentTurnTeam === 'Red' ? 'Blue' : 'Red';
    room.timerEndTime = Date.now() + 60000; // ✅ Reset backend-controlled timer
    await room.save();

    const io = req.app.get('io');
    io.to(roomCode).emit('turnSwitched', {
      currentTurnTeam: room.currentTurnTeam,
      timerEndTime: room.timerEndTime,
    });

    res.status(200).json({ message: 'Turn ended successfully.', timerEndTime: room.timerEndTime });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end turn.', details: error.message });
  }
});

// Get the game state for a specific room
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;

    const room = await GameRoom.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    res.status(200).json(room);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch room state.', details: error.message });
  }
});

// Leave a game room
router.delete('/leave', async (req, res) => {
  try {
    const { roomCode, username } = req.body;

    const room = await GameRoom.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    const updatedPlayers = room.players.filter((player) => player.username !== username);
    room.players = updatedPlayers;

    if (updatedPlayers.length === 0) {
      await GameRoom.deleteOne({ roomCode });
      return res.status(200).json({ message: 'Room deleted as no players remain.' });
    }

    await room.save();

    const io = req.app.get('io');
    io.to(roomCode).emit('updatePlayers', updatedPlayers);
    res.status(200).json({ message: 'Player removed successfully.', players: updatedPlayers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove player.', details: error.message });
  }
});

router.get("/:roomCode/hint", async (req, res) => {
  try {
    const room = await GameRoom.findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ error: "Room not found" });

    // console.log("🔍 API Returning Hint:", room.currentHint); 
    res.json({ currentHint: room.currentHint || "" });
  } catch (error) {
    console.error("⚠️ Error fetching hint:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

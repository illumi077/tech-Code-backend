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
    room.timerStartTime = Date.now();
    room.gameState = 'active';
    await room.save();

    const io = req.app.get('io');
    io.to(roomCode).emit('gameStarted', { currentTurnTeam: 'Red', timerStartTime: room.timerStartTime });
    res.status(200).json({ message: 'Game started successfully.' });
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

    room.currentTurnTeam = room.currentTurnTeam === 'Red' ? 'Blue' : 'Red';
    room.timerStartTime = Date.now();
    await room.save();

    const io = req.app.get('io');
    io.to(roomCode).emit('turnSwitched', { currentTurnTeam: room.currentTurnTeam, timerStartTime: room.timerStartTime });
    res.status(200).json({ message: 'Turn ended successfully.' });
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

router.post("/:roomCode/hint", async (req, res) => {
  try {
    const { hint, username } = req.body;
    const room = await GameRoom.findOne({ roomCode: req.params.roomCode });

    if (!room || room.gameState !== "active") {
      return res.status(400).json({ error: "Game is not active or room does not exist." });
    }

    const spymaster = room.players.find((player) => player.username === username);
    if (!spymaster || spymaster.role !== "Spymaster" || spymaster.team !== room.currentTurnTeam) {
      return res.status(403).json({ error: "Only the Spymaster can submit hints." });
    }

    if (room.currentHint) {
      return res.status(409).json({ error: "❌ You can only submit one hint per turn!" });
    }

    console.log("📝 Hint received via manual API:", hint);

    // ✅ Store hint in MongoDB
    room.currentHint = hint;
    await room.save();

    console.log("📢 Hint saved in database via API:", hint);
    io.to(req.params.roomCode).emit("newHint", hint);

    res.json({ message: "✅ Hint successfully saved.", currentHint: room.currentHint });
  } catch (error) {
    console.error("⚠️ Error storing hint via API:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

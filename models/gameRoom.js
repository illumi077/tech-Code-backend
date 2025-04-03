const mongoose = require('mongoose');

const gameRoomSchema = new mongoose.Schema({
  roomCode: { type: String, required: true, unique: true }, // Unique identifier for the game room
  wordSet: Array,                                           // Array of words for the game board
  patterns: [String],                                       // Tile color patterns (e.g., red/blue/black/grey)
  revealedTiles: Array,                                     // Boolean array tracking revealed tiles
  players: [                                                // Players in the game
    {
      username: { type: String, required: true },           // Player's name
      role: { type: String, enum: ['Spymaster', 'Agent'], required: true },
      team: { type: String, enum: ['Red', 'Blue'], required: true },
    },
  ],
  currentTurnTeam: { type: String, enum: ['Red', 'Blue'], default: null }, // Tracks whose turn it is
  timerStartTime: { type: Date, default: null },            // Timestamp for the start of the current turn
  gameState: { type: String, enum: ['waiting', 'active','paused', 'ended'], default: 'waiting' }, // Game state
  turnHistory: [                                            // Optional: Log of all turns for debugging/future replays
    {
      team: { type: String, enum: ['Red', 'Blue'], required: true },
      guess: { type: String, required: true },              // Word guessed during the turn
      result: { type: String, enum: ['correct', 'wrong', 'black'], required: true }, // Outcome of the guess
      timestamp: { type: Date, default: Date.now },         // Timestamp of the turn
    },
  ],
  timestamp: { type: Date, default: Date.now },
  currentHint: { type: String, default: '' }, // Store the latest hint

});

module.exports = mongoose.model('GameRoom', gameRoomSchema);
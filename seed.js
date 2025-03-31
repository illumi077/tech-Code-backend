const mongoose = require('mongoose');
const dotenv = require('dotenv');
const GameRoom = require('./models/gameRoom'); // Import GameRoom schema

dotenv.config(); // Load environment variables

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected for seeding!'))
  .catch((error) => console.error('MongoDB connection error:', error));

// Sample data for seeding
const sampleData = async () => {
  try {
    // Clear existing data
    await GameRoom.deleteMany({});

    // Seed word sets and patterns
    const room1 = new GameRoom({
      roomCode: 'TEST111',
      wordSet: ["Tech", "Code", "AI", "Server", "Data"],
      patterns: ["red", "blue", "grey", "black", "red"],
      revealedTiles: [false, false, false, false, false],
      players: [],
    });

    const room2 = new GameRoom({
      roomCode: 'ROOM456',
      wordSet: ["Binary", "Cloud", "Virtual", "Router", "Protocol"],
      patterns: ["blue", "grey", "red", "black", "blue"],
      revealedTiles: [false, false, false, false, false],
      players: [],
    });

    // Save to database
    await room1.save();
    await room2.save();

    console.log('Database seeded successfully!');
    mongoose.connection.close();
  } catch (error) {
    console.error('Seeding error:', error);
    mongoose.connection.close();
  }
};

// Call the seeding function
sampleData();
// This script connects to MongoDB, clears any existing data, and inserts sample game rooms with word sets and patterns. The sample data is then saved to the database, and the connection is closed. This script can be run manually to seed the database with initial data.
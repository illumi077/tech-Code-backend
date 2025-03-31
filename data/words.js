// words.js

// Pool of 150 tech-related terms
const words = [
    "Backup", "Graphics Card", "Syntax", "Cloud Storage", "Pixel", "Browser", "String", "Firewall", "Compile Error", 
    "CPU Fan", "Database", "DNS", "Event Listener", "Shading", "NFC", "Rendering", "Encryption", "Test Case", 
    "Avatar", "Power Supply", "Frame", "Resolution", "Logs", "Operating System", "Streaming", "Boolean", 
    "Code Editor", "Driver", "Cache", "Router", "Rendering Engine", "Tool", "Arrow Function", "Toolbar", 
    "Phishing", "Git Commit", "FPS", "Test Case", "Inventory", "Patch", "Mail Server", "Index", "For Loop", 
    "Variable", "Spreadsheets", "GPU", "HTTPS", "Presentation", "Class Constructor", "Loader", "Bluetooth", 
    "Clipboard", "Map Rendering", "Hub", "Malware", "URL Path", "AI Training", "Column Definition", "Power Mode", 
    "2D Map Rendering", "Data Tree Parsing", "Program Manager"
  ];
  
  
  // Function to get 25 random words
  const getRandomWords = () => {
    const shuffled = words.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 25); // Pick the first 25 random words
  };
  
  // Export the word pool and the function
  module.exports = { words, getRandomWords };
  
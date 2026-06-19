// Curated web game catalog. These are HTML5 games that work when proxied.
// Organized by category. Each entry:
//   { id, title, url, category, description, thumbnail? }
// The URL is proxied through Lux when launched.

window.__luxGamesCatalog = [
  // ---- Action ----
  { id: "a1", title: "Superhot Prototype", url: "https://superhot-prototype.s3.amazonaws.com/index.html", category: "Action", description: "Time moves only when you move." },
  { id: "a2", title: "HexGL", url: "https://hexgl.bkcore.com", category: "Action", description: "Fast-paced futuristic racing." },
  { id: "a3", title: "Radius Raid", url: "https://js13kgames.com/games/radius-raid/index.html", category: "Action", description: "Space shooter." },

  // ---- Puzzle ----
  { id: "p1", title: "2048", url: "https://play2048.co", category: "Puzzle", description: "Merge tiles to reach 2048." },
  { id: "p2", title: "Sudoku", url: "https://sudoku.com", category: "Puzzle", description: "Classic number puzzle." },
  { id: "p3", title: "Wordle", url: "https://www.nytimes.com/games/wordle/index.html", category: "Puzzle", description: "Guess the 5-letter word." },

  // ---- Retro ----
  { id: "r1", title: "NES Emulator", url: "https://js13kgames.com/games/nes-racer/index.html", category: "Retro", description: "Retro racing game." },
  { id: "r2", title: "DOOM (Emscripten)", url: "https://www.webrtc-experiment.com/Doom", category: "Retro", description: "Classic DOOM in the browser." },
  { id: "r3", title: "Wolfenstein 3D", url: "https://wolfenstein.bethsoft.com", category: "Retro", description: "Classic FPS." },

  // ---- Sports ----
  { id: "s1", title: "Pong", url: "https://js13kgames.com/games/pong/index.html", category: "Sports", description: "Classic paddle ball." },
  { id: "s2", title: "Ski Free", url: "https://www.skifree.com", category: "Sports", description: "Avoid the abominable snowman." },

  // ---- Strategy ----
  { id: "t1", title: "Chess", url: "https://www.chess.com", category: "Strategy", description: "Play chess online." },
  { id: "t2", title: "Tic-Tac-Toe", url: "https://js13kgames.com/games/tictactoe/index.html", category: "Strategy", description: "Classic three-in-a-row." },
];

export default window.__luxGamesCatalog;

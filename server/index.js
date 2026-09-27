const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "..", "public")));

const rooms = new Map();
const MAX_PLAYERS = 8;
const TOTAL_ROUNDS = 8;

const prompts = [
  { text: "You find $100 on the ground. What do you do?", options: ["Keep it", "Hand it in", "Split it with someone"] },
  { text: "Your team gets one superpower for a day. Pick one.", options: ["Time travel", "Invisibility", "Mind reading"] },
  { text: "A friend asks for your last slice of pizza.", options: ["Give it away", "Share it", "Keep it"] },
  { text: "You can instantly master one skill.", options: ["Coding", "Music", "Public speaking"] },
  { text: "Your group must escape a locked room.", options: ["Search", "Break something", "Work together"] },
  { text: "Pick a vacation with your friends.", options: ["Beach", "Mountains", "City"] },
  { text: "You receive one free upgrade.", options: ["Phone", "Laptop", "Travel"] },
  { text: "You must choose a team captain.", options: ["Most experienced", "Most confident", "Random player"] }
];

const chaos = [
  { name: "REVERSE", text: "The least popular answer gets +3 bonus points.", type: "least" },
  { name: "DOUBLE TROUBLE", text: "All prediction and mission points are doubled.", type: "double" },
  { name: "MIRROR", text: "Predictions are worth +5 instead of +3.", type: "prediction5" },
  { name: "WILDCARD", text: "The most popular answer gets +3 bonus points.", type: "most" },
  { name: "SOLO", text: "The player with the fewest points gets +5 comeback points.", type: "comeback" },
  { name: "SILENCE", text: "No answer distribution is shown until scoring is complete.", type: "silence" },
  { name: "STEAL", text: "The player with the most successful predictions steals 2 points from the leader.", type: "steal" },
  { name: "CHAOS", text: "Every player gets +1 participation point this round.", type: "participation" }
];

const missionTemplates = [
  "Match the answer of at least 2 other players.",
  "Be the only player selecting your answer.",
  "Successfully predict at least 2 players.",
  "Do NOT choose the most popular answer.",
  "Choose the same answer as the player immediately before you.",
  "Finish this round with exactly 2 successful predictions.",
  "Choose an answer that is not the first option.",
  "Be part of the majority choice."
];

function code() {
  let c;
  do c = Math.random().toString(36).slice(2, 7).toUpperCase();
  while (rooms.has(c));
  return c;
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    prompt: room.prompt,
    chaos: room.chaos,
    reveal: room.reveal,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, score: p.score, ready: p.ready
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", publicRoom(room));
}

function makeMissions(room) {
  const used = new Set();
  for (const p of room.players.values()) {
    let i;
    do i = Math.floor(Math.random() * missionTemplates.length);
    while (used.has(i) && used.size < missionTemplates.length);
    used.add(i);
    p.mission = missionTemplates[i];
  }
}

function startRound(room) {
  room.status = "answering";
  room.reveal = null;
  room.prompt = prompts[(room.round - 1) % prompts.length];
  room.chaos = chaos[Math.floor(Math.random() * chaos.length)];
  for (const p of room.players.values()) p.answer = null;
  makeMissions(room);

  for (const p of room.players.values()) {
    io.to(p.id).emit("mission", { text: p.mission });
  }
  broadcast(room);
}

function calculate(room) {
  const players = [...room.players.values()];
  const counts = {};
  for (const p of players) counts[p.answer] = (counts[p.answer] || 0) + 1;

  const max = Math.max(...Object.values(counts));
  const min = Math.min(...Object.values(counts));
  const most = Object.keys(counts).filter(k => counts[k] === max);
  const least = Object.keys(counts).filter(k => counts[k] === min);

  const results = players.map(p => {
    const predictions = players.filter(q => q.id !== p.id && q.answer === p.answer).length;
    let gained = predictions * (room.chaos.type === "prediction5" ? 5 : 3);

    const mission = evaluateMission(p, players, counts);
    if (mission) gained += room.chaos.type === "double" ? 10 : 5;

    if (room.chaos.type === "least" && least.includes(p.answer)) gained += 3;
    if (room.chaos.type === "most" && most.includes(p.answer)) gained += 3;
    if (room.chaos.type === "participation") gained += 1;

    return {
      id: p.id, name: p.name, answer: p.answer,
      predictions, mission, gained
    };
  });

  if (room.chaos.type === "comeback") {
    const low = Math.min(...players.map(p => p.score));
    results.forEach(r => {
      if (players.find(p => p.id === r.id).score === low) r.gained += 5;
    });
  }

  results.forEach(r => {
    const p = room.players.get(r.id);
    p.score += r.gained;
  });

  if (room.chaos.type === "steal") {
    const bestPred = Math.max(...results.map(r => r.predictions));
    const winner = results.find(r => r.predictions === bestPred);
    const leader = [...room.players.values()].sort((a,b) => b.score - a.score)[0];
    if (winner && leader && winner.id !== leader.id && leader.score >= 2) {
      leader.score -= 2;
      room.players.get(winner.id).score += 2;
    }
  }

  room.reveal = { counts, results, leaderboard: [...room.players.values()]
    .map(p => ({id:p.id,name:p.name,score:p.score}))
    .sort((a,b)=>b.score-a.score) };
  room.status = "reveal";
}

function evaluateMission(p, players, counts) {
  const answers = players.map(q => q.answer);
  const n = players.length;
  if (p.mission.includes("Match the answer")) return counts[p.answer] >= 3;
  if (p.mission.includes("only player")) return counts[p.answer] === 1;
  if (p.mission.includes("predict at least 2")) return answers.filter(a => a === p.answer).length >= 3;
  if (p.mission.includes("Do NOT")) return counts[p.answer] < Math.max(...Object.values(counts));
  if (p.mission.includes("immediately before")) {
    const idx = players.findIndex(q => q.id === p.id);
    if (idx === 0) return false;
    return players[idx-1].answer === p.answer;
  }
  if (p.mission.includes("exactly 2")) return answers.filter(a => a === p.answer).length === 3;
  if (p.mission.includes("not the first")) return Number(p.answer) !== 0;
  if (p.mission.includes("majority")) return counts[p.answer] === Math.max(...Object.values(counts));
  return false;
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}) => {
    const room = { code: code(), status:"lobby", round:1, prompt:null, chaos:null, reveal:null, players:new Map() };
    room.players.set(socket.id, {id:socket.id,name:String(name||"Player").slice(0,20),score:0,ready:false,answer:null});
    rooms.set(room.code, room);
    socket.join(room.code);
    socket.data.room = room.code;
    socket.emit("roomCreated", room.code);
    broadcast(room);
  });

  socket.on("joinRoom", ({roomCode,name}) => {
    const room = rooms.get(String(roomCode||"").toUpperCase());
    if (!room) return socket.emit("errorMessage","Room not found.");
    if (room.players.size >= MAX_PLAYERS) return socket.emit("errorMessage","Room is full.");
    if (room.status !== "lobby") return socket.emit("errorMessage","Game already started.");
    room.players.set(socket.id,{id:socket.id,name:String(name||"Player").slice(0,20),score:0,ready:false,answer:null});
    socket.join(room.code);
    socket.data.room = room.code;
    broadcast(room);
  });

  socket.on("ready", () => {
    const room = rooms.get(socket.data.room); if (!room) return;
    const p = room.players.get(socket.id); if (!p) return;
    p.ready = !p.ready;
    broadcast(room);
    if (room.players.size >= 2 && [...room.players.values()].every(x=>x.ready)) startRound(room);
  });

  socket.on("answer", ({answer}) => {
    const room = rooms.get(socket.data.room); if (!room || room.status !== "answering") return;
    const p = room.players.get(socket.id); if (!p || p.answer !== null) return;
    p.answer = Number(answer);
    if ([...room.players.values()].every(x => x.answer !== null)) {
      calculate(room);
      broadcast(room);
    } else broadcast(room);
  });

  socket.on("nextRound", () => {
    const room = rooms.get(socket.data.room); if (!room || room.status !== "reveal") return;
    if (room.round >= TOTAL_ROUNDS) {
      room.status = "finished";
      broadcast(room);
      return;
    }
    room.round++;
    startRound(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.room); if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) rooms.delete(room.code);
    else broadcast(room);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Chaos Link running on port " + (process.env.PORT || 3000));
});
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 1000 * 60 * 60 * 8;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

function roomCode() {
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function createRoomId() {
  let id = roomCode();
  while (rooms.has(id)) id = roomCode();
  return id;
}

function publicRoom(room) {
  return {
    roomId: room.id,
    state: room.state,
    players: {
      W: Boolean(room.players.W),
      B: Boolean(room.players.B),
    },
  };
}

function pruneRooms() {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    const empty = !room.players.W && !room.players.B && room.spectators.size === 0;
    if (empty || now - room.updatedAt > ROOM_TTL_MS) rooms.delete(id);
  }
}

app.get("/", (_req, res) => {
  res.json({ ok: true, name: "Stronghold multiplayer server", rooms: rooms.size });
});

io.on("connection", (socket) => {
  socket.data.rooms = new Set();

  socket.on("createGame", ({ state, player: requestedPlayer }, ack = () => {}) => {
    pruneRooms();
    if (!state || typeof state !== "object") {
      ack({ ok: false, error: "Missing game state." });
      return;
    }

    const id = createRoomId();
    const player = requestedPlayer === "B" ? "B" : "W";
    const room = {
      id,
      state,
      players: { W: player === "W" ? socket.id : null, B: player === "B" ? socket.id : null },
      spectators: new Set(),
      updatedAt: Date.now(),
    };
    rooms.set(id, room);
    socket.join(id);
    socket.data.rooms.add(id);
    ack({ ok: true, roomId: id, player, state: room.state });
  });

  socket.on("joinGame", ({ roomId }, ack = () => {}) => {
    pruneRooms();
    const id = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(id);
    if (!room) {
      ack({ ok: false, error: "Online room not found." });
      return;
    }

    let player = null;
    if (!room.players.W) {
      room.players.W = socket.id;
      player = "W";
    } else if (!room.players.B) {
      room.players.B = socket.id;
      player = "B";
    } else {
      room.spectators.add(socket.id);
    }

    room.updatedAt = Date.now();
    socket.join(id);
    socket.data.rooms.add(id);
    ack({ ok: true, roomId: id, player, state: room.state, room: publicRoom(room) });
    socket.to(id).emit("playersUpdated", publicRoom(room));
  });

  socket.on("submitState", ({ roomId, state }, ack = () => {}) => {
    const id = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(id);
    if (!room) {
      ack({ ok: false, error: "Online room not found." });
      socket.emit("onlineError", "Online room not found.");
      return;
    }

    const expectedPlayer = room.state && room.state.turn;
    if (!expectedPlayer || room.players[expectedPlayer] !== socket.id) {
      ack({ ok: false, error: "It is not your turn." });
      socket.emit("onlineError", "It is not your turn.");
      return;
    }

    if (!state || typeof state !== "object") {
      ack({ ok: false, error: "Missing game state." });
      return;
    }

    room.state = state;
    room.updatedAt = Date.now();
    io.to(id).emit("gameUpdated", { roomId: id, state: room.state });
    ack({ ok: true });
  });

  socket.on("disconnect", () => {
    for (const id of socket.data.rooms || []) {
      const room = rooms.get(id);
      if (!room) continue;
      if (room.players.W === socket.id) room.players.W = null;
      if (room.players.B === socket.id) room.players.B = null;
      room.spectators.delete(socket.id);
      room.updatedAt = Date.now();
      if (!room.players.W && !room.players.B && room.spectators.size === 0) {
        rooms.delete(id);
      } else {
        socket.to(id).emit("playersUpdated", publicRoom(room));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Stronghold multiplayer server listening on ${PORT}`);
});

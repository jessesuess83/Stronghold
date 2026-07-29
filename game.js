const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const SIDE = 4;
const RADIUS = SIDE - 1;
const HEX_SIZE = 62;
const KNIGHT_MOVE_LIMIT = 5;
const KNIGHT_HIT_RADIUS = 20;
const EDGE_HIT_RADIUS = 7;
const TOUCH_EDGE_HIT_RADIUS = 12;
const TOUCH_CONFIRM_EDGE_HIT_RADIUS = 16;
const CASTLE_HIT_RADIUS = 30;
const TOUCH_CASTLE_HIT_RADIUS = 42;
const TOUCH_CONFIRM_CASTLE_HIT_RADIUS = 50;
const CASTLE_TILE_RESERVE = 3;
const WIN_CASTLE_COUNT = 4;
const BOARD_SCALE = 0.99;
const PLAYERS = {
  W: { name: "White", wallColor: "#f8f4e8", pieceColor: "#fffdf7", text: "#1f252c" },
  B: { name: "Black", wallColor: "#1f252c", pieceColor: "#1f252c", text: "#fffaf0" },
};
const ASSET_PATHS = {
  knightW: "assets/knight-white.png",
  knightB: "assets/knight-black.png",
  castleW: "assets/castle-white.png",
  castleB: "assets/castle-black.png",
  capitalDark: "assets/capital-dark.png",
  capitalLight: "assets/capital-light.png",
};
const ONLINE_SERVER_URL = localStorage.getItem("strongholdServerUrl") || "https://stronghold-mulitplayer.onrender.com";

const els = {
  turnTitle: document.getElementById("turnTitle"),
  turnChip: document.getElementById("turnChip"),
  whiteScore: document.getElementById("whiteScore"),
  blackScore: document.getElementById("blackScore"),
  whiteWalls: document.getElementById("whiteWalls"),
  blackWalls: document.getElementById("blackWalls"),
  castleReserve: document.getElementById("castleReserve"),
  castleTokens: document.querySelectorAll("[data-castle-token]"),
  winner: document.getElementById("winner"),
  whiteHud: document.getElementById("whiteHud"),
  blackHud: document.getElementById("blackHud"),
  winModal: document.getElementById("winModal"),
  winTitle: document.getElementById("winTitle"),
  confirmResetModal: document.getElementById("confirmResetModal"),
  howToModal: document.getElementById("howToModal"),
  log: document.getElementById("log"),
  undoButtons: document.querySelectorAll("[data-undo]"),
  reset: document.getElementById("resetBtn"),
  online: document.getElementById("onlineBtn"),
  onlineStatus: document.getElementById("onlineStatus"),
  onlineStatusText: document.getElementById("onlineStatusText"),
  copyLink: document.getElementById("copyLinkBtn"),
  winReset: document.getElementById("winResetBtn"),
  cancelReset: document.getElementById("cancelResetBtn"),
  confirmReset: document.getElementById("confirmResetBtn"),
  howTo: document.getElementById("howToBtn"),
  closeHowTo: document.getElementById("closeHowToBtn"),
};

let cells = [];
let vertices = new Map();
let edges = new Map();
let layout = { scale: 1, ox: 0, oy: 0, width: 0, height: 0 };
let state;
let selectedKnight = null;
let hover = null;
let pendingTouchEdge = null;
let pendingTouchCell = null;
let captureMarkers = [];
let captureAnimationFrame = null;
let history = [];
let assetsReady = false;
let resizeFrame = null;
let suppressOnlinePublish = false;
let onlineGame = {
  socket: null,
  roomId: null,
  player: null,
  inviteUrl: null,
  joined: false,
};
const assetImages = {};

function cellKey(q, r) {
  return `${q},${r}`;
}

function vertexKey(x, y) {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
}

function edgeKey(a, b) {
  return [a, b].sort().join("|");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderedHexDiameter() {
  return HEX_SIZE * layout.scale * 2;
}

function axialToPixel(q, r) {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

function hexCorners(center) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((30 + i * 60) * Math.PI) / 180;
    return {
      x: center.x + HEX_SIZE * Math.cos(angle),
      y: center.y + HEX_SIZE * Math.sin(angle),
    };
  });
}

function buildGeometry() {
  cells = [];
  vertices = new Map();
  edges = new Map();

  for (let q = -RADIUS; q <= RADIUS; q += 1) {
    for (let r = -RADIUS; r <= RADIUS; r += 1) {
      const s = -q - r;
      if (Math.abs(s) > RADIUS) continue;
      const center = axialToPixel(q, r);
      const corners = hexCorners(center);
      const vKeys = corners.map((point) => {
        const key = vertexKey(point.x, point.y);
        if (!vertices.has(key)) vertices.set(key, { key, x: point.x, y: point.y, edges: new Set() });
        return key;
      });
      const cKey = cellKey(q, r);
      const edgeKeys = vKeys.map((from, i) => {
        const to = vKeys[(i + 1) % 6];
        const key = edgeKey(from, to);
        if (!edges.has(key)) edges.set(key, { key, a: from, b: to, cells: [] });
        edges.get(key).cells.push(cKey);
        vertices.get(from).edges.add(key);
        vertices.get(to).edges.add(key);
        return key;
      });
      cells.push({ key: cKey, q, r, x: center.x, y: center.y, vertices: vKeys, edges: edgeKeys });
    }
  }
}

function neighborsOfCell(cell) {
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  return dirs.map(([dq, dr]) => cellKey(cell.q + dq, cell.r + dr));
}

function createInitialState() {
  const whiteCapital = cells.find((cell) => cell.q === -RADIUS && cell.r === 0);
  const blackCapital = cells.find((cell) => cell.q === RADIUS && cell.r === 0);
  const whiteStart = [
    whiteCapital.vertices[0],
    whiteCapital.vertices[1],
    whiteCapital.vertices[2],
    whiteCapital.vertices[4],
    whiteCapital.vertices[5],
  ];
  const blackStart = [...blackCapital.vertices].slice(1, 6);
  return {
    turn: "W",
    winner: null,
    walls: {},
    castles: {
      [whiteCapital.key]: { owner: "W", capital: true },
      [blackCapital.key]: { owner: "B", capital: true },
    },
    knights: [
      ...whiteStart.map((v, i) => ({ id: `W${i + 1}`, owner: "W", vertex: v })),
      ...blackStart.map((v, i) => ({ id: `B${i + 1}`, owner: "B", vertex: v })),
    ],
    reserves: { W: 40, B: 40, castles: { W: CASTLE_TILE_RESERVE, B: CASTLE_TILE_RESERVE } },
    log: ["White begins."],
  };
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentPlayer() {
  return state.turn;
}

function canActLocally() {
  return !onlineGame.joined || (onlineGame.player && state.turn === onlineGame.player && !state.winner);
}

function onlineRoleName(role) {
  if (role === "W" || role === "B") return PLAYERS[role].name;
  return "Spectator";
}

function enemyOf(player) {
  return player === "W" ? "B" : "W";
}

function knightAt(vertex) {
  return state.knights.find((knight) => knight.vertex === vertex);
}

function cellByKey(key) {
  return cells.find((cell) => cell.key === key);
}

function pushHistory() {
  history.push(cloneState(state));
  if (history.length > 80) history.shift();
}

function addLog(message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 8);
}

function edgeTouchesOwner(edge, owner) {
  const ownKnight = state.knights.some((knight) => knight.owner === owner && (knight.vertex === edge.a || knight.vertex === edge.b));
  const ownWall = Object.entries(state.walls).some(([key, wallOwner]) => {
    if (wallOwner !== owner) return false;
    const other = edges.get(key);
    return other.a === edge.a || other.a === edge.b || other.b === edge.a || other.b === edge.b;
  });
  return ownKnight || ownWall;
}

function edgeTouchesEnemy(edge, owner) {
  const enemy = enemyOf(owner);
  const enemyKnight = state.knights.some((knight) => knight.owner === enemy && (knight.vertex === edge.a || knight.vertex === edge.b));
  const enemyWall = Object.entries(state.walls).some(([key, wallOwner]) => {
    if (wallOwner !== enemy) return false;
    const other = edges.get(key);
    return other.a === edge.a || other.a === edge.b || other.b === edge.a || other.b === edge.b;
  });
  return enemyKnight || enemyWall;
}

function canBuildWall(edgeKeyValue, owner) {
  const edge = edges.get(edgeKeyValue);
  return Boolean(
    edge &&
      !state.walls[edgeKeyValue] &&
      state.reserves[owner] > 0 &&
      edgeTouchesOwner(edge, owner) &&
      !edgeTouchesEnemy(edge, owner),
  );
}

function wallCountForCell(cell, owner) {
  return cell.edges.filter((key) => state.walls[key] === owner).length;
}

function hasCastleSpacing(cell) {
  return Object.entries(state.castles).every(([key]) => {
    const stronghold = cellByKey(key);
    const distance = hexDistance(cell, stronghold);
    return distance > 1;
  });
}

function canBuildCastle(cellKeyValue, owner) {
  return castleBuildReason(cellKeyValue, owner) === "";
}

function castleBuildReason(cellKeyValue, owner) {
  const cell = cellByKey(cellKeyValue);
  if (!cell) return "Choose a hex center.";
  if (state.castles[cellKeyValue]) return "That hex already has a castle.";
  if (state.reserves.castles[owner] <= 0) return `${PLAYERS[owner].name} has no castle tiles remaining.`;
  if (wallCountForCell(cell, owner) < 4) return "Castle needs 4 walls around that hex.";
  if (!hasCastleSpacing(cell)) return "Castle must be at least one empty hex from any capital or castle.";
  return "";
}

function knightCanReachWall(edge, knight) {
  return Boolean(knight && (edge.a === knight.vertex || edge.b === knight.vertex));
}

function isWallProtected(edgeKeyValue) {
  const edge = edges.get(edgeKeyValue);
  const wallOwner = state.walls[edgeKeyValue];
  return Boolean(
    edge &&
      wallOwner &&
      state.knights.some((knight) => knight.owner === wallOwner && (knight.vertex === edge.a || knight.vertex === edge.b)),
  );
}

function destroyerForWall(edgeKeyValue, owner) {
  const edge = edges.get(edgeKeyValue);
  if (!edge || state.walls[edgeKeyValue] !== enemyOf(owner)) return null;
  if (isWallProtected(edgeKeyValue)) return null;
  const selected = state.knights.find((knight) => knight.id === selectedKnight && knight.owner === owner);
  if (knightCanReachWall(edge, selected)) return selected;
  return state.knights.find((knight) => knight.owner === owner && knightCanReachWall(edge, knight)) || null;
}

function canDestroyWall(edgeKeyValue, owner) {
  return Boolean(destroyerForWall(edgeKeyValue, owner));
}

function legalMoveTargets(knight) {
  const enemy = enemyOf(knight.owner);
  const visited = new Set([knight.vertex]);
  const targets = new Set();
  const queue = [{ vertex: knight.vertex, depth: 0 }];

  while (queue.length) {
    const item = queue.shift();
    if (item.depth >= KNIGHT_MOVE_LIMIT) continue;
    for (const key of vertices.get(item.vertex).edges) {
      if (state.walls[key] === enemy) continue;
      const edge = edges.get(key);
      const next = edge.a === item.vertex ? edge.b : edge.a;
      const occupant = knightAt(next);
      if (occupant && occupant.owner === enemy) continue;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ vertex: next, depth: item.depth + 1 });
      }
      if (!occupant) targets.add(next);
    }
  }
  return targets;
}

function moveKnight(vertex) {
  const knight = state.knights.find((item) => item.id === selectedKnight);
  if (!knight) return false;
  if (!legalMoveTargets(knight).has(vertex)) return false;
  pushHistory();
  knight.vertex = vertex;
  addLog(`${PLAYERS[knight.owner].name} moved ${knight.id}.`);
  finishTurn();
  return true;
}

function buildWall(key) {
  const owner = currentPlayer();
  if (!canBuildWall(key, owner)) return false;
  pushHistory();
  state.walls[key] = owner;
  state.reserves[owner] -= 1;
  addLog(`${PLAYERS[owner].name} built a wall.`);
  finishTurn();
  return true;
}

function destroyWall(key) {
  const owner = currentPlayer();
  const knight = destroyerForWall(key, owner);
  if (!knight) {
    addLog(isWallProtected(key) ? "That wall is protected by an adjacent knight." : "Break needs one of your knights adjacent to an enemy wall.");
    updateUi();
    draw();
    return false;
  }
  pushHistory();
  const wallOwner = state.walls[key];
  delete state.walls[key];
  state.reserves[wallOwner] += 1;
  addLog(`${PLAYERS[knight.owner].name} broke an enemy wall.`);
  finishTurn();
  return true;
}

function buildCastle(key) {
  const owner = currentPlayer();
  const reason = castleBuildReason(key, owner);
  if (reason) {
    addLog(reason);
    updateUi();
    draw();
    return false;
  }
  pushHistory();
  state.castles[key] = { owner, capital: false };
  state.reserves.castles[owner] -= 1;
  addLog(`${PLAYERS[owner].name} raised a castle.`);
  finishTurn();
  return true;
}

function returnKnightHome(knight, fromVertex) {
  const capitalKey = Object.entries(state.castles).find(([, castle]) => castle.owner === knight.owner && castle.capital)[0];
  const capital = cellByKey(capitalKey);
  const from = vertices.get(fromVertex);
  let furthestOpen = null;
  let furthestDistance = -1;

  for (const key of capital.vertices) {
    if (knightAt(key)) continue;
    const point = vertices.get(key);
    const distance = (point.x - from.x) ** 2 + (point.y - from.y) ** 2;
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestOpen = key;
    }
  }

  knight.vertex = furthestOpen || capital.vertices[0];
  return knight.vertex;
}

function addCaptureMarker(owner, vertex, kind = "capture", delay = 0) {
  captureMarkers.push({ owner, vertex, kind, startedAt: performance.now() + delay });
  if (!captureAnimationFrame) animateCaptureMarkers();
}

function animateCaptureMarkers() {
  captureAnimationFrame = requestAnimationFrame(() => {
    captureMarkers = captureMarkers.filter((marker) => performance.now() - marker.startedAt < 1200);
    draw();
    if (captureMarkers.length) animateCaptureMarkers();
    else captureAnimationFrame = null;
  });
}

function resolveCaptures(actor) {
  const defender = enemyOf(actor);
  const captured = state.knights.filter((knight) => knight.owner === defender && legalMoveTargets(knight).size === 0);
  for (const knight of captured) {
    const capturedFrom = knight.vertex;
    addCaptureMarker(knight.owner, capturedFrom, "capture");
    const returnedTo = returnKnightHome(knight, capturedFrom);
    addCaptureMarker(knight.owner, returnedTo, "respawn", 360);
  }
  if (captured.length) addLog(`${PLAYERS[actor].name} captured ${captured.length} knight${captured.length === 1 ? "" : "s"}.`);

  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== defender) continue;
    const cell = cellByKey(key);
    if (wallCountForCell(cell, actor) >= 4) {
      castle.owner = actor;
      addLog(`${PLAYERS[actor].name} captured a castle.`);
    }
  }
}

function score(owner) {
  return Object.values(state.castles).filter((castle) => castle.owner === owner && !castle.capital).length;
}

function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(-a.q - a.r + b.q + b.r)) / 2;
}

function finishTurn() {
  const actor = currentPlayer();
  selectedKnight = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  hover = null;
  resolveCaptures(actor);
  if (score(actor) >= WIN_CASTLE_COUNT) {
    state.winner = actor;
    addLog(`${PLAYERS[actor].name} controls ${WIN_CASTLE_COUNT} castles.`);
  } else {
    state.turn = enemyOf(actor);
  }
  updateUi();
  draw();
  publishOnlineState();
}

function scheduleResize() {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    resizeCanvas();
  });
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      resizeCanvas();
    });
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(640, Math.floor(rect.width * dpr));
  canvas.height = Math.max(520, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const minX = Math.min(...xs) - HEX_SIZE * 0.95;
  const maxX = Math.max(...xs) + HEX_SIZE * 0.95;
  const minY = Math.min(...ys) - HEX_SIZE * 1.28;
  const maxY = Math.max(...ys) + HEX_SIZE * 1.28;
  const cssW = rect.width;
  const cssH = rect.height;
  layout.width = cssW;
  layout.height = cssH;
  layout.scale = Math.min(cssW / (maxX - minX), cssH / (maxY - minY)) * BOARD_SCALE;
  layout.ox = cssW / 2 - ((minX + maxX) / 2) * layout.scale;
  layout.oy = cssH / 2 - ((minY + maxY) / 2) * layout.scale;
  draw();
}

function toScreen(point) {
  return { x: point.x * layout.scale + layout.ox, y: point.y * layout.scale + layout.oy };
}

function fromScreen(x, y) {
  return { x: (x - layout.ox) / layout.scale, y: (y - layout.oy) / layout.scale };
}

function drawHex(cell, fill, stroke = "#d8dde2") {
  const points = cell.vertices.map((key) => toScreen(vertices.get(key)));
  ctx.beginPath();
  points.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawWall(key, owner, preview = false) {
  const edge = edges.get(key);
  const a = toScreen(vertices.get(edge.a));
  const b = toScreen(vertices.get(edge.b));
  const hexDiameter = renderedHexDiameter();
  const wallWidth = clamp(hexDiameter * 0.05, 4, 8);

  if (preview) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(212, 154, 36, 0.72)";
    ctx.lineWidth = wallWidth + clamp(hexDiameter * 0.045, 4, 6);
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = owner === "W" ? "#fffaf0" : "#1f252c";
  ctx.lineWidth = wallWidth;
  ctx.lineCap = "round";
  ctx.shadowColor = preview ? "rgba(212, 154, 36, 0.35)" : "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = preview ? 8 : 5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (owner === "B") {
    ctx.strokeStyle = "#06080a";
    ctx.lineWidth = clamp(hexDiameter * 0.009, 0.8, 1.4);
    ctx.stroke();
  }
}

function drawBreakPreview(key) {
  const edge = edges.get(key);
  const a = toScreen(vertices.get(edge.a));
  const b = toScreen(vertices.get(edge.b));
  const hexDiameter = renderedHexDiameter();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = "rgba(168, 75, 68, 0.92)";
  ctx.lineWidth = clamp(hexDiameter * 0.095, 8, 14);
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawImageIcon(image, x, y, size, shape, clipSize = size) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (shape === "hex") {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = ((30 + i * 60) * Math.PI) / 180;
      const px = x + (clipSize / 2) * Math.cos(angle);
      const py = y + (clipSize / 2) * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();
  }

  ctx.drawImage(image, x - size / 2, y - size / 2, size, size);

  ctx.restore();
}

function pieceContrastColor(owner) {
  return owner === "W" ? "#fffaf0" : "#20242a";
}

function drawKnightBacking(x, y, size, owner) {
  ctx.save();
  ctx.fillStyle = pieceContrastColor(owner);
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = ((30 + i * 60) * Math.PI) / 180;
    const px = x + (size / 2) * Math.cos(angle);
    const py = y + (size / 2) * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCastleBacking(x, y, size, owner) {
  ctx.save();
  ctx.fillStyle = pieceContrastColor(owner);
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = ((30 + i * 60) * Math.PI) / 180;
    const px = x + (size / 2) * Math.cos(angle);
    const py = y + (size / 2) * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCastle(cell, castle) {
  if (!assetsReady) return;
  const center = toScreen(cell);
  const hexDiameter = renderedHexDiameter();
  const borderSize = castle.capital ? Math.max(41, hexDiameter * 0.663) : clamp(hexDiameter * 0.576, 43, 75);
  const size = castle.capital ? Math.max(32, hexDiameter * 0.527) : clamp(hexDiameter * 0.544, 40, 72);
  const castleImage = castle.capital
    ? assetImages[castle.owner === "W" ? "capitalDark" : "capitalLight"]
    : assetImages[castle.owner === "W" ? "castleB" : "castleW"];
  if (castleImage?.complete && castleImage.naturalWidth > 0) {
    drawCastleBacking(center.x, center.y, borderSize, castle.owner);
    drawImageIcon(castleImage, center.x, center.y, size, castle.capital ? "none" : "hex", borderSize);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = ((30 + i * 60) * Math.PI) / 180;
      const px = center.x + (borderSize / 2) * Math.cos(angle);
      const py = center.y + (borderSize / 2) * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = pieceContrastColor(castle.owner);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.fillStyle = castle.owner === "W" ? "#fffaf0" : "#222931";
  ctx.strokeStyle = castle.capital ? "#d49a24" : "#738395";
  ctx.lineWidth = castle.capital ? 4 : 3;
  ctx.beginPath();
  ctx.moveTo(-20, 16);
  ctx.lineTo(-20, -8);
  ctx.lineTo(-11, -8);
  ctx.lineTo(-11, -19);
  ctx.lineTo(0, -11);
  ctx.lineTo(11, -19);
  ctx.lineTo(11, -8);
  ctx.lineTo(20, -8);
  ctx.lineTo(20, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = castle.owner === "W" ? "#20242a" : "#fffaf0";
  ctx.font = "900 12px system-ui";
  ctx.textAlign = "center";
  if (!castle.capital) ctx.fillText("C", 0, 6);
  ctx.restore();
}

function drawKnight(knight) {
  if (!assetsReady) return;
  const point = toScreen(vertices.get(knight.vertex));
  const selected = selectedKnight === knight.id;
  const hexDiameter = renderedHexDiameter();
  const backingSize = clamp(hexDiameter * (selected ? 0.313 : 0.277), 25, 40);
  const iconSize = clamp(hexDiameter * (selected ? 0.292 : 0.256), 23, 37);
  const selectionRadius = backingSize * 0.55;
  const knightImage = assetImages[knight.owner === "W" ? "knightB" : "knightW"];
  if (knightImage?.complete && knightImage.naturalWidth > 0) {
    drawKnightBacking(point.x, point.y, backingSize, knight.owner);
    if (selected) {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = ((30 + i * 60) * Math.PI) / 180;
        const px = point.x + selectionRadius * Math.cos(angle);
        const py = point.y + selectionRadius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = "#d49a24";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawImageIcon(knightImage, point.x, point.y, iconSize, "none");
  } else {
    ctx.beginPath();
    ctx.arc(point.x, point.y, selected ? 16 : 13, 0, Math.PI * 2);
    ctx.fillStyle = PLAYERS[knight.owner].pieceColor;
    ctx.strokeStyle = selected ? "#d49a24" : knight.owner === "W" ? "#2f3842" : "#fffaf0";
    ctx.lineWidth = selected ? 4 : 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PLAYERS[knight.owner].text;
    ctx.font = "900 15px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♞", point.x, point.y + 1);
  }
}

function drawTargets() {
  if (!selectedKnight) return;
  const knight = state.knights.find((item) => item.id === selectedKnight);
  for (const key of legalMoveTargets(knight)) {
    const point = toScreen(vertices.get(key));
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(108, 141, 85, 0.72)";
    ctx.fill();
  }
}

function drawCaptureMarkers() {
  const now = performance.now();
  for (const marker of captureMarkers) {
    const elapsed = now - marker.startedAt;
    if (elapsed < 0) continue;
    const progress = Math.min(1, elapsed / 1200);
    const point = toScreen(vertices.get(marker.vertex));
    const pulse = 1 + Math.sin(progress * Math.PI) * 0.22;
    ctx.save();
    ctx.globalAlpha = 1 - progress * 0.72;
    const outerColor = marker.kind === "respawn" ? "rgba(74, 132, 169, 0.95)" : "rgba(168, 75, 68, 0.95)";
    const innerColor = marker.kind === "respawn" ? "rgba(108, 141, 85, 0.94)" : "rgba(212, 154, 36, 0.92)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 34 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = outerColor;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 20 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = innerColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = marker.kind === "respawn" ? "rgba(74, 132, 169, 0.18)" : marker.owner === "W" ? "rgba(255, 250, 240, 0.38)" : "rgba(32, 36, 42, 0.3)";
    ctx.fill();
    ctx.restore();
  }
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  layout.width = rect.width;
  layout.height = rect.height;
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#e5e8eb";
  ctx.fillRect(0, 0, layout.width, layout.height);

  for (const cell of cells) drawHex(cell, "#b9c0c6");

  for (const [key, owner] of Object.entries(state.walls)) drawWall(key, owner);

  if (!selectedKnight && hover?.kind === "edge" && state.walls[hover.key] && canDestroyWall(hover.key, currentPlayer())) {
    drawBreakPreview(hover.key);
    for (const [key, owner] of Object.entries(state.walls)) drawWall(key, owner);
  }

  if (!selectedKnight && hover?.kind === "edge" && !state.walls[hover.key] && canBuildWall(hover.key, currentPlayer())) {
    drawWall(hover.key, currentPlayer(), true);
  }

  for (const [key, castle] of Object.entries(state.castles)) drawCastle(cellByKey(key), castle);

  if (hover?.kind === "cell" && canBuildCastle(hover.key, currentPlayer())) {
    const center = toScreen(cellByKey(hover.key));
    const castleTargetRadius = clamp(renderedHexDiameter() * (pendingTouchCell?.key === hover.key ? 0.34 : 0.3), 22, 38);
    ctx.beginPath();
    ctx.arc(center.x, center.y, castleTargetRadius, 0, Math.PI * 2);
    ctx.strokeStyle = pendingTouchCell?.key === hover.key ? "rgba(212, 154, 36, 0.92)" : "rgba(108, 141, 85, 0.9)";
    ctx.lineWidth = clamp(renderedHexDiameter() * (pendingTouchCell?.key === hover.key ? 0.05 : 0.036), 3, 6);
    ctx.stroke();
  }

  drawTargets();
  drawCaptureMarkers();
  for (const knight of state.knights) drawKnight(knight);
}

function nearestVertex(point) {
  let best = null;
  let bestDist = Infinity;
  for (const vertex of vertices.values()) {
    const dist = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (dist < bestDist) {
      best = vertex;
      bestDist = dist;
    }
  }
  return bestDist < 18 / layout.scale ? best.key : null;
}

function nearestOwnKnight(point, owner) {
  let best = null;
  let bestDist = Infinity;
  for (const knight of state.knights) {
    if (knight.owner !== owner) continue;
    const vertex = vertices.get(knight.vertex);
    const dist = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (dist < bestDist) {
      best = knight;
      bestDist = dist;
    }
  }
  return best && bestDist < KNIGHT_HIT_RADIUS / layout.scale ? best.vertex : null;
}

function nearestEdgeCandidate(point) {
  let best = null;
  let bestDist = Infinity;
  for (const edge of edges.values()) {
    const a = vertices.get(edge.a);
    const b = vertices.get(edge.b);
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / len2));
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const dist = Math.hypot(point.x - x, point.y - y);
    if (dist < bestDist) {
      best = edge;
      bestDist = dist;
    }
  }
  return { key: best?.key || null, dist: bestDist };
}

function nearestEdge(point) {
  const edge = nearestEdgeCandidate(point);
  return edge.key && edge.dist < EDGE_HIT_RADIUS / layout.scale ? edge.key : null;
}

function nearestCell(point) {
  const cell = nearestCellCandidate(point);
  return cell.key && cell.dist < HEX_SIZE * 0.72 ? cell.key : null;
}

function nearestCellCandidate(point) {
  let best = null;
  let bestDist = Infinity;
  for (const cell of cells) {
    const dist = Math.hypot(cell.x - point.x, cell.y - point.y);
    if (dist < bestDist) {
      best = cell;
      bestDist = dist;
    }
  }
  return { key: best?.key || null, dist: bestDist };
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return fromScreen(x, y);
}

function hitTest(event, options = {}) {
  const point = eventPoint(event);
  const edgeRadius = options.edgeRadius ?? EDGE_HIT_RADIUS;
  const castleRadius = options.castleRadius ?? CASTLE_HIT_RADIUS;
  const ownKnight = nearestOwnKnight(point, currentPlayer());
  if (ownKnight) return { kind: "vertex", key: ownKnight };
  if (selectedKnight) {
    const vertex = nearestVertex(point);
    if (vertex) return { kind: "vertex", key: vertex };
    const cell = nearestCell(point);
    if (cell) return { kind: "cell", key: cell };
    return null;
  }
  const castleCell = nearestCellCandidate(point);
  if (
    castleCell.key &&
    castleCell.dist < castleRadius / layout.scale &&
    canBuildCastle(castleCell.key, currentPlayer())
  ) {
    return { kind: "cell", key: castleCell.key };
  }
  const edge = nearestEdgeCandidate(point);
  if (edge.key && edge.dist < edgeRadius / layout.scale) {
    const isBreakable = state.walls[edge.key] && canDestroyWall(edge.key, currentPlayer());
    const isBuildable = !state.walls[edge.key] && canBuildWall(edge.key, currentPlayer());
    if (isBreakable || isBuildable) return { kind: "edge", key: edge.key };
  }
  const vertex = nearestVertex(point);
  if (vertex) return { kind: "vertex", key: vertex };
  const cell = nearestCell(point);
  if (cell) return { kind: "cell", key: cell };
  return null;
}

function edgeAction(key) {
  if (state.walls[key] && canDestroyWall(key, currentPlayer())) return "break";
  if (!state.walls[key] && canBuildWall(key, currentPlayer())) return "build";
  return null;
}

function updateOnlineStatus(message = null) {
  if (!els.onlineStatus) return;
  els.onlineStatus.hidden = !onlineGame.joined && !message;
  if (message) {
    els.onlineStatusText.textContent = message;
    return;
  }
  if (!onlineGame.joined) return;
  const role = onlineRoleName(onlineGame.player);
  const turn = state.winner ? `${PLAYERS[state.winner].name} won` : `${PLAYERS[state.turn].name} turn`;
  els.onlineStatusText.textContent = `Room ${onlineGame.roomId} - ${role} - ${turn}`;
}

function inviteUrlForRoom(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", roomId);
  return url.toString();
}

function loadSocketClient() {
  return new Promise((resolve, reject) => {
    if (window.io) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `${ONLINE_SERVER_URL}/socket.io/socket.io.js`;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load online server."));
    document.head.appendChild(script);
  });
}

async function connectOnlineSocket() {
  if (onlineGame.socket?.connected) return onlineGame.socket;
  updateOnlineStatus("Connecting online...");
  await loadSocketClient();
  onlineGame.socket = window.io(ONLINE_SERVER_URL, { transports: ["websocket", "polling"] });
  onlineGame.socket.on("connect_error", () => updateOnlineStatus("Online server unavailable."));
  onlineGame.socket.on("gameUpdated", ({ state: nextState }) => {
    suppressOnlinePublish = true;
    state = cloneState(nextState);
    selectedKnight = null;
    pendingTouchEdge = null;
    pendingTouchCell = null;
    hover = null;
    updateUi();
    draw();
    suppressOnlinePublish = false;
  });
  onlineGame.socket.on("roomClosed", () => {
    onlineGame.joined = false;
    updateOnlineStatus("Online room closed.");
  });
  onlineGame.socket.on("onlineError", (message) => updateOnlineStatus(message || "Online game error."));
  return onlineGame.socket;
}

function publishOnlineState() {
  if (suppressOnlinePublish || !onlineGame.joined || !onlineGame.socket?.connected || !onlineGame.player) return;
  onlineGame.socket.emit("submitState", { roomId: onlineGame.roomId, state: cloneState(state) });
}

async function createOnlineGame() {
  try {
    const socket = await connectOnlineSocket();
    socket.emit("createGame", { state: cloneState(state) }, (response) => {
      if (!response?.ok) {
        updateOnlineStatus(response?.error || "Could not create online game.");
        return;
      }
      onlineGame.roomId = response.roomId;
      onlineGame.player = response.player;
      onlineGame.inviteUrl = inviteUrlForRoom(response.roomId);
      onlineGame.joined = true;
      updateOnlineStatus();
      updateUi();
    });
  } catch (error) {
    updateOnlineStatus(error.message);
  }
}

async function joinOnlineGame(roomId) {
  try {
    const socket = await connectOnlineSocket();
    socket.emit("joinGame", { roomId }, (response) => {
      if (!response?.ok) {
        updateOnlineStatus(response?.error || "Could not join online game.");
        return;
      }
      onlineGame.roomId = response.roomId;
      onlineGame.player = response.player;
      onlineGame.inviteUrl = inviteUrlForRoom(response.roomId);
      onlineGame.joined = true;
      suppressOnlinePublish = true;
      state = cloneState(response.state);
      history = [];
      selectedKnight = null;
      pendingTouchEdge = null;
      pendingTouchCell = null;
      hover = null;
      updateUi();
      draw();
      suppressOnlinePublish = false;
    });
  } catch (error) {
    updateOnlineStatus(error.message);
  }
}

function handleBoardClick(event) {
  if (state.winner || !canActLocally()) return;
  const hit = hitTest(event);
  if (!hit) return;
  const owner = currentPlayer();

  if (hit.kind === "vertex") {
    pendingTouchEdge = null;
    pendingTouchCell = null;
    hover = null;
    const knight = knightAt(hit.key);
    if (knight && knight.owner === owner) {
      selectedKnight = selectedKnight === knight.id ? null : knight.id;
      draw();
      return;
    }
    moveKnight(hit.key);
    return;
  }

  if (hit.kind === "edge") {
    pendingTouchEdge = null;
    pendingTouchCell = null;
    if (state.walls[hit.key]) destroyWall(hit.key);
    else buildWall(hit.key);
    return;
  }

  pendingTouchEdge = null;
  pendingTouchCell = null;
  if (hit.kind === "cell" && canBuildCastle(hit.key, owner)) buildCastle(hit.key);
}

function handleBoardPointerUp(event) {
  if (event.pointerType !== "touch") {
    handleBoardClick(event);
    return;
  }

  if (state.winner || !canActLocally()) return;
  const hit = hitTest(event, {
    edgeRadius: pendingTouchEdge ? TOUCH_CONFIRM_EDGE_HIT_RADIUS : TOUCH_EDGE_HIT_RADIUS,
    castleRadius: pendingTouchCell ? TOUCH_CONFIRM_CASTLE_HIT_RADIUS : TOUCH_CASTLE_HIT_RADIUS,
  });
  const owner = currentPlayer();

  if (hit?.kind === "edge") {
    const action = edgeAction(hit.key);
    pendingTouchCell = null;
    if (action && pendingTouchEdge?.key === hit.key && pendingTouchEdge.action === action) {
      pendingTouchEdge = null;
      hover = null;
      if (action === "break") destroyWall(hit.key);
      else buildWall(hit.key);
      return;
    }
    pendingTouchEdge = { key: hit.key, action };
    hover = hit;
    draw();
    return;
  }

  if (hit?.kind === "cell" && canBuildCastle(hit.key, owner)) {
    pendingTouchEdge = null;
    if (pendingTouchCell?.key === hit.key) {
      pendingTouchCell = null;
      hover = null;
      buildCastle(hit.key);
      return;
    }
    pendingTouchCell = { key: hit.key };
    hover = hit;
    draw();
    return;
  }

  pendingTouchEdge = null;
  pendingTouchCell = null;
  hover = null;

  if (!hit) {
    draw();
    return;
  }

  if (hit.kind === "vertex") {
    const knight = knightAt(hit.key);
    if (knight && knight.owner === owner) {
      selectedKnight = selectedKnight === knight.id ? null : knight.id;
      draw();
      return;
    }
    moveKnight(hit.key);
    return;
  }

  if (hit.kind === "cell" && canBuildCastle(hit.key, owner)) buildCastle(hit.key);
  else draw();
}

function updateUi() {
  els.turnTitle.textContent = state.winner ? `${PLAYERS[state.winner].name} Wins` : `${PLAYERS[state.turn].name} Turn`;
  els.turnChip.textContent = state.winner || state.turn;
  els.turnChip.classList.toggle("black-turn", (state.winner || state.turn) === "B");
  els.whiteHud.classList.toggle("active", !state.winner && state.turn === "W");
  els.blackHud.classList.toggle("active", !state.winner && state.turn === "B");
  els.online?.classList.toggle("active", onlineGame.joined);
  els.undoButtons.forEach((button) => {
    button.disabled = onlineGame.joined;
    button.title = onlineGame.joined ? "Undo is disabled during online games" : "Undo last action";
  });
  if (els.copyLink) els.copyLink.disabled = !onlineGame.inviteUrl;
  updateOnlineStatus();
  els.whiteScore.textContent = score("W");
  els.blackScore.textContent = score("B");
  els.whiteWalls.textContent = state.reserves.W;
  els.blackWalls.textContent = state.reserves.B;
  els.castleReserve.textContent = state.reserves.castles.W + state.reserves.castles.B;
  els.castleTokens.forEach((token) => {
    const owner = token.dataset.castleToken;
    const ownerIndex = [...els.castleTokens].filter((item) => item.dataset.castleToken === owner).indexOf(token);
    const spent = ownerIndex >= state.reserves.castles[owner];
    token.hidden = spent;
    token.parentElement.hidden = spent;
  });
  els.winner.textContent = state.winner ? PLAYERS[state.winner].name : "-";
  els.winTitle.textContent = state.winner ? `${PLAYERS[state.winner].name} Wins` : "";
  els.winModal.hidden = !state.winner;
  els.log.innerHTML = state.log.map((item) => `<p>${item}</p>`).join("");
}

function resetGame() {
  if (onlineGame.joined) {
    updateOnlineStatus("New Game is local-only for now.");
    return;
  }
  state = createInitialState();
  history = [];
  selectedKnight = null;
  hover = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  captureMarkers = [];
  if (captureAnimationFrame) cancelAnimationFrame(captureAnimationFrame);
  captureAnimationFrame = null;
  updateUi();
  resizeCanvas();
}

function undoLastAction() {
  const previous = history.pop();
  if (!previous) return;
  state = previous;
  selectedKnight = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  captureMarkers = [];
  if (captureAnimationFrame) cancelAnimationFrame(captureAnimationFrame);
  captureAnimationFrame = null;
  hover = null;
  updateUi();
  draw();
}

els.undoButtons.forEach((button) => button.addEventListener("click", undoLastAction));
els.online?.addEventListener("click", createOnlineGame);
els.copyLink?.addEventListener("click", async () => {
  if (!onlineGame.inviteUrl) return;
  try {
    await navigator.clipboard.writeText(onlineGame.inviteUrl);
    updateOnlineStatus("Invite link copied.");
    setTimeout(() => updateOnlineStatus(), 1600);
  } catch (error) {
    updateOnlineStatus(onlineGame.inviteUrl);
  }
});
els.reset.addEventListener("click", () => {
  els.confirmResetModal.hidden = false;
});
els.cancelReset.addEventListener("click", () => {
  els.confirmResetModal.hidden = true;
});
els.confirmReset.addEventListener("click", () => {
  els.confirmResetModal.hidden = true;
  resetGame();
});
els.winReset.addEventListener("click", () => {
  els.winModal.hidden = true;
});
els.howTo.addEventListener("click", () => {
  els.howToModal.hidden = false;
});
els.closeHowTo.addEventListener("click", () => {
  els.howToModal.hidden = true;
});
canvas.addEventListener("pointerup", handleBoardPointerUp);
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  hover = hitTest(event);
  draw();
});
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") return;
  hover = null;
  draw();
});
window.addEventListener("resize", scheduleResize);


buildGeometry();
resetGame();
const roomFromUrl = new URLSearchParams(window.location.search).get("game");
if (roomFromUrl) joinOnlineGame(roomFromUrl.toUpperCase());

Promise.all(
  Object.entries(ASSET_PATHS).map(
    ([name, src]) =>
      new Promise((resolve) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = resolve;
        image.src = src;
        assetImages[name] = image;
      }),
  ),
).then(() => {
  assetsReady = true;
  draw();
  scheduleResize();
});

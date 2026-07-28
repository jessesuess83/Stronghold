const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const SIDE = 4;
const RADIUS = SIDE - 1;
const HEX_SIZE = 62;
const KNIGHT_MOVE_LIMIT = 5;
const KNIGHT_HIT_RADIUS = 20;
const EDGE_HIT_RADIUS = 7;
const CASTLE_HIT_RADIUS = 30;
const CASTLE_TILE_RESERVE = 6;
const WIN_CASTLE_COUNT = 4;
const BOARD_SCALE = 0.95;
const PLAYERS = {
  W: { name: "White", wallColor: "#f8f4e8", pieceColor: "#fffdf7", text: "#1f252c" },
  B: { name: "Black", wallColor: "#1f252c", pieceColor: "#1f252c", text: "#fffaf0" },
};
const ASSET_PATHS = {
  knightW: "assets/knight-white.png",
  knightB: "assets/knight-black.png",
  castleW: "assets/castle-white.png",
  castleB: "assets/castle-black.png",
};

const els = {
  turnTitle: document.getElementById("turnTitle"),
  turnChip: document.getElementById("turnChip"),
  whiteScore: document.getElementById("whiteScore"),
  blackScore: document.getElementById("blackScore"),
  whiteWalls: document.getElementById("whiteWalls"),
  blackWalls: document.getElementById("blackWalls"),
  castleReserve: document.getElementById("castleReserve"),
  winner: document.getElementById("winner"),
  whiteTurnLabel: document.getElementById("whiteTurnLabel"),
  blackTurnLabel: document.getElementById("blackTurnLabel"),
  winModal: document.getElementById("winModal"),
  winTitle: document.getElementById("winTitle"),
  log: document.getElementById("log"),
  undo: document.getElementById("undoBtn"),
  reset: document.getElementById("resetBtn"),
  winReset: document.getElementById("winResetBtn"),
};

let cells = [];
let vertices = new Map();
let edges = new Map();
let layout = { scale: 1, ox: 0, oy: 0, width: 0, height: 0 };
let state;
let selectedKnight = null;
let hover = null;
let pendingTouchEdge = null;
let history = [];
let assetsReady = false;
let resizeFrame = null;
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
    reserves: { W: 40, B: 40, castles: CASTLE_TILE_RESERVE },
    log: ["White begins."],
  };
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentPlayer() {
  return state.turn;
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

function connectedWallCountForCell(cell, owner) {
  const ownedEdges = cell.edges.filter((key) => state.walls[key] === owner);
  if (ownedEdges.length < 4) return 0;
  const remaining = new Set(ownedEdges);
  let best = 0;
  while (remaining.size) {
    const [start] = remaining;
    const stack = [start];
    remaining.delete(start);
    let size = 0;
    while (stack.length) {
      const key = stack.pop();
      size += 1;
      const edge = edges.get(key);
      for (const next of [...remaining]) {
        const other = edges.get(next);
        if (other.a === edge.a || other.a === edge.b || other.b === edge.a || other.b === edge.b) {
          remaining.delete(next);
          stack.push(next);
        }
      }
    }
    best = Math.max(best, size);
  }
  return best;
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
  if (state.reserves.castles <= 0) return "No castle tiles remain.";
  if (connectedWallCountForCell(cell, owner) < 4) return "Castle needs 4 connected walls around that hex.";
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
  state.reserves.castles -= 1;
  addLog(`${PLAYERS[owner].name} raised a castle.`);
  finishTurn();
  return true;
}

function returnKnightHome(knight) {
  const capitalKey = Object.entries(state.castles).find(([, castle]) => castle.owner === knight.owner && castle.capital)[0];
  const capital = cellByKey(capitalKey);
  const open = capital.vertices.find((key) => !knightAt(key));
  knight.vertex = open || capital.vertices[0];
}

function resolveCaptures(actor) {
  const defender = enemyOf(actor);
  const captured = state.knights.filter((knight) => knight.owner === defender && legalMoveTargets(knight).size === 0);
  for (const knight of captured) returnKnightHome(knight);
  if (captured.length) addLog(`${PLAYERS[actor].name} captured ${captured.length} knight${captured.length === 1 ? "" : "s"}.`);

  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== defender) continue;
    const cell = cellByKey(key);
    if (connectedWallCountForCell(cell, actor) >= 4) {
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
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(640, Math.floor(rect.width * dpr));
  canvas.height = Math.max(520, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const minX = Math.min(...xs) - HEX_SIZE * 0.82;
  const maxX = Math.max(...xs) + HEX_SIZE * 0.82;
  const minY = Math.min(...ys) - HEX_SIZE * 1.35;
  const maxY = Math.max(...ys) + HEX_SIZE * 1.35;
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
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = owner === "W" ? "#fffaf0" : "#1f252c";
  ctx.lineWidth = preview ? 5 : 7;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = preview ? 0 : 5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (owner === "B") {
    ctx.strokeStyle = "#06080a";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function drawBreakPreview(key) {
  const edge = edges.get(key);
  const a = toScreen(vertices.get(edge.a));
  const b = toScreen(vertices.get(edge.b));
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = "rgba(168, 75, 68, 0.92)";
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawImageIcon(image, x, y, size, shape) {
  ctx.save();
  if (shape === "hex") {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = ((30 + i * 60) * Math.PI) / 180;
      const px = x + (size / 2) * Math.cos(angle);
      const py = y + (size / 2) * Math.sin(angle);
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
  const center = toScreen(cell);
  const size = castle.capital ? 70 : 60;
  const castleImage = assetImages[castle.owner === "W" ? "castleB" : "castleW"];
  if (assetsReady && castleImage?.complete) {
    drawCastleBacking(center.x, center.y, size + 5, castle.owner);
    drawImageIcon(castleImage, center.x, center.y, size, "hex");
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = ((30 + i * 60) * Math.PI) / 180;
      const px = center.x + (size / 2) * Math.cos(angle);
      const py = center.y + (size / 2) * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = pieceContrastColor(castle.owner);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (castle.capital) {
      ctx.strokeStyle = "#d49a24";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
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
  const point = toScreen(vertices.get(knight.vertex));
  const selected = selectedKnight === knight.id;
  const knightImage = assetImages[knight.owner === "W" ? "knightB" : "knightW"];
  if (assetsReady && knightImage?.complete) {
    drawKnightBacking(point.x, point.y, selected ? 35 : 31, knight.owner);
    if (selected) {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = ((30 + i * 60) * Math.PI) / 180;
        const px = point.x + 14 * Math.cos(angle);
        const py = point.y + 14 * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = "#d49a24";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawImageIcon(knightImage, point.x, point.y, selected ? 34 : 30, "none");
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
    ctx.beginPath();
    ctx.arc(center.x, center.y, 24, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(108, 141, 85, 0.9)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  drawTargets();
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

function hitTest(event) {
  const point = eventPoint(event);
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
    castleCell.dist < CASTLE_HIT_RADIUS / layout.scale &&
    canBuildCastle(castleCell.key, currentPlayer())
  ) {
    return { kind: "cell", key: castleCell.key };
  }
  const edge = nearestEdgeCandidate(point);
  if (edge.key && edge.dist < EDGE_HIT_RADIUS / layout.scale) {
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

function handleBoardClick(event) {
  if (state.winner) return;
  const hit = hitTest(event);
  if (!hit) return;
  const owner = currentPlayer();

  if (hit.kind === "vertex") {
    pendingTouchEdge = null;
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
    if (state.walls[hit.key]) destroyWall(hit.key);
    else buildWall(hit.key);
    return;
  }

  pendingTouchEdge = null;
  if (hit.kind === "cell" && canBuildCastle(hit.key, owner)) buildCastle(hit.key);
}

function handleBoardPointerUp(event) {
  if (event.pointerType !== "touch") {
    handleBoardClick(event);
    return;
  }

  if (state.winner) return;
  const hit = hitTest(event);
  const owner = currentPlayer();

  if (hit?.kind === "edge") {
    const action = edgeAction(hit.key);
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

  pendingTouchEdge = null;
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
  els.whiteScore.textContent = score("W");
  els.blackScore.textContent = score("B");
  els.whiteWalls.textContent = state.reserves.W;
  els.blackWalls.textContent = state.reserves.B;
  els.castleReserve.textContent = state.reserves.castles;
  els.winner.textContent = state.winner ? PLAYERS[state.winner].name : "-";
  els.whiteTurnLabel.classList.toggle("active", !state.winner && state.turn === "W");
  els.blackTurnLabel.classList.toggle("active", !state.winner && state.turn === "B");
  els.winTitle.textContent = state.winner ? `${PLAYERS[state.winner].name} Wins` : "";
  els.winModal.hidden = !state.winner;
  els.log.innerHTML = state.log.map((item) => `<p>${item}</p>`).join("");
}

function resetGame() {
  state = createInitialState();
  history = [];
  selectedKnight = null;
  hover = null;
  pendingTouchEdge = null;
  updateUi();
  resizeCanvas();
}

els.undo.addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) return;
  state = previous;
  selectedKnight = null;
  pendingTouchEdge = null;
  hover = null;
  updateUi();
  draw();
});
els.reset.addEventListener("click", resetGame);
els.winReset.addEventListener("click", resetGame);
canvas.addEventListener("pointerup", handleBoardPointerUp);
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  pendingTouchEdge = null;
  hover = hitTest(event);
  draw();
});
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") return;
  hover = null;
  draw();
});
window.addEventListener("resize", () => {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    resizeCanvas();
  });
});

buildGeometry();
resetGame();

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
});

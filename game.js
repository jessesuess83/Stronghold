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
const CASTLE_TILE_RESERVE = 6;
const WIN_CASTLE_COUNT = 4;
const ACTION_MARKER_DURATION = 520;
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
const ONLINE_SERVER_URL = localStorage.getItem("strongholdServerUrl") || "https://stronghold-online.onrender.com";

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
  ai: document.getElementById("aiBtn"),
  copyAiLog: document.getElementById("copyAiLogBtn"),
  aiColorModal: document.getElementById("aiColorModal"),
  aiColorButtons: document.querySelectorAll("[data-ai-color]"),
  online: document.getElementById("onlineBtn"),
  onlineColorModal: document.getElementById("onlineColorModal"),
  onlineColorChoice: document.getElementById("onlineColorChoice"),
  onlineColorButtons: document.querySelectorAll("[data-online-color]"),
  onlineRole: document.getElementById("onlineRole"),
  onlineStatus: document.getElementById("onlineStatus"),
  copyLink: document.getElementById("copyLinkBtn"),
  winReset: document.getElementById("winResetBtn"),
  cancelReset: document.getElementById("cancelResetBtn"),
  confirmReset: document.getElementById("confirmResetBtn"),
  cancelAiColor: document.getElementById("cancelAiColorBtn"),
  cancelOnlineColor: document.getElementById("cancelOnlineColorBtn"),
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
let preferredOnlinePlayer = "W";
let aiReviewLog = [];
let aiGame = {
  enabled: false,
  player: "B",
  thinking: false,
};
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

function inputLockMarkersActive() {
  const now = performance.now();
  return captureMarkers.some((marker) => marker.blocksInput && now - marker.startedAt < ACTION_MARKER_DURATION);
}

function canActLocally() {
  if (state.winner) return false;
  if (inputLockMarkersActive()) return false;
  if (aiGame.enabled && state.turn === aiGame.player) return false;
  return !onlineGame.joined || (onlineGame.player && state.turn === onlineGame.player);
}

function onlineRoleName(role) {
  if (role === "W" || role === "B") return PLAYERS[role].name;
  return "Spectator";
}

function updateOnlineColorChoice() {
  if (els.onlineColorChoice) els.onlineColorChoice.hidden = false;
}

function showOnlineTurnBlocked() {
  if (!onlineGame.joined) return;
  const message = onlineGame.player
    ? `Waiting for ${PLAYERS[state.turn].name}. You are ${onlineRoleName(onlineGame.player)}.`
    : `Spectating. ${PLAYERS[state.turn].name} to move.`;
  updateOnlineStatus(message);
  window.setTimeout(() => updateOnlineStatus(), 1600);
}

function allowLocalBoardCommit() {
  if (canActLocally()) return true;
  selectedKnight = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  hover = null;
  showOnlineTurnBlocked();
  draw();
  return false;
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

function summarizeActionForReview(action) {
  if (!action) return null;
  if (action.type === "move") return { type: action.type, knightId: action.knightId, to: action.to };
  if (action.type === "buildWall" || action.type === "destroyWall") return { type: action.type, edge: action.edge };
  if (action.type === "buildCastle") return { type: action.type, cell: action.cell };
  return { type: action.type };
}

function reviewSnapshot() {
  return {
    turn: state.turn,
    winner: state.winner,
    score: { W: score("W"), B: score("B") },
    reserves: { W: state.reserves.W, B: state.reserves.B, castles: state.reserves.castles },
    castles: Object.fromEntries(Object.entries(state.castles).map(([key, castle]) => [key, { owner: castle.owner, capital: Boolean(castle.capital) }])),
    knights: state.knights.map((knight) => ({ id: knight.id, owner: knight.owner, vertex: knight.vertex, moves: legalMoveTargets(knight).size })),
    walls: Object.entries(state.walls).map(([edge, owner]) => [edge, owner]),
  };
}

function recordAiReviewTurn(actor, action, details = {}) {
  if (!aiGame.enabled || onlineGame.joined) return;
  const entry = {
    n: aiReviewLog.length + 1,
    actor,
    ai: actor === aiGame.player,
    action: summarizeActionForReview(action),
    after: reviewSnapshot(),
  };
  if (details.candidates?.length) entry.aiCandidates = details.candidates;
  if (details.note) entry.note = details.note;
  aiReviewLog.push(entry);
  aiReviewLog = aiReviewLog.slice(-120);
}

function aiReviewExportText() {
  const payload = {
    strongholdAiLogVersion: 1,
    exportedAt: new Date().toISOString(),
    aiPlayer: aiGame.player,
    humanPlayer: enemyOf(aiGame.player),
    final: reviewSnapshot(),
    turns: aiReviewLog,
  };
  return JSON.stringify(payload, null, 2);
}

async function copyAiReviewLog() {
  if (!aiReviewLog.length) {
    addLog("No AI game log yet.");
    updateUi();
    return;
  }
  const text = aiReviewExportText();
  try {
    await navigator.clipboard.writeText(text);
    addLog("AI game log copied.");
  } catch (error) {
    console.log(text);
    addLog("AI game log printed to console.");
  }
  updateUi();
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
  if (state.reserves.castles <= 0) return "No castle tiles remain.";
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
  if (!allowLocalBoardCommit()) return false;
  const knight = state.knights.find((item) => item.id === selectedKnight);
  if (!knight) return false;
  if (!legalMoveTargets(knight).has(vertex)) return false;
  pushHistory();
  knight.vertex = vertex;
  const action = { type: "move", knightId: knight.id, to: vertex };
  addLog(`${PLAYERS[knight.owner].name} moved ${knight.id}.`);
  finishTurn();
  recordAiReviewTurn(knight.owner, action);
  return true;
}

function buildWall(key) {
  if (!allowLocalBoardCommit()) return false;
  const owner = currentPlayer();
  if (!canBuildWall(key, owner)) return false;
  pushHistory();
  state.walls[key] = owner;
  state.reserves[owner] -= 1;
  const action = { type: "buildWall", edge: key };
  addLog(`${PLAYERS[owner].name} built a wall.`);
  finishTurn();
  recordAiReviewTurn(owner, action);
  return true;
}

function destroyWall(key) {
  if (!allowLocalBoardCommit()) return false;
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
  const action = { type: "destroyWall", edge: key };
  addLog(`${PLAYERS[knight.owner].name} broke an enemy wall.`);
  finishTurn();
  recordAiReviewTurn(knight.owner, action);
  return true;
}

function buildCastle(key) {
  if (!allowLocalBoardCommit()) return false;
  const owner = currentPlayer();
  const reason = castleBuildReason(key, owner);
  if (reason) {
    addLog(reason);
    updateUi();
    draw();
    return false;
  }
  pushHistory();
  state.castles[key] = { owner, capital: false, builtBy: owner };
  state.reserves.castles -= 1;
  const action = { type: "buildCastle", cell: key };
  addLog(`${PLAYERS[owner].name} raised a castle.`);
  finishTurn();
  recordAiReviewTurn(owner, action);
  return true;
}

function legalActionsForPlayer(owner) {
  if (state.winner) return [];
  const actions = [];

  for (const cell of cells) {
    if (canBuildCastle(cell.key, owner)) actions.push({ type: "buildCastle", cell: cell.key });
  }

  for (const [key, wallOwner] of Object.entries(state.walls)) {
    if (wallOwner === enemyOf(owner) && canDestroyWall(key, owner)) actions.push({ type: "destroyWall", edge: key });
  }

  for (const edge of edges.values()) {
    if (canBuildWall(edge.key, owner)) actions.push({ type: "buildWall", edge: edge.key });
  }

  for (const knight of state.knights) {
    if (knight.owner !== owner) continue;
    for (const target of legalMoveTargets(knight)) actions.push({ type: "move", knightId: knight.id, to: target });
  }

  return actions;
}

function mutateAction(action, owner, options = {}) {
  const writeLog = options.log ?? true;
  if (action.type === "move") {
    const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
    if (!knight || !legalMoveTargets(knight).has(action.to)) return false;
    knight.vertex = action.to;
    if (writeLog) addLog(`${PLAYERS[owner].name} moved ${knight.id}.`);
    return true;
  }
  if (action.type === "buildWall") {
    if (!canBuildWall(action.edge, owner)) return false;
    state.walls[action.edge] = owner;
    state.reserves[owner] -= 1;
    if (writeLog) addLog(`${PLAYERS[owner].name} built a wall.`);
    return true;
  }
  if (action.type === "destroyWall") {
    if (!canDestroyWall(action.edge, owner)) return false;
    const wallOwner = state.walls[action.edge];
    delete state.walls[action.edge];
    state.reserves[wallOwner] += 1;
    if (writeLog) addLog(`${PLAYERS[owner].name} broke an enemy wall.`);
    return true;
  }
  if (action.type === "buildCastle") {
    if (!canBuildCastle(action.cell, owner)) return false;
    state.castles[action.cell] = { owner, capital: false, builtBy: owner };
    state.reserves.castles -= 1;
    if (writeLog) addLog(`${PLAYERS[owner].name} raised a castle.`);
    return true;
  }
  return false;
}

function applyAction(action, options = {}) {
  const owner = currentPlayer();
  if (options.history ?? true) pushHistory();
  if (!mutateAction(action, owner, { log: options.log ?? true })) {
    if (options.history ?? true) history.pop();
    return false;
  }
  finishTurn({
    render: options.render ?? true,
    publish: options.publish ?? true,
    animate: options.animate ?? true,
    log: options.log ?? true,
  });
  return true;
}


function castleReserveGone() {
  return state.reserves.castles <= 0;
}

function builtCastleCount() {
  return CASTLE_TILE_RESERVE - state.reserves.castles;
}

function castleAttackMode(owner) {
  return castleReserveGone() || state.reserves.castles <= 1 || builtCastleCount() >= 5 || score(enemyOf(owner)) >= 3;
}

function thirdCastleUrgency(owner) {
  if (castleReserveGone() || score(owner) >= 3) return 0;
  const scoreGap = Math.max(0, score(enemyOf(owner)) - score(owner));
  const enemyNearWin = score(enemyOf(owner)) >= 3 ? 0.8 : 0;
  return 1.5 + (3 - score(owner)) * 0.9 + scoreGap * 0.45 + enemyNearWin;
}

function thirdCastleStatusScore(owner) {
  const owned = score(owner);
  if (owned >= 3) return 8600 + owned * 2200;
  return owned * 2300 - (3 - owned) * 2600;
}

function ownCastleWallPressure(edgeKeyValue, owner) {
  if (castleReserveGone()) return 0;
  const edge = edges.get(edgeKeyValue);
  if (!edge) return 0;
  const urgency = thirdCastleUrgency(owner);
  let value = 0;
  for (const cellKeyValue of edge.cells || []) {
    const cell = cellByKey(cellKeyValue);
    if (!cell || state.castles[cellKeyValue] || !hasCastleSpacing(cell)) continue;
    const afterOwnWalls = wallCountForCell(cell, owner) + (state.walls[edgeKeyValue] === owner ? 0 : 1);
    const emptyEdges = cell.edges.filter((key) => !state.walls[key] || key === edgeKeyValue).length;
    const multiplier = urgency ? 1 + urgency * 0.85 : 1;
    if (afterOwnWalls >= 4) value += 12200 * multiplier;
    else if (afterOwnWalls === 3 && emptyEdges >= 1) value += 6800 * multiplier;
    else if (afterOwnWalls === 2 && emptyEdges >= 2) value += 2600 * multiplier;
    else value += 520 * multiplier;
  }
  return value;
}

function enemyCastleWallPressure(edgeKeyValue, owner) {
  const edge = edges.get(edgeKeyValue);
  if (!edge) return 0;
  let value = 0;
  for (const cellKeyValue of edge.cells || []) {
    const cell = cellByKey(cellKeyValue);
    const castle = state.castles[cellKeyValue];
    if (!cell || castle?.owner !== enemyOf(owner) || castle.capital) continue;
    const afterOwnWalls = wallCountForCell(cell, owner) + (state.walls[edgeKeyValue] === owner ? 0 : 1);
    const enemyWalls = wallCountForCell(cell, enemyOf(owner));
    const modeMultiplier = castleAttackMode(owner) ? 1.65 : 1;
    if (afterOwnWalls >= 4) value += 28000 * modeMultiplier;
    else if (afterOwnWalls === 3) value += 14500 * modeMultiplier;
    else if (afterOwnWalls === 2) value += 5600 * modeMultiplier;
    else value += 820 * modeMultiplier;
    value += Math.max(0, 3 - enemyWalls) * 420;
  }
  return value;
}

function edgesShareVertex(firstKey, secondKey) {
  const first = edges.get(firstKey);
  const second = edges.get(secondKey);
  return Boolean(first && second && (first.a === second.a || first.a === second.b || first.b === second.a || first.b === second.b));
}

function edgeMidpoint(edgeKeyValue) {
  const edge = edges.get(edgeKeyValue);
  if (!edge) return null;
  const a = vertices.get(edge.a);
  const b = vertices.get(edge.b);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function blockedCompletionTargets(owner) {
  const targets = [];
  const enemy = enemyOf(owner);
  for (const [cellKeyValue, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== enemy) continue;
    const cell = cellByKey(cellKeyValue);
    if (!cell || wallCountForCell(cell, owner) !== 3) continue;
    for (const edgeKeyValue of cell.edges) {
      if (state.walls[edgeKeyValue] || canBuildWall(edgeKeyValue, owner)) continue;
      const edge = edges.get(edgeKeyValue);
      if (!edge) continue;
      const enemyKnightBlockers = state.knights.filter((knight) => knight.owner === enemy && (knight.vertex === edge.a || knight.vertex === edge.b));
      const enemyWallBlockers = Object.entries(state.walls)
        .filter(([key, wallOwner]) => wallOwner === enemy && edgesShareVertex(key, edgeKeyValue))
        .map(([key]) => key);
      const protectorVertices = [...new Set(
        enemyWallBlockers
          .filter((key) => isWallProtected(key))
          .flatMap((key) => {
            const wall = edges.get(key);
            return state.knights
              .filter((knight) => knight.owner === enemy && (knight.vertex === wall.a || knight.vertex === wall.b))
              .map((knight) => knight.vertex);
          }),
      )];
      targets.push({
        cell: cellKeyValue,
        edge: edgeKeyValue,
        midpoint: edgeMidpoint(edgeKeyValue),
        needsConnection: !edgeTouchesOwner(edge, owner),
        enemyKnightBlockers,
        enemyWallBlockers,
        protectorVertices,
        vulnerableEnemyWallBlockers: enemyWallBlockers.filter((key) => !isWallProtected(key)),
      });
    }
  }
  return targets;
}

function vertexDistance(firstKey, secondKey) {
  const first = vertices.get(firstKey);
  const second = vertices.get(secondKey);
  if (!first || !second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y) / HEX_SIZE;
}

function blockedCompletionPrepBonus(action, owner) {
  const targets = blockedCompletionTargets(owner);
  if (!targets.length) return 0;
  let value = 0;

  if (action.type === "destroyWall") {
    for (const target of targets) {
      if (!target.enemyWallBlockers.includes(action.edge)) continue;
      value += target.vulnerableEnemyWallBlockers.includes(action.edge) ? 7200 : 3200;
      if (edges.get(action.edge)?.cells?.includes(target.cell)) value += 1800;
    }
  }

  if (action.type === "buildWall") {
    for (const target of targets) {
      if (target.needsConnection && edgesShareVertex(action.edge, target.edge)) value += 5200;
      else if (edges.get(action.edge)?.cells?.includes(target.cell)) value += 1500;
    }
  }

  if (action.type === "move") {
    const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
    if (!knight) return value;
    const from = vertices.get(knight.vertex);
    const to = vertices.get(action.to);
    for (const target of targets) {
      if (!target.midpoint) continue;
      const fromDistance = Math.hypot(from.x - target.midpoint.x, from.y - target.midpoint.y) / HEX_SIZE;
      const toDistance = Math.hypot(to.x - target.midpoint.x, to.y - target.midpoint.y) / HEX_SIZE;
      value += Math.max(0, fromDistance - toDistance) * 980;
      const targetEdge = edges.get(target.edge);
      if (target.needsConnection && (action.to === targetEdge.a || action.to === targetEdge.b)) value += 4600;
      const adjacent = adjacentWallCounts(action.to, owner);
      if (target.vulnerableEnemyWallBlockers.length) value += adjacent.vulnerableEnemy * 820;
      for (const protectorVertex of target.protectorVertices || []) {
        const fromProtectorDistance = vertexDistance(knight.vertex, protectorVertex);
        const toProtectorDistance = vertexDistance(action.to, protectorVertex);
        value += Math.max(0, fromProtectorDistance - toProtectorDistance) * 1100;
        if (Array.from(vertices.get(action.to)?.edges || []).some((key) => {
          const edge = edges.get(key);
          return edge.a === protectorVertex || edge.b === protectorVertex;
        })) value += 3800;
      }
    }
  }

  return value;
}

function enemyKnightConstraintScore(owner) {
  let value = 0;
  for (const knight of state.knights) {
    if (knight.owner !== enemyOf(owner)) continue;
    const moves = legalMoveTargets(knight).size;
    if (moves === 0) value += 3600;
    else if (moves === 1) value += 1250;
    else if (moves === 2) value += 420;
  }
  return value;
}

function enemyCanBuildAdjacentToVertex(vertexKeyValue, owner) {
  return Array.from(vertices.get(vertexKeyValue)?.edges || []).some((edgeKeyValue) => !state.walls[edgeKeyValue] && canBuildWall(edgeKeyValue, enemyOf(owner)));
}

function enemyKnightNearVertex(vertexKeyValue, owner, radius = 1.8) {
  const point = vertices.get(vertexKeyValue);
  if (!point) return 0;
  return state.knights.filter((knight) => {
    if (knight.owner !== enemyOf(owner)) return false;
    const enemyPoint = vertices.get(knight.vertex);
    return enemyPoint && Math.hypot(point.x - enemyPoint.x, point.y - enemyPoint.y) / HEX_SIZE <= radius;
  }).length;
}

function knightTrapWarningAt(vertexKeyValue, owner, knightId = null) {
  const knight = knightId
    ? state.knights.find((item) => item.id === knightId && item.owner === owner)
    : { owner, vertex: vertexKeyValue, id: "trap-check" };
  if (!knight) return 0;

  const originalVertex = knight.vertex;
  knight.vertex = vertexKeyValue;
  const exits = Array.from(legalMoveTargets(knight));
  knight.vertex = originalVertex;

  const adjacent = adjacentWallCounts(vertexKeyValue, owner);
  const nearbyEnemies = enemyKnightNearVertex(vertexKeyValue, owner);
  if (exits.length >= 5 && adjacent.enemy === 0 && nearbyEnemies === 0) return 0;
  const fragileExits = exits.length <= 4
    ? exits.filter((target) => enemyCanBuildAdjacentToVertex(target, owner) || enemyKnightNearVertex(target, owner, 1.25)).length
    : 0;
  const secureExits = Math.max(0, exits.length - fragileExits);
  let value = 0;

  if (exits.length === 0) value += 18000;
  else if (exits.length === 1) value += 4200;
  else if (exits.length === 2) value += 1350;
  else if (secureExits <= 1 && exits.length <= 3) value += 720;

  value += fragileExits * (exits.length <= 3 ? 420 : 110);
  value += adjacent.enemy * (exits.length <= 3 ? 620 : 140);
  value += nearbyEnemies * (exits.length <= 3 ? 440 : 90);
  if (enemyCanBuildAdjacentToVertex(vertexKeyValue, owner) && exits.length <= 2) value += 700;

  return value;
}

function ownKnightVulnerabilityScore(owner) {
  let value = 0;
  for (const knight of state.knights) {
    if (knight.owner !== owner) continue;
    const moves = legalMoveTargets(knight).size;
    const adjacent = adjacentWallCounts(knight.vertex, owner);
    const point = vertices.get(knight.vertex);
    const nearbyEnemies = state.knights.filter((item) => {
      if (item.owner !== enemyOf(owner)) return false;
      const enemyPoint = vertices.get(item.vertex);
      return enemyPoint && point && Math.hypot(point.x - enemyPoint.x, point.y - enemyPoint.y) / HEX_SIZE <= 1.8;
    }).length;

    if (moves === 0) value += 18000;
    else if (moves === 1) value += 5200;
    else if (moves === 2) value += 1650;

    value += adjacent.enemy * (moves <= 2 ? 760 : 180);
    value += nearbyEnemies * (moves <= 2 ? 620 : 120);
    if (moves <= 4 || adjacent.enemy || nearbyEnemies) value += knightTrapWarningAt(knight.vertex, owner, knight.id) * 0.34;
  }
  return value;
}

function moveSelfCaptureRiskPenalty(action, owner) {
  if (action.type !== "move") return 0;
  const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
  if (!knight) return 0;
  const fromVertex = knight.vertex;
  knight.vertex = action.to;
  const moves = legalMoveTargets(knight).size;
  const adjacent = adjacentWallCounts(action.to, owner);
  const point = vertices.get(action.to);
  const nearbyEnemies = state.knights.filter((item) => {
    if (item.owner !== enemyOf(owner)) return false;
    const enemyPoint = vertices.get(item.vertex);
    return enemyPoint && point && Math.hypot(point.x - enemyPoint.x, point.y - enemyPoint.y) / HEX_SIZE <= 1.8;
  }).length;
  knight.vertex = fromVertex;

  let value = 0;
  if (moves === 0) value += 12000;
  else if (moves === 1) value += 3900;
  else if (moves === 2) value += 1250;
  value += adjacent.enemy * (moves <= 2 ? 620 : 130);
  value += nearbyEnemies * (moves <= 2 ? 520 : 90);
  if (moves <= 4 || adjacent.enemy || nearbyEnemies) value += knightTrapWarningAt(action.to, owner, knight.id) * 0.48;
  return value;
}

function enemyCastlePressureProfile(owner) {
  const profile = [];
  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== enemyOf(owner)) continue;
    const cell = cellByKey(key);
    if (!cell) continue;
    const ownWalls = wallCountForCell(cell, owner);
    const emptyEdges = cell.edges.filter((edgeKeyValue) => !state.walls[edgeKeyValue]).length;
    const legalCompletionEdges = ownWalls === 3 ? cell.edges.filter((edgeKeyValue) => !state.walls[edgeKeyValue] && canBuildWall(edgeKeyValue, owner)).length : 0;
    profile.push({ key, ownWalls, emptyEdges, legalCompletionEdges });
  }
  return profile;
}

function multiTargetAttackScore(owner) {
  const threats = enemyCastlePressureProfile(owner);
  const fronts2 = threats.filter((item) => item.ownWalls >= 2).length;
  const fronts3 = threats.filter((item) => item.ownWalls >= 3).length;
  const legalCompletions = threats.reduce((total, item) => total + item.legalCompletionEdges, 0);
  let value = 0;
  if (fronts2 >= 2) value += 1900 + (fronts2 - 2) * 520;
  if (fronts3 >= 2) value += 7600 + (fronts3 - 2) * 1900;
  if (fronts3 >= 1 && fronts2 >= 2) value += 2200;
  value += legalCompletions * 12500;
  return value;
}

function actionMultiTargetBonus(action, owner) {
  if (action.type !== "buildWall" && action.type !== "move") return 0;
  const before = enemyCastlePressureProfile(owner);
  const activeCells = before.filter((item) => item.ownWalls >= 2).map((item) => item.key);
  const advancedCells = before.filter((item) => item.ownWalls >= 3).map((item) => item.key);
  const blockedAdvancedCells = before.filter((item) => item.ownWalls >= 3 && item.legalCompletionEdges === 0).map((item) => item.key);
  let value = 0;

  if (action.type === "buildWall") {
    const edge = edges.get(action.edge);
    for (const cellKeyValue of edge?.cells || []) {
      const castle = state.castles[cellKeyValue];
      if (!castle || castle.capital || castle.owner !== enemyOf(owner)) continue;
      const beforeThreat = before.find((item) => item.key === cellKeyValue);
      const beforeWalls = beforeThreat?.ownWalls || 0;
      const afterWalls = beforeWalls + 1;
      const hasOtherActiveFront = activeCells.some((key) => key !== cellKeyValue);
      const hasOtherAdvancedFront = advancedCells.some((key) => key !== cellKeyValue);
      const hasOtherBlockedAdvancedFront = blockedAdvancedCells.some((key) => key !== cellKeyValue);

      if (beforeWalls === 0 && hasOtherBlockedAdvancedFront) value += 2600;
      else if (beforeWalls === 0 && hasOtherAdvancedFront) value += 1600;
      if (beforeWalls === 1 && (hasOtherAdvancedFront || hasOtherBlockedAdvancedFront)) value += 4300;
      if (beforeWalls < 2 && hasOtherActiveFront && afterWalls >= 2) value += 1800;
      if (beforeWalls === 2) value += hasOtherActiveFront || hasOtherAdvancedFront ? 11800 : 6800;
      if (beforeWalls === 3) value += hasOtherActiveFront ? 17800 : 13200;
    }
  }

  if (action.type === "move") {
    const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
    if (!knight) return value;
    const from = vertices.get(knight.vertex);
    const to = vertices.get(action.to);
    for (const threat of before) {
      if (threat.ownWalls >= 3) continue;
      const cell = cellByKey(threat.key);
      const hasOtherFront = activeCells.some((key) => key !== threat.key);
      if (!cell || !hasOtherFront) continue;
      const fromDistance = Math.hypot(from.x - cell.x, from.y - cell.y) / HEX_SIZE;
      const toDistance = Math.hypot(to.x - cell.x, to.y - cell.y) / HEX_SIZE;
      value += Math.max(0, fromDistance - toDistance) * (threat.ownWalls >= 1 ? 520 : 320);
      if (cell.vertices.includes(action.to)) value += threat.ownWalls >= 1 ? 1800 : 700;
    }
  }

  return value;
}

function focusedCastleAttackBonus(action, owner) {
  const pressure = enemyCastlePressureProfile(owner);
  const active = pressure.filter((item) => item.ownWalls >= 2);
  if (!active.length) return 0;
  const maxWalls = Math.max(...active.map((item) => item.ownWalls));
  const focusTargets = active.filter((item) => item.ownWalls === maxWalls);
  let value = 0;

  if (action.type === "buildWall") {
    const edge = edges.get(action.edge);
    for (const target of pressure) {
      const touches = edge?.cells?.includes(target.key);
      if (!touches) continue;
      const afterWalls = target.ownWalls + 1;
      const isFocus = focusTargets.some((item) => item.key === target.key);
      if (target.ownWalls >= 2) {
        value += afterWalls >= 4 ? 24000 : afterWalls === 3 ? 12500 : 2600;
        if (isFocus) value += 5200;
      } else if (maxWalls >= 2 && !isFocus) {
        value -= castleReserveGone() ? 2600 : 1200;
      }
    }
  }

  if (action.type === "destroyWall") {
    const edge = edges.get(action.edge);
    for (const target of focusTargets) {
      if (edge?.cells?.includes(target.key)) value += target.ownWalls >= 3 ? 9800 : 4600;
    }
  }

  if (action.type === "move") {
    const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
    if (!knight) return value;
    const from = vertices.get(knight.vertex);
    const to = vertices.get(action.to);
    for (const target of focusTargets) {
      const cell = cellByKey(target.key);
      if (!cell) continue;
      const fromDistance = Math.hypot(from.x - cell.x, from.y - cell.y) / HEX_SIZE;
      const toDistance = Math.hypot(to.x - cell.x, to.y - cell.y) / HEX_SIZE;
      const progress = Math.max(0, fromDistance - toDistance);
      value += progress * (target.ownWalls >= 3 ? 980 : 520);
      if (cell.vertices.includes(action.to)) value += target.ownWalls >= 3 ? 2200 : 900;
      if (cell.vertices.includes(knight.vertex) && !cell.vertices.includes(action.to)) value -= target.ownWalls >= 3 ? 2400 : 1200;
    }
  }

  return value;
}
function castleThreatScore(owner) {
  let value = 0;
  const enemy = enemyOf(owner);
  const thirdCastleMultiplier = thirdCastleUrgency(owner) ? 1 + thirdCastleUrgency(owner) * 0.7 : 1;
  for (const cell of cells) {
    if (state.castles[cell.key]?.capital) continue;
    const ownWalls = wallCountForCell(cell, owner);
    const enemyWalls = wallCountForCell(cell, enemy);
    const emptyEdges = cell.edges.filter((key) => !state.walls[key]).length;
    const canPlaceCastle = !state.castles[cell.key] && hasCastleSpacing(cell);
    const targetValue = state.castles[cell.key]?.owner === enemy ? 1.35 : 1;

    if (ownWalls >= 4 && (canPlaceCastle || state.castles[cell.key]?.owner === enemy)) value += 1450 * targetValue * thirdCastleMultiplier;
    else if (ownWalls === 3 && emptyEdges >= 1 && canPlaceCastle) value += 520 * thirdCastleMultiplier;
    else if (ownWalls === 2 && emptyEdges >= 2 && canPlaceCastle) value += 170 * thirdCastleMultiplier;
    else if (ownWalls === 1 && emptyEdges >= 3 && canPlaceCastle) value += 35 * thirdCastleMultiplier;

    if (ownWalls >= 3 && enemyWalls === 0) value += 120;
    if (ownWalls >= 2 && enemyWalls === 0) value += 45;
  }
  return value;
}

function captureThreatScore(owner) {
  let value = 0;
  const enemy = enemyOf(owner);
  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== enemy) continue;
    const cell = cellByKey(key);
    const ownWalls = wallCountForCell(cell, owner);
    const enemyWalls = wallCountForCell(cell, enemy);
    const emptyEdges = cell.edges.filter((edgeKeyValue) => !state.walls[edgeKeyValue]).length;
    if (ownWalls >= 4) value += 8200;
    else if (ownWalls === 3 && emptyEdges >= 1) value += 3300;
    else if (ownWalls === 2 && emptyEdges >= 2) value += 1250;
    else if (ownWalls === 1 && emptyEdges >= 3) value += 260;
    value -= enemyWalls * 90;
  }
  return value;
}

function capitalCell(owner) {
  const entry = Object.entries(state.castles).find(([, castle]) => castle.owner === owner && castle.capital);
  return entry ? cellByKey(entry[0]) : null;
}

function nearestCastleDistance(vertexKeyValue, owner, options = {}) {
  const point = vertices.get(vertexKeyValue);
  let best = Infinity;
  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital && !options.includeCapitals) continue;
    if (castle.owner !== owner) continue;
    const cell = cellByKey(key);
    const dist = Math.hypot(point.x - cell.x, point.y - cell.y) / HEX_SIZE;
    if (dist < best) best = dist;
  }
  return best;
}

function nearestBuildSiteDistance(vertexKeyValue, owner) {
  const point = vertices.get(vertexKeyValue);
  const home = capitalCell(owner);
  let best = Infinity;
  for (const cell of cells) {
    if (state.castles[cell.key] || !hasCastleSpacing(cell)) continue;
    if (home && hexDistance(cell, home) <= 1) continue;
    const dist = Math.hypot(point.x - cell.x, point.y - cell.y) / HEX_SIZE;
    if (dist < best) best = dist;
  }
  return best;
}

function castleEnemyKnightPressure(cell, owner) {
  const enemy = enemyOf(owner);
  const adjacentKnights = state.knights.filter((knight) => knight.owner === enemy && cell.vertices.includes(knight.vertex)).length;
  const nearbyKnights = state.knights.filter((knight) => {
    if (knight.owner !== enemy || cell.vertices.includes(knight.vertex)) return false;
    const point = vertices.get(knight.vertex);
    return point && Math.hypot(point.x - cell.x, point.y - cell.y) / HEX_SIZE <= 2.15;
  }).length;
  return { adjacentKnights, nearbyKnights, pressure: adjacentKnights * 0.8 + nearbyKnights * 0.25 };
}

function threatenedFriendlyCastles(owner) {
  const enemy = enemyOf(owner);
  const threats = [];
  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== owner) continue;
    const cell = cellByKey(key);
    if (!cell) continue;
    const enemyWalls = wallCountForCell(cell, enemy);
    const ownWalls = wallCountForCell(cell, owner);
    const emptyEdges = cell.edges.filter((edgeKeyValue) => !state.walls[edgeKeyValue]).length;
    const enemyCompletionEdges = enemyWalls >= 2 ? cell.edges.filter((edgeKeyValue) => !state.walls[edgeKeyValue] && canBuildWall(edgeKeyValue, enemy)) : [];
    const enemyLegalCompletions = enemyWalls === 3 ? enemyCompletionEdges.length : 0;
    const knightPressure = castleEnemyKnightPressure(cell, owner);
    const wallUrgency = enemyWalls >= 4 ? 5 : enemyWalls === 3 ? 3.5 + enemyLegalCompletions : enemyWalls === 2 ? 1.35 : 0;
    const exposedModifier = ownWalls <= 1 ? 0.65 : ownWalls === 2 ? 0.25 : 0;
    const knightUrgency = knightPressure.adjacentKnights >= 3 && (enemyWalls >= 1 || ownWalls <= 2)
      ? 1.7 + exposedModifier
      : knightPressure.adjacentKnights === 2 && (enemyWalls >= 1 || ownWalls <= 1)
        ? 0.85 + exposedModifier
        : knightPressure.adjacentKnights === 1 && knightPressure.nearbyKnights >= 2 && ownWalls <= 1
          ? 0.45 + exposedModifier
          : 0;
    const urgency = wallUrgency + knightUrgency;
    if (urgency > 0) threats.push({
      key,
      cell,
      enemyWalls,
      ownWalls,
      emptyEdges,
      enemyLegalCompletions,
      enemyCompletionEdges,
      adjacentEnemyKnights: knightPressure.adjacentKnights,
      nearbyEnemyKnights: knightPressure.nearbyKnights,
      urgency,
    });
  }
  return threats.sort((a, b) => b.urgency - a.urgency);
}

function exposedFriendlyCastles(owner) {
  const exposed = [];
  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== owner) continue;
    const cell = cellByKey(key);
    if (!cell) continue;
    const ownWalls = wallCountForCell(cell, owner);
    if (ownWalls >= 2) continue;
    const emptyEdges = cell.edges.filter((edgeKeyValue) => !state.walls[edgeKeyValue]);
    const legalRepairEdges = emptyEdges.filter((edgeKeyValue) => canBuildWall(edgeKeyValue, owner));
    const enemyWalls = wallCountForCell(cell, enemyOf(owner));
    const knightPressure = castleEnemyKnightPressure(cell, owner);
    const localThreat = castleLocalThreat(cell, owner);
    const urgency = (2 - ownWalls) * 1.65 + enemyWalls * 1.1 + knightPressure.pressure + Math.min(localThreat, 5) * 0.65 + (castleReserveGone() ? 1.4 : 0);
    exposed.push({
      key,
      cell,
      ownWalls,
      enemyWalls,
      emptyEdges,
      legalRepairEdges,
      adjacentEnemyKnights: knightPressure.adjacentKnights,
      nearbyEnemyKnights: knightPressure.nearbyKnights,
      localThreat,
      urgency,
    });
  }
  return exposed.sort((a, b) => b.urgency - a.urgency);
}

function nearestThreatenedFriendlyCastleDistance(vertexKeyValue, owner) {
  const point = vertices.get(vertexKeyValue);
  if (!point) return Infinity;
  let best = Infinity;
  for (const threat of threatenedFriendlyCastles(owner)) {
    const dist = Math.hypot(point.x - threat.cell.x, point.y - threat.cell.y) / HEX_SIZE;
    if (dist < best) best = dist;
  }
  return best;
}

function nearestExposedFriendlyCastleDistance(vertexKeyValue, owner) {
  const point = vertices.get(vertexKeyValue);
  if (!point) return Infinity;
  let best = Infinity;
  for (const threat of exposedFriendlyCastles(owner)) {
    const dist = Math.hypot(point.x - threat.cell.x, point.y - threat.cell.y) / HEX_SIZE;
    if (dist < best) best = dist;
  }
  return best;
}

function moveCompletionBlockCount(action, threat) {
  if (action.type !== "move" || !action.to) return 0;
  return (threat.enemyCompletionEdges || []).filter((edgeKeyValue) => {
    const edge = edges.get(edgeKeyValue);
    return edge && (edge.a === action.to || edge.b === action.to);
  }).length;
}

function castleIntegrityActionBonus(action, owner) {
  const exposed = exposedFriendlyCastles(owner);
  if (!exposed.length) return 0;
  let value = 0;

  if (action.type === "buildWall") {
    const edge = edges.get(action.edge);
    for (const threat of exposed) {
      if (!edge?.cells?.includes(threat.key)) continue;
      const base = threat.ownWalls === 0 ? 7600 : 3000;
      value += base + threat.urgency * 1150;
      if (castleReserveGone()) value += threat.ownWalls === 0 ? 2800 : 1200;
      if (threat.enemyWalls > 0) value += threat.enemyWalls * 1500;
      if (threat.localThreat >= 3) value += 2000;
    }
  }

  if (action.type === "move") {
    const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
    if (!knight) return value;
    const from = vertices.get(knight.vertex);
    const to = vertices.get(action.to);
    const targets = exposed.filter((threat) => (
      !threat.legalRepairEdges.length &&
      (threat.ownWalls === 0 || threat.enemyWalls > 0 || threat.adjacentEnemyKnights >= 2)
    ));
    const threat = targets[0];
    if (!threat) return value;
    const fromDistance = Math.hypot(from.x - threat.cell.x, from.y - threat.cell.y) / HEX_SIZE;
    const toDistance = Math.hypot(to.x - threat.cell.x, to.y - threat.cell.y) / HEX_SIZE;
    value += Math.max(0, fromDistance - toDistance) * threat.urgency * (castleReserveGone() ? 180 : 90);
    if (threat.cell.vertices.includes(action.to)) value += threat.urgency * 320;
  }

  return value;
}

function castleDefenseActionBonus(action, owner) {
  const threats = threatenedFriendlyCastles(owner);
  if (!threats.length) return 0;
  let value = 0;

  if (action.type === "destroyWall") {
    const edge = edges.get(action.edge);
    for (const threat of threats) {
      if (!edge?.cells?.includes(threat.key)) continue;
      value += threat.urgency * (isWallProtected(action.edge) ? 950 : 1900);
      if (threat.enemyWalls >= 3) value += 6200;
    }
  }

  if (action.type === "buildWall") {
    const edge = edges.get(action.edge);
    for (const threat of threats) {
      if (!edge?.cells?.includes(threat.key)) continue;
      value += threat.urgency * 1050 + threat.ownWalls * 220;
      if (threat.adjacentEnemyKnights >= 2 && threat.ownWalls <= 1) value += threat.adjacentEnemyKnights * 320;
      if (threat.enemyLegalCompletions) value += 3200;
    }
  }

  if (action.type === "move") {
    const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
    if (!knight) return value;
    const from = vertices.get(knight.vertex);
    const to = vertices.get(action.to);
    for (const threat of threats) {
      const fromDistance = Math.hypot(from.x - threat.cell.x, from.y - threat.cell.y) / HEX_SIZE;
      const toDistance = Math.hypot(to.x - threat.cell.x, to.y - threat.cell.y) / HEX_SIZE;
      value += Math.max(0, fromDistance - toDistance) * threat.urgency * 260;
      const blocksCompletions = moveCompletionBlockCount(action, threat);
      if (threat.cell.vertices.includes(action.to)) value += threat.urgency * 420 + (threat.enemyLegalCompletions ? 2300 : 0) + (threat.adjacentEnemyKnights >= 2 && threat.ownWalls <= 1 ? 140 : 0);
      if (blocksCompletions) value += blocksCompletions * threat.urgency * 4200;
      const adjacent = adjacentWallCounts(action.to, owner);
      value += adjacent.vulnerableEnemy * threat.urgency * 240;
    }
  }

  return value;
}

function adjacentWallCounts(vertexKeyValue, owner) {
  const counts = { own: 0, enemy: 0, vulnerableEnemy: 0 };
  for (const key of vertices.get(vertexKeyValue)?.edges || []) {
    if (state.walls[key] === owner) counts.own += 1;
    if (state.walls[key] === enemyOf(owner)) {
      counts.enemy += 1;
      if (!isWallProtected(key)) counts.vulnerableEnemy += 1;
    }
  }
  return counts;
}

function castleLocalThreat(cell, owner) {
  const enemy = enemyOf(owner);
  const adjacentAttackers = state.knights.filter((knight) => knight.owner === enemy && cell.vertices.includes(knight.vertex)).length;
  const nearbyAttackers = state.knights.filter((knight) => {
    if (knight.owner !== enemy || cell.vertices.includes(knight.vertex)) return false;
    const point = vertices.get(knight.vertex);
    return point && Math.hypot(point.x - cell.x, point.y - cell.y) / HEX_SIZE <= 2.15;
  }).length;
  const enemyWalls = wallCountForCell(cell, enemy);
  const ownWalls = wallCountForCell(cell, owner);
  return adjacentAttackers * 3 + nearbyAttackers * 1.15 + enemyWalls * 1.4 + Math.max(0, 2 - ownWalls) * 1.8;
}

function castleGuardScore(vertexKeyValue, owner) {
  let value = 0;
  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== owner) continue;
    const cell = cellByKey(key);
    if (!cell || !cell.vertices.includes(vertexKeyValue)) continue;
    const defenders = state.knights.filter((knight) => knight.owner === owner && cell.vertices.includes(knight.vertex)).length;
    const ownWalls = wallCountForCell(cell, owner);
    const threat = castleLocalThreat(cell, owner);
    const quiet = threat < 1.25 && ownWalls >= 2;

    if (quiet) {
      value += defenders <= 1 ? (castleReserveGone() ? 10 : 60) : -620 * (defenders - 1);
    } else if (ownWalls >= 2 && threat < 3) {
      value += defenders <= 1 ? 60 + threat * 25 : -420 * (defenders - 1);
    } else {
      value += 140 + threat * 90 - Math.max(0, defenders - 1) * 180;
    }
  }
  return value;
}

function knightDevelopmentScore(owner) {
  const home = capitalCell(owner);
  let value = 0;
  for (const knight of state.knights) {
    if (knight.owner !== owner) continue;
    const point = vertices.get(knight.vertex);
    const homeDistance = home ? Math.hypot(point.x - home.x, point.y - home.y) / HEX_SIZE : 0;
    const enemyCastleDistance = nearestCastleDistance(knight.vertex, enemyOf(owner));
    const ownCastleDistance = nearestCastleDistance(knight.vertex, owner);
    const adjacent = adjacentWallCounts(knight.vertex, owner);

    value += Math.min(homeDistance, 4.5) * (castleReserveGone() ? 115 : 75);
    const buildSiteDistance = nearestBuildSiteDistance(knight.vertex, owner);
    if (Number.isFinite(enemyCastleDistance)) value += Math.max(0, 7 - enemyCastleDistance) * (castleReserveGone() ? 145 : 10);
    if (Number.isFinite(buildSiteDistance) && !castleReserveGone()) value += Math.max(0, 7 - buildSiteDistance) * (thirdCastleUrgency(owner) ? 210 : 135);
    if (Number.isFinite(ownCastleDistance)) value += Math.max(0, 4 - ownCastleDistance) * 6;
    value += castleGuardScore(knight.vertex, owner);
    value += adjacent.vulnerableEnemy * (castleReserveGone() ? 720 : 70);
    value += adjacent.enemy * (castleReserveGone() ? 220 : 30);
    value += adjacent.own * (castleReserveGone() ? 35 : 35);
  }
  return value;
}

function quietCastleRedeployBonus(action, owner) {
  if (action.type !== "move" || !castleReserveGone()) return 0;
  const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
  if (!knight) return 0;
  let value = 0;
  const fromPoint = vertices.get(knight.vertex);
  const toPoint = vertices.get(action.to);

  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== owner) continue;
    const cell = cellByKey(key);
    if (!cell || !cell.vertices.includes(knight.vertex)) continue;
    const defenders = state.knights.filter((item) => item.owner === owner && cell.vertices.includes(item.vertex)).length;
    const threat = castleLocalThreat(cell, owner);
    const ownWalls = wallCountForCell(cell, owner);
    const leavingLastDefender = defenders <= 1 && threat >= 1.25;
    if (leavingLastDefender) value -= 900 + threat * 220;
    if (ownWalls >= 2 && threat < 1.25) {
      const fromEnemyDistance = nearestCastleDistance(knight.vertex, enemyOf(owner));
      const toEnemyDistance = nearestCastleDistance(action.to, enemyOf(owner));
      if (Number.isFinite(fromEnemyDistance) && Number.isFinite(toEnemyDistance)) {
        value += Math.max(0, fromEnemyDistance - toEnemyDistance) * (defenders > 1 ? 1050 : 520);
      }
      const leavingCastle = fromPoint && toPoint ? Math.hypot(toPoint.x - cell.x, toPoint.y - cell.y) > Math.hypot(fromPoint.x - cell.x, fromPoint.y - cell.y) : false;
      if (leavingCastle && defenders > 1) value += 2400;
    }
  }

  return value;
}

function immediateCastleDanger(owner) {
  return threatenedFriendlyCastles(owner).some((threat) => (
    threat.enemyWalls >= 3 ||
    threat.enemyLegalCompletions > 0 ||
    (threat.enemyWalls >= 2 && threat.adjacentEnemyKnights >= 2 && threat.ownWalls <= 1)
  ));
}

function counterPressureActionBonus(action, owner) {
  if (!castleReserveGone() || immediateCastleDanger(owner)) return 0;
  const enemy = enemyOf(owner);
  let value = 0;

  if (action.type === "buildWall") {
    const edge = edges.get(action.edge);
    for (const cellKeyValue of edge?.cells || []) {
      const castle = state.castles[cellKeyValue];
      if (!castle || castle.capital || castle.owner !== enemy) continue;
      const cell = cellByKey(cellKeyValue);
      const beforeWalls = wallCountForCell(cell, owner);
      value += beforeWalls >= 2 ? 14500 : beforeWalls === 1 ? 7200 : 2600;
    }
  }

  if (action.type === "destroyWall") {
    const edge = edges.get(action.edge);
    for (const cellKeyValue of edge?.cells || []) {
      const castle = state.castles[cellKeyValue];
      if (!castle || castle.capital || castle.owner !== enemy) continue;
      const cell = cellByKey(cellKeyValue);
      value += 5600 + wallCountForCell(cell, owner) * 2300;
    }
  }

  if (action.type === "move") {
    const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
    if (!knight) return value;
    const from = vertices.get(knight.vertex);
    const to = vertices.get(action.to);
    const activeTargets = enemyCastlePressureProfile(owner).filter((item) => item.ownWalls >= 1);
    const targets = activeTargets.length ? activeTargets : Object.entries(state.castles)
      .filter(([, castle]) => !castle.capital && castle.owner === enemy)
      .map(([key]) => ({ key, ownWalls: 0 }));

    for (const target of targets) {
      const cell = cellByKey(target.key);
      if (!cell) continue;
      const fromDistance = Math.hypot(from.x - cell.x, from.y - cell.y) / HEX_SIZE;
      const toDistance = Math.hypot(to.x - cell.x, to.y - cell.y) / HEX_SIZE;
      const progress = Math.max(0, fromDistance - toDistance);
      value += progress * (target.ownWalls >= 2 ? 1900 : target.ownWalls === 1 ? 1250 : 620);
      if (cell.vertices.includes(action.to)) value += target.ownWalls >= 2 ? 4200 : 1800;
    }

    for (const [key, castle] of Object.entries(state.castles)) {
      if (castle.capital || castle.owner !== owner) continue;
      const cell = cellByKey(key);
      if (!cell || !cell.vertices.includes(knight.vertex) || cell.vertices.includes(action.to)) continue;
      const defenders = state.knights.filter((item) => item.owner === owner && cell.vertices.includes(item.vertex)).length;
      const ownWalls = wallCountForCell(cell, owner);
      const threat = castleLocalThreat(cell, owner);
      if (ownWalls >= 2 && threat < 2.2) value += defenders > 1 ? 2600 : 1100;
    }
  }

  return value;
}

function moveAttackBonus(action, owner) {
  if (action.type !== "move") return 0;
  const knight = state.knights.find((item) => item.id === action.knightId);
  if (!knight) return 0;
  const fromEnemyDistance = nearestCastleDistance(knight.vertex, enemyOf(owner));
  const toEnemyDistance = nearestCastleDistance(action.to, enemyOf(owner));
  const fromBuildSiteDistance = nearestBuildSiteDistance(knight.vertex, owner);
  const toBuildSiteDistance = nearestBuildSiteDistance(action.to, owner);
  const fromDefenseDistance = nearestThreatenedFriendlyCastleDistance(knight.vertex, owner);
  const toDefenseDistance = nearestThreatenedFriendlyCastleDistance(action.to, owner);
  const fromExposedCastleDistance = nearestExposedFriendlyCastleDistance(knight.vertex, owner);
  const toExposedCastleDistance = nearestExposedFriendlyCastleDistance(action.to, owner);
  const fromHome = capitalCell(owner);
  const fromPoint = vertices.get(knight.vertex);
  const toPoint = vertices.get(action.to);
  const homeProgress = fromHome
    ? (Math.hypot(toPoint.x - fromHome.x, toPoint.y - fromHome.y) - Math.hypot(fromPoint.x - fromHome.x, fromPoint.y - fromHome.y)) / HEX_SIZE
    : 0;
  const adjacent = adjacentWallCounts(action.to, owner);
  let value = 0;
  if (Number.isFinite(fromEnemyDistance) && Number.isFinite(toEnemyDistance)) value += (fromEnemyDistance - toEnemyDistance) * (castleReserveGone() ? 760 : 45);
  if (Number.isFinite(fromBuildSiteDistance) && Number.isFinite(toBuildSiteDistance) && !castleReserveGone()) value += (fromBuildSiteDistance - toBuildSiteDistance) * (thirdCastleUrgency(owner) ? 820 : 520);
  if (Number.isFinite(fromDefenseDistance) && Number.isFinite(toDefenseDistance)) value += Math.max(0, fromDefenseDistance - toDefenseDistance) * (castleReserveGone() ? 360 : 180);
  if (Number.isFinite(fromExposedCastleDistance) && Number.isFinite(toExposedCastleDistance)) value += Math.max(0, fromExposedCastleDistance - toExposedCastleDistance) * (castleReserveGone() ? 80 : 40);
  value += Math.max(0, homeProgress) * (castleReserveGone() ? 170 : 150);
  value += adjacent.vulnerableEnemy * (castleReserveGone() ? 1450 : 130);
  value += adjacent.enemy * (castleReserveGone() ? 460 : 40);
  value += blockedCompletionPrepBonus(action, owner);
  value += castleDefenseActionBonus(action, owner);
  value += castleIntegrityActionBonus(action, owner);
  value += focusedCastleAttackBonus(action, owner);
  value += counterPressureActionBonus(action, owner);
  value += actionMultiTargetBonus(action, owner);
  value -= moveSelfCaptureRiskPenalty(action, owner);
  value += quietCastleRedeployBonus(action, owner);
  value += castleGuardScore(action.to, owner);
  value += adjacent.own * (castleReserveGone() ? 35 : 35);
  return value;
}

function buildExpansionBonus(edgeKeyValue, owner) {
  if (castleReserveGone()) return 0;
  const home = capitalCell(owner);
  if (!home) return 0;
  const edge = edges.get(edgeKeyValue);
  const urgency = thirdCastleUrgency(owner);
  let value = 0;
  let supportsCastlePlan = false;

  for (const cellKeyValue of edge?.cells || []) {
    const cell = cellByKey(cellKeyValue);
    if (!cell) continue;
    const distanceFromCapital = hexDistance(cell, home);
    const ownWalls = wallCountForCell(cell, owner);

    if (distanceFromCapital <= 1) value -= 620;
    if (!state.castles[cellKeyValue] && hasCastleSpacing(cell)) {
      supportsCastlePlan = true;
      value += Math.min(distanceFromCapital, 4) * 210;
      value += ownWalls * (urgency ? 760 : 260);
      if (distanceFromCapital >= 2) value += urgency ? 1150 : 520;
      if (distanceFromCapital >= 3) value += urgency ? 620 : 260;
    }
  }

  return supportsCastlePlan ? value : value - 260;
}

function actionAttackBonus(action, owner) {
  if (action.type === "buildWall") {
    let value = castleReserveGone() ? -760 : -90;
    const edge = edges.get(action.edge);
    value += ownCastleWallPressure(action.edge, owner);
    value += enemyCastleWallPressure(action.edge, owner);
    value += blockedCompletionPrepBonus(action, owner);
    value += castleDefenseActionBonus(action, owner);
    value += castleIntegrityActionBonus(action, owner);
    value += focusedCastleAttackBonus(action, owner);
    value += counterPressureActionBonus(action, owner);
    value += actionMultiTargetBonus(action, owner);
    for (const cellKeyValue of edge?.cells || []) {
      const cell = cellByKey(cellKeyValue);
      const castle = state.castles[cellKeyValue];
      const ownWalls = wallCountForCell(cell, owner);
      if (castle?.owner === enemyOf(owner) && !castle.capital) {
        const afterOwnWalls = ownWalls + 1;
        if (afterOwnWalls >= 4) value += castleReserveGone() ? 15000 : 2500;
        else if (afterOwnWalls === 3) value += castleReserveGone() ? 8500 : 1200;
        else if (afterOwnWalls === 2) value += castleReserveGone() ? 3600 : 460;
        else value += castleReserveGone() ? 1200 : 90;
      } else if (!castle && hasCastleSpacing(cell) && !castleReserveGone()) {
        if (ownWalls >= 4) value += 3600;
        else if (ownWalls === 3) value += 1900;
        else if (ownWalls === 2) value += 760;
        else value += 220;
      }
    }
    value += buildExpansionBonus(action.edge, owner);
    return value;
  }

  if (action.type === "destroyWall") {
    let value = 900 + blockedCompletionPrepBonus(action, owner) + castleDefenseActionBonus(action, owner) + castleIntegrityActionBonus(action, owner) + focusedCastleAttackBonus(action, owner) + counterPressureActionBonus(action, owner);
    const edge = edges.get(action.edge);
    for (const cellKeyValue of edge?.cells || []) {
      const cell = cellByKey(cellKeyValue);
      const castle = state.castles[cellKeyValue];
      if (castle?.owner === enemyOf(owner) && !castle.capital) value += (castleReserveGone() ? 1700 : 600) + wallCountForCell(cell, owner) * (castleReserveGone() ? 560 : 180);
      else if (!castle && hasCastleSpacing(cell) && !castleReserveGone()) value += wallCountForCell(cell, owner) * 180;
    }
    return value;
  }

  return 0;
}

function knightMobilityScore(owner) {
  return state.knights
    .filter((knight) => knight.owner === owner)
    .reduce((total, knight) => total + legalMoveTargets(knight).size, 0);
}

function wallPresenceScore(owner) {
  return Object.values(state.walls).filter((wallOwner) => wallOwner === owner).length;
}

function boardScoreFor(owner) {
  const enemy = enemyOf(owner);
  return (
    score(owner) * 1800 -
    score(enemy) * 1900 +
    thirdCastleStatusScore(owner) -
    thirdCastleStatusScore(enemy) * 0.8 +
    captureThreatScore(owner) * (castleReserveGone() ? 2.45 : 0.55) -
    captureThreatScore(enemy) * (castleReserveGone() ? 1.45 : 0.85) +
    castleThreatScore(owner) * (castleReserveGone() ? 0.08 : 1.65) -
    castleThreatScore(enemy) * 1.05 +
    knightDevelopmentScore(owner) -
    knightDevelopmentScore(enemy) * 0.65 +
    enemyKnightConstraintScore(owner) -
    enemyKnightConstraintScore(enemy) * 0.55 -
    ownKnightVulnerabilityScore(owner) +
    ownKnightVulnerabilityScore(enemy) * 0.36 +
    multiTargetAttackScore(owner) -
    multiTargetAttackScore(enemy) * 0.72 +
    knightMobilityScore(owner) * 8 -
    knightMobilityScore(enemy) * 10 +
    wallPresenceScore(owner) * 2 -
    wallPresenceScore(enemy) * 4 +
    state.reserves[owner] * 2
  );
}

function moveOscillationPenalty(action, owner) {
  if (action.type !== "move" || !castleReserveGone()) return 0;
  const recentMoves = aiReviewLog
    .filter((entry) => entry.actor === owner && entry.action?.type === "move" && entry.action.knightId === action.knightId)
    .slice(-4);
  if (!recentMoves.length) return 0;
  let penalty = 0;
  const previous = recentMoves[recentMoves.length - 1]?.action;
  const twoBack = recentMoves[recentMoves.length - 2]?.action;
  const threeBack = recentMoves[recentMoves.length - 3]?.action;

  if (twoBack?.to === action.to) penalty += 18000;
  if (threeBack?.to === action.to) penalty += 9000;
  if (previous?.to === action.to) penalty += 4000;

  const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
  const target = vertices.get(action.to);
  if (knight && target) {
    const fromEnemyDistance = nearestCastleDistance(knight.vertex, enemyOf(owner));
    const toEnemyDistance = nearestCastleDistance(action.to, enemyOf(owner));
    const adjacent = adjacentWallCounts(action.to, owner);
    const makingPressure = Number.isFinite(fromEnemyDistance) && Number.isFinite(toEnemyDistance) && toEnemyDistance + 0.2 < fromEnemyDistance;
    if (!makingPressure && !adjacent.enemy && !adjacent.vulnerableEnemy && recentMoves.length >= 2) penalty += 2600;
  }

  return penalty;
}

function immediateActionBonus(action, owner, beforeCastles, beforeEnemyCastles) {
  let value = 0;
  if (state.winner === owner) value += 100000;
  if (state.winner === enemyOf(owner)) value -= 100000;
  if (score(owner) > beforeCastles) value += 8500;
  if (score(owner) >= 3 && beforeCastles < 3) value += 26000;
  if (score(enemyOf(owner)) < beforeEnemyCastles) value += 9000;
  if (action.type === "buildCastle") value += thirdCastleUrgency(owner) ? 21000 : 7200;
  if (action.type === "destroyWall") value += 1050;
  if (action.type === "buildWall") value += 20;
  if (action.type === "move") value += 35;
  value += actionAttackBonus(action, owner);
  value += moveAttackBonus(action, owner);
  value -= moveOscillationPenalty(action, owner);
  return value;
}

function evaluateActionInPlace(action, owner) {
  const beforeCastles = score(owner);
  const beforeEnemyCastles = score(enemyOf(owner));
  if (!mutateAction(action, owner, { log: false })) return -Infinity;
  finishTurn({ render: false, publish: false, animate: false, log: false });
  return boardScoreFor(owner) + immediateActionBonus(action, owner, beforeCastles, beforeEnemyCastles);
}

function bestImmediateReplyScore(owner, limit = 6) {
  const actions = legalActionsForPlayer(owner);
  if (!actions.length) return 0;
  const ordered = actions.sort((a, b) => actionPriority(b) - actionPriority(a)).slice(0, limit);
  const replyBaseState = cloneState(state);
  let best = -Infinity;
  for (const action of ordered) {
    state = cloneState(replyBaseState);
    selectedKnight = null;
    hover = null;
    pendingTouchEdge = null;
    pendingTouchCell = null;
    const value = evaluateActionInPlace(action, owner);
    if (value > best) best = value;
  }
  state = replyBaseState;
  selectedKnight = null;
  hover = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  return best;
}

function actionPriority(action) {
  if (action.type === "buildCastle") return 5;
  if (action.type === "destroyWall") return 4;
  if (action.type === "buildWall") return 4;
  if (action.type === "move") return castleReserveGone() ? 3 : 1;
  return 1;
}

function simulatedActionScore(action, owner) {
  const previousState = state;
  const previousSelected = selectedKnight;
  const previousHover = hover;
  const previousPendingEdge = pendingTouchEdge;
  const previousPendingCell = pendingTouchCell;
  state = cloneState(previousState);
  selectedKnight = null;
  hover = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;

  const immediate = evaluateActionInPlace(action, owner);
  if (immediate === -Infinity) {
    state = previousState;
    selectedKnight = previousSelected;
    hover = previousHover;
    pendingTouchEdge = previousPendingEdge;
    pendingTouchCell = previousPendingCell;
    return -Infinity;
  }

  let value = immediate;
  if (!state.winner) {
    const reply = bestImmediateReplyScore(enemyOf(owner));
    value -= Math.max(0, reply) * (thirdCastleUrgency(owner) ? 0.42 : 0.68);
  }

  state = previousState;
  selectedKnight = previousSelected;
  hover = previousHover;
  pendingTouchEdge = previousPendingEdge;
  pendingTouchCell = previousPendingCell;
  return value;
}

function buildPhaseActions(actions, owner) {
  if (castleReserveGone()) return actions;
  const castleActions = actions.filter((action) => action.type === "buildCastle");
  if (castleActions.length) return castleActions;
  const repairWallActions = actions.filter((action) => action.type === "buildWall" && castleIntegrityActionBonus(action, owner) > 0);
  const strippedCastleNeedsRepair = exposedFriendlyCastles(owner).some((threat) => (
    threat.ownWalls === 0 &&
    threat.legalRepairEdges.length &&
    (castleReserveGone() || threat.enemyWalls > 0 || threat.adjacentEnemyKnights >= 2)
  ));
  if (strippedCastleNeedsRepair && repairWallActions.length) return repairWallActions;
  const attackingWallActions = actions.filter((action) => action.type === "buildWall" && enemyCastleWallPressure(action.edge, owner) > 0);
  const multiFrontWallActions = actions.filter((action) => action.type === "buildWall" && actionMultiTargetBonus(action, owner) > 0);
  const thirdCastleWallActions = actions.filter((action) => action.type === "buildWall" && ownCastleWallPressure(action.edge, owner) > 0);
  if (castleAttackMode(owner) && attackingWallActions.length && !thirdCastleUrgency(owner)) return attackingWallActions;
  const usefulWallActions = actions.filter((action) => action.type === "buildWall" && buildExpansionBonus(action.edge, owner) > 0);
  if (thirdCastleUrgency(owner) && thirdCastleWallActions.length) return thirdCastleWallActions;
  if (thirdCastleUrgency(owner) && usefulWallActions.length) return usefulWallActions;
  if (usefulWallActions.length) return usefulWallActions.concat(thirdCastleWallActions, repairWallActions, multiFrontWallActions, attackingWallActions);
  if (repairWallActions.length && castleAttackMode(owner)) return repairWallActions.concat(multiFrontWallActions, attackingWallActions);
  if (castleReserveGone() && multiFrontWallActions.length) return multiFrontWallActions.concat(attackingWallActions);
  if (attackingWallActions.length) return attackingWallActions.concat(multiFrontWallActions);
  const moveActions = actions.filter((action) => action.type === "move");
  if (moveActions.length) return moveActions;
  return actions;
}

function emergencyDefenseActions(actions, owner) {
  const activeCounterPressure = enemyCastlePressureProfile(owner).some((threat) => threat.ownWalls >= 3 || threat.legalCompletionEdges > 0);
  const urgentThreats = threatenedFriendlyCastles(owner).filter((threat) => (
    threat.enemyWalls >= 3 ||
    (castleReserveGone() && threat.enemyWalls >= 2 && !activeCounterPressure) ||
    (castleReserveGone() && threat.adjacentEnemyKnights >= 3 && threat.enemyWalls >= 1 && threat.ownWalls <= 1 && !activeCounterPressure)
  ));
  if (!urgentThreats.length) return actions;
  const urgentKeys = new Set(urgentThreats.map((threat) => threat.key));

  const touchesUrgentCastle = (edgeKeyValue) => edges.get(edgeKeyValue)?.cells?.some((cellKeyValue) => urgentKeys.has(cellKeyValue));
  const breakActions = actions.filter((action) => action.type === "destroyWall" && touchesUrgentCastle(action.edge));
  if (breakActions.length) return breakActions;

  const blockingBuilds = actions.filter((action) => action.type === "buildWall" && touchesUrgentCastle(action.edge));
  if (blockingBuilds.length) return blockingBuilds;

  const moveActions = actions
    .filter((action) => {
      if (action.type !== "move") return false;
      const knight = state.knights.find((item) => item.id === action.knightId && item.owner === owner);
      if (!knight) return false;
      const from = vertices.get(knight.vertex);
      const to = vertices.get(action.to);
      return urgentThreats.some((threat) => {
        const fromDistance = Math.hypot(from.x - threat.cell.x, from.y - threat.cell.y) / HEX_SIZE;
        const toDistance = Math.hypot(to.x - threat.cell.x, to.y - threat.cell.y) / HEX_SIZE;
        return threat.cell.vertices.includes(action.to) || toDistance + 0.15 < fromDistance;
      });
    })
    .map((action) => {
      const best = urgentThreats.reduce((current, threat) => {
        const to = vertices.get(action.to);
        const toDistance = Math.hypot(to.x - threat.cell.x, to.y - threat.cell.y) / HEX_SIZE;
        const onCastle = threat.cell.vertices.includes(action.to);
        if (!current || onCastle || (!current.onCastle && toDistance < current.toDistance)) return { action, toDistance, onCastle };
        return current;
      }, null);
      const blockCount = urgentThreats.reduce((total, threat) => total + moveCompletionBlockCount(action, threat), 0);
      return { ...best, blockCount };
    })
    .filter(Boolean);
  if (moveActions.length) {
    const maxBlocks = Math.max(...moveActions.map((item) => item.blockCount));
    if (maxBlocks > 0) return moveActions.filter((item) => item.blockCount === maxBlocks).map((item) => item.action);
    const onCastleMoves = moveActions.filter((item) => item.onCastle);
    if (onCastleMoves.length) return onCastleMoves.map((item) => item.action);
    const closestDistance = Math.min(...moveActions.map((item) => item.toDistance));
    return moveActions
      .filter((item) => item.toDistance <= closestDistance + 0.35)
      .map((item) => item.action);
  }

  return actions;
}

function chooseAiAction(owner, options = {}) {
  const legalActions = legalActionsForPlayer(owner);
  const defenseActions = emergencyDefenseActions(legalActions, owner);
  const actions = buildPhaseActions(defenseActions, owner);
  if (!actions.length) return options.explain ? { action: null, candidates: [] } : null;
  let best = null;
  let bestScore = -Infinity;
  const candidates = [];
  for (const action of actions) {
    const scoreValue = simulatedActionScore(action, owner);
    const value = scoreValue + Math.random() * 0.001;
    if (options.explain) candidates.push({ action, score: scoreValue });
    if (value > bestScore) {
      best = action;
      bestScore = value;
    }
  }
  if (options.explain) {
    candidates.sort((a, b) => b.score - a.score);
    return {
      action: best,
      candidates: candidates.slice(0, 8).map((candidate) => ({
        action: summarizeActionForReview(candidate.action),
        score: Math.round(candidate.score),
        defense: Math.round(castleDefenseActionBonus(candidate.action, owner)),
        integrity: Math.round(castleIntegrityActionBonus(candidate.action, owner)),
        focus: Math.round(focusedCastleAttackBonus(candidate.action, owner)),
        counter: Math.round(counterPressureActionBonus(candidate.action, owner)),
        repeat: Math.round(moveOscillationPenalty(candidate.action, owner)),
        trapRisk: Math.round(moveSelfCaptureRiskPenalty(candidate.action, owner)),
      })),
    };
  }
  return best;
}

function scheduleAiTurn() {
  if (!aiGame.enabled || aiGame.thinking || onlineGame.joined || state.winner || state.turn !== aiGame.player) return;
  aiGame.thinking = true;
  updateUi();
  window.setTimeout(() => {
    if (!aiGame.enabled || onlineGame.joined || state.winner || state.turn !== aiGame.player) {
      aiGame.thinking = false;
      updateUi();
      return;
    }
    const decision = chooseAiAction(aiGame.player, { explain: true });
    const action = decision.action;
    aiGame.thinking = false;
    if (action) {
      const previous = cloneState(state);
      if (applyAction(action, { publish: false })) {
        recordAiReviewTurn(aiGame.player, action, { candidates: decision.candidates });
        const markers = inferRemoteMarkers(previous, state);
        const fallback = markerForAction(action, aiGame.player);
        (markers.length ? markers : [fallback]).filter(Boolean).forEach((marker) => addActionMarker(marker));
        return;
      }
    }
    addLog(`${PLAYERS[aiGame.player].name} AI has no legal action.`);
    finishTurn({ publish: false });
  }, 260);
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
  captureMarkers.push({ owner, target: "vertex", vertex, kind, startedAt: performance.now() + delay });
  if (!captureAnimationFrame) animateCaptureMarkers();
}

function addActionMarker(marker, delay = 0) {
  captureMarkers.push({ ...marker, blocksInput: true, startedAt: performance.now() + delay });
  selectedKnight = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  hover = null;
  if (!captureAnimationFrame) animateCaptureMarkers();
}

function markerForAction(action, owner) {
  if (action.type === "move") return { owner, target: "vertex", vertex: action.to, kind: "move" };
  if (action.type === "buildWall") return { owner, target: "edge", edge: action.edge, kind: "buildWall" };
  if (action.type === "destroyWall") return { owner, target: "edge", edge: action.edge, kind: "destroyWall" };
  if (action.type === "buildCastle") return { owner, target: "cell", cell: action.cell, kind: "buildCastle" };
  return null;
}

function inferRemoteMarkers(previous, next) {
  const markers = [];
  const actor = previous.turn;
  const addMarker = (marker) => {
    if (!marker) return;
    const markerKey = marker.vertex || marker.edge || marker.cell || "";
    const duplicate = markers.some((item) => (
      item.owner === marker.owner
      && item.kind === marker.kind
      && item.target === marker.target
      && (item.vertex || item.edge || item.cell || "") === markerKey
    ));
    if (!duplicate) markers.push(marker);
  };

  for (const knight of next.knights || []) {
    const before = previous.knights?.find((item) => item.id === knight.id);
    if (before && before.vertex !== knight.vertex && knight.owner === actor) {
      addMarker({ owner: knight.owner, target: "vertex", vertex: knight.vertex, kind: "move" });
    }
  }

  for (const [key, owner] of Object.entries(next.walls || {})) {
    if (!previous.walls?.[key]) {
      addMarker({ owner, target: "edge", edge: key, kind: "buildWall" });
    }
  }

  for (const [key, owner] of Object.entries(previous.walls || {})) {
    if (!next.walls?.[key]) {
      addMarker({ owner, target: "edge", edge: key, kind: "destroyWall" });
    }
  }

  for (const [key, castle] of Object.entries(next.castles || {})) {
    const before = previous.castles?.[key];
    if (!before && !castle.capital) {
      addMarker({ owner: castle.owner, target: "cell", cell: key, kind: "buildCastle" });
    }
    if (before && before.owner !== castle.owner && !castle.capital) {
      addMarker({ owner: castle.owner, target: "cell", cell: key, kind: "captureCastle" });
    }
  }

  return markers;
}

function animateCaptureMarkers() {
  captureAnimationFrame = requestAnimationFrame(() => {
    captureMarkers = captureMarkers.filter((marker) => performance.now() - marker.startedAt < ACTION_MARKER_DURATION);
    draw();
    if (captureMarkers.length) animateCaptureMarkers();
    else captureAnimationFrame = null;
  });
}

function resolveCaptures(actor, options = {}) {
  const animate = options.animate ?? true;
  const writeLog = options.log ?? true;
  const defender = enemyOf(actor);
  const captured = state.knights.filter((knight) => knight.owner === defender && legalMoveTargets(knight).size === 0);
  for (const knight of captured) {
    const capturedFrom = knight.vertex;
    if (animate) addCaptureMarker(knight.owner, capturedFrom, "capture");
    const returnedTo = returnKnightHome(knight, capturedFrom);
    if (animate) addCaptureMarker(knight.owner, returnedTo, "respawn", 360);
  }
  if (captured.length && writeLog) addLog(`${PLAYERS[actor].name} captured ${captured.length} knight${captured.length === 1 ? "" : "s"}.`);

  for (const [key, castle] of Object.entries(state.castles)) {
    if (castle.capital || castle.owner !== defender) continue;
    const cell = cellByKey(key);
    if (wallCountForCell(cell, actor) >= 4) {
      castle.owner = actor;
      if (writeLog) addLog(`${PLAYERS[actor].name} captured a castle.`);
    }
  }
}

function score(owner) {
  return Object.values(state.castles).filter((castle) => castle.owner === owner && !castle.capital).length;
}

function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(-a.q - a.r + b.q + b.r)) / 2;
}

function finishTurn(options = {}) {
  const render = options.render ?? true;
  const publish = options.publish ?? true;
  const animate = options.animate ?? true;
  const writeLog = options.log ?? true;
  const actor = currentPlayer();
  selectedKnight = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  hover = null;
  resolveCaptures(actor, { animate, log: writeLog });
  if (score(actor) >= WIN_CASTLE_COUNT) {
    state.winner = actor;
    if (writeLog) addLog(`${PLAYERS[actor].name} controls ${WIN_CASTLE_COUNT} castles.`);
  } else {
    state.turn = enemyOf(actor);
  }
  if (render) {
    updateUi();
    draw();
  }
  if (publish) publishOnlineState();
  if (render) scheduleAiTurn();
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

function markerPalette(kind) {
  const destructive = kind === "capture" || kind === "destroyWall" || kind === "captureCastle";
  if (destructive) return { outer: "rgba(168, 75, 68, 0.95)", inner: "rgba(212, 154, 36, 0.92)", fill: "rgba(168, 75, 68, 0.14)" };
  return { outer: "rgba(74, 132, 169, 0.95)", inner: "rgba(108, 141, 85, 0.94)", fill: "rgba(74, 132, 169, 0.14)" };
}

function drawPulseAtPoint(point, marker, progress, radius = clamp(renderedHexDiameter() * 0.16, 16, 26)) {
  const palette = markerPalette(marker.kind);
  const pulse = 1 + Math.sin(progress * Math.PI) * 0.22;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = palette.outer;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius * 0.58 * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = palette.inner;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = palette.fill;
  ctx.fill();
}

function drawPulseOnEdge(edgeKeyValue, marker, progress) {
  const edge = edges.get(edgeKeyValue);
  if (!edge) return;
  const a = toScreen(vertices.get(edge.a));
  const b = toScreen(vertices.get(edge.b));
  const palette = markerPalette(marker.kind);
  const pulse = 1 + Math.sin(progress * Math.PI) * 0.22;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = palette.outer;
  ctx.lineWidth = clamp(renderedHexDiameter() * 0.11 * pulse, 8, 18);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = palette.inner;
  ctx.lineWidth = clamp(renderedHexDiameter() * 0.055 * pulse, 4, 10);
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawPulseOnCell(cellKeyValue, marker, progress) {
  const cell = cellByKey(cellKeyValue);
  if (!cell) return;
  drawPulseAtPoint(toScreen(cell), marker, progress, clamp(renderedHexDiameter() * 0.25, 24, 42));
}

function drawCaptureMarkers() {
  const now = performance.now();
  for (const marker of captureMarkers) {
    const elapsed = now - marker.startedAt;
    if (elapsed < 0) continue;
    const progress = Math.min(1, elapsed / ACTION_MARKER_DURATION);
    ctx.save();
    ctx.globalAlpha = 1 - progress * 0.72;
    if (marker.target === "edge") drawPulseOnEdge(marker.edge, marker, progress);
    else if (marker.target === "cell") drawPulseOnCell(marker.cell, marker, progress);
    else drawPulseAtPoint(toScreen(vertices.get(marker.vertex)), marker, progress);
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
  updateOnlineColorChoice();

  if (els.onlineRole) {
    els.onlineRole.hidden = !onlineGame.joined;
    els.onlineRole.classList.toggle("white-role", onlineGame.player === "W");
    els.onlineRole.classList.toggle("black-role", onlineGame.player === "B");
    if (onlineGame.joined) {
      els.onlineRole.textContent = onlineGame.player
        ? `You are ${onlineRoleName(onlineGame.player)}`
        : "Spectating";
    }
  }

  if (els.copyLink) {
    els.copyLink.hidden = !onlineGame.inviteUrl;
    els.copyLink.disabled = !onlineGame.inviteUrl;
  }

  if (!els.onlineStatus) return;
  els.onlineStatus.hidden = !message;
  els.onlineStatus.textContent = message || "";
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
    const remoteMarkers = !onlineGame.player || state.turn !== onlineGame.player ? inferRemoteMarkers(state, nextState) : [];
    state = cloneState(nextState);
    selectedKnight = null;
    pendingTouchEdge = null;
    pendingTouchCell = null;
    hover = null;
    updateUi();
    if (state.winner && els.winModal) els.winModal.hidden = false;
    draw();
    remoteMarkers.forEach((marker) => addActionMarker(marker));
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

function openOnlineColorModal() {
  updateOnlineColorChoice();
  if (els.onlineColorModal) els.onlineColorModal.hidden = false;
}

async function createOnlineGame(player = preferredOnlinePlayer) {
  preferredOnlinePlayer = player === "B" ? "B" : "W";
  aiGame.enabled = false;
  aiGame.thinking = false;
  leaveOnlineGame();
  prepareFreshGameState();
  updateUi();
  resizeCanvas();
  try {
    const socket = await connectOnlineSocket();
    socket.emit("createGame", { state: cloneState(state), player: preferredOnlinePlayer }, (response) => {
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
  aiGame.enabled = false;
  aiGame.thinking = false;
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
  if (state.winner) return;
  if (!canActLocally()) {
    showOnlineTurnBlocked();
    return;
  }
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

  if (state.winner) return;
  if (!canActLocally()) {
    showOnlineTurnBlocked();
    return;
  }
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
  els.reset?.classList.toggle("active", !onlineGame.joined && !aiGame.enabled);
  els.ai?.classList.toggle("active", aiGame.enabled && !onlineGame.joined);
  if (els.copyAiLog) {
    const canCopyAiGame = Boolean(state.winner && aiGame.enabled && !onlineGame.joined && aiReviewLog.length);
    els.copyAiLog.hidden = !canCopyAiGame;
    els.copyAiLog.disabled = !canCopyAiGame;
  }
  els.undoButtons.forEach((button) => {
    button.hidden = onlineGame.joined;
    button.disabled = onlineGame.joined || aiGame.thinking;
    button.title = onlineGame.joined ? "Undo is unavailable during online games" : "Undo last action";
  });
  updateOnlineStatus();
  els.whiteScore.textContent = score("W");
  els.blackScore.textContent = score("B");
  els.whiteWalls.textContent = state.reserves.W;
  els.blackWalls.textContent = state.reserves.B;
  els.castleReserve.textContent = state.reserves.castles;
  const spentCastleCount = CASTLE_TILE_RESERVE - state.reserves.castles;
  els.castleTokens.forEach((token, index) => {
    const spent = index < spentCastleCount;
    token.hidden = spent;
    token.parentElement.hidden = spent;
  });
  els.winner.textContent = state.winner ? PLAYERS[state.winner].name : "-";
  els.winTitle.textContent = state.winner ? `${PLAYERS[state.winner].name} Wins` : "";
  els.winModal.hidden = !state.winner;
  els.log.innerHTML = state.log.map((item) => `<p>${item}</p>`).join("");
}

function leaveOnlineGame() {
  if (onlineGame.socket) onlineGame.socket.disconnect();
  onlineGame = {
    socket: null,
    roomId: null,
    player: null,
    inviteUrl: null,
    joined: false,
  };
}

function prepareFreshGameState() {
  state = createInitialState();
  history = [];
  selectedKnight = null;
  hover = null;
  pendingTouchEdge = null;
  pendingTouchCell = null;
  captureMarkers = [];
  aiReviewLog = [];
  if (captureAnimationFrame) cancelAnimationFrame(captureAnimationFrame);
  captureAnimationFrame = null;
}

function resetGame() {
  aiGame.enabled = false;
  aiGame.thinking = false;
  leaveOnlineGame();
  prepareFreshGameState();
  updateUi();
  resizeCanvas();
}

function openAiColorModal() {
  if (els.aiColorModal) els.aiColorModal.hidden = false;
}

function startAiGame(humanPlayer = "W") {
  const human = humanPlayer === "B" ? "B" : "W";
  aiGame.enabled = true;
  aiGame.player = enemyOf(human);
  aiGame.thinking = false;
  leaveOnlineGame();
  prepareFreshGameState();
  addLog(`${PLAYERS[human].name} faces the ${PLAYERS[aiGame.player].name} AI.`);
  updateUi();
  resizeCanvas();
  scheduleAiTurn();
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
els.copyAiLog?.addEventListener("click", copyAiReviewLog);
els.ai?.addEventListener("click", openAiColorModal);
els.aiColorButtons?.forEach((button) => {
  button.addEventListener("click", () => {
    const humanPlayer = button.dataset.aiColor === "B" ? "B" : "W";
    if (els.aiColorModal) els.aiColorModal.hidden = true;
    startAiGame(humanPlayer);
  });
});
els.cancelAiColor?.addEventListener("click", () => {
  els.aiColorModal.hidden = true;
});
els.onlineColorButtons?.forEach((button) => {
  button.addEventListener("click", () => {
    const selectedPlayer = button.dataset.onlineColor === "B" ? "B" : "W";
    if (els.onlineColorModal) els.onlineColorModal.hidden = true;
    createOnlineGame(selectedPlayer);
  });
});
els.online?.addEventListener("click", openOnlineColorModal);
els.cancelOnlineColor?.addEventListener("click", () => {
  els.onlineColorModal.hidden = true;
});
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
  if (!canActLocally()) {
    hover = null;
    draw();
    return;
  }
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

'use strict';
// ---------------------------------------------------------------------------
// Expansión «Navegantes de Catán»: tablero con islas, barcos, oro y pirata
// ---------------------------------------------------------------------------

const SEA_CONFIGS = {
  small: { rows: 7, len: 12, main: CONFIGS.base, islands: 3, islandHexes: 11, gold: 2,
    islandNumbers: [3, 4, 5, 6, 8, 9, 10, 11, 2, 12, 4, 10, 5, 9] },
  big: { rows: 9, len: 14, main: CONFIGS.ext, islands: 4, islandHexes: 15, gold: 3,
    islandNumbers: [3, 4, 5, 6, 8, 9, 10, 11, 2, 12, 4, 10, 5, 9, 3, 11, 6, 8] },
};

function isSea(h) { return h.terrain === 'mar'; }
function isLandHex(h) { return h.terrain !== 'mar'; }

// ============================ Generación del tablero ============================
function generateSeaBoard(nPlayers) {
  const sc = SEA_CONFIGS[nPlayers > 4 ? 'big' : 'small'];
  for (let attempt = 0; attempt < 400; attempt++) {
    const board = tryGenerateSeaBoard(sc);
    if (board) return board;
  }
  throw new Error('No se pudo generar el tablero de Navegantes');
}

function tryGenerateSeaBoard(sc) {
  const R = HEX_R, W = Math.sqrt(3) * R;
  const hexes = [];
  const mid = (sc.rows - 1) / 2;
  for (let r = 0; r < sc.rows; r++) {
    const n = r % 2 ? sc.len + 1 : sc.len;
    for (let i = 0; i < n; i++) {
      hexes.push({ id: hexes.length, x: (i - (n - 1) / 2) * W, y: (r - mid) * 1.5 * R, terrain: 'mar', number: null,
        island: null, row: r, col: i, border: r === 0 || r === sc.rows - 1 || i === 0 || i === n - 1 });
    }
  }
  const { vertices, edges } = buildHexGraph(hexes);
  const near = (h, set) => h.neighbors.some(n => set.has(n));

  // Isla principal: mancha compacta en la parte izquierda
  const mainSize = Object.values(sc.main.terrains).reduce((a, b) => a + b, 0);
  const center = hexes.filter(h => !h.border && h.row === Math.floor(mid))
    .sort((a, b) => a.x - b.x)[Math.floor(sc.len * 0.32)];
  const main = growBlob(hexes, center, mainSize, h => !h.border, h => Math.hypot(h.x - center.x, (h.y - center.y) * 1.15));
  if (!main) return null;
  const mainSet = new Set(main.map(h => h.id));

  // Islas pequeñas separadas por al menos un hexágono de mar
  const taken = new Set(mainSet);
  const islands = [];
  const sizes = splitSizes(sc.islandHexes, sc.islands);
  for (const size of sizes) {
    const free = h => !h.border && !taken.has(h.id) && !near(h, taken);
    const seeds = shuffle(hexes.filter(free)).sort((a, b) => b.x - a.x).slice(0, 8);
    let blob = null;
    for (const seed of shuffle(seeds)) {
      blob = growBlob(hexes, seed, size, free, h => Math.hypot(h.x - seed.x, h.y - seed.y) + Math.random() * 40);
      if (blob) break;
    }
    if (!blob) return null;
    blob.forEach(h => taken.add(h.id));
    islands.push(blob);
  }

  // Terrenos y números
  const mainTerr = [];
  for (const [t, n] of Object.entries(sc.main.terrains)) for (let i = 0; i < n; i++) mainTerr.push(t);
  shuffle(mainTerr);
  main.forEach((h, i) => { h.terrain = mainTerr[i]; h.island = 0; });
  const islandHexes = islands.flat();
  const basic = ['bosque', 'cerro', 'pasto', 'campo', 'montana'];
  const islTerr = [];
  for (let i = 0; i < sc.gold; i++) islTerr.push('oro');
  while (islTerr.length < islandHexes.length) islTerr.push(basic[islTerr.length % basic.length]);
  shuffle(islTerr);
  islandHexes.forEach((h, i) => { h.terrain = islTerr[i]; });
  islands.forEach((blob, k) => blob.forEach(h => { h.island = k + 1; }));

  const mainNumbered = main.filter(h => h.terrain !== 'desierto');
  assignNumbers(hexes, [[mainNumbered, sc.main.numbers], [islandHexes, sc.islandNumbers.slice(0, islandHexes.length)]]);
  if (mainNumbered.some(h => !h.number)) return null;

  const robber = main.find(h => h.terrain === 'desierto').id;
  // Pirata: en mar abierto, lejos de la isla principal
  const openSea = hexes.filter(h => isSea(h) && !h.border && !near(h, taken));
  const pirateHex = openSea.length ? openSea[rand(openSea.length)] : hexes.find(h => isSea(h) && !near(h, mainSet));

  // Puertos en la costa de la isla principal
  const coast = [];
  for (const e of edges) {
    const ls = e.hexes.filter(id => mainSet.has(id));
    if (ls.length === 1 && e.hexes.length === 2 && isSea(hexes[e.hexes.find(id => id !== ls[0])])) coast.push({ e, land: ls[0] });
  }
  const cx = main.reduce((s, h) => s + h.x, 0) / main.length, cy = main.reduce((s, h) => s + h.y, 0) / main.length;
  const ports = placePorts(sc.main, hexes, vertices, coast, cx, cy);

  return { hexes, vertices, edges, ports, robber, pirate: pirateHex.id, islandCount: islands.length };
}

function splitSizes(totalHexes, k) {
  const sizes = new Array(k).fill(Math.floor(totalHexes / k));
  for (let i = 0; i < totalHexes % k; i++) sizes[i]++;
  return sizes;
}

// Hace crecer una zona conexa de «size» hexágonos desde «seed»
function growBlob(hexes, seed, size, allowed, weight) {
  if (!seed || !allowed(seed)) return null;
  const blob = [seed], inBlob = new Set([seed.id]);
  while (blob.length < size) {
    const cand = [];
    for (const h of blob) for (const n of h.neighbors) {
      const o = hexes[n];
      if (!inBlob.has(o.id) && allowed(o)) cand.push(o);
    }
    if (!cand.length) return null;
    cand.sort((a, b) => weight(a) - weight(b));
    const pick = cand[Math.min(cand.length - 1, rand(Math.min(3, cand.length)))];
    blob.push(pick);
    inBlob.add(pick.id);
  }
  return blob;
}

// Marca aristas y vértices: tierra (caminos/poblados) y mar (barcos)
function annotateBoard() {
  for (const e of G.edges) {
    const hs = e.hexes.map(id => G.hexes[id]);
    e.land = hs.some(isLandHex);
    e.sea = !!G.seafarers && hs.some(isSea);
  }
  for (const v of G.vertices) {
    const lands = v.hexes.map(id => G.hexes[id]).filter(isLandHex);
    v.land = lands.length > 0;
    v.island = lands.length ? lands[0].island : null;
  }
}

// ============================ Barcos ============================
function nearPirate(e) {
  return G.pirate != null && e.hexes.includes(G.pirate);
}

function validShipSpot(pid, eid, fromVertex) {
  const e = G.edges[eid];
  if (!G.seafarers || !e || !e.sea || e.road !== null || e.ship !== null || nearPirate(e)) return false;
  if (fromVertex != null) return e.v.includes(fromVertex);
  return e.v.some(vid => {
    const v = G.vertices[vid];
    if (v.building) return v.building.owner === pid;
    return v.edges.some(x => x !== eid && G.edges[x].ship === pid);
  });
}

function shipSpots(pid, fromVertex) {
  if (!G.seafarers) return [];
  return G.edges.filter(e => validShipSpot(pid, e.id, fromVertex)).map(e => e.id);
}

function placeShip(pid, eid) {
  G.edges[eid].ship = pid;
  G.edges[eid].shipTurn = G.turn;
  P(pid).ships--;
}

function buildShip(pid, eid) {
  const p = P(pid);
  if (!G.seafarers || p.ships <= 0 || !G.edges[eid]) return false;
  if (G.phase === 'setup-road') {
    if (pid !== G.current || !validShipSpot(pid, eid, G.lastSettlement)) return false;
    placeShip(pid, eid);
    log(`${pname(pid)} construye un barco.`);
    updateLongestRoad();
    advanceSetup();
    return true;
  }
  if (G.phase === 'road-building') {
    if (pid !== activePlayer() || !validShipSpot(pid, eid)) return false;
    placeShip(pid, eid);
    G.freeRoads--;
    log(`${pname(pid)} construye un barco gratis.`);
    if (G.freeRoads <= 0 || (!roadSpots(pid).length && !shipSpots(pid).length)) G.phase = G.pairedActive ? 'paired' : 'main';
    updateLongestRoad();
    checkWin();
    return true;
  }
  if (!canBuildNow(pid) || !canAfford(pid, COSTS.barco) || !validShipSpot(pid, eid)) return false;
  pay(pid, COSTS.barco);
  placeShip(pid, eid);
  log(`${pname(pid)} construye un barco.`);
  updateLongestRoad();
  checkWin();
  return true;
}

// Un barco se puede mover si está en el extremo abierto de una línea
function movableShip(pid, eid) {
  const e = G.edges[eid];
  if (!e || e.ship !== pid || e.shipTurn === G.turn || nearPirate(e)) return false;
  return e.v.some(vid => {
    const v = G.vertices[vid];
    if (v.building && v.building.owner === pid) return false;
    return !v.edges.some(x => x !== eid && G.edges[x].ship === pid);
  });
}

function canMoveShips(pid) {
  const turnOk = (G.phase === 'main' && pid === G.current) || (G.phase === 'paired' && pid === G.partner);
  return G.seafarers && turnOk && !G.shipMoved;
}

function movableShips(pid) {
  return canMoveShips(pid) ? G.edges.filter(e => movableShip(pid, e.id)).map(e => e.id) : [];
}

// Destinos posibles al mover el barco «from» (se calcula quitándolo antes)
function shipMoveTargets(pid, from) {
  if (!movableShip(pid, from)) return [];
  const e = G.edges[from];
  e.ship = null;
  const spots = shipSpots(pid).filter(id => id !== from);
  e.ship = pid;
  return spots;
}

function moveShip(pid, from, to) {
  if (!canMoveShips(pid) || !shipMoveTargets(pid, from).includes(to)) return false;
  G.edges[from].ship = null;
  G.edges[to].ship = pid;
  G.edges[to].shipTurn = G.turn;
  G.shipMoved = true;
  log(`${pname(pid)} mueve un barco.`);
  updateLongestRoad();
  checkWin();
  return true;
}

// ============================ Pirata ============================
function pirateAllowed(hid) {
  return !!G.seafarers && G.hexes[hid] && isSea(G.hexes[hid]) && hid !== G.pirate;
}

function pirateVictims(hid, pid) {
  const s = new Set();
  for (const eid of G.hexes[hid].edges) {
    const o = G.edges[eid].ship;
    if (o !== null && o !== pid && total(P(o).res) > 0) s.add(o);
  }
  return [...s];
}

// ============================ Ríos de oro ============================
function startGold(after) {
  const queue = [];
  const n = G.players.length;
  for (let i = 0; i < n; i++) {
    const pid = (G.current + i) % n;
    if (G.goldNeed[pid] > 0) queue.push(pid);
  }
  if (!queue.length) return;
  G.goldQueue = queue;
  G.afterGold = after;
  G.phase = 'gold';
}

function chooseGold(pid, sel) {
  if (G.phase !== 'gold' || G.goldQueue[0] !== pid) return false;
  const need = Math.min(G.goldNeed[pid], RES.reduce((s, r) => s + G.bank[r], 0));
  if (total(sel) !== need || COM.some(c => sel[c]) || RES.some(r => sel[r] > G.bank[r])) return false;
  RES.forEach(r => give(pid, r, sel[r]));
  log(`${pname(pid)} recibe ${resStr(sel)} del río de oro.`);
  G.goldNeed[pid] = 0;
  G.goldQueue.shift();
  if (!G.goldQueue.length) G.phase = G.afterGold;
  return true;
}

// ============================ Islas nuevas ============================
function claimIsland(pid, vid) {
  const isl = G.vertices[vid].island;
  if (!G.seafarers || !isl) return;
  const p = P(pid);
  if (p.islands.includes(isl)) return;
  p.islands.push(isl);
  log(`🏝️ ${pname(pid)} coloniza una isla nueva: <b>+2 puntos</b>.`);
}

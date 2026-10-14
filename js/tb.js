'use strict';
// ---------------------------------------------------------------------------
// Expansión «Mercaderes y Bárbaros»: escenarios Pescadores, Ríos, Caravanas
// y Ataque de los bárbaros.
// ---------------------------------------------------------------------------

const TB_SCENARIOS = {
  pescadores: { name: 'Pescadores de Catán', icon: '🐟',
    desc: 'Lago y caladeros dan peces; con ellos mueves el ladrón, robas, tomas recursos, caminos o cartas. ¡Cuidado con la bota vieja!' },
  rios: { name: 'Ríos de Catán', icon: '🌉',
    desc: 'Construir junto a los ríos da monedas; los puentes dan 3. El más rico gana 1 punto y los más pobres pierden 2.' },
  caravanas: { name: 'Caravanas', icon: '🐪',
    desc: 'Tras cada poblado o ciudad se vota con trigo y lana dónde va un camello. Los edificios en la ruta valen +1.' },
  barbaros: { name: 'Ataque de los bárbaros', icon: '🪓',
    desc: 'Cada poblado o ciudad atrae 3 bárbaros a la costa. Los caballeros salen del castillo y los capturan (2 prisioneros = 1 punto).' },
};

const FISH_USES = {
  2: { name: 'Devolver el ladrón al lago', icon: '🦹' },
  3: { name: 'Robar un recurso', icon: '🫳' },
  4: { name: 'Tomar un recurso del banco', icon: '🎁' },
  5: { name: 'Construir un camino gratis', icon: '🛤️' },
  7: { name: 'Tomar una carta de desarrollo', icon: '📜' },
};

const BRIDGE_COST = { arcilla: 2, madera: 1 };
const LAKE_NUMBERS = [2, 3, 11, 12];
const CAMELS = 22;
const BARBARIANS = 30;
const KNIGHT_MP = 3;

// ============================ Preparación ============================
function centerHex() {
  return G.hexes.slice().sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
}

// Lleva el desierto a la casilla «target» (intercambiando terreno y número)
function moveDesertTo(target) {
  const d = G.hexes.find(h => h.terrain === 'desierto');
  if (!d || d === target) return d;
  [d.terrain, target.terrain] = [target.terrain, d.terrain];
  [d.number, target.number] = [target.number, d.number];
  G.robber = target.id;
  return target;
}

function setupTB() {
  for (const p of G.players) { p.fishTokens = []; p.boot = false; p.gold = 0; p.prisoners = 0; }
  if (G.tb === 'pescadores') setupFishermen();
  else if (G.tb === 'rios') setupRivers();
  else if (G.tb === 'caravanas') setupCaravans();
  else if (G.tb === 'barbaros') setupBarbarians();
  annotateBoard();
}

function setupFishermen() {
  const interior = G.hexes.filter(h => h.neighbors.length === 6 && h.terrain !== 'desierto');
  const lake = moveDesertTo(interior[rand(interior.length)]);
  lake.terrain = 'lago';
  lake.number = null;
  G.lake = lake.id;
  // Caladeros: aristas de la costa sin puerto, separadas entre sí
  const portE = new Set(G.ports.map(p => p.edge));
  const coast = G.edges.filter(e => e.hexes.length === 1 && !portE.has(e.id));
  coast.sort((a, b) => edgeAngle(a) - edgeAngle(b));
  const used = new Set(), grounds = [];
  const nums = shuffle([4, 5, 6, 8, 9, 10]);
  const step = coast.length / nums.length;
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < coast.length; j++) {
      const e = coast[(Math.floor(i * step) + j) % coast.length];
      if (e.v.some(v => used.has(v))) continue;
      e.v.forEach(v => used.add(v));
      const h = G.hexes[e.hexes[0]];
      const [a, b] = e.v.map(id => G.vertices[id]);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = mx - h.x, dy = my - h.y, d = Math.hypot(dx, dy);
      grounds.push({ edge: e.id, number: nums[i], x: mx + dx / d * HEX_R * 0.55, y: my + dy / d * HEX_R * 0.55 });
      break;
    }
  }
  G.fishGrounds = grounds;
  const pool = [];
  for (let i = 0; i < 11; i++) pool.push(1);
  for (let i = 0; i < 10; i++) pool.push(2);
  for (let i = 0; i < 8; i++) pool.push(3);
  pool.push('bota');
  G.fishPool = shuffle(pool);
  G.fishSpent = [];
}

function edgeAngle(e) {
  const [a, b] = e.v.map(id => G.vertices[id]);
  return Math.atan2((a.y + b.y) / 2, (a.x + b.x) / 2);
}

function setupRivers() {
  for (let attempt = 0; attempt < 200; attempt++) {
    G.edges.forEach(e => { e.river = false; });
    G.vertices.forEach(v => { v.river = false; });
    if (makeRiver(6) && makeRiver(8)) break;
  }
  G.players.forEach(p => { p.gold = 3; });
}

// Un río recorre «len» aristas desde la costa hacia el interior
function makeRiver(len) {
  const coastV = G.vertices.filter(v => v.hexes.length < 3 && !v.river && !v.adj.some(a => G.vertices[a].river));
  if (!coastV.length) return false;
  let cur = coastV[rand(coastV.length)];
  const path = [], seen = new Set([cur.id]);
  for (let i = 0; i < len; i++) {
    const opts = cur.edges.map(eid => G.edges[eid]).filter(e => {
      const nv = G.vertices[e.v[0] === cur.id ? e.v[1] : e.v[0]];
      return e.hexes.length === 2 && !seen.has(nv.id) && nv.hexes.length === 3 && !nv.river &&
        !nv.adj.some(a => a !== cur.id && G.vertices[a].river);
    });
    if (!opts.length) return false;
    const e = opts[rand(opts.length)];
    path.push(e);
    cur = G.vertices[e.v[0] === cur.id ? e.v[1] : e.v[0]];
    seen.add(cur.id);
  }
  path.forEach(e => { e.river = true; e.v.forEach(v => { G.vertices[v].river = true; }); });
  return true;
}

function setupCaravans() {
  const oasis = moveDesertTo(centerHex());
  oasis.terrain = 'oasis';
  G.oasis = oasis.id;
  G.camelStarts = [oasis.vertices[0], oasis.vertices[2], oasis.vertices[4]];
  G.camelsLeft = CAMELS;
  G.voteQueue = [];
  G.votes = {};
}

function setupBarbarians() {
  const castle = moveDesertTo(centerHex());
  castle.terrain = 'castillo';
  G.castle = castle.id;
  G.hexes.forEach(h => { h.barbs = 0; h.conquered = false; });
  G.barbsLeft = BARBARIANS;
  G.bknights = [];
}

// ============================ Puntos ============================
function vpTB(pid) {
  const p = P(pid);
  let s = 0;
  if (G.tb === 'rios') {
    const golds = G.players.map(q => q.gold);
    const max = Math.max(...golds), min = Math.min(...golds);
    if (p.gold === max && golds.filter(g => g === max).length === 1) s += 1;
    if (p.gold === min && max !== min) s -= 2;
  }
  if (G.tb === 'caravanas') {
    for (const v of G.vertices) if (v.building && v.building.owner === pid && v.camelRoute) s += 1;
  }
  if (G.tb === 'barbaros') {
    s += Math.floor(p.prisoners / 2);
    // Edificios rodeados por hexágonos conquistados no puntúan
    for (const v of G.vertices) {
      if (!v.building || v.building.owner !== pid) continue;
      const land = v.hexes.map(id => G.hexes[id]).filter(h => TERRAIN[h.terrain].res || h.terrain === 'desierto');
      if (land.length && land.every(h => h.conquered)) s -= v.building.type === 'ciudad' ? 2 : 1;
    }
  }
  return s;
}

function winTarget(pid) {
  return G.winPoints + (P(pid).boot ? 1 : 0);
}

function vpTBLabel(pid) {
  const p = P(pid), out = [];
  if (G.tb === 'pescadores') out.push(`🐟 ${p.fishTokens.length}${p.boot ? ' 👢' : ''}`);
  if (G.tb === 'rios' || G.tb === 'barbaros') out.push(`🪙 ${p.gold}`);
  if (G.tb === 'barbaros') out.push(`⛓️ ${p.prisoners}`);
  return out;
}

// ============================ Pescadores ============================
function drawFish(pid, n) {
  const p = P(pid);
  for (let i = 0; i < n; i++) {
    if (!G.fishPool.length) {
      if (!G.fishSpent.length) return;
      G.fishPool = shuffle(G.fishSpent);
      G.fishSpent = [];
    }
    const t = G.fishPool.pop();
    if (t === 'bota') {
      p.boot = true;
      log(`👢 ${pname(pid)} pesca la <b>bota vieja</b>: necesita 1 punto más para ganar.`);
    } else p.fishTokens.push(t);
  }
}

function fishTotal(pid) {
  return (P(pid).fishTokens || []).reduce((a, b) => a + (b || 0), 0);
}

// Gasta las fichas que sumen lo justo (o lo mínimo por encima); el exceso se pierde
function spendFish(pid, cost) {
  const toks = P(pid).fishTokens;
  let best = null;
  const n = toks.length;
  for (let mask = 1; mask < (1 << Math.min(n, 14)); mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += toks[i];
    if (sum >= cost && (!best || sum < best.sum || (sum === best.sum && popcount(mask) < popcount(best.mask)))) best = { mask, sum };
  }
  if (!best) return false;
  const keep = [];
  toks.forEach((t, i) => { if (best.mask & (1 << i)) G.fishSpent.push(t); else keep.push(t); });
  P(pid).fishTokens = keep;
  return true;
}

function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }

function produceFish(n) {
  const catches = {};
  const add = (b, k) => { if (b) catches[b.owner] = (catches[b.owner] || 0) + (b.type === 'ciudad' ? 2 : 1) * k; };
  if (LAKE_NUMBERS.includes(n)) G.hexes[G.lake].vertices.forEach(v => add(G.vertices[v].building, 1));
  for (const fg of G.fishGrounds) {
    if (fg.number !== n) continue;
    G.edges[fg.edge].v.forEach(v => add(G.vertices[v].building, 1));
  }
  for (const [pid, k] of Object.entries(catches)) {
    drawFish(+pid, k);
    log(`🐟 ${pname(+pid)} pesca ${k} ficha(s) de pescado.`);
  }
}

function canUseFish(pid, use) {
  if (G.tb !== 'pescadores' || G.phase !== 'main' || pid !== G.current || G.pending) return false;
  if (!FISH_USES[use] || fishTotal(pid) < use) return false;
  if (use === 2) return G.robber !== G.lake;
  if (use === 3) return opponents(pid).some(o => RES.some(r => P(o).res[r] > 0));
  if (use === 5) return P(pid).roads > 0 && roadSpots(pid).length > 0;
  if (use === 7) return G.devDeck.length > 0;
  return true;
}

function useFish(pid, use) {
  use = toInt(use);
  if (!canUseFish(pid, use) || !spendFish(pid, use)) return false;
  log(`🐟 ${pname(pid)} gasta ${use} peces: ${FISH_USES[use].name.toLowerCase()}.`);
  switch (use) {
    case 2: G.robber = G.lake; break;
    case 3: setPending(pid, 'fish3', 'player', opponents(pid).filter(o => RES.some(r => P(o).res[r] > 0)), 'Elige a quién robar un recurso'); break;
    case 4: setPending(pid, 'fish4', 'card', RES.filter(r => G.bank[r] > 0), 'Elige el recurso que tomas del banco'); break;
    case 5: G.freeRoads = 1; G.phase = 'road-building'; break;
    case 7: P(pid).dev.push({ type: G.devDeck.pop(), turn: G.turn }); checkWin(); break;
  }
  return true;
}

function passBoot(pid, to) {
  to = toInt(to);
  if (G.tb !== 'pescadores' || !P(pid).boot || G.phase !== 'main' || pid !== G.current || !P(to) || to === pid) return false;
  if (vp(to) < vp(pid)) return false;
  P(pid).boot = false;
  P(to).boot = true;
  log(`👢 ${pname(pid)} le pasa la bota vieja a ${pname(to)}.`);
  return true;
}

// ============================ Ríos ============================
function riverAdjacent(e) {
  return !e.river && e.v.some(v => G.vertices[v].river);
}

function bridgeSpots(pid) {
  if (G.tb !== 'rios') return [];
  return G.edges.filter(e => e.river && e.road === null && e.v.some(vid => {
    const v = G.vertices[vid];
    if (v.building) return v.building.owner === pid;
    return v.edges.some(x => x !== e.id && G.edges[x].road === pid);
  })).map(e => e.id);
}

function buildBridge(pid, eid) {
  if (!canBuildNow(pid) || !bridgeSpots(pid).includes(eid) || !canAfford(pid, BRIDGE_COST) || P(pid).roads <= 0) return false;
  pay(pid, BRIDGE_COST);
  G.edges[eid].road = pid;
  G.edges[eid].bridge = true;
  P(pid).roads--;
  earnGold(pid, 3, 'por el puente');
  log(`🌉 ${pname(pid)} construye un puente.`);
  updateLongestRoad();
  checkWin();
  return true;
}

function earnGold(pid, n, why) {
  P(pid).gold += n;
  log(`🪙 ${pname(pid)} gana ${n} moneda(s) ${why}.`);
}

function buyWithGold(pid, r) {
  const may = (G.phase === 'main' && pid === G.current) || (G.phase === 'paired' && pid === G.partner);
  if (!G.tb || !['rios', 'barbaros'].includes(G.tb) || !may || G.pending || !RES.includes(r)) return false;
  if (P(pid).gold < 2 || G.bank[r] < 1) return false;
  P(pid).gold -= 2;
  give(pid, r, 1);
  log(`${pname(pid)} paga 2 🪙 por 1 ${RES_INFO[r].icon}.`);
  checkWin();
  return true;
}

// ============================ Caravanas ============================
function camelSpots() {
  if (G.tb !== 'caravanas' || G.camelsLeft <= 0) return [];
  const deg = {};
  G.edges.forEach(e => { if (e.camel) e.v.forEach(v => { deg[v] = (deg[v] || 0) + 1; }); });
  const ends = new Set();
  for (const s of G.camelStarts) if (!deg[s]) ends.add(s);
  for (const [v, d] of Object.entries(deg)) if (d === 1 && !G.camelStarts.includes(+v)) ends.add(+v);
  return G.edges.filter(e => !e.camel && e.land !== false && !e.hexes.includes(G.oasis) && e.v.some(v => ends.has(v))).map(e => e.id);
}

function startVote() {
  if (G.tb !== 'caravanas' || !camelSpots().length) return;
  const n = G.players.length, by = activePlayer();
  G.voteQueue = [];
  for (let i = 0; i < n; i++) G.voteQueue.push((by + i) % n);
  G.votes = {};
  G.voteBy = by;
  G.voteReturn = G.phase;
  G.phase = 'vote';
  log('🐪 Votación: ¿dónde va el próximo camello? (cada voto cuesta 1 🌾 o 1 🐑)');
}

function castVote(pid, bid) {
  if (G.phase !== 'vote' || G.voteQueue[0] !== pid) return false;
  const b = { trigo: Math.max(0, toInt(bid && bid.trigo)), lana: Math.max(0, toInt(bid && bid.lana)) };
  if (b.trigo > P(pid).res.trigo || b.lana > P(pid).res.lana) return false;
  G.votes[pid] = b;
  G.voteQueue.shift();
  if (!G.voteQueue.length) finishVote();
  return true;
}

function finishVote() {
  const totals = {};
  for (const [pid, b] of Object.entries(G.votes)) {
    const p = P(+pid);
    p.res.trigo -= b.trigo; p.res.lana -= b.lana;
    G.bank.trigo += b.trigo; G.bank.lana += b.lana;
    totals[pid] = b.trigo + b.lana;
  }
  const max = Math.max(...Object.values(totals));
  const top = Object.keys(totals).filter(k => totals[k] === max).map(Number);
  const winner = max > 0 && top.length === 1 ? top[0] : G.voteBy;
  log(`🐪 Votos: ${G.players.map(p => `${esc(p.name)} ${totals[p.id] || 0}`).join(', ')}. Decide ${pname(winner)}.`);
  G.phase = G.voteReturn;
  G.votes = {};
  setPending(winner, 'camello', 'edge', camelSpots(), 'Elige dónde poner el camello');
}

function placeCamel(eid) {
  const e = G.edges[eid];
  e.camel = true;
  G.camelsLeft--;
  e.v.forEach(v => { G.vertices[v].camelRoute = true; });
  log('🐪 Un camello avanza por la ruta de la caravana.');
  updateLongestRoad();
}

// ============================ Ataque de los bárbaros ============================
function coastalLand() {
  return G.hexes.filter(h => TERRAIN[h.terrain].res && h.edges.some(e => G.edges[e].hexes.length === 1));
}

function spawnBarbarians() {
  if (G.tb !== 'barbaros') return;
  let placed = 0;
  for (let i = 0; i < 3 && G.barbsLeft > 0; i++) {
    const opts = coastalLand().filter(h => h.barbs < 3);
    if (!opts.length) break;
    const h = opts[rand(opts.length)];
    h.barbs++;
    G.barbsLeft--;
    placed++;
    if (h.barbs === 3 && !h.conquered) {
      h.conquered = true;
      log(`🪓 Los bárbaros conquistan ${hexName(h)}: deja de producir.`);
    }
  }
  if (placed) log(`🪓 Desembarcan ${placed} bárbaros en la costa.`);
}

function castleEdges() {
  return G.hexes[G.castle].edges.filter(e => !G.bknights.some(k => k.edge === e));
}

function deployKnight(pid, eid) {
  G.bknights.push({ owner: pid, edge: eid, mp: KNIGHT_MP, boosted: false });
  log(`🛡️ ${pname(pid)} despliega un caballero en el castillo.`);
}

// Aristas alcanzables desde «from» con «mp» movimientos
function bkReach(from, mp) {
  const dist = new Map([[from, 0]]), q = [from];
  while (q.length) {
    const e = q.shift(), d = dist.get(e);
    if (d >= mp) continue;
    for (const vid of G.edges[e].v) for (const n of G.vertices[vid].edges) {
      if (dist.has(n) || G.edges[n].land === false) continue;
      dist.set(n, d + 1);
      q.push(n);
    }
  }
  return dist;
}

function bkMoveTargets(pid, from) {
  const k = G.bknights.find(x => x.edge === from && x.owner === pid);
  if (!k || G.phase !== 'main' || pid !== G.current || k.mp <= 0) return [];
  const dist = bkReach(from, k.mp);
  return [...dist.keys()].filter(e => e !== from && !G.bknights.some(x => x.edge === e));
}

function moveBKnight(pid, from, to) {
  if (!bkMoveTargets(pid, from).includes(to)) return false;
  const k = G.bknights.find(x => x.edge === from && x.owner === pid);
  k.mp -= bkReach(from, k.mp).get(to);
  k.edge = to;
  log(`🛡️ ${pname(pid)} mueve un caballero.`);
  checkLiberation(pid);
  checkWin();
  return true;
}

function boostKnight(pid, eid) {
  const k = G.bknights.find(x => x.edge === eid && x.owner === pid);
  if (!k || k.boosted || G.phase !== 'main' || pid !== G.current) return false;
  if (P(pid).res.trigo >= 1) { P(pid).res.trigo--; G.bank.trigo++; }
  else return false;
  k.boosted = true;
  k.mp = Math.min(5, k.mp + 2);
  log(`${pname(pid)} da trigo a un caballero: +2 movimientos.`);
  return true;
}

// Si los caballeros alrededor de un hexágono superan a sus bárbaros, los capturan
function checkLiberation(mover) {
  for (const h of G.hexes) {
    if (!h.barbs) continue;
    const around = G.bknights.filter(k => h.edges.includes(k.edge));
    if (around.length <= h.barbs) continue;
    let n = h.barbs;
    const owners = around.map(k => k.owner);
    let i = Math.max(0, owners.indexOf(mover));
    while (n-- > 0) { P(owners[i % owners.length]).prisoners++; i++; }
    log(`⛓️ Los caballeros capturan ${h.barbs} bárbaro(s) en ${hexName(h)}.`);
    // Bajas: con un 1 o 2 en el dado cae un caballero del que movió (y gana 3 monedas)
    if (rand(6) < 2) {
      const lost = around.find(k => k.owner === mover) || around[0];
      G.bknights.splice(G.bknights.indexOf(lost), 1);
      P(lost.owner).gold += 3;
      log(`⚰️ Cae un caballero de ${pname(lost.owner)} en la batalla (recibe 3 🪙).`);
    }
    h.barbs = 0;
    h.conquered = false;
  }
}

// ============================ Ganchos desde las reglas ============================
function tbOnRoad(pid, eid) {
  if (G.tb === 'rios' && riverAdjacent(G.edges[eid])) earnGold(pid, 1, 'por construir junto al río');
}

function tbOnSettlement(pid, vid, setup) {
  if (G.tb === 'rios' && G.vertices[vid].river) earnGold(pid, 1, 'por construir junto al río');
  if (!setup) tbOnBuilding();
}

function tbOnBuilding() {
  if (G.tb === 'caravanas') startVote();
  if (G.tb === 'barbaros') spawnBarbarians();
}

function tbTurnReset() {
  if (G.tb === 'barbaros') G.bknights.forEach(k => { k.mp = KNIGHT_MP; k.boosted = false; });
}

// Respuestas a elecciones pendientes de este módulo
const EXTRA_PICKS = {
  fish3: (pid, v) => {
    const pool = [];
    RES.forEach(r => { for (let i = 0; i < P(v).res[r]; i++) pool.push(r); });
    const r = pool[rand(pool.length)];
    P(v).res[r]--; P(pid).res[r]++;
    log(`${pname(pid)} le roba un recurso a ${pname(v)}.`);
  },
  fish4: (pid, v) => { give(pid, v, 1); log(`${pname(pid)} toma ${RES_INFO[v].icon} del banco.`); },
  camello: (pid, v) => placeCamel(v),
  bkDeploy: (pid, v) => deployKnight(pid, v),
};

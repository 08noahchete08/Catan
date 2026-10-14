'use strict';
// ---------------------------------------------------------------------------
// Estado y reglas del juego
// ---------------------------------------------------------------------------

const COSTS = {
  camino:  { madera: 1, arcilla: 1 },
  poblado: { madera: 1, arcilla: 1, lana: 1, trigo: 1 },
  ciudad:  { trigo: 2, mineral: 3 },
  carta:   { lana: 1, trigo: 1, mineral: 1 },
  barco:   { madera: 1, lana: 1 },
};

const DEV_INFO = {
  caballero:  { name: 'Caballero', icon: '⚔️', desc: 'Mueve el ladrón y roba una carta a un jugador junto a ese hexágono.' },
  carreteras: { name: 'Construcción de carreteras', icon: '🛤️', desc: 'Construye 2 caminos gratis (o barcos, con Navegantes).' },
  abundancia: { name: 'Año de abundancia', icon: '🎁', desc: 'Toma 2 cartas de recurso cualesquiera del banco.' },
  monopolio:  { name: 'Monopolio', icon: '💰', desc: 'Elige un recurso: todos los demás te entregan todas sus cartas de ese recurso.' },
  puntos:     { name: 'Punto de victoria', icon: '🏆', desc: 'Vale 1 punto de victoria. Se mantiene oculta.' },
};

const PLAYER_COLORS = [
  { name: 'Rojo',    hex: '#e03b3b' },
  { name: 'Azul',    hex: '#2f6fde' },
  { name: 'Blanco',  hex: '#f2f2f2' },
  { name: 'Naranja', hex: '#f39c12' },
  { name: 'Verde',   hex: '#27ae60' },
  { name: 'Marrón',  hex: '#8e5a2b' },
];

const WIN_POINTS = 10;

let G = null;

// ---------- utilidades ----------
function zeroRes() { return { madera: 0, arcilla: 0, lana: 0, trigo: 0, mineral: 0 }; }
function total(res) { return RES.reduce((s, r) => s + (res[r] || 0), 0); }
function rand(n) { return Math.floor(Math.random() * n); }
function P(id) { return G.players[id]; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pname(pid) { const p = P(pid); return `<span class="pn" style="--pc:${p.color}">${esc(p.name)}</span>`; }
function resStr(obj) {
  return RES.filter(r => obj[r] > 0).map(r => RES_INFO[r].icon.repeat(Math.min(obj[r], 6)) + (obj[r] > 6 ? `×${obj[r]}` : '')).join(' ') || 'nada';
}
function log(html) { G.log.push({ turn: G.turn, html }); if (G.log.length > 250) G.log.shift(); }
function hexName(h) { return TERRAIN[h.terrain].name + (h.number ? ` (${h.number})` : ''); }

// ---------- creación ----------
function newGame(setup, opts) {
  const n = setup.length;
  const cfg = CONFIGS[n > 4 ? 'ext' : 'base'];
  const seafarers = opts.expansion === 'seafarers';
  const board = seafarers ? generateSeaBoard(n) : generateBoard(cfg);
  const start = rand(n);
  const order = [];
  for (let i = 0; i < n; i++) order.push((start + i) % n);
  const deck = [];
  for (const [t, c] of Object.entries(cfg.dev)) for (let i = 0; i < c; i++) deck.push(t);
  shuffle(deck);
  const bank = zeroRes();
  RES.forEach(r => { bank[r] = cfg.bank; });

  G = {
    id: Math.random().toString(36).slice(2),
    cfg, ...board,
    players: setup.map((p, i) => ({
      id: i, name: p.name, color: p.color, isAI: p.isAI, away: false,
      res: zeroRes(), dev: [], knights: 0, roads: 15, settlements: 5, cities: 4, roadLen: 0,
      ships: seafarers ? 15 : 0, islands: [],
    })),
    bank, devDeck: deck,
    // Reglas configurables
    winPoints: Math.min(20, Math.max(5, Number(opts.winPoints) || WIN_POINTS)),
    cutRoads: opts.cutRoads !== false,
    // Reglas para 5-6 jugadores: 'paired' (turnos en pareja, 2023), 'special' (fase especial clásica) o 'none'
    mode5: n > 4 && ['paired', 'special', 'none'].includes(opts.mode5) ? opts.mode5 : (n > 4 && opts.mode5 == null ? 'paired' : 'none'),
    partner: null, pairedActive: false,
    expansion: seafarers ? 'seafarers' : 'none', seafarers,
    goldNeed: {}, goldQueue: [], afterGold: null, shipMoved: false,
    variants: cleanVariants(opts.variants), harborHolder: null, eventDeck: null, newYearAt: 0, epidemic: false, lastEvent: null,
    phase: 'setup-settlement',
    setupOrder: order.concat(order.slice().reverse()), setupIdx: 0,
    current: order[0], lastSettlement: null,
    turn: 0, dice: null, devPlayed: false,
    discardQueue: [], discardNeed: {}, afterRobber: 'main', stealCandidates: [],
    freeRoads: 0, specialQueue: [], specialBuilder: null,
    longestHolder: null, armyHolder: null, winner: null,
    offer: null, trade: null, aiTrades: 0, aiOffers: 0,
    log: [],
  };
  annotateBoard();
  log(`Nueva partida: ${n} jugadores, ${seafarers ? '⛵ Navegantes de Catán' : `tablero ${cfg.id === 'ext' ? 'ampliado (5-6)' : 'básico'}`}. Empieza ${pname(order[0])}.`);
}

// Jugador controlado por la IA (de forma permanente o porque se ha desconectado)
function isBot(pid) { return P(pid).isAI || P(pid).away; }
function handSize(p) { return p.handCount != null ? p.handCount : total(p.res); }

// Jugador que está jugando su turno (el principal, o su pareja en la fase de acción)
function activePlayer() { return G.pairedActive ? G.partner : G.current; }

// Jugador en pareja: el 3.º a la izquierda del jugador principal (enfrente, con 6)
function partnerOf(pid) { return (pid + 3) % G.players.length; }

function actor() {
  if (!G) return null;
  if (G.phase === 'discard') return G.discardQueue[0];
  if (G.phase === 'special-build') return G.specialBuilder;
  if (G.phase === 'gold') return G.goldQueue[0];
  return activePlayer();
}

function vp(pid, includeHidden = true) {
  let s = 0;
  for (const v of G.vertices) if (v.building && v.building.owner === pid) s += v.building.type === 'ciudad' ? 2 : 1;
  if (G.longestHolder === pid) s += 2;
  if (G.armyHolder === pid) s += 2;
  if (G.harborHolder === pid) s += 2;
  s += (P(pid).islands || []).length * 2;
  if (includeHidden) s += P(pid).dev.filter(d => d.type === 'puntos').length;
  return s;
}

function canAfford(pid, cost) { return Object.entries(cost).every(([r, n]) => P(pid).res[r] >= n); }
function pay(pid, cost) {
  for (const [r, n] of Object.entries(cost)) { P(pid).res[r] -= n; G.bank[r] += n; }
}
function give(pid, r, n) {
  n = Math.min(n, G.bank[r]);
  P(pid).res[r] += n; G.bank[r] -= n;
  return n;
}

function canBuildNow(pid) {
  return (G.phase === 'main' && pid === G.current) || (G.phase === 'special-build' && pid === G.specialBuilder) ||
    (G.phase === 'paired' && pid === G.partner);
}

// ---------- validación de posiciones ----------
function validSettlementSpot(pid, vid, ignoreRoad) {
  const v = G.vertices[vid];
  if (v.building || v.land === false) return false;
  if (v.adj.some(a => G.vertices[a].building)) return false;
  // Sin «cortar caminos»: no se puede construir donde pasa el camino de otro jugador
  if (!G.cutRoads) {
    const count = {};
    for (const e of v.edges) {
      const o = G.edges[e].road;
      if (o === null || o === pid) continue;
      count[o] = (count[o] || 0) + 1;
      if (count[o] >= 2) return false;
    }
  }
  if (!ignoreRoad && !v.edges.some(e => G.edges[e].road === pid || G.edges[e].ship === pid)) return false;
  return true;
}

function validRoadSpot(pid, eid, fromVertex) {
  const e = G.edges[eid];
  if (e.road !== null || e.ship != null || e.land === false) return false;
  if (fromVertex != null) return e.v.includes(fromVertex);
  return e.v.some(vid => {
    const v = G.vertices[vid];
    if (v.building) return v.building.owner === pid;
    return v.edges.some(x => x !== eid && G.edges[x].road === pid);
  });
}

function settlementSpots(pid, ignoreRoad) {
  // En Navegantes, la colocación inicial es solo en la isla principal
  const mainOnly = ignoreRoad && G.seafarers && G.phase === 'setup-settlement';
  return G.vertices.filter(v => (!mainOnly || v.island === 0) && validSettlementSpot(pid, v.id, ignoreRoad)).map(v => v.id);
}
function roadSpots(pid, fromVertex) {
  return G.edges.filter(e => validRoadSpot(pid, e.id, fromVertex)).map(e => e.id);
}
function citySpots(pid) {
  return G.vertices.filter(v => v.building && v.building.owner === pid && v.building.type === 'poblado').map(v => v.id);
}

// ---------- construcción ----------
function buildSettlement(pid, vid) {
  const setup = G.phase === 'setup-settlement';
  const p = P(pid);
  if (setup) { if (pid !== G.current) return false; }
  else if (!canBuildNow(pid) || !canAfford(pid, COSTS.poblado)) return false;
  if (p.settlements <= 0 || !validSettlementSpot(pid, vid, setup)) return false;
  if (setup && G.seafarers && G.vertices[vid].island !== 0) return false;
  if (!setup) pay(pid, COSTS.poblado);
  const v = G.vertices[vid];
  v.building = { owner: pid, type: 'poblado' };
  p.settlements--;
  log(`${pname(pid)} construye un poblado${v.port ? ' en un puerto' : ''}.`);
  updateHarbormaster();
  if (!setup) claimIsland(pid, vid);
  if (setup) {
    G.lastSettlement = vid;
    if (G.setupIdx >= G.players.length) {
      const got = zeroRes();
      for (const hid of v.hexes) {
        const t = TERRAIN[G.hexes[hid].terrain];
        if (t.res) got[t.res] += give(pid, t.res, 1);
        if (t.gold) G.goldNeed[pid] = (G.goldNeed[pid] || 0) + 1;
      }
      if (total(got)) log(`${pname(pid)} recibe ${resStr(got)}.`);
    }
    G.phase = 'setup-road';
    startGold('setup-road');
  }
  updateLongestRoad();
  checkWin();
  return true;
}

function buildCity(pid, vid) {
  const p = P(pid);
  if (!canBuildNow(pid) || !canAfford(pid, COSTS.ciudad) || p.cities <= 0) return false;
  const v = G.vertices[vid];
  if (!v.building || v.building.owner !== pid || v.building.type !== 'poblado') return false;
  pay(pid, COSTS.ciudad);
  v.building.type = 'ciudad';
  p.cities--; p.settlements++;
  log(`${pname(pid)} mejora un poblado a ciudad.`);
  updateHarbormaster();
  checkWin();
  return true;
}

function placeRoad(pid, eid) {
  G.edges[eid].road = pid;
  P(pid).roads--;
}

function buildRoad(pid, eid) {
  const p = P(pid);
  if (p.roads <= 0 || G.edges[eid] == null) return false;
  if (G.phase === 'setup-road') {
    if (pid !== G.current || !validRoadSpot(pid, eid, G.lastSettlement)) return false;
    placeRoad(pid, eid);
    log(`${pname(pid)} construye un camino.`);
    updateLongestRoad();
    advanceSetup();
    return true;
  }
  if (G.phase === 'road-building') {
    if (pid !== activePlayer() || !validRoadSpot(pid, eid)) return false;
    placeRoad(pid, eid);
    G.freeRoads--;
    log(`${pname(pid)} construye un camino gratis.`);
    if (G.freeRoads <= 0 || !freeBuildLeft(pid)) G.phase = G.pairedActive ? 'paired' : 'main';
    updateLongestRoad();
    checkWin();
    return true;
  }
  if (!canBuildNow(pid) || !canAfford(pid, COSTS.camino) || !validRoadSpot(pid, eid)) return false;
  pay(pid, COSTS.camino);
  placeRoad(pid, eid);
  log(`${pname(pid)} construye un camino.`);
  updateLongestRoad();
  checkWin();
  return true;
}

function buyDev(pid) {
  if (!canBuildNow(pid) || !canAfford(pid, COSTS.carta) || !G.devDeck.length) return false;
  pay(pid, COSTS.carta);
  const type = G.devDeck.pop();
  P(pid).dev.push({ type, turn: G.turn });
  log(`${pname(pid)} compra una carta de desarrollo.`);
  checkWin();
  return true;
}

// ¿Puede seguir construyendo caminos o barcos gratis?
function freeBuildLeft(pid) {
  const p = P(pid);
  return (p.roads > 0 && roadSpots(pid).length > 0) || (p.ships > 0 && shipSpots(pid).length > 0);
}

function advanceSetup() {
  G.setupIdx++;
  if (G.setupIdx >= G.setupOrder.length) {
    G.current = G.setupOrder[0];
    G.turn = 1;
    G.phase = 'roll';
    log(`¡Comienza la partida! Turno de ${pname(G.current)}.`);
  } else {
    G.current = G.setupOrder[G.setupIdx];
    G.phase = 'setup-settlement';
  }
}

// ---------- dados, producción y ladrón ----------
function rollDice() {
  if (G.phase !== 'roll') return false;
  let d = [rand(6) + 1, rand(6) + 1], event = null;
  if (G.variants.eventCards) {
    const drawn = drawEventCard();
    d = drawn.dice;
    event = drawn.card.ev;
  }
  const s = d[0] + d[1];
  G.dice = d;
  G.lastEvent = null;
  log(`${pname(G.current)} ${G.variants.eventCards ? 'roba una carta de eventos' : 'tira los dados'}: <b>${s}</b>.`);
  if (event) applyEvent(event);
  if (s === 7) {
    const n = G.players.length;
    G.discardQueue = [];
    G.discardNeed = {};
    for (let i = 0; i < n; i++) {
      const pid = (G.current + i) % n;
      const t = total(P(pid).res);
      if (t > 7) { G.discardQueue.push(pid); G.discardNeed[pid] = Math.floor(t / 2); }
    }
    G.afterRobber = 'main';
    G.phase = G.discardQueue.length ? 'discard' : 'robber';
    if (G.discardQueue.length) log(`Los jugadores con más de 7 cartas deben descartar la mitad.`);
  } else {
    produce(s);
    G.epidemic = false;
    G.phase = 'main';
    startGold('main');
  }
  return true;
}

function produce(n) {
  const demand = {};
  RES.forEach(r => { demand[r] = {}; });
  for (const h of G.hexes) {
    if (h.number !== n || h.id === G.robber) continue;
    const r = TERRAIN[h.terrain].res;
    if (TERRAIN[h.terrain].gold) {
      for (const vid of h.vertices) {
        const b = G.vertices[vid].building;
        if (b) G.goldNeed[b.owner] = (G.goldNeed[b.owner] || 0) + (b.type === 'ciudad' && !G.epidemic ? 2 : 1);
      }
      continue;
    }
    if (!r) continue;
    for (const vid of h.vertices) {
      const b = G.vertices[vid].building;
      if (b) demand[r][b.owner] = (demand[r][b.owner] || 0) + (b.type === 'ciudad' && !G.epidemic ? 2 : 1);
    }
  }
  const gains = G.players.map(() => zeroRes());
  for (const r of RES) {
    const owners = Object.keys(demand[r]).map(Number);
    if (!owners.length) continue;
    const tot = owners.reduce((s, o) => s + demand[r][o], 0);
    if (tot <= G.bank[r]) owners.forEach(o => { gains[o][r] += demand[r][o]; });
    else if (owners.length === 1) {
      gains[owners[0]][r] += G.bank[r];
      log(`El banco no tiene suficiente ${RES_INFO[r].name.toLowerCase()}.`);
    } else log(`El banco no tiene suficiente ${RES_INFO[r].name.toLowerCase()}: nadie la recibe.`);
  }
  let any = false;
  gains.forEach((g, pid) => {
    if (!total(g)) return;
    any = true;
    RES.forEach(r => { P(pid).res[r] += g[r]; G.bank[r] -= g[r]; });
    log(`${pname(pid)} recibe ${resStr(g)}.`);
  });
  if (!any) log('Nadie produce recursos.');
}

function discard(pid, sel) {
  if (G.phase !== 'discard' || G.discardQueue[0] !== pid) return false;
  const p = P(pid);
  if (total(sel) !== G.discardNeed[pid]) return false;
  if (RES.some(r => (sel[r] || 0) < 0 || (sel[r] || 0) > p.res[r])) return false;
  RES.forEach(r => { p.res[r] -= sel[r] || 0; G.bank[r] += sel[r] || 0; });
  log(`${pname(pid)} descarta ${G.discardNeed[pid]} cartas.`);
  G.discardQueue.shift();
  if (!G.discardQueue.length) G.phase = 'robber';
  return true;
}

function robberVictims(hid, pid) {
  const s = new Set();
  for (const vid of G.hexes[hid].vertices) {
    const b = G.vertices[vid].building;
    if (b && b.owner !== pid && total(P(b.owner).res) > 0) s.add(b.owner);
  }
  return [...s];
}

function moveRobber(hid) {
  if (G.phase !== 'robber') return false;
  let victims;
  if (pirateAllowed(hid)) {
    G.pirate = hid;
    log(`🏴‍☠️ ${pname(activePlayer())} mueve el pirata.`);
    victims = pirateVictims(hid, activePlayer());
  } else {
    if (!robberAllowed(hid, activePlayer()) || isSea(G.hexes[hid])) return false;
    G.robber = hid;
    log(`${pname(activePlayer())} mueve el ladrón a ${hexName(G.hexes[hid])}.`);
    victims = robberVictims(hid, activePlayer());
  }
  if (!victims.length) G.phase = G.afterRobber;
  else if (victims.length === 1) doSteal(victims[0]);
  else { G.stealCandidates = victims; G.phase = 'steal'; }
  return true;
}

function steal(victim) {
  if (G.phase !== 'steal' || !G.stealCandidates.includes(victim)) return false;
  doSteal(victim);
  return true;
}

function doSteal(victim) {
  const pool = [];
  RES.forEach(r => { for (let i = 0; i < P(victim).res[r]; i++) pool.push(r); });
  if (pool.length) {
    const r = pool[rand(pool.length)];
    P(victim).res[r]--;
    const thief = activePlayer();
    P(thief).res[r]++;
    G.lastSteal = { thief, victim, res: r };
    log(`${pname(thief)} roba una carta a ${pname(victim)}.`);
  }
  G.stealCandidates = [];
  G.phase = G.afterRobber;
}

// ---------- cartas de desarrollo ----------
function playableDev(pid, type) {
  if (!G || pid !== activePlayer() || G.devPlayed || type === 'puntos') return false;
  if (type === 'caballero') { if (!['roll', 'main', 'paired'].includes(G.phase)) return false; }
  else if (G.phase !== 'main' && G.phase !== 'paired') return false;
  return P(pid).dev.some(d => d.type === type && d.turn < G.turn);
}

function useDev(pid, type) {
  const p = P(pid);
  const i = p.dev.findIndex(d => d.type === type && d.turn < G.turn);
  p.dev.splice(i, 1);
  G.devPlayed = true;
  log(`${pname(pid)} juega <b>${DEV_INFO[type].name}</b>.`);
}

function playKnight(pid) {
  if (!playableDev(pid, 'caballero')) return false;
  useDev(pid, 'caballero');
  P(pid).knights++;
  updateLargestArmy(pid);
  G.afterRobber = G.phase;
  G.phase = 'robber';
  checkWin();
  return true;
}

function playRoadBuilding(pid) {
  if (!playableDev(pid, 'carreteras') || !freeBuildLeft(pid)) return false;
  useDev(pid, 'carreteras');
  G.freeRoads = Math.min(2, P(pid).roads + P(pid).ships);
  G.phase = 'road-building';
  return true;
}

function endRoadBuilding(pid) {
  if (G.phase !== 'road-building' || pid !== activePlayer()) return false;
  G.freeRoads = 0;
  G.phase = G.pairedActive ? 'paired' : 'main';
  return true;
}

function playAbundance(pid, r1, r2) {
  if (!playableDev(pid, 'abundancia') || !RES.includes(r1) || !RES.includes(r2)) return false;
  const need = zeroRes(); need[r1]++; need[r2]++;
  if (RES.some(r => G.bank[r] < need[r])) return false;
  useDev(pid, 'abundancia');
  RES.forEach(r => give(pid, r, need[r]));
  log(`${pname(pid)} toma ${resStr(need)} del banco.`);
  return true;
}

function playMonopoly(pid, r) {
  if (!playableDev(pid, 'monopolio') || !RES.includes(r)) return false;
  useDev(pid, 'monopolio');
  let got = 0;
  for (const o of G.players) {
    if (o.id === pid) continue;
    got += o.res[r];
    P(pid).res[r] += o.res[r];
    o.res[r] = 0;
  }
  log(`${pname(pid)} se queda con ${got} ${RES_INFO[r].icon} de los demás.`);
  return true;
}

// ---------- comercio ----------
function bankRate(pid, r) {
  let rate = 4;
  for (const v of G.vertices) {
    if (!v.building || v.building.owner !== pid || !v.port) continue;
    if (v.port === 'generic') rate = Math.min(rate, 3);
    else if (v.port === r) rate = 2;
  }
  return rate;
}

function bankTrade(pid, giveR, getR) {
  const may = (G.phase === 'main' && pid === G.current) || (G.phase === 'paired' && pid === G.partner);
  if (!may || giveR === getR) return false;
  const rate = bankRate(pid, giveR);
  if (P(pid).res[giveR] < rate || G.bank[getR] < 1) return false;
  P(pid).res[giveR] -= rate; G.bank[giveR] += rate;
  give(pid, getR, 1);
  log(`${pname(pid)} cambia con el banco ${rate} ${RES_INFO[giveR].icon} por 1 ${RES_INFO[getR].icon}.`);
  return true;
}

function playerTrade(a, b, giveObj, getObj) {
  if (G.phase !== 'main' || a !== G.current || b === a || P(b) == null) return false;
  if (!total(giveObj) || !total(getObj)) return false;
  if (RES.some(r => (giveObj[r] || 0) > P(a).res[r] || (getObj[r] || 0) > P(b).res[r])) return false;
  RES.forEach(r => {
    const g = giveObj[r] || 0, w = getObj[r] || 0;
    P(a).res[r] += w - g;
    P(b).res[r] += g - w;
  });
  log(`${pname(a)} comercia con ${pname(b)}: ${resStr(giveObj)} ⇄ ${resStr(getObj)}.`);
  return true;
}

// Propuesta del jugador en turno a todos los demás
function proposeTrade(pid, giveObj, getObj) {
  if (G.phase !== 'main' || pid !== G.current) return false;
  if (!total(giveObj) || !total(getObj) || RES.some(r => giveObj[r] && getObj[r])) return false;
  if (RES.some(r => giveObj[r] > P(pid).res[r])) return false;
  const responses = {};
  for (const o of G.players) {
    if (o.id === pid) continue;
    const has = RES.every(r => o.res[r] >= getObj[r]);
    responses[o.id] = !has ? 'no' : isBot(o.id) ? (AI.acceptTrade(o.id, pid, giveObj, getObj) ? 'yes' : 'no') : null;
  }
  G.trade = { from: pid, give: giveObj, get: getObj, responses };
  log(`${pname(pid)} propone un intercambio: ${resStr(giveObj)} ⇄ ${resStr(getObj)}.`);
  return true;
}

function respondTrade(pid, accept) {
  const t = G.trade;
  if (!t || !(pid in t.responses) || t.responses[pid] !== null) return false;
  const has = RES.every(r => P(pid).res[r] >= t.get[r]);
  t.responses[pid] = accept && has ? 'yes' : 'no';
  return true;
}

function confirmTrade(pid, to) {
  const t = G.trade;
  if (!t || t.from !== pid || t.responses[to] !== 'yes') return false;
  G.trade = null;
  if (!playerTrade(pid, to, t.give, t.get)) log('El intercambio no pudo realizarse.');
  return true;
}

function cancelTrade(pid) {
  if (!G.trade || G.trade.from !== pid) return false;
  G.trade = null;
  return true;
}

// Respuesta de un humano a la oferta de una IA
function respondOffer(pid, accept) {
  const o = G.offer;
  if (!o || !o.to.includes(pid)) return false;
  if (accept) {
    G.offer = null;
    if (!playerTrade(o.from, pid, o.give, o.get)) log('El intercambio no pudo realizarse.');
    return true;
  }
  o.to = o.to.filter(x => x !== pid);
  if (!o.to.length) {
    G.offer = null;
    log(`Nadie acepta la oferta de ${pname(o.from)}.`);
  }
  return true;
}

// ---------- acciones (punto de entrada común para la partida local y el servidor) ----------
function toInt(x) { const n = Number(x); return Number.isInteger(n) ? n : -1; }
function cleanRes(o) {
  const r = zeroRes();
  if (o && typeof o === 'object') RES.forEach(k => { const n = toInt(o[k]); r[k] = n > 0 && n <= 30 ? n : 0; });
  return r;
}

function applyAction(pid, a) {
  if (!G || !a || G.phase === 'gameover' || !G.players[pid]) return false;
  const v = toInt(a.v), e = toInt(a.e), h = toInt(a.h);
  switch (a.type) {
    case 'settle': return !!G.vertices[v] && buildSettlement(pid, v);
    case 'city': return !!G.vertices[v] && buildCity(pid, v);
    case 'road': return !!G.edges[e] && buildRoad(pid, e);
    case 'ship': return !!G.edges[e] && buildShip(pid, e);
    case 'move-ship': return moveShip(pid, toInt(a.from), toInt(a.to));
    case 'gold': return chooseGold(pid, cleanRes(a.sel));
    case 'roll': return pid === G.current && rollDice();
    case 'buy': return buyDev(pid);
    case 'end-turn': return endTurn(pid);
    case 'end-special': return endSpecial(pid);
    case 'end-paired': return endPaired(pid);
    case 'end-roads': return endRoadBuilding(pid);
    case 'discard': return discard(pid, cleanRes(a.sel));
    case 'robber': return pid === activePlayer() && !!G.hexes[h] && moveRobber(h);
    case 'steal': return pid === activePlayer() && steal(toInt(a.p));
    case 'knight': return playKnight(pid);
    case 'roadbuilding': return playRoadBuilding(pid);
    case 'yop': return playAbundance(pid, a.r1, a.r2);
    case 'mono': return playMonopoly(pid, a.r);
    case 'bank': return RES.includes(a.give) && RES.includes(a.get) && bankTrade(pid, a.give, a.get);
    case 'trade-propose': return proposeTrade(pid, cleanRes(a.give), cleanRes(a.get));
    case 'trade-respond': return respondTrade(pid, !!a.accept);
    case 'trade-confirm': return confirmTrade(pid, toInt(a.to));
    case 'trade-cancel': return cancelTrade(pid);
    case 'offer-respond': return respondOffer(pid, !!a.accept);
  }
  return false;
}

// ---------- turnos ----------
function endTurn(pid) {
  if (G.phase !== 'main' || pid !== G.current) return false;
  G.trade = null;
  log(`${pname(pid)} termina su turno.`);
  if (G.mode5 === 'paired') {
    // Turno en pareja: ahora actúa el jugador emparejado
    G.partner = partnerOf(G.current);
    G.pairedActive = true;
    G.devPlayed = false;
    G.aiTrades = 0;
    G.shipMoved = false;
    G.phase = 'paired';
    log(`🤝 Acción del jugador en pareja: ${pname(G.partner)}.`);
    checkWin();
  } else if (G.mode5 === 'special') {
    const n = G.players.length;
    G.specialQueue = [];
    for (let i = 1; i < n; i++) G.specialQueue.push((G.current + i) % n);
    G.phase = 'special-build';
    advanceSpecial();
  } else nextTurn();
  return true;
}

function endPaired(pid) {
  if (G.phase !== 'paired' || pid !== G.partner) return false;
  log(`${pname(pid)} termina su acción.`);
  nextTurn();
  return true;
}

function endSpecial(pid) {
  if (G.phase !== 'special-build' || pid !== G.specialBuilder) return false;
  advanceSpecial();
  return true;
}

// Pasa al siguiente jugador de la fase especial que pueda construir algo.
function advanceSpecial() {
  while (G.specialQueue.length) {
    const pid = G.specialQueue.shift();
    if (canBuildAnything(pid)) { G.specialBuilder = pid; return; }
  }
  nextTurn();
}

function canBuildAnything(pid) {
  const p = P(pid);
  return (canAfford(pid, COSTS.carta) && G.devDeck.length > 0) ||
    (canAfford(pid, COSTS.ciudad) && p.cities > 0 && citySpots(pid).length > 0) ||
    (canAfford(pid, COSTS.poblado) && p.settlements > 0 && settlementSpots(pid, false).length > 0) ||
    (canAfford(pid, COSTS.camino) && p.roads > 0 && roadSpots(pid).length > 0) ||
    (G.seafarers && canAfford(pid, COSTS.barco) && p.ships > 0 && shipSpots(pid).length > 0);
}

function nextTurn() {
  G.current = (G.current + 1) % G.players.length;
  G.turn++;
  G.phase = 'roll';
  G.dice = null;
  G.devPlayed = false;
  G.shipMoved = false;
  G.specialBuilder = null;
  G.partner = null;
  G.pairedActive = false;
  G.aiTrades = 0;
  G.aiOffers = 0;
  G.trade = null;
  checkWin();
  checkDeadlock();
}

// Con muchos puntos para ganar el tablero puede llenarse sin que nadie llegue.
// Si ya nadie puede conseguir más puntos, gana quien tenga más.
function canGainPoints(pid) {
  const p = P(pid);
  if (G.devDeck.length) return true;
  if (p.cities > 0 && citySpots(pid).length) return true;
  if (p.settlements > 0 && (settlementSpots(pid, false).length || AI.roadTarget(pid))) return true;
  return false;
}

function checkDeadlock() {
  if (G.phase === 'gameover' || G.players.some(p => canGainPoints(p.id))) return;
  const best = Math.max(...G.players.map(p => vp(p.id)));
  const winner = G.players.find(p => vp(p.id) === best).id;
  G.winner = winner;
  G.phase = 'gameover';
  log(`🔒 <b>Partida bloqueada:</b> ya nadie puede conseguir más puntos. Gana ${pname(winner)} con ${best} puntos.`);
}

function checkWin() {
  if (G.phase === 'gameover') return;
  if (G.phase === 'setup-settlement' || G.phase === 'setup-road') return;
  const pid = activePlayer();
  if (vp(pid) >= G.winPoints) {
    G.winner = pid;
    G.phase = 'gameover';
    log(`🏆 ¡${pname(pid)} alcanza ${vp(pid)} puntos y gana la partida!`);
  }
}

// ---------- Gran Ruta Comercial y Gran Ejército ----------
function longestRoadFor(pid) {
  let best = 0;
  const used = new Set();
  const building = vid => G.vertices[vid].building;
  const blocked = vid => { const b = building(vid); return b && b.owner !== pid; };
  const own = vid => { const b = building(vid); return b && b.owner === pid; };
  const kind = e => (e.road === pid ? 'r' : e.ship === pid ? 's' : null);
  function dfs(vid, len, last) {
    if (len > best) best = len;
    for (const eid of G.vertices[vid].edges) {
      const e = G.edges[eid];
      const k = kind(e);
      if (!k || used.has(eid)) continue;
      if (last && k !== last && !own(vid)) continue;
      const nv = e.v[0] === vid ? e.v[1] : e.v[0];
      used.add(eid);
      if (blocked(nv)) { if (len + 1 > best) best = len + 1; }
      else dfs(nv, len + 1, k);
      used.delete(eid);
    }
  }
  const starts = new Set();
  for (const e of G.edges) if (kind(e)) { starts.add(e.v[0]); starts.add(e.v[1]); }
  for (const st of starts) dfs(st, 0, null);
  return best;
}

function updateLongestRoad() {
  G.players.forEach(p => { p.roadLen = longestRoadFor(p.id); });
  const max = Math.max(...G.players.map(p => p.roadLen));
  const holder = G.longestHolder;
  if (holder !== null && max >= 5 && P(holder).roadLen === max) return;
  const top = G.players.filter(p => p.roadLen === max && max >= 5);
  const nh = top.length === 1 ? top[0].id : null;
  if (nh !== holder) {
    G.longestHolder = nh;
    if (nh !== null) log(`🛣️ ${pname(nh)} consigue la <b>Gran Ruta Comercial</b> (${max}).`);
    else log('🛣️ Nadie tiene ahora la Gran Ruta Comercial.');
  }
}

function updateLargestArmy(pid) {
  const k = P(pid).knights;
  const h = G.armyHolder;
  if (k >= 3 && h !== pid && (h === null || k > P(h).knights)) {
    G.armyHolder = pid;
    log(`🛡️ ${pname(pid)} consigue el <b>Gran Ejército de Caballería</b> (${k}).`);
  }
}

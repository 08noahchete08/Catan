'use strict';
// ---------------------------------------------------------------------------
// Expansión «Ciudades y Caballeros»: mercancías, caballeros, bárbaros,
// mejoras de ciudad, metrópolis, murallas y cartas de progreso.
// ---------------------------------------------------------------------------

const CK_COSTS = {
  caballero: { lana: 1, mineral: 1 },
  ascender: { lana: 1, mineral: 1 },
  activar: { trigo: 1 },
  muralla: { arcilla: 2 },
};

const TRACKS = {
  trade:    { name: 'Comercio', com: 'tela',   color: '#e0b43a', gate: '🟨',
    ability: 'Casa de comercio: cambias mercancías 2:1 con el banco.' },
  politics: { name: 'Política', com: 'moneda', color: '#3f6fb5', gate: '🟦',
    ability: 'Fortaleza: puedes ascender caballeros a poderosos (nivel 3).' },
  science:  { name: 'Ciencia',  com: 'papel',  color: '#4e9a3a', gate: '🟩',
    ability: 'Acueducto: si en una tirada no recibes nada, eliges 1 recurso.' },
};

// Mercancía que producen las ciudades en cada terreno
const TERRAIN_COM = { bosque: 'papel', pasto: 'tela', montana: 'moneda' };

const BARB_TRACK = 7;
const KNIGHT_NAMES = { 1: 'Caballero', 2: 'Caballero fuerte', 3: 'Caballero poderoso' };

const PROGRESS = {
  // Ciencia
  alquimista: { deck: 'science', count: 2, icon: '⚗️', name: 'Alquimista', desc: 'Antes de tirar: eliges el resultado de los dados rojo y amarillo.' },
  inventor: { deck: 'science', count: 2, icon: '💡', name: 'Inventor', desc: 'Intercambia dos fichas de número (no 2, 12, 6 ni 8).' },
  grua: { deck: 'science', count: 2, icon: '🏗️', name: 'Grúa', desc: 'Tu próxima mejora de ciudad de este turno cuesta 1 mercancía menos.' },
  ingeniero: { deck: 'science', count: 1, icon: '🧱', name: 'Ingeniero', desc: 'Construye una muralla gratis.' },
  irrigacion: { deck: 'science', count: 2, icon: '💧', name: 'Irrigación', desc: 'Recibes 2 de trigo por cada campo junto a tus edificios.' },
  medicina: { deck: 'science', count: 2, icon: '⚕️', name: 'Medicina', desc: 'Tu próxima ciudad de este turno cuesta 2 de mineral y 1 de trigo.' },
  mineria: { deck: 'science', count: 2, icon: '⛏️', name: 'Minería', desc: 'Recibes 2 de mineral por cada montaña junto a tus edificios.' },
  imprenta: { deck: 'science', count: 1, icon: '🖨️', name: 'Imprenta', desc: '1 punto de victoria.', vp: true },
  carreterasP: { deck: 'science', count: 2, icon: '🛤️', name: 'Construcción de carreteras', desc: 'Construye 2 caminos gratis.' },
  herrero: { deck: 'science', count: 2, icon: '🔨', name: 'Herrero', desc: 'Asciende gratis hasta 2 de tus caballeros.' },
  // Comercio
  puertoComercial: { deck: 'trade', count: 2, icon: '⚓', name: 'Puerto comercial', desc: 'Cada rival con mercancías te da una a cambio de uno de tus recursos.' },
  mercaderMaestro: { deck: 'trade', count: 2, icon: '🎩', name: 'Mercader maestro', desc: 'Toma 2 cartas de un jugador con más puntos que tú.' },
  mercader: { deck: 'trade', count: 6, icon: '🧑‍💼', name: 'Mercader', desc: 'Pon al mercader junto a tus edificios: cambias ese recurso 2:1 y vale 1 punto mientras sea tuyo.' },
  flota: { deck: 'trade', count: 2, icon: '🚢', name: 'Flota mercante', desc: 'Este turno cambias un tipo de carta a elegir 2:1 con el banco.' },
  monopolioRecursos: { deck: 'trade', count: 4, icon: '💰', name: 'Monopolio de recursos', desc: 'Elige un recurso: cada rival te da hasta 2.' },
  monopolioComercio: { deck: 'trade', count: 2, icon: '🏦', name: 'Monopolio comercial', desc: 'Elige una mercancía: cada rival te da 1.' },
  // Política
  obispo: { deck: 'politics', count: 2, icon: '⛪', name: 'Obispo', desc: 'Mueve el ladrón y roba una carta a cada jugador junto a él.' },
  constitucion: { deck: 'politics', count: 1, icon: '📜', name: 'Constitución', desc: '1 punto de victoria.', vp: true },
  desertor: { deck: 'politics', count: 2, icon: '🏃', name: 'Desertor', desc: 'Un rival retira un caballero y tú colocas uno igual.' },
  diplomatico: { deck: 'politics', count: 2, icon: '🕊️', name: 'Diplomático', desc: 'Retira un camino abierto (si es tuyo, puedes recolocarlo).' },
  intriga: { deck: 'politics', count: 2, icon: '🗡️', name: 'Intriga', desc: 'Desplaza un caballero rival que toque tus caminos.' },
  saboteador: { deck: 'politics', count: 2, icon: '💣', name: 'Saboteador', desc: 'Los rivales con tantos o más puntos que tú descartan la mitad.' },
  espia: { deck: 'politics', count: 3, icon: '🕵️', name: 'Espía', desc: 'Roba una carta de progreso a un rival.' },
  caudillo: { deck: 'politics', count: 2, icon: '🎖️', name: 'Caudillo', desc: 'Activa gratis todos tus caballeros.' },
  boda: { deck: 'politics', count: 2, icon: '💍', name: 'Boda', desc: 'Cada jugador con más puntos que tú te regala 2 cartas.' },
};

// ============================ Preparación ============================
function initCK() {
  const big = G.players.length > 4;
  COM.forEach(c => { G.bank[c] = big ? 18 : 12; });
  G.devDeck = [];
  G.barbPos = 0;
  G.barbAttacks = 0;
  G.robberActive = false;
  G.metropolis = { trade: null, politics: null, science: null };
  G.merchant = null;
  G.fleet = null;
  G.crane = {};
  G.medicine = {};
  G.pending = null;
  G.eventDie = null;
  G.forcedDice = null;
  G.progressDecks = { trade: [], politics: [], science: [] };
  for (const [k, c] of Object.entries(PROGRESS)) for (let i = 0; i < c.count; i++) G.progressDecks[c.deck].push(k);
  Object.values(G.progressDecks).forEach(shuffle);
  for (const p of G.players) {
    p.improve = { trade: 0, politics: 0, science: 0 };
    p.progress = [];
    p.vpCards = 0;
    p.defender = 0;
    p.wallsLeft = 3;
  }
}

function citiesOf(pid) {
  return G.vertices.filter(v => v.building && v.building.owner === pid && v.building.type === 'ciudad').map(v => v.id);
}

function handLimit(pid) {
  if (!G.ck) return 7;
  return 7 + 2 * G.vertices.filter(v => v.building && v.building.owner === pid && v.building.wall).length;
}

function vpCK(pid) {
  const p = P(pid);
  let s = p.vpCards + p.defender;
  for (const m of Object.values(G.metropolis)) if (m && m.owner === pid) s += 2;
  if (G.merchant && G.merchant.owner === pid) s += 1;
  return s;
}

// ============================ Caballeros ============================
function knightsOf(pid) {
  return G.vertices.filter(v => v.knight && v.knight.owner === pid).map(v => v.id);
}

function knightPiecesLeft(pid, level) {
  return 2 - knightsOf(pid).filter(vid => G.vertices[vid].knight.level === level).length;
}

function knightStrength(pid, activeOnly = true) {
  return knightsOf(pid).reduce((s, vid) => {
    const k = G.vertices[vid].knight;
    return s + (!activeOnly || k.active ? k.level : 0);
  }, 0);
}

function knightSpots(pid) {
  if (!G.ck) return [];
  return G.vertices.filter(v => v.land !== false && !v.building && !v.knight &&
    v.edges.some(e => G.edges[e].road === pid)).map(v => v.id);
}

function buildKnight(pid, vid, free, level = 1) {
  if (!G.ck || !canBuildNow(pid) && !free) return false;
  if (!knightSpots(pid).includes(vid) || knightPiecesLeft(pid, level) <= 0) return false;
  if (!free) {
    if (!canAfford(pid, CK_COSTS.caballero)) return false;
    pay(pid, CK_COSTS.caballero);
  }
  G.vertices[vid].knight = { owner: pid, level, active: false, activatedTurn: -1, promotedTurn: -1 };
  log(`${pname(pid)} coloca un ${KNIGHT_NAMES[level].toLowerCase()}.`);
  updateLongestRoad();
  return true;
}

function canPromote(pid, vid) {
  const k = G.vertices[vid] && G.vertices[vid].knight;
  if (!k || k.owner !== pid || k.level >= 3 || k.promotedTurn === G.turn) return false;
  if (k.level === 2 && P(pid).improve.politics < 3) return false;
  return knightPiecesLeft(pid, k.level + 1) > 0;
}

function promoteKnight(pid, vid, free) {
  if (!G.ck || (!free && !canBuildNow(pid)) || !canPromote(pid, vid)) return false;
  if (!free) {
    if (!canAfford(pid, CK_COSTS.ascender)) return false;
    pay(pid, CK_COSTS.ascender);
  }
  const k = G.vertices[vid].knight;
  k.level++;
  k.promotedTurn = G.turn;
  log(`${pname(pid)} asciende un caballero a ${KNIGHT_NAMES[k.level].toLowerCase()}.`);
  return true;
}

function activateKnight(pid, vid, free) {
  const k = G.vertices[vid] && G.vertices[vid].knight;
  if (!G.ck || !k || k.owner !== pid || k.active || (!free && !canBuildNow(pid))) return false;
  if (!free) {
    if (!canAfford(pid, CK_COSTS.activar)) return false;
    pay(pid, CK_COSTS.activar);
  }
  k.active = true;
  k.activatedTurn = G.turn;
  if (!free) log(`${pname(pid)} activa un caballero.`);
  return true;
}

// Intersecciones a las que se llega por los caminos propios desde «vid»
function knightReach(pid, vid) {
  const seen = new Set([vid]), q = [vid], out = [];
  while (q.length) {
    const u = q.shift();
    for (const eid of G.vertices[u].edges) {
      const e = G.edges[eid];
      if (e.road !== pid) continue;
      const w = e.v[0] === u ? e.v[1] : e.v[0];
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      const vw = G.vertices[w];
      const blocked = (vw.building && vw.building.owner !== pid) || vw.knight;
      if (!blocked) q.push(w);
    }
  }
  return out;
}

function knightCanAct(pid, vid) {
  const k = G.vertices[vid] && G.vertices[vid].knight;
  return !!k && k.owner === pid && k.active && k.activatedTurn < G.turn;
}

function knightMoveTargets(pid, vid) {
  if (!knightCanAct(pid, vid) || !canMoveKnights(pid)) return [];
  const lvl = G.vertices[vid].knight.level;
  return knightReach(pid, vid).filter(w => {
    const v = G.vertices[w];
    if (v.building || v.land === false) return false;
    if (!v.knight) return true;
    return v.knight.owner !== pid && v.knight.level < lvl;
  });
}

function canMoveKnights(pid) {
  return G.ck && G.phase === 'main' && pid === G.current;
}

// El caballero desplazado se recoloca en una intersección libre de su red, o se retira
function relocateKnight(owner, from, knight) {
  const spots = knightReach(owner, from).filter(w => !G.vertices[w].building && !G.vertices[w].knight && G.vertices[w].land !== false);
  if (spots.length) {
    G.vertices[spots[0]].knight = knight;
    log(`El caballero de ${pname(owner)} se retira a otra intersección.`);
  } else log(`El caballero de ${pname(owner)} no tiene adónde ir y vuelve a su reserva.`);
}

function moveKnight(pid, from, to) {
  if (!knightMoveTargets(pid, from).includes(to)) return false;
  const mine = G.vertices[from].knight;
  const target = G.vertices[to].knight;
  G.vertices[from].knight = null;
  if (target) {
    G.vertices[to].knight = null;
    log(`${pname(pid)} desplaza un caballero de ${pname(target.owner)}.`);
    relocateKnight(target.owner, to, target);
  } else log(`${pname(pid)} mueve un caballero.`);
  mine.active = false;
  G.vertices[to].knight = mine;
  updateLongestRoad();
  return true;
}

function chaseRobberSpots(pid) {
  if (!G.ck || !G.robberActive || !canMoveKnights(pid)) return [];
  return G.hexes[G.robber].vertices.filter(vid => knightCanAct(pid, vid));
}

function chaseRobber(pid, vid) {
  if (!chaseRobberSpots(pid).includes(vid)) return false;
  G.vertices[vid].knight.active = false;
  log(`⚔️ ${pname(pid)} expulsa al ladrón con un caballero.`);
  G.afterRobber = 'main';
  G.phase = 'robber';
  return true;
}

// ============================ Murallas y mejoras ============================
function wallSpots(pid) {
  if (!G.ck || P(pid).wallsLeft <= 0) return [];
  return citiesOf(pid).filter(vid => !G.vertices[vid].building.wall);
}

function buildWall(pid, vid, free) {
  if (!wallSpots(pid).includes(vid) || (!free && !canBuildNow(pid))) return false;
  if (!free) {
    if (!canAfford(pid, CK_COSTS.muralla)) return false;
    pay(pid, CK_COSTS.muralla);
  }
  G.vertices[vid].building.wall = true;
  P(pid).wallsLeft--;
  log(`${pname(pid)} construye una muralla (límite de cartas: ${handLimit(pid)}).`);
  return true;
}

function improveCost(pid, track) {
  const lvl = P(pid).improve[track];
  return Math.max(0, lvl + 1 - (G.crane[pid] ? 1 : 0));
}

function canImprove(pid, track) {
  const p = P(pid);
  if (!G.ck || !TRACKS[track] || p.improve[track] >= 5 || !citiesOf(pid).length) return false;
  return canBuildNow(pid) && p.res[TRACKS[track].com] >= improveCost(pid, track);
}

function improveCity(pid, track) {
  if (!canImprove(pid, track)) return false;
  const p = P(pid), t = TRACKS[track], cost = improveCost(pid, track);
  p.res[t.com] -= cost;
  G.bank[t.com] += cost;
  G.crane[pid] = false;
  p.improve[track]++;
  log(`${pname(pid)} mejora ${t.name.toLowerCase()} al nivel ${p.improve[track]}.`);
  if (p.improve[track] === 3) log(`🏛️ ${pname(pid)} consigue: ${t.ability}`);
  checkMetropolis(pid, track);
  checkWin();
  return true;
}

function checkMetropolis(pid, track) {
  const lvl = P(pid).improve[track];
  const holder = G.metropolis[track];
  if (lvl < 4) return;
  if (holder && (holder.owner === pid || lvl < 5 || P(holder.owner).improve[track] >= 5)) return;
  const free = citiesOf(pid).filter(vid => !G.vertices[vid].building.metro);
  if (!free.length) return;
  if (holder) {
    const hv = G.vertices[holder.vertex];
    if (hv.building) hv.building.metro = null;
    log(`🏙️ ${pname(pid)} le quita la metrópolis de ${TRACKS[track].name.toLowerCase()} a ${pname(holder.owner)}.`);
  } else log(`🏙️ ${pname(pid)} construye la metrópolis de ${TRACKS[track].name.toLowerCase()} (+2 puntos).`);
  const best = free.sort((a, b) => cityProd(b) - cityProd(a))[0];
  G.vertices[best].building.metro = track;
  G.metropolis[track] = { owner: pid, vertex: best };
}

function cityProd(vid) {
  return G.vertices[vid].hexes.reduce((s, hid) => s + pips(G.hexes[hid].number), 0);
}

// ============================ Dado de eventos y bárbaros ============================
function rollEventDie() {
  const f = rand(6);
  return f < 3 ? 'barco' : ['trade', 'politics', 'science'][f - 3];
}

function resolveEventDie(face, red) {
  G.eventDie = face;
  if (face === 'barco') {
    G.barbPos++;
    log(`⛵ El barco de los bárbaros avanza (${G.barbPos}/${BARB_TRACK}).`);
    if (G.barbPos >= BARB_TRACK) barbarianAttack();
    return;
  }
  const t = TRACKS[face];
  log(`${t.gate} Puerta de ${t.name.toLowerCase()} con el dado rojo en ${red}.`);
  const n = G.players.length;
  for (let i = 0; i < n; i++) {
    const pid = (G.current + i) % n;
    const lvl = P(pid).improve[face];
    if (lvl > 0 && red <= lvl + 1) drawProgress(pid, face);
  }
}

function drawProgress(pid, deck) {
  const d = G.progressDecks[deck];
  if (!d.length) return;
  const card = d.pop();
  const info = PROGRESS[card];
  const p = P(pid);
  if (info.vp) {
    p.vpCards++;
    log(`${pname(pid)} obtiene ${info.icon} <b>${info.name}</b> (+1 punto).`);
    checkWin();
    return;
  }
  if (p.progress.length >= 4) {
    d.unshift(card);
    log(`${pname(pid)} ya tiene 4 cartas de progreso y no puede robar más.`);
    return;
  }
  p.progress.push({ type: card, turn: G.turn });
  log(`${pname(pid)} roba una carta de progreso de ${TRACKS[deck].name.toLowerCase()}.`);
}

function barbarianAttack() {
  const strength = G.vertices.filter(v => v.building && v.building.type === 'ciudad').length;
  const def = G.players.map(p => knightStrength(p.id));
  const defense = def.reduce((a, b) => a + b, 0);
  log(`⚔️ <b>¡Atacan los bárbaros!</b> Fuerza ${strength} contra defensa ${defense}.`);
  if (defense >= strength) {
    const max = Math.max(...def);
    const best = G.players.filter(p => def[p.id] === max && max > 0).map(p => p.id);
    if (best.length === 1) {
      P(best[0]).defender++;
      log(`🛡️ ${pname(best[0])} es el <b>Defensor de Catán</b> (+1 punto).`);
    } else {
      for (const pid of best) drawProgress(pid, ['trade', 'politics', 'science'][rand(3)]);
      if (best.length) log('Empate entre los mejores defensores: cada uno roba una carta de progreso.');
    }
  } else {
    // Pierden una ciudad los que menos defendieron (y tienen ciudades sin metrópolis)
    const exposed = G.players.filter(p => citiesOf(p.id).some(vid => !G.vertices[vid].building.metro));
    if (exposed.length) {
      const min = Math.min(...exposed.map(p => def[p.id]));
      for (const p of exposed.filter(q => def[q.id] === min)) loseCity(p.id);
    }
  }
  // Tras el ataque: caballeros inactivos, el barco vuelve y el ladrón se activa
  for (const v of G.vertices) if (v.knight) v.knight.active = false;
  G.barbPos = 0;
  G.barbAttacks++;
  if (!G.robberActive) {
    G.robberActive = true;
    log('🦹 Desde ahora el ladrón ya puede moverse.');
  }
}

function loseCity(pid) {
  const cands = citiesOf(pid).filter(vid => !G.vertices[vid].building.metro)
    .sort((a, b) => (G.vertices[a].building.wall ? 1 : 0) - (G.vertices[b].building.wall ? 1 : 0) || cityProd(a) - cityProd(b));
  if (!cands.length) return;
  const v = G.vertices[cands[0]], p = P(pid);
  if (v.building.wall) p.wallsLeft++;
  p.cities++;
  if (p.settlements > 0) {
    p.settlements--;
    v.building = { owner: pid, type: 'poblado' };
  } else v.building = null;
  log(`🔥 Los bárbaros saquean una ciudad de ${pname(pid)}.`);
  updateLongestRoad();
}

// ============================ Producción ============================
function produceCK(n) {
  const demand = {};
  CARDS.forEach(r => { demand[r] = {}; });
  const add = (r, o, k) => { demand[r][o] = (demand[r][o] || 0) + k; };
  for (const h of G.hexes) {
    if (h.number !== n || h.id === G.robber) continue;
    const t = TERRAIN[h.terrain];
    if (!t.res) continue;
    for (const vid of h.vertices) {
      const b = G.vertices[vid].building;
      if (!b) continue;
      if (b.type !== 'ciudad' || G.epidemic) { add(t.res, b.owner, 1); continue; }
      const com = TERRAIN_COM[h.terrain];
      if (com) { add(t.res, b.owner, 1); add(com, b.owner, 1); }
      else add(t.res, b.owner, 2);
    }
  }
  const gains = G.players.map(() => zeroRes());
  for (const r of CARDS) {
    const owners = Object.keys(demand[r]).map(Number);
    if (!owners.length) continue;
    const tot = owners.reduce((s, o) => s + demand[r][o], 0);
    if (tot <= G.bank[r]) owners.forEach(o => { gains[o][r] += demand[r][o]; });
    else if (owners.length === 1) gains[owners[0]][r] += G.bank[r];
    else log(`El banco no tiene suficiente ${RES_INFO[r].name.toLowerCase()}: nadie la recibe.`);
  }
  let any = false;
  gains.forEach((gn, pid) => {
    if (!total(gn)) {
      // Acueducto: quien no recibe nada elige un recurso
      if (P(pid).improve.science >= 3) G.goldNeed[pid] = (G.goldNeed[pid] || 0) + 1;
      return;
    }
    any = true;
    CARDS.forEach(r => { P(pid).res[r] += gn[r]; G.bank[r] -= gn[r]; });
    log(`${pname(pid)} recibe ${resStr(gn)}.`);
  });
  if (!any) log('Nadie produce recursos.');
}

// ============================ Cartas de progreso ============================
function progressPlayable(pid, type) {
  if (!G.ck || G.pending || pid !== G.current || !P(pid).progress.some(c => c.type === type)) return false;
  if (type === 'alquimista') return G.phase === 'roll';
  if (G.phase !== 'main') return false;
  if (type === 'obispo') return G.robberActive;
  return true;
}

function playProgress(pid, type) {
  if (!progressPlayable(pid, type)) return false;
  const p = P(pid);
  p.progress.splice(p.progress.findIndex(c => c.type === type), 1);
  G.progressDecks[PROGRESS[type].deck].unshift(type);
  log(`${pname(pid)} juega ${PROGRESS[type].icon} <b>${PROGRESS[type].name}</b>.`);
  PROGRESS_FX[type](pid);
  checkWin();
  return true;
}

function setPending(pid, card, kind, options, prompt, step = 1, data = {}) {
  if (kind !== 'dice' && !options.length) { G.pending = null; return false; }
  G.pending = { pid, card, kind, options, prompt, step, data };
  return true;
}

function opponents(pid) { return G.players.filter(p => p.id !== pid).map(p => p.id); }

function takeRandomCards(from, to, n) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    const r = randomHandRes(from);
    if (!r) break;
    P(from).res[r]--; P(to).res[r]++; got++;
  }
  return got;
}

function adjacentHexesOf(pid, terrain) {
  const set = new Set();
  for (const v of G.vertices) {
    if (!v.building || v.building.owner !== pid) continue;
    v.hexes.forEach(h => { if (G.hexes[h].terrain === terrain) set.add(h); });
  }
  return [...set];
}

function openRoads() {
  return G.edges.filter(e => e.road !== null && e.v.some(vid => {
    const v = G.vertices[vid];
    if (v.building && v.building.owner === e.road) return false;
    return !v.edges.some(x => x !== e.id && G.edges[x].road === e.road);
  })).map(e => e.id);
}

const PROGRESS_FX = {
  alquimista: pid => setPending(pid, 'alquimista', 'dice', [], 'Elige el dado rojo y el amarillo'),
  inventor: pid => setPending(pid, 'inventor', 'hex', inventorHexes(), 'Elige la primera ficha de número'),
  grua: pid => { G.crane[pid] = true; },
  ingeniero: pid => setPending(pid, 'ingeniero', 'vertex', wallSpots(pid), 'Elige la ciudad para la muralla gratis'),
  irrigacion: pid => { const n = adjacentHexesOf(pid, 'campo').length * 2; const g = give(pid, 'trigo', n); log(`${pname(pid)} recibe ${g} 🌾.`); },
  medicina: pid => { G.medicine[pid] = true; },
  mineria: pid => { const n = adjacentHexesOf(pid, 'montana').length * 2; const g = give(pid, 'mineral', n); log(`${pname(pid)} recibe ${g} 🪨.`); },
  carreterasP: pid => { if (freeBuildLeft(pid)) { G.freeRoads = Math.min(2, P(pid).roads); G.phase = 'road-building'; } },
  herrero: pid => setPending(pid, 'herrero', 'vertex', knightsOf(pid).filter(v => canPromote(pid, v)), 'Elige un caballero para ascender (1 de 2)'),
  puertoComercial: pid => {
    for (const o of opponents(pid)) {
      const coms = COM.filter(c => P(o).res[c] > 0);
      const mine = RES.filter(r => P(pid).res[r] > 0);
      if (!coms.length || !mine.length) continue;
      const c = coms[rand(coms.length)], r = mine[rand(mine.length)];
      P(o).res[c]--; P(pid).res[c]++;
      P(pid).res[r]--; P(o).res[r]++;
      log(`${pname(pid)} cambia ${RES_INFO[r].icon} por ${RES_INFO[c].icon} con ${pname(o)}.`);
    }
  },
  mercaderMaestro: pid => setPending(pid, 'mercaderMaestro', 'player',
    opponents(pid).filter(o => vp(o, false) > vp(pid, false) && total(P(o).res) > 0), 'Elige a quién quitarle 2 cartas'),
  mercader: pid => setPending(pid, 'mercader', 'hex', merchantHexes(pid), 'Elige dónde poner al mercader'),
  flota: pid => setPending(pid, 'flota', 'card', CARDS.slice(), 'Elige qué carta cambiarás 2:1 este turno'),
  monopolioRecursos: pid => setPending(pid, 'monopolioRecursos', 'card', RES.slice(), 'Elige un recurso'),
  monopolioComercio: pid => setPending(pid, 'monopolioComercio', 'card', COM.slice(), 'Elige una mercancía'),
  obispo: pid => { G.bishop = true; G.afterRobber = 'main'; G.phase = 'robber'; },
  constitucion: () => {},
  imprenta: () => {},
  desertor: pid => setPending(pid, 'desertor', 'player', opponents(pid).filter(o => knightsOf(o).length), 'Elige al rival que pierde un caballero'),
  diplomatico: pid => setPending(pid, 'diplomatico', 'edge', openRoads(), 'Elige el camino abierto que se retira'),
  intriga: pid => setPending(pid, 'intriga', 'vertex', G.vertices.filter(v => v.knight && v.knight.owner !== pid &&
    v.edges.some(e => G.edges[e].road === pid)).map(v => v.id), 'Elige el caballero rival que desplazas'),
  saboteador: pid => {
    const mine = vp(pid, false);
    for (const o of opponents(pid)) {
      if (vp(o, false) < mine) continue;
      const n = Math.floor(total(P(o).res) / 2);
      for (let i = 0; i < n; i++) { const r = randomHandRes(o); P(o).res[r]--; G.bank[r]++; }
      if (n) log(`${pname(o)} descarta ${n} cartas.`);
    }
  },
  espia: pid => setPending(pid, 'espia', 'player', opponents(pid).filter(o => P(o).progress.length), 'Elige a quién robarle una carta de progreso'),
  caudillo: pid => { knightsOf(pid).forEach(vid => activateKnight(pid, vid, true)); log(`${pname(pid)} activa todos sus caballeros.`); },
  boda: pid => {
    const mine = vp(pid, false);
    for (const o of opponents(pid)) {
      if (vp(o, false) <= mine) continue;
      const n = takeRandomCards(o, pid, 2);
      if (n) log(`${pname(o)} regala ${n} carta(s) a ${pname(pid)}.`);
    }
  },
};

function inventorHexes() {
  return G.hexes.filter(h => h.number && ![2, 12, 6, 8].includes(h.number)).map(h => h.id);
}

function merchantHexes(pid) {
  return G.hexes.filter(h => TERRAIN[h.terrain].res && h.vertices.some(v => {
    const b = G.vertices[v].building;
    return b && b.owner === pid;
  })).map(h => h.id);
}

// Respuesta del jugador a una elección pendiente
function resolvePending(pid, value) {
  const pd = G.pending;
  if (!pd || pd.pid !== pid) return false;
  if (pd.kind === 'dice') {
    const red = toInt(value && value.red), yellow = toInt(value && value.yellow);
    if (red < 1 || red > 6 || yellow < 1 || yellow > 6) return false;
    G.pending = null;
    G.forcedDice = [red, yellow];
    return rollDice();
  }
  const v = pd.kind === 'card' ? value : toInt(value);
  if (!pd.options.includes(v)) return false;
  G.pending = null;
  switch (pd.card) {
    case 'inventor':
      if (pd.step === 1) {
        setPending(pid, 'inventor', 'hex', inventorHexes().filter(h => h !== v), 'Elige la segunda ficha de número', 2, { first: v });
      } else {
        const a = G.hexes[pd.data.first], b = G.hexes[v];
        [a.number, b.number] = [b.number, a.number];
        log(`${pname(pid)} intercambia las fichas ${b.number} y ${a.number}.`);
      }
      break;
    case 'ingeniero': buildWall(pid, v, true); break;
    case 'herrero':
      promoteKnight(pid, v, true);
      if (pd.step === 1) setPending(pid, 'herrero', 'vertex', knightsOf(pid).filter(w => canPromote(pid, w)), 'Elige otro caballero para ascender (2 de 2)', 2);
      break;
    case 'mercaderMaestro': {
      const n = takeRandomCards(v, pid, 2);
      log(`${pname(pid)} toma ${n} carta(s) de ${pname(v)}.`);
      break;
    }
    case 'mercader':
      G.merchant = { hex: v, owner: pid };
      log(`${pname(pid)} coloca al mercader en ${hexName(G.hexes[v])}.`);
      checkWin();
      break;
    case 'flota':
      G.fleet = { pid, type: v, turn: G.turn };
      log(`${pname(pid)} cambiará ${RES_INFO[v].icon} 2:1 este turno.`);
      break;
    case 'monopolioRecursos': case 'monopolioComercio': {
      const max = pd.card === 'monopolioRecursos' ? 2 : 1;
      let got = 0;
      for (const o of opponents(pid)) {
        const n = Math.min(max, P(o).res[v]);
        P(o).res[v] -= n; P(pid).res[v] += n; got += n;
      }
      log(`${pname(pid)} recibe ${got} ${RES_INFO[v].icon} de los demás.`);
      break;
    }
    case 'desertor':
      if (pd.step === 1) {
        const ks = knightsOf(v).sort((a, b) => G.vertices[a].knight.level - G.vertices[b].knight.level);
        const lvl = G.vertices[ks[0]].knight.level;
        G.vertices[ks[0]].knight = null;
        log(`Un caballero de ${pname(v)} deserta.`);
        updateLongestRoad();
        let level = lvl;
        while (level > 0 && knightPiecesLeft(pid, level) <= 0) level--;
        if (level > 0) setPending(pid, 'desertor', 'vertex', knightSpots(pid), 'Elige dónde colocar al desertor', 2, { level });
      } else buildKnight(pid, v, true, pd.data.level);
      break;
    case 'diplomatico':
      if (pd.step === 1) {
        const owner = G.edges[v].road;
        G.edges[v].road = null;
        P(owner).roads++;
        log(`Se retira un camino de ${pname(owner)}.`);
        updateLongestRoad();
        if (owner === pid) setPending(pid, 'diplomatico', 'edge', roadSpots(pid).filter(e => e !== v), 'Elige dónde recolocar tu camino', 2);
      } else {
        G.edges[v].road = pid;
        P(pid).roads--;
        log(`${pname(pid)} recoloca su camino.`);
        updateLongestRoad();
      }
      break;
    case 'intriga': {
      const k = G.vertices[v].knight;
      G.vertices[v].knight = null;
      log(`${pname(pid)} desplaza un caballero de ${pname(k.owner)}.`);
      relocateKnight(k.owner, v, k);
      updateLongestRoad();
      break;
    }
    default:
      if (typeof EXTRA_PICKS !== 'undefined' && EXTRA_PICKS[pd.card]) EXTRA_PICKS[pd.card](pid, v, pd);
      break;
    case 'espia': {
      const cards = P(v).progress;
      const c = cards.splice(rand(cards.length), 1)[0];
      P(pid).progress.push(c);
      log(`${pname(pid)} le roba una carta de progreso a ${pname(v)}.`);
      break;
    }
  }
  checkWin();
  return true;
}

// El jugador puede saltarse los pasos opcionales (segundo ascenso, recolocar)
function skipPending(pid) {
  const pd = G.pending;
  if (!pd || pd.pid !== pid || pd.step < 2) return false;
  G.pending = null;
  return true;
}

function ckTurnReset() {
  G.crane = {};
  G.medicine = {};
  G.fleet = null;
}

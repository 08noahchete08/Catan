'use strict';
// ---------------------------------------------------------------------------
// Variantes opcionales: ladrón amistoso, cartas de eventos y maestro del puerto
// ---------------------------------------------------------------------------

const VARIANTS = {
  friendlyRobber: { name: 'Ladrón amistoso', icon: '🤝',
    desc: 'El ladrón no se puede poner junto a un jugador que tenga 2 puntos visibles o menos.' },
  eventCards: { name: 'Cartas de eventos', icon: '🃏',
    desc: 'Una baraja de 36 cartas sustituye a los dados: los números salen con la misma frecuencia pero más repartidos, y algunas cartas traen un evento.' },
  harbormaster: { name: 'Maestro del puerto', icon: '⚓',
    desc: '+2 puntos para quien tenga más puntos de puerto (poblado en puerto = 1, ciudad = 2; mínimo 3).' },
};

function cleanVariants(v) {
  const out = {};
  for (const k of Object.keys(VARIANTS)) out[k] = !!(v && v[k]);
  return out;
}

// ============================ Ladrón amistoso ============================
function robberAllowed(hid, mover) {
  if (hid === G.robber || !G.hexes[hid] || G.hexes[hid].terrain === 'mar') return false;
  if (!G.variants.friendlyRobber) return true;
  const protectedHex = h => h.vertices.some(v => {
    const b = G.vertices[v].building;
    return b && b.owner !== mover && vp(b.owner, false) <= 2;
  });
  if (!protectedHex(G.hexes[hid])) return true;
  // Si todos los hexágonos están protegidos, se puede usar cualquiera
  return G.hexes.every(h => h.id === G.robber || h.terrain === 'mar' || protectedHex(h));
}

// ============================ Cartas de eventos ============================
const EVENT_INFO = {
  none: null,
  abundancia: { name: 'Año de abundancia', icon: '🌻', desc: 'Cada jugador recibe una carta de recurso del banco.' },
  epidemia: { name: 'Epidemia', icon: '🤒', desc: 'En esta tirada las ciudades solo producen 1 recurso.' },
  marCalma: { name: 'Mar en calma', icon: '⛵', desc: 'Quien tenga más edificios en puertos recibe una carta de recurso.' },
  torneo: { name: 'Torneo', icon: '🏇', desc: 'Quien haya jugado más caballeros recibe una carta de recurso.' },
  vecinos: { name: 'Buenos vecinos', icon: '🎁', desc: 'Cada jugador regala una carta al azar al jugador de su izquierda.' },
  conflicto: { name: 'Conflicto', icon: '⚔️', desc: 'Quien tenga el Gran Ejército roba una carta al jugador con más cartas.' },
};

function buildEventDeck() {
  const counts = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const cards = [];
  for (const [n, c] of Object.entries(counts)) for (let i = 0; i < c; i++) cards.push({ n: +n, ev: 'none' });
  // Los eventos van en cartas que no son 7
  const events = ['abundancia', 'abundancia', 'epidemia', 'epidemia', 'marCalma', 'marCalma', 'torneo', 'vecinos', 'vecinos', 'conflicto'];
  const slots = shuffle(cards.filter(c => c.n !== 7));
  events.forEach((ev, i) => { slots[i].ev = ev; });
  G.eventDeck = shuffle(cards);
  G.newYearAt = rand(5); // «Año nuevo»: se vuelve a barajar cuando quedan pocas cartas
}

function drawEventCard() {
  if (!G.eventDeck || G.eventDeck.length <= G.newYearAt) {
    if (G.eventDeck) log('🎆 <b>Año nuevo:</b> se vuelven a barajar las cartas de eventos.');
    buildEventDeck();
  }
  const card = G.eventDeck.pop();
  // Dados que muestran el número de la carta
  const opts = [];
  for (let a = 1; a <= 6; a++) { const b = card.n - a; if (b >= 1 && b <= 6) opts.push([a, b]); }
  return { card, dice: opts[rand(opts.length)] };
}

function randomBankRes() {
  const avail = RES.filter(r => G.bank[r] > 0);
  return avail.length ? avail[rand(avail.length)] : null;
}

function randomHandRes(pid) {
  const pool = [];
  CARDS.forEach(r => { for (let i = 0; i < P(pid).res[r]; i++) pool.push(r); });
  return pool.length ? pool[rand(pool.length)] : null;
}

function giftFromBank(pids, why) {
  for (const pid of pids) {
    const r = randomBankRes();
    if (r && give(pid, r, 1)) log(`${pname(pid)} recibe ${RES_INFO[r].icon} (${why}).`);
  }
}

function leaders(score) {
  const vals = G.players.map(p => score(p.id));
  const max = Math.max(...vals);
  return max > 0 ? G.players.filter(p => vals[p.id] === max).map(p => p.id) : [];
}

function applyEvent(ev) {
  const info = EVENT_INFO[ev];
  if (!info) return;
  log(`${info.icon} <b>Evento: ${info.name}.</b> ${info.desc}`);
  G.lastEvent = ev;
  switch (ev) {
    case 'abundancia': giftFromBank(G.players.map(p => p.id), 'año de abundancia'); break;
    case 'epidemia': G.epidemic = true; break;
    case 'marCalma': giftFromBank(leaders(pid => harborBuildings(pid)), 'mar en calma'); break;
    case 'torneo': giftFromBank(leaders(pid => P(pid).knights), 'torneo'); break;
    case 'vecinos': {
      const n = G.players.length;
      const gifts = G.players.map(p => randomHandRes(p.id));
      gifts.forEach((r, pid) => {
        if (!r) return;
        P(pid).res[r]--;
        P((pid + 1) % n).res[r]++;
      });
      log('Cada jugador ha regalado una carta a su vecino de la izquierda.');
      break;
    }
    case 'conflicto': {
      const thief = G.armyHolder;
      if (thief === null) { log('Nadie tiene el Gran Ejército: no pasa nada.'); break; }
      const others = G.players.filter(p => p.id !== thief && total(p.res) > 0);
      if (!others.length) break;
      const maxCards = Math.max(...others.map(p => total(p.res)));
      const victim = others.find(p => total(p.res) === maxCards).id;
      const r = randomHandRes(victim);
      P(victim).res[r]--; P(thief).res[r]++;
      log(`${pname(thief)} roba una carta a ${pname(victim)}.`);
      break;
    }
  }
}

// ============================ Maestro del puerto ============================
function harborBuildings(pid) {
  return G.vertices.filter(v => v.port && v.building && v.building.owner === pid).length;
}

function harborPoints(pid) {
  return G.vertices.reduce((s, v) => s + (v.port && v.building && v.building.owner === pid ? (v.building.type === 'ciudad' ? 2 : 1) : 0), 0);
}

function updateHarbormaster() {
  if (!G.variants.harbormaster) return;
  const h = G.harborHolder;
  const pts = G.players.map(p => harborPoints(p.id));
  const best = Math.max(...pts);
  if (best < 3) return;
  const pid = pts.indexOf(best);
  if (h === null || (pid !== h && best > pts[h])) {
    G.harborHolder = pid;
    log(`⚓ ${pname(pid)} es ahora el <b>Maestro del puerto</b> (${best} puntos de puerto, +2).`);
  }
}

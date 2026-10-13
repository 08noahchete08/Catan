'use strict';
// ---------------------------------------------------------------------------
// Interfaz de la partida: tablero SVG, paneles y ventanas modales.
// Las acciones del jugador pasan por send(): en local se aplican aquí mismo,
// online se envían al servidor (ver net.js).
// ---------------------------------------------------------------------------

const UI = {
  mode: null, viewer: null, aiTimer: null, speed: 650, modal: null,
  trade: null, bank: null, yop: [], discardSel: null, online: false, winnerShown: false,
  view3d: (() => { try { return localStorage.getItem('catan-3d') !== '0'; } catch (e) { return true; } })(),
  lastDice: null,
};
const $ = s => document.querySelector(s);
const DEFAULT_NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Fede'];
const DIE_PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

function dieHtml(n, cls) {
  let html = '';
  for (let i = 1; i <= 9; i++) html += `<i class="${n && DIE_PIPS[n].includes(i) ? 'on' : ''}"></i>`;
  return `<span class="die ${cls}">${html}</span>`;
}

function toggleView() {
  UI.view3d = !UI.view3d;
  try { localStorage.setItem('catan-3d', UI.view3d ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  if (G) { computeView(); render(); }
}

function costIcons(cost) {
  return Object.entries(cost).map(([r, n]) => RES_INFO[r].icon.repeat(n)).join('');
}

function showScreen(id) {
  ['menu-screen', 'setup-screen', 'lobby-screen', 'game'].forEach(s => $('#' + s).classList.toggle('hidden', s !== id));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(UI.toastTimer);
  UI.toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ============================ Partida local: configuración ============================
function initSetup() {
  $('#num-players').value = '6';
  $('#num-players').onchange = () => renderSetupRows();
  $('#btn-start').onclick = startGame;
  $('#btn-back-setup').onclick = () => showScreen('menu-screen');
  renderSetupRows();
}

function renderSetupRows(firstName) {
  const n = +$('#num-players').value;
  const rows = $('#player-rows');
  const prev = [...rows.querySelectorAll('.prow')].map(r => ({
    name: r.querySelector('.pname-in').value, color: r.querySelector('.pcolor').value, type: r.querySelector('.ptype').value,
  }));
  if (firstName && prev[0]) prev[0].name = firstName;
  let html = '';
  for (let i = 0; i < n; i++) {
    const p = prev[i] || { name: i === 0 && firstName ? firstName : DEFAULT_NAMES[i], color: PLAYER_COLORS[i].hex, type: i === 0 ? 'human' : 'ai' };
    html += `<div class="prow">
      <span class="swatch" style="background:${p.color}"></span>
      <input class="pname-in" maxlength="14" value="${esc(p.name)}" aria-label="Nombre del jugador ${i + 1}">
      <select class="pcolor" aria-label="Color">${PLAYER_COLORS.map(c => `<option value="${c.hex}" ${c.hex === p.color ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
      <select class="ptype" aria-label="Tipo"><option value="human" ${p.type === 'human' ? 'selected' : ''}>👤 Humano</option><option value="ai" ${p.type === 'ai' ? 'selected' : ''}>🤖 IA</option></select>
    </div>`;
  }
  rows.innerHTML = html;
  rows.querySelectorAll('.pcolor').forEach(sel => {
    sel.onchange = () => { sel.parentElement.querySelector('.swatch').style.background = sel.value; };
  });
  $('#board-note').innerHTML = boardNote(n);
  $('#opt-special').disabled = n < 5;
  $('#opt-special-row').classList.toggle('disabled', n < 5);
}

function boardNote(n) {
  return n >= 5
    ? '🗺️ <b>Ampliación 5-6 jugadores:</b> 30 hexágonos, 28 números, 11 puertos, 34 cartas de desarrollo y 24 cartas de cada recurso.'
    : '🗺️ <b>Juego básico:</b> 19 hexágonos, 9 puertos, 25 cartas de desarrollo y 19 cartas de cada recurso.';
}

function startGame() {
  const rows = [...document.querySelectorAll('#player-rows .prow')];
  const setup = rows.map((r, i) => ({
    name: r.querySelector('.pname-in').value.trim() || `Jugador ${i + 1}`,
    color: r.querySelector('.pcolor').value,
    isAI: r.querySelector('.ptype').value === 'ai',
  }));
  if (new Set(setup.map(p => p.color)).size !== setup.length) {
    toast('Cada jugador debe tener un color distinto.');
    return;
  }
  UI.speed = +$('#opt-speed').value;
  UI.online = false;
  stopLocalAI();
  newGame(setup, { special: $('#opt-special').checked });
  UI.mode = null; UI.viewer = null; UI.winnerShown = false;
  closeModal();
  showScreen('game');
  computeView();
  refresh();
}

function stopLocalAI() {
  clearTimeout(UI.aiTimer);
  UI.aiTimer = null;
}

function exitToMenu() {
  stopLocalAI();
  G = null;
  closeModal();
  showScreen('menu-screen');
}

// ============================ Ciclo principal ============================
function refresh() {
  render();
  scheduleAI();
}

function doAct(ok) {
  if (ok) UI.mode = null;
  refresh();
  return ok;
}

// Envía una acción del jugador. pid solo hace falta en local para respuestas
// de jugadores que no están en turno (ofertas, intercambios).
function send(action, pid) {
  if (UI.online) {
    UI.mode = null;
    wsSend({ t: 'action', action });
    render();
    return;
  }
  if (pid == null) pid = humanActor();
  if (pid == null) return;
  doAct(applyAction(pid, action));
}

function scheduleAI() {
  if (UI.online || !G || G.phase === 'gameover' || G.offer || UI.aiTimer) return;
  const a = actor();
  if (a == null || !isBot(a)) return;
  UI.aiTimer = setTimeout(() => {
    UI.aiTimer = null;
    if (!G || UI.online) return;
    try { AI.act(); } catch (e) { console.error(e); AI.fallback(actor()); }
    refresh();
  }, UI.speed);
}

// Jugador humano que debe decidir ahora en este dispositivo (o null)
function humanActor() {
  if (!G || G.phase === 'gameover') return null;
  const a = actor();
  if (a == null) return null;
  if (UI.online) return a === NET.seat ? a : null;
  return isBot(a) ? null : a;
}

function viewerId() {
  if (UI.online) return NET.seat;
  const h = humanActor();
  if (h != null) UI.viewer = h;
  if (UI.viewer == null) {
    const hp = G.players.find(p => !p.isAI);
    return hp ? (UI.viewer = hp.id) : actor();
  }
  return UI.viewer;
}

function render() {
  if (!G) return;
  renderBoard();
  renderBanner();
  renderPlayers();
  renderTurnPanel();
  renderHand();
  renderLog();
  $('#btn-3d').textContent = UI.view3d ? '🗺️ Vista 2D' : '🧊 Vista 3D';
  $('#room-tag').innerHTML = UI.online && NET.room ? `🌐 Sala <b>${NET.room}</b>` : '';
  $('#chat-panel').classList.toggle('hidden', !UI.online);
  syncModals();
}

// ============================ Tablero ============================
// El dibujo del tablero está en boardview.js

function onBoardClick(ev) {
  const t = ev.target.closest('[data-v],[data-e],[data-h]');
  if (!t || !G || humanActor() == null) return;
  if (t.dataset.v != null) {
    const v = +t.dataset.v;
    if (G.phase === 'setup-settlement' || UI.mode === 'poblado') send({ type: 'settle', v });
    else if (UI.mode === 'ciudad') send({ type: 'city', v });
  } else if (t.dataset.e != null) {
    send({ type: 'road', e: +t.dataset.e });
  } else if (t.dataset.h != null && G.phase === 'robber') {
    send({ type: 'robber', h: +t.dataset.h });
  }
}

function renderBanner() {
  const a = actor();
  let txt = '';
  if (G.phase === 'gameover') txt = `🏆 ¡${pname(G.winner)} gana la partida con ${vp(G.winner)} puntos!`;
  else if (G.offer) txt = `🤝 ${pname(G.offer.from)} ofrece un intercambio: esperando respuesta…`;
  else if (a != null) {
    const who = pname(a);
    const bot = isBot(a);
    const mine = humanActor() === a;
    switch (G.phase) {
      case 'setup-settlement': txt = `${who}: coloca un poblado inicial ${G.setupIdx < G.players.length ? '(1ª ronda)' : '(2ª ronda: recibes recursos)'}`; break;
      case 'setup-road': txt = `${who}: coloca un camino junto a tu poblado`; break;
      case 'roll': txt = `${who}: tira los dados`; break;
      case 'discard': txt = `${who}: descarta ${G.discardNeed[a]} cartas`; break;
      case 'robber': txt = `${who}: mueve el ladrón ${mine ? '(clic en un hexágono)' : ''}`; break;
      case 'steal': txt = `${who}: elige a quién robar`; break;
      case 'road-building': txt = `${who}: coloca ${G.freeRoads} camino(s) gratis`; break;
      case 'main':
        if (G.trade) txt = `🤝 ${who} propone un intercambio`;
        else txt = UI.mode && mine
          ? `${who}: elige dónde construir ${{ camino: 'el camino', poblado: 'el poblado', ciudad: 'la ciudad' }[UI.mode]} (Esc para cancelar)`
          : `${who}: construye, comercia o termina el turno`;
        break;
      case 'special-build': txt = `🔨 Fase especial de construcción: ${who}`; break;
    }
    if (bot) txt += ' <span class="thinking">🤖 pensando…</span>';
    else if (!mine && UI.online) txt += ' <span class="thinking">⏳</span>';
  }
  $('#banner').innerHTML = txt;
}

// ============================ Paneles ============================
function renderPlayers() {
  const view = viewerId();
  const a = actor();
  $('#players').innerHTML = `<h3>Jugadores <small>Meta: ${WIN_POINTS} puntos</small></h3>` + G.players.map(p => {
    const own = p.id === view || G.phase === 'gameover';
    const pts = vp(p.id, own);
    const hidden = own ? p.dev.filter(d => d.type === 'puntos').length : 0;
    const cls = [p.id === G.current ? 'current' : '', p.id === a && p.id !== G.current ? 'acting' : ''].join(' ');
    const offline = UI.online && NET.conn && !NET.conn[p.id];
    return `<div class="player ${cls}" style="--pc:${p.color}">
      <div class="pcolor-bar"></div>
      <div class="pmain">
        <div class="pname">${esc(p.name)}
          ${UI.online && p.id === NET.seat ? '<span class="tag me">tú</span>' : ''}
          ${p.isAI ? '<span class="tag">IA</span>' : ''}
          ${p.away ? '<span class="tag off" title="Desconectado: la IA juega en su lugar">IA temporal</span>' : offline ? '<span class="tag off">desconectado</span>' : ''}
          ${p.id === G.current ? '<span class="tag turn">turno</span>' : ''}</div>
        <div class="pstats">
          <span title="Cartas de recurso">🃏 ${handSize(p)}</span>
          <span title="Cartas de desarrollo">📜 ${p.dev.length}</span>
          <span title="Caballeros jugados">⚔️ ${p.knights}</span>
          <span title="Camino más largo">🛤️ ${p.roadLen}</span>
          ${G.longestHolder === p.id ? '<span class="award" title="Gran Ruta Comercial (+2)">🛣️ Ruta</span>' : ''}
          ${G.armyHolder === p.id ? '<span class="award" title="Gran Ejército de Caballería (+2)">🛡️ Ejército</span>' : ''}
        </div>
      </div>
      <div class="pvp" title="Puntos de victoria${hidden ? ' (incluye ' + hidden + ' oculto/s)' : ''}">${pts}${hidden ? '<sup>*</sup>' : ''}</div>
    </div>`;
  }).join('');
}

function renderTurnPanel() {
  const a = humanActor();
  // Los dados giran solo cuando hay una tirada nueva
  const key = G.dice ? `${G.id}-${G.turn}-${G.dice}` : null;
  const roll = key && key !== UI.lastDice ? 'rolling' : '';
  UI.lastDice = key;
  const dice = G.dice
    ? `<div class="dice ${G.dice[0] + G.dice[1] === 7 ? 'seven' : ''}">${dieHtml(G.dice[0], roll)}${dieHtml(G.dice[1], roll + ' second')}<b>${G.dice[0] + G.dice[1]}</b></div>`
    : `<div class="dice empty">${dieHtml(0, '')}${dieHtml(0, '')}<b>–</b></div>`;
  let html = `<div class="turn-head"><div><div class="turn-num">${G.turn ? 'Turno ' + G.turn : 'Colocación inicial'}</div>
    <div class="turn-who">${G.phase === 'gameover' ? 'Partida terminada' : 'Juega ' + pname(G.current)}</div></div>${dice}</div>`;

  if (G.phase === 'gameover') {
    html += `<button class="primary wide" data-act="show-winner">🏆 Ver resultados</button>`;
  } else if (a == null) {
    html += `<div class="info">⏳ Esperando a ${pname(actor())}…</div>`;
  } else {
    switch (G.phase) {
      case 'setup-settlement': html += `<div class="info">Haz clic en un punto brillante del tablero para colocar tu poblado.</div>`; break;
      case 'setup-road': html += `<div class="info">Haz clic en un borde brillante para colocar tu camino.</div>`; break;
      case 'roll':
        html += `<button class="primary wide big" data-act="roll">🎲 Tirar dados</button>`;
        if (playableDev(a, 'caballero')) html += `<div class="hint">Puedes jugar un Caballero antes de tirar.</div>`;
        break;
      case 'discard': html += `<button class="primary wide" data-act="reopen">Descartar ${G.discardNeed[a]} cartas</button>`; break;
      case 'robber': html += `<div class="info">🦹 Haz clic en un hexágono para mover el ladrón.</div>`; break;
      case 'steal': html += `<button class="primary wide" data-act="reopen">Elegir a quién robar</button>`; break;
      case 'road-building':
        html += `<div class="info">🛤️ Coloca ${G.freeRoads} camino(s) gratis en el tablero.</div>
          <button class="wide" data-act="end-roads">Terminar</button>`;
        break;
      case 'main':
        html += buildButtons(a);
        html += `<div class="btn-grid two">
          <button data-act="open-bank">🏦 Banco / puertos</button>
          <button data-act="open-trade">🤝 Comerciar${G.trade ? ' •' : ''}</button></div>
          <button class="primary wide" data-act="end-turn">⏭️ Terminar turno</button>`;
        break;
      case 'special-build':
        html += `<div class="info">🔨 Fase especial de construcción: puedes construir o comprar cartas (sin comerciar).</div>`;
        html += buildButtons(a);
        html += `<button class="primary wide" data-act="end-special">✔️ Terminar construcción</button>`;
        break;
    }
  }
  html += `<div class="bank-row" title="Cartas en el banco">🏦 ${RES.map(r => `<span>${RES_INFO[r].icon}${G.bank[r]}</span>`).join('')}<span>📜${G.devDeck.length}</span></div>`;
  $('#turn-panel').innerHTML = html;
}

function buildButtons(a) {
  const p = P(a);
  const can = {
    camino: canAfford(a, COSTS.camino) && p.roads > 0 && roadSpots(a).length > 0,
    poblado: canAfford(a, COSTS.poblado) && p.settlements > 0 && settlementSpots(a, false).length > 0,
    ciudad: canAfford(a, COSTS.ciudad) && p.cities > 0 && citySpots(a).length > 0,
  };
  const b = (kind, label, icon) => `<button class="build ${UI.mode === kind ? 'active' : ''}" data-act="mode" data-kind="${kind}" ${can[kind] ? '' : 'disabled'}>
    <span>${icon} ${label}</span><span class="cost">${costIcons(COSTS[kind])}</span></button>`;
  const canDev = canAfford(a, COSTS.carta) && G.devDeck.length > 0;
  return `<div class="btn-grid">${b('camino', 'Camino', '🛤️')}${b('poblado', 'Poblado', '🏠')}${b('ciudad', 'Ciudad', '🏰')}
    <button class="build" data-act="buy" ${canDev ? '' : 'disabled'}><span>📜 Carta</span><span class="cost">${costIcons(COSTS.carta)}</span></button></div>`;
}

function renderHand() {
  const v = viewerId();
  if (v == null) { $('#hand').innerHTML = ''; return; }
  const p = P(v);
  let html = `<h3><span>Mano de ${pname(v)}</span></h3><div class="cards">`;
  html += RES.map(r => `<div class="card ${p.res[r] ? '' : 'zero'}" style="--c:${RES_INFO[r].color}" title="${RES_INFO[r].name}">
    <span class="ic">${RES_INFO[r].icon}</span><span class="n">${p.res[r]}</span><span class="lbl">${RES_INFO[r].name}</span></div>`).join('');
  html += '</div>';

  const groups = {};
  p.dev.forEach(d => {
    groups[d.type] = groups[d.type] || { n: 0, fresh: 0 };
    groups[d.type].n++;
    if (d.turn >= G.turn) groups[d.type].fresh++;
  });
  if (p.dev.length) {
    html += '<div class="devs">';
    for (const [type, g] of Object.entries(groups)) {
      const info = DEV_INFO[type];
      if (!info) continue;
      const canPlay = playableDev(v, type) && humanActor() === v;
      html += `<div class="dev" title="${info.desc}">
        <span class="dev-ic">${info.icon}</span>
        <span class="dev-name">${info.name}${g.n > 1 ? ` ×${g.n}` : ''}${g.fresh ? `<small> (${g.fresh} nueva${g.fresh > 1 ? 's' : ''})</small>` : ''}</span>
        ${type !== 'puntos' ? `<button data-act="play-dev" data-type="${type}" ${canPlay ? '' : 'disabled'}>Jugar</button>` : ''}
      </div>`;
    }
    html += '</div>';
  } else html += '<div class="muted small">Sin cartas de desarrollo.</div>';

  html += `<div class="pieces">Piezas: 🛤️ ${p.roads} · 🏠 ${p.settlements} · 🏰 ${p.cities}</div>
    <div class="rates">Banco: ${RES.map(r => `<span>${RES_INFO[r].icon} ${bankRate(v, r)}:1</span>`).join('')}</div>`;
  $('#hand').innerHTML = html;
}

function renderLog() {
  const el = $('#log-list');
  el.innerHTML = G.log.map(l => `<div class="log-line">${l.html}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

// ============================ Modales ============================
function openModal(name, html) {
  UI.modal = name;
  $('#modal').innerHTML = html;
  $('#modal-backdrop').classList.remove('hidden');
}
function closeModal() {
  UI.modal = null;
  $('#modal-backdrop').classList.add('hidden');
  $('#modal').innerHTML = '';
}

function offerTargets() {
  if (!G.offer) return [];
  return UI.online ? G.offer.to.filter(pid => pid === NET.seat) : G.offer.to;
}

function syncModals() {
  const a = humanActor();
  if (G.phase === 'gameover') { if (!UI.winnerShown) { UI.winnerShown = true; showWinner(); } return; }
  if (offerTargets().length) { if (UI.modal !== 'offer') showOffer(); return; }
  if (G.phase === 'discard' && a != null) { if (UI.modal !== 'discard-' + a) showDiscard(a); return; }
  if (G.phase === 'steal' && a != null) { if (UI.modal !== 'steal') showSteal(); return; }
  if (UI.online && G.trade && G.trade.from !== NET.seat && G.trade.responses[NET.seat] === null) {
    if (UI.modal !== 'trade-resp') showTradeResp();
    return;
  }
  if (UI.modal && /^(discard|steal|offer|winner|trade-resp)/.test(UI.modal)) closeModal();
  if (['bank', 'trade', 'yop', 'mono'].includes(UI.modal) && !(G.phase === 'main' && a === G.current)) closeModal();
  if (UI.modal === 'trade') renderTradeModal();
  if (UI.modal === 'bank') renderBankModal();
}

function stepper(prefix, sel, max) {
  return `<div class="steppers">${RES.map(r => `<div class="stepper" style="--c:${RES_INFO[r].color}">
    <span class="ic">${RES_INFO[r].icon}</span>
    <button data-act="${prefix}" data-r="${r}" data-d="-1" ${sel[r] <= 0 ? 'disabled' : ''}>−</button>
    <span class="val">${sel[r]}</span>
    <button data-act="${prefix}" data-r="${r}" data-d="1" ${(max && sel[r] >= max[r]) || sel[r] >= 19 ? 'disabled' : ''}>+</button>
    ${max ? `<small>de ${max[r]}</small>` : ''}
  </div>`).join('')}</div>`;
}

function offerLine(give, get, giveLbl, getLbl) {
  return `<p class="offer-line"><span>${giveLbl}<br><b>${resStr(give)}</b></span><span class="arrow">⇄</span><span>${getLbl}<br><b>${resStr(get)}</b></span></p>`;
}

// --- Descarte ---
function showDiscard(pid) {
  if (UI.modal !== 'discard-' + pid) UI.discardSel = zeroRes();
  const need = G.discardNeed[pid], sel = UI.discardSel, n = total(sel);
  openModal('discard-' + pid, `<h2>${pname(pid)}: descarta ${need} cartas</h2>
    <p>Ha salido un 7 y tienes más de 7 cartas. Elige qué cartas devuelves al banco.</p>
    ${stepper('dsel', sel, P(pid).res)}
    <div class="modal-foot"><span class="counter ${n === need ? 'ok' : ''}">${n} / ${need}</span>
    <button class="primary" data-act="discard-ok" ${n === need ? '' : 'disabled'}>Descartar</button></div>`);
}

// --- Robo ---
function showSteal() {
  openModal('steal', `<h2>¿A quién le robas?</h2><div class="choice-list">
    ${G.stealCandidates.map(pid => `<button data-act="steal" data-p="${pid}">${pname(pid)} <small>🃏 ${handSize(P(pid))} cartas</small></button>`).join('')}
  </div>`);
}

// --- Banco ---
function openBank() {
  UI.bank = { give: null, get: null };
  renderBankModal();
}
function renderBankModal() {
  const a = G.current, p = P(a), s = UI.bank;
  if (s.give && p.res[s.give] < bankRate(a, s.give)) s.give = null;
  const rate = s.give ? bankRate(a, s.give) : null;
  const ok = s.give && s.get && s.give !== s.get && G.bank[s.get] > 0;
  openModal('bank', `<h2>🏦 Comercio con el banco</h2>
    <p class="muted">Cambia cartas iguales por una carta del banco. Tasa normal 4:1; con puerto 3:1 o 2:1.</p>
    <h3>Entregas</h3><div class="res-picks">${RES.map(r => {
      const rt = bankRate(a, r);
      return `<button class="pick ${s.give === r ? 'sel' : ''}" style="--c:${RES_INFO[r].color}" data-act="bank-give" data-r="${r}" ${p.res[r] >= rt ? '' : 'disabled'}>
        <span class="ic">${RES_INFO[r].icon}</span><span>${rt}:1</span><small>tienes ${p.res[r]}</small></button>`;
    }).join('')}</div>
    <h3>Recibes</h3><div class="res-picks">${RES.map(r => `<button class="pick ${s.get === r ? 'sel' : ''}" style="--c:${RES_INFO[r].color}" data-act="bank-get" data-r="${r}" ${r === s.give || !G.bank[r] ? 'disabled' : ''}>
        <span class="ic">${RES_INFO[r].icon}</span><span>${RES_INFO[r].name}</span><small>banco ${G.bank[r]}</small></button>`).join('')}</div>
    <div class="modal-foot"><button data-act="close">Cerrar</button>
    <button class="primary" data-act="bank-ok" ${ok ? '' : 'disabled'}>Cambiar ${ok ? `${rate} ${RES_INFO[s.give].icon} → 1 ${RES_INFO[s.get].icon}` : ''}</button></div>`);
}

// --- Comercio entre jugadores ---
function myTrade() {
  return G.trade && G.trade.from === G.current ? G.trade : null;
}
function openTrade() {
  const tr = myTrade();
  UI.trade = tr ? { give: { ...tr.give }, get: { ...tr.get } } : { give: zeroRes(), get: zeroRes() };
  renderTradeModal();
}
function renderTradeModal() {
  const a = G.current, p = P(a), t = UI.trade, tr = myTrade();
  const valid = total(t.give) > 0 && total(t.get) > 0 && !RES.some(r => t.give[r] && t.get[r]);
  let resp = '';
  if (tr) {
    resp = '<h3>Respuestas</h3><div class="choice-list">' + G.players.filter(o => o.id !== a).map(o => {
      const st = tr.responses[o.id];
      if (st === 'yes') return `<button class="primary" data-act="trade-confirm" data-p="${o.id}">✅ ${pname(o.id)} acepta — cerrar el trato</button>`;
      if (st === 'no') return `<div class="resp no">❌ ${pname(o.id)} rechaza</div>`;
      if (UI.online) return `<div class="resp">⏳ ${pname(o.id)} está decidiendo…</div>`;
      return `<div class="resp-row">${pname(o.id)}
        <button data-act="trade-resp-local" data-p="${o.id}" data-acc="1">Acepta</button>
        <button data-act="trade-resp-local" data-p="${o.id}" data-acc="0">Rechaza</button></div>`;
    }).join('') + '</div>';
  }
  openModal('trade', `<h2>🤝 Comercio con jugadores</h2>
    <div class="trade-cols">
      <div><h3>Ofreces</h3>${stepper('tgive', t.give, p.res)}</div>
      <div><h3>Pides</h3>${stepper('tget', t.get, null)}</div>
    </div>
    ${resp}
    <div class="modal-foot"><button data-act="close">Cerrar</button>
    ${tr ? '<button data-act="trade-cancel">Retirar oferta</button>'
         : `<button class="primary" data-act="trade-propose" ${valid ? '' : 'disabled'}>Proponer a todos</button>`}</div>`);
}

// --- Respuesta a una propuesta (online, jugador que no está en turno) ---
function showTradeResp() {
  const tr = G.trade, me = P(NET.seat);
  const has = RES.every(r => me.res[r] >= tr.get[r]);
  openModal('trade-resp', `<h2>🤝 ${pname(tr.from)} propone un intercambio</h2>
    ${offerLine(tr.give, tr.get, 'Te da', 'A cambio de')}
    ${has ? '' : '<p class="muted center">No tienes las cartas que pide.</p>'}
    <div class="modal-foot center"><button data-act="trade-respond" data-acc="0">Rechazar</button>
    <button class="primary" data-act="trade-respond" data-acc="1" ${has ? '' : 'disabled'}>Aceptar</button></div>`);
}

// --- Oferta de la IA a humanos ---
function showOffer() {
  const o = G.offer;
  const targets = offerTargets();
  openModal('offer', `<h2>Oferta de ${pname(o.from)}</h2>
    ${offerLine(o.give, o.get, 'Te da', 'A cambio de')}
    <div class="choice-list">${targets.map(pid => {
      const has = RES.every(r => P(pid).res[r] >= o.get[r]);
      return `<button class="primary" data-act="offer-yes" data-p="${pid}" ${has ? '' : 'disabled'}>Aceptar${UI.online ? '' : ` (${esc(P(pid).name)})`}</button>`;
    }).join('')}
    <button data-act="offer-no">Rechazar</button></div>`);
}

// --- Año de abundancia / Monopolio ---
function showYop() {
  const picks = UI.yop;
  openModal('yop', `<h2>🎁 Año de abundancia</h2><p>Elige 2 recursos del banco.</p>
    <div class="res-picks">${RES.map(r => `<button class="pick" style="--c:${RES_INFO[r].color}" data-act="yop-pick" data-r="${r}" ${picks.length >= 2 || G.bank[r] <= picks.filter(x => x === r).length ? 'disabled' : ''}>
      <span class="ic">${RES_INFO[r].icon}</span><span>${RES_INFO[r].name}</span></button>`).join('')}</div>
    <p class="chosen">Elegidos: ${picks.map(r => RES_INFO[r].icon).join(' ') || '—'} ${picks.length ? '<button class="link" data-act="yop-reset">borrar</button>' : ''}</p>
    <div class="modal-foot"><button data-act="close">Cancelar</button>
    <button class="primary" data-act="yop-ok" ${picks.length === 2 ? '' : 'disabled'}>Tomar</button></div>`);
}
function showMono() {
  openModal('mono', `<h2>💰 Monopolio</h2><p>Elige un recurso: todos los demás jugadores te darán todas sus cartas de ese tipo.</p>
    <div class="res-picks">${RES.map(r => `<button class="pick" style="--c:${RES_INFO[r].color}" data-act="mono-pick" data-r="${r}">
      <span class="ic">${RES_INFO[r].icon}</span><span>${RES_INFO[r].name}</span></button>`).join('')}</div>
    <div class="modal-foot"><button data-act="close">Cancelar</button></div>`);
}

// --- Fin de partida ---
function showWinner() {
  const ranking = G.players.slice().sort((a, b) => vp(b.id) - vp(a.id));
  const isHost = UI.online && NET.host === NET.seat;
  const buttons = UI.online
    ? `<button data-act="close">Ver tablero</button>
       ${isHost ? '<button class="primary" data-act="lobby-back">🔁 Volver a la sala</button>' : '<span class="muted small">El anfitrión puede volver a la sala para otra partida.</span>'}
       <button data-act="menu-exit">🏠 Menú</button>`
    : `<button data-act="close">Ver tablero</button>
       <button data-act="menu-exit">🏠 Menú</button>
       <button class="primary" data-act="local-again">🔄 Otra partida</button>`;
  openModal('winner', `<div class="winner"><div class="trophy">🏆</div>
    <h2>¡${pname(G.winner)} gana!</h2>
    <ol class="ranking">${ranking.map(p => {
      const vpc = p.dev.filter(d => d.type === 'puntos').length;
      return `<li>${pname(p.id)} <b>${vp(p.id)} pts</b> <small>${vpc ? `(${vpc} carta${vpc > 1 ? 's' : ''} de punto)` : ''}</small></li>`;
    }).join('')}</ol>
    <div class="modal-foot center wrap">${buttons}</div></div>`);
}

// --- Reglas ---
function showRules() {
  openModal('rules', `<h2>📖 Reglas rápidas</h2><div class="rules">
    <p><b>Objetivo:</b> ser el primero en alcanzar <b>${WIN_POINTS} puntos de victoria</b> durante tu turno.</p>
    <h3>Preparación</h3>
    <p>Cada jugador coloca un poblado y un camino; después, en orden inverso, un segundo poblado y camino. El segundo poblado produce una carta de cada terreno adyacente.</p>
    <h3>Tu turno</h3>
    <ol><li><b>Tira los dados:</b> cada hexágono con ese número produce para los poblados (1 carta) y ciudades (2 cartas) adyacentes.</li>
    <li><b>Comercia:</b> con otros jugadores o con el banco (4:1, o 3:1 / 2:1 si tienes un puerto).</li>
    <li><b>Construye:</b> 🛤️ Camino ${costIcons(COSTS.camino)} · 🏠 Poblado ${costIcons(COSTS.poblado)} · 🏰 Ciudad ${costIcons(COSTS.ciudad)} · 📜 Carta ${costIcons(COSTS.carta)}</li></ol>
    <h3>El 7 y el ladrón</h3>
    <p>Si sale un 7, quien tenga más de 7 cartas descarta la mitad. El jugador mueve el ladrón a otro hexágono (que deja de producir) y roba una carta a un jugador con edificio junto a él.</p>
    <h3>Reglas de construcción</h3>
    <p>Los poblados deben estar a 2 caminos de distancia de cualquier otro edificio y conectados a tus caminos. Un poblado vale 1 punto; una ciudad, 2.</p>
    <h3>Cartas de desarrollo</h3>
    <p>⚔️ Caballero · 🛤️ Construcción de carreteras · 🎁 Año de abundancia · 💰 Monopolio · 🏆 Punto de victoria. Solo una por turno, y no la que compraste ese mismo turno.</p>
    <h3>Premios (+2 puntos)</h3>
    <p>🛣️ <b>Gran Ruta Comercial:</b> el camino continuo más largo (mínimo 5). 🛡️ <b>Gran Ejército:</b> el primero con 3 caballeros jugados, o quien supere al actual.</p>
    <h3>Ampliación 5-6 jugadores</h3>
    <p>Tablero de 30 hexágonos (2 desiertos), 11 puertos, más cartas. <b>Fase especial de construcción:</b> al terminar el turno de un jugador, los demás, por orden, pueden construir o comprar cartas de desarrollo (pero no comerciar ni jugar cartas).</p>
    <h3>Partida online</h3>
    <p>Crea una sala y comparte el código o el enlace. Si alguien se desconecta, la IA juega en su lugar hasta que vuelva a entrar.</p>
    </div><div class="modal-foot"><button class="primary" data-act="close">Entendido</button></div>`);
}

// ============================ Eventos ============================
function playDevUI(type) {
  const a = humanActor();
  if (a == null || !playableDev(a, type)) return;
  if (type === 'caballero') send({ type: 'knight' });
  else if (type === 'carreteras') send({ type: 'roadbuilding' });
  else if (type === 'abundancia') { UI.yop = []; showYop(); }
  else if (type === 'monopolio') showMono();
}

function onClick(ev) {
  const t = ev.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const act = t.dataset.act;
  const r = t.dataset.r, d = +t.dataset.d, p = t.dataset.p != null ? +t.dataset.p : null;
  if (handleNetClick(act, t)) return; // acciones de menú y sala (net.js)
  switch (act) {
    case 'close':
      if (UI.modal === 'trade' && G && myTrade() && humanActor() === G.current) send({ type: 'trade-cancel' });
      closeModal(); render();
      return;
    case 'rules': showRules(); return;
    case 'toggle-3d': toggleView(); return;
    case 'menu-exit':
      if (UI.online) leaveOnline(); else exitToMenu();
      return;
    case 'local-again': exitToMenu(); showScreen('setup-screen'); return;
    case 'show-winner': showWinner(); return;
  }
  if (!G) return;
  const a = humanActor();
  switch (act) {
    case 'roll': send({ type: 'roll' }); break;
    case 'mode': UI.mode = UI.mode === t.dataset.kind ? null : t.dataset.kind; render(); break;
    case 'buy': send({ type: 'buy' }); break;
    case 'end-turn': send({ type: 'end-turn' }); break;
    case 'end-special': send({ type: 'end-special' }); break;
    case 'end-roads': send({ type: 'end-roads' }); break;
    case 'play-dev': playDevUI(t.dataset.type); break;
    case 'reopen': UI.modal = null; syncModals(); break;
    // descarte y robo
    case 'dsel': UI.discardSel[r] += d; showDiscard(a); break;
    case 'discard-ok': send({ type: 'discard', sel: UI.discardSel }); break;
    case 'steal': send({ type: 'steal', p }); break;
    // banco
    case 'open-bank': openBank(); break;
    case 'bank-give': UI.bank.give = r; if (UI.bank.get === r) UI.bank.get = null; renderBankModal(); break;
    case 'bank-get': UI.bank.get = r; renderBankModal(); break;
    case 'bank-ok': send({ type: 'bank', give: UI.bank.give, get: UI.bank.get }); break;
    // comercio entre jugadores
    case 'open-trade': openTrade(); break;
    case 'tgive': case 'tget':
      UI.trade[act === 'tgive' ? 'give' : 'get'][r] += d;
      if (myTrade()) send({ type: 'trade-cancel' });
      else renderTradeModal();
      break;
    case 'trade-propose': send({ type: 'trade-propose', give: UI.trade.give, get: UI.trade.get }); break;
    case 'trade-cancel': send({ type: 'trade-cancel' }); break;
    case 'trade-confirm': send({ type: 'trade-confirm', to: p }); closeModal(); break;
    case 'trade-resp-local': send({ type: 'trade-respond', accept: t.dataset.acc === '1' }, p); break;
    case 'trade-respond': send({ type: 'trade-respond', accept: t.dataset.acc === '1' }); break;
    // ofertas de la IA
    case 'offer-yes': send({ type: 'offer-respond', accept: true }, p); break;
    case 'offer-no':
      if (UI.online) send({ type: 'offer-respond', accept: false });
      else { G.offer.to.slice().forEach(pid => applyAction(pid, { type: 'offer-respond', accept: false })); refresh(); }
      break;
    // cartas de progreso
    case 'yop-pick': UI.yop.push(r); showYop(); break;
    case 'yop-reset': UI.yop = []; showYop(); break;
    case 'yop-ok': send({ type: 'yop', r1: UI.yop[0], r2: UI.yop[1] }); closeModal(); break;
    case 'mono-pick': send({ type: 'mono', r }); closeModal(); break;
  }
}

function onKey(ev) {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName);
  if (ev.key === 'Escape') {
    if (UI.modal && ['bank', 'trade', 'yop', 'mono', 'rules', 'winner'].includes(UI.modal)) {
      if (UI.modal === 'trade' && G && myTrade() && humanActor() === G.current) send({ type: 'trade-cancel' });
      closeModal(); render();
    } else if (UI.mode) { UI.mode = null; render(); }
  }
  if (ev.key === ' ' && !typing && G && G.phase === 'roll' && humanActor() != null && !UI.modal) {
    ev.preventDefault();
    send({ type: 'roll' });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initSetup();
  initMenu();
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  $('#board').addEventListener('click', onBoardClick);
  $('#modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop' && ['bank', 'rules', 'winner'].includes(UI.modal)) { closeModal(); render(); }
  });
});

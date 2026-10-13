'use strict';
// ---------------------------------------------------------------------------
// Menú de inicio, conexión con el servidor, sala de espera y chat
// ---------------------------------------------------------------------------

const NET = {
  ws: null, room: null, token: null, seat: null, host: null, lobby: null,
  conn: null, chat: [], leaving: false, retry: 0,
};
const SESSION_KEY = 'catan-session';
const NAME_KEY = 'catan-name';

// La sesión se guarda por pestaña (sobrevive a recargar la página); el nombre, en el navegador.
function storageFor(key) { return key === SESSION_KEY ? sessionStorage : localStorage; }
function store(key, val) {
  try { if (val == null) storageFor(key).removeItem(key); else storageFor(key).setItem(key, JSON.stringify(val)); } catch (e) { /* sin almacenamiento */ }
}
function load(key) {
  try { return JSON.parse(storageFor(key).getItem(key)); } catch (e) { return null; }
}

function canPlayOnline() {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function myName() {
  return $('#menu-name').value.trim().slice(0, 14);
}

// ============================ Menú ============================
function initMenu() {
  $('#menu-name').value = load(NAME_KEY) || '';
  $('#menu-name').addEventListener('input', () => store(NAME_KEY, myName()));
  $('#join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinFromMenu(); });
  $('#btn-local').onclick = () => { renderSetupRows(myName() || null); showScreen('setup-screen'); };
  $('#btn-create').onclick = createFromMenu;
  $('#btn-join').onclick = joinFromMenu;
  $('#btn-rules-menu').onclick = showRules;
  $('#chat-form').addEventListener('submit', sendChat);
  $('#lobby-chat-form').addEventListener('submit', sendChat);
  document.addEventListener('change', onNetChange);

  if (!canPlayOnline()) {
    disableOnline('🌐 Para jugar online, abre el juego desde el servidor: ejecuta <code>node server.js</code> y entra en <b>http://localhost:3000</b>. Más detalles en <code>LEEME.md</code>.');
    return;
  }
  // Si la página está en un hosting sin el servidor del juego, solo hay partida local
  fetch('salud', { cache: 'no-store' })
    .then(r => r.ok ? r.text() : '')
    .catch(() => '')
    .then(txt => {
      if (txt.trim() !== 'ok') disableOnline('🌐 Este sitio solo tiene la partida local: el servidor online no está instalado aquí.');
    });

  const sala = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
  if (sala) {
    $('#join-code').value = sala;
    $('#join-box').classList.add('highlight');
  }
  // Volver a entrar en la última partida (por ejemplo, tras recargar la página)
  const sess = load(SESSION_KEY);
  if (sess && sess.room && (!sala || sala === sess.room)) {
    connect(() => wsSend({ t: 'rejoin', room: sess.room, token: sess.token }));
  }
}

function disableOnline(html) {
  $('#btn-create').disabled = true;
  $('#btn-join').disabled = true;
  $('#join-code').disabled = true;
  const note = $('#online-note');
  note.innerHTML = html;
  note.classList.remove('hidden');
}

function requireName() {
  if (myName()) return true;
  toast('Escribe tu nombre para jugar online.');
  $('#menu-name').focus();
  return false;
}

function createFromMenu() {
  if (!requireName()) return;
  connect(() => wsSend({ t: 'create', name: myName() }));
}

function joinFromMenu() {
  const code = $('#join-code').value.trim().toUpperCase();
  if (!requireName()) return;
  if (code.length < 4) { toast('Escribe el código de la sala (4 letras).'); $('#join-code').focus(); return; }
  connect(() => wsSend({ t: 'join', room: code, name: myName() }));
}

// ============================ Conexión ============================
function connect(onOpen) {
  if (NET.ws && NET.ws.readyState === WebSocket.OPEN) { onOpen(); return; }
  if (NET.ws && NET.ws.readyState === WebSocket.CONNECTING) { NET.ws.addEventListener('open', onOpen, { once: true }); return; }
  let ws;
  try {
    // Misma dirección que la página (también si el juego está en una subcarpeta del dominio)
    const dir = location.pathname.replace(/[^/]*$/, '');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + dir);
  } catch (e) {
    toast('No se pudo conectar con el servidor.');
    return;
  }
  NET.ws = ws;
  NET.leaving = false;
  ws.addEventListener('open', () => { NET.retry = 0; onOpen(); }, { once: true });
  ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    handleMsg(m);
  };
  ws.onclose = () => {
    if (NET.ws !== ws) return;
    NET.ws = null;
    if (NET.room && !NET.leaving) {
      toast('Conexión perdida. Reconectando…');
      const delay = Math.min(1000 * ++NET.retry, 8000);
      setTimeout(() => {
        if (NET.room && !NET.ws) connect(() => wsSend({ t: 'rejoin', room: NET.room, token: NET.token }));
      }, delay);
    }
  };
  ws.onerror = () => { if (!NET.room) toast('No se pudo conectar con el servidor.'); };
}

function wsSend(m) {
  if (NET.ws && NET.ws.readyState === WebSocket.OPEN) NET.ws.send(JSON.stringify(m));
  else toast('Sin conexión con el servidor.');
}

function handleMsg(m) {
  switch (m.t) {
    case 'joined':
      NET.room = m.room;
      NET.token = m.token;
      UI.online = true;
      stopLocalAI();
      store(SESSION_KEY, { room: m.room, token: m.token });
      history.replaceState(null, '', location.pathname + '?sala=' + m.room);
      break;
    case 'lobby':
      NET.lobby = m;
      NET.seat = m.you;
      NET.host = m.host;
      if (G) { G = null; closeModal(); }
      showScreen('lobby-screen');
      renderLobby();
      break;
    case 'state': {
      NET.seat = m.you;
      NET.conn = m.conn;
      NET.host = m.host;
      const fresh = !G || G.id !== m.G.id;
      G = m.G;
      if (fresh) {
        UI.mode = null; UI.viewer = null; UI.winnerShown = false;
        closeModal();
        showScreen('game');
        computeView();
      } else if ($('#game').classList.contains('hidden')) showScreen('game');
      render();
      break;
    }
    case 'chat':
      NET.chat.push(m);
      if (NET.chat.length > 100) NET.chat.shift();
      renderChat();
      break;
    case 'chat-history':
      NET.chat = m.list || [];
      renderChat();
      break;
    case 'error':
      if (m.fatal) {
        store(SESSION_KEY, null);
        resetOnline();
        G = null;
        closeModal();
        showScreen('menu-screen');
      }
      if (!m.quiet) toast(m.msg);
      else if (G) render();
      break;
  }
}

function resetOnline() {
  UI.online = false;
  Object.assign(NET, { room: null, token: null, seat: null, host: null, lobby: null, conn: null, chat: [] });
  if (NET.ws) {
    const w = NET.ws;
    NET.ws = null;
    try { w.close(); } catch (e) { /* ya cerrada */ }
  }
}

function leaveOnline() {
  NET.leaving = true;
  if (NET.ws && NET.ws.readyState === WebSocket.OPEN) NET.ws.send(JSON.stringify({ t: 'leave' }));
  store(SESSION_KEY, null);
  resetOnline();
  G = null;
  closeModal();
  history.replaceState(null, '', location.pathname);
  showScreen('menu-screen');
}

// ============================ Sala de espera ============================
function lobbyLink() {
  return location.origin + location.pathname + '?sala=' + NET.lobby.code;
}

function renderLobby() {
  const L = NET.lobby;
  if (!L) return;
  const isHost = L.host === L.you;
  $('#lobby-code').textContent = L.code;
  $('#lobby-link').textContent = lobbyLink();
  const taken = L.seats.map((s, i) => i !== L.you && s.color);
  const mine = L.seats[L.you];

  let rows = L.seats.map((s, i) => `<div class="seat ${i === L.you ? 'me' : ''}">
    <span class="swatch" style="background:${s.color}"></span>
    <span class="seat-name">${esc(s.name)}</span>
    <span class="seat-tags">
      ${i === L.host ? '<span class="tag turn">anfitrión</span>' : ''}
      ${i === L.you ? '<span class="tag me">tú</span>' : ''}
      ${s.isAI ? '<span class="tag">🤖 IA</span>' : ''}
      ${!s.isAI && !s.connected ? '<span class="tag off">desconectado</span>' : ''}
    </span>
    ${i === L.you ? `<select id="lobby-color" aria-label="Tu color">${PLAYER_COLORS.map(c =>
      `<option value="${c.hex}" ${c.hex === mine.color ? 'selected' : ''} ${taken.includes(c.hex) ? 'disabled' : ''}>${c.name}</option>`).join('')}</select>` : ''}
    ${isHost && i !== L.you ? `<button class="icon" data-act="lobby-remove" data-p="${i}" title="Quitar de la sala">✕</button>` : ''}
  </div>`).join('');
  for (let i = L.seats.length; i < 6; i++) rows += `<div class="seat empty"><span class="swatch"></span><span class="muted">Puesto libre…</span></div>`;
  $('#lobby-seats').innerHTML = rows;

  const n = L.seats.length;
  const speeds = [[300, 'Rápida'], [900, 'Normal'], [1600, 'Lenta']];
  $('#lobby-note').innerHTML = boardNote(Math.max(n, 3));
  $('#lobby-controls').innerHTML = isHost
    ? `<div class="options">
        <button data-act="lobby-add-ai" ${n >= 6 ? 'disabled' : ''}>🤖 Añadir jugador IA</button>
        <label class="${n < 5 ? 'disabled' : ''}"><input type="checkbox" id="lobby-special" ${L.options.special ? 'checked' : ''} ${n < 5 ? 'disabled' : ''}> Fase especial de construcción (5-6 jugadores)</label>
        <label>Velocidad de la IA <select id="lobby-speed">${speeds.map(([v, t]) => `<option value="${v}" ${L.options.speed === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>`
    : `<p class="muted small">Fase especial: ${L.options.special ? 'sí' : 'no'} · Velocidad de la IA: ${(speeds.find(s => s[0] === L.options.speed) || speeds[1])[1]}</p>`;
  $('#lobby-start-wrap').innerHTML = isHost
    ? `<button class="primary big" data-act="lobby-start" ${n < 3 ? 'disabled' : ''}>▶ Comenzar partida</button>`
    : '<span class="muted">Esperando a que el anfitrión comience…</span>';
  $('#lobby-hint').textContent = isHost && n < 3 ? 'Se necesitan al menos 3 jugadores: espera a tus amigos o añade jugadores IA.' : '';
  renderChat();
}

function onNetChange(e) {
  if (e.target.id === 'lobby-color') wsSend({ t: 'color', color: e.target.value });
  else if (e.target.id === 'lobby-special' || e.target.id === 'lobby-speed') {
    wsSend({ t: 'options', special: $('#lobby-special').checked, speed: +$('#lobby-speed').value });
  }
}

// Clics de menú y sala. Devuelve true si la acción se ha gestionado aquí.
function handleNetClick(act, el) {
  switch (act) {
    case 'lobby-add-ai': wsSend({ t: 'add-ai' }); return true;
    case 'lobby-remove': wsSend({ t: 'remove', seat: +el.dataset.p }); return true;
    case 'lobby-start': wsSend({ t: 'start' }); return true;
    case 'lobby-leave': leaveOnline(); return true;
    case 'lobby-back': closeModal(); wsSend({ t: 'to-lobby' }); return true;
    case 'copy-link': {
      const link = lobbyLink();
      const done = () => toast('Enlace copiado. ¡Compártelo con tus amigos!');
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => prompt('Copia este enlace:', link));
      else prompt('Copia este enlace:', link);
      return true;
    }
    case 'menu':
      if (UI.online) {
        if (confirm('¿Salir de la partida online? La IA ocupará tu lugar.')) leaveOnline();
      } else if (!G || G.phase === 'gameover' || confirm('¿Abandonar la partida?')) exitToMenu();
      return true;
  }
  return false;
}

// ============================ Chat ============================
function sendChat(e) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  wsSend({ t: 'chat', text });
  input.value = '';
}

function renderChat() {
  const html = NET.chat.map(m => `<div class="chat-line"><span class="pn" style="--pc:${m.color}">${esc(m.name)}</span> ${esc(m.text)}</div>`).join('')
    || '<div class="muted small">Todavía no hay mensajes.</div>';
  document.querySelectorAll('.chat-list').forEach(el => {
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  });
}

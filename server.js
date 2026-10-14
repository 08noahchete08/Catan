'use strict';
// ---------------------------------------------------------------------------
// Servidor de Catán online.
// Sirve los archivos del juego y gestiona las salas por WebSocket.
// Es la autoridad de la partida: valida cada acción con las mismas reglas que
// el juego local (js/game.js), mueve a la IA y oculta a cada jugador las cartas
// de los demás. No necesita dependencias: ejecuta `node server.js`.
// ---------------------------------------------------------------------------

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const MAX_SEATS = 6;
const OFFER_TIMEOUT = 30000;      // la oferta de una IA caduca si nadie responde
const AWAY_GRACE = 15000;          // tiempo antes de que la IA sustituya a un desconectado
const LOBBY_DROP = 60000;          // en la sala, se quita a quien no vuelve
const ROOM_IDLE = 30 * 60000;      // se borra una sala sin humanos conectados

// ============================ Archivos estáticos ============================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { res.writeHead(400); res.end(); return; }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/salud') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  // Solo se sirven la página y las carpetas css/ y js/
  if (!(pathname === '/index.html' || /^\/(css|js)\/[\w.-]+$/.test(pathname))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }
  const file = path.join(ROOT, pathname);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ============================ WebSocket mínimo (RFC 6455) ============================
class WSConn extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.open = true;
    this.alive = true;
    sock.on('data', d => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 256 * 1024) { this.close(); return; }
      const mlen = masked ? 4 : 0;
      if (this.buf.length < off + mlen + len) return;
      let payload = Buffer.from(this.buf.subarray(off + mlen, off + mlen + len));
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(off + mlen + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x2) {
        if (fin) this.emit('message', payload.toString('utf8'));
        else this.frag = [payload];
        continue;
      }
      if (op === 0x0 && this.frag) {
        this.frag.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.frag).toString('utf8');
          this.frag = null;
          this.emit('message', msg);
        }
      }
    }
  }
  _frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.sock.write(Buffer.concat([head, payload])); } catch (e) { this._closed(); }
  }
  send(obj) { this._frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close() {
    if (!this.open) return;
    this._frame(0x8, Buffer.alloc(0));
    this.open = false;
    try { this.sock.end(); } catch (e) { /* ya cerrado */ }
    this._closed();
  }
  _closed() {
    if (this.didClose) return;
    this.didClose = true;
    this.open = false;
    try { this.sock.destroy(); } catch (e) { /* ya cerrado */ }
    this.emit('close');
  }
}

const conns = new Set();
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = new WSConn(socket);
  conns.add(ws);
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    try { onMessage(ws, msg); } catch (e) { console.error('Error procesando mensaje:', e); }
  });
  ws.on('close', () => { conns.delete(ws); onDisconnect(ws); });
});

// Latido para detectar conexiones muertas y mantener vivos los proxies
setInterval(() => {
  for (const ws of conns) {
    if (!ws.alive) { ws.close(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 25000);

// ============================ Motor del juego ============================
const GAME_SCRIPTS = ['board', 'game', 'variants', 'seafarers', 'ck', 'ai'].map(f =>
  new vm.Script(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), { filename: f + '.js' }));

function makeEngine() {
  const ctx = vm.createContext({ console });
  GAME_SCRIPTS.forEach(s => s.runInContext(ctx));
  // Llama a una expresión del juego pasando argumentos sin construir código con ellos
  const call = (expr, ...args) => { ctx.__args = args; return vm.runInContext(expr, ctx); };
  return { ctx, call };
}

const BASE = makeEngine();
const COLORS = BASE.call('PLAYER_COLORS.map(c => c.hex)');
const RES = BASE.call('RES');
const EXPANSIONS_READY = ['seafarers', 'ck']; // falta: 'tb'
const AI_NAMES = ['Bruno', 'Carla', 'Diego', 'Elena', 'Fede', 'Gala', 'Hugo', 'Irene'];

// ============================ Salas ============================
const rooms = new Map();

function newCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do code = Array.from({ length: 4 }, () => L[crypto.randomInt(L.length)]).join('');
  while (rooms.has(code));
  return code;
}

function cleanName(n) {
  return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Jugador';
}

function freeColor(room) {
  return COLORS.find(c => !room.seats.some(s => s.color === c));
}

function seatOf(room, token) {
  return room.seats.findIndex(s => s.token === token);
}

function hostIndex(room) {
  return seatOf(room, room.hostToken);
}

function addHuman(room, name, ws) {
  const seat = { name: cleanName(name), color: freeColor(room), isAI: false, token: crypto.randomUUID(), ws, connected: true };
  room.seats.push(seat);
  attach(ws, room, seat);
  return seat;
}

function attach(ws, room, seat) {
  if (seat.ws && seat.ws !== ws) {
    const old = seat.ws;
    old.room = null;
    old.close();
  }
  seat.ws = ws;
  seat.connected = true;
  ws.room = room;
  ws.token = seat.token;
  clearTimeout(seat.dropTimer);
  room.lastActive = Date.now();
  ws.send({ t: 'joined', room: room.code, token: seat.token });
  ws.send({ t: 'chat-history', list: room.chat });
}

function lobbyPayload(room, token) {
  return {
    t: 'lobby', code: room.code,
    seats: room.seats.map(s => ({ name: s.name, color: s.color, isAI: s.isAI, connected: s.isAI || s.connected })),
    host: hostIndex(room), you: seatOf(room, token), options: room.options,
  };
}

function broadcastLobby(room) {
  for (const s of room.seats) if (s.ws && s.connected) s.ws.send(lobbyPayload(room, s.token));
}

function getG(room) {
  return room.engine ? room.engine.call('G') : null;
}

// Copia del estado para un jugador: sin las cartas de los demás ni el orden del mazo
function stateFor(room, seat) {
  const G = getG(room);
  const s = JSON.parse(JSON.stringify(G));
  s.devDeck = new Array(G.devDeck.length).fill(0);
  if (s.progressDecks) for (const k of Object.keys(s.progressDecks)) s.progressDecks[k] = new Array(s.progressDecks[k].length).fill(0);
  s.log = s.log.slice(-150);
  delete s.lastSteal;
  const reveal = G.phase === 'gameover';
  for (const p of s.players) {
    p.handCount = Object.values(p.res).reduce((n, x) => n + x, 0);
    if (!reveal && p.id !== seat) {
      p.res = Object.fromEntries(Object.keys(p.res).map(r => [r, 0]));
      p.dev = p.dev.map(d => ({ type: 'oculta', turn: d.turn }));
      if (p.progress) p.progress = p.progress.map(() => ({ type: 'oculta' }));
    }
  }
  return {
    t: 'state', G: s, you: seat, host: hostIndex(room),
    conn: room.seats.map(x => x.isAI || x.connected),
  };
}

function broadcastState(room) {
  room.seats.forEach((s, i) => { if (s.ws && s.connected) s.ws.send(stateFor(room, i)); });
}

function sendRoom(room, obj) {
  for (const s of room.seats) if (s.ws && s.connected) s.ws.send(obj);
}

function gameLog(room, html) {
  room.engine.call('log(__args[0])', html);
}

function pnameHtml(room, i) {
  return room.engine.call('pname(__args[0])', i);
}

// Turnos de la IA (y de los jugadores desconectados) en el servidor
function scheduleAI(room) {
  if (!room.engine || room.aiTimer) return;
  const G = getG(room);
  if (!G || G.phase === 'gameover') return;
  if (G.offer) {
    if (!room.offerTimer) {
      room.offerTimer = setTimeout(() => {
        room.offerTimer = null;
        const g = getG(room);
        if (g && g.offer) {
          g.offer.to.slice().forEach(pid => room.engine.call('applyAction(__args[0], __args[1])', pid, { type: 'offer-respond', accept: false }));
          broadcastState(room);
          scheduleAI(room);
        }
      }, OFFER_TIMEOUT);
    }
    return;
  }
  if (room.offerTimer) { clearTimeout(room.offerTimer); room.offerTimer = null; }
  const bot = room.engine.call('(() => { const a = actor(); return a != null && isBot(a); })()');
  if (!bot) return;
  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (!room.engine) return;
    try { room.engine.call('AI.act()'); }
    catch (e) {
      console.error('Error de la IA:', e);
      try { room.engine.call('AI.fallback(actor())'); } catch (e2) { console.error(e2); }
    }
    broadcastState(room);
    scheduleAI(room);
  }, room.options.speed);
}

function startGame(room) {
  const setup = room.seats.map(s => ({ name: s.name, color: s.color, isAI: s.isAI }));
  room.engine = makeEngine();
  const { winPoints, mode5, cutRoads, variants, expansion } = room.options;
  room.engine.call('newGame(__args[0], __args[1])', setup, { winPoints, mode5, cutRoads, variants, expansion });
  room.started = true;
  room.seats.forEach((s, i) => { if (!s.isAI && !s.connected) markAway(room, i, true); });
  broadcastState(room);
  scheduleAI(room);
}

function stopGame(room) {
  clearTimeout(room.aiTimer);
  clearTimeout(room.offerTimer);
  room.aiTimer = room.offerTimer = null;
  room.engine = null;
  room.started = false;
}

// La IA juega por un jugador desconectado (o deja de hacerlo al volver)
function markAway(room, i, away) {
  if (!room.engine) return;
  const G = getG(room);
  const p = G.players[i];
  if (!p || p.away === away) return;
  p.away = away;
  if (away) {
    if (G.trade && G.trade.responses[i] === null) G.trade.responses[i] = 'no';
    if (G.offer && G.offer.to.includes(i)) room.engine.call('applyAction(__args[0], __args[1])', i, { type: 'offer-respond', accept: false });
    gameLog(room, `🔌 ${pnameHtml(room, i)} se ha desconectado: la IA juega en su lugar.`);
  } else {
    gameLog(room, `🔌 ${pnameHtml(room, i)} ha vuelto a la partida.`);
  }
}

function deleteRoom(room) {
  stopGame(room);
  room.seats.forEach(s => clearTimeout(s.dropTimer));
  rooms.delete(room.code);
}

// Quita a un jugador de la sala de espera
function removeFromLobby(room, idx, reason) {
  const [seat] = room.seats.splice(idx, 1);
  if (!seat) return;
  clearTimeout(seat.dropTimer);
  if (seat.ws && seat.ws.room === room) {
    seat.ws.room = null;
    seat.ws.send({ t: 'error', msg: reason || 'Has salido de la sala.', fatal: true });
  }
  if (seat.token === room.hostToken) {
    const next = room.seats.find(s => !s.isAI);
    room.hostToken = next ? next.token : null;
  }
  if (!room.seats.some(s => !s.isAI)) { deleteRoom(room); return; }
  broadcastLobby(room);
}

// ============================ Mensajes ============================
function onMessage(ws, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'create') {
    leaveCurrent(ws);
    const room = {
      code: newCode(), seats: [], hostToken: null, started: false, engine: null,
      options: { winPoints: 10, mode5: 'paired', cutRoads: true, variants: {}, expansion: 'none', speed: 900 }, chat: [], aiTimer: null, offerTimer: null, lastActive: Date.now(),
    };
    rooms.set(room.code, room);
    const seat = addHuman(room, m.name, ws);
    room.hostToken = seat.token;
    console.log(`Sala ${room.code} creada por ${seat.name}`);
    broadcastLobby(room);
    return;
  }
  if (m.t === 'join') {
    const room = rooms.get(String(m.room || '').toUpperCase());
    if (!room) { ws.send({ t: 'error', msg: 'No existe ninguna sala con ese código.' }); return; }
    if (room.started) { ws.send({ t: 'error', msg: 'Esa partida ya ha comenzado.' }); return; }
    if (room.seats.length >= MAX_SEATS) { ws.send({ t: 'error', msg: 'La sala está llena (máximo 6 jugadores).' }); return; }
    if (ws.room === room) return;
    leaveCurrent(ws);
    addHuman(room, m.name, ws);
    broadcastLobby(room);
    return;
  }
  if (m.t === 'rejoin') {
    const room = rooms.get(String(m.room || '').toUpperCase());
    const idx = room ? seatOf(room, m.token) : -1;
    if (!room || idx < 0 || !m.token) { ws.send({ t: 'error', msg: 'La partida anterior ya no está disponible.', fatal: true }); return; }
    const seat = room.seats[idx];
    attach(ws, room, seat);
    if (room.started) {
      clearTimeout(seat.awayTimer);
      markAway(room, idx, false);
      broadcastState(room);
      scheduleAI(room);
    } else broadcastLobby(room);
    return;
  }

  const room = ws.room;
  if (!room) return;
  const idx = seatOf(room, ws.token);
  if (idx < 0) return;
  room.lastActive = Date.now();
  const isHost = ws.token === room.hostToken;

  switch (m.t) {
    case 'chat': {
      const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
      if (!text) return;
      const msg = { t: 'chat', name: room.seats[idx].name, color: room.seats[idx].color, text };
      room.chat.push(msg);
      if (room.chat.length > 50) room.chat.shift();
      sendRoom(room, msg);
      return;
    }
    case 'leave':
      leaveCurrent(ws);
      return;
    case 'action': {
      if (!room.started) return;
      let ok = false;
      try { ok = room.engine.call('applyAction(__args[0], __args[1])', idx, m.action); }
      catch (e) { console.error('Acción con error:', e); }
      if (ok) { broadcastState(room); scheduleAI(room); }
      else ws.send({ t: 'error', msg: 'Acción no permitida.', quiet: true });
      return;
    }
  }

  // Ajustes de la sala de espera
  if (room.started) {
    if (m.t === 'to-lobby' && isHost && getG(room).phase === 'gameover') {
      stopGame(room);
      // Quien se marchó durante la partida deja su puesto libre
      room.seats = room.seats.filter(s => s.isAI || s.connected);
      broadcastLobby(room);
    }
    return;
  }
  switch (m.t) {
    case 'color':
      if (COLORS.includes(m.color) && !room.seats.some((s, i) => i !== idx && s.color === m.color)) room.seats[idx].color = m.color;
      break;
    case 'add-ai':
      if (!isHost || room.seats.length >= MAX_SEATS) return;
      room.seats.push({
        name: AI_NAMES.find(n => !room.seats.some(s => s.name === n)) || 'IA',
        color: freeColor(room), isAI: true, token: crypto.randomUUID(), ws: null, connected: true,
      });
      break;
    case 'remove': {
      const target = Number(m.seat);
      if (!isHost || target === idx || !room.seats[target]) return;
      removeFromLobby(room, target, 'El anfitrión te ha quitado de la sala.');
      return;
    }
    case 'options':
      if (!isHost) return;
      if (Number.isInteger(Number(m.winPoints)) && m.winPoints >= 5 && m.winPoints <= 20) room.options.winPoints = Number(m.winPoints);
      if (['paired', 'special', 'none'].includes(m.mode5)) room.options.mode5 = m.mode5;
      room.options.cutRoads = m.cutRoads !== false;
      room.options.variants = BASE.call('cleanVariants(__args[0])', m.variants);
      room.options.expansion = EXPANSIONS_READY.includes(m.expansion) ? m.expansion : 'none';
      if ([300, 900, 1600].includes(Number(m.speed))) room.options.speed = Number(m.speed);
      break;
    case 'start':
      if (!isHost || room.seats.length < 3) return;
      console.log(`Sala ${room.code}: comienza la partida con ${room.seats.length} jugadores`);
      startGame(room);
      return;
    default:
      return;
  }
  broadcastLobby(room);
}

// Abandono voluntario
function leaveCurrent(ws) {
  const room = ws.room;
  if (!room) return;
  const idx = seatOf(room, ws.token);
  ws.room = null;
  if (idx < 0) return;
  const seat = room.seats[idx];
  if (!room.started) { removeFromLobby(room, idx); return; }
  // En plena partida, la IA ocupa su lugar definitivamente
  seat.ws = null;
  seat.connected = false;
  clearTimeout(seat.awayTimer);
  markAway(room, idx, true);
  if (seat.token === room.hostToken) {
    const next = room.seats.find(s => !s.isAI && s.connected);
    if (next) room.hostToken = next.token;
  }
  broadcastState(room);
  scheduleAI(room);
}

// Desconexión involuntaria (cerrar pestaña, perder la conexión…)
function onDisconnect(ws) {
  const room = ws.room;
  if (!room) return;
  const idx = seatOf(room, ws.token);
  if (idx < 0) return;
  const seat = room.seats[idx];
  if (seat.ws !== ws) return;
  seat.connected = false;
  seat.ws = null;
  if (!room.started) {
    broadcastLobby(room);
    seat.dropTimer = setTimeout(() => {
      const i = room.seats.indexOf(seat);
      if (!room.started && i >= 0 && !seat.connected) removeFromLobby(room, i);
    }, LOBBY_DROP);
    return;
  }
  broadcastState(room);
  seat.awayTimer = setTimeout(() => {
    if (seat.connected || !room.started) return;
    markAway(room, room.seats.indexOf(seat), true);
    broadcastState(room);
    scheduleAI(room);
  }, AWAY_GRACE);
}

// Limpieza de salas abandonadas
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyone = room.seats.some(s => !s.isAI && s.connected);
    if (!anyone && now - room.lastActive > ROOM_IDLE) {
      console.log(`Sala ${room.code} eliminada por inactividad`);
      deleteRoom(room);
    }
  }
}, 5 * 60000);

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const lan = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('');
  console.log('  ⛵ Servidor de Catán en marcha');
  console.log(`  ▸ En este equipo:     http://localhost:${PORT}`);
  lan.forEach(ip => console.log(`  ▸ En tu red local:    http://${ip}:${PORT}`));
  console.log('  ▸ Para jugar por Internet, consulta LEEME.md');
  console.log('');
});

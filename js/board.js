'use strict';
// ---------------------------------------------------------------------------
// Datos estáticos y generación del tablero
// ---------------------------------------------------------------------------

const RES = ['madera', 'arcilla', 'lana', 'trigo', 'mineral'];

const RES_INFO = {
  madera:  { name: 'Madera',  icon: '🪵', color: '#3f7d3a' },
  arcilla: { name: 'Arcilla', icon: '🧱', color: '#c8693c' },
  lana:    { name: 'Lana',    icon: '🐑', color: '#8fbf4d' },
  trigo:   { name: 'Trigo',   icon: '🌾', color: '#e0b43a' },
  mineral: { name: 'Mineral', icon: '🪨', color: '#7d8590' },
};

const TERRAIN = {
  bosque:   { name: 'Bosque',   res: 'madera',  color: '#3f7d3a', dark: '#2d5e2a', icon: '🌲' },
  cerro:    { name: 'Cerro',    res: 'arcilla', color: '#c8693c', dark: '#9c4e2b', icon: '🧱' },
  pasto:    { name: 'Pasto',    res: 'lana',    color: '#a5cf5f', dark: '#7fa843', icon: '🐑' },
  campo:    { name: 'Campo',    res: 'trigo',   color: '#e9c046', dark: '#c39a26', icon: '🌾' },
  montana:  { name: 'Montaña',  res: 'mineral', color: '#8d939c', dark: '#676c74', icon: '⛰️' },
  desierto: { name: 'Desierto', res: null,      color: '#e5d3a1', dark: '#c9b27a', icon: '🌵' },
  oro:      { name: 'Río de oro', res: null,    color: '#9c7a1c', dark: '#6b520f', icon: '💰', gold: true },
  mar:      { name: 'Mar',      res: null,      color: '#2f7fb5', dark: '#22628f', icon: '🌊', sea: true },
};

// Configuración del juego básico (3-4) y de la ampliación (5-6 jugadores)
const CONFIGS = {
  base: {
    id: 'base',
    rows: [3, 4, 5, 4, 3],
    terrains: { bosque: 4, cerro: 3, pasto: 4, campo: 4, montana: 3, desierto: 1 },
    numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    ports: { generic: 4, madera: 1, arcilla: 1, lana: 1, trigo: 1, mineral: 1 },
    dev: { caballero: 14, puntos: 5, carreteras: 2, abundancia: 2, monopolio: 2 },
    bank: 19,
    special: false,
  },
  ext: {
    id: 'ext',
    rows: [3, 4, 5, 6, 5, 4, 3],
    terrains: { bosque: 6, cerro: 5, pasto: 6, campo: 6, montana: 5, desierto: 2 },
    numbers: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
    ports: { generic: 5, madera: 1, arcilla: 1, lana: 2, trigo: 1, mineral: 1 },
    dev: { caballero: 20, puntos: 5, carreteras: 3, abundancia: 3, monopolio: 3 },
    bank: 24,
    special: true,
  },
};

const HEX_R = 60;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pips(n) {
  return n ? 6 - Math.abs(7 - n) : 0;
}

// Crea vértices y aristas compartidos a partir de una lista de hexágonos con x, y
function buildHexGraph(hexes) {
  const R = HEX_R, W = Math.sqrt(3) * R;
  const vertices = [], edges = [];
  const vmap = new Map(), emap = new Map();
  for (const h of hexes) {
    Object.assign(h, { vertices: [], edges: [], neighbors: [] });
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (60 * k - 90);
      const vx = h.x + R * Math.cos(a), vy = h.y + R * Math.sin(a);
      // Las coordenadas de los vértices son múltiplos de W/2 y R/2: clave exacta.
      const key = Math.round(vx / (W / 2)) + ',' + Math.round(vy / (R / 2));
      let v = vmap.get(key);
      if (!v) {
        v = { id: vertices.length, x: vx, y: vy, hexes: [], adj: [], edges: [], building: null, port: null };
        vertices.push(v);
        vmap.set(key, v);
      }
      v.hexes.push(h.id);
      h.vertices.push(v.id);
    }
    for (let k = 0; k < 6; k++) {
      const a = h.vertices[k], b = h.vertices[(k + 1) % 6];
      const key = Math.min(a, b) + '-' + Math.max(a, b);
      let e = emap.get(key);
      if (!e) {
        e = { id: edges.length, v: [a, b], hexes: [], road: null, ship: null };
        edges.push(e);
        emap.set(key, e);
        vertices[a].adj.push(b); vertices[b].adj.push(a);
        vertices[a].edges.push(e.id); vertices[b].edges.push(e.id);
      }
      e.hexes.push(h.id);
      h.edges.push(e.id);
    }
  }
  for (const e of edges) {
    if (e.hexes.length === 2) {
      const [a, b] = e.hexes;
      hexes[a].neighbors.push(b);
      hexes[b].neighbors.push(a);
    }
  }
  return { vertices, edges };
}

// Números: 6 y 8 nunca adyacentes; además se intenta evitar números iguales juntos.
// groups: [[hexágonos, números], ...] — cada grupo baraja sus propios números.
function assignNumbers(hexes, groups) {
  const hot = x => x === 6 || x === 8;
  const all = groups.flatMap(g => g[0]);
  for (let tries = 0; tries < 4000; tries++) {
    for (const [hs, nums] of groups) {
      const sh = shuffle(nums.slice());
      hs.forEach((h, i) => { h.number = sh[i]; });
    }
    const ok = all.every(h => h.neighbors.every(nid => {
      const o = hexes[nid];
      if (!o.number) return true;
      if (hot(h.number) && hot(o.number)) return false;
      if (tries < 2000 && o.number === h.number) return false;
      return true;
    }));
    if (ok) return;
  }
}

// Reparte los puertos de forma uniforme por una costa.
// coast: [{ e, land }] (arista y su hexágono de tierra), ordenada alrededor de (cx, cy)
function placePorts(cfg, hexes, vertices, coast, cx, cy) {
  const R = HEX_R;
  const pts = coast.map(c => {
    const a = vertices[c.e.v[0]], b = vertices[c.e.v[1]];
    return { ...c, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  });
  pts.sort((p, q) => Math.atan2(p.my - cy, p.mx - cx) - Math.atan2(q.my - cy, q.mx - cx));
  const ptypes = [];
  for (const [t, n] of Object.entries(cfg.ports)) for (let i = 0; i < n; i++) ptypes.push(t);
  shuffle(ptypes);
  const step = pts.length / ptypes.length, off = Math.random() * step;
  return ptypes.map((t, i) => {
    const c = pts[Math.floor(off + i * step) % pts.length];
    const h = hexes[c.land];
    const dx = c.mx - h.x, dy = c.my - h.y, d = Math.hypot(dx, dy);
    c.e.v.forEach(vid => { vertices[vid].port = t; });
    return { type: t, edge: c.e.id, x: c.mx + dx / d * R * 0.62, y: c.my + dy / d * R * 0.62 };
  });
}

function generateBoard(cfg) {
  const R = HEX_R, W = Math.sqrt(3) * R;
  const hexes = [];
  const terr = [];
  for (const [t, n] of Object.entries(cfg.terrains)) for (let i = 0; i < n; i++) terr.push(t);
  shuffle(terr);

  const mid = (cfg.rows.length - 1) / 2;
  cfg.rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const id = hexes.length;
      hexes.push({ id, x: (i - (n - 1) / 2) * W, y: (r - mid) * 1.5 * R, terrain: terr[id], number: null, island: 0 });
    }
  });
  const { vertices, edges } = buildHexGraph(hexes);

  const land = hexes.filter(h => h.terrain !== 'desierto');
  assignNumbers(hexes, [[land, cfg.numbers]]);
  const robber = hexes.find(h => h.terrain === 'desierto').id;

  const coast = edges.filter(e => e.hexes.length === 1).map(e => ({ e, land: e.hexes[0] }));
  const ports = placePorts(cfg, hexes, vertices, coast, 0, 0);
  return { hexes, vertices, edges, ports, robber, pirate: null };
}

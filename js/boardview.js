'use strict';
// ---------------------------------------------------------------------------
// Dibujo del tablero en SVG. En vista 3D el tablero se inclina (perspectiva
// 2.5D): las fichas tienen grosor y los árboles, montañas y piezas se dibujan
// de pie. Los datos (G) siguen en coordenadas planas; solo cambia el dibujo.
// ---------------------------------------------------------------------------

const VIEW = { k: 0.66, t: 15, box: null };

function view3d() { return UI.view3d !== false; }

function setViewParams() {
  VIEW.k = view3d() ? 0.66 : 1;
  VIEW.t = view3d() ? 15 : 0;
}

// Proyección: el eje Y se comprime para simular la inclinación
function pr(x, y) { return [x, y * VIEW.k]; }
function f1(n) { return n.toFixed(1); }
function polyStr(pts) { return pts.map(p => f1(p[0]) + ',' + f1(p[1])).join(' '); }

function hexCorners(cx, cy, r) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 180 * (60 * k - 90);
    pts.push(pr(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}

// Aclara (amt > 0) u oscurece (amt < 0) un color hexadecimal
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const mix = c => Math.round((t - c) * p + c);
  const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function seeded(seed) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function computeView() {
  setViewParams();
  const xs = [], ys = [];
  // En Navegantes se encuadra la tierra y una franja de mar alrededor
  const shown = G.seafarers
    ? G.hexes.filter(h => h.terrain !== 'mar' || h.neighbors.some(n => G.hexes[n].terrain !== 'mar'))
    : G.hexes;
  shown.forEach(h => h.vertices.forEach(id => { const v = G.vertices[id]; const p = pr(v.x, v.y); xs.push(p[0]); ys.push(p[1]); }));
  G.ports.forEach(p => { const q = pr(p.x, p.y); xs.push(q[0]); ys.push(q[1]); });
  (G.fishGrounds || []).forEach(p => { const q = pr(p.x, p.y); xs.push(q[0]); ys.push(q[1]); });
  const pad = 30;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad - 30 - 40; // altura de las piezas + espacio para el cartel
  const w = Math.max(...xs) + pad - minX;
  const h = Math.max(...ys) + pad + VIEW.t - minY;
  VIEW.box = [minX, minY, w, h];
  $('#board').setAttribute('viewBox', VIEW.box.map(f1).join(' '));
}

// ============================ Ilustraciones del terreno ============================
const SHADOW = 'rgba(0,0,0,.26)';
function g(x, y, s, body, flip) {
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(${flip ? -s : s},${s})">${body}</g>`;
}

const ART = {
  pine: (x, y, s) => g(x, y, s, `
    <ellipse cy="1" rx="8" ry="2.6" fill="${SHADOW}"/>
    <rect x="-1.6" y="-5" width="3.2" height="6" fill="#5b3a1e"/>
    <path d="M0 -28 L9 -13 L4.5 -13 L11 -3 L-11 -3 L-4.5 -13 L-9 -13 Z" fill="#2f7d3c"/>
    <path d="M0 -28 L9 -13 L4.5 -13 L11 -3 L0 -3 Z" fill="#1d5a29"/>
    <path d="M0 -28 L-4 -20 L-1 -20 Z" fill="#5fb26b"/>`),
  peak: (x, y, s, flip) => g(x, y, s, `
    <ellipse cy="1" rx="20" ry="4" fill="${SHADOW}"/>
    <path d="M-20 0 L-5 -28 L3 -15 L9 -23 L21 0 Z" fill="#9097a0"/>
    <path d="M-5 -28 L1 -12 L-2 0 L21 0 L9 -23 L3 -15 Z" fill="#6b717a"/>
    <path d="M-5 -28 L-9.5 -19.5 L-6 -21 L-3.5 -18 L-1.5 -22.5 Z" fill="#f4f7fb"/>
    <path d="M9 -23 L6.2 -18 L8.5 -19 L11 -17 Z" fill="#f4f7fb"/>`, flip),
  mound: (x, y, s, flip) => g(x, y, s, `
    <ellipse cy="1" rx="17" ry="3.5" fill="${SHADOW}"/>
    <path d="M-17 0 Q-12 -15 -2 -13 Q8 -20 17 0 Z" fill="#c0612f"/>
    <path d="M-2 -13 Q8 -20 17 0 L4 0 Q7 -8 -2 -13 Z" fill="#96441f"/>
    <path d="M-12 -6 Q-8 -11 -3 -10" stroke="#e08a55" stroke-width="1.4" fill="none"/>`, flip),
  bricks: (x, y, s) => {
    let b = `<ellipse cy="1" rx="13" ry="3" fill="${SHADOW}"/>`;
    for (let r = 0; r < 3; r++) {
      const off = r % 2 ? 3.5 : 0;
      for (let i = 0; i < 3 - (r === 2 ? 1 : 0); i++) {
        b += `<rect x="${-10.5 + off + i * 7}" y="${-4.5 - r * 4.5}" width="7" height="4.5" fill="#b44a2a" stroke="#6e2814" stroke-width=".7"/>`;
      }
    }
    return g(x, y, s, b);
  },
  sheep: (x, y, s, flip) => g(x, y, s, `
    <ellipse cy="1" rx="9" ry="2.5" fill="${SHADOW}"/>
    <path d="M-4 0 V-5 M4 0 V-5" stroke="#333" stroke-width="1.7" stroke-linecap="round"/>
    <ellipse cy="-7" rx="8" ry="5.5" fill="#f7f6f0" stroke="#cfcabd" stroke-width=".8"/>
    <circle cx="-5" cy="-10" r="3" fill="#f7f6f0"/><circle cy="-11.5" r="3.3" fill="#fff"/><circle cx="4.5" cy="-10" r="3" fill="#f7f6f0"/>
    <ellipse cx="8.5" cy="-8" rx="3" ry="2.4" fill="#2e2e2e"/>`, flip),
  tuft: (x, y, s) => g(x, y, s, `<path d="M-4 0 L-2.5 -6 M0 0 L0 -8 M4 0 L2.5 -6" stroke="#5c9632" stroke-width="1.7" stroke-linecap="round" fill="none"/>`),
  sheaf: (x, y, s) => {
    let b = `<ellipse cy="1" rx="8" ry="2.4" fill="${SHADOW}"/>`;
    for (let i = -2; i <= 2; i++) {
      const tx = i * 3.2, ty = -19 + Math.abs(i) * 1.5;
      b += `<line x1="0" y1="0" x2="${tx}" y2="${ty}" stroke="#a7790f" stroke-width="1.3"/>
        <ellipse cx="${tx}" cy="${ty - 3}" rx="2" ry="4.6" fill="${i % 2 ? '#e8b52e' : '#f4cd4c'}" transform="rotate(${i * 8} ${tx} ${ty - 3})"/>`;
    }
    return g(x, y, s, b + '<rect x="-3.5" y="-7" width="7" height="2.2" fill="#8a5a12"/>');
  },
  cactus: (x, y, s, flip) => g(x, y, s, `
    <ellipse cy="1" rx="6" ry="2" fill="${SHADOW}"/>
    <path d="M-6 -9 V-14 M6 -12 V-17" stroke="#3f8f50" stroke-width="4" stroke-linecap="round"/>
    <path d="M-6 -9 H-1 M6 -12 H1" stroke="#3f8f50" stroke-width="4" stroke-linecap="round"/>
    <rect x="-2.6" y="-21" width="5.2" height="21" rx="2.6" fill="#4ea35f"/>
    <rect x="0" y="-20" width="2.6" height="19" rx="1.3" fill="#3a7f49"/>`, flip),
  river: (x, y, s) => g(x, y, s, `
    <path d="M-34 -8 Q-18 -18 -4 -6 T26 -4 T44 -14" stroke="#3d93c9" stroke-width="7" fill="none" stroke-linecap="round" opacity=".9"/>
    <path d="M-34 -8 Q-18 -18 -4 -6 T26 -4 T44 -14" stroke="#9fd6f5" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="4 6"/>`),
  goldpile: (x, y, s) => g(x, y, s, `
    <ellipse cy="1" rx="11" ry="3" fill="${SHADOW}"/>
    <ellipse cx="-4" cy="-3" rx="5" ry="3.5" fill="#d9a514" stroke="#8a6200" stroke-width=".8"/>
    <ellipse cx="4" cy="-3" rx="5" ry="3.5" fill="#f2c230" stroke="#8a6200" stroke-width=".8"/>
    <ellipse cx="0" cy="-7.5" rx="5" ry="3.5" fill="#ffd84d" stroke="#8a6200" stroke-width=".8"/>
    <path d="M-1 -10 L1 -12 M3 -9 L5 -10" stroke="#fff7c2" stroke-width="1.2" stroke-linecap="round"/>`),
  ingots: (x, y, s) => g(x, y, s, `
    <ellipse cy="1" rx="12" ry="3" fill="${SHADOW}"/>
    <path d="M-11 0 L-8 -5 H0 L3 0 Z" fill="#e0ad1a" stroke="#8a6200" stroke-width=".8"/>
    <path d="M1 0 L4 -5 H11 L13 0 Z" fill="#f2c230" stroke="#8a6200" stroke-width=".8"/>
    <path d="M-5 -5 L-2 -10 H6 L8 -5 Z" fill="#ffd84d" stroke="#8a6200" stroke-width=".8"/>
    <path d="M-1 -9 H4" stroke="#fff7c2" stroke-width="1"/>`),
  fish: (x, y, s, flip) => g(x, y, s, `
    <path d="M-8 0 Q0 -7 8 0 Q0 7 -8 0 Z" fill="#f2a65a" stroke="#8a4b16" stroke-width=".8"/>
    <path d="M8 0 L13 -4 V4 Z" fill="#f2a65a" stroke="#8a4b16" stroke-width=".8"/><circle cx="-4" cy="-1" r="1" fill="#222"/>`, flip),
  palm: (x, y, s, flip) => g(x, y, s, `
    <ellipse cy="1" rx="8" ry="2.4" fill="${SHADOW}"/>
    <path d="M0 0 Q2 -10 0 -20" stroke="#7a5230" stroke-width="2.4" fill="none"/>
    <path d="M0 -20 Q-9 -24 -13 -16 M0 -20 Q9 -25 13 -16 M0 -20 Q-4 -28 -10 -27 M0 -20 Q5 -29 10 -27" stroke="#2f8a3f" stroke-width="3" fill="none" stroke-linecap="round"/>`, flip),
  castle: (x, y, s) => g(x, y, s, `
    <ellipse cy="2" rx="22" ry="5" fill="${SHADOW}"/>
    <path d="M-18 0 V-16 H-13 V-20 H-9 V-16 H-4 V-20 H4 V-16 H9 V-20 H13 V-16 H18 V0 Z" fill="#c7c9cf" stroke="#3a3a40" stroke-width="1"/>
    <path d="M-6 -16 V-30 H-2 V-26 H2 V-30 H6 V-16 Z" fill="#b3b6bd" stroke="#3a3a40" stroke-width="1"/>
    <path d="M-4 0 V-7 A4 4 0 0 1 4 -7 V0 Z" fill="#4b3a2a"/>
    <path d="M0 -30 V-38 L7 -35 L0 -33" fill="#e03b3b" stroke="#3a3a40" stroke-width=".6"/>`),
  dune: (x, y, s, flip) => g(x, y, s, `
    <path d="M-19 0 Q-7 -10 4 -4 Q12 -9 19 0 Z" fill="#dcc48c"/>
    <path d="M4 -4 Q12 -9 19 0 L9 0 Q8 -3 4 -4 Z" fill="#c8ad6f"/>
    <path d="M-12 -2.5 Q-5 -7 1 -4" stroke="#f3e5bd" stroke-width="1.2" fill="none"/>`, flip),
};

// Posición de las ilustraciones en cada tipo de terreno (coordenadas del hexágono)
const LAYOUT = {
  bosque: [['pine', -30, -12, 1], ['pine', -13, -33, .95], ['pine', 13, -35, 1.05], ['pine', 31, -12, .95],
           ['pine', -36, 20, .9], ['pine', 36, 22, .95], ['pine', -15, 42, .8], ['pine', 16, 43, .85]],
  montana: [['peak', -21, -22, 1.1], ['peak', 22, -27, 1], ['peak', -33, 22, .72], ['peak', 33, 24, .8]],
  cerro: [['mound', -24, -21, 1], ['mound', 24, -24, .9], ['bricks', -32, 24, 1], ['bricks', 31, 26, .9], ['mound', 0, 44, .6]],
  pasto: [['tuft', -36, -4, 1], ['tuft', 37, -2, 1], ['tuft', -6, -42, 1], ['tuft', 12, 42, 1], ['tuft', -24, 34, 1],
          ['sheep', -25, -21, 1], ['sheep', 24, -27, .95], ['sheep', 31, 25, .9]],
  campo: [['sheaf', -31, -13, 1], ['sheaf', -12, -35, .95], ['sheaf', 12, -35, 1], ['sheaf', 31, -13, .95],
          ['sheaf', -33, 23, .9], ['sheaf', 33, 25, .9], ['sheaf', 0, 44, .75]],
  oro: [['river', -4, -14, 1], ['goldpile', -24, -20, 1], ['goldpile', 24, -24, .9], ['ingots', -30, 22, 1], ['ingots', 30, 24, .9], ['goldpile', 0, 44, .7]],
  mar: [],
  lago: [['fish', -18, -22, 1], ['fish', 20, -26, .9], ['fish', -26, 24, .9], ['fish', 24, 26, 1]],
  oasis: [['palm', -24, -18, 1], ['palm', 24, -22, 1.1], ['palm', -28, 22, .9], ['palm', 26, 24, 1], ['dune', 0, 40, .7]],
  castillo: [['castle', 0, -6, 1.3]],
  desierto: [['dune', -20, -22, 1], ['dune', 22, 26, 1.1], ['cactus', 22, -22, 1], ['cactus', -25, 24, .9], ['dune', -30, 6, .7]],
};

// ============================ Piezas ============================
function settlementSvg(x, y, c) {
  const d = shade(c, -.3), l = shade(c, .25), roof = shade(c, -.45);
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(1.2)" class="piece">
    <ellipse cy="3" rx="13" ry="4.5" fill="rgba(0,0,0,.35)"/>
    <path d="M-9 4 H3 V-6 H-9 Z" fill="${c}"/>
    <path d="M3 4 L9 0 V-10 L3 -6 Z" fill="${d}"/>
    <path d="M-9 -6 L3 -6 L-3 -15 Z" fill="${l}"/>
    <path d="M-3 -15 L3 -6 L9 -10 L3 -19 Z" fill="${roof}"/>
    <rect x="-5" y="-2" width="3.5" height="6" fill="${shade(c, -.55)}"/>
    <path d="M-9 4 H3 L9 0 V-10 L3 -19 L-3 -15 L-9 -6 Z" fill="none" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/>
  </g>`;
}

function citySvg(x, y, c, metro) {
  const d = shade(c, -.3), l = shade(c, .25), roof = shade(c, -.45);
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(1.2)" class="piece">
    <ellipse cy="4" rx="17" ry="5.5" fill="rgba(0,0,0,.35)"/>
    <path d="M-14 6 H4 V-4 H-14 Z" fill="${c}"/>
    <path d="M4 6 L11 2 V-8 L4 -4 Z" fill="${d}"/>
    <path d="M-14 -4 H4 L11 -8 H-7 Z" fill="${l}"/>
    <path d="M-12 -4 H-3 V-19 H-12 Z" fill="${shade(c, .1)}"/>
    <path d="M-3 -4 L1 -6.5 V-21.5 L-3 -19 Z" fill="${d}"/>
    <path d="M-12 -19 H-3 L-7.5 -29 Z" fill="${l}"/>
    <path d="M-3 -19 L1 -21.5 L-7.5 -29 Z" fill="${roof}"/>
    <rect x="-9" y="-15" width="3" height="4" fill="${shade(c, -.55)}"/>
    <rect x="-2" y="0" width="3" height="5" fill="${shade(c, -.55)}"/>
    <path d="M-14 6 H4 L11 2 V-8 L1 -8 V-21.5 L-7.5 -29 L-12 -19 V-4 H-14 Z" fill="none" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/>
    ${metro ? `<path d="M-7.5 -29 V-40 L2 -37 L-7.5 -34" fill="${TRACKS[metro].color}" stroke="#111" stroke-width=".8"/>
      <circle cx="-7.5" cy="-29" r="2.5" fill="#ffe27a" stroke="#111" stroke-width=".6"/>` : ''}
  </g>`;
}

function shipSvg(x, y, c, cls = 'piece') {
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(1.1)" class="${cls}">
    <ellipse cy="5" rx="12" ry="3" fill="rgba(0,0,0,.3)"/>
    <path d="M-12 0 H12 L8 6 H-8 Z" fill="${shade(c, -.35)}" stroke="#111" stroke-width="1" stroke-linejoin="round"/>
    <line x1="0" y1="0" x2="0" y2="-19" stroke="#3b2a12" stroke-width="1.6"/>
    <path d="M1.2 -18 L11 -3 H1.2 Z" fill="${c}" stroke="#111" stroke-width=".8" stroke-linejoin="round"/>
    <path d="M-1.2 -14 L-8 -3 H-1.2 Z" fill="${shade(c, .3)}" stroke="#111" stroke-width=".8" stroke-linejoin="round"/>
  </g>`;
}

function pirateSvg(x, y) {
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(1.35)" class="robber">
    <ellipse cy="6" rx="15" ry="3.5" fill="rgba(0,0,0,.35)"/>
    <path d="M-14 0 H14 L9 7 H-9 Z" fill="#2b2118" stroke="#000" stroke-width="1"/>
    <line x1="0" y1="0" x2="0" y2="-22" stroke="#1a120b" stroke-width="1.8"/>
    <path d="M1.2 -20 L12 -4 H1.2 Z" fill="#2d2d33" stroke="#000" stroke-width=".8"/>
    <path d="M-1.2 -17 L-10 -4 H-1.2 Z" fill="#3c3c44" stroke="#000" stroke-width=".8"/>
    <path d="M0 -22 H-8 V-17 H0 Z" fill="#111"/>
    <circle cx="-4" cy="-19.8" r="1.4" fill="#fff"/>
    <title>Pirata</title></g>`;
}

function knightSvg(x, y, c, level, active) {
  const bars = Array.from({ length: level }, (_, i) => `<rect x="${-5 + i * 4}" y="-2" width="2.4" height="5" fill="${active ? '#fff' : '#ddd'}"/>`).join('');
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(1.05)" class="piece knight ${active ? 'active' : 'inactive'}">
    <ellipse cy="5" rx="10" ry="3.5" fill="rgba(0,0,0,.35)"/>
    <path d="M-9 -12 H9 V-2 C9 4 4 7 0 9 C-4 7 -9 4 -9 -2 Z" fill="${active ? c : shade(c, -.25)}" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M-9 -12 H0 V9 C-4 7 -9 4 -9 -2 Z" fill="rgba(255,255,255,.18)"/>
    ${bars}
    ${active ? '<path d="M0 -12 V-22 L8 -19 L0 -16" fill="#ffe27a" stroke="#6b520f" stroke-width=".8"/>' : '<circle cx="0" cy="-16" r="3" fill="#666" stroke="#222" stroke-width=".8"/>'}
  </g>`;
}

function wallSvg(x, y) {
  return `<g transform="translate(${f1(x)},${f1(y)})" class="piece">
    <ellipse cy="7" rx="22" ry="8" fill="#7d7d84" stroke="#3a3a40" stroke-width="1.2"/>
    <ellipse cy="5" rx="22" ry="8" fill="#a3a3aa" stroke="#3a3a40" stroke-width="1.2"/>
    ${[-18, -9, 0, 9, 18].map(dx => `<rect x="${dx - 2.5}" y="${3 - Math.abs(dx) / 6}" width="5" height="4" fill="#8b8b92" stroke="#3a3a40" stroke-width=".6"/>`).join('')}
  </g>`;
}

function merchantSvg(x, y, c) {
  return `<g transform="translate(${f1(x)},${f1(y)})" class="robber">
    <ellipse cy="2" rx="9" ry="3.5" fill="rgba(0,0,0,.35)"/>
    <path d="M-7 2 C-7 -6 -4 -9 0 -9 C4 -9 7 -6 7 2 Z" fill="${c}" stroke="#111" stroke-width="1"/>
    <circle cy="-13" r="5" fill="#f1c9a0" stroke="#111" stroke-width="1"/>
    <path d="M-6 -16 H6 L4 -21 H-4 Z" fill="#3b2a12"/>
    <title>Mercader</title></g>`;
}

function robberSvg(x, y) {
  return `<g transform="translate(${f1(x)},${f1(y)})" class="robber">
    <ellipse cy="2" rx="11" ry="4" fill="rgba(0,0,0,.4)"/>
    <path d="M-9 2 C-10 -8 -6 -13 -4 -15 C-7 -17 -7 -24 0 -25 C7 -24 7 -17 4 -15 C6 -13 10 -8 9 2 Z" fill="url(#robberGrad)" stroke="#0d0d10" stroke-width="1.1"/>
    <ellipse cx="-3" cy="-20" rx="2" ry="3" fill="rgba(255,255,255,.25)"/>
    <title>Ladrón</title></g>`;
}

// ============================ Tablero ============================
function renderBoard() {
  setViewParams();
  const a = humanActor();
  let vT = [], eT = [], cT = [], sT = [], msT = [], hT = false, kT = [], pick = null;
  if (a != null && G.pending && G.pending.pid === a && ['hex', 'vertex', 'edge'].includes(G.pending.kind)) pick = G.pending;
  else if (a != null && G.ck && canBuildNow(a) && G.phase === 'main') {
    if (UI.mode === 'caballero') kT = knightSpots(a);
    else if (UI.mode === 'ascender') kT = knightsOf(a).filter(v => canPromote(a, v));
    else if (UI.mode === 'activar') kT = knightsOf(a).filter(v => !G.vertices[v].knight.active);
    else if (UI.mode === 'mover-cab') kT = UI.knightFrom == null ? knightsOf(a).filter(v => knightMoveTargets(a, v).length) : knightMoveTargets(a, UI.knightFrom);
    else if (UI.mode === 'expulsar') kT = chaseRobberSpots(a);
    else if (UI.mode === 'muralla') kT = wallSpots(a);
  }
  if (a != null && !pick) {
    const me = P(a);
    if (G.phase === 'setup-settlement') vT = settlementSpots(a, true);
    else if (G.phase === 'setup-road') { eT = roadSpots(a, G.lastSettlement); sT = shipSpots(a, G.lastSettlement); }
    else if (G.phase === 'road-building') { eT = me.roads > 0 ? roadSpots(a) : []; sT = me.ships > 0 ? shipSpots(a) : []; }
    else if (G.phase === 'robber') hT = true;
    else if (canBuildNow(a)) {
      if (UI.mode === 'camino') eT = roadSpots(a);
      else if (UI.mode === 'poblado') vT = settlementSpots(a, false);
      else if (UI.mode === 'ciudad') cT = citySpots(a);
      else if (UI.mode === 'barco') sT = shipSpots(a);
      else if (UI.mode === 'mover') {
        if (UI.moveFrom == null) msT = movableShips(a);
        else sT = shipMoveTargets(a, UI.moveFrom);
      }
    }
  }
  const K = VIEW.k, T = VIEW.t, is3d = view3d();
  const rolled = G.dice && G.phase !== 'setup-settlement' ? G.dice[0] + G.dice[1] : null;
  const out = [];

  // --- Definiciones: degradados y texturas ---
  let defs = `
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity=".45"/></filter>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="tokenGrad" cx="40%" cy="30%" r="75%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#e6d3a5"/></radialGradient>
    <radialGradient id="robberGrad" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="#6a6a78"/><stop offset="1" stop-color="#22222a"/></radialGradient>
    <linearGradient id="sandTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3e3b3"/><stop offset="1" stop-color="#e0c88e"/></linearGradient>
    <pattern id="waves" width="80" height="44" patternUnits="userSpaceOnUse">
      <path d="M0 22 Q10 15 20 22 T40 22" stroke="rgba(255,255,255,.16)" stroke-width="2" fill="none"/>
      <path d="M40 0 Q50 -7 60 0 T80 0 M40 44 Q50 37 60 44 T80 44" stroke="rgba(255,255,255,.12)" stroke-width="2" fill="none"/>
    </pattern>
    <pattern id="tex-bosque" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.6" fill="#1f4f24"/><circle cx="8" cy="7" r="1.2" fill="#2e6b33"/></pattern>
    <pattern id="tex-cerro" width="14" height="10" patternUnits="userSpaceOnUse"><path d="M1 4 L5 3 L8 6 M9 9 L13 8" stroke="#8f3f1c" stroke-width="1" fill="none"/></pattern>
    <pattern id="tex-pasto" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M2 7 L3 4 M6 8 L6.5 5" stroke="#6ea33f" stroke-width="1.1"/></pattern>
    <pattern id="tex-campo" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)"><rect width="9" height="3.5" fill="#f3d26a"/></pattern>
    <pattern id="tex-montana" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="4" r="1.5" fill="#5d636b"/><circle cx="9" cy="9" r="1" fill="#babfc6"/></pattern>
    <pattern id="tex-oro" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M3 3 l1 2 l2 1 l-2 1 l-1 2 l-1 -2 l-2 -1 l2 -1 Z" fill="#fff3b0"/><circle cx="10" cy="10" r="1" fill="#fff3b0"/></pattern>
    <pattern id="tex-lago" width="20" height="10" patternUnits="userSpaceOnUse"><path d="M0 5 Q5 2 10 5 T20 5" stroke="#9fd3f2" stroke-width="1" fill="none"/></pattern>
    <pattern id="tex-oasis" width="22" height="10" patternUnits="userSpaceOnUse"><path d="M0 6 Q5.5 2 11 6 T22 6" stroke="#c9ad6a" stroke-width="1.1" fill="none"/></pattern>
    <pattern id="tex-castillo" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M0 0 H12 M0 4 H12 M6 0 V4 M0 4 V8" stroke="#80858d" stroke-width=".8"/></pattern>
    <pattern id="tex-mar" width="20" height="10" patternUnits="userSpaceOnUse"><path d="M0 5 Q5 2 10 5 T20 5" stroke="#9fd3f2" stroke-width="1" fill="none"/></pattern>
    <pattern id="tex-desierto" width="22" height="10" patternUnits="userSpaceOnUse"><path d="M0 6 Q5.5 2 11 6 T22 6" stroke="#cdb37a" stroke-width="1.1" fill="none"/></pattern>`;
  for (const [id, t] of Object.entries(TERRAIN)) {
    defs += `<linearGradient id="top-${id}" x1="0" y1="0" x2=".35" y2="1">
      <stop offset="0" stop-color="${shade(t.color, .18)}"/><stop offset=".6" stop-color="${t.color}"/><stop offset="1" stop-color="${shade(t.color, -.12)}"/></linearGradient>`;
  }
  out.push(`<defs>${defs}</defs>`);
  const [bx, by, bw, bh] = VIEW.box;
  out.push(`<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="url(#waves)"/>`);

  // --- Puertos: muelle de madera hacia la costa ---
  for (const p of G.ports) {
    const [px, py] = pr(p.x, p.y);
    for (const vid of G.edges[p.edge].v) {
      const v = G.vertices[vid];
      const [vx, vy] = pr(v.x, v.y);
      out.push(`<line x1="${f1(vx)}" y1="${f1(vy)}" x2="${f1(px)}" y2="${f1(py)}" class="dock"/>
        <line x1="${f1(vx)}" y1="${f1(vy)}" x2="${f1(px)}" y2="${f1(py)}" class="dock-planks"/>`);
    }
    const generic = p.type === 'generic';
    out.push(`<g class="port" transform="translate(${f1(px)},${f1(py)})">
      <ellipse cy="${is3d ? 15 : 17}" rx="16" ry="${is3d ? 4 : 3}" fill="rgba(0,0,0,.25)"/>
      <circle r="18" class="port-bg" ${generic ? '' : `style="stroke:${RES_INFO[p.type].color}"`}/>
      <text y="-2" class="port-icon">${generic ? '⚓' : RES_INFO[p.type].icon}</text>
      <text y="12" class="port-rate">${generic ? '3:1' : '2:1'}</text>
      <title>${generic ? 'Puerto 3:1: cambia 3 cartas iguales por 1' : `Puerto 2:1 de ${RES_INFO[p.type].name.toLowerCase()}`}</title>
    </g>`);
  }

  const byY = G.hexes.filter(h => h.terrain !== 'mar').sort((p, q) => p.y - q.y);
  for (const h of G.hexes) {
    if (h.terrain !== 'mar') continue;
    out.push(`<polygon points="${polyStr(hexCorners(h.x, h.y, HEX_R - 1))}" class="sea-hex"/>`);
  }

  // --- Base de arena con grosor (el «marco» de la isla) ---
  for (const h of byY) {
    const c = hexCorners(h.x, h.y, HEX_R + 1.5);
    if (T) {
      // Caras laterales visibles: las dos aristas inferiores
      const down = p => [p[0], p[1] + T];
      out.push(`<polygon points="${polyStr([c[2], c[3], down(c[3]), down(c[2])])}" fill="#8c6a3f"/>
        <polygon points="${polyStr([c[3], c[4], down(c[4]), down(c[3])])}" fill="#a98251"/>`);
    }
    out.push(`<polygon points="${polyStr(c)}" fill="url(#sandTop)"/>`);
  }

  // --- Superficie de cada terreno ---
  for (const h of byY) {
    const t = TERRAIN[h.terrain];
    const c = polyStr(hexCorners(h.x, h.y, HEX_R - 4));
    out.push(`<polygon points="${c}" fill="url(#top-${h.terrain})" stroke="${t.dark}" stroke-width="1.5"/>
      <polygon points="${c}" fill="url(#tex-${h.terrain})" opacity=".35"/>`);
    if (rolled && h.number === rolled) {
      out.push(`<polygon points="${polyStr(hexCorners(h.x, h.y, HEX_R - 6))}" class="${h.id === G.robber ? 'rolled blocked' : 'rolled'}"/>`);
    }
  }

  // --- Ríos y caladeros (Mercaderes y Bárbaros) ---
  if (G.tb === 'rios') {
    for (const e of G.edges) {
      if (!e.river) continue;
      const [a1, b1] = e.v.map(id => G.vertices[id]);
      const p1 = pr(a1.x, a1.y), p2 = pr(b1.x, b1.y);
      out.push(`<line x1="${f1(p1[0])}" y1="${f1(p1[1])}" x2="${f1(p2[0])}" y2="${f1(p2[1])}" class="river"/>
        <line x1="${f1(p1[0])}" y1="${f1(p1[1])}" x2="${f1(p2[0])}" y2="${f1(p2[1])}" class="river-hi"/>`);
    }
  }
  if (G.tb === 'pescadores') {
    for (const fg of G.fishGrounds) {
      const [px, py] = pr(fg.x, fg.y);
      for (const vid of G.edges[fg.edge].v) {
        const [vx, vy] = pr(G.vertices[vid].x, G.vertices[vid].y);
        out.push(`<line x1="${f1(vx)}" y1="${f1(vy)}" x2="${f1(px)}" y2="${f1(py)}" class="net-line"/>`);
      }
      out.push(`<g class="fishground" transform="translate(${f1(px)},${f1(py)})"><circle r="16"/><text y="-2" class="fg-ic">🐟</text><text y="11" class="fg-num">${fg.number}</text><title>Caladero: pesca con ${fg.number}</title></g>`);
    }
  }

  // --- Ilustraciones (de atrás hacia delante) ---
  const deco = [];
  for (const h of G.hexes) {
    const rnd = seeded(h.id + 1);
    for (const [kind, dx, dy, s] of LAYOUT[h.terrain]) {
      const jx = (rnd() - .5) * 6, jy = (rnd() - .5) * 6;
      const [x, y] = pr(h.x + dx + jx, h.y + dy + jy);
      deco.push({ y, svg: ART[kind](x, y, s * (is3d ? 1 : .9), rnd() < .5) });
    }
  }
  deco.sort((p, q) => p.y - q.y).forEach(d => out.push(d.svg));

  // --- Fichas de número (tumbadas sobre el tablero en 3D) ---
  for (const h of G.hexes) {
    if (!h.number) continue;
    const hot = h.number === 6 || h.number === 8;
    const [x, y] = pr(h.x, h.y + 4);
    const rx = 19, ry = 19 * K, th = is3d ? 3 : 1.5;
    out.push(`<g class="token-g ${h.id === G.robber ? 'robbed' : ''}">
      <ellipse cx="${f1(x)}" cy="${f1(y + th)}" rx="${rx}" ry="${f1(ry)}" fill="#a88a55"/>
      <ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${rx}" ry="${f1(ry)}" fill="url(#tokenGrad)" class="token"/>
      <text x="${f1(x)}" y="${f1(y + (is3d ? 3 : 4))}" class="num ${hot ? 'hot' : ''} ${is3d ? 'flat' : ''}">${h.number}</text>
      <text x="${f1(x)}" y="${f1(y + (is3d ? 10 : 13))}" class="pips ${hot ? 'hot' : ''} ${is3d ? 'flat' : ''}">${'•'.repeat(pips(h.number))}</text>
      <title>${hexName(h)}</title></g>`);
  }

  if (G.tb === 'pescadores' && G.lake != null) {
    const lh = G.hexes[G.lake];
    const [x, y] = pr(lh.x, lh.y + 4);
    out.push(`<g class="token-g"><ellipse cx="${f1(x)}" cy="${f1(y)}" rx="24" ry="${f1(14 * K + 4)}" fill="url(#tokenGrad)" class="token"/>
      <text x="${f1(x)}" y="${f1(y + 4)}" class="num lake-num">2·3·11·12</text><title>Lago: pesca con 2, 3, 11 y 12</title></g>`);
  }
  if (G.tb === 'barbaros') {
    for (const h of G.hexes) {
      if (h.conquered) out.push(`<polygon points="${polyStr(hexCorners(h.x, h.y, HEX_R - 5))}" class="conquered"/>`);
    }
  }

  // --- Caminos ---
  for (const e of G.edges) {
    if (e.road === null) continue;
    const [a1, b1] = e.v.map(id => G.vertices[id]);
    const p1 = pr(a1.x + (b1.x - a1.x) * .16, a1.y + (b1.y - a1.y) * .16);
    const p2 = pr(b1.x + (a1.x - b1.x) * .16, b1.y + (a1.y - b1.y) * .16);
    const c = P(e.road).color;
    const line = (dy, cls, extra) => `<line x1="${f1(p1[0])}" y1="${f1(p1[1] + dy)}" x2="${f1(p2[0])}" y2="${f1(p2[1] + dy)}" class="${cls}" ${extra}/>`;
    if (e.bridge) out.push(line(5, 'bridge-base', '') + line(-3, 'bridge-rail', ''));
    out.push(line(3.5, 'road-shadow', '') + line(2, 'road-side', `stroke="${shade(c, -.45)}"`) +
      line(0, 'road', `stroke="${c}"`) + line(-1.2, 'road-hi', `stroke="${shade(c, .35)}"`));
  }
  for (const eid of eT) {
    const [a1, b1] = G.edges[eid].v.map(id => G.vertices[id]);
    const p1 = pr(a1.x, a1.y), p2 = pr(b1.x, b1.y);
    out.push(`<line x1="${f1(p1[0])}" y1="${f1(p1[1])}" x2="${f1(p2[0])}" y2="${f1(p2[1])}" class="edge-target" data-e="${eid}"/>`);
  }

  // --- Ladrón y edificios, de atrás hacia delante ---
  const pieces = [];
  for (const e of G.edges) {
    if (e.ship == null) continue;
    const [a1, b1] = e.v.map(id => G.vertices[id]);
    const [x, y] = pr((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
    pieces.push({ y, svg: shipSvg(x, y + 3, P(e.ship).color) + `<title>Barco de ${esc(P(e.ship).name)}</title>` });
  }
  if (G.pirate != null) {
    const ph = G.hexes[G.pirate];
    const [x, y] = pr(ph.x, ph.y);
    pieces.push({ y, svg: pirateSvg(x, y + 6) });
  }
  const rh = G.hexes[G.robber];
  const [rx, ry] = pr(rh.x - (rh.number ? 33 : 0), rh.y + (rh.number ? 8 : 4));
  pieces.push({ y: ry, svg: robberSvg(rx, ry) });
  for (const v of G.vertices) {
    const [x, y] = pr(v.x, v.y);
    if (v.knight) {
      const k = v.knight;
      pieces.push({ y, svg: knightSvg(x, y, P(k.owner).color, k.level, k.active) +
        `<title>${KNIGHT_NAMES[k.level]} de ${esc(P(k.owner).name)} (${k.active ? 'activo' : 'inactivo'})</title>` });
    }
    if (!v.building) continue;
    const c = P(v.building.owner).color;
    const wall = v.building.wall ? wallSvg(x, y) : '';
    const name = v.building.metro ? `metrópolis de ${TRACKS[v.building.metro].name.toLowerCase()}` : v.building.type + (v.building.wall ? ' con muralla' : '');
    pieces.push({ y, svg: wall + (v.building.type === 'ciudad' ? citySvg(x, y, c, v.building.metro) : settlementSvg(x, y, c)) + `<title>${esc(P(v.building.owner).name)}: ${name}</title>` });
  }
  if (G.tb === 'caravanas') {
    for (const e of G.edges) {
      if (!e.camel) continue;
      const [a1, b1] = e.v.map(id => G.vertices[id]);
      const [x, y] = pr((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
      pieces.push({ y, svg: `<text x="${f1(x)}" y="${f1(y + 2)}" class="camel">🐪</text>` });
    }
  }
  if (G.tb === 'barbaros') {
    for (const h of G.hexes) {
      for (let i = 0; i < (h.barbs || 0); i++) {
        const [x, y] = pr(h.x - 16 + i * 16, h.y + 30);
        pieces.push({ y, svg: `<g transform="translate(${f1(x)},${f1(y)})" class="robber"><ellipse cy="2" rx="7" ry="2.5" fill="rgba(0,0,0,.4)"/>
          <path d="M-6 2 C-6 -6 -3 -8 0 -8 C3 -8 6 -6 6 2 Z" fill="#5a2a1a" stroke="#111"/><circle cy="-11" r="4" fill="#5a2a1a" stroke="#111"/>
          <path d="M-5 -14 L-7 -18 M5 -14 L7 -18" stroke="#ddd" stroke-width="1.5"/><title>Bárbaro</title></g>` });
      }
    }
    for (const k of G.bknights) {
      const [a1, b1] = G.edges[k.edge].v.map(id => G.vertices[id]);
      const [x, y] = pr((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
      pieces.push({ y, svg: knightSvg(x, y, P(k.owner).color, 1, true) + `<title>Caballero de ${esc(P(k.owner).name)} (${k.mp} pasos)</title>` });
    }
  }
  if (G.ck && G.merchant) {
    const mh = G.hexes[G.merchant.hex];
    const [x, y] = pr(mh.x + 30, mh.y + 6);
    pieces.push({ y, svg: merchantSvg(x, y, P(G.merchant.owner).color) });
  }
  pieces.sort((p, q) => p.y - q.y).forEach(p => out.push(p.svg));

  // --- Zonas donde se puede hacer clic ---
  for (const vid of vT) {
    const [x, y] = pr(G.vertices[vid].x, G.vertices[vid].y);
    out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="10" class="v-target" data-v="${vid}"/>`);
  }
  for (const vid of cT) {
    const [x, y] = pr(G.vertices[vid].x, G.vertices[vid].y);
    out.push(`<ellipse cx="${f1(x)}" cy="${f1(y - 6)}" rx="20" ry="20" class="v-target city" data-v="${vid}"/>`);
  }
  for (const eid of sT) {
    const e = G.edges[eid];
    const [a1, b1] = e.v.map(id => G.vertices[id]);
    let mx = (a1.x + b1.x) / 2, my = (a1.y + b1.y) / 2;
    const seaHex = e.hexes.map(id => G.hexes[id]).find(h => h.terrain === 'mar');
    if (seaHex && e.land) { mx += (seaHex.x - mx) * .28; my += (seaHex.y - my) * .28; }
    const [x, y] = pr(mx, my);
    out.push(`<g class="ship-target" data-s="${eid}"><circle cx="${f1(x)}" cy="${f1(y)}" r="11"/><text x="${f1(x)}" y="${f1(y + 4)}">⛵</text><title>Construir un barco aquí</title></g>`);
  }
  for (const eid of msT) {
    const [a1, b1] = G.edges[eid].v.map(id => G.vertices[id]);
    const [x, y] = pr((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
    out.push(`<circle cx="${f1(x)}" cy="${f1(y - 5)}" r="15" class="v-target ship-pick" data-ms="${eid}"><title>Mover este barco</title></circle>`);
  }
  if (UI.mode === 'mover' && UI.moveFrom != null && G.edges[UI.moveFrom]) {
    const [a1, b1] = G.edges[UI.moveFrom].v.map(id => G.vertices[id]);
    const [x, y] = pr((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
    out.push(`<circle cx="${f1(x)}" cy="${f1(y - 5)}" r="16" class="ship-selected"/>`);
  }
  if (a != null && !pick && G.tb && G.phase === 'main' && a === G.current) {
    if (UI.mode === 'puente') {
      for (const eid of bridgeSpots(a)) {
        const [a1, b1] = G.edges[eid].v.map(id => G.vertices[id]);
        const p1 = pr(a1.x, a1.y), p2 = pr(b1.x, b1.y);
        out.push(`<line x1="${f1(p1[0])}" y1="${f1(p1[1])}" x2="${f1(p2[0])}" y2="${f1(p2[1])}" class="edge-target" data-b="${eid}"/>`);
      }
    }
    if (UI.mode === 'bk' || UI.mode === 'bk-boost') {
      const list = UI.mode === 'bk-boost' ? G.bknights.filter(k => k.owner === a && !k.boosted).map(k => k.edge)
        : UI.bkFrom == null ? G.bknights.filter(k => k.owner === a && bkMoveTargets(a, k.edge).length).map(k => k.edge)
        : bkMoveTargets(a, UI.bkFrom);
      for (const eid of list) {
        const [a1, b1] = G.edges[eid].v.map(id => G.vertices[id]);
        const [x, y] = pr((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
        out.push(`<circle cx="${f1(x)}" cy="${f1(y - 4)}" r="11" class="v-target knight-target" data-bk="${eid}"/>`);
      }
    }
  }
  for (const vid of kT) {
    const [x, y] = pr(G.vertices[vid].x, G.vertices[vid].y);
    out.push(`<circle cx="${f1(x)}" cy="${f1(y - 4)}" r="13" class="v-target knight-target ${UI.knightFrom === vid ? 'chosen' : ''}" data-kv="${vid}"/>`);
  }
  if (pick) {
    for (const o of pick.options) {
      if (pick.kind === 'hex') {
        const h = G.hexes[o];
        out.push(`<polygon points="${polyStr(hexCorners(h.x, h.y, HEX_R - 4))}" class="hex-hit" data-pick="${o}"><title>${hexName(h)}</title></polygon>`);
      } else if (pick.kind === 'vertex') {
        const [x, y] = pr(G.vertices[o].x, G.vertices[o].y);
        out.push(`<circle cx="${f1(x)}" cy="${f1(y - 4)}" r="14" class="v-target knight-target" data-pick="${o}"/>`);
      } else {
        const [a1, b1] = G.edges[o].v.map(id => G.vertices[id]);
        const p1 = pr(a1.x, a1.y), p2 = pr(b1.x, b1.y);
        out.push(`<line x1="${f1(p1[0])}" y1="${f1(p1[1])}" x2="${f1(p2[0])}" y2="${f1(p2[1])}" class="edge-target" data-pick="${o}"/>`);
      }
    }
  }
  if (hT) {
    for (const h of G.hexes) {
      if (G.seafarers && pirateAllowed(h.id)) {
        out.push(`<polygon points="${polyStr(hexCorners(h.x, h.y, HEX_R - 4))}" class="hex-hit pirate-hit" data-h="${h.id}"><title>Mover el pirata aquí</title></polygon>`);
        continue;
      }
      if (!robberAllowed(h.id, a)) continue;
      out.push(`<polygon points="${polyStr(hexCorners(h.x, h.y, HEX_R - 4))}" class="hex-hit" data-h="${h.id}"><title>${hexName(h)}</title></polygon>`);
    }
  }
  $('#board').innerHTML = out.join('');
}

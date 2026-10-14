'use strict';
// ---------------------------------------------------------------------------
// Jugadores controlados por la IA
// ---------------------------------------------------------------------------

const AI_WEIGHT = { madera: 1.05, arcilla: 1.05, lana: 0.9, trigo: 1.05, mineral: 1.0 };

const AI = {
  production(pid) {
    const prod = zeroRes();
    for (const v of G.vertices) {
      if (!v.building || v.building.owner !== pid) continue;
      const m = v.building.type === 'ciudad' ? 2 : 1;
      for (const hid of v.hexes) {
        const h = G.hexes[hid], r = TERRAIN[h.terrain].res;
        if (r) prod[r] += pips(h.number) * m;
      }
    }
    return prod;
  },

  scoreVertex(pid, vid, prod) {
    const v = G.vertices[vid];
    prod = prod || AI.production(pid);
    const types = new Set();
    let s = 0;
    for (const hid of v.hexes) {
      const h = G.hexes[hid], r = TERRAIN[h.terrain].res;
      if (TERRAIN[h.terrain].gold) { s += pips(h.number) * 1.25 * (hid === G.robber ? 0.5 : 1); continue; }
      if (!r) continue;
      s += pips(h.number) * AI_WEIGHT[r] * (hid === G.robber ? 0.5 : 1);
      if (!prod[r] && !types.has(r)) s += 1.5;
      types.add(r);
    }
    s += types.size * 0.6;
    if (G.seafarers && v.island > 0 && !P(pid).islands.includes(v.island)) s += 5;
    if (v.port) {
      if (v.port === 'generic') s += 1.2;
      else s += (prod[v.port] || 0) >= 5 ? 2.5 : 0.5;
    }
    return s;
  },

  cityValue(vid) {
    return G.vertices[vid].hexes.reduce((s, hid) => {
      const h = G.hexes[hid];
      if (!TERRAIN[h.terrain].res || hid === G.robber) return s;
      return s + pips(h.number) * (TERRAIN[h.terrain].res === 'mineral' || TERRAIN[h.terrain].res === 'trigo' ? 1.15 : 1);
    }, 0);
  },

  missing(res, cost) {
    return RES.reduce((s, r) => s + Math.max(0, (cost[r] || 0) - res[r]), 0);
  },

  // Busca el mejor lugar para un poblado accesible con caminos (y barcos en Navegantes).
  // Devuelve { edge, kind: 'r' | 's', score, v, d }: la primera pieza a construir.
  roadTarget(pid, starts) {
    const p = P(pid);
    const canR = p.roads > 0, canS = !!G.seafarers && p.ships > 0;
    if (!canR && !canS) return null;
    const prod = AI.production(pid);
    const seen = new Set(), q = [];
    const push = (v, mode, first, kind, d) => {
      const key = v + mode;
      if (seen.has(key)) return;
      seen.add(key);
      q.push({ v, mode, first, kind, d });
    };
    if (!starts) {
      for (const v of G.vertices) {
        if (v.building) {
          if (v.building.owner === pid) { push(v.id, 'r', null, null, 0); push(v.id, 's', null, null, 0); }
          continue;
        }
        if (v.edges.some(e => G.edges[e].road === pid)) push(v.id, 'r', null, null, 0);
        if (v.edges.some(e => G.edges[e].ship === pid)) push(v.id, 's', null, null, 0);
      }
    } else starts.forEach(st => { push(st, 'r', null, null, 0); push(st, 's', null, null, 0); });
    const maxD = G.seafarers ? 6 : 4;
    let best = null;
    while (q.length) {
      const cur = q.shift();
      if (cur.d > 0 && validSettlementSpot(pid, cur.v, true)) {
        const sc = AI.scoreVertex(pid, cur.v, prod) / (cur.d + 0.6);
        if (!best || sc > best.score) best = { edge: cur.first, kind: cur.kind, score: sc, v: cur.v, d: cur.d };
      }
      if (cur.d >= Math.min(maxD, cur.mode === 'r' ? p.roads : p.ships)) continue;
      const vv = G.vertices[cur.v];
      if (cur.d > 0 && vv.building) continue;
      for (const eid of vv.edges) {
        const e = G.edges[eid];
        if (e.road !== null || e.ship != null) continue;
        const ok = cur.mode === 'r' ? canR && e.land !== false : canS && e.sea && !nearPirate(e);
        if (!ok) continue;
        const nv = e.v[0] === cur.v ? e.v[1] : e.v[0];
        push(nv, cur.mode, cur.first === null ? eid : cur.first, cur.first === null ? cur.mode : cur.kind, cur.d + 1);
      }
    }
    return best;
  },

  // Construye la primera pieza (camino o barco) hacia un objetivo
  buildToward(pid, t, free) {
    if (!t) return false;
    if (t.kind === 's') return (free || canAfford(pid, COSTS.barco)) && buildShip(pid, t.edge);
    return (free || canAfford(pid, COSTS.camino)) && buildRoad(pid, t.edge);
  },

  chooseGold(pid) {
    const need = Math.min(G.goldNeed[pid], RES.reduce((s, r) => s + G.bank[r], 0));
    const g = AI.goal(pid);
    const cost = g ? AI.costOf(g) : {};
    const tmp = { ...P(pid).res }, bank = { ...G.bank }, sel = zeroRes();
    for (let i = 0; i < need; i++) {
      let best = null, bv = -Infinity;
      for (const r of RES) {
        if (bank[r] <= 0) continue;
        const v = ((cost[r] || 0) - tmp[r]) * 2 - tmp[r] * 0.3 + Math.random() * 0.1;
        if (v > bv) { bv = v; best = r; }
      }
      sel[best]++; tmp[best]++; bank[best]--;
    }
    return chooseGold(pid, sel);
  },

  costOf(g) { return g === 'ruta' ? COSTS.camino : COSTS[g]; }, // incluye 'barco'

  // Camino que más alarga la ruta propia (para pelear la Gran Ruta Comercial)
  longRoadEdge(pid) {
    const base = longestRoadFor(pid);
    let best = null, bestLen = base;
    for (const eid of roadSpots(pid)) {
      G.edges[eid].road = pid;
      const len = longestRoadFor(pid);
      G.edges[eid].road = null;
      if (len > bestLen) { bestLen = len; best = eid; }
    }
    return best;
  },

  goal(pid) {
    const p = P(pid);
    const opts = [];
    const spots = settlementSpots(pid, false);
    if (p.cities > 0 && citySpots(pid).length) opts.push(['ciudad', 0.4]);
    if (p.settlements > 0 && spots.length) opts.push(['poblado', 0.6]);
    const target = p.settlements > 0 && !spots.length ? AI.roadTarget(pid) : null;
    if (target) opts.push([target.kind === 's' ? 'barco' : 'camino', 0.3]);
    if (G.devDeck.length) opts.push(['carta', -0.5]);
    let best = null, bs = Infinity;
    for (const [g, bonus] of opts) {
      const s = AI.missing(p.res, AI.costOf(g)) - bonus;
      if (s < bs) { bs = s; best = g; }
    }
    // Sin nada más que construir: alargar el camino para conseguir la Gran Ruta
    if (!best && p.roads > 0 && G.longestHolder !== pid && AI.longRoadEdge(pid) !== null) best = 'ruta';
    return best;
  },

  robberOnMe(pid) {
    const h = G.hexes[G.robber];
    return h.number && pips(h.number) >= 3 &&
      h.vertices.some(v => G.vertices[v].building && G.vertices[v].building.owner === pid);
  },

  chooseRobberHex(pid) {
    let best = null, bs = -Infinity;
    for (const h of G.hexes) {
      if (G.seafarers && pirateAllowed(h.id)) {
        // Pirata: molesta a los barcos rivales y roba a uno de ellos
        let s = Math.random() * 0.2;
        for (const eid of h.edges) {
          const o = G.edges[eid].ship;
          if (o === pid) s -= 4;
          else if (o !== null) s += 2 * (1 + vp(o, false) / 4) + (total(P(o).res) > 0 ? 1.5 : 0);
        }
        if (s > bs) { bs = s; best = h.id; }
        continue;
      }
      if (!robberAllowed(h.id, pid)) continue;
      let s = Math.random() * 0.2;
      for (const vid of h.vertices) {
        const b = G.vertices[vid].building;
        if (!b) continue;
        const w = b.type === 'ciudad' ? 2 : 1;
        if (b.owner === pid) s -= 12 * w;
        else s += pips(h.number) * w * (1 + vp(b.owner, false) / 4) + (total(P(b.owner).res) > 0 ? 1.5 : 0);
      }
      if (s > bs) { bs = s; best = h.id; }
    }
    return best;
  },

  chooseVictim(pid, cands) {
    return cands.slice().sort((a, b) => (vp(b, false) - vp(a, false)) || (total(P(b).res) - total(P(a).res)))[0];
  },

  discard(pid) {
    const need = G.discardNeed[pid];
    const tmp = { ...P(pid).res };
    const g = AI.goal(pid);
    const cost = g ? AI.costOf(g) : {};
    const sel = zeroRes();
    for (let i = 0; i < need; i++) {
      let best = null, bv = -Infinity;
      for (const r of RES) {
        if (tmp[r] <= 0) continue;
        const v = tmp[r] - (cost[r] || 0) * 1.5 + Math.random() * 0.1;
        if (v > bv) { bv = v; best = r; }
      }
      tmp[best]--; sel[best]++;
    }
    return discard(pid, sel);
  },

  // ¿Acepta la IA un intercambio? receive = lo que recibe, giveAway = lo que entrega
  acceptTrade(aiId, proposer, receive, giveAway) {
    const me = P(aiId);
    if (RES.some(r => (giveAway[r] || 0) > me.res[r])) return false;
    if (vp(proposer, false) >= 8) return false;
    const g = AI.goal(aiId);
    if (!g) return false;
    const cost = AI.costOf(g);
    const after = { ...me.res };
    RES.forEach(r => { after[r] += (receive[r] || 0) - (giveAway[r] || 0); });
    const before = AI.missing(me.res, cost), now = AI.missing(after, cost);
    if (now < before) return total(giveAway) <= total(receive) + (now === 0 ? 1 : 0);
    if (now === before) return total(receive) > total(giveAway);
    return false;
  },

  tryDev(pid) {
    if (G.devPlayed) return false;
    const p = P(pid);
    if (playableDev(pid, 'caballero')) {
      const h = G.armyHolder;
      const hk = h === null ? 2 : P(h).knights;
      if (AI.robberOnMe(pid) || (h !== pid && p.knights + 1 > hk)) return playKnight(pid);
    }
    if (playableDev(pid, 'carreteras') && p.settlements > 0 && !settlementSpots(pid, false).length && AI.roadTarget(pid)) {
      return playRoadBuilding(pid);
    }
    if (playableDev(pid, 'monopolio')) {
      let best = null, bt = 0;
      for (const r of RES) {
        const t = G.players.reduce((s, o) => s + (o.id === pid ? 0 : o.res[r]), 0);
        if (t > bt) { bt = t; best = r; }
      }
      if (bt >= 4) return playMonopoly(pid, best);
    }
    if (playableDev(pid, 'abundancia')) {
      const g = AI.goal(pid);
      if (g) {
        const cost = AI.costOf(g);
        const miss = [];
        RES.forEach(r => { for (let i = p.res[r]; i < (cost[r] || 0); i++) miss.push(r); });
        if (miss.length >= 1 && miss.length <= 2) {
          const r1 = miss[0], r2 = miss[1] || (cost.mineral ? 'mineral' : 'trigo');
          if (playAbundance(pid, r1, r2)) return true;
        }
      }
    }
    return false;
  },

  tryBankTrade(pid, g) {
    if (!g || G.aiTrades >= 4) return false;
    const p = P(pid), cost = AI.costOf(g);
    const need = RES.filter(r => (cost[r] || 0) > p.res[r] && G.bank[r] > 0);
    if (!need.length) return false;
    const order = RES.slice().sort((a, b) => (p.res[b] - (cost[b] || 0)) - (p.res[a] - (cost[a] || 0)));
    for (const r of order) {
      if (need.includes(r)) continue;
      if (p.res[r] - (cost[r] || 0) >= bankRate(pid, r)) {
        G.aiTrades++;
        return bankTrade(pid, r, need[0]);
      }
    }
    return false;
  },

  tryPlayerTrade(pid, g) {
    if (!g || G.aiOffers >= 1) return false;
    G.aiOffers++;
    const p = P(pid), cost = AI.costOf(g);
    const need = RES.filter(r => (cost[r] || 0) > p.res[r]);
    const surplus = RES.filter(r => p.res[r] - (cost[r] || 0) >= 1 && !need.includes(r))
      .sort((a, b) => (p.res[b] - (cost[b] || 0)) - (p.res[a] - (cost[a] || 0)));
    if (!need.length || !surplus.length) return false;
    const giveObj = zeroRes(), getObj = zeroRes();
    giveObj[surplus[0]] = 1; getObj[need[0]] = 1;
    const others = G.players.filter(o => o.id !== pid && o.res[need[0]] >= 1);
    for (const o of others) {
      if (isBot(o.id) && AI.acceptTrade(o.id, pid, giveObj, getObj)) return playerTrade(pid, o.id, giveObj, getObj);
    }
    const humans = others.filter(o => !isBot(o.id)).map(o => o.id);
    if (humans.length) {
      G.offer = { from: pid, give: giveObj, get: getObj, to: humans };
      return true;
    }
    return false;
  },

  buildBest(pid, allowRoad) {
    const p = P(pid);
    if (canAfford(pid, COSTS.ciudad) && p.cities > 0) {
      const cs = citySpots(pid).sort((a, b) => AI.cityValue(b) - AI.cityValue(a));
      if (cs.length) return buildCity(pid, cs[0]);
    }
    if (canAfford(pid, COSTS.poblado) && p.settlements > 0) {
      const prod = AI.production(pid);
      const ss = settlementSpots(pid, false).sort((a, b) => AI.scoreVertex(pid, b, prod) - AI.scoreVertex(pid, a, prod));
      if (ss.length) return buildSettlement(pid, ss[0]);
    }
    const g = AI.goal(pid);
    if (allowRoad && (g === 'camino' || g === 'barco') && AI.buildToward(pid, AI.roadTarget(pid))) return true;
    if (g === 'carta' && canAfford(pid, COSTS.carta) && G.devDeck.length) return buyDev(pid);
    if (allowRoad && g === 'ruta' && canAfford(pid, COSTS.camino)) {
      const e = AI.longRoadEdge(pid);
      if (e !== null) return buildRoad(pid, e);
    }
    return false;
  },

  mainStep(pid) {
    if (AI.tryDev(pid)) return true;
    if (AI.buildBest(pid, true)) return true;
    const g = AI.goal(pid);
    if (AI.tryBankTrade(pid, g)) return true;
    if (AI.tryPlayerTrade(pid, g)) return true;
    // Gastar cartas si hay riesgo de descarte por un 7
    if (total(P(pid).res) > 7) {
      if (canAfford(pid, COSTS.carta) && G.devDeck.length) return buyDev(pid);
      if (AI.buildToward(pid, AI.roadTarget(pid))) return true;
    }
    return endTurn(pid);
  },

  specialStep(pid) {
    if (AI.buildBest(pid, true)) return true;
    return endSpecial(pid);
  },

  // Acción del jugador en pareja: construir, comerciar con el banco y una carta
  pairedStep(pid) {
    if (AI.tryDev(pid)) return true;
    if (AI.buildBest(pid, true)) return true;
    if (AI.tryBankTrade(pid, AI.goal(pid))) return true;
    return endPaired(pid);
  },

  act() {
    const pid = actor();
    let ok = false;
    switch (G.phase) {
      case 'setup-settlement': {
        const prod = AI.production(pid);
        const spots = settlementSpots(pid, true).sort((a, b) => AI.scoreVertex(pid, b, prod) - AI.scoreVertex(pid, a, prod));
        ok = buildSettlement(pid, spots[0]);
        break;
      }
      case 'setup-road': {
        const t = AI.roadTarget(pid, [G.lastSettlement]);
        ok = AI.buildToward(pid, t, true) || buildRoad(pid, roadSpots(pid, G.lastSettlement)[0]);
        break;
      }
      case 'gold': ok = AI.chooseGold(pid); break;
      case 'roll':
        ok = (AI.robberOnMe(pid) && playKnight(pid)) || rollDice();
        break;
      case 'discard': ok = AI.discard(pid); break;
      case 'robber': ok = moveRobber(AI.chooseRobberHex(pid)); break;
      case 'steal': ok = steal(AI.chooseVictim(pid, G.stealCandidates)); break;
      case 'road-building': {
        const spots = roadSpots(pid);
        ok = AI.buildToward(pid, AI.roadTarget(pid), true) ||
          (spots.length ? buildRoad(pid, spots[rand(spots.length)]) : endRoadBuilding(pid));
        break;
      }
      case 'main': ok = AI.mainStep(pid); break;
      case 'special-build': ok = AI.specialStep(pid); break;
      case 'paired': ok = AI.pairedStep(pid); break;
    }
    if (!ok) AI.fallback(pid);
  },

  // Red de seguridad: nunca dejar la partida bloqueada.
  fallback(pid) {
    switch (G.phase) {
      case 'setup-settlement': buildSettlement(pid, settlementSpots(pid, true)[0]); break;
      case 'setup-road': {
        const r = roadSpots(pid, G.lastSettlement);
        if (r.length) buildRoad(pid, r[0]); else buildShip(pid, shipSpots(pid, G.lastSettlement)[0]);
        break;
      }
      case 'gold': {
        const sel = zeroRes(), bank = { ...G.bank };
        const need = Math.min(G.goldNeed[pid], RES.reduce((s, r) => s + G.bank[r], 0));
        for (let i = 0; i < need; i++) { const r = RES.find(x => bank[x] > 0); bank[r]--; sel[r]++; }
        chooseGold(pid, sel);
        break;
      }
      case 'roll': rollDice(); break;
      case 'discard': {
        const sel = zeroRes(), tmp = { ...P(pid).res };
        for (let i = 0; i < G.discardNeed[pid]; i++) {
          const r = RES.find(x => tmp[x] > 0);
          tmp[r]--; sel[r]++;
        }
        discard(pid, sel);
        break;
      }
      case 'robber': moveRobber(G.hexes.find(h => robberAllowed(h.id, pid)).id); break;
      case 'steal': steal(G.stealCandidates[0]); break;
      case 'road-building': endRoadBuilding(pid); break;
      case 'main': endTurn(pid); break;
      case 'special-build': endSpecial(pid); break;
      case 'paired': endPaired(pid); break;
    }
  },
};

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
      if (!r) continue;
      s += pips(h.number) * AI_WEIGHT[r] * (hid === G.robber ? 0.5 : 1);
      if (!prod[r] && !types.has(r)) s += 1.5;
      types.add(r);
    }
    s += types.size * 0.6;
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

  // Busca el mejor lugar para un poblado accesible construyendo caminos.
  roadTarget(pid, starts) {
    const p = P(pid);
    if (p.roads <= 0) return null;
    if (!starts) {
      starts = [];
      for (const v of G.vertices) {
        if (v.building) { if (v.building.owner === pid) starts.push(v.id); continue; }
        if (v.edges.some(e => G.edges[e].road === pid)) starts.push(v.id);
      }
    }
    const prod = AI.production(pid);
    const seen = new Set(starts);
    const q = starts.map(s => ({ v: s, first: null, d: 0 }));
    let best = null;
    while (q.length) {
      const cur = q.shift();
      if (cur.d > 0 && validSettlementSpot(pid, cur.v, true)) {
        const sc = AI.scoreVertex(pid, cur.v, prod) / (cur.d + 0.6);
        if (!best || sc > best.score) best = { edge: cur.first, score: sc, v: cur.v, d: cur.d };
      }
      if (cur.d >= Math.min(4, p.roads)) continue;
      const vv = G.vertices[cur.v];
      if (cur.d > 0 && vv.building) continue;
      for (const eid of vv.edges) {
        const e = G.edges[eid];
        if (e.road !== null) continue;
        const nv = e.v[0] === cur.v ? e.v[1] : e.v[0];
        if (seen.has(nv)) continue;
        seen.add(nv);
        q.push({ v: nv, first: cur.first === null ? eid : cur.first, d: cur.d + 1 });
      }
    }
    return best;
  },

  costOf(g) { return g === 'ruta' ? COSTS.camino : COSTS[g]; },

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
    if (p.settlements > 0 && !spots.length && AI.roadTarget(pid)) opts.push(['camino', 0.3]);
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
      if (h.id === G.robber) continue;
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
    if (allowRoad && g === 'camino' && canAfford(pid, COSTS.camino)) {
      const t = AI.roadTarget(pid);
      if (t) return buildRoad(pid, t.edge);
    }
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
      if (canAfford(pid, COSTS.camino)) {
        const t = AI.roadTarget(pid);
        if (t) return buildRoad(pid, t.edge);
      }
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
        ok = buildRoad(pid, t ? t.edge : roadSpots(pid, G.lastSettlement)[0]);
        break;
      }
      case 'roll':
        ok = (AI.robberOnMe(pid) && playKnight(pid)) || rollDice();
        break;
      case 'discard': ok = AI.discard(pid); break;
      case 'robber': ok = moveRobber(AI.chooseRobberHex(pid)); break;
      case 'steal': ok = steal(AI.chooseVictim(pid, G.stealCandidates)); break;
      case 'road-building': {
        const spots = roadSpots(pid);
        const t = AI.roadTarget(pid);
        const eid = t && spots.includes(t.edge) ? t.edge : spots[rand(spots.length)];
        ok = eid == null ? endRoadBuilding(pid) : buildRoad(pid, eid);
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
      case 'setup-road': buildRoad(pid, roadSpots(pid, G.lastSettlement)[0]); break;
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
      case 'robber': moveRobber(G.hexes.find(h => h.id !== G.robber).id); break;
      case 'steal': steal(G.stealCandidates[0]); break;
      case 'road-building': endRoadBuilding(pid); break;
      case 'main': endTurn(pid); break;
      case 'special-build': endSpecial(pid); break;
      case 'paired': endPaired(pid); break;
    }
  },
};

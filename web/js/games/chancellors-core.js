/* Chancellors — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:chancellors  (P.D. Magnus)
 *
 * A resource-management game for two players.  Three royal services — the
 * Diplomat (Moons and Suns), the Soldier (Daemons and Crowns) and the Sailor
 * (Waves and Leaves) — are up for grabs.  Every turn each player secretly
 * plays one card; the best card for each service takes it.  Whoever controls
 * services then solves the kingdom's problems: pairs of dice that must be
 * met with cards (partly or wholly) for points.  Unsolved problems escalate;
 * one reaching 6 and 6 sacks you all and the LOWEST score wins.  Reach 100
 * points and the highest score wins instead.
 *
 * Extra material, emulated here: the six dice live in the state (a seeded
 * rng keeps them stable across reloads), and the scorepad becomes an
 * on-screen table of running scores.
 *
 * Implemented for exactly two players, pass-and-play.  Interpretations (all
 * restated on the rules page):
 *   1. Two players only: six dice in three problems; services play in the
 *      order Diplomat, Soldier, Sailor (the card ranks 8, 5, 4).
 *   2. Deck: the basic 36-card deck less the three service cards = 33 cards,
 *      three dealt to each player.
 *   3. A control card may take every service whose suits it matches (the
 *      three service cards carry disjoint suit pairs, so a two-suit card can
 *      match two services).
 *   4. Ties on rank go to the lower cumulative score; an exact dead heat
 *      leaves the service uncontrolled in the middle of the table.
 *   5. Cards played to solve with a service must share a suit with THAT
 *      service's card (the wiki says "a service that you control"; each
 *      chance is tied to the service being exercised).
 *   6. A part-solve is one card worth at most the lower die; a Crown counts
 *      as the higher die, so it only works when the dice match.  You choose
 *      which die to set aside; the remaining part is locked for the rest of
 *      the turn, even for its solver.
 *   7. Solving without a service: whole problems only, only problems nobody
 *      has touched this turn, cards totalling at least twice the dice sum,
 *      any suits, scoring the dice sum.
 *   8. The open-solving order starts left of the player who most recently
 *      solved a problem (part-solves count); with no solver yet, seat order.
 *   9. Escalation order: re-form partial problems (reroll the set-aside
 *      die), check 6-and-6 (a catastrophe ends the game at once, before any
 *      increment), increment the lower die of every unsolved problem, then
 *      dice from complete solves become fresh problems that do not escalate
 *      this turn.
 *  10. Draw three each (reshuffle the discard when the draw pile empties),
 *      then trim over-large hands down to six in seat order.
 *  11. Endings: 100+ points at the end of a turn ends the game (highest
 *      score wins); a 6-and-6 escalation ends it at once (lowest score
 *      wins); tied winning scores are a draw — the wiki's fisticuffs are
 *      politely omitted.
 *  12. The extended deck (Excuse, Pawns, Courts) is not implemented. */

import { rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const TARGET = 100;
export const DEAL = 3;
export const HAND_CAP = 6;
export const PROBLEM_COUNT = 3;

/** The services, in the order they act: Diplomat, Army, Navy (ranks 8·5·4). */
export const SERVICES = [
  { key: 'diplomat', id: 'the-diplomat', name: 'Diplomatic corps', short: 'Diplomat' },
  { key: 'army', id: 'the-soldier', name: 'Army', short: 'Soldier' },
  { key: 'navy', id: 'the-sailor', name: 'Navy', short: 'Sailor' },
];

/* ------------------------------------------------------------------- rng */

function rand(st) {
  let a = (st.rngState + 0x6d2b79f5) | 0;
  st.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** One die; the rng lives in the state so a reload keeps every roll. */
export const rollDie = (st) => 1 + Math.floor(rand(st) * 6);

/* -------------------------------------------------------------- problems */

export const total = (prob) => prob.dice[0] + prob.dice[1];
export const lowerDie = (prob) => Math.min(prob.dice[0], prob.dice[1]);
export const higherDie = (prob) => Math.max(prob.dice[0], prob.dice[1]);

/** Value of a card against a problem: Crowns show the higher die. */
export function cardValue(id, prob) {
  const c = card(id);
  return c.rank === 'crown' ? higherDie(prob) : rankValue(c);
}

export const sharesSuit = (id, serviceId) =>
  suitsOf(id).some((s) => suitsOf(serviceId).includes(s));

/* ---------------------------------------------------------------- setup */

export function newGame(seed, deck) {
  if (deck.length !== 36) throw new Error(`the basic Decktet is 36 cards, got ${deck.length}`);
  const st = {
    seed, rngState: seed >>> 0, moves: 0,
    hands: [[], []],
    draw: [], discard: [],
    services: SERVICES.map((s) => ({ key: s.key, id: s.id, name: s.name, holder: null })),
    problems: [],
    selections: [null, null],
    reveal: null,           // { cards: [id, id], entries: [...] } once both have chosen
    queue: [],              // service keys acting this turn
    serviceStep: 0,
    openOrder: [], openStep: 0,
    lastSolver: null,
    trimStep: 0,
    scores: [0, 0],
    turn: 1,
    phase: 'control',       // control | reveal | service | open | trim
    controlStep: 0,
    notes: [],
    over: null,             // 'score' | 'catastrophe'
    winner: null,
  };
  const serviceIds = new Set(SERVICES.map((s) => s.id));
  st.draw = deck.filter((id) => !serviceIds.has(id));
  for (let i = st.draw.length - 1; i > 0; i--) {
    const j = Math.floor(rand(st) * (i + 1));
    [st.draw[i], st.draw[j]] = [st.draw[j], st.draw[i]];
  }
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < DEAL; i++) st.hands[p].push(st.draw.pop());
  }
  for (let i = 0; i < PROBLEM_COUNT; i++) {
    st.problems.push({ dice: [rollDie(st), rollDie(st)], status: 'open' });
  }
  st.notes = [`Turn ${st.turn}: three problems face the kingdom.`];
  return st;
}

/* -------------------------------------------------------------- helpers */

export const serviceByKey = (state, key) => state.services.find((s) => s.key === key);
export const holderOf = (state, key) => serviceByKey(state, key).holder;
export const controlsService = (state, p) => state.services.some((s) => s.holder === p);
export const servicesOf = (state, p) => state.services.filter((s) => s.holder === p);

/** The service whose chance this is (null outside the service phase). */
export function currentService(state) {
  if (state.phase !== 'service') return null;
  const key = state.queue[state.serviceStep];
  return key ? serviceByKey(state, key) : null;
}

/** The player who must act right now, or null. */
export function actor(state) {
  if (state.over) return null;
  switch (state.phase) {
    case 'control': return state.controlStep;
    case 'service': { const svc = currentService(state); return svc ? svc.holder : null; }
    case 'open': return state.openOrder[state.openStep] ?? null;
    case 'trim': return state.trimStep;
    default: return null;
  }
}

export const problemIn = (state, pi) => {
  if (!Number.isInteger(pi) || pi < 0 || pi >= state.problems.length) {
    throw new Error(`there is no problem ${pi} — the kingdom has ${state.problems.length}`);
  }
  return state.problems[pi];
};

function requireOpenProblem(state, pi) {
  const prob = problemIn(state, pi);
  if (prob.status === 'solved') {
    throw new Error(`problem ${pi + 1} was already solved this turn — its dice will be rerolled`);
  }
  if (prob.status === 'partial') {
    throw new Error(`problem ${pi + 1} was partly solved this turn — the rest is locked until the turn ends`);
  }
  return prob;
}

function requireCards(state, p, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('play at least one card');
  const hand = state.hands[p];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${card(id).name} was counted twice`);
    seen.add(id);
    if (!hand.includes(id)) throw new Error(`${card(id).name} is not in Player ${p + 1}'s hand`);
  }
}

export const label = (ids) => ids.map((id) => card(id).name).join(' + ');

const phaseGuard = (state, phase) => {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== phase) {
    throw new Error(`that can only happen in the ${phase} phase — this is the ${state.phase} phase`);
  }
};

/* ---------------------------------------------------- (A) control services */

/** Player `state.controlStep` secretly picks one card from their hand. */
export function selectControl(state, id) {
  phaseGuard(state, 'control');
  const p = state.controlStep;
  if (!state.hands[p].length) throw new Error(`Player ${p + 1} has no card to influence with`);
  if (!state.hands[p].includes(id)) {
    throw new Error(`${card(id)?.name || id} is not in Player ${p + 1}'s hand`);
  }
  const next = structuredClone(state);
  next.hands[p].splice(next.hands[p].indexOf(id), 1);
  next.selections[p] = id;
  next.moves += 1;
  if (p === 0) {
    next.controlStep = 1;
    return next;
  }
  resolveControl(next);
  return next;
}

/** Resolve a service's display name, tolerating saves from before it was stored. */
const svcName = (svc) => svc.name || SERVICES.find((s) => s.key === svc.key).name;

/** Both cards are face up: settle who controls what (mutates a clone). */
function resolveControl(st) {
  const entries = [];
  for (const svc of st.services) {
    const name = svcName(svc);
    const cands = [0, 1].filter((p) => st.selections[p] && sharesSuit(st.selections[p], svc.id));
    if (!cands.length) {
      entries.push({ key: svc.key, cards: st.selections.slice(), winner: null, kept: true,
        text: `No one reached for the ${name}.` });
      continue;                                     // the service stays where it is
    }
    const bid = (p) => rankOf(st.selections[p]);
    const best = Math.max(...cands.map(bid));
    const top = cands.filter((p) => bid(p) === best);
    let winner;
    if (top.length === 1) winner = top[0];
    else {
      const low = Math.min(...top.map((p) => st.scores[p]));
      const byScore = top.filter((p) => st.scores[p] === low);
      winner = byScore.length === 1 ? byScore[0] : null;   // dead heat: back to the middle
    }
    svc.holder = winner;
    entries.push({
      key: svc.key, cards: st.selections.slice(), winner,
      text: winner == null
        ? `Tied bids on the ${name} — it sits in the middle of the table.`
        : `Player ${winner + 1} takes the ${name} with ${card(st.selections[winner]).name}.`,
    });
  }
  st.reveal = { cards: st.selections.slice(), entries };
  st.discard.push(...st.selections.filter(Boolean));
  st.selections = [null, null];
  st.phase = 'reveal';
  st.controlStep = 0;
  st.moves += 1;
}

/** Move on from the reveal screen into the solving phases. */
export function endReveal(state) {
  phaseGuard(state, 'reveal');
  const next = structuredClone(state);
  next.reveal = null;
  next.serviceStep = 0;
  next.queue = next.services.filter((s) => s.holder != null).map((s) => s.key);
  if (next.queue.length) {
    next.phase = 'service';
  } else {
    next.phase = 'open';
    startOpen(next);
    if (!next.openOrder.length) endTurn(next);      // nobody may solve: escalate straight away
  }
  next.moves += 1;
  return next;
}

/** Phase C order: players with no service, starting left of the last solver. */
function startOpen(st) {
  const from = st.lastSolver == null ? 0 : (st.lastSolver + 1) % 2;
  st.openOrder = [0, 1].map((i) => (from + i) % 2).filter((p) => !controlsService(st, p));
  st.openStep = 0;
}

/* ------------------------------------------- (B) solving with a service */

export function serviceSolveFull(state, pi, ids) {
  phaseGuard(state, 'service');
  const p = actor(state);
  const svc = currentService(state);
  const prob = requireOpenProblem(state, pi);
  requireCards(state, p, ids);
  for (const id of ids) {
    if (!sharesSuit(id, svc.id)) {
      throw new Error(`${card(id).name} shares no suit with the ${svc.name}'s card (${card(svc.id).name})`);
    }
  }
  const sum = ids.reduce((n, id) => n + cardValue(id, prob), 0);
  const need = total(prob);
  if (sum < need) {
    throw new Error(`${label(ids)} total ${sum}, but the problem needs at least ${need}`);
  }
  const next = structuredClone(state);
  applyFull(next, p, pi, ids, need);
  finishAction(next);
  return next;
}

/** Solve one problem in part: one card ≤ the lower die, set one die aside. */
export function serviceSolvePart(state, pi, id, die) {
  phaseGuard(state, 'service');
  const p = actor(state);
  const svc = currentService(state);
  const prob = requireOpenProblem(state, pi);
  requireCards(state, p, [id]);
  if (!sharesSuit(id, svc.id)) {
    throw new Error(`${card(id).name} shares no suit with the ${svc.name}'s card (${card(svc.id).name})`);
  }
  if (!Number.isInteger(die) || die < 0 || die > 1) throw new Error('choose which die to set aside');
  const low = lowerDie(prob);
  const v = cardValue(id, prob);
  if (v > low) {
    throw new Error(`a part-solve needs one card worth at most the lower die, ${low} — ` +
      `${card(id).name} is worth ${v}${card(id).rank === 'crown' ? ' (a Crown shows the higher die)' : ''}`);
  }
  const points = Math.ceil(total(prob) / 2);
  const next = structuredClone(state);
  const np = next.problems[pi];
  np.status = 'partial';
  np.keep = 1 - die;
  np.setAside = np.dice[die];
  np.solver = p;
  next.hands[p].splice(next.hands[p].indexOf(id), 1);
  next.discard.push(id);
  next.scores[p] += points;
  next.lastSolver = p;
  next.notes.push(`Player ${p + 1} solves part of problem ${pi + 1} with ${card(id).name} (+${points}); ` +
    `one die is set aside.`);
  finishAction(next);
  return next;
}

/** Pass on this service — optionally abdicating it back to the table. */
export function servicePass(state, abdicate = false) {
  phaseGuard(state, 'service');
  const p = actor(state);
  const next = structuredClone(state);
  const svc = currentService(next);
  if (abdicate) {
    svc.holder = null;
    next.notes.push(`Player ${p + 1} passes and abdicates the ${svc.name}.`);
  } else {
    next.notes.push(`Player ${p + 1} passes on the ${svc.name}.`);
  }
  finishAction(next);
  return next;
}

/* ---------------------------------------- (C) solving without a service */

export function openSolveFull(state, pi, ids) {
  phaseGuard(state, 'open');
  const p = actor(state);
  const prob = requireOpenProblem(state, pi);
  requireCards(state, p, ids);
  const sum = ids.reduce((n, id) => n + cardValue(id, prob), 0);
  const need = 2 * total(prob);
  if (sum < need) {
    throw new Error(`without a service the cards must total twice the dice — ${need}, ` +
      `but ${label(ids)} total ${sum}`);
  }
  const next = structuredClone(state);
  applyFull(next, p, pi, ids, total(prob));
  finishAction(next);
  return next;
}

export function openPass(state) {
  phaseGuard(state, 'open');
  const next = structuredClone(state);
  next.notes.push(`Player ${actor(state) + 1} passes.`);
  finishAction(next);
  return next;
}

function applyFull(st, p, pi, ids, points) {
  const prob = st.problems[pi];
  prob.status = 'solved';
  prob.solver = p;
  st.hands[p] = st.hands[p].filter((id) => !ids.includes(id));
  st.discard.push(...ids);
  st.scores[p] += points;
  st.lastSolver = p;
  st.notes.push(`Player ${p + 1} solves problem ${pi + 1} (${prob.dice[0]}+${prob.dice[1]}) with ` +
    `${label(ids)} for ${points} points.`);
}

/* ------------------------------------------------------- turn bookkeeping */

function finishAction(st) {
  st.moves += 1;
  if (st.phase === 'service') {
    st.serviceStep += 1;
    if (st.serviceStep < st.queue.length) return;
    // the services have had their chance: the service-less players go on
    st.phase = 'open';
    startOpen(st);
    if (st.openOrder.length) return;
    endTurn(st);                       // both control services: nobody may solve
    return;
  }
  if (st.phase === 'open') {
    st.openStep += 1;
    if (st.openStep < st.openOrder.length) return;
  }
  if (!st.over) endTurn(st);
}

/** (D) escalate, (E) draw, then trim — or sack everyone at 6 and 6. */
function endTurn(st) {
  // re-form partially solved problems: the set-aside die is rerolled
  for (const prob of st.problems) {
    if (prob.status !== 'partial') continue;
    prob.dice[1 - prob.keep] = rollDie(st);
    prob.status = 'open';
    prob.keep = null;
    prob.setAside = null;
    prob.solver = null;
  }
  // every unsolved problem gets worse; 6 and 6 ends the game at once
  for (const prob of st.problems) {
    if (prob.status !== 'open') continue;
    if (prob.dice[0] === 6 && prob.dice[1] === 6) {
      st.over = 'catastrophe';
      st.winner = st.scores[0] === st.scores[1] ? null : (st.scores[0] < st.scores[1] ? 0 : 1);
      st.notes.push('A problem reaches 6 and 6 and escalates out of control: the King sacks you ' +
        'both. The lowest score wins.');
      st.moves += 1;
      return;
    }
    if (prob.dice[0] <= prob.dice[1]) prob.dice[0] += 1;
    else prob.dice[1] += 1;
  }
  // dice from complete problems become fresh problems; they do not escalate
  for (let i = 0; i < st.problems.length; i++) {
    if (st.problems[i].status === 'solved') {
      st.problems[i] = { dice: [rollDie(st), rollDie(st)], status: 'open' };
    }
  }
  // every player draws three
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < DEAL; i++) drawOne(st, p);
  }
  if (st.hands.some((h) => h.length > HAND_CAP)) {
    st.phase = 'trim';
    st.trimStep = [0, 1].find((p) => st.hands[p].length > HAND_CAP);
    st.notes.push('Hands over six cards must be trimmed.');
    return;
  }
  finishTurn(st);
}

function drawOne(st, p) {
  if (!st.draw.length && st.discard.length) {
    st.draw = st.discard.slice();
    st.discard = [];
    for (let i = st.draw.length - 1; i > 0; i--) {
      const j = Math.floor(rand(st) * (i + 1));
      [st.draw[i], st.draw[j]] = [st.draw[j], st.draw[i]];
    }
  }
  if (st.draw.length) st.hands[p].push(st.draw.pop());
}

/** Trim phase: the player whose hand is too big discards down to six. */
export function trimDiscard(state, id) {
  phaseGuard(state, 'trim');
  const p = state.trimStep;
  if (!state.hands[p].includes(id)) {
    throw new Error(`${card(id)?.name || id} is not in Player ${p + 1}'s hand`);
  }
  const next = structuredClone(state);
  next.hands[p].splice(next.hands[p].indexOf(id), 1);
  next.discard.push(id);
  next.moves += 1;
  const again = [0, 1].find((q) => next.hands[q].length > HAND_CAP);
  if (again == null) finishTurn(next);
  else next.trimStep = again;
  return next;
}

function finishTurn(st) {
  st.phase = 'control';
  st.controlStep = 0;
  st.queue = [];
  st.serviceStep = 0;
  st.openOrder = [];
  st.openStep = 0;
  st.reveal = null;
  st.selections = [null, null];
  st.turn += 1;
  if (st.scores[0] >= TARGET || st.scores[1] >= TARGET) {
    st.over = 'score';
    st.winner = st.scores[0] === st.scores[1] ? null : (st.scores[0] > st.scores[1] ? 0 : 1);
    st.notes.push(`${TARGET} or more points: the King names a Lord High Chancellor.`);
    return;
  }
  st.notes = [`Turn ${st.turn}: three problems face the kingdom.`];
}

/* ------------------------------------------------------------ dispatcher */

/** One entry point for the UI and the playouts: { type, … }. */
export function applyMove(state, action) {
  switch (action.type) {
    case 'select': return selectControl(state, action.id);
    case 'continue': return endReveal(state);
    case 'full':
      return state.phase === 'service'
        ? serviceSolveFull(state, action.pi, action.ids)
        : openSolveFull(state, action.pi, action.ids);
    case 'part': return serviceSolvePart(state, action.pi, action.id, action.die);
    case 'pass': return state.phase === 'service' ? servicePass(state, false) : openPass(state);
    case 'abdic': return servicePass(state, true);
    case 'discard': return trimDiscard(state, action.id);
    default: throw new Error(`unknown action ${action.type}`);
  }
}

/* ------------------------------------------------------- legal actions */

const subsets = (arr, min, max) => {
  const out = [];
  const rec = (i, acc) => {
    if (acc.length >= min && acc.length <= max) out.push(acc.slice());
    if (i >= arr.length || acc.length >= max) return;
    for (let k = i; k < arr.length; k++) {
      acc.push(arr[k]);
      rec(k + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
};

/** Every legal move from this state, for random playouts. */
export function legalActions(state) {
  if (state.over) return [];
  const p = actor(state);
  switch (state.phase) {
    case 'control':
      return state.hands[p].map((id) => ({ type: 'select', id }));
    case 'reveal':
      return [{ type: 'continue' }];
    case 'service': {
      const svc = currentService(state);
      const out = [];
      for (let pi = 0; pi < state.problems.length; pi++) {
        const prob = state.problems[pi];
        if (prob.status !== 'open') continue;
        const low = lowerDie(prob);
        for (const id of state.hands[p]) {
          if (!sharesSuit(id, svc.id)) continue;
          if (cardValue(id, prob) <= low) {
            out.push({ type: 'part', pi, id, die: 0 });
            out.push({ type: 'part', pi, id, die: 1 });
          }
        }
        for (const ids of subsets(state.hands[p], 1, 5)) {
          if (!ids.every((id) => sharesSuit(id, svc.id))) continue;
          const sum = ids.reduce((n, id) => n + cardValue(id, prob), 0);
          if (sum >= total(prob)) out.push({ type: 'full', pi, ids });
        }
      }
      out.push({ type: 'pass' }, { type: 'abdic' });
      return out;
    }
    case 'open': {
      const out = [];
      for (let pi = 0; pi < state.problems.length; pi++) {
        const prob = state.problems[pi];
        if (prob.status !== 'open') continue;
        for (const ids of subsets(state.hands[p], 1, 5)) {
          const sum = ids.reduce((n, id) => n + cardValue(id, prob), 0);
          if (sum >= 2 * total(prob)) out.push({ type: 'full', pi, ids });
        }
      }
      out.push({ type: 'pass' });
      return out;
    }
    case 'trim':
      return state.hands[p].map((id) => ({ type: 'discard', id }));
    default:
      return [];
  }
}

/* --------------------------------------------------------------- misc */

/** Every card in circulation (33); the three service cards sit on the table. */
export function allCards(state) {
  return [...state.hands[0], ...state.hands[1], ...state.draw, ...state.discard,
    ...state.selections.filter(Boolean)];
}

export const OUTCOME = {
  score: { title: 'The King names a Chancellor', cls: 'win' },
  catastrophe: { title: 'The kingdom is in serious trouble', cls: 'lose' },
};

/** "5+3 — 8" for the UI.  Plain numerals: die glyphs are missing from some
 *  mobile font stacks. */
export const describeProblem = (prob) => {
  if (prob.status === 'partial') {
    return `${prob.dice[prob.keep]} — partly solved, a ${prob.setAside} set aside`;
  }
  return `${prob.dice[0]} + ${prob.dice[1]} — ${total(prob)}`;
};

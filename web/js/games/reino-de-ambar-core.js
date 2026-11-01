/* Reino de Ámbar — game logic, no DOM.  Solo mode.
 *
 * Rules: https://wiki.decktet.com/es-game:reino-de-ambar  (José Carlos de
 * Diego Guerrero, wiki rev 7, 7 July 2017) — Spanish only; the official text
 * is copied verbatim on the rules page, with an English summary above it.
 *
 * Solo form: you vs. the dummy player across 7 rounds.  Each round the dummy
 * acts first, then you; then both may contest the two face-up Problems.
 * Unresolved Problems raise the barbarians; after round 7 they attack and
 * your remaining Prestige (PV) decides.
 *
 * Deck: the Decktet (36) + the Excuse + the four Pawns (this app's Decktet
 * has four: the Borderland plus the three families) + one extra copy of each
 * Ace for the dummy's action set — 47 cards, conserved across board, action
 * sets, Problem deck and spare Pawn.
 *
 * Emulated components: the two 2d6 initial rolls are seeded and stored, the
 * barbarian power is drawn as a die face, influence markers and gold are
 * on-screen counters.
 *
 * The dummy's behaviour is an authored policy (below, restated on the rules
 * page): it always plays the front card of its face-down action hand; goes to
 * the Borderland whenever its symbol allows; otherwise prefers the odd/even
 * board position matching the round; skips destinations that would gain it
 * nothing ("sé honesto"), falling back to the most beneficial one; when it is
 * out of markers it pulls from its most-marked area (ties by lowest position,
 * never the Borderland).  When resolving Problems it attempts only where its
 * presence sum beats yours, takes the highest-PV Problem, prefers a
 * Borderland-bound symbol on Crown Problems, and otherwise parks the
 * Confidente on the parity-matching area.  Every choice is a pure function of
 * state — deterministic per seed — and every move it makes is validated by
 * the same rules as yours. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];

export const ROUNDS = 7;
export const MAX_BARBARIANS = 6;
export const MARKER_CAP = 10;
export const GOLD_CAP = 4;
export const START_MARKERS = 4;
export const START_GOLD = 3;
export const GENERAL_MARKERS = 4;      // per player colour in the general reserve
export const GENERAL_GOLD = 1;         // per player

export const MIDDLE_IDS = [
  'the-penitent', 'the-lunatic', 'the-castle',
  'the-market', 'the-cave', 'the-chance-meeting',
];
export const FACTIONS = ['the-harvest', 'the-light-keeper', 'the-watchman'];
export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const BOARD_IDS = ['the-excuse', ...MIDDLE_IDS, 'the-borderland'];

const isAce = (id) => card(id).rank === 1;
const isCrown = (id) => card(id).rank === 'crown';
const shuffle = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** The solo deck: basic 36 + Excuse + 4 Pawns + a second copy of every Ace. */
export function soloDeck(basicDeck) {
  const aces = basicDeck.filter(isAce);
  return [
    ...basicDeck,
    'the-excuse', 'the-borderland', 'the-harvest', 'the-light-keeper', 'the-watchman',
    ...aces.map((a) => `${a}#2`),
  ];
}

/* ------------------------------------------------------------- helpers */

export const areaSuits = (state, i) => card(state.areas[i]).suits;
export const areaName = (i) => (i === 0 ? 'the Excuse' : i === 7 ? 'the Borderland' : card(BOARD_IDS[i]).name);

/** The symbols a Problem card shows: its suits, plus Crown or its rank. */
export function symbolsOf(problemId) {
  const c = card(problemId);
  const out = [...c.suits];
  if (c.rank === 'crown') out.push('crown');
  else if (typeof c.rank === 'number') out.push('rank');
  return out;
}

/** PV a Problem gives when resolved for prestige: its rank,0 for Crowns. */
export const pvOf = (id) => (typeof card(id).rank === 'number' ? rankValue(card(id)) : 0);

/** Presence sum for `who` on a Problem: own markers on every area whose
 *  symbols overlap the Problem's, plus the Confidente where present. */
export function presenceSum(state, who, problemId) {
  const suits = card(problemId).suits;
  let sum = 0;
  for (let a = 1; a <= 7; a++) {
    if (!areaSuits(state, a).some((s) => suits.includes(s))) continue;
    const n = state.board[a][who];
    sum += n;
    if (state.confidente === a && n > 0) sum += 1;
  }
  return sum;
}

/** Every card in play, for conservation checks (47 cards). */
export function allCards(state) {
  return [
    ...state.areas,
    ...state.hands.me, ...state.hands.dummy,
    ...state.discards.me, ...state.discards.dummy,
    ...state.problems, ...state.problemDeck, ...state.problemDiscard,
    ...state.pv.me, ...state.pv.dummy,
    state.spare,
  ].filter(Boolean);
}

/* -------------------------------------------------------------- setup */

export function newGame(seed, basicDeck) {
  const rng = mulberry32(seed);
  const middle = shuffle(MIDDLE_IDS, rng);
  const areas = ['the-excuse', ...middle, 'the-borderland'];

  const factionPool = shuffle(FACTIONS, rng);
  const aces = basicDeck.filter(isAce);
  const hands = {
    me: shuffle([...aces, factionPool[0]], rng),
    dummy: shuffle([...aces.map((a) => `${a}#2`), factionPool[1]], rng),
  };

  const board = areas.map(() => ({ me: 0, dummy: 0 }));
  const roll = () => 1 + Math.floor(rng() * 6);
  const place = (who) => {
    const d1 = roll(), d2 = roll();
    board[d1][who] += 1;
    board[d2][who] += 1;                 // doubles allowed (wiki default)
    return [d1, d2];
  };
  const dice = { dummy: place('dummy'), me: place('me') };

  // the Problem deck: every basic card that is not an Ace or a board card —
  // the 6 Crowns (personalities) and the 18 cards ranked 2-9 (places/events)
  const problems = shuffle(
    basicDeck.filter((id) => !isAce(id) && !MIDDLE_IDS.includes(id)), rng);

  return {
    seed,
    areas, board, confidente: null,
    supply: { me: START_MARKERS, dummy: START_MARKERS },
    gold: { me: START_GOLD, dummy: START_GOLD },
    general: { me: GENERAL_MARKERS, dummy: GENERAL_MARKERS, gold: GENERAL_GOLD * 2 },
    barbarians: 0,
    hands, discards: { me: [], dummy: [] },
    problems: problems.slice(0, 2),
    problemDeck: problems.slice(2),
    problemDiscard: [],
    pv: { me: [], dummy: [] },
    spare: factionPool[2],
    dice,
    round: 1,
    phase: 'dummy-action',               // dummy-action → my-action → dummy-resolve → my-resolve
    dummyAttempt: null, myAttempt: null,
    moves: 0, over: null, score: null,
    log: 'The dummy player opens the round.',
  };
}

/* --------------------------------------------------- the dummy's policy */

const parityPref = (round, list) => {
  const want = round % 2 === 0 ? 0 : 1;         // even rounds → even positions
  const pref = list.filter((i) => i % 2 === want);
  return (pref.length ? pref : list).slice().sort((a, b) => a - b)[0];
};

/** Immediate value of taking an area action (used for the "beneficial" pick). */
function gainValue(state, who, area) {
  const id = state.areas[area];
  const opp = who === 'me' ? 'dummy' : 'me';
  const own = state.board[area][who];
  const withConf = own + (state.confidente === area ? 1 : 0);
  if (id === 'the-lunatic') {
    let v = 0;
    if (state.general.gold > 0 && state.gold[who] < GOLD_CAP) v += 1;
    if (state.general[who] > 0 && state.supply[who] < MARKER_CAP) v += 1;
    return v;
  }
  if (id === 'the-market') {
    let v = 0;
    const g = Math.min(withConf, GOLD_CAP - state.gold[who], state.general.gold);
    const m = Math.min(withConf, MARKER_CAP - state.supply[who], state.general[who]);
    v += g + m;
    return v;
  }
  if (id === 'the-castle') {
    return Math.min(withConf, MARKER_CAP - state.supply[who], state.general[who]);
  }
  if (id === 'the-penitent') {
    return state.gold[who] >= 1 && state.problems.length ? 2 : 0;
  }
  if (id === 'the-cave') {
    const oppMarkers = state.board.reduce((n, b, i) => (i === 0 ? n : n + b[opp]), 0);
    return oppMarkers > 0 ? 1 : 0;
  }
  if (id === 'the-chance-meeting') {
    const onBoard = state.board.reduce((n, b, i) => (i === 0 ? n : n + b[who]), 0);
    return onBoard >= 1 ? 1.5 : 0;
  }
  if (id === 'the-borderland') return 1;        // defence always counts
  return 0;
}

/** Would taking `area` give `who` nothing at all?  ("un absurdo") */
const isAbsurd = (state, who, area) =>
  gainValue(state, who, area) <= 0 ||
  (state.supply[who] === 0 && forcedSource(state, who, area) == null);

/** The dummy's choice of destination for its action card.  It must act every
 *  round, so the first candidate that actually applies is taken — the policy
 *  order below is the preference. */
export function dummyActionMove(state) {
  const cardId = state.hands.dummy[0];
  const suits = card(cardId).suits;
  const cands = [];
  for (let a = 1; a <= 7; a++) {
    if (areaSuits(state, a).some((s) => suits.includes(s))) cands.push(a);
  }
  const good = cands.filter((a) => !isAbsurd(state, 'dummy', a));
  const usable = good.length ? good : cands;
  const order = [];
  if (cands.includes(7)) order.push(7);          // "primero irá siempre a the Borderland"
  const rest = usable.filter((a) => a !== 7);
  order.push(parityPref(state.round, rest));     // then odd/even, "sé honesto"
  order.push(...rest.filter((a) => a !== order[order.length - 1]).sort((a, b) => a - b));
  order.push(...cands.filter((a) => !order.includes(a)));

  for (const area of order) {
    let mv = null;
    try { mv = buildDummyAction(state, cardId, area); } catch { continue; }
    if (!mv) continue;
    try { applyMove(state, mv); return mv; } catch { /* try the next option */ }
  }
  throw new Error('the dummy has no action it can take');
}

function buildDummyAction(state, cardId, area) {
  const suits = card(cardId).suits;
  const suit = areaSuits(state, area).find((s) => suits.includes(s)) || suits[0];
  const src = forcedSource(state, 'dummy', area);
  // judge the effect on the board as it will be after the marker lands
  const sim = structuredClone(state);
  placeMarker(sim, 'dummy', area, src);
  const spec = dummyAreaSpec(sim, area);
  return {
    type: 'area', who: 'dummy', hand: 0, suit, area,
    ...(src != null ? { moveFrom: src } : {}),
    ...(spec ? { spec } : {}),
  };
}

/** Sub-choices the dummy makes for a given area action. */
function dummyAreaSpec(state, area) {
  const id = state.areas[area];
  if (id === 'the-penitent' || id === 'the-cave') return policySpecFor(state, area);
  if (id === 'the-chance-meeting') {
    // source: most own markers outside the Borderland (ties → lowest), never
    // weaken the frontier if it has a choice; destination: best gain whose
    // effect the policy can actually drive
    const own = [];
    for (let a = 1; a <= 7; a++) if (state.board[a].dummy > 0) own.push(a);
    const land = own.filter((a) => a !== 7);
    const pool = land.length ? land : own;
    if (!pool.length && state.supply.dummy === 0) return null;
    const src = pool.length
      ? pool.reduce((b, a) =>
          state.board[a].dummy > state.board[b].dummy ? a
            : (state.board[a].dummy === state.board[b].dummy && a < b ? a : b), pool[0])
      : area;                                     // the marker just placed
    let best = null, bestV = -1, bestSpec = null;
    for (let d = 1; d <= 7; d++) {
      if (d === src || d === area) continue;      // never chain another Chance Meeting
      const spec = policySpecFor(state, d);
      if (spec == null) continue;
      const v = gainValue(state, 'dummy', d);
      if (v > bestV || (v === bestV && best != null && d < best)) { best = d; bestV = v; bestSpec = spec; }
    }
    if (best == null) return null;
    return { chanceSrc: src, chanceDest: best, chanceCount: src === 7 ? 1 : 2, destSpec: bestSpec };
  }
  return null;
}

/** Which Problem the dummy would take if it could pick any (PV first, then
 *  Borderland-bound Crown Problems, ties by face-up order). */
function bestProblemFor(state, seen = []) {
  let best = null, bestKey = null;
  state.problems.forEach((pid, i) => {
    if (seen.includes(pid)) return;
    const pv = pvOf(pid);
    const border = pv === 0 && card(pid).suits.some((s) => areaSuits(state, 7).includes(s)) ? 1 : 0;
    const key = [pv, border, -i];
    if (!bestKey || key.join() > bestKey.join()) { best = pid; bestKey = key; }
  });
  return best;
}

/** The spec the dummy's policy would use to act at area `d`, or null when it
 *  could not drive that effect.  `seen` guards the Penitent recursion;
 *  `current` is where the Confidente stands when the effect runs. */
function policySpecFor(state, d, seen = [], current = state.confidente) {
  const did = state.areas[d];
  if (did === 'the-penitent') {
    const p = bestProblemFor(state, seen);
    if (p == null || state.gold.dummy < 1) return null;
    return { penitent: { problem: p, resolution: dummyResolution(state, p, [...seen, p], current) } };
  }
  if (did === 'the-cave') {
    const t = worstAreaFor(state, 'me');
    if (state.board[t].me < 1) return null;
    return { caveTarget: t };
  }
  if (did === 'the-chance-meeting') return null;   // the policy never chains it
  return {};
}

/** The area where `who` has the most markers (ties → lowest position). */
function worstAreaFor(state, who) {
  let best = 1;
  for (let a = 2; a <= 7; a++) {
    if (state.board[a][who] > state.board[best][who]) best = a;
  }
  return best;
}

/** When out of reserve, the dummy pulls from its most-marked area (ties →
 *  lowest position) — the wiki forbids taking from the Borderland, so that
 *  only happens as a last resort when nothing else holds a marker. */
function forcedSource(state, who, target) {
  if (state.supply[who] > 0) return null;
  let best = null;
  for (let a = 1; a <= 6; a++) {                 // never index 7 unless forced
    if (a === target || state.board[a][who] < 1) continue;
    if (best == null || state.board[a][who] > state.board[best][who]) best = a;
  }
  if (best != null) return best;
  if (target !== 7 && state.board[7][who] > 0) return 7;   // last resort
  return null;
}

/** The dummy's resolution spec for one Problem (also used by the Penitent).
 *  `seen` guards the nested-Penitent recursion; `current` is where the
 *  Confidente stands when this resolution runs. */
export function dummyResolution(state, problemId, seen = [], current = state.confidente) {
  const rank = card(problemId).rank;
  if (typeof rank === 'number') return { symbol: 'rank' };
  // a Crown Problem: prefer the Borderland if one of its suits matches …
  const match = card(problemId).suits.find((s) => areaSuits(state, 7).includes(s));
  if (match) {
    const src = forcedSource(state, 'dummy', 7) ?? (state.board[7].dummy > 0 ? 7 : null);
    if (src != null || state.supply.dummy > 0) {
      return { symbol: match, area: 7, ...(src != null ? { moveFrom: src } : {}) };
    }
  }
  // … else park the Confidente on the parity-matching area the policy can
  // actually use (never where it already stands)
  const suit = card(problemId).suits[0];
  const areas = [];
  for (let a = 1; a <= 6; a++) {
    if (areaSuits(state, a).includes(suit) && current !== a) areas.push(a);
  }
  if (!areas.length) return { symbol: 'crown', confidenteTo: 1, spec: {} };
  const want = state.round % 2 === 0 ? 0 : 1;
  areas.sort((a, b) => ((a % 2 === want) ? 0 : 1) - ((b % 2 === want) ? 0 : 1) || a - b);
  for (const to of areas) {
    const spec = policySpecFor(state, to, seen, to);
    if (spec != null) return { symbol: 'crown', confidenteTo: to, spec };
  }
  // last resort: an area whose effect needs no sub-choice
  const safe = areas.filter((a) =>
    ['the-lunatic', 'the-market', 'the-castle', 'the-borderland'].includes(state.areas[a]));
  return { symbol: 'crown', confidenteTo: safe[0] ?? areas[0], spec: {} };
}

/** The dummy's Problem attempt: only where its sum beats yours. */
export function dummyResolveMove(state) {
  if (state.gold.dummy < 1 || !state.problems.length) return null;
  const better = [];
  state.problems.forEach((pid, i) => {
    if (presenceSum(state, 'dummy', pid) > presenceSum(state, 'me', pid)) better.push({ pid, i });
  });
  if (!better.length) return null;
  // "irá primero siempre al Problema que más PV le otorgue"; among equal-PV
  // Crown Problems prefer one bound for the Borderland; ties by face-up order
  better.sort((a, b) => pvOf(b.pid) - pvOf(a.pid) || a.i - b.i);
  const pvPick = better.find((x) => pvOf(x.pid) > 0);
  const borderPick = better.find((x) =>
    pvOf(x.pid) === 0 && card(x.pid).suits.some((s) => areaSuits(state, 7).includes(s)));
  const pick = pvPick || borderPick || better[0];
  const mv = {
    type: 'attempt', who: 'dummy', problem: pick.i,
    resolution: dummyResolution(state, pick.pid),
  };
  // only commit where the policy's own resolution actually executes
  try { applyMove(state, mv); } catch { return null; }
  return mv;
}

/* ------------------------------------------------- actions & validation */

/** All legal moves for whoever is to act (used by tests and playouts). */
export function legalMoves(state) {
  if (state.over) return [];
  if (state.phase === 'dummy-action') {
    const mv = dummyActionMove(state);
    try { applyMove(state, mv); return [mv]; } catch { return []; }   // never: alarm if it trips
  }
  if (state.phase === 'dummy-resolve') {
    return [dummyResolveMove(state) || { type: 'pass', who: 'dummy' }];
  }
  const out = [];
  const sources = () => {
    if (state.supply.me > 0) return [undefined];
    const s = [];
    for (let a = 1; a <= 7; a++) if (state.board[a].me > 0) s.push(a);
    return s;
  };
  if (state.phase === 'my-action') {
    state.hands.me.forEach((id, h) => {
      for (const suit of card(id).suits) {
        for (let a = 1; a <= 7; a++) {
          if (!areaSuits(state, a).includes(suit)) continue;
          for (const spec of defaultSpecs(state, a)) {
            for (const src of sources()) {
              out.push({
                type: 'area', who: 'me', hand: h, suit, area: a,
                ...(src != null ? { moveFrom: src } : {}),
                ...(spec ? { spec } : {}),
              });
            }
          }
        }
      }
    });
  } else if (state.phase === 'my-resolve') {
    out.push({ type: 'pass', who: 'me' });
    if (state.gold.me >= 1) {
      state.problems.forEach((pid, i) => {
        for (const sym of symbolsOf(pid)) {
          for (const res of defaultResolutions(state, pid, sym)) {
            for (const src of (res.symbol !== 'rank' && res.symbol !== 'crown' ? sources() : [undefined])) {
              out.push({
                type: 'attempt', who: 'me', problem: i,
                resolution: src != null ? { ...res, moveFrom: src } : res,
              });
            }
          }
        }
      });
    }
  }
  // keep only moves that actually apply — self-consistency by construction
  return out.filter((mv) => { try { applyMove(state, mv); return true; } catch { return false; } });
}

/** A plain spec for an area action (no sub-choices where none are needed). */
function defaultSpecs(state, area) {
  const id = state.areas[area];
  if (id === 'the-penitent') {
    if (state.gold.me < 1 || !state.problems.length) return [null];
    return state.problems.map((pid) =>
      ({ penitent: { problem: pid, resolution: defaultResolution(state, pid) } }));
  }
  if (id === 'the-cave') {
    const opp = 'dummy';
    const targets = [];
    for (let a = 1; a <= 7; a++) if (state.board[a][opp] > 0) targets.push(a);
    return targets.length ? targets.map((t) => ({ caveTarget: t })) : [null];
  }
  if (id === 'the-chance-meeting') {
    const own = [];
    for (let a = 1; a <= 7; a++) if (state.board[a].me > 0) own.push(a);
    if (!own.length) return [null];
    const out = [];
    for (const src of own) {
      for (let d = 1; d <= 7; d++) {
        if (d === src) continue;
        out.push({ chanceSrc: src, chanceDest: d, chanceCount: 2 });
      }
    }
    return out;
  }
  return [null];
}

function defaultResolution(state, problemId) {
  const syms = symbolsOf(problemId);
  const sym = syms.includes('rank') ? 'rank' : syms.includes('crown') ? 'crown' : syms[0];
  return defaultResolutions(state, problemId, sym)[0];
}

function defaultResolutions(state, problemId, symbol) {
  if (symbol === 'rank') return [{ symbol: 'rank' }];
  if (symbol === 'crown') {
    const areas = [];
    for (let a = 1; a <= 7; a++) if (state.confidente !== a) areas.push(a);
    return areas.map((a) => ({ symbol: 'crown', confidenteTo: a }));
  }
  const areas = [];
  for (let a = 1; a <= 7; a++) if (areaSuits(state, a).includes(symbol)) areas.push(a);
  const out = [];
  for (const a of areas) {
    for (const spec of defaultSpecs(state, a)) {
      out.push({ symbol, area: a, ...(spec ? { spec } : {}) });
    }
  }
  return out;
}

/* ------------------------------------------------------ the move itself */

function requirePhase(state, phase) {
  if (state.phase !== phase) {
    throw new Error(
      phase === 'dummy-action' ? 'it is the dummy player’s turn to act'
        : phase === 'my-action' ? 'it is your turn to act'
          : phase === 'dummy-resolve' ? 'the dummy player is deciding on the Problems'
            : 'you may attempt a Problem or pass');
  }
}

/** Place (or, out of reserve, move) one of `who`'s markers onto `area`. */
function placeMarker(state, who, area, moveFrom) {
  if (state.supply[who] > 0) {
    state.supply[who] -= 1;
    state.board[area][who] += 1;
    return;
  }
  if (moveFrom == null) {
    throw new Error(who === 'me'
      ? 'you have no markers in reserve — move one from another area first'
      : 'the dummy has no markers in reserve — one must come from another area');
  }
  if (!Number.isInteger(moveFrom) || moveFrom < 1 || moveFrom > 7 || moveFrom === area) {
    throw new Error('choose a different area to move the marker from');
  }
  if (state.board[moveFrom][who] < 1) {
    throw new Error(`${areaName(moveFrom)} has none of those markers to move`);
  }
  state.board[moveFrom][who] -= 1;
  state.board[area][who] += 1;
}

/** Execute an area's effect.  `state` already has the visitor's marker. */
function runAreaEffect(state, who, area, spec = {}, depth = 0) {
  if (depth > 3) throw new Error('that chain of effects nests too deeply');
  const opp = who === 'me' ? 'dummy' : 'me';
  const id = state.areas[area];

  if (id === 'the-excuse') throw new Error('the Excuse only marks the barbarians — it is not an action area');
  if (id === 'the-borderland') return;         // defence only

  if (id === 'the-lunatic') {
    if (state.gold[who] < GOLD_CAP && state.general.gold > 0) {
      state.general.gold -= 1; state.gold[who] += 1;
    }
    if (state.supply[who] < MARKER_CAP && state.general[who] > 0) {
      state.general[who] -= 1; state.supply[who] += 1;
    }
    return;
  }

  if (id === 'the-market' || id === 'the-castle') {
    const n = state.board[area][who] + (state.confidente === area ? 1 : 0);
    if (id === 'the-market') {
      const g = Math.min(n, GOLD_CAP - state.gold[who], state.general.gold);
      state.gold[who] += g; state.general.gold -= g;
    }
    const m = Math.min(n, MARKER_CAP - state.supply[who], state.general[who]);
    state.supply[who] += m; state.general[who] -= m;
    return;
  }

  if (id === 'the-cave') {
    const t = spec.caveTarget;
    if (!Number.isInteger(t) || t < 1 || t > 7) throw new Error('choose an area to take the marker from');
    if (state.board[t][opp] < 1) {
      throw new Error(`${areaName(t)} has no marker of the other side to remove`);
    }
    state.board[t][opp] -= 1;
    state.general[opp] += 1;
    return;
  }

  if (id === 'the-chance-meeting') {
    const { chanceSrc: src, chanceDest: dest, chanceCount: count } = spec;
    if (!Number.isInteger(src) || src < 1 || src > 7 || !Number.isInteger(dest) || dest < 1 || dest > 7) {
      throw new Error('choose a source area and a destination area');
    }
    if (src === dest) throw new Error('the Chance Meeting moves markers to a different area');
    const have = state.board[src][who];
    if (have < 1) throw new Error(`${areaName(src)} has none of your markers to move`);
    const k = Math.min(count === 1 ? 1 : 2, have);
    state.board[src][who] -= k;
    state.board[dest][who] += k;
    runAreaEffect(state, who, dest, spec.destSpec || {}, depth + 1);
    return;
  }

  if (id === 'the-penitent') {
    const sub = spec.penitent;
    if (!sub) throw new Error('the Penitent resolves one Problem — choose which');
    if (state.gold[who] < 1) throw new Error('the Penitent’s resolution costs 1 gold and you have none');
    const idx = state.problems.indexOf(sub.problem);
    if (idx < 0) throw new Error('that Problem is not on the table');
    state.gold[who] -= 1;
    state.general.gold += 1;
    state.problems.splice(idx, 1);              // resolved: not replenished
    runResolution(state, who, sub.problem, sub.resolution, depth + 1);
    // a Problem resolved without being taken as PV is spent
    if (state.pv.me.indexOf(sub.problem) < 0 && state.pv.dummy.indexOf(sub.problem) < 0 &&
        state.problemDiscard.indexOf(sub.problem) < 0) {
      state.problemDiscard.push(sub.problem);
    }
    return;
  }
  throw new Error(`unknown area ${id}`);
}

/** Execute a Problem resolution for `who`. */
function runResolution(state, who, problemId, resolution, depth = 0) {
  if (depth > 3) throw new Error('that chain of effects nests too deeply');
  if (!resolution || typeof resolution !== 'object') throw new Error('choose how to resolve the Problem');
  const syms = symbolsOf(problemId);
  const sym = resolution.symbol;
  if (!syms.includes(sym)) {
    throw new Error(`${card(problemId).name} shows ${syms.join(', ')} — not ${sym}`);
  }

  if (sym === 'rank') {
    state.pv[who].push(problemId);
    return;
  }

  if (sym === 'crown') {
    const to = resolution.confidenteTo;
    if (!Number.isInteger(to) || to < 1 || to > 7) throw new Error('choose where the Confidente goes');
    if (state.confidente != null && to === state.confidente) {
      throw new Error('once placed, the Confidente must move to a different area');
    }
    state.confidente = to;
    runAreaEffect(state, who, to, resolution.spec || {}, depth + 1);
    return;
  }

  // a suit symbol: place (or move) a marker on a matching area, then act
  const area = resolution.area;
  if (!Number.isInteger(area) || area < 1 || area > 7) throw new Error('choose a matching area');
  if (!areaSuits(state, area).includes(sym)) {
    throw new Error(`${areaName(area)} does not show the ${sym} symbol`);
  }
  placeMarker(state, who, area, resolution.moveFrom);
  runAreaEffect(state, who, area, resolution.spec || {}, depth + 1);
}

/** Apply the barbarian attack and score.  Exported for the endgame fixtures. */
export function endgame(next) {
  const defense = next.board[7].me;
  const threshold = MAX_BARBARIANS - next.barbarians + defense;
  const lost = next.pv.me.filter((id) => rankValue(card(id)) >= threshold);
  const keep = next.pv.me.filter((id) => rankValue(card(id)) < threshold);
  next.pv.me = keep;
  next.problemDiscard.push(...lost);
  next.score = keep.reduce((n, id) => n + rankValue(card(id)), 0);
  next.over = next.score >= 1 ? 'won' : 'lost';
  next.phase = 'over';
  next.log = next.over === 'won'
    ? `The barbarians strike at power ${next.barbarians}; your frontier holds ${defense}. ` +
      `You keep ${next.score} PV — the kingdom survives.`
    : `The barbarians strike at power ${next.barbarians}; your frontier holds ${defense}. ` +
      `Every Prestige card is swept away — the barbarians win.`;
}

/** After both sides have had their say: resolve the contests, then the round. */
function resolveRound(next) {
  const faceUp = next.problems.slice();
  const spent = (pid) =>
    next.pv.me.indexOf(pid) >= 0 || next.pv.dummy.indexOf(pid) >= 0 ||
    next.problemDiscard.indexOf(pid) >= 0;
  const resolvedNow = [];

  for (let i = 0; i < faceUp.length; i++) {
    const pid = faceUp[i];
    if (spent(pid)) continue;                   // consumed by an earlier nested effect
    const interested = [];
    if (next.dummyAttempt && next.dummyAttempt.problem === i) interested.push('dummy');
    if (next.myAttempt && next.myAttempt.problem === i) interested.push('me');
    if (!interested.length) continue;
    let winner;
    if (interested.length === 1) winner = interested[0];
    else {
      // highest sum wins; a tie goes to whoever tried first — the dummy
      winner = presenceSum(next, 'dummy', pid) >= presenceSum(next, 'me', pid) ? 'dummy' : 'me';
    }
    // take the Problem off the table before anyone acts on it, so a nested
    // Penitent cannot re-take a card already claimed
    const at = next.problems.indexOf(pid);
    if (at >= 0) next.problems.splice(at, 1);
    if (winner === 'dummy') {
      // execute the spec it committed to; if the world moved under it (say
      // you parked the Confidente where it planned to), fall back to the
      // policy, and if even that fails, its attempt simply fails
      const tryExec = (spec) => {
        const sim = structuredClone(next);
        try { runResolution(sim, 'dummy', pid, spec); return sim; } catch { return null; }
      };
      const done = tryExec(next.dummyAttempt.resolution) || tryExec(dummyResolution(next, pid));
      if (done) Object.assign(next, done);
    } else {
      runResolution(next, 'me', pid, next.myAttempt.resolution);
    }
    resolvedNow.push(pid);
    if (!spent(pid)) next.problemDiscard.push(pid);   // resolved without taking it as PV
  }

  const unresolved = faceUp.filter((pid) => !spent(pid) && resolvedNow.indexOf(pid) < 0);
  if (unresolved.length) {
    next.barbarians = Math.min(MAX_BARBARIANS, next.barbarians + unresolved.length);
  }
  next.problemDiscard.push(...unresolved);

  next.problems = [];
  next.dummyAttempt = null;
  next.myAttempt = null;
  next.round += 1;

  if (next.round > ROUNDS) { endgame(next); return; }

  const draw = () => next.problemDeck.pop() || null;
  next.problems = [draw(), draw()].filter(Boolean);
  next.phase = 'dummy-action';
  next.log = `Round ${next.round}: the dummy player acts first.`;
}

/** Apply one move.  Returns a NEW state; throws with a readable reason. */
export function applyMove(state, move) {
  if (state.over) throw new Error('the game is over');
  if (!move || typeof move !== 'object') throw new Error('choose a move first');
  const next = structuredClone(state);
  const t = move.type;
  const who = move.who;
  if (who !== 'me' && who !== 'dummy') throw new Error('moves are made by you or the dummy player');

  if (t === 'area') {
    if (who === 'dummy' && next.phase !== 'dummy-action') throw new Error('it is not the dummy player’s action');
    if (who === 'me' && next.phase !== 'my-action') throw new Error('it is not your action — wait for the dummy');
    const hand = move.hand;
    const id = next.hands[who][hand];
    if (!id) throw new Error(`${who === 'me' ? 'select a card in your hand' : 'the dummy plays its front card'}`);
    if (who === 'dummy' && hand !== 0) throw new Error('the dummy plays the first card of its action hand');
    const suits = card(id).suits;
    if (!suits.includes(move.suit)) throw new Error(`${card(id).name} has no ${move.suit} symbol`);
    const area = move.area;
    if (!Number.isInteger(area) || area < 1 || area > 7) {
      throw new Error('choose one of the seven areas of the Kingdom');
    }
    if (!areaSuits(next, area).includes(move.suit)) {
      throw new Error(`${areaName(area)} does not show the ${move.suit} symbol`);
    }
    placeMarker(next, who, area, move.moveFrom);
    runAreaEffect(next, who, area, move.spec);
    next.hands[who].splice(hand, 1);
    next.discards[who].push(id);               // last action stays on top, visible
    next.moves += 1;
    next.log = who === 'me'
      ? `You play ${card(id).name} → ${areaName(area)}.`
      : `The dummy plays ${card(id).name} → ${areaName(area)}.`;
    next.phase = who === 'dummy' ? 'my-action' : 'dummy-resolve';

  } else if (t === 'attempt' || t === 'pass') {
    if (who === 'dummy') {
      requirePhase(next, 'dummy-resolve');
      if (t === 'attempt') {
        const i = move.problem;
        if (!Number.isInteger(i) || !next.problems[i]) throw new Error('the dummy attempts one of the face-up Problems');
        if (next.gold.dummy < 1) throw new Error('the dummy has no gold to attempt a Problem');
        // validate its spec before paying
        runResolution(structuredClone(next), 'dummy', next.problems[i], move.resolution);
        next.gold.dummy -= 1;
        next.general.gold += 1;
        next.dummyAttempt = { problem: i, resolution: move.resolution };
        next.log = 'The dummy pays 1 gold and commits to a Problem.';
      } else {
        next.log = 'The dummy passes on the Problems.';
      }
      next.phase = 'my-resolve';

    } else {
      requirePhase(next, 'my-resolve');
      if (t === 'attempt') {
        const i = move.problem;
        if (!Number.isInteger(i) || !next.problems[i]) throw new Error('attempt one of the face-up Problems');
        if (next.gold.me < 1) throw new Error('attempting a Problem costs 1 gold and you have none');
        runResolution(structuredClone(next), 'me', next.problems[i], move.resolution);
        next.gold.me -= 1;
        next.general.gold += 1;
        next.myAttempt = { problem: i, resolution: move.resolution };
        next.log = `You pay 1 gold and commit to ${card(next.problems[i]).name}.`;
      } else {
        next.log = 'You pass on the Problems this round.';
      }
      next.moves += 1;
      resolveRound(next);
    }

  } else {
    throw new Error(`unknown move ${t}`);
  }

  return next;
}

export const OUTCOME = {
  won: { title: 'The kingdom endures', cls: 'win' },
  lost: { title: 'The barbarians win', cls: 'lose' },
};

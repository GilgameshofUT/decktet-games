/* Thricewise — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:thricewise  (P.D. Magnus)
 *
 * Two players hold three cards each over a 2x2 of cards dealt face up.  Every
 * turn both players secretly choose one card; both are then revealed and laid
 * into the growing grid, lowest rank first (a tie defers both cards, face up,
 * to a later turn).  A card may only go next to the grid, and the grid may not
 * grow beyond 6x6.  Whenever your card completes three in a row — a flush
 * (one suit shared by all three), a set (one rank) or a straight (three
 * consecutive ranks) — you score the rank of the lowest number card in that
 * threesome, once for each kind it makes.
 *
 * Interpretations (all stated on the rules page):
 *   1. Simultaneity on one device: each player chooses behind the pass screen,
 *      then both choices are revealed together.  `conceal()` is the only view
 *      the UI renders, and it never carries the other player's pick.
 *   2. A straight is three consecutive rank values (Ace 1 … Crown 10, no
 *      wrap); three equal ranks are a set, never also a straight.
 *   3. A three-card line sharing two suits scores two flushes (the wiki's
 *      second example), and each kind found on the same three cards scores
 *      separately.
 *   4. Deferred cards join your next able turn, laid after your new card
 *      (the wiki leaves the order inside a turn to the player; here it is
 *      new card first, then deferred cards oldest first).
 *   5. The grid is a floating 6x6 window: the dealt 2x2 may be extended on
 *      any side while its bounding box stays within 6x6, so the starting
 *      cards end up anywhere in the finished grid.
 *   6. The game ends the moment the 36th card is laid, or at the end of a
 *      turn in which either hand emptied; deferred cards still face up are
 *      then never played. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));        // Ace 1 … 9, Crown 10
export const suitsOf = (id) => card(id).suits;

export const SIZE = 6;
export const HAND_SIZE = 3;
export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];

const STARTING = [[0, 0], [0, 1], [1, 0], [1, 1]];         // the dealt 2x2
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const cellKey = (r, c) => `${r},${c}`;

export function gridMap(cells) {
  const m = new Map();
  for (const { r, c, id } of cells) m.set(cellKey(r, c), id);
  return m;
}

export function bounds(cells) {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const { r, c } of cells) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, maxR, minC, maxC };
}

/* ------------------------------------------------------------------ setup */

export function newGame(seed, deck) {
  const rng = mulberry32(seed);
  const shuffled = deck.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return {
    seed,
    grid: STARTING.map(([r, c], i) => ({ r, c, id: shuffled[i] })),
    hands: [shuffled.slice(4, 4 + HAND_SIZE), shuffled.slice(7, 10)],
    deck: shuffled.slice(10),
    deferred: [[], []],        // face up in front of their player, public
    picks: [null, null],       // this turn's secret choices
    choosing: 0,               // whose secret choice is due
    queue: [],                 // the revealed cards, in laying order
    reveal: null,              // { picks } once both are locked in
    turnPlacements: [],        // placements of the turn just resolved
    phase: 'choose',           // 'choose' | 'place' | 'recap'
    scores: [0, 0],
    log: [],                   // one entry per turn, newest last
    turn: 1,
    moves: 0,
    over: null,
    winner: null,
  };
}

export const laid = (state) => state.grid.length;

/* ------------------------------------------------------------------ moves */

export function canChoose(state, player, id) {
  return state.phase === 'choose' && !state.over &&
    player === state.choosing && state.hands[player].includes(id);
}

/** Player `player` locks in `id`.  When both have chosen, the turn resolves. */
export function choose(state, player, id) {
  if (!canChoose(state, player, id)) throw new Error('you cannot choose that card now');
  const next = structuredClone(state);
  next.picks[player] = id;
  if (next.picks[0] != null && next.picks[1] != null) return resolveTurn(next);
  next.choosing = 1 - next.choosing;
  return next;
}

/** Both picks are in: defer a tie, otherwise queue both cards by rank. */
function resolveTurn(next) {
  const [a, b] = next.picks;
  if (rankOf(a) === rankOf(b)) {
    // same rank: both cards are deferred, face up, and may be played later
    for (let p = 0; p < 2; p++) {
      const hand = next.hands[p];
      hand.splice(hand.indexOf(next.picks[p]), 1);
      next.deferred[p].push(next.picks[p]);
    }
    next.log.push({
      turn: next.turn, deferred: true, picks: [a, b],
      placements: [], scores: next.scores.slice(), drew: false,
    });
    next.picks = [null, null];
    next.choosing = 0;
    // if the deferred cards were the last in hand, nobody can choose again
    if (!next.hands[0].length || !next.hands[1].length) {
      next.phase = 'recap';
      finish(next);
    } else {
      next.phase = 'choose';
    }
    return next;
  }

  const low = rankOf(a) < rankOf(b) ? 0 : 1;
  const queue = [];
  for (const p of [low, 1 - low]) {
    queue.push({ player: p, id: next.picks[p] });          // the new card first
    for (const d of next.deferred[p]) queue.push({ player: p, id: d });
  }
  next.queue = queue;
  next.reveal = { picks: [a, b] };
  next.turnPlacements = [];
  next.phase = 'place';
  return next;
}

/** Squares the queue head may be laid on: touching the grid, inside 6x6. */
export function legalCells(state) {
  if (state.over || state.phase !== 'place') return [];
  const filled = gridMap(state.grid);
  const b = bounds(state.grid);
  const out = [];
  const seen = new Set();
  for (const { r, c } of state.grid) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc, k = cellKey(nr, nc);
        if (filled.has(k) || seen.has(k)) continue;
        seen.add(k);
        const height = Math.max(b.maxR, nr) - Math.min(b.minR, nr) + 1;
        const width = Math.max(b.maxC, nc) - Math.min(b.minC, nc) + 1;
        if (height <= SIZE && width <= SIZE) out.push({ r: nr, c: nc });
      }
    }
  }
  out.sort((x, y) => x.r - y.r || x.c - y.c);
  return out;
}

/** Lay the queue head at (r, c) and score it. */
export function place(state, r, c) {
  if (state.phase !== 'place' || state.over) throw new Error('nothing to lay right now');
  if (!legalCells(state).some((x) => x.r === r && x.c === c)) {
    throw new Error('that square must touch the grid and keep it within 6x6');
  }
  const next = structuredClone(state);
  const head = next.queue[0];
  // a new pick leaves the hand; a deferred card leaves the face-up row
  const hand = next.hands[head.player];
  const inHand = hand.indexOf(head.id);
  if (inHand >= 0) hand.splice(inHand, 1);
  else {
    const row = next.deferred[head.player];
    const at = row.indexOf(head.id);
    if (at < 0) throw new Error(`${head.id} is nowhere to be laid from`);
    row.splice(at, 1);
  }
  next.grid.push({ r, c, id: head.id });
  const sc = scoreAt(next.grid, r, c);
  next.scores[head.player] += sc.points;
  next.turnPlacements.push({
    player: head.player, id: head.id, r, c,
    points: sc.points, kinds: sc.kinds,
  });
  next.queue.shift();
  if (next.queue.length) return next;
  return endTurn(next);
}

function endTurn(next) {
  const drew = next.deck.length >= HAND_SIZE;      // enough for everyone or nobody
  if (drew) {
    for (let p = 0; p < 2; p++) next.hands[p].push(next.deck.shift());
  }
  next.log.push({
    turn: next.turn, deferred: false, picks: next.reveal.picks,
    placements: next.turnPlacements.slice(), scores: next.scores.slice(), drew,
  });
  next.moves += next.turnPlacements.length;
  next.queue = [];
  next.reveal = null;
  next.phase = 'recap';
  if (next.grid.length === SIZE * SIZE || !next.hands[0].length || !next.hands[1].length) {
    finish(next);
  }
  return next;
}

/** From the recap screen, start the next simultaneous choice. */
export function beginTurn(state) {
  if (state.phase !== 'recap' || state.over) throw new Error('the turn is not over yet');
  const next = structuredClone(state);
  next.picks = [null, null];
  next.choosing = 0;
  next.turnPlacements = [];
  next.phase = 'choose';
  next.turn += 1;
  return next;
}

function finish(next) {
  next.over = 'done';
  const [a, b] = next.scores;
  next.winner = a === b ? null : (a > b ? 0 : 1);
}

/* --------------------------------------------------------------- scoring */

/**
 * One three-in-a-row: flushes (one per suit all three share), a set, a
 * straight.  Each kind is worth the rank of the lowest *number* card in the
 * three (Aces and Crowns are not number cards, so three of them score 0).
 */
export function tripleScore(ids) {
  if (ids.length !== 3) return { points: 0, value: 0, kinds: [] };
  const suits = ids.map(suitsOf);
  const kinds = [];
  for (const s of SUITS) {
    if (suits[0].includes(s) && suits[1].includes(s) && suits[2].includes(s)) {
      kinds.push({ kind: 'flush', suit: s });
    }
  }
  const ranks = ids.map(rankOf);
  if (ranks[0] === ranks[1] && ranks[1] === ranks[2]) kinds.push({ kind: 'set' });
  const sorted = [...ranks].sort((x, y) => x - y);
  if (sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1) kinds.push({ kind: 'straight' });
  const numbers = ranks.filter((r) => r >= 2 && r <= 9);
  const value = numbers.length ? Math.min(...numbers) : 0;
  return { points: value * kinds.length, value, kinds };
}

/** What the card at (r, c) scores, once per three-in-a-row it takes part in. */
export function scoreAt(cells, r, c) {
  const m = gridMap(cells);
  if (m.get(cellKey(r, c)) == null) return { points: 0, kinds: [] };
  const seen = new Set();
  let points = 0;
  const kinds = [];
  for (const [dr, dc] of DIRS) {
    for (const [o1, o2] of [[1, 2], [-1, 1], [-2, -1]]) {
      const keys = [
        cellKey(r + dr * o1, c + dc * o1),
        cellKey(r + dr * o2, c + dc * o2),
      ];
      if (!keys.every((k) => m.has(k))) continue;
      const sig = [cellKey(r, c), ...keys].sort().join('|');
      if (seen.has(sig)) continue;                 // never score one line twice
      seen.add(sig);
      const ids = [m.get(cellKey(r, c)), ...keys.map((k) => m.get(k))];
      const sc = tripleScore(ids);
      if (sc.kinds.length) {                          // even three crowns, worth 0
        points += sc.points;
        kinds.push({ cells: sig.split('|'), ids, ...sc });
      }
    }
  }
  return { points, kinds };
}

export const rankLabel = (r) => (r === 10 ? 'Crown' : r === 1 ? 'Ace' : String(r));

/** "flush of suns +8 · straight 8–9–Crown +8" — one line for a placement. */
export function describePlacement(entry) {
  const parts = [];
  for (const line of entry.kinds) {
    for (const k of line.kinds) {
      if (k.kind === 'flush') parts.push(`flush of ${k.suit} +${line.value}`);
      else if (k.kind === 'set') parts.push(`set +${line.value}`);
      else {
        const rs = line.ids.map((id) => rankOf(id)).sort((x, y) => x - y);
        parts.push(`straight ${rs.map(rankLabel).join('–')} +${line.value}`);
      }
    }
  }
  return parts.length ? parts.join(' · ') : 'nothing';
}

/* --------------------------------------------------------------- privacy */

/**
 * The render-safe view of the state for `viewer` (0 | 1 | null).
 *
 * While the players are choosing, nobody's pick is exposed — picks collapse
 * to true/false — and a hand is only ever visible to its own owner.  This is
 * the only shape the UI renders, so an un-revealed choice cannot leak. */
export function conceal(state, viewer) {
  const pub = structuredClone(state);
  pub.hands = [viewer === 0 ? pub.hands[0] : null, viewer === 1 ? pub.hands[1] : null];
  if (pub.phase === 'choose') {
    pub.picks = pub.picks.map((p) => (p == null ? null : true));
  }
  return pub;
}

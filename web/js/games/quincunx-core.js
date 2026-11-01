/* Quincunx — game logic, no DOM.  Solitaire variant.
 *
 * Rules: https://wiki.decktet.com/game:quincunx  (Chris DeLeo, rules text
 * P.D. Magnus; solitaire variant by Jack Neal)
 *
 * The solitaire game is played on a 4x4 grid (the spread).  Four corner cards
 * are dealt (the "Blank Slate" setup deals one card instead) and you hold a
 * hand of 8 (12 in Blank Slate).  Each turn you play one card from your hand
 * into an empty square and score for the joins it makes: basic scoring per
 * orthogonally adjacent card (a positive sum with a matching Ace, negative
 * without, 0 at 10, a card drawn at 11 and 20, sum minus ten from 12 to 19),
 * +5 per adjacent pair, +20 per completed straight and +30 per completed
 * three of a kind (horizontal and vertical only — never diagonal in
 * solitaire), and a power play when an Ace or Crown joins an Ace or Crown of
 * the same suit.  Filling the spread ends the game; cards left in hand are a
 * penalty.  Running out of hand cards before the spread is full is a loss.
 *
 * Interpretations (all stated on the rules page):
 *   1. The wiki's default setup deals 5 cards in a 5x5 spread (2-4 players);
 *      the solitaire section prescribes 4x4 with corners + an 8 card hand.
 *      The revised Decktet Book made the one-card "Blank Slate" start the
 *      default for the multiplayer game, so this app offers both starts:
 *      "corners" (the wiki's solitaire setup) and "slate" (one card + a 12
 *      card hand + adjacency-only placement, keeping the grid a fixed 4x4).
 *   2. Straights and threes of a kind "may not be scored on diagonals" in
 *      solitaire, so every bonus here is horizontal or vertical only.
 *   3. "Cards that contribute to three of a kind may not be scored as pairs"
 *      is read as: a same-rank neighbour lying in a completed three-of-a-kind
 *      line through the played card scores no pair; other same-rank
 *      neighbours still do.
 *   4. A completed line scores once per direction — a four card straight
 *      through the played card is one straight (20), not two, but straights
 *      in two directions score twice (40).
 *   5. The power play adds the ranks of every *other* card of the suit in the
 *      spread (the wiki's "as many as 44" assumes all of a suit's numbered
 *      cards are showing; the ace and crown of the suit count too). */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const SIZE = 4;
export const CELLS = SIZE * SIZE;
export const CORNERS = [0, SIZE - 1, CELLS - SIZE, CELLS - 1];
export const VARIANTS = { corners: { hand: 8, label: 'four corners' }, slate: { hand: 12, label: 'blank slate' } };

/* ---------------------------------------------------------------- setup */

export function newGame(seed, deck, variant = 'corners') {
  const v = VARIANTS[variant] ? variant : 'corners';
  const rng = mulberry32(seed);
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }

  const grid = Array(CELLS).fill(null);
  if (v === 'slate') {
    grid[Math.floor(rng() * CELLS)] = d.pop();
  } else {
    for (const c of CORNERS) grid[c] = d.pop();
  }
  const hand = d.splice(d.length - VARIANTS[v].hand, VARIANTS[v].hand);

  const st = { seed, variant: v, grid, hand, deck: d, score: 0, draws: 0, moves: 0, last: null, over: null };
  settle(st);
  return st;
}

/** Squares the rules allow this turn (independent of which card you hold). */
export function legalCells(state) {
  if (state.over) return [];
  if (state.variant !== 'slate') return state.grid.map((_, i) => i).filter((i) => !state.grid[i]);
  if (!state.grid.some(Boolean)) return state.grid.map((_, i) => i);   // first card: anywhere
  const out = [];
  for (let i = 0; i < CELLS; i++) {
    if (state.grid[i]) continue;
    if (neighbours(i).some((n) => state.grid[n])) out.push(i);
  }
  return out;
}

export function neighbours(i) {
  const r = Math.floor(i / SIZE), c = i % SIZE;
  const out = [];
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  return out;
}

export const canPlace = (state, cell) =>
  Number.isInteger(cell) && legalCells(state).includes(cell);

/* --------------------------------------------------------------- play */

/** Place `cardId` from the hand on `cell`; returns a NEW state. */
export function applyMove(state, cell, cardId) {
  if (state.over) throw new Error('the game is over');
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) throw new Error('bad square');
  if (state.grid[cell]) throw new Error('that square is already filled');
  if (!canPlace(state, cell)) {
    throw new Error('blank slate: play on a square that touches a card already in play');
  }
  const idx = state.hand.indexOf(cardId);
  if (idx < 0) throw new Error('that card is not in your hand');

  const next = structuredClone(state);
  next.grid[cell] = cardId;
  next.hand.splice(idx, 1);

  const play = scorePlacement(next.grid, cell, cardId);
  next.score += play.total;
  drawCards(next, play.draws);
  next.draws += play.draws;
  next.moves += 1;
  next.last = play;
  settle(next);
  return next;
}

function drawCards(state, n) {
  for (let i = 0; i < n && state.deck.length; i++) state.hand.push(state.deck.shift());
}

/** End-of-game conditions: a full spread wins, an empty hand loses. */
export function settle(state) {
  if (state.over) return state.over;
  if (state.grid.every(Boolean)) state.over = 'won';
  else if (!state.hand.length) state.over = 'lost';
  return state.over;
}

export const filled = (state) => state.grid.filter(Boolean).length;

/** What a hand still costs: Aces 15, Crowns 10, number cards their rank. */
export function handPenalty(hand) {
  return hand.reduce((n, id) => n - (rankOf(id) === 1 ? 15 : rankOf(id) === 10 ? 10 : rankOf(id)), 0);
}

/** The final score: running total less the cards still in hand (win only). */
export function finalScore(state) {
  return state.over === 'won' ? state.score + handPenalty(state.hand) : state.score;
}

/* ------------------------------------------------------------- scoring */

const cellAt = (r, c) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : -1);

/**
 * Score playing `id` on `cell` of a grid that already contains it.
 * Every bonus is horizontal/vertical (solitaire bans diagonals).
 */
export function scorePlacement(grid, cell, id) {
  const r = Math.floor(cell / SIZE), c = cell % SIZE;
  const me = rankOf(id);
  const res = {
    cell, id, basic: [], basicPoints: 0, draws: 0,
    pairs: [], straights: [], threes: [], power: null, total: 0,
  };

  const nbrs = [cellAt(r, c - 1), cellAt(r, c + 1), cellAt(r - 1, c), cellAt(r + 1, c)]
    .filter((x) => x >= 0 && grid[x]);

  /* basic scoring, one entry per occupied side */
  for (const n of nbrs) {
    const other = grid[n];
    const sum = me + rankOf(other);
    let points = 0;
    let draw = false;
    if (sum <= 9) {
      const ace = rankOf(id) === 1 ? id : rankOf(other) === 1 ? other : null;
      const rest = ace === id ? other : id;
      if (ace && suitsOf(ace).some((s) => suitsOf(rest).includes(s))) points = sum;
      else points = -sum;
    } else if (sum === 10) {
      points = 0;
    } else if (sum === 11 || sum === 20) {
      draw = true;
    } else {
      points = sum - 10;                       // 12 … 19
    }
    res.basic.push({ cell: n, sum, points, draw });
    res.basicPoints += points;
    if (draw) res.draws += 1;
  }

  /* straights and threes of a kind, one score per direction */
  const voidedPairs = new Set();
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const arm = (sr, sc) => {
      const out = [];
      let rr = r + sr, cc = c + sc, prev = me, sign = 0;
      for (;;) {
        const ix = cellAt(rr, cc);
        if (ix < 0 || grid[ix] == null) break;
        const d = rankOf(grid[ix]) - prev;
        if (sign === 0) { if (d !== 1 && d !== -1) break; sign = d; }
        else if (d !== sign) break;
        out.push(ix);
        prev = rankOf(grid[ix]);
        rr += sr; cc += sc;
      }
      return out;
    };
    const sameArm = (sr, sc) => {              // same-rank run, for threes
      const out = [];
      let rr = r + sr, cc = c + sc;
      for (;;) {
        const ix = cellAt(rr, cc);
        if (ix < 0 || grid[ix] == null || rankOf(grid[ix]) !== me) break;
        out.push(ix);
        rr += sr; cc += sc;
      }
      return out;
    };
    const a = arm(-dr, -dc);                   // one way
    const b = arm(dr, dc);                     // the other

    /* a straight: both arms monotonic in opposite directions (one line),
       or a long enough arm ending at the played card */
    const through = a.length && b.length
      && (rankOf(grid[a[a.length - 1]]) - me) === -(rankOf(grid[b[b.length - 1]]) - me);
    const straightLen = through ? 1 + a.length + b.length : Math.max(1 + a.length, 1 + b.length);
    if (straightLen >= 3) res.straights.push({ dir: dr ? 'v' : 'h', length: straightLen });

    /* three of a kind: same-rank runs on either side, any sign */
    const ra = sameArm(-dr, -dc), rb = sameArm(dr, dc);
    const threeLen = 1 + ra.length + rb.length;
    if (threeLen >= 3) {
      res.threes.push({ dir: dr ? 'v' : 'h', length: threeLen });
      for (const ix of ra.concat(rb)) voidedPairs.add(ix);
    }
  }

  /* pair bonus: same rank next door, unless voided by a three of a kind */
  for (const n of nbrs) {
    if (rankOf(grid[n]) !== me) continue;
    if (voidedPairs.has(n)) continue;
    res.pairs.push({ cell: n, points: 5 });
  }

  /* power play: an Ace or Crown joining an Ace or Crown of the same suit */
  if (me === 1 || me === 10) {
    const suit = suitsOf(id).find((s) =>
      nbrs.some((n) => (rankOf(grid[n]) === 1 || rankOf(grid[n]) === 10) && suitsOf(grid[n]).includes(s)));
    if (suit) {
      let sum = 0;
      for (let i = 0; i < grid.length; i++) {
        if (i === cell || !grid[i]) continue;
        if (suitsOf(grid[i]).includes(suit)) sum += rankOf(grid[i]);
      }
      res.power = { suit, points: sum };
    }
  }

  res.total = res.basicPoints
    + res.pairs.reduce((n, p) => n + p.points, 0)
    + res.straights.length * 20
    + res.threes.length * 30
    + (res.power ? res.power.points : 0);
  return res;
}

/** One-line breakdown of a play for the UI, e.g. "… = +14, drew 1". */
export function describePlay(play) {
  if (!play) return '';
  const rankName = (r) => (r === 10 ? 'Crowns' : r === 1 ? 'Aces' : `${r}s`);
  const parts = [];
  if (play.basic.length) {
    const bits = play.basic.map((b) => (b.draw ? 'draw' : `${b.points >= 0 ? '+' : ''}${b.points}`));
    parts.push(`basic ${bits.join(' / ')}`);
  }
  if (play.pairs.length) parts.push(`pair${play.pairs.length > 1 ? 's' : ''} +${play.pairs.length * 5}`);
  for (const s of play.straights) parts.push(`straight (${s.length}) +20`);
  for (const t of play.threes) parts.push(`three of a kind (${t.length}) +30`);
  if (play.power) parts.push(`power play ${rankName(rankOf(play.id))} of ${play.power.suit} +${play.power.points}`);
  if (!parts.length) parts.push('nothing');
  const drawn = play.draws ? `, drew ${play.draws}` : '';
  return `${parts.join(' · ')} = ${play.total >= 0 ? '+' : ''}${play.total}${drawn}`;
}

export const OUTCOME = {
  won: { title: 'Spread complete', cls: 'win', text: 'Every square of the spread is filled.' },
  lost: { title: 'Out of cards', cls: 'lose', text: 'Your hand ran out before the spread was full.' },
};

/* Caravan — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:caravan  (P.D. Magnus)
 *
 * Two caravans cross the desert.  Each hand is a series of *trade seasons*:
 * one player lays down a *caravan* (a run of consecutive number cards where
 * neighbours share a suit — Aces and Crowns stand in for number ranks), the
 * other answers with a higher caravan or a *bandit* (a lone Ace, a lone
 * Crown, or an Ace and Crown together — bandits beat every caravan), until
 * one of them passes.  The season's cards are collected and scored at the
 * end of the hand against the two market cards turned up at the start: a
 * Crown's suit scores, an Ace's suit costs.  First to empty their hand scores
 * five points plus one per card left in the other's hand.
 *
 * Interpretations (each also noted on the rules page):
 *   1. Setup arithmetic: "shuffle them separately, and deal four to each
 *      player" reads as 2 Aces + 2 Crowns each; the remaining 4 (2+2) form a
 *      mini-pile from which the two market cards are flipped, with the wiki's
 *      same-suit rejection ("set aside the second one and flip over one of
 *      the two remaining"), so the market cards always carry different suits
 *      while still allowing both-Aces / both-Crowns markets.
 *   2. "Wild cards" in the wiki are the Aces and Crowns of the previous
 *      sentence — no other card is wild.  On that reading the basic game is
 *      complete and nothing is missing.
 *   3. "Sequential" caravans read as ascending (every wiki example is
 *      ascending, and "higher" comparisons presuppose it).
 *   4. A caravan is beaten by one of the same length with a higher top card.
 *      For consecutive runs that is the same as every card being higher.
 *   5. Two same-suit Ace+Crown bandits tie ("beat everything else"), so
 *      neither beats the other.
 *   6. The season opener must play a caravan; only answers may be bandits.
 *      The final reply after someone goes out follows the usual
 *      beat-or-pass rule, and passing it always ends the hand.
 *   7. If the final reply also empties that player's hand, both score the
 *      five-point going-out bonus (zero leftovers each).
 *   8. Five hands per match (the wiki's suggested length); the lower score
 *      opens each later hand, and on a tie the player who did not open the
 *      previous hand does. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));    // Ace 1 … 9, Crown 10
export const suitsOf = (id) => card(id).suits;

export const isAce = (id) => card(id).rank === 1;
export const isCrown = (id) => card(id).rank === 'crown';
/** Aces and Crowns stand in for number ranks in a caravan. */
export const isWild = (id) => isAce(id) || isCrown(id);
/** A real number card, rank 2 … 9. */
export const isNumber = (id) => typeof card(id).rank === 'number' && card(id).rank >= 2 && card(id).rank <= 9;

export const shareSuit = (a, b) => suitsOf(a).some((s) => suitsOf(b).includes(s));
export const HANDS = 5;

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const suitList = (id) => suitsOf(id).map(cap).join(' and ');

/* ------------------------------------------------------------- plays */

/** A bandit's rung in the ladder: Ace < Crown < Ace+Crown (diff) < Ace+Crown (same). */
function bandit(ids) {
  if (ids.length === 1) {
    if (isAce(ids[0])) return { kind: 'bandit', level: 1, ids, label: 'a single Ace' };
    if (isCrown(ids[0])) return { kind: 'bandit', level: 2, ids, label: 'a single Crown' };
    return null;
  }
  if (ids.length === 2 && isWild(ids[0]) && isWild(ids[1]) && isAce(ids[0]) !== isAce(ids[1])) {
    const ace = ids.find(isAce);
    const same = shareSuit(ids[0], ids[1]);
    return {
      kind: 'bandit', level: same ? 4 : 3, ids,
      label: same
        ? `an Ace and Crown of the same suit (${suitList(ace)})`
        : 'an Ace and Crown of different suits',
    };
  }
  return null;
}

/**
 * The value each position of a caravan stands for: consecutive, ascending,
 * every position a rank 2–9 (Aces and Crowns only substitute), neighbours
 * sharing a suit.  Cards are given in the order they will be played.
 */
export function caravanValues(ids) {
  if (!ids.some(isNumber)) {
    throw new Error('A caravan must include at least one number card (2–9): '
      + 'Aces and Crowns alone cannot form one.');
  }
  let start = null;
  ids.forEach((id, i) => {
    if (!isNumber(id)) return;
    const v = rankOf(id);
    if (start == null) start = v - i;
    else if (v - i !== start) {
      throw new Error(`Cards must run in order: position ${i + 1} would have to be `
        + `rank ${start + i}, but ${card(id).name} is a ${v}.`);
    }
  });
  const values = ids.map((_, i) => start + i);
  if (values[0] < 2 || values[values.length - 1] > 9) {
    const bad = values[0] < 2 ? values[0] : values[values.length - 1];
    throw new Error(`A caravan cannot reach rank ${bad}: Aces and Crowns may only `
      + `stand in for ranks 2–9, never rank 1 or 10.`);
  }
  for (let i = 1; i < ids.length; i++) {
    if (!shareSuit(ids[i - 1], ids[i])) {
      throw new Error(`Adjacent caravan cards must share a suit, but `
        + `${card(ids[i - 1]).name} and ${card(ids[i]).name} do not.`);
    }
  }
  return values;
}

/**
 * Describe an ordered selection as a bandit or a caravan.
 * Throws (with a human explanation) when it is not a legal combination.
 */
export function describePlay(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('Pick at least one card to play.');
  if (new Set(ids).size !== ids.length) throw new Error('The same card cannot be played twice.');
  const b = bandit(ids);
  if (b) return b;
  const values = caravanValues(ids);
  return {
    kind: 'caravan', ids, len: ids.length, top: values[values.length - 1], values,
    label: `a ${values.join('‑')} caravan`,
  };
}

/** May play `a` be laid onto play `b` (the previous play of the season)? */
export function beatsPlay(a, b) {
  if (a.kind === 'bandit') {
    if (b.kind === 'caravan') return true;               // bandits beat every caravan
    return a.level > b.level;
  }
  if (b.kind === 'bandit') return false;                 // only a higher bandit beats one
  return a.len === b.len && a.top > b.top;
}

/* ------------------------------------------------------------------ setup */

const shuffleWith = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Deal a hand onto an existing state (also used for the very first hand). */
function dealHand(next) {
  const rng = mulberry32((next.seed + next.handNo * 7919) >>> 0);
  const deck = shuffleWith(next.cards, rng);
  const aces = deck.filter(isAce);
  const crowns = deck.filter(isCrown);
  const numbers = deck.filter(isNumber);

  const hands = [[], []];
  let ai = 0, ci = 0, ni = 0;
  for (let p = 0; p < 2; p++) {
    for (let k = 0; k < 2; k++) { hands[p].push(aces[ai++]); hands[p].push(crowns[ci++]); }
    for (let k = 0; k < 11; k++) hands[p].push(numbers[ni++]);
  }

  // four Ace/Crown cards remain: flip two as the market, rejecting a second
  // card of the first one's suit (wiki's parenthetical)
  const mini = shuffleWith([...aces.slice(4), ...crowns.slice(4)], rng);
  const market = [];
  const miniAside = [];
  market.push(mini.pop());
  while (market.length < 2 && mini.length) {
    const c = mini.pop();
    if (shareSuit(c, market[0])) miniAside.push(c);
    else market.push(c);
  }
  miniAside.push(...mini);

  next.hands = hands;
  next.market = market;
  next.aside = [...miniAside, ...numbers.slice(22)];
  next.collected = [[], []];
  next.table = [];
  next.seasonPlays = [];
  next.last = null;                 // the play to beat
  next.outPlayer = null;            // who went out this hand
  next.lastSeason = null;           // { collector, cards }

  // the lower score opens each later hand; on a tie, the other player
  const [a, b] = next.scores;
  next.starter = a !== b ? (a < b ? 0 : 1)
    : (next.starter == null ? (rng() < 0.5 ? 0 : 1) : 1 - next.starter);
  next.turn = next.starter;
  next.phase = 'season-start';
}

export function newGame(seed, deck) {
  const state = {
    seed,
    cards: deck.slice(),            // the 36 cards, for redealing hands
    handNo: 1,
    scores: [0, 0],                 // cumulative across hands
    starter: null,
    lastHand: null,                 // { handNo, out, bonus, goods, total }
    moves: 0,
    over: null,                     // 'match'
    winner: null,
  };
  dealHand(state);
  return state;
}

/* ------------------------------------------------------------------ moves */

/** May a season be opened by this player (they hold a number card)? */
export const canStart = (state, p) => state.hands[p].some(isNumber);

/** May this player pass right now?  (Never the season opener.) */
export const canPass = (state) => state.phase !== 'season-start';

/** All plays that are legal right now (used by the tests' random players). */
export function legalPlays(state) {
  const hand = state.hands[state.turn];
  const out = [];
  const target = state.last;
  const offer = (p) => {
    const ok = !target ? p.kind === 'caravan' : beatsPlay(p, target);
    if (!ok) return;
    if (p.kind === 'caravan') p.label = `a ${p.values.join('‑')} caravan`;
    out.push(p);
  };

  if (target) {                                     // bandits answer only
    for (const a of hand.filter(isAce)) offer({ kind: 'bandit', level: 1, ids: [a], label: 'a single Ace' });
    for (const c of hand.filter(isCrown)) offer({ kind: 'bandit', level: 2, ids: [c], label: 'a single Crown' });
    for (const a of hand.filter(isAce)) {
      for (const c of hand.filter(isCrown)) {
        const same = shareSuit(a, c);
        offer({
          kind: 'bandit', level: same ? 4 : 3, ids: [a, c],
          label: same ? `an Ace and Crown of the same suit (${suitList(a)})`
            : 'an Ace and Crown of different suits',
        });
      }
    }
  }

  // caravans, built position by position along each possible run of ranks —
  // a number card pins its position, a wild may stand anywhere (suit-checked)
  const wilds = hand.filter(isWild);
  for (let start = 2; start <= 9; start++) {
    for (let len = 1; start + len - 1 <= 9; len++) {
      const chosen = [];
      const values = Array.from({ length: len }, (_, k) => start + k);
      let hasNumber = false;
      const rec = (i) => {
        if (i === len) {
          if (!hasNumber) return;                 // a caravan needs a number card
          offer({ kind: 'caravan', ids: chosen.slice(), len, top: start + len - 1, values });
          return;
        }
        const v = start + i;
        const tryCard = (id, number) => {
          if (i > 0 && !shareSuit(chosen[i - 1], id)) return;
          chosen.push(id);
          const wasNumber = hasNumber;
          hasNumber = hasNumber || number;
          rec(i + 1);
          hasNumber = wasNumber;
          chosen.pop();
        };
        const num = hand.find((id) => isNumber(id) && rankOf(id) === v && !chosen.includes(id));
        if (num) tryCard(num, true);
        for (const w of wilds) if (!chosen.includes(w)) tryCard(w, false);
      };
      rec(0);
    }
  }
  return out;
}

/** Why this combination cannot be played, or null when it is legal. */
export function explainPlay(state, ids) {
  if (state.over) return 'The match is over.';
  if (!Array.isArray(ids) || !ids.length) return 'Pick at least one card to play.';
  const hand = state.hands[state.turn];
  for (const id of ids) if (!hand.includes(id)) return 'That card is not in your hand.';
  let p;
  try { p = describePlay(ids); } catch (e) { return e.message; }

  const target = state.last;
  if (!target) {
    return p.kind === 'caravan' ? null
      : 'A trade season opens with a caravan — a bandit can only answer a play.';
  }
  if (beatsPlay(p, target)) return null;
  if (target.kind === 'bandit' && p.kind === 'bandit') {
    return `Only a higher bandit beats a bandit, and ${p.label} is not higher than `
      + `${target.label} (Ace < Crown < Ace and Crown of different suits < `
      + `Ace and Crown of the same suit).`;
  }
  if (target.kind === 'bandit') {
    return `A caravan cannot beat a bandit: answer ${target.label} with a higher bandit, or pass.`;
  }
  if (p.kind === 'bandit') return null;             // unreachable: bandits beat caravans
  return `${p.label} does not beat ${target.label}: the answer must be the same length `
    + `with a higher top card.`;
}

export const canPlay = (state, ids) => explainPlay(state, ids) == null;

/** Lay a combination onto the table. */
export function play(state, ids) {
  const why = explainPlay(state, ids);
  if (why) throw new Error(why);
  const next = structuredClone(state);
  const p = describePlay(ids);
  const player = next.turn;
  const hand = next.hands[player];
  for (const id of ids) hand.splice(hand.indexOf(id), 1);
  next.table.push(...ids);
  next.seasonPlays.push({ player, kind: p.kind, ids: ids.slice(), label: p.label });
  next.last = { player, kind: p.kind, ids: ids.slice(), label: p.label,
    level: p.level ?? null, len: p.len ?? null, top: p.top ?? null };
  next.moves += 1;

  if (next.phase === 'reply') { endSeason(next); finishHand(next); return next; }
  if (!next.hands[player].length) {                 // the player just went out
    next.outPlayer = player;
    next.phase = 'reply';
    next.turn = 1 - player;
    return next;
  }
  next.turn = 1 - player;
  next.phase = 'respond';
  return next;
}

/** Give up the season (or the final reply). */
export function pass(state) {
  if (state.over) throw new Error('The match is over.');
  if (state.phase === 'season-start') {
    throw new Error('You must open the trade season with a caravan — there is nothing to pass.');
  }
  const next = structuredClone(state);
  next.moves += 1;
  if (next.phase === 'reply') { endSeason(next); finishHand(next); return next; }

  const passer = next.turn;
  endSeason(next);
  const opener = 1 - passer;                        // the player who did not pass
  if (canStart(next, opener)) { next.turn = opener; next.phase = 'season-start'; }
  else if (canStart(next, passer)) { next.turn = passer; next.phase = 'season-start'; }
  else finishHand(next);                            // neither can open: the hand ends
  return next;
}

/* ---------------------------------------------------- season and hand ends */

/** Points (plus or minus) for collected cards given the market cards. */
export function goods(state) {
  const out = [0, 0];
  for (let p = 0; p < 2; p++) {
    for (const id of state.collected[p]) {
      for (const up of state.market) {
        if (suitsOf(up).some((s) => suitsOf(id).includes(s))) out[p] += isCrown(up) ? 1 : -1;
      }
    }
  }
  return out;
}

/** Collect the season's cards: the last caravan's player, or the bandit's opponent. */
function endSeason(next) {
  const plays = next.seasonPlays;
  if (!plays.length) return;
  const last = plays[plays.length - 1];
  const collector = last.kind === 'bandit' ? 1 - last.player : last.player;
  next.collected[collector].push(...next.table);
  next.lastSeason = { collector, cards: next.table.length, by: last.kind };
  next.table = [];
  next.seasonPlays = [];
  next.last = null;
}

/** Score the hand: going-out bonuses and market goods, then deal the next hand. */
function finishHand(next) {
  const goodsScore = goods(next);
  const bonus = [0, 0];
  if (next.outPlayer != null) {
    const other = 1 - next.outPlayer;
    bonus[next.outPlayer] = 5 + next.hands[other].length;
    if (!next.hands[next.outPlayer].length && !next.hands[other].length) {
      bonus[other] = 5;                             // the reply went out too
    }
  }
  next.scores[0] += bonus[0] + goodsScore[0];
  next.scores[1] += bonus[1] + goodsScore[1];
  next.lastHand = {
    handNo: next.handNo, out: next.outPlayer,
    bonus, goods: goodsScore, total: next.scores.slice(),
    leftover: [next.hands[0].length, next.hands[1].length],
  };
  next.aside.push(...next.hands[0], ...next.hands[1]);   // leftovers count for no one
  next.hands = [[], []];

  if (next.handNo >= HANDS) {
    next.over = 'match';
    next.winner = next.scores[0] === next.scores[1] ? null : (next.scores[0] > next.scores[1] ? 0 : 1);
  } else {
    next.handNo += 1;
    dealHand(next);
  }
}

/* ---------------------------------------------------------------- display */

/** One line describing the market: which suits score and which cost. */
export function marketText(state) {
  return state.market.map((id) => {
    const s = suitList(id);
    return isCrown(id) ? `${s} pay` : `${s} cost`;
  }).join(' · ');
}

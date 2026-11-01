/* Terrapin — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:terrapin  (P.D. Magnus)
 *
 * A family of betting games on the basic 36-card Decktet.  Two variants are
 * implemented for two players: Western Terrapin (the default — deal, bet,
 * three shared cards, take-or-stand, bet again, showdown) and Temptation
 * Terrapin (ante three, then buy face-down cards at a rising price).
 * Provincial and Liar's Terrapin are not implemented: the wiki itself says
 * they "play better with 4", and Liar's degenerates at two players.
 *
 * The hand ranking is shared with Soliterrapin (web/js/games/soliterrapin-
 * core.js) and the two implementations are cross-checked in the tests:
 *   Turtle Butt (all six suits present) scores 0 and cannot win;
 *   each pair is 5 points (extra Aces/Crowns 5 each, i.e. 5*(count-1));
 *   the longest straight scores 2 per card after the first, Ace low, Crown
 *   high, no wrap; only the longest straight counts.
 *
 * Interpretations (all restated on the rules page):
 *   1. Chips: each player starts with 50 chips (the wiki says only "provide
 *      chips").  Ante 1 (Western) or 3 (Temptation) per hand.
 *   2. Bet and raise limit: 5 chips per bet and per raise ("we play with a
 *      raise limit of 5 or 10 chips").  You may never put in more chips than
 *      you hold; if you cannot match a bet you must fold.
 *   3. First to act "bets or folds" — there is no check, in every betting
 *      round, exactly as the wiki words it.
 *   4. The match is open ended in the wiki; this app plays to 65 chips, or
 *      12 hands, or until one player is broke.
 *   5. Three shared cards that on their own make Turtle Butt are set aside
 *      and replaced; in the astronomically unlikely case the deck runs out
 *      while replacing, the set-aside cards are shuffled back.
 *   6. In the take-or-stand phase players alternate offers in laps around
 *      the table starting with the last aggressive player; a player who
 *      takes is offered a second card on the next lap.                */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const VARIANTS = ['western', 'temptation'];
export const START_CHIPS = 50;
export const ANTE = { western: 1, temptation: 3 };
export const RAISE_LIMIT = 5;
export const TARGET_CHIPS = 65;
export const MAX_HANDS = 12;

/* --------------------------------------------------------- the ranking */

/**
 * Score one Terrapin hand (any array of card ids).
 * Returns { total, turtleButt, pairs: [{rank,count,points}],
 *           straight: { ranks, points } }.
 */
export function scoreHand(ids) {
  const suits = new Set();
  for (const id of ids) for (const s of suitsOf(id)) suits.add(s);
  if (suits.size === 6) {
    return { total: 0, turtleButt: true, pairs: [], straight: { ranks: [], points: 0 } };
  }

  const counts = new Map();
  for (const id of ids) {
    const r = rankOf(id);
    counts.set(r, (counts.get(r) || 0) + 1);
  }

  const pairs = [];
  let pairPoints = 0;
  for (const [r, n] of counts) {
    if (n < 2) continue;
    const points = 5 * (n - 1);
    pairPoints += points;
    pairs.push({ rank: r, count: n, points });
  }
  pairs.sort((a, b) => a.rank - b.rank);

  let best = [];
  let run = [];
  for (let r = 1; r <= 10; r++) {                 // Ace 1 … Crown 10, no wrap
    if (counts.has(r)) {
      run.push(r);
      if (run.length > best.length) best = run.slice();
    } else {
      run = [];
    }
  }
  const straightPoints = best.length >= 2 ? 2 * (best.length - 1) : 0;

  return {
    total: pairPoints + straightPoints,
    turtleButt: false,
    pairs,
    straight: { ranks: best, points: straightPoints },
  };
}

const rankLabel = (r) => (r === 10 ? 'Crowns' : r === 1 ? 'Aces' : `${r}s`);
const runLabel = (ranks) => ranks
  .map((r) => (r === 10 ? 'Crown' : r === 1 ? 'Ace' : String(r))).join('–');

/** One line for the score display, e.g. "pair of 4s +5 · straight 3–4–5 +4 = 9". */
export function describeScore(sc) {
  if (sc.turtleButt) return 'Turtle Butt — cannot win';
  const parts = [];
  for (const p of sc.pairs) {
    const label = rankLabel(p.rank);
    parts.push(p.count === 2 ? `pair of ${label} +${p.points}` : `${p.count} × ${label} +${p.points}`);
  }
  if (sc.straight.points) parts.push(`straight ${runLabel(sc.straight.ranks)} +${sc.straight.points}`);
  if (!parts.length) parts.push('nothing');
  return `${parts.join(' · ')} = ${sc.total}`;
}

/* --------------------------------------------------------------- setup */

const shuffleWith = (arr, seed) => {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function newGame(seed, deck, variant = 'western') {
  if (!VARIANTS.includes(variant)) throw new Error(`unknown Terrapin variant "${variant}"`);
  if (deck.length !== 36) throw new Error(`the basic Decktet is 36 cards, got ${deck.length}`);
  const st = {
    seed,
    variant,
    hand: 1,
    dealer: 0,
    stacks: [START_CHIPS, START_CHIPS],
    pot: 0,
    handsPlayed: 0,
    over: null,             // 'match' when the match is decided
    winner: null,           // 0 | 1 | null (draw) once over
    moves: 0,
    note: '',
  };
  return dealHand(st, deck);
}

/** Deal a fresh hand onto an existing match state (antes come out of stacks). */
function dealHand(st, deck) {
  const ante = ANTE[st.variant];
  const shuffled = shuffleWith(deck, (st.seed + st.hand * 7919) >>> 0);
  const next = {
    ...st,
    deck: shuffled,
    hands: [[shuffled.pop(), shuffled.pop()], [shuffled.pop(), shuffled.pop()]],
    shared: [],
    setAside: [],
    folded: [false, false],
    pot: st.pot + 2 * ante,
    stacks: [st.stacks[0] - ante, st.stacks[1] - ante],
    phase: st.variant === 'western' ? 'bet' : 'buy',
    betRound: 1,
    buyRound: 1,
    bet: null,
    offer: null,
    drawOffer: null,
    result: null,
  };
  const first = 1 - next.dealer;                  // the player on the dealer's left
  if (next.variant === 'western') {
    next.bet = { level: 0, contrib: [0, 0], first, toAct: first, aggressor: null };
    next.lastAggressive = first;
    next.note = `Hand ${next.hand}: both ante ${ante} chip${ante === 1 ? '' : 's'}. ` +
      `Player ${first + 1} bets or folds.`;
  } else {
    dealShared(next);
    next.offer = { to: first, tookThisRound: false };
    next.lastAggressive = null;
    next.note = `Hand ${next.hand}: both ante ${ante} chips. ` +
      `Player ${first + 1} may buy a card for ${next.buyRound} chip.`;
  }
  return next;
}

/** Deal the three shared cards; a Turtle Butt triple is set aside and replaced. */
function dealShared(st) {
  for (;;) {
    if (st.deck.length < 3 && st.setAside.length) {      // degenerate safety net
      st.deck = shuffleWith(st.setAside, (st.seed + st.hand * 6151) >>> 0);
      st.setAside = [];
    }
    if (st.deck.length < 3) break;                       // cannot happen in a real hand
    const three = [st.deck.pop(), st.deck.pop(), st.deck.pop()];
    if (scoreHand(three).turtleButt) { st.setAside.push(...three); continue; }
    st.shared = three;
    break;
  }
}

/* ------------------------------------------------------------- betting */

function needBetPhase(st) {
  if (st.over) throw new Error('the match is over');
  if (st.phase !== 'bet') {
    throw new Error(st.phase === 'handOver'
      ? 'the hand is over — start the next one'
      : 'betting only happens during a betting round');
  }
}

/** The opening bet of a round: the first player "bets or folds" — no check. */
export function bet(state, amount) {
  const st = structuredClone(state);
  needBetPhase(st);
  const a = st.bet.toAct;
  if (st.bet.contrib[a] !== st.bet.level) {
    throw new Error(`you are facing a bet of ${st.bet.level - st.bet.contrib[a]} — match it, raise, or fold`);
  }
  if (!Number.isInteger(amount) || amount < 1) throw new Error('a bet is at least 1 chip');
  if (amount > RAISE_LIMIT) {
    throw new Error(`the agreed limit is ${RAISE_LIMIT} chips per bet — you tried to bet ${amount}`);
  }
  if (amount > st.stacks[a]) throw new Error(`you have only ${st.stacks[a]} chips to bet with`);

  st.stacks[a] -= amount;
  st.pot += amount;
  st.bet.contrib[a] = amount;
  st.bet.level = amount;
  st.bet.aggressor = a;
  st.lastAggressive = a;
  st.bet.toAct = 1 - a;
  st.moves += 1;
  st.note = `Player ${a + 1} bets ${amount}.`;
  return st;
}

export function call(state) {
  const st = structuredClone(state);
  needBetPhase(st);
  const a = st.bet.toAct;
  if (st.bet.contrib[a] >= st.bet.level) {
    throw new Error('there is no bet to call — you must bet or fold');
  }
  const owed = st.bet.level - st.bet.contrib[a];
  if (st.stacks[a] < owed) {
    throw new Error(`matching the bet needs ${owed} chips and you have ${st.stacks[a]} — you must fold`);
  }
  st.stacks[a] -= owed;
  st.pot += owed;
  st.bet.contrib[a] = st.bet.level;
  st.moves += 1;
  st.note = `Player ${a + 1} matches ${owed}.`;
  return endBetting(st);
}

export function raise(state, amount) {
  const st = structuredClone(state);
  needBetPhase(st);
  const a = st.bet.toAct;
  if (st.bet.contrib[a] >= st.bet.level) {
    throw new Error('there is no bet to raise — you must bet or fold');
  }
  if (!Number.isInteger(amount) || amount < 1) throw new Error('a raise is at least 1 chip');
  if (amount > RAISE_LIMIT) {
    throw new Error(`the agreed limit is ${RAISE_LIMIT} chips per raise — you tried to raise ${amount}`);
  }
  const owed = st.bet.level - st.bet.contrib[a];
  if (st.stacks[a] < owed + amount) {
    throw new Error(`a raise to ${st.bet.level + amount} needs ${owed + amount} chips and you have ${st.stacks[a]}`);
  }
  st.stacks[a] -= owed + amount;
  st.pot += owed + amount;
  st.bet.level += amount;
  st.bet.contrib[a] = st.bet.level;
  st.bet.aggressor = a;
  st.lastAggressive = a;
  st.bet.toAct = 1 - a;
  st.moves += 1;
  st.note = `Player ${a + 1} raises to ${st.bet.level}.`;
  return st;
}

export function fold(state) {
  const st = structuredClone(state);
  needBetPhase(st);
  const a = st.bet.toAct;
  st.folded[a] = true;
  st.moves += 1;
  return endHand(st, {
    winner: 1 - a,
    split: null,
    carry: false,
    scores: null,
    note: `Player ${a + 1} folds. Player ${2 - a} takes the pot of ${st.pot}.`,
  }, st.pot);
}

/** Betting round 1 deals the shared cards, round 2 opens the draw phase,
 *  round 3 goes to showdown. */
function endBetting(st) {
  if (st.betRound === 1) {
    dealShared(st);
    startBetting(st, 2, st.lastAggressive);
    st.note += ` Three cards are dealt: ${st.shared.map((id) => card(id).name).join(', ')}. ` +
      `Player ${st.bet.toAct + 1} bets or folds.`;
  } else if (st.betRound === 2) {
    st.phase = 'draw';
    st.drawOffer = { to: st.lastAggressive, stood: [false, false] };
    st.note += ` Player ${st.drawOffer.to + 1}: take a card or stand.`;
  } else {
    return showdown(st);
  }
  return st;
}

function startBetting(st, round, first) {
  st.phase = 'bet';
  st.betRound = round;
  st.bet = { level: 0, contrib: [0, 0], first, toAct: first, aggressor: null };
}

/* -------------------------------------------------- take a card or stand */

function needDrawPhase(st) {
  if (st.over) throw new Error('the match is over');
  if (st.phase !== 'draw') throw new Error('players may only take cards between the second and final betting rounds');
}

export function takeCard(state) {
  const st = structuredClone(state);
  needDrawPhase(st);
  const a = st.drawOffer.to;
  if (st.drawOffer.stood[a]) throw new Error(`Player ${a + 1} has already stood`);
  if (!st.deck.length) throw new Error('the deck is exhausted');
  st.hands[a].push(st.deck.pop());
  st.moves += 1;
  st.note = `Player ${a + 1} takes a card face down.`;
  if (!st.deck.length) { drawPhaseOver(st); return st; }
  advanceOffer(st);
  return st;
}

export function stand(state) {
  const st = structuredClone(state);
  needDrawPhase(st);
  const a = st.drawOffer.to;
  if (st.drawOffer.stood[a]) throw new Error(`Player ${a + 1} has already stood`);
  st.drawOffer.stood[a] = true;
  st.moves += 1;
  st.note = `Player ${a + 1} stands.`;
  advanceOffer(st);
  return st;
}

/** Next player who has not stood (laps keep coming back to a taker). */
function advanceOffer(st) {
  for (const off of [1, 2]) {
    const p = (st.drawOffer.to + off) % 2;
    if (!st.drawOffer.stood[p]) { st.drawOffer.to = p; return; }
  }
  drawPhaseOver(st);
}

function drawPhaseOver(st) {
  st.drawOffer = null;
  startBetting(st, 3, st.lastAggressive);
  st.note += ` Player ${st.bet.toAct + 1} bets or folds.`;
}

/* ---------------------------------------------------- Temptation buying */

function needBuyPhase(st) {
  if (st.over) throw new Error('the match is over');
  if (st.phase !== 'buy') throw new Error('cards may only be bought during the buying rounds');
}

export function buyCard(state) {
  const st = structuredClone(state);
  needBuyPhase(st);
  const a = st.offer.to;
  if (!st.deck.length) throw new Error('the deck is exhausted');
  if (st.stacks[a] < st.buyRound) {
    throw new Error(`a card costs ${st.buyRound} chips this round and you have ${st.stacks[a]}`);
  }
  st.stacks[a] -= st.buyRound;
  st.pot += st.buyRound;
  st.hands[a].push(st.deck.pop());
  st.offer.tookThisRound = true;
  st.moves += 1;
  st.note = `Player ${a + 1} pays ${st.buyRound} for a card.`;
  if (!st.deck.length) return showdown(st);
  advanceOfferT(st);
  return st;
}

export function passCard(state) {
  const st = structuredClone(state);
  needBuyPhase(st);
  const a = st.offer.to;
  st.moves += 1;
  st.note = `Player ${a + 1} passes.`;
  advanceOfferT(st);
  return st;
}

/** One decision per player per round; a round with no taker ends the buying. */
function advanceOfferT(st) {
  const order = [1 - st.dealer, st.dealer];
  const i = order.indexOf(st.offer.to);
  if (i + 1 < order.length) {
    st.offer.to = order[i + 1];
    st.note += ` Player ${st.offer.to + 1} may buy for ${st.buyRound}.`;
    return;
  }
  if (!st.offer.tookThisRound) return showdown(st);
  st.buyRound += 1;
  st.offer = { to: order[0], tookThisRound: false };
  st.note += ` Round ${st.buyRound}: a card now costs ${st.buyRound} chips.`;
}

/* ------------------------------------------------------------- showdown */

function showdown(st) {
  const live = [0, 1].filter((p) => !st.folded[p]);
  const scores = [0, 1].map((p) => scoreHand([...st.hands[p], ...st.shared]));
  const order = st.variant === 'western' && live.includes(st.lastAggressive)
    ? [st.lastAggressive, ...live.filter((p) => p !== st.lastAggressive)]
    : [1 - st.dealer, ...live.filter((p) => p !== 1 - st.dealer)];

  const allButt = live.every((p) => scores[p].turtleButt);
  if (allButt) {
    return endHand(st, {
      winner: null, split: null, carry: true, scores, order,
      note: 'Every hand at the showdown is Turtle Butt — the pot stays in play.',
    }, 0);
  }

  const contenders = live.filter((p) => !scores[p].turtleButt);
  const best = Math.max(...contenders.map((p) => scores[p].total));
  const winners = contenders.filter((p) => scores[p].total === best);

  if (winners.length === 1) {
    const w = winners[0];
    return endHand(st, {
      winner: w, split: null, carry: false, scores, order,
      note: `Player ${w + 1} shows ${describeScore(scores[w])} and takes the pot of ${st.pot}.`,
    }, st.pot);
  }

  const share = Math.floor(st.pot / winners.length);
  for (const w of winners) st.stacks[w] += share;
  st.pot -= share * winners.length;
  return endHand(st, {
    winner: null, split: winners, carry: false, scores, order,
    note: `Player ${winners[0] + 1} and Player ${winners[1] + 1} tie on ` +
      `${describeScore(scores[winners[0]])}; each takes ${share} chips` +
      (st.pot ? ` and ${st.pot} stays in the pot.` : '.'),
  }, 0);
}

/** Close the hand: record the result, then check whether the match is done. */
function endHand(st, res, takePot) {
  if (takePot && res.winner != null) {
    st.stacks[res.winner] += takePot;
    st.pot -= takePot;
  }
  st.phase = 'handOver';
  st.handsPlayed += 1;
  st.result = res;
  st.note = res.note;
  if (!res.carry) checkTargets(st);
  return st;
}

function checkTargets(st) {
  const [c0, c1] = st.stacks;
  if (c0 === 0 || c1 === 0) {
    st.over = 'match';
    st.winner = c0 === c1 ? null : (c0 === 0 ? 1 : 0);
  } else if (c0 >= TARGET_CHIPS || c1 >= TARGET_CHIPS) {
    st.over = 'match';
    st.winner = c0 >= TARGET_CHIPS ? 0 : 1;
  } else if (st.handsPlayed >= MAX_HANDS) {
    st.over = 'match';
    st.winner = c0 === c1 ? null : (c0 > c1 ? 0 : 1);
  }
}

/* ------------------------------------------------------------ next hand */

export function nextHand(state, deck) {
  const st = structuredClone(state);
  if (st.over) throw new Error('the match is over');
  if (st.phase !== 'handOver') throw new Error('this hand is not finished yet');
  const ante = ANTE[st.variant];
  if (st.stacks[0] < ante || st.stacks[1] < ante) {       // cannot re-ante
    st.over = 'match';
    st.winner = st.stacks[0] === st.stacks[1] ? null : (st.stacks[0] > st.stacks[1] ? 0 : 1);
    return st;
  }
  st.dealer = 1 - st.dealer;
  st.hand += 1;
  return dealHand(st, deck);
}

/* -------------------------------------------------------------- moves */

/** One entry point for the UI and the playouts: { type, … }. */
export function applyMove(state, action) {
  switch (action.type) {
    case 'bet': return bet(state, action.amount);
    case 'call': return call(state);
    case 'raise': return raise(state, action.amount);
    case 'fold': return fold(state);
    case 'take': return takeCard(state);
    case 'stand': return stand(state);
    case 'buy': return buyCard(state);
    case 'pass': return passCard(state);
    case 'nextHand': return nextHand(state, action.deck);
    default: throw new Error(`unknown action ${action.type}`);
  }
}

/** Every action the player whose turn it is may take right now. */
export function legalActions(state) {
  const st = state;
  if (st.over) return [];
  if (st.phase === 'handOver') return [{ type: 'nextHand' }];

  if (st.variant === 'western') {
    if (st.phase === 'bet') {
      const a = st.bet.toAct;
      const out = [{ type: 'fold' }];
      if (st.bet.contrib[a] === st.bet.level) {
        for (let n = 1; n <= Math.min(RAISE_LIMIT, st.stacks[a]); n++) out.push({ type: 'bet', amount: n });
      } else {
        const owed = st.bet.level - st.bet.contrib[a];
        if (st.stacks[a] >= owed) out.push({ type: 'call' });
        for (let n = 1; n <= RAISE_LIMIT; n++) {
          if (st.stacks[a] >= owed + n) out.push({ type: 'raise', amount: n });
        }
      }
      return out;
    }
    if (st.phase === 'draw') {
      const out = [{ type: 'stand' }];
      if (st.deck.length && !st.drawOffer.stood[st.drawOffer.to]) out.push({ type: 'take' });
      return out;
    }
    return [];
  }

  if (st.phase === 'buy') {
    const a = st.offer.to;
    const out = [{ type: 'pass' }];
    if (st.deck.length && st.stacks[a] >= st.buyRound) out.push({ type: 'buy' });
    return out;
  }
  return [];
}

/* --------------------------------------------------------- invariants */

/** Everything the tests conservation-check: all 36 cards, all 100 chips. */
export function allCards(state) {
  return [...state.deck, ...state.hands[0], ...state.hands[1],
    ...state.shared, ...state.setAside];
}

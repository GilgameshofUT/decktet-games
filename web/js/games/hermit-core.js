/* Hermit — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:hermit  (P.D. Magnus)
 *
 * Two players, sixteen cards each, four dealt off to the Cottage.  More than
 * one trick is in play at a time.  On your turn you must add a card to a
 * trick whose last card shares a suit with it; when you are void in every
 * trick in progress you start a new one instead.  A trick is complete on the
 * fourth card and is taken by whoever controls it — the player who last played
 * the highest ranked card in it.  You want to avoid taking tricks that contain
 * *personality* cards: each personality you take scores its rank against you,
 * and the lowest score wins the match.
 *
 * The trick loop follows the pattern of ace-trump-core.js (copied, not
 * imported), factored as:
 *
 *   newGame -> [pickCard: cottage / start tricks] -> [playCard: follow or
 *            start] -> resolveTrick -> trickControl -> collect -> (table
 *            clear) -> cottage phase -> start new tricks -> … -> endHand
 *
 * with explainPlay() returning the human-readable refusal the core throws.
 *
 * Interpretations (each also noted on the rules page):
 *   1. Two players = the wiki's "Hermit for Two": shuffle, deal four cards to
 *      the Cottage, the rest evenly (16 + 16 + 4 = 36).
 *   2. Tricks are still four cards at two players ("when a fourth card is
 *      played on a trick"), so each player plays twice per trick.
 *   3. The Cottage is filled "whenever all the tricks are cleared from the
 *      table … Note: This does not include the very first trick of the game".
 *      Read as: the opening simultaneous start of a hand is exempt (at that
 *      moment the table also holds no tricks, so the note is what rules it
 *      out); every later clearing of the table costs each player one
 *      face-down Cottage card before the new tricks start.
 *   4. Ace-cancels-crown: whenever an Ace and the Crown of the same suit are
 *      in the same trick, that Crown's value drops below every Ace — no
 *      matter which of the two was played first.  A tie for highest goes to
 *      the card played later (the wiki's "if it is tied for highest, move it
 *      anyway").
 *   5. Length: "Lowest score after each player has dealt twice" = four hands
 *      with the deal alternating; an equal total is a draw.  The 66-point
 *      target in the general scoring section is advice for three to five
 *      players, so it is not used here.
 *   6. Scoring: personalities are worth their rank (Crowns 10, "regardless
 *      of whether or not they were in the same trick as the matching Ace"),
 *      and the player who took fewer tricks also scores the personalities
 *      still in the Cottage; equal trick totals discard the Cottage.
 *   7. Simultaneous choices run Player 1 then Player 2 behind the pass screen
 *      with neither choice shown until both are made, so the order is
 *      invisible.  Unfinished tricks at the end of a hand are set aside and
 *      score for nobody.
 *   8. Not implemented: the three-to-five-player deals, "Hermit for Five",
 *      and the Pleasant Company / House Party variants.  Basic 36-card deck
 *      only (no Pawns, Courts or Excuse). */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));      // Ace 1 … 9, Crown 10
export const suitsOf = (id) => card(id).suits;
export const isAce = (id) => card(id).rank === 1;
export const isPersonality = (id) => !!card(id).personality;
export const shareSuit = (a, b) => suitsOf(a).some((s) => suitsOf(b).includes(s));

export const HAND_SIZE = 16;      // per player, two-player deal
export const COTTAGE_SIZE = 4;    // dealt off to the side
export const TRICK_SIZE = 4;      // a fourth card completes a trick
export const HANDS = 4;           // each player deals twice

/* ------------------------------------------------- the trick-taking kernel */

/**
 * One card's strength inside a trick.
 *
 * Aces are low (1) and Crowns are ordinarily high (10) — but when an Ace of
 * the same suit sits in the trick it cancels the Crown, and "a cancelled
 * Crown is lower even than an Ace": 0.  Cancellation applies to the whole
 * trick, so it works whether the Ace was played before or after the Crown.
 */
export function trickValue(plays, id) {
  const v = rankOf(id);
  if (v !== 10) return v;
  const suit = suitsOf(id)[0];
  const cancels = plays.some((p) => isAce(p.id) && suitsOf(p.id)[0] === suit);
  return cancels ? 0 : 10;
}

/** Move the trick in front of `player` when their new card is highest (ties included). */
function applyControl(trick, player) {
  const vals = trick.plays.map((p) => trickValue(trick.plays, p.id));
  const mine = vals[vals.length - 1];
  if (mine >= Math.max(...vals)) trick.control = player;
}

/* ------------------------------------------------------------------- setup */

const shuffleWith = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Deal a hand onto an existing state (also used for the very first hand). */
function dealHand(next, dealer) {
  const rng = mulberry32((next.seed + next.handNo * 7919) >>> 0);
  const deck = shuffleWith(next.cards, rng);
  next.hands = [[], []];
  for (let i = 0; i < HAND_SIZE; i++) {
    next.hands[0].push(deck.pop());
    next.hands[1].push(deck.pop());
  }
  next.cottage = [deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  next.tricks = [];
  next.piles = [[], []];
  next.setAside = [];
  next.lastTrick = null;
  next.tricksWon = [0, 0];
  next.phase = 'start';
  next.pick = 0;
  next.picks = [null, null];
  next.dealer = dealer;
  next.leader = 1 - dealer;          // the player on the dealer's left
  next.turn = next.leader;
}

export function newGame(seed, deck) {
  const dealer = mulberry32(seed)() < 0.5 ? 0 : 1;   // "randomly pick a dealer"
  const state = {
    seed,
    cards: deck.slice(),
    handNo: 1,
    total: [0, 0],                     // personality points across the match
    lastHand: null,
    moves: 0,
    over: null,                        // 'match'
    winner: null,
  };
  dealHand(state, dealer);
  return state;
}

/* ------------------------------------------------------------------ picks */

/** Why this pick is illegal, or null when it is legal. */
export function explainPick(state, id) {
  if (state.over) return 'The match is over.';
  if (state.phase !== 'cottage' && state.phase !== 'start') {
    return 'Now is not the time to pick a card.';
  }
  const hand = state.hands[state.pick];
  if (!hand || !hand.includes(id)) return 'That card is not in your hand.';
  return null;
}

/**
 * Pick a card face down — into the Cottage (scored at the end of the hand),
 * or to start a trick (revealed once both players have picked).
 */
export function pickCard(state, id) {
  const why = explainPick(state, id);
  if (why) throw new Error(why);
  const next = structuredClone(state);
  const hand = next.hands[next.pick];
  hand.splice(hand.indexOf(id), 1);

  if (next.phase === 'cottage') next.cottage.push(id);
  else next.picks[next.pick] = id;
  next.moves += 1;

  advancePick(next);
  return next;
}

/** Move to the second picker, or finish the pick phase. */
function advancePick(next) {
  if (next.pick === 0) {
    // Player 2 picks too — unless their hand is already empty
    next.pick = next.hands[1].length ? 1 : null;
    if (next.pick == null) finishPick(next);
    return;
  }
  finishPick(next);
}

function finishPick(next) {
  if (next.phase === 'cottage') {
    next.phase = 'start';
    next.picks = [null, null];
    if (!next.hands[0].length && !next.hands[1].length) return endHand(next);
    next.pick = next.hands[0].length ? 0 : 1;
    return;
  }
  startTricks(next);
}

/** Reveal both chosen cards as one trick each, then play resumes. */
function startTricks(next) {
  next.tricks = next.picks
    .map((id, p) => (id ? { player: p, control: p, plays: [{ player: p, id }] } : null))
    .filter(Boolean);
  next.picks = [null, null];
  next.pick = null;
  next.phase = 'play';
  // whoever just started the last card in their hand ends the hand here
  if (!next.hands[0].length || !next.hands[1].length) endHand(next);
}

/* ------------------------------------------------------------------ moves */

/** The trick indexes this card may legally be added to (empty = void). */
export function followsTricks(state, id) {
  const out = [];
  state.tricks.forEach((tr, i) => {
    const last = tr.plays[tr.plays.length - 1];
    if (last && shareSuit(id, last.id)) out.push(i);
  });
  return out;
}

/** Can any card in hand still follow a trick in progress? */
function anyFollow(state) {
  const hand = state.hands[state.turn];
  return state.tricks.some((tr) => {
    const last = tr.plays[tr.plays.length - 1];
    return hand.some((id) => last && shareSuit(id, last.id));
  });
}

/** The cards this player may play right now (the target still has to fit). */
export function legalPlays(state) {
  if (state.phase === 'cottage' || state.phase === 'start') {
    return (state.hands[state.pick] || []).slice();
  }
  const hand = state.hands[state.turn] || [];
  if (state.phase !== 'play') return hand.slice();
  if (!anyFollow(state)) return hand.slice();       // void everywhere: start a trick
  return hand.filter((id) => followsTricks(state, id).length > 0);
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

const trickLabel = (state, i) => {
  const tr = state.tricks[i];
  const last = tr.plays[tr.plays.length - 1];
  return `${card(last.id).name} (${suitsOf(last.id).map(cap).join(' or ')})`;
};

/**
 * Why this play is illegal, or null when it is legal.
 *
 * `target` is a trick index to play onto, `null` to start a new trick, or
 * undefined when the caller has not chosen yet (UI staging).
 */
export function explainPlay(state, id, target) {
  if (state.over) return 'The match is over.';
  if (state.phase === 'cottage') {
    return `Player ${state.pick + 1}: pick one card to add to the Cottage.`;
  }
  if (state.phase === 'start') {
    return `Player ${state.pick + 1}: pick one card to start a trick.`;
  }
  const hand = state.hands[state.turn];
  if (!hand.includes(id)) return 'That card is not in your hand.';

  const fits = followsTricks(state, id);
  const mustFollow = anyFollow(state);
  const ends = () => state.tricks.map((_, i) => trickLabel(state, i)).join(' — or ');

  // no target yet: legal if the card fits a trick, or if you are void everywhere
  if (target === undefined) {
    if (fits.length || !mustFollow) return null;
    return `You must follow suit: play a card that shares a suit with the last card of a `
      + `trick in progress (${ends()}). ${card(id).name} shares a suit with none of them, `
      + 'and one of the cards in your hand still fits.';
  }

  // asked to start a new trick
  if (target === null || (typeof target === 'number' && target < 0)) {
    if (!mustFollow) return null;
    return 'You must play on a trick you can follow — you cannot start a new trick while '
      + (fits.length
        ? `${card(id).name} still fits one of them.`
        : 'one of the cards in your hand still fits one.');
  }

  if (!Number.isInteger(target) || target >= state.tricks.length) return 'There is no trick there.';
  if (!mustFollow) {
    return 'You are void in every trick in progress, so you must start a new trick instead.';
  }
  if (fits.includes(target)) return null;
  if (fits.length) {
    return `${card(id).name} does not share a suit with the last card on that trick `
      + `(${trickLabel(state, target)}). It fits on ${fits.map((i) => `trick ${i + 1}`).join(' or ')}.`;
  }
  return `You must follow suit — the tricks in progress end with ${ends()}, and `
    + `${card(id).name} shares a suit with none of them.`;
}

export const canPlay = (state, id) => explainPlay(state, id, undefined) == null;

/** Play one card: onto a trick you follow, or face up to start a new one. */
export function playCard(state, id, target = undefined) {
  const why = explainPlay(state, id, target);
  if (why) throw new Error(why);
  let t = target;
  if (t === undefined) {                 // resolve an unstaged play
    const fits = followsTricks(state, id);
    if (fits.length > 1) {
      throw new Error(`${card(id).name} fits on ${fits.length} tricks in progress — `
        + 'say which one you are playing it on.');
    }
    t = fits.length ? fits[0] : null;
  }
  const handNoBefore = state.handNo;
  const next = structuredClone(state);
  const hand = next.hands[next.turn];
  hand.splice(hand.indexOf(id), 1);
  next.moves += 1;

  if (t == null) {
    next.tricks.push({ player: next.turn, control: next.turn, plays: [{ player: next.turn, id }] });
  } else {
    const tr = next.tricks[t];
    tr.plays.push({ player: next.turn, id });
    applyControl(tr, next.turn);
    if (tr.plays.length === TRICK_SIZE) resolveTrick(next, t);
  }

  if (next.over || next.handNo !== handNoBefore) return next;    // the hand ended and was redealt
  // "The hand ends when all players' cards have been played" — unfinished
  // tricks at that moment are set aside and score for nobody.
  if (next.phase === 'play' && !next.hands[0].length && !next.hands[1].length) {
    endHand(next);
    return next;
  }
  next.turn = 1 - next.turn;                      // play continues clockwise
  return next;
}

/** Take a complete trick for whoever controls it, then check the table. */
function resolveTrick(next, idx) {
  const tr = next.tricks[idx];
  const winner = tr.control;
  next.piles[winner].push(...tr.plays.map((p) => p.id));
  next.tricksWon[winner] += 1;
  next.lastTrick = { plays: tr.plays, winner };
  next.tricks.splice(idx, 1);
  if (!next.tricks.length) afterTableClear(next);
}

/** The table is empty of tricks: end the hand, or Cottage + start again. */
function afterTableClear(next) {
  if (!next.hands[0].length && !next.hands[1].length) return endHand(next);
  next.phase = 'cottage';
  next.pick = next.hands[0].length ? 0 : (next.hands[1].length ? 1 : null);
  next.picks = [null, null];
  if (next.pick == null) endHand(next);
}

/* --------------------------------------------------------------- scoring */

/** Personality points in a set of cards (Crowns score 10). */
export function pointsOf(ids) {
  return ids.reduce((sum, id) => (isPersonality(id) ? sum + rankOf(id) : sum), 0);
}

/** Score the hand, then deal the next one or end the match. */
function endHand(next) {
  for (const tr of next.tricks) next.setAside.push(...tr.plays.map((p) => p.id));
  next.tricks = [];

  const points = [pointsOf(next.piles[0]), pointsOf(next.piles[1])];
  const cottagePts = pointsOf(next.cottage);
  const fewer = next.tricksWon[0] === next.tricksWon[1]
    ? null
    : (next.tricksWon[0] < next.tricksWon[1] ? 0 : 1);
  if (fewer != null) points[fewer] += cottagePts;

  next.total[0] += points[0];
  next.total[1] += points[1];
  next.lastHand = {
    handNo: next.handNo,
    tricks: next.tricksWon.slice(),
    points,
    cottage: next.cottage.slice(),
    cottagePts,
    cottageTo: fewer,
    piles: [next.piles[0].slice(), next.piles[1].slice()],
    setAside: next.setAside.slice(),
    total: next.total.slice(),
  };

  if (next.handNo >= HANDS) {
    next.over = 'match';
    next.phase = 'over';
    next.winner = next.total[0] === next.total[1] ? null : (next.total[0] < next.total[1] ? 0 : 1);
    return;
  }
  next.handNo += 1;
  dealHand(next, 1 - next.dealer);                 // the deal passes each hand
}

export const OUTCOME = {
  match: { title: 'The match is over', cls: 'win' },
};

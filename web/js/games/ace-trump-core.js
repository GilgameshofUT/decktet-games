/* Ace Trump — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:ace-trump  (P.D. Magnus)
 *
 * A trick-taking game: lead a card, the other player must follow suit if they
 * can, highest card wins the trick and leads the next.  There is no trump
 * suit until someone plays an Ace — the Ace's suit becomes trump for that
 * trick and stays trump until another Ace is played.  An Ace that sets trump
 * does not automatically win: it is the lowest rank, so any higher card of
 * the trump suit beats it.
 *
 * This file is meant to be the pattern for the Decktet's other trick-takers,
 * so the trick loop is factored as small named steps:
 *
 *   newGame -> [playCard: lead/follow] -> resolveTrick -> trickWinner
 *            -> collect -> (end of hand) -> deal the next hand
 *
 * Interpretations (each also noted on the rules page):
 *   1. Two players: the wiki's recommended form — nine cards each, the other
 *      eighteen set aside unlooked at.  (The whole-deck 18-card game is
 *      called "awkward and not really worth the trouble" by the wiki.)
 *   2. Length of a match: the wiki leaves the target to agreement; this app
 *      plays five hands (45 tricks, so the higher trick total cannot tie).
 *   3. The dealer alternates each hand and the player to the dealer's left
 *      leads; the wiki only states the leader for the first hand.
 *   4. The extended deck (Excuse, Pawns) is not implemented — the game uses
 *      the basic 36-card deck only.
 *   5. Ties: the wiki's "the one played later takes the trick" is implemented,
 *      though in the basic deck no two cards share both a rank and a suit, so
 *      it can never actually arise.  (The Pawn tie-break — earlier beats
 *      later — belongs to the unimplemented extended deck.) */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));   // Ace 1 … 9, Crown 10
export const suitsOf = (id) => card(id).suits;
export const isAce = (id) => card(id).rank === 1;

/** Does this card carry the given suit? */
export const matchesSuit = (id, suit) => suit != null && suitsOf(id).includes(suit);
/** Do the two cards share at least one suit? */
export const shareSuit = (a, b) => suitsOf(a).some((s) => suitsOf(b).includes(s));

export const HAND_SIZE = 9;    // the wiki's two-player deal
export const HANDS = 5;        // hands in a match (agreed target)

/* ------------------------------------------------- the trick-taking kernel */

/** The trump after this trick's plays, applying Aces in the order played. */
export function trumpAfter(plays, trump) {
  let t = trump;
  for (const p of plays) if (isAce(p.id)) t = suitsOf(p.id)[0];
  return t;
}

/**
 * One card's strength in a trick, as a comparable key [class, rank].
 *
 * If any trump was played, only trumps count (class 1).  Otherwise only
 * cards following suit count.  Higher key wins; ranks are Ace 1 … 9, Crown 10.
 */
export function trickKeys(plays, trump, ledId) {
  const anyTrump = plays.some((p) => matchesSuit(p.id, trump));
  return plays.map((p) => [
    anyTrump
      ? (matchesSuit(p.id, trump) ? 1 : 0)
      : (ledId == null || shareSuit(p.id, ledId) ? 1 : 0),
    rankOf(p.id),
  ]);
}

/** Index of the winning key.  Ties go to the card played later. */
export function bestIndex(keys) {
  let best = 0;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i][0] !== keys[best][0]) { if (keys[i][0] > keys[best][0]) best = i; }
    else if (keys[i][1] >= keys[best][1]) best = i;    // later play takes the tie
  }
  return best;
}

/** Index of the winning play in a trick. */
export function trickWinner(plays, trump, ledId) {
  return bestIndex(trickKeys(plays, trump, ledId));
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
  next.setAside = deck.slice();          // the other eighteen, unlooked at
  next.pile = [[], []];                  // tricks collected, for conservation
  next.trick = [];                       // plays of the current trick
  next.trump = null;
  next.trumpSource = null;
  next.lastTrick = null;
  next.tricksWon = [0, 0];
  next.dealer = dealer;
  next.leader = 1 - dealer;              // the player to the dealer's left
  next.turn = next.leader;
}

export function newGame(seed, deck) {
  const state = {
    seed,
    cards: deck.slice(),                 // the 36 cards, for redealing hands
    handNo: 1,
    total: [0, 0],                       // trick points across all hands
    lastHand: null,                      // { handNo, tricks, total }
    moves: 0,
    over: null,                          // 'match'
    winner: null,
  };
  dealHand(state, 0);                    // player 1 deals the first hand
  return state;
}

/* ------------------------------------------------------------------ moves */

/** The cards this player may play right now. */
export function legalPlays(state) {
  const hand = state.hands[state.turn];
  if (!state.trick.length) return hand.slice();
  const led = state.trick[0].id;
  const following = hand.filter((id) => shareSuit(id, led));
  return following.length ? following : hand.slice();
}

/** Why this play is illegal, or null when it is legal. */
export function explainPlay(state, id) {
  if (state.over) return 'The match is over.';
  if (!state.hands[state.turn].includes(id)) return 'That card is not in your hand.';
  if (!state.trick.length) return null;               // leading: anything goes
  const led = state.trick[0].id;
  if (shareSuit(id, led)) return null;
  if (state.hands[state.turn].some((c) => shareSuit(c, led))) {
    return `${card(led).name} was led, so you must follow suit: play a card that `
      + `shares a suit with it (${suitsOf(led).map((s) => s[0].toUpperCase() + s.slice(1)).join(' or ')}).`;
  }
  return null;                                          // void in the led suit
}

export const canPlay = (state, id) => explainPlay(state, id) == null;

/** Play one card; the trick resolves when the second card lands. */
export function playCard(state, id) {
  const why = explainPlay(state, id);
  if (why) throw new Error(why);
  const next = structuredClone(state);
  const hand = next.hands[next.turn];
  hand.splice(hand.indexOf(id), 1);
  next.trick.push({ player: next.turn, id });
  next.moves += 1;
  if (next.trick.length === 2) resolveTrick(next);
  else next.turn = 1 - next.turn;
  return next;
}

/** Resolve a complete trick: trump, winner, collection, next leader. */
function resolveTrick(next) {
  const trump = trumpAfter(next.trick, next.trump);
  const ledId = next.trick[0].id;
  const winner = next.trick[trickWinner(next.trick, trump, ledId)].player;

  next.pile[winner].push(...next.trick.map((p) => p.id));
  next.tricksWon[winner] += 1;
  next.lastTrick = { plays: next.trick, winner, trump };
  next.trump = trump;
  const lastAce = [...next.trick].reverse().find((p) => isAce(p.id));
  if (lastAce) next.trumpSource = lastAce.id;
  next.trick = [];
  next.leader = winner;
  next.turn = winner;

  if (!next.hands[0].length && !next.hands[1].length) endHand(next);
}

/** Score the hand and deal the next one, or end the match. */
function endHand(next) {
  next.total[0] += next.tricksWon[0];
  next.total[1] += next.tricksWon[1];
  next.lastHand = { handNo: next.handNo, tricks: next.tricksWon.slice(), total: next.total.slice() };
  if (next.handNo >= HANDS) {
    next.over = 'match';
    next.winner = next.total[0] === next.total[1] ? null : (next.total[0] > next.total[1] ? 0 : 1);
  } else {
    next.handNo += 1;
    dealHand(next, 1 - next.dealer);      // the deal passes each hand
  }
}

/** One line describing the current trump situation. */
export function trumpText(state) {
  if (state.trump == null) return 'no trump yet';
  const t = state.trump;
  const cap = t[0].toUpperCase() + t.slice(1);
  return state.trumpSource
    ? `${cap} are trump (set by ${card(state.trumpSource).name})`
    : `${cap} are trump`;
}

export const OUTCOME = {
  match: { title: 'The match is over', cls: 'win' },
};

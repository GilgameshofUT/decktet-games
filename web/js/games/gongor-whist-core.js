/* Gongor Whist — game logic, no DOM.  Imported by the UI (games/gongor-whist.js)
   and by the node test (test/gongor-whist.test.mjs).

   Rules: https://wiki.decktet.com/game:gongor-whist

   The six Aces are shuffled into their own stack; the top one is flipped face
   up and its suit is the initial trump.  After you play a card — but before
   the trick resolves — you may twiddle trump: flip the next ace (or, with the
   ace stack empty, leave the hand with no trump).  Bid how many of the seven
   tricks you will take and take exactly that many.  Each pass through the deck
   is two hands: a fore hand, then an aft hand dealt without reshuffling.

   Scoring modes:
   - 'standard' (the default): every bid 0–7 may be used only once in the
     whole game; miss one bid and you lose, make all eight and you win.
   - 'points': bid any number every hand; add your bid when you make it,
     subtract the tricks you won when you miss; first to 50 wins.

   The state is plain JSON: arrays of card ids, plain numbers/strings/booleans,
   so it survives structuredClone and localStorage. */

import { mulberry32, rankValue } from '../decktet.js';

export { rankValue };

let BY_ID = null;

export function init(cardsById) {
  BY_ID = cardsById;
}

export const card = (id) => BY_ID[id];

export const TRICKS_PER_HAND = 7;
export const POINTS_TARGET = 50;

/** Titles for every possible result; handResult() reports the key it used. */
export const SCORE_TITLES = {
  made: { title: 'Bid made', cls: 'win' },
  missed: { title: 'Bid missed', cls: 'lose' },
  won: { title: 'You win', cls: 'win' },
  lost: { title: 'You lose', cls: 'lose' },
  fifty: { title: 'Fifty points', cls: 'win' },
};

/** Fisher–Yates with the game's own rng, so replays from a seed are exact. */
function shuffleWith(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const basicIdsFromData = () =>
  Object.keys(BY_ID).filter((id) => BY_ID[id].deck === 'basic');

/* ------------------------------------------------------------------ setup */

/** A fresh game.  opts: { basicIds, mode } (an array is taken as basicIds). */
export function newGame(seed, opts = {}) {
  if (Array.isArray(opts)) opts = { basicIds: opts };
  if (!BY_ID) throw new Error('call init(cardsById) before newGame');
  const rng = mulberry32(seed);
  const basic = opts.basicIds || basicIdsFromData();

  const aces = shuffleWith(rng, basic.filter((id) => card(id).rank === 1));
  const rest = shuffleWith(rng, basic.filter((id) => card(id).rank !== 1));
  if (aces.length !== 6 || rest.length !== 30) {
    throw new Error(`expected 6 aces and 30 other cards, got ${aces.length}/${rest.length}`);
  }

  return {
    seed,
    mode: opts.mode === 'points' ? 'points' : 'standard',
    phase: 'bidding',            // bidding -> playing -> handOver -> gameOver
    handNo: 1,                   // 1..8 over a full standard game
    handType: 'fore',            // fore and aft alternate
    bidSheet: [false, false, false, false, false, false, false, false],
    bid: null,
    yourHand: rest.slice(0, 7),
    dummy: rest.slice(7, 14),    // index 0 is the top: the next card led
    deck: rest.slice(14),        // 16 cards left after the fore hand is dealt
    setAside: [],                // the two cards dealt to neither hand
    taken: [],                   // tricks already won: set aside until reshuffle
    acesFlipped: [aces[0]],      // in flip order; the last one sets the trump
    aceStack: aces.slice(1),     // face down, index 0 is the next to flip
    trump: card(aces[0]).suits[0],
    leadCard: null,              // the dummy's face-up card for this trick
    playerCard: null,            // your card for this trick, once played
    twiddled: false,             // twiddle is allowed once per trick
    tricksWon: 0,
    tricksPlayed: 0,
    lastTrick: null,             // { no, lead, play, winner, trump, twiddled }
    score: 0,                    // points mode only
    over: null,                  // 'won' | 'lost' once the game is decided
    moves: 0,
  };
}

/* --------------------------------------------------------------- bidding */

/** Check off `n` (0–7) and start the first trick.  Standard scoring refuses
 *  a bid that has already been used in this game. */
export function bid(st, n) {
  if (!st || st.phase !== 'bidding') throw new Error('bidding is not open');
  if (!Number.isInteger(n) || n < 0 || n > 7) throw new Error('bids run from 0 to 7');
  if (st.mode !== 'points' && st.bidSheet[n]) throw new Error(`bid ${n} has already been used`);

  const next = structuredClone(st);
  if (st.mode !== 'points') next.bidSheet[n] = true;
  next.bid = n;
  next.phase = 'playing';
  next.tricksWon = 0;
  next.tricksPlayed = 0;
  next.lastTrick = null;
  next.twiddled = false;
  next.playerCard = null;
  next.leadCard = next.dummy.shift() || null;   // the dummy leads each trick
  next.moves += 1;
  return next;
}

/* ---------------------------------------------------------------- playing */

/** The cards you may play right now: follow the dummy's lead if you can,
 *  otherwise anything.  Empty unless a trick is waiting for your card. */
export function legalPlays(st) {
  if (!st || st.phase !== 'playing' || st.playerCard || !st.leadCard) return [];
  const lead = card(st.leadCard);
  const following = st.yourHand.filter((id) =>
    card(id).suits.some((s) => lead.suits.includes(s)));
  return following.length ? following : st.yourHand.slice();
}

/** Play `id` from your hand onto the dummy's lead.  Pure: returns a new state. */
export function playCard(st, id) {
  if (!st || st.phase !== 'playing') throw new Error('it is not your play');
  if (st.playerCard) throw new Error('a card has already been played this trick');
  if (!st.leadCard) throw new Error('the dummy has not led');
  if (!st.yourHand.includes(id)) throw new Error(`${id} is not in your hand`);
  if (!legalPlays(st).includes(id)) throw new Error('you must follow suit');

  const next = structuredClone(st);
  next.yourHand = next.yourHand.filter((c) => c !== id);
  next.playerCard = id;
  next.twiddled = false;
  next.moves += 1;
  return next;
}

/** Twiddle trump: flip the next ace of the stack and make its suit trump.
 *  With no aces left there is no trump for the rest of the hand.  Only legal
 *  after you have played and before the trick resolves, once per trick. */
export function twiddle(st) {
  if (!st || st.phase !== 'playing' || !st.playerCard) {
    throw new Error('twiddle after you play, before the trick resolves');
  }
  if (st.twiddled) throw new Error('you have already twiddled this trick');

  const next = structuredClone(st);
  next.twiddled = true;
  next.moves += 1;
  if (next.aceStack.length) {
    const id = next.aceStack.shift();
    next.acesFlipped.push(id);
    next.trump = card(id).suits[0];
  } else {
    next.trump = null;            // no trump for the remainder of the hand
  }
  return next;
}

/** Who takes the trick?  `leadCard` is the dummy's card, `playerCard` yours,
 *  `trump` a suit or null.  Returns 'you' or 'dummy'. */
export function trickWinner(leadId, playId, trump) {
  const lead = card(leadId);
  const play = card(playId);
  const leadIsTrump = !!trump && lead.suits.includes(trump);
  const playIsTrump = !!trump && play.suits.includes(trump);

  if (playIsTrump) {
    // You played trump and the dummy didn't, or you played the higher trump.
    if (!leadIsTrump) return 'you';
    return rankValue(play) > rankValue(lead) ? 'you' : 'dummy';
  }
  if (leadIsTrump) return 'dummy';   // the dummy played trump, you did not

  // No trump was played: the higher card that shares a suit with the dummy's
  // lead wins; if you could not follow suit, you lose the trick.
  if (!lead.suits.some((s) => play.suits.includes(s))) return 'dummy';
  return rankValue(play) > rankValue(lead) ? 'you' : 'dummy';
}

/** Settle the trick you have just played.  Pure: returns a new state. */
export function resolveTrick(st) {
  if (!st || st.phase !== 'playing' || !st.playerCard) {
    throw new Error('there is no trick to resolve');
  }
  const next = structuredClone(st);
  const winner = trickWinner(next.leadCard, next.playerCard, next.trump);

  next.tricksPlayed += 1;
  if (winner === 'you') next.tricksWon += 1;
  next.lastTrick = {
    no: next.tricksPlayed,
    lead: next.leadCard,
    play: next.playerCard,
    winner,
    trump: next.trump,
    twiddled: next.twiddled,
  };
  next.taken.push(next.leadCard, next.playerCard);
  next.leadCard = null;
  next.playerCard = null;
  next.twiddled = false;
  next.moves += 1;

  if (!next.yourHand.length || !next.dummy.length) next.phase = 'handOver';
  else next.leadCard = next.dummy.shift();       // the dummy leads again
  return next;
}

/* --------------------------------------------------------------- scoring */

/** The result of the hand in `st`.  Pure — it never mutates anything, so it
 *  also works on fixture states built by hand. */
export function handResult(st) {
  const mode = st.mode === 'points' ? 'points' : 'standard';
  const bidMade = st.bid;
  const tricksWon = st.tricksWon;
  const ok = tricksWon === bidMade;

  // Point scoring: exactly your bid adds it, anything else costs the tricks
  // you did take.  The checklist scoring has no points.
  const points = mode === 'points' ? (ok ? bidMade : -tricksWon) : 0;
  const score = (st.score || 0) + points;

  const sheetDone = Array.isArray(st.bidSheet) && st.bidSheet.length === 8
    && st.bidSheet.every(Boolean);

  let outcome = null;
  if (mode === 'points') {
    if (score >= POINTS_TARGET) outcome = 'won';   // first to 50 wins
  } else if (!ok) {
    outcome = 'lost';                              // one missed bid ends it
  } else if (sheetDone) {
    outcome = 'won';                               // all eight bids made
  }

  const gameOver = outcome !== null;
  let key;
  if (gameOver) key = outcome === 'won' ? (mode === 'points' ? 'fifty' : 'won') : 'lost';
  else key = ok ? 'made' : 'missed';

  return {
    bid: bidMade,
    tricksWon,
    ok,
    points,
    score,
    gameOver,
    outcome,
    key,
    title: SCORE_TITLES[key].title,
    cls: SCORE_TITLES[key].cls,
  };
}

/** The hand is over: either the game ends, or the next hand (fore -> aft ->
 *  fore ...) is dealt.  Pure: returns a new state. */
export function nextHand(st) {
  if (!st || st.phase !== 'handOver') throw new Error('the hand is not over');
  const res = handResult(st);
  const next = structuredClone(st);
  if (next.mode === 'points') next.score = res.score;
  next.moves += 1;

  if (res.gameOver) {
    next.phase = 'gameOver';
    next.over = res.outcome;
    return next;
  }

  const wasFore = next.handType === 'fore';
  next.handNo += 1;
  next.handType = wasFore ? 'aft' : 'fore';

  if (wasFore) {
    // The aft hand: do not reshuffle.  Deal seven and seven from what is
    // left; the last two cards are set aside without looking at them.  The
    // ace pile, the trump and the tricks set aside stay exactly as they are.
    next.yourHand = next.deck.splice(0, 7);
    next.dummy = next.deck.splice(0, 7);
    next.setAside = next.deck.splice(0, next.deck.length);
  } else {
    // End of the pass: reshuffle the ace pile together with the main deck —
    // the tricks won over both hands plus the two cards set aside — then deal
    // a fresh fore hand and flip the top ace for the initial trump.
    const rng = mulberry32((next.seed ^ Math.imul(next.handNo, 0x9e3779b1)) >>> 0);
    const aces = shuffleWith(rng, [...next.acesFlipped, ...next.aceStack]);
    const main = shuffleWith(rng, [...next.taken, ...next.setAside, ...next.deck]);
    next.acesFlipped = [aces[0]];
    next.aceStack = aces.slice(1);
    next.trump = card(aces[0]).suits[0];
    next.yourHand = main.slice(0, 7);
    next.dummy = main.slice(7, 14);
    next.deck = main.slice(14);
    next.setAside = [];
    next.taken = [];
  }

  next.bid = null;
  next.phase = 'bidding';
  next.tricksWon = 0;
  next.tricksPlayed = 0;
  next.leadCard = null;
  next.playerCard = null;
  next.twiddled = false;
  next.lastTrick = null;
  return next;
}

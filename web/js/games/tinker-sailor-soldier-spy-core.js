/* Tinker, Sailor, Soldier, Spy — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:tinker-sailor-soldier-spy  (mrichey)
 *
 * A Friday-like solo game.  You start with four cards (the Excuse — you —
 * plus the Sailor, Soldier and Diplomat) and 36 suit chips.  Round 1 you
 * reveal a personality and an event, pick one as the challenge, and beat it
 * by playing cards and chips of the challenge's suits; beaten challenges
 * join your deck, the other card is trashed.  Round 2 you must beat every
 * location in turn.  Each time your hand empties an Ace is shuffled in —
 * weariness.  Run out of chips mid-location and you lose.
 *
 * Interpretations (all stated on the rules page):
 *   1. Weariness — the wiki says both "add an Ace to your discard pile" and
 *      "add an Ace to your hand".  We follow m.c. de Marco's write-up
 *      (mcdemarco.net/games/decktet/ttss/): whenever you must draw from an
 *      empty draw pile, take the top Ace (if any remain) and shuffle it into
 *      the deck being rebuilt.  One Ace per reshuffle, none once they run out.
 *   2. Pile sizes — the wiki (rev 26) gives 11 personalities, 11 events
 *      (incl. the Market) and "the remaining cards" as locations.  The Decktet
 *      Book's interpretive-type chart makes that arithmetic work: 14
 *      personalities (11 basic + Watchman, Light Keeper, Consul) less the
 *      three that start the game = 11; 13 events less Origin and End = 11;
 *      14 locations less the Market = 13 (incl. Origin and End).
 *      4 + 11 + 11 + 13 + 6 aces = 45.
 *   3. Ranks — the extended-deck values from the wiki and m.c. de Marco:
 *      Excuse 0, Ace 1 … 9, Pawn 10, Court 11, Crown 12.
 *   4. Ending — round 1 cannot be lost (giving up is always allowed once the
 *      free card is played); round 2 is mandatory and is lost the moment the
 *      current location is unbeatable and you cannot continue.
 *   5. Suits — wiki example text uses the old names: wyrms = daemons,
 *      knots = crowns. */

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[String(id).split('#')[0]];

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];

/* ------------------------------------------------------------- card piles */
/* The Book's "Summary of Cards by Interpretive Type", with the three
 * dual-type cards assigned the way the wiki and m.c. de Marco assign them:
 * the Market goes to Events, the Origin and the End go to Locations. */

export const STARTERS = [
  'the-excuse', 'the-sailor', 'the-soldier', 'the-diplomat',
];
export const PERSONALITIES = [
  'the-author', 'the-bard', 'the-huntress', 'the-lunatic', 'the-merchant',
  'the-painter', 'the-penitent', 'the-savage',
  'the-consul', 'the-light-keeper', 'the-watchman',
];
export const EVENTS = [
  'the-journey', 'the-battle', 'the-discovery', 'the-market',
  'the-chance-meeting', 'the-betrayal', 'the-pact', 'the-harvest',
  'the-rite', 'the-calamity', 'the-windfall',
];
export const LOCATIONS = [
  'the-desert', 'the-origin', 'the-mountain', 'the-forest', 'the-castle',
  'the-cave', 'the-mill', 'the-darkness', 'the-borderland', 'the-island',
  'the-window', 'the-sea', 'the-end',
];

/** Card value for payment: Excuse 0, Ace 1 … 9, Pawn 10, Court 11, Crown 12. */
export function val(id) {
  const c = card(id);
  if (c.rank == null) return 0;                 // the Excuse
  if (c.rank === 'pawn') return 10;
  if (c.rank === 'court') return 11;
  if (c.rank === 'crown') return 12;
  return c.rank;                                // Ace 1 … 9
}

/* ------------------------------------------------------------------- rng */
/* The generator lives in the state so saves, undo and reload stay stable. */

function rand(st) {
  let a = (st.rngState + 0x6d2b79f5) | 0;
  st.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(arr, st) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(st) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ------------------------------------------------------------------ setup */

export function newGame(seed, deck) {
  if (deck.length !== 45) throw new Error(`the extended Decktet is 45 cards, got ${deck.length}`);
  const st = {
    seed,
    rngState: seed >>> 0,
    over: null,
    round: 1,
    phase: 'choose',              // 'choose' | 'fight' | 'over'
    personalities: [], events: [], locations: [], aces: [],
    draw: [], discard: [], trash: [],
    played: [],                   // cards in play for the current challenge
    challenge: null,
    choice: null,                 // [personality, event] offered this turn
    chips: Object.fromEntries(SUITS.map((s) => [s, 6])),
    chipPlay: [],                 // suits of chips spent on this challenge
    chipTrash: Object.fromEntries(SUITS.map((s) => [s, 0])),
    challengesDone: 0,
    acesAdded: 0,                 // weariness
    moves: 0,
    lastNote: null,
  };

  const left = new Set(deck);
  const take = (ids, label) => {
    const out = [];
    for (const id of ids) {
      if (!left.has(id)) throw new Error(`${label}: ${id} not in deck`);
      left.delete(id);
      out.push(id);
    }
    return out;
  };
  st.draw = take(STARTERS, 'starters');
  st.personalities = take(PERSONALITIES, 'personalities');
  st.events = take(EVENTS, 'events');
  st.locations = take(LOCATIONS, 'locations');
  for (const id of deck) {
    if (left.has(id) && card(id).rank === 1) { left.delete(id); st.aces.push(id); }
  }
  if (left.size) throw new Error(`unassigned cards: ${[...left].join(', ')}`);

  for (const pile of [st.draw, st.personalities, st.events, st.locations, st.aces]) {
    shuffle(pile, st);
  }
  offerChallenge(st);
  return st;
}

/** Reveal the top personality and the top event (round 1). */
function offerChallenge(st) {
  if (!st.personalities.length && !st.events.length) return;
  st.phase = 'choose';
  st.choice = [
    st.personalities.length ? st.personalities.pop() : null,
    st.events.length ? st.events.pop() : null,
  ];
}

/* -------------------------------------------------------------- summing */

/** Suits the current challenge accepts payment in. */
export function goalSuits(state) {
  return state.challenge ? new Set(card(state.challenge).suits) : new Set();
}

/** The value the current challenge must be matched or beaten. */
export const goal = (state) => (state.challenge ? val(state.challenge) : 0);

/** Sum of played cards and chips that match the challenge's suits. */
export function sum(state) {
  const suits = goalSuits(state);
  let s = 0;
  for (const id of state.played) {
    if (card(id).suits.some((x) => suits.has(x))) s += val(id);
  }
  for (const suit of state.chipPlay) if (suits.has(suit)) s += 1;
  return s;
}

export const chipsLeft = (state) =>
  SUITS.reduce((n, s) => n + state.chips[s], 0);

/** May another card be played this fight?  (a chip and a card to draw) */
export function canContinue(state) {
  if (state.over || state.phase !== 'fight') return false;
  if (chipsLeft(state) <= 0) return false;
  return state.draw.length + state.discard.length > 0;
}

/* ------------------------------------------------------------ draw / reshuffle */

/** Draw one card, reshuffling the discard (plus a weary Ace) when needed. */
function drawOne(st) {
  if (!st.draw.length) {
    if (!st.discard.length) return null;
    st.draw = st.discard;
    st.discard = [];
    if (st.aces.length) {                       // weariness
      st.draw.push(st.aces.pop());
      st.acesAdded += 1;
      st.lastNote = st.lastNote
        ? `${st.lastNote} Your company is weary — an Ace has joined the deck.`
        : 'Your company is weary — an Ace has joined the deck.';
    }
    shuffle(st.draw, st);
  }
  return st.draw.pop();
}

/* ------------------------------------------------------------- the fight */

function startFight(st, id) {
  st.challenge = id;
  st.phase = 'fight';
  st.played = [];
  st.chipPlay = [];
  const free = drawOne(st);                     // the mandatory free play
  if (free) st.played.push(free);
  settleFight(st);
}

/** After each card: beat it, or notice the fight can no longer continue.
 *  Exported for the tests; the UI reaches it through the actions. */
export function settleFight(st) {
  if (st.over) return;
  if (sum(st) >= goal(st)) { resolveFight(st, true); return; }
  if (!canContinue(st) && st.round === 2) {
    st.over = 'lost';
    st.phase = 'over';
    st.lastNote = 'You cannot beat this location — no amulets left to press on.';
  }
}

function resolveFight(st, won) {
  for (const suit of st.chipPlay) st.chipTrash[suit] += 1;
  st.chipPlay = [];
  st.discard.push(...st.played);
  st.played = [];
  if (!won) {
    st.trash.push(st.challenge);               // gave up: the card is lost
    st.lastNote = 'You backed down — the challenge card is trashed.';
  } else if (st.round === 1) {
    st.discard.push(st.challenge);             // recruited into the deck
  } else {
    st.trash.push(st.challenge);               // locations never join the deck
  }
  st.challenge = null;
  st.challengesDone += 1;

  if (st.round === 2) {
    if (!st.locations.length) {
      st.over = 'won';
      st.phase = 'over';
      return;
    }
    startFight(st, st.locations.pop());
    return;
  }
  if (!st.personalities.length && !st.events.length) {
    if (!st.locations.length) {                 // nothing left to fight at all
      st.over = 'won';
      st.phase = 'over';
      return;
    }
    st.round = 2;
    st.choice = null;
    st.phase = 'fight';
    st.lastNote = 'Round 2 — the journey begins. Every location must fall.';
    startFight(st, st.locations.pop());
    return;
  }
  offerChallenge(st);
}

/* --------------------------------------------------------------- actions */

/** Round 1: pick one of the two offered cards as the challenge. */
export function choose(state, i) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'choose' || !state.choice) throw new Error('no challenge is being offered');
  if (i !== 0 && i !== 1) throw new Error('bad choice');
  const chosen = state.choice[i];
  if (!chosen) throw new Error('bad choice');
  const other = state.choice[1 - i];
  const next = structuredClone(state);
  next.choice = null;
  if (other) {
    next.trash.push(other);
    next.lastNote = `Trashed the ${card(other).name.replace(/^the /, '')}.`;
  }
  next.moves += 1;
  startFight(next, chosen);
  return next;
}

/** Spend one suit chip and draw the next card into the fight. */
export function playChip(state, suit) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'fight' || !state.challenge) throw new Error('no challenge is being fought');
  if (!SUITS.includes(suit)) throw new Error('unknown suit');
  if (!state.chips[suit]) throw new Error(`no ${suit} amulets left`);
  if (!state.draw.length && !state.discard.length) throw new Error('no cards left to draw');
  const next = structuredClone(state);
  next.chips[suit] -= 1;
  next.chipPlay.push(suit);
  const card2 = drawOne(next);
  if (!card2) throw new Error('no cards left to draw');
  next.played.push(card2);
  next.moves += 1;
  settleFight(next);
  return next;
}

/** Round 1 only: back down from the current challenge. */
export function giveUp(state) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'fight' || !state.challenge) throw new Error('no challenge is being fought');
  if (state.round === 2) throw new Error('you cannot give up on a location');
  if (!state.played.length) throw new Error('the free play has not happened yet');
  const next = structuredClone(state);
  resolveFight(next, false);
  next.moves += 1;
  return next;
}

/* ----------------------------------------------------------------- misc */

/** Every card, wherever it is. */
export function allCards(state) {
  return [
    ...state.personalities, ...state.events, ...state.locations, ...state.aces,
    ...state.draw, ...state.discard, ...state.trash, ...state.played,
    ...(state.challenge ? [state.challenge] : []),
    ...(state.choice || []).filter(Boolean),
  ];
}

export const OUTCOME = {
  won: {
    title: 'The world is saved',
    cls: 'win',
    text: 'Every location has been cleansed of evil. Your company can rest — ' +
      'for now.',
  },
  lost: {
    title: 'Stranded',
    cls: 'lose',
    text: 'You ran out of amulets with evil still in a location. The journey ends here.',
  },
};

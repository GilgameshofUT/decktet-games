/* Shed — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:shed  (Greg James)
 *
 * Two players, ten cards each, one token in every suit (the other tokens of
 * each suit sit in the supply).  A trick is led by one card; every later play
 * must match the *type* of that lead — Personality, Location or Event — except
 * when an Ace is led, when every play must match the Ace's suit instead.  The
 * trick is won by the highest combined score of each player's type-matching
 * cards (ties to the player whose card tied the score); the winner then sheds
 * one of their tokens that matches a suit of the lead card, or — if they hold
 * none — takes one as a penalty from an opponent or from the supply.  Shed
 * your last token and you win immediately.
 *
 * The trick loop follows the pattern of ace-trump-core.js (copied, not
 * imported), factored as:
 *
 *   newGame -> [lead] -> [play] -> resolveTrick -> trickWinner/scores
 *           -> collect -> shed (own / opponent / supply) -> draw -> next lead
 *           -> (hands empty) -> new round -> … -> over
 *
 * with explainLead / explainPlay / explainShed returning the human-readable
 * refusals the core throws.
 *
 * Interpretations (each also noted on the rules page):
 *   1. Two-player rules exactly as written: 10-card hands, 4 cards set aside
 *      as the remainder each round (10 + 10 + 4 + 12 in the draw pile = 36),
 *      Pawns and Courts are NOT used (basic 36-card deck), each player plays
 *      two cards per trick A-B-A-B, and after each trick each player draws
 *      exactly one card (winner first) while the draw pile lasts.
 *   2. Tokens: the components list "5 in each of the six suits" = 30 tokens;
 *      each player starts with the 6-token pool (one per suit), so the supply
 *      starts with 3 of each suit.  Tokens are counters in state, drawn from
 *      the suit icons.
 *   3. Combined score decides a type-led trick: the wiki's 2P text mirrors the
 *      partnership rules ("may be added together for a combined score" and
 *      "the trick being awarded to the player that plays the card which ties
 *      the score"), and the partnership example wins a trick 14 to 9 on
 *      combined score rather than on the single highest card.  Ace-led tricks
 *      stay "won on the merits of rank and suit only", exactly as the rules
 *      state, with the Ace's two special wins (matching Crown played, or the
 *      Ace is the only card of its suit).
 *   4. Ace scoring (2P): an Ace scores 0 unless it leads; a leading Ace scores
 *      1; if the opponent plays the matching Crown onto the lead the Ace
 *      scores 11; if the leader plays their own matching Crown the Ace still
 *      scores 1.  The combined score is shown as a running total — the wiki
 *      gives it no role in deciding the 2P game, which is won only by
 *      shedding every token, so it never decides the winner here.
 *   5. Kingmaker Scenario: exposed as a toggle, defaulting to the designer's
 *      own house rule — option 1, "the game ends at this point" (at two
 *      players the candidate set is a single player, so the shared victory
 *      degenerates to your opponent winning the moment a forced penalty take
 *      would empty them).  Option 2, "take from the supply as his penalty",
 *      is available from the table and redirects exactly that game-deciding
 *      take to the supply so play continues to a definite winner; if the
 *      supply holds no matching token it falls back to the forced take.
 *   6. Shedding is mandatory whenever the winner holds a token matching the
 *      lead — "may shed" is read as must-shed-when-able, since shedding can
 *      only ever help and declining would only ever delay your own win.
 *   7. First dealer is picked at random (the wiki's "whose pet sheds the
 *      most"), the dealer then alternates each round, and a round ends when
 *      both hands are empty: all 36 cards are reshuffled including the
 *      remainder.  Aces rank zero in tricks they do not lead.
 *   8. Not implemented: the partnership rules, the random-start-token
 *      variant, and the extended deck (Pawns/Courts), none of which the two-
 *      player rules use. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));      // Ace 1 … 9, Crown 10
export const suitsOf = (id) => card(id).suits;
export const isAce = (id) => card(id).rank === 1;
export const isCrown = (id) => card(id).rank === 'crown';
export const isPersonality = (id) => !!card(id).personality;
export const cap = (s) => s[0].toUpperCase() + s.slice(1);

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const HAND_SIZE = 10;        // 2P rules
export const REMAINDER = 4;         // 2P rules: set aside unseen each round
export const DRAW_SIZE = 12;        // 36 - 10 - 10 - 4
export const TRICK_SIZE = 4;        // each player plays twice, A-B-A-B
export const TOKENS_PER_SUIT = 5;   // components: 5 tokens in each suit
export const KINGMAKER_MODES = ['shared', 'supply'];

/* --------------------------------------------- card types (the marks) */

/* The star/dot/split-dot marks of the Decktet, as tabulated in "Summary of
 * Cards by Interpretive Type" (The Decktet Book, p.134; the charts PDF at
 * decktet.com).  The Origin, the Market and the End carry both marks. */
export const LOCATIONS = new Set([
  'the-desert', 'the-origin', 'the-mountain', 'the-forest', 'the-market',
  'the-castle', 'the-cave', 'the-mill', 'the-darkness', 'the-sea', 'the-end',
]);
export const EVENTS = new Set([
  'the-origin', 'the-journey', 'the-battle', 'the-discovery', 'the-market',
  'the-chance-meeting', 'the-betrayal', 'the-pact', 'the-end', 'the-calamity',
  'the-windfall',
]);
export const DUALS = new Set(['the-origin', 'the-market', 'the-end']);

/** Every type this card can count as: [] for Aces, ['a','b'] for duals. */
export function cardTypes(id) {
  const b = baseId(id);
  if (isAce(id)) return [];
  if (isPersonality(id)) return ['personality'];
  const out = [];
  if (LOCATIONS.has(b)) out.push('location');
  if (EVENTS.has(b)) out.push('event');
  return out;
}
export const isDual = (id) => DUALS.has(baseId(id));

/** The type this card leads as; duals must be announced. */
export function leadType(id, announce) {
  if (isAce(id)) return 'ace';
  if (isPersonality(id)) return 'personality';
  if (isDual(id)) return announce === 'location' || announce === 'event' ? announce : null;
  return LOCATIONS.has(baseId(id)) ? 'location' : 'event';
}

/** Does this card count as following a lead of `type`? */
export function followsType(id, type) {
  if (type === 'personality') return isPersonality(id);
  if (type === 'location') return LOCATIONS.has(baseId(id));
  if (type === 'event') return EVENTS.has(baseId(id));
  return false;
}

export const TYPE_LABEL = {
  personality: 'Personality', location: 'Location', event: 'Event', ace: 'Ace',
};
const art = (word) => (/^[AEIO]/.test(word) ? 'an' : 'a');

/* ------------------------------------------------------------ trick kernel */

/**
 * Each player's combined score for a trick: their own cards that match the
 * lead type, added together.  In an Ace trick only cards of the Ace's suit
 * score, and the Ace itself scores 0 / 1 / 11 per the 2P Ace rules.
 */
export function trickScores(plays, type, aceSuit) {
  const scores = [0, 0];
  if (type === 'ace') {
    const ace = plays[0];
    const crown = plays.find((p) => isCrown(p.id) && suitsOf(p.id).includes(aceSuit));
    const crownByOpponent = !!crown && crown.player !== ace.player;
    for (const p of plays) {
      if (!suitsOf(p.id).includes(aceSuit)) continue;
      scores[p.player] += (p === ace) ? (crownByOpponent ? 11 : 1) : rankOf(p.id);
    }
    return scores;
  }
  for (const p of plays) if (followsType(p.id, type)) scores[p.player] += rankOf(p.id);
  return scores;
}

/** Who takes the trick: combined score, tie to the card that tied the score. */
export function trickWinner(plays, type, aceSuit) {
  if (type === 'ace') return aceWinner(plays, aceSuit);
  const scores = trickScores(plays, type, aceSuit);
  if (scores[0] !== scores[1]) return scores[0] > scores[1] ? 0 : 1;
  const scoring = plays.filter((p) => followsType(p.id, type));
  return scoring[scoring.length - 1].player;
}

/**
 * An Ace trick is won on rank and suit: the Ace wins if its matching Crown
 * is in the trick, or if it is the only card of its suit; otherwise the
 * highest card of the Ace's suit wins, with the Ace counting as zero and
 * ties going to the last card played.
 */
function aceWinner(plays, aceSuit) {
  const ace = plays[0];
  const crown = plays.find((p) => isCrown(p.id) && suitsOf(p.id).includes(aceSuit));
  if (crown) return ace.player;
  let best = null;
  for (const p of plays) {
    if (!suitsOf(p.id).includes(aceSuit)) continue;
    const v = (p === ace) ? 0 : rankOf(p.id);
    if (!best || v >= best.v) best = { player: p.player, v };
  }
  return best ? best.player : ace.player;
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

const pool = (n) => Object.fromEntries(SUITS.map((s) => [s, n]));
export const heldTotal = (tokens) => SUITS.reduce((sum, s) => sum + tokens[s], 0);
export const tokensOf = (state, p) => heldTotal(state.tokens[p]);

/** Deal a round: 10 each, 4 remainder, 12 to the draw pile. */
function dealRound(next) {
  const rng = mulberry32((next.seed + next.round * 7919) >>> 0);
  const deck = shuffleWith(next.cards, rng);
  next.hands = [[], []];
  for (let i = 0; i < HAND_SIZE; i++) {
    next.hands[0].push(deck.pop());
    next.hands[1].push(deck.pop());
  }
  next.remainder = [deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  next.draw = deck;                     // the other 12
  next.discards = [];
  next.trick = [];
  next.trickType = null;
  next.trickSuit = null;
  next.leadId = null;
  next.lastTrick = null;
  next.phase = 'lead';
}

export function newGame(seed, deck) {
  const dealer = mulberry32(seed)() < 0.5 ? 0 : 1;    // "whose pet sheds the most"
  const state = {
    seed,
    cards: deck.slice(),
    round: 1,
    dealer,
    leader: 1 - dealer,
    turn: 1 - dealer,
    tokens: [pool(1), pool(1)],        // one of each suit per player
    supply: pool(TOKENS_PER_SUIT - 2), // 3 of each suit left for the table
    scores: [0, 0],                    // combined scores (display only)
    tricksWon: [0, 0],
    kingmaker: 'shared',               // option 1 (the designer's own rule)
    lastEvent: { kind: 'deal' },
    lastShed: null,
    moves: 0,
    over: null,                        // 'shed' | 'kingmaker'
    winner: null,
    endReason: null,
  };
  dealRound(state);
  return state;
}

/* ------------------------------------------------------------------ moves */

/** Why this lead is illegal, or null when it is legal. */
export function explainLead(state, id, announce) {
  if (state.over) return 'The game is over.';
  if (state.phase === 'shed') {
    return `Player ${state.turn + 1}: choose a token to shed before the next trick.`;
  }
  if (state.phase !== 'lead') {
    return `Player ${state.turn + 1} is still playing to the trick in progress.`;
  }
  if (!state.hands[state.turn].includes(id)) return 'That card is not in your hand.';
  if (isDual(id) && announce !== 'location' && announce !== 'event') {
    return `${card(id).name} is either a Location or an Event — announce which type of `
      + 'trick it leads as you play it.';
  }
  return null;
}

export const canLead = (state, id, announce) => explainLead(state, id, announce) == null;

/** Lead a card; `announce` picks the type for the three ambiguous cards. */
export function lead(state, id, announce) {
  const why = explainLead(state, id, announce);
  if (why) throw new Error(why);
  const next = structuredClone(state);
  const hand = next.hands[next.turn];
  hand.splice(hand.indexOf(id), 1);

  next.trick = [{ player: next.turn, id }];
  next.leadId = id;
  next.trickType = leadType(id, announce);
  next.trickSuit = next.trickType === 'ace' ? suitsOf(id)[0] : null;
  next.phase = 'follow';
  next.turn = 1 - next.turn;
  next.moves += 1;
  next.lastEvent = { kind: 'lead', player: 1 - next.turn, id };
  return next;
}

/** Why this follow is illegal, or null when it is legal. */
export function explainPlay(state, id) {
  if (state.over) return 'The game is over.';
  if (state.phase === 'shed') {
    return `Player ${state.turn + 1}: choose a token to shed before the next trick.`;
  }
  if (state.phase !== 'follow') return 'Now is not the time to play a card — lead one first.';
  const hand = state.hands[state.turn];
  if (!hand.includes(id)) return 'That card is not in your hand.';

  if (state.trickType === 'ace') {
    const suit = state.trickSuit;
    if (suitsOf(id).includes(suit)) return null;
    if (hand.some((c) => suitsOf(c).includes(suit))) {
      return `${card(state.leadId).name} led an Ace trick, so you must follow ${cap(suit)}. `
        + `Play a ${cap(suit)} card — ${card(id).name} does not share the suit.`;
    }
    return null;                                   // void in the suit: play anything
  }

  if (followsType(id, state.trickType)) return null;
  const label = TYPE_LABEL[state.trickType];
  if (hand.some((c) => followsType(c, state.trickType))) {
    return `${card(state.leadId).name} led ${art(label)} ${label} trick, so you must play `
      + `${art(label)} ${label} card. ${card(id).name} is not one — you still hold `
      + `${art(label)} ${label} card.`;
  }
  return null;                                     // no card of that type: play anything
}

export const canPlay = (state, id) => explainPlay(state, id) == null;

/** The cards this player may legally play right now. */
export function legalPlays(state) {
  const hand = state.hands[state.turn] || [];
  if (state.phase !== 'follow') return hand.slice();
  const fitting = hand.filter((id) => explainPlay(state, id) == null);
  return fitting.length ? fitting : hand.slice();
}

/** Play the follow; the trick resolves on the fourth card. */
export function playCard(state, id) {
  const why = explainPlay(state, id);
  if (why) throw new Error(why);
  const next = structuredClone(state);
  const hand = next.hands[next.turn];
  hand.splice(hand.indexOf(id), 1);
  next.trick.push({ player: next.turn, id });
  next.moves += 1;
  next.lastEvent = { kind: 'play', player: next.turn, id };

  if (next.trick.length === TRICK_SIZE) resolveTrick(next);
  else next.turn = 1 - next.turn;
  return next;
}

/** Score the complete trick, award it, then the winner sheds (or plays on). */
function resolveTrick(next) {
  const plays = next.trick;
  const scores = trickScores(plays, next.trickType, next.trickSuit);
  const winner = trickWinner(plays, next.trickType, next.trickSuit);

  next.scores[0] += scores[0];
  next.scores[1] += scores[1];
  next.tricksWon[winner] += 1;
  next.lastTrick = { plays: plays.slice(), winner, type: next.trickType, scores, lead: next.leadId };
  next.discards.push(...plays.map((p) => p.id));
  next.trick = [];
  next.turn = winner;                              // the winner leads the next trick
  next.lastEvent = { kind: 'trick', winner, scores };

  if (shedOptionsFor(next, winner).length) next.phase = 'shed';
  else afterTrick(next, winner);
}

/* ------------------------------------------------------------- shedding */

/**
 * The tokens the trick winner may take this moment, in lead-suit order:
 *   own     — shed one to the supply (the normal case)
 *   opponent — a penalty take (you hold none of the lead suits)
 *   supply  — back out of the supply (nobody holds one, or the Kingmaker
 *             option "take from the supply" is on and the take would decide
 *             the game)
 */
export function shedOptionsFor(state, w) {
  const leadSuits = suitsOf(state.leadId);
  const own = leadSuits.filter((s) => state.tokens[w][s] > 0);
  if (own.length) return own.map((s) => ({ suit: s, source: 'own' }));

  const opp = 1 - w;
  const theirs = leadSuits.filter((s) => state.tokens[opp][s] > 0);
  if (theirs.length) {
    const decides = heldTotal(state.tokens[opp]) === 1;   // the take would empty them
    if (state.kingmaker === 'supply' && decides) {
      const fromSupply = leadSuits.filter((s) => state.supply[s] > 0);
      if (fromSupply.length) return fromSupply.map((s) => ({ suit: s, source: 'supply' }));
    }
    return theirs.map((s) => ({ suit: s, source: 'opponent' }));
  }
  return leadSuits.filter((s) => state.supply[s] > 0).map((s) => ({ suit: s, source: 'supply' }));
}

/** The choices open to the player on turn while the shed phase lasts. */
export function shedOptions(state) {
  return state.phase === 'shed' ? shedOptionsFor(state, state.turn) : [];
}

const SOURCE_TEXT = {
  own: 'shed it to the supply',
  opponent: 'take it from your opponent',
  supply: 'take it from the supply',
};

/** Why this token choice is illegal, or null when it is legal. */
export function explainShed(state, suit) {
  if (state.over) return 'The game is over.';
  if (state.phase !== 'shed') return 'Now is not the time to shed a token.';
  const opts = shedOptions(state);
  if (opts.some((o) => o.suit === suit)) return null;
  const leadSuits = suitsOf(state.leadId).map(cap).join(' or ');
  if (!SUITS.includes(suit)) return 'There is no such token.';
  const list = opts.map((o) => `${cap(o.suit)} (${SOURCE_TEXT[o.source]})`).join(', ');
  return `The trick was led by ${card(state.leadId).name}, so only a ${leadSuits} token `
    + `can be shed — and you can ${list || 'take nothing at all'}.`;
}

export const canShed = (state, suit) => explainShed(state, suit) == null;

/**
 * Take one token as the trick winner: shed your own to the supply, or take a
 * penalty from the opponent or the supply.  Shedding your last token ends the
 * game at once; emptying an opponent with a forced take ends it too (the
 * Kingmaker Scenario).
 */
export function shedToken(state, suit) {
  const why = explainShed(state, suit);
  if (why) throw new Error(why);
  const next = structuredClone(state);
  const w = next.turn;
  const opp = 1 - w;
  const opt = shedOptionsFor(next, w).find((o) => o.suit === suit);

  if (opt.source === 'own') {
    next.tokens[w][suit] -= 1;
    next.supply[suit] += 1;
  } else if (opt.source === 'opponent') {
    next.tokens[opp][suit] -= 1;
    next.tokens[w][suit] += 1;
  } else {
    next.supply[suit] -= 1;
    next.tokens[w][suit] += 1;
  }
  next.moves += 1;
  next.lastShed = { player: w, suit, source: opt.source };
  next.lastEvent = { kind: opt.source === 'own' ? 'shed' : 'penalty', player: w, suit, source: opt.source };

  if (heldTotal(next.tokens[w]) === 0) {
    next.over = 'shed';
    next.endReason = 'shed';
    next.winner = w;
    next.phase = 'over';
    return next;
  }
  if (opt.source === 'opponent' && heldTotal(next.tokens[opp]) === 0) {
    next.over = 'kingmaker';
    next.endReason = 'kingmaker';
    next.winner = opp;
    next.phase = 'over';
    return next;
  }
  afterTrick(next, w);
  return next;
}

/** Defensive way out of a shed phase with nothing to take. */
export function continueAfterTrick(state) {
  if (state.phase !== 'shed' || shedOptions(state).length) {
    throw new Error('There is still a token to choose.');
  }
  const next = structuredClone(state);
  afterTrick(next, next.turn);
  return next;
}

/** Both players draw one card (winner first), then the winner leads again. */
function afterTrick(next, w) {
  for (const p of [w, 1 - w]) if (next.draw.length) next.hands[p].push(next.draw.pop());
  if (!next.hands[0].length || !next.hands[1].length) {
    // nobody could fill another trick: the round is over (any straggler joins
    // the discards so every card is accounted for)
    for (const p of [0, 1]) { next.discards.push(...next.hands[p]); next.hands[p] = []; }
    return newRound(next);
  }
  next.phase = 'lead';
  next.turn = w;
  next.lastEvent = { kind: 'ready', winner: w };
}

/** All cards played: the dealer passes and everything is reshuffled. */
function newRound(next) {
  next.round += 1;
  next.dealer = 1 - next.dealer;
  dealRound(next);
  next.leader = 1 - next.dealer;
  next.turn = next.leader;
  next.lastEvent = { kind: 'round', round: next.round };
}

/** Flip the Kingmaker resolution (option 1 or option 2 of the wiki). */
export function setKingmaker(state, mode) {
  if (!KINGMAKER_MODES.includes(mode)) throw new Error(`no such Kingmaker rule: ${mode}`);
  if (state.kingmaker === mode) return state;
  const next = structuredClone(state);
  next.kingmaker = mode;
  return next;
}

export const OUTCOME = {
  shed: { title: 'Every token shed', cls: 'win' },
  kingmaker: { title: 'Kingmaker Scenario', cls: 'win' },
};

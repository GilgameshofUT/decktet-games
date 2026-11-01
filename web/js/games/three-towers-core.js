/* Three Towers — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:three-towers  (Maginobi, after
 * P.D. Magnus's Ivory Tower)
 *
 * The ranks 2-9 only, shuffled.  Five tower spaces stand before you; on them
 * you build three towers of descending rank in which each card shares a suit
 * with the one below it.  Each turn you either play the face-up card on top
 * of the deck to a space, or move the top card of one space onto another.
 * Win when the deck is empty and three complete towers stand.
 *
 * Interpretation (noted on the rules page):
 *   1. The wiki defines no loss; this app ends a lost game when no move at
 *      all is possible — the deck card fits nowhere and no tower top can be
 *      stacked on another.  A game you are not winning can otherwise be
 *      shuffled around for ever, so the table also offers a "Give up"
 *      button that ends it (as `abandon`).
 *   2. "Three towers" in the win means exactly three non-empty spaces, each
 *      a complete run: with every card in play that is the only way the
 *      counts can work out.
 *   3. The variants: the difficulty levels use the wiki's own "remove
 *      high-ranked cards" knob (level N keeps ranks 2-N), and the Ivory
 *      Three Towers variant asks for a suit before the first move and adds
 *      its all-one-suit tower to the win condition.  The Quota variant is
 *      not implemented here — it needs a preset number chosen up front. */

import { mulberry32, rankValue, baseId, SUITS } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const SPACES = 5;      // tower spaces on the table
export const LOW_RANK = 2;    // every tower runs down to the 2
export const LEVELS = [6, 7, 8, 9];

/** Do two cards share a suit symbol? */
export const shareSuit = (a, b) => suitsOf(a).some((s) => suitsOf(b).includes(s));

/** The 24-card deck, cut down to ranks 2..level for the difficulty level. */
export function towerDeck(basicDeck, level = 9) {
  return basicDeck.filter((id) => {
    const r = card(id).rank;
    return typeof r === 'number' && r >= LOW_RANK && r <= level;
  });
}

/* ---------------------------------------------------------------- setup */

export function newGame(seed, basicDeck, { level = 9, ivory = false } = {}) {
  const deck = towerDeck(basicDeck, level).slice();
  const rng = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // "flip over the top card of the deck and place it into one of the 5 tower
  // spaces, then flip over a new card and leave it on top of the deck"
  const up = deck.pop() ?? null;
  const st = {
    seed, level, ivoryMode: !!ivory, ivory: null,
    deck, up,
    spaces: Array.from({ length: SPACES }, () => []),
    moves: 0, over: null,
  };
  settle(st);
  return st;
}

/** Pick the suit your ivory tower will hold (Ivory Three Towers variant). */
export function chooseSuit(state, suit) {
  if (!state.ivoryMode || state.ivory) throw new Error('no suit is being chosen');
  if (!SUITS.includes(suit)) throw new Error(`unknown suit ${suit}`);
  const next = structuredClone(state);
  next.ivory = suit;
  settle(next);
  return next;
}

/* -------------------------------------------------------------- placement */

export const topOf = (space) => (space.length ? space[space.length - 1] : null);

/** A card may sit on a space's top card when it is lower and shares a suit;
 *  an empty space takes anything. */
export function canPlace(state, i, id) {
  const sp = state.spaces[i];
  if (!sp || !sp.length) return true;
  const top = sp[sp.length - 1];
  return rankOf(id) < rankOf(top) && shareSuit(id, top);
}

/** The card a source offers: the deck's face-up card, or a space's top card. */
export function cardOf(state, src) {
  if (src === 'deck') return state.up;
  const sp = state.spaces[src];
  return sp ? topOf(sp) : null;
}

export function destinations(state, src) {
  if (state.over || (state.ivoryMode && !state.ivory)) return [];
  const id = cardOf(state, src);
  if (!id) return [];
  const out = [];
  for (let i = 0; i < SPACES; i++) {
    if (i === src) continue;                       // a space is not its own destination
    if (canPlace(state, i, id)) out.push(i);
  }
  return out;
}

export function legalMoves(state) {
  const out = [];
  for (const src of ['deck', 0, 1, 2, 3, 4]) {
    for (const dest of destinations(state, src)) out.push({ src, dest });
  }
  return out;
}

/** Move the card at `src` ('deck' | 0..4) onto space `dest` (0..4). */
export function applyMove(state, mv) {
  const { src, dest } = mv;
  if (!destinations(state, src).includes(dest)) {
    throw new Error(`illegal move ${String(src)} -> ${String(dest)}`);
  }
  const next = structuredClone(state);
  let id;
  if (src === 'deck') {
    id = next.up;
    next.up = next.deck.pop() ?? null;             // "flip over the new top card"
  } else {
    id = next.spaces[src].pop();
  }
  next.spaces[dest].push(id);
  next.moves += 1;
  settle(next);
  return next;
}

/* ------------------------------------------------------------------- end */

/** Is one space a complete tower: level … 2, each card sharing a suit with
 *  the one below it? */
export function complete(space, level) {
  if (space.length !== level - 1) return false;
  for (let k = 0; k < space.length; k++) {
    if (rankOf(space[k]) !== level - k) return false;
    if (k > 0 && !shareSuit(space[k], space[k - 1])) return false;
  }
  return true;
}

export function towersBuilt(state) {
  return state.spaces.filter((sp) => complete(sp, state.level)).length;
}

export function isWon(state) {
  if (state.up || state.deck.length) return false;
  if (state.ivoryMode && !state.ivory) return false;
  const used = state.spaces.filter((sp) => sp.length);
  if (used.length !== 3) return false;
  if (!used.every((sp) => complete(sp, state.level))) return false;
  if (state.ivoryMode) {
    return used.some((sp) => sp.every((id) => suitsOf(id).includes(state.ivory)));
  }
  return true;
}

/** The player calls it: there is no more they want to do here.
 *
 *  The wiki defines no loss for Three Towers, and a game that is going badly
 *  can otherwise be shuffled around for ever, so the table offers this. */
export function abandon(state) {
  if (state.over) return state;
  const next = structuredClone(state);
  next.over = 'gaveup';
  return next;
}

/** Apply the end-of-game rules (after setup and after every move). */
export function settle(state) {
  if (state.over) return;
  if (isWon(state)) { state.over = 'won'; return; }
  if (state.ivoryMode && !state.ivory) return;     // the suit comes first
  if (!legalMoves(state).length) state.over = 'lost';
}

export const OUTCOME = {
  won: { title: 'You win', cls: 'win', text: 'Three towers of descending rank, each card sharing a suit with the one below.' },
  lost: { title: 'No moves left', cls: 'lose', text: 'The deck card fits nowhere and no tower top can be stacked. The towers stay unfinished.' },
  gaveup: { title: 'You gave up', cls: 'lose', text: 'The towers stand as they were. Start a new deal whenever you like.' },
};

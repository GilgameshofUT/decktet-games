/* Adaman — game logic, no DOM.  Imported by the UI (games/adaman.js) and by
   the node test (test/adaman.test.mjs).

   Rules: https://wiki.decktet.com/game:adaman
   Deal five capital cards, five non-personality resources (personalities go to
   the palace), then spend resources that share a suit with a target and total
   at least its rank.  Win by controlling all eleven personalities; lose when no
   move is left, or when a sixth personality reaches the palace. */

import { mulberry32, rankValue } from '../decktet.js';

export { rankValue };

let BY_ID = null;

export function init(cardsById) {
  BY_ID = cardsById;
}

export const card = (id) => BY_ID[id];

export const PERSONALITY_TOTAL = 11;

/** Fresh shuffled game. `basicIds` is the 36-card basic deck. */
export function newGame(seed, basicIds) {
  const rng = mulberry32(seed);
  const deck = basicIds.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const st = {
    seed, deck, capital: [], resources: [], palace: [], discard: [],
    over: null, moves: 0,
  };
  deal(st);
  settle(st);
  return st;
}

/** Apply the end-of-game rules to a freshly dealt (or just played) state. */
function settle(st) {
  if (st.over) return;
  if (personalitiesInDiscard(st) === PERSONALITY_TOTAL) st.over = 'won';
  else if (!hasAnyMove(st)) st.over = 'lost';
}

/** Refill the capital to five, then the resources to five (personalities to the
 *  palace — a sixth one there ends the game at once). */
function deal(st) {
  while (!st.over && st.capital.length < 5 && st.deck.length) {
    st.capital.push(st.deck.pop());
  }
  while (!st.over && st.resources.length < 5 && st.deck.length) {
    const id = st.deck.pop();
    if (card(id).personality) {
      st.palace.push(id);
      if (st.palace.length > 5) st.over = 'caught';
    } else {
      st.resources.push(id);
    }
  }
}

export function personalitiesInDiscard(st) {
  return st.discard.filter((id) => card(id).personality).length;
}

/** All resources that could contribute against `targetId`. */
export function contributors(st, targetId) {
  const target = card(targetId);
  return st.resources.filter((id) =>
    card(id).suits.some((s) => target.suits.includes(s)));
}

/** Is this particular selection a legal way to take `targetId`? */
export function canTake(st, targetId, selectedIds) {
  if (!selectedIds.length) return false;
  const target = card(targetId);
  const total = selectedIds.reduce((sum, id) => sum + rankValue(card(id)), 0);
  if (total < rankValue(target)) return false;
  return selectedIds.every((id) =>
    card(id).suits.some((s) => target.suits.includes(s)));
}

/** Every target the current selection could take. */
export function legalTargets(st, selectedIds) {
  return [...st.capital, ...st.palace].filter((t) => canTake(st, t, selectedIds));
}

/** Does any move exist at all? (Any single resource that can take any target.) */
export function hasAnyMove(st) {
  for (const t of [...st.capital, ...st.palace]) {
    const contrib = contributors(st, t);
    if (!contrib.length) continue;
    const total = contrib.reduce((sum, id) => sum + rankValue(card(id)), 0);
    if (total >= rankValue(card(t))) return true;
  }
  return false;
}

/** Play `selectedIds` (from the resources) against `targetId`.  Pure: returns a
 *  new state. */
export function applyMove(st, targetId, selectedIds) {
  if (!canTake(st, targetId, selectedIds)) {
    throw new Error(`illegal move: ${selectedIds} -> ${targetId}`);
  }
  const next = structuredClone(st);
  const target = card(targetId);

  next.resources = next.resources.filter((id) => !selectedIds.includes(id));
  next.discard.push(...selectedIds);

  next.capital = next.capital.filter((id) => id !== targetId);
  next.palace = next.palace.filter((id) => id !== targetId);
  if (target.personality) next.discard.push(targetId);
  else next.resources.push(targetId);

  next.moves += 1;
  deal(next);
  settle(next);
  return next;
}

/** Score: 66 + your resources when you win, the personalities you controlled
 *  when you lose, zero when you are caught. */
export function scoreOf(st) {
  if (st.over === 'caught') return 0;
  const controlled = st.discard
    .filter((id) => card(id).personality)
    .reduce((sum, id) => sum + rankValue(card(id)), 0);
  if (st.over === 'won') {
    const held = st.resources.reduce((sum, id) => sum + rankValue(card(id)), 0);
    return controlled + held;
  }
  return controlled;
}

export const OUTCOME = {
  won: { title: 'You win', cls: 'win', text: 'You have control of everyone who matters and can safely seize the throne.' },
  lost: { title: 'You lose', cls: 'lose', text: 'Without the backing of everyone, your plan must be abandoned. All that scheming for nothing!' },
  caught: { title: 'You lose utterly', cls: 'lose', text: 'With so many people snooping about, someone has discovered your plot. It is the gallows for you, old chum.' },
};

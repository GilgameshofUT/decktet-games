/* Defend and Capture — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:defend-and-capture  (W. Nai)
 *
 * A solo defence game on a 3x3 Battleground with a Defense row below it and a
 * Side column beside it.  Every turn the enemy advances and attacks; then you
 * draw to your hand size and spend actions (Play, Counterattack,
 * Interchange, Sacrifice, Withdraw) trying to Capture 12 cards before the
 * rank sum of the Damaged Area reaches 20.
 *
 * The deck is the 44-card deck: the extended Decktet minus the Excuse.
 * Pawns, Courts and Crowns all count as rank 10; Aces count as 1 (the wiki's
 * Component section says so outright).
 *
 * Interpretations (all restated on the rules page):
 *   1. The wiki's turn order (Enemy Phase, then Player Phase) means the very
 *      first thing that happens is an Enemy Phase — on an empty board that
 *      only fills the top row, so the app runs it during setup.  This is the
 *      same order the reference digital version (gjchangmu/A-Few-Decktet-Games,
 *      src/DefenseCapture1p.cs) uses.
 *   2. Win/lose is checked after every card added to Captured or Damaged, so
 *      the game can end mid Enemy Phase; when both thresholds trip at once,
 *      the win is checked first (again as in the digital version).
 *   3. A counterattack's suit test is applied to each of the defense and side
 *      cards separately: both must share a suit with the affected enemy.
 *   4. Sacrifice's "a card of lesser rank" means the damaged card must be
 *      strictly lower rank than the hand card you swap in.
 *   5. Hasten repeats the whole Enemy Phase once, judged on the Captured
 *      count after the first pass.
 *   6. Reshuffling the Discard Pile into a new Main Deck is driven by a
 *      counter kept in state, so a saved game reshuffles identically. */

import { mulberry32, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];

export const CAPTURE_TO_WIN = 12;
export const DAMAGE_TO_LOSE = 20;
export const HASTEN_AT = 8;

/** Rank as Defend and Capture counts it: Pawns, Courts and Crowns are all
 *  10, Aces are 1, everything else keeps its number. */
export function rankOf(id) {
  const c = card(id);
  if (c.rank === 'crown' || c.rank === 'court' || c.rank === 'pawn') return 10;
  return c.rank;
}

export const suitsOf = (id) => card(id).suits;
export const sharesSuit = (a, b) => suitsOf(a).some((s) => suitsOf(b).includes(s));

/* ------------------------------------------------------------- utilities */

const shuffle = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Draw one card, reshuffling the Discard Pile into a new Main Deck when the
 *  deck runs dry (both empty -> null: the wiki's "skip drawing"). */
function drawOne(next) {
  if (!next.deck.length) {
    if (!next.discard.length) return null;
    const rng = mulberry32(((next.seed ^ 0x9e3779b9) + next.reshuffles * 2654435761) >>> 0);
    next.deck = shuffle(next.discard, rng);
    next.discard = [];
    next.reshuffles += 1;
  }
  return next.deck.shift();
}

export const damageSum = (state) => state.damaged.reduce((n, id) => n + rankOf(id), 0);
export const capturedTotal = (state) => state.captured.length;
/** Captured cards ranked 1-9: these set the hand size. */
export const capturedLow = (state) => state.captured.filter((id) => rankOf(id) <= 9).length;
/** Captured Pawns/Courts/Crowns: these pay for the turn's actions. */
export const capturedTen = (state) => state.captured.filter((id) => rankOf(id) === 10).length;
export const handTarget = (state) => capturedLow(state);

/** Every card that exists, for conservation checks. */
export function allCards(state) {
  return [...state.deck, ...state.discard, ...state.bg, ...state.defense, ...state.side,
    ...state.captured, ...state.damaged, ...state.hand].filter(Boolean);
}

/* ----------------------------------------------------------------- setup */

export function newGame(seed, deck44) {
  const rng = mulberry32(seed);
  const pool = shuffle(deck44, rng);

  // Setup: 2 Pawns/Courts + 2 cards ranked 1-9 go straight to Captured.
  const captured = [];
  const rest = [];
  let pawns = 0, lows = 0;
  for (const id of pool) {
    const c = card(id);
    if (pawns < 2 && (c.rank === 'pawn' || c.rank === 'court')) { captured.push(id); pawns++; continue; }
    if (lows < 2 && typeof c.rank === 'number') { captured.push(id); lows++; continue; }
    rest.push(id);
  }

  const st = {
    seed, reshuffles: 0,
    deck: rest, discard: [],
    bg: Array(9).fill(null),           // row 0 = top (reinforce), row 2 = bottom (attacks)
    defense: Array(3).fill(null), side: Array(3).fill(null),
    captured, damaged: [],
    hand: [],
    actions: 0, actionsTotal: 0,
    turn: 1, moves: 0, over: null, log: '',
  };

  enemyPhase(st);                      // the first turn opens with the enemy
  drawStep(st);
  st.log = 'The enemy advances; you draw your hand.';
  settle(st);
  return st;
}

/* --------------------------------------------------- the enemy, per turn */

function attack(next) {
  for (let c = 0; c < 3; c++) {
    const i = 6 + c;                                  // the bottom row
    const attacker = next.bg[i];
    if (!attacker) continue;
    next.bg[i] = null;
    const defender = next.defense[c];
    if (defender == null) {
      next.damaged.push(attacker);                    // full damage
    } else if (rankOf(attacker) >= rankOf(defender)) {
      next.damaged.push(defender);                    // partial damage
      next.defense[c] = null;
      next.discard.push(attacker);
    } else {
      next.discard.push(attacker);                    // defence holds
    }
    settle(next);
    if (next.over) return;
  }
}

function advance(next) {
  for (let r = 1; r >= 0; r--) {
    for (let c = 0; c < 3; c++) {
      next.bg[(r + 1) * 3 + c] = next.bg[r * 3 + c];
      next.bg[r * 3 + c] = null;
    }
  }
}

function reinforce(next) {
  for (let c = 0; c < 3; c++) {
    const id = drawOne(next);
    if (id) next.bg[c] = id;
  }
}

function enemyPhase(next) {
  attack(next);
  if (next.over) return;
  advance(next);
  reinforce(next);
  if (!next.over && capturedTotal(next) >= HASTEN_AT) {   // hasten: go again
    attack(next);
    if (next.over) return;
    advance(next);
    reinforce(next);
  }
}

/** Draw up to the hand size; actions are the captured Pawns/Courts/Crowns. */
function drawStep(next) {
  const target = capturedLow(next);
  while (next.hand.length < target) {
    const id = drawOne(next);
    if (!id) break;
    next.hand.push(id);
  }
  next.actionsTotal = capturedTen(next);
  next.actions = next.actionsTotal;
}

/* -------------------------------------------------------------- scoring */

export function isWon(state) { return capturedTotal(state) >= CAPTURE_TO_WIN; }
export function isLost(state) { return damageSum(state) >= DAMAGE_TO_LOSE; }

/** Win first, then loss — the order the reference implementation checks. */
export function settle(state) {
  if (state.over) return;
  if (isWon(state)) state.over = 'won';
  else if (isLost(state)) state.over = 'lost';
}

/* -------------------------------------------------------------- actions */

export function legalActions(state) {
  if (state.over) return [{ type: 'endTurn' }];
  const out = [];
  const busy = state.actions > 0;
  if (busy) {
    state.hand.forEach((_, h) => {
      for (const area of ['defense', 'side']) {
        for (let i = 0; i < 3; i++) out.push({ type: 'play', hand: h, area, slot: i });
      }
      state.captured.forEach((_, i) => out.push({ type: 'interchange', hand: h, index: i }));
      state.damaged.forEach((_, i) => {
        if (rankOf(state.hand[h]) > rankOf(state.damaged[i])) {
          out.push({ type: 'sacrifice', hand: h, index: i });
        }
      });
    });
    for (const area of ['defense', 'side']) {
      for (let i = 0; i < 3; i++) {
        if (state[area][i]) {
          out.push({ type: 'counter', area, slot: i });
          out.push({ type: 'withdraw', area, slot: i });
        }
      }
    }
  }
  state.hand.forEach((_, h) => out.push({ type: 'discard', hand: [h] }));
  out.push({ type: 'endTurn' });
  return out;
}

function needAction(next) {
  if (next.actions <= 0) throw new Error('You have no actions left this turn — end the turn.');
  next.actions -= 1;
  next.moves += 1;
}

const validSlot = (i) => Number.isInteger(i) && i >= 0 && i < 3;

/** Apply one player action.  Returns a NEW state; throws on an illegal move. */
export function applyMove(state, action) {
  if (state.over) throw new Error('the game is over');
  const next = structuredClone(state);
  const t = action.type;

  if (t === 'play') {
    const { hand, area, slot } = action;
    needAction(next);
    if (!validSlot(slot)) throw new Error('bad slot');
    if (area !== 'defense' && area !== 'side') throw new Error('play into the Defense row or the Side column');
    if (!Number.isInteger(hand) || !next.hand[hand]) throw new Error('select a card in your hand first');
    const id = next.hand[hand];
    if (next[area][slot]) next.discard.push(next[area][slot]);   // replaced card is discarded
    next[area][slot] = id;
    next.hand.splice(hand, 1);
    next.log = `You play ${card(id).name} to the ${area === 'defense' ? 'Defense row' : 'Side column'}.`;

  } else if (t === 'counter') {
    const { area, slot } = action;
    needAction(next);
    if (area !== 'defense' && area !== 'side') throw new Error('counterattack from the Defense row or the Side column');
    if (!validSlot(slot) || !next[area][slot]) throw new Error('select a defending or side card first');
    const source = next[area][slot];
    let captured = 0, destroyed = 0;
    for (let k = 0; k < 3; k++) {
      const r = area === 'side' ? slot : k;
      const c = area === 'defense' ? slot : k;
      const affected = next.bg[r * 3 + c];
      const def = next.defense[c];
      const sid = next.side[r];
      if (!affected || !def || !sid) continue;
      if (!sharesSuit(def, affected) || !sharesSuit(sid, affected)) continue;
      const sum = rankOf(def) + rankOf(sid);
      next.bg[r * 3 + c] = null;
      if (sum === rankOf(affected)) { next.captured.push(affected); captured++; }
      else if (sum > rankOf(affected)) { next.discard.push(affected); destroyed++; }
      else { next.bg[r * 3 + c] = affected; }
      settle(next);
      if (next.over) break;
    }
    next.log = `Counterattack from the ${area === 'defense' ? 'Defense row' : 'Side column'}: ` +
      `${captured} captured, ${destroyed} destroyed.`;

  } else if (t === 'interchange') {
    const { hand, index } = action;
    needAction(next);
    if (!Number.isInteger(hand) || !next.hand[hand]) throw new Error('select a card in your hand first');
    if (!Number.isInteger(index) || !next.captured[index]) throw new Error('select a captured card first');
    const a = next.hand[hand];
    const b = next.captured[index];
    next.hand[hand] = b;
    next.captured[index] = a;
    next.log = `You interchange ${card(a).name} with the captured ${card(b).name}.`;
    settle(next);

  } else if (t === 'sacrifice') {
    const { hand, index } = action;
    needAction(next);
    if (!Number.isInteger(hand) || !next.hand[hand]) throw new Error('select a card in your hand first');
    if (!Number.isInteger(index) || !next.damaged[index]) throw new Error('select a damaged card first');
    const a = next.hand[hand];
    const b = next.damaged[index];
    if (rankOf(a) <= rankOf(b)) {
      throw new Error(`Sacrifice swaps for a card of lesser rank — ${card(a).name} (rank ${rankOf(a)}) ` +
        `is not higher than the damaged ${card(b).name} (rank ${rankOf(b)}).`);
    }
    next.hand[hand] = b;
    next.damaged[index] = a;
    next.log = `You sacrifice ${card(a).name} to salvage the ${card(b).name}.`;
    settle(next);

  } else if (t === 'withdraw') {
    const { area, slot } = action;
    needAction(next);
    if (area !== 'defense' && area !== 'side') throw new Error('withdraw from the Defense row or the Side column');
    if (!validSlot(slot) || !next[area][slot]) throw new Error('select a defending or side card first');
    const id = next[area][slot];
    next[area][slot] = null;
    next.hand.push(id);
    next.log = `You withdraw ${card(id).name} back to your hand.`;

  } else if (t === 'discard') {
    const idxs = (action.hand || []).slice().sort((a, b) => b - a);
    if (!idxs.length) throw new Error('select the cards to discard first');
    for (const h of idxs) {
      if (!Number.isInteger(h) || !next.hand[h]) throw new Error('select cards in your hand to discard');
    }
    for (const h of idxs) next.discard.push(next.hand.splice(h, 1)[0]);
    next.moves += 1;
    next.log = `You discard ${idxs.length} card${idxs.length === 1 ? '' : 's'}.`;

  } else if (t === 'endTurn') {
    next.moves += 1;
    enemyPhase(next);
    if (!next.over) {
      drawStep(next);
      next.turn += 1;
      const hurt = next.damaged.length - state.damaged.length;
      next.log = `The enemy attacks${hurt ? ` (${hurt} card${hurt === 1 ? '' : 's'} to the Damaged Area)` : ''}` +
        `${capturedTotal(next) >= HASTEN_AT ? ' — and surges again!' : ''}. ` +
        `Turn ${next.turn}: ${next.actions} actions, hand size ${handTarget(next)}.`;
    }
    settle(next);

  } else {
    throw new Error(`unknown action ${t}`);
  }

  settle(next);
  return next;
}

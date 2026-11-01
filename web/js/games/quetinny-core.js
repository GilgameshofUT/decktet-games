/* Quetinny — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:quetinny  (Jack Neal, wiki rev 11,
 * 23 Feb 2018) compared with the Google Doc the wiki points at (its version
 * history ends 5/25/2014 — the wiki page is the later text, see the rules
 * page's "Sources" note).
 *
 * A trade-route network: provinces are cards laid out on an ever-growing
 * grid, suit chips mark trade routes, Aces produce spice, caravans carry it
 * to the matching Crown for gold, and every turn you pay taxes by playing a
 * card.  The deck is the basic 36-card Decktet (the wiki's current text;
 * the extended-deck options are described on the rules page but not
 * implemented here).
 *
 * Interpretations (all restated on the rules page):
 *   1. Setup "only one Ace or one Crown in the tableaux": draw 4 until the
 *      draw contains exactly one Ace-or-Crown (the wiki spells out the
 *      zero-case redraw; the "only one" goal governs both ends).
 *   2. Initial suit chips (one per starting card) are the player's choice in
 *      the physical game; here the seed picks one of the card's suits.
 *   3. A chip may be placed on any chipless, non-Ace/Crown province that is
 *      diagonally-or-orthogonally adjacent to the suit's route (an
 *      S-chipped province, or the Ace/Crown of S) — that is what "expand an
 *      existing trade route … routes always trace back to an Ace, a Crown
 *      or a starting chip" buys you.
 *   4. A caravan route for suit S runs from the Ace of S to the Crown of S,
 *      each step to a horizontally/vertically/diagonally adjacent province,
 *      every middle province carrying an S chip, ranks strictly increasing,
 *      no province twice.  Path length (Ace and Crown included) must not
 *      exceed the played card's rank.
 *   5. Taxes: rank minus the number of suit chips on the board for each of
 *      the card's suits, clamped at 0 (Crown = rank 15 for taxes).
 *   6. The final hand: when the deck is empty and the hand is under 4, you
 *      play one action card and every remaining hand card is taxed
 *      automatically.
 *   7. End-game: "an Ace or a Crown of each suit" is read literally — each
 *      suit needs at least one of its two courts on the board.  (Requiring
 *      both would mean fitting all twelve court cards into roughly sixteen
 *      turns; a search shows that is all but impossible.) */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));      // Ace 1 … 9, Crown 10
export const suitsOf = (id) => card(id).suits;

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const START_GOLD = 25;
export const SPICE_MAX = 6;               // "an extra set of 6 spice cubes"
export const CHIPS_PER_SUIT = 6;          // "6 suit chips for each suit"
export const HAND_SIZE = 4;

const isAce = (id) => card(id).rank === 1;
const isCrown = (id) => card(id).rank === 'crown';
const isCourt = (id) => isAce(id) || isCrown(id);

/** Tax rank: Crown 15, Ace 1, everything else its number. */
export function taxRank(id) {
  return isCrown(id) ? 15 : rankOf(id);
}

const shuffle = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ------------------------------------------------------------- geometry */

export const ortho = (r, c) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
const touches = (a, b) => Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1 && !(a.r === b.r && a.c === b.c);

export function provinceAt(state, r, c) {
  return state.provinces.find((p) => p.r === r && p.c === c) || null;
}

/** Every empty cell orthogonally touching a province — expand candidates. */
export function emptyCells(state) {
  const out = [];
  const seen = new Set();
  for (const p of state.provinces) {
    for (const [r, c] of ortho(p.r, p.c)) {
      const k = `${r},${c}`;
      if (seen.has(k) || provinceAt(state, r, c)) continue;
      seen.add(k);
      out.push([r, c]);
    }
  }
  return out;
}

export const aceOf = (state, suit) => state.provinces.find((p) => isAce(p.id) && card(p.id).suits.includes(suit)) || null;
export const crownOf = (state, suit) => state.provinces.find((p) => isCrown(p.id) && card(p.id).suits.includes(suit)) || null;

/* ------------------------------------------------------- route finding */

/** Every simple, strictly increasing route for `suit`: Ace → Crown through
 *  S-chipped provinces, 8-directional steps.  Returns arrays of [r,c]. */
export function routes(state, suit, maxLen = 10) {
  const ace = aceOf(state, suit);
  const crown = crownOf(state, suit);
  if (!ace || !crown) return [];
  const startKey = `${ace.r},${ace.c}`;
  const goalKey = `${crown.r},${crown.c}`;
  const out = [];
  const seen = new Set([startKey]);
  const path = [[ace.r, ace.c]];

  const walk = (p) => {
    if (path.length >= maxLen) return;
    for (const [r, c] of ortho(p.r, p.c).concat([[p.r - 1, p.c - 1], [p.r - 1, p.c + 1], [p.r + 1, p.c - 1], [p.r + 1, p.c + 1]])) {
      const k = `${r},${c}`;
      if (seen.has(k)) continue;
      const q = provinceAt(state, r, c);
      if (!q) continue;
      const rk = `${q.r},${q.c}`;
      if (rk === goalKey) {
        out.push([...path, [r, c]]);
        continue;                              // a path ends at the Crown
      }
      if (q.chip !== suit) continue;           // middles must be S-chipped
      if (rankOf(q.id) <= rankOf(provinceAt(state, p.r, p.c).id)) continue;  // strictly increasing
      seen.add(k);
      path.push([r, c]);
      walk(q);
      path.pop();
      seen.delete(k);
    }
  };

  walk(ace);
  return out;
}

/** Gold for a delivery of `n` provinces (Ace and Crown included). */
export const goldFor = (n) => (n <= 2 ? 4 : n === 3 ? 8 : n === 4 ? 16 : 32);

/* ---------------------------------------------------------- legality */

/** May `hand` be expanded at (r,c) as `suit`?  Returns null or a reason. */
export function expandError(state, hand, suit, r, c) {
  if (state.over) return 'the game is over';
  if (state.step !== 'action') return 'this is not the action step';
  const id = state.hand[hand];
  if (!id) return 'select a card in your hand first';
  if (!suitsOf(id).includes(suit)) return `${card(id).name} has no ${suit} symbol`;
  if (provinceAt(state, r, c)) return 'that cell already holds a province';
  const nb = ortho(r, c).map(([rr, cc]) => provinceAt(state, rr, cc)).filter(Boolean);
  if (!nb.length) return 'a province must be placed orthogonally next to an existing one';
  if (rankOf(id) >= 2 && rankOf(id) <= 9 && !nb.some((p) => card(p.id).suits.includes(suit))) {
    return `a rank card must touch another province of the same suit — no ${suit} province is orthogonally adjacent`;
  }
  if (isCourt(id) && nb.some((p) => isCourt(p.id))) {
    return 'Aces and Crowns may never be orthogonally adjacent to other Aces or Crowns';
  }
  return null;
}

/** May an `suit` chip go on the province at (r,c)?  Returns null or a reason. */
export function chipError(state, r, c, suit) {
  const p = provinceAt(state, r, c);
  if (!p) return 'no province there';
  return chipProvError(state, p, suit);
}

/** Same test on a province object (used for the not-yet-placed province). */
function chipProvError(state, p, suit) {
  if (state.over) return 'the game is over';
  if (isCourt(p.id)) return 'Aces and Crowns are already the roots of a route';
  if (p.chip) return 'only one suit chip can be on a province';
  if (!SUITS.includes(suit)) return 'unknown suit';
  if (state.chips[suit] <= 0) return `no ${suit} chips left in the supply`;
  const onRoute = state.provinces.some((q) => q !== p && touches(q, p) &&
    (q.chip === suit || (isAce(q.id) && card(q.id).suits.includes(suit)) ||
     (isCrown(q.id) && card(q.id).suits.includes(suit))));
  if (!onRoute) return `the chip must expand an existing ${suit} trade route — nothing adjacent is on it`;
  return null;
}

export function harvestError(state, hand) {
  if (state.over) return 'the game is over';
  if (state.step !== 'action') return 'this is not the action step';
  const id = state.hand[hand];
  if (!id) return 'select a card in your hand first';
  if (!suitsOf(id).some((s) => aceOf(state, s))) {
    return 'harvest needs a matching Ace of one of this card’s suits on the board';
  }
  return null;
}

/** Is `path` a legal caravan for `suit`, paid with `hand`?  Returns null/reason. */
export function caravanError(state, hand, suit, path) {
  if (state.over) return 'the game is over';
  if (state.step !== 'action') return 'this is not the action step';
  const id = state.hand[hand];
  if (!id) return 'select a card in your hand first';
  if (!suitsOf(id).includes(suit)) return `${card(id).name} has no ${suit} symbol`;
  if (!Array.isArray(path) || path.length < 2) return 'a caravan route needs at least the Ace and the Crown';
  if (path.length > rankOf(id)) {
    return `a rank ${rankOf(id)} card can only pay for a route of ${rankOf(id)} provinces or fewer`;
  }
  const ace = aceOf(state, suit);
  const crown = crownOf(state, suit);
  if (!ace || !crown) return `the ${suit} Ace and Crown must both be on the board first`;
  if (path[0][0] !== ace.r || path[0][1] !== ace.c) return 'a caravan must start at the Ace';
  const last = path[path.length - 1];
  if (last[0] !== crown.r || last[1] !== crown.c) return 'a caravan must end at the Crown';
  const seen = new Set();
  let prevRank = 0;
  for (let i = 0; i < path.length; i++) {
    const [r, c] = path[i];
    const k = `${r},${c}`;
    if (seen.has(k)) return 'a path cannot cross itself';
    seen.add(k);
    const p = provinceAt(state, r, c);
    if (!p) return 'the route passes through empty space';
    if (i > 0) {
      const [pr, pc] = path[i - 1];
      if (Math.abs(pr - r) > 1 || Math.abs(pc - c) > 1) return 'each step moves to an adjacent province';
      if (i < path.length - 1 && p.chip !== suit) {
        return `every province between Ace and Crown must carry a ${suit} chip`;
      }
    }
    const rk = rankOf(p.id);
    if (rk <= prevRank) return 'each step of the route must increase in rank';
    prevRank = rk;
  }
  if (!ace.spice) return 'the Ace has no spice to carry';
  return null;
}

export function taxError(state, hand) {
  if (state.over) return 'the game is over';
  if (state.step !== 'tax') return 'you must choose your action first';
  if (!state.hand[hand]) return 'select a card in your hand to pay the tax';
  return null;
}

/** Gold owed when paying taxes with `id`. */
export function taxFor(state, id) {
  const chips = suitsOf(id).reduce((n, s) =>
    n + state.provinces.reduce((m, p) => m + (p.chip === s ? 1 : 0), 0), 0);
  return Math.max(0, taxRank(id) - chips);
}

/** Any non-discard action at all?  (The wiki allows discarding only when
 *  there is no possible legal play.) */
export function hasLegalPlay(state) {
  if (state.over || state.step !== 'action') return false;
  return legalMoves(state).some((m) => m.type !== 'discard');
}

/* -------------------------------------------------------- the moves */

export function legalMoves(state) {
  if (state.over) return [];
  if (state.step === 'tax') return state.hand.map((_, i) => ({ type: 'tax', hand: i }));
  const out = [];
  state.hand.forEach((id, i) => {
    for (const suit of suitsOf(id)) {
      for (const [r, c] of emptyCells(state)) {
        if (expandError(state, i, suit, r, c)) continue;
        out.push({ type: 'expand', hand: i, suit, r, c, chip: null });
        // chip targets: every existing province the chip could go on, plus the
        // province about to be placed (the only new candidate it can add)
        for (const p of state.provinces) {
          if (!chipProvError(state, p, suit)) out.push({ type: 'expand', hand: i, suit, r, c, chip: [p.r, p.c] });
        }
        if (!chipProvError(state, { r, c, id, chip: null, spice: 0 }, suit)) {
          out.push({ type: 'expand', hand: i, suit, r, c, chip: [r, c] });
        }
      }
    }
    if (!harvestError(state, i)) out.push({ type: 'harvest', hand: i });
    for (const suit of suitsOf(id)) {
      for (const path of routes(state, suit)) {
        if (!caravanError(state, i, suit, path)) out.push({ type: 'caravan', hand: i, suit, path });
      }
    }
  });
  if (!out.length) state.hand.forEach((_, i) => out.push({ type: 'discard', hand: i }));
  return out;
}

/** Apply one move.  Returns a NEW state; throws with a readable reason. */
export function applyMove(state, move) {
  if (!move || typeof move !== 'object') throw new Error('choose a move first');
  const next = structuredClone(state);
  const t = move.type;

  if (t === 'expand') {
    const { hand, suit, r, c, chip } = move;
    const why = expandError(next, hand, suit, r, c);
    if (why) throw new Error(why);
    const id = next.hand.splice(hand, 1)[0];
    next.provinces.push({ r, c, id, chip: null, spice: 0 });
    if (chip) {
      // validated on the board *including* the new province: the chip may go
      // on the province just placed
      const why2 = chipError(next, chip[0], chip[1], suit);
      if (why2) throw new Error(why2);
      provinceAt(next, chip[0], chip[1]).chip = suit;
      next.chips[suit] -= 1;
      next.log = `You play ${card(id).name} as a ${suit} province and lay a ${suit} chip.`;
    } else {
      next.log = `You play ${card(id).name} as a province.`;
    }

  } else if (t === 'harvest') {
    const why = harvestError(next, move.hand);
    if (why) throw new Error(why);
    const id = next.hand.splice(move.hand, 1)[0];
    let placed = 0;
    for (const s of suitsOf(id)) {
      const ace = aceOf(next, s);
      if (!ace) continue;
      const give = Math.min(2, next.spice);
      ace.spice += give;
      next.spice -= give;
      placed += give;
    }
    next.discard.push(id);
    next.log = `You harvest: ${placed} spice cube${placed === 1 ? '' : 's'} placed.`;

  } else if (t === 'caravan') {
    const { hand, suit, path } = move;
    const why = caravanError(next, hand, suit, path);
    if (why) throw new Error(why);
    const id = next.hand.splice(hand, 1)[0];
    const ace = aceOf(next, suit);
    ace.spice -= 1;
    next.spice += 1;
    const gain = goldFor(path.length);
    next.gold += gain;
    next.discard.push(id);
    next.log = `Caravan delivered: ${path.length} provinces of ${suit} for ${gain} gold.`;

  } else if (t === 'discard') {
    if (state.step !== 'action') throw new Error('this is not the action step');
    if (!Number.isInteger(move.hand) || !next.hand[move.hand]) throw new Error('select a card in your hand first');
    if (hasLegalPlay(next)) {
      throw new Error('you may only discard a card when there is no possible legal play');
    }
    const id = next.hand.splice(move.hand, 1)[0];
    next.discard.push(id);
    next.log = `You discard ${card(id).name} — there was no legal play.`;

  } else if (t === 'tax') {
    const why = taxError(next, move.hand);
    if (why) throw new Error(why);
    const id = next.hand.splice(move.hand, 1)[0];
    const owe = taxFor(next, id);
    next.gold -= owe;
    next.discard.push(id);
    next.log = owe
      ? `Taxes: you pay ${owe} gold with ${card(id).name}.`
      : `Taxes: ${card(id).name} covers them — you owe nothing.`;
    endTurn(next);

  } else {
    throw new Error(`unknown move ${t}`);
  }

  // after the action step: taxes, or the final hand's automatic tax
  // (the tax move itself already ran endTurn)
  if (t !== 'tax' && !next.over && next.step !== 'tax') {
    if (next.final) {
      let owe = 0;
      for (const id of next.hand) owe += taxFor(next, id);
      const paid = next.hand.splice(0, next.hand.length);
      next.discard.push(...paid);
      next.gold -= owe;
      next.log += owe ? ` Final hand: ${owe} gold in taxes.` : ' Final hand: no taxes.';
      finish(next);
    } else {
      next.step = 'tax';
    }
  }

  next.moves += 1;
  return next;
}

function endTurn(next) {
  if (next.gold < 0) { next.over = 'lost'; return; }
  while (next.hand.length < HAND_SIZE && next.deck.length) next.hand.push(next.deck.shift());
  next.turn += 1;
  next.step = 'action';
  next.final = next.deck.length === 0 && next.hand.length < HAND_SIZE;
}

function finish(next) {
  if (next.gold < 0) { next.over = 'lost'; return; }
  for (const s of SUITS) {
    // "If you do not have an Ace or a Crown of each suit on the board you
    // automatically lose" — read literally: each suit needs at least one of
    // its two courts on the board (see the rules page's note).
    if (!aceOf(next, s) && !crownOf(next, s)) {
      next.over = 'lost';
      next.log = `The clans demand a court of every suit on the board — the ${s} route has none.`;
      return;
    }
  }
  if (next.gold <= 0) {
    next.over = 'lost';
    next.log = 'You end the year with no gold. The catnip-mustard habit got you.';
  } else if (next.gold > START_GOLD) {
    next.over = 'outright';
    next.log = `You end with ${next.gold} gold — more than you started. Outright win!`;
  } else {
    next.over = 'won';
    next.log = `You end with ${next.gold} gold — a comfortable retirement.`;
  }
}

/* ------------------------------------------------------------- setup */

export function newGame(seed, basicDeck) {
  const rng = mulberry32(seed);
  let deck = shuffle(basicDeck, rng);

  // draw 4 for the tableaux until exactly one of them is an Ace or a Crown
  let start = null;
  for (let tries = 0; tries < 200; tries++) {
    const draw = deck.splice(0, 4);
    if (draw.filter(isCourt).length === 1) { start = draw; break; }
    deck = shuffle(deck.concat(draw), rng);
  }
  if (!start) throw new Error('setup could not draw a tableau');

  const grid = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const provinces = start.map((id, i) => {
    const suits = suitsOf(id);
    const suit = suits[Math.floor(rng() * suits.length)];
    return { r: grid[i][0], c: grid[i][1], id, chip: suit, spice: 0 };
  });

  const chips = Object.fromEntries(SUITS.map((s) => [s, CHIPS_PER_SUIT]));
  for (const p of provinces) chips[p.chip] -= 1;

  const spice = SPICE_MAX - provinces.reduce((n, p) => n + (isAce(p.id) ? 1 : 0), 0);
  for (const p of provinces) if (isAce(p.id)) p.spice = 1;

  const st = {
    seed, provinces,
    hand: deck.splice(0, HAND_SIZE),
    deck, discard: [],
    gold: START_GOLD, spice, chips,
    step: 'action', turn: 1, moves: 0, over: null, final: false,
    log: 'The kingdom is laid out. Choose your first action.',
  };
  return st;
}

export const OUTCOME = {
  won: { title: 'You win', cls: 'win', text: 'Gold left over at year’s end — a comfortable retirement.' },
  outright: { title: 'You win outright', cls: 'win', text: 'More gold than you started with — you retire in style.' },
  lost: { title: 'You lose', cls: 'lose', text: 'The year got the better of you.' },
};

/** Every card in play, for conservation checks. */
export function allCards(state) {
  return [...state.provinces.map((p) => p.id), ...state.hand, ...state.deck, ...state.discard];
}

/* Magnate — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:magnate
 * (Original design: Cristyn Magnus. Additional development: P.D. Magnus.)
 *
 * Two players build the five districts of the duchy with the extended
 * Decktet.  Each turn has three explicit phases, in order:
 *
 *   a. ROLL   — roll 2d10; a 1 on either die triggers taxation (1d6 names
 *               the taxed suit); both players then collect resources from
 *               the higher die (doubles of 1 collect for Aces, a 10 pays
 *               out per Crown).
 *   b. ACTION — any number of trades (3 of a kind for 1 of another) and
 *               partial developments, plus exactly one card play: develop
 *               a property outright, buy a deed, or sell a card.
 *   c. DRAW   — draw one card; this ends the turn.
 *
 * The game ends the second time the draw pile is exhausted; each player
 * then gets one final turn.  Districts are shared chains: a property must
 * share a suit with the district's Pawn (first card) or with the previous
 * property in that district.  Most districts won wins; ties break on total
 * ranks, then on remaining resources.
 *
 * Courts are included, per the extended-deck section (sell for three
 * tokens, develop for ten with one of each suit, never income, rank 10 at
 * the end).
 *
 * Extra material, emulated here: the two d10s and the d6 live in the state
 * (seeded rolls survive a reload), resource tokens are per-suit counters,
 * and deeds are partial cards in the districts.
 *
 * Interpretations (all restated on the rules page):
 *   1. Deeds block only their owner: "once you have a deed to a property,
 *      you may not put another deed in that district or develop another
 *      property there" — the opponent may still place there, subject to
 *      the suit chain.  A deeded property counts in the chain.
 *   2. Payments are chosen by the app: outright development keeps one
 *      token of each suit in reserve and spends the rest from the player's
 *      most-held suit; income from an undeveloped deed (one token, "your
 *      choice") goes to the suit the player holds fewest of.  Both are
 *      deterministic and shown in the log.
 *   3. Completing a deed over time needs no "one of each suit" mix — that
 *      rule is only for developing outright.  Tokens on deeds are not
 *      affected by taxation, as the wiki says.
 *   4. There is no bank limit: tokens are counters, so the "about 10 of
 *      each" the components list asks for is unlimited here.
 *   5. If the discard pile is empty the first time the draw pile runs out,
 *      the game goes straight to the final turns (the wiki has no rule). */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const DISTRICTS = ['the-borderland', 'the-harvest', 'the-light-keeper', 'the-watchman', 'the-excuse'];
export const COURTS = ['the-consul', 'the-island', 'the-rite', 'the-window'];
export const TAX_BY_DIE = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];

/* ------------------------------------------------------------- card facts */

export const isAce = (id) => card(id).rank === 1;
export const isCourt = (id) => card(id).rank === 'court';

/** Tokens to develop outright: rank, 3 for an Ace, 10 for a Court. */
export const cost = (id) => (isCourt(id) ? 10 : isAce(id) ? 3 : rankOf(id));
/** Tokens to buy the deed: one per suit, 1 for an Ace, 3 for a Court. */
export const deedCost = (id) => suitsOf(id).length;
/** Tokens gained by selling: two, or three for a Court (one per suit). */
export const saleTokens = (id) => (isCourt(id) ? 3 : 2);
/** Income rank for the die roll: 1 for an Ace, the rank, or null (Courts). */
export const incomeRank = (id) => (isCourt(id) ? null : rankOf(id));
/** Victory value: rank, 10 for a Court, 1 for an Ace. */
export const value = (id) => (isCourt(id) ? 10 : rankOf(id));

/* ----------------------------------------------------------------- setup */

const zero = () => Object.fromEntries(SUITS.map((s) => [s, 0]));

const shuffleWith = (arr, seed) => {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function newGame(seed, allIds) {
  const pool = allIds.filter((id) => {
    const r = card(id).rank;
    return r !== 'pawn' && r !== 'crown' && r != null;      // no Pawns, Crowns, Excuse
  });
  if (pool.length !== 34) {
    throw new Error(`the Magnate property deck is 34 cards (no Pawns, Crowns or Excuse), got ${pool.length}`);
  }
  const deck = shuffleWith(pool, seed >>> 0);
  const crownIds = shuffleWith(allIds.filter((id) => card(id).rank === 'crown'), (seed ^ 0x5f3759df) >>> 0);

  const st = {
    seed,
    deck,
    discard: [],
    hands: [[deck.pop(), deck.pop(), deck.pop()], [deck.pop(), deck.pop(), deck.pop()]],
    crowns: [crownIds.slice(0, 3), crownIds.slice(3, 6)],
    supply: [zero(), zero()],
    collected: [zero(), zero()],                 // tokens ever received (incl. the first three)
    spent: [zero(), zero()],                     // tokens ever paid away (bank + taxation)
    districts: DISTRICTS.map((marker) => ({ marker, props: [] })),
    dice: null,                                  // { a, b, tax } for this turn, or null
    turn: 0,
    phase: 'roll',                               // 'roll' | 'action' | 'draw'
    played: false,                               // the mandatory card play is done
    rolls: 0,
    moves: 0,
    exhaustions: 0,
    finalTurnsLeft: 0,
    over: null,
    winner: null,
    final: null,
    note: 'The first player begins: roll the dice.',
  };
  for (let p = 0; p < 2; p++) {
    for (const c of st.crowns[p]) {
      const s = suitsOf(c)[0];
      st.supply[p][s] += 1;
      st.collected[p][s] += 1;
    }
  }
  return st;
}

/** Every property card: deck + discard + hands + districts (34 cards). */
export function allCards(state) {
  return [...state.deck, ...state.discard, ...state.hands[0], ...state.hands[1],
    ...state.districts.flatMap((d) => d.props.map((p) => p.id))];
}

export const totalTokens = (state, p) => SUITS.reduce((n, s) => n + state.supply[p][s], 0);

/* ----------------------------------------------------------- a. the roll */

function needPhase(state, phase, what) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== phase) throw new Error(what);
}

/** Roll this turn's dice (seeded — the result lives in the state). */
export function rollPhase(state) {
  needPhase(state, 'roll', 'the dice have already been rolled this turn');
  const next = structuredClone(state);
  const rng = mulberry32(((next.seed ^ 0x9e3779b9) + next.rolls * 2654435761) >>> 0);
  const a = 1 + Math.floor(rng() * 10);
  const b = 1 + Math.floor(rng() * 10);
  next.dice = { a, b, tax: null };
  next.rolls += 1;
  const notes = [`Player ${next.turn + 1} rolls ${a} and ${b}.`];

  if (a === 1 || b === 1) {
    const t = 1 + Math.floor(rng() * 6);
    const suit = TAX_BY_DIE[t - 1];
    next.dice.tax = t;
    for (let p = 0; p < 2; p++) {
      const extra = next.supply[p][suit] - 1;
      if (extra > 0) {
        next.supply[p][suit] = 1;
        next.spent[p][suit] += extra;
        notes.push(`Player ${p + 1} is taxed down to one ${suit} token.`);
      }
    }
    notes.push(`Taxation: a ${t} on the six-sided die taxes ${suit}.`);
  }

  notes.push(...collectIncome(next, a, b));
  next.phase = 'action';
  next.moves += 1;
  next.note = notes.join(' ');
  return next;
}

/** Both players collect from the higher die; doubles of 1 collect for Aces.
 *  Returns the log lines it produced. */
function collectIncome(st, a, b) {
  const notes = [];
  if (a === 1 && b === 1) {
    for (let p = 0; p < 2; p++) {
      for (const d of st.districts) {
        for (const prop of d.props) {
          if (prop.owner !== p || !isAce(prop.id)) continue;
          if (prop.developed) give(st, p, suitsOf(prop.id)[0], 1, notes);
          else give(st, p, pickIncomeSuit(st, p, prop.id), 1, notes);
        }
      }
    }
    notes.push('A pair of 1s: each player collects for their Ace properties.');
    return notes;
  }

  const high = Math.max(a, b);
  if (high === 10) {
    for (let p = 0; p < 2; p++) {
      for (const c of st.crowns[p]) give(st, p, suitsOf(c)[0], 1, notes);
    }
    notes.push('A 10: each player collects one resource matching each of their Crowns.');
  } else {
    for (let p = 0; p < 2; p++) {
      for (const d of st.districts) {
        for (const prop of d.props) {
          if (prop.owner !== p || incomeRank(prop.id) !== high) continue;
          if (prop.developed) {
            for (const s of suitsOf(prop.id)) give(st, p, s, 1, notes);
          } else {
            give(st, p, pickIncomeSuit(st, p, prop.id), 1, notes);
          }
        }
      }
    }
    notes.push(`A ${high}: each player collects for their ${high}s in play.`);
  }
  return notes;
}

function give(st, p, suit, n, notes) {
  st.supply[p][suit] += n;
  st.collected[p][suit] += n;
  if (notes) notes.push(`+${n} ${suit}.`);
}

/** The undeveloped-deed income choice: the suit the player holds fewest. */
export function pickIncomeSuit(state, p, id) {
  let best = suitsOf(id)[0];
  for (const s of suitsOf(id)) {
    if (state.supply[p][s] < state.supply[p][best]) best = s;
  }
  return best;
}

/* --------------------------------------------------------- b. the actions */

/** Trade 3 of one resource for 1 of another, with the bank. */
export function trade(state, from, to) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'action' && state.phase !== 'draw') {
    throw new Error('you may only trade after the dice, before the draw');
  }
  if (!SUITS.includes(from) || !SUITS.includes(to) || from === to) throw new Error('trade one suit for a different suit');
  const next = structuredClone(state);
  const p = next.turn;
  if (next.supply[p][from] < 3) throw new Error(`trading needs 3 ${from} tokens — you have ${next.supply[p][from]}`);
  next.supply[p][from] -= 3;
  next.supply[p][to] += 1;
  next.spent[p][from] += 3;
  next.collected[p][to] += 1;
  next.moves += 1;
  next.note = `Player ${p + 1} trades 3 ${from} for 1 ${to}.`;
  return next;
}

/** Spend one token on one of your deeded properties (partial development). */
export function spend(state, districtIndex, suit) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'action' && state.phase !== 'draw') {
    throw new Error('you may only develop deeds after the dice, before the draw');
  }
  const next = structuredClone(state);
  const p = next.turn;
  const d = next.districts[districtIndex];
  if (!d) throw new Error('no such district');
  const prop = [...d.props].reverse().find((x) => x.owner === p && !x.developed);
  if (!prop) throw new Error(`you have no unfinished deed in ${districtName(districtIndex)}`);
  if (!suitsOf(prop.id).includes(suit)) throw new Error(`${card(prop.id).name} shows no ${suit}`);
  if (next.supply[p][suit] < 1) throw new Error(`you have no ${suit} token`);

  next.supply[p][suit] -= 1;
  prop.spent[suit] = (prop.spent[suit] || 0) + 1;
  const total = Object.values(prop.spent).reduce((n, x) => n + x, 0);
  if (total >= cost(prop.id)) prop.developed = true;
  next.moves += 1;
  next.note = prop.developed
    ? `Player ${p + 1} finishes developing ${card(prop.id).name}.`
    : `Player ${p + 1} puts a ${suit} token on ${card(prop.id).name} (${total}/${cost(prop.id)}).`;
  return next;
}

/** Why `id` may not be placed in district `i`, or null when it may. */
export function placeError(state, i, id) {
  const d = state.districts[i];
  if (!d) return 'no such district';
  const p = state.turn;
  if (d.props.some((x) => x.owner === p && !x.developed)) {
    return `you must finish developing ${card(d.props.find((x) => x.owner === p && !x.developed).id).name} in ${districtName(i)} first`;
  }
  const last = d.props[d.props.length - 1];
  if (!last) {
    if (d.marker === 'the-excuse') return null;                // any first card
    if (suitsOf(id).some((s) => suitsOf(d.marker).includes(s))) return null;
    return `${card(id).name} shares no suit with ${card(d.marker).name}, which starts ${districtName(i)}`;
  }
  if (suitsOf(id).some((s) => suitsOf(last.id).includes(s))) return null;
  return `${card(id).name} shares no suit with the previous property, ${card(last.id).name}`;
}

export const legalDistricts = (state, id) =>
  state.districts.map((_, i) => i).filter((i) => !placeError(state, i, id));

/** How the app pays for an outright development, or null when unaffordable. */
export function developmentPayment(state, id) {
  const p = state.turn;
  const suits = suitsOf(id);
  const pay = Object.fromEntries(suits.map((s) => [s, 1]));
  let rest = cost(id) - suits.length;                          // one of each is reserved
  const order = suits.slice().sort((a, b) => state.supply[p][b] - state.supply[p][a]);
  for (const s of order) {
    const giveNow = Math.min(rest, state.supply[p][s] - 1);
    pay[s] += giveNow;
    rest -= giveNow;
    if (!rest) break;
  }
  if (rest > 0) return null;
  for (const s of suits) if (state.supply[p][s] < pay[s]) return null;
  return pay;
}

function handCard(state, handIndex) {
  const id = state.hands[state.turn][handIndex];
  if (!id) throw new Error('you hold no card there');
  return id;
}

/** Play a card outright: a fully developed property in a legal district. */
export function playDevelop(state, handIndex, districtIndex) {
  if (state.over) throw new Error('the game is over');
  if (state.played) throw new Error('you have already played your card this turn');
  if (state.phase !== 'action') throw new Error('you must play a card during the action phase');
  const next = structuredClone(state);
  const p = next.turn;
  const id = handCard(next, handIndex);
  const why = placeError(next, districtIndex, id);
  if (why) throw new Error(why);
  const pay = developmentPayment(next, id);
  if (!pay) {
    const have = suitsOf(id).map((s) => `${next.supply[p][s]} ${s}`).join(', ');
    throw new Error(`${card(id).name} costs ${cost(id)} tokens matching its suits ` +
      `(${suitsOf(id).join(', ')}) — you have ${have}`);
  }
  for (const s of suitsOf(id)) {
    next.supply[p][s] -= pay[s];
    next.spent[p][s] += pay[s];
  }
  next.districts[districtIndex].props.push({ id, owner: p, developed: true, spent: {} });
  next.hands[p].splice(handIndex, 1);
  next.played = true;
  next.phase = 'draw';
  next.moves += 1;
  const payLine = Object.entries(pay).map(([s, n]) => `${n} ${s}`).join(', ');
  next.note = `Player ${p + 1} develops ${card(id).name} in ${districtName(districtIndex)} (${payLine}).`;
  return next;
}

/** Buy the deed: the property goes into a district undeveloped. */
export function playDeed(state, handIndex, districtIndex) {
  if (state.over) throw new Error('the game is over');
  if (state.played) throw new Error('you have already played your card this turn');
  if (state.phase !== 'action') throw new Error('you must play a card during the action phase');
  const next = structuredClone(state);
  const p = next.turn;
  const id = handCard(next, handIndex);
  const why = placeError(next, districtIndex, id);
  if (why) throw new Error(why);
  for (const s of suitsOf(id)) {
    if (next.supply[p][s] < 1) {
      throw new Error(`a deed for ${card(id).name} costs one ${s} token — you have ${next.supply[p][s]}`);
    }
  }
  for (const s of suitsOf(id)) {
    next.supply[p][s] -= 1;
    next.spent[p][s] += 1;
  }
  next.districts[districtIndex].props.push({ id, owner: p, developed: false, spent: {} });
  next.hands[p].splice(handIndex, 1);
  next.played = true;
  next.phase = 'draw';
  next.moves += 1;
  next.note = `Player ${p + 1} buys the deed for ${card(id).name} in ${districtName(districtIndex)}.`;
  return next;
}

/** Sell a card: discard it and collect one token per suit (two for an Ace). */
export function playSell(state, handIndex) {
  if (state.over) throw new Error('the game is over');
  if (state.played) throw new Error('you have already played your card this turn');
  if (state.phase !== 'action') throw new Error('you must play a card during the action phase');
  const next = structuredClone(state);
  const p = next.turn;
  const id = handCard(next, handIndex);
  const n = saleTokens(id);
  for (const s of suitsOf(id)) give(next, p, s, 1, null);
  if (n === 2 && suitsOf(id).length === 1) give(next, p, suitsOf(id)[0], 1, null);
  next.discard.push(id);
  next.hands[p].splice(handIndex, 1);
  next.played = true;
  next.phase = 'draw';
  next.moves += 1;
  next.note = `Player ${p + 1} sells ${card(id).name} for ${n} token${n === 1 ? '' : 's'}.`;
  return next;
}

/* ------------------------------------------------------------ c. the draw */

/** Draw a card; this ends the turn (and possibly the game). */
export function drawPhase(state) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'draw') {
    throw new Error('you must play exactly one card — develop, buy a deed, or sell — before drawing');
  }
  const next = structuredClone(state);
  if (!next.played) throw new Error('you must play exactly one card — develop, buy a deed, or sell — before drawing');
  let id = next.deck.pop();
  if (!id) {
    next.exhaustions += 1;
    if (next.exhaustions === 1 && next.discard.length) {
      next.deck = shuffleWith(next.discard, ((next.seed ^ 0x51ed270b) + 1) >>> 0);
      next.discard = [];
      id = next.deck.pop();
      next.note = 'The draw pile is exhausted; the discard pile is shuffled into a new one. ';
    } else if (!next.finalTurnsLeft) {
      next.finalTurnsLeft = 2;
      next.note = 'The draw pile is exhausted for good. Each player gets one final turn. ';
    }
  }
  if (id) {
    next.hands[next.turn].push(id);
    next.note += `Player ${next.turn + 1} draws a card.`;
  }
  endTurn(next);
  return next;
}

function endTurn(st) {
  st.turn = 1 - st.turn;
  st.phase = 'roll';
  st.dice = null;
  st.played = false;
  st.moves += 1;
  if (st.finalTurnsLeft > 0) {
    st.finalTurnsLeft -= 1;
    if (st.finalTurnsLeft === 0) { endGame(st); return; }
  }
  st.note += ` Player ${st.turn + 1}: roll the dice.`;
}

/* ------------------------------------------------------------- the end */

/** The final scoring, computed from the districts (also used by the UI). */
export function scoreFinal(state) {
  const totals = state.districts.map(() => [0, 0]);  // per district, per player
  const ranks = [0, 0];
  for (let i = 0; i < state.districts.length; i++) {
    const d = state.districts[i];
    for (let p = 0; p < 2; p++) {
      const mine = d.props.filter((x) => x.owner === p && x.developed);
      let sum = 0;
      for (const prop of mine) {
        if (isAce(prop.id)) {
          const suit = suitsOf(prop.id)[0];
          const others = mine.filter((x) => x !== prop && suitsOf(x.id).includes(suit)).length;
          sum += 1 + others;
        } else {
          sum += value(prop.id);
        }
        ranks[p] += value(prop.id);                  // the tiebreak uses plain ranks
      }
      totals[i][p] = sum;
    }
  }
  const vps = [0, 0];
  for (let i = 0; i < state.districts.length; i++) {
    const [a, b] = [totals[i][0], totals[i][1]];
    if (a > b) vps[0] += 1;
    else if (b > a) vps[1] += 1;
  }
  const tokens = [totalTokens(state, 0), totalTokens(state, 1)];
  let winner = null;
  let how = null;
  if (vps[0] !== vps[1]) { winner = vps[0] > vps[1] ? 0 : 1; how = 'districts'; }
  else if (ranks[0] !== ranks[1]) { winner = ranks[0] > ranks[1] ? 0 : 1; how = 'ranks'; }
  else if (tokens[0] !== tokens[1]) { winner = tokens[0] > tokens[1] ? 0 : 1; how = 'tokens'; }
  return { totals, vps, ranks, tokens, winner, how };
}

function endGame(st) {
  // discard hands and unfinished deeds (with the tokens spent on them)
  st.discard.push(...st.hands[0], ...st.hands[1]);
  st.hands = [[], []];
  for (const d of st.districts) {
    const keep = [];
    for (const prop of d.props) {
      if (prop.developed) { keep.push(prop); continue; }
      st.discard.push(prop.id);
      for (const [s, n] of Object.entries(prop.spent)) st.spent[prop.owner][s] += n;
    }
    d.props = keep;
  }
  st.final = scoreFinal(st);
  st.winner = st.final.winner;
  st.over = 'done';
  const w = st.final.winner;
  st.note = w == null
    ? 'The Grand Duke dies without choosing: the game is a draw.'
    : `Player ${w + 1} becomes Grand Duke.`;
}

/* -------------------------------------------------------------- moves */

/** One entry point for the UI and the playouts: { type, … }. */
export function applyMove(state, action) {
  switch (action.type) {
    case 'roll': return rollPhase(state);
    case 'trade': return trade(state, action.from, action.to);
    case 'spend': return spend(state, action.district, action.suit);
    case 'develop': return playDevelop(state, action.handIndex, action.district);
    case 'deed': return playDeed(state, action.handIndex, action.district);
    case 'sell': return playSell(state, action.handIndex);
    case 'draw': return drawPhase(state);
    default: throw new Error(`unknown action ${action.type}`);
  }
}

/** Every move the player whose turn it is may take right now. */
export function legalActions(state) {
  if (state.over) return [];
  if (state.phase === 'roll') return [{ type: 'roll' }];
  if (state.phase === 'draw') return [{ type: 'draw' }, ...freeActions(state)];
  if (state.phase !== 'action') return [];
  const out = freeActions(state);
  const p = state.turn;
  if (!state.played) {
    state.hands[p].forEach((id, handIndex) => {
      out.push({ type: 'sell', handIndex });
      const districts = legalDistricts(state, id);
      if (districts.length) {
        for (const district of districts) {
          if (developmentPayment(state, id)) out.push({ type: 'develop', handIndex, district });
          if (suitsOf(id).every((s) => state.supply[p][s] >= 1)) out.push({ type: 'deed', handIndex, district });
        }
      }
    });
  }
  return out;
}

/** Trades and partial developments: free actions after the roll, before the draw. */
function freeActions(state) {
  const out = [];
  const p = state.turn;
  for (const from of SUITS) {
    if (state.supply[p][from] < 3) continue;
    for (const to of SUITS) {
      if (to !== from) out.push({ type: 'trade', from, to });
    }
  }
  state.districts.forEach((d, district) => {
    const prop = [...d.props].reverse().find((x) => x.owner === p && !x.developed);
    if (!prop) return;
    for (const s of suitsOf(prop.id)) {
      if (state.supply[p][s] > 0) out.push({ type: 'spend', district, suit: s });
    }
  });
  return out;
}

/* --------------------------------------------------------------- misc */

export const districtName = (i) => (i === 4 ? 'the Excuse district' : `district ${i + 1}`);

/** One line for a district: "district 1 · the Borderland · 2 properties". */
export function describeDistrict(state, i) {
  const d = state.districts[i];
  return `${districtName(i)} · ${card(d.marker).name} · ${d.props.length} propert${d.props.length === 1 ? 'y' : 'ies'}`;
}

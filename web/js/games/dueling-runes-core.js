/* Dueling Runes — game logic, no DOM.  Solitaire form: you vs. a rival mage.
 *
 * Rules: https://wiki.decktet.com/game:dueling-runes  (Jorge Arroyo, based on
 * Waving Hands by Richard Bartle)
 *
 * Each turn both mages reveal a card onto their spell sequence.  Activation
 * runes on the card just played (Moons = Caster, Wyrms = Daemons, Knots =
 * Crowns) fire spells, powered by energy runes (Suns, Waves, Leaves) showing
 * in the sequence.  Effects resolve Moons, then Wyrms, then Knots; highest
 * played card first inside each phase.  Both sides start on a d12 of health
 * and hold up to five cards; the sequence is trimmed to three at the end of
 * every turn.  Last wizard standing wins.
 *
 * Interpretations (all stated on the rules page, "Note on this
 * implementation"):
 *   1. Sequence size — the wiki says 4 cards in the introduction but says to
 *      trim to 3 at end of turn.  This app follows the end-of-turn rule: the
 *      sequence holds at most 3 cards and the 4-card limit never binds.
 *   2. Only the basic spell table is implemented (12 spells plus Counter
 *      Spell and Magic Mirror); the advanced table is unfinished in the wiki.
 *   3. The solo variant asks for a "fair" opponent; this app states an
 *      explicit AI policy (see foePlan / foeCast below) that is deterministic
 *      for a given seed.
 *   4. Targeting is fixed by the spell: Moons and the protective Knots
 *      (Haste, Invisibility) act on the caster; Wyrms and the harmful Knots
 *      (Amnesia, Confusion) act on the rival.
 *   5. Each rune *type* powers at most one spell per turn, and all visible
 *      runes of that type power it (the wiki lets you split individual
 *      runes; splitting is not offered here).
 *   6. The Excuse is a rune-less card that cycles the deck when drawn and
 *      never sits in a hand.
 *   7. Counter Spell and Magic Mirror are self-targeted and resolved before
 *      the three phases; a mirror reflects at most twice (so two mages
 *      mirroring each other send a spell back where it came from). */

import { mulberry32, rankValue, baseId } from '../decktet.js';

const EXCUSE = 'the-excuse';

export const ENERGY = ['suns', 'waves', 'leaves'];
export const ACTIVATION = ['moons', 'daemons', 'crowns'];
export const RUNE_NAME = {
  suns: 'Sun', waves: 'Wave', leaves: 'Leaf',
  moons: 'Moon', daemons: 'Wyrm', crowns: 'Knot',
};
export const SPELL_TABLE = {
  moons: { suns: 'resist-cold', waves: 'resist-heat', leaves: 'heal', '': 'shield' },
  daemons: { suns: 'fire-ball', waves: 'ice-bolt', leaves: 'drain', '': 'hit' },
  crowns: { suns: 'haste', waves: 'invisible', leaves: 'amnesia', '': 'confusion' },
};
export const SPELL_NAME = {
  'resist-cold': 'Resist Cold', 'resist-heat': 'Resist Heat',
  heal: 'Heal', shield: 'Shield',
  'fire-ball': 'Fire Ball', 'ice-bolt': 'Ice Bolt',
  drain: 'Drain', hit: 'Hit',
  haste: 'Haste', invisible: 'Invisibility',
  amnesia: 'Amnesia', confusion: 'Confusion',
  counter: 'Counter Spell', mirror: 'Magic Mirror',
};

const SELF_SCHOOL = new Set(['resist-cold', 'resist-heat', 'heal', 'shield', 'haste', 'invisible']);
const DAMAGE_KIND = { 'fire-ball': 'heat', 'ice-bolt': 'cold', drain: 'physical', hit: 'physical' };
const COUNTER_STOPS = new Set([
  'resist-cold', 'resist-heat', 'heal', 'shield',
  'haste', 'invisible', 'amnesia', 'confusion', 'drain',
]);
export const HAND_MAX = 5;
export const SEQ_KEEP = 3;
export const HP_MAX = 12;

/* log phrasing */
const subj = (w) => (w === 'you' ? 'You' : 'The rival');
const obj = (w) => (w === 'you' ? 'you' : 'the rival');
const gen = (w) => (w === 'you' ? 'your' : "the rival's");
const capGen = (w) => (w === 'you' ? 'Your' : "The rival's");
const s3 = (w, base) => (w === 'you' ? base : `${base}s`);

/* ------------------------------------------------------------ card access */

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const runesOf = (id) => card(id).suits;
export const activationsOf = (id) => runesOf(id).filter((s) => ACTIVATION.includes(s));
export const cardName = (id) => card(id).name;
const cap = (who) => (who === 'you' ? 'You' : 'Rival');
const other = (who) => (who === 'you' ? 'foe' : 'you');

/* ------------------------------------------------------------------ rng */

function nextRand(st) {
  st.rngs = (st.rngs + 0x6d2b79f5) | 0;
  let t = Math.imul(st.rngs ^ (st.rngs >>> 15), 1 | st.rngs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffleInPlace(a, st) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand(st) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/* --------------------------------------------------------------- status */

export function anyStatus(state, who, name) {
  return state[who].status.some((s) => s.name === name);
}
/** Active right now (not merely "starting next turn"). */
export function hasStatus(state, who, name) {
  return state[who].status.some((s) => s.name === name && !s.pending);
}
function addStatus(next, who, name, turns, pending) {
  const entry = { name, turns, pending };
  const i = next[who].status.findIndex((s) => s.name === name);
  if (i >= 0) next[who].status[i] = entry;
  else next[who].status.push(entry);
}
function addLog(next, msg) {
  next.log.push(msg);
  if (next.log.length > 60) next.log.shift();
}

/* ---------------------------------------------------------------- setup */

function mkPlayer(hp) {
  return { hp, maxHp: HP_MAX, hand: [], seq: [], status: [] };
}

/**
 * newGame(seed, allDeck, { playerHp, foeHp })
 * The wiki starts both on 12, but suggests the *solo player* take fewer.
 * Defaults: you 8, rival 12 (12, 8, 5 and 1 are offered in the UI).
 */
export function newGame(seed, allDeck, opts = {}) {
  const rng = mulberry32(seed >>> 0);
  const pool = allDeck.filter((id) => id !== EXCUSE).slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.splice(Math.floor(pool.length / 2), 0, EXCUSE);       // "around the middle"

  const youHp = clampHp(opts.playerHp === undefined ? 8 : opts.playerHp, HP_MAX);
  const foeHp = clampHp(opts.foeHp === undefined ? HP_MAX : opts.foeHp, HP_MAX);
  const st = {
    seed: seed >>> 0, rngs: seed >>> 0, turn: 1,
    deck: pool, discard: [],
    you: mkPlayer(youHp), foe: mkPlayer(foeHp),
    phase: 'choose', pending: null, plan: null, confused: null,
    hpChoice: youHp,
    log: [], over: null,
  };
  for (let i = 0; i < HAND_MAX; i++) {
    st.you.hand.push(st.deck.shift());
    st.foe.hand.push(st.deck.shift());
  }
  return st;
}
const clampHp = (v, max) => (Number.isFinite(v) && v > 0 ? Math.min(v, max) : max);

/** How many cards the player must reveal this turn. */
export function playNeed(state, who) {
  if (who === 'you' && anyStatus(state, 'you', 'confusion')) return 1;
  if (!hasStatus(state, who, 'haste')) return 1;
  return Math.min(2, Math.max(1, state[who].hand.length));
}

/* ------------------------------------------------------------- draw / Excuse */

function takeTop(next) {
  if (!next.deck.length) return null;
  let id = next.deck.shift();
  if (id !== EXCUSE) return id;

  /* "the remaining cards are shuffled together with the discard pile …
     Then the Excuse is placed around the middle of the deck." */
  const pool = next.deck.concat(next.discard);
  next.discard = [];
  shuffleInPlace(pool, next);
  const pos = pool.length ? Math.max(1, Math.floor(pool.length / 2)) : 0;
  pool.splice(pos, 0, EXCUSE);
  next.deck = pool;
  addLog(next, 'The Excuse is drawn: deck and discard are shuffled into a new deck, Excuse back in the middle.');
  if (!next.deck.length) return null;                   // only the Excuse is left
  id = next.deck.shift();
  if (id === EXCUSE) { next.deck.unshift(EXCUSE); return null; }
  return id;
}

function drawUpTo(next, who) {
  const n = Math.min(2, HAND_MAX - next[who].hand.length);
  for (let i = 0; i < n; i++) {
    const id = takeTop(next);
    if (id == null) break;
    next[who].hand.push(id);
  }
}

/* ------------------------------------------------------------- runes */

/** Visible runes of a sequence: face-down cards do not count. */
export function visibleRunes(state, who) {
  const counts = {};
  for (const e of state[who].seq) {
    if (e.down) continue;
    for (const s of runesOf(e.id)) counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

/* ---------------------------------------------------------- cast planning */

/**
 * Every legal cast plan for one revealed card: one { act, energy } pair per
 * activation rune on it, each energy type used at most once (a rune may only
 * power one spell per turn).  energy '' is the "Nothing" row of the table.
 */
export function castPlans(state, who, cardId) {
  const acts = activationsOf(cardId);
  const counts = visibleRunes(state, who);
  const avail = ENERGY.filter((s) => (counts[s] || 0) > 0);
  const plans = [];
  const walk = (i, used, picks) => {
    if (i === acts.length) { plans.push(picks.map((p) => ({ ...p }))); return; }
    for (const e of ['', ...avail]) {
      if (e && used.has(e)) continue;
      if (e) used.add(e);
      picks.push({ act: acts[i], energy: e });
      walk(i + 1, used, picks);
      picks.pop();
      if (e) used.delete(e);
    }
  };
  walk(0, new Set(), []);
  return plans;
}

/** The energy options still open for one activation rune. */
export function energyOptions(counts, used) {
  return ['', ...ENERGY.filter((s) => (counts[s] || 0) > 0 && !used.has(s))];
}

export const spellFor = (act, energy) => SPELL_TABLE[act][energy === undefined ? '' : energy];

/** Label for the UI: { spell, name, amount, target } — target is fixed. */
export function castInfo(act, energy, counts) {
  const e = energy || '';
  const spell = SPELL_TABLE[act][e];
  const amount = e ? (counts[e] || 0) : 0;
  const target = SELF_SCHOOL.has(spell) ? 'self' : 'other';
  return { spell, name: SPELL_NAME[spell], amount, target, energy: e };
}

/* -------------------------------------------------- damage helpers (policy) */

function damageAfter(state, target, kind, amount) {
  if (kind === 'heat' && hasStatus(state, target, 'resist-heat')) return 0;
  if (kind === 'cold' && hasStatus(state, target, 'resist-cold')) return 0;
  if (kind === 'physical' && hasStatus(state, target, 'shield')) return 0;
  return amount;
}

/* --------------------------------------------------------------- specials */

/** Distinct activation runes showing in a hand. */
function handRunes(hand) {
  const set = new Set();
  for (const id of hand) for (const r of activationsOf(id)) set.add(r);
  return set;
}

export function specialEligible(hand, kind) {
  const have = handRunes(hand);
  return kind === 'counter' ? have.size >= 2 : kind === 'mirror' ? have.size >= 3 : false;
}

const pairs = (a) => [[a[0], a[1]], [a[0], a[2]], [a[1], a[2]]];

/** Cheapest set of hand cards covering the required runes. */
function minCover(hand, required) {
  let best = null;
  for (let mask = 1; mask < (1 << hand.length); mask++) {
    const cards = [];
    const set = new Set();
    for (let i = 0; i < hand.length; i++) {
      if (!(mask & (1 << i))) continue;
      cards.push(hand[i]);
      for (const r of activationsOf(hand[i])) set.add(r);
    }
    if (!required.every((r) => set.has(r))) continue;
    const rankSum = cards.reduce((n, id) => n + rankOf(id), 0);
    if (!best || cards.length < best.cards.length
      || (cards.length === best.cards.length && rankSum < best.rankSum)) {
      best = { cards, rankSum };
    }
  }
  return best;
}

/** What casting this special costs from `hand`: { cards, runes }. */
export function specialCost(hand, kind) {
  if (!specialEligible(hand, kind)) return null;
  if (kind === 'mirror') {
    const cover = minCover(hand, ACTIVATION.slice());
    return cover && { cards: cover.cards, runes: ACTIVATION.slice() };
  }
  const have = [...handRunes(hand)];
  let best = null;
  for (const req of pairs(ACTIVATION)) {
    if (!req.every((r) => have.includes(r))) continue;
    const cover = minCover(hand, req);
    if (cover && (!best || cover.cards.length < best.cards.length
      || (cover.cards.length === best.cards.length && cover.rankSum < best.rankSum))) {
      best = cover;
    }
  }
  return best && { cards: best.cards, runes: best.cards.flatMap((id) => activationsOf(id)) };
}

/* ------------------------------------------------------------- AI policy */

/**
 * The rival's card choice — the "fair" opponent the solo variant asks for,
 * stated as a policy:
 *   - value the card by what it can cast right now: 3x damage it would
 *     actually deal (after your resists and shield), plus sustain (healing
 *     and protection) and control (knot spells);
 *   - at 1-6 HP: 3*sustain + 2*control + damage  (heal and protect first,
 *     attack only when there is nothing else) — the wiki's low bracket;
 *   - at 7-12 HP: 3*damage + 2*control + a little sustain — attack with the
 *     most damaging spell;
 *   - cards with no activation rune are fuel: half a point per energy rune;
 *   - a small bonus for the higher card, ties broken by a seeded rng that is
 *     derived from (seed, turn) alone, so the same state always repeats.
 */
function foeCardValue(state, id) {
  const counts = { ...visibleRunes(state, 'foe') };
  for (const s of runesOf(id)) counts[s] = (counts[s] || 0) + 1;
  const hp = state.foe.hp;
  const acts = activationsOf(id);
  let damage = 0, sustain = 0, control = 0, fuel = 0;

  for (const a of acts) {
    if (a === 'daemons') {
      let best = damageAfter(state, 'you', 'physical', 1);        // the bare Hit
      if (counts.suns > 0) best = Math.max(best, damageAfter(state, 'you', 'heat', counts.suns));
      if (counts.waves > 0) best = Math.max(best, damageAfter(state, 'you', 'cold', counts.waves));
      if (counts.leaves > 0) best = Math.max(best, damageAfter(state, 'you', 'physical', counts.leaves));
      damage += best;
    } else if (a === 'moons') {
      if (hp < state.foe.maxHp && counts.leaves > 0) {
        sustain += Math.min(counts.leaves, state.foe.maxHp - hp);
      } else {
        sustain += 1.5;                                            // protection
      }
    } else if (a === 'crowns') {
      control += 2;
    }
  }
  if (!acts.length) {
    fuel = 0.6 * runesOf(id).filter((s) => ENERGY.includes(s)).length;
  }
  const bracket = hp <= 6
    ? 3 * sustain + 2 * control + damage
    : 3 * damage + 2 * control + (hp <= 9 ? sustain : 0.2 * sustain);
  return bracket + fuel + 0.05 * rankOf(id);
}

/**
 * The rival's whole reveal: { cards, special } or { confused: true }.
 * Specials: Counter Spell when it can pay and the rival is at 5 or less;
 * Magic Mirror when it can pay and is at 9 or less (Counter wins ties).
 */
export function foePlan(state) {
  const rng = mulberry32((state.seed ^ Math.imul(state.turn, 0x9e3779b9)) >>> 0);
  if (anyStatus(state, 'foe', 'confusion')) return { cards: [], special: null, confused: true };

  const hand = state.foe.hand;
  const ranked = hand
    .map((id, i) => ({ id, v: foeCardValue(state, id) + rng() * 1e-6, i }))
    .sort((a, b) => b.v - a.v);
  const need = playNeed(state, 'foe');
  const cards = ranked.slice(0, Math.min(need, ranked.length)).map((r) => r.id);

  const rest = hand.filter((id) => !cards.includes(id));
  let special = null;
  if (state.foe.hp <= 5 && specialEligible(rest, 'counter')) special = 'counter';
  else if (state.foe.hp <= 9 && specialEligible(rest, 'mirror')) special = 'mirror';
  return { cards, special };
}

/**
 * The rival's cast for one activation rune in one phase, decided as the
 * spells resolve (so it never targets what you are protected against):
 *   - Wyrm: the energy that deals the most damage to you right now, skipping
 *     anything you resist or shield (ties: Sun, Wave, Leaf, then Hit);
 *   - Moon: at 6 or less HP heal first if leaves power it, else protect
 *     (Resist Heat if you can Fire Ball, Resist Cold if you can Ice Bolt,
 *     otherwise Shield); at 7 or more protect first;
 *   - Knot: at 6 or less defensive — Invisibility, then Haste, else Amnesia,
 *     then Confusion; at 7 or more aggressive — Amnesia, Confusion, then
 *     Haste, then Invisibility (the wiki's bracket guidelines).
 */
function foeCast(next, id, act, entries, ctx) {
  const counts = visibleRunes(next, 'foe');
  const avail = ENERGY.filter((s) => counts[s] > 0 && !ctx.used.foe.has(s));
  const yourActs = entries.filter((e) => e.who === 'you').flatMap((e) => activationsOf(e.id));
  const yourCounts = visibleRunes(next, 'you');
  const hp = next.foe.hp, max = next.foe.maxHp;
  const threatHeat = yourActs.includes('daemons') && yourCounts.suns > 0;
  const threatCold = yourActs.includes('daemons') && yourCounts.waves > 0;

  const valueOf = (e) => {
    if (act === 'daemons') {
      const amount = e === '' ? 1 : counts[e];
      const kind = e === 'suns' ? 'heat' : e === 'waves' ? 'cold' : 'physical';
      return damageAfter(next, 'you', kind, amount);
    }
    if (act === 'moons') {
      if (e === 'leaves') return hp <= 6 ? 4 * Math.min(counts.leaves, max - hp) : 0;
      if (e === 'waves') return threatHeat ? 3 : 0.5;          // Resist Heat
      if (e === 'suns') return threatCold ? 3 : 0.5;           // Resist Cold
      return hp <= 6 ? 1 : 2;                                  // Shield
    }
    // crowns
    const youVisible = next.you.seq.some((x) => !x.down);
    if (e === 'waves') return hp <= 6 ? 3 : 0.5;               // Invisibility
    if (e === 'suns') return hp <= 6 ? 2 : 1;                  // Haste
    if (e === 'leaves') return (hp <= 6 ? 0.5 : 4) * (youVisible ? 1 : 0);  // Amnesia
    return (hp <= 6 ? 1 : 3) * (anyStatus(next, 'you', 'confusion') ? 0 : 1); // Confusion
  };

  let bestE = '', bestV = -Infinity;
  for (const e of ['', ...avail]) {                            // '' last wins ties
    const v = valueOf(e);
    if (v > bestV) { bestV = v; bestE = e; }
  }
  const cast = mkCast('foe', id, act, bestE, counts);
  if (cast.energy) ctx.used.foe.add(cast.energy);   // one rune type per spell per turn
  return cast;
}

/* ------------------------------------------------------------- casting */

function mkCast(caster, id, act, energy, counts) {
  const e = energy || '';
  const spell = SPELL_TABLE[act][e];
  const cast = {
    caster, act, energy: e, spell, rank: rankOf(id),
    amount: e ? (counts[e] || 0) : 0,
    target: SELF_SCHOOL.has(spell) ? caster : other(caster),
  };
  if (cast.amount === 0 && e) throw new Error(`no ${RUNE_NAME[e]} runes to power ${cast.spell}`);
  return cast;
}

/** Validate one card's plan, register its energy use, return its casts. */
function buildYourCasts(next, id, plan, used) {
  const acts = activationsOf(id);
  const counts = visibleRunes(next, 'you');
  if (!Array.isArray(plan) || plan.length !== acts.length) {
    throw new Error(`cast one spell per activation rune on ${cardName(id)}`);
  }
  const seen = new Set();
  return plan.map((c) => {
    if (!c || !ACTIVATION.includes(c.act) || !acts.includes(c.act) || seen.has(c.act)) {
      throw new Error('each activation rune on the card must cast exactly one spell');
    }
    seen.add(c.act);
    const e = c.energy || '';
    if (e !== '') {
      if (!ENERGY.includes(e)) throw new Error(`bad energy rune ${e}`);
      if (!counts[e]) throw new Error(`your sequence shows no ${RUNE_NAME[e]} to power that`);
      if (used.has(e)) throw new Error(`your ${RUNE_NAME[e]} runes are already powering a spell this turn`);
      used.add(e);
    }
    return mkCast('you', id, c.act, e, counts);
  });
}

/* ------------------------------------------------------------- effects */

function applyCast(next, cast, ctx, delta) {
  const { caster, spell, amount } = cast;
  let target = SELF_SCHOOL.has(spell) ? caster : other(caster);
  let flips = 0;
  while (target !== caster && ctx.mirror.has(target) && flips < 2) {
    target = other(target);
    flips++;
    addLog(next, `Magic Mirror turns the spell back: it now lands on ${obj(target)}.`);
  }
  if (COUNTER_STOPS.has(spell) && ctx.counter.has(target)) {
    addLog(next, `${capGen(target)} ${SPELL_NAME[spell]} is stopped by Counter Spell.`);
    return;
  }
  if (target !== caster && hasStatus(next, target, 'invisible')) {
    addLog(next, `${subj(target)} ${target === 'you' ? 'are' : 'is'} invisible — ${SPELL_NAME[spell]} finds no target.`);
    return;
  }

  switch (spell) {
    case 'resist-cold':
    case 'resist-heat':
      addStatus(next, caster, spell, Math.max(1, amount), false);
      addLog(next, `${subj(caster)} ${s3(caster, 'cast')} ${SPELL_NAME[spell]} for ${amount} turn${amount === 1 ? '' : 's'}.`);
      break;
    case 'shield':
      addStatus(next, caster, 'shield', 1, false);
      addLog(next, `${subj(caster)} ${s3(caster, 'raise')} a Shield this turn.`);
      break;
    case 'heal':
      delta[caster] += amount;
      addLog(next, `${subj(caster)} ${s3(caster, 'heal')} up to ${amount}.`);
      break;
    case 'fire-ball':
    case 'ice-bolt': {
      const kind = DAMAGE_KIND[spell];
      const immune = (kind === 'heat' && hasStatus(next, target, 'resist-heat'))
        || (kind === 'cold' && hasStatus(next, target, 'resist-cold'));
      if (immune) {
        addLog(next, `${subj(target)} ${target === 'you' ? 'are' : 'is'} immune — ${SPELL_NAME[spell]} does nothing.`);
      } else {
        delta[target] -= amount;
        addLog(next, `${capGen(caster)} ${SPELL_NAME[spell]} hits ${obj(target)} for ${amount}.`);
      }
      break;
    }
    case 'drain':
      if (hasStatus(next, target, 'shield')) {
        addLog(next, `Drain is stopped by ${gen(target)} Shield.`);
      } else {
        delta[target] -= amount;
        delta[caster] += amount;
        addLog(next, `${capGen(caster)} Drain takes ${amount} from ${obj(target)}.`);
      }
      break;
    case 'hit':
      if (hasStatus(next, target, 'shield')) {
        addLog(next, `Hit is stopped by ${gen(target)} Shield.`);
      } else {
        delta[target] -= 1;
        addLog(next, `${capGen(caster)} Hit lands on ${obj(target)}.`);
      }
      break;
    case 'haste':
      addStatus(next, target, 'haste', Math.max(1, amount), true);
      addLog(next, `${subj(target)} ${target === 'you' ? 'are' : 'is'} Hasted for ${amount} turn${amount === 1 ? '' : 's'} — an extra card each turn.`);
      break;
    case 'invisible':
      addStatus(next, target, 'invisible', Math.max(1, amount), true);
      addLog(next, `${subj(target)} will be Invisible for ${amount} turn${amount === 1 ? '' : 's'}.`);
      break;
    case 'amnesia': {
      const visible = next[target].seq.filter((e) => !e.down);
      const flipped = Math.min(amount, visible.length);
      for (let i = visible.length - 1, n = 0; i >= 0 && n < flipped; i--, n++) visible[i].down = true;
      addLog(next, flipped
        ? `${subj(caster)} ${s3(caster, 'turn')} ${flipped} of ${gen(target)} rune${flipped === 1 ? '' : 's'} face down.`
        : `${subj(caster)} ${s3(caster, 'cast')} Amnesia, but there are no face-up runes to turn down.`);
      break;
    }
    case 'confusion':
      addStatus(next, target, 'confusion', 1, true);
      addLog(next, `${subj(target)} ${target === 'you' ? 'are' : 'is'} Confused: a random card next turn.`);
      break;
    default:
      throw new Error(`unknown spell ${spell}`);
  }
}

function applyGroup(next, group, ctx) {
  const delta = { you: 0, foe: 0 };
  for (const cast of group) applyCast(next, cast, ctx, delta);
  for (const who of ['you', 'foe']) {
    const p = next[who];
    p.hp = Math.min(p.maxHp, Math.max(0, p.hp + delta[who]));
  }
  const youDead = next.you.hp <= 0, foeDead = next.foe.hp <= 0;
  if (youDead && foeDead) {
    next.over = 'draw';
    addLog(next, 'Both mages fall — the duel ends in a draw.');
  } else if (foeDead) {
    next.over = 'won';
    addLog(next, 'The rival mage falls. You win the duel.');
  } else if (youDead) {
    next.over = 'lost';
    addLog(next, 'You fall. The duel is lost.');
  }
}

/* ---------------------------------------------------------- turn taking */

/**
 * reveal(state, decl) — both mages lay a card face up.
 * decl = { you: [cardIds], youSpecial: 'counter'|'mirror'|null }
 * The rival's card (and its special) come from foePlan; a confused rival
 * draws from the deck instead.  Returns a NEW state in phase 'casting'.
 */
export function reveal(state, decl) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'choose') throw new Error('cards are already revealed');
  const next = structuredClone(state);
  const confusedYou = anyStatus(next, 'you', 'confusion');
  const confusedFoe = anyStatus(next, 'foe', 'confusion');

  if (!next.you.hand.length || !next.foe.hand.length) {
    next.over = 'stalemate';
    next.phase = null;
    addLog(next, 'No cards left to play — the duel ends undecided.');
    return next;
  }

  /* your cards */
  let youCards;
  if (confusedYou) {
    if (!next.confused) throw new Error('draw a card for your confused play first');
    youCards = [next.confused.card];
  } else {
    youCards = Array.isArray(decl?.you) ? decl.you.slice() : [];
    const need = playNeed(next, 'you');
    if (youCards.length !== need) throw new Error(`you must play ${need} card${need === 1 ? '' : 's'} this turn`);
    if (new Set(youCards).size !== youCards.length) throw new Error('the same card twice');
    for (const id of youCards) {
      if (!next.you.hand.includes(id)) throw new Error(`you do not hold ${cardName(id)}`);
    }
  }

  /* the rival picks without seeing your choice (simultaneous reveal) */
  const fp = foePlan(next);
  let foeCards;
  if (confusedFoe) {
    foeCards = [];
    const id = takeTop(next);
    if (id != null) foeCards.push(id);
    else if (next.foe.hand.length) {
      const i = Math.floor(nextRand(next) * next.foe.hand.length);
      foeCards.push(next.foe.hand.splice(i, 1)[0]);
    }
    if (!foeCards.length) throw new Error('the rival has no card to play');
  } else {
    foeCards = fp.cards;
    if (!foeCards.length || foeCards.some((id) => !next.foe.hand.includes(id))) {
      throw new Error('the rival has no card to play');
    }
  }

  /* both cards go onto the sequences now, so the casting step sees exactly
     the runes that will resolve */
  for (const who of ['you', 'foe']) {
    const cards = who === 'you' ? youCards : foeCards;
    for (const id of cards) {
      const i = next[who].hand.indexOf(id);
      if (i >= 0) next[who].hand.splice(i, 1);
      next[who].seq.push({ id, down: false });
    }
  }

  /* your special, paid for out of what is left in your hand */
  const youSpecial = decl?.youSpecial || null;
  if (youSpecial && !['counter', 'mirror'].includes(youSpecial)) throw new Error('bad special spell');
  if (youSpecial && !specialEligible(next.you.hand, youSpecial)) {
    throw new Error(`your hand cannot pay for ${SPELL_NAME[youSpecial]}`);
  }
  const foeSpecial = confusedFoe ? null : (fp.special || null);
  if (foeSpecial && !specialEligible(next.foe.hand, foeSpecial)) {
    throw new Error('the rival cannot pay for its special');
  }

  next.pending = { you: youCards, foe: foeCards, youSpecial, foeSpecial };
  next.phase = 'casting';
  next.plan = null;
  return next;
}

/**
 * resolveTurn(state, plan) — resolve everything the reveal set up.
 * plan = [[{act, energy}, …] one array per card you revealed].
 * Returns a NEW state: log lines appended, phase back to 'choose' (or over).
 */
export function resolveTurn(state, plan) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'casting' || !state.pending) throw new Error('nothing has been revealed');
  const next = structuredClone(state);
  const pending = next.pending;
  const confusedYou = anyStatus(next, 'you', 'confusion');
  const confusedFoe = anyStatus(next, 'foe', 'confusion');

  /* 1 — the reveal already put both cards on the sequences; check sync */
  for (const who of ['you', 'foe']) {
    const tail = next[who].seq.slice(-pending[who].length).map((e) => e.id);
    if (tail.join('|') !== pending[who].join('|')) throw new Error('sequence out of sync with the reveal');
    const names = pending[who].map(cardName).join(' and ');
    if (who === 'foe' && confusedFoe) addLog(next, `The rival is confused — it plays ${names}.`);
    else if (who === 'you' && confusedYou) addLog(next, `Confused, you play ${names} at random.`);
    else addLog(next, `${subj(who)} ${who === 'you' ? 'play' : 'plays'} ${names}.`);
  }

  /* 2 — special spells, resolved before the phases */
  const ctx = { counter: new Set(), mirror: new Set(), used: { you: new Set(), foe: new Set() } };
  for (const who of ['you', 'foe']) {
    const kind = who === 'you' ? pending.youSpecial : pending.foeSpecial;
    if (!kind) continue;
    const cost = specialCost(next[who].hand, kind);
    if (!cost) throw new Error(`${cap(who)} cannot pay for ${SPELL_NAME[kind]}`);
    for (const id of cost.cards) {
      const i = next[who].hand.indexOf(id);
      if (i >= 0) next[who].hand.splice(i, 1);
      next.discard.push(id);
    }
    (kind === 'counter' ? ctx.counter : ctx.mirror).add(who);
    addLog(next, `${subj(who)} ${who === 'you' ? 'cast' : 'casts'} ${SPELL_NAME[kind]}, discarding ${cost.cards.map(cardName).join(' and ')}.`);
  }

  /* 3 — your casts, validated up front so nothing resolves half-done */
  if (!Array.isArray(plan) || plan.length !== pending.you.length) {
    throw new Error('choose a spell for each card you revealed');
  }
  const yourCasts = pending.you.map((id, i) => buildYourCasts(next, id, plan[i], ctx.used.you));

  /* 4 — haste: an extra mini-turn before the regular one */
  const rounds = [];
  const firstRound = [], mainRound = [];
  for (const who of ['you', 'foe']) {
    const cards = pending[who];
    const hasted = hasStatus(next, who, 'haste');
    if (hasted && cards.length) firstRound.push({ who, id: cards[0], index: 0 });
    for (let i = hasted ? 1 : 0; i < cards.length; i++) mainRound.push({ who, id: cards[i], index: i });
  }
  if (firstRound.length) {
    rounds.push(firstRound);
    const youH = firstRound.some((e) => e.who === 'you');
    const foeH = firstRound.some((e) => e.who === 'foe');
    const subject = youH && foeH ? 'Both mages are' : youH ? 'You are' : 'The rival is';
    addLog(next, `${subject} hasted — an extra play resolves first.`);
  }
  if (mainRound.length) rounds.push(mainRound);

  /* 5 — phases: Moons, then Wyrms, then Knots; highest card first */
  outer:
  for (const entries of rounds) {
    for (const phase of ACTIVATION) {
      const batch = [];
      for (const e of entries) {
        if (!activationsOf(e.id).includes(phase)) continue;
        if (e.who === 'you') {
          for (const c of yourCasts[e.index]) if (c.act === phase) batch.push(c);
        } else {
          batch.push(foeCast(next, e.id, phase, entries, ctx));
        }
      }
      if (!batch.length) continue;
      batch.sort((a, b) => b.rank - a.rank);                 // stable within ties
      let i = 0;
      while (i < batch.length) {
        let j = i;
        while (j < batch.length && batch[j].rank === batch[i].rank) j++;
        applyGroup(next, batch.slice(i, j), ctx);            // simultaneous batch
        if (next.over) break outer;
        i = j;
      }
    }
  }

  /* 6 — end of turn upkeep */
  next.pending = null;
  next.plan = null;
  if (!next.over) {
    for (const who of ['you', 'foe']) {
      const p = next[who];
      drawUpTo(next, who);
      while (p.seq.length > SEQ_KEEP) {
        const e = p.seq.shift();
        next.discard.push(e.id);
      }
      for (const s of p.status) {
        if (s.pending) s.pending = false;
        else s.turns -= 1;
      }
      p.status = p.status.filter((s) => s.turns > 0);
    }
    next.turn += 1;
    next.phase = 'choose';
    next.confused = null;
  } else {
    next.phase = null;
    next.confused = null;
  }
  return next;
}

/* ------------------------------------------------------------- confusion */

/**
 * Draw your confused play (attempt 1), or redraw once (attempt 2 — the
 * first card then goes to your hand if there is room, else the discard).
 * Returns a NEW state with state.confused = { card, redrawn }.
 */
export function confusedDraw(state, attempt) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'choose') throw new Error('cards are already revealed');
  if (!anyStatus(state, 'you', 'confusion')) throw new Error('you are not confused');
  if (attempt !== 1 && attempt !== 2) throw new Error('bad draw');
  if (attempt === 1) {
    if (state.confused) throw new Error('you have already drawn');
  } else if (!state.confused || state.confused.redrawn) {
    throw new Error('you have already redrawn once');
  }

  const next = structuredClone(state);
  const prev = next.confused ? next.confused.card : null;
  if (prev) {
    if (next.you.hand.length < HAND_MAX) next.you.hand.push(prev);
    else next.discard.push(prev);
  }
  let id = takeTop(next);
  if (id == null && next.you.hand.length) {
    const i = Math.floor(nextRand(next) * next.you.hand.length);
    id = next.you.hand.splice(i, 1)[0];
  }
  if (id == null) throw new Error('no cards left to draw');
  next.confused = { card: id, redrawn: attempt === 2 };
  addLog(next, attempt === 2
    ? `You redraw: the first card goes to ${next.you.hand.includes(prev) ? 'your hand' : 'the discard'}, you will play ${cardName(id)}.`
    : `Confused: you draw ${cardName(id)} at random.`);
  return next;
}

/* ------------------------------------------------------------- the default */

/**
 * A good default plan for your reveal: greedy per activation rune, picking
 * the option with the highest value (damage first, then sustain, control).
 */
export function bestPlan(state, cardIds) {
  const counts = visibleRunes(state, 'you');
  const used = new Set();
  return cardIds.map((id) => {
    const acts = activationsOf(id);
    return acts.map((act) => {
      let bestE = '', bestV = -Infinity;
      for (const e of energyOptions(counts, used)) {
        const info = castInfo(act, e, counts);
        let v = 0;
        if (info.spell === 'fire-ball' || info.spell === 'ice-bolt') {
          v = 3 * damageAfter(state, 'foe', DAMAGE_KIND[info.spell], info.amount);
        } else if (info.spell === 'drain') {
          v = 3 * damageAfter(state, 'foe', 'physical', info.amount)
            + (state.you.hp < state.you.maxHp ? info.amount : 0);
        } else if (info.spell === 'hit') {
          v = 3 * damageAfter(state, 'foe', 'physical', 1);
        } else if (info.spell === 'heal') {
          v = state.you.hp < state.you.maxHp
            ? 3 * Math.min(info.amount, state.you.maxHp - state.you.hp) : 0;
        } else if (info.spell === 'resist-cold' || info.spell === 'resist-heat' || info.spell === 'shield') {
          v = 1;
        } else if (info.spell === 'amnesia') {
          v = state.foe.seq.some((x) => !x.down) ? 2 : 0;
        } else if (info.spell === 'confusion') {
          v = anyStatus(state, 'foe', 'confusion') ? 0 : 1.5;
        } else {
          v = 1;                                                 // haste / invisibility
        }
        if (v > bestV) { bestV = v; bestE = e; }
      }
      if (bestE) used.add(bestE);
      return { act, energy: bestE };
    });
  });
}

/** One line for the UI, e.g. "Fire Ball ×2 → rival". */
export function describeCast(cast) {
  const info = castInfo(cast.act, cast.energy, { [cast.energy]: cast.amount });
  const amt = info.amount > 1 ? ` ×${info.amount}` : '';
  const to = info.target === 'self'
    ? (cast.caster === 'you' ? 'you' : 'rival')
    : (cast.caster === 'you' ? 'rival' : 'you');
  return `${info.name}${amt} → ${to}`;
}

export const OUTCOME = {
  won: { title: 'Victory', cls: 'win', text: 'The rival mage falls; you are the last wizard standing.' },
  lost: { title: 'You fall', cls: 'lose', text: 'Your rival\'s spell finishes you off.' },
  draw: { title: 'Draw', cls: '', text: 'Both mages fall at the same moment.' },
  stalemate: { title: 'No cards left', cls: '', text: 'Neither mage can play another card.' },
};

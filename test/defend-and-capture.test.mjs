// Headless tests for Defend and Capture: node test/defend-and-capture.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/defend-and-capture-core.js');
C.init(byId);

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } }

// The exact deck this game uses: the extended Decktet minus the Excuse (44).
const DECK44 = manifest.cards.map((c) => c.id).filter((id) => id !== 'the-excuse');
check(DECK44.length === 44, `the deck has ${DECK44.length} cards, want 44`);
const IN_DECK = new Set(DECK44);

/** Full-game conservation: all 44 cards exist exactly once. */
function conserved(state, label) {
  const all = C.allCards(state);
  if (all.length !== 44) { check(false, `${label}: ${all.length} cards on the table`); return; }
  if (new Set(all).size !== 44) check(false, `${label}: duplicate or missing card`);
  for (const id of all) if (!IN_DECK.has(id)) check(false, `${label}: ${id} is not in the 44-card deck`);
}

/** For hand-built boards: the move must neither create nor destroy a card. */
function sameCards(before, after, label) {
  const a = C.allCards(before).slice().sort().join('|');
  const b = C.allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
}

/** A hand-built table. Every field defaults to empty. */
function mk(over = {}) {
  return {
    seed: 1, reshuffles: 0,
    deck: [], discard: [],
    bg: Array(9).fill(null),
    defense: [null, null, null], side: [null, null, null],
    captured: [], damaged: [], hand: [],
    actions: 2, actionsTotal: 2,
    turn: 3, moves: 0, over: null, log: '',
    ...over,
  };
}

const card = (id) => byId[id];
const pick = (rank, suit) => DECK44.find((id) =>
  C.rankOf(id) === rank && (suit ? card(id).suits.includes(suit) : true));
const rankCards = (r) => DECK44.filter((id) => C.rankOf(id) === r);
const LOWS = DECK44.filter((id) => C.rankOf(id) <= 9);      // 24 cards ranked 1-9

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, DECK44);
  check(st.captured.length === 4, `seed ${seed}: captured ${st.captured.length}`);
  check(C.capturedTen(st) === 2, `seed ${seed}: captured has ${C.capturedTen(st)} Pawns/Courts, want 2`);
  check(C.capturedLow(st) === 2, `seed ${seed}: captured has ${C.capturedLow(st)} cards ranked 1-9, want 2`);
  check(st.bg.filter(Boolean).length === 3 && st.bg.slice(3).every((x) => x === null),
    `seed ${seed}: the first enemy phase should fill only the top row`);
  check(st.deck.length === 35, `seed ${seed}: deck ${st.deck.length}, want 44-4 captured-3 on the board-2 in hand`);
  check(st.hand.length === 2, `seed ${seed}: hand ${st.hand.length}, want the captured-low count 2`);
  check(st.actions === 2 && st.actionsTotal === 2, `seed ${seed}: actions ${st.actions}/${st.actionsTotal}`);
  check(st.turn === 1 && st.moves === 0 && st.over === null, `seed ${seed}: bad start flags`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.deck.length === st.deck.length && json.bg.length === 9, `seed ${seed}: JSON round trip`);
}

/* ---- rank rules: Pawns/Courts/Crowns are 10, Aces are 1 ---- */
{
  check(C.rankOf('the-bard') === 10 && C.rankOf('the-watchman') === 10 &&
    C.rankOf('the-window') === 10, 'Crowns, Pawns and Courts all count as 10');
  check(C.rankOf('ace-of-moons') === 1 && C.rankOf('the-author') === 2 &&
    C.rankOf('the-darkness') === 9, 'Aces 1 … 9 keep their numbers');
}

/* ---- the enemy attack, all three outcomes (hand-computed) ---- */
{
  // Bottom row: an Ace (1), a Crown (10) and a Pawn (10) attack.
  //   col 0: defense holds a 5        -> attacker discarded, no damage
  //   col 1: defense is empty         -> the Crown goes to Damaged (10)
  //   col 2: defense is a Court (10)  -> equal ranks: defender to Damaged (20)
  const st = mk({
    bg: [null, null, null, null, null, null,
      'ace-of-moons', 'the-bard', 'the-watchman'],
    defense: [pick(5), null, 'the-window'],
    deck: ['the-mountain', 'the-forest', 'the-soldier'],
  });
  const next = C.applyMove(st, { type: 'endTurn' });
  check(next.over === 'lost', `damage sum 20 ends the game: over=${next.over}`);
  check(next.damaged.join() === ['the-bard', 'the-window'].join(),
    `damaged area ${next.damaged.join()}, want the Crown then the Court`);
  check(C.damageSum(next) === 20, `damage sum ${C.damageSum(next)}, paper says 20`);
  check(next.discard.includes('ace-of-moons') && next.discard.includes('the-watchman'),
    'the losing attackers went to the Discard Pile');
  check(next.defense[0] === pick(5) && next.defense[2] === null,
    'the stronger defender survived, the tied defender was spent');
  sameCards(st, next, 'after the attack');
  check(st.over === null && st.damaged.length === 0, 'the original state was not mutated');

  // The phase stops the moment the loss trips: slot 2 is never attacked.
  //   9 + 10 = 19, then 29 -> the game ends before the third column.
  const early = mk({
    bg: [null, null, null, null, null, null, 'the-bard', 'the-bard', 'the-bard'],
    defense: [null, null, null],
    damaged: [pick(9)],
  });
  const after = C.applyMove(early, { type: 'endTurn' });
  check(after.over === 'lost' && after.damaged.length === 3,
    'the phase stops as soon as the damage sum reaches 20');
  check(after.bg[8] === 'the-bard', 'the third attacker never got to attack');
  sameCards(early, after, 'early stop');
}

/* ---- advance + reinforce move every card down and refill the top ---- */
{
  const st = mk({
    bg: ['the-castle', null, null, 'the-cave', null, null, null, null, null],
    deck: ['the-mill', 'the-desert', 'the-pact'],
    discard: ['the-journey'],
  });
  const next = C.applyMove(st, { type: 'endTurn' });
  check(next.bg.join() === ['the-mill', 'the-desert', 'the-pact',
    'the-castle', null, null, 'the-cave', null, null].join(),
    `advance+reinforce gave ${next.bg.join()}`);
  check(next.deck.length === 0 && next.discard.length === 1, 'three cards drawn');
  check(next.turn === 4, `turn advanced to ${next.turn}`);
  sameCards(st, next, 'advance+reinforce');
}

/* ---- hasten: 8+ captured repeats the whole enemy phase ---- */
{
  const captured8 = rankCards(2).concat(rankCards(4)).concat(rankCards(6)).slice(0, 8);
  check(captured8.length === 8, `fixture has ${captured8.length} captured cards`);
  const attackers = ['the-discovery', 'the-forest', 'the-soldier'];   // three rank-5 enemies
  const st = mk({
    captured: captured8,
    bg: [null, null, null, ...attackers, null, null, null],
    deck: DECK44.filter((id) => !captured8.includes(id) && !attackers.includes(id)).slice(0, 6),
  });
  const next = C.applyMove(st, { type: 'endTurn' });
  check(next.damaged.length === 3, `hasten attack hit ${next.damaged.length} cards (the advanced row)`);
  check(C.damageSum(next) === 15, `damage ${C.damageSum(next)}, paper says 3 x rank 5 = 15`);
  check(next.deck.length === 0, 'six cards were drawn: 3 + 3');
  check(next.bg.slice(0, 6).every(Boolean) && next.bg.slice(6).every((x) => x === null),
    'the second pass left the top two rows full and the bottom row empty');
  sameCards(st, next, 'hasten');
}

/* ---- reshuffle: the discard pile becomes a new deck, deterministically ---- */
{
  const pile6 = ['the-journey', 'the-battle', 'the-pact', 'the-betrayal', 'the-cave', 'the-mill'];
  const st = mk({ discard: pile6, hand: [] });
  const a = C.applyMove(st, { type: 'endTurn' });
  check(a.reshuffles === 1 && a.discard.length === 0, 'the discard pile was reshuffled');
  check(a.deck.length === 3, 'three of the six reshuffled cards remain after the reinforce');
  check(a.bg.slice(0, 3).every(Boolean), 'the new deck refilled the top row');
  sameCards(st, a, 'reshuffle');
  const b = C.applyMove(mk({ discard: pile6, hand: [] }), { type: 'endTurn' });
  check(b.deck.join() === a.deck.join(), 'reshuffling is deterministic for a given state');

  // Both piles empty: draws are skipped, nothing crashes.
  const dry = C.applyMove(mk({ hand: [] }), { type: 'endTurn' });
  check(dry.deck.length === 0 && dry.discard.length === 0 && dry.over === null,
    'an empty deck and discard pile just skips draws');
  sameCards(mk({ hand: [] }), dry, 'dry draw');
}

/* ---- the draw step refills the hand to the captured-low count ---- */
{
  const st = mk({
    captured: [pick(2), pick(3), 'the-bard', 'the-window'],   // hand target 2, actions 2
    hand: [pick(7)],
    deck: [pick(8), pick(9), 'the-battle', 'the-discovery', 'the-lunatic'],
  });
  const next = C.applyMove(st, { type: 'endTurn' });
  check(next.hand.length === 2, `hand refilled to ${next.hand.length}, want 2`);
  check(next.actions === 2 && next.actionsTotal === 2,
    'actions are the number of captured Pawns/Courts/Crowns');
  check(next.deck.length === 1, 'one card left in the deck after 3+1 draws');
  sameCards(st, next, 'draw step');

  // Already at (or above) the target: no draw.
  const full = mk({
    captured: [pick(2), pick(3)],
    hand: [pick(7), pick(8), pick(9)],
    deck: ['the-battle'],
  });
  const afterFull = C.applyMove(full, { type: 'endTurn' });
  check(afterFull.hand.length === 3, 'a hand already at the target draws nothing');
}

/* ---- Play ---- */
{
  const st = mk({ hand: [pick(4), pick(6)], defense: [pick(9), null, null] });
  const next = C.applyMove(st, { type: 'play', hand: 0, area: 'defense', slot: 1 });
  check(next.defense[1] === pick(4) && next.defense[0] === pick(9), 'the card landed in the slot');
  check(next.hand.join() === [pick(6)].join(), 'the hand card was played');
  check(next.actions === 1, `actions ${next.actions}, want 1`);
  check(next.discard.length === 0, 'an empty slot replaces nothing');

  // Replacing: the old card goes to the Discard Pile.
  const rep = C.applyMove(next, { type: 'play', hand: 0, area: 'defense', slot: 0 });
  check(rep.defense[0] === pick(6) && rep.discard.join() === [pick(9)].join(),
    'the replaced card was discarded');
  check(rep.hand.length === 0 && rep.actions === 0, 'hand empty, actions spent');
  sameCards(next, rep, 'replace');

  // Illegal plays (with actions left).
  const fresh = mk({ hand: [pick(4)] });
  for (const bad of [
    { type: 'play', hand: 5, area: 'defense', slot: 0 },   // no such hand card
    { type: 'play', hand: 0, area: 'bg', slot: 0 },        // wrong area
    { type: 'play', hand: 0, area: 'defense', slot: 7 },   // bad slot
    { type: 'play', hand: 0, area: null, slot: 0 },        // no area
  ]) {
    let threw = false;
    try { C.applyMove(fresh, bad); } catch { threw = true; }
    check(threw, `illegal play ${JSON.stringify(bad)} throws`);
  }
  let spentThrew = false;
  try { C.applyMove(rep, { type: 'play', hand: 0, area: 'defense', slot: 0 }); } catch { spentThrew = true; }
  check(spentThrew, 'playing with no actions left throws');
  check(C.applyMove(mk({ hand: [pick(4)] }), { type: 'play', hand: 0, area: 'side', slot: 2 })
    .side[2] === pick(4), 'play into the side column works too');
}

/* ---- Counterattack: every branch, hand-computed ---- */
{
  // Defense column 0: the Mill (8, waves+leaves). Side rows hold the Origin
  // (2, waves+leaves), the Desert (2, suns+daemons) and the Forest
  // (5, moons+leaves).
  //   bg[0] the Market (6, leaves+crowns) -> both guards share leaves: 10 > 6 -> destroyed
  //   bg[3] the Bard (10, suns)           -> the Mill shares no suit: nothing
  //   bg[6] the Calamity (10, daemons)    -> the Mill shares no suit: nothing
  const st = mk({
    defense: ['the-mill', null, null],
    side: ['the-origin', 'the-desert', 'the-forest'],
    bg: ['the-market', null, null, 'the-bard', null, null, 'the-calamity', null, null],
  });
  const next = C.applyMove(st, { type: 'counter', area: 'defense', slot: 0 });
  check(next.discard.includes('the-market'), 'the Market was destroyed (sum 10 > rank 6)');
  check(next.bg[0] === null, 'the destroyed slot is now empty');
  check(next.bg[3] === 'the-bard' && next.bg[6] === 'the-calamity',
    'enemies sharing no suit with the guard cards are untouched');
  check(next.actions === 1 && next.moves === 1, 'the counterattack cost one action');
  sameCards(st, next, 'counterattack');

  // Equality captures: the Mill (8) + the Origin (2) = 10 exactly matches
  // the Crown of Leaves, which shares leaves with both guards.
  const cap = mk({
    defense: ['the-mill', null, null],
    side: ['the-origin', null, null],
    bg: ['the-end', null, null, null, null, null, null, null, null],
  });
  const capped = C.applyMove(cap, { type: 'counter', area: 'defense', slot: 0 });
  check(capped.captured.join() === ['the-end'].join(),
    'rank sum equal to the enemy rank captures it alive');
  check(capped.bg[0] === null, 'the captured enemy left the battleground');

  // Missing side card -> nothing happens (the wiki's case 1).
  const noSide = mk({
    defense: ['the-mill', null, null], side: [null, null, null],
    bg: ['the-market', null, null, null, null, null, null, null, null],
  });
  const none = C.applyMove(noSide, { type: 'counter', area: 'defense', slot: 0 });
  check(none.bg[0] === 'the-market' && none.captured.length === 0 && none.discard.length === 0,
    'no side card means nothing happens');

  // Sum less than the enemy rank -> nothing (case 4): the Cave (7,
  // waves+daemons) + the Ace of Waves (1) = 8 against the Darkness
  // (9, waves+daemons) — both guards share a suit, but the sum is too low.
  const weak = mk({
    defense: ['the-cave', null, null], side: ['ace-of-waves', null, null],
    bg: ['the-darkness', null, null, null, null, null, null, null, null],
  });
  const w = C.applyMove(weak, { type: 'counter', area: 'defense', slot: 0 });
  check(w.bg[0] === 'the-darkness', 'a weak sum leaves the enemy in place');

  // Counterattack from the side affects a whole row:
  // the Castle (7, suns+crowns) + the Origin (2, waves+leaves) = 9.
  //   bg[0] the Market (6, leaves+crowns) -> shares with both guards: 9 > 6 -> destroyed
  //   bg[1] the Bard  (10, suns)          -> the Journey shares no suit: nothing
  //   bg[2] no defense card                -> nothing
  const row = mk({
    defense: ['the-castle', 'the-journey', null],
    side: ['the-origin', null, null],
    bg: ['the-market', 'the-bard', null, null, null, null, null, null, null],
  });
  const r = C.applyMove(row, { type: 'counter', area: 'side', slot: 0 });
  check(r.bg[0] === null && r.discard.includes('the-market'),
    'the side counterattack hit the row (sum 9 > rank 6)');
  check(r.bg[1] === 'the-bard', 'the Bard shares no suit with the guards');

  // Illegal counters.
  const empty = mk({});
  for (const bad of [
    { type: 'counter', area: 'defense', slot: 0 },     // empty slot
    { type: 'counter', area: 'side', slot: 2 },        // empty slot
    { type: 'counter', area: 'bg', slot: 0 },          // wrong area
  ]) {
    let threw = false;
    try { C.applyMove(empty, bad); } catch { threw = true; }
    check(threw, `illegal counterattack ${JSON.stringify(bad)} throws`);
  }
  const spent = mk({
    actions: 0, hand: [pick(4)],
    defense: ['the-mill', null, null], side: ['the-origin', null, null],
    bg: ['the-market', null, null, null, null, null, null, null, null],
  });
  let threw = false;
  try { C.applyMove(spent, { type: 'counter', area: 'defense', slot: 0 }); } catch { threw = true; }
  check(threw, 'counterattacking with no actions left throws');
}

/* ---- Interchange ---- */
{
  const st = mk({ hand: [pick(4)], captured: ['the-bard', pick(2)] });
  const next = C.applyMove(st, { type: 'interchange', hand: 0, index: 0 });
  check(next.hand.join() === ['the-bard'].join() && next.captured[0] === pick(4),
    'the hand card and the captured card swapped');
  check(next.actions === 1, 'interchange costs an action');
  check(C.capturedTen(next) === 0 && C.capturedLow(next) === 2,
    'the swap changes both the hand-size target and the action budget');
  sameCards(st, next, 'interchange');
  let threw = false;
  try { C.applyMove(st, { type: 'interchange', hand: 0, index: 9 }); } catch { threw = true; }
  check(threw, 'interchanging with a non-existent captured card throws');
}

/* ---- Sacrifice ---- */
{
  const st = mk({ hand: [pick(10), pick(3)], damaged: [pick(5), pick(9)] });
  const next = C.applyMove(st, { type: 'sacrifice', hand: 0, index: 0 });
  check(next.damaged[0] === pick(10) && next.hand[0] === pick(5),
    'the higher hand card swapped for the lower damaged card');
  check(C.damageSum(next) === 19, `damage sum ${C.damageSum(next)}, paper says 10+9=19`);
  check(next.actions === 1, 'sacrifice costs an action');
  sameCards(st, next, 'sacrifice');

  // Lesser rank, strictly: equal ranks are refused with an explanation.
  for (const [h, d] of [[1, 1], [1, 0]]) {          // rank 3 vs 9, then vs 5
    let err = null;
    try { C.applyMove(st, { type: 'sacrifice', hand: h, index: d }); } catch (e) { err = e; }
    check(err && /lesser rank/.test(err.message),
      `sacrifice ${h}->${d} should be refused with a helpful message`);
  }

  // A sacrifice can push the damage over the edge: 9 + two Crowns.
  const lethal = mk({ hand: ['the-bard'], damaged: [pick(9), 'the-calamity'] });
  const dead = C.applyMove(lethal, { type: 'sacrifice', hand: 0, index: 0 });
  check(dead.over === 'lost' && C.damageSum(dead) === 20, 'a sacrifice can lose the game');
}

/* ---- Withdraw ---- */
{
  const st = mk({ side: [null, 'the-window', null] });
  const next = C.applyMove(st, { type: 'withdraw', area: 'side', slot: 1 });
  check(next.side[1] === null && next.hand.join() === ['the-window'].join(),
    'the card came back to hand');
  let threw = false;
  try { C.applyMove(st, { type: 'withdraw', area: 'side', slot: 0 }); } catch { threw = true; }
  check(threw, 'withdrawing from an empty slot throws');
}

/* ---- Discard ---- */
{
  const st = mk({ hand: [pick(2), pick(4), pick(6)] });
  const next = C.applyMove(st, { type: 'discard', hand: [0, 2] });
  check(next.hand.join() === [pick(4)].join(), 'the selected cards were discarded');
  check(next.discard.includes(pick(2)) && next.discard.includes(pick(6)), 'into the discard pile');
  check(next.actions === 2, 'discarding costs no actions');
  let threw = false;
  try { C.applyMove(st, { type: 'discard', hand: [] }); } catch { threw = true; }
  check(threw, 'discarding nothing throws');
  threw = false;
  try { C.applyMove(st, { type: 'discard', hand: [7] }); } catch { threw = true; }
  check(threw, 'discarding a non-existent card throws');
}

/* ---- winning: 12 captured ends the game at once ---- */
{
  const before = LOWS.slice(0, 11);
  check(before.length === 11, `fixture has ${before.length} captured cards`);
  const st = mk({
    captured: before,
    defense: ['the-mill', null, null], side: ['the-origin', null, null],
    bg: ['the-end', null, null, null, null, null, null, null, null],
  });
  const next = C.applyMove(st, { type: 'counter', area: 'defense', slot: 0 });
  check(next.over === 'won', `capturing the 12th card wins: over=${next.over}`);
  check(next.captured.length === 12, `captured ${next.captured.length}, want 12`);
  sameCards(st, next, 'won state');

  // Win beats loss when both trip at once.
  const both = mk({ captured: LOWS.slice(0, 12), damaged: ['the-bard', 'the-calamity'] });
  C.settle(both);
  check(both.over === 'won', 'the win is checked before the loss');

  // Playing on after the end throws.
  let threw = false;
  try { C.applyMove(next, { type: 'endTurn' }); } catch { threw = true; }
  check(threw, 'acting after the game is over throws');
}

/* ---- no actions left: only discarding and ending the turn are legal ---- */
{
  const st = mk({ actions: 0, hand: [pick(4)], defense: [pick(9), null, null] });
  const types = new Set(C.legalActions(st).map((a) => a.type));
  check(!types.has('play') && !types.has('counter') && !types.has('withdraw'),
    'with no actions only discard and endTurn remain');
  check(types.has('discard') && types.has('endTurn'), 'discard and endTurn are always legal');
}

/* ---- full random playouts ----
 *
 * A purely random player would occasionally park rank-10 defenders in every
 * column and stall forever (a rank-10 defender can never be beaten), so this
 * player withdraws defenders fairly often to open the gates; damage then
 * always flows and every game ends. */
let won = 0, lost = 0, totalTurns = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, DECK44);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 600) {
    const actions = C.legalActions(st).filter((a) => a.type !== 'endTurn');
    const counters = actions.filter((a) => a.type === 'counter');
    const plays = actions.filter((a) => a.type === 'play');
    const withdraws = actions.filter((a) => a.type === 'withdraw');
    const rand = (arr) => arr[Math.floor(rng() * arr.length)];
    const roll = rng();
    let action = null;
    if (counters.length && roll < 0.35) action = rand(counters);
    else if (plays.length && roll < 0.7) {
      // Prefer plugging an empty Defense slot: it keeps the damage out.
      const emptyDef = plays.filter((a) => a.area === 'defense' && !st.defense[a.slot]);
      action = rand(emptyDef.length ? emptyDef : plays);
    } else if (withdraws.length && roll < 0.85) action = rand(withdraws);
    else if (actions.length && roll < 0.95) action = rand(actions);
    st = C.applyMove(st, action || { type: 'endTurn' });
    conserved(st, `seed ${seed} move ${st.moves}`);
  }
  check(!!st.over, `seed ${seed}: game never ended (guard ${guard})`);
  if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else check(false, `seed ${seed}: unknown over=${st.over}`);
  // Independent expectation: a win means 12 captured, a loss means 20 damage.
  if (st.over === 'won') check(st.captured.length >= 12, `seed ${seed}: won with ${st.captured.length} captured`);
  if (st.over === 'lost') {
    check(C.damageSum(st) >= 20, `seed ${seed}: lost at damage ${C.damageSum(st)}`);
    check(st.captured.length < 12, `seed ${seed}: lost with ${st.captured.length} captured`);
  }
  const json = JSON.parse(JSON.stringify(st));
  check(json.captured.length === st.captured.length, `seed ${seed}: JSON round trip`);
  totalTurns += st.turn;
}
console.log(`random playouts: ${won} won, ${lost} lost, ` +
  `average ${(totalTurns / 300).toFixed(1)} turns`);

console.log(failures === 0
  ? 'defend-and-capture: all tests passed'
  : `defend-and-capture: ${failures} failures`);
process.exit(failures ? 1 : 0);

// Headless tests for Hexaract: node test/hexaract.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/hexaract-core.js');
C.init(byId);

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } }

/** For hand-built boards: the action must neither create nor destroy a card. */
function sameCards(before, after, label) {
  const a = C.allCards(before).slice().sort().join('|');
  const b = C.allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
}

// The deck this game uses: the basic 36 (the wiki never says; see the rules page).
const BASIC = manifest.basicDeck;
check(BASIC.length === 36, `the deck has ${BASIC.length} cards, want 36`);
const IN_BASIC = new Set(BASIC);

function conserved(state, label) {
  const all = C.allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards in play`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
  for (const id of all) if (!IN_BASIC.has(id)) check(false, `${label}: ${id} is not in the basic deck`);
}

const zero = () => Object.fromEntries(C.SUITS.map((s) => [s, 0]));
function mk(over = {}) {
  return {
    seed: 1, rolls: 0, deck: [],
    journey: [null, null, null],
    discard: [],
    acesReserve: [], acesDiscarded: [],
    supply: zero(), harm: 0, dice: [],
    spentThisTurn: false, turn: 1, moves: 0, over: null, log: '',
    ...over,
  };
}
const slot = (id, over = {}) => ({ id, tokens: [], exhausted: false, arrived: 1, ...over });
const handThrows = (fn, re, msg) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  check(err && (!re || re.test(err.message)), `${msg} (got: ${err && err.message})`);
};

/* ---- card types: 11 personalities, 11 locations, 11 events; duals are locations ---- */
{
  const counts = { personality: 0, location: 0, event: 0 };
  for (const id of BASIC) {
    if (C.rankOf(id) === 1) continue;                    // aces have no type
    const t = C.typeOf(id);
    check(!!t, `${id} has no type`);
    counts[t]++;
  }
  check(counts.personality === 11 && counts.location === 11 && counts.event === 8,
    `basic-deck types ${JSON.stringify(counts)}, want 11+11+8 = 30 (the three dual cards count as locations)`);
  for (const id of ['the-origin', 'the-market', 'the-end']) {
    check(C.typeOf(id) === 'location', `${id} must resolve as a location`);
  }
  check(C.rankOf('the-bard') === 10 && C.rankOf('the-author') === 2 && C.rankOf('ace-of-moons') === 1,
    'Crowns count 10, Aces 1');
  check(C.neededTokens('the-sea') === 1 && C.neededTokens('the-origin') === 2,
    'a location needs one token per suit it shows');
}

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.acesDiscarded.length === 3 && st.acesReserve.length === 3,
    `seed ${seed}: aces split ${st.acesDiscarded.length}/${st.acesReserve.length}, want 3/3`);
  for (const id of st.acesDiscarded) check(C.rankOf(id) === 1, `seed ${seed}: ${id} is not an Ace`);
  const supplySum = C.supplyTotal(st);
  check(supplySum === 3, `seed ${seed}: supply ${supplySum} tokens, want 3`);
  for (const id of st.acesDiscarded) {
    const s = byId[id].suits[0];
    check(st.supply[s] >= 1, `seed ${seed}: the flipped ${id} should grant a ${s} token`);
  }
  check(st.journey.length === 3 && st.journey.every((s) => s && C.rankOf(s.id) >= 2),
    `seed ${seed}: the journey holds three non-Ace cards`);
  const ids = st.journey.map((s) => s.id);
  check(new Set(ids).size === 3, `seed ${seed}: duplicate journey card`);
  check(st.journey.every((s) => s.arrived === 1 && !s.exhausted && s.tokens.length === 0),
    `seed ${seed}: fresh journey slots`);
  check(st.deck.length === 27, `seed ${seed}: deck ${st.deck.length}, want 36-6-3=27`);
  check(st.dice.length === 0 && st.harm === 0 && st.turn === 1 && st.over === null,
    `seed ${seed}: bad start flags`);
  check(st.discard.length === 0, `seed ${seed}: the discard starts empty`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.deck.length === 27 && json.journey.length === 3, `seed ${seed}: JSON round trip`);
}

/* ---- dice: reproducible seeded rolls, kept in state ---- */
{
  const rollsOf = (seed, times) => {
    let st = C.newGame(seed, BASIC);
    const out = [];
    for (let i = 0; i < times; i++) {
      st = { ...st, rolls: i, dice: [] };              // pretend it is turn i+1
      st = C.rollDice(st);
      check(st.dice.length === 5 && st.dice.every((v) => v >= 1 && v <= 6),
        `seed ${seed}: bad roll ${st.dice.join()}`);
      out.push(st.dice.join());
    }
    return out;
  };
  const a = rollsOf(42, 6);
  const b = rollsOf(42, 6);
  check(a.join('|') === b.join('|'), `a seeded roll sequence must be reproducible: ${a} vs ${b}`);
  const others = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => rollsOf(s, 1)[0]));
  check(others.size > 1, 'different seeds should roll different dice');

  // A state restored from JSON rolls on exactly where it left off.
  const mid = { ...C.newGame(7, BASIC), rolls: 3, dice: [] };
  const restored = JSON.parse(JSON.stringify(mid));
  check(C.rollDice(mid).dice.join() === C.rollDice(restored).dice.join(),
    'a reloaded game rolls the same dice');

  const st = C.rollDice(C.newGame(9, BASIC));
  handThrows(() => C.rollDice(st), /already rolled/, 'rolling twice in one turn throws');
  handThrows(() => C.rollDice(mk({ over: 'lost' })), /over/, 'rolling after the end throws');
  check(st.moves === 1, 'the roll counts as a move');
}

/* ---- couplets and wild sixes ---- */
{
  const fits = C.coupletFits;
  check(fits(5, 5, 10) && !fits(5, 5, 9), '[5,5] only sums to 10');
  check(fits(6, 5, 6) && fits(6, 5, 10) && !fits(6, 5, 5), '[6(wild),5] covers 6..10');
  check(fits(1, 1, 2) && !fits(1, 1, 3), '[1,1] only sums to 2');
  for (let r = 2; r <= 10; r++) check(fits(6, 6, r), `[6,6] should cover rank ${r}`);
  check(fits(3, 4, 7) && !fits(3, 4, 8), '[3,4] only sums to 7');
  const w = C.resolveWilds;
  check(w(5, 5, 10).join() === '5,5', 'no wilds needed for 5+5');
  check(w(6, 4, 9).join() === '5,4', 'the 6 counts as 5');
  check(w(6, 6, 5).join() === '4,1', 'both sixes count (canonical pick)');
  check(w(2, 3, 9) === null, 'an impossible sum resolves to null');
}

/* ---- assign: personalities and events ---- */
{
  // Thwart a rank-8 personality (the Diplomat, moons+suns).
  const st = mk({
    journey: [slot('the-diplomat'), null, null],
    dice: [4, 4, 1, 2, 3],
  });
  const next = C.applyAssign(st, 0, 0, 1, 'suns');
  check(next.journey[0] === null, 'the thwarted personality left the journey');
  check(next.discard.join() === ['the-diplomat'].join(), 'it was discarded');
  check(next.supply.suns === 1 && C.supplyTotal(next) === 1, 'one suns token gained');
  check(next.dice.join() === '1,2,3', 'the two assigned dice were consumed');
  check(next.moves === 1 && /thwart/.test(next.log), 'the log says what happened');
  check(st.journey[0] && st.dice.length === 5, 'the original state was not mutated');

  // An event resolves the same way.
  const ev = mk({ journey: [slot('the-battle'), null, null], dice: [2, 2, 5, 6, 6] });
  const afterEv = C.applyAssign(ev, 0, 0, 1, 'daemons');
  check(afterEv.journey[0] === null && afterEv.supply.daemons === 1,
    'turning the tables on the Battle yields a daemons token');

  // A crown personality with the ace bonus: two tokens, one ace spent.
  const cr = mk({
    journey: [slot('the-huntress'), null, null],          // Crown of Moons
    dice: [5, 5, 1, 2, 3],
    acesReserve: ['ace-of-waves', 'ace-of-suns', 'ace-of-leaves'],
  });
  const bonus = C.applyAssign(cr, 0, 0, 1, 'moons', 1);
  check(bonus.supply.moons === 2, 'the crown bonus is a second matching token');
  check(bonus.acesReserve.join() === ['ace-of-waves', 'ace-of-leaves'].join(),
    'the spent Ace left the face-up row');
  check(bonus.acesDiscarded.length === 1, 'the spent Ace was discarded');
  handThrows(() => C.applyAssign(cr, 0, 0, 1, 'moons', 3), /no face-up Ace/,
    'asking for a fourth ace bonus throws');

  // Illegal assignments.
  handThrows(() => C.applyAssign(st, 0, 0, 0, 'suns'), /bad dice/, 'the same die twice throws');
  handThrows(() => C.applyAssign(st, 0, 0, 4, 'suns'), /cannot sum/, '2+3 cannot make 8');
  handThrows(() => C.applyAssign(st, 0, 0, 1, 'waves'), /shows no/, 'wrong suit throws');
  handThrows(() => C.applyAssign(st, 1, 0, 1, 'suns'), /empty/, 'an empty slot throws');
  handThrows(() => C.applyAssign(mk({ dice: [] }), 0, 0, 1, 'suns'), /Roll/,
    'assigning before rolling throws');
}

/* ---- assign: locations ---- */
{
  // A single-suit crown location (the Sea): one token completes it.
  const sea = mk({
    journey: [slot('the-sea'), null, null],
    dice: [5, 5, 1, 2, 3],
    acesReserve: ['ace-of-moons'],
  });
  const done = C.applyAssign(sea, 0, 0, 1, 'waves', 0);
  check(done.journey[0] === null, 'the Sea was traversed with its one token');
  check(done.discard.join() === ['the-sea'].join(), 'the traversed card was discarded');
  check(done.supply.waves === 1, 'the crown-location ace bonus lands in the supply');
  check(C.supplyTotal(done) === 1, 'the token placed on the card is discarded with it');

  // A two-suit location takes two tokens; both couplets may be used in one turn.
  const origin = mk({
    journey: [slot('the-origin'), null, null],
    dice: [1, 1, 1, 1, 5],                               // two couplets of 1+1
  });
  const half = C.applyAssign(origin, 0, 0, 1, 'waves');
  check(half.journey[0] && half.journey[0].tokens.join() === 'waves',
    'one couplet puts one token on the location');
  const full = C.applyAssign(half, 0, 0, 1, 'leaves');
  check(full.journey[0] === null, 'the second token completes the Origin');
  check(C.supplyTotal(full) === 0, 'survey tokens are spent, not banked');
  sameCards(origin, full, 'a completed location');
}

/* ---- spend from your supply onto a location ---- */
{
  const st = mk({
    journey: [slot('the-mill', { arrived: 1 }), slot('the-battle'), null],
    supply: { ...zero(), waves: 2, leaves: 1 },
    turn: 2,                                              // the Mill arrived in turn 1
  });
  check(C.legalSpends(st).some((x) => x.slot === 0 && x.suit === 'waves'),
    'legalSpends offers the Mill with matching supply');
  check(!C.legalSpends(st).some((x) => x.slot === 1), 'an event cannot take resources');
  const spent = C.applySpend(st, 0, 'waves');
  check(spent.supply.waves === 1 && spent.journey[0].tokens.join() === 'waves',
    'the token moved from supply to card');
  check(spent.spentThisTurn, 'one spend per turn');
  handThrows(() => C.applySpend(spent, 0, 'leaves'), /only one resource/,
    'a second spend in the same turn throws');
  handThrows(() => C.applySpend(st, 1, 'waves'), /only a location/, 'spending on an event throws');
  handThrows(() => C.applySpend(st, 0, 'daemons'), /shows no/, 'spending a foreign suit throws');
  handThrows(() => C.applySpend(st, 0, 'suns'), /no suns/, 'spending what you do not have throws');

  // Spending the last needed token completes the location.
  const near = mk({
    journey: [slot('the-origin', { tokens: ['waves'] })],
    supply: { ...zero(), leaves: 1 },
  });
  const closed = C.applySpend(near, 0, 'leaves');
  check(closed.journey[0] === null && C.supplyTotal(closed) === 0,
    'the last supply token can finish a survey');
}

/* ---- end of turn: consequences of inaction (hand-computed) ---- */
{
  // Turn 3: an unresolved personality, an exhausted location and a current
  // event whose suits are daemons+crowns.  Supply holds 2 daemons, 1 moons.
  //   harm: +1 (personality) +1 (exhausted location) = 2 -> 5 total
  //   event: discards the daemons token (2 copies > 0 crowns)
  //   then: event rotates to exhausted, replenish fills the two vacancies.
  const st = mk({
    journey: [
      slot('the-soldier'),
      slot('the-castle', { exhausted: true }),
      slot('the-battle'),
    ],
    supply: { ...zero(), daemons: 2, moons: 1 },
    harm: 3, turn: 3,
    deck: ['the-desert', 'the-mountain'],
    dice: [3, 3, 2, 5, 6], spentThisTurn: true,
  });
  const next = C.endTurn(st);
  check(next.harm === 5, `harm ${next.harm}, paper says 3+1+1=5`);
  check(next.supply.daemons === 1 && next.supply.moons === 1,
    'the event cost one daemons token');
  check(C.typeOf(next.journey[2].id) === 'event' && next.journey[2].exhausted,
    'the current event rotated to exhausted');
  check(!next.journey[0].exhausted && C.typeOf(next.journey[0].id) === 'personality',
    'personalities never rotate');
  check(next.journey[1].exhausted, 'the exhausted location stays');
  check(next.journey.filter(Boolean).length === 3 && next.deck.length === 2,
    'the event rotates rather than leaves, so nothing was drawn');
  check(next.turn === 4 && next.dice.length === 0 && !next.spentThisTurn,
    'the new turn starts with fresh dice and a fresh spend');
  check(next.journey[0].arrived === 1 && next.journey[1].arrived === 1,
    'the survivors keep their arrival turn');
  check(st.harm === 3 && st.deck.length === 2, 'the original state was not mutated');

  // Replenish: vacancies draw from the deck and arrive in the ending turn.
  const refill = mk({ journey: [null, slot('the-desert'), null], deck: ['the-mill', 'the-cave'], turn: 2 });
  const filled = C.endTurn(refill);
  check(filled.deck.length === 0 && filled.journey.every(Boolean),
    'replenish fills the vacancies');
  check(filled.journey[0].id === 'the-mill' && filled.journey[2].id === 'the-cave',
    'left to right from the deck');
  check(filled.journey[0].arrived === 2 && filled.journey[2].arrived === 2,
    'new cards arrived in the turn that drew them');
  check(filled.journey[1].exhausted && !filled.journey[0].exhausted,
    'the Desert tires at the end of turn 2; the fresh cards are still fresh');

  // An event with no matching supply does nothing.
  const dry = mk({ journey: [slot('the-battle')], supply: zero(), harm: 1 });
  const dryNext = C.endTurn(dry);
  check(dryNext.harm === 1 && C.supplyTotal(dryNext) === 0,
    'no matching resource means no effect');
  check(dryNext.journey[0].exhausted, 'the event still rotates');

  // An exhausted event is discarded after its second consequence.
  const twice = mk({ journey: [slot('the-battle', { exhausted: true, arrived: 1 })], harm: 0 });
  const twiceNext = C.endTurn(twice);
  check(twiceNext.journey[0] === null && twiceNext.discard.join() === ['the-battle'].join(),
    'the spent event left the journey and was discarded');

  // Location exhaustion timing: initial locations tire at the end of turn 2,
  // replenished ones at the end of the turn after they arrive.
  const grace = mk({ journey: [slot('the-mountain'), slot('the-forest', { arrived: 4 })] });
  const t1 = C.endTurn({ ...grace, turn: 1 });
  check(!t1.journey[0].exhausted, 'an initial location is not weary the turn it arrives');
  const t2 = C.endTurn({ ...grace, turn: 2 });
  check(t2.journey[0].exhausted, 'an initial location tires at the end of turn 2');
  check(!t2.journey[1].exhausted, 'the Forest arrived in turn 4, so it is fresh at the end of turn 2');
  const t5 = C.endTurn({ ...grace, turn: 5 });
  check(t5.journey[1].exhausted, 'a replenished location tires at the end of the next turn');
}

/* ---- harm at 10 ends the game at once ---- */
{
  const st = mk({
    journey: [slot('the-soldier'), slot('the-savage'), slot('the-lunatic')],
    harm: 8, deck: ['the-desert'],
  });
  const next = C.endTurn(st);
  check(next.over === 'lost' && next.harm === 11,
    `three personalities end it: harm ${next.harm}, over ${next.over}`);
  check(next.deck.length === 1 && next.journey.filter(Boolean).length === 3,
    'a lost game stops before replenish');
  handThrows(() => C.endTurn(next), /over/, 'ending the turn after the end throws');
}

/* ---- the end of the deck decides by your supply ---- */
{
  const full = zero();
  for (const s of C.SUITS) full[s] = 1;
  const wonSt = mk({ supply: full, deck: [], journey: [null, null, null] });
  C.settle(wonSt);
  check(wonSt.over === 'won', 'empty deck, clear journey, all six suits: won');

  const lostSt = mk({ supply: { ...full, waves: 0 }, deck: [], journey: [null, null, null] });
  C.settle(lostSt);
  check(lostSt.over === 'lost', 'missing one suit: lost');

  // Harm is checked before the win.
  const both = mk({ supply: full, deck: [], journey: [null, null, null], harm: 10 });
  C.settle(both);
  check(both.over === 'lost', '10 harm loses even with the artifact complete');

  // A non-empty deck or journey means the adventure continues.
  const going = mk({ supply: full, deck: ['the-desert'], journey: [null, null, null] });
  C.settle(going);
  check(going.over === null, 'cards left in the deck: play on');

  // An endTurn that empties the journey wins in one move.
  const last = mk({
    journey: [slot('the-windfall'), null, null],      // a Crown event, crowns token
    supply: { ...full, crowns: 2 }, deck: [], dice: [5, 5, 1, 2, 3], harm: 3,
  });
  const finished = C.applyAssign(last, 0, 0, 1, 'crowns');
  check(finished.over === 'won', `resolving the last card with all six suits wins: ${finished.over}`);
}

/* ---- legal couplets, enumerated ---- */
{
  const st = mk({
    journey: [slot('the-author'), slot('the-battle'), slot('the-castle')],  // ranks 2, 4, 7
    dice: [1, 1, 3, 4, 6],
  });
  const got = C.legalAssigns(st).map((x) => `${x.slot}:${x.d1}${x.d2}`).sort().join(' ');
  const want = [
    '0:01', '0:04', '0:14',                        // rank 2: 1+1, the 6 wild as 1
    '1:02', '1:04', '1:12', '1:14', '1:24',        // rank 4: 1+3, and the 6 wild as 3 or 1
    '2:23', '2:24', '2:34',                        // rank 7: 3+4, and the 6 wild as 4 or 3
  ].sort().join(' ');
  check(got === want, `legalAssigns returned "${got}", paper says "${want}"`);
  // spot-check a few individual couplets instead of trusting the list above
  const has = (s, a, b) => C.legalAssigns(st).some((x) => x.slot === s && [x.d1, x.d2].join() === [a, b].sort().join());
  check(has(0, 0, 1), 'the Author (rank 2) takes 1+1');
  check(!has(0, 2, 3), 'the Author cannot take 3+4');
  check(has(1, 0, 2), 'the Battle (rank 4) takes 1+3');
  check(has(2, 2, 3), 'the Castle (rank 7) takes 3+4');
  check(has(2, 3, 4), 'the Castle takes 3 + wild-6 as 4');
  check(!has(2, 0, 1), 'the Castle cannot take 1+1');
}

/* ---- full random playouts ----
 *
 * A random player: roll, do a random legal assign or spend if there is one,
 * otherwise end the turn.  Harm from unresolved minions and weary locations,
 * plus events eating tokens, always ends the game one way or the other. */
let won = 0, lost = 0, totalTurns = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 300) {
    const assigns = C.legalAssigns(st);
    const spends = C.legalSpends(st);
    const rand = (arr) => arr[Math.floor(rng() * arr.length)];
    const roll = rng();
    let action = null;
    if (assigns.length && roll < 0.7) {
      const a = rand(assigns);
      const suits = C.suitsOf(st.journey[a.slot].id);
      action = { type: 'assign', slot: a.slot, d1: a.d1, d2: a.d2, suit: suits[Math.floor(rng() * suits.length)] };
    } else if (spends.length && roll < 0.8) {
      const s = rand(spends);
      action = { type: 'spend', slot: s.slot, suit: s.suit };
    } else if (!st.dice.length) {
      action = { type: 'roll' };
    }
    st = C.applyMove(st, action || { type: 'endTurn' });
    conserved(st, `seed ${seed} move ${st.moves}`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.journey.length === 3 && json.deck.length === st.deck.length,
      `seed ${seed}: JSON round trip`);
  }
  check(!!st.over, `seed ${seed}: game never ended (guard ${guard})`);
  if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else check(false, `seed ${seed}: unknown over=${st.over}`);
  // Independent expectation for the recorded outcome.
  if (st.over === 'won') {
    check(C.hasAllSuits(st) && st.harm < C.HARM_TO_LOSE,
      `seed ${seed}: won with harm ${st.harm} and supply ${JSON.stringify(st.supply)}`);
  } else {
    const deckOut = !st.deck.length && !C.journeyCount(st);
    check(st.harm >= C.HARM_TO_LOSE || (deckOut && !C.hasAllSuits(st)),
      `seed ${seed}: lost with harm ${st.harm}, deck ${st.deck.length}, journey ${C.journeyCount(st)}`);
  }
  totalTurns += st.turn;
}
console.log(`random playouts: ${won} won, ${lost} lost, ` +
  `average ${(totalTurns / 300).toFixed(1)} turns`);

console.log(failures === 0 ? 'hexaract: all tests passed' : `hexaract: ${failures} failures`);
process.exit(failures ? 1 : 0);

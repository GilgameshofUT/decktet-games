// Headless tests for Tinker, Sailor, Soldier, Spy:
// node test/tinker-sailor-soldier-spy.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));
const ALL = manifest.cards.map((c) => c.id);

const C = await import('../web/js/games/tinker-sailor-soldier-spy-core.js');
C.init(byId);

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, label) => {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  check(!!threw, `${label} should throw`);
  return threw;
};

const SUITS = C.SUITS;
const FULL = Object.fromEntries(SUITS.map((s) => [s, 6]));
const ZERO = Object.fromEntries(SUITS.map((s) => [s, 0]));
const ACES = ALL.filter((id) => byId[id].rank === 1);
check(ACES.length === 6, 'the six aces');

/* ---- card conservation: 45 unique cards and 36 chips, always ---- */
function conserved(st, label) {
  const all = C.allCards(st);
  if (all.length !== 45) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 45) check(false, `${label}: duplicate or missing card`);
  for (const s of SUITS) {
    const inPlay = st.chipPlay.filter((x) => x === s).length;
    const n = st.chips[s] + inPlay + st.chipTrash[s];
    if (n !== 6) check(false, `${label}: ${s} chips total ${n}`);
  }
}

/** For hand-built (partial) boards: a move must neither create nor destroy a card. */
function sameCards(before, after, label) {
  const a = C.allCards(before).slice().sort().join('|');
  const b = C.allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
}

/* ---- the pile partition matches the deck exactly ---- */
{
  const piles = [C.STARTERS, C.PERSONALITIES, C.EVENTS, C.LOCATIONS];
  check(piles.map((p) => p.length).join() === '4,11,11,13', `pile sizes ${piles.map((p) => p.length)}`);
  const all = [...piles.flat(), ...ACES];
  check(all.length === 45 && new Set(all).size === 45, 'the piles do not partition the deck');
  for (const id of all) check(!!byId[id], `unknown card ${id}`);
}

/* ---- card values: the extended-deck ranks ---- */
check(C.val('the-excuse') === 0, 'the Excuse is worth 0');
check(C.val('ace-of-moons') === 1, 'an Ace is worth 1');
check(C.val('the-sailor') === 4 && C.val('the-merchant') === 9, 'number ranks');
check(C.val('the-harvest') === 10, 'a Pawn is worth 10');
check(C.val('the-rite') === 11, 'a Court is worth 11');
check(C.val('the-end') === 12 && C.val('the-sea') === 12, 'a Crown is worth 12');

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, ALL);
  check(st.draw.length === 4, `seed ${seed}: draw ${st.draw.length}`);
  // one personality and one event are already face up as the first offer
  check(st.personalities.length === 10, `seed ${seed}: personalities ${st.personalities.length}`);
  check(st.events.length === 10, `seed ${seed}: events ${st.events.length}`);
  check(st.personalities.concat(st.choice[0]).length === 11, `seed ${seed}: 11 personalities in all`);
  check(st.events.concat(st.choice[1]).length === 11, `seed ${seed}: 11 events in all`);
  check(st.locations.length === 13, `seed ${seed}: locations ${st.locations.length}`);
  check(st.aces.length === 6, `seed ${seed}: aces ${st.aces.length}`);
  check(SUITS.every((s) => st.chips[s] === 6), `seed ${seed}: chips ${JSON.stringify(st.chips)}`);
  check(st.round === 1 && st.phase === 'choose' && st.over === null, `seed ${seed}: bad flags`);
  check(st.choice && st.choice.length === 2 && st.choice.every(Boolean), `seed ${seed}: no choice offered`);
  check(new Set(st.choice).size === 2, `seed ${seed}: the same card offered twice`);
  check(st.moves === 0 && st.acesAdded === 0, `seed ${seed}: counters not zero`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.draw.length === 4 && json.chips.moons === 6, `seed ${seed}: JSON round trip`);
}
throws(() => C.newGame(1, ALL.slice(1)), 'an incomplete deck');

/* ---- a hand-built fight, from the wiki's own example ----
 *
 * The Merchant (9, leaves + knots) is the challenge.  The player plays the
 * Savage (3 leaves), 1 knot chip, the Author (2 knots), 1 leaf chip and the
 * Painter (3 knots): 4 leaves + 6 knots = 10 against a goal of 9. */
function fightState(spec = {}) {
  return {
    seed: 0, rngState: 1,
    over: null, round: spec.round ?? 1, phase: 'fight',
    personalities: spec.personalities ?? ['the-author'],
    events: spec.events ?? ['the-market'],
    locations: spec.locations ?? [], aces: spec.aces ?? ACES.slice(),
    draw: spec.draw ?? [], discard: spec.discard ?? [], trash: spec.trash ?? [],
    played: spec.played ?? [], challenge: spec.challenge ?? 'the-merchant',
    choice: null,
    chips: { ...FULL, ...(spec.chips || {}) },
    chipPlay: spec.chipPlay ?? [],
    chipTrash: { ...ZERO },
    challengesDone: 0, acesAdded: 0, moves: 0, lastNote: null,
  };
}

{
  const st = fightState({
    played: ['the-savage', 'the-author', 'the-painter'],
    chipPlay: ['crowns', 'leaves'],
  });
  check(C.goal(st) === 9, `merchant goal ${C.goal(st)}`);
  check(C.sum(st) === 10, `wiki example sum ${C.sum(st)}, paper says 10`);
  const leaves = st.played.filter((id) => byId[id].suits.includes('leaves'))
    .reduce((n, id) => n + C.val(id), 0) + st.chipPlay.filter((s) => s === 'leaves').length;
  const knots = st.played.filter((id) => byId[id].suits.includes('crowns'))
    .reduce((n, id) => n + C.val(id), 0) + st.chipPlay.filter((s) => s === 'crowns').length;
  check(leaves === 4 && knots === 6, `breakdown leaves ${leaves} knots ${knots}, paper says 4 and 6`);
}

/* ---- only matching suits count ---- */
{
  const st = fightState({
    challenge: 'ace-of-leaves',                 // goal 1, leaves only
    played: ['ace-of-moons', 'the-sailor'],     // waves+leaves: 4 counts, moons 0
    chipPlay: ['suns', 'suns'],
  });
  check(C.sum(st) === 4, `matching-only sum ${C.sum(st)}, paper says 4 (the Sailor's 4 leaves)`);
  const st2 = fightState({
    challenge: 'the-merchant',                  // leaves + crowns
    played: ['the-sailor'],                     // waves + leaves → 4
    chipPlay: ['waves'],
  });
  check(C.sum(st2) === 4, 'a chip of a non-challenge suit counts 0');
}

/* ---- choosing the challenge ---- */
{
  let st = C.newGame(42, ALL);
  st = { ...st, personalities: ['the-author'], events: ['the-market'],
    draw: ['ace-of-moons', 'the-sailor', 'the-soldier', 'the-diplomat'],
    choice: ['the-merchant', 'the-betrayal'] };
  const a = C.choose(st, 0);
  check(a.challenge === 'the-merchant', `challenge ${a.challenge}`);
  check(a.trash.includes('the-betrayal') && !a.trash.includes('the-merchant'), 'the other card is trashed');
  check(a.phase === 'fight' && a.played.length === 1, 'the free card was played');
  check(a.draw.length === 3 && a.moves === 1, 'a card left the deck');
  sameCards(st, a, 'after choose');

  const b = C.choose(st, 1);
  check(b.challenge === 'the-betrayal' && b.trash.includes('the-merchant'), 'either card may be chosen');

  throws(() => C.choose(st, 5), 'a bad choice index');
  throws(() => C.choose(a, 0), 'choosing while a fight is on');
  throws(() => C.choose({ ...a, over: 'lost' }, 0), 'choosing after the game is over');
}

/* ---- playing a chip: spend one amulet, draw one card ---- */
{
  let st = fightState({
    challenge: 'ace-of-leaves', draw: ['ace-of-waves'], played: ['ace-of-moons'],
  });
  const next = C.playChip(st, 'leaves');         // matching chip: +1 = the goal
  check(next.chips.leaves === 5 && next.chipTrash.leaves === 1, 'the chip was spent for good');
  check(next.discard.includes('ace-of-waves') && next.discard.includes('ace-of-moons'),
    'the played cards were discarded');
  check(next.over === null && next.phase === 'choose', 'the fight was won and the next offered');
  check(next.challenge === null, 'the challenge moved on');
  check(next.discard.includes('ace-of-leaves'), 'the beaten challenge joined the discard');
  sameCards(st, next, 'after a winning chip play');

  // a chip of the wrong suit is still spent (it buys a card) but counts 0
  st = fightState({ challenge: 'the-merchant', draw: ['ace-of-waves'], played: ['the-savage'] });
  const b = C.playChip(st, 'suns');
  check(b.chipPlay.join() === 'suns' && C.sum(b) === 3, 'a non-matching chip buys a card but adds 0');
  check(b.phase === 'fight', 'the fight continues');

  throws(() => C.playChip(st, 'plums'), 'an unknown suit');
  const noChips = fightState({ challenge: 'the-merchant', draw: ['ace-of-moons'], chips: ZERO });
  throws(() => C.playChip(noChips, 'leaves'), 'spending an amulet you do not have');
  const noCards = fightState({ challenge: 'the-merchant', draw: [], discard: [] });
  const err = throws(() => C.playChip(noCards, 'leaves'), 'drawing with no cards left');
  check(err.message.includes('no cards'), `error message: ${err.message}`);
  throws(() => C.playChip({ ...C.newGame(7, ALL) }, 'leaves'), 'spending chips with no fight on');
  throws(() => C.playChip({ ...st, over: 'won' }, 'leaves'), 'playing after the game is over');
}

/* ---- weariness: every reshuffle adds one Ace (m.c. de Marco's ruling) ---- */
{
  const st = fightState({
    challenge: 'the-merchant',                  // 9: the free play cannot beat it
    played: ['the-savage'],                     // 3 leaves
    draw: [], discard: ['ace-of-moons', 'the-sailor'],
    aces: ACES.slice(),
  });
  const next = C.playChip(st, 'leaves');
  check(next.aces.length === 5 && next.acesAdded === 1, 'one Ace joined the reshuffled deck');
  check(next.lastNote && next.lastNote.includes('weary'), `note: ${next.lastNote}`);
  const deckNow = next.draw.length + next.discard.length;
  check(deckNow === 2, `after the reshuffle ${deckNow} cards remain in the deck, paper says 2`);
  sameCards(st, next, 'after the reshuffle');

  // no Ace is added when the Ace pile has run out — you still reshuffle
  const dry = fightState({
    challenge: 'the-merchant', played: ['the-savage'],
    draw: [], discard: ['ace-of-moons'], aces: [],
  });
  const d2 = C.playChip(dry, 'leaves');
  check(d2.acesAdded === 0 && d2.aces.length === 0, 'no weariness without Aces left');
  check(d2.draw.length + d2.discard.length === 0, 'the reshuffle still happens — every card is in play');

  // a full draw pile never reshuffles
  const stocked = fightState({
    challenge: 'the-merchant', played: ['the-savage'],
    draw: ['ace-of-moons', 'the-sailor'], discard: ['the-soldier'], aces: ACES.slice(),
  });
  const s2 = C.playChip(stocked, 'leaves');
  check(s2.acesAdded === 0 && s2.aces.length === 6, 'no reshuffle from a stocked deck');
}

/* ---- backing down (round 1) ---- */
{
  const st = fightState({
    draw: ['ace-of-moons'], played: ['the-savage'], chipPlay: ['leaves'],
    chips: { ...FULL, leaves: 5 },               // the leaf chip is already in play
  });
  const next = C.giveUp(st);
  check(next.trash.includes('the-merchant'), 'the challenge is trashed');
  check(next.discard.includes('the-savage'), 'the played card is discarded');
  check(next.chipTrash.leaves === 1 && next.chips.leaves === 5, 'the spent chip is trashed');
  check(next.challenge === null && next.phase === 'choose', 'the next pair is offered');
  check(next.choice.join() === 'the-author,the-market', 'the next two cards');
  check(next.over === null, 'giving up never ends the game');
  sameCards(st, next, 'after giving up');

  throws(() => C.giveUp(fightState({ round: 2 })), 'giving up on a location');
  throws(() => C.giveUp(fightState({ phase: 'choose' })), 'giving up with no fight on');
  const over = fightState({});
  over.over = 'won';
  throws(() => C.giveUp(over), 'giving up after the game is over');
}

/* ---- the last round-1 fight opens round 2 ---- */
{
  const st = fightState({
    personalities: [], events: [],
    locations: ['the-end', 'the-mountain'],
    played: ['the-savage'],                     // 3 leaves
    draw: ['the-merchant'],                     // 9 leaves+crowns — beats the Market (6)
    challenge: 'the-market',
  });
  const next = C.playChip(st, 'crowns');        // buys the Merchant: 3 + 1 + 9 = 13 >= 6
  check(next.round === 2, 'round 2 begins');
  check(next.challenge === 'the-mountain', `first location ${next.challenge} (popped from the end)`);
  check(next.locations.join() === 'the-end', 'one location left');
  check(next.phase === 'fight' && next.played.length === 1, 'the location fight started with the free play');
  check(!next.trash.includes('the-market'), 'the beaten challenge joined the deck, not the trash');
  check(next.lastNote.includes('Round 2'), `note: ${next.lastNote}`);
  sameCards(st, next, 'into round 2');
}

/* ---- locations are mandatory and never join the deck ---- */
{
  const st = fightState({
    round: 2, locations: [], challenge: 'the-mountain',   // 4, moons + suns
    played: ['the-savage'], draw: ['the-diplomat'],       // 8 moons+suns
  });
  const next = C.playChip(st, 'moons');
  check(next.over === 'won', `beating the last location wins: over=${next.over}`);
  check(next.trash.includes('the-mountain'), 'the location is trashed, not recruited');
  sameCards(st, next, 'won state');

  const err = throws(() => C.giveUp(fightState({ round: 2 })), 'no backing down in round 2');
  check(err.message.includes('location'), `message: ${err.message}`);
}

/* ---- losing: an unbeatable location with nothing to press on with ---- */
{
  const st = fightState({
    round: 2, locations: ['the-sea'], challenge: 'the-end',   // 12
    played: ['ace-of-moons'], draw: [], discard: [], chips: ZERO,
  });
  C.settleFight(st);
  check(st.over === 'lost', `no chips + no cards + short of 12: over=${st.over}`);
  check(st.phase === 'over', 'the phase is over');

  // …but the same squeeze in round 1 is survivable: you simply back down
  const r1 = fightState({
    round: 1, challenge: 'the-end',
    played: ['ace-of-moons'], draw: [], discard: [], chips: ZERO,
  });
  C.settleFight(r1);
  check(r1.over === null && r1.phase === 'fight', 'round 1 never ends in defeat');
  const quit = C.giveUp(r1);
  check(quit.over === null && quit.phase === 'choose', 'backing down survives the squeeze');
}

/* ---- full random playouts: a random player always finishes ---- */
let won = 0, lost = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, ALL);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 500) {
    let next = null;
    if (st.phase === 'choose') {
      next = C.choose(st, rng() < 0.5 ? 0 : 1);
    } else if (C.canContinue(st)) {
      if (st.round === 2 || rng() < 0.6) {
        const avail = SUITS.filter((s) => st.chips[s] > 0);
        next = C.playChip(st, avail[Math.floor(rng() * avail.length)]);
      } else {
        next = C.giveUp(st);
      }
    } else if (st.round === 1) {
      next = C.giveUp(st);
    }
    check(next !== null || st.over, `seed ${seed}: stuck at round ${st.round} phase ${st.phase}`);
    if (!next) break;
    st = next;
    conserved(st, `seed ${seed} move ${st.moves}`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.challenge === st.challenge && json.round === st.round, `seed ${seed}: JSON round trip`);
  }
  check(st.over === 'won' || st.over === 'lost', `seed ${seed}: game never ended (guard ${guard})`);
  check(st.phase === 'over', `seed ${seed}: phase ${st.phase} at the end`);
  if (st.over === 'won') won++; else lost++;
  if (st.over === 'won') {
    check(st.locations.length === 0, `seed ${seed}: won with locations left`);
    check(st.challengesDone === 24, `seed ${seed}: ${st.challengesDone} challenges, paper says 24`);
  }
}
check(won + lost === 300, `only ${won + lost} of 300 games finished`);
console.log(`random playouts: 300/300 finished — ${won} won, ${lost} lost`);

console.log(failures === 0
  ? 'tinker-sailor-soldier-spy: all tests passed'
  : `tinker-sailor-soldier-spy: ${failures} failures`);
process.exit(failures ? 1 : 0);

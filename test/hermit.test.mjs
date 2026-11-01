// Headless tests for Hermit: node test/hermit.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/hermit-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throwsWith = (fn, needle, msg) => {
  try { fn(); check(false, `${msg}: did not throw`); }
  catch (e) { check(e.message.includes(needle), `${msg}: message "${e.message}" lacks "${needle}"`); }
};

/* ---- card lookups ---- */
const aceOf = (suit) => BASIC.find((id) => byId[id].rank === 1 && byId[id].suits.includes(suit));
const named = (name) => BASIC.find((id) => byId[id].name === name);

const JOURNEY = named('the Journey');            // 3 moons + waves
const HUNTRESS = named('the Huntress');          // Crown of Moons (personality)
const BARD = named('the Bard');                  // Crown of Suns (personality)
const FOREST = named('the Forest');              // 5 moons + leaves
const MOUNTAIN = named('the Mountain');          // 4 moons + suns
const CAVE = named('the Cave');                  // 7 waves + daemons
const CASTLE = named('the Castle');              // 7 suns + crowns
const DARKNESS = named('the Darkness');          // 9 waves + daemons
const CHANCE = named('the Chance Meeting');      // 7 moons + leaves
const DESERT = named('the Desert');              // 2 suns + daemons
const BETRAYAL = named('the Betrayal');          // 8 daemons + crowns
const PACT = named('the Pact');                  // 9 moons + suns
const AUTHOR = named('the Author');              // personality, 2
const LUNATIC = named('the Lunatic');            // personality, 6
const SAILOR = named('the Sailor');              // personality, 4

/* ---- a hand-built position: leftovers live in setAside so all 36 count ---- */
function pos({ hands, tricks = [], cottage = [], piles = [[], []],
  turn = 0, phase = 'play', pick = null, picks = [null, null], handNo = 1,
  tricksWon = [0, 0], dealer = 0, total = [0, 0], over = null }) {
  const used = new Set([
    ...hands.flat(), ...cottage, ...piles.flat(),
    ...tricks.flatMap((t) => t.plays.map((p) => p.id)),
  ]);
  return {
    seed: 1, cards: BASIC.slice(), handNo, dealer, leader: 1 - dealer, turn,
    hands: [hands[0].slice(), hands[1].slice()],
    cottage: cottage.slice(),
    tricks: structuredClone(tricks),
    piles: [piles[0].slice(), piles[1].slice()],
    setAside: BASIC.filter((id) => !used.has(id)),
    tricksWon: tricksWon.slice(),
    phase, pick, picks: picks.slice(),
    total: total.slice(), lastHand: null, lastTrick: null,
    moves: 0, over, winner: null,
  };
}

function allCards(state) {
  return [
    ...state.hands[0], ...state.hands[1], ...state.cottage,
    ...state.piles[0], ...state.piles[1], ...state.setAside,
    ...(state.picks || []).filter(Boolean),     // chosen to start tricks, still face down
    ...state.tricks.flatMap((t) => t.plays.map((p) => p.id)),
  ];
}
function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

const trickOf = (player, id) => ({ player, control: player, plays: [{ player, id }] });

/* ======================================================= setup over seeds */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 16 && st.hands[1].length === 16,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.cottage.length === 4, `seed ${seed}: cottage ${st.cottage.length}`);
  check(st.phase === 'start' && st.pick === 0, `seed ${seed}: phase/pick`);
  check(st.leader === 1 - st.dealer && st.turn === st.leader, `seed ${seed}: leader/turn`);
  check(st.handNo === 1 && st.total[0] === 0 && st.total[1] === 0, `seed ${seed}: fresh match`);
  check(st.tricks.length === 0 && st.piles[0].length === 0, `seed ${seed}: empty table`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.hands[1].length === 16 && json.cottage.length === 4, `seed ${seed}: JSON round trip`);
}

/* ============================================ the ranking wrinkle: aces */
{
  // Aces are low, Crowns ordinarily high …
  check(C.trickValue([], HUNTRESS) === 10, 'a Crown alone is 10');
  check(C.trickValue([], aceOf('moons')) === 1, 'an Ace is 1');

  // … until an Ace of the same suit is in the trick, in either order
  const crownFirst = [{ id: HUNTRESS, player: 0 }, { id: aceOf('moons'), player: 1 }];
  check(C.trickValue(crownFirst, HUNTRESS) === 0, 'a cancelled Crown is below every Ace');
  check(C.trickValue(crownFirst, aceOf('moons')) === 1, 'the cancelling Ace stays 1');
  check(C.trickValue(crownFirst, HUNTRESS) < C.trickValue(crownFirst, aceOf('moons')),
    'cancelled Crown < Ace');
  const aceFirst = [{ id: aceOf('moons'), player: 1 }, { id: HUNTRESS, player: 0 }];
  check(C.trickValue(aceFirst, HUNTRESS) === 0, 'the Ace cancels the Crown played after it');

  // an Ace of another suit cancels nothing
  const other = [{ id: HUNTRESS, player: 0 }, { id: aceOf('suns'), player: 1 }];
  check(C.trickValue(other, HUNTRESS) === 10, 'only the matching Ace cancels');

  // personality points
  check(C.pointsOf([HUNTRESS]) === 10, 'a Crown personality is worth 10');
  check(C.pointsOf([LUNATIC, AUTHOR, CAVE]) === 8, '6 + 2, non-personalities score nothing');
  check(manifest.personalities.length === 11 &&
    manifest.personalities.reduce((s, id) => s + C.rankOf(id), 0) === 66,
  'the eleven personalities total 66');
}

/* =============================== a fully resolved trick: the wiki's own */
{
  // Journey (3) led → Huntress (Crown, 10) takes control → the matching Ace
  // neutralises the Crown without taking control (the 3 is still higher) →
  // the 5 is high and completes the trick.
  const st = pos({
    hands: [[JOURNEY, aceOf('moons')], [HUNTRESS, FOREST]],
    cottage: [AUTHOR, LUNATIC, CAVE, named('the Mill')],
    turn: 0,
  });
  conserved(st, 'wiki fixture');

  let s = C.playCard(st, JOURNEY, null);              // p0 starts the trick
  check(s.tricks.length === 1 && s.tricks[0].control === 0, 'the led card controls');
  check(s.turn === 1, 'turn passes');

  s = C.playCard(s, HUNTRESS, 0);                     // Crown beats the 3
  check(s.tricks[0].control === 1, 'the Crown takes control');

  s = C.playCard(s, aceOf('moons'), 0);               // Ace cancels the Crown…
  check(s.tricks[0].control === 1, 'the Ace is still below the 3, so control does not move');

  const before = s;
  s = C.playCard(s, FOREST, 0);                       // 5 is high, fourth card
  check(before.lastHand == null, 'the hand was still running before the fourth card');
  check(s.lastHand.piles[1].length === 4, 'the fourth card completes the trick');
  check(s.tricks.length === 0 && s.lastHand.tricks[1] === 1,
    'p1 took it and the table is clear');
  check(s.turn === 0, "the hand was redealt, so the new dealer's left leads");

  // both hands are empty, so the hand ends and is scored:
  //   p1's trick holds the Huntress → 10 points; the Cottage holds Author +
  //   Lunatic = 8, and p1 took the only trick, so the fewer-tricks player
  //   (p0) scores the Cottage.
  check(s.handNo === 2, `next hand ${s.handNo}`);
  check(s.lastHand.points[0] === 8 && s.lastHand.points[1] === 10,
    `hand points ${s.lastHand.points} (paper: 8 / 10)`);
  check(s.total[0] === 8 && s.total[1] === 10, `totals ${s.total}`);
  check(s.lastHand.cottageTo === 0, 'the fewer-tricks player scores the Cottage');
  check(s.lastHand.tricks.join() === '0,1', `tricks taken ${s.lastHand.tricks}`);
  conserved(s, 'after the wiki trick');
  check(s.lastHand.piles.flat().length + s.lastHand.cottage.length +
    s.lastHand.setAside.length === 36, 'the finished hand accounts for all 36 cards');
}

/* ============ a personality you avoided: the Bard stays with the leader */
{
  // p0 leads the Bard (Crown of Suns, 10 points); nobody can beat a Crown
  // without its matching Ace, so p0 takes the trick — but p0 also collects
  // it with 3,5,4 support.  Tricks 3–5 → p0 has fewer tricks → Cottage.
  const st = pos({
    hands: [[BARD, MOUNTAIN], [PACT, JOURNEY]],
    cottage: [AUTHOR, LUNATIC, CAVE, named('the Mill')],
    tricksWon: [3, 5],
    turn: 0,
  });
  let s = C.playCard(st, BARD, null);
  s = C.playCard(s, PACT, 0);
  s = C.playCard(s, MOUNTAIN, 0);
  s = C.playCard(s, JOURNEY, 0);
  check(s.lastHand, 'the hand ended');
  check(s.lastHand.tricks.join() === '4,5', `tricks ${s.lastHand.tricks} (paper 4/5)`);
  check(s.lastHand.cottageTo === 0, 'the fewer-tricks player scores the Cottage');
  check(s.lastHand.points[0] === 10 + 8 && s.lastHand.points[1] === 0,
    `points ${s.lastHand.points} (paper: 18 / 0 — Bard 10 + Cottage 8)`);
  check(s.total.join() === '18,0', `totals ${s.total}`);
  conserved(s, 'personality fixture');
}

/* ==================== equal tricks: the Cottage is discarded */
{
  const st = pos({
    hands: [[PACT, JOURNEY], [BARD, MOUNTAIN]],   // p1 leads: the Bard
    cottage: [AUTHOR, LUNATIC, CAVE, named('the Mill')],
    tricksWon: [4, 3],
    turn: 1,                                       // p1 leads this time
  });
  let s = C.playCard(st, BARD, null);
  s = C.playCard(s, PACT, 0);
  s = C.playCard(s, MOUNTAIN, 0);
  s = C.playCard(s, JOURNEY, 0);
  check(s.lastHand, 'the hand ended');
  check(s.lastHand.tricks.join() === '4,4', `tricks ${s.lastHand.tricks} (paper 4/4)`);
  check(s.lastHand.cottageTo === null, 'equal tricks: the Cottage is discarded');
  check(s.lastHand.cottagePts === 8, `cottage points counted anyway: ${s.lastHand.cottagePts}`);
  check(s.lastHand.points.join() === '0,10',
    `points ${s.lastHand.points} (paper: 0 / 10 — only the Bard)`);
}

/* ================================ must follow suit: refusals and voids */
{
  const st = pos({
    hands: [[MOUNTAIN, PACT], [DARKNESS, FOREST]],
    tricks: [trickOf(0, CAVE), trickOf(0, CASTLE)],
    turn: 1,
  });
  check(C.legalPlays(st).join() === DARKNESS, 'only the fitting card is legal');
  check(C.explainPlay(st, FOREST, undefined) != null, 'a void card is refused while you can follow');
  check(C.explainPlay(st, DARKNESS, undefined) == null, 'the fitting card is legal');
  throwsWith(() => C.playCard(st, FOREST, null), 'follow',
    'starting a trick while a card still fits');
  throwsWith(() => C.playCard(st, DARKNESS, 1), 'does not share a suit',
    'playing onto a trick you cannot follow');
  throwsWith(() => C.playCard(st, DARKNESS, 7), 'no trick', 'a target that does not exist');
  throwsWith(() => C.playCard(st, MOUNTAIN, undefined), 'not in your hand',
    'a card the player does not hold');

  const ok = C.playCard(st, DARKNESS, 0);
  check(ok.tricks[0].plays.length === 2, 'the fitting card lands on the first trick');
  conserved(ok, 'after following');
}

{
  // void in every trick in progress: you must start a new one
  const st = pos({
    hands: [[MOUNTAIN, PACT], [FOREST, CHANCE]],
    tricks: [trickOf(0, CAVE), trickOf(0, CASTLE)],
    turn: 1,
  });
  check(C.legalPlays(st).length === 2, 'void everywhere: every card is legal');
  check(C.explainPlay(st, FOREST, 0) != null, 'you cannot play onto a trick while void');
  throwsWith(() => C.playCard(st, FOREST, 0), 'void', 'playing onto a trick while void');
  const s = C.playCard(st, FOREST, null);
  check(s.tricks.length === 3 && s.tricks[2].control === 1, 'a void player starts a new trick');
  check(s.tricks[2].plays[0].id === FOREST, 'the new trick holds the card played');
}

/* ================================== the Cottage and the start of tricks */
{
  const st = C.newGame(42, BASIC);
  const first = C.pickCard(st, st.hands[0][0]);
  check(first.picks[0] === st.hands[0][0], 'player 1 has chosen a start card');
  check(first.cottage.length === 4, 'the opening start costs no Cottage card');
  check(first.tricks.length === 0, 'nothing is revealed until both have chosen');
  const second = C.pickCard(first, first.hands[1][0]);
  check(second.phase === 'play', 'both tricks start together');
  check(second.tricks.length === 2, 'one trick per player');
  check(second.tricks[0].plays[0].player === 0 && second.tricks[1].plays[0].player === 1,
    'each player starts their own trick');
  check(second.picks[0] === null && second.picks[1] === null, 'the picks are cleared');
  check(second.turn === second.leader, 'the player on the dealer\'s left plays first');
  conserved(second, 'after the opening start');

  throwsWith(() => C.pickCard(second, second.hands[0][0]), 'not the time',
    'picking outside a pick phase');
  const bad = pos({ hands: [[JOURNEY], [FOREST]], phase: 'cottage', pick: 0, turn: 0 });
  throwsWith(() => C.pickCard(bad, FOREST), 'not in your hand', "picking the other player's card");
  throwsWith(() => C.pickCard({ ...bad, over: 'match' }, JOURNEY), 'over', 'picking after the match');
  check(C.explainPlay(bad, JOURNEY, 0).includes('Cottage'), 'explainPlay explains the pick phase');
}

{
  // one trick in play, the fourth card clears the table → Cottage phase
  const st = pos({
    hands: [[PACT, FOREST, DARKNESS, MOUNTAIN],
      [CASTLE, JOURNEY, CHANCE, HUNTRESS, BETRAYAL]],
    cottage: [AUTHOR, LUNATIC, CAVE, named('the Mill')],
    tricks: [{ player: 0, control: 0, plays: [{ player: 0, id: DESERT }] }],
    turn: 1,
  });
  let s = C.playCard(st, CASTLE, 0);      // p1 follows the Desert's suits with the Castle
  s = C.playCard(s, PACT, 0);             // p0 follows (Suns)
  check(s.phase === 'play' && s.tricks[0].plays.length === 3, 'three cards down');
  s = C.playCard(s, JOURNEY, 0);          // p1's fourth card completes it
  check(s.phase === 'cottage' && s.pick === 0, 'the clear table asks for Cottage cards');
  check(s.cottage.length === 4, 'nothing has been added yet');
  check(s.turn === 0, 'the player who did not play last is next');

  const c0 = C.pickCard(s, s.hands[0][0]);
  check(c0.phase === 'cottage' && c0.pick === 1 && c0.cottage.length === 5,
    'player 1 adds one face-down card');
  check(c0.tricks.length === 0, 'the table is still clear');
  const c1 = C.pickCard(c0, c0.hands[1][0]);
  check(c1.phase === 'start' && c1.cottage.length === 6, 'player 2 adds one too');
  const t = C.pickCard(c1, c1.hands[0][0]);
  check(t.phase === 'start' && t.pick === 1 && t.tricks.length === 0,
    'start cards stay hidden until both are chosen');
  const t2 = C.pickCard(t, t.hands[1][0]);
  check(t2.phase === 'play' && t2.tricks.length === 2, 'new tricks start after the Cottage');
  conserved(t2, 'after a cottage round');
}

/* ================= the match ends after each player has dealt twice */
{
  const st = pos({
    hands: [[JOURNEY, aceOf('moons')], [HUNTRESS, FOREST]],
    cottage: [AUTHOR, LUNATIC, CAVE, named('the Mill')],
    turn: 0, handNo: 4,
  });
  let s = C.playCard(st, JOURNEY, null);
  s = C.playCard(s, HUNTRESS, 0);
  s = C.playCard(s, aceOf('moons'), 0);
  s = C.playCard(s, FOREST, 0);
  check(s.over === 'match', `over after four hands (${s.over})`);
  check(s.total[0] === 8 && s.total[1] === 10, `final ${s.total}`);
  check(s.winner === 0, `winner ${s.winner} (lowest score: p0 has 8, p1 has 10)`);
  conserved(s, 'match over');

  // a level total is a draw
  const draw = pos({
    hands: [[JOURNEY, aceOf('moons')], [HUNTRESS, FOREST]],
    cottage: [LUNATIC, SAILOR, CAVE, named('the Mill')],   // 6 + 4 = 10
    turn: 0, handNo: 4, total: [20, 20],
  });
  let d = C.playCard(draw, JOURNEY, null);
  d = C.playCard(d, HUNTRESS, 0);
  d = C.playCard(d, aceOf('moons'), 0);
  d = C.playCard(d, FOREST, 0);
  check(d.over === 'match' && d.winner === null, 'a level total is a draw');
  check(d.total.join() === '30,30', `draw fixture totals ${d.total}`);
}

/* ====================================== random matches (300 seeds) */
let handsPlayed = 0, movesPlayed = 0, matchWins = [0, 0, 0], scoreSum = 0, lastWinner = null;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 131 + 7);
  let guard = 0, seenHand = 0, expect = [0, 0];
  while (!st.over && guard++ < 20000) {
    if (st.phase === 'cottage' || st.phase === 'start') {
      const hand = st.hands[st.pick];
      st = C.pickCard(st, hand[Math.floor(rng() * hand.length)]);
    } else {
      const legal = C.legalPlays(st);
      const id = legal[Math.floor(rng() * legal.length)];
      const fits = C.followsTricks(st, id);
      const target = fits.length ? fits[Math.floor(rng() * fits.length)] : null;
      st = C.playCard(st, id, target);
    }
    movesPlayed++;
    conserved(st, `seed ${seed} move ${movesPlayed}`);
    check(JSON.parse(JSON.stringify(st)).cards.length === 36, `seed ${seed}: JSON round trip`);

    if (st.lastHand && st.lastHand.handNo !== seenHand) {
      seenHand = st.lastHand.handNo;
      handsPlayed++;
      const lh = st.lastHand;
      const paper = [C.pointsOf(lh.piles[0]), C.pointsOf(lh.piles[1])];
      const cottage = C.pointsOf(lh.cottage);
      if (lh.cottageTo != null) paper[lh.cottageTo] += cottage;
      check(lh.points[0] === paper[0] && lh.points[1] === paper[1],
        `seed ${seed} hand ${lh.handNo}: points ${lh.points} vs paper ${paper}`);
      check(lh.piles.flat().length + lh.cottage.length + lh.setAside.length === 36,
        `seed ${seed} hand ${lh.handNo}: the hand does not add to 36`);
      check(lh.tricks[0] + lh.tricks[1] <= 8,
        `seed ${seed} hand ${lh.handNo}: ${lh.tricks[0] + lh.tricks[1]} tricks taken`);
      check(lh.cottageTo === (lh.tricks[0] === lh.tricks[1]
        ? null : (lh.tricks[0] < lh.tricks[1] ? 0 : 1)),
      `seed ${seed} hand ${lh.handNo}: the Cottage went to the wrong player`);
      expect[0] += paper[0];
      expect[1] += paper[1];
      check(lh.points[0] + lh.points[1] <= 66,
        `seed ${seed} hand ${lh.handNo}: ${lh.points[0] + lh.points[1]} points, more than the 66 personalities`);
    }
  }
  if (st.over !== 'match') { check(false, `seed ${seed}: never finished (${guard} moves)`); continue; }
  check(st.total[0] === expect[0] && st.total[1] === expect[1],
    `seed ${seed}: totals ${st.total} vs paper ${expect}`);
  const paperWinner = st.total[0] === st.total[1] ? null : (st.total[0] < st.total[1] ? 0 : 1);
  check(st.winner === paperWinner, `seed ${seed}: winner ${st.winner} vs paper ${paperWinner}`);
  check(st.total[0] + st.total[1] <= 4 * 66, `seed ${seed}: ${st.total[0] + st.total[1]} points > 4×66`);
  matchWins[st.winner === null ? 2 : st.winner]++;
  scoreSum += st.total[0] + st.total[1];
  lastWinner = st.winner;
}
check(movesPlayed > 3000, `only ${movesPlayed} moves played`);
check(handsPlayed === 1200, `only ${handsPlayed} hands scored (expected 300×4)`);

console.log(`random matches: ${movesPlayed} moves, ${handsPlayed} hands, `
  + `average total score ${(scoreSum / 300).toFixed(1)} `
  + `(P1 ${matchWins[0]} / P2 ${matchWins[1]} / draw ${matchWins[2]}, last winner ${lastWinner})`);
console.log(failures === 0 ? 'hermit: all tests passed' : `hermit: ${failures} failures`);
process.exit(failures ? 1 : 0);

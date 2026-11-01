// Headless tests for Emu Ranchers: node test/emu-ranchers.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/emu-ranchers-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

const rankOf = (id) => byId[id].rank;
const find = (rank, suits) => BASIC.find((id) => byId[id].rank === rank &&
  suits.every((s) => byId[id].suits.includes(s)));

function allCards(state) {
  return [...state.hands[0], ...state.hands[1], ...state.draw, ...state.discard,
    ...state.ranch[0].flat(), ...state.ranch[1].flat()];
}
function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/* ---- setup ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 6 && st.hands[1].length === 6,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.draw.length === 24, `seed ${seed}: draw pile ${st.draw.length}`);
  check(st.discard.length === 0, `seed ${seed}: discard not empty at deal`);
  check(st.ranch[0].length === 0 && st.ranch[1].length === 0, `seed ${seed}: ranch not empty`);
  check(st.turn === 0 && st.phase === 'action', `seed ${seed}: turn/phase`);
  check(st.year === 1 && st.scores[0] === 0 && st.scores[1] === 0, `seed ${seed}: year/scores`);
  check(!st.over, `seed ${seed}: over at deal`);
  conserved(st, `seed ${seed}`);
}
check(C.newGame(1, BASIC, 1).turn === 1, 'second seat may deal first');

/* ---- stack order: suit commitment and direction ---- */
{
  const aceW = 'ace-of-waves';
  const three = find(3, ['waves']);       // the Journey
  const four = find(4, ['waves']);        // the Sailor
  const five = find(5, ['waves']);        // the Discovery
  const six = find(6, ['waves']);         // the Lunatic
  const eight = find(8, ['waves']);       // the Mill
  const painter = find(3, ['suns']);      // the Painter — no waves

  check(C.growFits([aceW, three, four], five), 'Ace-2-4 grows with 5 or more');
  check(!C.growFits([aceW, three, four], three), '3 cannot grow Ace-3-4 going up');
  check(!C.growFits([aceW, three, four], painter), 'a Sun cannot grow a Waves bird');
  check(C.growFits([six, five], three), 'a decreasing stack keeps decreasing');
  check(!C.growFits([six, five], eight), '8 breaks a decreasing Waves stack');
  check(!C.growFits([], aceW), 'an empty stack is not a bird');

  // a number hatch leaves suit and direction open — either suit, either way
  check(C.growFits([five], eight), 'grow up with a Wave after a lone Discovery');
  check(C.growFits([five], three), 'grow down with a Wave after a lone Discovery');
  check(C.growFits([five], find('crown', ['suns'])), 'the Sun side is also open');
  // …but the first growth commits the bird
  const committed = [five, find('crown', ['suns'])];       // Sun bird going up to the top
  check(!C.growFits(committed, painter), '3 Suns cannot join a Sun bird at the Crown');
  check(!C.growFits(committed, aceW), 'a Wave cannot join a committed Sun bird');

  const info = C.stackInfo([aceW, three, four]);
  check(info.suits.length === 1 && info.suits[0] === 'waves' && info.dir === 'up' &&
    info.total === 7 && info.ace && !info.crown, `stackInfo ${JSON.stringify(info)}`);
}

/* ---- hatch / grow / discard on a real state ---- */
{
  let st = C.newGame(7, BASIC);
  const id = st.hands[0][0];
  const hatched = C.hatch(st, id);
  check(hatched.ranch[0].length === 1 && hatched.ranch[0][0][0] === id, 'hatch starts a bird');
  check(hatched.hands[0].length === 5, 'hatched card left the hand');
  check(hatched.hands[1].join() === st.hands[1].join(), 'opponent hand untouched');
  check(hatched.phase === 'draw' && hatched.turn === 0, 'hatch then draw');

  // a second turn so the discard pile exists
  const d1 = C.drawCard(hatched, 'deck');
  check(d1.turn === 1 && d1.phase === 'action', 'turn passes after the draw');
  const thrown = d1.hands[1][0];
  const disc = C.discardCard(d1, thrown);
  check(disc.discard[disc.discard.length - 1] === thrown, 'discard on the pile');
  check(disc.phase === 'draw' && disc.mustDrawDeck, 'after a discard the draw is forced');
  check(!C.canDraw(disc, 'discard'), 'the discard cannot be taken back');
  let threw = false;
  try { C.drawCard(disc, 'discard'); } catch { threw = true; }
  check(threw, 'drawing from the discard after discarding should throw');
  const d2 = C.drawCard(disc, 'deck');
  check(d2.turn === 0, 'back to the first player');

  // growing: give player 0 a card that fits bird 0, if the hand has one
  const bird = d2.ranch[0][0];
  const fit = d2.hands[0].find((id2) => C.growFits(bird, id2));
  if (fit) {
    const grew = C.grow(d2, fit, 0);
    check(grew.ranch[0][0].length === 2, 'grow adds to the stack');
    check(grew.hands[0].length === d2.hands[0].length - 1, 'grow spends the card');
  }

  // illegal moves throw
  const oppCard = st.hands[1][0];
  threw = false; try { C.hatch(st, oppCard); } catch { threw = true; }
  check(threw, 'hatching the opponent hand card should throw');
  threw = false; try { C.grow(d2, oppCard, 0); } catch { threw = true; }
  check(threw, 'growing with the opponent hand card should throw');
  threw = false; try { C.discardCard(d2, oppCard); } catch { threw = true; }
  check(threw, 'discarding the opponent hand card should throw');
  threw = false; try { C.grow(d2, d2.hands[0][0], 5); } catch { threw = true; }
  check(threw, 'growing onto a stack that does not exist should throw');
  threw = false; try { C.hatch(d1, d1.hands[0][0]); } catch { threw = true; }
  check(threw, 'hatching during the draw phase should throw');
  threw = false; try { C.discardCard(d2, 'not-a-card'); } catch { threw = true; }
  check(threw, 'discarding a card you do not hold should throw');
}

/* ---- the last card of the draw pile ends the year ---- */
{
  let st = C.newGame(3, BASIC);
  st = C.hatch(st, st.hands[0][0]);
  st.draw = [st.draw[0]];                       // one card left in the fixture
  const next = C.drawCard(st, 'deck');
  check(next.draw.length === 0 && next.phase === 'year-end', 'the last draw ends the year');
  check(next.yeSeat === 0, `the drawer plays out the year (yeSeat ${next.yeSeat})`);
  check(next.hands[0].length === 6, 'the drawn card joined the hand');
  check(!next.over, 'the year is not over until it is scored');
}

/* ---- year end ---- */
{
  let st = C.newGame(9, BASIC);
  let guard = 0;
  while (st.phase !== 'year-end' && guard++ < 4000) st = C.applyAction(st, C.legalActions(st)[0]);
  check(st.phase === 'year-end', `a straight-line player reaches year end (phase ${st.phase})`);
  check(st.draw.length === 0, 'draw pile empty at year end');

  const ye = st.yeSeat;
  let threw = false;
  threw = false; try { C.yeGrow(st, st.hands[1 - ye][0], 0); } catch { threw = true; }
  check(threw, 'year-end growth with the opponent card should throw');
  threw = false; try { C.discardCard(st, st.hands[ye][0]); } catch { threw = true; }
  check(threw, 'discarding during year end should throw (only the finish discards)');
  threw = false; try { C.hatch(st, st.hands[ye][0]); } catch { threw = true; }
  check(threw, 'hatching during year end should throw');
  threw = false; try { C.drawCard({ ...st, phase: 'draw' }, 'deck'); } catch { threw = true; }
  check(threw, 'drawing from an empty draw pile should throw');

  const first = C.yeFinish(st);
  check(first.yeSeat === 1 - ye && first.yeDone[ye] && !first.yeDone[1 - ye],
    'the other seat plays out next');
  check(first.hands[ye].length === 0, "the finisher's hand was discarded");
  check(first.discard.includes(...st.hands[ye]), 'leftovers went to the discard');
  const second = C.yeFinish(first);
  check(second.phase === 'scored' && second.over === 'year', `year scored: ${second.phase}/${second.over}`);
  check(second.yearLog.length === 1 && second.scores[0] !== undefined, 'the year was banked');
  conserved(second, 'after year end');
  const json = JSON.parse(JSON.stringify(second));
  check(json.ranch.length === 2, 'JSON round trip keeps the ranch');
}

/* ---- hand-computed scoring ---- */
{
  const waves = (r) => find(r, ['waves']);
  // the wiki's blue bird: Ace, 2, 3, 5, 6, 8, Crown of Waves → 16
  const wikiBird = ['ace-of-waves', waves(2), waves(3), waves(5), waves(6), waves(8), waves('crown')];
  check(wikiBird.every(Boolean), 'waves fixture cards exist');
  const r = C.scoreStack(wikiBird);
  check(r.score === 16, `wiki blue bird scores 16, got ${r.score}`);
  check(r.upkeep.map((id) => rankOf(id)).reduce((a, b) => a + b, 0) === 18,
    `upkeep paid ${r.upkeep.map((id) => rankOf(id))}`);

  // orange bird gone wrong: Crown, 8, 4 of Suns → -(18-12) - 5 = -11
  const suns = (r2) => find(r2, ['suns']);
  check(C.scoreStack([suns('crown'), suns(8), suns(4)]).score === -11,
    `Crown/8/4 Suns loses 11, got ${C.scoreStack([suns('crown'), suns(8), suns(4)]).score}`);

  // no court: 2+3+5+6+8+9 Waves = 33, pay 18 (9+6+3), keep 15
  const plain = [waves(2), waves(3), waves(5), waves(6), waves(8), waves(9)];
  check(C.scoreStack(plain).score === 15, `plain Waves bird scores 15, got ${C.scoreStack(plain).score}`);

  // 2+8+9 = 19: the closest payment wastes 1 — nothing left, nothing scored
  check(C.scoreStack([waves(2), waves(8), waves(9)]).score === 0,
    'a 19-total bird with no court scores 0');

  // Ace + Crown with no number cards: 18 + 10 lost
  check(C.scoreStack(['ace-of-waves', waves('crown')]).score === -28,
    'Ace+Crown alone loses 28');

  // optimal payment: 3+5+7+9 Moons totals 24; 9+7+3 = 18 exactly beats 9+7+5 = 21
  const moons = (r3) => find(r3, ['moons']);
  const mixed = [moons(3), moons(5), moons(7), moons(9)];
  check(mixed.every(Boolean), 'moons fixture cards exist');
  check(C.scoreStack(mixed).score === 5, `3+5+7+9 Moons scores 5, got ${C.scoreStack(mixed).score}`);

  check(C.minUpkeep([9, 8]) === null, 'below 18 there is no upkeep payment');
  check(C.minUpkeep([9, 8, 2]).sum === 19, 'the closest payment to 18 wastes 1');
}

/* ---- a hand-built year end ---- */
{
  const waves = (r) => find(r, ['waves']);
  const suns = (r) => find(r, ['suns']);
  const bird0 = ['ace-of-waves', waves(2), waves(3), waves(5), waves(6), waves(8), waves('crown')]; // 16
  const bird1 = [suns('crown'), suns(8), suns(4)];                                                 // -11
  const used = [...bird0, ...bird1];
  const leftover = BASIC.find((id) => !used.includes(id));
  const st = {
    seed: 1, year: 1, first: 0,
    hands: [[], [leftover]],
    draw: [], discard: BASIC.filter((id) => !used.includes(id) && id !== leftover),
    ranch: [[bird0], [bird1]],
    turn: 0, phase: 'year-end', mustDrawDeck: false,
    yeSeat: 1, yeDone: [true, false],
    scores: [0, 0], yearLog: [], lastScore: null,
    over: null, winner: null, moves: 0,
  };
  conserved(st, 'year-end fixture');
  const next = C.yeFinish(st);
  check(next.scores[0] === 16 && next.scores[1] === -11,
    `year scores ${next.scores} want 16 / -11`);
  check(next.over === 'year', `first three years end the year (${next.over})`);
  check(next.ranch[0][0].join() === ['ace-of-waves', waves(6), waves('crown')].join(),
    `upkeep leaves the Ace, 6 and Crown (${next.ranch[0][0]})`);
  check(next.discard.includes(waves(2), waves(3), waves(5), waves(8)), 'upkeep cards discarded');
  check(next.hands[1].length === 0, 'the leftover was discarded');
  conserved(next, 'year scored');

  const y2 = C.nextYear(next, BASIC);
  check(y2.year === 2 && y2.turn === 1 && y2.first === 1, 'the dealer flips each year');
  check(y2.scores[0] === 16 && y2.scores[1] === -11, 'totals carry over');
  check(y2.hands[0].length === 6 && y2.hands[1].length === 6 && y2.draw.length === 24,
    'the new year redeals');
  check(y2.over === null && y2.turn === 1, 'play resumes with the other seat');

  // four years make a game
  const last = { ...next, year: 4, ranch: [[], []] };
  const done = C.yeFinish({ ...last, phase: 'year-end', yeSeat: 1, yeDone: [true, false], over: null });
  check(done.over === 'game' && done.winner === 0, `after four years: ${done.over}/${done.winner}`);
}

/* ---- full random games: both seats played at random ---- */
let finished = 0, draws = 0, totalMoves = 0, winnerCounts = [0, 0], sumScores = [0, 0];
for (let seed = 1; seed <= 60; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 31 + 7);
  let guard = 0;
  while (guard++ < 20000) {
    if (st.over === 'year') { st = C.nextYear(st, BASIC); continue; }
    if (st.over === 'game') break;
    const acts = C.legalActions(st);
    if (!acts.length) { check(false, `seed ${seed}: no legal actions in ${st.phase}`); break; }
    // the acting seat can only ever touch its own hand
    const seat = C.seatOf(st);
    for (const a of acts) {
      if (a.id) check(st.hands[seat].includes(a.id),
        `seed ${seed}: action ${a.type} ${a.id} is not in seat ${seat}'s hand`);
    }
    st = C.applyAction(st, acts[Math.floor(rng() * acts.length)]);
    totalMoves++;
    conserved(st, `seed ${seed} move`);
  }
  if (st.over === 'game') {
    finished++;
    if (st.winner === null) draws++;
    else winnerCounts[st.winner]++;
    sumScores[0] += st.scores[0];
    sumScores[1] += st.scores[1];
    check(st.yearLog.length === 4, `seed ${seed}: ${st.yearLog.length} years`);
  } else {
    check(false, `seed ${seed}: game never finished (phase ${st.phase}, guard ${guard})`);
  }
  const json = JSON.parse(JSON.stringify(st));
  check(json.scores.length === 2 && json.yearLog.length === 4, `seed ${seed}: JSON round trip`);
}
check(finished === 60, `only ${finished}/60 random games finished`);
check(draws <= 6, `random games drew ${draws} times (expected few)`);
check(winnerCounts[0] > 0 && winnerCounts[1] > 0, 'both seats should win sometimes');
check(totalMoves > 600, `only ${totalMoves} moves played`);

console.log(`random games: ${finished} finished, ${totalMoves} moves, ` +
  `avg score ${((sumScores[0] + sumScores[1]) / (2 * finished)).toFixed(1)}, draws ${draws}`);
console.log(failures === 0 ? 'emu-ranchers: all tests passed' : `emu-ranchers: ${failures} failures`);
process.exit(failures ? 1 : 0);

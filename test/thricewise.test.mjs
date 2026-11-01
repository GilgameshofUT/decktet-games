// Headless tests for Thricewise: node test/thricewise.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/thricewise-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const rank = (id) => (byId[id].rank === 'crown' ? 10 : byId[id].rank);
const cell = (r, c, id) => ({ r, c, id });

function allIds(state) {
  return [
    ...state.grid.map((x) => x.id),
    ...state.hands[0], ...state.hands[1],
    ...state.deck,
    ...state.deferred[0], ...state.deferred[1],
  ];
}
function conserved(state, label) {
  const all = allIds(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/** A hand-built state: the wiki's example cards on the table, known hands. */
function fixtureState() {
  const grid = [
    cell(0, 0, 'the-diplomat'),   // 8 moons+suns
    cell(0, 1, 'the-pact'),       // 9 moons+suns
    cell(1, 0, 'the-battle'),     // 4 daemons+crowns
    cell(1, 1, 'the-sailor'),     // 4 waves+leaves
  ];
  const hands = [
    ['the-discovery', 'the-forest', 'the-mountain'],    // 5 suns+waves, 5 moons+leaves, 4 moons+suns
    ['the-soldier', 'the-lunatic', 'the-penitent'],     // 5 daemons+crowns, 6 moons+waves, 6 suns+daemons
  ];
  const used = [...grid.map((x) => x.id), ...hands[0], ...hands[1]];
  return {
    seed: 42,
    grid, hands,
    deck: BASIC.filter((id) => !used.includes(id)),
    deferred: [[], []],
    picks: [null, null], choosing: 0, queue: [], reveal: null,
    turnPlacements: [], phase: 'choose', scores: [0, 0], log: [],
    turn: 1, moves: 0, over: null, winner: null,
  };
}

/* ---- an independent scorer, to hold the core against ---- */
function indScoreAt(cells, r, c) {
  const m = new Map(cells.map((x) => [`${x.r},${x.c}`, x.id]));
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const seen = new Set();
  let total = 0;
  for (const [dr, dc] of DIRS) {
    for (const oo of [[1, 2], [-1, 1], [-2, -1]]) {
      const keys = oo.map((o) => `${r + dr * o},${c + dc * o}`);
      if (!keys.every((k) => m.has(k))) continue;
      const sig = [`${r},${c}`, ...keys].sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      const ids = [m.get(`${r},${c}`), ...keys.map((k) => m.get(k))];
      const suits = ids.map((id) => byId[id].suits);
      const ranks = ids.map(rank);
      let kinds = 0;
      for (const s of ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns']) {
        if (suits.every((x) => x.includes(s))) kinds++;
      }
      if (new Set(ranks).size === 1) kinds++;
      const sorted = [...ranks].sort((a, b) => a - b);
      if (sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1) kinds++;
      const numbers = ranks.filter((x) => x >= 2 && x <= 9);
      total += (numbers.length ? Math.min(...numbers) : 0) * kinds;
    }
  }
  return total;
}

/* ---- setup over 320 seeds ---- */
for (let seed = 1; seed <= 320; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 3 && st.hands[1].length === 3, `seed ${seed}: hands`);
  check(st.grid.length === 4 && st.deck.length === 26, `seed ${seed}: grid/deck ${st.grid.length}/${st.deck.length}`);
  check(st.phase === 'choose' && st.choosing === 0 && st.turn === 1, `seed ${seed}: start flags`);
  check(st.grid.every((x) => x.r >= 0 && x.r <= 1 && x.c >= 0 && x.c <= 1), `seed ${seed}: the 2x2`);
  check(JSON.parse(JSON.stringify(st)).grid.length === 4, `seed ${seed}: JSON round trip`);
  conserved(st, `seed ${seed}`);
}

/* ---- choosing ---- */
{
  let st = fixtureState();
  check(!C.canChoose(st, 1, 'the-sailor'), 'player 2 may not choose while player 1 is due');
  check(!C.canChoose(st, 0, 'the-sailor'), 'you may only choose a card you hold');
  let threw = false;
  try { C.choose(st, 0, 'the-sailor'); } catch { threw = true; }
  check(threw, 'choosing out of turn throws');

  st = C.choose(st, 0, 'the-discovery');            // a five
  check(st.choosing === 1 && st.phase === 'choose', 'the choice passes to player 2');
  check(st.picks[0] === 'the-discovery', 'the pick is recorded');
  threw = false;
  try { C.choose(st, 0, 'the-forest'); } catch { threw = true; }
  check(threw, 'choosing twice in one turn throws');

  st = C.choose(st, 1, 'the-lunatic');              // a six
  check(st.phase === 'place', 'both picks resolve into the laying phase');
  check(st.queue.map((q) => q.id).join() === 'the-discovery,the-lunatic',
    'lowest rank lays first');
  check(st.reveal.picks.join() === 'the-discovery,the-lunatic', 'the reveal records both picks');
  check(st.hands[0].length === 3, 'the picked card stays in hand until it is laid');
  conserved(st, 'after both picks');
}

/* ---- a tied choice defers both cards, face up ---- */
{
  let st = fixtureState();
  st = C.choose(st, 0, 'the-discovery');            // five of suns+waves
  st = C.choose(st, 1, 'the-soldier');              // five of daemons+crowns
  check(st.phase === 'choose' && st.choosing === 0, 'a tie defers and starts a fresh choice');
  check(st.picks[0] === null && st.picks[1] === null, 'picks are cleared');
  check(st.deferred[0].join() === 'the-discovery' && st.deferred[1].join() === 'the-soldier',
    'both cards are deferred, in front of their player');
  check(st.hands[0].length === 2 && st.hands[1].length === 2, 'deferred cards leave the hand');
  check(st.log.length === 1 && st.log[0].deferred === true, 'the deferral is logged');
  check(st.scores[0] === 0 && st.scores[1] === 0, 'a deferred turn scores nothing');
  conserved(st, 'after a deferral');

  // next turn: the deferred cards join the new ones, new card first
  st = C.choose(st, 0, 'the-forest');               // five of moons+leaves
  st = C.choose(st, 1, 'the-lunatic');              // six
  check(st.queue.map((q) => `${q.player}:${q.id}`).join() ===
    '0:the-forest,0:the-discovery,1:the-lunatic,1:the-soldier',
    'new card first, then deferred, lowest rank side first');
}

/* ---- laying: adjacency, the 6x6 window, and no double occupancy ---- */
{
  let st = fixtureState();
  st = C.choose(st, 0, 'the-discovery');
  st = C.choose(st, 1, 'the-lunatic');
  const legal = C.legalCells(st);
  const keys = new Set(legal.map((x) => C.cellKey(x.r, x.c)));
  check(keys.has('2,0'), 'below the grid is legal');
  check(keys.has('-1,-1'), 'the grid may grow up-left, diagonally touching');
  check(!keys.has('0,0') && !keys.has('0,1'), 'occupied squares are not legal');
  check(!keys.has('3,3'), 'a far square is not legal');

  const threws = [[0, 0], [0, 1], [1, 0], [1, 1], [3, 3]].map(([r, c]) => {
    try { C.place(st, r, c); return false; } catch { return true; }
  });
  check(threws.every(Boolean), 'occupied and far squares throw');

  let next = C.place(st, -1, -1);
  check(next.grid.length === 5, 'the card joined the grid');
  check(next.hands[0].length === 2, 'and left the hand');
  check(next.turnPlacements.length === 1 && next.turnPlacements[0].player === 0,
    'the placement is recorded for the turn');
  conserved(next, 'after the first lay');
  check(C.legalCells(next).length > 0, 'the second card can still be laid');
}

/* ---- a full row seals its own width but the grid may still grow taller ---- */
{
  const grid = [];
  for (let c = 0; c < 6; c++) grid.push(cell(0, c, BASIC[c]));
  const st = { ...fixtureState(), grid, phase: 'place' };
  const keys = new Set(C.legalCells(st).map((x) => C.cellKey(x.r, x.c)));
  check(!keys.has('0,-1') && !keys.has('0,6'), 'a six-wide grid cannot grow wider');
  check(keys.has('-1,3') && keys.has('1,3'), 'it can still grow taller on either side');
}

/* ---- scoring: two finished grids, computed on paper ---- */

// Grid A — the wiki's first example.  The Crown of Suns goes onto
// 8 of Moons+Suns and 9 of Moons+Suns.  Paper: one triple, two kinds —
// flush of suns, worth the lowest number card = 8; straight 8-9-Crown
// (Crown counts 10), also worth 8.  Total 16.
{
  const grid = [cell(0, 0, 'the-diplomat'), cell(0, 1, 'the-pact'), cell(0, 2, 'the-bard')];
  const sc = C.scoreAt(grid, 0, 2);
  check(sc.points === 16, `grid A: ${sc.points}, paper says 16`);
  check(sc.kinds.length === 1, `grid A: ${sc.kinds.length} line, paper says 1`);
  check(sc.kinds[0].kinds.map((k) => k.kind).sort().join() === 'flush,straight',
    'grid A: a flush and a straight on the same three cards');
  check(sc.kinds[0].value === 8, 'grid A: worth the 8, the lowest number card');
  check(indScoreAt(grid, 0, 2) === 16, 'grid A: independent scorer agrees');
}

// Grid B — the wiki's second example.  The Soldier (5 of Daemons+Crowns)
// goes into the middle of a cross.  Paper: the row 4-5-8 shows Daemons on
// all three (+4) and Crowns on all three (+4); the column 5-5-5 is a set,
// worth the lowest number card = 5.  Two triples share the Soldier.
// Total 4 + 4 + 5 = 13.
{
  const grid = [
    cell(1, 0, 'the-battle'), cell(1, 2, 'the-betrayal'),
    cell(0, 1, 'the-discovery'), cell(2, 1, 'the-forest'),
    cell(1, 1, 'the-soldier'),
  ];
  const sc = C.scoreAt(grid, 1, 1);
  check(sc.points === 13, `grid B: ${sc.points}, paper says 13`);
  check(sc.kinds.length === 2, `grid B: ${sc.kinds.length} lines, paper says 2`);
  const flat = sc.kinds.flatMap((l) => l.kinds.map((k) => k.kind)).sort().join();
  check(flat === 'flush,flush,set', `grid B kinds: ${flat}`);
  check(indScoreAt(grid, 1, 1) === 13, 'grid B: independent scorer agrees');
}

/* ---- scoring details: value rules and double suits ---- */
{
  // Three Crowns in a row: a set, but Crowns are not number cards → 0.
  const crowns = [cell(0, 0, 'the-bard'), cell(0, 1, 'the-sea'), cell(0, 2, 'the-end')];
  let sc = C.scoreAt(crowns, 0, 2);
  check(sc.points === 0, `three crowns: ${sc.points}, paper says 0`);
  check(sc.kinds[0].kinds.length === 1 && sc.kinds[0].kinds[0].kind === 'set',
    'three crowns is still a set — it just scores nothing');

  // Ace-2-3 of moons: flush of moons (2) + straight (2) = 4, lowest number card 2.
  const run = [cell(0, 0, 'ace-of-moons'), cell(0, 1, 'the-author'), cell(0, 2, 'the-journey')];
  sc = C.scoreAt(run, 0, 2);
  check(sc.points === 4, `A-2-3 of moons: ${sc.points}, paper says 4 (flush 2 + straight 2)`);

  // Crowns do not wrap: 9-Crown-Ace is not a straight; it is a moons flush,
  // worth the lowest number card = 9.
  const wrap = [cell(0, 0, 'the-pact'), cell(0, 1, 'the-huntress'), cell(0, 2, 'ace-of-moons')];
  sc = C.scoreAt(wrap, 0, 2);
  check(sc.points === 9, `9-Crown-Ace: ${sc.points}, paper says 9 (one moons flush, no straight)`);
  const kinds = sc.kinds[0].kinds.map((k) => k.kind).sort().join();
  check(kinds === 'flush', `9-Crown-Ace kinds: ${kinds}`);
}

/* ---- placing scores exactly what the paper says, through the move ---- */
{
  let st = fixtureState();
  st = C.choose(st, 0, 'the-discovery');    // 5
  st = C.choose(st, 1, 'the-lunatic');      // 6
  st = C.place(st, -1, -1);                 // the discovery: nothing adjacent-completing yet?
  const placed = st.turnPlacements[0];
  check(placed.points === indScoreAt(st.grid, placed.r, placed.c),
    'the placed card scores what the independent scorer says');
  conserved(st, 'mid-turn');
}

/* ---- drawing: everyone or nobody ---- */
{
  let st = fixtureState();
  st = C.choose(st, 0, 'the-discovery');
  st = C.choose(st, 1, 'the-lunatic');
  st = C.place(st, -1, -1);
  st = C.place(st, -1, -2);
  check(st.phase === 'recap', 'a full turn ends in the recap');
  check(st.deck.length === 24, `deck after drawing: ${st.deck.length}, paper says 24`);
  check(st.hands[0].length === 3 && st.hands[1].length === 3, 'both players drew back to three');
  const entry = st.log[st.log.length - 1];
  check(entry.drew === true && entry.placements.length === 2, 'the turn is logged');

  const begun = C.beginTurn(st);
  check(begun.phase === 'choose' && begun.choosing === 0 && begun.turn === 2, 'the next turn starts');
  check(begun.picks[0] === null && begun.picks[1] === null, 'picks cleared');
  {
    let threw = false;
    try { C.beginTurn(begun); } catch { threw = true; }
    check(threw, 'beginTurn outside the recap throws');
  }

  // nobody draws when there are not enough cards for both
  const almost = fixtureState();
  almost.deck = [BASIC[30]];
  almost.phase = 'place';
  almost.queue = [{ player: 0, id: 'the-discovery' }, { player: 1, id: 'the-lunatic' }];
  almost.reveal = { picks: ['the-discovery', 'the-lunatic'] };
  let done = C.place(almost, -1, -1);
  done = C.place(done, -1, -2);
  const last = done.log[done.log.length - 1];
  check(last.drew === false, 'one card left: nobody draws');
  check(done.hands[0].length === 2 && done.hands[1].length === 2, 'hands stay short');
}

/* ---- the game ends: 36th card, or empty hands ---- */
{
  // 35 cards on the grid, one card left to lay → the 36th ends the game.
  const grid = [];
  const used = new Set();
  for (let i = 0; i < 35; i++) { grid.push(cell(Math.floor(i / 6), i % 6, BASIC[i])); used.add(BASIC[i]); }
  const last = BASIC[35];
  const st = {
    ...fixtureState(),
    grid, hands: [[last], []], deck: [], deferred: [[], []],
    phase: 'place',
    queue: [{ player: 0, id: last }],
    reveal: { picks: [last, last] },
    turnPlacements: [],
  };
  const done = C.place(st, 5, 5);
  check(done.over === 'done' && done.grid.length === 36, 'the 36th card ends the game');
  check(done.phase === 'recap', 'the last turn is still shown in the recap');
  check(done.winner === (done.scores[0] === done.scores[1] ? null : (done.scores[0] > done.scores[1] ? 0 : 1)),
    'the winner matches the scores');
  let threw = false;
  try { C.beginTurn(done); } catch { threw = true; }
  check(threw, 'no new turn after the game is over');
  conserved(done, 'the finished grid');

  // Empty hands end it too.
  const empty = fixtureState();
  empty.phase = 'place';
  empty.queue = [{ player: 0, id: 'the-discovery' }, { player: 1, id: 'the-lunatic' }];
  empty.reveal = { picks: ['the-discovery', 'the-lunatic'] };
  empty.hands[0] = ['the-discovery'];
  empty.hands[1] = ['the-lunatic'];
  empty.deck = [];
  let e = C.place(empty, -1, -1);
  e = C.place(e, -2, -1);
  check(e.over === 'done', 'empty hands at the end of a turn end the game');
  check(e.grid.length === 6, 'only the cards in hand were laid');
}

/* ---- the hidden-choice invariant: no pick leaks before the reveal ---- */
{
  let st = fixtureState();
  st = C.choose(st, 0, 'the-discovery');
  const pick = 'the-discovery';
  for (const viewer of [0, 1, null]) {
    const pub = C.conceal(st, viewer);
    check(pub.picks[0] === true && pub.picks[1] === null,
      `viewer ${viewer}: the pick is masked, not shown`);
    check(!JSON.stringify(pub.picks).includes(pick), `viewer ${viewer}: picks carry no card ids`);
  }
  check(!JSON.stringify(C.conceal(st, 1)).includes(pick),
    'the opponent cannot see the pick anywhere in the public view');
  check(!JSON.stringify(C.conceal(st, null)).includes(pick),
    'a spectator view carries neither hand nor pick');
  check(C.conceal(st, 0).hands[0].includes(pick), 'the chooser still sees their own hand');
  check(C.conceal(st, 0).hands[1] === null && C.conceal(st, 1).hands[0] === null,
    'a hand is only ever shown to its owner');

  // once the cards are laid, the choice is public knowledge again
  let live = C.choose(st, 1, 'the-lunatic');
  live = C.place(live, -1, -1);
  check(C.conceal(live, 1).hands[1].length === 3, 'during laying the placer still sees their own hand');
  check(C.conceal(live, 1).hands[0] === null, 'during laying the opponent hand stays hidden');
  check(live.reveal.picks.join() === 'the-discovery,the-lunatic', 'the reveal is public');
}

/* ---- full random playouts: 320 seeds, every move checked ---- */
let totalMoves = 0, totalPoints = [0, 0], winners = [0, 0, 0], maxTurns = 0;
for (let seed = 1; seed <= 320; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 8000) {
    const before = st.scores.slice();
    if (st.phase === 'choose') {
      const hand = st.hands[st.choosing];
      st = C.choose(st, st.choosing, hand[Math.floor(rng() * hand.length)]);
    } else if (st.phase === 'place') {
      const legal = C.legalCells(st);
      check(legal.length > 0, `seed ${seed}: no legal square with ${st.grid.length} laid`);
      const sq = legal[Math.floor(rng() * legal.length)];
      const laidBefore = st.grid.length;
      st = C.place(st, sq.r, sq.c);
      check(st.grid.length === laidBefore + 1, `seed ${seed}: exactly one card laid`);
      const entry = st.turnPlacements[st.turnPlacements.length - 1];
      const ind = indScoreAt(st.grid, entry.r, entry.c);
      check(entry.points === ind,
        `seed ${seed}: ${entry.points} scored, independent scorer says ${ind}`);
      check(st.scores[entry.player] === before[entry.player] + entry.points,
        `seed ${seed}: the placer's score moved by exactly the placement's points`);
    } else {
      st = C.beginTurn(st);
    }
    conserved(st, `seed ${seed} move ${st.moves}`);
    check(JSON.parse(JSON.stringify(st)).turn === st.turn, `seed ${seed}: JSON round trip`);
    totalMoves++;
  }
  check(st.over === 'done', `seed ${seed}: game never ended (guard ${guard})`);
  const [a, b] = st.scores;
  check(st.winner === (a === b ? null : (a > b ? 0 : 1)), `seed ${seed}: winner ${st.winner}`);
  check(st.grid.length + st.hands[0].length + st.deferred[0].length +
    st.deferred[1].length <= 36, `seed ${seed}: too many cards played`);
  const total = st.scores[0] + st.scores[1];
  check(total === st.log.reduce((n, e) =>
    n + e.placements.reduce((m, p) => m + p.points, 0), 0),
    `seed ${seed}: the pad and the scores agree`);
  winners[a === b ? 2 : (a > b ? 0 : 1)]++;
  totalPoints[0] += a; totalPoints[1] += b;
  maxTurns = Math.max(maxTurns, st.turn);
}

console.log(`random playouts: 320/320 finished, ${totalMoves} moves, ` +
  `average score ${(totalPoints[0] / 320).toFixed(1)}–${(totalPoints[1] / 320).toFixed(1)}, ` +
  `P1 wins ${winners[0]}, P2 wins ${winners[1]}, ties ${winners[2]}, longest game ${maxTurns} turns`);
console.log(failures === 0 ? 'thricewise: all tests passed' : `thricewise: ${failures} failures`);
process.exit(failures ? 1 : 0);

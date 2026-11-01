// Headless tests for Oh Quay: node test/oh-quay.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/oh-quay-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

const find = (rank, suits) => BASIC.find((id) => byId[id].rank === rank &&
  suits.every((s) => byId[id].suits.includes(s)));

function allCards(state) {
  return [...state.canals[0], ...state.canals[1], ...state.docks[0], ...state.docks[1],
    ...state.scores[0], ...state.scores[1], ...(state.pending ? [state.pending] : [])];
}
function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/** A hand-built table: only the fields the moves touch are meaningful. */
function table(spec) {
  return {
    seed: 0,
    canals: [spec.canal0 || [], spec.canal1 || []],
    docks: [spec.dock0 || [], spec.dock1 || []],
    scores: [spec.scores0 || [], spec.scores1 || []],
    turn: spec.turn ?? 0,
    phase: spec.phase || 'cargo',
    pending: spec.pending ?? null,
    over: null, finisher: null, points: null, winner: null, moves: 0,
  };
}

/* ---- setup ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.canals[0].length === 9 && st.canals[1].length === 9,
    `seed ${seed}: canals ${st.canals[0].length}/${st.canals[1].length}`);
  check(st.docks[0].length === 9 && st.docks[1].length === 9,
    `seed ${seed}: docks ${st.docks[0].length}/${st.docks[1].length}`);
  check(st.phase === 'cargo' && st.turn === 0 && !st.over, `seed ${seed}: phase/turn`);
  check(st.scores[0].length === 0 && st.scores[1].length === 0, `seed ${seed}: score piles`);
  conserved(st, `seed ${seed}`);
}
check(C.newGame(1, BASIC, 1).turn === 1, 'the second seat may take the first turn');

/* ---- cargo and insertion ---- */
{
  let st = C.newGame(7, BASIC);
  check(C.canCargo(st, 'own') && C.canCargo(st, 'foe'), 'both docks are open at the start');
  const foeTop = st.docks[1][0];
  const c = C.cargo(st, 'foe');
  check(c.pending === foeTop, 'the visible dock gives its front card');
  check(c.canals[1].join() === st.canals[1].join(), 'the opponent canal is untouched');
  check(c.phase === 'insert', 'cargo leads to insertion');

  const mid = Math.floor(c.canals[0].length / 2);
  const ins = C.insert(c, mid);
  check(ins.canals[0].length === 10 && ins.pending === null && ins.phase === 'launch',
    'the card joined the canal');
  check(ins.canals[0][mid] === foeTop, 'the card landed in the chosen spot');
  check(ins.canals[0].filter((x) => x === foeTop).length === 1, 'exactly one copy');
  conserved(ins, 'after insertion');

  let threw = false;
  try { C.insert(ins, 11); } catch { threw = true; }
  check(threw, 'an out-of-range insertion throws');
  threw = false; try { C.cargo(ins, 'own'); } catch { threw = true; }
  check(threw, 'cargo during the launch phase throws');
  threw = false; try { C.insert({ ...ins, phase: 'cargo' }, 0); } catch { threw = true; }
  check(threw, 'inserting during the cargo phase throws');

  const own = C.cargo({ ...st, phase: 'cargo' }, 'own');
  check(own.pending === st.docks[0][0], 'the blind dock gives its front card too');
}

/* ---- launching: rafts, gaps, ordering ---- */
{
  const w2 = find(2, ['waves']);       // the Origin
  const w4 = find(4, ['waves']);       // the Sailor
  const w6 = find(6, ['waves']);       // the Lunatic
  const m3 = find(3, ['moons']);       // the Journey
  const m5 = find(5, ['moons']);       // the Forest
  const s2 = find(2, ['suns']);        // the Desert
  const spare = BASIC.find((id) => ![w2, w4, w6, m3, m5, s2].includes(id));

  check(C.maxRaft([w2, w4, w6, m3]) === 3, 'same suit, ascending, gaps fine → 3');
  check(C.maxRaft([w2, w6]) === 2, 'a rank gap still lashes');
  check(C.maxRaft([w6, w4]) === 1, 'descending front is a single');
  check(C.maxRaft([s2, m3]) === 1, 'no shared suit is not a raft');
  check(C.maxRaft([m3, m5]) === 2, 'a dual-suit card joins on its moon side');
  check(C.maxRaft([]) === 0, 'an empty canal has no raft');

  const st = table({
    canal0: [w2, w4, w6, m3], dock0: [spare], dock1: [spare],
    scores0: [w2], phase: 'launch',
  });
  check(C.canLaunch(st, 1) && C.canLaunch(st, 2) && C.canLaunch(st, 3), '1..3 all legal');
  let threw = false;
  try { C.launch(st, 4); } catch { threw = true; }
  check(threw, 'launching the 4 cards (a Moon after Waves) throws');
  threw = false; try { C.launch(st, 0); } catch { threw = true; }
  check(threw, 'launching nothing throws');

  const n = C.launch(st, 3);
  check(n.docks[0][n.docks[0].length - 1] === w2, 'the front card goes to your own dock');
  check(n.docks[1][n.docks[1].length - 1] === w4, 'the next card goes to the opponent dock');
  check(n.scores[0].join() === [w2, w6].join(), 'the rest of the raft scores');
  check(n.canals[0].join() === [m3].join(), 'the rest of the canal stays');
  check(n.turn === 1 && n.phase === 'cargo' && n.moves === 1, 'the turn passes after a launch');
  check(n.canals[1].length === 0, 'the opponent canal was never touched');

  // a single card: back to your own dock, nothing scores
  const one = C.launch(table({ canal0: [m3], dock0: [spare], scores0: [w2], phase: 'launch' }), 1);
  check(one.docks[0][one.docks[0].length - 1] === m3 && one.scores[0].join() === [w2].join(),
    'a single card goes to your dock and scores nothing');
  check(one.over === 'end' && one.finisher === 0, 'an emptied canal ends the game');
  threw = false; try { C.launch({ ...one, over: 'end' }, 1); } catch { threw = true; }
  check(threw, 'launching after the game is over throws');
}

/* ---- a dock can run dry ---- */
{
  let st = C.newGame(11, BASIC);
  const before = st.docks[0].length;
  const starve = (s) => (s.turn === 0 ? 'foe' : 'own');   // always docks[1]
  let guard = 0;
  while (st.docks[1].length && guard++ < 40) {
    st = C.cargo(st, starve(st));
    st = C.insert(st, 0);
    st = C.launch(st, 1);
    conserved(st, `starving move ${guard}`);
  }
  check(!C.canCargo(st, starve(st)), 'the starved dock cannot be drawn from');
  check(C.canCargo(st, st.turn === 0 ? 'own' : 'foe'), 'the other dock still can');
  check(st.docks[0].length > before, 'your own dock grew by the singles');
  const c = C.cargo(st, st.turn === 0 ? 'own' : 'foe');
  check(c.phase === 'insert' && c.pending != null, 'the forced draw works');
}

/* ---- hand-computed scoring ---- */
{
  const w = (r) => find(r, ['waves']);
  const m = (r) => find(r, ['moons']);
  // the finisher (seat 0) launches their last card; the loser's canal holds a
  // Waves raft of 3 (2, 4, 6) and a Moons raft of 2 (3, 5) — two rafts.
  const loserCanal = [w(2), w(4), w(6), m(3), m(5)];
  check(loserCanal.every(Boolean), 'scoring fixture cards exist');
  const pool = BASIC.filter((id) => !loserCanal.includes(id));
  const [a1, a2, a3, a4, a5, a6] = pool;

  const st = table({
    canal0: [a1], canal1: loserCanal,
    scores0: [a2, a3, a4], scores1: [a5, a6],
    phase: 'launch',
  });
  const n = C.launch(st, 1);
  check(n.over === 'end' && n.finisher === 0, 'seat 0 finishes');
  check(n.points.join() === '5,2', `points ${n.points} want 5 / 2 (3 + 2 rafts vs 2)`);
  check(n.winner === 0, `winner ${n.winner}`);

  // greedy raft counting: a lone 6 blocks the 3-4 behind it
  check(C.raftsRemaining([w(6), m(3), w(4)]) === 2, 'a blocked front counts as its own raft');
  check(C.raftsRemaining([w(2), w(4), w(6), m(3), m(5)]) === 2, '2 rafts in the fixture canal');
  check(C.raftsRemaining([w(3)]) === 1, 'a single card is one raft');
  check(C.raftsRemaining([]) === 0, 'an empty canal has no rafts');

  // an exact tie is a draw, but the finisher is still recorded
  // (a1..a5 are the six court-free aces: canal1 = two singles = two rafts)
  const tie = table({
    canal0: [a1], canal1: [a3, a4],
    scores0: [], scores1: [a2, a5],
    phase: 'launch',
  });
  const t = C.launch(tie, 1);
  check(t.points.join() === '2,2', `tie points ${t.points} want 2 / 2`);
  check(t.winner === null && t.finisher === 0, 'a tie is a draw');
}

/* ---- the opponent's canal can never be touched ---- */
{
  let threw = false;
  let st = C.newGame(13, BASIC);
  const foeBefore = st.canals[1].join();
  const acts1 = C.legalActions(st);
  check(acts1.every((a) => a.type === 'cargo'), 'cargo phase offers only docks');
  st = C.applyAction(st, { type: 'cargo', which: 'own' });
  check(C.legalActions(st).every((a) => a.type === 'insert'), 'insert phase offers positions');
  st = C.applyAction(st, { type: 'insert', pos: st.canals[0].length });
  const launchActs = C.legalActions(st);
  check(launchActs.every((a) => a.type === 'launch' && a.k >= 1 && a.k <= C.maxRaft(st.canals[0])),
    'launch phase offers raft prefixes only');
  st = C.applyAction(st, launchActs[0]);
  check(st.canals[1].join() === foeBefore, 'the opponent canal is never touched');
  threw = false; try { C.applyAction(st, { type: 'launch', k: 1 }); } catch { threw = true; }
  check(threw, 'launching during the cargo phase throws');
  threw = false; try { C.applyAction(st, { type: 'insert', pos: 0 }); } catch { threw = true; }
  check(threw, 'inserting during the cargo phase throws');
  threw = false; try { C.applyAction(st, { type: 'teleport' }); } catch { threw = true; }
  check(threw, 'an unknown action throws');
}

/* ---- full random playouts: both seats played at random ---- */
let finished = 0, draws = 0, totalMoves = 0, winnerCounts = [0, 0], sumPoints = [0, 0];
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 31 + 7);
  let guard = 0;
  while (!st.over && guard++ < 5000) {
    const acts = C.legalActions(st);
    if (!acts.length) { check(false, `seed ${seed}: no legal actions in ${st.phase}`); break; }
    // every action belongs to the current seat's own canal — the only hidden
    // card (the blind dock draw) is simply the front of a dock
    st = C.applyAction(st, acts[Math.floor(rng() * acts.length)]);
    totalMoves++;
    conserved(st, `seed ${seed} move`);
  }
  if (st.over === 'end') {
    finished++;
    if (st.winner === null) draws++;
    else winnerCounts[st.winner]++;
    sumPoints[0] += st.points[0];
    sumPoints[1] += st.points[1];
    check(st.points[0] >= 0 && st.points[1] >= 0, `seed ${seed}: negative points`);
  } else {
    check(false, `seed ${seed}: game never finished (phase ${st.phase}, guard ${guard})`);
  }
  const json = JSON.parse(JSON.stringify(st));
  check(json.canals.length === 2 && json.points.join() === st.points.join(),
    `seed ${seed}: JSON round trip`);
}
check(finished === 300, `only ${finished}/300 random games finished`);
check(draws <= 90, `random games drew ${draws} times (expected few)`);
check(winnerCounts[0] > 50 && winnerCounts[1] > 50, 'both seats should win often');
check(totalMoves > 3000, `only ${totalMoves} moves played`);

console.log(`random games: ${finished} finished, ${totalMoves} moves, ` +
  `avg points ${((sumPoints[0] + sumPoints[1]) / (2 * finished)).toFixed(1)}, draws ${draws}`);
console.log(failures === 0 ? 'oh-quay: all tests passed' : `oh-quay: ${failures} failures`);
process.exit(failures ? 1 : 0);

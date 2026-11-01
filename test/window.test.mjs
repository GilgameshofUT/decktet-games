// Headless tests for Window: node test/window.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const D = { mulberry32: D_mulberry32 };

const C = await import('../web/js/games/window-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

function allCards(state) {
  return state.stacks.flatMap((s) => [...s.down, ...s.up]);
}

function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  const seen = new Set(all);
  if (seen.size !== 36) { check(false, `${label}: duplicate or missing card`); }
}

/** For hand-built boards: the move must neither create nor destroy a card. */
function sameCards(before, after, label) {
  const a = allCards(before).slice().sort().join('|');
  const b = allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
}

/* ---- setup invariants ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.stacks.length === 9, `seed ${seed}: ${st.stacks.length} stacks`);
  check(st.stacks.every((s) => s.down.length === 3 && s.up.length === 1),
    `seed ${seed}: stack shape ${st.stacks.map((s) => s.down.length + '/' + s.up.length)}`);
  conserved(st, `seed ${seed}`);
  check(st.moves === 0, `seed ${seed}: moves ${st.moves}`);
}

/* ---- rank adjacency, including the Ace/Crown wrap ---- */
const meet = [
  [4, 3, true], [4, 5, true], [4, 4, false], [4, 6, false],
  [1, 2, true], [2, 1, true], [10, 9, true], [9, 10, true],
  [1, 10, true], [10, 1, true],        // the wrap
  [1, 3, false], [10, 8, false], [1, 8, false],
];
for (const [a, b, want] of meet) {
  check(C.ranksMeet(a, b) === want, `ranksMeet(${a},${b}) = ${C.ranksMeet(a, b)}, want ${want}`);
}

/* ---- a hand-built board: legality and the flip ---- */
function board(spec) {
  const stacks = Array.from({ length: 9 }, (_, i) => {
    const s = spec[i] || { down: [], up: [] };
    return { down: [...(s.down || [])], up: [...(s.up || [])] };
  });
  return { seed: 0, stacks, moves: 0, over: null };
}
const card = (n) => BASIC.find((id) => byId[id].rank === n && byId[id].suits.length === 2)
  || BASIC.find((id) => byId[id].rank === n);

{
  const st = board({
    0: { down: [card(7), card(8)], up: [card(4)] },
    1: { down: [card(2)], up: [card(6), card(5)] },   // top of the pile is the 5
    3: { up: [card(9)] },                             // below 0: 4 and 9 do not meet
  });

  check(C.canMove(st, 0, 1), '4 onto 5 should be legal');
  check(C.canMove(st, 1, 0), '5 onto 4 should be legal');
  check(!C.canMove(st, 0, 3), '4 and 9 do not meet');
  check(!C.canMove(st, 3, 0), '9 and 4 do not meet');
  check(!C.canMove(st, 0, 4), 'diagonals are not adjacent');
  check(!C.canMove(st, 0, 0), 'a stack may not move onto itself');
  check(!C.canMove(st, 4, 0), 'an empty stack has nothing to move');

  const next = C.applyMove(st, 0, 1);
  check(next.stacks[1].up.join() === [card(6), card(5), card(4)].join(),
    `pile order wrong: ${next.stacks[1].up}`);
  check(next.stacks[0].up.length === 1 && next.stacks[0].up[0] === card(8),
    'the source flipped its next face-down card');
  check(next.stacks[0].down.length === 1, 'source should have one face-down left');
  check(next.moves === 1, `moves ${next.moves}`);
  sameCards(st, next, 'after move');
  check(st.moves === 0, 'the original state must not be mutated');
}

/* ---- moving into an empty space ---- */
{
  const st = board({ 0: { up: [card(4)] } });          // stack 1 is empty and adjacent
  check(C.canMove(st, 0, 1), 'into an empty space needs no rank match');
  const next = C.applyMove(st, 0, 1);
  check(next.stacks[1].up.length === 1 && next.stacks[0].up.length === 0, 'pile relocated');
  sameCards(st, next, 'empty-space move');
}

/* ---- illegal moves throw ---- */
{
  const st = board({ 0: { up: [card(4)] }, 1: { up: [card(9)] } });
  for (const [a, b] of [[0, 0], [0, 4], [0, 1], [1, 0], [4, 0]]) {
    let threw = false;
    try { C.applyMove(st, a, b); } catch { threw = true; }
    check(threw, `applyMove(${a},${b}) should throw`);
  }
}

/* ---- winning ---- */
{
  const top = card(4);
  const last = card(5);                       // 5 meets 4, so the merge is legal
  const pile = BASIC.filter((id) => id !== top && id !== last).concat(top);
  const st = board({ 0: { up: pile }, 1: { up: [last] } });
  check(pile.length === 35, `pile has ${pile.length} cards`);
  check(!C.isWon(st), 'two piles is not a win');
  const next = C.applyMove(st, 1, 0);
  check(C.isWon(next), 'one face-up pile of 36 is a win');
  check(next.over === 'won', `over = ${next.over}`);
  conserved(next, 'won state');

  // …but a face-down card still hidden in the final pile means no win yet
  const st2 = board({ 0: { down: [last], up: pile } });
  check(!C.isWon(st2), 'a face-down card in the last pile is not a win');
  conserved(st2, 'unfinished final pile');
}

/* ---- losing: a full board where no two neighbours meet ---- */
{
  // ranks 2, 4 and 6 never meet each other, and there is no empty space
  const pool = [
    ...BASIC.filter((id) => byId[id].rank === 2),
    ...BASIC.filter((id) => byId[id].rank === 4),
    ...BASIC.filter((id) => byId[id].rank === 6),
  ];
  check(pool.length === 9, `pool has ${pool.length} cards`);
  const spec = {};
  pool.forEach((id, i) => { spec[i] = { up: [id] }; });
  const st = board(spec);
  check(C.legalMoves(st).length === 0, 'a 2/4/6 board has no legal move');
  C.settle(st);
  check(st.over === 'lost', `over = ${st.over}`);
}

/* ---- full random playouts (deterministic: seeded rng per game) ----
 *
 * A player that only ever prefers "flip a card" moves loops now and then — the
 * game has no rule against shuffling back and forth — so a handful of the 300
 * games are allowed to hit the move guard.  What must always hold is that
 * every move is legal and nothing is ever created or lost. */
let won = 0, lost = 0, unfinished = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = D.mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 2000) {
    const moves = C.legalMoves(st);
    if (!moves.length) break;
    const flipping = moves.filter((m) => st.stacks[m.from].down.length > 0);
    const pool = flipping.length ? flipping : moves;
    const m = pool[Math.floor(rng() * pool.length)];
    st = C.applyMove(st, m.from, m.to);
    conserved(st, `seed ${seed} move ${st.moves}`);
  }
  if (!st.over) unfinished++;
  else if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else { check(false, `seed ${seed}: over=${st.over}`); }
  const json = JSON.parse(JSON.stringify(st));
  check(json.stacks.length === 9, `seed ${seed}: JSON round trip lost stacks`);
}
check(unfinished <= 10, `${unfinished} of 300 games looped past the guard (expected <= 10)`);
check(won >= 150, `only ${won} of 300 games were won by a random player`);

/* ---- the game really can be won: a bounded search solves some deals ---- */
{
  let solved = 0;
  const budget = 250000;
  for (const seed of [1, 2, 3]) {
    let nodes = 0;
    const dfs = (state, depth) => {
      if (++nodes > budget || depth <= 0) return null;
      if (state.over === 'won') return [];
      const moves = C.legalMoves(state);
      moves.sort((a, b) => (state.stacks[b.to].up.length > 0) - (state.stacks[a.to].up.length > 0));
      for (const mv of moves) {
        const rest = dfs(C.applyMove(state, mv.from, mv.to), depth - 1);
        if (rest) return [mv, ...rest];
      }
      return null;
    };
    const solution = dfs(C.newGame(seed, BASIC), 150);
    if (solution) solved++;
  }
  check(solved >= 1, 'a search could not win any of seeds 1-3');
  console.log(`search: solved ${solved}/3 test deals`);
}

/* ---- JSON round trip of a mid-game state ---- */
{
  let st = C.newGame(99, BASIC);
  for (let i = 0; i < 25 && !st.over; i++) {
    const moves = C.legalMoves(st);
    if (!moves.length) break;
    st = C.applyMove(st, moves[0].from, moves[0].to);
  }
  const back = JSON.parse(JSON.stringify(st));
  check(C.legalMoves(back).length === C.legalMoves(st).length, 'legal moves differ after round trip');
}

console.log(`random playouts: ${won} won, ${lost} lost`);
console.log(failures === 0 ? 'window: all tests passed' : `window: ${failures} failures`);
process.exit(failures ? 1 : 0);

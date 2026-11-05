// Headless tests for Solo Hex: node test/solo-hex.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/solo-hex-core.js');
C.init(byId);

const ALL = manifest.cards.map((c) => c.id);          // the 45-card extended deck

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, label) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(threw, `${label} should throw`);
};

/** A hand-built state.  Fixture boards may reuse card ids to reach a branch;
 *  uniqueness is checked separately on real deals. */
function board(spec) {
  return {
    seed: 0,
    deckSize: 45,
    piles: Array.from({ length: 7 }, (_, i) => {
      const p = (spec.piles && spec.piles[i]) || {};
      const cards = [...(p.cards || [])];
      return {
        cards,
        up: p.up ?? (cards.length ? 1 : 0),
        sideways: p.sideways ?? null,
      };
    }),
    setAside: [...(spec.setAside || [])],
    moves: 0,
    over: null,
    loss: null,
    pending: null,
  };
}

/** Conservation: every card of the deck is somewhere, no card twice. */
function conserved(st, label) {
  const all = C.allCards(st);
  if (all.length !== 45) { check(false, `${label}: ${all.length} cards, want 45`); return; }
  if (new Set(all).size !== 45) check(false, `${label}: duplicate or missing card`);
}

/** Face-up bookkeeping must always hold. */
function sane(st, label) {
  st.piles.forEach((p, i) => {
    if (p.up < (p.cards.length ? 1 : 0) || p.up > p.cards.length) {
      check(false, `${label}: pile ${i} is ${p.cards.length} cards with ${p.up} face up`);
    }
  });
}

const ACE_M = 'ace-of-moons';     // moons
const ACE_S = 'ace-of-suns';     // suns
const ACE_L = 'ace-of-leaves';    // leaves
const ACE_W = 'ace-of-waves';    // waves
const BARD = 'the-bard';              // Crown of Suns
const HUNTRESS = 'the-huntress';       // Crown of Moons
const SEA = 'the-sea';                 // Crown of Waves
const BORDERLAND = 'the-borderland';    // Pawn, waves + leaves + daemons
const CONSUL = 'the-consul';          // Court, moons + waves + crowns
const EXCUSE = 'the-excuse';
const J = 'the-journey';            // 3, moons + waves
const D = 'the-discovery';          // 5, suns + waves
const S = 'the-savage';             // 3, leaves + daemons
const W = 'the-mill';               // 8, waves + leaves
const F = 'the-forest';             // 5, moons + leaves
const A2 = 'the-author';            // 2, moons + crowns
const PAINTER = 'the-painter';      // 3, suns + crowns

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, ALL);
  check(st.piles.length === 7, `seed ${seed}: ${st.piles.length} piles`);
  check(st.piles.map((p) => p.cards.length).join() === C.PILE_SIZES.join(),
    `seed ${seed}: sizes ${st.piles.map((p) => p.cards.length)}`);
  check(st.piles.every((p) => p.up === 1), `seed ${seed}: a pile does not start with one face up`);
  st.piles.forEach((p, i) => {
    const want = C.SIDEWAYS_PILES.includes(i) ? C.SIDeways_INDEX : null;
    if (p.sideways !== want) check(false, `seed ${seed}: pile ${i} sideways = ${p.sideways}, want ${want}`);
    if (want != null && !p.cards[want]) check(false, `seed ${seed}: pile ${i} has no sideways card`);
  });
  check(st.setAside.length === C.SET_ASIDE, `seed ${seed}: ${st.setAside.length} set aside`);
  check(st.deckSize === 45 && st.moves === 0 && !st.over && !st.pending, `seed ${seed}: counters`);
  conserved(st, `seed ${seed}`);
  sane(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.piles.length === 7 && json.piles[2].sideways === 3, `seed ${seed}: JSON round trip`);
}

/* ---- the hexagon: neighbour symmetry, no self-loops ---- */
{
  for (let i = 0; i < 7; i++) {
    check(!C.NEIGHBOURS[i].includes(i), `pile ${i} neighbours itself`);
    for (const j of C.NEIGHBOURS[i]) {
      check(C.NEIGHBOURS[j].includes(i), `neighbours are not symmetric: ${i} -> ${j}`);
    }
  }
  check(C.NEIGHBOURS[3].length === 6, 'the centre pile touches every other pile');
  check(C.NEIGHBOURS[0].join() === [1, 2, 3].join(),
    'top-left touches the top-right pile and the two middle piles below it');
  check(C.NEIGHBOURS[5].join() === [2, 3, 6].join(), 'bottom-left neighbours');
  check(C.NEIGHBOURS[4].join() === [1, 3, 6].join(), 'middle-right neighbours');
  // every outer pile touches the centre and exactly two ring neighbours
  for (const i of [0, 1, 2, 4, 5, 6]) {
    check(C.NEIGHBOURS[i].includes(3) && C.NEIGHBOURS[i].length === 3,
      `pile ${i} should touch the centre and two ring neighbours`);
  }
}

/* ---- a move carries the whole face-up stack ---- */
{
  // pile 2 holds [S face down, F and J face up]; pile 3's top (D) shares waves with J.
  const st = board({ piles: { 2: { cards: [S, F, J], up: 2 }, 3: { cards: [D] } } });
  check(C.canMove(st, 2, 3), 'moons/waves shares waves with suns/waves');
  const before = C.allCards(st).slice().sort().join('|');
  const next = C.applyMove(st, 2, 3);
  check(next.piles[3].cards.join() === [D, F, J].join(), `stack order: ${next.piles[3].cards}`);
  check(next.piles[3].up === 3, 'the receiving pile is all face up under the moved card');
  check(next.piles[2].cards.join() === [S].join() && next.piles[2].up === 1,
    'the pile left behind flips its next card face up');
  check(next.moves === 1, 'move counter');
  check(C.allCards(next).slice().sort().join('|') === before, 'a move neither creates nor destroys a card');
  check(st.moves === 0 && st.piles[2].cards.length === 3, 'the original state is not mutated');
  sane(next, 'after a stack move');

  // only the stack's TOP card is matched against the neighbour
  const under = board({ piles: { 2: { cards: [J, D], up: 2 }, 3: { cards: [HUNTRESS] } } });
  check(!C.canMove(under, 2, 3), 'suns/waves on top matches no Crown of Moons, whatever lies under it');
  const topWins = board({ piles: { 2: { cards: [D, J], up: 2 }, 3: { cards: [HUNTRESS] } } });
  check(C.canMove(topWins, 2, 3), 'the top card alone decides the move');

  // moving a whole pile empties it for the rest of the game
  const all = C.applyMove(board({ piles: { 2: { cards: [S, F, J], up: 3 }, 3: { cards: [D] } } }), 2, 3);
  check(all.piles[2].cards.length === 0 && all.piles[2].up === 0, 'the emptied pile is empty');
  check(!C.canMove(all, 3, 2), 'cards may not go back into an emptied pile');
  check(/empty for the rest of the game/.test(C.moveRejection(all, 3, 2)),
    'the empty-pile rejection explains itself');
}

/* ---- may-move branches: self, empties, non-adjacency, the Excuse ---- */
{
  // piles 0 (top-left) and 6 (bottom-right) are diagonal opposites — NOT
  // neighbours — even though the Savage and the Forest share leaves.
  const st = board({ piles: { 0: { cards: [S] }, 6: { cards: [F] }, 2: { cards: [J] }, 3: { cards: [D] } } });
  check(!C.canMove(st, 2, 2), 'a pile cannot move onto itself');
  check(!C.canMove(st, 4, 1), 'an empty pile has nothing to move');
  check(!C.canMove(st, 2, 6), 'an empty pile may not receive');
  check(!C.canMove(st, 0, 6), 'diagonally opposite piles cannot move even when the suits match');
  check(/not hexagonally adjacent/.test(C.moveRejection(st, 0, 6)), 'the adjacency rejection explains itself');
  throws(() => C.applyMove(st, 0, 6), 'a non-adjacent move');

  // …but the two piles of a row sit side by side and may move between them
  // (regression: the top and bottom rows used to be missing from the map).
  const across = board({ piles: { 0: { cards: [S] }, 1: { cards: [F] }, 5: { cards: [F] }, 6: { cards: [S] } } });
  check(C.canMove(across, 0, 1), 'the top row is adjacent across its own row');
  check(C.canMove(across, 1, 0), '…in both directions');
  check(C.canMove(across, 5, 6), 'the bottom row is adjacent across its own row');
  check(!C.canMove(across, 0, 5), 'the two left piles are a row apart, not adjacent');

  check(/cannot move onto itself/.test(C.moveRejection(st, 2, 2)), 'the self rejection explains itself');
  check(/shares no suit/.test(C.moveRejection(st, 2, 0) || C.moveRejection(st, 0, 2)),
    'the suit rejection explains itself');

  // the Excuse: a sink that never moves
  const ex = board({ piles: { 0: { cards: [S] }, 2: { cards: [EXCUSE] } } });
  check(!C.canMove(ex, 2, 0), 'the Excuse never moves');
  check(/Excuse never moves/.test(C.moveRejection(ex, 2, 0)), 'the Excuse rejection explains itself');
  check(C.canMove(ex, 0, 2), 'anything lands on the Excuse');
  check(C.moveRejection(ex, 0, 2) === null, 'no rejection when moving onto the Excuse');
}

/* ---- legalMoves enumerates the board ---- */
{
  // only the Journey (moons/waves) and the Discovery (suns/waves) share waves;
  // the Savages on piles 0 and 5 share nothing with anyone.
  const st = board({ piles: { 0: { cards: [S] }, 2: { cards: [J] }, 3: { cards: [D] }, 5: { cards: [S] } } });
  const moves = C.legalMoves(st).map((m) => `${m.from}->${m.to}`).sort().join();
  check(moves === '2->3,3->2', `legal moves ${moves}`);
  const pending = board({ piles: { 2: { cards: [J], up: 1 } } });
  pending.pending = { pile: 2, excuse: false };
  check(C.legalMoves(pending).length === 0, 'no moves while a sideways jump is pending');
  throws(() => C.applyMove(pending, 2, 3), 'no move while a sideways jump is pending');
}

/* ---- the sideways card: reveal, jump, flip out ---- */
{
  // pile 2 hides the Excuse fourth from the bottom; its top (F) moves away,
  // revealing the sideways Excuse, which must jump at once.
  const st = board({
    piles: {
      0: { cards: [HUNTRESS] },                       // Crown of Moons — sheetRank 12
      2: { cards: [A2, S, J, EXCUSE, F], up: 1, sideways: 3 },
      3: { cards: [W] },                              // shares leaves with F
      5: { cards: [ACE_S] },                          // Ace — sheetRank 1
    },
  });
  const next = C.applyMove(st, 2, 3);
  check(next.pending && next.pending.pile === 2 && next.pending.excuse === true,
    'revealing the sideways Excuse pauses the game');
  check(next.piles[2].up === 1, 'the revealed sideways card is face up');
  const targets = C.jumpTargets(next, 2);
  check(targets.length === 1 && targets[0] === 5,
    `a sideways Excuse jumps to the lowest-ranked neighbour (sheet order), got ${targets}`);
  const jumped = C.applyJump(next, 5);
  check(jumped.pending === null, 'the jump resolves the pause');
  check(jumped.piles[5].cards.join() === [ACE_S, EXCUSE].join() && jumped.piles[5].up === 2,
    'the Excuse lands face up on the Ace');
  check(jumped.piles[2].cards.join() === [A2, S, J].join() && jumped.piles[2].up === 1,
    'only the sideways card jumped; the pile beneath flips up');
  check(jumped.piles[2].sideways === null, 'the pile is no longer sideways');
  sane(jumped, 'after a jump');
  check(!C.canMove(jumped, 5, 3), 'the Excuse still never moves');

  // illegal jumps throw
  const mid = C.applyMove(st, 2, 3);
  throws(() => C.applyJump(mid, 0), 'the Crown of Moons is not the lowest-ranked target');
  throws(() => C.applyJump(mid, 2), 'a jump cannot go home');
  throws(() => C.applyJump(board({ piles: { 2: { cards: [J] } } }), 3), 'no pending, no jump');

  // a sideways jump moves exactly one card and costs no move
  check(jumped.moves === 1, 'the forced jump costs no move');
  const beforeJump = C.allCards(st).slice().sort().join('|');
  check(C.allCards(jumped).slice().sort().join('|') === beforeJump, 'the jump conserves the deck');
}

{
  // a sideways card that shares a suit jumps like any card
  const st = board({
    piles: {
      2: { cards: [A2, S, J, D, F], up: 1, sideways: 3 },   // D (suns/waves) is sideways
      3: { cards: [W] },                                    // shares leaves with F
      5: { cards: [SEA] },                                  // Crown of Waves — shares waves with D
    },
  });
  const next = C.applyMove(st, 2, 3);
  check(next.pending && next.pending.excuse === false, 'a normal sideways card also pauses the game');
  check(C.jumpTargets(next, 2).join() === [5].join(), 'it jumps to the one sharing pile');
  const jumped = C.applyJump(next, 5);
  check(jumped.piles[5].cards.join() === [SEA, D].join(), 'the sideways card lands face up');
  check(jumped.piles[2].sideways === null && jumped.piles[2].up === 1, 'the pile beneath flips up');
}

{
  // flip out: the revealed sideways card shares nothing with any neighbour
  const st = board({
    piles: {
      0: { cards: [ACE_L] },
      2: { cards: [A2, S, J, D, F], up: 1, sideways: 3 },   // D (suns/waves) is sideways
      3: { cards: [W] },                                    // F lands here (shares leaves)
      5: { cards: [HUNTRESS] },
    },
  });
  const next = C.applyMove(st, 2, 3);
  check(next.over === 'flipout' && next.loss === 'flipout', `over = ${next.over}, want flipout`);
  check(next.pending === null, 'no jump to resolve');
}

{
  // tie: two aces are equally low, the player picks
  const st = board({
    piles: {
      0: { cards: [ACE_M] },
      2: { cards: [A2, S, J, EXCUSE, F], up: 1, sideways: 3 },
      3: { cards: [W] },
      5: { cards: [ACE_S] },
    },
  });
  const next = C.applyMove(st, 2, 3);
  check(C.jumpTargets(next, 2).slice().sort().join() === [0, 5].join(),
    'a tie between two Aces leaves the choice to the player');
  check(C.jumpTargets(next, 2).includes(3) === false, 'the Mill (rank 8) is not among the lowest');
}

/* ---- the reference sheet's rank order, for the sideways Excuse ---- */
{
  check(C.sheetRank('ace-of-moons') === 1, 'an Ace is 1');
  check(C.sheetRank('the-author') === 2, 'a 2 is 2');
  check(C.sheetRank('the-sea') === 12, 'a Crown is above a Court');
  check(C.sheetRank(BORDERLAND) === 10, 'a Pawn is above the 9s and below a Court');
  check(C.sheetRank(CONSUL) === 11, 'a Court is above a Pawn');
  check(C.sheetRank(EXCUSE) === 0, 'the Excuse has no rank');
}

/* ---- ending: win, trap, stuck — hand-built ---- */
{
  const dealt = C.newGame(1, ALL).piles.flatMap((p) => p.cards);
  check(dealt.length === 41, `a deal puts 41 cards on the table, got ${dealt.length}`);

  // win: one pile, every card face up
  const wonBoard = board({ piles: { 0: { cards: dealt, up: dealt.length } } });
  check(C.isWon(wonBoard), 'one all-face-up pile is a win');
  C.settle(wonBoard);
  check(wonBoard.over === 'won', `over = ${wonBoard.over}, want won`);
  check(C.score(wonBoard) === 41, 'the winning score is the whole deal');

  // trap: one pile, one card still face down — no move can ever expose it
  const trap = board({ piles: { 0: { cards: dealt, up: dealt.length - 1 } } });
  check(!C.isWon(trap), 'a hidden card in the last pile is not a win');
  check(C.legalMoves(trap).length === 0, 'the last pile has nowhere to go');
  C.settle(trap);
  check(trap.over === 'stuck', `over = ${trap.over}, want stuck`);

  // stuck: seven single-card piles, no two neighbours sharing a suit
  const stuckBoard = board({
    piles: {
      0: { cards: [ACE_S] }, 1: { cards: [S] }, 2: { cards: [ACE_W] },
      3: { cards: [ACE_M] }, 4: { cards: [BARD] }, 5: { cards: [PAINTER] }, 6: { cards: [SEA] },
    },
  });
  check(C.legalMoves(stuckBoard).length === 0, 'no two neighbouring tops share a suit');
  C.settle(stuckBoard);
  check(stuckBoard.over === 'stuck' && stuckBoard.loss === 'stuck', `over = ${stuckBoard.over}`);

  // score: the biggest pile
  const scored = board({ piles: { 0: { cards: dealt.slice(0, 12), up: 3 }, 1: { cards: dealt.slice(12, 19), up: 2 } } });
  check(C.score(scored) === 12, `score = ${C.score(scored)}, want 12`);
}

/* ---- full playouts: a random player and a heuristic player ---- */
function watch(st, label) {
  conserved(st, label);
  sane(st, label);
}

/** A random legal player.  It may shuffle cards back and forth, so a handful
 *  of games are allowed to hit the move guard — every move must still be
 *  legal and conserving. */
function randomPlayout(seed) {
  let st = C.newGame(seed, ALL);
  const rng = mulberry32(seed * 9176 + 31);
  let guard = 0;
  while (!st.over && guard++ < 2000) {
    if (st.pending) {
      const ts = C.jumpTargets(st, st.pending.pile);
      check(ts.length > 0, `seed ${seed}: a pending jump with no target`);
      st = C.applyJump(st, ts[Math.floor(rng() * ts.length)]);
      watch(st, `seed ${seed} after jump`);
      continue;
    }
    const moves = C.legalMoves(st);
    if (!moves.length) break;
    const m = moves[Math.floor(rng() * moves.length)];
    st = C.applyMove(st, m.from, m.to);
    watch(st, `seed ${seed} after move ${m.from}->${m.to}`);
  }
  if (st.over) check(['won', 'flipout', 'stuck'].includes(st.over), `seed ${seed}: over = ${st.over}`);
  return st;
}

/** A greedy player: prefer consolidating onto single-suit cards, avoid
 *  burying Pawns and Courts, jump sideways cards while the board is full of
 *  options, and keep the most future moves (the strategy a published
 *  playthrough describes). */
const isMulti = (id) => C.suitsOf(id).length > 1;
/** Board mobility, ignoring the pending pause: the state after the jump is
 *  what the move is really worth. */
const rawMob = (st) => {
  let n = 0;
  for (let f = 0; f < 7; f++) {
    if (!st.piles[f].cards.length) continue;
    for (const t of C.NEIGHBOURS[f]) if (C.canMove(st, f, t)) n++;
  }
  return n;
};
function heuristicPlayout(seed) {
  let st = C.newGame(seed, ALL);
  const rng = mulberry32(seed * 31337 + 7);
  let guard = 0;
  while (!st.over && guard++ < 600) {
    if (st.pending) {
      const ts = C.jumpTargets(st, st.pending.pile);
      let best = ts[0], bestScore = -Infinity;
      for (const t of ts) {
        const c = C.applyJump(structuredClone(st), t);
        const top = C.pileTop(c, t);
        const s = c.over === 'flipout' ? -1000 : C.legalMoves(c).length + (C.isExcuse(top) ? 0 : C.suitsOf(top).length) + rng();
        if (s > bestScore) { bestScore = s; best = t; }
      }
      st = C.applyJump(st, best);
      watch(st, `heuristic seed ${seed} after jump`);
      continue;
    }
    const moves = C.legalMoves(st);
    if (!moves.length) break;
    let best = moves[0], bestScore = -Infinity;
    for (const m of moves) {
      const c = C.applyMove(structuredClone(st), m.from, m.to);
      if (c.over === 'flipout') continue;
      let s = rawMob(c) * 2 + rng();
      if (c.pending) {
        const tj = C.jumpTargets(c, c.pending.pile);
        if (!tj.length) s = -1000; else s += tj.length;
      }
      if (st.piles[m.from].cards.length === st.piles[m.from].up) s += 6;   // empties a pile
      const covered = C.pileTop(st, m.to);
      if (C.isExcuse(covered)) s += 3;
      else if (!isMulti(covered)) s += 2;                                  // cover single-suit cards
      else if (C.suitsOf(covered).length === 3) s -= 3;                    // spare Pawns and Courts
      // don't strand the card the move flips up
      if (st.piles[m.from].cards.length > st.piles[m.from].up) {
        const nt = C.pileTop(c, m.from);
        if (!C.isExcuse(nt)) {
          s += C.NEIGHBOURS[m.from].filter((j) => C.pileTop(c, j) && C.canMove(c, m.from, j)).length;
        }
      }
      if (s > bestScore) { bestScore = s; best = m; }
    }
    if (bestScore === -Infinity) {           // every move flip outs: play one and take it
      st = C.applyMove(st, moves[0].from, moves[0].to);
      watch(st, `heuristic seed ${seed} after forced flip out`);
      continue;
    }
    st = C.applyMove(st, best.from, best.to);
    watch(st, `heuristic seed ${seed} after ${best.from}->${best.to}`);
  }
  check(!!st.over, `heuristic seed ${seed}: playout did not terminate`);
  return st;
}

let rWon = 0, rFlip = 0, rStuck = 0, rRan = 0;
for (let seed = 1; seed <= 300; seed++) {
  const st = randomPlayout(seed);
  if (!st.over) { rRan++; continue; }
  if (st.over === 'won') rWon++; else if (st.over === 'flipout') rFlip++; else rStuck++;
  const json = JSON.parse(JSON.stringify(st));
  check(C.legalMoves(json).length === C.legalMoves(st).length, `seed ${seed}: JSON round trip`);
}
check(rRan <= 10, `${rRan} of 300 random games looped past the guard (expected <= 10)`);

let hWon = 0, hFlip = 0, hStuck = 0;
for (let seed = 1; seed <= 500; seed++) {
  const st = heuristicPlayout(seed);
  if (st.over === 'won') hWon++; else if (st.over === 'flipout') hFlip++; else hStuck++;
}
check(hWon >= 1, `a strategy player won ${hWon}/500 games — the game should be winnable`);
check(hFlip <= 10, `a strategy player flip out ${hFlip}/500 times`);

console.log(`solo-hex: random playouts — ${rWon} won, ${rFlip} flip out, ${rStuck} stuck (of 300); ` +
  `strategy player — ${hWon} won, ${hFlip} flip out (of 500)`);
console.log(failures === 0 ? 'solo-hex: all tests passed' : `solo-hex: ${failures} failures`);
process.exit(failures ? 1 : 0);

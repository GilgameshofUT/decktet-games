// Headless tests for Bharg: node test/bharg.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/bharg-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

const find = (rank, suits) => BASIC.find((id) => byId[id].rank === rank &&
  suits.every((s) => byId[id].suits.includes(s)));

function allCards(state) {
  return [...state.hands[0], ...state.hands[1], ...state.draw, ...state.discard, ...state.acePile];
}
function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/* ---- setup ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 7 && st.hands[1].length === 7,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.phase === 'draw' && st.turn === 0, `seed ${seed}: phase/turn`);
  check(C.discardTop(st) && byId[C.discardTop(st)].rank !== 1,
    `seed ${seed}: discard top is an ace`);
  check(st.acePile.every((id) => byId[id].rank === 1), `seed ${seed}: ace pile holds aces`);
  conserved(st, `seed ${seed}`);
}

/* ---- bharg sets ---- */
{
  const sixes = BASIC.filter((id) => byId[id].rank === 6);
  check(sixes.length === 3, `three 6s? ${sixes.length}`);
  check(C.isBhargSet(sixes), 'the three 6s always form a bharg set');

  const two = [sixes[0], sixes[1]];
  check(!C.isBhargSet(two), 'two cards is not a set');

  const overlap = [find(2, ['waves', 'leaves']), find(4, ['waves', 'leaves'])];
  check(!C.isBhargSet(overlap), 'leaves (and waves) twice is not a set');

  const four = [
    BASIC.find((id) => byId[id].rank === 1 && byId[id].suits.join() === 'moons'),
    BASIC.find((id) => byId[id].rank === 'crown' && byId[id].suits.join() === 'suns'),
    find(7, ['waves', 'daemons']),
    find(6, ['leaves', 'crowns']),
  ];
  check(four.every(Boolean), 'wiki four-card example cards not found');
  check(C.isBhargSet(four), 'the wiki four-card bharg set should be valid');
}

/* ---- bound / unbound ---- */
{
  const ace = BASIC.find((id) => byId[id].rank === 1 && byId[id].suits.includes('moons'));
  const mountain = find(4, ['moons', 'suns']);      // ace-matched
  const diplomat = find(8, ['moons', 'suns']);      // ace-matched
  const savage = find(3, ['leaves', 'daemons']);    // matches nothing on its own
  check(ace && mountain && diplomat && savage, 'fixture cards missing');

  check(C.isFullyBound([mountain, diplomat], ace), 'two ace-matched cards are bound');
  check(C.isFullyBound([savage], ace) === false, 'an unmatched single card is not bound');
  check(C.isFullyBound([], null), 'an empty hand is bound');

  const hand = [mountain, diplomat, savage];
  const unbound = C.unboundCards(hand, ace);
  check(unbound.length === 1 && unbound[0] === savage, `unbound = ${unbound}`);
  check(C.scoreUnbound(hand, ace) === byId[savage].rank, 'score of unbound cards');

  // a set binds cards that the ace does not touch
  const sixes = BASIC.filter((id) => byId[id].rank === 6);
  check(C.isFullyBound(sixes, null), 'a full set binds itself with no ace');
  check(C.unboundCards(sixes, null).length === 0, 'no unbound cards in a full set');

  // a card may be in at most one set
  const cov = C.bestCovering([...sixes, mountain, diplomat], ace);
  const flat = cov.sets.flat();
  check(new Set(flat).size === flat.length, 'a card appeared in two sets');
  check(cov.covered === sixes.length + 2,
        `expected ${sixes.length + 2} covered, got ${cov.covered}`);
}

/* ---- drawing ---- */
{
  let st = C.newGame(7, BASIC);
  check(C.canDraw(st, 'deck') && C.canDraw(st, 'discard'), 'both draws open at start');
  const d = C.draw(st, 'deck');
  check(d.hands[0].length === 8 && d.phase === 'discard', 'draw fills the hand');
  check(st.hands[0].length === 7, 'the original state must not be mutated');
  let threw = false;
  try { C.draw(d, 'deck'); } catch { threw = true; }
  check(threw, 'drawing twice in one turn should throw');
}

/* ---- discarding ---- */
{
  let st = C.newGame(11, BASIC);
  st = C.draw(st, 'discard');
  const pick = st.hands[0][0];
  const next = C.discard(st, pick);
  check(next.turn === 1 && next.phase === 'draw', 'turn passes after a discard');
  check(byId[pick].rank === 1
    ? next.acePile[next.acePile.length - 1] === pick
    : next.discard[next.discard.length - 1] === pick, 'ace goes to the ace pile, rest to the discard');
  conserved(next, 'after discard');

  let threw = false;
  try { C.discard(next, 'not-a-card'); } catch { threw = true; }
  check(threw, 'discarding a card you do not hold should throw');
}

/* ---- winning a round ---- */
{
  const ace = BASIC.find((id) => byId[id].rank === 1 && byId[id].suits.includes('moons'));
  const sixes = BASIC.filter((id) => byId[id].rank === 6);      // a bharg set
  const moonly = (rank) => BASIC.find((id) => byId[id].rank === rank &&
    byId[id].suits.includes('moons'));
  const hand = [...sixes, moonly(5), moonly(8), moonly(9), moonly(2)];
  const foe = [find(2, ['waves', 'leaves']), find(7, ['waves', 'daemons']),
    find(9, ['leaves', 'crowns'])];

  const st = {
    seed: 1,
    hands: [hand, foe],
    draw: BASIC.filter((id) => ![...hand, ...foe, ace].includes(id)),
    discard: [], acePile: [ace],
    turn: 0, phase: 'discard', scores: [0, 0], round: 1, over: null, winner: null,
  };
  conserved(st, 'win fixture');

  const throwaway = moonly(9);            // dropping a moons card leaves the set + ace binds
  const won = C.discard(st, throwaway);
  check(won.over === 'round', `expected a win, got ${won.over}`);
  check(won.winner === 0, `winner ${won.winner}`);
  check(won.lastScore === 18, `foe should have 2+7+9 = 18 unbound, got ${won.lastScore}`);
  conserved(won, 'won round');

  // …and you cannot win before you have discarded
  const before = { ...st, phase: 'draw' };
  check(!C.isFullyBound(before.hands[0], C.aceTop(before)) ||
    before.phase !== 'discard', 'the win check only runs after a discard');
}

/* ---- rounds and the match ---- */
{
  const st = { ...C.newGame(3, BASIC), over: 'round', winner: 0 };
  st.scores = [48, 45];
  const next = C.nextRound(st, BASIC);
  check(next.round === 2, `round ${next.round}`);
  check(next.scores[0] === 48 && next.scores[1] === 45, 'scores carry over');
  check(next.over === null, 'match continues below the target');

  const done = C.nextRound({ ...st, scores: [50, 40], over: 'round', winner: 0, round: 4 }, BASIC);
  check(done.over === 'match' && done.winner === 0, `match end: ${done.over}/${done.winner}`);
}

/* ---- random matches ---- */
let movesPlayed = 0, roundsPlayed = 0, matchWinner = null, seedUsed = 0;
for (let seed = 1; seed <= 40 && !matchWinner; seed++) {
  seedUsed = seed;
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 31 + 7);
  let guard = 0;
  while (st.over !== 'match' && guard++ < 6000) {
    if (st.over === 'round') { st = C.nextRound(st, BASIC); roundsPlayed += 1; continue; }
    const moves = [];
    if (st.phase === 'draw') {
      if (C.canDraw(st, 'deck')) moves.push(() => C.draw(st, 'deck'));
      if (C.canDraw(st, 'discard')) moves.push(() => C.draw(st, 'discard'));
    } else {
      for (const id of st.hands[st.turn]) moves.push(() => C.discard(st, id));
    }
    if (!moves.length) break;
    st = moves[Math.floor(rng() * moves.length)]();
    movesPlayed++;
    conserved(st, `seed ${seed} move`);
  }
  if (st.over === 'match') matchWinner = st.winner;
  else check(false, `seed ${seed}: match never finished`);
}
check(movesPlayed > 30, `only ${movesPlayed} moves played`);
check(roundsPlayed >= 1, `only ${roundsPlayed} rounds played`);

console.log(`random matches: ${movesPlayed} moves in ${roundsPlayed} rounds, winner ${matchWinner} (seed ${seedUsed})`);
console.log(failures === 0 ? 'bharg: all tests passed' : `bharg: ${failures} failures`);
process.exit(failures ? 1 : 0);

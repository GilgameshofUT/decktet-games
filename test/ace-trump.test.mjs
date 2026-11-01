// Headless tests for Ace Trump: node test/ace-trump.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/ace-trump-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throwsWith = (fn, needle, msg) => {
  try { fn(); check(false, `${msg}: did not throw`); }
  catch (e) { check(e.message.includes(needle), `${msg}: message "${e.message}" lacks "${needle}"`); }
};

const rank = (n, suit) => BASIC.find((id) => byId[id].rank === n && byId[id].suits.includes(suit));
const crownOf = (suit) => BASIC.find((id) => byId[id].rank === 'crown' && byId[id].suits.includes(suit));
const aceOf = (suit) => BASIC.find((id) => byId[id].rank === 1 && byId[id].suits.includes(suit));

/** A hand-built state; the set-aside pile holds everything not in play. */
function pos({ hands, trick = [], trump = null, trumpSource = null }) {
  const used = new Set([...hands.flat(), ...trick.map((p) => p.id)]);
  return {
    seed: 0, cards: BASIC.slice(), handNo: 1, total: [0, 0], lastHand: null,
    hands: [hands[0].slice(), hands[1].slice()],
    setAside: BASIC.filter((id) => !used.has(id)),
    pile: [[], []], trick, trump, trumpSource, lastTrick: null,
    tricksWon: [0, 0], dealer: 0,
    leader: trick.length ? 1 - trick[0].player : 0,
    turn: trick.length ? 1 - trick[0].player : 0,
    moves: 0, over: null, winner: null,
  };
}

function allCards(state) {
  return [...state.hands[0], ...state.hands[1], ...state.setAside,
    ...state.pile[0], ...state.pile[1], ...state.trick.map((p) => p.id)];
}
function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/* ---- setup over many seeds ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 9 && st.hands[1].length === 9,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.setAside.length === 18, `seed ${seed}: set aside ${st.setAside.length}`);
  check(st.turn === st.leader && st.leader === 1 - st.dealer, `seed ${seed}: leader/turn`);
  check(st.trump === null && st.trick.length === 0, `seed ${seed}: fresh trick`);
  check(st.handNo === 1 && st.total[0] === 0 && st.total[1] === 0, `seed ${seed}: totals`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.hands[0].length === 9 && json.setAside.length === 18, `seed ${seed}: JSON round trip`);
}

/* ---- the trick kernel: keys, ordering, ties ---- */
{
  // the Sailor (4 waves/leaves) led, the Mill (8 waves/leaves) follows
  const plays = [{ id: rank(4, 'waves') }, { id: rank(8, 'waves') }];
  const keys = C.trickKeys(plays, null, plays[0].id);
  check(keys[0][0] === 1 && keys[1][0] === 1, 'both follow suit');
  check(C.bestIndex(keys) === 1, 'the higher card wins');

  // the Darkness (9 waves/daemons) led; the Author (2 moons/crowns) does not
  // follow it, so the 9 still wins
  const k2 = C.trickKeys([{ id: rank(9, 'daemons') }, { id: rank(2, 'moons') }], null, rank(9, 'daemons'));
  check(C.bestIndex(k2) === 0, 'only cards following suit win without trump');

  // trump: a low trump beats a high follower
  const k3 = C.trickKeys([{ id: rank(9, 'waves') }, { id: rank(2, 'moons') }], 'moons', rank(9, 'waves'));
  check(C.bestIndex(k3) === 1, 'a trump beats a higher non-trump');

  // synthetic tie (impossible in the basic deck): the later play takes it
  check(C.bestIndex([[1, 5], [1, 5]]) === 1, 'ties go to the later play');
  check(C.bestIndex([[0, 9], [1, 2]]) === 1, 'trump class outranks plain class');
}

/* ---- follow suit: legal and illegal plays ---- */
{
  const sailor = rank(4, 'waves');                     // waves + leaves
  const mill = rank(8, 'waves');                       // waves + leaves
  const betrayal = rank(8, 'daemons');                 // daemons + crowns
  const savage = rank(3, 'leaves');
  const penitent = rank(6, 'suns');                    // suns + daemons

  const mid = pos({ hands: [[savage], [mill, betrayal]],
    trick: [{ player: 0, id: sailor }] });
  conserved(mid, 'follow fixture');
  check(C.canPlay(mid, mill), 'following suit is legal');
  throwsWith(() => C.playCard(mid, betrayal), 'follow suit',
    'an off-suit play while holding a fitting card is refused');
  check(/must follow suit/.test(C.explainPlay(mid, betrayal)), 'the refusal explains itself');

  // void in the led suit: any card is legal, even a higher-ranked outsider
  const voidState = pos({ hands: [[savage], [betrayal, penitent]],
    trick: [{ player: 0, id: sailor }] });
  check(C.canPlay(voidState, betrayal), 'void in the led suit: any card is legal');
  const done = C.playCard(voidState, betrayal);
  check(done.tricksWon[0] === 1, 'the leader wins when the follower cannot follow');
  check(done.pile[0].length === 2 && done.turn === 0, 'collected, and the winner leads again');

  // leading: any held card is legal; strangers are not
  const fresh = C.newGame(5, BASIC);
  check(C.canPlay(fresh, fresh.hands[fresh.turn][3]), 'leading any held card is legal');
  throwsWith(() => C.playCard(fresh, 'not-a-card'), 'not in your hand', 'unknown card');
}

/* ---- hand-computed trick fixtures ----
   Every player holds a spare card so the hand cannot end mid-fixture. */
{
  // A — no trump, both follow: the Mill (8) beats the Sailor (4)
  let st = pos({ hands: [[rank(4, 'waves'), rank(3, 'leaves')], [rank(8, 'waves'), rank(2, 'suns')]] });
  conserved(st, 'fixture A');
  st = C.playCard(st, rank(4, 'waves'));
  st = C.playCard(st, rank(8, 'waves'));
  check(st.tricksWon[1] === 1 && st.pile[1].length === 2, 'A: higher follower wins');
  check(st.trump === null && st.lastTrick.winner === 1, 'A: no ace, no trump, winner recorded');
  check(st.turn === 1 && st.leader === 1, 'A: the winner leads the next trick');

  // B — follower void: the led 4 beats an off-suit 8
  st = pos({ hands: [[rank(4, 'waves'), rank(3, 'moons')], [rank(8, 'daemons'), rank(6, 'suns')]] });
  st = C.playCard(st, rank(4, 'waves'));
  st = C.playCard(st, rank(8, 'daemons'));
  check(st.tricksWon[0] === 1, 'B: leader wins when the follower is void');

  // C — trump already moons: the Huntress (Crown of Moons) wins though it
  // does not follow the led suit
  st = pos({ hands: [[rank(4, 'waves'), rank(2, 'suns')], [crownOf('moons'), rank(6, 'suns')]],
    trump: 'moons' });
  st = C.playCard(st, rank(4, 'waves'));
  st = C.playCard(st, crownOf('moons'));
  check(st.tricksWon[1] === 1, 'C: a trump wins even off-suit');
  check(st.trump === 'moons', 'C: trump survives the trick');

  // D — an ace played out of suit sets trump and wins as the only trump
  st = pos({ hands: [[rank(4, 'waves'), rank(3, 'moons')], [aceOf('suns'), rank(6, 'suns')]] });
  st = C.playCard(st, rank(4, 'waves'));
  st = C.playCard(st, aceOf('suns'));
  check(st.trump === 'suns' && st.trumpSource === aceOf('suns'), 'D: the ace sets trump');
  check(st.tricksWon[1] === 1, 'D: the lone trump takes the trick');

  // E — an ace that follows suit sets trump but loses to the higher trump
  st = pos({ hands: [[rank(8, 'moons'), rank(4, 'daemons')], [aceOf('moons'), rank(6, 'suns')]] });
  st = C.playCard(st, rank(8, 'moons'));               // the Diplomat, moons + suns
  st = C.playCard(st, aceOf('moons'));
  check(st.trump === 'moons', 'E: ace trump');
  check(st.tricksWon[0] === 1, 'E: the ace that decides trump does not win');

  // F — trump persists across tricks, and a later ace re-trumps
  st = pos({ hands: [[aceOf('waves'), rank(4, 'suns'), rank(9, 'leaves')],
    [rank(8, 'daemons'), rank(2, 'suns'), rank(6, 'suns')]] });
  st = C.playCard(st, aceOf('waves'));                 // leads the Ace of Waves
  st = C.playCard(st, rank(8, 'daemons'));             // void in waves: anything goes
  check(st.trick.length === 0 && st.tricksWon[0] === 1, 'F: trick one resolved');
  check(st.trump === 'waves' && st.turn === 0, 'F: waves trump, the ace won, leader again');
  st = C.playCard(st, rank(4, 'suns'));                // the Mountain follows its own lead
  st = C.playCard(st, rank(2, 'suns'));                // the Desert must follow suit
  check(st.trump === 'waves', 'F: trump persists when no ace is played');
  check(st.tricksWon[0] === 2, 'F: the 4 beats the 2 and neither is trump');

  st = pos({ hands: [[rank(4, 'suns'), rank(9, 'leaves')], [aceOf('moons'), rank(5, 'waves')]],
    trump: 'waves' });
  st = C.playCard(st, rank(4, 'suns'));                // the Mountain, waves still trump
  st = C.playCard(st, aceOf('moons'));                 // follows suit and re-trumps
  check(st.trump === 'moons', 'F2: the new ace re-trumps the trick');
  check(st.tricksWon[0] === 1, 'F2: the Mountain is now the higher trump');
}

/* ---- a full hand within one state: redealing ---- */
{
  let st = C.newGame(21, BASIC);
  const rng = mulberry32(99);
  let guard = 0;
  while (st.handNo === 1 && guard++ < 40) {
    const opts = C.legalPlays(st);
    st = C.playCard(st, opts[Math.floor(rng() * opts.length)]);
    conserved(st, 'mid-hand');
  }
  check(st.handNo === 2 && st.trick.length === 0, `hand two reached: ${st.handNo}`);
  check(st.hands[0].length === 9 && st.hands[1].length === 9, 'hand two redealt');
  check(st.dealer === 1, 'the deal alternates');
  check(st.trump === null, 'a new hand starts with no trump');
  check(st.total[0] + st.total[1] === 9, `hand one scored: ${st.total}`);
  check(st.lastHand && st.lastHand.handNo === 1 && st.lastHand.total[0] + st.lastHand.total[1] === 9,
    'lastHand records the hand');
  conserved(st, 'after redeal');
}

/* ---- full random matches: five hands, a real winner every time ---- */
let matches = 0, decisive = 0, totalTricks = 0, movesPlayed = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 31 + 7);
  let guard = 0;
  while (!st.over && guard++ < 300) {
    const opts = C.legalPlays(st);
    st = C.playCard(st, opts[Math.floor(rng() * opts.length)]);
    movesPlayed++;
    conserved(st, `seed ${seed} move`);
  }
  if (!st.over) { check(false, `seed ${seed}: match never finished (${guard} moves)`); continue; }
  matches++;
  totalTricks += st.total[0] + st.total[1];
  if (st.winner === 0 || st.winner === 1) decisive++;
  else check(st.total[0] === st.total[1], `seed ${seed}: draw without equal totals`);
  const expect = st.total[0] === st.total[1] ? null : (st.total[0] > st.total[1] ? 0 : 1);
  check(st.winner === expect, `seed ${seed}: winner ${st.winner} vs ${expect}`);
  check(st.total[0] + st.total[1] === 45, `seed ${seed}: ${st.total[0] + st.total[1]} tricks scored`);
  check(st.lastHand.tricks[0] === st.pile[0].length / 2 &&
    st.lastHand.tricks[1] === st.pile[1].length / 2,
  `seed ${seed}: last hand's tricks match the collected pile`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.over === 'match', `seed ${seed}: JSON round trip`);
}
check(decisive === 300, `only ${decisive} of ${matches} matches had a winner`);

console.log(`random matches: ${matches} finished, ${decisive} decisive, `
  + `${movesPlayed} moves, ${totalTricks} tricks scored in total`);
console.log(failures === 0 ? 'ace-trump: all tests passed' : `ace-trump: ${failures} failures`);
process.exit(failures ? 1 : 0);

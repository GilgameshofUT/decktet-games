// Headless tests for Ivory Tower: node test/ivory-tower.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/ivory-tower-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

/* ------------------------------------------------------------- fixtures */

const allCards = (s) => [...s.deck, ...s.draw, ...s.tower, ...s.reserves.flat()];

function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/** For hand-built boards: a move must neither create nor destroy a card. */
function sameCards(before, after, label) {
  const a = allCards(before).slice().sort().join('|');
  const b = allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
}

/** A hand-built position.  reserves: three arrays, lowest card first. */
function board(spec = {}) {
  return {
    seed: 0,
    deck: [...(spec.deck || [])],
    draw: [...(spec.draw || [])],
    tower: [...(spec.tower || [])],
    reserves: [0, 1, 2].map((i) => [...((spec.reserves || [])[i] || [])]),
    moves: 0,
    over: null,
  };
}

/* -------------------------------------------------- setup over many seeds */

for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.deck.length === 33, `seed ${seed}: deck ${st.deck.length}`);
  check(st.draw.length === 3, `seed ${seed}: draw ${st.draw.length}`);
  check(st.tower.length === 0, `seed ${seed}: tower not empty`);
  check(st.reserves.length === 3 && st.reserves.every((p) => p.length === 0),
    `seed ${seed}: reserves ${JSON.stringify(st.reserves)}`);
  check(st.moves === 0 && st.over === null, `seed ${seed}: moves ${st.moves} over ${st.over}`);
  conserved(st, `seed ${seed}`);
  for (const id of allCards(st)) check(BASIC.includes(id), `seed ${seed}: foreign card ${id}`);
}

/* -------------------------------------------------------- suit matching */

check(C.shareSuit('the-pact', 'the-author'), 'the Pact shares a suit with the Author');
check(!C.shareSuit('the-pact', 'the-mill'), 'the Pact and the Mill share nothing');
check(C.shareSuit('the-mill', 'the-market'), 'the Mill and the Market share Leaves');

/* ---------------------------------------------------------------- tower */

{
  // an Ace starts an empty tower; nothing else may
  check(C.canPlayToTower(board(), 'ace-of-moons'), 'an Ace starts the tower');
  check(!C.canPlayToTower(board(), 'the-author'), 'a 2 may not start the tower');
  check(!C.canPlayToTower(board(), 'the-windfall'), 'a Crown may not start the tower');

  // once started, one rank up, carrying the tower's suit
  const two = board({ tower: ['ace-of-moons'] });
  check(C.canPlayToTower(two, 'the-author'), '2 of Moons and Crowns continues a Moons tower');
  check(!C.canPlayToTower(two, 'the-desert'), '2 of Suns and Daemons is the wrong suit');
  check(!C.canPlayToTower(two, 'ace-of-moons'), 'the tower never repeats a rank');

  const three = board({ tower: ['ace-of-moons', 'the-author'] });
  check(C.canPlayToTower(three, 'the-journey'), '3 of Moons and Waves continues');
  check(!C.canPlayToTower(three, 'the-mountain'), 'a 4 may not follow a 2');
  check(!C.canPlayToTower(three, 'the-sailor'), 'a 4 of another suit may not follow a 2');

  // the Crown completes it
  const nine = board({ tower: ['ace-of-moons', 'the-author', 'the-journey', 'the-mountain',
    'the-forest', 'the-lunatic', 'the-chance-meeting', 'the-diplomat', 'the-pact'] });
  check(nine.tower.length === 9, `fixture tower has ${nine.tower.length} cards`);
  check(C.canPlayToTower(nine, 'the-huntress'), 'the Crown of Moons completes the tower');
  check(!C.canPlayToTower(nine, 'the-bard'), 'the Crown of Suns does not');
}

/* ------------------------------------------------------ resource piles */

{
  // a pile starts with a Crown, and only with a Crown
  check(C.canPlayToReserve(board(), 'the-windfall', 0), 'a Crown starts a pile');
  check(!C.canPlayToReserve(board(), 'the-pact', 0), 'a 9 may not start a pile');

  // one rank less, sharing no suit at all
  const one = board({ reserves: [['the-pact']] });
  check(C.canPlayToReserve(one, 'the-mill', 0), '8 of Waves and Leaves goes on the 9 of Moons and Suns');
  check(C.canPlayToReserve(one, 'the-betrayal', 0), '8 of Daemons and Crowns goes on it too');
  check(!C.canPlayToReserve(one, 'the-diplomat', 0), '8 of Moons and Suns shares a suit with it');
  check(!C.canPlayToReserve(one, 'the-journey', 0), 'a 3 is two ranks too low');

  const two = board({ reserves: [['the-mill']] });        // 8 of Waves and Leaves
  check(C.canPlayToReserve(two, 'the-castle', 0), '7 of Suns and Crowns goes on the Mill');
  check(!C.canPlayToReserve(two, 'the-chance-meeting', 0), '7 of Moons and Leaves shares Leaves');
  check(!C.canPlayToReserve(two, 'the-cave', 0), '7 of Waves and Daemons shares Waves');

  // the wiki's own example: Crown of Waves, then the Pact, then an 8 that is
  // neither Suns nor Moons
  const ex = board({ reserves: [['the-pact', 'the-sea']] });
  check(ex.reserves[0][0] === 'the-pact' && ex.reserves[0][1] === 'the-sea',
    'pile order: lowest card first, Crown at the bottom');
  check(C.canPlayToReserve(ex, 'the-mill', 0), 'an 8 of neither Suns nor Moons may follow the Pact');
  check(!C.canPlayToReserve(ex, 'the-diplomat', 0), 'the 8 of Suns and Moons may not');
  check(!C.canPlayToReserve(ex, 'the-castle', 0), 'nor may a 7 — the rank must step down one');
}

/* ----------------------------------------------------------- the moves */

{
  // the draw pile's top card → the tower
  const st = board({
    draw: ['the-forest', 'the-painter'],               // top of the draw pile: the Painter
    reserves: [['the-windfall'], [], []],
    tower: ['ace-of-suns', 'the-desert'],
  });
  check(C.cardOf(st, 'draw') === 'the-painter', 'the draw pile offers its top card');
  check(C.cardOf(st, 0) === 'the-windfall', 'a pile offers its lowest card');
  check(C.cardOf(st, 1) === null, 'an empty pile offers nothing');
  check(C.destinations(st, 'draw').join() === 'tower', 'the Painter only fits the tower');

  const next = C.applyMove(st, { src: 'draw', dest: 'tower' });
  check(next.tower.join() === ['ace-of-suns', 'the-desert', 'the-painter'].join(), 'tower order');
  check(next.draw.join() === ['the-forest'].join(), 'the draw pile exposed its next card');
  check(next.moves === 1, `moves ${next.moves}`);
  check(st.moves === 0 && st.tower.length === 2, 'the original state must not be mutated');
  sameCards(st, next, 'draw → tower');

  // a pile's lowest card → the tower
  const fromPile = board({
    reserves: [['the-painter', 'the-windfall'], [], []],
    tower: ['ace-of-suns', 'the-desert'],
  });
  const toTower = C.applyMove(fromPile, { src: 0, dest: 'tower' });
  check(toTower.reserves[0].join() === ['the-windfall'].join(), 'the pile lost its lowest card');
  check(toTower.tower.join() === ['ace-of-suns', 'the-desert', 'the-painter'].join(),
    'the 3 joined the tower');
  sameCards(fromPile, toTower, 'pile → tower');

  // a pile's lowest card → a fresh pile (a Crown may start one)
  const st2 = board({ reserves: [['the-windfall', 'the-castle'], [], []] });
  const moved = C.applyMove(st2, { src: 0, dest: 1 });
  check(moved.reserves[0].join() === ['the-castle'].join()
    && moved.reserves[1].join() === ['the-windfall'].join(), 'the Crown moved to a fresh pile');

  // illegal moves throw
  const bad = board({
    draw: ['the-desert'],
    reserves: [['the-market', 'the-windfall'], [], []],
    tower: ['ace-of-suns'],
  });
  check(throws(() => C.applyMove(bad, { src: 1, dest: 'tower' })), 'an empty pile has nothing to move');
  check(throws(() => C.applyMove(bad, { src: 'draw', dest: 0 })), 'the 2 may not go on the 6');
  check(throws(() => C.applyMove(bad, { src: 0, dest: 0 })), 'a pile may not feed itself');
  check(throws(() => C.applyMove(bad, { src: 'draw', dest: 'draw' })), 'the draw pile is no destination');
  check(throws(() => C.applyMove(bad, { src: 'draw', dest: 2 })), 'only a Crown starts a fresh pile');
  check(throws(() => C.applyMove(bad, { src: 'nope', dest: 'tower' })), 'unknown sources are refused');
}

/* -------------------------------------------------------- turning over */

{
  const st = board({ deck: ['the-battle', 'the-discovery', 'the-lunatic', 'the-castle'],
    draw: ['the-forest', 'the-desert'], tower: ['ace-of-suns'],
    reserves: [['the-pact', 'the-windfall'], [], []] });
  check(C.legalMoves(st).length === 1, 'the 2 of Suns and Daemons is the only play');
  check(!C.canTurnOver(st), 'while the top card fits somewhere, turning over is not allowed');
  check(throws(() => C.applyTurnOver(st)), 'and it throws');

  const stuck = board({ deck: ['the-battle', 'the-discovery', 'the-lunatic', 'the-castle'],
    draw: ['the-mountain'], reserves: [['the-pact', 'the-windfall'], [], []] });
  check(C.legalMoves(stuck).length === 0, 'nothing is playable in the stuck position');
  check(C.canTurnOver(stuck), 'with no play left, turning over is allowed');
  const turned = C.applyTurnOver(stuck);
  check(turned.deck.join() === ['the-battle'].join(), 'three cards left the deck');
  check(turned.draw.join() === ['the-mountain', 'the-castle', 'the-lunatic', 'the-discovery'].join(),
    'the draw pile takes the turned cards, the third one on top');
  check(turned.moves === 1, `moves ${turned.moves}`);
  sameCards(stuck, turned, 'turn over');

  // fewer than three cards left in the deck
  const thin = C.applyTurnOver(board({ deck: ['the-battle'], draw: ['the-mountain'],
    reserves: [['the-market'], ['the-pact'], []] }));
  check(thin.deck.length === 0 && thin.draw.join() === ['the-mountain', 'the-battle'].join(),
    'the last card is turned over too');

  // an empty deck flips the draw pile: the card at its bottom comes first
  const flip = C.applyTurnOver(board({ deck: [],
    draw: ['the-mountain', 'the-desert', 'the-castle', 'the-battle'],
    reserves: [['the-market'], ['the-pact'], []] }));
  check(flip.deck.join() === ['the-battle'].join(),
    'the draw pile was flipped face down, bottom card on top');
  check(flip.draw.join() === ['the-mountain', 'the-desert', 'the-castle'].join(),
    'and the card that was at its bottom is turned over first');
  check(throws(() => C.applyTurnOver(board())), 'with nothing at all, turning over throws');
}

/* -------------------------------------------------------------- winning */

{
  const moons = ['ace-of-moons', 'the-author', 'the-journey', 'the-mountain', 'the-forest',
    'the-lunatic', 'the-chance-meeting', 'the-diplomat', 'the-pact'];
  const st = board({ draw: ['the-huntress'], tower: moons, reserves: [['the-castle'], [], []] });
  check(!C.isWon(st), 'nine cards is not a tower');
  check(C.destinations(st, 'draw').includes('tower'), 'the Crown of Moons fits the tower');
  const next = C.applyMove(st, { src: 'draw', dest: 'tower' });
  check(C.isWon(next), 'the Crown completes the tower');
  check(next.over === 'won', `over = ${next.over}`);
  sameCards(st, next, 'winning move');
  check(C.score(next) === 10, 'the completed tower tops out at the Crown');
  check(!C.canTurnOver(next), 'a finished game takes no more actions');
  check(C.destinations(next, 0).length === 0, 'a finished game offers no destinations');
}

/* --------------------------------------------------------------- losing */

{
  // no card can be played, and a full recycle of the draw pile would only
  // bring the same unplayable card back
  const lost = board({
    draw: ['the-diplomat'],
    reserves: [['the-mountain'], ['the-market'], ['the-pact']],
  });
  check(C.legalMoves(lost).length === 0, 'no legal play in this position');
  C.settle(lost);
  check(lost.over === 'lost', `over = ${lost.over}`);

  // …but the same position with a card that *could* be played is still live
  const live = board({
    draw: ['the-mill'],                              // fits on the 9 of Moons and Suns
    reserves: [['the-mountain'], ['the-market'], ['the-pact']],
  });
  check(C.legalMoves(live).length === 1, 'exactly one play remains');
  check(!C.canTurnOver(live), 'a playable card blocks turning over');
  C.settle(live);
  check(live.over === null, 'a reachable play means the game goes on');

  // a card still in the deck keeps the game alive too — it comes up next
  const decked = board({
    deck: ['the-mill'],
    draw: ['the-diplomat'],
    reserves: [['the-mountain'], ['the-market'], ['the-pact']],
  });
  C.settle(decked);
  check(decked.over === null, 'cards still in the deck may yet be playable');

  // the limbo position: the cycle is dead and the tower cannot grow, but the
  // piles could still be shuffled around — the app calls that a loss rather
  // than letting shuffling go on for ever
  const zombie = board({
    draw: ['the-diplomat'],
    reserves: [['the-windfall'], ['the-pact'], ['the-mountain']],
  });
  check(C.legalMoves(zombie).length === 1, 'a shuffle is still legal in the zombie position');
  check(!C.towerMovePossible(zombie), 'and still nothing can reach the tower');
  C.settle(zombie);
  check(zombie.over === 'lost', `zombie over = ${zombie.over}`);
}

/* -------------------------------------------------- scoring fixtures */

{
  check(C.score(board()) === 0, 'an empty tower scores 0');
  check(C.score(board({ tower: ['ace-of-moons'] })) === 1, 'an Ace scores 1');
  check(C.score(board({ tower: ['ace-of-moons', 'the-author', 'the-journey', 'the-mountain'] })) === 4,
    'a tower topped by a 4 scores 4');
  check(C.score(board({ tower: ['ace-of-suns', 'the-desert', 'the-penitent'] })) === 6,
    'a tower topped by a 6 scores 6');
}

/* ---- the game really can be won: a rigged deal a careful player wins ---- *
 *
 *  The deck is ordered so that the Moons tower keeps coming up as the top
 *  card — one card at the end of every three-card packet — which is the
 *  shape of deal a winnable game needs.  A player who only ever adds a
 *  Moons card to the tower, buries the rest and turns cards over when
 *  nothing fits finishes it. */

{
  const moons = ['ace-of-moons', 'the-author', 'the-journey', 'the-mountain', 'the-forest',
    'the-lunatic', 'the-chance-meeting', 'the-diplomat', 'the-pact', 'the-huntress'];
  const junk = BASIC.filter((id) => !moons.includes(id));
  check(junk.length === 26, `the junk pile has ${junk.length} cards`);
  const topFirst = [];
  for (let k = 0; k < moons.length; k++) topFirst.push(junk.pop(), junk.pop(), moons[k]);
  topFirst.push(...junk);
  check(topFirst.length === 36, `the rigged deck has ${topFirst.length} cards`);

  let st = board({ deck: topFirst.slice().reverse() });
  st = C.applyTurnOver(st);                       // the setup's first three cards
  let guard = 0;
  while (!st.over && guard++ < 300) {
    const suit = st.tower.length ? byId[st.tower[0]].suits[0] : null;
    const fits = (id) => (suit ? byId[id].suits.includes(suit) : byId[id].rank === 1);
    const moves = C.legalMoves(st);
    const toTower = moves.filter((m) => m.dest === 'tower' && fits(C.cardOf(st, m.src)));
    const bury = moves.filter((m) => m.src === 'draw' && m.dest !== 'tower'
      && !fits(C.cardOf(st, m.src)));
    const mv = toTower[0] || bury[0] || null;
    if (mv) st = C.applyMove(st, mv);
    else if (C.canTurnOver(st)) st = C.applyTurnOver(st);
    else break;
  }
  check(st.over === 'won', `the rigged game did not win: over=${st.over}, tower ${st.tower.length}`);
  check(st.tower.join() === moons.join(), 'the tower holds the Moons cards in order');
  conserved(st, 'the rigged win');
  console.log(`rigged deal: won in ${st.moves} moves, ${st.reserves.reduce((n, p) => n + p.length, 0)} cards buried`);
}

/* ---- full random playouts (deterministic: one seeded rng per game) ---- */

let won = 0, lost = 0, stalled = 0, maxMoves = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = D_mulberry32(seed * 7919 + 13);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  let guard = 0, shuffles = 0, last = null;
  while (!st.over && guard++ < 3000) {
    const moves = C.legalMoves(st);
    const toTower = moves.filter((m) => m.dest === 'tower');
    const fromDraw = moves.filter((m) => m.src === 'draw');
    const shuffling = moves.filter((m) => m.src !== 'draw' && m.dest !== 'tower');
    let mv = null;
    if (toTower.length) mv = pick(toTower);
    else if (fromDraw.length) mv = pick(fromDraw);
    else if (shuffling.length && shuffles < 60 && rng() < 0.3) {
      // never immediately undo the last shuffle, or a two-move loop is easy
      const fresh = shuffling.filter((m) => !(last && m.src === last.dest && m.dest === last.src));
      mv = pick(fresh.length ? fresh : shuffling);
      last = mv;
      shuffles += 1;
    }
    if (mv) st = C.applyMove(st, mv);
    else if (C.canTurnOver(st)) st = C.applyTurnOver(st);
    else break;
    conserved(st, `seed ${seed} move ${st.moves}`);
  }
  if (!st.over) stalled++;
  else if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else check(false, `seed ${seed}: over=${st.over}`);
  if (st.moves > maxMoves) maxMoves = st.moves;
  if (st.over === 'lost') {
    const top = st.tower.length ? st.tower[st.tower.length - 1] : null;
    const expected = top ? byId[top].rank : 0;
    check(C.score(st) === expected, `seed ${seed}: score ${C.score(st)} vs tower top ${expected}`);
  }
  const json = JSON.parse(JSON.stringify(st));
  check(json.deck.length === st.deck.length && json.reserves.length === 3,
    `seed ${seed}: JSON round trip lost cards`);
}
check(stalled <= 5, `${stalled} of 300 games stalled the shuffling guard (expected <= 5)`);
console.log(`random playouts: ${won} won, ${lost} lost, ${stalled} stalled, max ${maxMoves} moves`);

/* ---- a JSON round trip of a mid-game state changes nothing ---- */
{
  let st = C.newGame(4242, BASIC);
  for (let i = 0; i < 30 && !st.over; i++) {
    if (C.canTurnOver(st)) st = C.applyTurnOver(st);
    else {
      const moves = C.legalMoves(st);
      if (!moves.length) break;
      st = C.applyMove(st, moves[0]);
    }
  }
  const back = JSON.parse(JSON.stringify(st));
  check(C.legalMoves(back).length === C.legalMoves(st).length, 'legal moves differ after round trip');
  check(C.canTurnOver(back) === C.canTurnOver(st), 'turning over differs after round trip');
  check(back.over === st.over, 'over differs after round trip');
}

console.log(failures === 0 ? 'ivory-tower: all tests passed' : `ivory-tower: ${failures} failures`);
process.exit(failures ? 1 : 0);

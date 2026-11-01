// Headless tests for Caravan: node test/caravan.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/caravan-core.js');
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

/* fixture cards, named for readability */
const journey = rank(3, 'moons');       // moons + waves
const mountain = rank(4, 'moons');      // moons + suns
const discovery = rank(5, 'suns');      // suns + waves
const origin = rank(2, 'waves');        // waves + leaves
const sailor = rank(4, 'waves');        // waves + leaves
const savage = rank(3, 'leaves');       // leaves + daemons
const soldier = rank(5, 'daemons');     // daemons + crowns
const penitent = rank(6, 'suns');       // suns + daemons
const mill = rank(8, 'waves');          // waves + leaves
const merchant = rank(9, 'leaves');     // leaves + crowns
const pact = rank(9, 'moons');          // moons + suns
const battle = rank(4, 'daemons');      // daemons + crowns
const sea = crownOf('waves');
const bard = crownOf('suns');
const windfall = crownOf('crowns');
const calamity = crownOf('daemons');
const aceMoon = aceOf('moons');
const aceWave = aceOf('waves');
const aceDaemon = aceOf('daemons');
const aceLeaf = aceOf('leaves');

/** A hand-built state; the set-aside pile holds everything not elsewhere. */
function pos({ hands, market = [windfall, aceLeaf], table = [], collected = [[], []],
  last = null, turn = 0, phase = 'respond', outPlayer = null,
  handNo = 1, scores = [0, 0], starter = null }) {
  const used = new Set([...hands.flat(), ...market, ...table, ...collected.flat()]);
  return {
    seed: 0, cards: BASIC.slice(), handNo, scores, starter, lastHand: null,
    hands: [hands[0].slice(), hands[1].slice()],
    market: market.slice(),
    aside: BASIC.filter((id) => !used.has(id)),
    collected: [collected[0].slice(), collected[1].slice()],
    table: table.slice(),
    seasonPlays: [], last, outPlayer, lastSeason: null,
    turn, phase, moves: 0, over: null, winner: null,
  };
}

function allCards(state) {
  return [...state.hands[0], ...state.hands[1], ...state.market, ...state.aside,
    ...state.collected[0], ...state.collected[1], ...state.table];
}
function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/* ---- setup over many seeds ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 15 && st.hands[1].length === 15,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.market.length === 2 && !C.shareSuit(st.market[0], st.market[1]),
    `seed ${seed}: market ${st.market}`);
  check(st.market.every((id) => byId[id].rank === 1 || byId[id].rank === 'crown'),
    `seed ${seed}: market cards are Aces/Crowns`);
  check(st.aside.length === 4, `seed ${seed}: set aside ${st.aside.length}`);
  for (const p of [0, 1]) {
    const aces = st.hands[p].filter((id) => byId[id].rank === 1).length;
    const crowns = st.hands[p].filter((id) => byId[id].rank === 'crown').length;
    check(aces === 2 && crowns === 2, `seed ${seed}: player ${p} holds ${aces} aces + ${crowns} crowns`);
  }
  check(st.phase === 'season-start' && st.turn === st.starter, `seed ${seed}: opener`);
  check(st.handNo === 1 && st.scores[0] === 0 && st.scores[1] === 0, `seed ${seed}: scores`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.hands[0].length === 15 && json.aside.length === 4, `seed ${seed}: JSON round trip`);
}

/* ---- caravans: what forms one ---- */
{
  const v = C.describePlay([journey, mountain, discovery]).values;
  check(v.join() === '3,4,5', `3-4-5 values ${v}`);
  check(C.describePlay([origin, journey, mountain]).values.join() === '2,3,4', '2-3-4');

  // a Crown standing in for the 6: 4-5-6 with a wild on top
  const wildTop = C.describePlay([mountain, discovery, sea]);
  check(wildTop.kind === 'caravan' && wildTop.top === 6 && wildTop.len === 3,
    'a Crown may stand in for a number rank');

  // an Ace standing in for the 2: A-3 is the run 2-3
  const wildLow = C.describePlay([aceMoon, journey]);
  check(wildLow.values.join() === '2,3', `ace low: ${wildLow.values}`);

  throwsWith(() => C.describePlay([mill, merchant, windfall]), 'rank 10',
    'a Crown cannot stand in for rank 10');
  throwsWith(() => C.describePlay([aceMoon, origin]), 'rank 1',
    'an Ace cannot stand in for rank 1');
  throwsWith(() => C.describePlay([journey, battle]), 'share a suit',
    'neighbours must share a suit');
  throwsWith(() => C.describePlay([journey, discovery]), 'run in order',
    'cards must be consecutive');
  throwsWith(() => C.describePlay([aceMoon, aceOf('suns')]), 'at least one number card',
    'two Aces are no caravan');
  throwsWith(() => C.describePlay([]), 'Pick at least one card', 'an empty selection');
}

/* ---- the bandit ladder and the comparisons ---- */
{
  const l1 = C.describePlay([aceMoon]);
  const l2 = C.describePlay([bard]);
  const l3 = C.describePlay([aceMoon, sea]);
  const l4 = C.describePlay([aceWave, sea]);
  check(l1.level === 1 && l2.level === 2 && l3.level === 3 && l4.level === 4,
    'bandit ladder levels');
  check(C.beatsPlay(l2, l1) && C.beatsPlay(l3, l2) && C.beatsPlay(l4, l3), 'ladder climbs');
  check(!C.beatsPlay(l4, C.describePlay([aceDaemon, calamity])), 'two same-suit bandits tie');

  const c345 = C.describePlay([journey, mountain, discovery]);
  const c456 = C.describePlay([mountain, discovery, penitent]);
  const c234 = C.describePlay([origin, journey, mountain]);
  const c4567 = C.describePlay([mountain, discovery, penitent, rank(7, 'suns')]);
  check(c4567.len === 4 && c4567.top === 7, '4-5-6-7 forms');
  check(C.beatsPlay(c456, c345), '4-5-6 beats 3-4-5');
  check(!C.beatsPlay(c234, c345), '2-3-4 is too low');
  check(!C.beatsPlay(c4567, c345), 'a different length cannot beat');
  check(!C.beatsPlay(c345, C.describePlay([rank(3, 'suns'), battle, soldier])),
    'equal strength does not beat');
  check(C.beatsPlay(l1, c345) && C.beatsPlay(l4, c4567), 'any bandit beats any caravan');
  check(!C.beatsPlay(c456, l1), 'no caravan beats a bandit');
}

/* ---- a full hand: caravan collection, going out, scoring ---- */
{
  let st = pos({ hands: [[journey, soldier, savage], [bard, pact]],
    market: [sea, aceLeaf], turn: 0, phase: 'season-start' });
  conserved(st, 'flow A start');

  st = C.play(st, [journey]);                    // opens with a lone 3
  check(st.phase === 'respond' && st.turn === 1, 'A: responding');
  check(C.canPlay(st, [pact]), 'A: a lone 9 beats a lone 3');

  st = C.play(st, [bard]);                       // a Crown bandit answers
  check(st.phase === 'respond' && st.turn === 0, 'A: back to the opener');
  st = C.pass(st);                               // the opener passes
  check(st.collected[0].join() === [journey, bard].join(),
    'A: a caravan season collects for the player who laid it');
  check(st.turn === 1 && st.phase === 'season-start',
    'A: the player who made the last play opens the next season');

  st = C.play(st, [pact]);                       // 9 caravan — and out
  check(st.phase === 'reply' && st.outPlayer === 1, 'A: going out opens the final reply');
  check(C.canPass(st), 'A: the reply may be a pass');
  throwsWith(() => C.play(st, [soldier]), 'does not beat', 'A: the 5 cannot answer the 9');
  throwsWith(() => C.pass(pos({ hands: [[journey], [bard]], turn: 0, phase: 'season-start' })),
    'nothing to pass', 'A: the season opener cannot pass');
  st = C.pass(st);                               // cannot beat, so pass: the hand ends
  check(st.handNo === 2, 'A: the hand ended and the next was dealt');
  const lh = st.lastHand;
  check(lh.out === 1 && lh.bonus.join() === '0,7', `A: bonus ${lh.bonus} (5 + 2 cards left)`);
  check(lh.goods.join() === '1,0', `A: goods ${lh.goods} (the journey shares waves with the Crown)`);
  check(lh.total.join() === '1,7', `A: totals ${lh.total}`);
  check(st.scores.join() === '1,7', 'A: cumulative scores');
  check(lh.leftover.join() === '2,0',
    'A: the two leftover cards are set aside, not collected');
  check(st.turn === 0, 'A: the lower score opens the next hand');
  conserved(st, 'flow A end');
}

/* ---- bandit collection goes to the opponent; both-out reply ---- */
{
  let st = pos({ hands: [[aceMoon, journey], [sea, pact]],
    market: [bard, aceLeaf], turn: 0, phase: 'season-start' });
  st = C.play(st, [journey]);                    // 3 caravan
  st = C.play(st, [sea]);                        // Crown bandit
  st = C.pass(st);                               // opener passes
  check(st.collected[0].join() === [journey, sea].join(),
    'B: a bandit season collects for the bandit\'s opponent');

  // the player to open again holds only an Ace, so the season passes over
  check(!C.canStart(st, 0) && C.canStart(st, 1), 'B: only the other player can open');
  check(st.turn === 1 && st.phase === 'season-start', 'B: the bandit player opens again');

  st = C.play(st, [pact]);                       // 9 caravan — and out
  check(st.phase === 'reply' && st.outPlayer === 1, 'B: out');
  check(C.canPlay(st, [aceMoon]), 'B: any bandit beats a caravan in the reply');
  st = C.play(st, [aceMoon]);                    // bandit reply — and it empties the hand too
  const lh = st.lastHand;
  check(lh.out === 1 && lh.bonus.join() === '5,5', `B: both-out bonus ${lh.bonus}`);
  check(lh.goods.join() === '0,1', `B: goods ${lh.goods} (the pact shares suns with the Crown)`);
  check(lh.total.join() === '5,6', `B: totals ${lh.total}`);
  check(lh.leftover.join() === '0,0', 'B: nothing left over when both go out');
  conserved(st, 'flow B end');
}

/* ---- neither player can open: the hand ends, goods only ---- */
{
  let st = pos({ hands: [[aceMoon, journey], [bard, sea]],
    market: [windfall, aceLeaf], collected: [[savage], []], turn: 0, phase: 'season-start' });
  st = C.play(st, [journey]);
  check(!C.canStart(st, 0) && !C.canStart(st, 1), 'C: neither can open');
  st = C.pass(st);
  check(st.handNo === 2, 'C: the hand ended anyway');
  check(st.lastHand.out === null, 'C: nobody went out');
  check(st.lastHand.bonus.join() === '0,0' && st.lastHand.goods.join() === '-1,0',
    'C: only goods score (savage under the Ace of Leaves)');
  check(st.scores.join() === '-1,0', 'C: nothing else to declare');
  conserved(st, 'flow C end');
}

/* ---- market scoring fixtures: +2, -2, 0 ---- */
{
  const mk = (market, collected) => pos({ hands: [[journey], [pact]], market, collected });
  check(C.goods(mk([bard, sea], [[discovery], []]))[0] === 2,
    'both Crowns: a double-suited card scores two');
  check(C.goods(mk([aceOf('suns'), aceWave], [[discovery], []]))[0] === -2, 'both Aces: minus two');
  check(C.goods(mk([bard, aceWave], [[discovery], []]))[0] === 0, 'Crown + Ace: they cancel');
  check(C.goods(mk([bard, aceLeaf], [[savage, soldier], []]))[0] === -1,
    'leaves cost 1 under the Ace of Leaves');
}

/* ---- illegal moves explain themselves ---- */
{
  const lastCaravan = { player: 0, ...C.describePlay([journey, mountain, discovery]) };
  const st = pos({ hands: [[], [origin, savage, sailor]], last: lastCaravan, turn: 1 });
  throwsWith(() => C.play(st, [origin, savage, sailor]), 'does not beat',
    '2-3-4 does not beat 3-4-5');

  const st2 = pos({ hands: [[], [pact]], last: { player: 0, ...C.describePlay([bard]) }, turn: 1 });
  throwsWith(() => C.play(st2, [pact]), 'cannot beat a bandit', 'a caravan cannot answer a bandit');

  const st3 = pos({ hands: [[], [aceDaemon, calamity]],
    last: { player: 0, ...C.describePlay([aceWave, sea]) }, turn: 1 });
  throwsWith(() => C.play(st3, [aceDaemon, calamity]), 'not higher',
    'a same-suit bandit does not beat another');

  const st4 = pos({ hands: [[bard, sea], [journey, pact]], turn: 0, phase: 'season-start' });
  throwsWith(() => C.play(st4, [bard]), 'opens with a caravan', 'a season cannot open with a bandit');
  throwsWith(() => C.play(st4, [bard, sea]), 'at least one number card',
    'two Crowns are no caravan either');

  const st5 = pos({ hands: [[journey, mountain], [discovery, pact]], turn: 1 });
  throwsWith(() => C.play(st5, [mill]), 'not in your hand', 'a card from outside the hand');
}

/* ---- full random matches: five hands, a real winner most of the time ---- */
let matches = 0, decisive = 0, movesPlayed = 0, handsPlayed = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 4000) {
    const plays = C.legalPlays(st);
    if (C.canPass(st) && (!plays.length || rng() < 0.25)) st = C.pass(st);
    else st = C.play(st, plays[Math.floor(rng() * plays.length)].ids);
    movesPlayed++;
    conserved(st, `seed ${seed} move`);
  }
  if (!st.over) { check(false, `seed ${seed}: match never finished (${guard} moves)`); continue; }
  matches++;
  handsPlayed += st.handNo - 1;
  if (st.winner === 0 || st.winner === 1) decisive++;
  else check(st.scores[0] === st.scores[1], `seed ${seed}: draw without equal scores`);
  const expect = st.scores[0] === st.scores[1] ? null : (st.scores[0] > st.scores[1] ? 0 : 1);
  check(st.winner === expect, `seed ${seed}: winner ${st.winner} vs ${expect}`);
  check(st.handNo === 5 && st.lastHand.handNo === 5, `seed ${seed}: five hands (${st.handNo})`);
  check(st.lastHand.total.join() === st.scores.join(), `seed ${seed}: totals recorded`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.over === 'match', `seed ${seed}: JSON round trip`);
}
check(decisive >= 250, `only ${decisive} of ${matches} matches had a winner`);

/* ---- a mid-hand JSON round trip keeps the same options ---- */
{
  let st = C.newGame(404, BASIC);
  const rng = mulberry32(3);
  for (let i = 0; i < 20 && !st.over; i++) {
    const plays = C.legalPlays(st);
    if (C.canPass(st) && rng() < 0.3) st = C.pass(st);
    else if (plays.length) st = C.play(st, plays[Math.floor(rng() * plays.length)].ids);
    else st = C.pass(st);
  }
  const back = JSON.parse(JSON.stringify(st));
  check(C.legalPlays(back).length === C.legalPlays(st).length, 'legal plays differ after round trip');
  check(C.canPass(back) === C.canPass(st), 'canPass differs after round trip');
}

console.log(`random matches: ${matches} finished (${handsPlayed} hands), ${decisive} decisive, `
  + `${movesPlayed} moves`);
console.log(failures === 0 ? 'caravan: all tests passed' : `caravan: ${failures} failures`);
process.exit(failures ? 1 : 0);

// Headless tests for Xing: node test/xing.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/xing-core.js');
C.init(byId);

const ALL45 = [...manifest.basicDeck, ...manifest.extendedDeck];
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throwsWith = (fn, needle, label) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  check(msg != null, `${label}: should throw`);
  if (msg != null) {
    check(msg.includes(needle), `${label}: error "${msg}" should mention "${needle}"`);
  }
};
const find = (rank, suits) => ALL45.find((id) => byId[id].rank === rank &&
  suits.every((s) => byId[id].suits.includes(s)));

const allCards = (st) => [
  C.EXCUSE, ...st.corridor, ...st.hands[0], ...st.hands[1],
  ...st.market.filter(Boolean), ...st.deck, ...st.discard,
];
function conserved(st, label) {
  const all = allCards(st);
  if (all.length !== 45) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 45) check(false, `${label}: duplicate or missing card`);
}

/* ---- fixtures ----
   The corridor below is the same twelve cards in every fixture; every other
   card used in a fixture comes from outside it, so all 45 stay distinct. */

const CORRIDOR = [
  find(2, ['waves', 'leaves']),    // 0 the Origin
  find(3, ['moons', 'waves']),     // 1 the Journey
  find(2, ['suns', 'daemons']),    // 2 the Desert
  find(4, ['moons', 'suns']),      // 3 the Mountain
  find(4, ['waves', 'leaves']),    // 4 the Sailor
  find(3, ['leaves', 'daemons']),  // 5 the Savage
  find(7, ['waves', 'daemons']),   // 6 the Cave
  find(5, ['moons', 'leaves']),    // 7 the Forest
  find(3, ['suns', 'crowns']),     // 8 the Painter
  find(4, ['daemons', 'crowns']),  // 9 the Battle
  'the-harvest',                   // 10 a Pawn
  'the-window',                    // 11 a Court
];
check(CORRIDOR.every(Boolean), 'corridor fixture cards missing');
check(CORRIDOR.filter((id) => byId[id].rank === 'pawn').length === 1, 'one Pawn in the fixture');
check(CORRIDOR.filter((id) => byId[id].rank === 'court').length === 1, 'one Court in the fixture');

// hand / market cards — none of them sits in the corridor above
const PACT = find(9, ['moons', 'suns']);        // number: Moons + Suns
const DARK = find(9, ['waves', 'daemons']);     // number: Waves + Daemons
const MILL = find(8, ['waves', 'leaves']);      // number: Waves + Leaves
const ACE_M = find(1, ['moons']);
const CHANCE = find(7, ['moons', 'leaves']);
const DIPLOMAT = find(8, ['moons', 'suns']);
const DISCOVERY = find(5, ['suns', 'waves']);
const LUNATIC = find(6, ['moons', 'waves']);
const LEAFCROWN = find(6, ['leaves', 'crowns']);
const MERCHANT = find(9, ['leaves', 'crowns']);
const SIX = [CHANCE, DIPLOMAT, DISCOVERY, LUNATIC, LEAFCROWN, MERCHANT];
check([PACT, DARK, MILL, ACE_M, ...SIX].every(Boolean), 'fixture hand cards missing');
check([...SIX].every((id) => !CORRIDOR.includes(id)), 'a market card sits in the corridor');

/** spec: null/'excuse' | 'home' | [card, slot] */
const F = (spec = []) => Array.from({ length: C.FROGS }, (_, i) => {
  const s = spec[i];
  if (s == null || s === 'excuse') return { k: 'excuse' };
  if (s === 'home') return { k: 'home' };
  return { k: 'card', card: s[0], slot: s[1] };
});

function makeState({ corridor = CORRIDOR, hands = [[], []], market = [],
  frogs = [F(), F()], turn = 0, actions = 0, pending = null, over = null, winner = null }) {
  const used = new Set([C.EXCUSE, ...corridor, ...hands[0], ...hands[1], ...market]);
  check(used.size === 1 + corridor.length + hands[0].length + hands[1].length + market.length,
    'fixture zones overlap');
  const deck = ALL45.filter((id) => !used.has(id));
  return {
    seed: 7, moves: 0, corridor, hands, market, deck, discard: [],
    frogs, turn, actions, pending, over, winner,
  };
}

/* ---- setup: 300 seeds ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, ALL45);
  check(st.corridor.length === C.CORRIDOR, `seed ${seed}: corridor ${st.corridor.length}`);
  const pawns = st.corridor.filter((id) => byId[id].rank === 'pawn');
  check(pawns.length === 4, `seed ${seed}: corridor pawns ${pawns.length}`);
  check(!st.corridor.includes(C.EXCUSE), `seed ${seed}: the Excuse is not in the corridor`);
  check(st.hands[0].length === 4 && st.hands[1].length === 4,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.market.length === 6 && st.market.every(Boolean), `seed ${seed}: market`);
  check(st.deck.length === 18, `seed ${seed}: deck ${st.deck.length}`);
  check(st.frogs.every((row) => row.length === 6 &&
    row.every((f) => f.k === 'excuse')), `seed ${seed}: frogs start at the Excuse`);
  check(st.turn === 0 && st.actions === 0 && st.pending === null && st.over === null,
    `seed ${seed}: turn state`);
  conserved(st, `seed ${seed}`);
  check(JSON.stringify(C.newGame(seed, ALL45)) === JSON.stringify(st),
    `seed ${seed}: newGame is not deterministic`);
}
check(JSON.stringify(C.newGame(1, ALL45).corridor) !== JSON.stringify(C.newGame(2, ALL45).corridor),
  'different seeds give different corridors');

/* ---- corridor crossing: the first free matching symbol ---- */
{
  // a frog at the Excuse plays the Pact (Moons, Suns): the first match is the
  // Journey's Moons symbol on card 1
  const st = makeState({ hands: [[PACT, DARK], []] });
  const next = C.advance(st, 0, 0, 0);
  check(next.frogs[0][0].k === 'card' && next.frogs[0][0].card === 1 &&
    next.frogs[0][0].slot === 0, `landed on ${JSON.stringify(next.frogs[0][0])}`);
  check(next.hands[0].length === 1 && next.discard.join() === st.hands[0][0],
    'the played card leaves the hand');
  check(next.actions === 1 && next.moves === 1, 'one action used');
  conserved(next, 'after an advance');

  // an occupied matching symbol is skipped: their frog covers the Journey's
  // Moons, so the frog lands on the Desert's Suns instead
  const blocked = makeState({
    hands: [[PACT, DARK], []],
    frogs: [F([[0, 0]]), F([null, [1, 0]])],
  });
  const skip = C.advance(blocked, 0, 0, 0);
  check(skip.frogs[0][0].card === 2 && skip.frogs[0][0].slot === 0,
    `skipped the covered Moons: ${JSON.stringify(skip.frogs[0][0])}`);

  // every Moons/Suns symbol ahead is covered → a self-explaining refusal
  const jammed = makeState({
    hands: [[PACT, DARK], []],
    frogs: [
      F([[0, 0], [3, 0], [3, 1], [7, 0], [8, 0], [10, 0]]),
      F([[1, 0], [2, 0], [10, 1], [11, 0]]),
    ],
  });
  throwsWith(() => C.advance(jammed, 0, 0, 0), 'is occupied', 'all matches covered');
  conserved(jammed, 'jammed fixture');

  // no matching symbol anywhere ahead → the frog goes home
  const open = makeState({
    hands: [[DARK], []],                     // Waves + Daemons: absent from cards 10–11
    frogs: [F([[9, 0]]), F()],
  });
  const home = C.advance(open, 0, 0, 0);
  check(home.frogs[0][0].k === 'home', `no match ahead: home (${home.frogs[0][0].k})`);
  conserved(home, 'home fixture');

  // …and finishing the last frog ends the game
  const lastFrog = makeState({
    hands: [[DARK], []],
    frogs: [F([[9, 0], 'home', 'home', 'home', 'home', 'home']), F()],
  });
  const won = C.advance(lastFrog, 0, 0, 0);
  check(won.over === 'win' && won.winner === 0, `game over: ${won.over}/${won.winner}`);
  conserved(won, 'at the win');

  // an Ace landing devours every other frog on the card
  const devoured = makeState({
    hands: [[ACE_M], []],
    frogs: [F([[0, 0]]), F([null, [1, 1]])],   // theirs on the Journey's Waves
  });
  const dev = C.advance(devoured, 0, 0, 0);
  check(dev.frogs[1][0].k === 'excuse' && dev.frogs[1][1].k === 'excuse',
    'a Crown/Ace landing devours the other frogs');
  check(dev.frogs[0][0].card === 1, 'the moving frog stays on the card');
  conserved(dev, 'devour fixture');

  throwsWith(() => C.advance(makeState({ hands: [[PACT], []], turn: 1 }), 0, 0, 0),
    "it is player 2's turn", 'playing out of turn');
  throwsWith(() => C.advance(makeState({ hands: [[PACT], []] }), 0, 5, 0),
    'no card in slot 6', 'a card you do not hold');
}

/* ---- moving back and taking a card ---- */
{
  // my frog on card 5; the Sailor and Mountain behind it are full → the
  // Desert on card 2 has room, first free symbol = Suns
  const st = makeState({
    hands: [[], []],
    market: SIX,
    frogs: [F([[5, 0]]), F([null, [4, 0], [4, 1], [3, 0], [3, 1]])],
    turn: 0, actions: 1,
  });
  const back = C.moveBack(st, 0, 0);
  check(back.frogs[0][0].card === 2 && back.frogs[0][0].slot === 0,
    `landed on ${JSON.stringify(back.frogs[0][0])}`);
  check(back.pending && back.pending.suit === 'suns', `pending suit ${back.pending && back.pending.suit}`);
  check(back.actions === 1 && back.moves === 1, 'the move-back is not complete until the card is taken');
  throwsWith(() => C.endTurn(back), 'finish taking your card', 'ending with a pending take');
  throwsWith(() => C.advance(back, 0, 0, 0), 'finish taking your card', 'acting with a pending take');

  const taken = C.takeCard(back, 0, 0);            // the Chance Meeting: Moons+Leaves
  check(taken.hands[0].length === 1 && taken.actions === 2 && taken.pending === null,
    'taking the card completes the action');
  check(taken.moves === 2, 'the take completes the same action');
  check(taken.market.filter(Boolean).length === 5, 'one market card gone');
  conserved(taken, 'after a take');

  throwsWith(() => C.takeCard(back, 0, 1), 'shares Suns', 'taking the forbidden suit');
  throwsWith(() => C.takeCard({ ...back, pending: null }, 0, 0), 'not waiting to take',
    'taking with nothing pending');
  throwsWith(() => C.moveBack(st, 0, 0, 5), 'not free', 'landing on an occupied symbol');

  // a frog at the Excuse cannot move back; neither can a frog at home
  throwsWith(() => C.moveBack(makeState({}), 0, 0), 'on the Excuse', 'moving back from the start');
  throwsWith(() => C.moveBack(makeState({ frogs: [F(['home']), F()] }), 0, 0), 'home',
    'moving back from home');

  // nothing behind has a free symbol → the Excuse, and any card may be taken
  const packed = makeState({
    hands: [[], []],
    market: SIX,
    frogs: [F([[2, 0]]), F([[1, 0], [1, 1], [0, 0], [0, 1]])],
    turn: 0, actions: 2,
  });
  const backExcuse = C.moveBack(packed, 0, 0);
  check(backExcuse.frogs[0][0].k === 'excuse', 'no room behind: back to the Excuse');
  check(backExcuse.pending && backExcuse.pending.suit === null,
    'the Excuse landing allows any card');
  const anyCard = C.takeCard(backExcuse, 0, 5);
  check(anyCard.hands[0].length === 1, 'any card may be taken from the Excuse');
  conserved(anyCard, 'excuse landing take');
}

/* ---- blocked players ---- */
{
  const blocked = makeState({
    hands: [[], []],
    market: SIX,
    frogs: [F(['excuse', 'excuse', 'home', 'home', 'home', 'home']), F()],
    turn: 0, actions: 0,
  });
  check(C.isBlocked(blocked, 0), 'a cardless player with no frogs out is blocked');
  const took = C.takeOnly(blocked, 0, 2);
  check(took.hands[0].length === 1, 'the blocked player takes a card');
  check(took.turn === 1 && took.actions === 0, 'the take uses the whole turn');
  conserved(took, 'blocked take');

  const notBlocked = makeState({
    hands: [[], []],
    market: SIX,
    frogs: [F([[2, 0], 'home', 'home', 'home', 'home', 'home']), F()],
    turn: 0,
  });
  throwsWith(() => C.takeOnly(notBlocked, 0, 0), 'only when blocked', 'taking while unblocked');
}

/* ---- turn structure ---- */
{
  const st = makeState({ hands: [[PACT], []], actions: 3 });
  throwsWith(() => C.advance(st, 0, 0, 0), 'three actions', 'a fourth action');
  throwsWith(() => C.moveBack(st, 0, 0), 'three actions', 'a fourth action (move back)');

  const idle = makeState({ hands: [[PACT], []], actions: 0 });
  throwsWith(() => C.endTurn(idle), 'at least one action', 'passing without acting');

  const empty = makeState({
    hands: [[], []],
    frogs: [F(['home', 'home', 'home', 'home', 'home', 'home']), F()],
  });
  const passed = C.endTurn(empty);
  check(passed.turn === 1 && passed.actions === 0, 'a player with no possible action may pass');
  check(C.canAct(empty, 0) === false, 'no possible action');

  const three = makeState({ hands: [[PACT, DARK, MILL], []], actions: 2 });
  const acted = C.advance(three, 0, 0, 0);
  check(acted.actions === 3, 'three actions used');
}

/* ---- market refill ---- */
{
  const st = makeState({
    hands: [[], []],
    market: [LEAFCROWN],                       // the market has exactly one card
    frogs: [F([[5, 0]]), F([null, [4, 0], [4, 1], [3, 0], [3, 1]])],
    turn: 0, actions: 1,
  });
  const back = C.moveBack(st, 0, 0);            // lands on card 2 (Suns)
  check(back.pending && back.pending.suit === 'suns', 'pending after the move-back');
  const taken = C.takeCard(back, 0, 0);         // the Market: Leaves+Crowns, no Suns
  check(taken.market.filter(Boolean).length === 6, `market refilled: ${taken.market.filter(Boolean).length}`);
  check(taken.deck.length === 25, `deck after the refill: ${taken.deck.length}`);
  conserved(taken, 'after the refill');

  // deck empty → the discard pile is shuffled into a new deck
  const dry = structuredClone(back);
  dry.discard = dry.deck.slice();               // the whole deck is in the discard
  dry.deck = [];
  check(dry.deck.length === 0 && dry.discard.length === 31, `dry fixture: ${dry.discard.length}`);
  const reshuffled = C.takeCard(dry, 0, 0);
  check(reshuffled.market.filter(Boolean).length === 6 && reshuffled.discard.length === 0 &&
    reshuffled.deck.length === 25,
    `after the reshuffle: market ${reshuffled.market.filter(Boolean).length}, ` +
    `discard ${reshuffled.discard.length}, deck ${reshuffled.deck.length}`);
  conserved(reshuffled, 'after the reshuffle');
}

/* ---- a full crossing and a six-frog finish, on paper ---- */
{
  // five frogs already home; the last one on the Battle jumps to home with a
  // card that matches nothing in cards 10–11 → the race is won
  const nearEnd = makeState({
    hands: [[DARK], []],
    frogs: [F([[9, 0], 'home', 'home', 'home', 'home', 'home']), F([[0, 0]])],
  });
  const finish = C.advance(nearEnd, 0, 0, 0);
  check(finish.frogs[0][0].k === 'home', 'the last frog goes home');
  check(finish.over === 'win' && finish.winner === 0, 'the race is won');
  conserved(finish, 'finish fixture');

  // crossing from the Cave: the Forest covers Moons and Leaves, so the frog
  // skips card 7 and lands on the Harvest's Leaves on card 10
  const crossing = makeState({
    hands: [[MILL], []],                      // Waves + Leaves
    frogs: [F([[6, 0]]), F([null, [7, 0], [7, 1]])],
  });
  const crossed = C.advance(crossing, 0, 0, 0);
  check(crossed.frogs[0][0].card === 10 && crossed.frogs[0][0].slot === 2,
    `crossed to card ${crossed.frogs[0][0].card + 1} slot ${crossed.frogs[0][0].slot}`);
  conserved(crossed, 'crossing fixture');
}

/* ---- random two-player games ---- */
function pickAction(st, rng) {
  const p = st.turn;
  if (st.pending) {
    const legal = C.legalMarket(st, p);
    return () => C.takeCard(st, p, legal[Math.floor(rng() * legal.length)]);
  }
  const advances = [];
  for (let hi = 0; hi < st.hands[p].length; hi++) {
    for (let fi = 0; fi < C.FROGS; fi++) {
      if (st.frogs[p][fi].k === 'home') continue;
      try { C.advance(st, p, hi, fi); advances.push([hi, fi]); } catch { /* not legal */ }
    }
  }
  if (advances.length) {
    const [hi, fi] = advances[Math.floor(rng() * advances.length)];
    return () => C.advance(st, p, hi, fi);
  }
  if (C.isBlocked(st, p) && st.market.some((x) => x != null)) {
    const i = C.legalMarket(st, p)[0];
    return () => C.takeOnly(st, p, i);
  }
  const backs = [];
  for (let fi = 0; fi < C.FROGS; fi++) {
    if (st.frogs[p][fi].k !== 'card') continue;
    try { C.moveBack(st, p, fi); backs.push(fi); } catch { /* not legal */ }
  }
  if (backs.length) {
    const fi = backs[Math.floor(rng() * backs.length)];
    return () => C.moveBack(st, p, fi);
  }
  return null;                                     // nothing to do: pass
}

let games = 0, actions = 0, wins = [0, 0], longest = 0, lastWinner = null;
for (let seed = 1; seed <= 40; seed++) {
  let st = C.newGame(seed, ALL45);
  const rng = mulberry32((seed * 2654435761) >>> 0);
  let guard = 0;
  while (!st.over && guard++ < 6000) {
    const movesBefore = st.moves;
    const act = pickAction(st, rng);
    if (act) {
      st = act();
      // a blocked take ends the turn inside one call, so it may tick twice
      check(st.moves > movesBefore, `seed ${seed}: the move counter did not tick`);
      conserved(st, `seed ${seed} move ${guard}`);
      if (!st.over && st.actions >= C.ACTIONS_PER_TURN && !st.pending) st = C.endTurn(st);
    } else {
      st = C.endTurn(st);
      check(st.moves > movesBefore, `seed ${seed}: passing did not tick the counter`);
    }
    actions++;
  }
  check(st.over === 'win', `seed ${seed}: game never finished (guard ${guard})`);
  check([0, 1].includes(st.winner), `seed ${seed}: winner ${st.winner}`);
  check(C.homeCount(st, st.winner) === C.FROGS, `seed ${seed}: the winner has all six home`);
  games++;
  wins[st.winner]++;
  longest = Math.max(longest, guard);
  lastWinner = st.winner;
}
check(actions > 400, `only ${actions} actions across ${games} games`);

console.log(`random games: ${games} finished in ${actions} actions ` +
  `(${(actions / games).toFixed(1)} per game, longest ${longest}), ` +
  `winners P1 ${wins[0]} / P2 ${wins[1]} (last: P${lastWinner + 1})`);
console.log(failures === 0 ? 'xing: all tests passed' : `xing: ${failures} failures`);
process.exit(failures ? 1 : 0);

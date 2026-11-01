// Headless tests for Terrapin: node test/terrapin.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/terrapin-core.js');
C.init(byId);
const S = await import('../web/js/games/soliterrapin-core.js');   // the ranking twin
S.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, label, want) => {
  try { fn(); check(false, `${label}: should have thrown`); return null; }
  catch (e) {
    check(!!e.message, `${label}: the error must explain itself`);
    if (want) check(e.message.includes(want), `${label}: error "${e.message}" should mention "${want}"`);
    return e;
  }
};

/* ---- conservation ---- */
function conserved(st, label) {
  const all = C.allCards(st);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
  const chips = st.stacks[0] + st.stacks[1] + st.pot;
  check(chips === 100, `${label}: ${chips} chips on the table, expected 100`);
  check(st.stacks.every((c) => c >= 0), `${label}: negative stack`);
}

/* ---- the hand ranking, computed on paper ---- */
{
  const tb = ['the-castle', 'the-cave', 'the-chance-meeting'];       // the three 7s
  const sc = C.scoreHand(tb);
  check(sc.turtleButt, 'three 7s cover all six suits — Turtle Butt');
  check(sc.total === 0, `Turtle Butt scores 0, got ${sc.total}`);

  check(C.scoreHand(['ace-of-moons', 'ace-of-suns']).total === 5, 'a pair of Aces is 5');
  check(C.scoreHand(['ace-of-moons', 'ace-of-suns', 'ace-of-waves']).total === 10,
    'three Aces: pair 5 + extra Ace 5 = 10');
  check(C.scoreHand(['ace-of-moons', 'ace-of-suns', 'ace-of-waves', 'ace-of-leaves']).total === 15,
    'four Aces: 5 x (4-1) = 15');

  // Ace-2-3-4 straight = 6, suits stay under six
  const straight = ['ace-of-moons', 'the-author', 'the-journey', 'the-mountain'];
  check(C.scoreHand(straight).total === 6, `Ace-2-3-4 is worth 6, got ${C.scoreHand(straight).total}`);

  // 8-9-Crown = 4 (Crowns sit above 9)
  check(C.scoreHand(['the-mill', 'the-merchant', 'the-bard']).total === 4,
    '8-9-Crown is a straight worth 4');

  // no wrap: 9-Crown-Ace only counts 9-10
  check(C.scoreHand(['the-pact', 'the-bard', 'ace-of-moons']).total === 2,
    'straights do not wrap around');

  // only the longest straight counts: [1,2,3] beats [7,8]
  const twoRuns = ['ace-of-waves', 'the-origin', 'the-journey', 'the-cave', 'the-diplomat'];
  check(!C.scoreHand(twoRuns).turtleButt, 'that five-card hand has five suits, not six');
  check(C.scoreHand(twoRuns).total === 4, `only the longer run scores, got ${C.scoreHand(twoRuns).total}`);

  // pair + straight together: pair of 3s (5) + 3-4-5 (4) = 9
  check(C.scoreHand(['the-journey', 'the-painter', 'the-sailor', 'the-forest']).total === 9,
    'pair of 3s plus 3-4-5 is 9');

  check(C.scoreHand(['the-cave', 'the-mountain']).total === 0, 'two unrelated cards score nothing');

  // every rank's three cards partition the six suits (the wiki's warning)
  for (let r = 2; r <= 9; r++) {
    const three = BASIC.filter((id) => byId[id].rank === r);
    const suits = new Set(three.flatMap((id) => byId[id].suits));
    check(three.length === 3 && suits.size === 6, `the three ${r}s should be Turtle Butt`);
  }

  // consistency with Soliterrapin's scoreLine on random hands
  const rng = mulberry32(4242);
  for (let i = 0; i < 300; i++) {
    const n = 3 + Math.floor(rng() * 6);
    const pool = BASIC.slice();
    const hand = [];
    for (let k = 0; k < n; k++) hand.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const a = C.scoreHand(hand);
    const b = S.scoreLine(hand);
    check(a.total === b.total && a.turtleButt === b.turtleButt,
      `ranking mismatch with Soliterrapin on ${hand.join(',')}: ${a.total}/${b.total}`);
  }
}

/* ---- setup, over 300 seeds, both variants ---- */
for (const variant of ['western', 'temptation']) {
  for (let seed = 1; seed <= 300; seed++) {
    const st = C.newGame(seed, BASIC, variant);
    check(st.hands[0].length === 2 && st.hands[1].length === 2, `seed ${seed}: two cards each`);
    check(st.dealer === 0 && st.handsPlayed === 0 && st.hand === 1, `seed ${seed}: hand 1, dealer 1`);
    check(st.pot === 2 * C.ANTE[variant] && st.stacks[0] === 50 - C.ANTE[variant],
      `seed ${seed}: antes are in the pot`);
    const first = variant === 'western' ? st.bet.toAct : st.offer.to;
    check(first === 1, `seed ${seed}: the non-dealer (on the dealer's left) starts`);
    if (variant === 'western') {
      check(st.phase === 'bet' && st.betRound === 1 && st.shared.length === 0, `seed ${seed}: opening bet`);
      check(st.lastAggressive === 1, `seed ${seed}: the opening player starts as last aggressor`);
    } else {
      check(st.phase === 'buy' && st.buyRound === 1, `seed ${seed}: first buying round`);
      check(st.shared.length === 3 && !C.scoreHand(st.shared).turtleButt,
        `seed ${seed}: three shared cards, no Turtle Butt among them`);
      check(st.setAside.every((id) => C.scoreHand(st.setAside).turtleButt) || st.setAside.length === 0,
        `seed ${seed}: only Turtle Butt triples are set aside`);
    }
    conserved(st, `seed ${seed} ${variant}`);
  }
}

/* ---- Western betting ---- */
{
  let st = C.newGame(7, BASIC, 'western');
  check(st.bet.toAct === 1, 'the non-dealer acts first');

  throws(() => C.call(st), 'call with no bet to call', 'no bet to call');
  throws(() => C.raise(st, 2), 'raise with no bet to raise', 'no bet to raise');
  throws(() => C.bet(st, 0), 'betting zero', 'at least 1 chip');
  throws(() => C.bet(st, 6), 'betting over the limit', 'limit is 5');
  throws(() => C.bet(st, 1.5), 'a fractional bet', 'at least 1 chip');

  const b = C.bet(st, 3);
  check(b.stacks[1] === 46 && b.pot === 5 && b.bet.level === 3 && b.bet.toAct === 0, 'bet 3');
  check(st.stacks[1] === 49, 'the original state is not mutated');
  conserved(b, 'after bet');
  throws(() => C.bet(b, 2), 'betting again when facing your own bet is a raise', 'match it, raise');

  const r = C.raise(b, 4);
  check(r.bet.level === 7 && r.bet.toAct === 1 && r.lastAggressive === 0, 'raise to 7');
  throws(() => C.raise(r, 6), 'raising over the limit', 'limit is 5');
  const poor = structuredClone(r); poor.stacks[1] = 3;
  throws(() => C.raise(poor, 3), 'raising with too few chips', 'chips');
  throws(() => C.call(poor), 'calling with too few chips forces a fold', 'must fold');

  const called = C.call(r);
  check(called.betRound === 2 && called.phase === 'bet', 'the call closes round 1');
  check(called.shared.length === 3, 'the flop is dealt after round 1');
  check(called.bet.toAct === called.lastAggressive, 'round 2 begins with the last aggressive player');
  conserved(called, 'after round 1');

  const folded = C.fold(C.bet(st, 2));
  check(folded.phase === 'handOver' && folded.result.winner === 1, 'a fold hands the pot over');
  check(folded.stacks[1] === 51,
    `the winner takes the pot: their own bet returns plus the folder's ante (${folded.stacks[1]})`);
  check(folded.stacks[0] === 49, 'the folder is only down their ante');
  check(folded.over === null, 'one folded hand does not end the match');
  conserved(folded, 'after a fold-win');

  throws(() => C.takeCard(st), 'taking a card during betting', 'betting');
}

/* ---- the flop replaces a Turtle Butt triple ---- */
{
  let st = C.newGame(3, BASIC, 'western');
  const tb = ['the-castle', 'the-cave', 'the-chance-meeting'];       // three 7s = Turtle Butt
  const good = ['the-mill', 'the-forest', 'the-bard'];
  st.hands = [['ace-of-moons', 'the-author'], ['the-desert', 'the-origin']];
  const used = new Set([...tb, ...good, ...st.hands[0], ...st.hands[1]]);
  st.deck = [...BASIC.filter((id) => !used.has(id)), ...good, ...tb];   // popped tb-first
  const after = C.call(C.bet(st, 1));
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  check(sameSet(after.shared, good), `shared should be ${good}, got ${after.shared}`);
  check(sameSet(after.setAside, tb), 'the Turtle Butt triple is set aside');
  check(C.allCards(after).length === 36 && new Set(C.allCards(after)).size === 36, 'conserved after the swap');
}

/* ---- take a card or stand ---- */
{
  // bet 2 / call, bet 2 / call reaches the draw phase for player 1 (last aggressor)
  let st = C.newGame(11, BASIC, 'western');
  st = C.call(C.bet(st, 2));
  st = C.call(C.bet(st, 2));
  check(st.phase === 'draw' && st.drawOffer.to === st.lastAggressive, 'the draw phase opens');

  const h0 = st.hands[st.drawOffer.to].length;
  const took = C.takeCard(st);
  const taker = st.drawOffer.to;
  check(took.hands[taker].length === h0 + 1, 'a taken card is dealt face down');
  check(took.drawOffer.to === 1 - taker, 'the offer passes to the other player');
  conserved(took, 'after a take');

  const stood = C.stand(took);
  check(stood.drawOffer.to === taker, 'the taker is offered a second card on the next lap');
  const stood2 = C.stand(stood);
  check(stood2.phase === 'bet' && stood2.betRound === 3, 'both standing opens the final betting round');
  check(stood2.bet.toAct === stood2.lastAggressive, 'round 3 begins with the last aggressive player');
  throws(() => C.takeCard(stood2), 'taking during the final betting round', 'final betting rounds');

  // taking again and again is allowed until the deck runs out
  let many = C.takeCard(took);
  while (many.phase === 'draw') many = C.takeCard(many);
  check(many.betRound === 3, 'the phase ends when everyone stands');

  // deck exhaustion ends the taking at once
  let low = C.call(C.bet({ ...st, phase: 'bet', betRound: 1,
    bet: { level: 0, contrib: [0, 0], first: 1, toAct: 1, aggressor: null } }, 2));
  low = C.call(C.bet(low, 2));
  low.deck = low.deck.slice(0, 1);
  const last = C.takeCard(low);
  check(last.phase === 'bet' && last.betRound === 3, 'an exhausted deck ends the taking');
  check(last.deck.length === 0, 'the taken card was the last');
  throws(() => C.takeCard({ ...low, deck: [] }), 'taking from an empty deck', 'exhausted');
}

/* ---- showdown, computed on paper ---- */
{
  const shared = ['the-mill', 'the-forest', 'the-bard'];              // 8, 5, Crown
  const rig = (hands, stacks = [45, 45], pot = 10) => {
    const st = C.newGame(5, BASIC, 'western');
    st.hands = hands;
    st.shared = shared;
    st.deck = BASIC.filter((id) => ![...hands[0], ...hands[1], ...shared].includes(id));
    st.stacks = stacks;
    st.pot = pot;
    st.phase = 'bet';
    st.betRound = 3;
    st.lastAggressive = 0;
    st.bet = { level: 0, contrib: [0, 0], first: 0, toAct: 0, aggressor: null };
    return st;
  };

  const p0 = ['ace-of-moons', 'ace-of-suns'];        // + shared: pair of Aces = 5
  const p1 = ['the-market', 'the-lunatic'];          // pair of 6s (5) + straight 5-6 (2) = 7
  check(!C.scoreHand([...p1, ...shared]).turtleButt, 'P1 hand is five suits, not six');
  const scores0 = C.scoreHand([...p0, ...shared]);
  const scores1 = C.scoreHand([...p1, ...shared]);
  check(scores0.total === 5, `P0 shows a pair of Aces = 5, got ${scores0.total}`);
  check(scores1.total === 7, `P1 shows pair of 6s + straight 5-6 = 7, got ${scores1.total}`);
  const won = C.call(C.bet(rig([p0, p1]), 1));
  check(won.phase === 'handOver' && won.result.winner === 1, 'the higher hand takes the pot');
  check(won.stacks[1] === 45 - 1 + 12 && won.stacks[0] === 44, `chips move to the winner (${won.stacks})`);
  check(won.handsPlayed === 1, 'the hand is counted');
  conserved(won, 'after showdown');

  // a tie splits the pot, the odd chip stays
  const tie = rig([['ace-of-moons', 'ace-of-suns'], ['ace-of-waves', 'ace-of-leaves']], [44, 45], 11);
  const split = C.call(C.bet(tie, 1));
  check(split.result.split && split.result.split.length === 2, 'identical hands tie');
  check(split.stacks[0] === 49 && split.stacks[1] === 50, `each takes half of 13 (${split.stacks})`);
  check(split.pot === 1, `the odd chip stays in the pot (pot ${split.pot})`);
  conserved(split, 'after a split');

  // Turtle Butt loses to any scoring hand, and cannot win
  const butt = ['the-castle', 'the-cave', 'the-chance-meeting'];
  const challenger = ['the-mountain', 'the-sailor'];   // pair of 4s + shared straight 5? ranks 4,4,8,5,10
  check(C.scoreHand([...challenger, ...shared]).total > 0, 'the challenger scores above zero');
  const res = C.call(C.bet(rig([butt, challenger]), 1));
  check(res.result.winner === 1, 'the non-Turtle-Butt hand wins');
  check(res.result.scores[0].turtleButt, 'the showdown records Turtle Butt');

  // both Turtle Butt: the pot stays in play
  const butt2 = ['the-mountain', 'the-sailor', 'the-battle'];          // the three 4s
  const carry = C.call(C.bet(rig([butt, butt2], [45, 45], 10), 1));
  check(carry.result.carry === true && carry.pot === 12, 'all-Turtle-Butt keeps the whole pot');
  check(carry.phase === 'handOver' && carry.stacks[0] === 44, 'no chips move');
  const next = C.nextHand(carry, BASIC);
  check(next.pot === 12 + 2, 'the carried pot collects the new antes');
  check(next.hand === 2 && next.dealer === 1, 'the deal passes');
  conserved(next, 'next hand after a carry');
}

/* ---- match end ---- */
{
  const shared = ['the-mill', 'the-forest', 'the-bard'];
  const aces = ['ace-of-moons', 'ace-of-suns'];                   // scores 5
  const sevens = ['the-market', 'the-lunatic'];                   // scores 7
  const rig3 = (stacks, pot) => {
    const st = C.newGame(9, BASIC, 'western');
    st.hands = [aces, sevens];
    st.shared = shared;
    st.deck = BASIC.filter((id) => ![...aces, ...sevens, ...shared].includes(id));
    st.stacks = stacks;
    st.pot = pot;
    st.phase = 'bet';
    st.betRound = 3;
    st.lastAggressive = 0;
    st.bet = { level: 0, contrib: [0, 0], first: 0, toAct: 0, aggressor: null };
    return st;
  };

  // bust: P0 shoves and loses
  const allin = C.call(C.bet(rig3([4, 94], 2), 4));
  check(allin.stacks[0] === 0, 'the all-in caller is broke');
  check(allin.over === 'match' && allin.winner === 1, 'bust ends the match at once');
  conserved(allin, 'at the bust');
  throws(() => C.nextHand(allin, BASIC), 'no next hand after the match', 'match is over');

  // reaching the target: P1 wins the pot with the sevens hand
  const reached = C.call(C.bet(rig3([44, 61], 2), 1));            // P1: 61-1+4 = 65? no: 64
  check(reached.stacks[1] === 64, `P1 reaches 64, one short (${reached.stacks})`);
  check(reached.over === null, '64 chips do not end the match yet');
  const hit = C.call(C.bet(rig3([44, 62], 2), 1));                // P1: 62-1+4 = 65
  check(hit.stacks[1] === 65 && hit.over === 'match' && hit.winner === 1,
    '65 chips win the match');

  // the 12-hand cap decides on chips
  const cap = { ...C.newGame(4, BASIC, 'western'), handsPlayed: 11, stacks: [44, 54], pot: 2 };
  cap.phase = 'bet';
  cap.bet = { level: 0, contrib: [0, 0], first: 0, toAct: 0, aggressor: null };
  const lastHand = C.fold(cap);
  check(lastHand.over === 'match' && lastHand.winner === 1, 'after 12 hands the chip leader wins');

  // a player who cannot re-ante loses the match
  const poor = { ...C.newGame(4, BASIC, 'western'), phase: 'handOver', stacks: [0, 30], pot: 70 };
  const done = C.nextHand(poor, BASIC);
  check(done.over === 'match' && done.winner === 1, 'a player with no chips cannot re-ante');

  throws(() => C.nextHand(C.newGame(1, BASIC, 'western'), BASIC), 'nextHand mid-hand', 'not finished');
}

/* ---- Temptation ---- */
{
  let st = C.newGame(21, BASIC, 'temptation');
  check(st.phase === 'buy' && st.buyRound === 1 && st.shared.length === 3, 'Temptation starts buying');
  check(st.stacks[0] === 47 && st.pot === 6, 'the antes are three chips each');

  const h1 = st.hands[st.offer.to].length;
  const bought = C.buyCard(st);
  const buyer = st.offer.to;
  check(bought.hands[buyer].length === h1 + 1 && bought.pot === 7, 'a bought card costs one chip');
  check(bought.offer.to === 1 - buyer, 'the dealer decides next');
  conserved(bought, 'after a buy');

  // the dealer buys too: the price rises to two
  const rt = C.buyCard(bought);
  check(rt.buyRound === 2 && rt.offer.to === buyer, 'round 2 begins at two chips');
  const poor = structuredClone(rt); poor.stacks[poor.offer.to] = 0;
  throws(() => C.buyCard(poor), 'buying without chips', 'you have 0');

  // deck exhaustion goes straight to showdown
  const low = structuredClone(rt);
  low.deck = low.deck.slice(0, 1);
  const over = C.buyCard(low);
  check(over.phase === 'handOver' && over.result.scores, 'the last card forces the showdown');

  // two passes end the buying at once and go to showdown
  const passed = C.passCard(C.passCard(st));
  check(passed.phase === 'handOver', 'a round with no taker ends the buying at once');
  check(passed.result.scores && !passed.result.carry, 'the showdown scores both hands');
  conserved(passed, 'after a Temptation showdown');

  // Temptation hands continue while chips last
  const next = C.nextHand(passed, BASIC);
  check(next.variant === 'temptation' && next.hand === 2 && next.buyRound === 1, 'hand 2 of Temptation');
}

/* ---- random matches, both variants ---- */
let totalMoves = 0, matches = 0, westernWins = [0, 0, 0], temptWins = [0, 0, 0];
for (const variant of ['western', 'temptation']) {
  for (let seed = 1; seed <= 40; seed++) {
    let st = C.newGame(seed, BASIC, variant);
    const rng = mulberry32(seed * 131 + 17);
    let guard = 0;
    while (!st.over && guard++ < 40000) {
      const acts = C.legalActions(st);
      check(acts.length > 0, `seed ${seed}: no legal action in phase ${st.phase}`);
      if (!acts.length) break;
      const act = acts[Math.floor(rng() * acts.length)];
      st = C.applyMove(st, { ...act, deck: BASIC });
      totalMoves++;
      conserved(st, `${variant} seed ${seed} move ${st.moves}`);
      check(st.hands[0].length + st.hands[1].length + st.shared.length <= 36, `seed ${seed}: too many cards`);
    }
    check(st.over === 'match', `seed ${seed} ${variant}: match never finished (phase ${st.phase})`);
    if (st.over === 'match') {
      matches++;
      const richer = st.stacks[0] === st.stacks[1] ? null : (st.stacks[0] > st.stacks[1] ? 0 : 1);
      check(st.winner === richer, `seed ${seed} ${variant}: winner ${st.winner} but stacks ${st.stacks}`);
      (variant === 'western' ? westernWins : temptWins)[st.winner ?? 2] += 1;
    }
    check(st.handsPlayed >= 1 && st.handsPlayed <= C.MAX_HANDS,
      `seed ${seed} ${variant}: ${st.handsPlayed} hands`);
    check(JSON.parse(JSON.stringify(st)).seed === seed, `seed ${seed}: state must survive a JSON round trip`);
  }
}
check(totalMoves > 2000, `only ${totalMoves} moves played across the random matches`);

console.log(`random matches: ${matches} finished in ${totalMoves} moves — ` +
  `Western winners P1/P2/draw ${westernWins.join('/')}, Temptation ${temptWins.join('/')}`);
console.log(failures === 0 ? 'terrapin: all tests passed' : `terrapin: ${failures} failures`);
process.exit(failures ? 1 : 0);

// Headless tests for the Gongor Whist rules: node test/gongor-whist.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/gongor-whist-core.js');
const { mulberry32 } = await import('../web/js/decktet.js');
C.init(byId);

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
}

function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(threw, msg);
}

const BASIC = manifest.basicDeck;
const ACES = BASIC.filter((id) => byId[id].rank === 1);

/* Card ids used by the trickWinner tests; assert the manifest still has the
   properties these cases rely on. */
const find = (fn) => BASIC.find(fn);
const crownSuns = find((id) => byId[id].rank === 'crown' && byId[id].suits.includes('suns'));
const crownMoons = find((id) => byId[id].rank === 'crown' && byId[id].suits.includes('moons'));
const mountain = 'the-mountain';   // Moons and Suns, rank 4
const diplomat = 'the-diplomat';   // Moons and Suns, rank 8
const pact = 'the-pact';           // Moons and Suns, rank 9
const desert = 'the-desert';       // Suns and Daemons, rank 2
const cave = 'the-cave';           // Waves and Daemons, rank 7
const aceMoons = 'ace-of-moons';

for (const [id, suits, rank] of [
  [crownSuns, ['suns'], 'crown'], [crownMoons, ['moons'], 'crown'],
  [mountain, ['moons', 'suns'], 4], [diplomat, ['moons', 'suns'], 8],
  [pact, ['moons', 'suns'], 9], [desert, ['suns', 'daemons'], 2],
  [cave, ['waves', 'daemons'], 7], [aceMoons, ['moons'], 1],
]) {
  check(!!id && byId[id] && JSON.stringify(byId[id].suits) === JSON.stringify(suits)
    && byId[id].rank === rank,
  `manifest card ${id} has suits ${suits} rank ${rank}`);
}

/* Every card of the game must be somewhere in the state, exactly once. */
function checkConservation(st, where) {
  const zones = ['yourHand', 'dummy', 'deck', 'setAside', 'taken',
    'acesFlipped', 'aceStack'];
  const tally = {};
  let total = 0;
  for (const z of zones) {
    for (const id of st[z]) { tally[id] = (tally[id] || 0) + 1; total++; }
  }
  for (const id of [st.leadCard, st.playerCard]) {
    if (id) { tally[id] = (tally[id] || 0) + 1; total++; }
  }
  check(total === 36, `${where}: ${total} cards in the state, expected 36`);
  for (const id of BASIC) {
    check((tally[id] || 0) === 1, `${where}: ${id} appears ${tally[id] || 0} times`);
  }
}

/* ------------------------------------------------------------------ setup */

for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, { basicIds: BASIC });
  check(st.phase === 'bidding', `seed ${seed}: starts in bidding`);
  check(st.handNo === 1 && st.handType === 'fore', `seed ${seed}: first hand is the fore hand`);
  check(st.mode === 'standard', `seed ${seed}: standard scoring by default`);
  check(st.yourHand.length === 7 && st.dummy.length === 7,
    `seed ${seed}: seven cards each (${st.yourHand.length}/${st.dummy.length})`);
  check(st.deck.length === 16, `seed ${seed}: ${st.deck.length} cards left in the deck`);
  check(st.acesFlipped.length === 1 && st.aceStack.length === 5,
    `seed ${seed}: ace stack ${st.acesFlipped.length}/${st.aceStack.length}`);
  check(st.trump === byId[st.acesFlipped[0]].suits[0],
    `seed ${seed}: trump ${st.trump} follows the flipped ace`);
  check(st.bidSheet.every((u) => !u), `seed ${seed}: empty bid sheet`);
  check(st.bid === null && st.leadCard === null && st.playerCard === null,
    `seed ${seed}: nothing played yet`);
  check(ACES.includes(st.acesFlipped[0])
    && st.aceStack.every((id) => ACES.includes(id))
    && st.aceStack.every((id) => id !== st.acesFlipped[0]),
  `seed ${seed}: the aces are separated from the deck`);
  checkConservation(st, `seed ${seed} setup`);
}

/* --------------------------------------------------------- bidding rules */

{
  const st = C.newGame(3, { basicIds: BASIC });
  throws(() => C.bid(st, -1), 'a negative bid is refused');
  throws(() => C.bid(st, 8), 'a bid above 7 is refused');
  throws(() => C.bid(st, 3.5), 'a fractional bid is refused');

  const after = C.bid(st, 4);
  check(after.bid === 4 && after.phase === 'playing', 'the bid opens play');
  check(after.bidSheet[4] === true, 'the bid is checked off');
  check(after.leadCard && !after.dummy.includes(after.leadCard),
    'the dummy flips its top card as the lead');
  check(after.tricksWon === 0 && after.tricksPlayed === 0, 'counters start at zero');

  const used = { ...st, bidSheet: [true, false, false, false, false, false, false, false] };
  throws(() => C.bid(used, 0), 'a bid already used is refused');
  check(C.bid(used, 5).bid === 5, 'an unused bid is accepted');

  const pts = C.newGame(4, { basicIds: BASIC, mode: 'points' });
  check(pts.mode === 'points', 'point scoring can be selected');
  let p = C.bid(pts, 3);
  while (p.phase === 'playing') {
    p = p.playerCard ? C.resolveTrick(p) : C.playCard(p, C.legalPlays(p)[0]);
  }
  p = C.nextHand(p);
  check(p.phase === 'bidding' && p.handNo === 2 && p.handType === 'aft',
    'the aft hand follows the fore hand');
  const again = C.bid(p, 3);
  check(again.bid === 3, 'point scoring allows the same bid again');
  check(again.bidSheet.every((u) => !u), 'point scoring does not use the sheet');
}

/* ------------------------------------------------------- following suit */

{
  const base = C.newGame(11, { basicIds: BASIC });
  const mk = (lead, hand, over = {}) => ({
    ...base, phase: 'playing', bid: 3, leadCard: lead, playerCard: null,
    trump: null, yourHand: hand, dummy: [], tricksPlayed: 0, ...over,
  });

  // The dummy leads a Crown of Suns: you must play one of your Suns cards.
  const st = mk(crownSuns, [desert, cave, pact]);
  const legal = C.legalPlays(st);
  check(JSON.stringify([...legal].sort()) === JSON.stringify([desert, pact].sort()),
    `following suit leaves ${legal}`);
  throws(() => C.playCard(st, cave), 'an off-suit card is refused');
  const played = C.playCard(st, desert);
  check(!played.yourHand.includes(desert) && played.playerCard === desert,
    'the card moves from your hand to the table');
  check(C.legalPlays(played).length === 0, 'no second card may be played');
  throws(() => C.playCard(played, pact), 'playing twice in one trick is refused');

  // Dual-suit leads count: the mountain is Moons and Suns, so a Moons-only
  // card also follows.
  const dual = mk(mountain, [cave, pact]);
  check(C.legalPlays(dual).includes(pact) && !C.legalPlays(dual).includes(cave),
    'a dual-suit lead is followed by either suit');

  // With nothing in the lead suit, anything goes.
  const voidHand = mk(crownSuns, [cave, 'the-journey']);
  check(C.legalPlays(voidHand).length === 2, 'with no card in suit, anything is legal');

  // Twiddle happens after your play: it touches neither hand nor lead, and
  // the trick simply waits for resolution.
  let tw = C.playCard(mk(crownSuns, [desert, cave], { trump: 'moons' }), desert);
  const handBefore = tw.yourHand.slice();
  tw = C.twiddle(tw);
  check(JSON.stringify(tw.yourHand) === JSON.stringify(handBefore), 'twiddle touches neither hand');
  check(tw.leadCard === crownSuns, 'twiddle leaves the dummy\'s lead alone');
  check(C.legalPlays(tw).length === 0, 'the played trick waits for resolution');
}

/* -------------------------------------------------------- twiddling trump */

{
  let st = C.bid(C.newGame(5, { basicIds: BASIC }), 3);
  st = C.playCard(st, C.legalPlays(st)[0]);
  const before = {
    trump: st.trump, stack: st.aceStack.length, flipped: st.acesFlipped.length,
  };
  const tw = C.twiddle(st);
  check(tw.aceStack.length === before.stack - 1, 'twiddle flips one ace off the stack');
  check(tw.acesFlipped.length === before.flipped + 1, 'the flipped ace is remembered');
  check(tw.trump === byId[tw.acesFlipped[tw.acesFlipped.length - 1]].suits[0],
    'the new trump is the suit of the ace just flipped');
  check(tw.trump !== before.trump, 'the six aces are all different suits, so trump changes');
  check(tw.twiddled === true, 'one twiddle per trick');
  throws(() => C.twiddle(tw), 'a second twiddle in the same trick is refused');

  // Twiddling an empty ace stack leaves no trump for the rest of the hand.
  const empty = { ...st, aceStack: [], twiddled: false };
  const none = C.twiddle(empty);
  check(none.trump === null, 'twiddle with no aces left means no trump');
  check(none.acesFlipped.length === empty.acesFlipped.length, 'nothing is flipped');
  throws(() => C.twiddle(none), 'the empty-stack twiddle still counts as the trick\'s twiddle');

  // Twiddle is only legal after you play and before the trick resolves.
  const waiting = C.bid(C.newGame(6, { basicIds: BASIC }), 0);
  throws(() => C.twiddle(waiting), 'twiddle before playing is refused');
}

/* ------------------------------------------------------------ trickWinner */

{
  const eq = (a, b, msg) => check(a === b, `${msg}: got ${a}, expected ${b}`);

  // The wiki's example: the dummy leads the Crown of Suns, the ace of Moons
  // is showing, and you play the 4 of Moons and Suns — your card is trump.
  eq(C.trickWinner(crownSuns, mountain, 'moons'), 'you', 'trump via the other suit wins');
  eq(C.trickWinner(mountain, crownSuns, 'moons'), 'dummy', 'dummy played trump, you did not');

  // Both cards trump: the higher one wins, in either order.
  eq(C.trickWinner(mountain, pact, 'moons'), 'you', 'higher trump wins');
  eq(C.trickWinner(pact, mountain, 'moons'), 'dummy', 'lower trump loses');
  // Ranks compare Ace 1 ... Crown 10.
  eq(C.trickWinner(crownMoons, aceMoons, 'moons'), 'dummy', 'the ace is low');
  eq(C.trickWinner(aceMoons, crownMoons, 'moons'), 'you', 'the crown is high');

  // No trump played at all: the higher card sharing the lead's suit wins.
  eq(C.trickWinner(mountain, pact, null), 'you', 'no trump, higher follower wins');
  eq(C.trickWinner(pact, mountain, null), 'dummy', 'no trump, lower follower loses');
  eq(C.trickWinner(mountain, desert, null), 'dummy', 'no trump, lower follower loses');
  eq(C.trickWinner(crownSuns, cave, null), 'dummy', 'no trump, cannot follow suit');

  // Trump in effect but neither card is trump: following suit still matters.
  const crowns = 'crowns';
  eq(C.trickWinner(diplomat, pact, crowns), 'you', 'neither is trump, higher follower wins');
  eq(C.trickWinner(pact, diplomat, crowns), 'dummy', 'neither is trump, lower follower loses');
  eq(C.trickWinner(diplomat, cave, crowns), 'dummy', 'neither is trump, cannot follow suit');

  // A card counts as trump even when the dummy led it "for its other suit":
  // you cannot overtake a trump lead with a mere follower.
  eq(C.trickWinner(diplomat, crownSuns, 'moons'), 'dummy', 'you cannot beat a trump lead off-suit');
}

/* --------------------------------------------- hand result / both scorings */

{
  const fixture = (over = {}) => ({
    seed: 1, mode: 'standard', phase: 'handOver', handNo: 1, handType: 'fore',
    bidSheet: [false, false, false, false, false, false, false, false],
    bid: null, yourHand: [], dummy: [], deck: [], setAside: [], taken: [],
    acesFlipped: [], aceStack: [], trump: null, leadCard: null, playerCard: null,
    twiddled: false, tricksWon: 0, tricksPlayed: 7, lastTrick: null,
    score: 0, over: null, moves: 0, ...over,
  });
  const sheet = (used) => [0, 1, 2, 3, 4, 5, 6, 7].map((n) => used.includes(n));

  // Standard: make your bid with bids left to use — the game goes on.
  let r = C.handResult(fixture({ bid: 4, tricksWon: 4, bidSheet: sheet([0, 1, 2, 3]) }));
  check(r.ok && !r.gameOver && r.outcome === null && r.key === 'made',
    'standard: a made bid with an incomplete sheet continues');
  check(r.title === C.SCORE_TITLES.made.title, 'standard: title comes from SCORE_TITLES');
  check(r.points === 0 && r.score === 0, 'standard scoring has no points');

  // Standard: make the eighth bid — all eight used — and you win.
  r = C.handResult(fixture({ bid: 7, tricksWon: 7, bidSheet: sheet([0, 1, 2, 3, 4, 5, 6, 7]) }));
  check(r.ok && r.gameOver && r.outcome === 'won' && r.key === 'won',
    'standard: eight made bids win the game');

  // Standard: miss the bid and you lose at once, whatever the sheet says.
  r = C.handResult(fixture({ bid: 4, tricksWon: 2, bidSheet: sheet([0, 1, 2, 3, 4]) }));
  check(!r.ok && r.gameOver && r.outcome === 'lost' && r.key === 'lost',
    'standard: a missed bid loses the game');

  // Point scoring: made bid adds it, missed bid costs the tricks won.
  r = C.handResult(fixture({ mode: 'points', bid: 3, tricksWon: 3, score: 40 }));
  check(r.ok && !r.gameOver && r.points === 3 && r.score === 43,
    `points: made bid scores +3 (got ${r.points}/${r.score})`);
  r = C.handResult(fixture({ mode: 'points', bid: 5, tricksWon: 2, score: 10 }));
  check(!r.ok && !r.gameOver && r.points === -2 && r.score === 8,
    `points: missed bid scores -2 (got ${r.points}/${r.score})`);
  r = C.handResult(fixture({ mode: 'points', bid: 6, tricksWon: 6, score: 45 }));
  check(r.ok && r.gameOver && r.outcome === 'won' && r.key === 'fifty' && r.score === 51,
    'points: 50 points is a decisive win');
  r = C.handResult(fixture({ mode: 'points', bid: 7, tricksWon: 1, score: 0 }));
  check(!r.gameOver && r.score === -1, 'points: a negative score keeps playing');

  // nextHand applies the points and moves on (or ends the game).
  let st = fixture({ mode: 'points', bid: 5, tricksWon: 5, score: 10 });
  st = C.nextHand(st);
  check(st.phase === 'bidding' && st.score === 15 && st.over === null,
    'points: nextHand banks the score and deals on');
  st = C.nextHand(fixture({ mode: 'points', bid: 6, tricksWon: 6, score: 45 }));
  check(st.phase === 'gameOver' && st.over === 'won' && st.score === 51,
    'points: nextHand ends the game at 50');

  st = C.nextHand(fixture({ bid: 2, tricksWon: 2, bidSheet: sheet([0, 1, 2]) }));
  check(st.phase === 'bidding' && st.handType === 'aft' && st.handNo === 2,
    'standard: a made bid deals the aft hand');
  st = C.nextHand(fixture({ bid: 2, tricksWon: 5, bidSheet: sheet([0, 1, 2]) }));
  check(st.phase === 'gameOver' && st.over === 'lost', 'standard: a missed bid ends the game');
  throws(() => C.nextHand(fixture({ phase: 'playing' })), 'nextHand needs a finished hand');
  throws(() => C.resolveTrick(fixture({ phase: 'playing' })), 'resolveTrick needs your card');
}

/* --------------------------------------- fore hand -> aft hand -> reshuffle */

{
  let st = C.newGame(42, { basicIds: BASIC });
  const playOut = (s) => {
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 100) {
      s = s.playerCard ? C.resolveTrick(s) : C.playCard(s, C.legalPlays(s)[0]);
    }
    return s;
  };

  st = playOut(C.bid(st, 4));
  check(st.phase === 'handOver' && st.handType === 'fore', 'the fore hand finishes');
  const fore = {
    acesFlipped: st.acesFlipped.slice(), aceStack: st.aceStack.slice(),
    trump: st.trump, taken: st.taken.slice(),
  };
  check(st.taken.length === 14, `the fore hand's tricks are set aside (${st.taken.length})`);

  st.tricksWon = st.bid;             // stand in for a hand made exactly as bid
  st = C.nextHand(st);
  check(st.handType === 'aft' && st.handNo === 2, 'the aft hand comes next');
  check(st.yourHand.length === 7 && st.dummy.length === 7, 'seven and seven are dealt again');
  check(st.deck.length === 0 && st.setAside.length === 2,
    `two cards are set aside unseen (${st.setAside.length})`);
  check(JSON.stringify(st.acesFlipped) === JSON.stringify(fore.acesFlipped)
    && JSON.stringify(st.aceStack) === JSON.stringify(fore.aceStack),
  'the ace pile is left as it is');
  check(st.trump === fore.trump, 'the trump carries over into the aft hand');
  check(JSON.stringify(st.taken) === JSON.stringify(fore.taken),
    'the fore hand tricks stay set aside');
  check(st.bidSheet.filter(Boolean).length === 1, 'the bid sheet carries over');
  checkConservation(st, 'aft hand deal');

  st = playOut(C.bid(st, st.bidSheet.findIndex((u) => !u)));   // an unused bid
  check(st.handType === 'aft' && st.phase === 'handOver', 'the aft hand finishes');
  check(st.taken.length === 28, `both hands' tricks are set aside (${st.taken.length})`);

  st.tricksWon = st.bid;             // stand in for a hand made exactly as bid
  st = C.nextHand(st);
  check(st.handType === 'fore' && st.handNo === 3, 'a fresh fore hand starts the next pass');
  check(st.deck.length === 16 && st.setAside.length === 0 && st.taken.length === 0,
    'everything except the current hands is back in the deck');
  check(st.acesFlipped.length === 1 && st.aceStack.length === 5,
    'the six aces are reshuffled');
  check(st.trump === byId[st.acesFlipped[0]].suits[0], 'a new initial trump is flipped');
  check(st.phase === 'bidding' && st.bid === null, 'bidding opens the new hand');
  checkConservation(st, 'third hand deal');
}

/* --------------------------------- full random games, standard scoring */

function driveHand(st, rng) {
  const avail = [];
  st.bidSheet.forEach((used, n) => { if (!used) avail.push(n); });
  check(avail.length > 0, 'there is always an unused bid to make');
  st = C.bid(st, avail[Math.floor(rng() * avail.length)]);

  let guard = 0;
  while (st.phase === 'playing' && guard++ < 200) {
    if (!st.playerCard) {
      const legal = C.legalPlays(st);
      check(legal.length > 0, 'there is always a legal card to play');
      st = C.playCard(st, legal[Math.floor(rng() * legal.length)]);
    } else if (!st.twiddled && rng() < 0.4) {
      st = C.twiddle(st);
    } else {
      st = C.resolveTrick(st);
    }
  }
  check(st.phase === 'handOver', 'the hand ends after seven tricks');
  return st;
}

const outcomes = { won: 0, lost: 0 };
for (let seed = 1; seed <= 200; seed++) {
  let st = C.newGame(seed, { basicIds: BASIC });
  const rng = mulberry32(seed * 7919 + 13);
  let hands = 0;
  let ended = null;

  while (!st.over && hands < 30) {
    const handNo = st.handNo;
    const handType = st.handType;
    check(st.phase === 'bidding', `seed ${seed}: hand ${handNo} opens with bidding`);

    st = driveHand(st, rng);
    checkConservation(st, `seed ${seed} hand ${handNo} over`);
    check(st.tricksPlayed === 7, `seed ${seed}: hand ${handNo} played ${st.tricksPlayed} tricks`);
    check(st.tricksWon >= 0 && st.tricksWon <= 7,
      `seed ${seed}: hand ${handNo} won ${st.tricksWon} tricks`);
    check(st.yourHand.length === 0 && st.dummy.length === 0,
      `seed ${seed}: hand ${handNo} depleted both hands`);
    check(st.bidSheet.filter(Boolean).length === hands + 1,
      `seed ${seed}: exactly one new bid checked off (${st.bidSheet.filter(Boolean).length}/${hands + 1})`);

    const res = C.handResult(st);
    st = C.nextHand(st);
    hands++;

    if (st.over) {
      ended = st.over;
      check(st.phase === 'gameOver', `seed ${seed}: phase gameOver after the deciding hand`);
      check(res.gameOver && res.outcome === st.over,
        `seed ${seed}: handResult saw the same outcome (${res.outcome}/${st.over})`);
      const used = st.bidSheet.filter(Boolean).length;
      check(used === hands, `seed ${seed}: ${used} bids used in ${hands} hands (no bid twice)`);
      if (st.over === 'won') {
        check(used === 8 && st.handNo === 8,
          `seed ${seed}: a win is eight hands with all bids used (hand ${st.handNo})`);
      } else {
        check(!res.ok, `seed ${seed}: a loss is a missed bid`);
      }
      break;
    }

    check(st.phase === 'bidding', `seed ${seed}: back to bidding`);
    check(st.handNo === handNo + 1, `seed ${seed}: hand number advances`);
    check(st.handType !== handType, `seed ${seed}: fore and aft alternate`);
    check(st.bid === null, `seed ${seed}: the new hand starts unbidded`);
    checkConservation(st, `seed ${seed} hand ${st.handNo} deal`);
  }

  check(ended !== null, `seed ${seed}: the game reached gameOver`);
  if (ended) outcomes[ended]++;
}

/* The win path: eight hands made exactly as bid take the game. */
for (let seed = 1; seed <= 20; seed++) {
  let st = C.newGame(seed, { basicIds: BASIC });
  const rng = mulberry32(seed * 31 + 7);
  let hands = 0;
  while (st.phase !== 'gameOver' && hands < 12) {
    st = driveHand(st, rng);
    st.tricksWon = st.bid;            // play the hand out exactly as bid
    st = C.nextHand(st);
    hands++;
  }
  check(st.phase === 'gameOver' && st.over === 'won',
    `seed ${seed}: eight made bids win (${st.phase}/${st.over})`);
  check(st.handNo === 8 && st.handType === 'aft', `seed ${seed}: four fore and four aft`);
  check(st.bidSheet.every(Boolean), `seed ${seed}: all eight bids used`);
}

/* Point scoring: seven made bids of 7 reach 50 and stop the game. */
{
  let st = C.newGame(7, { basicIds: BASIC, mode: 'points' });
  let hands = 0;
  while (st.phase !== 'gameOver' && hands < 40) {
    st = C.bid(st, 7);
    let guard = 0;
    while (st.phase === 'playing' && guard++ < 100) {
      st = st.playerCard ? C.resolveTrick(st) : C.playCard(st, C.legalPlays(st)[0]);
    }
    st.tricksWon = 7;
    const before = st.score;
    st = C.nextHand(st);
    hands++;
    if (st.phase !== 'gameOver') {
      check(st.score === before + 7, `points: score ${before} -> ${st.score} (+7)`);
    }
  }
  check(st.phase === 'gameOver' && st.over === 'won', `points: reached 50 (${st.score})`);
  check(st.score >= 50, `points: final score ${st.score} is at least 50`);
  check(hands === 8, `points: 7 x 8 = 56 in ${hands} hands`);
}

/* ------------------------------------------------------- serialisability */

{
  let st = C.newGame(9, { basicIds: BASIC });
  st = C.bid(st, 2);
  st = C.playCard(st, C.legalPlays(st)[0]);
  st = C.twiddle(st);
  st = C.resolveTrick(st);
  const round = JSON.parse(JSON.stringify(st));
  check(JSON.stringify(round) === JSON.stringify(st), 'the state survives a JSON round trip');
  const clone = structuredClone(st);
  check(JSON.stringify(clone) === JSON.stringify(st), 'the state survives structuredClone');
  for (const v of Object.values(st)) {
    check(v === null || ['string', 'number', 'boolean', 'object'].includes(typeof v),
      `state value is plain JSON (${typeof v})`);
  }
}

console.log('standard outcomes:', outcomes);
console.log(failures === 0 ? 'gongor-whist: all tests passed'
  : `gongor-whist: ${failures} failures`);
process.exit(failures ? 1 : 0);

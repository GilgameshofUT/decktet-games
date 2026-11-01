// Headless tests for the Jacynth solitaire rules: node test/jacynth.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/jacynth-core.js');
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

const BASIC = manifest.basicDeck;             // 36 cards
const CORNERS = [0, 3, 12, 15];

/** Build a hand-made state for targeted tests. */
function fixture({ grid = {}, corners = CORNERS, ...rest } = {}) {
  const g = Array(C.CELLS).fill(null);
  for (const [k, v] of Object.entries(grid)) g[Number(k)] = v;
  return {
    seed: 1, rng: 0x12345678,
    grid: g, corners, hand: [], deck: [], discard: [],
    tokenCards: [], phase: 'idle', lastFlip: null, moves: 0, over: null,
    ...rest,
  };
}

function zones(st) {
  return [...st.grid, ...st.hand, ...st.deck, ...st.discard].filter(Boolean);
}
function checkDeck(st, label) {
  const all = zones(st);
  const tally = {};
  for (const id of all) tally[id] = (tally[id] || 0) + 1;
  check(all.length === 36, `${label}: ${all.length} cards across all zones (want 36)`);
  for (const id of BASIC) check((tally[id] || 0) === 1, `${label}: ${id} duplicated or missing`);
}

/* ------------------------------------------------------- setup invariants */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.phase === 'setup', `seed ${seed}: phase ${st.phase}`);
  check(st.grid.filter(Boolean).length === 4, `seed ${seed}: ${st.grid.filter(Boolean).length} corners dealt`);
  check(CORNERS.every((i) => st.grid[i]), `seed ${seed}: a corner is empty`);
  check(st.hand.length === 3, `seed ${seed}: hand ${st.hand.length}`);
  check(st.deck.length === 29, `seed ${seed}: deck ${st.deck.length}`);
  check(st.tokenCards.length === 0, `seed ${seed}: tokens already placed`);
  check(st.over === null, `seed ${seed}: game over at setup`);
  checkDeck(st, `seed ${seed} setup`);
  // nothing playable during setup
  check(C.legalCells(st, st.hand[0]).length === 0, `seed ${seed}: cells legal during setup`);
  throws(() => C.playCard(st, 1, st.hand[0]), `seed ${seed}: play allowed during setup`);
}

// deterministic: same seed, same game
{
  const a = C.newGame(42, BASIC);
  const b = C.newGame(42, BASIC);
  check(JSON.stringify(a) === JSON.stringify(b), 'same seed must produce the same game');
}

/* -------------------------------------------------- the first token (setup) */
for (let seed = 1; seed <= 100; seed++) {
  const st = C.newGame(seed, BASIC);
  // must be a starting card: hand cards and empty cells are refused
  throws(() => C.placeToken(st, st.hand[0]), `seed ${seed}: token on a hand card accepted`);
  throws(() => C.placeToken(st, 'the-excuse'), `seed ${seed}: token on a non-city card accepted`);

  const cornerId = st.grid[CORNERS[seed % 4]];
  const after = C.placeToken(st, cornerId);
  check(after.tokenCards.length === 1, `seed ${seed}: first token not recorded`);
  check(after.tokenCards[0] === cornerId, `seed ${seed}: token on the wrong card`);
  check(after.phase === 'idle', `seed ${seed}: still in '${after.phase}' after the first token`);
  checkDeck(after, `seed ${seed} after setup`);
}

/* ------------------------------------------------------------ the flip rule */
{
  const base = () => fixture({
    grid: { 0: 'ace-of-moons', 3: 'ace-of-suns', 12: 'ace-of-waves', 15: 'ace-of-leaves' },
    hand: ['the-soldier'],                       // rank 5, daemons+crowns
    tokenCards: ['ace-of-moons'],
  });

  // flipped Ace/Crown: flip discarded, ours placed
  {
    const st = fixture({ ...base(), deck: ['ace-of-waves'] });
    const nx = C.playCard(st, 1, 'the-soldier');
    check(nx.grid[1] === 'the-soldier', 'ace flip: our card not placed');
    check(nx.discard.includes('ace-of-waves'), 'ace flip: flipped card not discarded');
    check(nx.deck.length === 0, 'ace flip: deck not consumed');
    check(nx.lastFlip.result === 'court', `ace flip: result ${nx.lastFlip.result}`);
    check(nx.phase === 'token', `ace flip: phase ${nx.phase}`);
    check(nx.hand.length === 0, 'ace flip: hand not spent');
  }
  // flipped number of equal-or-higher rank: ours discarded, theirs placed
  {
    const st = fixture({ ...base(), deck: ['the-merchant'] });   // rank 9
    const nx = C.playCard(st, 1, 'the-soldier');
    check(nx.grid[1] === 'the-merchant', 'beaten flip: flipped card not placed');
    check(nx.discard.includes('the-soldier'), 'beaten flip: our card not discarded');
    check(nx.lastFlip.result === 'beaten', `beaten flip: result ${nx.lastFlip.result}`);
    // equal rank counts as beaten too (the-forest is also a 5)
    const eq = C.playCard(fixture({ ...base(), deck: ['the-forest'] }), 1, 'the-soldier');
    check(eq.grid[1] === 'the-forest' && eq.discard.includes('the-soldier') &&
      eq.lastFlip.result === 'beaten', 'equal-rank flip must beat our card');
  }
  // flipped number of lower rank: flipped discarded, ours placed
  {
    const st = fixture({ ...base(), deck: ['the-journey'] });    // rank 3
    const nx = C.playCard(st, 1, 'the-soldier');
    check(nx.grid[1] === 'the-soldier', 'lower flip: our card not placed');
    check(nx.discard.includes('the-journey'), 'lower flip: flipped card not discarded');
    check(nx.lastFlip.result === 'lower', `lower flip: result ${nx.lastFlip.result}`);
  }
  // no flip for Aces/Crowns, and none from an empty deck
  {
    const st = fixture({ ...base(), hand: ['ace-of-daemons'], deck: ['the-merchant'] });
    const nx = C.playCard(st, 1, 'ace-of-daemons');
    check(nx.grid[1] === 'ace-of-daemons', 'ace play: not placed');
    check(nx.deck.length === 1 && nx.deck[0] === 'the-merchant', 'ace play: deck was touched');
    check(nx.lastFlip.result === 'none', 'ace play: flip recorded');
    const drawn = C.endTurn(nx);
    check(drawn.hand.includes('the-merchant') && drawn.deck.length === 0, 'draw after the turn');
  }
  {
    const st = fixture({ ...base(), deck: [] });
    const nx = C.playCard(st, 1, 'the-soldier');
    check(nx.grid[1] === 'the-soldier' && nx.lastFlip.result === 'none', 'empty deck: flip recorded');
  }
  // determinism of the flip stream
  {
    const mk = () => fixture({
      ...base(),
      deck: BASIC.filter((id) => !['ace-of-moons', 'ace-of-suns', 'ace-of-waves',
        'ace-of-leaves', 'the-soldier'].includes(id)).slice(0, 12),
    });
    const a = C.playCard(mk(), 1, 'the-soldier');
    const b = C.playCard(mk(), 1, 'the-soldier');
    check(JSON.stringify(a) === JSON.stringify(b), 'same state must flip the same card');
  }
}

/* --------------------------------------------------- illegal plays refused */
{
  const st = fixture({
    grid: { 0: 'ace-of-moons', 3: 'ace-of-suns', 12: 'ace-of-waves', 15: 'ace-of-leaves' },
    hand: ['the-soldier'],
    tokenCards: ['ace-of-moons', 'the-mountain'],
  });
  throws(() => C.playCard(st, 1, 'the-forest'), 'play of a card not in hand');
  throws(() => C.playCard(st, 0, 'the-soldier'), 'play into an occupied cell');
  throws(() => C.playCard(st, 5, 'the-soldier'), 'diagonal-only play (cell 5 touches no card)');
  throws(() => C.playCard(st, 6, 'the-soldier'), 'jump-over play (cell 6 touches no card)');
  throws(() => C.playCard(st, 99, 'the-soldier'), 'out-of-range cell');
  check(C.legalCells(st, 'the-forest').length === 0, 'legal cells for a non-hand card');
  const legal = C.legalCells(st, 'the-soldier');
  check(legal.length > 0, 'no legal cells with corners only?');
  for (const i of legal) {
    check(st.grid[i] === null, `legal cell ${i} is occupied`);
    check(C.orthogonal(i).some((n) => st.grid[n]), `legal cell ${i} does not touch the city`);
  }
}

/* --------------------------------------------------------- token deadlines */
{
  // 7 cards in the city, one token placed: the 4th play must force the 2nd token
  const st = fixture({
    grid: {
      0: 'ace-of-moons', 1: 'the-mountain', 3: 'ace-of-suns', 4: 'the-battle',
      5: 'the-forest', 12: 'ace-of-waves', 15: 'ace-of-leaves',
    },
    hand: ['the-soldier', 'the-cave'],
    tokenCards: ['ace-of-moons'],
  });
  check(C.cityCount(st) === 7, `city ${C.cityCount(st)} (want 7)`);
  check(!C.tokenDue(st), 'token due too early');
  const nx = C.playCard(st, 2, 'the-soldier');       // 8th card in the city
  check(C.cityCount(nx) === 8, `city ${C.cityCount(nx)} (want 8)`);
  check(C.tokenDue(nx) && C.dueToken(nx) === 2, 'second-token deadline did not fire');
  check(C.legalCells(nx, 'the-cave').length === 0, 'cards playable while the deadline stands');
  throws(() => C.playCard(nx, 6, 'the-cave'), 'play allowed while the deadline stands');
  throws(() => C.endTurn(nx), 'turn ended while the deadline stands');
  const after = C.placeToken(nx, 'the-mountain');
  check(after.tokenCards.length === 2, 'second token not placed');
  check(!C.tokenDue(after) && after.phase === 'idle', 'deadline still stands after the token');
  check(C.legalCells(after, 'the-cave').length > 0, 'no cells after the token');
}
{
  // 11 cards, two tokens: the 8th play forces the third
  const st = fixture({
    grid: {
      0: 'ace-of-moons', 1: 'the-mountain', 2: 'the-desert', 3: 'ace-of-suns',
      4: 'the-battle', 5: 'the-forest', 7: 'the-castle', 8: 'the-sea',
      10: 'the-end', 12: 'ace-of-waves', 15: 'ace-of-leaves',
    },
    hand: ['the-soldier'],
    tokenCards: ['ace-of-moons', 'the-mountain'],
  });
  check(C.cityCount(st) === 11, `city ${C.cityCount(st)} (want 11)`);
  const nx = C.playCard(st, 9, 'the-soldier');       // 12th card
  check(C.cityCount(nx) === 12, `city ${C.cityCount(nx)} (want 12)`);
  check(C.tokenDue(nx) && C.dueToken(nx) === 3, 'third-token deadline did not fire');
  throws(() => C.endTurn(nx), 'third token skipped');
  const after = C.placeToken(nx, 'the-castle');
  check(after.tokenCards.length === 3 && !C.tokenDue(after), 'deadline stands after the third token');
}
{
  // the fourth token is never forced
  const st = fixture({
    grid: {
      0: 'ace-of-moons', 1: 'the-mountain', 2: 'the-desert', 3: 'ace-of-suns',
      4: 'the-battle', 5: 'the-forest', 7: 'the-castle', 8: 'the-sea',
      10: 'the-end', 12: 'ace-of-waves', 15: 'ace-of-leaves',
    },
    hand: ['the-soldier'],
    deck: ['the-journey'],
    tokenCards: ['ace-of-moons', 'the-mountain', 'the-castle'],
  });
  check(!C.tokenDue(st), 'fourth token forced at 11 cards');
  const nx = C.playCard(st, 9, 'the-soldier');       // 12th card, three tokens placed
  check(!C.tokenDue(nx), 'fourth token forced at 12 cards');
  const done = C.endTurn(nx);                        // skip the fourth token entirely
  check(done.phase === 'idle', `phase ${done.phase} after skipping the fourth token`);
}

/* ---------------------------------------------------- token placement rules */
{
  const st = fixture({
    grid: { 0: 'ace-of-moons', 3: 'ace-of-suns', 12: 'ace-of-waves', 15: 'ace-of-leaves' },
    hand: ['the-soldier'], deck: ['the-journey'],
    tokenCards: ['ace-of-moons'],
    phase: 'token',
  });
  throws(() => C.placeToken(st, 'ace-of-moons'), 'second token on the same card');
  throws(() => C.placeToken(st, 'the-forest'), 'token on a card not in the city');
  const nx = C.placeToken(st, 'ace-of-suns');
  check(nx.tokenCards.length === 2, 'token not placed in the token phase');
  check(nx.phase === 'idle', 'turn not closed by the token');
  check(nx.hand.includes('the-journey'), 'no draw after the token');
  throws(() => C.placeToken(nx, 'ace-of-waves'), 'two tokens in one turn');
}
{
  // no tokens left
  const st = fixture({
    grid: { 0: 'ace-of-moons', 3: 'ace-of-suns', 12: 'ace-of-waves', 15: 'ace-of-leaves' },
    tokenCards: ['ace-of-moons', 'the-mountain', 'the-desert', 'the-cave'],
    phase: 'token',
  });
  throws(() => C.placeToken(st, 'ace-of-suns'), 'token placed with none left');
  // with all four down the turn just ends
  const grid = { 0: 'ace-of-moons', 3: 'ace-of-suns', 12: 'ace-of-waves', 15: 'ace-of-leaves' };
  const full = fixture({
    grid, hand: ['the-soldier'], deck: ['the-journey', 'the-sailor'],   // the flip eats one
    tokenCards: ['ace-of-moons', 'the-mountain', 'the-desert', 'the-cave'],
  });
  const nx = C.playCard(full, 1, 'the-soldier');
  check(nx.phase === 'idle', `phase ${nx.phase}: turn should end at once with 4 tokens`);
  // the flip eats the top card (the-sailor, lower rank -> discarded), the draw takes the-journey
  check(nx.hand.length === 1 && nx.hand[0] === 'the-journey' && nx.deck.length === 0,
    'no draw when the turn ends at once');
}

/* ------------------------------------------- districts and scoring fixtures */
{
  // one two-suit card, one token: the card counts for both of its districts
  const st = fixture({
    grid: { 0: 'ace-of-moons', 1: 'the-mountain' },   // the-mountain: 4 of Moons + Suns
    tokenCards: ['the-mountain'],
  });
  const ds = C.districts(st);
  check(ds.length === 2, `districts ${ds.length} (want 2)`);
  check(ds.some((d) => d.suit === 'moons' && d.size === 2), 'moons district should be {0,1}');
  check(ds.some((d) => d.suit === 'suns' && d.size === 1), 'suns district should be {1}');
  check(C.score(st) === 3, `score ${C.score(st)} (want 3)`);
}
{
  // tokens on three edges: the two-suit card is counted in both controlled districts
  const st = fixture({
    grid: { 0: 'ace-of-moons', 1: 'the-mountain', 2: 'ace-of-suns', 4: 'the-battle' },
    tokenCards: ['ace-of-moons', 'ace-of-suns', 'the-battle'],
  });
  const ds = C.districts(st);
  check(ds.length === 4, `districts ${ds.length} (want 4)`);
  check(C.score(st) === 6, `score ${C.score(st)} (want 6: moons 2 + suns 2 + daemons 1 + crowns 1)`);
}
{
  // diagonals do not connect, and uncontrolled districts score nothing
  const st = fixture({
    grid: { 0: 'ace-of-moons', 5: 'the-chance-meeting' },   // (0,0) and (1,1): diagonal
    tokenCards: ['ace-of-moons'],
  });
  const ds = C.districts(st);
  check(ds.length === 3, `districts ${ds.length} (want 3: two moons singles + one leaves single)`);
  check(C.score(st) === 1, `score ${C.score(st)} (want 1)`);
}
{
  // a chain: Moons run 0-1-2, Leaves 1-2, Waves isolated on both ends
  const st = fixture({
    grid: {
      0: 'the-journey',        // Moons + Waves
      1: 'the-forest',         // Moons + Leaves
      2: 'the-chance-meeting', // Moons + Leaves
      3: 'ace-of-waves',
    },
    tokenCards: ['the-forest'],
  });
  const ds = C.districts(st);
  check(ds.length === 4, `districts ${ds.length} (want 4)`);
  const moons = ds.find((d) => d.suit === 'moons');
  check(moons && moons.size === 3 && moons.cells.join() === '0,1,2', 'moons chain wrong');
  const leaves = ds.find((d) => d.suit === 'leaves');
  check(leaves && leaves.size === 2 && leaves.cells.join() === '1,2', 'leaves pair wrong');
  check(C.score(st) === 5, `score ${C.score(st)} (want 5: moons 3 + leaves 2)`);
  // no token at all: nothing scores
  check(C.score(fixture({ grid: { 0: 'the-journey', 1: 'the-forest' } })) === 0,
    'a tokenless city must score 0');
}

/* ------------------------------------------------------------ rank titles */
{
  const want = [
    [0, 'Outsider'], [10, 'Outsider'],
    [11, 'Respectable citizen'], [14, 'Respectable citizen'],
    [15, 'Aspiring noble'], [18, 'Aspiring noble'],
    [19, 'Favoured courtier'], [23, 'Favoured courtier'],
    [24, 'Power broker'], [26, 'Power broker'],
    [27, 'Mogul'], [29, 'Mogul'],
    [30, 'Prince of the city'], [40, 'Prince of the city'],
  ];
  for (const [pts, title] of want) {
    check(C.rankTitle(pts) === title, `rankTitle(${pts}) = ${C.rankTitle(pts)} (want ${title})`);
  }
  check(C.RANK_TITLES.length === 7, 'seven rungs in the hierarchy');
}

/* ------------------------------------------------ random games to the end */
function playout(seed, policy) {
  let st = C.newGame(seed, BASIC);
  let forced = 0;
  let guard = 0;
  while (!st.over && guard++ < 100) {
    if (st.phase === 'setup') {
      const i = st.corners[Math.floor(Math.random() * st.corners.length)];
      st = C.placeToken(st, st.grid[i]);
      continue;
    }
    if (st.phase === 'token') {
      if (C.tokenDue(st)) {
        forced++;
        st = C.placeToken(st, pickTokenCard(st));
      } else if (policy === 'random' && Math.random() < 0.5 && st.tokenCards.length < 4) {
        st = C.placeToken(st, pickTokenCard(st));
      } else {
        st = C.endTurn(st);
      }
      continue;
    }
    // idle: play a random hand card into a random legal cell
    const legal = C.legalCells(st, null);
    check(legal.length > 0, `seed ${seed}: stuck in the idle phase`);
    const cardId = st.hand[Math.floor(Math.random() * st.hand.length)];
    const cells = C.legalCells(st, cardId);
    check(cells.length > 0, `seed ${seed}: hand card with no legal cell`);
    st = C.playCard(st, cells[Math.floor(Math.random() * cells.length)], cardId);

    // invariants after every move
    checkDeck(st, `seed ${seed} mid-game`);
    check(st.phase !== 'idle' || !C.tokenDue(st),
      `seed ${seed}: idle with a token deadline outstanding`);
    check(st.tokenCards.length <= 4, `seed ${seed}: more than four tokens`);
    check(new Set(st.tokenCards).size === st.tokenCards.length, `seed ${seed}: duplicate token card`);
  }
  check(guard < 100, `seed ${seed} (${policy}): game never ended`);
  check(st.over === 'done', `seed ${seed} (${policy}): outcome ${st.over}`);
  return { st, forced };
}

function pickTokenCard(st) {
  const free = st.grid.filter((id) => id && !st.tokenCards.includes(id));
  return free[Math.floor(Math.random() * free.length)];
}

let forcedTotal = 0;
let scoreSum = 0;
for (const policy of ['random', 'stingy']) {
  for (let seed = 1; seed <= 200; seed++) {
    const { st, forced } = playout(seed, policy);
    forcedTotal += forced;

    check(C.cityCount(st) === 16, `seed ${seed} (${policy}): city ${C.cityCount(st)} at the end`);
    check(st.moves === 12, `seed ${seed} (${policy}): ${st.moves} plays`);
    check(st.grid.every(Boolean), `seed ${seed} (${policy}): city not full at the end`);
    check(st.hand.length === 3, `seed ${seed} (${policy}): hand ${st.hand.length} at the end`);
    check(st.tokenCards.length >= 3 && st.tokenCards.length <= 4,
      `seed ${seed} (${policy}): ${st.tokenCards.length} tokens at the end`);
    if (policy === 'stingy') {
      check(forced === 2,
        `seed ${seed} (stingy): ${forced} forced token placements (want exactly 2)`);
    }

    const score = C.score(st);
    check(Number.isInteger(score) && score >= 0 && score <= 32,
      `seed ${seed} (${policy}): implausible score ${score}`);
    scoreSum += score;

    // the state must survive a save/restore round trip untouched
    const rt = JSON.parse(JSON.stringify(st));
    check(JSON.stringify(rt) === JSON.stringify(st), `seed ${seed}: state is not JSON-stable`);
    check(C.score(rt) === score, `seed ${seed}: score changes after a JSON round trip`);
    check(typeof C.rankTitle(score) === 'string', `seed ${seed}: no rank for score ${score}`);
    const b = C.scoreBreakdown(st);
    check(b.score === score, `seed ${seed}: breakdown ${b.score} != score ${score}`);
  }
}

console.log('forced token placements:', forcedTotal);
console.log('average score:', (scoreSum / 400).toFixed(2));
console.log(failures === 0 ? 'jacynth: all tests passed' : `jacynth: ${failures} failures`);
process.exit(failures ? 1 : 0);

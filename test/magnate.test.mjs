// Headless tests for Magnate: node test/magnate.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/magnate-core.js');
C.init(byId);

const ALL = manifest.cards.map((c) => c.id);
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

const SUITS = C.SUITS;
const suits = (id) => byId[id].suits;

/* ---- conservation ---- */
function tokensConserved(st, label) {
  for (const s of SUITS) {
    for (let p = 0; p < 2; p++) {
      let onProps = 0;
      for (const d of st.districts) {
        for (const prop of d.props) {
          if (prop.owner === p) onProps += prop.spent[s] || 0;
        }
      }
      const have = st.supply[p][s] + st.spent[p][s] + onProps;
      check(have === st.collected[p][s],
        `${label}: P${p + 1} ${s}: ${st.supply[p][s]} supply + ${st.spent[p][s]} spent + ${onProps} on cards ` +
        `= ${have}, collected ${st.collected[p][s]}`);
    }
  }
}
function cardsConserved(st, label) {
  const all = C.allCards(st);
  if (all.length !== 34) { check(false, `${label}: ${all.length} property cards`); return; }
  if (new Set(all).size !== 34) check(false, `${label}: duplicate or missing property card`);
  const crowns = [...st.crowns[0], ...st.crowns[1]];
  check(crowns.length === 6 && new Set(crowns).size === 6, `${label}: six Crowns`);
}
function conserved(st, label) { cardsConserved(st, label); tokensConserved(st, label); }

/** Rig tokens onto a player, keeping the conservation books true. */
function giveTokens(st, p, suit, n) {
  st.supply[p][suit] += n;
  st.collected[p][suit] += n;
}

/** Put a property on the board, pulling its card out of wherever it was. */
function injectProp(st, districtIndex, prop) {
  for (const arr of [st.deck, st.discard, st.hands[0], st.hands[1]]) {
    const i = arr.indexOf(prop.id);
    if (i >= 0) arr.splice(i, 1);
  }
  st.districts[districtIndex].props.push(prop);
}

/** Put a card into a player's hand, pulling it out of wherever it was. */
function injectHand(st, p, id) {
  for (const arr of [st.deck, st.discard, st.hands[0], st.hands[1]]) {
    const i = arr.indexOf(id);
    if (i >= 0) { arr.splice(i, 1); break; }
  }
  st.hands[p].splice(0, 0, id);
}

/** The dice the core would roll for `seed` on a fresh turn (rolls = 0). */
function peekRoll(seed, rolls = 0) {
  const rng = mulberry32(((seed ^ 0x9e3779b9) + rolls * 2654435761) >>> 0);
  const a = 1 + Math.floor(rng() * 10);
  const b = 1 + Math.floor(rng() * 10);
  const tax = (a === 1 || b === 1) ? 1 + Math.floor(rng() * 6) : null;
  return { a, b, tax };
}
function findSeed(pred, from = 1) {
  for (let s = from; s < from + 4000; s++) if (pred(peekRoll(s))) return s;
  throw new Error('no suitable seed found');
}

/* ---- setup, over 300 seeds ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, ALL);
  check(st.deck.length === 28, `seed ${seed}: deck ${st.deck.length}`);
  check(st.hands[0].length === 3 && st.hands[1].length === 3, `seed ${seed}: three cards each`);
  check(st.crowns[0].length === 3 && st.crowns[1].length === 3, `seed ${seed}: three Crowns each`);
  check(st.crowns.flat().every((id) => byId[id].rank === 'crown'), `seed ${seed}: Crowns only`);
  check(C.totalTokens(st, 0) === 3 && C.totalTokens(st, 1) === 3, `seed ${seed}: three tokens each`);
  check(st.districts.length === 5 && st.districts.every((d) => d.props.length === 0),
    `seed ${seed}: five empty districts`);
  check(st.districts[4].marker === 'the-excuse', `seed ${seed}: the Excuse is the fifth district`);
  check(st.phase === 'roll' && st.turn === 0 && st.dice === null && !st.played, `seed ${seed}: first turn`);
  check(!C.allCards(st).some((id) => byId[id].rank === 'pawn' || byId[id].rank === 'crown' || byId[id].rank == null),
    `seed ${seed}: no Pawns, Crowns or Excuse in the property deck`);
  conserved(st, `seed ${seed}`);
}

/* ---- a. the roll: taxation, income ---- */
{
  let st = C.newGame(7, ALL);
  const rolled = C.rollPhase(st);
  check(rolled.phase === 'action' && rolled.rolls === 1 && rolled.dice, 'rolling opens the action phase');
  check(st.dice === null, 'the original state is not mutated');
  throws(() => C.rollPhase(rolled), 'rolling twice in one turn', 'already been rolled');
  throws(() => C.trade(st, 'moons', 'suns'), 'trading before the roll', 'after the dice');
  throws(() => C.playSell(st, 0), 'playing before the roll', 'action phase');
  throws(() => C.drawPhase(rolled), 'drawing before playing a card', 'play exactly one card');
  const rt = JSON.parse(JSON.stringify(rolled));
  check(rt.dice.a === rolled.dice.a, 'the dice survive a JSON round trip (a reload keeps them)');

  // taxation: find a taxed roll, rig a fat supply, check the cull
  const taxSeed = findSeed((r) => r.tax != null);
  const taxSuit = C.TAX_BY_DIE[peekRoll(taxSeed).tax - 1];
  let fat = C.newGame(taxSeed, ALL);
  giveTokens(fat, 0, taxSuit, 4);
  const taxed = C.rollPhase(fat);
  check(taxed.dice.tax != null, `seed ${taxSeed} rolls taxation`);
  check(taxed.supply[0][taxSuit] === 1, `taxation culls ${taxSuit} down to one`);
  check(taxed.spent[0][taxSuit] === 4, 'the culled tokens go to the bank');
  conserved(taxed, 'after taxation');

  // a 10 pays each player one token per Crown
  const tenSeed = findSeed((r) => Math.max(r.a, r.b) === 10 && r.a !== r.b && r.a > 1 && r.b > 1);
  let ten = C.newGame(tenSeed, ALL);
  const before = [C.totalTokens(ten, 0), C.totalTokens(ten, 1)];
  const paid = C.rollPhase(ten);
  check(C.totalTokens(paid, 0) === before[0] + 3 && C.totalTokens(paid, 1) === before[1] + 3,
    'a 10 pays three tokens to each player');
  for (let p = 0; p < 2; p++) {
    for (const c of paid.crowns[p]) {
      check(paid.supply[p][suits(c)[0]] >= 1, 'each Crown pays in its own suit');
    }
  }
  conserved(paid, 'after a 10');

  // a 2-9 pays for the matching rank; undeveloped deeds choose, Courts never pay
  const highSeed = findSeed((r) => {
    const h = Math.max(r.a, r.b);
    return h >= 2 && h <= 9 && r.a !== r.b && r.a > 1 && r.b > 1;
  });
  let rank = C.newGame(highSeed, ALL);
  const high = Math.max(peekRoll(highSeed).a, peekRoll(highSeed).b);
  const prop = { id: manifest.basicDeck.find((id) => byId[id].rank === high), owner: 0, developed: true, spent: {} };
  injectProp(rank, 0, prop);
  const paidRank = C.rollPhase(rank);
  const got = suits(prop.id).reduce((n, s) => n + (paidRank.supply[0][s] - rank.supply[0][s]), 0);
  check(got === suits(prop.id).length,
    `a developed ${high} pays one token per suit (${suits(prop.id).join(', ')}), got ${got}`);
  const paidCourt = structuredClone(paidRank);
  injectProp(paidCourt, 1, { id: 'the-consul', owner: 1, developed: true, spent: {} });
  const beforeCourt = C.totalTokens(paidCourt, 1);
  const rolled2 = C.rollPhase({ ...paidCourt, phase: 'roll', dice: null });
  check(C.totalTokens(rolled2, 1) === beforeCourt, 'a developed Court never provides income');
  conserved(paidRank, 'after rank income');

  // a pair of 1s collects for Ace properties
  const oneSeed = findSeed((r) => r.a === 1 && r.b === 1);
  let ones = C.newGame(oneSeed, ALL);
  injectProp(ones, 0, { id: 'ace-of-moons', owner: 0, developed: true, spent: {} });
  injectProp(ones, 1, { id: 'ace-of-waves', owner: 1, developed: false, spent: {} });
  const paidOnes = C.rollPhase(ones);
  check(paidOnes.supply[0].moons === ones.supply[0].moons + 1, 'a pair of 1s pays for a built Ace');
  check(paidOnes.supply[1][C.pickIncomeSuit(ones, 1, 'ace-of-waves')] === ones.supply[1].waves + 1 ||
    paidOnes.supply[1].waves === ones.supply[1].waves + 1,
    'an undeveloped Ace deed still pays one matching resource');
  conserved(paidOnes, 'after a pair of 1s');
}

/* ---- b. actions: trade, spend, develop, deed, sell ---- */
{
  let st = C.rollPhase(C.newGame(11, ALL));
  giveTokens(st, 0, 'moons', 3);
  const traded = C.trade(st, 'moons', 'waves');
  check(traded.supply[0].moons === 1 && traded.supply[0].waves === st.supply[0].waves + 1, '3 for 1');
  tokensConserved(traded, 'after a trade');
  throws(() => C.trade(st, 'moons', 'moons'), 'trading a suit for itself', 'different suit');
  throws(() => C.trade(st, 'moons', 'wyrms'), 'trading an unknown suit', 'different suit');
  const broke = structuredClone(st); broke.supply[0].moons = 2;
  throws(() => C.trade(broke, 'moons', 'waves'), 'trading without 3 tokens', 'needs 3 moons');
  const afterDraw = { ...traded, phase: 'draw' };
  giveTokens(afterDraw, 0, 'suns', 3);
  const late = C.trade(afterDraw, 'suns', 'waves');
  check(late.supply[0].suns === 0 && late.phase === 'draw',
    'trading is still open in the draw phase, before drawing');

  // partial development: only matching suits, completion flips the flag
  let dev = C.rollPhase(C.newGame(13, ALL));
  injectProp(dev, 0, { id: 'the-mill', owner: 0, developed: false, spent: {} });   // 8 waves+leaves
  giveTokens(dev, 0, 'waves', 3);
  giveTokens(dev, 0, 'leaves', 2);
  throws(() => C.spend(dev, 0, 'moons'), 'spending a non-matching token', 'shows no moons');
  throws(() => C.spend(dev, 1, 'waves'), 'spending with no deed there', 'no unfinished deed');
  let half = C.spend(dev, 0, 'waves');
  check(half.districts[0].props[0].spent.waves === 1 && !half.districts[0].props[0].developed,
    'one token lands on the deed');
  const done = C.spend(C.spend(half, 0, 'waves'), 0, 'waves');
  check(!done.districts[0].props[0].developed, 'three of eight is not done');
  tokensConserved(half, 'after a partial spend');

  // outright development: the app's payment keeps one of each suit
  let out = C.rollPhase(C.newGame(17, ALL));
  injectHand(out, 0, 'the-mill');
  giveTokens(out, 0, 'waves', 4);
  giveTokens(out, 0, 'leaves', 4);
  const pay = C.developmentPayment(out, 'the-mill');
  check(pay.waves + pay.leaves === 8 && pay.waves >= 1 && pay.leaves >= 1,
    `a Mill (8) is paid 1+7 in some order, got ${JSON.stringify(pay)}`);
  const built = C.playDevelop(out, 0, 0);
  const placed = built.districts[0].props[0];
  check(placed.id === 'the-mill' && placed.developed && placed.owner === 0, 'the property is built');
  check(built.phase === 'draw' && built.played, 'one play ends the action phase');
  tokensConserved(built, 'after development');
  throws(() => C.playSell(built, 0), 'playing two cards in a turn', 'already played');
  const poor = structuredClone(out);
  poor.supply[0].waves = 1; poor.supply[0].leaves = 1;
  throws(() => C.playDevelop(poor, 0, 0), 'developing without the tokens', 'costs 8 tokens');

  // the Ace costs 3 of its suit; the district chain decides placement
  let aceGame = C.rollPhase(C.newGame(19, ALL));
  injectHand(aceGame, 0, 'ace-of-moons');
  giveTokens(aceGame, 0, 'moons', 3);
  throws(() => C.playDevelop(aceGame, 0, 2), 'an Ace of Moons cannot start the Light Keeper district', 'shares no suit');
  const aceBuilt = C.playDevelop(aceGame, 0, 1);
  check(aceBuilt.districts[1].props[0].id === 'ace-of-moons', 'an Ace can start the Harvest district');
  check(C.playDevelop(aceGame, 0, 4), 'any card may start the Excuse district');

  // a second property in a district must match the previous one
  const g = structuredClone(aceBuilt);
  g.phase = 'action';
  g.played = false;
  injectHand(g, 0, 'the-journey');                  // moons+waves — chains onto the Ace of Moons
  giveTokens(g, 0, 'moons', 2);
  giveTokens(g, 0, 'waves', 2);
  throws(() => C.playDevelop({ ...g, hands: [['the-mill', ...g.hands[0].slice(1)], g.hands[1]] }, 0, 1),
    'the Mill cannot chain onto the Ace of Moons', 'shares no suit');
  const chained = C.playDevelop(g, 0, 1);
  check(chained.districts[1].props.length === 2, 'the second property matches the previous one');
  tokensConserved(chained, 'after chaining');

  // deeds: one token per suit, and your own unfinished deed blocks your district
  let deed = C.rollPhase(C.newGame(23, ALL));
  injectHand(deed, 0, 'the-discovery');             // 5 suns+waves
  giveTokens(deed, 0, 'suns', 1);
  giveTokens(deed, 0, 'waves', 1);
  throws(() => C.playDeed({ ...deed, supply: [{ ...deed.supply[0], waves: 0 }, deed.supply[1]] }, 0, 0),
    'a deed needs one token per suit', 'one waves token');
  const got = C.playDeed(deed, 0, 0);
  check(got.districts[0].props[0].developed === false, 'a bought deed is undeveloped');
  check(got.phase === 'draw', 'buying a deed is the turn\'s play');
  throws(() => C.playDevelop({ ...got, phase: 'action', played: false }, 0, 0),
    'your own unfinished deed blocks the district', 'must finish developing');

  // selling: two tokens, one per suit (two of an Ace's suit, three of a Court)
  let sell = C.rollPhase(C.newGame(29, ALL));
  const before0 = C.totalTokens(sell, 0);
  const sold = C.playSell(sell, 0);
  check(C.totalTokens(sold, 0) === before0 + 2, 'a numbered card sells for two tokens');
  check(sold.discard.length === 1 && sold.hands[0].length === 2, 'the card goes to the discard pile');
  let sellAce = C.rollPhase(C.newGame(31, ALL));
  injectHand(sellAce, 0, 'ace-of-daemons');
  const aceSold = C.playSell(sellAce, 0);
  check(aceSold.supply[0].daemons === sellAce.supply[0].daemons + 2, 'an Ace sells for two of its suit');
  let sellCourt = C.rollPhase(C.newGame(37, ALL));
  injectHand(sellCourt, 0, 'the-island');           // court: suns+waves+daemons
  const courtSold = C.playSell(sellCourt, 0);
  check(C.totalTokens(courtSold, 0) === C.totalTokens(sellCourt, 0) + 3, 'a Court sells for three tokens');
  conserved(courtSold, 'after selling a Court');
  tokensConserved(aceSold, 'after selling an Ace');
}

/* ---- c. the draw, reshuffle, final turns, game end ---- */
{
  let st = C.rollPhase(C.newGame(41, ALL));
  st = C.playSell(st, 0);
  check(st.deck.length === 28, `deck after setup and one sell: ${st.deck.length}`);
  st.discard.push(...st.deck);                        // exhaust the pile without losing cards
  st.deck = [];
  const drawn = C.drawPhase(st);
  check(drawn.exhaustions === 1 && drawn.deck.length === 28 && drawn.discard.length === 0,
    'the first exhaustion reshuffles the discard pile and draws from it');
  check(drawn.turn === 1 && drawn.phase === 'roll' && !drawn.played, 'the draw ends the turn');
  check(drawn.hands[0].length === 3, `the reshuffled card lands in the drawer's hand (${drawn.hands[0].length})`);

  let pre = { ...drawn, phase: 'action', played: false };
  pre = C.playSell(pre, 0);
  pre.discard.push(...pre.deck);
  pre.deck = [];
  const second = C.drawPhase(pre);
  check(second.finalTurnsLeft === 1 && second.turn === 0 && !second.over,
    'the second exhaustion grants each player one final turn');
  const ended = C.drawPhase(C.playSell(C.rollPhase(second), 0));
  check(ended.over === 'done' && ended.final, 'the last final turn ends the game');
  check(ended.final.winner === C.scoreFinal(ended).winner, 'the winner is the scoring verdict');
  conserved(ended, 'at game end');
}

/* ---- final scoring fixtures, computed on paper ---- */
{
  // Fixture A: districts, an Ace multiplier, a Court, and a ranks tiebreak
  const st = C.newGame(3, ALL);
  st.districts[0].props = [
    { id: 'the-mill', owner: 0, developed: true, spent: {} },        // 8
    { id: 'the-cave', owner: 1, developed: true, spent: {} },        // 7
  ];
  st.districts[1].props = [
    { id: 'ace-of-moons', owner: 0, developed: true, spent: {} },    // 1 + one moons neighbour = 2
    { id: 'the-forest', owner: 0, developed: true, spent: {} },      // 5 moons+leaves
  ];
  st.districts[2].props = [
    { id: 'the-consul', owner: 1, developed: true, spent: {} },      // Court = 10
    { id: 'the-painter', owner: 0, developed: true, spent: {} },     // 3 suns+crowns
  ];
  st.districts[3].props = [
    { id: 'the-market', owner: 0, developed: true, spent: {} },      // 6 leaves+crowns
    { id: 'the-betrayal', owner: 1, developed: true, spent: {} },    // 8 daemons+crowns
  ];
  const fin = C.scoreFinal(st);
  check(fin.totals[0][0] === 8 && fin.totals[0][1] === 7, `district 1: ${fin.totals[0]}`);
  check(fin.totals[1][0] === 7 && fin.totals[1][1] === 0, `district 2: ${fin.totals[1]} (Ace + moons neighbour)`);
  check(fin.totals[2][0] === 3 && fin.totals[2][1] === 10, `district 3: ${fin.totals[2]} (Court is 10)`);
  check(fin.totals[3][0] === 6 && fin.totals[3][1] === 8, `district 4: ${fin.totals[3]}`);
  check(fin.totals[4][0] === 0 && fin.totals[4][1] === 0, 'the Excuse district starts empty');
  check(fin.vps[0] === 2 && fin.vps[1] === 2, `districts tied ${fin.vps}`);
  check(fin.ranks[0] === 23 && fin.ranks[1] === 25,
    `total ranks: P1 ${fin.ranks[0]} (8+1+5+3+6), P2 ${fin.ranks[1]} (7+10+8)`);
  check(fin.winner === 1 && fin.how === 'ranks',
    `P2 wins the tiebreak on ranks (winner ${fin.winner}, how ${fin.how})`);

  // Fixture B: districts and ranks tied — remaining resources decide
  const st2 = C.newGame(5, ALL);
  st2.districts[1].props = [
    { id: 'the-mountain', owner: 0, developed: true, spent: {} },   // 4 moons+suns
    { id: 'the-sailor', owner: 1, developed: true, spent: {} },     // 4 waves+leaves
  ];
  st2.districts[2].props = [
    { id: 'the-journey', owner: 0, developed: true, spent: {} },    // 3 moons+waves
    { id: 'the-painter', owner: 1, developed: true, spent: {} },    // 3 suns+crowns
  ];
  giveTokens(st2, 0, 'moons', 5);
  const fin2 = C.scoreFinal(st2);
  check(fin2.vps[0] === 0 && fin2.vps[1] === 0, 'no district is won');
  check(fin2.ranks[0] === 7 && fin2.ranks[1] === 7, `ranks tied ${fin2.ranks}`);
  check(fin2.tokens[0] === 8 && fin2.tokens[1] === 3, `tokens ${fin2.tokens}`);
  check(fin2.winner === 0 && fin2.how === 'tokens', 'the player with more resources becomes Grand Duke');

  // Fixture C: taxation reaches the final state — an unfinished deed never scores
  const taxSeed = findSeed((r) => r.tax != null);
  const taxSuit = C.TAX_BY_DIE[peekRoll(taxSeed).tax - 1];
  let st3 = C.newGame(taxSeed, ALL);
  giveTokens(st3, 0, taxSuit, 3);
  st3 = C.rollPhase(st3);
  check(st3.supply[0][taxSuit] === 1, `taxation culls ${taxSuit} to one before income`);
  st3.districts[0].props.push({ id: 'the-soldier', owner: 0, developed: false, spent: { daemons: 2, crowns: 2 } });
  st3.collected[0].daemons += 2; st3.collected[0].crowns += 2;
  tokensConserved(st3, 'before the deed is discarded');
  const fin3 = C.scoreFinal(st3);
  check(fin3.totals[0][1] === 0, 'an undeveloped deed never scores');
  check(fin3.totals[0][0] === 0, 'nor does it score for its owner');
}

/* ---- random games ---- */
let totalMoves = 0, games = 0, winners = [0, 0, 0];
for (let seed = 1; seed <= 40; seed++) {
  let st = C.newGame(seed, ALL);
  const rng = mulberry32(seed * 977 + 3);
  let guard = 0;
  while (!st.over && guard++ < 30000) {
    const acts = C.legalActions(st);
    check(acts.length > 0, `seed ${seed}: no legal action in phase ${st.phase}`);
    if (!acts.length) break;
    const act = acts[Math.floor(rng() * acts.length)];
    st = C.applyMove(st, act);
    totalMoves++;
    conserved(st, `seed ${seed} move ${st.moves}`);
    check(JSON.parse(JSON.stringify(st)).seed === seed, `seed ${seed}: JSON round trip`);
  }
  check(st.over === 'done', `seed ${seed}: the game never ended (phase ${st.phase}, turn ${st.turn})`);
  if (st.over === 'done') {
    games++;
    winners[st.winner ?? 2] += 1;
    const verdict = C.scoreFinal(st);
    check(verdict.winner === st.winner, `seed ${seed}: winner ${st.winner} vs ${verdict.winner}`);
    check(st.districts.every((d) => d.props.every((p) => p.developed)),
      `seed ${seed}: no unfinished deeds survive the end`);
    check(st.hands[0].length === 0 && st.hands[1].length === 0, `seed ${seed}: hands are discarded`);
  }
}
check(totalMoves > 1500, `only ${totalMoves} moves played`);

console.log(`random games: ${games} finished in ${totalMoves} moves — ` +
  `Grand Duke P1/P2/draw ${winners.join('/')}`);
console.log(failures === 0 ? 'magnate: all tests passed' : `magnate: ${failures} failures`);
process.exit(failures ? 1 : 0);

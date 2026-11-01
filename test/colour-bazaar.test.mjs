// Headless tests for Colour Bazaar: node test/colour-bazaar.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/colour-bazaar-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
const SUITS = C.SUITS;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const named = (name) => BASIC.find((id) => byId[id].name === name);
const throws = (fn, want) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) { check(false, `expected a throw containing "${want}"`); return; }
  check(String(err.message).length > 8, `error "${err.message}" does not explain itself`);
  check(String(err.message).includes(want),
    `error "${err.message}" should mention "${want}"`);
};

const chipsTotal = (state) =>
  SUITS.reduce((n, s) => n + state.supply[s] + state.chips[0][s] + state.chips[1][s], 0);

function checkState(st, label) {
  const all = C.allCards(st);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
  if (chipsTotal(st) !== 30) check(false, `${label}: ${chipsTotal(st)} chips in play`);
  for (const s of SUITS) {
    const n = st.supply[s] + st.chips[0][s] + st.chips[1][s];
    if (n !== 5) check(false, `${label}: ${s} chips total ${n}`);
  }
  if (st.stacks.length !== 4 || st.stacks.some((st2, i) => st2[0] !== C.PAWNS[i])) {
    check(false, `${label}: a market lost its Pawn`);
  }
  if (st.hands.some((h) => h.length > 6)) check(false, `${label}: hand ballooned`);
  if (!['play', 'chip'].includes(st.phase)) check(false, `${label}: bad phase ${st.phase}`);
}

/* ------------------------------------------------------------------ setup */

for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 4 && st.hands[1].length === 4,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.draw.length === 28, `seed ${seed}: draw ${st.draw.length}`);
  check(st.stacks.every((s) => s.length === 1), `seed ${seed}: markets should hold a Pawn`);
  check(SUITS.every((s) => st.supply[s] === 5), `seed ${seed}: supply`);
  check(st.turn === 0 && st.phase === 'play', `seed ${seed}: turn/phase`);
  checkState(st, `seed ${seed}`);
  const st2 = C.newGame(seed, BASIC);
  check(JSON.stringify(st2) === JSON.stringify(st), `seed ${seed}: setup is not deterministic`);
}

/* ---- 300 seeds: a few random legal moves each, conservation throughout ---- */
{
  let played = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let st = C.newGame(seed, BASIC);
    const rng = mulberry32(seed * 17 + 3);
    for (let i = 0; i < 6; i++) {
      const acts = C.legalActions(st);
      if (!acts.length || st.over) break;
      st = C.applyMove(st, acts[Math.floor(rng() * acts.length)]);
      checkState(st, `seed ${seed} move ${i}`);
      played++;
    }
  }
  check(played > 1200, `only ${played} moves across the seed sweep`);
}

/* --------------------------------------------------------- playing cards */

{
  // the Pawns open every market to three suits each
  const st = C.newGame(3, BASIC);
  check(!C.canPlay(st, named('the Pact'), 0), 'a moons-suns 9 does not fit the borderland');
  check(C.canPlay(st, named('the Pact'), 1), '…but it fits the harvest (moons)');
  const moonTop = C.newGame(3, BASIC);
  moonTop.hands = [[named('Ace of Moons')], [named('the Cave')]];
  const played = C.playCard(moonTop, named('Ace of Moons'), 1);    // the-harvest: moons+suns+leaves
  check(played.stacks[1].length === 2 && played.stacks[1][1] === named('Ace of Moons'),
    'the ace joins its market');
  check(played.phase === 'chip', 'a play leads to the chip step');
  check(played.hands[0].length === 0, 'the played card leaves the hand');
  check(moonTop.hands[0].length === 1, 'the original state must not be mutated');

  throws(() => C.playCard(played, named('Ace of Moons'), 1), 'chip phase');  // wrong phase
  throws(() => C.playCard(moonTop, named('the Desert'), 1), 'not in Player 1');

  // market 3 is the-light-keeper: suns+waves+crowns — a moons ace shares nothing with it
  throws(() => C.playCard(moonTop, named('Ace of Moons'), 2), 'shares no suit');
  throws(() => C.playCard(moonTop, named('Ace of Moons'), 9), 'markets');
}

/* --------------------------------------------------------- forced discards */

{
  let st = C.newGame(4, BASIC);
  // a hand of daemons-cards fits the borderland and the watchman; craft one that fits nothing
  st.hands = [[named('the Battle')], [named('the Cave')]];   // daemons+crowns / waves+daemons
  // the Battle (daemons+crowns) fits market 0 (borderland: daemons) — so a discard must be refused
  throws(() => C.discardCard(st, named('the Battle')), 'could still be played');

  // a moons-only hand against moons-free market tops… make a hand that fits nothing:
  // every market top: borderland (waves/leaves/daemons), harvest (moons/suns/leaves),
  // light-keeper (suns/waves/crowns), watchman (moons/daemons/crowns) — all six suits appear,
  // so a hand always fits something; simulate the end game instead: raise the tops.
  st.stacks[0].push(named('the Windfall'));       // crown of crowns: tops market 1 with crowns
  st.stacks[1].push(named('the End'));            // crown of leaves
  st.stacks[2].push(named('the Sea'));            // crown of waves
  st.stacks[3].push(named('the Calamity'));       // crown of daemons
  st.hands = [[named('Ace of Suns')], []];        // a lone suns ace: no crown shares suns
  check(!C.anyLegalPlay(st), 'nothing fits the crowned tops');
  const disc = C.discardCard(st, named('Ace of Suns'));
  check(disc.discard.includes(named('Ace of Suns')) && disc.phase === 'chip',
    'the forced discard still earns a chip step');
}

/* ------------------------------------------------------------- chip taking */

{
  let st = C.newGame(5, BASIC);
  st.phase = 'chip';
  const took = C.takeChip(st, 'moons');
  check(took.chips[0].moons === 1 && took.supply.moons === 4, 'a chip changes hands');
  check(took.turn === 1 && took.phase === 'play', 'the other player takes their turn');
  check(took.hands[0].length === 5, 'the investor drew a card');
  check(chipsTotal(took) === 30, 'chips are conserved');

  throws(() => C.takeChip(took, 'moons'), 'play phase');         // wrong phase now
  throws(() => C.takeChip(st, 'unicorns'), 'six styles');

  st.supply.waves = 0;
  throws(() => C.takeChip(st, 'waves'), 'already been taken');

  // the last chip ends the game there and then — no draw, no turn
  const last = structuredClone(st);
  for (const s of SUITS) last.chips[0][s] = s === 'moons' ? 4 : 5;   // 29 chips banked
  last.supply = { moons: 1, suns: 0, waves: 0, leaves: 0, daemons: 0, crowns: 0 };
  check(chipsTotal(last) === 30, 'the fixture starts with all 30 chips placed');
  const ended = C.takeChip(last, 'moons');
  check(ended.over === 'done' && ended.turn === 0, 'the taker of the last chip ends it');
  check(chipsTotal(ended) === 30, 'even at the end, chips are conserved');
  check(ended.hands[0].length === last.hands[0].length, 'no card is drawn at the end');
}

/* ---------------------------------------------------------------- scoring */

{   // the wiki's own worked example, stack by stack
  const st = C.newGame(6, BASIC);
  st.stacks = [
    ['the-harvest', named('the Cave'), named('the Discovery'), named('Ace of Suns'),
      named('the Diplomat'), named('the Author'), named('the Huntress')],
    ['the-borderland'],
    ['the-light-keeper'],
    ['the-watchman'],
  ];
  check(C.stackContribution(st.stacks[0], 'moons') === 8,
    'a Crown of Moons copies the highest moon card (8), not the closest (2)');
  check(C.stackContribution(st.stacks[0], 'suns') === 8, 'the 8 is the sun closest to the top');
  check(C.stackContribution(st.stacks[0], 'waves') === 5, 'the 5 is the wave closest to the top');
  check(C.stackContribution(st.stacks[0], 'daemons') === 7, 'the 7 is the only wyrm');
  check(C.stackContribution(st.stacks[0], 'crowns') === 2, 'the Author is the top knot');
  check(C.stackContribution(st.stacks[0], 'leaves') === 0, 'no leaves: nothing');
  check(C.stackContribution(st.stacks[1], 'moons') === 0, 'a bare Pawn contributes nothing');

  const pad = C.score(st);
  check(pad.values.moons === 8 && pad.values.suns === 8 && pad.values.waves === 5 &&
    pad.values.leaves === 0 && pad.values.daemons === 7 && pad.values.crowns === 2,
    `wiki example values: ${JSON.stringify(pad.values)}`);

  // scoring only counts chips you hold
  st.chips = [{ moons: 2, suns: 0, waves: 0, leaves: 0, daemons: 0, crowns: 1 },
    { moons: 0, suns: 0, waves: 1, leaves: 0, daemons: 3, crowns: 0 }];
  const scored = C.score(st);
  check(scored.players[0] === 2 * 8 + 2, `player 1 holds 2 moons + 1 knot = 18, got ${scored.players[0]}`);
  check(scored.players[1] === 5 + 3 * 7, `player 2 holds 1 wave + 3 wyrms = 26, got ${scored.players[1]}`);
  st.winner = scored.players[0] === scored.players[1] ? null : (scored.players[0] > scored.players[1] ? 0 : 1);
  check(st.winner === 1, 'player 2 wins the wiki fixture');

  // a Crown with no matching number card in its stack is worth nothing
  const crownOnly = C.stackContribution(['the-light-keeper', named('the Bard')], 'suns');
  check(crownOnly === 0, `a Crown whose suit has no number card scores 0, got ${crownOnly}`);
  check(C.stackContribution(['the-light-keeper', named('the Bard')], 'crowns') === 0,
    'and the same for its other suit');
}

/* ---------------------- two finished games, scored on paper ------------- */

{   // Game 1 — the wiki's example stacks, played out to the last chip.
  //   market 1 (borderland): the Cave (7 waves+daemons), the Discovery (5 suns+waves)
  //     → waves 5, daemons 7, suns 5
  //   market 2 (harvest): Ace of Suns, the Diplomat (8 moons+suns), the Author
  //     (2 moons+crowns), the Huntress (crown moons)
  //     → moons: crowned, highest moon number = 8; suns 8; crowns 2
  //   markets 3+4: bare Pawns → 0
  //   values: moons 8, suns 5+8 = 13, waves 5, leaves 0, daemons 7, crowns 2
  //   P1 holds 5 moons + 4 suns + 5 wyrms = 40+52+35 = 127
  //   P2 holds 1 sun + 5 waves + 5 leaves + 4 knots = 13+25+0+8 = 46
  //   The last knot chip is taken by P1: 127+2 = 129.  P1 wins 129 to 46.
  const st = C.newGame(7, BASIC);
  st.stacks = [
    ['the-borderland', named('the Cave'), named('the Discovery')],
    ['the-harvest', named('Ace of Suns'), named('the Diplomat'), named('the Author'),
      named('the Huntress')],
    ['the-light-keeper'],
    ['the-watchman'],
  ];
  st.chips = [{ moons: 5, suns: 4, waves: 0, leaves: 0, daemons: 5, crowns: 0 },
    { moons: 0, suns: 1, waves: 5, leaves: 5, daemons: 0, crowns: 4 }];
  st.supply = { moons: 0, suns: 0, waves: 0, leaves: 0, daemons: 0, crowns: 1 };
  // hands may not duplicate market cards; the rest of the deck fills draw + discard
  const stackIds = new Set(st.stacks.flat());
  st.hands = [st.hands[0].filter((id) => !stackIds.has(id)),
    st.hands[1].filter((id) => !stackIds.has(id))];
  const rest = BASIC.filter((id) => !stackIds.has(id) && !st.hands.flat().includes(id));
  st.draw = rest.slice(0, 12);
  st.discard = rest.slice(12);
  st.phase = 'chip';
  st.turn = 0;
  checkState(st, 'game 1 fixture');
  const ended = C.takeChip(st, 'crowns');          // the last chip on offer
  check(ended.over === 'done', `game 1 ends on the last chip, got ${ended.over}`);
  const pad = C.score(ended);
  check(pad.values.moons === 8 && pad.values.suns === 13 && pad.values.waves === 5 &&
    pad.values.leaves === 0 && pad.values.daemons === 7 && pad.values.crowns === 2,
    `game 1 style values: ${JSON.stringify(pad.values)}`);
  check(pad.players[0] === 129, `game 1 P1 paper score 129 (127 + the last chip), got ${pad.players[0]}`);
  check(pad.players[1] === 46, `game 1 P2 paper score 46, got ${pad.players[1]}`);
  check(ended.winner === 0, 'P1 wins game 1');
  checkState(ended, 'game 1 final');

{   // Game 2 — four busy markets, including a Crown that lifts its suit and one
  // that scores nothing.
  //   market 1 (borderland): the Savage (3 leaves+daemons) then the Penitent
  //     (6 suns+daemons) → leaves 3, daemons 6, suns 6
  //   market 2 (harvest): the Bard (crown suns) → suns 0 (no sun number!), crowns 0
  //   market 3 (light-keeper): Ace of Crowns then the Painter (3 suns+crowns)
  //     → crowns 3 (the Crown copies the highest knot number), suns 3
  //   market 4 (watchman): the Darkness (9 waves+daemons) then the Lunatic
  //     (6 moons+waves) → waves 6, daemons 9, moons 6
  //   values: moons 6, suns 9, waves 6 (the Lunatic tops its market), leaves 3,
  //     daemons 15, crowns 3
  //   P1 holds 4 moons + 2 suns + 5 waves + 1 leaf + 5 wyrms + 2 knots
  //     = 24+18+30+3+75+6 = 156
  //   P2 holds 1 moon + 3 suns + 4 leaves + 2 knots = 6+27+12+6 = 51,
  //     and takes the last crowns chip: 51+3 = 54.  P1 wins 156 to 54.
  const st = C.newGame(8, BASIC);
  st.stacks = [
    ['the-borderland', named('the Savage'), named('the Penitent')],
    ['the-harvest', named('the Bard')],
    ['the-light-keeper', named('Ace of Crowns'), named('the Painter')],
    ['the-watchman', named('the Darkness'), named('the Lunatic')],
  ];
  st.chips = [{ moons: 4, suns: 2, waves: 5, leaves: 1, daemons: 5, crowns: 2 },
    { moons: 1, suns: 3, waves: 0, leaves: 4, daemons: 0, crowns: 2 }];
  st.supply = { moons: 0, suns: 0, waves: 0, leaves: 0, daemons: 0, crowns: 1 };
  const stackIds = new Set(st.stacks.flat());
  st.hands = [st.hands[0].filter((id) => !stackIds.has(id)),
    st.hands[1].filter((id) => !stackIds.has(id))];
  const rest = BASIC.filter((id) => !stackIds.has(id) && !st.hands.flat().includes(id));
  st.draw = rest.slice(0, 14);
  st.discard = rest.slice(14);
  st.phase = 'chip';
  st.turn = 1;
  checkState(st, 'game 2 fixture');
  const ended = C.takeChip(st, 'crowns');          // P2 takes the very last chip
  check(ended.over === 'done', `game 2 ends on the last chip, got ${ended.over}`);
  const pad = C.score(ended);
  check(pad.values.moons === 6 && pad.values.suns === 9 && pad.values.waves === 6 &&
    pad.values.leaves === 3 && pad.values.daemons === 15 && pad.values.crowns === 3,
    `game 2 style values: ${JSON.stringify(pad.values)}`);
  check(pad.players[0] === 156, `game 2 P1 paper score 156, got ${pad.players[0]}`);
  check(pad.players[1] === 54, `game 2 P2 paper score 54 (51 + the last chip), got ${pad.players[1]}`);
  check(ended.winner === 0, 'P1 wins game 2');
  checkState(ended, 'game 2 final');
}
}

/* ------------------------------------------------- independent scorer ---- */

/** A second, deliberately naive implementation of the end-game valuation. */
function refValue(st, suit) {
  let total = 0;
  for (const stack of st.stacks) {
    const nums = stack
      .filter((id) => typeof byId[id].rank === 'number' && byId[id].suits.includes(suit))
      .map((id) => (byId[id].rank === 1 ? 1 : byId[id].rank));
    const crowned = stack.some((id) => byId[id].rank === 'crown' && byId[id].suits.includes(suit));
    if (crowned) { total += nums.length ? Math.max(...nums) : 0; continue; }
    for (let i = stack.length - 1; i >= 0; i--) {
      const id = stack[i];
      if (typeof byId[id].rank === 'number' && byId[id].suits.includes(suit)) {
        total += byId[id].rank === 1 ? 1 : byId[id].rank;
        break;
      }
    }
  }
  return total;
}

/* ------------------------------------------------------- random matches */

let movesPlayed = 0, gamesPlayed = 0, lastWinner = null, seedUsed = 0;
for (let seed = 1; seed <= 40; seed++) {
  seedUsed = seed;
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 41 + 11);
  let guard = 0;
  while (!st.over && guard++ < 4000) {
    const acts = C.legalActions(st);
    if (!acts.length) { check(false, `seed ${seed}: no legal moves in ${st.phase}`); break; }
    st = C.applyMove(st, acts[Math.floor(rng() * acts.length)]);
    movesPlayed++;
    if (movesPlayed % 4 === 0) checkState(st, `seed ${seed} move ${guard}`);
  }
  if (!st.over) { check(false, `seed ${seed}: game never finished`); continue; }
  gamesPlayed++;
  lastWinner = st.winner;
  check(SUITS.every((s) => st.supply[s] === 0), `seed ${seed}: chips left at the end`);
  const pad = C.score(st);
  for (const s of SUITS) {
    check(pad.values[s] === refValue(st, s),
      `seed ${seed}: ${s} valued ${pad.values[s]}, the paper reckoner says ${refValue(st, s)}`);
  }
  const hi = Math.max(...pad.players);
  check(st.winner == null ? pad.players[0] === pad.players[1]
    : pad.players[st.winner] === hi, `seed ${seed}: winner does not hold the high score`);
  check(hi > 0, `seed ${seed}: a finished game has a positive score`);
  checkState(st, `seed ${seed} final`);
}
check(gamesPlayed === 40, `only ${gamesPlayed} games finished`);
check(movesPlayed > 1500, `only ${movesPlayed} moves in 40 games`);

console.log(`random games: ${gamesPlayed} finished in ${movesPlayed} moves, last winner ${lastWinner} (seed ${seedUsed})`);
console.log(failures === 0 ? 'colour-bazaar: all tests passed' : `colour-bazaar: ${failures} failures`);
process.exit(failures ? 1 : 0);

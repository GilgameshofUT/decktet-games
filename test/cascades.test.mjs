// Headless tests for Cascades: node test/cascades.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/cascades-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;                       // 36 cards
const EXTENDED = C.deckList(manifest, true);            // 44 cards, no Excuse

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, label) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(threw, `${label} should throw`);
};

/** Conservation: every card of the deck is somewhere, no card twice. */
function conserved(st, deck, label) {
  const all = C.allCards(st);
  if (all.length !== deck.length) { check(false, `${label}: ${all.length} cards, want ${deck.length}`); return; }
  if (new Set(all).size !== deck.length) check(false, `${label}: duplicate or missing card`);
}

/** A hand-built state.  Fixture boards may reuse card ids to reach a branch;
 *  uniqueness is checked separately on real deals. */
function board(spec) {
  return {
    seed: 0,
    deckSize: spec.deckSize ?? BASIC.length,
    tiers: [0, 1, 2].map((t) => [...((spec.tiers && spec.tiers[t]) || [])]),
    stock: [...(spec.stock || [])],
    waste: [...(spec.waste || [])],
    reserves: [0, 1, 2].map((r) => [...((spec.reserves && spec.reserves[r]) || [])]),
    trips: spec.trips ?? 0,
    moves: 0, flips: 0, redeals: 0,
    over: null,
  };
}

/* ---- the deck ---- */
{
  check(C.deckList(manifest, false).length === 36, 'the basic deck is 36 cards');
  const ext = C.deckList(manifest, true);
  check(ext.length === 44, `the extended deck is 44 cards, got ${ext.length}`);
  check(!ext.includes('the-excuse'), 'the Excuse is never used in Cascades');
  check(new Set(ext).size === 44, 'the extended deck has no duplicates');
  check(ext.every((id) => byId[id]), 'every deck id resolves');
  check(ext.filter((id) => byId[id].rank === 'pawn').length === 4, 'four Pawns');
  check(ext.filter((id) => byId[id].rank === 'court').length === 4, 'four Courts');
}

/* ---- setup invariants over 500 seeds (basic) and 300 (extended) ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.tiers.length === 3 && st.tiers.every((t) => t.length === 0), `seed ${seed}: tiers not empty`);
  check(st.stock.length === 27, `seed ${seed}: stock ${st.stock.length}, want 27`);
  check(st.reserves.length === 3 && st.reserves.every((r) => r.length === 3),
    `seed ${seed}: reserves ${JSON.stringify(st.reserves.map((r) => r.length))}`);
  check(st.trips === 0 && st.moves === 0 && st.flips === 0 && st.redeals === 0, `seed ${seed}: counters`);
  check(C.reservesFree(st).join() === 'false,false,false', `seed ${seed}: a reserve is free at deal`);
  check(C.legalPlays(st).length === 0, `seed ${seed}: something is playable at deal`);
  check(!st.over, `seed ${seed}: over at deal`);
  conserved(st, BASIC, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.stock.length === 27 && json.reserves.length === 3, `seed ${seed}: JSON round trip`);
}
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, EXTENDED);
  check(st.stock.length === 35, `extended seed ${seed}: stock ${st.stock.length}, want 35`);
  check(st.reserves.flat().length === 9, `extended seed ${seed}: reserves`);
  conserved(st, EXTENDED, `extended seed ${seed}`);
}

/* ---- the trips free the draw piles in order ---- */
{
  let st = C.newGame(1, BASIC);
  check(C.sourceCard(st, { kind: 'reserve', i: 0 }) === null, 'a locked draw pile offers nothing');
  check(C.playableSources(st).length === 0, 'nothing is playable at deal');
  while (st.stock.length) st = C.applyFlip(st);
  check(st.trips === 1 && st.stock.length === 0, 'the first trip ends when the stock runs out');
  check(C.reservesFree(st).join() === 'true,false,false', 'the first trip frees the top draw pile');
  st = C.applyRedeal(st);
  while (st.stock.length) st = C.applyFlip(st);
  check(st.trips === 2 && C.reservesFree(st).join() === 'true,true,false', 'the second trip frees the middle');
  st = C.applyRedeal(st);
  while (st.stock.length) st = C.applyFlip(st);
  check(C.reservesFree(st).join() === 'true,true,true', 'the third trip frees the bottom');
  conserved(st, BASIC, 'after three trips');
}

/* ---- flipping and redealing ---- */
{
  const [a, b, c, d] = ['the-savage', 'the-journey', 'the-mill', 'the-discovery'];
  const st = board({ stock: [a, b, c, d] });
  const s1 = C.applyFlip(st);
  check(s1.waste.join() === [b, c, d].join(), `flip takes the top trio, got ${s1.waste}`);
  check(s1.stock.join() === [a].join(), 'the bottom card stays in the stock');
  check(s1.flips === 1 && s1.trips === 0 && s1.moves === 0, 'flip counters');
  const s2 = C.applyFlip(s1);
  check(s2.stock.length === 0 && s2.trips === 1, 'the last flip takes whatever is left (35-card deck)');
  check(s2.waste.join() === [b, c, d, a].join(), 'waste order is bottom-to-top');
  throws(() => C.applyFlip(s2), 'flipping an empty stock');

  check(!C.canRedeal(s1), 'no redeal while the stock has cards');
  check(C.canRedeal(s2), 'a spent stock with cards in the waste may be redealt');
  const s3 = C.applyRedeal(s2);
  check(s3.stock.join() === [a, d, c, b].join(), 'the redeal turns the waste face down in reverse');
  check(s3.waste.length === 0 && s3.redeals === 1, 'redeal counters');
  check(s3.trips === 1, 'a redeal does not complete a trip by itself');
  throws(() => C.applyRedeal(s3), 'redealing while the stock has cards');
  throws(() => C.applyRedeal(board({})), 'redealing an empty waste');
  throws(() => C.applyFlip(board({})), 'flipping an empty stock (no waste)');
}

/* ---- redealTops: which cards a redeal can surface again ----
 *
 * Five cards A..E in the waste (E on top).  The redeal reverses them and the
 * trios shift the phase, so over the two trips it takes for the order to
 * repeat the tops are A, D, C, E — card B can never be played again. */
{
  const ids = ['the-savage', 'the-journey', 'the-mill', 'the-discovery', 'the-forest'];
  const [A, B, c, D, E] = ids;
  const st = board({ waste: ids });
  check(C.redealTops(st).join() === [A, D, c, E].join(),
    `redealTops = ${C.redealTops(st)}, want ${[A, D, c, E]}`);
  check(!C.redealTops(st).includes(B), 'card B never surfaces again');
  check(C.redealTops(board({})).length === 0, 'no waste, no redeal tops');
}

/* ---- the suit rule and the tier gates (hand-built boards) ---- */
const J = 'the-journey';       // 3, moons + waves
const D = 'the-discovery';     // 5, suns + waves
const S = 'the-savage';        // 3, leaves + daemons
const F = 'the-forest';        // 5, moons + leaves
const A2 = 'the-author';       // 2, moons + crowns
const ACE_M = 'ace-of-moons';
const ACE_S = 'ace-of-suns';
const ACE_W = 'ace-of-waves';
const HUNTRESS = 'the-huntress';   // Crown of Moons
const BORDERLAND = 'the-borderland';   // Pawn, waves + leaves + daemons
const CONSUL = 'the-consul';         // Court, moons + waves + crowns

{
  // suit matching at the end of a tier
  const st = board({ tiers: [[J]], waste: [D] });        // D shares waves with J
  check(C.canPlay(st, { kind: 'waste' }, 0), 'suns/waves shares waves with moons/waves');
  const bad = board({ tiers: [[J]], waste: [S] });       // leaves/daemons shares nothing
  check(!C.canPlay(bad, { kind: 'waste' }, 0), 'leaves/daemons shares no suit with moons/waves');
  check(/shares no suit/.test(C.playRejection(bad, { kind: 'waste' }, 0)), 'the suit rejection explains itself');

  // an empty tier needs no suit match — but the rank gates still apply
  check(C.canPlay(board({ tiers: [[], [], []], waste: [S] }), { kind: 'waste' }, 0),
    'the empty top tier needs no suit match');
  check(!C.canPlay(board({ tiers: [[], [], []], waste: [S] }), { kind: 'waste' }, 1),
    'the rank gate still blocks an empty middle tier');
  check(C.canPlay(board({ tiers: [[S], [], []], waste: [J] }), { kind: 'waste' }, 1),
    'an empty middle tier takes the rank already above');
  check(C.canPlay(board({ tiers: [[S], [J], []], waste: ['the-painter'] }), { kind: 'waste' }, 2),
    'an empty bottom tier takes the rank already above');

  // numbered ranks: one per tier, and the tier above must hold that rank first
  const gate = board({ tiers: [[J], [], []], waste: [D] });   // D is rank 5, tier 0 holds only a 3
  check(!C.canPlay(gate, { kind: 'waste' }, 1), 'rank 5 may not start the middle tier');
  check(/rank 5 on the tier above/.test(C.playRejection(gate, { kind: 'waste' }, 1)),
    'the rank rejection names the rank');
  const allowed = board({ tiers: [[F], [], []], waste: [D] });  // tier 0 holds a 5
  check(C.canPlay(allowed, { kind: 'waste' }, 1), 'rank 5 follows rank 5 down a tier');
  check(C.canPlay(allowed, { kind: 'waste' }, 2) === false, 'rank 5 skips no tier');

  // Aces: two per tier; a lower tier needs the tier above to hold them first
  check(C.canPlay(board({ tiers: [[J]], waste: [ACE_M] }), { kind: 'waste' }, 0),
    'an Ace joins the top tier when the suit matches');
  const aceGate = board({ tiers: [[J], [], []], waste: [ACE_M] });
  check(!C.canPlay(aceGate, { kind: 'waste' }, 1), 'no Ace in the tier above blocks an Ace below');
  check(/must be an Ace in the tier above/.test(C.playRejection(aceGate, { kind: 'waste' }, 1)),
    'the Ace rejection explains itself');
  const aceOk = board({ tiers: [[J, ACE_M], [], []], waste: [ACE_S] });
  check(C.canPlay(aceOk, { kind: 'waste' }, 1), 'one Ace above lets one Ace below');

  const twoAces = board({ tiers: [[ACE_M, ACE_M], [], []], waste: [ACE_M] });  // fixture: 2 Aces already
  check(!C.canPlay(twoAces, { kind: 'waste' }, 0), 'a tier holds at most two Aces');
  check(/more than two Aces/.test(C.playRejection(twoAces, { kind: 'waste' }, 0)),
    'the two-Ace rejection explains itself');

  const secondAce = board({ tiers: [[ACE_M], [ACE_M], []], waste: [ACE_M] });
  check(!C.canPlay(secondAce, { kind: 'waste' }, 1), 'a second Ace below needs two above');
  check(/hold two Aces/.test(C.playRejection(secondAce, { kind: 'waste' }, 1)),
    'the second-Ace rejection explains itself');
  check(C.canPlay(board({ tiers: [[ACE_M, ACE_M], [ACE_M], []], waste: [ACE_M] }),
    { kind: 'waste' }, 1), 'two Aces above let a second Ace below');

  // Crowns obey the same two-per-tier pattern
  check(C.canPlay(board({ tiers: [[HUNTRESS, HUNTRESS], [], []], waste: [HUNTRESS] }),
    { kind: 'waste' }, 0) === false, 'a tier holds at most two Crowns');
  check(C.canPlay(board({ tiers: [[HUNTRESS], [], []], waste: [HUNTRESS] }), { kind: 'waste' }, 0),
    'two Crowns may lead the top tier');
}

/* ---- Pawns and Courts (extended deck branch) ---- */
{
  // a second Pawn may lead the top tier only after one sits on the bottom tier
  const first = board({ tiers: [[], [], []], waste: [BORDERLAND] });
  check(C.canPlay(first, { kind: 'waste' }, 0), 'the first Pawn leads the top tier');
  check(!C.canPlay(first, { kind: 'waste' }, 1), 'no Pawn in the tier above blocks a Pawn below');
  const second = board({ tiers: [[BORDERLAND], [], []], waste: [BORDERLAND] });
  check(!C.canPlay(second, { kind: 'waste' }, 0), 'a second top-tier Pawn waits for the bottom tier');
  check(/after one has been played on the bottom tier/.test(C.playRejection(second, { kind: 'waste' }, 0)),
    'the second-Pawn rejection explains itself');
  check(C.canPlay(board({ tiers: [[BORDERLAND], [], [BORDERLAND]], waste: [BORDERLAND] }),
    { kind: 'waste' }, 0), 'one Pawn on the bottom tier opens a second on the top');
  const gated = board({ tiers: [[BORDERLAND, BORDERLAND], [], [BORDERLAND]], waste: [BORDERLAND] });
  check(C.canPlay(gated, { kind: 'waste' }, 1), 'a Pawn follows the tier above');
  const twoPawns = board({ tiers: [[BORDERLAND], [BORDERLAND], []], waste: [BORDERLAND] });
  check(!C.canPlay(twoPawns, { kind: 'waste' }, 1), 'a second Pawn below needs two above');

  // Courts behave the same way
  const court = board({ tiers: [[CONSUL], [], []], waste: [CONSUL] });
  check(!C.canPlay(court, { kind: 'waste' }, 0), 'a second top-tier Court waits for the bottom tier');
  check(C.canPlay(board({ tiers: [[], [], [CONSUL]], waste: [CONSUL] }), { kind: 'waste' }, 0),
    'the first Court leads the top tier even when the bottom tier holds one');
  check(C.canPlay(board({ tiers: [[], [], []], waste: [CONSUL] }), { kind: 'waste' }, 0),
    'the first Court leads the top tier');
}

/* ---- sources: the waste and the freed draw piles ---- */
{
  const st = board({ stock: [], trips: 1, waste: [D], reserves: [[J], [], []] });
  check(C.sourceCard(st, { kind: 'waste' }) === D, 'the waste offers its top card');
  check(C.sourceCard(st, { kind: 'reserve', i: 0 }) === J, 'a freed draw pile offers its top card');
  check(C.sourceCard(st, { kind: 'reserve', i: 1 }) === null, 'an empty draw pile offers nothing');
  check(C.sourceCard(st, { kind: 'nope' }) === null, 'an unknown source offers nothing');
  check(C.sourceCard(st, { kind: 'reserve', i: 9 }) === null, 'an out-of-range draw pile offers nothing');
  const locked = board({ stock: [D], waste: [J], reserves: [[A2], [], []] });
  check(C.sourceCard(locked, { kind: 'reserve', i: 0 }) === null, 'a locked draw pile offers nothing');
  const plays = C.legalPlays(st);
  check(plays.length > 0 && plays.every((p) => p.src.kind === 'waste' || p.src.kind === 'reserve'),
    'legalPlays enumerates real sources');

  throws(() => C.playRejection(st, null, 0) && C.applyPlay(st, null, 0), 'playing from nothing');
  throws(() => C.applyPlay(st, { kind: 'reserve', i: 2 }, 0), 'playing from a locked pile');
  throws(() => C.applyPlay(st, { kind: 'waste' }, 3), 'playing to a fourth tier');
  throws(() => C.applyPlay(board({ tiers: [[J]], waste: [S] }), { kind: 'waste' }, 0),
    'playing off-suit');
}

/* ---- a play moves exactly one card and flips nothing else ---- */
{
  const st = board({ tiers: [[J]], stock: [S, D, A2], waste: [F], trips: 1 });
  const before = C.allCards(st).slice().sort().join('|');
  const next = C.applyPlay(st, { kind: 'waste' }, 0);
  check(next.tiers[0].join() === [J, F].join(), 'the card lands at the right end of the tier');
  check(next.waste.length === 0, 'the waste shrinks by one');
  check(next.moves === 1 && next.flips === 0, 'move counters');
  check(C.allCards(next).slice().sort().join('|') === before, 'a play neither creates nor destroys a card');
  check(st.moves === 0 && st.tiers[0].length === 1, 'the original state is not mutated');
  check(JSON.parse(JSON.stringify(next)).tiers[0].length === 2, 'JSON round trip');
}

/* ---- ending: win and loss, both hand-computed ---- */
{
  // win: all 36 cards in the tiers
  const tiers = [BASIC.slice(0, 12), BASIC.slice(12, 24), BASIC.slice(24, 36)];
  const st = board({ tiers });
  check(C.cardsPlayed(st) === 36 && C.score(st) === 36, 'score is the number of cards played');
  check(C.isWon(st), 'all 36 cards in the tiers is a win');
  C.settle(st);
  check(st.over === 'won', `over = ${st.over}, want won`);

  // not yet: two cards still in the waste, one playable
  const almost = board({ deckSize: 4, tiers: [[A2, J]], waste: [D, F], trips: 1 });
  check(!C.isWon(almost), 'cards left in the waste is not a win');
  check(C.legalPlays(almost).length > 0, 'the waste top is playable');
  C.settle(almost);
  check(almost.over === null, `over = ${almost.over}, want none`);

  // loss: the stock is spent, the waste top fits nowhere, and a redeal shows
  // nothing better.  Three single-suit Aces end the tiers; the Savage
  // (leaves/daemons, rank 3) matches no suit and its rank sits on no tier.
  const stuck = board({ tiers: [[ACE_M], [ACE_S], [ACE_W]], waste: [S], trips: 1 });
  check(C.legalPlays(stuck).length === 0, 'no legal play on the stuck board');
  check(C.score(stuck) === 3, 'the stuck score is the three Aces played');
  C.settle(stuck);
  check(stuck.over === 'stuck', `over = ${stuck.over}, want stuck`);

  // …but not while the stock still has cards, and not before one trip
  C.settle(board({ tiers: [[ACE_M], [ACE_S], [ACE_W]], waste: [S], stock: [D] }));
  check(!board({ tiers: [[ACE_M], [ACE_S], [ACE_W]], waste: [S], stock: [D] }).over,
    'cards left in the stock keep the game alive');
  const noTrip = board({ tiers: [[ACE_M], [ACE_S], [ACE_W]], waste: [S], trips: 0 });
  C.settle(noTrip);
  check(noTrip.over === null, 'before one trip through the deck the game cannot be lost');

  // …and not when a redeal would surface something playable.  The Author
  // (2, moons/crowns) buried under the Savage fits the moons Ace, and a
  // two-card waste surfaces its bottom card on the redeal.
  const rescue = board({ tiers: [[ACE_M], [ACE_S], [ACE_W]], waste: [A2, S], trips: 1 });
  check(C.legalPlays(rescue).length === 0, 'the waste top itself is unplayable');
  check(C.redealTops(rescue).includes(A2), 'a redeal surfaces the buried Author');
  C.settle(rescue);
  check(rescue.over === null, 'a playable redeal top keeps the game alive');

  // all sources spent and nothing anywhere: lost
  const empty = board({ tiers: [[ACE_M], [ACE_S], [ACE_W]], trips: 3 });
  C.settle(empty);
  check(empty.over === 'stuck', 'nothing left at all is a loss');
}

/* ---- full random playouts: seeded, terminating, conserving ---- */
function playout(seed, deck, label) {
  let st = C.newGame(seed, deck);
  const rng = mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 50000) {
    const before = C.allCards(st).length;
    const free = C.reservesFree(st);
    check(free.slice(1).every((ok, i) => !ok || free[i]), `${label} seed ${seed}: draw piles freed out of order`);
    const plays = C.legalPlays(st);
    if (plays.length) {
      const p = plays[Math.floor(rng() * plays.length)];
      st = C.applyPlay(st, p.src, p.tier);
    } else if (st.stock.length) st = C.applyFlip(st);
    else if (C.canRedeal(st)) st = C.applyRedeal(st);
    else break;
    if (C.allCards(st).length !== before) { check(false, `${label} seed ${seed}: cards changed mid-game`); break; }
  }
  check(!!st.over, `${label} seed ${seed}: playout did not terminate`);
  check(['won', 'stuck'].includes(st.over), `${label} seed ${seed}: over = ${st.over}`);
  check(C.score(st) === st.tiers.flat().length, `${label} seed ${seed}: score is not cards played`);
  conserved(st, deck, `${label} seed ${seed} end`);
  const json = JSON.parse(JSON.stringify(st));
  check(C.legalPlays(json).length === 0 && !!json.over, `${label} seed ${seed}: JSON round trip`);
  return st;
}

let won = 0, stuck = 0, cards = 0;
for (let seed = 1; seed <= 300; seed++) {
  const st = playout(seed, BASIC, 'basic');
  if (st.over === 'won') won++; else stuck++;
  cards += C.cardsPlayed(st);
}
let xWon = 0;
for (let seed = 1; seed <= 200; seed++) {
  const st = playout(seed, EXTENDED, 'extended');
  if (st.over === 'won') xWon++;
}
check(won >= 1, `a random player won ${won}/300 basic games — the game should be winnable`);
check(xWon >= 1, `a random player won ${xWon}/200 extended games — the game should be winnable`);

console.log(`cascades: random playouts — ${won} won / 300 basic (${(cards / 300).toFixed(1)} cards played), ` +
  `${xWon} won / 200 extended`);
console.log(failures === 0 ? 'cascades: all tests passed' : `cascades: ${failures} failures`);
process.exit(failures ? 1 : 0);

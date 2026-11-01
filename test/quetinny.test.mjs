// Headless tests for Quetinny: node test/quetinny.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/quetinny-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throwsWith = (fn, frag, label) => {
  let msg = '';
  try { fn(); } catch (e) { msg = e.message; }
  check(msg && msg.includes(frag), `${label}: expected an error containing "${frag}", got "${msg || 'no error'}"`);
};
/** The *Error helpers return a reason instead of throwing. */
const returnsErr = (fn, frag, label) => {
  const msg = fn() || '';
  check(msg.includes(frag), `${label}: expected a reason containing "${frag}", got "${msg || 'no reason'}"`);
};

const find = (pred, label) => {
  const id = BASIC.find(pred);
  check(!!id, `fixture card missing: ${label}`);
  return id;
};
const byRank = (n) => find((id) => byId[id].rank === n, `rank ${n}`);
const courtOf = (rank, suit) =>
  find((id) => byId[id].rank === rank && byId[id].suits.includes(suit), `${rank} of ${suit}`);
const ace = (suit) => courtOf(1, suit);
const crown = (suit) => courtOf('crown', suit);

const SUITS = C.SUITS;
const freshChips = () => Object.fromEntries(SUITS.map((s) => [s, C.CHIPS_PER_SUIT]));

/** A hand-built state. provinces: [{r,c,id,chip,spice}].
 *  Any card not named goes into the deck, so every fixture conserves 36. */
function st(spec = {}) {
  const provinces = (spec.provinces || []).map((p) => ({ chip: null, spice: 0, ...p }));
  const hand = spec.hand || [];
  const discard = spec.discard || [];
  const named = new Set([...provinces.map((p) => p.id), ...hand, ...discard, ...(spec.deck || [])]);
  return {
    seed: 0,
    provinces,
    hand,
    deck: (spec.deck || []).concat(BASIC.filter((id) => !named.has(id))),
    discard,
    gold: spec.gold ?? 25,
    spice: spec.spice ?? 6,
    chips: spec.chips || freshChips(),
    step: spec.step || 'action',
    turn: 1,
    moves: 0,
    over: null,
    final: spec.final ?? false,
    log: '',
  };
}

function conserved(state, label) {
  const all = C.allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  const seen = new Set(all);
  if (seen.size !== 36) check(false, `${label}: duplicate or missing card`);
}

/* ---- setup invariants over 300 seeds ---- */
let spiceSum = 0;
for (let seed = 1; seed <= 300; seed++) {
  const g = C.newGame(seed, BASIC);
  check(g.provinces.length === 4, `seed ${seed}: ${g.provinces.length} provinces`);
  const courts = g.provinces.filter((p) => byId[p.id].rank === 1 || byId[p.id].rank === 'crown');
  check(courts.length === 1, `seed ${seed}: ${courts.length} Aces/Crowns in the tableau`);
  check(g.hand.length === 4 && g.deck.length === 28 && g.discard.length === 0,
    `seed ${seed}: hand ${g.hand.length}, deck ${g.deck.length}, discard ${g.discard.length}`);
  check(g.gold === 25, `seed ${seed}: gold ${g.gold}`);
  check(g.provinces.every((p) => SUITS.includes(p.chip) && byId[p.id].suits.includes(p.chip)),
    `seed ${seed}: initial chip does not match its card`);
  check(g.provinces.every((p) => (byId[p.id].rank === 1 ? p.spice === 1 : p.spice === 0)),
    `seed ${seed}: initial spice wrong`);
  check(g.spice === 6 - courts.filter((p) => byId[p.id].rank === 1).length,
    `seed ${seed}: spice supply ${g.spice}`);
  const chipsLeft = SUITS.reduce((n, s) => n + g.chips[s], 0);
  check(36 - chipsLeft === 4, `seed ${seed}: ${36 - chipsLeft} chips placed`);
  check(g.step === 'action' && !g.over && !g.final, `seed ${seed}: bad start step`);
  conserved(g, `seed ${seed}`);
  spiceSum += g.spice;
  const json = JSON.parse(JSON.stringify(g));
  check(json.hand.length === 4 && json.provinces.length === 4, `seed ${seed}: JSON round trip`);
}
console.log(`setup: average starting spice supply ${(spiceSum / 300).toFixed(2)}`);

/* ---- expanding a province ---- */
{
  const mtn = find((id) => byId[id].rank === 4 && byId[id].suits.includes('moons'), 'the Mountain');
  const disc = find((id) => byId[id].rank === 5 && byId[id].suits.includes('suns'), 'the Discovery');
  const painter = find((id) => byId[id].rank === 3 && byId[id].suits.includes('suns'), 'the Painter');
  const bard = crown('suns');

  const g = st({
    provinces: [
      { r: 0, c: 0, id: mtn, chip: 'suns' },        // a starting chip roots a suns route
      { r: 0, c: 1, id: ace('moons'), chip: 'moons', spice: 1 },
      { r: 1, c: 1, id: disc, chip: null },
    ],
    hand: [painter, bard, find((id) => byId[id].rank === 5 && id !== disc, 'a rank 5')],
  });

  check(C.expandError(g, 0, 'suns', 1, 0) === null, 'a 3 of Suns may sit beside the Mountain');
  check(C.expandError(g, 0, 'crowns', 1, 0) && C.expandError(g, 0, 'crowns', 1, 0).includes('same suit'),
    'the same card needs a Crowns neighbour there');
  check(C.expandError(g, 0, 'suns', 0, 2) && C.expandError(g, 0, 'suns', 0, 2).includes('same suit'),
    'a 3 of Suns may not sit beside the moons Ace');
  check(C.expandError(g, 0, 'suns', 2, 2) && C.expandError(g, 0, 'suns', 2, 2).includes('orthogonally'),
    'diagonal placement is not orthogonal');
  check(C.expandError(g, 0, 'moons', 1, 0) && C.expandError(g, 0, 'moons', 1, 0).includes('no moons symbol'),
    'the Painter has no moons symbol');
  check(C.expandError(g, 9, 'suns', 1, 0) && C.expandError(g, 9, 'suns', 1, 0).includes('select a card'),
    'no such card in hand');
  check(C.expandError(g, 1, 'suns', -1, 0) === null, 'a Crown may be placed beside a rank card');
  check(C.expandError(g, 1, 'suns', -1, 1) && C.expandError(g, 1, 'suns', -1, 1).includes('Aces and Crowns'),
    'a Crown may not be orthogonally adjacent to an Ace');

  const next = C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 1, c: 0, chip: null });
  check(next.provinces.length === 4 && next.hand.length === 2, 'province placed, card to discard');
  check(next.provinces.some((p) => p.id === painter && p.r === 1 && p.c === 0), 'the played card became the province');
  check(next.discard.length === 0, 'a province card is not also discarded');
  check(next.step === 'tax', 'the turn moved to the tax step');
  check(g.provinces.length === 3 && g.hand.length === 3, 'the original state must not be mutated');
  conserved(next, 'after expand');
  // a chip may go on the new province itself — and on any other route-adjacent one
  const withChip = C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 1, c: 0, chip: [1, 0] });
  check(C.provinceAt(withChip, 1, 0).chip === 'suns', 'the new province was chipped');
  check(withChip.chips.suns === 5, 'a suns chip was spent');
  const withChip2 = C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 1, c: 0, chip: [1, 1] });
  check(C.provinceAt(withChip2, 1, 1).chip === 'suns', 'the chip extended the route on an existing province');
  check(withChip2.chips.suns === 5, 'a suns chip was spent (2nd)');
  conserved(withChip, 'after expand+chip');

  throwsWith(() => C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 3, c: 3 }),
    'orthogonally next to', 'expand far away from everything');
  throwsWith(() => C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 1, c: 0, chip: [0, 1] }),
    'roots', 'chipping an Ace');
  throwsWith(() => C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 1, c: 0, chip: [0, 0] }),
    'only one suit chip', 'chipping a chipped province');
  const noChips = st({ provinces: g.provinces, hand: g.hand, chips: { ...freshChips(), suns: 0 } });
  throwsWith(() => C.applyMove(noChips, { type: 'expand', hand: 0, suit: 'suns', r: 1, c: 0, chip: [1, 0] }),
    'no suns chips left', 'chips exhausted');
  throwsWith(() => C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 1, c: 0, chip: [3, 3] }),
    'no province there', 'chipping empty space');
  throwsWith(() => C.applyMove(g, { type: 'expand', hand: 0, suit: 'suns', r: 2, c: 2, chip: [2, 2] }),
    'orthogonally next to', 'the chip does not rescue an illegal placement');
  throwsWith(() => C.applyMove(g, { type: 'expand', hand: 0, suit: 'waves', r: 1, c: 0 }),
    'no waves symbol', 'wrong suit');
}

/* ---- harvesting ---- */
{
  const forest = find((id) => byId[id].rank === 5 && byId[id].suits.includes('leaves'), 'the Forest');
  const am = ace('moons');
  const al = ace('leaves');

  const g = st({
    provinces: [
      { r: 0, c: 0, id: am, chip: 'moons', spice: 1 },
      { r: 0, c: 2, id: al, chip: 'leaves' },
    ],
    hand: [forest, byRank(3)],
  });
  const next = C.applyMove(g, { type: 'harvest', hand: 0 });
  check(C.provinceAt(next, 0, 0).spice === 3, 'harvest added 2 moons spice to the 1 there');
  check(C.provinceAt(next, 0, 2).spice === 2, 'harvest added 2 leaves spice');
  check(next.spice === 2, `supply after harvest ${next.spice}`);
  check(next.step === 'tax', 'harvest ends the action step');
  check(next.discard.includes(forest), 'the harvest card was discarded');
  conserved(next, 'after harvest');

  const dry = st({ provinces: g.provinces, hand: [byRank(4)] });
  returnsErr(() => C.harvestError(dry, 0), 'matching Ace', 'harvest with no Ace on the board');
  const capped = C.applyMove(
    st({ provinces: g.provinces.map((p) => (p.id === am ? { ...p, spice: 0 } : p)), hand: [forest], spice: 1 }),
    { type: 'harvest', hand: 0 });
  check(C.provinceAt(capped, 0, 0).spice === 1 && C.provinceAt(capped, 0, 2).spice === 0 && capped.spice === 0,
    'running out of spice places only the remainder (the first suit gets the last cube)');
}

/* ---- caravans ---- */
{
  const am = ace('moons');
  const hm = crown('moons');
  const mtn = find((id) => byId[id].rank === 4 && byId[id].suits.includes('moons'), 'the Mountain');
  const journey = find((id) => byId[id].rank === 3 && byId[id].suits.includes('moons'), 'the Journey');
  const pact = find((id) => byId[id].rank === 9 && byId[id].suits.includes('moons'), 'the Pact');

  const g = st({
    provinces: [
      { r: 0, c: 0, id: am, chip: 'moons', spice: 2 },
      { r: 0, c: 1, id: mtn, chip: 'moons' },
      { r: 0, c: 2, id: hm, chip: 'moons' },
    ],
    hand: [journey, pact],
    spice: 4,
  });

  const paths = C.routes(g, 'moons');
  check(paths.length === 1 && paths[0].length === 3, `routes found: ${JSON.stringify(paths)}`);
  check(C.caravanError(g, 0, 'moons', paths[0]) === null, 'a rank 3 may pay for a 3-province route');

  const next = C.applyMove(g, { type: 'caravan', hand: 0, suit: 'moons', path: paths[0] });
  check(next.gold === 33, `gold after 3-province delivery ${next.gold}`);
  check(next.spice === 5 && C.provinceAt(next, 0, 0).spice === 1, 'the delivered cube went back to the supply');
  check(next.discard.includes(journey), 'the delivery card was discarded');
  check(next.step === 'tax', 'delivery ends the action step');
  conserved(next, 'after caravan');

  throwsWith(() => C.applyMove(g, { type: 'caravan', hand: 0, suit: 'suns', path: paths[0] }),
    'no suns symbol', 'caravan in a suit the card lacks');
  const low = st({ provinces: g.provinces, hand: [byRank(2)], spice: 4 });
  const lowPath = C.routes(low, 'moons')[0];
  returnsErr(() => C.caravanError(low, 0, 'moons', lowPath), 'provinces or fewer', 'rank below route length');
  returnsErr(() => C.caravanError(g, 1, 'moons', [[0, 0], [0, 1], [0, 0], [0, 2]]),
    'cross itself', 'path crossing itself');
  returnsErr(() => C.caravanError(g, 0, 'moons', [[0, 1], [0, 2]]), 'start at the Ace', 'path not starting at the Ace');
  returnsErr(() => C.caravanError(g, 0, 'moons', [[0, 0], [0, 1], [1, 2]]),
    'must end at the Crown', 'path not ending at the Crown');
  returnsErr(() => C.caravanError(g, 0, 'moons', [[0, 0], [0, 2]]), 'adjacent', 'a jump over empty space');
  const noChip = st({ provinces: g.provinces.map((p) => ({ ...p, chip: null })), hand: g.hand, spice: 4 });
  returnsErr(() => C.caravanError(noChip, 0, 'moons', paths[0]), 'carry a moons chip', 'middle without a chip');
  const dry = st({
    provinces: g.provinces.map((p) => (p.id === am ? { ...p, spice: 0 } : p)),
    hand: g.hand, spice: 4,
  });
  returnsErr(() => C.caravanError(dry, 0, 'moons', paths[0]), 'no spice', 'caravan from an empty Ace');

  // an Ace card is rank 1 and can never pay for a route
  const sunsRoute = st({
    provinces: [
      { r: 0, c: 0, id: ace('suns'), chip: 'suns', spice: 1 },
      { r: 0, c: 1, id: crown('suns'), chip: 'suns' },
    ],
    hand: [ace('suns')], spice: 5,
  });
  returnsErr(() => C.caravanError(sunsRoute, 0, 'suns', [[0, 0], [0, 1]]), 'provinces or fewer',
    'an Ace card cannot pay for a delivery');

  // longer route, gold chart
  const m5 = find((id) => byId[id].rank === 5 && byId[id].suits.includes('moons'), 'a moons 5');
  const m7 = find((id) => byId[id].rank === 7 && byId[id].suits.includes('moons'), 'a moons 7');
  const g2 = st({
    provinces: [
      { r: 0, c: 0, id: am, chip: 'moons', spice: 1 },
      { r: 0, c: 1, id: mtn, chip: 'moons' },
      { r: 1, c: 1, id: m5, chip: 'moons' },
      { r: 2, c: 1, id: m7, chip: 'moons' },
      { r: 2, c: 2, id: hm, chip: 'moons' },
    ],
    hand: [pact],
    spice: 5,
  });
  const long = C.routes(g2, 'moons').filter((p) => p.length === 5);
  check(long.length >= 1, 'a 5-province route exists');
  const g2n = C.applyMove(g2, { type: 'caravan', hand: 0, suit: 'moons', path: long[0] });
  check(g2n.gold === 57, `gold after 5-province delivery ${g2n.gold} (25 + 32)`);

  check([2, 3, 4, 5].map(C.goldFor).join() === '4,8,16,32', 'the gold chart');
}

/* ---- discarding: only when there is no legal play ---- */
{
  const mtn = find((id) => byId[id].rank === 4 && byId[id].suits.includes('moons'), 'the Mountain');
  const sailor = find((id) => byId[id].rank === 4 && byId[id].suits.includes('waves'), 'the Sailor');
  const g = st({ provinces: [{ r: 0, c: 0, id: mtn, chip: 'moons' }], hand: [sailor] });
  check(!C.hasLegalPlay(g), 'a waves/leaves card beside a moons province has no play');
  const next = C.applyMove(g, { type: 'discard', hand: 0 });
  check(next.discard.includes(sailor) && next.step === 'tax', 'forced discard');
  const playable = st({ provinces: g.provinces, hand: [sailor, ace('moons')] });
  throwsWith(() => C.applyMove(playable, { type: 'discard', hand: 0 }),
    'no possible legal play', 'discard while a play exists');
}

/* ---- taxes ---- */
{
  const betrayal = find((id) => byId[id].rank === 8 && byId[id].suits.includes('daemons'), 'the Betrayal');
  const author = find((id) => byId[id].rank === 2 && byId[id].suits.includes('crowns'), 'the Author');
  const bard = crown('suns');
  const g = st({
    provinces: [
      { r: 0, c: 0, id: find((id) => byId[id].rank === 9 && byId[id].suits.includes('daemons'), 'daemons 9'), chip: 'daemons' },
      { r: 0, c: 1, id: find((id) => byId[id].rank === 5 && byId[id].suits.includes('daemons'), 'daemons 5'), chip: 'daemons' },
      { r: 0, c: 2, id: find((id) => byId[id].rank === 9 && byId[id].suits.includes('crowns') && !byId[id].suits.includes('daemons'), 'crowns 9'), chip: 'crowns' },
      { r: 0, c: 3, id: find((id) => byId[id].rank === 3 && byId[id].suits.includes('crowns') && !byId[id].suits.includes('daemons'), 'crowns 3'), chip: 'crowns' },
    ],
    hand: [betrayal, bard, author, byRank(6)],
    deck: [byRank(7), find((id) => byId[id].rank === 8 && id !== betrayal, 'a rank 8')],
    step: 'tax', gold: 20,
  });
  // the Betrayal: rank 8 − (2 daemons + 2 crowns chips) = 4
  check(C.taxFor(g, betrayal) === 4, `Betrayal tax ${C.taxFor(g, betrayal)}`);
  // the Bard: Crown at rank 15 − 0 suns chips = 15
  check(C.taxFor(g, bard) === 15, `Crown tax ${C.taxFor(g, bard)}`);
  // the Author: rank 2 − 2 crowns chips, clamped at 0
  check(C.taxFor(g, author) === 0, `Author tax ${C.taxFor(g, author)}`);

  throwsWith(() => C.applyMove(g, { type: 'tax', hand: 9 }), 'select a card', 'tax with no such card');
  const notYet = st({ provinces: g.provinces, hand: g.hand });
  throwsWith(() => C.applyMove(notYet, { type: 'tax', hand: 0 }), 'choose your action first', 'tax before the action');

  const next = C.applyMove(g, { type: 'tax', hand: 0 });
  check(next.gold === 16, `gold after paying 4 ${next.gold}`);
  check(next.hand.length === 4, 'refilled to 4');
  check(next.step === 'action' && next.turn === 2 && !next.final, 'a fresh turn');
  conserved(next, 'after tax');

  // broke: owing more than you hold ends the game as a loss
  const broke = st({ provinces: g.provinces, hand: [bard], deck: [], step: 'tax', gold: 3, final: true });
  const dead = C.applyMove(broke, { type: 'tax', hand: 0 });
  check(dead.over === 'lost' && dead.gold === -12, `broke: over=${dead.over}, gold=${dead.gold}`);
}

/* ---- the final hand and the end of the game ---- */
{
  // every Ace and Crown on the board, laid along one row; cells above are free.
  // Only the Moons and Suns pairs carry chips (2 each).
  const royals = SUITS.flatMap((s) => [ace(s), crown(s)]);
  const prov = royals.map((id, i) => ({ r: 0, c: i, id, chip: i < 4 ? SUITS[Math.floor(i / 2)] : null, spice: 0 }));
  const journey = find((id) => byId[id].rank === 3 && byId[id].suits.includes('moons'), 'the Journey');
  const author = byRank(2);        // moons/crowns, rank 2
  const lunatic = byRank(6);       // moons/waves, rank 6
  const battle = byRank(4);        // daemons/crowns, rank 4
  const merchant = find((id) => byId[id].rank === 9 && byId[id].suits.includes('leaves'), 'the Merchant');
  // board chips: moons ×2, suns ×2
  const taxOf = (id) => C.taxFor(st({ provinces: prov }), id);
  check(taxOf(author) === 0, `Author tax on the royal board: ${taxOf(author)}`);
  check(taxOf(lunatic) === 4, `Lunatic tax on the royal board: ${taxOf(lunatic)}`);
  check(taxOf(battle) === 4, `Battle tax on the royal board: ${taxOf(battle)}`);
  check(taxOf(merchant) === 9, `Merchant tax on the royal board: ${taxOf(merchant)}`);

  // final hand of 3, deck empty: one action card, the other two taxed automatically
  const g = st({ provinces: prov, hand: [journey, author, lunatic], deck: [], final: true, gold: 10 });
  const next = C.applyMove(g, { type: 'expand', hand: 0, suit: 'moons', r: -1, c: 0, chip: null });
  check(next.gold === 6, `final hand: 10 − (0 + 4) taxes = ${next.gold}`);
  check(next.over === 'won', `final hand over=${next.over}`);
  check(next.hand.length === 0, 'the final hand is emptied');
  check(next.discard.includes(author) && next.discard.includes(lunatic), 'the taxed cards were discarded');
  conserved(next, 'after final hand');

  // hand of 2: one action, one taxed
  const g2 = st({ provinces: prov, hand: [journey, author], deck: [], final: true, gold: 10 });
  const n2 = C.applyMove(g2, { type: 'expand', hand: 0, suit: 'moons', r: -1, c: 0, chip: null });
  check(n2.gold === 10 && n2.over === 'won', `hand of 2: gold ${n2.gold}, over ${n2.over}`);

  // outright win: more gold than the 25 you started with
  const rich = st({ provinces: prov, hand: [journey, battle], deck: [], final: true, gold: 30 });
  const richNext = C.applyMove(rich, { type: 'expand', hand: 0, suit: 'moons', r: -1, c: 0, chip: null });
  check(richNext.over === 'outright' && richNext.gold === 26, `outright: over=${richNext.over} gold=${richNext.gold}`);

  // broke on the final tax
  const brokeState = st({ provinces: prov, hand: [journey, merchant], deck: [], final: true, gold: 5 });
  const brokeNext = C.applyMove(brokeState, { type: 'expand', hand: 0, suit: 'moons', r: -1, c: 0, chip: null });
  check(brokeNext.over === 'lost' && brokeNext.gold === -4, `broke: over=${brokeNext.over} gold=${brokeNext.gold}`);

  // no gold left at all: a loss even with every Ace and Crown on the board
  const zero = st({ provinces: prov, hand: [journey, battle], deck: [], final: true, gold: 4 });
  const zeroNext = C.applyMove(zero, { type: 'expand', hand: 0, suit: 'moons', r: -1, c: 0, chip: null });
  check(zeroNext.over === 'lost' && zeroNext.gold === 0, `zero gold: over=${zeroNext.over} gold=${zeroNext.gold}`);

  // missing every court of one suit: an automatic loss however rich
  const noWaves = prov.filter((p) => p.id !== crown('waves') && p.id !== ace('waves'));
  const rich2 = st({ provinces: noWaves, hand: [journey, battle], deck: [], final: true, gold: 40 });
  const rich2Next = C.applyMove(rich2, { type: 'expand', hand: 0, suit: 'moons', r: -1, c: 0, chip: null });
  check(rich2Next.over === 'lost' && rich2Next.log.includes('waves'), `missing court: over=${rich2Next.over}`);

  // …but one court of the suit is enough: losing only the waves Crown is fine
  const oneWaves = prov.filter((p) => p.id !== crown('waves'));
  const rich3 = st({ provinces: oneWaves, hand: [journey, battle], deck: [], final: true, gold: 30 });
  const rich3Next = C.applyMove(rich3, { type: 'expand', hand: 0, suit: 'moons', r: -1, c: 0, chip: null });
  check(rich3Next.over === 'outright', `one court per suit suffices: over=${rich3Next.over}`);
}

/* ---- illegal moves generally ---- */
{
  const g = C.newGame(7, BASIC);
  throwsWith(() => C.applyMove(g, null), 'choose a move', 'no move');
  throwsWith(() => C.applyMove(g, { type: 'teleport' }), 'unknown move', 'unknown move');
  throwsWith(() => C.applyMove(g, { type: 'tax', hand: 0 }), 'choose your action first', 'tax out of turn');
  let s = g;
  const rng = D_mulberry32(99);
  for (let i = 0; i < 400 && !s.over; i++) {
    const ms = C.legalMoves(s);
    if (!ms.length) break;
    s = C.applyMove(s, ms[Math.floor(rng() * ms.length)]);
  }
  check(!!s.over, 'a forced game must end');
  throwsWith(() => C.applyMove(s, { type: 'tax', hand: 0 }), 'game is over', 'moving after the end');
}

/* ---- full random playouts: 300 seeds, a random legal player ---- */
let won = 0, outright = 0, lost = 0, goldSum = 0, movesSum = 0;
for (let seed = 1; seed <= 300; seed++) {
  let s = C.newGame(seed, BASIC);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!s.over && guard++ < 400) {
    const moves = C.legalMoves(s);
    if (!moves.length) { check(false, `seed ${seed}: no moves but not over (step ${s.step})`); break; }
    s = C.applyMove(s, moves[Math.floor(rng() * moves.length)]);
    conserved(s, `seed ${seed} move ${s.moves}`);
  }
  check(!!s.over, `seed ${seed}: playout did not terminate within 400 moves`);
  // score consistency, recomputed independently
  const courtsOnBoard = SUITS.every((suit) =>
    s.provinces.some((p) => (byId[p.id].rank === 1 || byId[p.id].rank === 'crown') && byId[p.id].suits.includes(suit)));
  if (s.over === 'won') check(s.gold > 0 && s.gold <= 25 && courtsOnBoard, `seed ${seed}: won with gold ${s.gold}`);
  else if (s.over === 'outright') check(s.gold > 25 && courtsOnBoard, `seed ${seed}: outright with gold ${s.gold}`);
  else if (s.over === 'lost') {
    const legit = s.gold < 0 || s.gold === 0 || !courtsOnBoard;
    check(legit, `seed ${seed}: lost with gold ${s.gold} and every court present`);
  } else check(false, `seed ${seed}: unknown over ${s.over}`);
  goldSum += Math.max(0, s.gold);
  movesSum += s.moves;
  if (s.over === 'won') won++;
  else if (s.over === 'outright') outright++;
  else lost++;
  const json = JSON.parse(JSON.stringify(s));
  check(json.provinces.length === s.provinces.length, `seed ${seed}: JSON round trip`);
}
console.log(`random playouts: ${won} won, ${outright} outright, ${lost} lost · avg gold ${Math.round(goldSum / 300)} · avg moves ${(movesSum / 300).toFixed(1)}`);

console.log(failures === 0 ? 'quetinny: all tests passed' : `quetinny: ${failures} failures`);
process.exit(failures ? 1 : 0);

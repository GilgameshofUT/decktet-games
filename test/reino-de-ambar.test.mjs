// Headless tests for Reino de Ámbar: node test/reino-de-ambar.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/reino-de-ambar-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throwsWith = (fn, frag, label) => {
  let msg = '';
  try { fn(); } catch (e) { msg = e.message; }
  check(msg && msg.includes(frag), `${label}: expected an error containing "${frag}", got "${msg || 'no error'}"`);
};

const byRank = (n, suit) => BASIC.find((id) =>
  byId[id].rank === n && (!suit || byId[id].suits.includes(suit)));
const crownOf = (suit) => BASIC.find((id) => byId[id].rank === 'crown' && byId[id].suits.includes(suit));
const aceOf = (suit) => BASIC.find((id) => byId[id].rank === 1 && byId[id].suits.includes(suit));

const DEFAULT_AREAS = [
  'the-excuse', 'the-penitent', 'the-lunatic', 'the-castle',
  'the-market', 'the-cave', 'the-chance-meeting', 'the-borderland',
];
// positions: 1 Penitent(suns,daemons) 2 Lunatic(moons,waves) 3 Castle(suns,crowns)
//            4 Market(leaves,crowns) 5 Cave(waves,daemons) 6 Chance Meeting(moons,leaves)
//            7 Borderland(waves,leaves,daemons)

/** A hand-built state; anything unnamed goes into the Problem deck. */
function mkState(spec = {}) {
  const areas = spec.areas || DEFAULT_AREAS;
  const board = spec.board || areas.map(() => ({ me: 0, dummy: 0 }));
  const problems = spec.problems || [];
  const handMe = spec.handMe || BASIC.filter((id) => byId[id].rank === 1).concat(['the-harvest']);
  const handDummy = spec.handDummy ||
    BASIC.filter((id) => byId[id].rank === 1).map((a) => `${a}#2`).concat(['the-light-keeper']);
  const named = new Set([
    ...areas, ...handMe, ...handDummy,
    ...problems, ...(spec.pvMe || []), ...(spec.pvDummy || []),
    ...(spec.discMe || []), ...(spec.discDummy || []), ...(spec.pvDiscard || []),
  ]);
  const pawnsUsed = new Set([...handMe, ...handDummy].filter((id) => C.FACTIONS.includes(id)));
  const unusedPawns = C.FACTIONS.filter((f) => !pawnsUsed.has(f));
  return {
    seed: 0,
    areas, board,
    confidente: spec.confidente ?? null,
    supply: spec.supply || { me: 4, dummy: 4 },
    gold: spec.gold || { me: 3, dummy: 3 },
    general: spec.general || { me: 4, dummy: 4, gold: 2 },
    barbarians: spec.barbarians ?? 0,
    hands: { me: handMe, dummy: handDummy },
    discards: { me: spec.discMe || [], dummy: spec.discDummy || [] },
    problems,
    problemDeck: (spec.problemDeck ?? BASIC.filter((id) => !named.has(id))).concat(unusedPawns.slice(1)),
    problemDiscard: spec.pvDiscard || [],
    pv: { me: spec.pvMe || [], dummy: spec.pvDummy || [] },
    spare: spec.spare ?? unusedPawns[0] ?? 'the-watchman',
    dice: { me: [1, 1], dummy: [1, 1] },
    round: spec.round ?? 1,
    phase: spec.phase || 'my-action',
    dummyAttempt: null, myAttempt: null,
    moves: 0, over: null, score: null,
    log: '',
  };
}

function conserved(state, label) {
  const all = C.allCards(state);
  if (all.length !== 47) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 47) check(false, `${label}: a card is duplicated`);
  for (const id of all) check(!!byId[String(id).split('#')[0]], `${label}: unknown card ${id}`);
}

/* ---- setup invariants over 300 seeds ---- */
for (let seed = 1; seed <= 300; seed++) {
  const g = C.newGame(seed, BASIC);
  check(g.areas.length === 8 && g.areas[0] === 'the-excuse' && g.areas[7] === 'the-borderland',
    `seed ${seed}: board ends`);
  const middle = g.areas.slice(1, 7).slice().sort().join('|');
  check(middle === C.MIDDLE_IDS.slice().sort().join('|'), `seed ${seed}: middle areas ${middle}`);
  check(g.hands.me.length === 7 && g.hands.dummy.length === 7, `seed ${seed}: hand sizes`);
  check(g.hands.me.filter((id) => byId[id].rank === 1).length === 6 &&
    g.hands.me.filter((id) => C.FACTIONS.includes(id)).length === 1, `seed ${seed}: my action set`);
  check(g.hands.dummy.filter((id) => byId[id.split('#')[0]].rank === 1 && id.endsWith('#2')).length === 6 &&
    g.hands.dummy.filter((id) => C.FACTIONS.includes(id)).length === 1, `seed ${seed}: dummy action set`);
  check(C.FACTIONS.includes(g.spare), `seed ${seed}: spare pawn`);
  check(new Set([g.hands.me[6], g.hands.dummy[6], g.spare]).size === 3,
    `seed ${seed}: the three families are dealt once each`);
  for (const who of ['me', 'dummy']) {
    const placed = g.board.reduce((n, b) => n + b[who], 0);
    const d = g.dice[who];
    check(placed === 2, `seed ${seed} ${who}: dice ${d} place ${placed}`);
    check(g.supply[who] === 4 && g.supply[who] + placed + g.general[who] === 10,
      `seed ${seed} ${who}: markers ${g.supply[who]}+${placed}+${g.general[who]} ≠ 10`);
    check(d[0] >= 1 && d[0] <= 6 && d[1] >= 1 && d[1] <= 6, `seed ${seed}: die value`);
    check(g.gold[who] === 3, `seed ${seed} ${who}: gold ${g.gold[who]}`);
  }
  check(g.general.gold === 2 && g.gold.me + g.gold.dummy + g.general.gold === 8,
    `seed ${seed}: gold in circulation`);
  check(g.problems.length === 2 && g.problemDeck.length === 22,
    `seed ${seed}: problems ${g.problems.length}, deck ${g.problemDeck.length}`);
  check(g.problems.every((id) => byId[id].rank !== 1 && !C.MIDDLE_IDS.includes(id)),
    `seed ${seed}: Problem deck membership`);
  check(g.barbarians === 0 && g.round === 1 && g.phase === 'dummy-action' && !g.over,
    `seed ${seed}: fresh game`);
  check(g.confidente === null, `seed ${seed}: no Confidente yet`);
  conserved(g, `seed ${seed}`);
  check(JSON.parse(JSON.stringify(g)).hands.me.length === 7, `seed ${seed}: JSON round trip`);
}

/* ---- determinism of the deal ---- */
{
  check(JSON.stringify(C.newGame(42, BASIC)) === JSON.stringify(C.newGame(42, BASIC)),
    'same seed must give the same game');
  let differs = 0;
  for (let seed = 1; seed <= 20; seed++) {
    if (JSON.stringify(C.newGame(seed, BASIC)) !== JSON.stringify(C.newGame(seed + 500, BASIC))) differs++;
  }
  check(differs >= 19, `different seeds should differ (${differs}/20)`);
}

/* ---- area actions: rules and their errors ---- */
{
  // marker placement, caps and forced moves
  const dryBoard = Array.from({ length: 8 }, () => ({ me: 0, dummy: 0 }));
  dryBoard[4].me = 3;
  const dry = mkState({
    supply: { me: 0, dummy: 4 }, board: dryBoard, handMe: [aceOf('moons')],
    areas: ['the-excuse', 'the-lunatic', 'the-castle', 'the-market', 'the-cave', 'the-chance-meeting', 'the-penitent', 'the-borderland'],
  });
  throwsWith(() => C.applyMove(dry, { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1 }),
    'move one from another area', 'out of reserve with no source');
  throwsWith(() => C.applyMove(dry, { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1, moveFrom: 1 }),
    'different area', 'source must differ from the target');
  throwsWith(() => C.applyMove(dry, { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1, moveFrom: 2 }),
    'none of those markers', 'source without markers');
  const forced = C.applyMove(dry, { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1, moveFrom: 4 });
  check(forced.board[4].me === 2 && forced.board[1].me === 1,
    'the forced move relocates one marker');
  check(forced.supply.me === 1, 'the Lunatic refills the reserve it just spent');
  check(forced.discards.me.includes(aceOf('moons')), 'the played card went to the action discard');
  conserved(forced, 'after a forced move');

  // structural errors
  const g2 = mkState();
  throwsWith(() => C.applyMove(g2, { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1 }),
    'no moons symbol', 'card lacks the suit');
  throwsWith(() => C.applyMove(g2, { type: 'area', who: 'me', hand: 0, suit: 'crowns', area: 2 }),
    'does not show', 'area lacks the symbol');
  throwsWith(() => C.applyMove(g2, { type: 'area', who: 'me', hand: 0, suit: 'crowns', area: 0 }),
    'seven areas', 'the Excuse is not an action area');
  throwsWith(() => C.applyMove(g2, { type: 'area', who: 'me', hand: 9, suit: 'crowns', area: 3 }),
    'select a card', 'no such card in hand');
  throwsWith(() => C.applyMove(mkState({ phase: 'dummy-action' }), { type: 'area', who: 'me', hand: 0, suit: 'crowns', area: 3 }),
    'not your action', 'acting out of turn');
  throwsWith(() => C.applyMove(mkState(), { type: 'area', who: 'dummy', hand: 1, suit: 'crowns', area: 3 }),
    'not the dummy', 'the dummy out of its phase');
  throwsWith(() => C.applyMove(mkState({ phase: 'dummy-action' }), { type: 'area', who: 'dummy', hand: 1, suit: 'crowns', area: 3 }),
    'first card', 'the dummy plays its front card only');
  throwsWith(() => C.applyMove(mkState(), { type: 'teleport', who: 'me' }), 'unknown move', 'unknown move');
  throwsWith(() => C.applyMove({ ...mkState(), over: 'won' }, { type: 'pass', who: 'me' }), 'game is over', 'after the end');

  // the Lunatic: +1 gold and +1 marker from the general reserve …
  const lun = (over) => mkState({
    areas: ['the-excuse', 'the-lunatic', 'the-castle', 'the-market', 'the-cave', 'the-chance-meeting', 'the-penitent', 'the-borderland'],
    handMe: [aceOf('moons')], ...over,
  });
  const lun1 = C.applyMove(lun(), { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1 });
  check(lun1.gold.me === 4 && lun1.supply.me === 4 && lun1.general.gold === 1 && lun1.general.me === 3,
    'the Lunatic pays out of the general reserve (the placed marker is replaced)');
  const lun2 = C.applyMove(
    lun({ supply: { me: 10, dummy: 4 }, gold: { me: 4, dummy: 3 } }),
    { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1 });
  check(lun2.gold.me === 4 && lun2.supply.me === 10 && lun2.general.gold === 2 && lun2.general.me === 3,
    'the caps hold: no gold is gained at the gold limit');

  // the Market: gains what you have there; the Confidente counts
  const marketState = mkState({
    areas: ['the-excuse', 'the-market', 'the-lunatic', 'the-castle', 'the-cave', 'the-chance-meeting', 'the-penitent', 'the-borderland'],
    handMe: [aceOf('leaves')], confidente: 1,
  });
  marketState.board[1].me = 2;
  const mk1 = C.applyMove(marketState, { type: 'area', who: 'me', hand: 0, suit: 'leaves', area: 1 });
  // 3 own markers there counting the Confidente (plus the one just placed)
  // → 4 of everything allowed; only 1 gold fits under the cap
  check(mk1.gold.me === 4 && mk1.supply.me === 7 && mk1.general.gold === 1 && mk1.general.me === 0,
    `the Market pays what the caps allow (gold ${mk1.gold.me}, supply ${mk1.supply.me})`);

  // the Cave: one opponent marker back to the general reserve
  const caveState = mkState({
    areas: ['the-excuse', 'the-cave', 'the-lunatic', 'the-castle', 'the-market', 'the-chance-meeting', 'the-penitent', 'the-borderland'],
    handMe: [aceOf('waves')],
  });
  caveState.board[3].dummy = 2;
  throwsWith(() => C.applyMove(caveState, { type: 'area', who: 'me', hand: 0, suit: 'waves', area: 1 }),
    'choose an area', 'the Cave needs a target');
  throwsWith(() => C.applyMove(caveState, { type: 'area', who: 'me', hand: 0, suit: 'waves', area: 1, spec: { caveTarget: 5 } }),
    'no marker of the other side', 'Cave target without an opponent marker');
  const cave1 = C.applyMove(caveState, { type: 'area', who: 'me', hand: 0, suit: 'waves', area: 1, spec: { caveTarget: 3 } });
  check(cave1.board[3].dummy === 1 && cave1.general.dummy === 5, 'the Cave removes one marker');

  // the Chance Meeting: move up to 2 markers, then act at the destination
  const chanceState = mkState({
    areas: ['the-excuse', 'the-chance-meeting', 'the-lunatic', 'the-castle', 'the-market', 'the-cave', 'the-penitent', 'the-borderland'],
    handMe: [aceOf('moons')],
  });
  chanceState.board[3].me = 2;
  throwsWith(() => C.applyMove(chanceState, { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1 }),
    'source area', 'the Chance Meeting needs a source');
  throwsWith(() => C.applyMove(chanceState,
    { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1, spec: { chanceSrc: 3, chanceDest: 3 } }),
    'different area', 'source must differ from destination');
  throwsWith(() => C.applyMove(chanceState,
    { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1, spec: { chanceSrc: 5, chanceDest: 3 } }),
    'none of your markers', 'source without markers');
  const chance1 = C.applyMove(chanceState,
    { type: 'area', who: 'me', hand: 0, suit: 'moons', area: 1, spec: { chanceSrc: 3, chanceDest: 4, chanceCount: 2 } });
  check(chance1.board[3].me === 0 && chance1.board[4].me === 2,
    'two markers moved; the destination action ran there');

  // the Borderland: only the marker
  const bl = mkState({
    areas: ['the-excuse', 'the-borderland', 'the-lunatic', 'the-castle', 'the-market', 'the-cave', 'the-penitent', 'the-chance-meeting'],
    handMe: [aceOf('waves')],
  });
  const bl1 = C.applyMove(bl, { type: 'area', who: 'me', hand: 0, suit: 'waves', area: 1 });
  check(bl1.board[1].me === 1 && bl1.supply.me === 3, 'the Borderland only takes the marker');
}

/* ---- the Penitent ---- */
{
  const state = mkState({ problems: ['the-forest', 'the-desert'], handMe: [aceOf('suns')] });
  throwsWith(() => C.applyMove(state, { type: 'area', who: 'me', hand: 0, suit: 'suns', area: 1, spec: {} }),
    'choose which', 'the Penitent needs a Problem choice');
  throwsWith(() => C.applyMove(state, {
    type: 'area', who: 'me', hand: 0, suit: 'suns', area: 1,
    spec: { penitent: { problem: 'the-mountain', resolution: { symbol: 'rank' } } },
  }), 'not on the table', 'a Problem that is not face up');
  const broke = mkState({ problems: ['the-forest'], handMe: [aceOf('suns')], gold: { me: 0, dummy: 3 } });
  throwsWith(() => C.applyMove(broke, {
    type: 'area', who: 'me', hand: 0, suit: 'suns', area: 1,
    spec: { penitent: { problem: 'the-forest', resolution: { symbol: 'rank' } } },
  }), 'costs 1 gold', 'the Penitent without gold');

  const ok = C.applyMove(state, {
    type: 'area', who: 'me', hand: 0, suit: 'suns', area: 1,
    spec: { penitent: { problem: 'the-forest', resolution: { symbol: 'rank' } } },
  });
  check(ok.gold.me === 2 && ok.general.gold === 3, 'the Penitent charges 1 gold to the reserve');
  check(ok.pv.me.includes('the-forest'), 'the Problem resolves straight to PV');
  check(ok.problems.join() === 'the-desert', 'the resolved Problem is not replenished');
  check(ok.board[1].me === 1, 'the visit still places a marker');
  conserved(ok, 'after the Penitent');

  // a Crown Problem resolved through the Penitent is spent, not PV
  const crownPen = mkState({ problems: ['the-bard'], handMe: [aceOf('suns')] });
  const cp = C.applyMove(crownPen, {
    type: 'area', who: 'me', hand: 0, suit: 'suns', area: 1,
    spec: { penitent: { problem: 'the-bard', resolution: { symbol: 'crown', confidenteTo: 3 } } },
  });
  check(cp.confidente === 3 && cp.pv.me.length === 0 && cp.problemDiscard.includes('the-bard'),
    'a Crown Problem through the Penitent moves the Confidente and is spent');
  conserved(cp, 'after a Crown Problem via the Penitent');
}

/* ---- Problems: sums, contests, barbarians ---- */
{
  // presence sums: matching areas, plus a present Confidente
  const s = mkState({ problems: ['the-journey'] });      // 3 PV, Moons and Waves
  s.board[2].me = 2;                                      // the Lunatic matches
  s.board[1].me = 1;                                      // the Penitent does not
  s.confidente = 2;
  check(C.presenceSum(s, 'me', 'the-journey') === 3, `sum with Confidente ${C.presenceSum(s, 'me', 'the-journey')}`);
  s.board[2].me = 0; s.confidente = null;
  check(C.presenceSum(s, 'me', 'the-journey') === 0, 'presence without markers is zero');

  // contested: the dummy leads the forest (5 PV) and the desert (2 PV)
  const contested = mkState({
    phase: 'dummy-resolve', problems: ['the-forest', 'the-desert'], gold: { me: 3, dummy: 3 },
  });
  contested.board[2].dummy = 2;      // the Lunatic: forest's moons
  contested.board[5].dummy = 1;      // the Cave: desert's daemons
  contested.board[1].dummy = 1;      // the Penitent: desert's suns
  contested.board[1].me = 1;         // my Penitent marker
  contested.board[6].me = 1;         // the Chance Meeting: forest's moons
  check(C.presenceSum(contested, 'dummy', 'the-forest') > C.presenceSum(contested, 'me', 'the-forest'),
    'the dummy leads the forest');
  check(C.presenceSum(contested, 'dummy', 'the-desert') > C.presenceSum(contested, 'me', 'the-desert'),
    'the dummy leads the desert too');

  const afterDummy = C.applyMove(contested, {
    type: 'attempt', who: 'dummy', problem: 0, resolution: { symbol: 'rank' },
  });
  check(afterDummy.dummyAttempt.problem === 0, 'the dummy committed to the higher-PV Problem');
  check(afterDummy.phase === 'my-resolve', 'the round passes to me');
  check(afterDummy.gold.dummy === 2 && afterDummy.general.gold === 3, 'an attempt costs 1 gold');

  // a tie goes to whoever tried first — in solo the dummy
  const tie = mkState({ phase: 'dummy-resolve', problems: ['the-journey'], gold: { me: 3, dummy: 3 } });
  tie.board[2].dummy = 1;             // the Lunatic
  tie.board[6].me = 1;                // the Chance Meeting — equal presence
  const tieDone = C.applyMove(
    C.applyMove(tie, { type: 'attempt', who: 'dummy', problem: 0, resolution: { symbol: 'rank' } }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'rank' } });
  check(tieDone.pv.dummy.join() === 'the-journey' && tieDone.pv.me.length === 0,
    'the tie resolves for the first attempter — the dummy');
  check(tieDone.gold.me === 2 && tieDone.gold.dummy === 2, 'both paid their attempt fee');

  // I attempt alone: uncontested even with a weaker sum
  const alone = mkState({
    phase: 'my-resolve', problems: ['the-forest', 'the-desert'], gold: { me: 3, dummy: 3 },
  });
  alone.board[1].me = 1;             // my Penitent marker on the desert's suns
  alone.board[5].dummy = 2;          // the dummy would out-sum me there
  alone.board[6].me = 1;             // the Chance Meeting on the forest's moons
  const solo = C.applyMove(alone, { type: 'attempt', who: 'me', problem: 1, resolution: { symbol: 'rank' } });
  check(solo.pv.me.includes('the-desert'), 'an uncontested attempt resolves');
  check(solo.barbarians === 1, 'the unattempted Problem raises the barbarians');
  check(solo.problemDiscard.includes('the-forest'), 'unresolved Problems are discarded');
  check(solo.problems.length === 2 && solo.round === 2 && solo.phase === 'dummy-action',
    'the round closes and the next opens with two fresh Problems');

  // passing is free and leaves the dummy's attempt standing
  const passed = C.applyMove(afterDummy, { type: 'pass', who: 'me' });
  check(passed.pv.dummy.join() === 'the-forest', 'the dummy resolves its uncontested Problem');
  check(passed.gold.me === 3, 'passing costs nothing');

  // attempt costs and structural errors
  throwsWith(() => C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-forest'], gold: { me: 0, dummy: 3 } }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'rank' } }),
    'costs 1 gold', 'attempt without gold');
  throwsWith(() => C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-forest'] }),
    { type: 'attempt', who: 'me', problem: 3, resolution: { symbol: 'rank' } }),
    'face-up', 'no such Problem');
  throwsWith(() => C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-bard'] }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'rank' } }),
    'shows', 'a Crown Problem has no rank to take');
  throwsWith(() => C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-journey'] }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'suns', area: 1 } }),
    'shows', 'a symbol the Problem does not have');
  throwsWith(() => C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-journey'] }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'moons', area: 1 } }),
    'does not show', 'an area without that symbol');
  throwsWith(() => C.applyMove(mkState({ phase: 'my-action', problems: ['the-forest'] }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'rank' } }),
    'you may attempt', 'attempting out of phase');
  throwsWith(() => C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-bard'], confidente: 3 }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'crown', confidenteTo: 3 } }),
    'different area', 'the Confidente may not stay put');

  // the Confidente's first placement is free
  const conf1 = C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-bard'] }),
    { type: 'attempt', who: 'me', problem: 0, resolution: { symbol: 'crown', confidenteTo: 3 } });
  check(conf1.confidente === 3, 'the Confidente is placed');
  check(conf1.pv.me.length === 0 && conf1.problemDiscard.includes('the-bard'),
    'a Crown Problem resolves without PV and is spent');

  // barbarian accumulation, capped at 6
  const barb = C.applyMove(mkState({ phase: 'my-resolve', problems: ['the-journey', 'the-desert'], round: 6 }),
    { type: 'pass', who: 'me' });
  check(barb.barbarians === 2 && barb.round === 7 && barb.phase === 'dummy-action',
    `two unresolved Problems → ${barb.barbarians} barbarians, round 7 opens`);
  const barb2 = C.applyMove(
    mkState({ phase: 'my-resolve', problems: ['the-journey', 'the-desert'], round: 6, barbarians: 5 }),
    { type: 'pass', who: 'me' });
  check(barb2.barbarians === 6, `barbarians cap at 6 (${barb2.barbarians})`);
}

/* ---- the endgame, hand-computed ---- */
{
  const dark = byRank(9), forest5 = byRank(5), journey3 = byRank(3), author = byRank(2);

  // power 2, frontier 1 → threshold 5: the 9 and the 5 are swept away
  const a = mkState({ barbarians: 2, pvMe: [dark, forest5, journey3, author], round: 7, phase: 'over' });
  a.board[7].me = 1;
  C.endgame(a);
  check(a.score === 5 && a.over === 'won', `fixture A: score ${a.score}, ${a.over}`);
  check(a.pv.me.join() === [journey3, author].join() && a.problemDiscard.includes(dark),
    'fixture A: cards at or above the threshold are discarded');
  conserved(a, 'fixture A');

  // power 6, frontier 0 → threshold 0: everything goes
  const b = mkState({ barbarians: 6, pvMe: [dark, journey3], round: 7, phase: 'over' });
  C.endgame(b);
  check(b.score === 0 && b.over === 'lost' && b.pv.me.length === 0, `fixture B: score ${b.score}, ${b.over}`);

  // power 0, frontier 6 → threshold 12: nothing is lost
  const c = mkState({ barbarians: 0, pvMe: [dark, forest5], round: 7, phase: 'over' });
  c.board[7].me = 6;
  C.endgame(c);
  check(c.score === 14 && c.over === 'won', `fixture C: score ${c.score}, ${c.over}`);

  // no PV at all: the barbarians win
  const d = mkState({ barbarians: 3, pvMe: [], round: 7, phase: 'over' });
  C.endgame(d);
  check(d.score === 0 && d.over === 'lost', `fixture D: score ${d.score}, ${d.over}`);

  // exactly at the threshold goes too ("valor igual o superior")
  const e = mkState({ barbarians: 4, pvMe: [byRank(4)], round: 7, phase: 'over' });
  e.board[7].me = 2;                        // threshold 6−4+2 = 4
  C.endgame(e);
  check(e.score === 0 && e.over === 'lost', `fixture E: score ${e.score}, ${e.over}`);
}

/* ---- the dummy's authored policy ---- */
{
  // it plays the front card of its action hand
  const front = C.newGame(11, BASIC).hands.dummy[0];
  const pv0 = mkState({ phase: 'dummy-action', handDummy: [front, aceOf('moons'), aceOf('suns')] });
  const mv0 = C.dummyActionMove(pv0);
  check(mv0.hand === 0 && byId[front.split('#')[0]].suits.includes(mv0.suit), 'the dummy plays its front card');

  // the Borderland first whenever one of its suits allows …
  const pawn = 'the-harvest';                // Moons, Suns, Leaves — Leaves is on the Borderland
  const withLand = mkState({ phase: 'dummy-action', handDummy: [pawn], problems: ['the-forest'] });
  check(C.dummyActionMove(withLand).area === 7, 'the dummy goes to the Borderland whenever it can');

  // … otherwise parity — laid out so the Penitent sits at 3 (odd) and the
  // Castle at 4 (even)
  const PARITY_AREAS = ['the-excuse', 'the-lunatic', 'the-cave', 'the-penitent',
    'the-castle', 'the-market', 'the-chance-meeting', 'the-borderland'];
  const sunsAce = aceOf('suns');             // the Penitent (3) and the Castle (4)
  const odd = mkState({
    areas: PARITY_AREAS, phase: 'dummy-action', handDummy: [sunsAce], round: 1, problems: ['the-forest'],
  });
  odd.board[4].dummy = 2;                    // the Castle would pay, too
  check(C.dummyActionMove(odd).area === 3, 'round 1 → the odd area');

  // … and round 2 (even) the even one
  const even = mkState({
    areas: PARITY_AREAS, phase: 'dummy-action', handDummy: [sunsAce], round: 2, problems: ['the-forest'],
  });
  even.board[4].dummy = 2;
  check(C.dummyActionMove(even).area === 4, 'round 2 → the even area when it pays');

  // "un absurdo": with no gold the Penitent cannot resolve anything
  const poor = mkState({
    areas: PARITY_AREAS, phase: 'dummy-action', handDummy: [sunsAce], round: 1,
    problems: ['the-forest'], gold: { me: 3, dummy: 0 },
  });
  poor.board[4].dummy = 2;
  check(C.dummyActionMove(poor).area === 4, 'the Penitent is skipped without gold');

  // out of reserve: pull from the most-marked area, never the Borderland
  const dry = mkState({
    areas: PARITY_AREAS, phase: 'dummy-action', handDummy: [sunsAce],
    problems: ['the-forest'], supply: { me: 4, dummy: 0 }, gold: { me: 3, dummy: 0 },
  });
  dry.board[2].dummy = 1;                    // the Cave
  dry.board[4].dummy = 3;                    // the Castle
  dry.board[7].dummy = 5;                    // the Borderland
  const dryMv = C.dummyActionMove(dry);
  check(dryMv.area === 4 && dryMv.moveFrom === 2, `pulls from the most-marked area outside the target (${dryMv.moveFrom})`);
  const dry2 = C.applyMove(dry, dryMv);
  check(dry2.board[2].dummy === 0 && dry2.board[4].dummy === 4 && dry2.board[7].dummy === 5,
    'the Borderland keeps its markers while the Castle refills the reserve');

  // resolution policy: only where it leads; higher PV first
  const res = mkState({ phase: 'dummy-resolve', round: 1, problems: ['the-forest', 'the-desert'], gold: { me: 3, dummy: 3 } });
  res.board[2].dummy = 2;                    // the Lunatic — the forest's moons
  res.board[5].dummy = 1;                    // the Cave — the desert's daemons
  res.board[1].dummy = 1;                    // the Penitent — the desert's suns
  res.board[1].me = 1;
  res.board[6].me = 1;                       // my Chance Meeting marker on the forest
  const resMv = C.dummyResolveMove(res);
  check(resMv && resMv.problem === 0 && resMv.resolution.symbol === 'rank',
    'leading both, it takes the higher-PV Problem');

  const res2 = mkState({ phase: 'dummy-resolve', round: 1, problems: ['the-forest', 'the-desert'], gold: { me: 3, dummy: 3 } });
  res2.board[5].dummy = 2;                   // it leads only the desert …
  res2.board[1].me = 1;                      // … where I have 1
  res2.board[6].me = 2;                      // and I lead the forest
  const res2Mv = C.dummyResolveMove(res2);
  check(res2Mv && res2Mv.problem === 1, `leading only one, it takes that one (${res2Mv && res2Mv.problem})`);

  const res3 = mkState({ phase: 'dummy-resolve', round: 1, problems: ['the-forest', 'the-desert'], gold: { me: 3, dummy: 3 } });
  res3.board[6].me = 3;                      // I lead the forest
  res3.board[1].me = 3;                      // and the desert
  check(C.dummyResolveMove(res3) === null, 'trailing both, it attempts nothing');
  check(C.dummyResolveMove(mkState({ phase: 'dummy-resolve', problems: ['the-forest'], gold: { me: 3, dummy: 0 } })) === null,
    'without gold it cannot attempt');

  // Crown Problems: the Borderland-bound suit first, else parity for the Confidente
  const crownRes = mkState({ phase: 'dummy-resolve', round: 1, problems: ['the-sea', 'the-bard'], gold: { me: 3, dummy: 3 } });
  crownRes.board[2].dummy = 2;                // the Lunatic — the sea's waves
  crownRes.board[5].dummy = 2;                // the Cave — the sea's waves
  crownRes.board[1].dummy = 2;                // the Penitent — the bard's suns
  crownRes.board[3].dummy = 2;                // the Castle — the bard's suns
  const crownMv = C.dummyResolveMove(crownRes);
  check(crownMv.problem === 0 && crownMv.resolution.symbol === 'waves' && crownMv.resolution.area === 7,
    'a Borderland-bound Crown Problem is resolved on the Borderland');

  const bardOnly = mkState({ phase: 'dummy-resolve', round: 1, problems: ['the-bard'], gold: { me: 3, dummy: 3 } });
  bardOnly.board[1].dummy = 2;
  bardOnly.board[3].dummy = 2;
  const bardMv = C.dummyResolveMove(bardOnly);
  check(bardMv.resolution.symbol === 'crown' &&
    [1, 3].includes(bardMv.resolution.confidenteTo),
    `the Confidente parks on a matching area (${bardMv.resolution.confidenteTo})`);

  // purity: the same state always gives the same move
  for (const st of [pv0, odd, even, poor, dry, res, res2, res3, crownRes, bardOnly]) {
    const pick = () => st.phase === 'dummy-action' ? C.dummyActionMove(st)
      : (C.dummyResolveMove(st) || { type: 'pass', who: 'dummy' });
    check(JSON.stringify(pick()) === JSON.stringify(pick()), 'the dummy policy is a pure function of state');
  }
}

/* ---- full games: the policy is never illegal; the AI is deterministic ---- */
{
  const playGame = (seed) => {
    let s = C.newGame(seed, BASIC);
    const rng = D_mulberry32(seed * 131 + 7);
    let guard = 0;
    while (!s.over && guard++ < 600) {
      let applied = false;
      for (let tries = 0; tries < 40 && !applied; tries++) {
        let mv;
        if (s.phase === 'dummy-action') {
          // the policy's own move, applied directly: any throw fails the test
          mv = C.dummyActionMove(s);
        } else if (s.phase === 'dummy-resolve') {
          mv = C.dummyResolveMove(s) || { type: 'pass', who: 'dummy' };
        } else {
          const ms = C.legalMoves(s);
          if (!ms.length) throw new Error(`seed ${seed}: no moves in ${s.phase} round ${s.round}`);
          mv = ms[Math.floor(rng() * ms.length)];
        }
        try { s = C.applyMove(s, mv); applied = true; }
        catch (e) {
          // only a Problem the world moved under between commit and execution
          // may be rejected; the dummy's own moves are pre-validated
          if (s.phase === 'dummy-action' || s.phase === 'dummy-resolve') throw e;
        }
      }
      if (!applied) throw new Error(`seed ${seed}: no move applied in ${s.phase}`);
      conserved(s, `seed ${seed} move ${s.moves}`);
      if (s.barbarians > 6) throw new Error(`seed ${seed}: barbarians ${s.barbarians}`);
    }
    if (!s.over) throw new Error(`seed ${seed}: did not finish (round ${s.round})`);
    return s;
  };

  let won = 0, lost = 0, moves = 0;
  const scores = [];
  for (let seed = 1; seed <= 300; seed++) {
    const s = playGame(seed);
    if (s.over === 'won') won++; else lost++;
    const want = s.pv.me.reduce((n, id) => n + byId[String(id).split('#')[0]].rank, 0);
    check(s.score === want, `seed ${seed}: score ${s.score}, PV cards total ${want}`);
    check((s.over === 'won') === (s.score >= 1), `seed ${seed}: ${s.over} with score ${s.score}`);
    moves += s.moves;
    scores.push(s.score);
  }
  scores.sort((a, b) => a - b);
  console.log(`games: ${won} won, ${lost} lost · avg score ${(scores.reduce((a, b) => a + b, 0) / 300).toFixed(1)} · median ${scores[150]} · avg moves ${(moves / 300).toFixed(1)}`);

  let identical = 0;
  for (let seed = 1; seed <= 25; seed++) {
    if (JSON.stringify(playGame(seed)) === JSON.stringify(playGame(seed))) identical++;
    else check(false, `seed ${seed}: the AI is not deterministic`);
  }
  check(identical === 25, `deterministic AI: ${identical}/25 identical replays`);

  let divergent = 0;
  for (let seed = 1; seed <= 25; seed++) {
    if (JSON.stringify(playGame(seed)) !== JSON.stringify(playGame(seed + 999))) divergent++;
  }
  check(divergent >= 24, `different seeds diverge (${divergent}/25)`);
}

console.log(failures === 0 ? 'reino-de-ambar: all tests passed' : `reino-de-ambar: ${failures} failures`);
process.exit(failures ? 1 : 0);

// Headless tests for Dueling Runes: node test/dueling-runes.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/dueling-runes-core.js');
C.init(byId);

const ALL = [...manifest.basicDeck, ...manifest.extendedDeck];
const ALL44 = ALL.filter((id) => id !== 'the-excuse');
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, msg) => {
  let t = false;
  try { fn(); } catch { t = true; }
  check(t, `${msg} — should throw`);
};

const cardsIn = (st) => [
  ...st.deck, ...st.discard,
  ...st.you.hand, ...st.foe.hand,
  ...st.you.seq.map((e) => e.id), ...st.foe.seq.map((e) => e.id),
  ...(st.confused ? [st.confused.card] : []),
];
const sorted = (list) => list.slice().sort().join('|');

/** A whole 45-card game state must never gain or lose a card. */
function conserved(st, label) {
  const all = cardsIn(st);
  if (all.length !== 45) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 45) check(false, `${label}: duplicate or missing card`);
}
/** The same idea for hand-built fixture states. */
function sameCards(before, after, label) {
  check(sorted(cardsIn(before)) === sorted(cardsIn(after)), `${label}: cards changed`);
}
/** Structural sanity that holds everywhere. */
function checkShape(st, label) {
  check(st.you.hand.length <= 5 && st.foe.hand.length <= 5,
    `${label}: hand ${st.you.hand.length}/${st.foe.hand.length} over 5`);
  if (!st.over) {
    check(st.you.seq.length <= 3 && st.foe.seq.length <= 3,
      `${label}: sequence ${st.you.seq.length}/${st.foe.seq.length} over 3`);
    check(st.you.hp > 0 && st.foe.hp > 0, `${label}: a mage is at 0 but the game continues`);
    check(['choose', 'casting'].includes(st.phase), `${label}: phase ${st.phase}`);
  }
}

/* ------------------------------------------------------------- fixtures */

function mkState(spec = {}) {
  return {
    seed: 12345, rngs: 12345, turn: 3,
    deck: spec.deck || ['ace-of-moons', 'the-mountain', 'the-sea', 'the-forest', 'the-bard'],
    discard: spec.discard || [],
    you: { hp: 8, maxHp: 12, hand: [], seq: [], status: [], ...(spec.you || {}) },
    foe: { hp: 12, maxHp: 12, hand: [], seq: [], status: [], ...(spec.foe || {}) },
    phase: spec.phase || 'choose',
    pending: null, plan: null, confused: null, hpChoice: 8,
    log: [], over: null,
  };
}

/** Simulate the reveal: move the pending cards onto the sequences. */
function startTurn(st, { you = [], foe = [], youSpecial = null, foeSpecial = null } = {}) {
  st.pending = { you, foe, youSpecial, foeSpecial };
  st.phase = 'casting';
  for (const [who, ids] of [['you', you], ['foe', foe]]) {
    for (const id of ids) {
      const i = st[who].hand.indexOf(id);
      if (i >= 0) st[who].hand.splice(i, 1);
      st[who].seq.push({ id, down: false });
    }
  }
  return st;
}

/** Plan for the revealed cards: one energy map per card. */
const plan = (ids, ...maps) => ids.map((id, i) =>
  C.activationsOf(id).map((act) => ({ act, energy: (maps[i] || {})[act] ?? '' })));

/** Build the fixture state, reveal it, resolve it. */
function spellTurn(spec, { you, foe, energies, youSpecial = null, foeSpecial = null } = {}) {
  const st = mkState(spec);
  const before = structuredClone(st);
  startTurn(st, { you, foe, youSpecial, foeSpecial });
  const out = C.resolveTurn(st, plan(you, energies));
  sameCards(before, out, `spell turn ${you.join('+')}`);
  return out;
}

/* ------------------------------------------------------- setup invariants */

for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, ALL, {});
  check(st.you.hand.length === 5 && st.foe.hand.length === 5,
    `seed ${seed}: hands ${st.you.hand.length}/${st.foe.hand.length}`);
  check(st.deck.length === 35, `seed ${seed}: deck ${st.deck.length}`);
  check(st.deck.indexOf('the-excuse') === 12, `seed ${seed}: Excuse at ${st.deck.indexOf('the-excuse')}`);
  check(!st.you.hand.includes('the-excuse') && !st.foe.hand.includes('the-excuse'),
    `seed ${seed}: Excuse dealt`);
  check(st.you.hp === 8 && st.foe.hp === 12 && st.you.maxHp === 12,
    `seed ${seed}: hp ${st.you.hp}/${st.foe.hp}`);
  check(st.phase === 'choose' && !st.over && st.turn === 1, `seed ${seed}: start flags`);
  check(C.playNeed(st, 'you') === 1 && C.playNeed(st, 'foe') === 1, `seed ${seed}: need`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.deck.length === st.deck.length && json.you.hand.length === 5, `seed ${seed}: JSON round trip`);
}
{
  const st = C.newGame(1, ALL, { playerHp: 99 });
  check(st.you.hp === 12, 'player HP caps at 12 (the d12)');
  const st2 = C.newGame(1, ALL, { playerHp: 0 });
  check(st2.you.hp === 12, 'a silly HP falls back to 12');
}

/* ------------------------------------------------------------ card basics */

{
  check(C.activationsOf('the-pact').join() === 'moons', 'the Pact activates Moons');
  check(C.activationsOf('the-battle').join() === 'daemons,crowns', 'the Battle activates Wyrm and Knot');
  check(C.activationsOf('the-watchman').join() === 'moons,daemons,crowns',
    'a Pawn can carry all three activation runes');
  check(C.activationsOf('the-excuse').length === 0 && C.runesOf('the-excuse').length === 0,
    'the Excuse shows no runes');
  check(C.rankOf('the-watchman') === 12 && C.rankOf('the-bard') === 10 && C.rankOf('ace-of-suns') === 1,
    'ranks: Pawn 12, Crown 10, Ace 1');

  const st = mkState({
    you: { seq: [{ id: 'ace-of-suns', down: false }, { id: 'the-pact', down: true }] },
  });
  const counts = C.visibleRunes(st, 'you');
  check(counts.suns === 1 && !counts.moons, 'face-down cards contribute no runes (the Pact is blind)');
}

/* ------------------------------------------------------------- cast plans */

{
  const st = mkState({
    you: { seq: [{ id: 'ace-of-suns', down: false }, { id: 'ace-of-waves', down: false }, { id: 'the-pact', down: false }] },
  });
  const plans = C.castPlans(st, 'you', 'the-battle');      // daemons + crowns
  check(plans.length > 0, 'there is always at least one plan');
  for (const p of plans) {
    check(p.map((c) => c.act).join() === 'daemons,crowns', `plan order ${p.map((c) => c.act)}`);
    const energies = p.map((c) => c.energy).filter(Boolean);
    check(new Set(energies).size === energies.length, 'each rune type powers one spell per turn');
    for (const e of energies) check(['suns', 'waves'].includes(e), `only visible energy, got ${e}`);
  }
  check(plans.some((p) => p[0].energy === 'suns' && p[1].energy === 'waves'),
    'the plan where Sun powers the Wyrm and Wave the Knot exists');
  check(!plans.some((p) => p.some((c) => c.energy === 'leaves')),
    'no plan may use an energy rune that is not showing');

  check(C.energyOptions({ suns: 2 }, new Set(['suns'])).join() === '',
    'a spent energy type is not offered again');
  check(C.energyOptions({ suns: 2 }, new Set()).join() === ',suns',
    'the Nothing row is always on offer');

  const info = C.castInfo('daemons', 'suns', { suns: 3 });
  check(info.spell === 'fire-ball' && info.amount === 3 && info.target === 'other',
    'Fire Ball, 3 damage, aimed at the rival');
  check(C.castInfo('crowns', '', {}).spell === 'confusion', 'the Nothing row is Confusion for Knots');
}

/* ------------------------------------------------- every basic spell, once */

{
  // Fire Ball: your sequence shows 2 Suns (ace + the Desert's own sun).
  let st = spellTurn({
    you: { seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-desert'] },
    foe: { hp: 12, hand: ['the-discovery'] },
  }, { you: ['the-desert'], foe: ['the-discovery'], energies: { daemons: 'suns' } });
  check(st.foe.hp === 10, `Fire Ball for 2: rival at ${st.foe.hp}, paper: 10`);
  check(st.log.some((l) => l.includes('Fire Ball') && l.includes('for 2')), 'the log says the damage');
  checkShape(st, 'after fire ball');

  // …unless the rival is immune to heat.
  st = spellTurn({
    you: { seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-desert'] },
    foe: { hp: 12, status: [{ name: 'resist-heat', turns: 2, pending: false }], hand: ['the-discovery'] },
  }, { you: ['the-desert'], foe: ['the-discovery'], energies: { daemons: 'suns' } });
  check(st.foe.hp === 12, 'Resist Heat stops Fire Ball');
  check(st.log.some((l) => l.includes('immune')), 'the log says it was immune');
}

{
  // Ice Bolt needs Waves; Resist Cold stops it.
  let st = spellTurn({
    you: { seq: [{ id: 'ace-of-waves', down: false }], hand: ['the-cave'] },
    foe: { hand: ['the-discovery'] },
  }, { you: ['the-cave'], foe: ['the-discovery'], energies: { daemons: 'waves' } });
  check(st.foe.hp === 10, `Ice Bolt for 2: rival at ${st.foe.hp}, paper: 10`);

  st = spellTurn({
    you: { seq: [{ id: 'ace-of-waves', down: false }], hand: ['the-cave'] },
    foe: { status: [{ name: 'resist-cold', turns: 1, pending: false }], hand: ['the-discovery'] },
  }, { you: ['the-cave'], foe: ['the-discovery'], energies: { daemons: 'waves' } });
  check(st.foe.hp === 12, 'Resist Cold stops Ice Bolt');
}

{
  // Drain: damage across, healing back — and healing clamps at the d12 max.
  let st = spellTurn({
    you: { hp: 8, seq: [{ id: 'ace-of-leaves', down: false }], hand: ['the-savage'] },
    foe: { hand: ['the-discovery'] },
  }, { you: ['the-savage'], foe: ['the-discovery'], energies: { daemons: 'leaves' } });
  check(st.foe.hp === 10 && st.you.hp === 10, `Drain 2: ${st.you.hp}/${st.foe.hp}, paper: 10/10`);

  st = spellTurn({
    you: { hp: 11, seq: [{ id: 'ace-of-leaves', down: false }], hand: ['the-savage'] },
    foe: { hand: ['the-discovery'] },
  }, { you: ['the-savage'], foe: ['the-discovery'], energies: { daemons: 'leaves' } });
  check(st.you.hp === 12, 'Healing clamps at the d12 maximum');

  st = spellTurn({
    you: { seq: [{ id: 'ace-of-leaves', down: false }], hand: ['the-savage'] },
    foe: { status: [{ name: 'shield', turns: 1, pending: false }], hand: ['the-discovery'] },
  }, { you: ['the-savage'], foe: ['the-discovery'], energies: { daemons: 'leaves' } });
  check(st.foe.hp === 12 && st.you.hp === 8, 'Shield stops Drain entirely (no damage, no healing)');
}

{
  // Hit is worth 1, and a Shield stops it.
  let st = spellTurn({
    you: { hand: ['the-battle'] }, foe: { hand: ['the-discovery'] },
  }, { you: ['the-battle'], foe: ['the-discovery'], energies: { daemons: '' } });
  check(st.foe.hp === 11, `Hit: rival at ${st.foe.hp}, paper: 11`);

  st = spellTurn({
    you: { hand: ['the-battle'] },
    foe: { status: [{ name: 'shield', turns: 1, pending: false }], hand: ['the-discovery'] },
  }, { you: ['the-battle'], foe: ['the-discovery'], energies: { daemons: '' } });
  check(st.foe.hp === 12, 'Shield stops Hit');
}

{
  // Heal, capped at the d12; Shield and Resist Cold last exactly as long as
  // their runes say (and are already active this very turn).
  let st = spellTurn({
    you: { hp: 10, seq: [{ id: 'ace-of-leaves', down: false }], hand: ['the-forest'] },
    foe: { hand: ['the-discovery'] },
  }, { you: ['the-forest'], foe: ['the-discovery'], energies: { moons: 'leaves' } });
  check(st.you.hp === 12, `Heal 2: you at ${st.you.hp}, paper: 12`);

  st = spellTurn({
    you: { hp: 6, hand: ['the-forest'] }, foe: { hand: ['the-discovery'] },
  }, { you: ['the-forest'], foe: ['the-discovery'], energies: { moons: '' } });
  check(st.log.some((l) => l.includes('Shield')), 'a Moon-phase Shield was cast this turn');
  check(!st.you.status.some((s) => s.name === 'shield'),
    'and a one-turn Shield is gone again by the next turn');
  check(st.you.hp === 6, 'nothing else happened to you');

  st = spellTurn({
    you: { seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-pact'] },
    foe: { hand: ['the-discovery'] },
  }, { you: ['the-pact'], foe: ['the-discovery'], energies: { moons: 'suns' } });
  const resist = st.you.status.find((s) => s.name === 'resist-cold');
  check(resist && resist.turns === 1 && !resist.pending,
    'Resist Cold: 2 Sun runes = 2 turns, one already spent on this turn, 1 left');
}

{
  // Knot spells: Haste, Invisibility and Confusion all start next turn
  // (pending during their own turn), then tick down.
  let st = spellTurn({
    you: { seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-painter'] },
    foe: { hand: ['the-discovery'] },
  }, { you: ['the-painter'], foe: ['the-discovery'], energies: { crowns: 'suns' } });
  const haste = st.you.status.find((s) => s.name === 'haste');
  check(haste && !haste.pending && haste.turns === 2,
    `Haste lands and survives the turn: 2 Sun runes = 2 extra turns (${JSON.stringify(haste)})`);
  check(C.playNeed(st, 'you') === 2, 'a hasted mage plays two cards next turn');

  st = spellTurn({
    you: { seq: [{ id: 'ace-of-waves', down: false }], hand: ['the-painter'] },
    foe: { hand: ['the-discovery'] },
  }, { you: ['the-painter'], foe: ['the-discovery'], energies: { crowns: 'waves' } });
  const inv = st.you.status.find((s) => s.name === 'invisible');
  check(inv && !inv.pending && inv.turns === 1, `Invisibility is running (${JSON.stringify(inv)})`);

  // Confusion is harmful: it lands on the RIVAL, and your own Moon-phase
  // Shield stops a same-turn Hit (the phases run in wiki order).
  st = spellTurn({
    you: { hp: 6, hand: ['the-windfall'] }, foe: { hand: ['the-discovery'] },
  }, { you: ['the-windfall'], foe: ['the-discovery'], energies: { crowns: '' } });
  const conf = st.foe.status.find((s) => s.name === 'confusion');
  check(conf && !conf.pending, 'Confusion lands on the rival for next turn');
  check(st.phase === 'choose' && !st.confused, 'back to choose; no draw yet');

  st = spellTurn({
    you: { hp: 6, hand: ['the-forest'] }, foe: { hand: ['the-savage'] },
  }, { you: ['the-forest'], foe: ['the-savage'], energies: { moons: '' } });
  check(st.you.hp === 6, `your Moon-phase Shield stops the rival's same-turn Hit: you at ${st.you.hp}, paper: 6`);
  check(st.log.some((l) => l.includes('Shield')), 'you raised a Shield this turn');
  check(st.log.some((l) => l.includes('Hit is stopped')), 'and the Hit was stopped by it');
}

{
  // Amnesia turns the NEWEST cards face down first.
  const st = spellTurn({
    you: { seq: [{ id: 'ace-of-leaves', down: false }], hand: ['the-market'] },
    foe: {
      seq: [{ id: 'the-sailor', down: false }, { id: 'the-battle', down: false }, { id: 'the-mountain', down: false }],
      hand: ['the-discovery'],
    },
  }, { you: ['the-market'], foe: ['the-discovery'], energies: { crowns: 'leaves' } });
  const seq = st.foe.seq;
  check(seq[seq.length - 1].down && !seq[0].down,
    `Amnesia blinds the newest card first (${seq.map((e) => (e.down ? 'down' : 'up')).join(',')})`);
  check(st.log.some((l) => l.includes('face down')), 'the log counts what was turned down');
}

/* ------------------------------------- phase order, rank order, simultaneity */

{
  // Phases run Moons → Wyrms → Knots: the rival's Moon-phase Resist Cold
  // (its policy, because your played Wyrm threatens an Ice Bolt and it has
  // Sun energy) shields it from your same-turn Ice Bolt.
  const st = mkState({
    you: { seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-cave'] },
    foe: { hp: 12, seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-pact'] },
  });
  const r = C.reveal(st, { you: ['the-cave'], youSpecial: null });
  const out = C.resolveTurn(r, plan(['the-cave'], { daemons: 'waves' }));
  check(out.foe.hp === 12, `Moon-phase Resist Cold shields the same-turn Ice Bolt (rival at ${out.foe.hp})`);
  check(out.log.some((l) => l.includes('Resist Cold')), 'the rival cast Resist Cold');
  check(out.log.some((l) => l.includes('immune')), 'and the Ice Bolt was immune');

  check(C.rankOf('the-pact') > C.rankOf('the-cave'), 'the pact out-ranks the cave');

  // Simultaneous (equal number) kills: both die, the duel is a draw.
  const st3 = mkState({
    you: { hp: 1, seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-rite'] },
    foe: { hp: 1, hand: ['the-island'] },
  });
  const r3 = C.reveal(st3, { you: ['the-rite'], youSpecial: null });
  const out3 = C.resolveTurn(r3, plan(['the-rite'], { moons: 'suns', daemons: '' }));
  check(out3.over === 'draw' && out3.you.hp === 0 && out3.foe.hp === 0,
    `equal-rank kills both: over=${out3.over} hp ${out3.you.hp}/${out3.foe.hp}`);
  check(out3.log.some((l) => l.includes('draw')), 'the log announces the draw');

  // A higher card that kills resolves first — your spell never fires.
  const st4 = mkState({
    you: { hp: 1, hand: ['the-desert'] },                   // rank 2
    foe: { hp: 12, hand: ['the-island'] },                  // rank 11
  });
  const r4 = C.reveal(st4, { you: ['the-desert'], youSpecial: null });
  const out4 = C.resolveTurn(r4, plan(['the-desert'], { daemons: 'suns' }));
  check(out4.over === 'lost' && out4.foe.hp === 12,
    `the rival's higher card kills you first: over=${out4.over}, rival ${out4.foe.hp}`);

  // …and a clean kill wins.
  const st5 = mkState({ you: { hp: 8, hand: ['the-battle'] }, foe: { hp: 1, hand: ['the-discovery'] } });
  const r5 = C.reveal(st5, { you: ['the-battle'], youSpecial: null });
  const out5 = C.resolveTurn(r5, plan(['the-battle'], { daemons: '', crowns: '' }));
  check(out5.over === 'won' && out5.foe.hp === 0, `last-hit wins: over=${out5.over}`);
}

/* ---------------------------------------------------- specials from hand */

{
  check(C.specialEligible(['the-author'], 'counter'), 'one card can carry both counter runes');
  check(!C.specialEligible(['ace-of-suns', 'the-desert'], 'counter'), 'energy runes do not pay for specials');
  check(!C.specialEligible(['the-author'], 'mirror'), 'mirror needs all three');
  check(C.specialEligible(['the-watchman'], 'mirror'), 'a single Pawn covers all three runes');

  const cost = C.specialCost(['the-author', 'the-soldier'], 'counter');
  check(cost && cost.cards.length === 1 && cost.cards[0] === 'the-author',
    `cheapest counter: ${cost && cost.cards.join('+')}, paper: the Author alone`);
  const mcost = C.specialCost(['the-author', 'the-soldier', 'the-watchman'], 'mirror');
  check(mcost && mcost.cards.length === 1 && mcost.cards[0] === 'the-watchman',
    `cheapest mirror: ${mcost && mcost.cards.join('+')}, paper: the Watchman alone`);
  check(C.specialCost(['the-desert'], 'counter') === null, 'no cover, no cost');

  // Counter Spell stops everything on you — including your own Heal (the
  // wiki says so) — but the physical Hit still lands (also the wiki).
  let st = spellTurn({
    you: { hp: 8, hand: ['the-forest', 'the-author'] },
    foe: { hp: 12, hand: ['the-island'] },
  }, { you: ['the-forest'], foe: ['the-island'], youSpecial: 'counter', energies: { moons: 'leaves' } });
  check(st.log.some((l) => l.includes('stopped by Counter Spell')), 'the heal is stopped');
  check(st.you.hp === 7,
    `counter blocks the heal, the rival's physical Hit still lands: you at ${st.you.hp}, paper: 7`);
  check(!st.you.hand.includes('the-author') && st.discard.includes('the-author'),
    'the counter is paid for with hand cards');
  checkShape(st, 'after counter');

  st = spellTurn({
    you: { hp: 8, hand: ['the-battle', 'the-author'] },
    foe: { hp: 12, hand: ['the-island'] },
  }, { you: ['the-battle'], foe: ['the-island'], youSpecial: 'counter', energies: { daemons: '' } });
  check(st.you.hp === 7 && st.foe.hp === 11,
    `Hit ignores Counter Spell (you ${st.you.hp}, rival ${st.foe.hp}; paper 7/11)`);
}

{
  // Magic Mirror sends the rival's Fire Ball back at it: the reflected spell
  // lands on the rival (3 Suns showing on its side of the table).
  let st = spellTurn({
    you: { hp: 8, seq: [{ id: 'the-pact', down: false }], hand: ['the-forest', 'the-author', 'the-desert'] },
    foe: {
      hp: 8, seq: [{ id: 'ace-of-suns', down: false }, { id: 'the-bard', down: false }],
      hand: ['the-island'],
    },
  }, { you: ['the-forest'], foe: ['the-island'], youSpecial: 'mirror', energies: { moons: '' } });
  check(st.log.some((l) => l.includes('Magic Mirror')), 'the mirror is cast');
  check(st.foe.hp === 5, `reflected Fire Ball: rival at ${st.foe.hp}, paper: 5 (three Suns)`);

  // The same reflection from the other side: the RIVAL mirrors, so your own
  // Fire Ball is sent back at you — and stopped by your Resist Heat, exactly
  // as the wiki's parenthetical promises.
  st = spellTurn({
    you: {
      hp: 8, seq: [{ id: 'the-pact', down: false }],
      status: [{ name: 'resist-heat', turns: 2, pending: false }],
      hand: ['the-desert', 'the-author', 'the-soldier'],
    },
    foe: { hp: 12, seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-island', 'the-author', 'the-soldier'] },
  }, { you: ['the-desert'], foe: ['the-island'], foeSpecial: 'mirror', energies: { daemons: 'suns' } });
  check(st.log.some((l) => l.includes('Magic Mirror')), 'the rival mirrors');
  check(st.you.hp === 7, `your Fire Ball was mirrored back at you and stopped by your Resist Heat — but the physical Hit still lands: you at ${st.you.hp}, paper: 7`);
  check(st.foe.hp === 12, `the rival takes nothing from your mirrored spell: ${st.foe.hp}, paper: 12`);
}

{
  // Invisibility: the rival cannot be targeted at all.
  const st = spellTurn({
    you: { seq: [{ id: 'ace-of-suns', down: false }], hand: ['the-desert'] },
    foe: { status: [{ name: 'invisible', turns: 2, pending: false }], hand: ['the-discovery'] },
  }, { you: ['the-desert'], foe: ['the-discovery'], energies: { daemons: 'suns' } });
  check(st.foe.hp === 12, 'an invisible rival cannot be targeted');
  check(st.log.some((l) => l.includes('invisible')), 'the log says the spell found no target');
}

/* ------------------------------------------------------------- haste */

{
  const st = mkState({
    you: { hp: 8, status: [{ name: 'haste', turns: 2, pending: false }], hand: ['the-battle', 'the-market', 'ace-of-moons'] },
    foe: { hand: ['the-discovery'] },
  });
  check(C.playNeed(st, 'you') === 2, 'a hasted mage must play two cards');
  check(C.playNeed({ ...st, you: { ...st.you, hand: ['the-battle'] } }, 'you') === 1,
    'with only one card in hand there is nothing to haste into');

  const r = C.reveal(st, { you: ['the-battle', 'the-market'], youSpecial: null });
  check(r.pending.you.length === 2, 'both cards are revealed');
  const out = C.resolveTurn(r, plan(['the-battle', 'the-market'], { daemons: '', crowns: '' }, { crowns: '' }));
  check(out.log.some((l) => l.includes('hasted')), 'the log announces the extra mini-turn');
  check(out.you.seq.some((e) => e.id === 'the-battle') && out.you.seq.some((e) => e.id === 'the-market'),
    'both revealed cards landed in the sequence');
  checkShape(out, 'after a hasted turn');
}

/* ------------------------------------------------- confusion: draw + redraw */

{
  const st = mkState({
    you: { status: [{ name: 'confusion', turns: 1, pending: false }], hand: ['the-battle', 'the-market'] },
    foe: { hand: ['the-discovery'] },
  });
  throws(() => C.reveal(st, { you: ['the-battle'] }), 'revealing while confused without drawing');
  throws(() => C.confusedDraw(mkState({}), 1), 'drawing while not confused');

  const d1 = C.confusedDraw(st, 1);
  check(d1.confused && !d1.confused.redrawn && d1.confused.card, 'the first random draw');
  check(!d1.you.hand.includes(d1.confused.card), 'the drawn card is the play, not a hand card');
  check(d1.deck.length === st.deck.length - 1, 'one card off the deck');
  throws(() => C.confusedDraw(d1, 1), 'a second first-draw');

  const d2 = C.confusedDraw(d1, 2);
  check(d2.confused.redrawn, 'the redraw');
  check(d2.you.hand.length === st.you.hand.length + 1, 'the first card goes to the hand (there was room)');
  throws(() => C.confusedDraw(d2, 2), 'only one redraw');

  const r = C.reveal(d2, { you: [d2.confused.card], youSpecial: null });
  check(r.pending.you.join() === d2.confused.card, 'the confused card is what you play');
  const out = C.resolveTurn(r, plan([d2.confused.card], {}));
  check(!out.confused && !out.you.status.some((s) => s.name === 'confusion'),
    'confusion clears itself after the turn');
  checkShape(out, 'after a confused turn');

  // The rival is confused too: reveal draws its card from the deck.
  const foeSt = mkState({
    you: { hand: ['the-battle'] },
    foe: { status: [{ name: 'confusion', turns: 1, pending: false }], hand: ['the-discovery'] },
  });
  const rr = C.reveal(foeSt, { you: [foeSt.you.hand[0]], youSpecial: null });
  check(rr.pending.foe.length === 1 && !rr.pending.foe.includes('the-discovery'),
    `the confused rival plays a random draw (${rr.pending.foe})`);
  const oo = C.resolveTurn(rr, plan(rr.pending.you, {}));
  checkShape(oo, 'after the rival was confused');
}

/* ------------------------------------------- the Excuse recycles the decks */

{
  const st = mkState({
    you: { hand: ['the-battle', 'the-market', 'the-pact'] },
    foe: { hand: ['the-discovery'] },
    deck: ['the-excuse'],
    discard: ['ace-of-moons', 'the-sailor', 'the-end'],
  });
  const before = structuredClone(st);
  const r = C.reveal(st, { you: ['the-battle'], youSpecial: null });
  const out = C.resolveTurn(r, plan(['the-battle'], { daemons: '', crowns: '' }));
  sameCards(before, out, 'after the Excuse cycles');
  check(out.deck.indexOf('the-excuse') === Math.floor(out.deck.length / 2),
    `the Excuse sits in the middle of the new deck (${out.deck.indexOf('the-excuse')} of ${out.deck.length})`);
  check(out.discard.length === 0, 'the discard was shuffled into the new deck');
  check(out.you.hand.length === 4, `the draws came from the new deck: you hold ${out.you.hand.length}, paper: 4`);
  checkShape(out, 'after the Excuse cycled');
}

/* ------------------------------------------------ end-of-turn bookkeeping */

{
  // draw up to 2, hand capped at 5, sequence trimmed to 3 (oldest to the
  // discard), statuses ticked once, turn advanced.
  const st = mkState({
    you: {
      hp: 8, hand: ['the-battle'],
      seq: [{ id: 'the-sailor', down: false }, { id: 'the-forest', down: false }, { id: 'the-pact', down: false }],
      status: [{ name: 'resist-cold', turns: 3, pending: false }],
    },
    foe: { hp: 12, hand: ['the-discovery'], seq: [{ id: 'the-desert', down: false }] },
    deck: ['ace-of-moons', 'ace-of-suns', 'the-mountain', 'the-sea'],
  });
  const before = structuredClone(st);
  const r = C.reveal(st, { you: ['the-battle'], youSpecial: null });
  check(r.you.seq.length === 4, 'the sequence reaches 4 cards the moment you play');
  const out = C.resolveTurn(r, plan(['the-battle'], { daemons: '', crowns: '' }));
  sameCards(before, out, 'after upkeep');
  check(out.you.seq.length === 3, `trimmed to 3 (${out.you.seq.length})`);
  check(out.discard.includes('the-sailor'), 'the oldest card went to the discard, not the void');
  check(out.you.hand.length === 2 && out.foe.hand.length === 2,
    `each drew up to 2: you ${out.you.hand.length}, rival ${out.foe.hand.length}, paper: 2/2`);
  const resist = out.you.status.find((s) => s.name === 'resist-cold');
  check(resist && resist.turns === 2, `statuses tick once (${resist && resist.turns}, paper: 2)`);
  check(out.turn === 4 && out.phase === 'choose', 'the next turn begins');
  checkShape(out, 'after upkeep');
}

/* --------------------------------------------------------- illegal moves */

{
  const hand = ['the-battle', 'the-market', 'the-pact'];
  const base = () => mkState({
    you: { hand: hand.slice(), seq: [] },
    foe: { hand: ['the-discovery'] },
  });

  throws(() => C.reveal(base(), { you: ['the-battle', 'the-market'] }), 'two cards without Haste');
  const hasty = () => mkState({
    you: { hand: hand.slice(), status: [{ name: 'haste', turns: 2, pending: false }] },
    foe: { hand: ['the-discovery'] },
  });
  throws(() => C.reveal(hasty(), { you: ['the-battle'] }), 'one card while Hasted asks for two');
  throws(() => C.reveal(base(), { you: [] }), 'playing no card at all');
  throws(() => C.reveal(base(), { you: ['the-battle', 'the-market'] }), 'two cards without Haste');
  throws(() => C.reveal(base(), { you: ['the-battle', 'the-battle'] }), 'the same card twice');
  throws(() => C.reveal(base(), { you: ['ace-of-suns'] }), 'a card you do not hold');
  throws(() => C.reveal(base(), { you: ['the-battle'], youSpecial: 'nonsense' }), 'an unknown special');
  throws(() => C.reveal(base(), { you: ['the-battle'], youSpecial: 'mirror' }),
    'a mirror your hand cannot pay for');

  const choose = mkState({ you: { hand: ['the-battle'] }, foe: { hand: ['the-discovery'] } });
  const revealed = C.reveal(choose, { you: ['the-battle'] });
  throws(() => C.reveal(revealed, { you: ['the-market'] }), 'revealing twice');

  throws(() => C.resolveTurn(choose, [[]]), 'resolving before anything is revealed');
  throws(() => C.resolveTurn({ ...revealed, over: 'won' }, [[]]), 'resolving a finished game');

  const good = plan(['the-battle'], { daemons: '', crowns: '' });
  throws(() => C.resolveTurn(revealed, []), 'a plan with no rows');
  throws(() => C.resolveTurn(revealed, [[]]), 'a plan that skips an activation rune');
  throws(() => C.resolveTurn(revealed, [[{ act: 'moons', energy: '' }]]),
    'an activation rune the card does not show');
  throws(() => C.resolveTurn(revealed,
    [[{ act: 'daemons', energy: 'suns' }, { act: 'crowns', energy: 'suns' }]]),
  'the same rune type powering two spells');
  throws(() => C.resolveTurn(revealed,
    [[{ act: 'daemons', energy: 'waves' }, { act: 'crowns', energy: '' }]]),
  'energy that is not in the sequence');

  const ok = C.resolveTurn(revealed, good);
  check(ok.phase === 'choose', 'the good plan resolves');
}

{
  // A mage with no cards left ends the duel undecided rather than crashing.
  const st = mkState({ you: { hand: [] }, foe: { hand: ['the-discovery'] } });
  const out = C.reveal(st, { you: [] });
  check(out.over === 'stalemate' && out.phase === null, `no cards: over=${out.over}`);
}

/* ------------------------------------------------------------- the AI */

{
  for (let seed = 1; seed <= 60; seed++) {
    const st = C.newGame(seed, ALL, {});
    const a = C.foePlan(st);
    const b = C.foePlan(structuredClone(st));
    check(JSON.stringify(a) === JSON.stringify(b), `seed ${seed}: foePlan is not deterministic`);
    const c = C.foePlan(JSON.parse(JSON.stringify(st)));
    check(JSON.stringify(a) === JSON.stringify(c), `seed ${seed}: foePlan changes across a JSON round trip`);
    check(a.cards.length === 1, `seed ${seed}: one card revealed`);
    check(new Set(a.cards).size === a.cards.length, `seed ${seed}: duplicate cards`);
    for (const id of a.cards) check(st.foe.hand.includes(id), `seed ${seed}: ${id} is not in the rival's hand`);
    check(['counter', 'mirror', null].includes(a.special), `seed ${seed}: odd special ${a.special}`);
    if (a.special) {
      const rest = st.foe.hand.filter((id) => !a.cards.includes(id));
      check(C.specialEligible(rest, a.special), `seed ${seed}: rival wants ${a.special} it cannot pay for`);
      check(C.specialCost(rest, a.special).cards.length > 0, `seed ${seed}: and no cover exists`);
    }
  }

  // policy shape, straight from the wiki's brackets
  const hurt = mkState({
    you: { seq: [], hand: [] },
    foe: { hp: 3, hand: ['the-forest', 'the-desert', 'ace-of-suns'] },
  });
  const hp3 = C.foePlan(hurt);
  check(hp3.special === null || hp3.special === 'counter', `at 3 HP the rival ${hp3.special}s`);
  check(hp3.cards.includes('the-forest'),
    `at 3 HP it grabs the healer, got ${hp3.cards}`);

  const rich = mkState({
    foe: { hp: 12, hand: ['the-desert', 'the-cave', 'the-forest'] },
  });
  const hp12 = C.foePlan(rich);
  check(hp12.special === null, 'at 12 HP the rival hoards its hand');
  check(hp12.cards.includes('the-desert') || hp12.cards.includes('the-cave'),
    `at full health it reaches for a Wyrm card, got ${hp12.cards}`);
}

/* --------------------------------------------------- full random playouts */

let won = 0, lost = 0, drawn = 0, stalled = 0, turnsTotal = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, ALL, { playerHp: 8 });
  const rng = mulberry32Local(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 400) {
    let cards;
    if (C.anyStatus(st, 'you', 'confusion')) {
      st = C.confusedDraw(st, 1);
      if (rng() < 0.5) st = C.confusedDraw(st, 2);
      cards = [st.confused.card];
    } else {
      const need = C.playNeed(st, 'you');
      const ranked = st.you.hand
        .map((id) => ({ id, v: C.activationsOf(id).length + rng() * 0.5 }))
        .sort((a, b) => b.v - a.v);
      cards = ranked.slice(0, need).map((r) => r.id);
    }
    let youSpecial = null;
    if (st.you.hp <= 6 && rng() < 0.2) {
      const rest = st.you.hand.filter((id) => !cards.includes(id));
      if (C.specialEligible(rest, 'counter')) youSpecial = 'counter';
    }
    const reveal = C.reveal(st, { you: cards, youSpecial });
    const planed = C.bestPlan(reveal, reveal.pending.you);
    st = C.resolveTurn(reveal, planed);
    conserved(st, `seed ${seed} turn ${st.turn}`);
    checkShape(st, `seed ${seed} turn ${st.turn}`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.log.length === st.log.length, `seed ${seed}: JSON round trip`);
  }
  if (!st.over) {
    stalled++;
    check(false, `seed ${seed}: still going after ${guard} turns`);
  } else {
    turnsTotal += st.turn;
    if (st.over === 'won') won++;
    else if (st.over === 'lost') lost++;
    else if (st.over === 'draw') drawn++;
    else check(false, `seed ${seed}: odd outcome ${st.over}`);
  }
}
console.log(`random playouts: ${won} won, ${lost} lost, ${drawn} drawn, ` +
  `average length ${(turnsTotal / Math.max(1, 300 - stalled)).toFixed(1)} turns`);
check(won + lost + drawn === 300, `${stalled} of 300 duels failed to finish`);
check(drawn < 10, `too many draws (${drawn})`);

function mulberry32Local(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log(failures === 0 ? 'dueling-runes: all tests passed' : `dueling-runes: ${failures} failures`);
process.exit(failures ? 1 : 0);

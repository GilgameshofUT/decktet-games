// Headless tests for Fifes & Drums: node test/fifes-and-drums.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/fifes-and-drums-core.js');
C.init(byId);

const ALL45 = [...manifest.basicDeck, ...manifest.extendedDeck];
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throwsWith = (fn, needle, label) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  check(msg != null, `${label}: should throw`);
  if (msg != null) {
    check(msg.includes(needle),
      `${label}: error "${msg}" should mention "${needle}"`);
  }
};
const find = (rank, suits) => ALL45.find((id) => byId[id].rank === rank &&
  suits.every((s) => byId[id].suits.includes(s)));

const allCards = (st) => [
  ...st.goals, ...st.aside, ...st.pool.filter(Boolean), ...st.draw, ...st.discard,
];
const conserved = (st, label) => {
  const all = allCards(st);
  if (all.length !== 45) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 45) check(false, `${label}: duplicate or missing card`);
};

/** An independent scorer: value of a unit = tokens strictly behind it. */
function independentScores(st) {
  const ordered = C.SUITS.map((s) => ({ s, p: st.pos[s] })).sort((a, b) => a.p - b.p);
  const value = {};
  ordered.forEach((e, i) => {
    value[e.s] = ordered.slice(0, i).filter((x) => x.p < e.p).length;
  });
  const sum = (p) => byId[st.goals[p]].suits.reduce((t, s) => t + value[s], 0);
  return [sum(0), sum(1)];
}

/* ---- setup ---- */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, ALL45);
  check(st.pool.length === 5 && st.draw.length === 32, `seed ${seed}: pool/draw ${st.pool.length}/${st.draw.length}`);
  check(st.goals.length === 2 && st.aside.length === 6, `seed ${seed}: goal/aside sizes`);
  check(st.goals[0] !== st.goals[1], `seed ${seed}: identical goal cards`);
  const units = [...st.goals, ...st.aside].sort();
  const allUnits = ALL45.filter((id) => ['pawn', 'court'].includes(byId[id].rank)).sort();
  check(JSON.stringify(units) === JSON.stringify(allUnits), `seed ${seed}: the 8 Pawns/Courts split wrongly`);
  check([...st.goals, ...st.aside].every((id) => byId[id].suits.length === 3),
    `seed ${seed}: goal cards must carry three suits`);
  check(!st.pool.includes(C.EXCUSE) && !st.aside.includes(C.EXCUSE) && !st.goals.includes(C.EXCUSE),
    `seed ${seed}: the Excuse is not in play at setup`);
  check(st.draw.filter((id) => id === C.EXCUSE).length === 1, `seed ${seed}: the Excuse is in the draw pile`);
  check(st.draw.slice(0, 6).includes(C.EXCUSE), `seed ${seed}: the Excuse sits on the bottom six`);
  check(C.SUITS.every((s) => st.pos[s] === 0), `seed ${seed}: units must start on space 1`);
  check(st.turn === 0 && st.over === null, `seed ${seed}: turn/over`);
  conserved(st, `seed ${seed}`);
  // determinism
  const again = C.newGame(seed, ALL45);
  check(JSON.stringify(again) === JSON.stringify(st), `seed ${seed}: newGame is not deterministic`);
}
{
  const a = JSON.stringify(C.newGame(1, ALL45).pos);
  const b = JSON.stringify(C.newGame(2, ALL45).pos);
  check(a === b, 'positions are identical for every seed (fine) — sanity only');
  check(JSON.stringify(C.newGame(1, ALL45).pool) !== JSON.stringify(C.newGame(2, ALL45).pool),
    'different seeds should give different pools');
}

/* ---- a plain number order ---- */
{
  const g1 = 'the-watchman', g2 = 'the-consul';
  const st = {
    seed: 9, moves: 0, goals: [g1, g2], aside: [],
    pos: { moons: 0, suns: 0, waves: 0, leaves: 0, daemons: 0, crowns: 0 },
    pool: ['the-mountain', 'the-betrayal', 'ace-of-moons', 'the-calamity', 'the-market'],
    draw: ['the-excuse', 'the-forest'],       // top of the pile is the end
    discard: [], turn: 0, over: null, winner: null,
  };
  const mountain = find(4, ['moons', 'suns']);
  check(st.pool[0] === mountain, 'the Mountain is the first pool card');
  const next = C.play(st, 0, { splits: { moons: 1, suns: 3 } });
  check(next.pos.moons === 1 && next.pos.suns === 3, `mountain moves: ${next.pos.moons}/${next.pos.suns}`);
  check(next.turn === 1, 'the turn passes');
  check(next.pool.length === 5 && next.pool.includes('the-forest'), 'the pool is refilled');
  check(next.discard.join() === 'the-mountain', 'the played order is discarded');
  check(next.draw.join() === 'the-excuse', 'one card left under the Excuse');
  check(next.moves === 1, 'the move counter ticks');
  check(st.pos.moons === 0 && st.pool.length === 5, 'the original state is untouched');

  // a number order with an empty split, wrong sums and stray suits all throw
  throwsWith(() => C.play(st, 5, {}), 'pool slot 6 is empty', 'pool index out of range');
  throwsWith(() => C.play(st, 2, {}), 'choose a direction', 'ace without direction');
  throwsWith(() => C.play(st, 0, { splits: { moons: 2, suns: 1 } }), '4 spaces in total', 'wrong total');
  throwsWith(() => C.play(st, 0, { splits: { moons: 4, suns: 0 } }), 'at least one space', 'zero move');
  throwsWith(() => C.play(st, 0, { splits: { waves: 2, suns: 2 } }), 'no Waves unit', 'stray suit');
  throwsWith(() => C.play({ ...st, over: 'end' }, 0, { splits: { moons: 2, suns: 2 } }),
    'the Excuse has been drawn', 'playing after the game is over');
}

/* ---- charged units: a Crown in the pool flips a suit backwards ---- */
{
  const st = {
    seed: 10, moves: 0, goals: ['the-watchman', 'the-consul'], aside: [],
    pos: { moons: 0, suns: 0, waves: 0, leaves: 0, daemons: 10, crowns: 1 },
    pool: ['the-mountain', 'the-betrayal', 'ace-of-moons', 'the-calamity', 'the-market'],
    draw: ['the-excuse', 'the-forest'],
    discard: [], turn: 0, over: null, winner: null,
  };
  check(C.chargedSuits(st.pool).join() === 'daemons', 'the Crown of Daemons charges Daemons');
  const next = C.play(st, 1, { splits: { daemons: 3, crowns: 5 } });
  check(next.pos.daemons === 7, `charged unit retreats toward the enemy: ${next.pos.daemons}`);
  check(next.pos.crowns === 6, 'the uncharged unit still retreats up the track');

  // both suits charged at once
  const both = {
    ...st,
    pos: { moons: 0, suns: 0, waves: 0, leaves: 0, daemons: 10, crowns: 1 },
    pool: ['the-calamity', 'the-windfall', 'the-market', 'the-mountain', 'the-betrayal'],
  };
  check(C.chargedSuits(both.pool).sort().join() === 'crowns,daemons', 'two charges in the pool');
  const b2 = C.play(both, 2, { splits: { leaves: 2, crowns: 4 } });
  check(b2.pos.leaves === 2 && b2.pos.crowns === 0, `both-charged play: ${b2.pos.leaves}/${b2.pos.crowns}`);
  // …and the clamps hold
  const clamp = C.play({
    ...both,
    pos: { moons: 44, suns: 0, waves: 0, leaves: 0, daemons: 10, crowns: 1 },
  }, 3, { splits: { moons: 1, suns: 3 } });
  check(clamp.pos.moons === 44, `a retreat stops on space 45: ${clamp.pos.moons}`);
  const startClamp = C.play({
    ...both,
    pos: { moons: 0, suns: 0, waves: 0, leaves: 0, daemons: 2, crowns: 1 },
  }, 4, { splits: { daemons: 5, crowns: 3 } });   // the Betrayal, Daemons charged
  check(startClamp.pos.daemons === 0, `a charge stops on space 1: ${startClamp.pos.daemons}`);
}

/* ---- Aces: forced marches ---- */
{
  const base = {
    seed: 11, moves: 0, goals: ['the-watchman', 'the-consul'], aside: [],
    pos: { moons: 5, suns: 0, waves: 2, leaves: 9, daemons: 9, crowns: 3 },
    pool: ['ace-of-moons', 'the-mountain', 'the-betrayal', 'the-calamity', 'the-market'],
    draw: ['the-excuse', 'the-forest'],
    discard: [], turn: 0, over: null, winner: null,
  };
  const fwd = C.play(base, 0, { direction: 'forward' });
  check(fwd.pos.moons === 9, `march forward lands on the nearest contact: ${fwd.pos.moons}`);
  const back = C.play(base, 0, { direction: 'backward' });
  check(back.pos.moons === 3, `charge back lands on the nearest contact: ${back.pos.moons}`);

  const alone = { ...base, pos: { ...base.pos, moons: 12 } };
  const oneUp = C.play(alone, 0, { direction: 'forward' });
  check(oneUp.pos.moons === 13, `no contact ahead: march one space (${oneUp.pos.moons})`);

  // a Crown plays like a backward march, no direction asked
  const crownSt = {
    ...base,
    pos: { moons: 6, suns: 1, waves: 2, leaves: 9, daemons: 9, crowns: 3 },
    pool: ['the-huntress', 'the-mountain', 'the-betrayal', 'the-calamity', 'the-market'],
  };
  const ch = C.play(crownSt, 0, {});
  check(ch.pos.moons === 3, `the Crown charges back to contact: ${ch.pos.moons}`);
  check(ch.turn === 1 && ch.discard.join() === 'the-huntress', 'the Crown is discarded');
}

/* ---- scoring on paper ---- */
{
  const st = {
    seed: 12, moves: 0, aside: [], goals: ['the-rite', 'the-consul'],
    pos: { moons: 3, suns: 3, waves: 5, leaves: 8, daemons: 12, crowns: 0 },
    pool: ['the-mountain', 'the-betrayal', 'ace-of-moons', 'the-calamity', 'the-market'],
    draw: [C.EXCUSE], discard: [], turn: 0, over: 'end', winner: null,
  };
  const v = C.unitValues(st);
  check(v.crowns === 0 && v.moons === 1 && v.suns === 1 && v.waves === 3 &&
    v.leaves === 4 && v.daemons === 5, `unit values: ${JSON.stringify(v)}`);
  // the-rite = Moons 1 + Leaves 4 + Daemons 5 = 10; the-consul = Moons 1 + Waves 3 + Crowns 0 = 4
  check(C.finalScores(st).join() === '10,4', `scores ${C.finalScores(st)}`);
  check(C.winnerOf(st) === 0, 'Player 1 wins 10 to 4');
  check(JSON.stringify(independentScores(st)) === JSON.stringify(C.finalScores(st)),
    'the independent scorer agrees');

  // tokens in the same space share the lower value
  const tie = { ...st, pos: Object.fromEntries(C.SUITS.map((s) => [s, 5])) };
  check(C.finalScores(tie).join() === '0,0', `all six tied at the start: ${C.finalScores(tie)}`);
  check(C.winnerOf(tie) === 'draw', 'a level field is a draw');
}

/* ---- the Excuse ends the game and the reveal is scored on paper ---- */
{
  const st = {
    seed: 13, moves: 0, aside: [], goals: ['the-window', 'the-harvest'],
    pos: { moons: 10, suns: 4, waves: 0, leaves: 4, daemons: 7, crowns: 8 },
    pool: ['the-mountain', 'the-betrayal', 'ace-of-moons', 'the-calamity', 'the-market'],
    draw: [C.EXCUSE],
    discard: [], turn: 0, over: null, winner: null,
  };
  const next = C.play(st, 0, { splits: { moons: 1, suns: 3 } });
  check(next.over === 'end', 'the game ends when the Excuse is flipped');
  check(next.discard.join() === 'the-mountain,the-excuse', 'the Excuse joins the discard');
  check(next.pos.moons === 11 && next.pos.suns === 7, 'the last order still takes effect');
  // after the move: Waves 0, Leaves 1, Daemons 2, Suns 2, Crowns 4, Moons 5
  // the-window  = Suns 2 + Leaves 1 + Crowns 4 = 7
  // the-harvest = Moons 5 + Suns 2 + Leaves 1  = 8
  check(C.finalScores(next).join() === '7,8', `scores ${C.finalScores(next)}`);
  check(next.winner === 1, `winner ${next.winner}`);
  check(JSON.stringify(independentScores(next)) === JSON.stringify(C.finalScores(next)),
    'the independent scorer agrees after the Excuse');
}

/* ---- random games to the Excuse ---- */
let games = 0, plays = 0, wins = [0, 0, 0], lastWinner = null;
for (let seed = 1; seed <= 50; seed++) {
  let st = C.newGame(seed, ALL45);
  const rng = mulberry32(seed * 131 + 17);
  let guard = 0;
  while (!st.over && guard++ < 80) {
    const index = Math.floor(rng() * st.pool.length);
    const c = byId[st.pool[index]];
    let plan;
    if (c.rank === 1) {
      plan = { direction: rng() < 0.5 ? 'forward' : 'backward' };
    } else if (typeof c.rank === 'number') {
      const v = 1 + Math.floor(rng() * (c.rank - 1));
      plan = { splits: { [c.suits[0]]: v, [c.suits[1]]: c.rank - v } };
    } else {
      plan = {};
    }
    const next = C.play(st, index, plan);
    conserved(next, `seed ${seed} move ${guard}`);
    check(next.moves === st.moves + 1, `seed ${seed}: move counter`);
    st = next;
    plays++;
  }
  check(st.over === 'end', `seed ${seed}: game never ended (guard ${guard})`);
  check(st.discard.includes(C.EXCUSE), `seed ${seed}: the Excuse was not drawn`);
  check(guard >= 27 && guard <= 32, `seed ${seed}: ${guard} plays — expected 27..32`);
  check(['draw', 0, 1].includes(st.winner), `seed ${seed}: winner ${st.winner}`);
  check(JSON.stringify(independentScores(st)) === JSON.stringify(C.finalScores(st)),
    `seed ${seed}: independent scoring disagrees`);
  games++;
  wins[st.winner === 'draw' ? 2 : st.winner]++;
  lastWinner = st.winner;
}
check(plays > 1000, `only ${plays} plays across ${games} games`);

console.log(`random games: ${games} finished in ${plays} plays ` +
  `(${(plays / games).toFixed(1)} per game), winners P1 ${wins[0]} / P2 ${wins[1]} / draws ${wins[2]} ` +
  `(last: ${lastWinner})`);
console.log(failures === 0
  ? 'fifes-and-drums: all tests passed'
  : `fifes-and-drums: ${failures} failures`);
process.exit(failures ? 1 : 0);

// Headless tests for Chancellors: node test/chancellors.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/chancellors-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
const SERVICE_IDS = ['the-diplomat', 'the-soldier', 'the-sailor'];
const POOL = BASIC.filter((id) => !SERVICE_IDS.includes(id));   // the 33 movable cards
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

const MOVING = 33;   // 36 less the three service cards

function checkState(st, label) {
  const all = C.allCards(st);
  if (all.length !== MOVING) { check(false, `${label}: ${all.length} moving cards`); return; }
  if (new Set(all).size !== MOVING) check(false, `${label}: duplicate or missing card`);
  const everything = [...all, ...st.services.map((s) => s.id)];
  if (new Set(everything).size !== 36) check(false, `${label}: not exactly 36 cards`);
  for (const prob of st.problems) {
    if (!prob.dice.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)) {
      check(false, `${label}: die out of range ${prob.dice}`);
    }
    if (!['open', 'partial', 'solved'].includes(prob.status)) {
      check(false, `${label}: bad problem status ${prob.status}`);
    }
    if (prob.status === 'partial' && ![0, 1].includes(prob.keep)) {
      check(false, `${label}: partial problem without a keep die`);
    }
  }
  if (!st.scores.every((s) => Number.isInteger(s) && s >= 0)) check(false, `${label}: bad scores`);
  if (st.phase === 'control' && st.hands.some((h) => h.length > C.HAND_CAP)) {
    check(false, `${label}: hand over the cap outside the trim phase`);
  }
  if (st.over && !['score', 'catastrophe'].includes(st.over)) check(false, `${label}: bad over ${st.over}`);
}

/* ------------------------------------------------------------------ setup */

for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 3 && st.hands[1].length === 3,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.draw.length === 27, `seed ${seed}: draw ${st.draw.length}`);
  check(st.problems.length === 3 && st.problems.every((p) => p.status === 'open'),
    `seed ${seed}: problems`);
  check(st.services.every((s) => s.holder === null), `seed ${seed}: a service starts held`);
  check(st.phase === 'control' && st.turn === 1 && st.scores[0] === 0,
    `seed ${seed}: phase/turn/score`);
  check(C.actor(st) === 0, `seed ${seed}: first controller is Player 1`);
  checkState(st, `seed ${seed}`);
  const st2 = C.newGame(seed, BASIC);
  check(JSON.stringify(st2) === JSON.stringify(st), `seed ${seed}: setup is not deterministic`);
}

/* ---- 300 seeds: a few random legal moves each, conservation throughout ---- */
{
  let played = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let st = C.newGame(seed, BASIC);
    const rng = mulberry32(seed * 13 + 1);
    for (let i = 0; i < 8; i++) {
      const acts = C.legalActions(st);
      if (!acts.length || st.over) break;
      st = C.applyMove(st, acts[Math.floor(rng() * acts.length)]);
      checkState(st, `seed ${seed} move ${i}`);
      played++;
    }
  }
  check(played > 2000, `only ${played} moves across the seed sweep`);
}

/* ------------------------------------------------- controlling the services */

{
  let st = C.newGame(5, BASIC);
  const pact = named('the Pact');                 // 9 of Moons and Suns
  st.hands = [[pact], [named('the Mountain')]];   // 4 of Moons and Suns
  st = C.selectControl(st, pact);
  check(C.actor(st) === 1 && st.hands[0].length === 0, 'Player 1 played secretly');
  st = C.selectControl(st, named('the Mountain'));
  check(st.phase === 'reveal', 'both picks resolve into the reveal');
  check(st.services[0].holder === 0, 'the higher matching card takes the Diplomatic corps');
  check(st.services[1].holder === null && st.services[2].holder === null, 'the other services stay put');
  check(st.discard.length === 2, 'played control cards are discarded');

  throws(() => C.selectControl(st, pact), 'control phase');           // wrong phase now
  throws(() => C.endReveal({ ...st, phase: 'control' }), 'reveal phase');

  // a bid only counts for the services whose suits it matches
  st = C.newGame(6, BASIC);
  st.hands = [[named('the Cave')], [named('the Battle')]];    // 7 waves+daemons / 4 daemons+crowns
  st = C.selectControl(st, st.hands[0][0]);
  st = C.selectControl(st, st.hands[1][0]);
  check(st.services[0].holder === null, 'no moons/suns bid: the corps stays put');
  check(st.services[1].holder === 0, 'the 7 takes the Army on rank');
  check(st.services[2].holder === 0, 'the Cave waves also reaches the Navy');

  // one two-suit card can take two services
  st = C.newGame(7, BASIC);
  const desert = named('the Desert');            // 2 of Suns and Daemons
  st.hands = [[desert], [named('the Pact')]];    // 9 moons+suns only contests the corps
  st = C.selectControl(st, desert);
  st = C.selectControl(st, named('the Pact'));
  check(st.services[0].holder === 1, 'the 9 beats the 2 on the corps');
  check(st.services[1].holder === 0, 'the desert also matches the Army and takes it');
  check(st.services[2].holder === null, 'no waves/leaves bid');

  // tie on rank: the lower score takes it; an exact dead heat leaves it in the middle
  st = C.newGame(8, BASIC);
  st.scores = [30, 20];
  st.hands = [[named('Ace of Moons')], [named('Ace of Suns')]];    // both rank 1, both match
  st = C.selectControl(st, st.hands[0][0]);
  st = C.selectControl(st, st.hands[1][0]);
  check(st.services[0].holder === 1, 'the lower score wins the tie');

  st = C.newGame(8, BASIC);
  st.scores = [30, 30];
  st.hands = [[named('Ace of Moons')], [named('Ace of Suns')]];
  st = C.selectControl(st, st.hands[0][0]);
  st = C.selectControl(st, st.hands[1][0]);
  check(st.services[0].holder === null, 'a dead heat leaves the corps in the middle');

  // keeping control: no matching bid, the holder keeps it
  st = C.newGame(9, BASIC);
  st.services[0].holder = 1;
  st.hands = [[named('the Cave')], [named('the Battle')]];   // no moons/suns bid
  st = C.selectControl(st, st.hands[0][0]);
  st = C.selectControl(st, st.hands[1][0]);
  check(st.services[0].holder === 1, 'an uncontested service stays with its holder');
  throws(() => C.selectControl(st, st.hands[0][0]), 'control phase');
}

/* ----------------------------------------------- the service queue and order */

{
  let st = C.newGame(10, BASIC);
  st.services[0].holder = 0;    // diplomat
  st.services[1].holder = 1;    // army
  st.services[2].holder = 0;    // navy
  st.phase = 'reveal';
  st = C.endReveal(st);
  check(st.phase === 'service', 'holders move into the service phase');
  check(st.queue.join() === 'diplomat,army,navy', `queue ${st.queue}`);
  check(C.actor(st) === 0, 'the Diplomat holder goes first');
  st = C.servicePass(st);
  check(C.actor(st) === 1, 'then the Army holder');
  st = C.servicePass(st);
  check(C.actor(st) === 0, 'the same player may act twice for two services');
  st = C.servicePass(st);
  check(st.phase === 'control' && st.turn === 2,
    'both players hold services, so no one solves without and the turn ends');

  // with a player holding nothing, they get the open phase after the services
  st = C.newGame(10, BASIC);
  st.services[0].holder = 1;
  st.services[1].holder = 1;
  st.phase = 'reveal';
  st = C.endReveal(st);
  st = C.servicePass(st);
  st = C.servicePass(st);
  check(st.phase === 'open' && C.actor(st) === 0,
    'after the services, the service-less player solves');

  // nobody controls anything: both players solve without help
  st = C.newGame(11, BASIC);
  st.phase = 'reveal';
  st = C.endReveal(st);
  check(st.phase === 'open' && st.openOrder.join() === '0,1', `open order ${st.openOrder}`);
  check(C.actor(st) === 0, 'with no solver yet, seat order');

  // the open order starts left of the player who most recently solved
  st = C.newGame(11, BASIC);
  st.lastSolver = 0;
  st.phase = 'reveal';
  st = C.endReveal(st);
  check(st.openOrder.join() === '1,0' && C.actor(st) === 1,
    `left of the last solver: ${st.openOrder}`);
}

/* ------------------------------------------------- solving with a service */

function svcFixture({ dice, hand, holder = 0, scores = [0, 0], holders = null }) {
  const st = C.newGame(12, BASIC);
  st.hands = [hand.slice(), [named('the Battle')]];
  st.problems = [{ dice: dice.slice(), status: 'open' }, ...st.problems.slice(1)];
  if (holders) holders.forEach((h, i) => { st.services[i].holder = h; });
  else st.services[0].holder = holder;
  st.scores = scores;
  st.phase = 'reveal';
  const keep = new Set([...st.hands[0], ...st.hands[1]]);
  st.draw = POOL.filter((id) => !keep.has(id));
  const nxt = C.endReveal(st);
  check(nxt.phase === 'service' && C.actor(nxt) === (holders ? holders.find((h) => h != null) : holder),
    'fixture starts in the service phase');
  return nxt;
}

{   // whole problems: both outcomes
  const pact = named('the Pact');                 // 9 of Moons and Suns
  let st = svcFixture({ dice: [5, 3], hand: [pact, named('the Journey'), named('the Bard'),
    named('the Cave')] });
  const solved = C.serviceSolveFull(st, 0, [pact]);
  check(solved.scores[0] === 8, `a solved 5+3 problem scores the dice sum 8, got ${solved.scores[0]}`);
  check(solved.problems[0].status === 'solved' && solved.problems[0].solver === 0, 'problem marked solved');
  check(solved.lastSolver === 0, 'lastSolver updates');
  check(solved.discard.includes(pact), 'solving cards are discarded');
  checkState(solved, 'after a full solve');

  throws(() => C.serviceSolveFull(st, 0, [named('the Cave')]), 'shares no suit');
  throws(() => C.serviceSolveFull(st, 0, [named('the Journey')]), 'at least 8');   // 3 moons+waves = 3
  throws(() => C.serviceSolveFull(st, 0, [pact, pact]), 'counted twice');
  throws(() => C.serviceSolveFull(st, 0, [named('the Desert')]), 'not in Player 1'); // suns matches

  // a Crown counts as the higher die, so two Crowns solve anything
  st = svcFixture({ dice: [6, 6], hand: [named('the Bard'), named('the Huntress')] });
  const crowns = C.serviceSolveFull(st, 0, [named('the Bard'), named('the Huntress')]);
  check(crowns.scores[0] === 12, `two Crowns solve 6+6 for 12, got ${crowns.scores[0]}`);

  st = svcFixture({ dice: [3, 2], hand: [named('the Bard')] });   // crown = 3, need 5
  throws(() => C.serviceSolveFull(st, 0, [named('the Bard')]), 'at least 5');
}

{   // part-solves: both outcomes
  const journey = named('the Journey');           // 3 of Moons and Waves
  let st = svcFixture({ dice: [5, 3], hand: [journey, named('the Pact'), named('the Bard')],
    holders: [0, 0] });                           // Player 1 also holds the Army
  const part = C.serviceSolvePart(st, 0, journey, 1);          // set aside the 3
  check(part.scores[0] === 4, `a part-solve of 5+3 scores ceil(8/2)=4, got ${part.scores[0]}`);
  check(part.problems[0].status === 'partial' && part.problems[0].keep === 0 &&
    part.problems[0].setAside === 3, 'the chosen die is set aside');
  check(part.phase === 'service', 'the next service still gets its chance');

  // the rest of a partly solved problem is locked for the turn — even for its solver
  throws(() => C.serviceSolvePart(part, 0, named('the Pact'), 0), 'locked');
  throws(() => C.serviceSolveFull(part, 0, [named('the Pact')]), 'locked');

  // value must not exceed the lower die; a Crown shows the higher die
  st = svcFixture({ dice: [5, 3], hand: [named('the Pact')] });
  throws(() => C.serviceSolvePart(st, 0, named('the Pact'), 0), 'lower die, 3');
  st = svcFixture({ dice: [4, 4], hand: [named('the Bard')] });  // crown = 4 ≤ 4: legal
  const even = C.serviceSolvePart(st, 0, named('the Bard'), 1);
  check(even.scores[0] === 4, 'a Crown may solve part when the dice match');
  st = svcFixture({ dice: [6, 4], hand: [named('the Bard')] });  // crown = 6 > 4
  throws(() => C.serviceSolvePart(st, 0, named('the Bard'), 0), 'lower die, 4');
}

{   // passing and abdicating
  const st = svcFixture({ dice: [4, 2], hand: [named('the Pact')] });
  const kept = C.servicePass(st, false);
  check(kept.services[0].holder === 0, 'passing keeps control');
  const gone = C.servicePass(st, true);
  check(gone.services[0].holder === null, 'abdication puts the card back in the middle');
  check(gone.over !== 'score' || gone.winner != null, 'the game moved on');
}

/* ------------------------------------------ solving without a service */

function openFixture({ dice, hands, lastSolver = null }) {
  const st = C.newGame(13, BASIC);
  st.hands = [hands[0].slice(), hands[1].slice()];
  st.problems = [{ dice: dice.slice(), status: 'open' }, ...st.problems.slice(1)];
  st.scores = [0, 0];
  st.lastSolver = lastSolver;
  st.phase = 'reveal';
  return C.endReveal(st);
}

{
  const pact = named('the Pact');                 // 9
  const merchant = named('the Merchant');         // 9 of Leaves and Crowns
  let st = openFixture({ dice: [5, 3], hands: [[pact, merchant], [named('the Cave')]] });
  check(st.phase === 'open' && C.actor(st) === 0, 'both players start without a service');
  const solved = C.openSolveFull(st, 0, [pact, merchant]);
  check(solved.scores[0] === 8, `the open solve still scores the dice sum, got ${solved.scores[0]}`);

  st = openFixture({ dice: [5, 3], hands: [[pact, merchant, named('the Cave')], []] });
  throws(() => C.openSolveFull(st, 0, [pact]), 'twice the dice');            // 9 < 16
  throws(() => C.openSolveFull(st, 0, [merchant]), 'twice the dice');        // 9 < 16

  // only problems nobody has touched this turn
  st = openFixture({ dice: [2, 2], hands: [[pact, merchant], []] });
  st = C.applyMove(st, { type: 'full', pi: 0, ids: [pact] });                // whole, 9 ≥ 4
  check(st.phase === 'open' && C.actor(st) === 1, 'the second player gets their chance');
  throws(() => C.openSolveFull(st, 0, [merchant]), 'already solved this turn');

  // …and only whole problems: a partly solved problem is locked
  st = openFixture({ dice: [5, 3], hands: [[named('the Journey'), pact], [merchant]] });
  st.problems[0] = { dice: [5, 3], status: 'partial', keep: 0, setAside: 3, solver: 1 };
  throws(() => C.openSolveFull(st, 0, [pact]), 'partly solved');
}

/* ------------------------------------------------------------ escalation */

{
  const st = C.newGame(14, BASIC);

  // 1. partial problems re-form from the rerolled set-aside die, then climb
  const reformed = structuredClone(st);
  reformed.problems[0] = { dice: [4, 3], status: 'partial', keep: 1, setAside: 4, solver: 0 };
  reformed.problems[1] = { dice: [4, 4], status: 'solved', solver: 1 };
  reformed.problems[2] = { dice: [1, 2], status: 'open' };
  reformed.phase = 'open';
  reformed.openOrder = [0, 1];
  reformed.openStep = 1;
  reformed.hands = [[], [named('the Pact')]];
  const next = C.openPass(reformed);                           // passes out: end of turn
  check(next.problems[0].status === 'open' && [3, 4].includes(next.problems[0].dice[1]),
    `the remaining die stays 3 or climbs to 4: ${next.problems[0].dice}`);
  check(next.problems[0].dice[0] >= 1 && next.problems[0].dice[0] <= 6,
    `the set-aside die was rerolled: ${next.problems[0].dice}`);
  check(next.problems[1].status === 'open' && next.problems[1].dice.length === 2,
    'a solved problem becomes a fresh problem that does not escalate');
  check(next.problems[2].dice.join() === '2,2', `the lower die escalates: ${next.problems[2].dice}`);
  check(next.turn === 2 && next.phase === 'control', 'the next turn begins');
  check(next.hands.every((h) => h.length >= 3), 'everyone drew three');

  // 2. equal dice climb one of them
  const equal = structuredClone(st);
  equal.problems = [{ dice: [2, 2], status: 'open' }, { dice: [3, 3], status: 'open' },
    { dice: [6, 5], status: 'open' }];
  equal.phase = 'open';
  equal.openOrder = [0, 1];
  equal.openStep = 1;
  equal.hands = [[], [named('the Pact')]];
  const eq = C.openPass(equal);
  check(eq.problems[0].dice.join() === '3,2', `equal dice climb: ${eq.problems[0].dice}`);
  check(eq.problems[1].dice.join() === '4,3', `equal dice climb: ${eq.problems[1].dice}`);
  check(eq.problems[2].dice.join() === '6,6', `the 6 climbs to threaten: ${eq.problems[2].dice}`);

  // 3. a 6-and-6 that escalates ends the game at once: lowest score wins
  const boom = structuredClone(st);
  boom.problems = [{ dice: [6, 6], status: 'open' }, { dice: [1, 1], status: 'open' },
    { dice: [1, 1], status: 'open' }];
  boom.phase = 'open';
  boom.openOrder = [0, 1];
  boom.openStep = 1;
  boom.hands = [[], [named('the Pact')]];
  boom.scores = [40, 62];
  const dead = C.openPass(boom);
  check(dead.over === 'catastrophe', `catastrophe sets over, got ${dead.over}`);
  check(dead.winner === 0, 'the lowest score wins the catastrophe');
  check(dead.turn === 1, 'no draw happens after a catastrophe');

  boom.scores = [40, 40];
  const drawn = C.openPass(structuredClone(boom));
  check(drawn.over === 'catastrophe' && drawn.winner == null, 'level scores: no winner');
}

/* ------------------------------------------------------------ draw & trim */

{
  let st = C.newGame(15, BASIC);
  st.phase = 'open';
  st.openOrder = [0, 1];
  st.openStep = 1;
  st.hands = [[named('the Pact')], [named('the Cave')]];
  const drawn = C.openPass(st);
  check(drawn.hands[0].length === 4 && drawn.hands[1].length === 4, 'everyone draws three');
  check(drawn.phase === 'control', 'small hands go straight to the next turn');

  // a big hand must be trimmed, in seat order
  st = C.newGame(16, BASIC);
  st.phase = 'open';
  st.openOrder = [0, 1];
  st.openStep = 1;
  const dealt = C.allCards(st).slice(0, 6);        // the six cards the deal took
  st.hands = [dealt.slice(0, 4), dealt.slice(4)];  // 4 + 2 → 7 and 5 after the draw
  st.draw = C.allCards(st).slice(6);
  const trimmed = C.openPass(st);
  checkState(trimmed, 'after the draw');
  check(trimmed.phase === 'trim' && trimmed.trimStep === 0, `trim phase ${trimmed.phase}/${trimmed.trimStep}`);
  let t = trimmed;
  throws(() => C.trimDiscard(t, 'not-a-card'), 'not in Player 1');
  while (t.phase === 'trim') {
    const p = t.trimStep;
    t = C.trimDiscard(t, t.hands[p][0]);
    checkState(t, `trim by Player ${p + 1}`);
  }
  check(t.hands.every((h) => h.length <= C.HAND_CAP), 'hands back to six');
  check(t.phase === 'control' && t.turn === 2, 'the next turn begins after trimming');

  // the discard pile reshuffles when the draw pile empties
  const resh = C.newGame(17, BASIC);
  const big = C.allCards(resh);
  resh.draw = [big[0]];
  resh.discard = big.slice(1);
  resh.hands = [[], []];
  resh.phase = 'open';
  resh.openOrder = [0, 1];
  resh.openStep = 1;
  const redrew = C.openPass(resh);
  checkState(redrew, 'after a reshuffle');
  check(redrew.discard.length === 0 && redrew.hands.flat().length === 6,
    'the reshuffled discard feeds the draw');
}

/* ------------------------------------------------------------- score end */

{
  let st = C.newGame(18, BASIC);
  st.phase = 'open';
  st.openOrder = [0, 1];
  st.openStep = 1;
  st.hands = [[], [named('the Pact')]];
  st.scores = [99, 40];
  const below = C.openPass(st);
  check(below.over === null, '99 points does not end the game');
  check(below.turn === 2, 'but the turn still ends');

  st.scores = [100, 40];
  const done = C.openPass(structuredClone(st));
  check(done.over === 'score' && done.winner === 0, `score end: ${done.over}/${done.winner}`);

  st.scores = [100, 100];
  const tie = C.openPass(structuredClone(st));
  check(tie.over === 'score' && tie.winner == null, 'level winning scores: a draw');

  // …and it waits for the end of the turn, through the open phase
  st.scores = [100, 40];
  st.phase = 'service';
  st.queue = ['diplomat'];
  st.services[0].holder = 0;
  st.serviceStep = 0;
  st.hands = [[named('the Pact')], []];
  const midTurn = C.servicePass(st, false);
  check(midTurn.over === null, 'it does not end in the middle of the turn');
  const mid = C.openPass(midTurn);
  check(mid.over === 'score', 'the end is honoured once the turn is done');
}

/* ------------------------------- hand-computed dice-problem fixtures ---- */

{
  // Fixture A — the Diplomatic corps (Moons and Suns), problem 6+4 = 10.
  // the Pact (9, moons+suns) + the Mountain (4, moons+suns) = 13 ≥ 10 → +10 points.
  const st = C.newGame(19, BASIC);
  st.hands = [[named('the Pact'), named('the Mountain'), named('the Bard')], []];
  st.problems = [{ dice: [6, 4], status: 'open' }, ...st.problems.slice(1)];
  st.services[0].holder = 0;
  st.phase = 'reveal';
  const s = C.endReveal(st);
  const full = C.serviceSolveFull(s, 0, [named('the Pact'), named('the Mountain')]);
  check(full.scores[0] === 10, `fixture A scores 10, got ${full.scores[0]}`);
  // …and the illegal attempt: the Bard alone (Crown = the higher die = 6) < 10
  throws(() => C.serviceSolveFull(s, 0, [named('the Bard')]), 'at least 10');

  // Fixture B — part-solve the same problem with the Mountain (4 ≤ lower die 4):
  // ceil(10/2) = 5 points, the 6 is set aside; the 4 stays and will climb.
  const part = C.serviceSolvePart(s, 0, named('the Mountain'), 0);
  check(part.scores[0] === 5, `fixture B scores 5, got ${part.scores[0]}`);
  check(part.problems[0].keep === 1 && part.problems[0].setAside === 6, 'the 6 was set aside');
  // …and the illegal attempt: the Pact (9) is worth more than the lower die
  throws(() => C.serviceSolvePart(s, 0, named('the Pact'), 1), 'lower die, 4');

  // Fixture C — no service in sight: the same problem needs twice the dice.
  const st2 = C.newGame(20, BASIC);
  st2.hands = [[named('the Pact'), named('the Merchant'), named('the Cave'),
    named('the Mountain')], []];
  st2.problems = [{ dice: [6, 4], status: 'open' }, ...st2.problems.slice(1)];
  st2.phase = 'reveal';
  const o = C.endReveal(st2);
  const open = C.openSolveFull(o, 0, [named('the Pact'), named('the Cave'),
    named('the Mountain')]);                                              // 9+7+4 = 20 = 2×10
  check(open.scores[0] === 10, `fixture C scores the dice sum 10, got ${open.scores[0]}`);
  throws(() => C.openSolveFull(o, 0, [named('the Merchant'), named('the Cave')]),
    'twice the dice');                                                    // 16 < 20
}

/* ------------------------------------------------------- random matches */

let movesPlayed = 0, gamesPlayed = 0, lastWinner = null, seedUsed = 0, turnsTotal = 0;
for (let seed = 1; seed <= 30; seed++) {
  seedUsed = seed;
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 31 + 7);
  let guard = 0;
  while (!st.over && guard++ < 20000) {
    const acts = C.legalActions(st);
    if (!acts.length) { check(false, `seed ${seed}: no legal moves in ${st.phase}`); break; }
    st = C.applyMove(st, acts[Math.floor(rng() * acts.length)]);
    movesPlayed++;
    if (movesPlayed % 5 === 0) checkState(st, `seed ${seed} move ${guard}`);
  }
  if (!st.over) { check(false, `seed ${seed}: game never finished`); continue; }
  gamesPlayed++;
  turnsTotal += st.turn;
  lastWinner = st.winner;
  if (st.over === 'score') {
    const hi = Math.max(...st.scores);
    check(hi >= C.TARGET, `seed ${seed}: ended by score below the target`);
    check(st.winner == null ? st.scores[0] === st.scores[1]
      : st.scores[st.winner] === hi, `seed ${seed}: winner does not hold the high score`);
  } else if (st.over === 'catastrophe') {
    check(st.problems.some((p) => p.dice[0] === 6 && p.dice[1] === 6) ||
      st.scores[0] === st.scores[1] || st.winner != null,
      `seed ${seed}: catastrophe without cause`);
    check(st.winner == null ? st.scores[0] === st.scores[1]
      : st.scores[st.winner] === Math.min(...st.scores), `seed ${seed}: catastrophe winner is not lowest`);
  }
  checkState(st, `seed ${seed} final`);
}
check(gamesPlayed === 30, `only ${gamesPlayed} games finished`);
check(movesPlayed > 400, `only ${movesPlayed} moves in 30 games`);

console.log(`random games: ${gamesPlayed} finished in ${movesPlayed} moves ` +
  `(~${Math.round(turnsTotal / Math.max(gamesPlayed, 1))} turns each), last winner ${lastWinner} (seed ${seedUsed})`);
console.log(failures === 0 ? 'chancellors: all tests passed' : `chancellors: ${failures} failures`);
process.exit(failures ? 1 : 0);

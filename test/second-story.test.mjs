// Headless tests for Second Story: node test/second-story.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/second-story-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

/** Chip conservation: bank + bags + lairs is always ten of every suit. */
function chipsOk(state, label) {
  const t = C.chipTotals(state);
  for (const s of C.SUITS) {
    if (t[s] !== 10) check(false, `${label}: ${t[s]} ${s} chips, want 10`);
  }
}
function cardsOk(state, label) {
  const n = state.deck.length + state.discard.length + state.cards.length;
  if (n !== 36) check(false, `${label}: ${n} cards, want 36`);
}

/** A hand-built night in progress: house `card`, phase 'act', everyone broke.
 *  Injected bag chips come out of the bank, so chip counts stay honest. */
function fixture(over = {}) {
  const st = C.newGame(7, BASIC);
  const next = {
    ...st,
    phase: 'act',
    card: 'the-battle',       // 4 of Daemons and Crowns
    cards: ['the-battle'],
    bag: [],
    ...over,
  };
  for (const s of C.SUITS) {
    const n = next.bag.filter((x) => x === s).length;
    if (n) next.bank = { ...next.bank, [s]: Math.max(0, next.bank[s] - n) };
  }
  return next;
}

/* ---- setup over 320 seeds ---- */
for (let seed = 1; seed <= 320; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.deck.length === 36 && st.discard.length === 0, `seed ${seed}: deck`);
  check(st.phase === 'flip' && st.player === 0 && st.turn === 1, `seed ${seed}: start flags`);
  check(C.SUITS.every((s) => st.bank[s] === 10), `seed ${seed}: the bank holds 60 chips`);
  check(st.bag.length === 0 && st.log.length === 0 && st.roll === null, `seed ${seed}: clean night`);
  chipsOk(st, `seed ${seed}`);
  cardsOk(st, `seed ${seed}`);
  check(JSON.parse(JSON.stringify(st)).bank.moons === 10, `seed ${seed}: JSON round trip`);
}

/* ---- aces: luck, both ways ---- */

/** A night just begun with `top` as the next card off the deck. */
function flipFixture(top, over = {}) {
  const st = C.newGame(7, BASIC);
  return {
    ...st,
    deck: [top, ...st.deck.filter((id) => id !== top)],
    phase: 'flip', card: null,
    ...over,
  };
}

{
  // bag empty → take a chip
  let st = flipFixture('ace-of-moons', { bag: [] });
  st = C.flip(st);
  check(st.bag.join() === 'moons' && st.bank.moons === 9, 'an Ace fills the bag');
  check(st.phase === 'flip' && st.card === null, 'you cannot end a turn on an Ace');

  // bag has the suit → something fell out
  st = flipFixture('ace-of-moons', { bag: ['moons', 'suns'] });
  st = C.flip(st);
  check(st.bag.join() === 'suns' && st.bank.moons === 11, 'an Ace of a suit you carry drops a chip');

  // bank depleted, bag empty → nothing happens
  st = flipFixture('ace-of-moons', { bag: [], bank: { ...C.emptyBank(), moons: 0 } });
  st = C.flip(st);
  check(st.bag.length === 0 && st.bank.moons === 0, 'no chips of that suit left: the Ace does nothing');
  check(st.phase === 'flip', 'and the night still goes on');

  // a number card off the flip goes to the act phase
  st = flipFixture('the-pact');
  st = C.flip(st);
  check(st.phase === 'act' && st.card === 'the-pact' && st.cards.join() === 'the-pact',
    'a house is turned face up');

  // illegal flips
  let threw = false;
  try { C.flip(fixture({ phase: 'decide' })); } catch { threw = true; }
  check(threw, 'flipping outside the flip phase throws');
  threw = false;
  try { C.flip(fixture({ over: 'done' })); } catch { threw = true; }
  check(threw, 'flipping after the game is over throws');
}

/* ---- the risk die, both outcomes ---- */

// Thorough job, one die: meets the rank → both suits in the bag.
{
  const st = fixture();
  const next = C.act(st, 'thorough', [4]);            // 4 meets security 4
  check(next.bag.slice().sort().join() === 'crowns,daemons', `thorough win bag: ${next.bag}`);
  check(next.bank.daemons === 9 && next.bank.crowns === 9, 'two chips leave the bank');
  check(next.phase === 'decide', 'you may stop or carry on');
  check(next.roll.join() === '4', 'the roll is kept in state');
  check(st.bag.length === 0 && st.bank.daemons === 10, 'the original state is untouched');
  chipsOk(next, 'thorough win');
}

// Thorough job, one die: below the rank → caught, the bag drops.
{
  const st = fixture({ bag: ['moons'] });
  const next = C.act(st, 'thorough', [3]);
  check(next.player === 1 && next.phase === 'flip', 'caught: the night is over');
  check(next.bag.length === 0 && next.bank.moons === 10, 'the bag goes back to the bank');
  check(next.log.length === 1 && next.log[0].caught === true, 'the capture is logged');
  check(next.discard.length === 1 && next.cards.length === 0, 'the house is revealed and discarded');
  chipsOk(next, 'thorough loss');
}

// Quick job, two dice: one die meets the rank → choose one of the two suits.
{
  const st = fixture({ card: 'the-pact' });           // 9 of Moons and Suns
  let next = C.act(st, 'quick', [9, 2]);
  check(next.phase === 'take', 'both suits are available: you pick');
  let threw = false;
  try { C.take(next, 'waves'); } catch { threw = true; }
  check(threw, 'taking a suit the house does not have throws');
  threw = false;
  try { C.take(C.take(next, 'moons'), 'suns'); } catch { threw = true; }
  check(threw, 'taking twice in one roll throws');
  next = C.take(next, 'suns');
  check(next.bag.join() === 'suns' && next.bank.suns === 9, 'one chip of your chosen suit');
  check(next.phase === 'decide', 'and you may stop or carry on');
}

// Quick job, two dice: both below → caught.
{
  const st = fixture({ card: 'the-pact', bag: ['leaves'] });
  const next = C.act(st, 'quick', [4, 4]);
  check(next.log[0].caught === true && next.bank.leaves === 10, 'quick and caught drops the bag');
  check(next.player === 1, 'the night passes to the other burglar');
}

// Quick job with one suit already gone: the choice is made for you.
{
  const st = fixture({ card: 'the-pact', bank: { ...C.emptyBank(), suns: 0 } });
  const next = C.act(st, 'quick', [9, 1]);
  check(next.phase === 'decide' && next.bag.join() === 'moons', 'only moons is left to take');
  check(next.bank.moons === 9, 'one chip leaves the bank');
}

// Quick job, both suits gone: no compensation, but you still rolled.
{
  const st = fixture({ card: 'the-pact', bank: { ...C.emptyBank(), suns: 0, moons: 0 } });
  const next = C.act(st, 'quick', [10, 10]);
  check(next.phase === 'decide' && next.bag.length === 0, 'nothing of that kind is left: no compensation');
}

/* ---- crowns ---- */
{
  // A Crown is security 10: only a 10 beats it, and always two dice.
  const st = fixture({ card: 'the-bard', lair: [{ ...C.emptyLair(), suns: 1 }, C.emptyLair()] });
  let threw = false;
  try { C.act(st, 'thorough', [10]); } catch { threw = true; }
  check(threw, 'a Crown cannot be rolled with one die');

  const win = C.act(st, 'quick', [10, 3]);
  check(win.bag.join() === 'suns' && win.bank.suns === 9, 'a ten takes the crown chip');
  check(win.phase === 'decide', 'and you may stop or carry on');

  const miss = C.act(st, 'quick', [7, 3]);
  check(miss.phase === 'chance', 'a missed Crown with a matching lair chip offers a second chance');

  const broke = fixture({ card: 'the-bard', lair: [C.emptyLair(), C.emptyLair()], bag: ['waves'] });
  const drop = C.act(broke, 'quick', [7, 3]);
  check(drop.log[0].caught === true && drop.bank.waves === 10, 'no chip to risk: the bag drops');
}

/* ---- the second chance ---- */
{
  const lair = [{ ...C.emptyLair(), suns: 2 }, C.emptyLair()];
  const st = fixture({ card: 'the-bard', lair, phase: 'chance', bag: ['waves'] });
  let next = C.reroll(st, [10, 4]);
  check(next.lair[0].suns === 1, 'one lair chip was moved to the bag');
  check(next.bag.slice().sort().join() === 'suns,suns,waves', `bag after the second chance: ${next.bag}`);
  check(next.bank.suns === 9, 'and the crown chip came out of the bank');
  check(next.phase === 'decide', 'you made it: stop or carry on');
  // (the lair chip was injected from nowhere, so only deltas are honest here)

  // missing again, with another chip to risk → go again
  const st2 = fixture({ card: 'the-bard', lair, phase: 'chance', bag: [] });
  let again = C.reroll(st2, [5, 5]);
  check(again.phase === 'chance' && again.lair[0].suns === 1, 'miss: another second chance is offered');
  const drop = C.reroll(again, [2, 2]);
  check(drop.log[0].caught === true, 'miss with nothing left to risk: caught');
  check(drop.bank.suns === 12, 'both risked chips drop back into the bank');

  // giving up takes the loss without rolling
  const st3 = fixture({ card: 'the-bard', phase: 'chance', bag: ['daemons'] });
  const loss = C.giveUp(st3);
  check(loss.log[0].caught === true && loss.bank.daemons === 10, 'taking the loss drops the bag');

  let threw = false;
  try { C.reroll(st3, [10, 10]); } catch { threw = true; }
  check(threw, 'no matching lair chip: no second chance');
  threw = false;
  try { C.giveUp(fixture()); } catch { threw = true; }
  check(threw, 'giving up outside the second chance throws');
  threw = false;
  try { C.reroll(st3, [10, 11]); } catch { threw = true; }
  check(threw, 'a die off the d10 throws');
}

/* ---- stopping and carrying on ---- */
{
  const st = fixture({ bag: ['moons', 'daemons'], phase: 'decide', events: ['a good night'] });
  const stopped = C.stop(st);
  check(stopped.lair[0].moons === 1 && stopped.lair[0].daemons === 1, 'the bag is banked in the lair');
  check(stopped.bank.moons === 9 && stopped.bank.daemons === 9, 'and stays out of the bank');
  check(stopped.player === 1 && stopped.phase === 'flip', 'the night passes on');
  check(stopped.discard.join() === 'the-battle' && stopped.cards.length === 0, 'the house is discarded');
  check(stopped.log.length === 1 && stopped.log[0].caught === false, 'the night is logged');
  chipsOk(stopped, 'a stopped night');

  const on = C.cont(st);
  check(on.phase === 'flip' && on.card === null, 'try another: back to flipping');
  check(on.bag.join() === 'moons,daemons', 'the bag stays with you');
  check(on.cards.join() === 'the-battle', 'and the revealed cards stay face up');
  check(on.player === 0, 'still your night');

  let threw = false;
  try { C.stop(fixture()); } catch { threw = true; }
  check(threw, 'stopping before a successful job throws');
  threw = false;
  try { C.cont(fixture()); } catch { threw = true; }
  check(threw, 'carrying on before a successful job throws');
  threw = false;
  try { C.act(fixture(), 'sideways', [1]); } catch { threw = true; }
  check(threw, 'an unknown move throws');
  threw = false;
  try { C.take(fixture(), 'moons'); } catch { threw = true; }
  check(threw, 'taking a chip out of turn throws');
}

/* ---- reshuffle: the discard becomes a new draw pile, deterministically ---- */
{
  const st = C.newGame(11, BASIC);
  const base = { ...st, deck: [], discard: st.deck.slice(0, 3) };
  const a = C.flip(base);
  const b = C.flip(base);
  check(a.deck.join() === b.deck.join(), 'the reshuffle is seeded: same order on a reload');
  check(a.deck.length === 2 && a.cards.length === 1, 'three cards became one flip plus a two-card deck');
  check(new Set([...a.deck, ...a.cards, ...a.discard]).size === 3, 'no card duplicated by the reshuffle');
}

/* ---- the last night ---- */
{
  // Player 1 takes the last Moons chip out of the bank and stops.
  let st = fixture({
    card: 'the-journey',                       // 3 of Moons and Waves
    bank: { ...C.emptyBank(), moons: 1 },
  });
  st = C.act(st, 'thorough', [3]);
  check(st.bank.moons === 0, 'the last moons chip is in the bag');
  st = C.stop(st);
  check(st.final === true, 'the turn that empties a suit starts the last night');
  check(st.finalQueue.join() === '1,0', 'the other burglar goes first, emptier last');
  check(st.player === 1, 'player 2 takes the next final turn');
  check(st.lair[0].moons === 1 && st.lair[0].waves === 1, 'the loot is safe in the lair');

  // Player 2's final turn.
  st = { ...st, phase: 'act', card: 'the-merchant' };     // 9 of Leaves and Crowns
  st = C.act(st, 'quick', [1, 1]);
  check(st.log[st.log.length - 1].caught === true, 'a caught final night is still a turn');
  check(st.finalQueue.join() === '0', 'one final turn remains');
  check(st.player === 0, 'player 1 plays their last night');

  // Player 1's final turn — depleting another suit now changes nothing.
  st = { ...st, phase: 'act', card: 'the-discovery', bank: { ...st.bank, suns: 1 } };
  st = C.act(st, 'thorough', [5]);                        // 5 of Suns and Waves
  check(st.bank.suns === 0 && st.bank.waves === st.bank.waves, 'another suit runs dry mid-final');
  st = C.stop(st);
  check(st.over === 'done', 'the last night ends the game');
  check(st.finalQueue.length === 0, 'no extra turns are granted');
  const a = C.scoreVector(st.lair[0]), b = C.scoreVector(st.lair[1]);
  let winner = null;
  for (let i = 1; i < 6; i++) if (a[i] !== b[i]) { winner = a[i] > b[i] ? 0 : 1; break; }
  check(st.winner === winner, `winner ${st.winner}, scores say ${winner}`);
}

/* ---- scoring: the wiki's example, worked on paper ---- */
{
  // Morgan: 6, 4, 3, 2, 1 in five suits.  Siveny: 4, 4, 3, 3 in four.
  const morgan = { moons: 6, suns: 4, waves: 3, leaves: 2, daemons: 1, crowns: 0 };
  const siveny = { moons: 4, suns: 4, waves: 3, leaves: 3, daemons: 0, crowns: 0 };
  check(C.scoreVector(morgan).join() === '6,4,3,2,1,0', `vector: ${C.scoreVector(morgan)}`);
  check(C.scoreVector(siveny).join() === '4,4,3,3,0,0', `vector: ${C.scoreVector(siveny)}`);
  check(C.lairScore(morgan) === 4 && C.lairScore(siveny) === 4, 'both score their second suit');

  const st = C.newGame(3, BASIC);
  const game = {
    ...st, over: 'done',
    lair: [{ ...C.emptyLair(), ...morgan }, { ...C.emptyLair(), ...siveny }],
  };
  const a = C.scoreVector(game.lair[0]), b = C.scoreVector(game.lair[1]);
  let winner = null;
  for (let i = 1; i < 6; i++) if (a[i] !== b[i]) { winner = a[i] > b[i] ? 0 : 1; break; }
  check(winner === 1, 'the wiki says Siveny wins on the fourth most numerous suit');

  // an empty lair scores nothing, and identical lairs tie
  check(C.lairScore(C.emptyLair()) === 0, 'a broke burglar scores 0');
  const tie = { ...st, lair: [{ ...C.emptyLair(), waves: 2 }, { ...C.emptyLair(), waves: 2 }] };
  const ta = C.scoreVector(tie.lair[0]), tb = C.scoreVector(tie.lair[1]);
  check(ta.join() === tb.join(), 'identical lairs produce identical vectors');
}

/* ---- the same seed replays the same night (reload stability) ---- */
{
  const play = (seed) => {
    let st = C.newGame(seed, BASIC);
    const rng = mulberry32(seed * 31 + 3);
    for (let i = 0; i < 120 && !st.over; i++) st = playoutStep(st, rng);
    return st;
  };
  const a = play(9), b = play(9);
  check(JSON.stringify(a) === JSON.stringify(b),
    'a saved game resumes with the same dice: the whole playthrough is seeded');
  check(a.moves > 3, `seed 9 should have played some nights, played ${a.moves}`);
}

/* ---- full random playouts: 320 seeds, every move checked ---- */
function playoutStep(st, rng) {
  if (st.phase === 'flip') return C.flip(st);
  if (st.phase === 'act') {
    const mode = C.rankOf(st.card) === 10
      ? 'quick'
      : (rng() < 0.5 ? 'thorough' : 'quick');
    return C.act(st, mode);
  }
  if (st.phase === 'take') {
    const suits = byId[st.card].suits.filter((s) => st.bank[s] > 0);
    return C.take(st, suits[Math.floor(rng() * suits.length)]);
  }
  if (st.phase === 'chance') return rng() < 0.5 ? C.reroll(st) : C.giveUp(st);
  if (st.phase === 'decide') return rng() < 0.6 ? C.stop(st) : C.cont(st);
  throw new Error(`unexpected phase ${st.phase}`);
}

let totalMoves = 0, winners = [0, 0, 0], longestNight = 0, finalNights = 0;
for (let seed = 1; seed <= 320; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 104729 + 7);
  let guard = 0, nights = 0;
  while (!st.over && guard++ < 20000) {
    const movesBefore = st.moves;
    const player = st.player;
    st = playoutStep(st, rng);
    chipsOk(st, `seed ${seed} move ${st.moves}`);
    cardsOk(st, `seed ${seed} move ${st.moves}`);
    if (st.moves > movesBefore) {
      nights++;
      check(st.player !== player || st.over,
        `seed ${seed}: the night changed hands`);
      check(st.log[st.log.length - 1].player === player, `seed ${seed}: the log knows who played`);
    }
    totalMoves++;
  }
  check(st.over === 'done', `seed ${seed}: game never ended (guard ${guard}, phase ${st.phase})`);
  check(st.final === true, `seed ${seed}: every game reaches the last night`);
  check(st.finalQueue.length === 0, `seed ${seed}: every final turn was taken`);
  const a = C.scoreVector(st.lair[0]), b = C.scoreVector(st.lair[1]);
  let winner = null;
  for (let i = 1; i < 6; i++) if (a[i] !== b[i]) { winner = a[i] > b[i] ? 0 : 1; break; }
  check(st.winner === winner, `seed ${seed}: winner ${st.winner}, lairs say ${winner}`);
  check(st.moves === st.log.length, `seed ${seed}: one log entry per night`);
  longestNight = Math.max(longestNight, guard);
  winners[st.winner == null ? 2 : st.winner]++;
  finalNights += nights;
}

console.log(`random playouts: 320/320 finished, ${totalMoves} moves, ` +
  `P1 wins ${winners[0]}, P2 wins ${winners[1]}, ties ${winners[2]}, ` +
  `longest game ${longestNight} moves`);
console.log(failures === 0 ? 'second-story: all tests passed' : `second-story: ${failures} failures`);
process.exit(failures ? 1 : 0);

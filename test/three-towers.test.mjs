// Headless tests for Three Towers: node test/three-towers.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

// Two synthetic cards let us build a position no real five cards can make —
// see "no real deal can deadlock" below.
for (const n of ['a', 'b', 'c', 'd', 'e']) {
  byId[`fake-lock-${n}`] = { id: `fake-lock-${n}`, name: `fake lock ${n}`, rank: 9, suits: ['crowns'] };
}

const C = await import('../web/js/games/three-towers-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const rank = (id) => byId[id].rank;
const share = (a, b) => byId[a].suits.some((s) => byId[b].suits.includes(s));

/** A hand-built position.  spaces: five arrays, bottom card first. */
function board(spec = {}) {
  return {
    seed: 0,
    level: spec.level ?? 9,
    ivoryMode: !!spec.ivoryMode,
    ivory: spec.ivory ?? null,
    deck: [...(spec.deck || [])],
    up: spec.up ?? null,
    spaces: [0, 1, 2, 3, 4].map((i) => [...((spec.spaces || [])[i] || [])]),
    moves: 0,
    over: null,
  };
}

const allCards = (s) => [...s.deck, ...(s.up ? [s.up] : []), ...s.spaces.flat()];

/** Every card of the level's deck is somewhere, exactly once. */
function conserved(state, label) {
  const want = C.towerDeck(BASIC, state.level);
  const got = allCards(state);
  if (got.length !== want.length) { check(false, `${label}: ${got.length} cards, want ${want.length}`); return; }
  const set = new Set(got);
  if (set.size !== want.length) { check(false, `${label}: duplicate card`); return; }
  for (const id of want) {
    if (!set.has(id)) { check(false, `${label}: missing ${id}`); return; }
  }
}

/** The score, recomputed from the manifest rather than the core. */
function towersBuiltByHand(state) {
  let n = 0;
  for (const sp of state.spaces) {
    if (sp.length !== state.level - 1) continue;
    let ok = true;
    for (let k = 0; k < sp.length; k++) {
      if (byId[sp[k]].rank !== state.level - k) { ok = false; break; }
      if (k > 0 && !byId[sp[k]].suits.some((s) => byId[sp[k - 1]].suits.includes(s))) { ok = false; break; }
    }
    if (ok) n += 1;
  }
  return n;
}

/* ---------------------------------------------------------- the decks */

for (const level of C.LEVELS) {
  const deck = C.towerDeck(BASIC, level);
  check(deck.length === 3 * (level - 1), `level ${level}: deck ${deck.length}`);
  for (const id of deck) {
    check(typeof byId[id].rank === 'number' && byId[id].rank >= 2 && byId[id].rank <= level,
      `level ${level}: foreign card ${id}`);
  }
  for (let r = 2; r <= level; r++) {
    check(deck.filter((id) => byId[id].rank === r).length === 3,
      `level ${level}: rank ${r} has ${deck.filter((id) => byId[id].rank === r).length} cards`);
  }
}

/* --------------------------------------------------- setup invariants */

for (const level of [9, 6]) {
  for (let seed = 1; seed <= 300; seed++) {
    const st = C.newGame(seed, BASIC, { level });
    const total = 3 * (level - 1);
    check(st.deck.length === total - 1, `level ${level} seed ${seed}: deck ${st.deck.length}`);
    check(typeof st.up === 'string', `level ${level} seed ${seed}: no card flipped up`);
    check(st.spaces.length === 5 && st.spaces.every((s) => s.length === 0),
      `level ${level} seed ${seed}: spaces ${JSON.stringify(st.spaces)}`);
    check(st.moves === 0 && st.over === null, `level ${level} seed ${seed}: moves ${st.moves} over ${st.over}`);
    check(st.level === level, `level ${level} seed ${seed}: state.level ${st.level}`);
    conserved(st, `level ${level} seed ${seed}`);
    // the first card is playable somewhere: all five spaces are empty
    check(C.destinations(st, 'deck').length === 5, `level ${level} seed ${seed}: first card has no home`);
  }
}

/* ------------------------------------------------------- placement */

{
  // an empty space takes anything
  check(C.canPlace(board(), 0, 'the-author'), 'an empty space takes a 2');
  check(C.canPlace(board(), 0, 'the-pact'), 'an empty space takes a 9');

  // lower rank and a shared suit
  const on9 = board({ spaces: [['the-pact']] });
  check(C.canPlace(on9, 0, 'the-diplomat'), '8 of Moons and Suns stacks on the 9 of Moons and Suns');
  check(!C.canPlace(on9, 0, 'the-mill'), '8 of Waves and Leaves shares no suit with it');
  check(!C.canPlace(on9, 0, 'the-betrayal'), '8 of Daemons and Crowns shares no suit with it');
  check(!C.canPlace(on9, 0, 'the-pact'), 'a card may not stack on its own rank');
  check(!C.canPlace(on9, 0, 'the-merchant'), 'a 9 is not lower than a 9');

  const on8 = board({ spaces: [['the-mill']] });      // 8 of Waves and Leaves
  check(C.canPlace(on8, 0, 'the-cave'), '7 of Waves and Daemons shares Waves');
  check(!C.canPlace(on8, 0, 'the-castle'), '7 of Suns and Crowns shares nothing');
}

/* --------------------------------------------------- the card you hold */

{
  const st = board({ deck: ['the-market'], up: 'the-pact', spaces: [['the-desert'], [], [], [], []] });
  check(C.cardOf(st, 'deck') === 'the-pact', 'the deck offers its face-up card');
  check(C.cardOf(st, 0) === 'the-desert', 'a space offers its top card');
  check(C.cardOf(st, 1) === null, 'an empty space offers nothing');

  // the Pact (9) fits the empty spaces, but not the 2 of Suns and Daemons
  const dests = C.destinations(st, 'deck');
  check(dests.join() === '1,2,3,4', `deck destinations ${dests}`);
  check(C.legalMoves(st).some((m) => m.src === 'deck' && m.dest === 1), 'deck → space is legal');
  check(!C.legalMoves(st).some((m) => m.src === m.dest), 'a space is not its own destination');
  check(C.legalMoves(st).some((m) => m.src === 0 && m.dest === 2), 'the 2 can be moved into an empty space');
  check(!C.legalMoves(st).some((m) => m.src === 1), 'empty spaces make no moves');
}

/* -------------------------------------------------------- the moves */

{
  const st = board({ deck: ['the-market'], up: 'the-pact',
    spaces: [['the-desert'], [], [], [], []] });
  const next = C.applyMove(st, { src: 'deck', dest: 1 });
  check(next.spaces[1].join() === 'the-pact', 'the card was placed');
  check(next.up === 'the-market', 'the deck flipped its new top card');
  check(next.deck.length === 0, 'the deck is spent');
  check(next.moves === 1, `moves ${next.moves}`);
  check(st.up === 'the-pact' && st.moves === 0, 'the original state must not be mutated');

  const last = C.applyMove(next, { src: 'deck', dest: 2 });
  check(last.up === null, 'with no cards left, nothing is face up on the deck');
  check(last.deck.length === 0, 'and the deck is empty');

  const moved = C.applyMove(last, { src: 1, dest: 3 });   // the 9 onto an empty space
  check(moved.spaces[1].length === 0 && moved.spaces[3].join() === 'the-pact',
    'a space card moved to another space');

  // illegal moves throw
  const bad = board({ up: 'the-pact', deck: ['the-market'],
    spaces: [['the-desert'], [], [], [], []] });
  check(throws(() => C.applyMove(bad, { src: 'deck', dest: 0 })), 'the 9 may not stack on the 2');
  check(throws(() => C.applyMove(bad, { src: 0, dest: 0 })), 'a space may not move onto itself');
  check(throws(() => C.applyMove(bad, { src: 4, dest: 0 })), 'an empty space has nothing to move');
  check(throws(() => C.applyMove(bad, { src: 'nope', dest: 0 })), 'unknown sources are refused');
  check(throws(() => C.applyMove(board(), { src: 'deck', dest: 0 })),
    'with no card face up on the deck there is nothing to play');
}

/* ------------------------------------------------------ winning */

// Every card of the 24-card deck, in three complete runs of 9 … 2:
const T1 = ['the-darkness', 'the-betrayal', 'the-castle', 'the-market', 'the-forest',
  'the-mountain', 'the-journey', 'the-author'];
const T2 = ['the-merchant', 'the-mill', 'the-cave', 'the-penitent', 'the-soldier',
  'the-battle', 'the-painter', 'the-desert'];
const T3 = ['the-pact', 'the-diplomat', 'the-chance-meeting', 'the-lunatic',
  'the-discovery', 'the-sailor', 'the-savage', 'the-origin'];

for (const [i, t] of [T1, T2, T3].entries()) {
  check(t.length === 8, `tower ${i + 1} has ${t.length} cards`);
  for (let k = 0; k < t.length; k++) {
    check(rank(t[k]) === 9 - k, `tower ${i + 1}: position ${k} is rank ${rank(t[k])}`);
    if (k > 0) check(share(t[k], t[k - 1]), `tower ${i + 1}: ${t[k]} and ${t[k - 1]} share no suit`);
  }
}

{
  const win = board({ spaces: [T1, T2, T3] });
  check(C.isWon(win), 'three complete towers is a win');
  check(towersBuiltByHand(win) === 3, 'hand-computed score: 3 towers');
  check(C.towersBuilt(win) === 3, 'core agrees: 3 towers');
  C.settle(win);
  check(win.over === 'won', `over = ${win.over}`);

  // …but not yet if one card is still to be played
  const almost = board({ up: 'the-author', spaces: [T1.slice(0, -1), T2, T3] });
  check(!C.isWon(almost), 'a card still to play is not a win');
  check(C.legalMoves(almost).some((m) => m.src === 'deck' && m.dest === 0),
    'the Author can finish the first tower');
  const done = C.applyMove(almost, { src: 'deck', dest: 0 });
  check(done.up === null && done.deck.length === 0, 'the deck is spent');
  check(C.isWon(done) && done.over === 'won', 'the last card completes it');

  // a gap in the ranks
  const gap = board({ spaces: [T1, T2, ['the-pact', 'the-diplomat', 'the-lunatic',
    'the-chance-meeting', 'the-sailor', 'the-discovery', 'the-savage', 'the-origin']] });
  check(!C.isWon(gap), 'a tower that skips the 7 and the 5 is not complete');
  check(C.towersBuilt(gap) === 2, 'the two other towers still count');

  // a suit break: the rank order is perfect but the 2 shares nothing with the 3
  const broken = board({
    spaces: [
      [...T1.slice(0, -1), 'the-desert'],                 // the Author's seat, wrongly filled
      [...T2.slice(0, -1), 'the-author'],
      T3,
    ],
  });
  check(!C.isWon(broken), 'a tower whose 2 shares no suit with the 3 is not complete');
  check(C.towersBuilt(broken) === 2, 'the two sound towers still count');
  check(allCards(broken).length === 24 && new Set(allCards(broken)).size === 24,
    'the broken fixture still holds every card once');

  // four towers: all cards, but not three towers
  const four = board({ spaces: [T1.slice(0, -1), ['the-author'], T2, T3] });
  check(four.spaces.filter((s) => s.length).length === 4, 'four spaces are in use');
  check(!C.isWon(four), 'four towers is not three towers');
}

/* ------------------------------------------------- the difficulty levels */

{
  // level 6: runs of 6 … 2 over its 15 cards
  const L1 = ['the-lunatic', 'the-discovery', 'the-mountain', 'the-journey', 'the-author'];
  const L2 = ['the-market', 'the-forest', 'the-sailor', 'the-savage', 'the-origin'];
  const L3 = ['the-penitent', 'the-soldier', 'the-battle', 'the-painter', 'the-desert'];
  for (const [i, t] of [L1, L2, L3].entries()) {
    check(t.length === 5, `level 6 tower ${i + 1} has ${t.length} cards`);
    for (let k = 0; k < t.length; k++) {
      check(rank(t[k]) === 6 - k, `level 6 tower ${i + 1}: position ${k} is rank ${rank(t[k])}`);
      if (k > 0) check(share(t[k], t[k - 1]), `level 6 tower ${i + 1}: ${t[k]} vs ${t[k - 1]}`);
    }
  }
  const win6 = board({ level: 6, spaces: [L1, L2, L3] });
  check(C.isWon(win6), 'level 6 wins with three runs of five');
  check(C.towersBuilt(win6) === 3, 'level 6 score is 3');

  // the same three towers judged at level 9 are not complete
  const judged9 = board({ level: 9, spaces: [L1, L2, L3] });
  check(!C.isWon(judged9), 'a level 6 deal is not a level 9 win');
  check(C.towersBuilt(judged9) === 0, 'nor does it score');
}

/* ------------------------------------------------- the Ivory variant */

{
  const st = C.newGame(1, BASIC, { level: 9, ivory: true });
  check(st.ivoryMode === true && st.ivory === null, 'the variant starts without a suit');
  check(C.legalMoves(st).length === 0, 'no card may be played before the suit is chosen');
  C.settle(st);
  check(st.over === null, 'and the game waits instead of ending');
  check(throws(() => C.chooseSuit(st, 'hearts')), 'an unknown suit is refused');
  const picked = C.chooseSuit(st, 'moons');
  check(picked.ivory === 'moons', 'the suit is recorded');
  check(C.legalMoves(picked).length === 5, 'then play begins');
  check(throws(() => C.chooseSuit(picked, 'suns')), 'the suit may not be chosen twice');

  // the base win without an ivory tower is not a win under the variant
  const plain = board({ ivoryMode: true, ivory: 'moons', spaces: [T1, T2, T3] });
  check(C.towersBuilt(plain) === 3, 'three towers stand');
  check(!C.isWon(plain), 'but none of them is all one suit');

  // …and with one it is
  const MOONS = ['the-pact', 'the-diplomat', 'the-chance-meeting', 'the-lunatic',
    'the-forest', 'the-mountain', 'the-journey', 'the-author'];
  const R1 = ['the-darkness', 'the-betrayal', 'the-castle', 'the-market',
    'the-soldier', 'the-battle', 'the-painter', 'the-desert'];
  const R2 = ['the-merchant', 'the-mill', 'the-cave', 'the-penitent',
    'the-discovery', 'the-sailor', 'the-savage', 'the-origin'];
  const ivoryWin = board({ ivoryMode: true, ivory: 'moons', spaces: [MOONS, R1, R2] });
  for (const t of [MOONS, R1, R2]) check(t.length === 8, `ivory fixture tower has ${t.length}`);
  for (let k = 0; k < MOONS.length; k++) {
    check(byId[MOONS[k]].suits.includes('moons'), `${MOONS[k]} carries Moons`);
    if (k > 0) check(share(MOONS[k], MOONS[k - 1]), `${MOONS[k]} vs ${MOONS[k - 1]}`);
  }
  for (const t of [R1, R2]) {
    for (let k = 0; k < t.length; k++) {
      check(rank(t[k]) === 9 - k, `ivory fixture: rank ${rank(t[k])} at ${k}`);
      if (k > 0) check(share(t[k], t[k - 1]), `ivory fixture: ${t[k]} vs ${t[k - 1]}`);
    }
  }
  check(C.towersBuilt(ivoryWin) === 3, 'three complete towers');
  check(C.isWon(ivoryWin), 'and one of them is all Moons: a win');

  const wrongSuit = board({ ivoryMode: true, ivory: 'suns', spaces: [MOONS, R1, R2] });
  check(!C.isWon(wrongSuit), 'the ivory tower must hold the suit you picked');
}

/* ----------------------------------------------------------------- loss */

{
  // the branch itself: five tops that can never stack (equal ranks).  No five
  // cards of the real deck look like this — see below — which is exactly why
  // the wiki defines no loss and the table offers "Give up".
  const locked = board({
    deck: [],
    spaces: [['fake-lock-a'], ['fake-lock-b'], ['fake-lock-c'], ['fake-lock-d'], ['fake-lock-e']],
  });
  check(C.legalMoves(locked).length === 0, 'no move at all in the locked position');
  C.settle(locked);
  check(locked.over === 'lost', `over = ${locked.over}`);

  // giving up ends the game without touching the cards
  const g = board({ deck: ['the-market'], up: 'the-pact', spaces: [['the-desert'], [], [], [], []] });
  const quit = C.abandon(g);
  check(quit.over === 'gaveup', 'give up ends the game');
  check(g.over === null, 'the original state is untouched');
  check(C.abandon(quit) === quit, 'give up again changes nothing');
  check(allCards(quit).length === allCards(g).length, 'giving up moves no card');
}

/* ------------------------------------------ no real deal can deadlock */

{
  // five cards that could never be the five tower tops of a stuck position:
  // for every pair, the lower one would have to share no suit with the higher.
  // There are none at any level — which is exactly why the wiki defines no
  // loss and the table offers "Give up".
  for (const level of C.LEVELS) {
    const deck = C.towerDeck(BASIC, level);
    let deadlocks = 0;
    const pick5 = (start, acc) => {
      if (acc.length === 5) {
        let ok = true;
        for (let i = 0; i < 5 && ok; i++) {
          for (let j = 0; j < 5; j++) {
            if (i === j) continue;
            if (rank(acc[i]) < rank(acc[j]) && share(acc[i], acc[j])) { ok = false; break; }
          }
        }
        if (ok) deadlocks += 1;
        return;
      }
      for (let i = start; i < deck.length; i++) { acc.push(deck[i]); pick5(i + 1, acc); acc.pop(); }
    };
    pick5(0, []);
    check(deadlocks === 0, `level ${level}: ${deadlocks} deadlock sets among ${deck.length} cards`);
  }
}

/* ---------------------------------------- a rigged deal a player wins */

{
  // the deck laid out so the three towers can be built card by card, and a
  // player who always stacks a card onto the run it continues wins it
  const exposure = [...T1, ...T2, ...T3];
  let st = board({ deck: exposure.slice(1).reverse(), up: exposure[0] });
  C.settle(st);
  check(st.over === null, 'the rigged game starts live');
  let guard = 0;
  while (!st.over && guard++ < 100) {
    const dests = C.destinations(st, 'deck');
    if (!dests.length) break;
    const ontoRun = dests.filter((i) => st.spaces[i].length
      && rank(st.up) + 1 === rank(C.topOf(st.spaces[i])));
    st = C.applyMove(st, { src: 'deck', dest: ontoRun.length ? ontoRun[0] : dests[0] });
  }
  check(st.over === 'won', `rigged deal: over=${st.over} after ${st.moves} moves`);
  check(st.moves === 24, `every card placed: ${st.moves} moves`);
  check(st.deck.length === 0 && st.up === null, 'the deck is empty');
  check(C.towersBuilt(st) === 3, 'three towers stand');
  conserved(st, 'the rigged win');
  console.log(`rigged deal: won in ${st.moves} moves, score ${C.towersBuilt(st)}`);
}

/* -------------------------------------------------- full random playouts */
//
// The scripted player: play the deck card when it fits (preferring to extend
// a run and to leave a space free), plan a few tower moves ahead when it does
// not, shuffle preferentially into runs when the deck is empty, and — when no
// plan lets the card in, or the shuffling runs on — do what the "Give up"
// button does and end the game.  The wiki defines no loss, so ending is the
// player's call; what every game must do is reach `over` without ever
// creating or losing a card.

function deckPlan(spaces, up, maxDepth = 4, cap = 4000) {
  const fits = (id, sp) => !sp.length || (rank(id) < rank(C.topOf(sp)) && share(id, C.topOf(sp)));
  const key = (s) => s.map((p) => p.join(',')).join('|');
  let nodes = 0;
  const dfs = (sp, d, depth, seen) => {
    if (++nodes > cap) return 'CAP';
    for (let from = 0; from < 5; from++) {
      if (!sp[from].length) continue;
      const id = sp[from][sp[from].length - 1];
      for (let to = 0; to < 5; to++) {
        if (to === from || !fits(id, sp[to])) continue;
        if (sp[from].length === 1 || fits(up, sp[to].concat(id))) return [{ from, to }];
        if (d < depth) {
          const ns = sp.map((p, k) => (k === from ? p.slice(0, -1) : k === to ? p.concat(id) : p));
          const k = key(ns);
          if (!seen.has(k)) {
            seen.add(k);
            const rest = dfs(ns, d + 1, depth, seen);
            if (rest) return rest === 'CAP' ? rest : [{ from, to }, ...rest];
          }
        }
      }
    }
    return null;
  };
  for (let depth = 1; depth <= maxDepth; depth++) {
    const seen = new Set([key(spaces)]);
    const r = dfs(spaces, 1, depth, seen);
    if (r === 'CAP') return null;
    if (r) return r;
  }
  return null;
}

function scriptedPlay(seed, level) {
  let st = C.newGame(seed, BASIC, { level });
  const rng = D_mulberry32(seed * 104729 + 7);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  let guard = 0, last = null, endgame = 0, failedPlans = 0, plan = [], searches = 0;
  while (!st.over && guard++ < 2500) {
    const moves = C.legalMoves(st);
    if (!moves.length) break;
    const continues = (m) => {
      const d = st.spaces[m.dest];
      return d.length && rank(C.cardOf(st, m.src)) + 1 === rank(C.topOf(d));
    };
    let mv = null;
    if (st.up != null) {
      const dests = C.destinations(st, 'deck');
      if (dests.length) {
        failedPlans = 0;
        plan = [];
        const runs = dests.filter((i) => continues({ src: 'deck', dest: i }));
        const used = dests.filter((i) => st.spaces[i].length > 0);
        mv = { src: 'deck', dest: runs.length ? pick(runs) : (used.length ? pick(used) : pick(dests)) };
      } else if (plan.length) {
        const step = plan[0];
        if (moves.some((m) => m.src === step.from && m.dest === step.to)) {
          plan.shift();
          mv = { src: step.from, dest: step.to };
        } else plan = [];
      } else {
        searches += 1;
        const found = deckPlan(st.spaces, st.up);
        if (found) {
          plan = found.slice(1);
          mv = { src: found[0].from, dest: found[0].to };
        } else if (++failedPlans > 25) {
          st = C.abandon(st);                       // the scripted player gives up
          break;
        } else {
          const run = moves.filter(continues);
          const pool = run.length ? run : moves;
          const fresh = pool.filter((m) => !(last && m.src === last.dest && m.dest === last.src));
          mv = pick(fresh.length ? fresh : pool);
        }
      }
    } else {
      if (++endgame > 400) { st = C.abandon(st); break; }
      const runs = moves.filter(continues);
      const lone = moves.filter((m) => st.spaces[m.src].length === 1 && st.spaces[m.dest].length > 0);
      const fill = moves.filter((m) => st.spaces[m.dest].length === 0 && st.spaces[m.src].length > 1);
      const pool = runs.length ? runs : (lone.length ? lone : (fill.length ? fill : moves));
      const fresh = pool.filter((m) => !(last && m.src === last.dest && m.dest === last.src));
      mv = pick(fresh.length ? fresh : pool);
    }
    if (!mv) continue;
    st = C.applyMove(st, mv);
    last = mv;
    conserved(st, `seed ${seed} level ${level} move ${st.moves}`);
  }
  if (!st.over) st = C.abandon(st);
  return { st, searches };
}

const tally = {};
let maxMoves = 0, searched = 0;
for (const level of C.LEVELS) {
  for (let seed = 1; seed <= 75; seed++) {
    const { st, searches } = scriptedPlay(seed, level);
    searched += searches;
    check(st.over === 'won' || st.over === 'gaveup', `level ${level} seed ${seed}: over=${st.over}`);
    conserved(st, `level ${level} seed ${seed} final`);
    const key = `level ${level}: ${st.over === 'won' ? 'won' : 'gave up'}`;
    tally[key] = (tally[key] || 0) + 1;
    if (st.moves > maxMoves) maxMoves = st.moves;
    const want = towersBuiltByHand(st);
    check(C.towersBuilt(st) === want,
      `level ${level} seed ${seed}: score ${C.towersBuilt(st)} vs hand ${want}`);
    if (st.over === 'won') check(want === 3, `level ${level} seed ${seed}: won with ${want} towers`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.spaces.length === 5 && json.deck.length === st.deck.length,
      `level ${level} seed ${seed}: JSON round trip lost cards`);
    check(C.legalMoves(json).length === C.legalMoves(st).length,
      `level ${level} seed ${seed}: legal moves differ after round trip`);
  }
}

console.log(`random playouts: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`max ${maxMoves} moves, ${searched} deck plans searched`);
console.log(failures === 0 ? 'three-towers: all tests passed' : `three-towers: ${failures} failures`);
process.exit(failures ? 1 : 0);

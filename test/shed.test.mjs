// Headless tests for Shed: node test/shed.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/shed-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
const SUITS = C.SUITS;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throwsWith = (fn, needle, msg) => {
  try { fn(); check(false, `${msg}: did not throw`); }
  catch (e) { check(e.message.includes(needle), `${msg}: message "${e.message}" lacks "${needle}"`); }
};

const named = (name) => BASIC.find((id) => byId[id].name === name);
const rank = (n, ...suits) => BASIC.find((id) => byId[id].rank === n &&
  suits.every((s) => byId[id].suits.includes(s)));

const SAILOR = named('the Sailor');            // personality 4
const MERCHANT = named('the Merchant');        // personality 9
const LUNATIC = named('the Lunatic');          // personality 6
const BARD = named('the Bard');                // personality, Crown of Suns
const CAVE = named('the Cave');                // location 7
const DESERT = named('the Desert');            // location 2
const MOUNTAIN = named('the Mountain');        // location 4
const FOREST = named('the Forest');            // location 5
const MILL = named('the Mill');                // location 8
const END = named('the End');                  // dual, Crown of Leaves
const CHANCE = named('the Chance Meeting');    // event 7
const BATTLE = named('the Battle');            // event 4
const JOURNEY = named('the Journey');          // event 3
const MARKET = named('the Market');            // dual event/location 6
const PACT = named('the Pact');                // event 9
const BETRAYAL = named('the Betrayal');        // event 8
const SEA = named('the Sea');                  // Crown of Waves
const DISCOVERY = named('the Discovery');      // 5 suns + waves
const ACE_WAVES = 'ace-of-waves';
const ACE_SUNS = 'ace-of-suns';

const TOKENS = () => Object.fromEntries(SUITS.map((s) => [s, 1]));
const SUPPLY = () => Object.fromEntries(SUITS.map((s) => [s, 3]));

/* ---- a hand-built position; leftovers sit in `rest` so all 36 count ---- */
function pos({ hands, draw = [], rest = [], discards = [], trick = [], trickType = null,
  trickSuit = null, leadId = null, phase = 'lead', turn = 0, round = 1, dealer = 0,
  tokens = [TOKENS(), TOKENS()], supply = SUPPLY(), kingmaker = 'shared',
  scores = [0, 0], tricksWon = [0, 0], over = null, winner = null }) {
  const used = new Set([...hands.flat(), ...draw, ...discards, ...rest,
    ...trick.map((p) => p.id)]);
  const leftovers = BASIC.filter((id) => !used.has(id));
  return {
    seed: 7, cards: BASIC.slice(), round, dealer, leader: 1 - dealer,
    turn, hands: [hands[0].slice(), hands[1].slice()],
    draw: draw.slice(), remainder: [...rest, ...leftovers], discards: discards.slice(),
    tokens: structuredClone(tokens), supply: { ...supply },
    scores: scores.slice(), tricksWon: tricksWon.slice(),
    phase, trick: structuredClone(trick), trickType, trickSuit, leadId,
    pending: null, lastTrick: null, lastEvent: { kind: 'deal' },
    kingmaker, moves: 0, over, winner, endReason: null,
  };
}

/** Rebuild the supply so every suit again totals five tokens. */
function balance(state) {
  for (const s of SUITS) {
    state.supply[s] = 5 - state.tokens[0][s] - state.tokens[1][s];
  }
  return state;
}

function cardConserved(state, label) {
  const all = [...state.hands[0], ...state.hands[1], ...state.draw,
    ...state.remainder, ...state.discards, ...state.trick.map((p) => p.id)];
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}
function tokenConserved(state, label) {
  for (const s of SUITS) {
    const n = state.tokens[0][s] + state.tokens[1][s] + state.supply[s];
    if (n !== 5) check(false, `${label}: ${s} tokens total ${n}, paper says 5`);
    for (const p of [0, 1]) {
      if (state.tokens[p][s] < 0 || state.tokens[p][s] > 1) {
        check(false, `${label}: player ${p + 1} holds ${state.tokens[p][s]} ${s} tokens`);
      }
    }
  }
}
const held = (state, p) => SUITS.reduce((sum, s) => sum + state.tokens[p][s], 0);

/* ======================================================= setup over seeds */
for (let seed = 1; seed <= 300; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hands[0].length === 10 && st.hands[1].length === 10,
    `seed ${seed}: hands ${st.hands[0].length}/${st.hands[1].length}`);
  check(st.draw.length === 12, `seed ${seed}: draw pile ${st.draw.length}`);
  check(st.remainder.length === 4, `seed ${seed}: remainder ${st.remainder.length}`);
  check(st.phase === 'lead' && st.turn === st.leader && st.leader === 1 - st.dealer,
    `seed ${seed}: phase/turn/leader`);
  check(held(st, 0) === 6 && held(st, 1) === 6, `seed ${seed}: starting pools`);
  check(SUITS.every((s) => st.supply[s] === 3), `seed ${seed}: supply ${JSON.stringify(st.supply)}`);
  check(st.kingmaker === 'shared', `seed ${seed}: default Kingmaker rule`);
  cardConserved(st, `seed ${seed}`);
  tokenConserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.draw.length === 12 && json.remainder.length === 4, `seed ${seed}: JSON round trip`);
}

/* ================================================ card types and the marks */
{
  const aces = BASIC.filter((id) => C.isAce(id));
  const personalities = BASIC.filter((id) => C.isPersonality(id));
  const locations = BASIC.filter((id) => C.cardTypes(id).includes('location'));
  const events = BASIC.filter((id) => C.cardTypes(id).includes('event'));
  check(aces.length === 6, `aces ${aces.length}`);
  check(aces.every((id) => C.cardTypes(id).length === 0 && C.leadType(id) === 'ace'),
    'an Ace leads an Ace trick');
  check(personalities.length === 11, `personalities ${personalities.length}`);
  check(locations.length === 11, `locations ${locations.length}`);
  check(events.length === 11, `events ${events.length}`);
  check(BASIC.every((id) => C.isAce(id) || C.cardTypes(id).length >= 1),
    'every non-Ace card carries a mark');
  check(C.isDual(END) && C.isDual(MARKET) && C.isDual(named('the Origin')),
    'the three ambiguous cards');
  check(!C.isDual(DESERT) && !C.isDual(BATTLE), 'plain cards are not ambiguous');
  check(C.leadType(END) === null, 'a dual card cannot lead without an announcement');
  check(C.leadType(END, 'event') === 'event' && C.leadType(END, 'location') === 'location',
    'the announced type is used');
  check(C.followsType(END, 'location') && C.followsType(END, 'event'),
    'a dual card follows either type');
  check(!C.followsType(CAVE, 'event') && C.followsType(CAVE, 'location'),
    'the Cave is only a Location');
}

/* ============================================== leading, including duals */
{
  let st = pos({ hands: [[END, BATTLE], [SAILOR, CAVE]], turn: 0 });
  throwsWith(() => C.lead(st, END), 'announce', 'leading an ambiguous card unannounced');
  throwsWith(() => C.lead(st, MOUNTAIN), 'not in your hand', 'leading a card you do not hold');
  const s = C.lead(st, END, 'location');
  check(s.trickType === 'location', `type ${s.trickType}`);
  check(s.trick.length === 1 && s.turn === 1 && s.phase === 'follow', 'the lead passes the turn');
  check(s.hands[0].length === 1, 'the card left the hand');
  cardConserved(s, 'after a lead');

  const busy = pos({ hands: [[SAILOR], [CAVE]], trick: [{ player: 0, id: SAILOR }],
    trickType: 'personality', leadId: SAILOR, phase: 'follow', turn: 1 });
  throwsWith(() => C.lead(busy, CAVE), 'still playing', 'leading while a trick is open');
  throwsWith(() => C.playCard({ ...st, phase: 'lead' }, CAVE), 'lead one first',
    'playing a follow while it is time to lead');
}

/* ================== a Personality trick: combined score decides the win */
{
  // p0 leads the Sailor (4) and adds the Lunatic (6) → 10; p1 answers with
  // the Merchant (9) and, void in Personalities, the Cave (0) → 9.
  // The single highest Personality is the Merchant, but the combined score
  // (10 to 9) gives the trick to p0.
  const st = pos({ hands: [[SAILOR, LUNATIC], [MERCHANT, CAVE]], turn: 0 });
  let s = C.lead(st, SAILOR);
  s = C.playCard(s, MERCHANT);
  s = C.playCard(s, LUNATIC);
  s = C.playCard(s, CAVE);
  check(s.lastTrick && s.lastTrick.winner === 0, `winner ${s.lastTrick?.winner} (paper: p0)`);
  check(s.lastTrick.scores.join() === '10,9', `scores ${s.lastTrick.scores} (paper 10/9)`);
  check(s.scores.join() === '10,9', `running scores ${s.scores}`);
  check(s.tricksWon.join() === '1,0', `tricks ${s.tricksWon}`);
  check(s.discards.length === 4, 'the trick went to the discard pile');
  cardConserved(s, 'after a personality trick');
}

/* ================= a Location trick: the dual End follows type */
{
  const st = pos({ hands: [[DESERT, MOUNTAIN], [END, FOREST]], turn: 0 });
  let s = C.lead(st, DESERT);
  s = C.playCard(s, END);            // the Crown of Leaves counts as a Location
  s = C.playCard(s, MOUNTAIN);
  s = C.playCard(s, FOREST);
  check(s.lastTrick.winner === 1, `winner ${s.lastTrick.winner} (paper: p1, the End)`);
  check(s.lastTrick.type === 'location', `type ${s.lastTrick.type}`);
  check(s.lastTrick.scores.join() === '6,15', `scores ${s.lastTrick.scores} (paper 6/15)`);
}

/* ================================ an Event trick: the dual Market follows */
{
  const st = pos({ hands: [[BATTLE, JOURNEY], [MARKET, PACT]], turn: 0 });
  let s = C.lead(st, BATTLE);
  s = C.playCard(s, MARKET);
  s = C.playCard(s, JOURNEY);
  s = C.playCard(s, PACT);
  check(s.lastTrick.winner === 1, `winner ${s.lastTrick.winner} (paper: p1)`);
  check(s.lastTrick.scores.join() === '7,15', `scores ${s.lastTrick.scores} (paper 7/15)`);
  check(s.lastTrick.type === 'event', `type ${s.lastTrick.type}`);
}

/* ================= a tie on combined score: the card that tied it wins */
{
  const st = pos({ hands: [[BATTLE, MARKET], [JOURNEY, CHANCE]], turn: 0 });
  let s = C.lead(st, BATTLE);
  s = C.playCard(s, JOURNEY);
  s = C.playCard(s, MARKET);
  s = C.playCard(s, CHANCE);
  check(s.lastTrick.scores.join() === '10,10', `scores ${s.lastTrick.scores} (paper 10/10)`);
  check(s.lastTrick.winner === 1, `tie goes to the card that tied it (${s.lastTrick.winner})`);
}

/* =========================== Ace tricks: won on rank and suit only */
{
  // the two ways an Ace wins its own trick
  check(C.trickWinner([{ player: 0, id: ACE_WAVES }, { player: 1, id: SEA }],
    'ace', 'waves') === 0, 'the Ace wins when its matching Crown is played');
  check(C.trickWinner([{ player: 0, id: ACE_WAVES }, { player: 1, id: MOUNTAIN }],
    'ace', 'waves') === 0, 'the Ace wins as the only card of its suit');
  check(C.trickWinner([{ player: 0, id: ACE_SUNS }, { player: 1, id: DISCOVERY }],
    'ace', 'suns') === 1, 'a higher card of the Ace suit beats it');
  check(C.trickWinner([{ player: 0, id: ACE_SUNS }, { player: 1, id: DESERT }],
    'ace', 'suns') === 1, 'even the 2 beats an Ace that is not alone');

  // Ace scoring: 1 leading, 11 when the opponent plays the matching Crown,
  // 1 when the leader plays their own, 0 when it does not lead
  check(C.trickScores([{ player: 0, id: ACE_WAVES }, { player: 1, id: CAVE }],
    'ace', 'waves')[0] === 1, 'a lone leading Ace scores 1');
  check(C.trickScores([{ player: 0, id: ACE_WAVES }, { player: 1, id: SEA }],
    'ace', 'waves')[0] === 11, 'the opponent\'s matching Crown makes it 11');
  check(C.trickScores([{ player: 0, id: ACE_SUNS }, { player: 0, id: BARD }],
    'ace', 'suns')[0] === 11, 'leader\'s own Crown: 1 + 10 = 11, the Ace still scores 1');
  check(C.trickScores([{ player: 0, id: BATTLE }, { player: 1, id: ACE_SUNS }],
    'event', null)[1] === 0, 'a non-leading Ace scores zero');
}

/* ---- a full Ace trick where score and rank disagree: rank decides ---- */
{
  // p0 leads the Ace of Waves, p1 the matching Crown (10), p0 the Mill (8),
  // p1 the Darkness (9).  Combined score is 19–19, but the rules say the Ace
  // is the high card once its Crown is in the trick.
  const st = pos({ hands: [[ACE_WAVES, MILL], [SEA, named('the Darkness')]], turn: 0 });
  let s = C.lead(st, ACE_WAVES);
  s = C.playCard(s, SEA);
  s = C.playCard(s, MILL);
  s = C.playCard(s, named('the Darkness'));
  check(s.lastTrick.type === 'ace', `type ${s.lastTrick.type}`);
  check(s.lastTrick.scores.join() === '19,19', `scores ${s.lastTrick.scores} (paper 19/19)`);
  check(s.lastTrick.winner === 0, `winner ${s.lastTrick.winner} (paper: p0, the Ace wins)`);
}

/* =========================== must follow the lead: refusals and voids */
{
  const st = pos({ hands: [[MOUNTAIN], [SAILOR, PACT]], trick: [{ player: 0, id: BATTLE }],
    trickType: 'event', leadId: BATTLE, phase: 'follow', turn: 1 });
  check(C.legalPlays(st).join() === PACT, 'only the Event card is legal');
  check(C.explainPlay(st, SAILOR) != null, 'a Personality is refused on an Event trick');
  check(C.explainPlay(st, PACT) == null, 'the Event card is legal');
  throwsWith(() => C.playCard(st, SAILOR), 'must play an Event card', 'following the wrong type');
  throwsWith(() => C.playCard(st, MOUNTAIN), 'not in your hand', 'a card the player lacks');

  const voidSt = pos({ hands: [[MOUNTAIN], [SAILOR, BARD]], trick: [{ player: 0, id: BATTLE }],
    trickType: 'event', leadId: BATTLE, phase: 'follow', turn: 1 });   // both are Personalities
  check(C.legalPlays(voidSt).length === 2, 'void in the type: any card may be played');
  check(C.explainPlay(voidSt, SAILOR) == null, 'a Personality is fine when you are void');
  const played = C.playCard(voidSt, SAILOR);
  check(played.trick.length === 2, 'the card was played');
  cardConserved(played, 'after a void follow');
}

{
  // an Ace trick is followed by suit, not by type
  const st = pos({ hands: [[ACE_WAVES], [MERCHANT, DISCOVERY]], trick: [{ player: 0, id: ACE_WAVES }],
    trickType: 'ace', trickSuit: 'waves', leadId: ACE_WAVES, phase: 'follow', turn: 1 });
  check(C.legalPlays(st).join() === DISCOVERY, 'only a Waves card fits an Ace of Waves');
  throwsWith(() => C.playCard(st, MERCHANT), 'follow Waves', 'ignoring the Ace\'s suit');
  const voidSt = pos({ hands: [[ACE_WAVES], [MERCHANT, BARD]], trick: [{ player: 0, id: ACE_WAVES }],
    trickType: 'ace', trickSuit: 'waves', leadId: ACE_WAVES, phase: 'follow', turn: 1 });
  check(C.explainPlay(voidSt, MERCHANT) == null, 'void in the Ace suit: anything goes');
}

/* ================================================ shedding the tokens */
function trickWonByP0() {
  // p0 leads the Mill (Location, Waves/Leaves) and adds the Forest (5);
  // p1 is void in Locations and plays two Personalities → 13 to 0.
  const rest = BASIC.filter((id) => ![MILL, FOREST, SAILOR, BARD].includes(id));
  const st = pos({ hands: [[MILL, FOREST], [SAILOR, BARD]], draw: rest.slice(0, 6), turn: 0 });
  let s = C.lead(st, MILL);
  s = C.playCard(s, SAILOR);
  s = C.playCard(s, FOREST);
  s = C.playCard(s, BARD);
  check(s.phase === 'shed', `trick resolved into ${s.phase}`);
  check(s.turn === 0, 'the winner holds the turn');
  return s;
}

{
  const st = trickWonByP0();
  check(st.turn === 0, 'the winner chooses the token');
  const opts = C.shedOptions(st);
  check(opts.length === 2 && opts.every((o) => o.source === 'own'),
    `p0 holds both lead suits: ${JSON.stringify(opts)}`);
  check(C.explainShed(st, 'moons') != null, 'a suit the lead does not name is refused');
  throwsWith(() => C.shedToken(st, 'moons'), 'only a Waves or Leaves token', 'shedding the wrong suit');

  const s = C.shedToken(st, 'waves');
  check(s.tokens[0].waves === 0 && s.supply.waves === 4, 'the token went to the supply');
  check(s.lastShed && s.lastShed.source === 'own' && s.lastShed.suit === 'waves',
    `last shed ${JSON.stringify(s.lastShed)}`);
  check(s.phase === 'lead' && s.turn === 0, 'the winner leads the next trick');
  check(s.hands[0].length === 1 && s.hands[1].length === 1, 'both players drew one card');
  check(s.draw.length === 4, `draw pile ${s.draw.length} (6 - 2)`);
  cardConserved(s, 'after shedding');
  tokenConserved(s, 'after shedding');
}

{
  // p0 holds neither Waves nor Leaves: the penalty comes from p1
  const st = balance(trickWonByP0());
  st.tokens[0].waves = 0;
  st.tokens[0].leaves = 0;
  balance(st);
  const opts = C.shedOptions(st);
  check(opts.length === 2 && opts.every((o) => o.source === 'opponent'),
    `penalty options ${JSON.stringify(opts)}`);
  const s = C.shedToken(st, 'leaves');
  check(s.tokens[1].leaves === 0 && s.tokens[0].leaves === 1, 'p1 lost a token, p0 gained it');
  check(s.supply.leaves === 4, 'the supply is untouched by a penalty take');
  tokenConserved(s, 'after a penalty take');
}

{
  // nobody holds one of the lead suits: take it back out of the supply
  const st = balance(trickWonByP0());
  st.tokens[0].waves = 0; st.tokens[0].leaves = 0;
  st.tokens[1].waves = 0; st.tokens[1].leaves = 0;
  balance(st);
  const opts = C.shedOptions(st);
  check(opts.length === 2 && opts.every((o) => o.source === 'supply'),
    `supply options ${JSON.stringify(opts)}`);
  const s = C.shedToken(st, 'waves');
  check(s.supply.waves === 4 && s.tokens[0].waves === 1, 'the token came from the supply');
  tokenConserved(s, 'after a supply take');
}

{
  // shedding your last token wins the game at once
  const st = balance(trickWonByP0());
  for (const s2 of SUITS) st.tokens[0][s2] = 0;
  st.tokens[0].waves = 1;
  balance(st);
  const s = C.shedToken(st, 'waves');
  check(s.over === 'shed' && s.winner === 0, `over: ${s.over}/${s.winner}`);
  check(s.endReason === 'shed', `reason ${s.endReason}`);
  check(held(s, 0) === 0, 'no tokens left');
  tokenConserved(s, 'the win');
}

/* =================================== the Kingmaker Scenario, both rules */
function kingmakerPos() {
  // p0 has no Waves/Leaves; p1 owns exactly one token, the Waves
  const st = balance(trickWonByP0());
  for (const s2 of SUITS) { st.tokens[0][s2] = 0; st.tokens[1][s2] = 0; }
  st.tokens[0].suns = 1;                 // p0 keeps a token so the game is on
  st.tokens[1].waves = 1;
  balance(st);                           // supply 4 suns, 4 waves, 5 of the rest
  return st;
}

{
  // option 1 (the default): the forced take would empty p1, so the game ends
  // there and p1 — the only possible candidate — takes it
  const st = kingmakerPos();
  check(st.kingmaker === 'shared', 'shared is the default');
  const opts = C.shedOptions(st);
  check(opts.length === 1 && opts[0].source === 'opponent' && opts[0].suit === 'waves',
    `options ${JSON.stringify(opts)}`);
  const s = C.shedToken(st, 'waves');
  check(s.over === 'kingmaker' && s.winner === 1, `over ${s.over}, winner ${s.winner}`);
  check(s.endReason === 'kingmaker' && s.kingmaker === 'shared',
    `reason ${s.endReason}/${s.kingmaker}`);
  check(held(s, 1) === 0 && held(s, 0) === 2, `pools ${held(s, 0)}/${held(s, 1)}`);
  tokenConserved(s, 'kingmaker (shared)');
  cardConserved(s, 'kingmaker (shared)');
}

{
  // option 2: the winner pays the supply instead, and play goes on
  const st = kingmakerPos();
  const s0 = C.setKingmaker(st, 'supply');
  check(s0.kingmaker === 'supply', 'the toggle switches the rule');
  const opts = C.shedOptions(s0);
  // the wiki's own wording for option 2: "would choose a Wave or a Leaf token
  // as his penalty from the supply" — either lead suit, from the supply
  check(opts.length === 2 && opts.every((o) => o.source === 'supply'),
    `options ${JSON.stringify(opts)}`);
  const s = C.shedToken(s0, 'waves');
  check(!s.over, `the game continues (${s.over})`);
  check(s.supply.waves === 3 && s.tokens[0].waves === 1, 'the penalty came out of the supply');
  check(held(s, 1) === 1, 'p1 keeps their token');
  tokenConserved(s, 'kingmaker (supply)');
  cardConserved(s, 'kingmaker (supply)');
  check(s.phase === 'lead' && s.turn === 0, 'the winner leads on');

  // (A supply take can never fail at two players: each player holds at most
  // one token of a suit, so the supply always keeps at least three.)
  check(SUITS.every((x) => s.supply[x] >= 3), 'the supply can never run dry');

  throwsWith(() => C.setKingmaker(st, 'nope'), 'no such Kingmaker rule', 'a bogus rule name');
  check(C.setKingmaker(st, 'shared') === st, 'toggling to the current rule changes nothing');
}

/* ============================================ rounds: draw, reshuffle, dealer */
{
  const st = pos({
    hands: [[MILL, FOREST], [SAILOR, BARD]],
    draw: BASIC.filter((id) => ![MILL, FOREST, SAILOR, BARD].includes(id)).slice(0, 4),
    turn: 0,
  });
  // after the trick both hands are empty but four cards remain in the draw:
  // each draws one, so the round continues with one card each
  let s = C.lead(st, MILL);
  s = C.playCard(s, SAILOR);
  s = C.playCard(s, FOREST);
  s = C.playCard(s, BARD);
  if (s.phase === 'shed') s = C.shedToken(s, SUITS.find((x) => C.shedOptions(s).some((o) => o.suit === x)));
  check(s.round === 1, `still round ${s.round}`);
  check(s.hands[0].length === 1 && s.hands[1].length === 1, `hands ${s.hands[0].length}/${s.hands[1].length}`);
  check(s.draw.length === 2, `draw left ${s.draw.length}`);
  cardConserved(s, 'mid-round draw');
}

{
  // nothing left to draw and both hands empty: the dealer passes, all 36 come back
  const st = pos({
    hands: [[MILL, FOREST], [SAILOR, BARD]],
    draw: [], turn: 0, dealer: 0, round: 1,
  });
  let s = C.lead(st, MILL);
  s = C.playCard(s, SAILOR);
  s = C.playCard(s, FOREST);
  s = C.playCard(s, BARD);
  if (s.phase === 'shed') {
    const opt = C.shedOptions(s)[0];
    s = C.shedToken(s, opt.suit);
  }
  check(s.round === 2, `round ${s.round}`);
  check(s.dealer === 1, `dealer passed: ${s.dealer}`);
  check(s.hands[0].length === 10 && s.hands[1].length === 10, 'fresh hands');
  check(s.draw.length === 12 && s.remainder.length === 4, 'fresh draw and remainder');
  check(s.phase === 'lead' && s.turn === s.leader && s.leader === 0, 'the new dealer\'s left leads');
  check(s.lastEvent.kind === 'round', `event ${s.lastEvent.kind}`);
  cardConserved(s, 'new round');
  tokenConserved(s, 'new round');
}

/* ====================================== random games (300 seeds) */
let movesPlayed = 0, tricksPlayed = 0, roundCount = 0, kings = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = mulberry32(seed * 977 + 13);
  let guard = 0, lastRound = 1;
  while (!st.over && guard++ < 60000) {
    if (st.phase === 'lead') {
      const legal = C.legalPlays(st);
      const id = legal[Math.floor(rng() * legal.length)];
      const announce = C.isDual(id)
        ? (rng() < 0.5 ? 'location' : 'event')
        : undefined;
      st = C.lead(st, id, announce);
    } else if (st.phase === 'follow') {
      const legal = C.legalPlays(st);
      st = C.playCard(st, legal[Math.floor(rng() * legal.length)]);
      if (st.lastTrick) tricksPlayed++;
    } else if (st.phase === 'shed') {
      const opts = C.shedOptions(st);
      st = C.shedToken(st, opts[Math.floor(rng() * opts.length)].suit);
    } else {
      check(false, `seed ${seed}: unexpected phase ${st.phase}`);
      break;
    }
    movesPlayed++;
    cardConserved(st, `seed ${seed} move ${movesPlayed}`);
    tokenConserved(st, `seed ${seed} move ${movesPlayed}`);
    if (st.round !== lastRound) { lastRound = st.round; roundCount++; }
    check(JSON.parse(JSON.stringify(st)).cards.length === 36, `seed ${seed}: JSON round trip`);
  }
  if (!st.over) { check(false, `seed ${seed}: never finished (${guard} moves, round ${st.round})`); continue; }
  check(st.winner === 0 || st.winner === 1, `seed ${seed}: no real winner (${st.winner})`);
  check(st.endReason === 'shed' || st.endReason === 'kingmaker',
    `seed ${seed}: odd end reason ${st.endReason}`);
  if (st.endReason === 'kingmaker') kings++;
  check(held(st, 0) + held(st, 1) + SUITS.reduce((n, s) => n + st.supply[s], 0) === 30,
    `seed ${seed}: tokens lost`);
}
check(movesPlayed > 3000, `only ${movesPlayed} moves played`);
check(tricksPlayed > 2000, `only ${tricksPlayed} tricks played`);
check(roundCount >= 100, `only ${roundCount} reshuffles`);

console.log(`random games: ${movesPlayed} moves, ${tricksPlayed} tricks, ${roundCount} reshuffles, `
  + `${kings} ended in the Kingmaker Scenario`);
console.log(failures === 0 ? 'shed: all tests passed' : `shed: ${failures} failures`);
process.exit(failures ? 1 : 0);

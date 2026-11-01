/* Reino de Ámbar — UI (solo).  The rules live in reino-de-ambar-core.js. */

import { mountGame, D } from '../gamikit.js';
import * as C from './reino-de-ambar-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const SUIT_NAME = D.SUIT_NAME;
const AREA_NAME = ['the Excuse', ...C.MIDDLE_IDS.map((id) => data.byId[id].name), 'the Borderland'];
const RECURSIVE = ['the-penitent', 'the-chance-meeting'];

let ui = { mode: 'idle', hand: null, suit: null, area: null };
let autoPlaying = false;              // re-entrancy guard for the dummy's auto-play
let autoPending = false;              // one deferred auto-play tick at a time
const myTurn = (state) => !state.over && (state.phase === 'my-action' || state.phase === 'my-resolve');

const api = mountGame({
  id: 'reino-de-ambar',
  title: 'Reino de Ámbar',
  subtitle: 'hold the kingdom — solo',
  rules: '../rules/reino-de-ambar.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    scheduleAutoPlay();
    if (ui.hand != null && !state.hands.me[ui.hand]) reset();
    api.table.textContent = '';
    api.table.appendChild(boardEl(state));
    api.table.appendChild(problemsEl(state));
    api.table.appendChild(handEl(state));
    api.table.appendChild(actionsEl(state));

    const hint = document.createElement('p');
    hint.className = 'rn-hint';
    hint.textContent = hintFor(state);
    api.table.appendChild(hint);

    api.setStatus(
      `<strong>Round ${Math.min(state.round, C.ROUNDS)}/7</strong> · gold <strong>${state.gold.me}</strong>/4` +
      ` · markers <strong>${state.supply.me}</strong> · PV <strong>${state.pv.me.length}</strong>` +
      ` · barbarians <strong>${state.barbarians}</strong>` +
      (state.confidente != null ? ` · Confidente: ${AREA_NAME[state.confidente]}` : '') +
      (state.log ? `<br><span class="muted">${state.log}</span>` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    const defense = state.board[7].me;
    return {
      title: o.title,
      cls: o.cls,
      score: state.score,
      body: `<p>${state.log}</p>` +
        `<p class="muted">Barbarian power ${state.barbarians} · frontier defence ${defense} · ` +
        `attack threshold ${Math.max(0, C.MAX_BARBARIANS - state.barbarians + defense)}.</p>`,
    };
  },

  record: (state) => ({ win: state.over === 'won', score: state.score }),
});

function reset() { ui = { mode: 'idle', hand: null, suit: null, area: null }; }

/* ------------------------------------------------ auto-play the dummy */

/** Deferred: the first render happens inside mountGame, before `api` exists. */
function scheduleAutoPlay() {
  if (autoPending) return;
  autoPending = true;
  setTimeout(() => { autoPending = false; autoPlay(api.state); }, 0);
}

function autoPlay(state) {
  if (autoPlaying) return;
  autoPlaying = true;
  try {
    let guard = 0;
    while (!state.over && guard++ < 8) {
      let mv = null;
      if (state.phase === 'dummy-action') {
        try { mv = C.dummyActionMove(state); } catch { mv = null; }
      } else if (state.phase === 'dummy-resolve') {
        mv = C.dummyResolveMove(state) || { type: 'pass', who: 'dummy' };
      }
      if (!mv) return;
      try {
        api.setState(C.applyMove(state, mv));
        state = api.state;
      } catch (err) {
        console.warn('dummy move failed', err);
        return;
      }
    }
  } finally {
    autoPlaying = false;
  }
}

/* --------------------------------------------------------------- board */

function boardEl(state) {
  const grid = document.createElement('div');
  grid.className = 'rn-board';
  // the wiki's layout: the Excuse | 1 2 3 | the Borderland
  //                     (blank)    | 4 5 6 | (blank)
  const cells = [
    { i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 7 },
    { empty: true }, { i: 4 }, { i: 5 }, { i: 6 }, { empty: true },
  ];
  for (const c of cells) {
    const cell = document.createElement('div');
    cell.className = 'rn-cell';
    if (c.empty) { grid.appendChild(cell); continue; }
    const i = c.i;
    const id = state.areas[i];
    const el = D.cardEl({ ...data.byId[D.baseId(id)], id }, { tag: 'div', static: true, eager: i === 0 || i === 7 });
    cell.appendChild(el);

    if (i === 0) {
      const die = document.createElement('span');
      die.className = 'rn-die';
      die.textContent = String(state.barbarians);
      die.setAttribute('aria-label', `barbarian power ${state.barbarians} of 6`);
      cell.appendChild(die);
    } else {
      for (const who of ['me', 'dummy']) {
        const n = state.board[i][who];
        if (!n) continue;
        const b = document.createElement('span');
        b.className = `rn-marker rn-${who}`;
        b.textContent = String(n);
        b.setAttribute('aria-label', `${n} ${who === 'me' ? 'yours' : 'dummy'} markers on ${AREA_NAME[i]}`);
        cell.appendChild(b);
      }
    }
    if (state.confidente === i) {
      const cf = document.createElement('span');
      cf.className = 'rn-confidente';
      cf.textContent = 'C';
      cf.setAttribute('aria-label', 'the Confidente is here');
      cell.appendChild(cf);
    }

    cell.setAttribute('aria-label',
      `${AREA_NAME[i]}: ${C.areaSuits(state, i).map((s) => SUIT_NAME[s]).join(', ') || 'barbarian power'} · ` +
      `you ${state.board[i].me}, dummy ${state.board[i].dummy}` +
      (state.confidente === i ? ' · Confidente' : ''));

    if (myTurn(state) && ui.suit != null && i >= 1 && C.areaSuits(state, i).includes(ui.suit)) {
      cell.classList.add(ui.mode === 'area' ? 'is-legal' : 'is-suggested');
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;
      const go = () => onArea(state, i);
      cell.addEventListener('click', go);
      cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    } else {
      cell.addEventListener('click', () => {
        if (!myTurn(state)) return;
        api.toast(`${AREA_NAME[i]} — ${C.areaSuits(state, i).map((s) => SUIT_NAME[s]).join(', ') || 'no symbols'}.`);
      });
    }
    grid.appendChild(cell);
  }
  return grid;
}

/* ------------------------------------------------------------ problems */

function problemsEl(state) {
  const p = document.createElement('section');
  p.className = 'panel';
  p.innerHTML = `<h2>Problems of the Realm <span class="count">${state.problems.length}</span></h2>`;
  const row = document.createElement('div');
  row.className = 'cardrow rn-problems';

  state.problems.forEach((pid, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'rn-problem';
    const c = data.byId[D.baseId(pid)];
    const el = D.cardEl({ ...c, id: pid }, { tag: 'div', static: true, eager: true });
    wrap.appendChild(el);
    const info = document.createElement('div');
    info.className = 'rn-problem-meta';
    const pv = C.pvOf(pid);
    info.innerHTML = C.symbolsOf(pid).map((s) =>
      s === 'rank' ? `<span class="oc-badge">${pv} PV</span>`
        : s === 'crown' ? '<span class="oc-badge">Confidente</span>'
          : `<img class="rn-suiticon" src="${D.url(`cards/icons/suits/${s}.png`)}" alt="${SUIT_NAME[s]}">`
    ).join(' ');
    const sums = document.createElement('div');
    sums.className = 'muted';
    sums.textContent = `presence — you ${C.presenceSum(state, 'me', pid)}, dummy ${C.presenceSum(state, 'dummy', pid)}`;
    info.appendChild(sums);
    wrap.appendChild(info);

    if (state.phase === 'my-resolve' && !state.over) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small' + (state.gold.me >= 1 ? ' primary' : ' is-off');
      b.textContent = state.gold.me >= 1 ? 'Attempt (1 gold)' : 'Need 1 gold';
      b.addEventListener('click', () => attemptProblem(state, idx, pid));
      wrap.appendChild(b);
    }
    row.appendChild(wrap);
  });
  if (!state.problems.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No Problems are face up.';
    row.appendChild(e);
  }
  p.appendChild(row);
  return p;
}

/* ---------------------------------------------------------------- hand */

function handEl(state) {
  const p = document.createElement('section');
  p.className = 'panel';
  const dummyTop = state.discards.dummy[state.discards.dummy.length - 1];
  p.innerHTML = `<h2>Your family <span class="count">${state.hands.me.length} cards</span>` +
    (dummyTop ? ` <span class="muted">· dummy last played ${data.byId[D.baseId(dummyTop)].name}</span>` : '') +
    `</h2>`;
  const row = document.createElement('div');
  row.className = 'cardrow rn-hand';
  state.hands.me.forEach((id, i) => {
    const el = D.cardEl({ ...data.byId[D.baseId(id)], id }, {
      selected: ui.hand === i, eager: i < 4,
      cls: ui.hand != null && ui.hand !== i ? 'is-dim' : '',
    });
    el.setAttribute('aria-label', `${D.describe(data.byId[D.baseId(id)])} in hand`);
    el.addEventListener('click', () => onHand(state, i));
    row.appendChild(el);
  });
  if (!state.hands.me.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Your action hand is spent — the year is ending.';
    row.appendChild(e);
  }
  p.appendChild(row);
  return p;
}

/* ------------------------------------------------------------ controls */

function actionsEl(state) {
  const bar = document.createElement('div');
  bar.className = 'btnrow rn-actions';

  if (state.phase === 'my-resolve' && !state.over) {
    mkBtn(bar, 'Pass this round', true, '', () => act(state, { type: 'pass', who: 'me' }));
    return bar;
  }
  if (state.phase !== 'my-action' || state.over) return bar;

  const id = ui.hand != null ? state.hands.me[ui.hand] : null;
  if (id != null && ui.suit == null) {
    for (const s of C.card(id).suits) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.appendChild(document.createTextNode(`${SUIT_NAME[s]} `));
      b.appendChild(D.suitChip(s));
      b.addEventListener('click', () => { ui.suit = s; ui.mode = 'area'; api.refresh(); });
      bar.appendChild(b);
    }
  }
  if (ui.suit != null) {
    mkBtn(bar, 'Cancel', true, '', () => { reset(); api.refresh(); });
  }
  if (id == null) {
    const b = document.createElement('span');
    b.className = 'oc-muted';
    b.textContent = 'Tap a card to play it as an action.';
    bar.appendChild(b);
  }
  return bar;
}

function mkBtn(bar, label, ready, why, fn, cls = 'small') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}` + (ready ? '' : ' is-off');
  b.textContent = label;
  if (!ready) b.setAttribute('aria-disabled', 'true');
  b.addEventListener('click', () => { ready ? fn() : api.toast(why()); });
  bar.appendChild(b);
  return b;
}

/* ------------------------------------------------------------ the flow */

function onHand(state, i) {
  if (!myTurn(state)) return;
  if (state.phase !== 'my-action') { api.toast('Actions are taken first — resolve Problems after.'); return; }
  if (ui.hand === i) { reset(); api.refresh(); return; }
  ui = { mode: 'idle', hand: i, suit: null, area: null };
  api.refresh();
}

async function onArea(state, i) {
  if (state.phase !== 'my-action' || ui.hand == null || ui.suit == null) return;
  try {
    const move = { type: 'area', who: 'me', hand: ui.hand, suit: ui.suit, area: i };
    const drained = [];
    const withMarker = await withMarkerSource(state, i, move, 0, drained);
    withMarker.spec = await effectFlow(state, i, 0,
      state.confidente != null ? [state.confidente] : [], [], 1, drained);
    reset();
    act(state, withMarker);
  } catch (err) {
    if (err && err.message === 'cancel') { reset(); api.refresh(); return; }
    api.toast(err.message);
    api.setStatus(err.message, true);
  }
}

async function attemptProblem(state, idx, pid) {
  try {
    const symbol = await choose(`How do you resolve ${data.byId[D.baseId(pid)].name}?`,
      C.symbolsOf(pid).map((s) => ({
        label: s === 'rank' ? `Take ${C.pvOf(pid)} PV` : s === 'crown' ? 'Move the Confidente' : SUIT_NAME[s],
        value: s,
      })));
    const resolution = { symbol };
    const drained = [];
    if (symbol === 'crown') {
      const used = state.confidente != null ? [state.confidente] : [];
      const areas = [];
      for (let a = 1; a <= 7; a++) if (!used.includes(a)) areas.push(a);
      resolution.confidenteTo = await choose('Where does the Confidente go?',
        areas.map((a) => ({ label: AREA_NAME[a], value: a })));
      // its effect runs one level below the resolution — one level deeper
      // than a plain area action
      resolution.spec = await effectFlow(state, resolution.confidenteTo, 1,
        [...used, resolution.confidenteTo], [], 1, drained);
    } else if (symbol !== 'rank') {
      const areas = [];
      for (let a = 1; a <= 7; a++) if (C.areaSuits(state, a).includes(symbol)) areas.push(a);
      resolution.area = await choose(`Which ${SUIT_NAME[symbol]} area?`,
        areas.map((a) => ({ label: AREA_NAME[a], value: a })));
      const marked = await withMarkerSource(state, resolution.area, {}, 0, drained);
      if (marked.moveFrom != null) resolution.moveFrom = marked.moveFrom;
      resolution.spec = await effectFlow(state, resolution.area, 1,
        state.confidente != null ? [state.confidente] : [], [], 1, drained);
    }
    act(state, { type: 'attempt', who: 'me', problem: idx, resolution });
  } catch (err) {
    if (err && err.message === 'cancel') { api.refresh(); return; }
    api.toast(err.message);
    api.setStatus(err.message, true);
  }
}

/** When the chain's placements outrun the reserve, the rules force a marker
 *  in from elsewhere.  `placed` counts placements this chain has already
 *  committed; `drained` collects the areas the chain pulls from. */
async function withMarkerSource(state, area, move, placed, drained) {
  if (state.supply.me > placed) return move;
  const areas = [];
  for (let a = 1; a <= 7; a++) {
    const needed = drained.filter((x) => x === a).length;
    if (a !== area && state.board[a].me > needed) areas.push(a);
  }
  if (!areas.length) throw new Error('You have no markers left anywhere to place.');
  const src = await choose('No markers in reserve — move one from where?',
    areas.map((a) => ({ label: `${AREA_NAME[a]} (${state.board[a].me})`, value: a })));
  drained.push(src);
  move.moveFrom = src;
  return move;
}

/** The sub-choices an area's effect needs; returns the spec (or undefined).
 *
 *  `depth` guards the engine's three-level chain limit (counting resolution
 *  steps, which the engine interleaves); `placed` counts marker placements
 *  this chain has committed; `drained` lists areas the chain pulls markers
 *  from; `confidenteUsed` / `problemsUsed` stop the chain from reusing a
 *  Confidente position or a Problem. */
async function effectFlow(state, area, depth, confidenteUsed, problemsUsed, placed, drained) {
  if (depth > 3) throw new Error('That chain of effects nests too deeply.');
  const id = state.areas[area];
  // the engine interleaves a resolution step: a sub-target's own effect runs
  // two levels below a Penitent's and one below a Chance Meeting's, so only
  // non-recursive areas are offered from a Penitent, and a Chance Meeting
  // destination may recurse only when it is the chain's first level
  const subTargetOk = (a, base) =>
    !RECURSIVE.includes(state.areas[a]) || base === 0;

  if (id === 'the-penitent') {
    if (state.gold.me < 1) throw new Error("The Penitent's resolution costs 1 gold and you have none.");
    if (!state.problems.length) throw new Error('There is no Problem left to resolve.');
    const open = state.problems.filter((pid) => !problemsUsed.includes(pid));
    if (!open.length) throw new Error('Every remaining Problem is already spoken for in this chain.');
    const problem = await choose('Which Problem does the Penitent resolve?',
      open.map((pid) => ({
        label: `${data.byId[D.baseId(pid)].name}${C.pvOf(pid) ? ` — ${C.pvOf(pid)} PV` : ''}`,
        value: pid,
      })));
    const symbol = await choose('How is it resolved?',
      C.symbolsOf(problem).map((s) => ({
        label: s === 'rank' ? `Take ${C.pvOf(problem)} PV` : s === 'crown' ? 'Move the Confidente' : SUIT_NAME[s],
        value: s,
      })));
    const sub = { problem, resolution: { symbol } };
    const usedProblems = [...problemsUsed, problem];
    if (symbol === 'crown') {
      const used = [...confidenteUsed];
      if (state.confidente != null && !used.includes(state.confidente)) used.push(state.confidente);
      const areas = [];
      for (let a = 1; a <= 7; a++) if (!used.includes(a) && subTargetOk(a, 1)) areas.push(a);
      if (!areas.length) throw new Error('The Confidente has nowhere left to move.');
      sub.resolution.confidenteTo = await choose('Where does the Confidente go?',
        areas.map((a) => ({ label: AREA_NAME[a], value: a })));
      sub.resolution.spec = await effectFlow(state, sub.resolution.confidenteTo, depth + 2,
        [...used, sub.resolution.confidenteTo], usedProblems, placed, drained);
    } else if (symbol !== 'rank') {
      const areas = [];
      for (let a = 1; a <= 7; a++) {
        if (C.areaSuits(state, a).includes(symbol) && subTargetOk(a, 1)) areas.push(a);
      }
      if (!areas.length) throw new Error('No matching area can be reached from this depth of the chain.');
      sub.resolution.area = await choose(`Which ${SUIT_NAME[symbol]} area?`,
        areas.map((a) => ({ label: AREA_NAME[a], value: a })));
      const marked = await withMarkerSource(state, sub.resolution.area, {}, placed, drained);
      if (marked.moveFrom != null) sub.resolution.moveFrom = marked.moveFrom;
      sub.resolution.spec = await effectFlow(state, sub.resolution.area, depth + 2,
        confidenteUsed, usedProblems, placed + 1, drained);
    }
    return { penitent: sub };
  }

  if (id === 'the-cave') {
    const areas = [];
    for (let a = 1; a <= 7; a++) if (state.board[a].dummy > 0) areas.push(a);
    if (!areas.length) throw new Error('The dummy has no marker anywhere to remove.');
    const target = await choose('Remove a dummy marker from where?',
      areas.map((a) => ({ label: `${AREA_NAME[a]} (${state.board[a].dummy})`, value: a })));
    return { caveTarget: target };
  }

  if (id === 'the-chance-meeting') {
    const own = [];
    for (let a = 1; a <= 7; a++) {
      const needed = drained.filter((x) => x === a).length;
      if (state.board[a].me > needed) own.push(a);
    }
    if (!own.length && state.supply.me <= drained.length) throw new Error('You have no markers to move.');
    const src = own.length
      ? await choose('Move your markers from where?',
        own.map((a) => ({ label: `${AREA_NAME[a]} (${state.board[a].me})`, value: a })))
      : area;
    // the destination executes its effect one level deeper; only offer areas
    // whose effects do not recurse (the engine allows no more levels here)
    const dests = [];
    for (let a = 1; a <= 7; a++) {
      if (a === src || a === area) continue;
      if (!subTargetOk(a, depth)) continue;
      dests.push(a);
    }
    if (!dests.length) throw new Error('No destination area is left for the Chance Meeting.');
    const dest = await choose('… to which area? (its action executes there)',
      dests.map((a) => ({ label: AREA_NAME[a], value: a })));
    const have = src === area ? state.board[area].me + Math.max(0, state.supply.me - drained.length) : state.board[src].me;
    const count = have >= 2
      ? await choose('How many markers move?', [{ label: '2', value: 2 }, { label: '1', value: 1 }])
      : 1;
    const spec = { chanceSrc: src, chanceDest: dest, chanceCount: count };
    spec.destSpec = await effectFlow(state, dest, depth + 1, confidenteUsed, problemsUsed, placed, drained);
    return spec;
  }

  return undefined;                                   // Lunatic / Market / Castle / Borderland
}

/* ------------------------------------------------------------- plumbing */

function choose(title, options) {
  return new Promise((resolve, reject) => {
    const body = document.createElement('div');
    body.className = 'btnrow rn-choose';
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = o.label;
      b.addEventListener('click', () => { oclose.close(); resolve(o.value); });
      body.appendChild(b);
    }
    const oclose = api.overlay({
      title, body,
      actions: [{ label: 'Cancel', onClick: () => reject(new Error('cancel')) }],
    });
  });
}

function act(state, move) {
  let next;
  try {
    next = C.applyMove(state, move);
  } catch (err) {
    api.toast(err.message);
    api.setStatus(err.message, true);
    return;
  }
  api.pushHistory();
  api.setState(next);
}

function hintFor(state) {
  if (state.over) return '';
  if (state.phase === 'dummy-action' || state.phase === 'dummy-resolve') return 'The dummy player is acting…';
  if (state.phase === 'my-resolve') {
    return 'Problems of the Realm: attempt one (1 gold, presence decides) or pass. ' +
      'Unresolved Problems raise the barbarians.';
  }
  if (ui.hand != null && ui.suit == null) return 'Pick which symbol of the card to act with.';
  if (ui.suit != null) return `Tap a glowing area that shows ${SUIT_NAME[ui.suit]} to play there.`;
  return 'Tap a card, pick a symbol, then an area. Borderland markers defend you at year’s end.';
}

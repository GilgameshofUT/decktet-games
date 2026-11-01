/* Thricewise — UI.  Two players, one device: each turn both choose a card
   behind the pass screen, then both choices are revealed together and laid
   into the 6x6 grid, lowest rank first. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './thricewise-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let heldBy = null;        // 0-based player holding the device, or null
let passShown = false;
let passOverlay = null;
let lastSeed = null;
let selected = null;      // the chooser's tapped card, not locked in yet

const cardOf = (id) => ({ ...data.byId[D.baseId(id)], id });
const nameOf = (id) => data.byId[D.baseId(id)].name;

/** Who has to act now (-1 = nobody needs the device: recap / game over). */
function actor(state) {
  if (state.over || state.phase === 'recap') return -1;
  if (state.phase === 'choose') return state.choosing;
  if (state.phase === 'place') return state.queue[0].player;
  return -1;
}

const api = mountGame({
  id: 'thricewise',
  title: 'Thricewise',
  subtitle: 'choose together, score three in a row',
  rules: '../rules/thricewise.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (state.seed !== lastSeed) {
      lastSeed = state.seed; heldBy = null; passShown = false; selected = null;
    }

    const table = document.createElement('div');
    table.className = 'tw-table';

    table.appendChild(scorepad(state));
    table.appendChild(gridEl(state));

    if (state.deferred[0].length || state.deferred[1].length) {
      table.appendChild(deferredStrip(state));
    }
    if (state.phase === 'choose') table.appendChild(handPanel(state, api));
    if (state.phase === 'place') table.appendChild(placePanel(state));
    if (state.phase === 'recap') table.appendChild(recapPanel(state, api));

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- subtitle + status ---- */
    api.setSubtitle(subtitleOf(state));
    api.setStatus(statusOf(state), false);

    /* ---- the hand-off ---- */
    if (state.over && passOverlay) { passOverlay.close(); passOverlay = null; passShown = false; }
    const need = actor(state);
    if (!state.over && need >= 0 && heldBy !== need && !passShown) showPass(need, api);
  },

  endOf(state) {
    if (!state.over) return null;
    const [a, b] = state.scores;
    const pad = `<p class="muted">Player 1 — ${a} · Player 2 — ${b}</p>`;
    if (a === b) {
      return {
        title: 'A tie', cls: '', score: a,
        body: `<p>Both yeggs finish on ${a} points after ${state.log.length} turns.</p>${pad}`,
      };
    }
    const w = a > b ? 0 : 1;
    return {
      title: `Player ${w + 1} wins`, cls: 'win', score: state.scores[w],
      body: `<p>Three in a row: ${state.scores[w]} points after ${state.log.length} turns.</p>${pad}`,
    };
  },

  record: (state) => ({
    played: 1, win: null,
    score: state.over ? Math.max(...state.scores) : null,
  }),
});

/* --------------------------------------------------------------- pieces */

function subtitleOf(state) {
  if (state.over) return 'the grid is full';
  if (state.phase === 'recap') return `turn ${state.turn} revealed`;
  if (state.phase === 'place') return `Player ${state.queue[0].player + 1} lays a card`;
  return `Player ${state.choosing + 1} to choose`;
}

function statusOf(state) {
  if (state.over) {
    return `<strong>Game over.</strong> Player ${state.scores[0] >= state.scores[1] ? 1 : 2} finishes on ${Math.max(...state.scores)}.`;
  }
  if (state.phase === 'recap') {
    const last = state.log[state.log.length - 1];
    if (last.deferred) {
      return `<strong>Turn ${state.turn}:</strong> both cards showed rank ${C.rankLabel(C.rankOf(last.picks[0]))} — both are deferred, face up.`;
    }
    const pts = [0, 0];
    for (const p of last.placements) pts[p.player] += p.points;
    return `<strong>Turn ${state.turn} over.</strong> Player 1 scored ${pts[0]}, Player 2 scored ${pts[1]} — now ${state.scores[0]}–${state.scores[1]}. Pass on when ready.`;
  }
  if (state.phase === 'place') {
    const head = state.queue[0];
    const who = `Player ${head.player + 1}`;
    if (heldBy !== head.player) return `<strong>${who} lays ${nameOf(head.id)}.</strong> Pass the device on.`;
    return `<strong>${who}:</strong> tap a glowing square for ${nameOf(head.id)} — it must touch the grid and keep it within 6×6.`;
  }
  const who = `Player ${state.choosing + 1}`;
  if (heldBy !== state.choosing) return `<strong>${who} to choose.</strong> Pass the device on, then reveal the hand.`;
  const lead = state.deferred[state.choosing].length
    ? ` You also have ${state.deferred[state.choosing].length} deferred card(s) to lay with it.` : '';
  return `<strong>${who}:</strong> pick one card and lay it face down. Both choices are revealed together.${lead}`;
}

/* ---- the scorepad: totals plus one row per turn ---- */

function scorepad(state) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.innerHTML = `Scorepad<span class="count">${state.scores[0]}–${state.scores[1]}</span>`;
  panel.appendChild(h);

  const who = actor(state) >= 0 ? actor(state) : (state.phase === 'recap' ? -1 : state.choosing);
  const totals = document.createElement('div');
  totals.className = 'tw-totals';
  for (let p = 0; p < 2; p++) {
    const s = document.createElement('span');
    s.className = (who === p ? 'on' : '');
    s.innerHTML = `Player ${p + 1} · <b>${state.scores[p]}</b>`;
    totals.appendChild(s);
  }
  panel.appendChild(totals);

  if (state.log.length) {
    const rows = document.createElement('div');
    rows.className = 'tw-rows';
    for (const entry of state.log.slice(-6).reverse()) {
      const row = document.createElement('div');
      row.className = 'tw-row';
      if (entry.deferred) {
        row.innerHTML = `<b>T${entry.turn}</b><span class="tw-defer">both deferred · rank ${C.rankLabel(C.rankOf(entry.picks[0]))}</span>`;
      } else {
        const pts = [0, 0];
        for (const p of entry.placements) pts[p.player] += p.points;
        row.innerHTML = `<b>T${entry.turn}</b><span>P1 +${pts[0]} · P2 +${pts[1]}</span>` +
          `<i>${entry.scores[0]}–${entry.scores[1]}</i>`;
      }
      rows.appendChild(row);
    }
    panel.appendChild(rows);
  }
  return panel;
}

/* ---- the 6x6 (floating) grid ---- */

function gridEl(state) {
  const wrap = document.createElement('div');
  wrap.className = 'tw-gridwrap';

  const b0 = C.bounds(state.grid);
  const placing = state.phase === 'place' && !state.over;
  const canTap = placing && heldBy === state.queue[0].player;
  const legalList = canTap ? C.legalCells(state) : [];
  const legal = new Set(legalList.map((x) => C.cellKey(x.r, x.c)));

  // the window shows the cards AND the squares they may grow into
  const b = { ...b0 };
  for (const { r, c } of legalList) {
    b.minR = Math.min(b.minR, r); b.maxR = Math.max(b.maxR, r);
    b.minC = Math.min(b.minC, c); b.maxC = Math.max(b.maxC, c);
  }
  const height = b.maxR - b.minR + 1;
  const width = b.maxC - b.minC + 1;

  const fresh = new Set();
  if (state.phase === 'recap' || (state.phase === 'place' && state.turnPlacements.length)) {
    for (const p of state.turnPlacements) fresh.add(C.cellKey(p.r, p.c));
  }

  const grid = document.createElement('div');
  grid.className = 'tw-grid';
  grid.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
  grid.style.maxWidth = `min(100%, ${width * 68 + (width - 1) * 3}px)`;
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'the grid');

  const filled = C.gridMap(state.grid);
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const r = b.minR + i, c = b.minC + j, key = C.cellKey(r, c);
      const cell = document.createElement('div');
      cell.className = 'tw-cell';
      const id = filled.get(key);
      if (id) {
        cell.appendChild(D.cardEl(cardOf(id), { tag: 'div', static: true, eager: fresh.has(key) }));
        cell.setAttribute('aria-label', D.describe(data.byId[D.baseId(id)]));
        if (fresh.has(key)) cell.classList.add('is-new');
      } else if (legal.has(key)) {
        cell.classList.add('is-legal');
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', `Empty square, row ${i + 1} column ${j + 1}: lay the card here`);
        const tap = () => doPlace(state, r, c);
        cell.addEventListener('click', tap);
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
        });
      } else {
        cell.classList.add('is-empty');
        cell.setAttribute('aria-label', `Empty square, row ${i + 1} column ${j + 1}`);
        cell.addEventListener('click', () => {
          if (placing && canTap) apiRef.toast('That square does not touch the grid — or it would make the grid bigger than 6×6.');
        });
      }
      grid.appendChild(cell);
    }
  }
  wrap.appendChild(grid);
  return wrap;
}

/* ---- deferred cards, face up in front of their player ---- */

function deferredStrip(state) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Deferred, face up';
  panel.appendChild(h);
  for (let p = 0; p < 2; p++) {
    if (!state.deferred[p].length) continue;
    const line = document.createElement('div');
    line.className = 'tw-deferred';
    const label = document.createElement('span');
    label.textContent = `Player ${p + 1}`;
    line.appendChild(label);
    const row = document.createElement('div');
    row.className = 'cardrow';
    for (const id of state.deferred[p]) row.appendChild(D.cardEl(cardOf(id), { tag: 'div', static: true }));
    line.appendChild(row);
    panel.appendChild(line);
  }
  return panel;
}

/* ---- the choosing player's hand ---- */

function handPanel(state, api) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const mine = heldBy === state.choosing;
  const h = document.createElement('h2');
  const count = mine ? `${state.hands[state.choosing].length} cards` : 'hidden';
  h.innerHTML = `Player ${state.choosing + 1}'s hand<span class="count">${count}</span>`;
  panel.appendChild(h);

  const row = document.createElement('div');
  row.className = 'cardrow';
  if (mine) {
    for (const id of state.hands[state.choosing]) {
      row.appendChild(D.cardEl(cardOf(id), {
        cls: selected === id ? 'is-selected' : '',
        onPick: () => { selected = id; api.refresh(); },
      }));
    }
    if (!state.hands[state.choosing].length) row.appendChild(D.el('div', 'empty', 'No cards left.'));
  } else {
    row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
  }
  panel.appendChild(row);

  if (mine) {
    const actions = document.createElement('div');
    actions.className = 'btnrow';
    actions.appendChild(btn('Lay it face down', () => {
      if (!selected) { api.toast('Tap a card in your hand first, then lay it face down.'); return; }
      const id = selected;
      selected = null;
      api.pushHistory();
      api.setState(C.choose(state, state.choosing, id));
    }));
    panel.appendChild(actions);
  }
  return panel;
}

/* ---- laying the revealed cards, one at a time ---- */

function placePanel(state) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const head = state.queue[0];
  const mine = heldBy === head.player;
  const h = document.createElement('h2');
  h.innerHTML = `Laying ${nameOf(head.id)}<span class="count">Player ${head.player + 1}</span>`;
  panel.appendChild(h);

  const row = document.createElement('div');
  row.className = 'cardrow';
  row.appendChild(D.cardEl(cardOf(head.id), { tag: 'div', static: true, eager: true }));
  if (state.queue[1]) {
    const next = D.cardEl(cardOf(state.queue[1].id), { tag: 'div', static: true, cls: 'is-dim' });
    row.appendChild(next);
  }
  panel.appendChild(row);

  const note = document.createElement('p');
  note.className = 'tw-note';
  note.textContent = mine
    ? 'Tap a glowing square. Each card scores every three in a row it completes.'
    : `Pass the device to Player ${head.player + 1}.`;
  panel.appendChild(note);
  return panel;
}

/* ---- the reveal: what both players chose and what it scored ---- */

function recapPanel(state, api) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const entry = state.log[state.log.length - 1];
  const h = document.createElement('h2');
  h.innerHTML = state.over
    ? 'Last turn'
    : `Turn ${state.turn} revealed<span class="count">${state.scores[0]}–${state.scores[1]}</span>`;
  panel.appendChild(h);

  const picks = document.createElement('div');
  picks.className = 'tw-picks';
  for (let p = 0; p < 2; p++) {
    const box = document.createElement('div');
    box.className = 'tw-pick';
    const label = document.createElement('span');
    label.textContent = `Player ${p + 1} chose`;
    box.appendChild(label);
    box.appendChild(D.cardEl(cardOf(entry.picks[p]), { tag: 'div', static: true, eager: true }));
    picks.appendChild(box);
  }
  panel.appendChild(picks);

  const list = document.createElement('div');
  list.className = 'tw-events';
  if (entry.deferred) {
    const line = document.createElement('p');
    line.textContent = `Same rank (${C.rankLabel(C.rankOf(entry.picks[0]))}): both cards are deferred, face up, and may be played later.`;
    list.appendChild(line);
  } else {
    for (const p of entry.placements) {
      const line = document.createElement('p');
      const scored = p.points
        ? ` — scores ${p.points}: ${C.describePlacement(p)}`
        : ' — scores nothing.';
      line.innerHTML = `Player ${p.player + 1} laid <strong>${nameOf(p.id)}</strong>${scored}`;
      list.appendChild(line);
    }
    if (!entry.drew) {
      const line = document.createElement('p');
      line.className = 'muted';
      line.textContent = 'Not enough cards left for both — nobody drew.';
      list.appendChild(line);
    }
  }
  panel.appendChild(list);

  if (!state.over) {
    const actions = document.createElement('div');
    actions.className = 'btnrow';
    actions.appendChild(btn(`Pass to Player 1 — next turn`, () => {
      api.pushHistory();
      api.setState(C.beginTurn(state));
    }, 'primary'));
    panel.appendChild(actions);
  }
  return panel;
}

/* --------------------------------------------------------------- helpers */

const apiRef = { toast: (m) => api.toast(m) };

function btn(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function doPlace(state, r, c) {
  try {
    api.setState(C.place(state, r, c));
  } catch (err) {
    api.toast(err.message);
  }
}

function showPass(player, api) {
  passShown = true;
  passOverlay = passDevice(player + 1, () => {
    heldBy = player;
    passShown = false;
    passOverlay = null;
    selected = null;
    api.refresh();
  });
}

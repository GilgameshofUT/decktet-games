/* Quetinny — UI.  The rules live in quetinny-core.js. */

import { mountGame, D } from '../gamikit.js';
import * as C from './quetinny-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const SUIT_NAME = D.SUIT_NAME;

let ui = { mode: 'idle', hand: null, suit: null, place: null };

const api = mountGame({
  id: 'quetinny',
  title: 'Quetinny',
  subtitle: 'trade routes, spice, taxes',
  rules: '../rules/quetinny.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (ui.hand != null && !state.hand[ui.hand]) reset();
    api.table.textContent = '';
    api.table.appendChild(chipStrip(state));
    api.table.appendChild(board(state));
    api.table.appendChild(handPanel(state));
    api.table.appendChild(actionBar(state));

    const hint = document.createElement('p');
    hint.className = 'q-hint';
    hint.textContent = hintFor(state);
    api.table.appendChild(hint);

    api.setStatus(
      `<strong>${state.gold}</strong> gold · spice <strong>${state.spice}</strong>/${C.SPICE_MAX}` +
      ` · deck <strong>${state.deck.length}</strong> · hand <strong>${state.hand.length}</strong>` +
      ` · turn <strong>${state.turn}</strong>` +
      (state.final ? ' · <strong>final hand!</strong>' : '') +
      (state.log ? `<br><span class="muted">${state.log}</span>` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    return {
      title: o.title,
      cls: o.cls,
      score: state.gold,
      body: `<p>${o.text}</p><p class="muted">${state.log}</p>`,
    };
  },

  record: (state) => ({ win: state.over === 'won' || state.over === 'outright', score: state.gold }),
});

function reset() { ui = { mode: 'idle', hand: null, suit: null, place: null }; }

/** The suit-chip supply: 6 chips of each suit (the wiki's extra material). */
function chipStrip(state) {
  const strip = document.createElement('div');
  strip.className = 'q-chips';
  strip.setAttribute('aria-label', 'suit chip supply');
  for (const s of C.SUITS) {
    const item = document.createElement('span');
    item.className = 'q-chip-item' + (state.chips[s] === 0 ? ' is-out' : '');
    const img = D.suitChip(s);
    item.appendChild(img);
    const n = document.createElement('b');
    n.textContent = String(state.chips[s]);
    item.appendChild(n);
    item.title = `${s} chips left`;
    strip.appendChild(item);
  }
  return strip;
}

/* ------------------------------------------------------------- board */

function board(state) {
  const wrap = document.createElement('div');
  wrap.className = 'q-boardwrap';

  const placing = ui.mode === 'place' || (ui.mode === 'idle' && ui.hand != null);
  const rs = state.provinces.map((p) => p.r);
  const cs = state.provinces.map((p) => p.c);
  let r0 = Math.min(...rs), r1 = Math.max(...rs);
  let c0 = Math.min(...cs), c1 = Math.max(...cs);
  if (placing) { r0 -= 1; r1 += 1; c0 -= 1; c1 += 1; }
  if (ui.place) {
    r0 = Math.min(r0, ui.place[0]); r1 = Math.max(r1, ui.place[0]);
    c0 = Math.min(c0, ui.place[1]); c1 = Math.max(c1, ui.place[1]);
  }

  // chip targets, computed on the board as it will be after placement
  let chipTargets = new Set();
  let temp = null;
  if (ui.mode === 'chip') {
    temp = structuredClone(state);
    temp.provinces.push({ r: ui.place[0], c: ui.place[1], id: state.hand[ui.hand], chip: null, spice: 0 });
    chipTargets = new Set(temp.provinces
      .filter((p) => !C.chipError(temp, p.r, p.c, ui.suit))
      .map((p) => `${p.r},${p.c}`));
  }

  const grid = document.createElement('div');
  grid.className = 'q-board';
  grid.style.gridTemplateColumns = `repeat(${c1 - c0 + 1}, var(--q-cell))`;

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = document.createElement('div');
      cell.className = 'q-cell';
      const k = `${r},${c}`;
      const p = temp
        ? temp.provinces.find((q) => q.r === r && q.c === c) || null
        : C.provinceAt(state, r, c);

      if (p) {
        const isNew = ui.mode === 'chip' && p.r === ui.place[0] && p.c === ui.place[1];
        const id = isNew ? state.hand[ui.hand] : p.id;
        cell.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, { tag: 'div', static: true, eager: r <= r0 + 1 }));
        if (p.chip) {
          const chip = D.suitChip(p.chip);
          chip.className = 'q-chip';
          cell.appendChild(chip);
        }
        if (p.spice) {
          const sp = document.createElement('span');
          sp.className = 'q-spice';
          sp.textContent = `✶ ${p.spice}`;
          cell.appendChild(sp);
        }
        cell.setAttribute('aria-label',
          `${D.describe(data.byId[D.baseId(p.id)])}${p.chip ? `, ${p.chip} chip` : ''}${p.spice ? `, ${p.spice} spice` : ''}`);
        if (chipTargets.has(k)) {
          cell.classList.add('q-chipok');
          cell.setAttribute('role', 'button');
          cell.tabIndex = 0;
          const go = () => commitExpand(state, [r, c]);
          cell.addEventListener('click', go);
          cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        }
      } else {
        cell.classList.add('q-empty');
        cell.setAttribute('aria-label', `Empty province space at row ${r + 1}, column ${c + 1}`);
        const legal = legalPlacements(state).has(k);
        if (legal) {
          cell.classList.add('q-legal');
          cell.setAttribute('role', 'button');
          cell.tabIndex = 0;
          const go = () => pickCell(state, r, c);
          cell.addEventListener('click', go);
          cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        }
      }
      grid.appendChild(cell);
    }
  }
  wrap.appendChild(grid);
  return wrap;
}

/** Empty cells the selected card may be placed on, per chosen suit. */
function legalPlacements(state) {
  const out = new Set();
  if (state.over || state.step !== 'action' || ui.hand == null || ui.mode === 'chip') return out;
  const suits = ui.suit != null ? [ui.suit] : C.suitsOf(state.hand[ui.hand]);
  for (const s of suits) {
    for (const [r, c] of C.emptyCells(state)) {
      if (!C.expandError(state, ui.hand, s, r, c)) out.add(`${r},${c}`);
    }
  }
  return out;
}

function pickCell(state, r, c) {
  if (ui.suit == null) {
    const suits = C.suitsOf(state.hand[ui.hand]).filter((s) => !C.expandError(state, ui.hand, s, r, c));
    showSuits(state, suits, (suit) => { ui = { mode: 'chip', hand: ui.hand, suit, place: [r, c] }; api.refresh(); });
    return;
  }
  ui = { mode: 'chip', hand: ui.hand, suit: ui.suit, place: [r, c] };
  api.refresh();
}

/* ------------------------------------------------------------- hand */

function handPanel(state) {
  const p = document.createElement('section');
  p.className = 'panel';
  const taxStep = state.step === 'tax';
  p.innerHTML = `<h2>${taxStep ? 'Pay taxes — pick a card' : 'Your hand'} <span class="count">${state.hand.length}</span></h2>`;
  const row = document.createElement('div');
  row.className = 'cardrow';
  state.hand.forEach((id, i) => {
    const el = D.cardEl({ ...data.byId[D.baseId(id)], id }, {
      selected: ui.hand === i, eager: i < 4,
      cls: ui.hand != null && ui.hand !== i && !taxStep ? 'is-dim' : '',
    });
    el.setAttribute('aria-label', taxStep
      ? `${D.describe(data.byId[D.baseId(id)])} — pays ${C.taxFor(state, id)} gold`
      : `${D.describe(data.byId[D.baseId(id)])} in hand`);
    if (taxStep) {
      const b = document.createElement('span');
      b.className = 'q-tax';
      b.textContent = `${C.taxFor(state, id)} gold`;
      el.appendChild(b);
    }
    el.addEventListener('click', () => onHand(state, i));
    row.appendChild(el);
  });
  if (!state.hand.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Your hand is empty.';
    row.appendChild(e);
  }
  p.appendChild(row);
  return p;
}

/* --------------------------------------------------------- controls */

function actionBar(state) {
  const bar = document.createElement('div');
  bar.className = 'btnrow q-actions';
  if (state.over || state.step === 'tax') return bar;

  const mk = (label, ready, why, fn, cls = 'small') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${cls}` + (ready ? '' : ' is-off');
    b.textContent = label;
    if (!ready) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => { ready ? fn() : api.toast(why()); });
    bar.appendChild(b);
    return b;
  };

  if (ui.mode === 'chip') {
    mk('No chip', true, '', () => commitExpand(state, null), 'small primary');
    mk('Cancel', true, '', () => { reset(); api.refresh(); });
    return bar;
  }

  const id = ui.hand != null ? state.hand[ui.hand] : null;
  const empty = C.emptyCells(state);
  const placeSuits = id == null ? [] : C.suitsOf(id).filter((s) =>
    empty.some(([r, c]) => !C.expandError(state, ui.hand, s, r, c)));
  const harvestOk = id != null && !C.harvestError(state, ui.hand);
  const caravanOpts = id == null ? [] : C.suitsOf(id).flatMap((s) =>
    C.routes(state, s).filter((path) => !C.caravanError(state, ui.hand, s, path))
      .map((path) => ({ suit: s, path })));

  mk('Place as province', placeSuits.length > 0,
    () => (id == null ? 'Select a card in your hand first.' : 'This card cannot be placed next to the kingdom right now.'),
    () => {
      const start = (suit) => { ui = { mode: 'place', hand: ui.hand, suit, place: null }; api.refresh(); };
      if (placeSuits.length === 1) start(placeSuits[0]);
      else showSuits(state, placeSuits, start);
    });

  mk('Harvest spice', harvestOk,
    () => (id == null ? 'Select a card in your hand first.' : 'No Ace of this card’s suits is on the board.'),
    () => act(state, { type: 'harvest', hand: ui.hand }));

  mk(`Caravan (${caravanOpts.length})`, caravanOpts.length > 0,
    () => (id == null ? 'Select a card in your hand first.' : 'No deliverable route of this card’s suits fits its rank.'),
    () => showCaravan(state, caravanOpts));

  if (!C.hasLegalPlay(state)) {
    mk('Discard (no legal play)', true, '',
      () => act(state, { type: 'discard', hand: ui.hand ?? 0 }), 'small danger');
  }
  return bar;
}

function showSuits(state, suits, onPick) {
  if (suits.length === 1) { onPick(suits[0]); return; }
  const body = document.createElement('div');
  body.className = 'btnrow';
  for (const s of suits) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.appendChild(document.createTextNode(`${SUIT_NAME[s]} `));
    b.appendChild(D.suitChip(s));
    b.addEventListener('click', () => { o.close(); onPick(s); });
    body.appendChild(b);
  }
  const o = api.overlay({
    title: 'Which suit?',
    body,
    actions: [{ label: 'Cancel', onClick: () => { reset(); api.refresh(); } }],
  });
}

function showCaravan(state, opts) {
  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '6px';
  for (const { suit, path } of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = `${SUIT_NAME[suit]}: ${path.length} provinces → ${C.goldFor(path.length)} gold`;
    b.addEventListener('click', () => { o.close(); act(state, { type: 'caravan', hand: ui.hand, suit, path }); });
    body.appendChild(b);
  }
  api.overlay({
    title: 'Send a caravan',
    body,
    actions: [{ label: 'Cancel', onClick: () => { reset(); api.refresh(); } }],
  });
}

function commitExpand(state, chip) {
  act(state, { type: 'expand', hand: ui.hand, suit: ui.suit, r: ui.place[0], c: ui.place[1], chip });
}

function onHand(state, i) {
  if (state.over) return;
  if (state.step === 'tax') { act(state, { type: 'tax', hand: i }); return; }
  if (ui.hand === i) { reset(); api.refresh(); return; }
  ui = { mode: 'idle', hand: i, suit: null, place: null };
  api.refresh();
}

function act(state, action) {
  let next;
  try {
    next = C.applyMove(state, action);
  } catch (err) {
    api.toast(err.message);
    api.setStatus(err.message, true);
    return;
  }
  reset();
  api.pushHistory();
  api.setState(next);
}

function hintFor(state) {
  if (state.over) return '';
  if (state.step === 'tax') return 'Taxes are due: tap a card to pay with it. Crowns cost 15, minus your suit chips on the board.';
  if (ui.mode === 'chip') return `Lay a ${SUIT_NAME[ui.suit]} chip on a glowing province to extend the route — or press “No chip”.`;
  if (ui.mode === 'place') return 'Tap a glowing empty cell to place the province.';
  if (ui.hand != null) return 'Now pick Place, Harvest or Caravan below — or tap the card again to put it back.';
  return 'Tap a card in your hand to start your turn: place a province, harvest spice, or send a caravan.';
}

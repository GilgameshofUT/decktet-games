/* Wyvern Pass Not — UI.  The rules live in wyvern-pass-not-core.js. */

import { mountGame, D, panel, pile } from '../gamikit.js';
import * as C from './wyvern-pass-not-core.js';

const data = await D.loadDeck();
C.init(data.byId);

// The basic game's deck: every card except the Excuse (who is the mage).
const DECK44 = [...data.basicDeck, ...data.extendedDeck].filter((id) => id !== C.MAGE);
const info = (id) => data.byId[D.baseId(id)];

let selected = null;          // { kind: 'pool', index } | { kind: 'ring', slot }
let ui = null;                // the mountGame api, set on every render

const api = mountGame({
  id: 'wyvern-pass-not',
  title: 'Wyvern Pass Not',
  subtitle: 'close the ring before the wyvern breathes',
  rules: '../rules/wyvern-pass-not.html',
  newGame: (seed) => C.newGame(seed, DECK44),

  render(state, api) {
    ui = api;                            // helpers and callbacks draw through this
    if (selected && selected.kind === 'pool' && state.pool[selected.index] == null) selected = null;
    if (selected && selected.kind === 'ring' && !state.ring[selected.slot]) selected = null;
    ui.table.textContent = '';

    renderRing(state);
    renderPool(state);
    renderControls(state);
    renderHint(state);

    const plan = C.bestPlan(state.ring);
    ui.setStatus(
      `Links <strong>${plan.count}/${C.RING_SIZE}</strong>` +
      ` · pool <strong>${state.pool.length}</strong>` +
      ` · deck <strong>${state.deck.length}</strong>` +
      ` · deals <strong>${state.redeals}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.outcomeOf(state);
    const s = C.score(state);
    return {
      title: o.title,
      cls: o.cls,
      score: s.total,
      body: `<p>${o.text}</p>` +
        `<p class="muted">${s.links} valid link${s.links === 1 ? '' : 's'} × 6 = ${s.linkPoints}` +
        (s.poolPoints ? ` · suit pools +${s.poolPoints}` : '') +
        ` · total ${s.total}.</p>` +
        (state.over === 'won'
          ? '<p class="muted">Play again for another round — each round scores on its own.</p>'
          : ''),
    };
  },

  record: (state) => ({ win: state.over === 'won', score: C.score(state).total }),
});

/* ------------------------------------------------------------------ parts */

function renderRing(state) {
  const plan = C.bestPlan(state.ring);
  const grid = document.createElement('div');
  grid.className = 'wpn-ring';

  state.ring.forEach((id, i) => {
    const cell = document.createElement('div');
    cell.className = 'wpn-slot';
    cell.style.gridArea = cellArea(C.SLOT_CELL[i]);

    if (id) {
      const c = info(id);
      cell.appendChild(D.cardEl({ ...c, id }, {
        tag: 'div',
        static: true,
        eager: i < 3,
        selected: selected?.kind === 'ring' && selected.slot === i,
      }));
      cell.appendChild(linkBadge(plan, state, i));
    } else {
      cell.classList.add('is-empty');
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;
      cell.setAttribute('aria-label', `Empty ring slot ${i + 1}`);
      if (selected) cell.classList.add('is-legal');
      cell.innerHTML = '<span class="wpn-empty">slot</span>';
    }

    cell.addEventListener('click', () => onSlot(state, i));
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSlot(state, i); }
    });
    grid.appendChild(cell);
  });

  const mage = document.createElement('div');
  mage.className = 'wpn-mage';
  mage.style.gridArea = '2 / 2';
  mage.appendChild(D.cardEl({ ...info(C.MAGE), id: C.MAGE }, {
    tag: 'div', static: true, eager: true, cls: 'wpn-magecard',
  }));
  const tag = document.createElement('span');
  tag.className = 'wpn-magetag';
  tag.textContent = 'the mage';
  mage.appendChild(tag);
  grid.appendChild(mage);

  ui.table.appendChild(grid);
}

/** Two markers under each placed card: the suit of its left and right link. */
function linkBadge(plan, state, i) {
  const wrap = document.createElement('div');
  wrap.className = 'wpn-links';
  const left = plan.links[(i + C.RING_SIZE - 1) % C.RING_SIZE];
  const right = plan.links[i];
  const leftOk = state.ring[(i + C.RING_SIZE - 1) % C.RING_SIZE] != null && left != null;
  const rightOk = state.ring[(i + 1) % C.RING_SIZE] != null && right != null;
  wrap.appendChild(mark(left, leftOk, state.ring[(i + C.RING_SIZE - 1) % C.RING_SIZE] != null));
  wrap.appendChild(mark(right, rightOk, state.ring[(i + 1) % C.RING_SIZE] != null));
  return wrap;
}

function mark(suit, ok, neighbourThere) {
  const m = document.createElement('span');
  if (!neighbourThere) { m.className = 'wpn-mark is-none'; m.textContent = '·'; return m; }
  if (!ok || !suit) { m.className = 'wpn-mark is-bad'; m.textContent = '✕'; return m; }
  m.className = 'wpn-mark is-ok';
  const img = document.createElement('img');
  img.src = D.url(`cards/icons/suits/${suit}.png`);
  img.alt = D.SUIT_NAME[suit];
  img.width = 115;
  img.height = 114;
  m.appendChild(img);
  return m;
}

function renderPool(state) {
  const p = panel('Drawing pool');
  p.heading.appendChild(countChip(`${state.pool.length}`));
  state.pool.forEach((id, i) => {
    if (id == null) return;
    const c = info(id);
    p.row.appendChild(D.cardEl({ ...c, id }, {
      selected: selected?.kind === 'pool' && selected.index === i,
      dim: selected != null && !(selected.kind === 'pool' && selected.index === i),
      eager: i < 2,
      onPick: () => {
        if (state.over) return;
        selected = selected?.kind === 'pool' && selected.index === i ? null : { kind: 'pool', index: i };
        ui.refresh();
      },
    }));
  });
  const deck = pile('deck');
  deck.set(state.deck.length);
  p.row.appendChild(deck.el);
  ui.table.appendChild(p.section);
}

function renderControls(state) {
  const row = document.createElement('div');
  row.className = 'btnrow wpn-ctl';

  const deal = document.createElement('button');
  deal.type = 'button';
  deal.className = 'btn small';
  deal.textContent = state.poolSize <= 1
    ? 'Deal again — you will die'
    : `Deal again (pool → ${Math.max(0, state.poolSize - 1)})`;
  deal.addEventListener('click', async () => {
    if (state.over) return;
    if (state.poolSize <= 1) {
      const ok = await ui.confirm({
        title: 'Deal again?',
        message: 'Only one card is in the pool. There are no resources left to finish the ring — the wyvern will breathe.',
        okLabel: 'The wyvern wins',
        danger: true,
      });
      if (!ok) return;
    }
    ui.pushHistory();
    ui.setState(C.applyRedeal(state));
    D.toast('Pool dealt again.');
  });
  row.appendChild(deal);

  const sur = document.createElement('button');
  sur.type = 'button';
  sur.className = 'btn small danger';
  sur.textContent = 'Surrender';
  sur.addEventListener('click', async () => {
    if (state.over) return;
    const ok = await ui.confirm({
      title: 'Surrender?',
      message: 'The mage gives up. The wyvern breathes and the round ends.',
      okLabel: 'Surrender',
      danger: true,
    });
    if (!ok) return;
    ui.pushHistory();
    ui.setState(C.applySurrender(state));
  });
  row.appendChild(sur);

  ui.table.appendChild(row);
}

function renderHint(state) {
  const hint = document.createElement('p');
  hint.className = 'wpnhint';
  hint.textContent = state.over
    ? ''
    : selected == null
      ? 'Tap a pool card to pick it up, then tap any empty slot of the ring. ' +
        'Adjacent cards must share a suit — each of a card’s suits can only be spent once.'
      : selected.kind === 'pool'
        ? 'Tap any empty ring slot to place the card — even next to a broken link, ' +
        'but a full ring with any broken link means the wyvern wins.'
        : 'Tap any empty ring slot to move this card there, or tap it again to put it back.';
  ui.table.appendChild(hint);
}

/* --------------------------------------------------------------- actions */

function onSlot(state, i) {
  if (state.over) return;
  if (state.ring[i]) {
    selected = selected?.kind === 'ring' && selected.slot === i ? null : { kind: 'ring', slot: i };
    ui.refresh();
    return;
  }
  if (!selected) { D.toast('Pick up a card from the pool first.'); return; }
  ui.pushHistory();
  if (selected.kind === 'pool') {
    const pi = selected.index;
    selected = null;
    ui.setState(C.applyTake(state, pi, i));
  } else {
    const from = selected.slot;
    selected = null;
    ui.setState(C.applyMoveCard(state, from, i));
  }
}

function cellArea(cell) {
  return `${Math.ceil(cell / 3)} / ${((cell - 1) % 3) + 1}`;
}

function countChip(text) {
  const s = document.createElement('span');
  s.className = 'count';
  s.textContent = text;
  return s;
}

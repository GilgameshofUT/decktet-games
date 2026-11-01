/* Aucteraden — UI.  The rules live in aucteraden-core.js */

import { mountGame, D, panel } from '../gamikit.js';
import * as C from './aucteraden-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const SUIT_NAME = {
  moons: 'Moons', suns: 'Suns', waves: 'Waves',
  leaves: 'Leaves', daemons: 'Daemons', crowns: 'Crowns',
};

let selectedSlot = null;
let shownNote = null;

const api = mountGame({
  id: 'aucteraden',
  title: 'Aucteraden',
  subtitle: 'buy at market, build trade routes',
  rules: '../rules/aucteraden.html',
  newGame: (seed) => {
    selectedSlot = null;
    shownNote = null;
    return C.newGame(seed, data.basicDeck);
  },

  render(state, api) {
    api.table.textContent = '';
    if (state.lastNote && state.lastNote !== shownNote) {
      shownNote = state.lastNote;
      api.toast(state.lastNote);
    }
    if (selectedSlot != null && !state.market[selectedSlot]) selectedSlot = null;
    const placing = selectedSlot != null ? state.market[selectedSlot] : null;
    const legal = new Set(placing ? C.legalCells(state, placing) : []);

    /* ---- the market ---- */
    const market = panel('Market', (() => {
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(state.deck.length);
      return n;
    })());
    market.row.className = 'ac-market';
    state.market.forEach((id, slot) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'ac-slot';
      if (id) {
        const cost = C.COST[slot];
        const badge = document.createElement('span');
        badge.className = 'ac-cost' + (cost === 0 ? ' is-free' : '');
        badge.textContent = cost === 0 ? 'free' : `${cost} ◈`;
        cell.appendChild(badge);
        cell.appendChild(D.cardEl({ ...data.byId[id], id }, {
          tag: 'span', static: true, eager: slot < 3,
          selected: selectedSlot === slot,
        }));
        cell.setAttribute('aria-label',
          `${['Left', 'Middle', 'Right'][slot]} market card, ${D.describe(data.byId[id])}, costs ${cost} chip${cost === 1 ? '' : 's'}`);
      } else {
        cell.disabled = true;
        cell.className += ' is-empty';
        cell.textContent = '—';
      }
      cell.addEventListener('click', () => onSelect(state, slot, id));
      market.row.appendChild(cell);
    });
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'btn small ac-discard';
    discardBtn.textContent = 'Discard the row −3 VP';
    discardBtn.addEventListener('click', async () => {
      if (state.over) return void api.toast('The game is over.');
      const ok = await api.confirm({
        title: 'Discard the whole market row?',
        message: 'Every market card is permanently removed and the row ' +
          'refills from the deck. This costs 3 VP.',
        okLabel: 'Discard —3 VP',
        danger: true,
      });
      if (ok) act(() => C.discardRow(state));
    });
    market.section.appendChild(discardBtn);
    api.table.appendChild(market.section);

    /* ---- the tableau ---- */
    const grid = document.createElement('div');
    grid.className = 'ac-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', 'the four by four tableau');
    for (let i = 0; i < C.CELLS; i++) {
      const cell = document.createElement('div');
      cell.className = 'ac-cell';
      const id = state.tableau[i];
      if (id) {
        cell.appendChild(D.cardEl({ ...data.byId[id], id }, { tag: 'div', static: true }));
        cell.setAttribute('aria-label', D.describe(data.byId[id]));
        cell.addEventListener('click', () => {
          if (state.over) return void api.toast('The game is over.');
          api.toast(placing
            ? 'That square is taken.'
            : 'Buy a card from the market first, then tap a glowing square.');
        });
      } else if (legal.has(i)) {
        cell.classList.add('is-legal');
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', `Empty square, row ${C.rowOf(i) + 1} column ${C.colOf(i) + 1}: place here`);
        const place = () => {
          if (state.over) return;
          try {
            const next = C.buy(state, selectedSlot, i);
            api.pushHistory();
            selectedSlot = null;
            api.setState(next);
          } catch (err) {
            api.toast(err.message);
          }
        };
        cell.addEventListener('click', place);
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(); }
        });
      } else {
        cell.classList.add('is-empty');
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', `Empty square, row ${C.rowOf(i) + 1} column ${C.colOf(i) + 1}`);
        cell.addEventListener('click', () => {
          if (state.over) return void api.toast('The game is over.');
          if (placing) {
            api.toast(C.isAC(placing)
              ? 'An Ace or Crown may not be placed straight next to another Ace or Crown — try a diagonal.'
              : 'A card must touch a card already down — straight up, down, left or right.');
          } else {
            api.toast('Buy a card from the market first, then tap a glowing square.');
          }
        });
      }
      grid.appendChild(cell);
    }
    api.table.appendChild(grid);

    /* ---- suit chips ---- */
    const chipPanel = panel('Suit chips', (() => {
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(C.SUITS.reduce((t, s) => t + state.chips[s], 0));
      return n;
    })());
    chipPanel.row.className = 'ac-chips';
    for (const suit of C.SUITS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ac-chip' + (state.chips[suit] === 0 ? ' is-out' : '');
      b.appendChild(D.suitChip(suit));
      const n = document.createElement('span');
      n.className = 'ac-chipn';
      n.textContent = String(state.chips[suit]);
      b.appendChild(n);
      b.setAttribute('aria-label', `${SUIT_NAME[suit]} chips: ${state.chips[suit]}`);
      b.addEventListener('click', () => {
        api.toast('Chips pay for market cards automatically: the left card costs 2, ' +
          'the middle 1, the right is free — always chips of the card’s own suit.');
      });
      chipPanel.row.appendChild(b);
    }
    api.table.appendChild(chipPanel.section);

    /* ---- the pad: score so far ---- */
    const sc = C.score(state);
    const pad = panel('Pad', (() => {
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(sc.total);
      return n;
    })());
    pad.row.className = 'ac-pad';
    for (const row of sc.suits) {
      const line = document.createElement('button');
      line.type = 'button';
      line.className = 'ac-padline';
      const icon = D.suitChip(row.suit);
      icon.className = 'suit-inline';
      line.appendChild(icon);
      const txt = document.createElement('span');
      txt.textContent = row.length
        ? `${row.length} cards · ${row.total > 0 ? '+' : ''}${row.total}`
        : `no chain · ${row.total}`;
      line.appendChild(txt);
      const pts = document.createElement('b');
      pts.textContent = String(row.total);
      line.appendChild(pts);
      line.title = C.describeSuit(row);
      line.addEventListener('click', () => api.toast(C.describeSuit(row)));
      pad.row.appendChild(line);
    }
    const pen = document.createElement('p');
    pen.className = 'ac-pen';
    pen.innerHTML =
      `Empty squares −<b>${sc.emptyPenalty}</b> · ` +
      `row discards −<b>${sc.discardPenalty}</b>` +
      (sc.empty ? ` (${sc.empty} left)` : '');
    pad.section.appendChild(pen);
    api.table.appendChild(pad.section);

    /* ---- hint ---- */
    const hint = document.createElement('p');
    hint.className = 'ac-hint';
    hint.textContent = state.over
      ? ''
      : placing
        ? `Now tap a glowing square for the ${data.byId[placing].name.replace(/^the /, '')}.`
        : 'Tap a market card to buy it (left 2 chips, middle 1, right free), then ' +
          'place it straight next to a card already down.';
    api.table.appendChild(hint);

    api.setStatus(
      `VP <strong>${sc.total}</strong>` +
      ` · deck <strong>${state.deck.length}</strong>` +
      ` · chips <strong>${C.SUITS.reduce((t, s) => t + state.chips[s], 0)}/24</strong>` +
      ` · tableau <strong>${state.tableau.filter(Boolean).length}/16</strong>` +
      ` · row discards <strong>${state.rowDiscards}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const sc = C.score(state);
    const o = sc.total >= C.COMMANDING ? C.OUTCOME.great
      : sc.total >= C.WIN ? C.OUTCOME.win : C.OUTCOME.lose;
    const list = document.createElement('ul');
    list.className = 'ac-endlist';
    for (const row of sc.suits) {
      const li = document.createElement('li');
      li.textContent = C.describeSuit(row);
      list.appendChild(li);
    }
    const li = document.createElement('li');
    li.textContent = `Empty squares −${sc.emptyPenalty} · row discards −${sc.discardPenalty}`;
    list.appendChild(li);
    const wrap = document.createElement('div');
    const p = document.createElement('p');
    p.innerHTML = sc.total >= C.WIN
      ? `Your trade routes score <strong>${sc.total}</strong> points — a win needs ${C.WIN}.`
      : `Your trade routes score <strong>${sc.total}</strong> points. A win needs ${C.WIN}.`;
    wrap.append(p, list);
    return { title: o.title, cls: o.cls, score: sc.total, body: wrap };
  },

  record(state) {
    const sc = C.score(state);
    return { win: sc.total >= C.WIN, score: sc.total };
  },
});

function onSelect(state, slot, id) {
  if (state.over) return void api.toast('The game is over.');
  if (!id) return void api.toast('That slot is empty.');
  const cost = C.COST[slot];
  const pay = C.payment(state, id, cost);
  if (!pay) {
    const have = C.suitsOf(id).map((s) => `${state.chips[s]} ${s}`).join(', ');
    return void api.toast(`The ${['left', 'middle', 'right'][slot]} card costs ` +
      `${cost} chip${cost === 1 ? '' : 's'} of its own suit — you have ${have}.`);
  }
  if (!C.legalCells(state, id).length) {
    return void api.toast('No square accepts this card — every empty square is ' +
      'blocked by the Ace/Crown rule or does not touch the tableau.');
  }
  selectedSlot = selectedSlot === slot ? null : slot;
  api.refresh();
}

function act(move) {
  try {
    const next = move();
    api.pushHistory();
    selectedSlot = null;
    api.setState(next);
  } catch (err) {
    api.toast(err.message);
  }
}

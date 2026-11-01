/* Quincunx — UI.  The rules live in quincunx-core.js. */

import { mountGame, D, panel } from '../gamikit.js';
import * as C from './quincunx-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let variant = D.getSetting('quincunx.variant', 'corners');
let selected = null;                 // a card id from the hand

const api = mountGame({
  id: 'quincunx',
  title: 'Quincunx',
  subtitle: 'fill the 4×4 spread, score the joins',
  rules: '../rules/quincunx.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck, variant),

  render(state, api) {
    if (selected && !state.hand.includes(selected)) selected = null;
    const legal = new Set(selected ? C.legalCells(state) : []);

    api.table.textContent = '';

    /* ---- the two setups ---- */
    const sw = document.createElement('div');
    sw.className = 'qx-switch';
    const swLabel = document.createElement('span');
    swLabel.className = 'qx-switch-label';
    swLabel.textContent = 'Start:';
    sw.appendChild(swLabel);
    for (const v of Object.keys(C.VARIANTS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'iconbtn';
      b.setAttribute('aria-pressed', String(state.variant === v));
      b.textContent = v === 'corners' ? '4 corners' : 'Blank slate';
      b.addEventListener('click', () => switchVariant(state, v));
      sw.appendChild(b);
    }
    const swHint = document.createElement('span');
    swHint.className = 'qx-switch-hint';
    swHint.textContent = state.variant === 'slate' ? 'one card · hand of 12 · touch to grow' : 'four cards · hand of 8';
    sw.appendChild(swHint);
    api.table.appendChild(sw);

    /* ---- the 4x4 spread ---- */
    const grid = document.createElement('div');
    grid.className = 'qx-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', 'the spread, four by four');
    for (let i = 0; i < C.CELLS; i++) {
      const cell = document.createElement('div');
      cell.className = 'qx-cell';
      const id = state.grid[i];
      if (id) {
        cell.appendChild(D.cardEl({ ...data.byId[id], id }, { tag: 'div', static: true }));
        cell.setAttribute('aria-label', D.describe(data.byId[id]));
        cell.addEventListener('click', () => {
          api.toast('That square is already filled — play your card on an empty one.');
        });
      } else if (legal.has(i)) {
        cell.classList.add('is-legal');
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        const play = () => {
          api.pushHistory();
          const id = selected;
          selected = null;
          const next = C.applyMove(state, i, id);
          api.setState(next);
          api.toast(C.describePlay(next.last));
        };
        cell.addEventListener('click', play);
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
        });
        cell.setAttribute('aria-label', `Empty square: play ${selected ? D.describe(data.byId[selected]) : 'here'}`);
      } else {
        cell.classList.add('is-empty');
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.addEventListener('click', () => explainBadCell(state, i));
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); explainBadCell(state, i); }
        });
        cell.setAttribute('aria-label', 'Empty square');
      }
      grid.appendChild(cell);
    }
    api.table.appendChild(grid);

    /* ---- your hand ---- */
    const hand = panel('Your hand', count(`${state.hand.length}`));
    for (const id of state.hand) {
      const el = D.cardEl({ ...data.byId[D.baseId(id)], id }, {
        selected: selected === id,
        dim: !!selected && selected !== id,
        onPick: () => { selected = selected === id ? null : id; api.refresh(); },
      });
      hand.row.appendChild(el);
    }
    if (!state.hand.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = 'Your hand is empty.';
      hand.row.appendChild(p);
    }
    api.table.appendChild(hand.section);

    /* ---- the score pad ---- */
    const sc = panel('Score', count(String(C.finalScore(state))));
    sc.row.className = 'qx-chips';
    chip(sc.row, 'Spread', `${C.filled(state)}/16`);
    chip(sc.row, 'Deck', String(state.deck.length));
    chip(sc.row, 'Hand penalty', String(C.handPenalty(state.hand)));
    if (state.draws) chip(sc.row, 'Cards drawn', String(state.draws));
    const rec = api.records();
    if (rec.best != null) chip(sc.row, 'Best', String(rec.best));
    api.table.appendChild(sc.section);

    if (state.last) {
      const p = document.createElement('p');
      p.className = 'qx-last';
      p.innerHTML = `<strong>Last play:</strong> ${C.describePlay(state.last)}`;
      api.table.appendChild(p);
    }

    const hint = document.createElement('p');
    hint.className = 'qx-hint';
    hint.textContent = state.over
      ? ''
      : selected == null
        ? 'Tap a card in your hand, then tap a glowing square of the spread.'
        : state.variant === 'slate'
          ? 'Blank slate: the card must touch a card already in play, straight up, down, left or right.'
          : 'Play the card on any glowing empty square. A sum of 11 or 20 with a neighbour draws a card.';
    api.table.appendChild(hint);

    api.setStatus(
      `Score <strong>${state.score}</strong> · hand <strong>${state.hand.length}</strong>` +
      ` · deck <strong>${state.deck.length}</strong> · spread <strong>${C.filled(state)}/16</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    const pen = C.handPenalty(state.hand);
    const won = state.over === 'won';
    return {
      title: o.title,
      cls: o.cls,
      score: won ? C.finalScore(state) : null,
      body: `<p>${o.text}</p>` +
        `<p class="muted">Play scored <strong>${state.score}</strong>` +
        (won ? `, minus <strong>${Math.abs(pen)}</strong> for ${state.hand.length} card${state.hand.length === 1 ? '' : 's'} left in hand.` : '.') +
        `</p>`,
    };
  },

  record(state) {
    const won = state.over === 'won';
    return { win: won, score: won ? C.finalScore(state) : null };
  },
});

function count(text) {
  const n = document.createElement('span');
  n.className = 'count';
  n.textContent = text;
  return n;
}

function chip(row, label, value) {
  const c = document.createElement('span');
  c.className = 'qx-chip';
  c.innerHTML = `<small>${label}</small><b>${value}</b>`;
  row.appendChild(c);
  return c;
}

function explainBadCell(state, i) {
  if (state.over) return;
  if (state.grid[i]) { api.toast('That square is already filled.'); return; }
  if (!selected) { api.toast('Pick a card from your hand first, then tap a glowing square.'); return; }
  if (state.variant === 'slate' && !C.legalCells(state).includes(i)) {
    api.toast('Blank slate: a card must be played next to a card already in play — ' +
      'straight up, down, left or right.');
    return;
  }
  api.toast('Play the selected card on a glowing empty square.');
}

async function switchVariant(state, v) {
  if (state.variant === v) return;
  if (state.moves > 0 && !state.over) {
    const ok = await api.confirm({
      title: 'Change the setup?',
      message: `This starts a new game with the ${C.VARIANTS[v].label} setup, discarding this one.`,
      okLabel: 'New game',
      danger: true,
    });
    if (!ok) return;
  }
  variant = v;
  selected = null;
  D.setSetting('quincunx.variant', v);
  api.newGame();
}

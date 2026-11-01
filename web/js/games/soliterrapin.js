/* Soliterrapin — UI.  The rules live in soliterrapin-core.js. */

import { mountGame, D, panel } from '../gamikit.js';
import * as C from './soliterrapin-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const api = mountGame({
  id: 'soliterrapin',
  title: 'Soliterrapin',
  subtitle: 'place freely, then score with Terrapin hands',
  rules: '../rules/soliterrapin.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    api.table.textContent = '';

    /* ---- the card you just flipped ---- */
    const cur = document.createElement('div');
    cur.className = 'si-current';
    const curLabel = document.createElement('span');
    curLabel.className = 'si-current-label';
    if (state.current) {
      curLabel.textContent = 'Place this card';
      cur.appendChild(D.cardEl({ ...data.byId[state.current], id: state.current }, {
        tag: 'div', static: true, eager: true,
      }));
    } else {
      curLabel.textContent = 'The deck is spent — the board is complete.';
    }
    cur.appendChild(curLabel);
    api.table.appendChild(cur);

    /* ---- the 6x6 tableau ---- */
    const legal = new Set(state.over ? [] : C.legalCells(state));
    const grid = document.createElement('div');
    grid.className = 'si-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', 'the tableau, six by six');
    for (let i = 0; i < C.SIZE * C.SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'si-cell';
      const id = state.grid[i];
      if (id) {
        cell.appendChild(D.cardEl({ ...data.byId[id], id }, { tag: 'div', static: true }));
        cell.setAttribute('aria-label', D.describe(data.byId[id]));
      } else if (legal.has(i)) {
        cell.classList.add('is-legal');
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', `Empty square, row ${C.rowOf(i) + 1} column ${C.colOf(i) + 1}: place here`);
        const place = () => {
          if (state.over) return;
          api.pushHistory();
          api.setState(C.applyMove(state, i));
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
          api.toast('That square must touch a card already on the table — ' +
            'straight up, down, left or right.');
        });
      }
      grid.appendChild(cell);
    }
    api.table.appendChild(grid);

    /* ---- the score so far, row by row and column by column ---- */
    const sc = C.scoreGrid(state.grid);
    const scorePanel = panel('Score', (() => {
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(sc.total);
      return n;
    })());
    scorePanel.row.className = 'si-chips';
    const chipRow = (lines, label) => {
      const head = document.createElement('div');
      head.className = 'si-chips-label';
      head.textContent = label;
      scorePanel.row.appendChild(head);
      for (const line of lines) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'si-chip' + (line.turtleButt ? ' is-tb' : '');
        if (!line.ids.some(Boolean)) chip.classList.add('is-empty');
        chip.innerHTML = `<b>${line.kind === 'row' ? 'R' : 'C'}${line.index + 1}</b>` +
          `<i>${line.turtleButt ? 'TB' : line.total}</i>`;
        chip.title = C.describeLine(line);
        chip.addEventListener('click', () => api.toast(C.describeLine(line)));
        scorePanel.row.appendChild(chip);
      }
    };
    chipRow(sc.lines.filter((l) => l.kind === 'row'), 'Rows');
    chipRow(sc.lines.filter((l) => l.kind === 'col'), 'Cols');
    api.table.appendChild(scorePanel.section);

    const hint = document.createElement('p');
    hint.className = 'si-hint';
    hint.textContent = state.over
      ? ''
      : !state.grid.some(Boolean)
        ? 'Tap any square for the first card.'
        : 'Tap a glowing square: a card may go anywhere that touches another card, ' +
          'straight up, down, left or right. A line of six seals.';
    api.table.appendChild(hint);

    api.setStatus(
      `Score <strong>${sc.total}</strong> · cards out <strong>${C.placed(state)}/36</strong>` +
      ` · deck <strong>${state.deck.length}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const sc = C.scoreGrid(state.grid);
    const r = api.records();
    const newBest = r.best != null && sc.total > r.best;
    const tb = sc.lines.filter((l) => l.turtleButt).length;
    const list = document.createElement('ul');
    list.className = 'si-endlist';
    for (const line of sc.lines) {
      const li = document.createElement('li');
      li.textContent = C.describeLine(line);
      list.appendChild(li);
    }
    const wrap = document.createElement('div');
    const p = document.createElement('p');
    p.innerHTML = `Your board scores <strong>${sc.total}</strong> points — ` +
      `pairs, longest straights, and ${tb} Turtle Butt line${tb === 1 ? '' : 's'} scoring zero.` +
      (r.best != null ? ` <span class="muted">Best so far: ${r.best}.</span>` : '');
    wrap.append(p, list);
    return {
      title: newBest ? 'New best' : 'Game over',
      cls: newBest ? 'win' : '',
      score: sc.total,
      body: wrap,
    };
  },

  // Higher is better here, so the score passes through as it is.
  record(state) {
    const sc = C.scoreGrid(state.grid);
    const r = api.records();
    return { win: r.best == null || sc.total > r.best, score: sc.total };
  },
});

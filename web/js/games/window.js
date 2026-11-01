/* Window — UI.  The rules live in window-core.js. */

import { mountGame, D } from '../gamikit.js';
import * as C from './window-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let selected = null;

const api = mountGame({
  id: 'window',
  title: 'Window',
  subtitle: 'merge everything into one pile',
  rules: '../rules/window.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (selected != null && !state.stacks[selected]?.up.length) selected = null;

    const legal = new Set(
      selected == null ? [] : C.legalMoves(state).filter((m) => m.from === selected).map((m) => m.to)
    );

    const grid = document.createElement('div');
    grid.className = 'wgrid';

    state.stacks.forEach((stack, i) => {
      const cell = document.createElement('div');
      cell.className = 'wstack';
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;

      if (!stack.down.length && !stack.up.length) {
        cell.classList.add('is-empty');
        cell.setAttribute('aria-label', `Empty space ${i + 1}`);
      } else {
        const topId = stack.up[stack.up.length - 1];
        const top = topId ? data.byId[D.baseId(topId)] : null;
        if (top) {
          cell.appendChild(D.cardEl({ ...top, id: stack.up[stack.up.length - 1] }, {
            tag: 'div',
            static: true,
            eager: i < 3,
            badge: stack.up.length > 1 ? `×${stack.up.length}` : null,
          }));
        }
        if (stack.down.length) {
          const b = document.createElement('span');
          b.className = 'downbadge';
          b.textContent = `▼ ${stack.down.length}`;
          cell.appendChild(b);
        }
        cell.setAttribute('aria-label',
          `Pile ${i + 1}: ${stack.up.length} face up, ${stack.down.length} face down`);
      }

      if (selected === i) cell.classList.add('is-selected');
      if (legal.has(i)) cell.classList.add('is-legal');
      if (selected != null && selected !== i && !legal.has(i)) cell.classList.add('is-dim');

      cell.addEventListener('click', () => onCell(state, i, legal));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCell(state, i, legal); }
      });
      grid.appendChild(cell);
    });

    api.table.textContent = '';
    api.table.appendChild(grid);

    const hint = document.createElement('p');
    hint.className = 'whint';
    hint.innerHTML = state.over
      ? ''
      : selected == null
        ? 'Tap a pile to pick it up, then tap a glowing neighbour to merge it.'
        : 'A pile moves onto a neighbour when one of its face-up cards is one ' +
          'rank from that neighbour’s top card — or onto any empty space.';
    api.table.appendChild(hint);

    api.setStatus(
      `<strong>Moves ${state.moves}</strong> · piles <strong>${C.stacksLeft(state)}</strong>` +
      ` · face down <strong>${C.faceDown(state)}</strong>` +
      ` · face up <strong>${C.cardsUp(state)}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    return {
      title: o.title,
      cls: o.cls,
      body: `<p>${o.text}</p><p class="muted">Finished in ${state.moves} moves.</p>`,
    };
  },

  record: (state, result) => ({ win: state.over === 'won', score: null }),
});

function onCell(state, i, legal) {
  if (state.over) return;
  const stack = state.stacks[i];
  if (selected == null) {
    if (!stack.up.length) { D.toast('That space is empty.'); return; }
    selected = i;
    api.refresh();
    return;
  }
  if (selected === i) { selected = null; api.refresh(); return; }
  if (!legal.has(i)) {
    if (stack.up.length) { selected = i; api.refresh(); }
    else D.toast('Move onto an empty space or a neighbouring pile whose top card is one rank away.');
    return;
  }
  api.pushHistory();
  const from = selected;
  selected = null;
  api.setState(C.applyMove(state, from, i));
}

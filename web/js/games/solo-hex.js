/* Solo Hex — UI.  The rules live in solo-hex-core.js.
 *
 * The board is drawn the way the wiki's setup photo shows it: seven piles in a
 * hexagon (rows of 2, 3, 2), every pile splayed so each card shows the top-left
 * corner of its index, and the sideways card lying horizontally across its pile. */

import { mountGame, D } from '../gamikit.js';
import * as C from './solo-hex-core.js';

const data = await D.loadDeck();
C.init(data.byId);

/* The hexagon: two piles on top, three in the middle, two below. */
const ROWS = [[0, 1], [2, 3, 4], [5, 6]];

let sel = null;   // the picked-up pile index

const api = mountGame({
  id: 'solo-hex',
  title: 'Solo Hex',
  subtitle: 'merge hexagonally adjacent piles that share a suit',
  rules: '../rules/solo-hex.html',
  newGame: (seed) => C.newGame(seed, data.cards.map((c) => c.id)),
  restore: (st) => !!(st && Array.isArray(st.piles)
    && st.piles.every((p) => Array.isArray(p.cards) && typeof p.up === 'number')),

  render(state, api) {
    if (sel != null && (!C.pileTop(state, sel) || C.isExcuse(C.pileTop(state, sel)))) sel = null;

    const pending = state.pending;
    const legal = new Set(
      pending
        ? C.jumpTargets(state, pending.pile)
        : sel == null
          ? []
          : C.legalMoves(state).filter((m) => m.from === sel).map((m) => m.to)
    );

    const board = document.createElement('div');
    board.className = 'shex-board';
    for (const row of ROWS) {
      const rowEl = document.createElement('div');
      rowEl.className = 'shex-row';
      rowEl.setAttribute('role', 'group');
      rowEl.setAttribute('aria-label', 'a row of the hexagon');
      for (const i of row) rowEl.appendChild(pileEl(state, i, legal, pending));
      board.appendChild(rowEl);
    }

    api.table.textContent = '';
    api.table.appendChild(board);

    const hint = document.createElement('p');
    hint.className = 'shint';
    hint.innerHTML = state.over
      ? ''
      : pending
        ? `The <strong>sideways ${C.isExcuse(C.pileTop(state, pending.pile)) ? 'Excuse' : 'card'}</strong> ` +
          `revealed on pile ${pending.pile + 1} must jump — tap a glowing pile.`
        : sel == null
          ? 'Tap a pile to pick up its whole face-up stack, then tap a glowing neighbour ' +
            'to merge them. The pile you left flips its next card face up.'
          : 'Tap a glowing neighbour to move the stack there. Tap the pile again to put it back.';
    api.table.appendChild(hint);

    api.setStatus(
      `<strong>Moves ${state.moves}</strong> · piles <strong>${C.pilesLeft(state)}</strong>` +
      ` · biggest pile <strong>${C.score(state)}</strong> cards` +
      ` · set aside <strong>${state.setAside.length}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    return {
      title: o.title,
      cls: o.cls,
      score: C.score(state),
      body: `<p>${o.text}</p><p class="muted">Biggest pile: ${C.score(state)} of ${state.deckSize} cards, ` +
        `in ${state.moves} moves.</p>`,
    };
  },

  record: (state) => ({ win: state.over === 'won', score: C.score(state) }),
});

/* ------------------------------------------------------------ pile widget */

function pileEl(state, i, legal, pending) {
  const pile = state.piles[i];
  const cell = document.createElement('div');
  cell.className = 'shex-pile';
  cell.setAttribute('role', 'button');
  cell.tabIndex = 0;
  cell.style.setProperty('--n', String(Math.max(0, pile.cards.length - 1)));

  if (!pile.cards.length) {
    cell.classList.add('is-empty');
    cell.setAttribute('aria-label', `Pile ${i + 1}, empty for the rest of the game`);
  } else {
    const topId = C.pileTop(state, i);
    const top = data.byId[D.baseId(topId)];

    /* Every card in the pile, splayed: the bottom of the pile at the top of the
       cell, the playable top card at the front.  The sideways card lies across
       the pile at its own position instead of overlapping in line. */
    pile.cards.forEach((id, k) => {
      const isTop = k === pile.cards.length - 1;
      const faceUp = k >= pile.cards.length - pile.up;
      const sideways = pile.sideways === k;
      const def = data.byId[D.baseId(id)];
      const el = D.cardEl({ ...def, id }, {
        tag: 'div',
        static: true,
        faceDown: !faceUp,
        eager: isTop && i < 3,
      });
      el.style.setProperty('--k', String(k));
      if (sideways) el.classList.add('is-sideways');
      // the pile's own label carries the details for screen readers
      el.setAttribute('aria-hidden', 'true');
      cell.appendChild(el);
    });

    cell.setAttribute('aria-label',
      `Pile ${i + 1}: ${D.describe(top)}, ${pile.cards.length} cards, ` +
      `${pile.up} face up` + (pile.sideways != null ? ', one lying sideways' : ''));
  }

  const isSel = pending ? pending.pile === i : sel === i;
  if (isSel) cell.classList.add('is-selected');
  if (legal.has(i)) cell.classList.add('is-legal');
  if ((pending || sel != null) && !isSel && !legal.has(i)) cell.classList.add('is-dim');

  const hit = () => onPile(state, i, legal);
  cell.addEventListener('click', hit);
  cell.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(); }
  });
  return cell;
}

/* ------------------------------------------------------------ interactions */

function onPile(state, i, legal) {
  if (state.over) return;

  if (state.pending) {
    if (!legal.has(i)) {
      D.toast(`The sideways card must jump to a glowing pile — ${C.jumpTargets(state, state.pending.pile).length} can take it.`);
      return;
    }
    api.pushHistory();
    api.setState(C.applyJump(state, i));
    return;
  }

  if (sel == null) {
    if (!C.pileTop(state, i)) { D.toast('That pile is empty for the rest of the game.'); return; }
    if (C.isExcuse(C.pileTop(state, i))) {
      D.toast('The Excuse never moves — other cards jump onto its pile.');
      return;
    }
    sel = i;
    api.refresh();
    return;
  }

  if (sel === i) { sel = null; api.refresh(); return; }

  if (!legal.has(i)) { D.toast(C.moveRejection(state, sel, i)); return; }

  api.pushHistory();
  const from = sel;
  sel = null;
  api.setState(C.applyMove(state, from, i));
}

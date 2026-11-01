/* Kittyhawk — UI.  The rules live in kittyhawk-core.js.
 *
 * Two Decktetts (60–72 cards, instance ids like "the-author#2").  Tap a
 * pile's top card to pick it up, then tap a glowing destination: a
 * foundation, a tableau pile — or the Deal button feeds the two heaps. */

import { mountGame, D } from '../gamikit.js';
import * as C from './kittyhawk-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let level = D.getSetting('kittyhawk.level', C.DEFAULT_LEVEL);
if (!C.LEVELS.some((l) => l.level === level)) level = C.DEFAULT_LEVEL;

let sel = null;                    // { kind: 'tableau'|'heap'|'foundation', i }

const api = mountGame({
  id: 'kittyhawk',
  title: 'Kittyhawk',
  subtitle: 'two Decktetts',
  rules: '../rules/kittyhawk.html',
  newGame: (seed) => C.newGame(seed, data, level),

  render(state, api) {
    const meta = C.LEVELS.find((l) => l.level === state.level) || C.LEVELS[0];
    api.setSubtitle(`${meta.name} · two Decktetts`);
    if (sel && !topOf(state, sel.kind, sel.i)) sel = null;

    api.table.textContent = '';

    /* ---- difficulty ---- */
    const levels = document.createElement('div');
    levels.className = 'kh-levels';
    for (const l of C.LEVELS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'iconbtn';
      b.textContent = String(l.level);
      b.setAttribute('aria-pressed', String(l.level === state.level));
      b.title = `${l.name}: ${l.blurb}`;
      b.addEventListener('click', () => pickLevel(state, l.level));
      levels.appendChild(b);
    }
    api.table.appendChild(levels);

    /* ---- foundations ---- */
    const fPanel = document.createElement('section');
    fPanel.className = 'panel';
    const fHead = document.createElement('h2');
    fHead.textContent = 'Foundations';
    const fCount = document.createElement('span');
    fCount.className = 'count';
    fCount.textContent = `${C.cardsIn(state)}/${state.total}`;
    fHead.appendChild(fCount);
    fPanel.appendChild(fHead);
    const fRow = document.createElement('div');
    fRow.className = 'kh-foundations';
    for (let i = 0; i < C.SUITS.length; i++) {
      fRow.appendChild(pileEl(state, 'foundation', i));
    }
    fPanel.appendChild(fRow);
    api.table.appendChild(fPanel);

    /* ---- stock and heaps ---- */
    const mid = document.createElement('div');
    mid.className = 'kh-mid';
    const stockWrap = document.createElement('div');
    stockWrap.className = 'kh-stock';
    const stock = document.createElement('div');
    stock.className = 'pile' + (state.stock.length ? '' : ' is-empty');
    stock.innerHTML = `<span class="n">${state.stock.length}</span><small>stock</small>`;
    stockWrap.appendChild(stock);
    const dealBtn = document.createElement('button');
    dealBtn.type = 'button';
    dealBtn.className = 'btn primary small';
    dealBtn.textContent = 'Deal 3 + 3';
    dealBtn.disabled = !!state.over;
    dealBtn.addEventListener('click', () => {
      try {
        const next = C.applyDeal(state);     // throws before any history is written
        api.pushHistory();
        api.setState(next);
      } catch (err) {
        api.toast(err.message);
      }
    });
    stockWrap.appendChild(dealBtn);
    mid.appendChild(stockWrap);
    for (let i = 0; i < C.HEAP_COUNT; i++) {
      mid.appendChild(pileEl(state, 'heap', i));
    }
    api.table.appendChild(mid);

    /* ---- tableau ---- */
    const tPanel = document.createElement('section');
    tPanel.className = 'panel';
    const tHead = document.createElement('h2');
    tHead.textContent = 'Tableau';
    tPanel.appendChild(tHead);
    const tRow = document.createElement('div');
    tRow.className = 'kh-tableau';
    for (let i = 0; i < C.TABLEAU_COUNT; i++) {
      tRow.appendChild(pileEl(state, 'tableau', i));
    }
    tPanel.appendChild(tRow);
    api.table.appendChild(tPanel);

    const hint = document.createElement('p');
    hint.className = 'kh-hint';
    hint.innerHTML = state.over
      ? ''
      : sel == null
        ? 'Tap a pile’s top card, then tap a glowing destination: the matching ' +
          'foundation, or a tableau pile whose top card is one rank higher in a shared suit.'
        : 'Tap a glowing pile to drop the card there — or deal three cards onto each heap.';
    api.table.appendChild(hint);

    api.setStatus(
      `Foundations <strong>${C.cardsIn(state)}/${state.total}</strong>` +
      ` · stock <strong>${state.stock.length}</strong>` +
      ` · moves <strong>${state.moves}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    if (state.over === 'won') {
      return {
        title: 'You win',
        cls: 'win',
        score: C.cardsIn(state),
        body: `<p>All ${state.total} cards are stacked in the foundation piles — ` +
          `six straight suits, Ace to Crown.</p>` +
          `<p class="muted">${state.moves} moves, ${state.deals} deal${state.deals === 1 ? '' : 's'} ` +
          `from the stock.</p>`,
      };
    }
    return {
      title: 'No moves left',
      cls: 'lose',
      score: C.cardsIn(state),
      body: `<p>No card can move anywhere and the stock is empty. ` +
        `<strong>${C.cardsIn(state)}</strong> of ${state.total} cards reached the foundations.</p>` +
        `<p class="muted">${state.moves} moves, ${state.deals} deals.</p>`,
    };
  },

  record: (state) => ({ win: state.over === 'won', score: C.cardsIn(state) }),
});

/* ------------------------------------------------------------ pile widget */

const topOf = (state, kind, i) => {
  const pile = kind === 'foundation' ? state.foundations[i]
    : kind === 'tableau' ? state.tableau[i] : state.heaps[i];
  return pile && pile.length ? pile[pile.length - 1] : null;
};

function pileEl(state, kind, i) {
  const pile = kind === 'foundation' ? state.foundations[i]
    : kind === 'tableau' ? state.tableau[i] : state.heaps[i];
  const cell = document.createElement('div');
  cell.className = `kh-pile kh-${kind}`;
  if (!pile.length) {
    cell.classList.add('is-empty');
    cell.textContent = kind === 'foundation' ? 'A' : '·';
    cell.setAttribute('role', 'button');
    cell.tabIndex = 0;
    const label = kind === 'foundation' ? 'an empty foundation — any Ace starts it'
      : 'an empty tableau pile — any card may fill it';
    cell.setAttribute('aria-label', label);
    const tap = () => onSlot(state, kind, i);
    cell.addEventListener('click', tap);
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
    });
  } else {
    pile.forEach((id, j) => {
      const def = data.byId[D.baseId(id)];
      const isTop = j === pile.length - 1;
      const el = D.cardEl({ ...def, id }, { tag: 'div', static: true, eager: isTop });
      el.classList.add('kh-card');
      el.style.setProperty('--k', String(j));
      if (!isTop) el.classList.add('is-buried');
      if (sel && sel.kind === kind && sel.i === i && isTop) el.classList.add('is-selected');
      if (sel && isLegalDest(state, sel, kind, i)) el.classList.add('is-legal');
      el.setAttribute('aria-label',
        `${kind} ${i + 1}${isTop ? ', top card' : ''}: ${D.describe(def)}`);
      if (isTop) {
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        const tap = () => onCard(state, kind, i, j);
        el.addEventListener('click', tap);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
        });
      } else {
        el.addEventListener('click', () => {
          api.toast(`Only the top card of a ${kind} can move.`);
        });
      }
      cell.appendChild(el);
    });
    cell.style.setProperty('--n', String(Math.max(0, pile.length - 1)));
  }
  if (sel && isLegalDest(state, sel, kind, i)) cell.classList.add('is-legal-target');
  return cell;
}

const isLegalDest = (state, s, kind, i) => {
  const id = topOf(state, s.kind, s.i);
  return !!id && !(s.kind === kind && s.i === i) && C.canMoveTo(state, id, kind, i);
};

/* --------------------------------------------------------------- clicking */

function onSlot(state, kind, i) {
  if (state.over) return;
  if (!sel) {
    api.toast(kind === 'heap'
      ? 'Cards only reach the heaps by dealing from the stock.'
      : kind === 'foundation'
        ? 'Only an Ace may start an empty foundation pile.'
        : 'Pick up a card first — tap a pile’s top card.');
    return;
  }
  move(state, kind, i);
}

function onCard(state, kind, i, j) {
  if (state.over) return;
  const pile = kind === 'foundation' ? state.foundations[i]
    : kind === 'tableau' ? state.tableau[i] : state.heaps[i];
  const isTop = j === pile.length - 1;
  if (!isTop) {
    api.toast(`Only the top card of a ${kind} can move.`);
    return;
  }
  if (sel && isLegalDest(state, sel, kind, i)) { move(state, kind, i); return; }
  if (sel && sel.kind === kind && sel.i === i) { sel = null; api.refresh(); return; }
  if (sel) { explain(state, sel, kind, i); return; }
  sel = { kind, i };
  api.refresh();
}

function move(state, kind, i) {
  const from = { ...sel };
  api.pushHistory();
  sel = null;
  try {
    api.setState(C.applyMove(state, from.kind, from.i, kind, i));
  } catch (err) {
    api.toast(err.message);
    api.refresh();
  }
}

function explain(state, s, kind, i) {
  const id = topOf(state, s.kind, s.i);
  const rank = C.orderOf(id);
  if (kind === 'heap' || kind === 'stock') {
    api.toast('Cards only reach the heaps by dealing from the stock.');
    return;
  }
  if (kind === 'foundation') {
    const f = state.foundations[i];
    api.toast(f.length
      ? `That foundation takes the card one rank higher in its own suit — rank ${rank + 1}.`
      : 'Only an Ace may start an empty foundation pile.');
    return;
  }
  const t = state.tableau[i];
  if (!t.length) { move(state, kind, i); return; }
  const top = t[t.length - 1];
  api.toast(`That tableau pile takes a card one rank higher sharing a suit with its ` +
    `top card — rank ${C.orderOf(top) + 1} in a shared suit; you hold rank ${rank}.`);
}

/* ------------------------------------------------------------ difficulty */

async function pickLevel(state, n) {
  if (n === state.level) return;
  if (state.moves > 0 && !state.over) {
    const ok = await api.confirm({
      title: 'Change difficulty?',
      message: 'This game is still in progress and will be discarded.',
      okLabel: 'New game',
      danger: true,
    });
    if (!ok) return;
  }
  level = n;
  sel = null;
  D.setSetting('kittyhawk.level', n);
  api.newGame();
}

/* Myrmex — UI.  The rules live in myrmex-core.js.
 *
 * Two Decktetts (60–70 cards, instance ids like "the-author#2").  Tap a
 * face-up card to pick up the run from that card to the top of its pile,
 * then tap a pile to drop it.  The Deal button restocks the tableau. */

import { mountGame, D } from '../gamikit.js';
import * as C from './myrmex-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let level = D.getSetting('myrmex.level', C.DEFAULT_LEVEL);
if (!C.LEVELS.some((l) => l.id === level)) level = C.DEFAULT_LEVEL;
let larval = D.getSetting('myrmex.larval', false) === true;

let sel = null;                    // { from, depth }

const api = mountGame({
  id: 'myrmex',
  title: 'Myrmex',
  subtitle: 'two Decktetts',
  rules: '../rules/myrmex.html',
  newGame: (seed) => C.newGame(seed, data, level, larval),

  render(state, api) {
    const meta = C.LEVELS.find((l) => l.id === state.level) || C.LEVELS[0];
    api.setSubtitle(`${meta.name} · two Decktetts`);
    if (sel && !C.legalRuns(state, sel.from).includes(sel.depth)) sel = null;

    api.table.textContent = '';

    /* ---- difficulty ---- */
    const levels = document.createElement('div');
    levels.className = 'mx-levels';
    for (const l of C.LEVELS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'iconbtn';
      b.textContent = l.name;
      b.setAttribute('aria-pressed', String(l.id === state.level));
      b.title = l.blurb;
      b.addEventListener('click', () => pickLevel(state, l.id));
      levels.appendChild(b);
    }
    if (state.level === 'minor') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'iconbtn';
      b.textContent = 'Larval Stage';
      b.setAttribute('aria-pressed', String(!!state.larval));
      b.title = 'the easier variant: the initial tableau is dealt face up';
      b.addEventListener('click', () => {
        larval = !state.larval;
        D.setSetting('myrmex.larval', larval);
        api.newGame();
      });
      levels.appendChild(b);
    }
    api.table.appendChild(levels);

    /* ---- the six chambers ---- */
    const chambers = document.createElement('div');
    chambers.className = 'mx-chambers';
    for (let i = 0; i < C.CHAMBER_COUNT; i++) {
      const slot = document.createElement('div');
      slot.className = 'mx-chamber';
      const ch = state.chambers[i];
      if (ch) {
        slot.classList.add('is-full');
        slot.appendChild(D.suitChip(ch.suit));
        slot.title = `${D.SUIT_NAME[ch.suit]} chamber: Crown down to Ace`;
      } else {
        slot.textContent = '?';
        slot.title = 'an empty chamber — fill it with a suit from Crown down to Ace';
      }
      chambers.appendChild(slot);
    }
    api.table.appendChild(chambers);

    /* ---- the eight tableau piles ---- */
    const legal = new Set(
      sel == null ? [] : C.legalMoves(state).filter((m) => m.from === sel.from && m.depth === sel.depth).map((m) => m.to)
    );
    const grid = document.createElement('div');
    grid.className = 'mx-grid';
    for (let i = 0; i < C.PILE_COUNT; i++) {
      const pile = state.piles[i];
      const cell = document.createElement('div');
      cell.className = 'mx-pile';
      cell.dataset.i = i;
      cell.style.setProperty('--dn', String(pile.down.length));
      cell.style.setProperty('--up', String(Math.max(0, pile.up.length - 1)));

      if (!pile.down.length && !pile.up.length) {
        cell.classList.add('is-empty');
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', `Pile ${i + 1}: empty — any card or run may fill it`);
        const tap = () => {
          if (state.over) return;
          if (sel) api.setState(C.applyMove(state, sel.from, i, sel.depth));
          else api.toast('That space is empty — pick up a card or a run first.');
        };
        cell.addEventListener('click', tap);
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
        });
      }

      pile.down.forEach((id, k) => {
        const back = document.createElement('div');
        back.className = 'card is-face-down mx-card mx-back';
        back.style.setProperty('--k', String(k));
        back.setAttribute('aria-hidden', 'true');
        cell.appendChild(back);
      });

      pile.up.forEach((id, j) => {
        const def = data.byId[D.baseId(id)];
        const el = D.cardEl({ ...def, id }, { tag: 'div', static: true, eager: i < 4 && j === pile.up.length - 1 });
        el.classList.add('mx-card', 'mx-up');
        el.style.setProperty('--k', String(pile.down.length + j));
        const depth = pile.up.length - j;
        const inRun = C.legalRuns(state, i).includes(depth);
        if (sel && sel.from === i && inRun && depth <= sel.depth) el.classList.add('is-selected');
        if (legal.has(i)) el.classList.add('is-legal');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.setAttribute('aria-label', `Pile ${i + 1}, card ${j + 1} of ${pile.up.length}: ${D.describe(def)}`);
        const tap = () => onCard(state, i, j, inRun, depth);
        el.addEventListener('click', tap);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
        });
        cell.appendChild(el);
      });

      if (legal.has(i)) cell.classList.add('is-legal-target');
      grid.appendChild(cell);
    }
    api.table.appendChild(grid);

    /* ---- the draw pile ---- */
    const dealRow = document.createElement('div');
    dealRow.className = 'mx-deal';
    const dealBtn = document.createElement('button');
    dealBtn.type = 'button';
    dealBtn.className = 'btn primary';
    dealBtn.textContent = `Deal a row (${state.stock.length} left)`;
    dealBtn.disabled = !!state.over;
    dealBtn.addEventListener('click', () => {
      try {
        const next = C.applyDeal(state);      // throws before any history is written
        api.pushHistory();
        api.setState(next);
      } catch (err) {
        api.toast(err.message);
      }
    });
    dealRow.appendChild(dealBtn);
    api.table.appendChild(dealRow);

    const hint = document.createElement('p');
    hint.className = 'mx-hint';
    hint.innerHTML = state.over
      ? ''
      : sel == null
        ? 'Tap a face-up card to pick up the run from that card to the top of its pile, ' +
          'then tap a pile to move it — onto a card one rank higher, or into any empty space.'
        : `Run of ${sel.depth} picked up. Tap a glowing pile to drop it there.`;
    api.table.appendChild(hint);

    api.setStatus(
      `Chambers <strong>${state.chambers.length}/6</strong>` +
      ` · draw pile <strong>${state.stock.length}</strong>` +
      ` · moves <strong>${state.moves}</strong>` +
      (C.faceDown(state) ? ` · face down <strong>${C.faceDown(state)}</strong>` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const n = state.chambers.length;
    const deals = `${state.deals} restock${state.deals === 1 ? '' : 's'} of the tableau`;
    if (state.over === 'won') {
      return {
        title: 'Full victory',
        cls: 'win',
        score: n,
        body: `<p>${C.OUTCOME.won.text}</p>` +
          `<p class="muted">All six chambers filled in ${state.moves} moves, ${deals}.</p>`,
      };
    }
    if (n === 0) {
      return {
        title: 'Total loss',
        cls: 'lose',
        score: 0,
        body: `<p>Not a single chamber was completed — a massive cave-in. ` +
          `Nobody bothers to dig you out.</p>` +
          `<p class="muted">The draw pile is spent after ${state.moves} moves, ${deals}.</p>`,
      };
    }
    return {
      title: 'Partial win',
      cls: '',
      score: n,
      body: `<p>You completed <strong>${n}</strong> chamber${n === 1 ? '' : 's'}, but the rest of ` +
        `the colony is still a mess. You are evicted — and devoured by a spider in the garden.</p>` +
        `<p class="muted">${state.moves} moves, ${deals}.</p>`,
    };
  },

  record: (state) => ({ win: state.over === 'won', score: state.chambers.length }),
});

function onCard(state, i, j, inRun, depth) {
  if (state.over) return;
  if (sel && sel.from === i) {
    if (!inRun) {
      api.toast('Cards only move together as a run of consecutive same-suit cards ' +
        'stepping down one rank at a time.');
      return;
    }
    if (depth === sel.depth) { sel = null; api.refresh(); return; }
    sel = { from: i, depth };
    api.refresh();
    return;
  }
  if (sel) {
    if (C.canMove(state, sel.from, i, sel.depth)) {
      const from = sel.from;
      const run = sel.depth;
      api.pushHistory();
      sel = null;
      api.setState(C.applyMove(state, from, i, run));
      return;
    }
    if (inRun) { sel = { from: i, depth }; api.refresh(); return; }
    explain(state, sel, i);
    return;
  }
  if (!inRun) {
    api.toast('Cards only move together as a run of consecutive same-suit cards ' +
      'stepping down one rank at a time — or one at a time from the top.');
    return;
  }
  sel = { from: i, depth };
  api.refresh();
}

function explain(state, s, to) {
  const src = state.piles[s.from];
  const bottom = src.up[src.up.length - s.depth];
  const dst = state.piles[to];
  if (dst.up.length) {
    const top = dst.up[dst.up.length - 1];
    api.toast(`A run starting at rank ${C.orderOf(bottom)} may only drop onto a card of ` +
      `rank ${C.orderOf(bottom) + 1}; that pile’s top is rank ${C.orderOf(top)}.`);
  } else {
    api.toast('That pile cannot take this run.');
  }
}

async function pickLevel(state, id) {
  if (id === state.level) return;
  if (state.moves > 0 && !state.over) {
    const ok = await api.confirm({
      title: 'Change difficulty?',
      message: 'This game is still in progress and will be discarded.',
      okLabel: 'New game',
      danger: true,
    });
    if (!ok) return;
  }
  level = id;
  sel = null;
  D.setSetting('myrmex.level', id);
  api.newGame();
}

/* Head Solitaire — UI.  The rules live in head-solitaire-core.js. */

import { mountGame, D, panel, pile } from '../gamikit.js';
import * as C from './head-solitaire-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let selected = [];      // hand cards picked for a meld
let swapFrom = null;    // first card of a swap (meldless hands only)

const api = mountGame({
  id: 'head-solitaire',
  title: 'Head Solitaire',
  subtitle: 'meld sets, suits and runs out of your hand',
  rules: '../rules/head-solitaire.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    selected = selected.filter((id) => state.hand.includes(id));
    if (swapFrom != null && swapFrom >= state.hand.length) swapFrom = null;
    const offersMelds = C.handMelds(state.hand).length > 0;
    const meldMode = offersMelds && !state.offer;

    api.table.textContent = '';

    /* ---- the piles you hold: draw, discard, phase ---- */
    const piles = document.createElement('div');
    piles.className = 'hs-piles';

    const drawPile = pile('draw');
    drawPile.set(state.draw.length);
    piles.appendChild(drawPile.el);

    const disc = document.createElement('div');
    disc.className = 'hs-discard';
    if (state.discard.length) {
      const top = state.discard[0];          // the card you will see first in pass two
      disc.appendChild(D.cardEl({ ...data.byId[top], id: top }, {
        tag: 'div', static: true, badge: `×${state.discard.length}`,
      }));
      const lab = document.createElement('small');
      lab.textContent = 'discard';
      disc.appendChild(lab);
    } else {
      disc.className += ' is-empty';
      disc.innerHTML = '<span>—</span><small>discard</small>';
    }
    piles.appendChild(disc);

    const pass = document.createElement('p');
    pass.className = 'hs-pass';
    pass.innerHTML = state.phase === 1
      ? 'Pass <strong>1</strong> of 2 — meld what you can.'
      : 'Pass <strong>2</strong> of 2 — the discard came back as the draw pile.';
    piles.appendChild(pass);
    api.table.appendChild(piles);

    /* ---- the archive: melds you have placed ---- */
    const archCount = document.createElement('span');
    archCount.className = 'count';
    archCount.textContent = `${state.archive.length} melds · ${C.melded(state)} cards`;
    const arch = panel('Archive', archCount);
    if (!state.archive.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = 'No melds yet.';
      arch.row.appendChild(p);
    }
    for (const meld of state.archive) {
      const rowEl = document.createElement('div');
      rowEl.className = 'hs-meld';
      const label = document.createElement('span');
      label.className = 'hs-meld-label';
      label.textContent = C.meldLabel(meld);
      rowEl.appendChild(label);
      for (const id of meld.ids) {
        rowEl.appendChild(D.cardEl({ ...data.byId[id], id }, { tag: 'div', static: true, eager: true }));
      }
      arch.row.appendChild(rowEl);
    }
    arch.row.className = 'hs-archive';
    api.table.appendChild(arch.section);

    /* ---- your hand ---- */
    const handCount = document.createElement('span');
    handCount.className = 'count';
    handCount.textContent = `${state.hand.length}/6`;
    const hand = panel('Your hand', handCount);
    hand.row.className = 'hs-hand';
    state.hand.forEach((id, i) => {
      const el = D.cardEl({ ...data.byId[id], id }, {
        tag: 'div',
        selected: selected.includes(id) || swapFrom === i,
        eager: true,
        onPick: () => onHandCard(state, i, id, meldMode),
      });
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHandCard(state, i, id, meldMode); }
      });
      hand.row.appendChild(el);
    });
    api.table.appendChild(hand.section);

    /* ---- actions ---- */
    const actions = document.createElement('div');
    actions.className = 'hs-actions';

    if (state.offer) {
      const dump = document.createElement('button');
      dump.className = 'btn';
      dump.textContent = 'Discard the top card, then draw';
      dump.addEventListener('click', () => act(state, { type: 'discard-top' },
        'Dumped the top card of the new draw pile.'));
      const draw = document.createElement('button');
      draw.className = 'btn primary';
      draw.textContent = 'Draw six';
      draw.addEventListener('click', () => act(state, { type: 'draw' }, 'Drew your second hand of six.'));
      actions.append(dump, draw);
    } else {
      const meld = document.createElement('button');
      meld.className = 'btn primary';
      meld.textContent = 'Meld';
      meld.addEventListener('click', () => {
        if (!selected.length) { api.toast('Tap the cards of a meld first.'); return; }
        const ids = selected.slice();
        const type = C.meldType(ids);
        if (!type) {
          api.toast('Those cards do not make a meld: all six suits exactly once, ' +
            'three or more of one rank, or three or more consecutive ranks sharing a suit.');
          return;
        }
        selected = [];
        act(state, { type: 'meld', ids }, `Placed ${C.meldLabel({ type, ids })}.`);
      });
      actions.appendChild(meld);

      if (offersMelds) {
        const hint = document.createElement('button');
        hint.className = 'btn small';
        hint.textContent = 'Hint';
        hint.addEventListener('click', () => {
          const m = C.suggestMeld(state.hand);
          if (m) { selected = m.ids.slice(); api.refresh(); api.toast(`Try ${C.meldLabel(m)}.`); }
        });
        actions.appendChild(hint);
      }

      const discard = document.createElement('button');
      discard.className = 'btn';
      discard.textContent = 'Discard hand';
      discard.title = offersMelds
        ? 'Your hand contains a meld — you must place it.'
        : 'Discard all six cards face up at the back.';
      discard.addEventListener('click', () => {
        if (offersMelds) {
          api.toast('This hand contains a meld — place it before discarding.');
          return;
        }
        act(state, { type: 'discard' }, 'Discarded the hand face up.');
      });
      actions.appendChild(discard);
    }
    api.table.appendChild(actions);

    const hintEl = document.createElement('p');
    hintEl.className = 'hs-hint';
    hintEl.textContent = state.over
      ? ''
      : state.offer
        ? 'The first pass is through and your hand is empty: you may discard the top card ' +
          'of the new draw pile before drawing your hand of six.'
        : meldMode
          ? 'Tap the cards of a meld, then tap Meld. A hand with a meld in it must meld it.'
          : state.phase === 1
            ? 'No meld here. Tap one card, then another, to reorder them — then discard: ' +
              'the order you discard in is the order you will see them again in pass two.'
            : 'No meld here. Discard the hand — order no longer matters.';
    api.table.appendChild(hintEl);

    api.setStatus(
      `Pass <strong>${state.phase}</strong> · draw <strong>${state.draw.length}</strong>` +
      ` · discard <strong>${state.discard.length}</strong>` +
      ` · melded <strong>${C.melded(state)}</strong>/36` +
      (state.phase === 2 ? ` · score <strong>${C.score(state)}</strong>` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const best = api.records().best;
    const bestSoFar = best == null ? null : -best;          // stored negated: lower is better
    const s = C.score(state);
    const title = bestSoFar != null && s < bestSoFar ? 'New best' : 'Game over';
    return {
      title,
      cls: bestSoFar != null && s < bestSoFar ? 'win' : '',
      score: s,
      body: `<p>You melded ${C.melded(state)} cards across ${state.archive.length} melds. ` +
        `${s} card${s === 1 ? '' : 's'} stayed in your final discard — that is your score, ` +
        `and lower is better.</p>` +
        (bestSoFar != null ? `<p class="muted">Your best so far: ${bestSoFar}.</p>` : ''),
    };
  },

  // The record system keeps the *highest* score it is handed, so a
  // lower-is-better game stores the score negated: max(-N) = your lowest N.
  record(state) {
    const r = api.records();
    const bestSoFar = r.best == null ? null : -r.best;
    const s = C.score(state);
    return { win: bestSoFar == null || s < bestSoFar, score: -s };
  },
});

function onHandCard(state, i, id, meldMode) {
  if (state.over || state.offer) return;
  if (meldMode) {
    const at = selected.indexOf(id);
    if (at >= 0) selected.splice(at, 1);
    else selected.push(id);
    api.refresh();
    return;
  }
  // Meldless hand: the wiki lets you re-order the six before discarding.
  if (swapFrom == null) { swapFrom = i; api.refresh(); return; }
  if (swapFrom === i) { swapFrom = null; api.refresh(); return; }
  const from = swapFrom;
  swapFrom = null;
  api.pushHistory();
  api.setState(C.applyMove(state, { type: 'swap', a: from, b: i }));
}

function act(state, action, message) {
  api.pushHistory();
  selected = [];
  swapFrom = null;
  api.setState(C.applyMove(state, action));
  api.toast(message);
}

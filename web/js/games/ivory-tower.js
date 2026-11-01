/* Ivory Tower — UI.  The rules live in ivory-tower-core.js. */

import { mountGame, D, pile as pileEl } from '../gamikit.js';
import * as C from './ivory-tower-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const describe = (id) => D.describe(data.byId[D.baseId(id)]);
let selected = null;          // 'draw' | 0 | 1 | 2 — the card being held
let note = '';                // what just happened, shown in the status line

const api = mountGame({
  id: 'ivory-tower',
  title: 'Ivory Tower',
  subtitle: 'one suit, Ace to Crown',
  rules: '../rules/ivory-tower.html',
  newGame: (seed) => {
    selected = null;
    note = '';
    return C.newGame(seed, data.basicDeck);
  },
  restore: (s) => s && Array.isArray(s.tower) && Array.isArray(s.reserves) && s.reserves.length === 3,

  render(state, api) {
    if (selected !== null && !C.cardOf(state, selected)) selected = null;
    const legal = new Set(selected == null ? [] : C.destinations(state, selected));

    const board = document.createElement('div');
    board.className = 'it-board';

    /* --- the tower ------------------------------------------------- */
    const towerSlot = slotEl('tower');
    towerSlot.appendChild(fanEl(state.tower));
    towerSlot.setAttribute('aria-label', state.tower.length
      ? `Tower: ${state.tower.length} card${state.tower.length === 1 ? '' : 's'}, top ${describe(state.tower[state.tower.length - 1])}`
      : 'Tower: empty, the Ace starts the tower');
    if (!state.tower.length) towerSlot.appendChild(emptyMark('the Ace starts the tower'));
    if (selected != null) {
      if (legal.has('tower')) towerSlot.classList.add('is-legal');
      else towerSlot.classList.add('is-dim');
    }
    towerSlot.addEventListener('click', () => onTower(state));
    board.appendChild(zone('Tower', towerSlot, ['it-tower']));

    /* --- the resource piles ---------------------------------------- */
    const piles = document.createElement('div');
    piles.className = 'it-piles';
    state.reserves.forEach((pile, i) => {
      const s = slotEl(i);
      s.appendChild(fanEl(pile.slice().reverse()));   // lowest card last, face up
      s.setAttribute('aria-label', pile.length
        ? `Reserve pile ${i + 1}: ${pile.length} card${pile.length === 1 ? '' : 's'}, lowest ${describe(pile[0])}`
        : `Reserve pile ${i + 1}: empty, a Crown starts it`);
      if (!pile.length) s.appendChild(emptyMark('a Crown starts a pile'));
      if (selected != null) {
        if (legal.has(i)) s.classList.add('is-legal');
        else if (selected !== i) s.classList.add('is-dim');
      }
      if (selected === i) s.classList.add('is-held');
      s.addEventListener('click', () => onSlot(state, i, legal));
      piles.appendChild(s);
    });
    board.appendChild(zone('Reserve piles', piles, ['it-pilerow']));

    /* --- the deck --------------------------------------------------- */
    const deckRow = document.createElement('div');
    deckRow.className = 'it-deck';
    const dp = pileEl('deck');
    dp.set(state.deck.length);
    deckRow.appendChild(dp.el);

    const topId = C.cardOf(state, 'draw');
    if (topId) {
      const picked = D.cardEl({ ...data.byId[D.baseId(topId)], id: topId }, {
        tag: 'div',
        static: true,
        eager: true,
        selected: selected === 'draw',
        legal: legal.has('tower') || state.reserves.some((_, i) => legal.has(i)),
      });
      picked.addEventListener('click', () => {
        if (state.over) return;
        selected = selected === 'draw' ? null : 'draw';
        note = '';
        api.refresh();
      });
      deckRow.appendChild(picked);
    } else {
      const spent = document.createElement('div');
      spent.className = 'it-spent';
      spent.textContent = 'the deck is spent';
      deckRow.appendChild(spent);
    }

    const turn = document.createElement('button');
    turn.type = 'button';
    turn.className = 'btn small it-turn';
    turn.textContent = state.deck.length ? 'Turn over 3 more cards' : 'Flip the draw pile';
    turn.disabled = !C.canTurnOver(state);
    turn.addEventListener('click', () => {
      const before = state.deck.length;
      const next = C.applyTurnOver(state);
      const n = Math.min(C.TURNS, before);
      note = `Turned over ${n} card${n === 1 ? '' : 's'} — ` +
        (next.draw.length ? `${describe(C.cardOf(next, 'draw'))} is available.` : 'nothing left to turn.');
      selected = null;
      api.pushHistory();
      api.setState(next);
    });
    if (!state.over) deckRow.appendChild(turn);    // nothing is actionable at the end
    board.appendChild(zone('Draw pile', deckRow, ['it-deckzone']));

    /* --- chrome ------------------------------------------------------ */
    api.table.textContent = '';
    api.table.appendChild(board);

    const hint = document.createElement('p');
    hint.className = 'ithint';
    hint.innerHTML = state.over
      ? ''
      : selected == null
        ? 'Tap the draw card — or the lowest card of a pile — to pick it up, then tap the tower or a pile to play it.'
        : 'The tower takes one rank more of its suit; a pile takes one rank less that shares no suit. ' +
          'Nothing fits? Turn over three more cards.';
    api.table.appendChild(hint);

    const high = C.towerTopRank(state);
    api.setStatus(
      `<strong>Moves ${state.moves}</strong>` +
      ` · tower <strong>${state.tower.length}/10</strong>` +
      (high ? ` (top: <strong>${D.rankLabel(data.byId[D.baseId(state.tower[state.tower.length - 1])])}</strong>)` : '') +
      ` · deck <strong>${state.deck.length}</strong>` +
      ` · piles <strong>${state.reserves.filter((p) => p.length).length}/3</strong>` +
      (note ? ` · ${note}` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    const top = state.tower.length
      ? describe(state.tower[state.tower.length - 1])
      : 'no card at all';
    return {
      title: o.title,
      cls: o.cls,
      score: state.over === 'won' ? null : C.score(state),
      body: `<p>${o.text}</p>` +
        `<p class="muted">The tower reached ${top} in ${state.moves} moves.` +
        (state.over === 'won' ? '' : ' Its highest card is your score.') + '</p>',
    };
  },

  record: (state) => ({ win: state.over === 'won', score: state.over === 'won' ? null : C.score(state) }),
});

/* ------------------------------------------------------------- helpers */

function zone(label, body, cls = []) {
  const z = document.createElement('div');
  z.className = 'it-zone' + (cls.length ? ' ' + cls.join(' ') : '');
  const h = document.createElement('span');
  h.className = 'it-label';
  h.textContent = label;
  z.appendChild(h);
  z.appendChild(body);
  return z;
}

function slotEl(dest) {
  const s = document.createElement('div');
  s.className = 'it-slot';
  s.setAttribute('role', 'button');
  s.tabIndex = 0;
  s.dataset.dest = String(dest);
  return s;
}

function emptyMark(text) {
  const e = document.createElement('span');
  e.className = 'it-empty';
  e.textContent = text;
  return e;
}

/** A stack of cards: every card but the last shown as a thin strip of its top
 *  edge, the last one — the playable one — face up in full. */
function fanEl(ids) {
  const fan = document.createElement('div');
  fan.className = 'it-fan';
  ids.forEach((id, k) => {
    if (k === ids.length - 1) {
      fan.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
        tag: 'div', static: true, eager: true,
      }));
    } else {
      const strip = document.createElement('div');
      strip.className = 'it-strip';
      const img = document.createElement('img');
      img.src = D.cardUrl(id, 'web');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      strip.appendChild(img);
      fan.appendChild(strip);
    }
  });
  return fan;
}

/** Tapping a slot: play the held card there, or pick that pile's lowest card. */
function onSlot(state, i, legal) {
  if (state.over) return;
  if (selected != null && selected !== i) {
    if (legal.has(i)) {
      const src = selected;
      const next = C.applyMove(state, { src, dest: i });
      note = `Played ${describe(C.cardOf(state, src))} onto pile ${i + 1}.`;
      selected = null;
      api.pushHistory();
      api.setState(next);
      return;
    }
    if (selected !== 'draw') {
      api.toast(whyNot(state, selected, i));
      return;
    }
  }
  if (!state.reserves[i].length) {
    api.toast(selected == null
      ? 'Only a Crown can start a reserve pile.'
      : whyNot(state, selected, i));
    return;
  }
  selected = selected === i ? null : i;
  note = '';
  api.refresh();
}

/** Tapping the tower slot plays the held card there. */
function onTower(state) {
  if (state.over) return;
  if (selected == null) { api.toast('The tower starts with an Ace.'); return; }
  if (!C.destinations(state, selected).includes('tower')) {
    api.toast(whyNot(state, selected, 'tower'));
    return;
  }
  const src = selected;
  const next = C.applyMove(state, { src, dest: 'tower' });
  note = `Played ${describe(C.cardOf(state, src))} to the tower.`;
  selected = null;
  api.pushHistory();
  api.setState(next);
}

function whyNot(state, src, dest) {
  const id = C.cardOf(state, src);
  if (dest === 'tower') {
    if (!state.tower.length) return 'Only an Ace can start the tower.';
    const need = C.towerTopRank(state) + 1;
    return `The tower takes the ${D.rankLabel({ rank: need })} of ` +
      `${D.SUIT_NAME[C.towerSuit(state)]} next.`;
  }
  const pile = state.reserves[dest];
  if (!pile.length) return 'Only a Crown can start a reserve pile.';
  return `That pile takes a card one rank below the ${describe(pile[0])} ` +
    'that shares no suit with it.';
}

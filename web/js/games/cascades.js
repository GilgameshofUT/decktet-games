/* Cascades — UI.  The rules live in cascades-core.js. */

import { mountGame, D } from '../gamikit.js';
import * as C from './cascades-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const extended = () => D.getSetting('cascades.deck', 'basic') === 'extended';

let sel = null;   // { kind: 'waste' } | { kind: 'reserve', i } — the picked-up card

const api = mountGame({
  id: 'cascades',
  title: 'Cascades',
  subtitle: 'play the deck into three ranked tiers',
  rules: '../rules/cascades.html',
  newGame: (seed) => C.newGame(seed, C.deckList(data, extended())),
  restore: (st) => !!(st && Array.isArray(st.tiers) && typeof st.trips === 'number'),

  render(state, api) {
    if (sel && !C.sourceCard(state, sel)) sel = null;
    api.setSubtitle(extended()
      ? 'three ranked tiers · with Pawns & Courts'
      : 'three ranked tiers · basic deck');

    const table = api.table;
    table.textContent = '';

    /* ---- the three tiers ---- */
    const tierNames = ['Top tier', 'Middle tier', 'Bottom tier'];
    state.tiers.forEach((tier, t) => {
      const row = document.createElement('div');
      row.className = 'cs-tier';
      row.setAttribute('role', 'button');
      row.tabIndex = 0;

      const label = document.createElement('span');
      label.className = 'cs-tierlabel';
      label.textContent = tierNames[t];
      row.appendChild(label);

      const fan = document.createElement('div');
      fan.className = 'cs-fan';
      tier.forEach((id, i) => {
        const c = data.byId[D.baseId(id)];
        fan.appendChild(D.cardEl({ ...c, id }, {
          tag: 'div', static: true, eager: t === 0 && i < 4,
          badge: null,
        }));
      });
      if (!tier.length) {
        const e = document.createElement('span');
        e.className = 'cs-empty';
        e.textContent = 'empty — no suit to match';
        fan.appendChild(e);
      }
      row.appendChild(fan);

      const ok = sel != null && C.canPlay(state, sel, t);
      if (ok) row.classList.add('is-legal');
      if (sel != null && !ok) row.classList.add('is-dim');

      const hit = () => onTier(state, t, ok);
      row.addEventListener('click', hit);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(); }
      });
      table.appendChild(row);
    });

    /* ---- deck, waste and the three draw piles ---- */
    const src = document.createElement('div');
    src.className = 'cs-sources';

    // the deck: tap to turn over the next trio, or to redeal the waste
    const deckEl = document.createElement('button');
    deckEl.type = 'button';
    const redealReady = C.canRedeal(state);
    deckEl.className = 'pile cs-src' + (state.stock.length || redealReady ? '' : ' is-empty');
    deckEl.innerHTML = state.stock.length
      ? `<span class="n">${state.stock.length}</span><small>deck · tap to flip 3</small>`
      : redealReady
        ? `<span class="n">↻</span><small>deck spent · tap to redeal</small>`
        : `<span class="n">0</span><small>deck spent</small>`;
    deckEl.setAttribute('aria-label', state.stock.length
      ? `Deck, ${state.stock.length} cards left. Turn over three.`
      : redealReady ? 'Deck spent. Tap to flip the waste over for another trip.'
        : 'Deck spent.');
    deckEl.addEventListener('click', () => onFlip(state));
    src.appendChild(deckEl);

    // the waste: the top card of the current trio is playable
    src.appendChild(sourcePile(state, { kind: 'waste' }, 'waste'));

    // the three draw piles, locked until freed
    const free = C.reservesFree(state);
    state.reserves.forEach((r, i) => {
      const el = free[i]
        ? sourcePile(state, { kind: 'reserve', i }, `draw ${i + 1}`)
        : (() => {
            const e = document.createElement('div');
            e.className = 'pile cs-src is-locked';
            e.innerHTML = `<span class="n">${r.length}</span><small>draw ${i + 1} · locked</small>`;
            e.setAttribute('aria-label', `Draw pile ${i + 1}, locked, ${r.length} cards`);
            return e;
          })();
      src.appendChild(el);
    });
    table.appendChild(src);

    /* ---- controls ---- */
    const ctrls = document.createElement('div');
    ctrls.className = 'cs-ctrls';

    const flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.className = 'btn small';
    flipBtn.textContent = state.stock.length
      ? `Flip 3 (${state.stock.length} left)`
      : C.canRedeal(state) ? 'Redeal the waste' : 'Deck spent';
    flipBtn.disabled = (!state.stock.length && !C.canRedeal(state)) || !!state.over;
    flipBtn.addEventListener('click', () => onFlip(state));
    ctrls.appendChild(flipBtn);

    const deckBtn = document.createElement('button');
    deckBtn.type = 'button';
    deckBtn.className = 'btn small';
    deckBtn.textContent = extended() ? 'Deck: +Pawns & Courts (44)' : 'Deck: basic (36)';
    deckBtn.addEventListener('click', () => switchDeck());
    ctrls.appendChild(deckBtn);
    table.appendChild(ctrls);

    /* ---- hint + status ---- */
    const hint = document.createElement('p');
    hint.className = 'shint';
    hint.innerHTML = state.over
      ? ''
      : sel == null
        ? 'Tap the <strong>deck</strong> to turn over three cards, then tap a glowing ' +
          'pile’s top card to pick it up — and tap the tier it should go on. When the ' +
          'deck runs out, flip the waste over for another trip.'
        : 'Tap a glowing tier to play the card there. Tap the card again to put it back.';
    table.appendChild(hint);

    const left = state.stock.length + state.waste.length
      + state.reserves.reduce((n, r) => n + r.length, 0);
    api.setStatus(
      `<strong>Moves ${state.moves}</strong> · tiers <strong>${C.cardsPlayed(state)}/${state.deckSize}</strong>` +
      ` · left to play <strong>${left}</strong> · trips <strong>${state.trips}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    return {
      title: o.title,
      cls: o.cls,
      score: C.score(state),
      body: `<p>${o.text}</p><p class="muted">${C.cardsPlayed(state)} of ${state.deckSize} cards played ` +
        `in ${state.moves} moves and ${state.flips} flips.</p>`,
    };
  },

  record: (state) => ({ win: state.over === 'won', score: C.score(state) }),
});

/* ------------------------------------------------------------ interactions */

function onTier(state, t, ok) {
  if (state.over) return;
  if (!sel) {
    D.toast('Pick up a card first: tap the deck to flip, or tap a freed pile’s top card.');
    return;
  }
  if (!ok) {
    D.toast(C.playRejection(state, sel, t));
    return;
  }
  api.pushHistory();
  const src = sel;
  sel = null;
  api.setState(C.applyPlay(state, src, t));
}

function onSource(state, s) {
  if (state.over) return;
  const id = C.sourceCard(state, s);
  if (!id) return;
  const same = sel && sel.kind === s.kind && (s.kind === 'waste' || sel.i === s.i);
  sel = same ? null : s;
  api.refresh();
}

function onFlip(state) {
  if (state.over) return;
  if (!state.stock.length && !state.waste.length) { D.toast('The deck is empty.'); return; }
  api.pushHistory();
  sel = null;
  if (!state.stock.length) {
    api.setState(C.applyRedeal(state));
    D.toast('The waste is flipped over — another trip through the deck.');
    return;
  }
  api.setState(C.applyFlip(state));
}

async function switchDeck() {
  const next = extended() ? 'basic' : 'extended';
  const ok = await api.confirm({
    title: 'Switch the deck?',
    message: next === 'extended'
      ? 'Start a new game with the Pawns and Courts added (44 cards, no Excuse)?'
      : 'Start a new game with just the basic 36-card deck?',
    okLabel: 'New game',
  });
  if (!ok) return;
  D.setSetting('cascades.deck', next);
  sel = null;
  api.newGame();
}

/** One selectable pile: the waste, or a freed draw pile. */
function sourcePile(state, s, label) {
  const id = C.sourceCard(state, s);
  const wrap = document.createElement('button');
  wrap.type = 'button';
  wrap.className = 'cs-src';
  const count = s.kind === 'waste' ? state.waste.length : state.reserves[s.i].length;
  const buried = Math.max(0, count - 1);

  if (id) {
    const c = data.byId[D.baseId(id)];
    wrap.appendChild(D.cardEl({ ...c, id }, {
      tag: 'div', static: true, eager: true,
      badge: buried > 0 ? `+${buried}` : null,
    }));
  }
  const small = document.createElement('small');
  small.textContent = buried > 0 ? `${label} · ${buried} under` : label;
  wrap.appendChild(small);

  const isSel = sel && sel.kind === s.kind && (s.kind === 'waste' || sel.i === s.i);
  if (isSel) {
    wrap.querySelectorAll('.card').forEach((el) => el.classList.add('is-selected'));
  }
  wrap.setAttribute('aria-label',
    `${label}: ${data.byId[D.baseId(id)]?.name || 'empty'}${buried ? `, ${buried} buried under` : ''}`);
  wrap.addEventListener('click', () => onSource(state, s));
  return wrap;
}

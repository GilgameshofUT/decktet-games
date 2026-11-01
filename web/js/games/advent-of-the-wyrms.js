/* Advent of the Wyrms — UI.  The rules live in advent-of-the-wyrms-core.js. */

import { mountGame, D, panel, pile } from '../gamikit.js';
import * as C from './advent-of-the-wyrms-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const DECK45 = [...data.basicDeck, ...data.extendedDeck];   // the extended 45-card deck
const info = (id) => data.byId[D.baseId(id)];

let selected = null;          // hand index
let ui = null;                // the mountGame api, set on every render

const api = mountGame({
  id: 'advent-of-the-wyrms',
  title: 'Advent of the Wyrms',
  subtitle: 'four incantations before the wyrms arrive',
  rules: '../rules/advent-of-the-wyrms.html',
  newGame: (seed) => C.newGame(seed, DECK45),

  render(state, api) {
    ui = api;                            // helpers and callbacks draw through this
    if (selected != null && !state.hand[selected]) selected = null;
    if (state.pending) selected = null;
    ui.table.textContent = '';

    if (state.pending && !state.over) renderNegation(state);
    renderHand(state);
    if (!state.pending) renderActions(state);
    renderIncantations(state);
    renderCompleted(state);
    renderPiles(state);
    renderHint(state);

    ui.setStatus(
      `Hand <strong>${state.hand.length}</strong> · deck <strong>${state.deck.length}</strong>` +
      ` · incantations <strong>${state.done.length}/${C.WIN_COUNT}</strong>` +
      ` · being crafted <strong>${state.open.length}</strong>` +
      ` · negated <strong>${state.negated.length}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    return {
      title: o.title,
      cls: o.cls,
      score: C.score(state),
      body: `<p>${o.text}</p>` +
        (state.over === 'won'
          ? `<p class="muted">${state.deck.length} cards left in the deck — that is your score.</p>`
          : `<p class="muted">Score: 0 — you always score nothing when the calamity comes.</p>`),
    };
  },

  record: (state) => ({ win: state.over === 'won', score: C.score(state) }),
});

/* ------------------------------------------------------------------ parts */

function renderNegation(state) {
  const panel = document.createElement('section');
  panel.className = 'panel adv-negpanel';
  const h = document.createElement('h2');
  h.textContent = 'A wyrms card! Negate it';
  panel.appendChild(h);

  const row = document.createElement('div');
  row.className = 'adv-negate';

  const shown = info(state.pending.card);
  row.appendChild(D.cardEl({ ...shown, id: state.pending.card }, {
    tag: 'div', static: true, eager: true,
    badge: `rank ${C.rankOf(state.pending.card)}`,
  }));

  const btns = document.createElement('div');
  btns.className = 'adv-negbtns';
  for (const opt of C.legalNegations(state)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    if (opt.method === 'deck2') b.textContent = 'Discard 2 cards from the top of the deck';
    else if (opt.method === 'excuse') b.textContent = 'Discard the Excuse';
    else {
      const name = D.describe(info(state.hand[opt.handIndex]));
      b.textContent = opt.method === 'match'
        ? `Match its other suit — discard ${name}`
        : `Equal or beat its rank — discard ${name}`;
    }
    b.addEventListener('click', () => {
      ui.pushHistory();
      ui.setState(C.applyNegate(state, opt));
      D.toast('Wyrms card negated.');
    });
    btns.appendChild(b);
  }
  row.appendChild(btns);
  panel.appendChild(row);
  ui.table.appendChild(panel);
}

function renderHand(state) {
  const p = panel('Hand');
  p.heading.appendChild(countChip(`${state.hand.length}`));
  state.hand.forEach((id, i) => {
    const c = info(id);
    p.row.appendChild(D.cardEl({ ...c, id }, {
      selected: selected === i,
      dim: !state.pending && selected != null && selected !== i,
      eager: true,
      onPick: () => {
        if (state.over) return;
        if (state.pending) { D.toast('Negate the drawn wyrms card first.'); return; }
        selected = selected === i ? null : i;
        ui.refresh();
      },
    }));
  });
  ui.table.appendChild(p.section);
}

function renderActions(state) {
  if (selected == null) return;
  const bar = document.createElement('div');
  bar.className = 'btnrow adv-actions';

  const disc = document.createElement('button');
  disc.type = 'button';
  disc.className = 'btn small danger';
  disc.textContent = 'Discard it';
  disc.addEventListener('click', () => {
    ui.pushHistory();
    const i = selected;
    selected = null;
    ui.setState(C.applyDiscard(state, i));
    D.toast('Card discarded — drew a replacement.');
  });
  bar.appendChild(disc);

  for (const opt of C.addOptions(state, selected)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.append(opt.existing ? `Add to incantation ${opt.slot + 1}` : 'Start a new incantation');
    if (opt.suit) b.append(D.suitChip(opt.suit));
    b.addEventListener('click', () => {
      ui.pushHistory();
      const i = selected;
      selected = null;
      ui.setState(C.applyAdd(state, i, opt.slot, opt.suit));
    });
    bar.appendChild(b);
  }
  ui.table.appendChild(bar);
}

function renderIncantations(state) {
  const p = panel('Incantations — 3 cards, one suit, ascending');
  p.heading.appendChild(countChip(`${state.done.length}/${C.WIN_COUNT}`));
  const slots = document.createElement('div');
  slots.className = 'adv-slots';

  state.open.forEach((inc, i) => {
    const slot = document.createElement('div');
    slot.className = 'adv-slot';
    const head = document.createElement('div');
    head.className = 'adv-slothead';
    head.append(`${i + 1}`);
    if (inc.suit) head.append(D.suitChip(inc.suit));
    slot.appendChild(head);
    inc.cards.forEach((id, k) => {
      const c = info(id);
      slot.appendChild(D.cardEl({ ...c, id }, {
        tag: 'div', static: true, cls: `adv-c${k}`, eager: k === inc.cards.length - 1,
      }));
    });
    slots.appendChild(slot);
  });

  for (let i = state.open.length; i < C.MAX_OPEN; i++) {
    const slot = document.createElement('div');
    slot.className = 'adv-slot is-empty';
    slot.innerHTML = `<div class="adv-slothead">${i + 1}</div><div class="adv-ghost">new</div>`;
    slots.appendChild(slot);
  }

  p.row.className = 'adv-slotwrap';
  p.row.appendChild(slots);
  ui.table.appendChild(p.section);
}

function renderCompleted(state) {
  if (!state.done.length) return;
  const p = panel('Completed');
  p.row.className = 'adv-donewrap';
  state.done.forEach((inc, i) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'adv-donerow';
    const lbl = document.createElement('span');
    lbl.className = 'adv-donelbl';
    lbl.textContent = `${i + 1}.`;
    rowEl.appendChild(lbl);
    if (inc.suit) rowEl.append(D.suitChip(inc.suit));
    for (const id of inc.cards) {
      const c = info(id);
      rowEl.appendChild(D.cardEl({ ...c, id }, { tag: 'div', static: true }));
    }
    p.row.appendChild(rowEl);
  });
  ui.table.appendChild(p.section);
}

function renderPiles(state) {
  const row = document.createElement('div');
  row.className = 'piles adv-piles';

  const deck = pile('deck');
  deck.set(state.deck.length);
  row.appendChild(deck.el);

  const disc = pile('discarded');
  disc.set(state.discards.length);
  row.appendChild(disc.el);

  const neg = pile('negated');
  neg.set(state.negated.length);
  row.appendChild(neg.el);

  ui.table.appendChild(row);
}

function renderHint(state) {
  const hint = document.createElement('p');
  hint.className = 'advhint';
  hint.textContent = state.pending
    ? 'Every wyrms card drawn must be negated with one of the sacrifices above.'
    : selected == null
      ? 'Tap a card in your hand, then discard it or play it into an incantation — ' +
        'three cards of one suit, in ascending rank order. Craft four to win.'
      : 'A card may join an incantation only if it shares the incantation’s suit ' +
        'and outranks every card already there. The Excuse is wild anywhere.';
  ui.table.appendChild(hint);
}

function countChip(text) {
  const s = document.createElement('span');
  s.className = 'count';
  s.textContent = text;
  return s;
}

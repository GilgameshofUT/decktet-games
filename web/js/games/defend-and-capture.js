/* Defend and Capture — UI.  The rules live in defend-and-capture-core.js. */

import { mountGame, D } from '../gamikit.js';
import * as C from './defend-and-capture-core.js';

const data = await D.loadDeck();
C.init(data.byId);

// The 44-card deck: every card except the Excuse.
const DECK44 = data.cards.map((c) => c.id).filter((id) => id !== 'the-excuse');

let sel = { hand: null, slot: null };   // slot: { area: 'defense'|'side'|'captured'|'damaged', i }

const api = mountGame({
  id: 'defend-and-capture',
  title: 'Defend and Capture',
  subtitle: 'hold the line, capture twelve',
  rules: '../rules/defend-and-capture.html',
  newGame: (seed) => C.newGame(seed, DECK44),

  render(state, api) {
    if (sel.hand != null && !state.hand[sel.hand]) sel.hand = null;
    if (sel.slot && !slotCard(state, sel.slot)) sel.slot = null;

    api.table.textContent = '';

    /* ---- the table: battleground + side column + defense row ---- */
    const board = document.createElement('div');
    board.className = 'dc-board';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) board.appendChild(bgCell(state, r * 3 + c, r, c));
      board.appendChild(slotCell(state, 'side', r));
    }
    for (let c = 0; c < 3; c++) board.appendChild(slotCell(state, 'defense', c));
    const corner = document.createElement('div');
    corner.className = 'dc-corner';
    corner.innerHTML = `<b>${state.deck.length}</b><small>deck</small>` +
      `<b>${state.discard.length}</b><small>discard</small>`;
    board.appendChild(corner);
    api.table.appendChild(board);

    /* ---- captured and damaged ---- */
    api.table.appendChild(pilePanel(state, 'captured',
      'Captured', `${state.captured.length} / ${C.CAPTURE_TO_WIN}`, 'alive enemies — 12 wins'));
    api.table.appendChild(pilePanel(state, 'damaged',
      'Damaged', `${C.damageSum(state)} / ${C.DAMAGE_TO_LOSE}`, 'rank sum — 20 loses'));

    /* ---- hand ---- */
    const hand = document.createElement('section');
    hand.className = 'panel';
    hand.innerHTML = `<h2>Hand <span class="count">${state.hand.length} / ${C.handTarget(state)}</span></h2>`;
    const row = document.createElement('div');
    row.className = 'cardrow dc-hand';
    state.hand.forEach((id, i) => {
      const el = D.cardEl({ ...data.byId[D.baseId(id)], id }, {
        selected: sel.hand === i, eager: i < 4,
        cls: sel.hand != null && sel.hand !== i ? 'is-dim' : '',
      });
      el.setAttribute('aria-label', `${D.describe(data.byId[D.baseId(id)])} in hand`);
      el.addEventListener('click', () => {
        sel = { hand: sel.hand === i ? null : i, slot: null };
        api.refresh();
      });
      row.appendChild(el);
    });
    if (!state.hand.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = `Your hand is empty — it refills to ${C.handTarget(state)} card${C.handTarget(state) === 1 ? '' : 's'} each turn.`;
      row.appendChild(p);
    }
    hand.appendChild(row);
    api.table.appendChild(hand);

    /* ---- action bar ---- */
    api.table.appendChild(actionBar(state));

    const hint = document.createElement('p');
    hint.className = 'dc-hint';
    hint.textContent = hintFor(state);
    api.table.appendChild(hint);

    api.setStatus(
      `<strong>Turn ${state.turn}</strong> · actions left <strong>${state.actions}</strong>` +
      ` of ${state.actionsTotal} · captured <strong>${state.captured.length}</strong>/${C.CAPTURE_TO_WIN}` +
      ` · damage <strong>${C.damageSum(state)}</strong>/${C.DAMAGE_TO_LOSE}` +
      (state.captured.length >= C.HASTEN_AT ? ' · <strong>the enemy will surge twice!</strong>' : '') +
      (state.log ? `<br><span class="muted">${state.log}</span>` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const won = state.over === 'won';
    return {
      title: won ? 'You win — the town is safe' : 'The town has fallen',
      cls: won ? 'win' : 'lose',
      score: state.captured.length,
      body: `<p>${won
        ? `Twelve enemies captured alive in ${state.turn} turns.`
        : `The Damaged Area reached a rank sum of ${C.damageSum(state)}.`}</p>` +
        `<p class="muted">Captured ${state.captured.length} · damage ${C.damageSum(state)} · ${state.moves} actions.</p>`,
    };
  },

  record(state) {
    return { win: state.over === 'won', score: state.captured.length };
  },
});

/* ------------------------------------------------------------- rendering */

const slotCard = (state, slot) => slot && state[slot.area][slot.i];

function bgCell(state, i, r, c) {
  const cell = document.createElement('div');
  cell.className = 'dc-slot dc-bg';
  cell.setAttribute('role', 'button');
  cell.tabIndex = 0;
  const id = state.bg[i];
  if (id) {
    cell.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
      tag: 'div', static: true, eager: r === 0,
    }));
    cell.setAttribute('aria-label',
      `Enemy: ${D.describe(data.byId[D.baseId(id)])}, row ${r + 1} column ${c + 1}`);
  } else {
    cell.classList.add('is-empty');
    cell.setAttribute('aria-label', `Battleground slot, row ${r + 1} column ${c + 1}: empty`);
  }
  cell.addEventListener('click', () => api.toast(
    id
      ? `An enemy attacks down this column each turn. Its rank is ${C.rankOf(id)}.`
      : 'Empty battleground slot — enemies advance down from the top.'));
  return cell;
}

function slotCell(state, area, i) {
  const cell = document.createElement('div');
  cell.className = 'dc-slot';
  cell.setAttribute('role', 'button');
  cell.tabIndex = 0;
  const id = state[area][i];
  const label = area === 'defense' ? `Defense slot ${i + 1}` : `Side slot ${i + 1}`;
  if (id) {
    const isSel = sel.slot && sel.slot.area === area && sel.slot.i === i;
    cell.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
      tag: 'div', static: false, selected: isSel,
    }));
    cell.setAttribute('aria-label', `${label}: ${D.describe(data.byId[D.baseId(id)])}`);
  } else {
    cell.classList.add('is-empty');
    cell.setAttribute('aria-label', `${label}: empty — play a card here`);
  }
  if (sel.slot && sel.slot.area === area && sel.slot.i === i) cell.classList.add('is-marked');
  cell.addEventListener('click', () => onSlotTap(state, area, i, id));
  return cell;
}

function pilePanel(state, area, title, count, blurb) {
  const p = document.createElement('section');
  p.className = 'panel';
  p.innerHTML = `<h2>${title} <span class="count">${count}</span></h2>`;
  const row = document.createElement('div');
  row.className = `cardrow dc-mini dc-${area}`;
  state[area].forEach((id, i) => {
    const isSel = sel.slot && sel.slot.area === area && sel.slot.i === i;
    const el = D.cardEl({ ...data.byId[D.baseId(id)], id }, {
      selected: isSel, eager: i < 6,
    });
    el.setAttribute('aria-label',
      `${D.describe(data.byId[D.baseId(id)])} in the ${title} area, rank ${C.rankOf(id)}`);
    el.addEventListener('click', () => {
      if (sel.hand == null) {
        api.toast(area === 'captured'
          ? 'Select a card in your hand first, then tap a captured card to interchange.'
          : 'Select a card in your hand first, then tap a damaged card to sacrifice.');
        return;
      }
      sel = { hand: sel.hand, slot: { area, i } };
      api.refresh();
    });
    row.appendChild(el);
  });
  if (!state[area].length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = blurb;
    row.appendChild(e);
  }
  p.appendChild(row);
  return p;
}

function actionBar(state) {
  const bar = document.createElement('div');
  bar.className = 'btnrow dc-actions';
  const handSel = sel.hand != null;
  const slotArea = sel.slot?.area;
  const srcFilled = (slotArea === 'defense' || slotArea === 'side') && state[slotArea][sel.slot.i];

  const mk = (label, ready, why, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small' + (ready ? '' : ' is-off');
    b.textContent = label;
    if (!ready) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => { ready ? fn() : api.toast(why()); });
    bar.appendChild(b);
  };

  mk('Play', handSel && (slotArea === 'defense' || slotArea === 'side'),
    () => (handSel ? 'Tap a Defense or Side slot first — that is where the card goes.'
      : 'Select a card in your hand first.'),
    () => act(state, { type: 'play', hand: sel.hand, area: sel.slot.area, slot: sel.slot.i }));

  mk('Counterattack', !!srcFilled,
    () => 'Tap a card in the Defense row or Side column first — it strikes its whole line.',
    () => act(state, { type: 'counter', area: sel.slot.area, slot: sel.slot.i }));

  mk('Interchange', handSel && slotArea === 'captured',
    () => (handSel ? 'Tap a captured card first — it swaps with your selected hand card.'
      : 'Select a card in your hand first, then a captured card.'),
    () => act(state, { type: 'interchange', hand: sel.hand, index: sel.slot.i }));

  mk('Sacrifice', handSel && slotArea === 'damaged',
    () => (handSel ? 'Tap a damaged card first — it must be of lesser rank than your hand card.'
      : 'Select a card in your hand first, then a damaged card.'),
    () => act(state, { type: 'sacrifice', hand: sel.hand, index: sel.slot.i }));

  mk('Withdraw', !!srcFilled,
    () => 'Tap a card in the Defense row or Side column first — it comes back to your hand.',
    () => act(state, { type: 'withdraw', area: sel.slot.area, slot: sel.slot.i }));

  mk('Discard', handSel,
    () => 'Select a card in your hand first.',
    () => act(state, { type: 'discard', hand: [sel.hand] }));

  const end = document.createElement('button');
  end.type = 'button';
  end.className = 'btn small primary';
  end.textContent = state.captured.length >= C.HASTEN_AT ? 'End turn (surge!)' : 'End turn';
  end.addEventListener('click', () => {
    sel = { hand: null, slot: null };
    act(state, { type: 'endTurn' });
  });
  bar.appendChild(end);
  return bar;
}

function onSlotTap(state, area, i, id) {
  if (sel.hand != null) {
    if (area === 'captured' || area === 'damaged') return;
    act(state, { type: 'play', hand: sel.hand, area, slot: i });
    return;
  }
  if (!id) {
    api.toast(area === 'defense'
      ? 'That Defense slot is empty — select a card in your hand, then tap it to play there.'
      : 'That Side slot is empty — select a card in your hand, then tap it to play there.');
    return;
  }
  const same = sel.slot && sel.slot.area === area && sel.slot.i === i;
  sel = { hand: null, slot: same ? null : { area, i } };
  api.refresh();
}

function act(state, action) {
  let next;
  try {
    next = C.applyMove(state, action);
  } catch (err) {
    api.toast(err.message);
    return;
  }
  sel = { hand: null, slot: null };
  api.pushHistory();
  api.setState(next);
}

function hintFor(state) {
  if (state.over) return '';
  if (sel.hand != null && (sel.slot?.area === 'defense' || sel.slot?.area === 'side')) {
    return `Tap to confirm: play ${C.card(state.hand[sel.hand]).name} into that slot.`;
  }
  if (sel.hand != null) return 'Now tap a Defense or Side slot to play it, a captured card to interchange, or a damaged card to sacrifice.';
  if (sel.slot) return 'Now press Counterattack, Withdraw — or select a hand card first.';
  return 'Tap a hand card to select it, or tap a Defense/Side card to act from it. End the turn to face the enemy.';
}

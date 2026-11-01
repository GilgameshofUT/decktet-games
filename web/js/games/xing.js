/* Xing — UI.  Two players, one device: hands are hidden behind a
   pass-the-device screen between turns. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './xing-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const ALL45 = [...data.basicDeck, ...data.extendedDeck];
const info = (id) => data.byId[D.baseId(id)];

let revealed = false;      // is the current player's hand on screen?
let revealedTurn = null;   // the turn the reveal belongs to
let revealedMoves = null;  // an undo rewinds the counter and retires the reveal
let passShown = false;
let lastSeed = null;
let sel = null;            // { hand } | { back: { fi, dest } } | null

const api = mountGame({
  id: 'xing',
  title: 'Xing',
  subtitle: 'race six frogs home',
  rules: '../rules/xing.html',
  newGame: (seed) => C.newGame(seed, ALL45),
  restore: (st) => !!(st && Array.isArray(st.corridor) && st.corridor.length === C.CORRIDOR
    && Array.isArray(st.frogs) && Array.isArray(st.hands)),

  render(state, api) {
    if (state.seed !== lastSeed) {
      lastSeed = state.seed;
      revealed = false; revealedTurn = null; revealedMoves = null; passShown = false; sel = null;
    }
    // a turn change or an undo retires the current reveal
    if (revealed && (state.turn !== revealedTurn || state.moves < revealedMoves)) revealed = false;
    if (sel && sel.back && state.frogs[state.turn][sel.back.fi].k !== 'card') sel = null;

    const table = document.createElement('div');
    table.className = 'xing-table';
    table.appendChild(corridorPanel(state));
    table.appendChild(handPanel(state));
    table.appendChild(marketPanel(state));
    table.appendChild(controls(state));

    api.table.textContent = '';
    api.table.appendChild(table);

    api.setSubtitle(state.over
      ? `Player ${state.winner + 1} is home`
      : `Player ${state.turn + 1} to play`);
    api.setStatus(statusText(state));

    if (!state.over && !revealed && !passShown) showPass(state, api);
  },

  endOf(state) {
    if (!state.over) return null;
    const w = state.winner;
    const other = 1 - w;
    const stuck = state.frogs[other].filter((f) => f.k !== 'home').length;
    return {
      title: `Player ${w + 1} wins the race`,
      cls: 'win',
      body: `<p>All six frogs crossed the corridor. ` +
        `Player ${other + 1} still had ${stuck} in the traffic.</p>`,
    };
  },

  record: () => ({ played: 1, win: null, score: null }),
});

/* ----------------------------------------------------------------- parts */

function corridorPanel(state) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  const h = document.createElement('h2');
  h.innerHTML = 'The corridor<span class="count">start → home</span>';
  sec.appendChild(h);

  /* the Excuse: where waiting frogs sit */
  const start = document.createElement('div');
  start.className = 'xing-start';
  start.appendChild(D.cardEl({ ...info(C.EXCUSE), id: C.EXCUSE },
    { tag: 'div', static: true, eager: true, cls: 'xing-excusecard' }));
  const waiting = document.createElement('div');
  waiting.className = 'xing-waiting';
  waiting.appendChild(D.el('span', 'xing-startlabel', 'the Excuse — start'));
  const dots = document.createElement('div');
  dots.className = 'xing-dotrow';
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < C.FROGS; i++) {
      if (state.frogs[p][i].k !== 'excuse') continue;
      dots.appendChild(frogDot(state, p, i, () => onTapFrog(state, p, i)));
    }
  }
  if (!dots.children.length) dots.appendChild(D.el('span', 'xing-none', 'all frogs are out'));
  waiting.appendChild(dots);
  start.appendChild(waiting);
  sec.appendChild(start);

  /* the twelve corridor cards, serpentine: row 2 runs right to left */
  const grid = document.createElement('div');
  grid.className = 'xing-corridor';
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      const idx = row === 0 ? col : 11 - col;
      const cell = document.createElement('div');
      cell.className = 'xing-cell';
      const id = state.corridor[idx];
      const c = info(id);
      cell.appendChild(D.cardEl({ ...c, id }, { tag: 'div', static: true, eager: idx < 3 }));

      const slots = document.createElement('div');
      slots.className = 'xing-slots';
      C.slotsOf(state, idx).forEach((suit, slot) => {
        slots.appendChild(slotChip(state, idx, slot, suit));
      });
      cell.appendChild(slots);
      cell.appendChild(D.el('span', 'xing-pos', String(idx + 1)));
      grid.appendChild(cell);
    }
  }
  sec.appendChild(grid);
  sec.appendChild(D.el('p', 'xing-legend',
    'Row 1 runs left to right; row 2 runs back right to left. Each suit symbol is a ' +
    'space one frog can sit on. Home is past the far end.'));

  /* the two home pads */
  const homes = document.createElement('div');
  homes.className = 'xing-homes';
  [0, 1].forEach((p) => {
    const pad = document.createElement('div');
    pad.className = 'xing-home';
    pad.appendChild(D.el('span', 'xing-homelabel', `Player ${p + 1} — home`));
    const row = document.createElement('div');
    row.className = 'xing-dotrow';
    for (let i = 0; i < C.FROGS; i++) {
      const home = state.frogs[p][i].k === 'home';
      const d = document.createElement('span');
      d.className = `xing-homepip${home ? ` p${p}` : ''}`;
      row.appendChild(d);
    }
    pad.appendChild(row);
    homes.appendChild(pad);
  });
  sec.appendChild(homes);
  return sec;
}

function slotChip(state, cardIdx, slot, suit) {
  const occ = C.occupant(state, cardIdx, slot);
  const chipEl = document.createElement('button');
  chipEl.type = 'button';
  chipEl.className = 'xing-slot' + (occ ? ` is-occ p${occ.p}` : '');
  const img = document.createElement('img');
  img.src = D.url(`cards/icons/suits/${suit}.png`);
  img.alt = D.SUIT_NAME[suit];
  img.width = 115;
  img.height = 114;
  chipEl.appendChild(img);

  const mine = occ && occ.p === state.turn;
  chipEl.setAttribute('aria-label', occ
    ? `${D.SUIT_NAME[suit]} space, card ${cardIdx + 1}: ` +
      `${mine ? 'your frog' : `player ${occ.p + 1}'s frog`}`
    : `${D.SUIT_NAME[suit]} space, card ${cardIdx + 1}: free`);

  if (mine) chipEl.classList.add('is-mine');
  if (isSlotLegal(state, cardIdx, slot)) chipEl.classList.add('is-legal');

  chipEl.addEventListener('click', () => onTapSlot(state, cardIdx, slot));
  return chipEl;
}

/** Is this free slot a legal landing for the pending move-back? */
function isSlotLegal(state, cardIdx, slot) {
  if (!sel || !sel.back) return false;
  return sel.back.dest === cardIdx && C.freeSlots(state, cardIdx).includes(slot);
}

function frogDot(state, p, i, onClick) {
  const d = document.createElement('button');
  d.type = 'button';
  d.className = `xing-frogdot p${p}` + (p === state.turn ? ' is-mine' : '');
  d.title = `Player ${p + 1}'s frog ${i + 1}`;
  d.setAttribute('aria-label', `Player ${p + 1}'s frog ${i + 1}, at the Excuse`);
  if (onClick) d.addEventListener('click', onClick);
  return d;
}

function handPanel(state) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  const h = document.createElement('h2');
  const hand = state.hands[state.turn];
  h.innerHTML = state.over ? 'Hands'
    : `Player ${state.turn + 1}'s hand<span class="count">${hand.length} cards</span>`;
  sec.appendChild(h);

  const row = document.createElement('div');
  row.className = 'cardrow';
  if (revealed || state.over) {
    const shown = hand;
    shown.forEach((id, i) => {
      const c = info(id);
      row.appendChild(D.cardEl({ ...c, id }, {
        eager: i < 3,
        selected: sel?.hand === i,
        dim: sel?.hand != null && sel.hand !== i,
        disabled: state.over || !!state.pending,
        onPick: () => {
          if (state.over || state.pending) return;
          sel = sel?.hand === i ? null : { hand: i };
          api.refresh();
        },
      }));
    });
    if (!shown.length) row.appendChild(D.el('div', 'empty', 'No cards in hand.'));
  } else {
    row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
  }
  sec.appendChild(row);
  return sec;
}

function marketPanel(state) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  const h = document.createElement('h2');
  h.innerHTML = 'The market<span class="count">deck ' + state.deck.length +
    ' · discard ' + state.discard.length + '</span>';
  sec.appendChild(h);

  const row = document.createElement('div');
  row.className = 'cardrow';
  const legal = state.pending ? new Set(C.legalMarket(state, state.turn)) : null;
  state.market.forEach((id, i) => {
    if (id == null) return;
    const c = info(id);
    row.appendChild(D.cardEl({ ...c, id }, {
      eager: i < 2,
      selected: false,
      dim: legal != null && !legal.has(i),
      disabled: state.over || !state.pending || !revealed,
      onPick: () => onTake(state, i),
    }));
  });
  if (!state.market.some((x) => x != null)) {
    row.appendChild(D.el('div', 'empty', 'The market is empty — no cards left to draw.'));
  }
  sec.appendChild(row);
  return sec;
}

function controls(state) {
  const wrap = document.createElement('div');
  wrap.className = 'xing-ctl';

  const dots = document.createElement('div');
  dots.className = 'xing-actions';
  for (let i = 0; i < C.ACTIONS_PER_TURN; i++) {
    const d = document.createElement('span');
    d.className = 'xing-actionpip' + (i < state.actions ? ' is-used' : '');
    dots.appendChild(d);
  }
  dots.appendChild(D.el('span', 'xing-actionlabel',
    `${state.actions}/${C.ACTIONS_PER_TURN} actions`));
  wrap.appendChild(dots);

  const row = document.createElement('div');
  row.className = 'btnrow';

  if (!state.over && revealed && C.isBlocked(state, state.turn) && !state.pending &&
      state.market.some((x) => x != null)) {
    row.appendChild(btn('Take a card (you are blocked)', false, () => {
      const i = C.legalMarket(state, state.turn)[0];
      if (i == null) { D.toast('No cards are left to take.'); return; }
      doAction(state, () => C.takeOnly(state, state.turn, i));
    }));
  }

  const canEnd = !state.over && revealed && !state.pending &&
    (state.actions > 0 || !C.canAct(state, state.turn));
  row.appendChild(btn(state.pending ? 'Take your card first' : 'End turn', !canEnd, () => {
    doAction(state, () => C.endTurn(state), { endsTurn: true });
  }));
  wrap.appendChild(row);

  const hint = document.createElement('p');
  hint.className = 'xing-hint';
  hint.textContent = hintText(state);
  wrap.appendChild(hint);
  return wrap;
}

function hintText(state) {
  if (state.over) return 'The race is over.';
  if (!revealed) return 'Pass the device on, then reveal this player’s hand.';
  if (state.pending) {
    const suit = state.pending.suit;
    return suit
      ? `Your frog sits on a ${D.SUIT_NAME[suit]} symbol — take any market card except a ${D.SUIT_NAME[suit]} one.`
      : 'Your frog is back at the Excuse — take any card from the market.';
  }
  if (sel?.hand != null) {
    return 'Now tap one of your frogs: it jumps to the first matching free symbol ahead — ' +
      'or to home if nothing ahead matches.';
  }
  if (sel?.back) {
    return 'Tap one of the glowing free symbols on the landing card.';
  }
  return 'Tap a card in your hand to play it and advance a frog, or tap one of your ' +
    'frogs on the corridor (or the Excuse) to move it back and take a card. Three actions a turn.';
}

/* --------------------------------------------------------------- actions */

function onTapFrog(state, p, i) {
  if (state.over || p !== state.turn || !revealed) return;
  if (sel?.hand != null) { doAdvance(state, sel.hand, i); return; }
  askMoveBack(state, i);
}

function onTapSlot(state, cardIdx, slot) {
  const st = api.state;                 // the freshest board
  const occ = C.occupant(st, cardIdx, slot);
  if (occ) { onTapFrog(st, occ.p, occ.i); return; }
  if (sel?.back && isSlotLegal(st, cardIdx, slot)) {
    completeBack(st, sel.back.fi, slot);
  }
}

function doAdvance(state, handIdx, fi) {
  const p = state.turn;
  let next;
  try {
    next = C.advance(state, p, handIdx, fi);
  } catch (err) {
    api.toast(err.message);
    api.setStatus(err.message, true);
    return;
  }
  sel = null;
  api.pushHistory();
  api.setState(withAutoPass(next));
}

async function askMoveBack(state, fi) {
  const p = state.turn;
  const frog = state.frogs[p][fi];
  if (frog.k === 'home') { D.toast(`Frog ${fi + 1} is already home.`); return; }
  if (frog.k === 'excuse') {
    D.toast('That frog is still at the Excuse — play a card to advance it.');
    return;
  }
  const ok = await api.confirm({
    title: `Move frog ${fi + 1} back?`,
    message: 'It jumps back to the first card behind it with a free symbol, ' +
      'and then you may take a card from the market.',
    okLabel: 'Move it back',
  });
  if (!ok) return;
  const st = api.state;                 // the board may have changed meanwhile
  const free = freeBehind(st, fi);
  if (free == null) { completeBack(st, fi, null); return; }
  if (free.slots.length === 1) { completeBack(st, fi, free.slots[0]); return; }
  sel = { back: { fi, dest: free.card } };
  api.refresh();
}

function freeBehind(state, fi) {
  const frog = state.frogs[state.turn][fi];
  for (let t = frog.card - 1; t >= 0; t--) {
    const slots = C.freeSlots(state, t);
    if (slots.length) return { card: t, slots };
  }
  return null;
}

function completeBack(state, fi, slot) {
  sel = null;
  let next;
  try {
    next = C.moveBack(state, state.turn, fi, slot);
  } catch (err) {
    api.toast(err.message);
    api.setStatus(err.message, true);
    return;
  }
  api.pushHistory();
  api.setState(withAutoPass(next));
}

function onTake(state, marketIdx) {
  if (state.over || !state.pending || !revealed) return;
  let next;
  try {
    next = C.takeCard(state, state.turn, marketIdx);
  } catch (err) {
    api.toast(err.message);
    api.setStatus(err.message, true);
    return;
  }
  api.pushHistory();
  api.setState(withAutoPass(next));
}

/** After three actions the turn passes automatically. */
function withAutoPass(next) {
  if (!next.over && next.actions >= C.ACTIONS_PER_TURN && !next.pending) {
    try { return C.endTurn(next); } catch { return next; }
  }
  return next;
}

function doAction(state, make, { endsTurn = false } = {}) {
  let next;
  try {
    next = make();
  } catch (err) {
    api.toast(err.message);
    api.setStatus(err.message, true);
    return;
  }
  sel = null;
  api.pushHistory();
  api.setState(endsTurn ? next : withAutoPass(next));
}

function statusText(state) {
  if (state.over) return `<strong>Player ${state.winner + 1} wins.</strong> All six frogs are home.`;
  if (!revealed) return `Pass the device to Player ${state.turn + 1}, then reveal their hand.`;
  const homes = [0, 1].map((p) => `${p + 1}: ${C.homeCount(state, p)}/${C.FROGS}`).join(' · ');
  if (state.pending) {
    return `Player ${state.turn + 1}: take a card from the market, then your turn may continue. ` +
      `Home — ${homes}`;
  }
  return `Player ${state.turn + 1}: ${C.ACTIONS_PER_TURN - state.actions} action(s) left. ` +
    `Play a card to advance, or move a frog back to take one. Home — ${homes}`;
}

function btn(label, disabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function showPass(state, api) {
  passShown = true;
  passDevice(state.turn + 1, () => {
    revealed = true;
    revealedTurn = api.state.turn;
    revealedMoves = api.state.moves;
    passShown = false;
    sel = null;
    api.refresh();
  });
}

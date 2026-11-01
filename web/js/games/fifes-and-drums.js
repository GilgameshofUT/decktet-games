/* Fifes & Drums — UI.  Two players, one device: the secret order is only
   rendered for the player whose turn it is, behind a pass-the-device screen. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './fifes-and-drums-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const ALL45 = [...data.basicDeck, ...data.extendedDeck];
const info = (id) => data.byId[D.baseId(id)];

let revealed = false;      // is the current player's secret order on screen?
let revealedTurn = null;   // the turn the reveal belongs to
let revealedMoves = null;  // an undo rewinds the counter and retires the reveal
let passShown = false;
let lastSeed = null;
let sel = null;            // pool index of the order being planned
let splitFirst = null;     // spaces given to the first suit of a number order

const api = mountGame({
  id: 'fifes-and-drums',
  title: 'Fifes & Drums',
  subtitle: 'jigger the retreat orders',
  rules: '../rules/fifes-and-drums.html',
  newGame: (seed) => C.newGame(seed, ALL45),
  restore: (st) => !!(st && st.pos && Array.isArray(st.pool) && Array.isArray(st.goals)),

  render(state, api) {
    if (state.seed !== lastSeed) {
      lastSeed = state.seed;
      revealed = false; revealedTurn = null; revealedMoves = null;
      passShown = false; sel = null; splitFirst = null;
    }
    // a turn change or an undo retires the current reveal
    if (revealed && (state.turn !== revealedTurn || state.moves < revealedMoves)) revealed = false;
    if (sel != null && state.pool[sel] == null) { sel = null; splitFirst = null; }

    const table = document.createElement('div');
    table.className = 'fd-table';
    table.appendChild(trackPanel(state));
    table.appendChild(poolPanel(state));
    table.appendChild(infoPanel(state));
    table.appendChild(goalPanel(state));

    api.table.textContent = '';
    api.table.appendChild(table);

    api.setSubtitle(state.over
      ? 'the Excuse has been drawn'
      : `Player ${state.turn + 1} to play`);
    api.setStatus(statusText(state));

    if (!state.over && !revealed && !passShown) showPass(state, api);
  },

  endOf(state) {
    if (!state.over) return null;
    const [a, b] = C.finalScores(state);
    const w = state.winner;
    const line = (p, score) => {
      const g = info(state.goals[p]);
      return `<li><strong>Player ${p + 1}</strong> — ${g.name} ` +
        `(${C.goalSuits(state.goals[p]).map((s) => D.SUIT_NAME[s]).join(', ')}) ` +
        `<b>${score}</b></li>`;
    };
    return {
      title: w === 'draw' ? 'The field is a draw' : `Player ${w + 1} wins the rout`,
      cls: 'win',
      body: `<p>The Excuse is turned over — the enemy army surges forward. ` +
        `Each staff officer scores their three secret units:</p>` +
        `<ul class="fd-final">${line(0, a)}${line(1, b)}</ul>` +
        `<p class="muted">${w === 'draw'
          ? 'Both bribes pay out equally.'
          : `Player ${w + 1} walks away with the money.`}</p>`,
    };
  },

  record: () => ({ played: 1, win: null, score: null }),
});

/* ----------------------------------------------------------------- parts */

function trackPanel(state) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  const h = document.createElement('h2');
  h.innerHTML = 'Battlefield track<span class="count">space 1 → 45</span>';
  sec.appendChild(h);

  const grid = document.createElement('div');
  grid.className = 'fd-track';
  const COLS = 8;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + (row % 2 === 0 ? col : COLS - 1 - col);
      const cell = document.createElement('div');
      cell.className = 'fd-space';
      if (idx >= C.TRACK) { cell.classList.add('is-void'); grid.appendChild(cell); continue; }
      if (idx === 0) cell.classList.add('is-start');
      if (idx === C.TRACK - 1) cell.classList.add('is-end');
      cell.setAttribute('aria-label', `space ${idx + 1}`);

      const here = C.SUITS.filter((s) => state.pos[s] === idx);
      const n = document.createElement('span');
      n.className = 'fd-num';
      n.textContent = String(idx + 1);
      cell.appendChild(n);
      const chips = document.createElement('span');
      chips.className = 'fd-tokens';
      for (const s of here) {
        const t = document.createElement('span');
        t.className = 'fd-token';
        t.style.setProperty('--suit', D.SUIT_COLOR[s]);
        t.title = `${D.SUIT_NAME[s]} unit`;
        const img = document.createElement('img');
        img.src = D.url(`cards/icons/suits/${s}.png`);
        img.alt = D.SUIT_NAME[s];
        img.width = 115;
        img.height = 114;
        t.appendChild(img);
        chips.appendChild(t);
      }
      cell.appendChild(chips);
      grid.appendChild(cell);
    }
  }
  sec.appendChild(grid);
  sec.appendChild(D.el('p', 'fd-legend',
    'Space 1 is in the shadow of the enemy; space 45 is safety. ' +
    'Units retreat up the track — the goal is to have yours furthest along when the Excuse appears.'));
  return sec;
}

function poolPanel(state) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  const h = document.createElement('h2');
  h.innerHTML = 'Orders in the pool<span class="count">' +
    `${state.pool.filter(Boolean).length}/${C.POOL_SIZE}</span>`;
  sec.appendChild(h);

  const row = document.createElement('div');
  row.className = 'cardrow';
  state.pool.forEach((id, i) => {
    if (id == null) return;
    const c = info(id);
    row.appendChild(D.cardEl({ ...c, id }, {
      eager: i < 3,
      selected: sel === i,
      dim: sel != null && sel !== i,
      disabled: !revealed || !!state.over,
      onPick: () => {
        if (!revealed || state.over) return;
        sel = sel === i ? null : i;
        splitFirst = null;
        api.refresh();
      },
    }));
  });
  sec.appendChild(row);

  if (sel != null && state.pool[sel] != null && !state.over) {
    sec.appendChild(actionArea(state));
  } else if (!state.over) {
    sec.appendChild(D.el('p', 'fd-hint', revealed
      ? 'Tap an order to play it: number cards split a retreat between two units, ' +
        'Aces march a unit to contact, Crowns charge a unit back toward the enemy.'
      : 'Ready when you are.'));
  }
  return sec;
}

function actionArea(state) {
  const id = state.pool[sel];
  const c = info(id);
  const wrap = document.createElement('div');
  wrap.className = 'fd-action';

  const charged = C.chargedSuits(state.pool);
  if (charged.length) {
    wrap.appendChild(D.el('p', 'fd-charged',
      `Crown${charged.length > 1 ? 's' : ''} of ${charged.map((s) => D.SUIT_NAME[s]).join(' and ')} ` +
      `${charged.length > 1 ? 'are' : 'is'} in the pool — orders carrying those suits charge ` +
      'those units back toward the enemy.'));
  }

  const plan = { splits: {}, direction: null };

  if (typeof c.rank === 'number') {
    const suits = c.suits;
    if (splitFirst == null) splitFirst = 1;
    const second = c.rank - splitFirst;
    plan.splits[suits[0]] = splitFirst;
    plan.splits[suits[1]] = second;

    const list = document.createElement('div');
    list.className = 'fd-split';
    suits.forEach((s, i) => {
      const line = document.createElement('div');
      line.className = 'fd-splitline';
      const back = C.crownCharged(state.pool, s);
      line.appendChild(D.el('span', 'fd-suitspec',
        `${chip(s)} ${D.SUIT_NAME[s]} unit — ${back ? 'charge ↙' : 'retreat ↗'}`));
      if (i === 0) {
        line.appendChild(stepper(splitFirst, 1, c.rank - 1, (v) => { splitFirst = v; api.refresh(); }));
      } else {
        line.appendChild(D.el('span', 'fd-splitval', `${second} space${second === 1 ? '' : 's'}`));
      }
      list.appendChild(line);
    });
    wrap.appendChild(list);
    wrap.appendChild(btn(`Play ${c.name} (${c.rank} spaces)`, false,
      () => doPlay(state, sel, plan)));
  } else if (c.rank === 1) {
    wrap.appendChild(D.el('p', 'fd-march',
      `${chip(c.suits[0])} ${D.SUIT_NAME[c.suits[0]]}: march to contact — hop onto the ` +
      'nearest occupied space in the chosen direction, or one space if nothing is there.'));
    const row = document.createElement('div');
    row.className = 'btnrow';
    row.appendChild(btn('March forward ↗', false, () => doPlay(state, sel, { direction: 'forward' })));
    row.appendChild(btn('Charge back ↙', false, () => doPlay(state, sel, { direction: 'backward' })));
    wrap.appendChild(row);
  } else {
    wrap.appendChild(D.el('p', 'fd-march',
      `${chip(c.suits[0])} ${D.SUIT_NAME[c.suits[0]]}: the General wants this unit to ` +
      'charge — it moves back to the nearest occupied space (or one space).'));
    wrap.appendChild(btn(`Play ${c.name}`, false, () => doPlay(state, sel, {})));
  }
  return wrap;
}

function infoPanel(state) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  const h = document.createElement('h2');
  h.innerHTML = 'Deck & last order<span class="count">' +
    `${state.draw.length} in draw</span>`;
  sec.appendChild(h);

  const row = document.createElement('div');
  row.className = 'fd-deckrow';

  const deck = document.createElement('div');
  deck.className = 'pile';
  deck.innerHTML = `<span class="n">${state.draw.length}</span><small>draw</small>`;
  row.appendChild(deck);

  const last = state.discard[state.discard.length - 1];
  const box = document.createElement('div');
  box.className = 'fd-last';
  if (last && last !== C.EXCUSE) {
    const c = info(last);
    box.appendChild(D.cardEl({ ...c, id: last }, { tag: 'div', static: true, eager: true }));
    box.appendChild(D.el('div', 'fd-lastlabel', 'last order played'));
  } else if (last === C.EXCUSE) {
    box.appendChild(D.cardEl({ ...info(C.EXCUSE), id: C.EXCUSE },
      { tag: 'div', static: true, eager: true }));
    box.appendChild(D.el('div', 'fd-lastlabel', 'the Excuse — game over'));
  } else {
    box.appendChild(D.el('div', 'fd-lastblank', '—'));
    box.appendChild(D.el('div', 'fd-lastlabel', 'no order played yet'));
  }
  row.appendChild(box);

  const note = document.createElement('p');
  note.className = 'pilehint';
  note.innerHTML = `Six retired units (<b>${state.aside.length}</b>) are set aside unseen; ` +
    `the Excuse sits somewhere in the bottom of the draw pile and ends the game when flipped.`;
  row.appendChild(note);
  sec.appendChild(row);
  return sec;
}

function goalPanel(state) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  const h = document.createElement('h2');

  if (state.over) {
    h.textContent = 'The bribes are revealed';
    sec.appendChild(h);
    const v = C.unitValues(state);
    [0, 1].forEach((p) => {
      const g = info(state.goals[p]);
      const row = document.createElement('div');
      row.className = 'fd-goal is-open';
      row.appendChild(D.cardEl({ ...g, id: state.goals[p] },
        { tag: 'div', static: true, eager: true }));
      const txt = document.createElement('div');
      txt.className = 'fd-goaltext';
      const suits = C.goalSuits(state.goals[p]);
      txt.innerHTML = `<strong>Player ${p + 1}</strong> — ${g.name}<br>` +
        suits.map((s) => `${chip(s)} ${D.SUIT_NAME[s]} <b>${v[s]}</b>`).join(' · ') +
        `<br><span class="fd-goalscore">total ${C.scoreOf(state, p)}</span>`;
      row.appendChild(txt);
      sec.appendChild(row);
    });
    return sec;
  }

  h.innerHTML = `Player ${state.turn + 1}'s secret order`;
  sec.appendChild(h);
  if (!revealed) {
    sec.appendChild(D.el('p', 'empty', 'Hidden until this player is ready.'));
    return sec;
  }
  const g = info(state.goals[state.turn]);
  const row = document.createElement('div');
  row.className = 'fd-goal';
  row.appendChild(D.cardEl({ ...g, id: state.goals[state.turn] },
    { tag: 'div', static: true, eager: true }));
  const txt = document.createElement('div');
  txt.className = 'fd-goaltext';
  txt.innerHTML = `<strong>Your three units</strong> — you score the track positions of<br>` +
    C.goalSuits(state.goals[state.turn])
      .map((s) => `${chip(s)} ${D.SUIT_NAME[s]}`).join(' · ');
  row.appendChild(txt);
  sec.appendChild(row);
  sec.appendChild(D.el('p', 'fd-hint', 'Keep it to yourself — your opponent is helping their own three.'));
  return sec;
}

/* --------------------------------------------------------------- helpers */

function statusText(state) {
  if (state.over) {
    const [a, b] = C.finalScores(state);
    return `<strong>The Excuse has been drawn.</strong> Final: Player 1 — ${a} · Player 2 — ${b}`;
  }
  if (!revealed) return `Pass the device to Player ${state.turn + 1}, then reveal their order.`;
  const charged = C.chargedSuits(state.pool);
  return `Player ${state.turn + 1}: take one order from the pool and move units. ` +
    (charged.length
      ? `Charged: ${charged.map((s) => D.SUIT_NAME[s]).join(', ')}.`
      : 'Nothing is charged — every order retreats.');
}

function chip(suit) {
  return `<img class="suit-inline" src="${D.url(`cards/icons/suits/${suit}.png`)}" ` +
    `alt="${D.SUIT_NAME[suit]}" width="115" height="114">`;
}

function stepper(value, min, max, onChange) {
  const wrap = document.createElement('span');
  wrap.className = 'fd-stepper';
  const dec = document.createElement('button');
  dec.type = 'button';
  dec.className = 'fd-step';
  dec.textContent = '−';
  dec.disabled = value <= min;
  dec.addEventListener('click', () => onChange(value - 1));
  const val = document.createElement('b');
  val.textContent = `${value} space${value === 1 ? '' : 's'}`;
  const inc = document.createElement('button');
  inc.type = 'button';
  inc.className = 'fd-step';
  inc.textContent = '+';
  inc.disabled = value >= max;
  inc.addEventListener('click', () => onChange(value + 1));
  wrap.append(dec, val, inc);
  return wrap;
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

function doPlay(state, index, plan) {
  let next;
  try {
    next = C.play(state, index, plan);
  } catch (err) {
    api.toast(err.message);
    api.setStatus(err.message, true);
    return;
  }
  revealed = false;
  passShown = false;
  sel = null;
  splitFirst = null;
  api.pushHistory();
  api.setState(next);
}

function showPass(state, api) {
  passShown = true;
  passDevice(state.turn + 1, () => {
    revealed = true;
    revealedTurn = api.state.turn;
    revealedMoves = api.state.moves;
    passShown = false;
    api.refresh();
  });
}

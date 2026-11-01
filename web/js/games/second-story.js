/* Second Story — UI.  Two players, one device: a press-your-luck burglary
   with an emulated d10, on-screen chips, and the pass screen between nights. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './second-story-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let heldBy = null;        // 0-based player holding the device, or null
let passShown = false;
let passOverlay = null;
let lastSeed = null;

const cardOf = (id) => ({ ...data.byId[D.baseId(id)], id });
const nameOf = (id) => data.byId[D.baseId(id)].name;

const PHASE_LABEL = {
  flip: 'flip the next card',
  act: 'roll against the house',
  take: 'pick your chip',
  chance: 'take the second chance',
  decide: 'stop or try another',
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);

const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const api = mountGame({
  id: 'second-story',
  title: 'Second Story',
  subtitle: 'a game of reckless burgling',
  rules: '../rules/second-story.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (state.seed !== lastSeed) {
      lastSeed = state.seed; heldBy = null; passShown = false;
    }

    const table = document.createElement('div');
    table.className = 'ss-table';

    table.appendChild(housePanel(state, api));
    table.appendChild(bagPanel(state));
    table.appendChild(bankPanel(state));
    table.appendChild(lairPanel(state));
    table.appendChild(actionsPanel(state, api));
    table.appendChild(logPanel(state));

    api.table.textContent = '';
    api.table.appendChild(table);

    api.setSubtitle(state.over
      ? 'the last night is over'
      : `Player ${state.player + 1} to ${PHASE_LABEL[state.phase]}`);
    api.setStatus(statusOf(state), false);

    if (state.over && passOverlay) { passOverlay.close(); passOverlay = null; passShown = false; }
    if (!state.over && heldBy !== state.player && !passShown) showPass(state.player, api);
  },

  endOf(state) {
    if (!state.over) return null;
    const s = [C.lairScore(state.lair[0]), C.lairScore(state.lair[1])];
    const rows = [0, 1].map((p) => {
      const v = C.scoreVector(state.lair[p]).join(' · ');
      return `Player ${p + 1}: ${s[p]} points <span class="muted">(${v})</span>`;
    }).join('<br>');
    if (state.winner == null) {
      return {
        title: 'A tie', cls: '', score: s[0],
        body: `<p>Both burglars end with the same second most numerous suit.</p><p>${rows}</p>`,
      };
    }
    return {
      title: `Player ${state.winner + 1} wins`, cls: 'win', score: s[state.winner],
      body: `<p>Scored on the second most numerous suit in the lair.</p><p>${rows}</p>`,
    };
  },

  record: (state) => ({
    played: 1, win: null,
    score: state.over && state.winner != null ? C.lairScore(state.lair[state.winner]) : null,
  }),
});

/* --------------------------------------------------------------- pieces */

function statusOf(state) {
  if (state.over) return '<strong>The last night is over.</strong> Score the lairs.';
  const who = `Player ${state.player + 1}`;
  const head = state.final
    ? `<strong>${who}:</strong> (last night) `
    : `<strong>${who}:</strong> `;
  const last = state.events[state.events.length - 1];
  const hint = {
    flip: 'Flip the next card of the night.',
    act: 'Roll against the house — a Crown always takes two dice.',
    take: 'Choose which of the two suits to take.',
    chance: 'A Crown: risk a matching chip from your lair to reroll, or take the loss.',
    decide: 'You got away with it — stop with the bag, or try another house.',
  }[state.phase];
  return head + (last ? `${escapeHtml(last)} ` : '') + hint;
}

/* ---- the house, the roll, the night so far ---- */

function housePanel(state, api) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  const what = state.card ? `Burgling ${nameOf(state.card)}` : (state.cards.length ? 'Still inside' : 'The street');
  h.innerHTML = `${what}<span class="count">${state.final ? 'last night' : `night ${state.turn}`}</span>`;
  panel.appendChild(h);

  const row = document.createElement('div');
  row.className = 'ss-house';

  if (state.card) {
    row.appendChild(D.cardEl(cardOf(state.card), { tag: 'div', static: true, eager: true }));
    const meta = document.createElement('div');
    meta.className = 'ss-meta';
    const c = data.byId[D.baseId(state.card)];
    meta.innerHTML = `<b>security ${C.rankOf(state.card)}</b><span>${c.suits.map(cap).join(' and ')}</span>`;
    if (state.roll) {
      const dice = document.createElement('div');
      dice.className = 'ss-dice';
      for (const d of state.roll) {
        const die = document.createElement('span');
        die.className = 'ss-die';
        die.textContent = d === 10 ? '0' : String(d);
        dice.appendChild(die);
      }
      dice.appendChild(D.el('small', null, state.mode === 'thorough' ? 'one die' : 'two dice'));
      meta.appendChild(dice);
    }
    row.appendChild(meta);
  } else {
    row.appendChild(D.el('div', 'ss-meta', state.cards.length
      ? 'The night continues — flip the next card.'
      : 'A fresh night in Jacynth.'));
  }
  panel.appendChild(row);

  if (state.events.length) {
    const list = document.createElement('div');
    list.className = 'ss-events';
    for (const e of state.events.slice(-3)) {
      const line = document.createElement('p');
      line.textContent = e;
      list.appendChild(line);
    }
    panel.appendChild(list);
  }
  return panel;
}

/* ---- the bag ---- */

function bagPanel(state) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.innerHTML = `Bag of loot<span class="count">${state.bag.length}</span>`;
  panel.appendChild(h);
  const row = document.createElement('div');
  row.className = 'ss-chips';
  if (!state.bag.length) row.appendChild(D.el('div', 'empty', 'Empty — everything you carry is at risk.'));
  for (const suit of state.bag) row.appendChild(chipEl(suit));
  panel.appendChild(row);
  return panel;
}

/* ---- the bank ---- */

function bankPanel(state) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const total = C.SUITS.reduce((n, s) => n + state.bank[s], 0);
  const h = document.createElement('h2');
  h.innerHTML = `The bank<span class="count">${total} chips</span>`;
  panel.appendChild(h);
  const row = document.createElement('div');
  row.className = 'ss-chips';
  for (const suit of C.SUITS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ss-chip' + (state.bank[suit] ? '' : ' is-out');
    chip.appendChild(chipIcon(suit));
    const n = document.createElement('b');
    n.textContent = state.bank[suit];
    chip.appendChild(n);
    chip.addEventListener('click', () => api.toast(`${cap(suit)}: ${state.bank[suit]} chip(s) left in the bank.`));
    row.appendChild(chip);
  }
  panel.appendChild(row);
  return panel;
}

/* ---- the lairs (this is the score sheet) ---- */

function lairPanel(state) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'The lair';
  panel.appendChild(h);
  for (let p = 0; p < 2; p++) {
    const line = document.createElement('div');
    line.className = 'ss-lair' + (state.player === p && !state.over ? ' on' : '');
    const label = document.createElement('span');
    label.className = 'ss-lair-who';
    label.textContent = `Player ${p + 1}`;
    line.appendChild(label);
    const chips = document.createElement('span');
    chips.className = 'ss-chips';
    for (const suit of C.SUITS) {
      const chip = document.createElement('span');
      chip.className = 'ss-chip' + (state.lair[p][suit] ? '' : ' is-out');
      chip.appendChild(chipIcon(suit));
      const n = document.createElement('b');
      n.textContent = state.lair[p][suit];
      chip.appendChild(n);
      chips.appendChild(chip);
    }
    line.appendChild(chips);
    const score = document.createElement('span');
    score.className = 'ss-score';
    score.textContent = C.lairScore(state.lair[p]);
    line.appendChild(score);
    panel.appendChild(line);
  }
  const note = document.createElement('p');
  note.className = 'ss-note';
  note.textContent = 'Score: disregard your most numerous suit — the number on the right is your second most numerous.';
  panel.appendChild(note);
  return panel;
}

function chipIcon(suit) {
  const img = document.createElement('img');
  img.src = new URL(`../cards/icons/suits/${suit}.png`, import.meta.url).href;
  img.alt = cap(suit);
  img.width = 115;
  img.height = 114;
  return img;
}

function chipEl(suit) {
  const chip = document.createElement('span');
  chip.className = 'ss-chip';
  chip.appendChild(chipIcon(suit));
  return chip;
}

/* ---- what you may do now ---- */

function actionsPanel(state, api) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Your move';
  panel.appendChild(h);
  const row = document.createElement('div');
  row.className = 'btnrow';

  if (state.over) {
    row.appendChild(D.el('div', 'empty', 'The game is over.'));
  } else if (state.phase === 'flip') {
    row.appendChild(btn('Flip a card', 'primary', () => run(state, C.flip, api)));
  } else if (state.phase === 'act') {
    const c = data.byId[D.baseId(state.card)];
    if (c.rank === 'crown') {
      row.appendChild(btn('Roll both dice', 'primary', () => run(state, (s) => C.act(s, 'quick'), api)));
    } else {
      row.appendChild(btn(`Thorough — 1 die, both suits`, 'primary', () => run(state, (s) => C.act(s, 'thorough'), api)));
      row.appendChild(btn(`Quick — 2 dice, one suit`, '', () => run(state, (s) => C.act(s, 'quick'), api)));
    }
  } else if (state.phase === 'take') {
    const c = data.byId[D.baseId(state.card)];
    for (const suit of c.suits) {
      row.appendChild(btn(`Take a ${suit} chip`, 'primary', () => run(state, (s) => C.take(s, suit), api)));
    }
  } else if (state.phase === 'chance') {
    row.appendChild(btn('Risk a lair chip, reroll', 'primary', () => run(state, C.reroll, api)));
    row.appendChild(btn('Take the loss', 'danger', () => run(state, C.giveUp, api)));
  } else if (state.phase === 'decide') {
    row.appendChild(btn('Stop for the night', 'primary', () => run(state, C.stop, api)));
    row.appendChild(btn('Try another house', '', () => run(state, C.cont, api)));
  }
  panel.appendChild(row);
  return panel;
}

/* ---- the last few nights ---- */

function logPanel(state) {
  if (!state.log.length) return document.createElement('div');
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'The nights so far';
  panel.appendChild(h);
  const rows = document.createElement('div');
  rows.className = 'ss-rows';
  for (const entry of state.log.slice(-5).reverse()) {
    const row = document.createElement('div');
    row.className = 'ss-row';
    row.innerHTML = `<b>N${entry.turn}</b><span>Player ${entry.player + 1}</span>` +
      `<i class="${entry.caught ? 'bad' : ''}">${entry.caught ? 'caught' : `${entry.cards.length} card(s), bag banked`}</i>`;
    rows.appendChild(row);
  }
  panel.appendChild(rows);
  return panel;
}

/* --------------------------------------------------------------- helpers */

/** Run a core move; if it throws (stale tap, illegal move), say why. */
function run(state, fn, api) {
  try {
    api.setState(fn(state));
  } catch (err) {
    api.toast(err.message);
    api.refresh();
  }
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function showPass(player, api) {
  passShown = true;
  passOverlay = passDevice(player + 1, () => {
    heldBy = player;
    passShown = false;
    passOverlay = null;
    api.refresh();
  });
}

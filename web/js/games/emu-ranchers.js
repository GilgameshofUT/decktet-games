/* Emu Ranchers — UI.  Two players, one device: hands are hidden behind a
   pass-the-device screen between turns.  Ranches (the bird stacks) are
   public, as at a real table; only the hands are secret. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './emu-ranchers-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealed = false;      // is the current player's hand on screen?
let passShown = false;
let passOverlay = null;    // the open hand-off screen, if any
let lastSeed = null;
let sel = null;            // the selected hand card

const api = mountGame({
  id: 'emu-ranchers',
  title: 'Emu Ranchers',
  subtitle: 'raise profitable birds',
  rules: '../rules/emu-ranchers.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (state.seed !== lastSeed) {
      lastSeed = state.seed; revealed = false; passShown = false; sel = null;
      if (passOverlay) { passOverlay.close(); passOverlay = null; }   // a new deal replaces the hand-off
    }
    if (sel != null && !state.hands[C.seatOf(state)].includes(sel)) sel = null;

    const seat = C.seatOf(state);
    const foe = 1 - seat;
    const table = document.createElement('div');
    table.className = 'emu-table';

    /* ---- scores / year ---- */
    const info = document.createElement('div');
    info.className = 'emu-info';
    info.innerHTML = `
      <div class="emu-scores">
        <span class="${state.turn === 0 && !state.over ? 'on' : ''}">Player 1 · <b>${fmt(state.scores[0])}</b></span>
        <span class="${state.turn === 1 && !state.over ? 'on' : ''}">Player 2 · <b>${fmt(state.scores[1])}</b></span>
      </div>
      <div class="emu-year">Year ${state.year} of ${C.YEARS} · upkeep ${C.UPKEEP}` +
      (state.lastScore && state.lastScore.year < state.year
        ? ` · last year: ${fmt(state.lastScore.scores[0])} / ${fmt(state.lastScore.scores[1])}` : '') +
      `</div>`;
    table.appendChild(info);

    /* ---- the opponent's ranch (public) ---- */
    const foePanel = panel(`Player ${foe + 1}'s ranch`,
      `${state.ranch[foe].length} bird${state.ranch[foe].length === 1 ? '' : 's'}`);
    foePanel.row.remove();
    foePanel.section.appendChild(ranchEl(state, foe, false));
    table.appendChild(foePanel.section);

    /* ---- the draw pile and the discard ---- */
    const piles = document.createElement('div');
    piles.className = 'emu-piles';
    piles.appendChild(pileEl('draw pile', state.draw.length));
    piles.appendChild(facedUp('discard', state.discard[state.discard.length - 1]));
    table.appendChild(piles);

    /* ---- your ranch ---- */
    const mine = panel(`${labelFor(seat, state)} ranch`,
      `${state.ranch[seat].length} bird${state.ranch[seat].length === 1 ? '' : 's'}`);
    mine.row.remove();
    mine.section.appendChild(ranchEl(state, seat, true));
    table.appendChild(mine.section);

    /* ---- actions ---- */
    const actions = document.createElement('div');
    actions.className = 'btnrow';
    if (!state.over && revealed) {
      if (state.phase === 'action') {
        if (sel != null) {
          actions.appendChild(btn('Hatch new bird', false, () => doAction(state, () => C.hatch(state, sel))));
          actions.appendChild(btn('Discard', false, () => doAction(state, () => C.discardCard(state, sel))));
        }
      } else if (state.phase === 'draw') {
        actions.appendChild(btn(`Draw from the deck (${state.draw.length})`,
          !C.canDraw(state, 'deck'), () => doDraw(state, 'deck')));
        if (!state.mustDrawDeck) {
          actions.appendChild(btn(`Take the discard (${state.discard.length})`,
            !C.canDraw(state, 'discard'), () => doDraw(state, 'discard')));
        }
      } else if (state.phase === 'year-end') {
        actions.appendChild(btn('Finish year-end', false,
          () => doTurnEnd(state, () => C.yeFinish(state))));
      }
    }
    table.appendChild(actions);

    /* ---- the current hand ---- */
    const handPanel = panel(`${labelFor(seat, state)} hand`,
      `${state.hands[seat].length} card${state.hands[seat].length === 1 ? '' : 's'}`);
    if (revealed || state.over) {
      for (const id of state.hands[seat]) {
        handPanel.row.appendChild(D.cardEl(cardOf(id), {
          cls: sel === id ? 'is-selected' : '',
          onPick: (c) => onHandCard(state, c.id),
          disabled: state.over || state.phase === 'draw' || state.phase === 'scored',
        }));
      }
      if (!state.hands[seat].length) handPanel.row.appendChild(D.el('div', 'empty', 'No cards.'));
    } else {
      handPanel.row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
    }
    table.appendChild(handPanel.section);

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- status + subtitle ---- */
    api.setSubtitle(state.over
      ? (state.over === 'game' ? 'the game is over' : `year ${state.year} is over`)
      : state.phase === 'year-end'
        ? `Player ${state.yeSeat + 1} plays out the year`
        : `Player ${state.turn + 1} to play`);
    api.setStatus(statusText(state, seat));

    /* ---- the hand-off ---- */
    if (!state.over && !revealed && !passShown) showPass(seat, api);
  },

  endOf(state) {
    if (!state.over) return null;
    if (state.over === 'year') {
      return {
        title: `Year ${state.year} is over`,
        cls: '',
        body: `<p>This year: Player 1 scored ${fmt(state.lastScore.scores[0])}, ` +
              `Player 2 scored ${fmt(state.lastScore.scores[1])}.</p>` +
              `<p class="muted">Totals — Player 1: ${fmt(state.scores[0])} · ` +
              `Player 2: ${fmt(state.scores[1])}</p>`,
        actions: [{
          label: 'Deal the next year', cls: 'primary',
          onClick: () => { sel = null; api.setState(C.nextYear(api.state, data.basicDeck)); },
        }],
      };
    }
    const w = state.winner;
    return {
      title: w == null ? 'The game is a draw' : `Player ${w + 1} wins the game`,
      cls: 'win',
      body: `<p>Four years of ranching.</p>` +
            `<p class="muted">Final — Player 1: ${fmt(state.scores[0])} · ` +
            `Player 2: ${fmt(state.scores[1])}</p>`,
    };
  },

  record: (state) => (state.over === 'game'
    ? { played: 1, win: null, score: null }
    : { played: 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function fmt(n) { return n < 0 ? `−${Math.abs(n)}` : String(n); }
function cardOf(id) { return { ...data.byId[D.baseId(id)], id }; }
function labelFor(seat, state) {
  return state.over ? `Player ${seat + 1}`
    : seat === state.turn || seat === state.yeSeat ? 'Your' : `Player ${seat + 1}'s`;
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

function panel(heading, count) {
  const s = document.createElement('section');
  s.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = heading;
  if (count) h.appendChild(D.el('span', 'count', count));
  s.appendChild(h);
  const row = document.createElement('div');
  row.className = 'cardrow';
  s.appendChild(row);
  return { section: s, row, heading: h };
}

function pileEl(label, n) {
  const d = document.createElement('div');
  d.className = 'pile' + (n === 0 ? ' is-empty' : '');
  d.innerHTML = `<span class="n">${n}</span><small>${label}</small>`;
  return d;
}

function facedUp(label, id) {
  const wrap = document.createElement('div');
  wrap.className = 'emu-faceup';
  if (id) wrap.appendChild(D.cardEl(cardOf(id), { tag: 'div', static: true, eager: true }));
  else wrap.appendChild(D.el('div', 'emu-blank', '—'));
  wrap.appendChild(D.el('div', 'emu-label', label));
  return wrap;
}

/** One bird: a fanned stack with a suit/total label. */
function birdEl(state, seat, idx, { legal, onClick }) {
  const stack = state.ranch[seat][idx];
  const info = C.stackInfo(stack);
  const el = document.createElement('div');
  el.className = 'emu-bird' + (legal ? ' is-legal' : '') + (onClick ? '' : ' is-static');
  stack.forEach((id, j) => {
    el.appendChild(D.cardEl(cardOf(id), {
      tag: 'div', static: true, eager: j === stack.length - 1,
      cls: j > 0 ? 'emu-shift' : '',
    }));
  });
  const label = document.createElement('div');
  label.className = 'emu-bird-label';
  for (const s of info.suits) label.appendChild(D.suitChip(s));
  const txt = document.createElement('span');
  txt.className = 'emu-bird-total';
  txt.textContent = `${info.dir === 'up' ? '↑' : info.dir === 'down' ? '↓' : ''} ${info.total}`;
  label.appendChild(txt);
  el.appendChild(label);
  el.setAttribute('aria-label',
    `${info.suits.join(' and ')} bird, ${stack.length} cards, number total ${info.total}`);
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

function ranchEl(state, seat, interactive) {
  const wrap = document.createElement('div');
  wrap.className = 'emu-ranch';
  if (!state.ranch[seat].length) {
    wrap.appendChild(D.el('div', 'empty', 'No birds yet — hatch one with a card from your hand.'));
    return wrap;
  }
  state.ranch[seat].forEach((stack, i) => {
    const legal = interactive && sel != null && C.growFits(stack, sel);
    wrap.appendChild(birdEl(state, seat, i, {
      legal,
      onClick: interactive ? () => onBird(state, i, legal) : null,
    }));
  });
  return wrap;
}

function statusText(state, seat) {
  if (state.over === 'game') return '<strong>The game is over.</strong>';
  if (state.over === 'year') return '<strong>The year is over.</strong> Deal the next one when ready.';
  if (state.phase === 'year-end') {
    return `The draw pile is empty — the year has ended. ` +
      `Player ${state.yeSeat + 1}: grow your birds with any cards that fit, then finish.`;
  }
  if (state.phase === 'draw') {
    return state.mustDrawDeck
      ? `Player ${state.turn + 1}: you discarded, so draw from the deck.`
      : `Player ${state.turn + 1}: draw from the deck or take the discard.`;
  }
  return `Player ${state.turn + 1}: hatch a new bird, grow one, or discard — ` +
    `then draw. Tap a card to begin.`;
}

function showPass(seat, api) {
  passShown = true;
  passOverlay = passDevice(seat + 1, () => {
    revealed = true;
    passShown = false;
    passOverlay = null;
    api.refresh();
  });
}

function onHandCard(state, id) {
  if (state.over || !revealed) return;
  if (state.phase !== 'action') { D.toast('Now draw — the buttons above your hand.'); return; }
  sel = sel === id ? null : id;
  api.refresh();
}

function onBird(state, idx, legal) {
  if (state.over || !revealed) return;
  if (sel == null) { D.toast('Tap a card in your hand first, then tap a bird to grow it.'); return; }
  if (!legal) {
    D.toast(`${data.byId[D.baseId(sel)].name} can't go on that bird: every card must ` +
      'share one suit and the stack must keep its order.');
    return;
  }
  if (state.phase === 'year-end') {
    api.pushHistory();
    const next = C.yeGrow(state, sel, idx);
    sel = null;
    api.setState(next);
    return;
  }
  doAction(state, () => C.grow(state, sel, idx));
}

function doAction(state, make) {
  if (!revealed || state.phase !== 'action' || sel == null) return;
  api.pushHistory();
  const next = make();
  sel = null;
  api.setState(next);
}

function doDraw(state, source) {
  if (!revealed) return;
  revealed = false;
  passShown = false;
  sel = null;
  api.pushHistory();
  api.setState(C.drawCard(state, source));
}

function doTurnEnd(state, make) {
  if (!revealed) return;
  revealed = false;
  passShown = false;
  sel = null;
  api.pushHistory();
  api.setState(make());
}

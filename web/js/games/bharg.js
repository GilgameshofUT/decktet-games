/* Bharg — UI.  Two players, one device: hands are hidden behind a
   pass-the-device screen between turns. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './bharg-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealed = false;      // is the current player's hand on screen?
let passShown = false;
let lastSeed = null;

const api = mountGame({
  id: 'bharg',
  title: 'Bharg',
  subtitle: 'bind all seven cards',
  rules: '../rules/bharg.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (state.seed !== lastSeed) { lastSeed = state.seed; revealed = false; passShown = false; }

    /* ---- table ---- */
    const table = document.createElement('div');
    table.className = 'bharg-table';

    const piles = document.createElement('div');
    piles.className = 'bharg-piles';

    piles.appendChild(pileEl('deck', state.draw.length, state.draw.length === 0));
    piles.appendChild(facedUp('discard', C.discardTop(state)));
    piles.appendChild(facedUp('ace pile', C.aceTop(state)));

    const info = document.createElement('div');
    info.className = 'bharg-info';
    info.innerHTML = `
      <div class="bharg-scores">
        <span class="${state.turn === 0 ? 'on' : ''}">Player 1 · <b>${state.scores[0]}</b></span>
        <span class="${state.turn === 1 ? 'on' : ''}">Player 2 · <b>${state.scores[1]}</b></span>
      </div>
      <div class="bharg-round">Round ${state.round} · first to ${C.TARGET_SCORE}</div>`;
    piles.appendChild(info);
    table.appendChild(piles);

    /* ---- actions ---- */
    const actions = document.createElement('div');
    actions.className = 'btnrow';
    if (!state.over && revealed) {
      if (state.phase === 'draw') {
        actions.appendChild(btn('Take from deck', !C.canDraw(state, 'deck'),
          () => doDraw(state, 'deck')));
        actions.appendChild(btn('Take the discard', !C.canDraw(state, 'discard'),
          () => doDraw(state, 'discard')));
      } else {
        const note = document.createElement('div');
        note.className = 'bharg-note';
        note.textContent = 'Now discard one card — tap it in your hand.';
        actions.appendChild(note);
      }
    }
    table.appendChild(actions);

    /* ---- the current hand ---- */
    const panel = document.createElement('section');
    panel.className = 'panel';
    const h = document.createElement('h2');
    const who = state.over ? 'Hands' : `Player ${state.turn + 1}'s hand`;
    h.innerHTML = `${who}<span class="count">${state.hands[state.turn].length} cards</span>`;
    panel.appendChild(h);

    const row = document.createElement('div');
    row.className = 'cardrow';
    if (revealed || state.over) {
      const hand = state.hands[state.turn];
      const flags = C.boundFlags(hand, C.aceTop(state));
      for (const id of hand) {
        const bound = flags.get(id);
        row.appendChild(D.cardEl(data.byId[D.baseId(id)] ? { ...data.byId[D.baseId(id)], id } : { id, name: id, suits: [], rank: 2 }, {
          cls: bound ? 'is-bound' : 'is-unbound',
          onPick: (c) => onDiscard(state, c.id),
          disabled: state.phase !== 'discard' || !!state.over,
          badge: bound ? 'bound' : null,
        }));
      }
      if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards.'));
    } else {
      row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
    }
    panel.appendChild(row);
    table.appendChild(panel);

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- status + subtitle ---- */
    api.setSubtitle(state.over
      ? (state.over === 'match' ? 'the match is over' : 'round over')
      : `Player ${state.turn + 1} to play`);
    api.setStatus(statusText(state));

    /* ---- the hand-off ---- */
    if (!state.over && !revealed && !passShown) showPass(state, api);
  },

  endOf(state) {
    if (!state.over) return null;
    if (state.over === 'round') {
      const w = state.winner;
      return {
        title: `Player ${w + 1} wins the round`,
        cls: '',
        body: `<p>Player ${2 - w} had ${state.lastScore} points of unbound cards left.</p>
               <p class="muted">Score: Player 1 — ${state.scores[0]} · Player 2 — ${state.scores[1]}</p>`,
        actions: [{ label: 'Next round', cls: 'primary', onClick: () => api.setState(C.nextRound(api.state, data.basicDeck)) }],
        record: true,
      };
    }
    const w = state.winner;
    return {
      title: w == null ? 'The match is a draw' : `Player ${w + 1} wins the match`,
      cls: 'win',
      body: `<p>First to ${C.TARGET_SCORE} points.</p>
             <p class="muted">Final: Player 1 — ${state.scores[0]} · Player 2 — ${state.scores[1]}</p>`,
    };
  },

  record: (state) => (state.over === 'match'
    ? { played: 1, win: null, score: null }
    : { played: 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function btn(label, disabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function pileEl(label, n, empty) {
  const d = document.createElement('div');
  d.className = 'pile' + (empty ? ' is-empty' : '');
  d.innerHTML = `<span class="n">${n}</span><small>${label}</small>`;
  return d;
}

function facedUp(label, id) {
  const wrap = document.createElement('div');
  wrap.className = 'bharg-faceup';
  if (id) {
    const card = { ...data.byId[D.baseId(id)], id };
    wrap.appendChild(D.cardEl(card, { tag: 'div', static: true, eager: true }));
  } else {
    wrap.appendChild(D.el('div', 'bharg-blank', '—'));
  }
  wrap.appendChild(D.el('div', 'bharg-label', label));
  return wrap;
}

function statusText(state) {
  if (state.over === 'match') return '<strong>The match is over.</strong>';
  if (state.over === 'round') return '<strong>Round over.</strong> Start the next one when ready.';
  const top = C.aceTop(state);
  const aceLine = top
    ? `Ace pile: <strong>${data.byId[D.baseId(top)].name}</strong> — anything sharing a suit with it is bound.`
    : 'The Ace pile is empty: only bharg sets bind cards right now.';
  if (state.phase === 'draw') {
    return `Player ${state.turn + 1}: take from the deck or the discard, then discard. ${aceLine}`;
  }
  return `Player ${state.turn + 1}: choose a card to discard. ${aceLine}`;
}

function showPass(state, api) {
  passShown = true;
  passDevice(state.turn + 1, () => {
    revealed = true;
    passShown = false;
    api.refresh();
  });
}

function doDraw(state, source) {
  if (!revealed) return;
  api.setState(C.draw(state, source));
}

function onDiscard(state, id) {
  if (state.over || state.phase !== 'discard' || !revealed) return;
  revealed = false;
  passShown = false;
  api.pushHistory();
  api.setState(C.discard(state, id));
}

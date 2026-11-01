/* Jacynth — UI.  The rules live in jacynth-core.js; this file draws the city
   and wires up taps. */

import * as D from '../decktet.js';
import * as C from './jacynth-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), grid: $('grid'), hand: $('hand'),
  cityCount: $('cityCount'), handCount: $('handCount'),
  deckCount: $('deckCount'), deckPile: $('deckPile'),
  hint: $('hint'), undo: $('undo'), newBtn: $('new'), help: $('help'),
  done: $('done'), sub: $('subline'),
};

let state = null;
let history = [];
let selected = null;      // hand card id
let endShown = false;

/* ------------------------------------------------------------ persistence */

function persist() {
  D.saveGame('jacynth', { state, history: history.slice(-40) });
}

function restore() {
  const saved = D.loadGame('jacynth');
  if (saved && saved.state && !saved.state.over) {
    state = saved.state;
    history = saved.history || [];
    return true;
  }
  return false;
}

function startNew() {
  state = C.newGame(D.newSeed(), data.basicDeck);
  history = [];
  selected = null;
  endShown = false;
  persist();
  render();
}

function push() {
  history.push(structuredClone(state));
  if (history.length > 60) history.shift();
}

/* ----------------------------------------------------------------- status */

function statsLine() {
  const tokensLeft = C.TOKEN_TOTAL - state.tokenCards.length;
  return `City <strong>${C.cityCount(state)}</strong>/${C.CELLS} · ` +
    `deck <strong>${state.deck.length}</strong> · ` +
    `tokens <strong>${tokensLeft}</strong> left · ` +
    `score <strong>${C.score(state)}</strong>`;
}

function promptText() {
  if (state.phase === 'setup') {
    return 'Tap one of the four starting cards to place your first influence token.';
  }
  if (C.tokenDue(state)) {
    const n = C.dueToken(state);
    return `<strong>Place your ${n === 2 ? 'second' : 'third'} influence token now</strong> — ` +
      'tap any card in the city that does not have a token yet.';
  }
  if (state.phase === 'token') {
    return 'Influence: tap a card in the city to place a token, or end your turn.';
  }
  if (selected) return 'Now tap a glowing space in the city.';
  return 'Tap a card in your hand to play it into an empty space next to the city.';
}

/* ----------------------------------------------------------------- render */

function flipHint() {
  const f = state.lastFlip;
  if (!f) return 'Play cards to fill the city, and put your tokens on the districts you want to control.';
  if (f.result === 'beaten') {
    return `You flipped <strong>${data.byId[f.flipped].name}</strong> — it beats your ` +
      `${data.byId[f.played].name} and takes the spot instead.`;
  }
  if (f.result === 'court' || f.result === 'lower') {
    return `You flipped <strong>${data.byId[f.flipped].name}</strong> — discarded, ` +
      `your ${data.byId[f.played].name} was placed as normal.`;
  }
  return 'Your card was placed as normal.';
}

function render() {
  const legal = new Set(state.phase === 'idle' && selected ? C.legalCells(state, selected) : []);
  const pickingToken = state.phase === 'setup' || state.phase === 'token';
  const tokenOn = new Set(state.tokenCards);

  els.grid.textContent = '';
  for (let i = 0; i < C.CELLS; i++) {
    const id = state.grid[i];
    let el;
    if (!id) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'card jcell is-empty';
      el.setAttribute('aria-label', 'empty space in the city');
      if (state.phase === 'idle' && selected) {
        el.classList.add(legal.has(i) ? 'is-legal' : 'is-dim');
      }
      el.addEventListener('click', () => onCell(i, null));
    } else {
      const canPick = (state.phase === 'setup' && state.corners.includes(i))
        || (state.phase === 'token' && !tokenOn.has(id))
        || legal.has(i);
      el = D.cardEl(data.byId[id], {
        cls: 'jcell',
        static: !canPick,
        dim: (state.phase === 'idle' && selected && !legal.has(i))
          || (state.phase === 'token' && tokenOn.has(id)),
        legal: canPick && state.phase !== 'idle',
        eager: state.corners.includes(i),
        onPick: () => onCell(i, id),
      });
      if (tokenOn.has(id)) {
        const tok = document.createElement('span');
        tok.className = 'tok';
        tok.setAttribute('aria-label', 'influence token');
        el.appendChild(tok);
      }
    }
    els.grid.appendChild(el);
  }

  D.renderCards(els.hand, state.hand, (id) => ({
    selected: selected === id,
    dim: state.phase !== 'idle',
    onPick: onHand,
  }));

  els.cityCount.textContent = `${C.cityCount(state)}/${C.CELLS}`;
  els.handCount.textContent = state.hand.length;
  els.deckCount.textContent = state.deck.length;
  els.deckPile.classList.toggle('is-empty', state.deck.length === 0);

  const info = C.scoreBreakdown(state);
  els.hint.innerHTML = flipHint() +
    `<br>You control <strong>${info.controlled}</strong> of <strong>${info.districts}</strong> districts.`;

  els.undo.disabled = history.length === 0;
  const showDone = state.phase === 'token' && !state.over;
  els.done.hidden = !showDone;
  els.done.disabled = C.tokenDue(state);
  els.sub.textContent = C.rankTitle(info.score);

  D.setStatus(els.status,
    state.over ? '<strong>The city is full — the game is over.</strong>' : `${statsLine()} — ${promptText()}`);

  if (state.over && !endShown) {
    endShown = true;
    showEnd();
  }
}

/* ---------------------------------------------------------------- actions */

function onHand(card) {
  if (state.over || state.phase !== 'idle') return;
  selected = selected === card.id ? null : card.id;
  render();
}

function onCell(i, id) {
  if (state.over) return;
  if (state.phase === 'setup') {
    if (state.corners.includes(i)) doPlaceToken(id);
    else D.toast('Your first token goes on one of the four starting cards.');
    return;
  }
  if (state.phase === 'token') {
    if (!id) return;
    if (state.tokenCards.includes(id)) { D.toast('That card already holds a token.'); return; }
    doPlaceToken(id);
    return;
  }
  // idle
  if (!selected) return;
  if (!state.grid[i] && C.legalCells(state, selected).includes(i)) doPlay(i, selected);
  else D.toast('You can only play into an empty space next to a card already in the city.');
}

function doPlay(i, cardId) {
  push();
  state = C.playCard(state, i, cardId);
  selected = null;
  persist();
  render();
  const f = state.lastFlip;
  if (f && f.result === 'beaten') {
    D.toast(`Flipped ${data.byId[f.flipped].name} — it takes the spot instead!`, 3000);
  } else if (f && (f.result === 'court' || f.result === 'lower')) {
    D.toast(`Flipped ${data.byId[f.flipped].name} — discarded; yours was placed.`);
  }
}

function doPlaceToken(cardId) {
  push();
  state = C.placeToken(state, cardId);
  selected = null;
  persist();
  render();
  D.toast('Influence placed.');
}

function showEnd() {
  const info = C.scoreBreakdown(state);
  const body = document.createElement('div');
  body.innerHTML = `
    <p>The city is complete. You control ${info.controlled} of ${info.districts} districts.</p>
    <div class="scoreline">${info.score}</div>
    <p><strong>${C.rankTitle(info.score)}</strong></p>
    <p class="muted" style="font-size:13.5px">One point for each card in the districts you control;
      a card in two controlled districts counts twice.</p>`;
  D.overlay({
    title: 'The city is built',
    titleCls: 'win',
    body,
    actions: [
      { label: 'Review the city', onClick: () => { endShown = false; } },
      { label: 'New game', cls: 'primary', onClick: startNew },
    ],
  });
  D.record('jacynth', { score: info.score });
}

/* --------------------------------------------------------------- controls */

els.done.addEventListener('click', () => {
  if (state.over || state.phase !== 'token') return;
  if (C.tokenDue(state)) {
    D.toast('Place the required influence token first.');
    return;
  }
  push();
  state = C.endTurn(state);
  selected = null;
  persist();
  render();
});

els.undo.addEventListener('click', () => {
  if (!history.length) return;
  state = history.pop();
  selected = null;
  endShown = false;
  persist();
  render();
  D.toast('Move undone.');
});

els.newBtn.addEventListener('click', async () => {
  if (state && !state.over && (state.moves > 0 || state.phase !== 'setup')) {
    const ok = await D.confirmBox({
      title: 'Start a new game?',
      message: 'This game is still in progress and will be discarded.',
      okLabel: 'New game',
      danger: true,
    });
    if (!ok) return;
  }
  startNew();
});

els.help.addEventListener('click', () => {
  const body = document.createElement('div');
  body.innerHTML = `
    <p>Jacynth is solitaire: fill the 4x4 city and control its districts.</p>
    <p><strong>Each turn:</strong></p>
    <ol class="muted" style="font-size:14px;padding-left:18px;margin:0 0 14px">
      <li>Play one card from your hand into an empty space that touches the city along an edge.
        Number cards (2–9) flip the top of the deck: a higher or equal number takes the spot instead,
        an Ace or Crown is simply discarded.</li>
      <li>Place at most one influence token on any card in the city.</li>
      <li>Draw a card.</li>
    </ol>
    <p class="muted" style="font-size:13.5px">Your second token must go down by the time the city
      holds 8 cards, your third by 12; the fourth is free. A district is a group of edge-adjacent
      cards sharing a suit — you score one point per card in each district holding one of your
      tokens. Full rules: the Rules link above.</p>`;
  D.overlay({ title: 'How to play', body, actions: [{ label: 'Got it', cls: 'primary' }] });
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    els.undo.click();
  }
});

/* ------------------------------------------------------------------- boot */

if (!restore()) startNew();
else render();

D.registerSW();

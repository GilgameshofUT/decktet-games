/* Adaman — UI.  The rules live in adaman-core.js; this file draws the table
   and wires up taps. */

import * as D from '../decktet.js';
import * as C from './adaman-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), palace: $('palace'), capital: $('capital'),
  resources: $('resources'), palaceCount: $('palaceCount'),
  capitalCount: $('capitalCount'), resourceCount: $('resourceCount'),
  deckCount: $('deckCount'), discardCount: $('discardCount'),
  deckPile: $('deckPile'), discardPile: $('discardPile'), hint: $('scoreHint'),
  undo: $('undo'), newBtn: $('new'), sub: $('subline'),
};

let state = null;
let history = [];
let selection = new Set();
let endShown = false;

/* ------------------------------------------------------------ persistence */

function persist() {
  D.saveGame('adaman', { state, history: history.slice(-40) });
}

function restore() {
  const saved = D.loadGame('adaman');
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
  selection = new Set();
  endShown = false;
  persist();
  render();
}

/* ----------------------------------------------------------------- status */

function selectedIds() {
  return [...selection];
}

function selectionInfo() {
  const ids = selectedIds();
  const total = ids.reduce((sum, id) => sum + C.rankValue(data.byId[id]), 0);
  return { ids, total, count: ids.length };
}

function whyNot(targetId, ids, total) {
  const target = data.byId[targetId];
  const wrongSuit = ids.filter((id) =>
    !data.byId[id].suits.some((s) => target.suits.includes(s)));
  if (wrongSuit.length) {
    const names = wrongSuit.map((id) => data.byId[id].name).join(', ');
    return `<strong>${names}</strong> ${wrongSuit.length > 1 ? 'share' : 'shares'} no suit with ${D.describe(target)}.`;
  }
  return `You need at least <strong>${C.rankValue(target)}</strong>; you have <strong>${total}</strong>.`;
}

function statusText() {
  const { ids, total, count } = selectionInfo();
  const controlled = C.personalitiesInDiscard(state);
  const tail = `Personality <strong>${controlled}/${C.PERSONALITY_TOTAL}</strong>`;
  if (!count) {
    return `Tap cards in <strong>your resources</strong> to select them, then tap a card to take control of it. · ${tail}`;
  }
  const legal = C.legalTargets(state, ids);
  if (legal.length) {
    return `${count} card${count > 1 ? 's' : ''}, total rank <strong>${total}</strong> — now tap a glowing card. · ${tail}`;
  }
  return `Nothing can be taken with that selection: pick cards that share a suit with your target and add up to its rank. · ${tail}`;
}

/* ----------------------------------------------------------------- render */

function render() {
  const { ids } = selectionInfo();
  const legal = new Set(ids.length ? C.legalTargets(state, ids) : []);
  const anyLegal = ids.length > 0 && legal.size > 0;

  D.renderCards(els.palace, state.palace, (id) => ({
    selected: selection.has(id),
    legal: legal.has(id),
    dim: anyLegal && !legal.has(id),
    onPick: onTarget,
  }));
  D.renderCards(els.capital, state.capital, (id) => ({
    selected: selection.has(id),
    legal: legal.has(id),
    dim: anyLegal && !legal.has(id),
    onPick: onTarget,
  }));
  D.renderCards(els.resources, state.resources, (id) => ({
    selected: selection.has(id),
    onPick: onResource,
    emptyText: 'No resources left.',
  }));

  els.palaceCount.textContent = state.palace.length;
  els.palaceCount.className = 'count' +
    (state.palace.length >= 5 ? ' is-hot' : state.palace.length >= 3 ? ' is-warm' : '');
  els.capitalCount.textContent = state.capital.length;
  els.resourceCount.textContent = state.resources.length;
  els.deckCount.textContent = state.deck.length;
  els.discardCount.textContent = state.discard.length;
  els.deckPile.classList.toggle('is-empty', state.deck.length === 0);

  const controlled = C.personalitiesInDiscard(state);
  els.hint.innerHTML =
    `You have turned <strong>${controlled}</strong> of the eleven personalities.` +
    (state.deck.length === 0
      ? '<br>The deck is empty — play out the rows until the game ends.'
      : '<br>Win by controlling all eleven before the palace fills with onlookers.');

  els.undo.disabled = history.length === 0;
  D.setStatus(els.status, state.over ? '<strong>The game is over.</strong>' : statusText());

  if (state.over && !endShown) {
    endShown = true;
    showEnd();
  }
}

/* ---------------------------------------------------------------- actions */

function onResource(card) {
  if (state.over) return;
  if (selection.has(card.id)) selection.delete(card.id);
  else selection.add(card.id);
  render();
}

function onTarget(card) {
  if (state.over) return;
  const { ids, total } = selectionInfo();
  if (!ids.length) {
    D.toast('Select one or more resources first.');
    return;
  }
  if (!C.canTake(state, card.id, ids)) {
    D.toast(whyNot(card.id, ids, total), 3200);
    return;
  }
  history.push(structuredClone(state));
  if (history.length > 60) history.shift();
  state = C.applyMove(state, card.id, ids);
  selection = new Set();
  endShown = false;
  persist();
  render();
}

function showEnd() {
  const info = C.OUTCOME[state.over];
  const score = C.scoreOf(state);
  const body = document.createElement('div');
  body.innerHTML = `
    <p>${info.text}</p>
    <div class="scoreline">${score}</div>
    <p class="muted" style="font-size:14px">
      ${state.over === 'won'
        ? '66 for the eleven personalities, plus the ranks left in your resources.'
        : state.over === 'lost'
          ? 'The ranks of the personalities you managed to control.'
          : 'Caught in the act — zero points.'}
    </p>`;
  D.overlay({
    title: info.title,
    titleCls: info.cls,
    body,
    actions: [
      { label: 'Review the board', cls: '', onClick: () => { endShown = false; } },
      { label: 'New game', cls: 'primary', onClick: startNew },
    ],
  });
  D.record('adaman', {
    win: state.over === 'won',
    score: state.over === 'won' ? score : null,
  });
}

/* --------------------------------------------------------------- controls */

els.undo.addEventListener('click', () => {
  if (!history.length) return;
  state = history.pop();
  selection = new Set();
  endShown = false;
  persist();
  render();
  D.toast('Move undone.');
});

els.newBtn.addEventListener('click', async () => {
  if (state && !state.over && state.moves > 0) {
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

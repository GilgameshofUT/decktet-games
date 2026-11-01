/* Gongor Whist — UI.  The rules live in gongor-whist-core.js; this file draws
   the table and wires up taps. */

import * as D from '../decktet.js';
import * as C from './gongor-whist-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), undo: $('undo'), newBtn: $('new'),
  tableLabel: $('tableLabel'), trump: $('trump'), strip: $('strip'),
  progress: $('progress'), scoreVal: $('scoreVal'), barFill: $('barFill'),
  leadSlot: $('leadSlot'), playSlot: $('playSlot'), reveal: $('reveal'),
  actions: $('actions'), bidNote: $('bidNote'), bidsheet: $('bidsheet'),
  handCount: $('handCount'), hand: $('hand'),
  acePile: $('acePile'), aceCount: $('aceCount'),
  deckPile: $('deckPile'), deckCount: $('deckCount'), hint: $('hint'),
  howto: $('howto'), scoring: $('scoring'),
};

const GAME = 'gongor-whist';
const scoringMode = () =>
  (D.getSetting('gongor.scoring', 'standard') === 'points' ? 'points' : 'standard');

let state = null;
let history = [];          // in-memory undo stack: one hand at a time
let resultShown = false;   // the hand-result dialog has been shown this hand
let endShown = false;      // the game-over dialog has been shown
let recorded = false;

/* ------------------------------------------------------------ persistence */

function persist() {
  D.saveGame(GAME, state);
}

function restore() {
  const saved = D.loadGame(GAME);
  if (saved && saved.phase && !saved.over && saved.phase !== 'gameOver') {
    state = saved;
    state.mode = scoringMode();   // the settings button is always authoritative
    history = [];
    return true;
  }
  return false;
}

function startNew() {
  state = C.newGame(D.newSeed(), { mode: scoringMode() });
  history = [];
  resultShown = false;
  endShown = false;
  recorded = false;
  persist();
  render();
}

/** Take an action: remember the state we came from, then draw the result. */
function commit(next) {
  history.push(structuredClone(state));
  if (history.length > 60) history.shift();
  state = next;
  persist();
  render();
}

function undoable() {
  if (!state || !history.length) return false;
  if (state.phase === 'playing' || state.phase === 'bidding') return true;
  // A finished hand can still be re-opened — unless it decided the game.
  if (state.phase === 'handOver') return !C.handResult(state).gameOver;
  return false;
}

/* ------------------------------------------------------------- small views */

function addTag(parent, text, cls) {
  const s = document.createElement('span');
  s.className = cls || 'tag';
  s.textContent = text;
  parent.appendChild(s);
  return s;
}

function handLabel(s) {
  const kind = s.handType === 'fore' ? 'Fore' : 'Aft';
  if (s.mode === 'standard' && s.handNo <= 8) return `${kind} ${s.handNo} of 8`;
  return `${kind} hand ${s.handNo}`;
}

function shownScore() {
  if (state.phase === 'handOver') return C.handResult(state).score;
  return state.score;
}

function renderTrump() {
  const s = state;
  els.trump.textContent = '';
  els.trump.classList.toggle('is-none', !s.trump);
  if (s.trump) {
    els.trump.appendChild(D.suitChip(s.trump));
    els.trump.appendChild(D.el('strong', null, `${D.SUIT_NAME[s.trump]} is trump`));
  } else {
    els.trump.appendChild(D.el('strong', null, 'No trump'));
    els.trump.appendChild(D.el('span', 'muted', 'the ace stack is empty'));
  }
  addTag(els.trump, `aces ${s.aceStack.length}`, 'tag plain');
}

function renderStrip(trickNo) {
  const s = state;
  els.strip.textContent = '';
  addTag(els.strip, s.bid == null ? 'Bid —' : `Bid ${s.bid}`);
  addTag(els.strip, `Won ${s.tricksWon} of ${C.TRICKS_PER_HAND}`, 'tag plain');
  addTag(els.strip, `Trick ${trickNo} of ${C.TRICKS_PER_HAND}`, 'tag plain');
  addTag(els.strip, handLabel(s), 'tag plain');
  addTag(els.strip, `Deck ${s.deck.length}`, 'tag plain');
  if (s.mode === 'points') {
    addTag(els.strip, `Score ${shownScore()} / ${C.POINTS_TARGET}`);
  }
  if (s.setAside.length) {
    addTag(els.strip, `${s.setAside.length} set aside`, 'tag plain');
  }
}

function renderProgress() {
  const s = state;
  const points = s.mode === 'points';
  els.progress.hidden = !points;
  if (!points) return;
  const score = shownScore();
  els.scoreVal.textContent = `${score} / ${C.POINTS_TARGET}`;
  const pct = Math.max(0, Math.min(100, (score / C.POINTS_TARGET) * 100));
  els.barFill.style.width = `${pct}%`;
}

function slot(container, id, placeholder) {
  container.textContent = '';
  if (id && data.byId[id]) container.appendChild(D.cardEl(data.byId[id], { static: true, eager: true }));
  else container.appendChild(D.el('span', 'gw-slot-text', placeholder));
}

function renderTrickArea() {
  const s = state;
  // After the hand the last trick stays on the table to look at.
  const done = s.phase === 'handOver' || s.phase === 'gameOver';
  const lead = s.leadCard || (done && s.lastTrick ? s.lastTrick.lead : null);
  const play = s.playerCard || (done && s.lastTrick ? s.lastTrick.play : null);
  slot(els.leadSlot, lead, s.phase === 'bidding' ? 'flips on your bid' : 'waiting');
  slot(els.playSlot, play, done ? 'hand over' : 'your card');

  if (s.lastTrick && (s.phase === 'playing' || done)) {
    const t = s.lastTrick;
    els.reveal.hidden = false;
    els.reveal.className = 'gw-reveal ' + (t.winner === 'you' ? 'is-you' : 'is-dummy');
    els.reveal.textContent = '';
    els.reveal.append(`Trick ${t.no} of ${C.TRICKS_PER_HAND} — `);
    els.reveal.appendChild(D.el('strong', null, t.winner === 'you' ? 'you win' : 'the dummy wins'));
    els.reveal.append(t.twiddled ? ' · trump was twiddled' : '');
  } else {
    els.reveal.hidden = true;
  }
}

function actionButton(label, onClick, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + (cls || '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderActions() {
  const s = state;
  els.actions.textContent = '';
  els.actions.hidden = false;

  if (s.phase === 'playing' && s.playerCard) {
    const twiddleable = !s.twiddled && (s.aceStack.length > 0 || s.trump !== null);
    if (twiddleable) {
      const left = s.aceStack.length;
      els.actions.appendChild(actionButton(
        `Twiddle trump${left ? ` (${left} ace${left > 1 ? 's' : ''} left)` : ' (no aces left)'}`,
        onTwiddle, 'primary'));
    } else if (!s.twiddled) {
      els.actions.appendChild(D.el('span', 'muted', 'Nothing left to twiddle — the trump is set.'));
    }
    els.actions.appendChild(actionButton('Resolve the trick', onResolve, 'primary'));
  } else if (s.phase === 'handOver') {
    els.actions.appendChild(actionButton('Next hand', onNextHand, 'primary'));
  } else if (s.phase === 'gameOver') {
    els.actions.appendChild(actionButton('New game', startNew, 'primary'));
  } else {
    els.actions.hidden = true;
  }
}

function renderBidSheet() {
  const s = state;
  chips.forEach((b, n) => {
    const used = s.mode === 'standard' && s.bidSheet[n];
    b.classList.toggle('is-used', used);
    b.classList.toggle('is-mine', s.bid === n);
    b.disabled = s.phase !== 'bidding' || used;
    b.setAttribute('aria-pressed', s.bid === n ? 'true' : 'false');
  });
  els.bidNote.textContent = s.mode === 'points'
    ? 'any bid may be repeated'
    : `${s.bidSheet.filter(Boolean).length} of 8 used`;
}

function renderHand() {
  const s = state;
  const choosing = s.phase === 'playing' && !s.playerCard;
  const legal = choosing ? new Set(C.legalPlays(s)) : null;
  D.renderCards(els.hand, s.yourHand, (id) => ({
    legal: !!legal && legal.has(id),
    dim: !!legal && !legal.has(id),
    onPick: onPlay,
  }));
  els.handCount.textContent = `${s.yourHand.length} card${s.yourHand.length === 1 ? '' : 's'}`;
}

function renderPiles() {
  const s = state;
  els.aceCount.textContent = s.aceStack.length;
  els.deckCount.textContent = s.deck.length;
  els.acePile.classList.toggle('is-empty', s.aceStack.length === 0);
  els.deckPile.classList.toggle('is-empty', s.deck.length === 0);

  let hint = '';
  if (s.handType === 'aft') {
    hint += `<strong>Aft hand</strong> — dealt without reshuffling`
      + (s.setAside.length
        ? `; ${s.setAside.length} card${s.setAside.length > 1 ? 's' : ''} set aside unseen. `
        : '. ');
  }
  hint += s.aceStack.length
    ? `${s.aceStack.length} ace${s.aceStack.length > 1 ? 's' : ''} left in the stack — twiddle to change trump.`
    : 'The ace stack is empty: twiddling now means <strong>no trump</strong> for the rest of the hand.';
  els.hint.innerHTML = hint;
}

function statusText() {
  const s = state;
  if (s.phase === 'bidding') {
    return s.mode === 'standard'
      ? 'Look at your hand and <strong>bid</strong> a number 0–7 on the sheet — each bid may be used only once in the game.'
      : 'Look at your hand and <strong>bid</strong> a number 0–7. Any bid may be repeated.';
  }
  if (s.phase === 'playing') {
    if (!s.playerCard) {
      const lead = data.byId[s.leadCard];
      const follow = lead
        ? lead.suits.map((x) => D.SUIT_NAME[x]).join(' or ')
        : '';
      return `The dummy leads <strong>${lead ? D.describe(lead) : '—'}</strong>. `
        + `Play a ${follow} card if you have one — otherwise anything.`;
    }
    const play = data.byId[s.playerCard];
    return `Your <strong>${play ? D.describe(play) : 'card'}</strong> is on the table. `
      + '<strong>Twiddle trump</strong> if you like, then resolve the trick.';
  }
  if (s.phase === 'handOver') {
    const r = C.handResult(s);
    return `<strong>Hand over.</strong> You won ${r.tricksWon} of ${C.TRICKS_PER_HAND} tricks and bid ${r.bid}.`;
  }
  return '<strong>The game is over.</strong> Start a new one when you are ready.';
}

/* ------------------------------------------------------------------ render */

function render() {
  if (!state) return;

  let pending = null;
  if (state.phase === 'handOver') {
    const res = C.handResult(state);
    if (res.gameOver) {
      state = C.nextHand(state);   // banks the points and closes the game
      persist();
    } else if (!resultShown) {
      resultShown = true;
      pending = res;
    }
  }
  const s = state;
  const trickNo = s.phase === 'bidding' ? 1
    : s.phase === 'playing' ? Math.min(s.tricksPlayed + 1, C.TRICKS_PER_HAND)
      : C.TRICKS_PER_HAND;

  els.tableLabel.textContent = handLabel(s);
  renderTrump();
  renderStrip(trickNo);
  renderProgress();
  renderTrickArea();
  renderActions();
  renderBidSheet();
  renderHand();
  renderPiles();

  els.undo.disabled = !undoable();
  els.scoring.textContent = s.mode === 'points' ? 'Scoring: to 50' : 'Scoring: checklist';
  D.setStatus(els.status, statusText());

  if (pending) showHandResult(pending);
  if (s.over && !endShown) showEnd();
}

/* ----------------------------------------------------------------- dialogs */

function showHandResult(res) {
  const body = document.createElement('div');
  body.innerHTML =
    `<p>You won <strong>${res.tricksWon}</strong> of ${C.TRICKS_PER_HAND} tricks and bid <strong>${res.bid}</strong>.</p>`
    + (state.mode === 'points'
      ? `<p>Score: <strong>${res.score}</strong> / ${C.POINTS_TARGET} (${res.points >= 0 ? '+' : ''}${res.points}).</p>`
      : '');
  D.overlay({
    title: res.title,
    titleCls: res.cls,
    body,
    actions: [{ label: 'Next hand', cls: 'primary', onClick: onNextHand }],
  });
}

function showEnd() {
  endShown = true;
  const s = state;
  const res = C.handResult(s);
  const checklist = s.mode !== 'points';
  const score = checklist ? s.bidSheet.filter(Boolean).length : s.score;

  const outcome = s.over === 'won'
    ? (checklist
      ? 'Four fore hands and four aft hands, every one of the eight bids made. You win!'
      : `${s.score} points in one sitting — a decisive win.`)
    : (res.ok
      ? 'The game ended without a missed bid, but the sheet was not finished.'
      : `You needed exactly ${res.bid} tricks and took ${res.tricksWon}. One missed bid ends the game.`);

  const body = document.createElement('div');
  body.innerHTML = `<p>${outcome}</p>`
    + `<div class="scoreline">${score}${checklist ? ' / 8' : ` / ${C.POINTS_TARGET}`}</div>`
    + `<p class="muted" style="font-size:14px">${checklist ? 'bids made' : 'points'}</p>`;

  D.overlay({
    title: res.title,
    titleCls: res.cls,
    body,
    actions: [
      { label: 'Review the table', onClick: () => { endShown = false; } },
      { label: 'New game', cls: 'primary', onClick: startNew },
    ],
  });

  if (!recorded) {
    recorded = true;
    D.record(GAME, { win: s.over === 'won', score: checklist ? score : s.score });
  }
}

const HOWTO = `
  <ul>
    <li><strong>The ace stack.</strong> The six Aces are shuffled apart; the top
    one lies face up and its suit is trump.</li>
    <li><strong>Bid</strong> how many of the seven tricks you will take (0–7) on
    the bid sheet. In the standard game each number may be used only once.</li>
    <li><strong>Play.</strong> The dummy leads; follow suit if you can, and play
    anything when you cannot.</li>
    <li><strong>Twiddle trump.</strong> After you play, and before the trick
    resolves, you may flip the next ace to change trump. With no aces left,
    twiddling means no trump for the rest of the hand.</li>
    <li><strong>Make exactly your bid.</strong> Win one trick more or less and
    the game is over.</li>
    <li><strong>Two hands per pass.</strong> The aft hand is dealt from the
    remaining deck without reshuffling. Four fore hands and four aft hands with
    all eight bids made wins the game.</li>
  </ul>
  <p class="muted" style="font-size:13.5px">Scoring is the bid checklist unless
  you switch it to “Point scoring to 50” with the Scoring button.</p>`;

/* ---------------------------------------------------------------- actions */

function onBid(n) {
  if (!state || state.phase !== 'bidding') {
    D.toast('The bid sheet is closed for this hand.');
    return;
  }
  if (state.mode === 'standard' && state.bidSheet[n]) {
    D.toast(`${n} is already used — pick another bid.`, 2600);
    return;
  }
  commit(C.bid(state, n));
  D.toast(`Bid ${n} trick${n === 1 ? '' : 's'} — now play them out.`);
}

function onPlay(card) {
  if (!state || state.phase !== 'playing') {
    D.toast('Bid on the sheet first — then the tricks begin.');
    return;
  }
  if (state.playerCard) {
    D.toast('Twiddle trump or resolve the trick first.');
    return;
  }
  if (!C.legalPlays(state).includes(card.id)) {
    const lead = data.byId[state.leadCard];
    const follow = lead ? lead.suits.map((x) => D.SUIT_NAME[x]).join(' or ') : 'lead';
    D.toast(`Follow suit: play a ${follow} card, or nothing else.`, 3000);
    return;
  }
  commit(C.playCard(state, card.id));
}

function onTwiddle() {
  if (!state || state.phase !== 'playing' || !state.playerCard || state.twiddled) return;
  commit(C.twiddle(state));
  D.toast(state.trump
    ? `Trump is now ${D.SUIT_NAME[state.trump]}.`
    : 'No trump for the rest of this hand.', 2600);
}

function onResolve() {
  if (!state || state.phase !== 'playing' || !state.playerCard) return;
  commit(C.resolveTrick(state));
  const t = state.lastTrick;
  if (t) D.toast(t.winner === 'you' ? 'You win the trick.' : 'The dummy wins the trick.');
}

function onNextHand() {
  if (!state || state.phase !== 'handOver') return;
  state = C.nextHand(state);
  history = [];            // undo reaches back across one hand only
  resultShown = false;
  persist();
  render();
}

/* --------------------------------------------------------------- controls */

const chips = [];
for (let n = 0; n <= 7; n++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bidchip';
  b.textContent = String(n);
  b.setAttribute('aria-label', `Bid ${n} trick${n === 1 ? '' : 's'}`);
  b.addEventListener('click', () => onBid(n));
  els.bidsheet.appendChild(b);
  chips.push(b);
}

els.undo.addEventListener('click', () => {
  if (!undoable()) return;
  state = history.pop();
  resultShown = false;
  persist();
  render();
  D.toast('Undone.');
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

els.howto.addEventListener('click', () => {
  const body = document.createElement('div');
  body.innerHTML = HOWTO;
  D.overlay({ title: 'How to play', body, actions: [{ label: 'Got it', cls: 'primary' }] });
});

els.scoring.addEventListener('click', () => {
  const cur = scoringMode();
  D.overlay({
    title: 'Scoring',
    body: '<p>Choose how the game is scored — the choice is remembered on this device.</p>'
      + '<p class="muted" style="font-size:13.5px">'
      + '<strong>Bid checklist:</strong> each bid 0–7 is used once per game; miss one and you lose, '
      + 'make all eight and you win.<br>'
      + '<strong>Point scoring:</strong> bid any number every hand; add it when you make it, lose the '
      + `tricks you won when you miss, and race to ${C.POINTS_TARGET}.</p>`,
    actions: [
      {
        label: 'Bid checklist (standard)',
        cls: cur === 'standard' ? 'primary' : '',
        onClick: () => setScoring('standard'),
      },
      {
        label: 'Point scoring to 50',
        cls: cur === 'points' ? 'primary' : '',
        onClick: () => setScoring('points'),
      },
    ],
  });
});

function setScoring(mode) {
  D.setSetting('gongor.scoring', mode);
  if (state && state.phase !== 'gameOver') {
    state.mode = mode;
    persist();
  }
  render();
  D.toast(mode === 'points' ? 'Point scoring to 50.' : 'Bid checklist scoring.');
}

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

/* Terrapin — UI.  Two players, one device: hands are hidden behind the
   pass-the-device screen between turns.  Chips are counters in the state;
   both variants (Western, Temptation) share this table. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './terrapin-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealedFor = null;      // whose hand may be on screen right now
let passShown = false;
let passOverlay = null;      // the open hand-off screen, if any
let lastSig = '';
let variant = D.getSetting('terrapin.variant', 'western');

const api = mountGame({
  id: 'terrapin',
  title: 'Terrapin',
  subtitle: 'bet on pairs and straights',
  rules: '../rules/terrapin.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck, variant),

  render(state, api) {
    variant = state.variant;                      // a restored game keeps its variant
    const actor = actorOf(state);
    const sig = `${state.seed}:${state.hand}:${state.moves}:${state.phase}:${actor}`;
    if (sig !== lastSig) lastSig = sig;

    const table = D.el('div', 'trp-table');

    /* ---- chips ---- */
    const chips = D.el('div', 'trp-chips');
    chips.appendChild(chipBadge('Pot', state.pot, 'pot'));
    chips.appendChild(chipBadge(dealerLabel(state, 0), state.stacks[0], actor === 0 ? 'on' : ''));
    chips.appendChild(chipBadge(dealerLabel(state, 1), state.stacks[1], actor === 1 ? 'on' : ''));
    table.appendChild(chips);
    table.appendChild(D.el('div', 'trp-handno',
      `Hand ${state.hand} of at most ${C.MAX_HANDS} · ` +
      `${state.variant === 'western' ? 'Western' : 'Temptation'} · first to ${C.TARGET_CHIPS} chips`));

    /* ---- the shared cards ---- */
    const shared = D.el('section', 'panel');
    shared.appendChild(D.el('h2', '', 'The three face-up cards'));
    const srow = D.el('div', 'cardrow');
    if (state.shared.length) {
      for (const id of state.shared) srow.appendChild(cardImg(id));
    } else {
      srow.appendChild(D.el('div', 'empty',
        'These are dealt after the first betting round.'));
    }
    shared.appendChild(srow);
    if (state.setAside.length) {
      shared.appendChild(D.el('div', 'trp-note',
        `${state.setAside.length} cards were set aside — that triple was Turtle Butt.`));
    }
    table.appendChild(shared);

    /* ---- actions ---- */
    const actions = D.el('div', 'trp-actions');
    if (!state.over && state.phase !== 'handOver' && revealedFor === actor) {
      if (state.variant === 'western' && state.phase === 'bet') {
        const facing = state.bet.contrib[actor] !== state.bet.level;
        if (!facing) {
          actions.appendChild(D.el('div', 'trp-note',
            `Player ${actor + 1}: bet 1–${C.RAISE_LIMIT} chips, or fold.`));
          for (let n = 1; n <= C.RAISE_LIMIT; n++) {
            actions.appendChild(btn(`Bet ${n}`, '', () => commit(api, () => C.bet(api.state, n))));
          }
        } else {
          const owed = state.bet.level - state.bet.contrib[actor];
          actions.appendChild(D.el('div', 'trp-note',
            `Player ${actor + 1}: match ${owed} chips, raise, or fold.`));
          actions.appendChild(btn(`Call (${owed})`, 'primary', () => commit(api, () => C.call(api.state))));
          for (let n = 1; n <= C.RAISE_LIMIT; n++) {
            actions.appendChild(btn(`Raise +${n}`, '', () => commit(api, () => C.raise(api.state, n))));
          }
        }
        actions.appendChild(btn('Fold', 'danger', () => commit(api, () => C.fold(api.state))));
      } else if (state.variant === 'western' && state.phase === 'draw') {
        actions.appendChild(D.el('div', 'trp-note',
          `Player ${actor + 1}: take a card face down, or stand.`));
        actions.appendChild(btn('Take a card', 'primary', () => commit(api, () => C.takeCard(api.state))));
        actions.appendChild(btn('Stand', '', () => commit(api, () => C.stand(api.state))));
      } else if (state.variant === 'temptation' && state.phase === 'buy') {
        actions.appendChild(D.el('div', 'trp-note',
          `Player ${actor + 1}: round ${state.buyRound} — a card costs ` +
          `${state.buyRound} chip${state.buyRound === 1 ? '' : 's'}.`));
        actions.appendChild(btn(`Take a card (pay ${state.buyRound})`, 'primary',
          () => commit(api, () => C.buyCard(api.state))));
        actions.appendChild(btn('Pass', '', () => commit(api, () => C.passCard(api.state))));
      }
    }
    table.appendChild(actions);

    /* ---- the hand(s) ---- */
    if (state.phase === 'handOver' || state.over) {
      table.appendChild(resultPanel(state));
      for (let p = 0; p < 2; p++) table.appendChild(handPanel(state, `Player ${p + 1}’s hand`, state.hands[p], p));
    } else if (revealedFor === actor) {
      table.appendChild(handPanel(state, `Player ${actor + 1}’s hand`, state.hands[actor], actor));
    } else {
      table.appendChild(handPanel(state, `Player ${actor + 1}’s hand`, null));
    }

    /* ---- variant switch ---- */
    const settings = D.el('div', 'btnrow trp-settings');
    const other = state.variant === 'western' ? 'temptation' : 'western';
    settings.appendChild(btn(`Switch to ${other[0].toUpperCase() + other.slice(1)} Terrapin`, '',
      async () => {
        const ok = await api.confirm({
          title: 'Switch variant?',
          message: 'A new match of the other variant starts; this one is discarded.',
          okLabel: 'New match',
        });
        if (!ok) return;
        variant = other;
        D.setSetting('terrapin.variant', other);
        revealedFor = null;
        passShown = false;
        if (passOverlay) { passOverlay.close(); passOverlay = null; }
        api.newGame();
      }));
    table.appendChild(settings);

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- chrome ---- */
    api.setSubtitle(state.over ? 'the match is over'
      : state.phase === 'handOver' ? 'the hand is over'
      : `Player ${actor + 1} to play`);
    api.setStatus(statusText(state));

    /* ---- the hand-off ---- */
    if (!state.over && state.phase !== 'handOver' && actor != null &&
        revealedFor !== actor && !passShown) {
      showPass(actor, api);
    }
  },

  endOf(state) {
    if (!state.over) return null;
    const w = state.winner;
    return {
      title: w == null ? 'The match is a draw' : `Player ${w + 1} wins the match`,
      cls: 'win',
      body: `<p>First to ${C.TARGET_CHIPS} chips, ${C.MAX_HANDS} hands, ` +
            `or until one player is broke.</p>` +
            `<p class="muted">Final: Player 1 — ${state.stacks[0]} · ` +
            `Player 2 — ${state.stacks[1]}</p>`,
    };
  },

  record: (state) => (state.over === 'match'
    ? { played: 1, win: null, score: state.winner == null ? null : Math.max(...state.stacks) }
    : { played: 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function actorOf(state) {
  if (state.over || state.phase === 'handOver') return null;
  if (state.variant === 'western') {
    if (state.phase === 'bet') return state.bet.toAct;
    if (state.phase === 'draw') return state.drawOffer.to;
    return null;
  }
  return state.offer ? state.offer.to : null;
}

function dealerLabel(state, p) {
  return `Player ${p + 1}${state.dealer === p ? ' · dealer' : ''}`;
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function chipBadge(label, n, cls) {
  const d = D.el('div', 'trp-chip' + (cls ? ' ' + cls : ''));
  d.innerHTML = `${label} <b>${n}</b>`;
  return d;
}

function cardImg(id) {
  const card = { ...data.byId[D.baseId(id)], id };
  return D.cardEl(card, { tag: 'div', static: true });
}

function commit(api, fn) {
  try {
    const next = fn();
    revealedFor = null;
    passShown = false;
    api.pushHistory();
    api.setState(next);
    return true;
  } catch (e) {
    api.setStatus(e.message, true);
    return false;
  }
}

function handPanel(state, title, hand, p) {
  const panel = D.el('section', 'panel');
  const h = D.el('h2', '', title);
  panel.appendChild(h);
  const row = D.el('div', 'cardrow');
  if (hand) {
    for (const id of hand) row.appendChild(cardImg(id));
    if (state.shared.length && p != null) {
      const sc = C.scoreHand([...hand, ...state.shared]);
      h.appendChild(D.el('span', 'count', `${hand.length} cards`));
      row.appendChild(D.el('div', 'trp-score', C.describeScore(sc)));
    }
    if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards.'));
  } else {
    row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
  }
  panel.appendChild(row);
  return panel;
}

function resultPanel(state) {
  const panel = D.el('section', 'panel trp-result');
  panel.appendChild(D.el('h2', '', state.over ? 'The match is over' : `Hand ${state.hand} is over`));
  panel.appendChild(D.el('p', 'trp-note', state.note));
  panel.appendChild(D.el('p', 'muted',
    `Player 1 — ${state.stacks[0]} chips · Player 2 — ${state.stacks[1]} chips · ` +
    `pot ${state.pot}`));
  if (!state.over) {
    panel.appendChild(btn('Next hand', 'primary', () => {
      try {
        revealedFor = null;
        passShown = false;
        api.pushHistory();
        api.setState(C.nextHand(api.state, data.basicDeck));
      } catch (e) {
        api.setStatus(e.message, true);
      }
    }));
  }
  return panel;
}

function statusText(state) {
  if (state.over === 'match') return '<strong>The match is over.</strong>';
  if (state.phase === 'handOver') return `<strong>${state.note}</strong> Start the next hand when ready.`;
  const actor = actorOf(state);
  if (revealedFor !== actor) return `Player ${actor + 1} to play.`;
  return state.note;
}

function showPass(p, api) {
  if (passOverlay) passOverlay.close();             // never stack two hand-off screens
  passShown = true;
  passOverlay = passDevice(p + 1, () => {
    revealedFor = p;
    passShown = false;
    passOverlay = null;
    api.refresh();
  });
}

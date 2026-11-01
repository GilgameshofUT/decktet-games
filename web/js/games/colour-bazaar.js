/* Colour Bazaar — UI.  Two players, one device: the hand is hidden behind a
   pass-the-device screen whenever the player who must act changes. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './colour-bazaar-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealedFor = null;      // whose hand may be on screen right now
let passShown = false;
let lastSig = '';
let selected = null;         // the tapped card, waiting for a market

const api = mountGame({
  id: 'colour-bazaar',
  title: 'Colour Bazaar',
  subtitle: 'the treacherous winds of fashion',
  rules: '../rules/colour-bazaar.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    const act = state.over ? null : state.turn;
    const sig = `${state.seed}:${state.moves}:${state.phase}:${state.turn}`;
    if (sig !== lastSig) { lastSig = sig; selected = null; }

    const table = D.el('div', 'cb-table');
    const pad = C.score(state);

    /* ---- the styles (chips on offer) ---- */
    const styles = D.el('section', 'panel');
    const sh = D.el('h2', '', 'Styles on offer');
    const left = C.SUITS.reduce((n, s) => n + state.supply[s], 0);
    sh.appendChild(D.el('span', 'count', `${left}/30 chips`));
    styles.appendChild(sh);
    const srow = D.el('div', 'cb-styles');
    for (const suit of C.SUITS) {
      const n = state.supply[suit];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cb-chip' + (n === 0 ? ' is-out' : '') +
        (state.phase === 'chip' && !state.over && revealedFor === act && n > 0 ? ' is-legal' : '');
      b.appendChild(D.suitChip(suit));
      b.appendChild(D.el('span', 'cb-chipn', String(n)));
      b.setAttribute('aria-label', `${D.SUIT_NAME[suit]} chips left: ${n}`);
      b.addEventListener('click', () => {
        if (state.phase !== 'chip' || state.over) {
          api.setStatus(state.over ? 'The game is over.' :
            'First influence fashion — play or discard a card — then take a chip.', true);
          return;
        }
        commit(() => C.takeChip(state, suit));
      });
      srow.appendChild(b);
    }
    styles.appendChild(srow);
    table.appendChild(styles);

    /* ---- the four markets ---- */
    const markets = D.el('section', 'panel');
    markets.appendChild(D.el('h2', '', 'Markets'));
    const mrow = D.el('div', 'cb-stacks');
    state.stacks.forEach((stack, si) => {
      const col = document.createElement('button');
      col.type = 'button';
      col.className = 'cb-stack';
      const playable = !state.over && revealedFor === act && state.phase === 'play' &&
        selected && C.canPlay(state, selected, si);
      if (playable) col.classList.add('is-legal');
      // top of the stack first; the cards below peek out
      for (let i = stack.length - 1; i >= 0; i--) {
        const id = stack[i];
        const c = { ...data.byId[D.baseId(id)], id };
        col.appendChild(D.cardEl(c, { tag: 'div', static: true, eager: i === stack.length - 1 }));
      }
      col.appendChild(D.el('div', 'cb-stacklabel', `Market ${si + 1} · ${stack.length}`));
      col.addEventListener('click', () => onMarket(state, si));
      mrow.appendChild(col);
    });
    markets.appendChild(mrow);
    table.appendChild(markets);

    /* ---- the on-screen pad ---- */
    const padBox = D.el('section', 'panel');
    padBox.appendChild(D.el('h2', '', 'Style values'));
    const prow = D.el('div', 'cb-pad');
    for (const suit of C.SUITS) {
      const cell = D.el('div', 'cb-padcell');
      cell.appendChild(D.suitChip(suit));
      cell.appendChild(D.el('span', 'cb-padval', String(pad.values[suit])));
      prow.appendChild(cell);
    }
    padBox.appendChild(prow);
    const totals = D.el('div', 'cb-totals');
    for (let p = 0; p < 2; p++) {
      const own = C.SUITS.filter((s) => state.chips[p][s] > 0)
        .map((s) => `${state.chips[p][s]}×${s}`).join(', ') || 'no chips yet';
      const line = D.el('div', 'cb-total' + (act === p ? ' on' : ''));
      line.innerHTML = `Player ${p + 1} — <b>${pad.players[p]}</b> <span class="muted">(${own})</span>`;
      totals.appendChild(line);
    }
    padBox.appendChild(totals);
    table.appendChild(padBox);

    /* ---- piles and turn ---- */
    const info = D.el('div', 'cb-info');
    info.appendChild(D.el('div', 'cb-turn', `Turn ${state.moves + 1} · Player ${state.turn + 1} plays, invests, draws`));
    const piles = D.el('div', 'cb-piles');
    piles.appendChild(pileEl('draw pile', state.draw.length));
    piles.appendChild(pileEl('discard', state.discard.length));
    info.appendChild(piles);
    table.appendChild(info);

    /* ---- actions ---- */
    const actions = D.el('div', 'btnrow');
    if (!state.over && revealedFor === act) {
      if (state.phase === 'play') {
        const forced = !C.anyLegalPlay(state);
        if (forced) {
          actions.appendChild(D.el('div', 'cb-note',
            'Nothing fits any market — tap a card in your hand to discard it.'));
        } else if (selected) {
          actions.appendChild(D.el('div', 'cb-note',
            `Tap a lit market to add ${data.byId[D.baseId(selected)].name}.`));
          actions.appendChild(btn('Cancel', true, () => { selected = null; api.refresh(); }));
        } else {
          actions.appendChild(D.el('div', 'cb-note',
            'Tap a card to influence fashion, then tap a market.'));
        }
      } else if (state.phase === 'chip') {
        actions.appendChild(D.el('div', 'cb-note',
          `Player ${state.turn + 1}: take one chip of your choice.`));
      }
    }
    table.appendChild(actions);

    /* ---- the current hand ---- */
    if (state.over) {
      table.appendChild(handPanel('Player 1’s hand', state.hands[0], false));
      table.appendChild(handPanel('Player 2’s hand', state.hands[1], false));
    } else if (revealedFor === act) {
      table.appendChild(handPanel(`Player ${act + 1}’s hand`, state.hands[act], true));
    } else {
      table.appendChild(handPanel(`Player ${act + 1}’s hand`, null, false));
    }

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- chrome ---- */
    api.setSubtitle(state.over ? 'the bazaar closes' : `Player ${state.turn + 1} to play`);
    api.setStatus(statusText(state));

    /* ---- the hand-off ---- */
    if (!state.over && act != null && revealedFor !== act && !passShown) showPass(act, api);
  },

  endOf(state) {
    if (!state.over) return null;
    const pad = C.score(state);
    const w = state.winner;
    const suitLine = C.SUITS
      .map((s) => `${D.SUIT_NAME[s]} ${pad.values[s]}`).join(' · ');
    const chipsLine = [0, 1].map((p) => {
      const own = C.SUITS.filter((s) => state.chips[p][s] > 0)
        .map((s) => `${state.chips[p][s]}×${s}`).join(', ') || 'no chips';
      return `<p class="muted">Player ${p + 1}: ${pad.players[p]} (${own})</p>`;
    }).join('');
    return {
      title: w == null ? 'The bazaar ends in a draw' : `Player ${w + 1} wins the bazaar`,
      cls: 'win',
      score: Math.max(...pad.players),
      body: `<p>The last chip is taken and the cargo arrives. Style values:
             <br><span class="muted">${suitLine}</span></p>${chipsLine}` +
        (w == null ? '' : `<p><strong>Player ${w + 1} backed the most fashionable styles.</strong></p>`),
    };
  },

  record: (state) => ({ played: 1, win: null, score: Math.max(...C.score(state).players) }),
});

/* --------------------------------------------------------------- helpers */

function btn(label, enabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.disabled = !enabled;
  b.addEventListener('click', onClick);
  return b;
}

function pileEl(label, n) {
  const d = document.createElement('div');
  d.className = 'pile' + (n === 0 ? ' is-empty' : '');
  d.innerHTML = `<span class="n">${n}</span><small>${label}</small>`;
  return d;
}

function commit(fn) {
  try {
    const next = fn();
    api.pushHistory();
    api.setState(next);
    return true;
  } catch (e) {
    api.setStatus(e.message, true);
    return false;
  }
}

function onMarket(state, si) {
  if (state.over || state.phase !== 'play') return;
  if (revealedFor !== state.turn) return;
  if (!selected) {
    api.setStatus('Tap a card in your hand first, then the market it fits.', true);
    return;
  }
  const id = selected;
  if (commit(() => C.playCard(state, id, si))) selected = null;
}

function onHandTap(state, id) {
  if (state.over || revealedFor !== state.turn) return;
  if (state.phase === 'chip') {
    api.setStatus('Take a chip of your choice from the styles above.', true);
    return;
  }
  if (!C.anyLegalPlay(state)) {                    // forced discard
    commit(() => C.discardCard(state, id));
    return;
  }
  selected = selected === id ? null : id;
  api.refresh();
}

function handPanel(title, hand, interactive) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = title;
  if (hand) h.appendChild(D.el('span', 'count', `${hand.length} cards`));
  panel.appendChild(h);
  const row = document.createElement('div');
  row.className = 'cardrow';
  if (hand) {
    for (const id of hand) {
      row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
        cls: selected === id ? 'is-selected' : '',
        badge: selected === id ? '✓' : null,
        onPick: interactive ? (c) => onHandTap(api.state, c.id) : null,
      }));
    }
    if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards — nothing to draw.'));
  } else {
    row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
  }
  panel.appendChild(row);
  return panel;
}

function statusText(state) {
  if (state.over) return '<strong>The last chip is taken.</strong> Scores are tabulated above.';
  if (state.phase === 'chip') {
    return `Player ${state.turn + 1}: take one chip of your choice — then Player ` +
      `${2 - state.turn} plays.`;
  }
  if (revealedFor !== state.turn) return `Player ${state.turn + 1} to play.`;
  if (!C.anyLegalPlay(state)) {
    return `Player ${state.turn + 1}: no card fits any market — discard one.`;
  }
  return `Player ${state.turn + 1}: add a card to a market whose top shares a suit, ` +
    `then take a chip and draw.`;
}

function showPass(p, api) {
  passShown = true;
  passDevice(p + 1, () => {
    revealedFor = p;
    passShown = false;
    api.refresh();
  });
}

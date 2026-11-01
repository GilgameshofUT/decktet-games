/* Oh Quay — UI.  Two players, one device.  Canals are public; the only
   hidden cards are inside the docks, and the pass-the-device screen between
   turns keeps each player's blind dock draw a secret. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './oh-quay-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealed = false;      // is the current player's view on screen?
let passShown = false;
let passOverlay = null;    // the open hand-off screen, if any
let lastSeed = null;
let nextFirst = 0;         // the loser of the last game goes first next time

const api = mountGame({
  id: 'oh-quay',
  title: 'Oh Quay',
  subtitle: 'build rafts, empty your canal',
  rules: '../rules/oh-quay.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck, nextFirst),

  render(state, api) {
    if (state.seed !== lastSeed) {
      lastSeed = state.seed; revealed = false; passShown = false;
      if (passOverlay) { passOverlay.close(); passOverlay = null; }   // a new deal replaces the hand-off
    }
    if (state.over && !passShown) { passShown = true; nextFirst = 1 - (state.winner ?? state.finisher); }

    const seat = state.turn;
    const foe = 1 - seat;
    const table = document.createElement('div');
    table.className = 'oq-table';

    /* ---- score piles + whose turn ---- */
    const info = document.createElement('div');
    info.className = 'oq-info';
    info.innerHTML = `
      <div class="oq-scores">
        <span class="${!state.over && seat === 0 ? 'on' : ''}">Player 1 · <b>${state.scores[0].length}</b> pts</span>
        <span class="${!state.over && seat === 1 ? 'on' : ''}">Player 2 · <b>${state.scores[1].length}</b> pts</span>
      </div>
      <div class="oq-note">Rafts of 3+ score · the finisher also scores a point per raft left in the other canal</div>`;
    table.appendChild(info);

    /* ---- the opponent's canal (public) ---- */
    const theirs = panel(`Player ${foe + 1}'s canal`,
      `${state.canals[foe].length} card${state.canals[foe].length === 1 ? '' : 's'}`);
    canalRow(theirs.row, state.canals[foe], { small: true });
    table.appendChild(theirs.section);

    /* ---- the docks ---- */
    const docks = document.createElement('div');
    docks.className = 'oq-docks';
    docks.appendChild(dockEl(state, 'foe', foe));
    docks.appendChild(dockEl(state, 'own', seat));
    table.appendChild(docks);

    /* ---- your canal ---- */
    const minePanel = panel(`Player ${seat + 1}'s canal`,
      `${state.canals[seat].length} card${state.canals[seat].length === 1 ? '' : 's'}`);
    const row = minePanel.row;
    row.className = 'cardrow oq-canal';
    if (state.phase === 'insert' && revealed) {
      canalRow(row, state.canals[seat], { gaps: true, onGap: (pos) => doInsert(state, pos) });
    } else if (state.phase === 'launch' && revealed) {
      const n = C.maxRaft(state.canals[seat]);
      canalRow(row, state.canals[seat], {
        front: n,
        onCard: (i) => { if (i < n) doLaunch(state, i + 1); },
      });
    } else {
      canalRow(row, state.canals[seat], { small: state.over != null });
    }
    table.appendChild(minePanel.section);

    /* ---- the pending cargo ---- */
    if (state.phase === 'insert' && revealed) {
      const p = document.createElement('div');
      p.className = 'oq-pending';
      p.appendChild(D.cardEl(cardOf(state.pending), { tag: 'div', static: true, eager: true }));
      p.appendChild(D.el('div', 'oq-pending-note',
        'Tap a spot in your canal — front, between two barges, or the back.'));
      table.appendChild(p);
    }

    /* ---- actions ---- */
    const actions = document.createElement('div');
    actions.className = 'btnrow';
    if (!state.over && revealed) {
      if (state.phase === 'launch') {
        const n = C.maxRaft(state.canals[seat]);
        for (let k = 1; k <= n; k++) {
          const label = k === 1
            ? 'Launch 1 card → your dock'
            : `Launch raft of ${k}` + (k > 2 ? ` · ${k - 2} scored` : ' · no points');
          actions.appendChild(btn(label, k > 1 && k === n ? 'primary' : '', () => doLaunch(state, k)));
        }
      }
    }
    table.appendChild(actions);

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- status + subtitle ---- */
    api.setSubtitle(state.over
      ? 'the game is over'
      : `Player ${seat + 1} to ` + (state.phase === 'cargo' ? 'add cargo'
        : state.phase === 'insert' ? 'slot the card in' : 'launch a raft'));
    api.setStatus(statusText(state, seat));

    /* ---- the hand-off ---- */
    if (!state.over && !revealed && !passShown) showPass(seat, api);
  },

  endOf(state) {
    if (!state.over) return null;
    const [a, b] = state.points;
    const w = state.winner;
    return {
      title: w == null ? 'The game is a draw' : `Player ${w + 1} wins`,
      cls: 'win',
      body: `<p>Player ${state.finisher + 1} emptied their canal first.</p>` +
            `<p class="muted">Final — Player 1: ${a} · Player 2: ${b} ` +
            `(score pile, plus a point per raft left in the other canal for the finisher).</p>`,
    };
  },

  record: (state) => ({ played: state.over ? 1 : 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function cardOf(id) { return { ...data.byId[D.baseId(id)], id }; }

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
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

/** A dock: for the opponent, the top card is visible to you; for you, it is
 *  hidden — exactly the card you hold facing away.  During the cargo phase
 *  both are tappable. */
function dockEl(state, which, owner) {
  const dock = state.docks[owner];
  const wrap = document.createElement('div');
  wrap.className = 'oq-dock';
  const isOwn = which === 'own';
  const tappable = !state.over && revealed && state.phase === 'cargo' && C.canCargo(state, which);

  const pile = document.createElement('div');
  if (isOwn || !dock.length) {
    pile.className = 'pile' + (dock.length === 0 ? ' is-empty' : '');
    pile.innerHTML = `<span class="n">${dock.length}</span><small>${isOwn ? 'your dock' : 'their dock'}</small>`;
  } else {
    pile.className = 'oq-dockcard';
    pile.appendChild(D.cardEl(cardOf(dock[0]), { tag: 'div', static: true, eager: true }));
    const n = document.createElement('span');
    n.className = 'oq-dockcount';
    n.textContent = dock.length;
    pile.appendChild(n);
  }
  wrap.appendChild(pile);

  const label = document.createElement('div');
  label.className = 'oq-label';
  label.textContent = isOwn ? `your dock (hidden from you) · ${dock.length}`
    : `Player ${owner + 1}'s dock — top card visible · ${dock.length}`;
  wrap.appendChild(label);

  if (tappable) {
    wrap.setAttribute('role', 'button');
    wrap.tabIndex = 0;
    wrap.classList.add('is-tappable');
    const go = () => doCargo(state, which);
    wrap.addEventListener('click', go);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  }
  return wrap;
}

/** Cards in a canal; opts: { small, gaps, front, onGap, onCard } */
function canalRow(row, canal, opts = {}) {
  row.textContent = '';
  if (!canal.length) {
    row.appendChild(D.el('div', 'empty', 'Empty — this canal is clear!'));
    return;
  }
  const add = (i) => {
    if (opts.gaps) {
      const gap = document.createElement('div');
      gap.className = 'oq-gap';
      gap.setAttribute('role', 'button');
      gap.tabIndex = 0;
      gap.setAttribute('aria-label', `Insert here, position ${i}`);
      gap.addEventListener('click', () => opts.onGap(i));
      gap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onGap(i); }
      });
      row.appendChild(gap);
    }
    const interactive = !!opts.onCard && opts.front != null && i < opts.front;
    const el = D.cardEl(cardOf(canal[i]), {
      tag: interactive ? 'button' : 'div',
      static: !interactive,
      eager: true,
      cls: (opts.small ? 'oq-small' : '') + (interactive ? ' is-legal oq-front' : ''),
    });
    if (interactive) {
      el.addEventListener('click', () => opts.onCard(i));
      el.setAttribute('aria-label', `Launch ${i + 1} from the front`);
    }
    row.appendChild(el);
  };
  for (let i = 0; i < canal.length; i++) add(i);
  if (opts.gaps) {                                   // the back slot
    const gap = document.createElement('div');
    gap.className = 'oq-gap';
    gap.setAttribute('role', 'button');
    gap.tabIndex = 0;
    gap.setAttribute('aria-label', `Insert at the back, position ${canal.length}`);
    gap.addEventListener('click', () => opts.onGap(canal.length));
    row.appendChild(gap);
  }
}

function statusText(state, seat) {
  if (state.over) {
    return `<strong>Player ${state.finisher + 1} emptied their canal.</strong> ` +
      `Player 1 scored ${state.points[0]}, Player 2 scored ${state.points[1]}.`;
  }
  if (!revealed) return `Player ${seat + 1}, take the device and reveal your view.`;
  if (state.phase === 'cargo') {
    return `Player ${seat + 1}: take the front card of either dock — the one you can see ` +
      `(their dock) or the one you can't (yours).`;
  }
  if (state.phase === 'insert') {
    return `Player ${seat + 1}: put the ${data.byId[D.baseId(state.pending)].name.replace(/^the /, '')} ` +
      'somewhere in your canal — you may not re-arrange the rest.';
  }
  const n = C.maxRaft(state.canals[seat]);
  return `Player ${seat + 1}: launch from the front — 1 card, or up to ${n} ` +
    'same-suit cards in ascending order (gaps are fine).';
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

function doCargo(state, which) {
  if (!revealed || state.phase !== 'cargo') return;
  api.pushHistory();
  api.setState(C.cargo(state, which));
}

function doInsert(state, pos) {
  if (!revealed || state.phase !== 'insert') return;
  api.pushHistory();
  api.setState(C.insert(state, pos));
}

function doLaunch(state, k) {
  if (!revealed || state.phase !== 'launch') return;
  if (!C.canLaunch(state, k)) {
    D.toast('A raft must share one suit and run in ascending order from the front.');
    return;
  }
  revealed = false;
  passShown = false;
  api.pushHistory();
  api.setState(C.launch(state, k));
}

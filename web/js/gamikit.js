/* Shared game shell: page chrome, persistence, undo, end-of-game dialog.
 *
 * A game page is just:
 *
 *   <body>
 *     <main id="table"></main>
 *     <script type="module" src="../js/games/my-game.js"></script>
 *   </body>
 *
 * and its module does:
 *
 *   const api = mountGame({
 *     id: 'my-game',                 // save key + record key
 *     title: 'My Game', subtitle: 'one line',
 *     rules: '../rules/my-game.html',
 *     newGame: (seed) => makeState(seed),
 *     render: (state, api) => { ... draw into api.table ... },
 *     endOf: (state) => state.over ? { title, cls, score, body } : null,
 *   });
 */

import * as D from './decktet.js';

export { D };

export function mountGame(spec) {
  const {
    id, title, subtitle = '', rules,
    newGame, render, endOf = null,
    restore = null, canUndo = null,
    home = '../index.html',
    historyLimit = 60,
    record = null,              // (state, result) => patch for D.record
  } = spec;

  if (typeof newGame !== 'function' || typeof render !== 'function') {
    throw new Error('mountGame: newGame and render are required');
  }

  /* ------------------------------------------------------------ chrome */
  const header = document.createElement('header');
  header.className = 'topbar';
  header.innerHTML = `
    <a class="iconbtn" href="${home}" aria-label="Back to home">‹</a>
    <h1>${title}<span class="sub">${subtitle}</span></h1>
    <button class="iconbtn" id="undo" aria-label="Undo last move" disabled>↶ Undo</button>
    <a class="iconbtn" href="${rules}">Rules</a>
    <button class="iconbtn" id="new" aria-label="Start a new game">New</button>`;

  const status = document.createElement('div');
  status.className = 'status';
  status.id = 'status';
  status.setAttribute('role', 'status');

  const table = document.createElement('main');
  table.id = 'table';

  const body = document.body;
  body.insertBefore(header, body.firstChild);
  body.insertBefore(status, header.nextSibling);
  body.appendChild(table);
  document.title = title;

  const undoBtn = header.querySelector('#undo');
  const newBtn = header.querySelector('#new');

  /* -------------------------------------------------------- the state */
  let state = null;
  let history = [];
  let endShown = false;

  const api = {
    id, title, table, status, header,
    get state() { return state; },
    get history() { return history; },
    get over() { return !!state?.over; },
    setStatus(html, isError = false) { D.setStatus(status, html, isError); },
    setSubtitle(text) {
      const sub = header.querySelector('h1 .sub');
      if (sub) sub.textContent = text;
    },
    toast: D.toast,
    overlay: D.overlay,
    confirm: D.confirmBox,
    save, pushHistory, undo, newGame: startNew, refresh, end, records, setState,
  };

  function setState(next) {
    state = next;
    save();
    refresh();
  }

  function save() {
    D.saveGame(id, { state, history: history.slice(-historyLimit) });
  }

  function pushHistory() {
    history.push(structuredClone(state));
    if (history.length > historyLimit) history.shift();
  }

  function restoreGame() {
    const saved = D.loadGame(id);
    if (!saved || !saved.state) return false;
    if (restore && !restore(saved.state)) return false;
    state = saved.state;
    history = saved.history || [];
    return true;
  }

  function startNew(seed = D.newSeed()) {
    state = newGame(seed);
    history = [];
    endShown = false;
    save();
    refresh();
  }

  function refresh() {
    render(state, api);
    undoBtn.disabled = canUndo ? !canUndo(state) : history.length === 0;
    checkEnd();
  }

  function checkEnd() {
    if (!endOf || endShown || !state) return;
    const result = endOf(state);
    if (!result) return;
    endShown = true;
    api.end(result);
  }

  function end(result) {
    const actions = [
      { label: 'Review', onClick: () => { endShown = false; } },
      { label: 'New game', cls: 'primary', onClick: startNew },
      ...(result.actions || []),
    ];
    const bodyEl = document.createElement('div');
    if (result.body instanceof Node) bodyEl.appendChild(result.body);
    else if (result.body) bodyEl.innerHTML = result.body;
    if (result.score != null) {
      const s = document.createElement('div');
      s.className = 'scoreline';
      s.textContent = String(result.score);
      bodyEl.insertBefore(s, bodyEl.firstChild);
    }
    D.overlay({ title: result.title, titleCls: result.cls || '', body: bodyEl, actions });

    const patch = record
      ? record(state, result)
      : { win: /win|victory|prince|triumph/i.test(result.title || ''), score: result.score ?? null };
    D.record(id, patch);
  }

  function records() {
    return D.records(id);
  }

  /* -------------------------------------------------------- controls */
  undoBtn.addEventListener('click', () => {
    if (!history.length) return;
    state = history.pop();
    endShown = false;
    save();
    refresh();
    D.toast('Move undone.');
  });

  newBtn.addEventListener('click', async () => {
    if (state && !state.over && (state.moves || 0) > 0) {
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoBtn.click();
    }
  });

  /* ----------------------------------------------------------- boot */
  if (!restoreGame()) startNew();
  else refresh();

  D.registerSW();
  return api;
}

/* --------------------------------------------------------- helpers */

/** A labelled panel: <section class="panel"><h2>…</h2><div class="cardrow"> */
export function panel(heading, countEl = false) {
  const s = document.createElement('section');
  s.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = heading;
  s.appendChild(h);
  const row = document.createElement('div');
  row.className = 'cardrow';
  s.appendChild(row);
  if (countEl) h.appendChild(countEl);
  return { section: s, row, heading: h };
}

/** A face-down pile with a counter: { el, set(n, label) } */
export function pile(label) {
  const el = document.createElement('div');
  el.className = 'pile';
  el.innerHTML = `<span class="n">0</span><small>${label}</small>`;
  return {
    el,
    set(n) {
      el.querySelector('.n').textContent = n;
      el.classList.toggle('is-empty', n === 0);
    },
  };
}

/** Pass-and-play interstitial: "Player N, take the device". */
export function passDevice(player, onReady, { names = null } = {}) {
  const name = names ? names[player - 1] : `Player ${player}`;
  return D.overlay({
    title: `${name}'s turn`,
    body: `<p>Hands are hidden until you are ready. Pass the device, then reveal.</p>`,
    actions: [{ label: `Reveal ${name}'s hand`, cls: 'primary', onClick: onReady }],
    sticky: true,
  });
}

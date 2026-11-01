/* Decktet shared library: deck data, card UI, storage, small dialogs. */

export const BASE = new URL('../', import.meta.url);
export const url = (p) => new URL(p, BASE).href;

/* ---------------------------------------------------------------- deck data */

let DATA = null;

export async function loadDeck() {
  if (DATA) return DATA;
  const res = await fetch(url('cards/manifest.json'), { cache: 'no-cache' });
  if (!res.ok) throw new Error('cannot read cards/manifest.json');
  DATA = await res.json();
  DATA.byId = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
  DATA.rankOf = Object.fromEntries(DATA.cards.map((c) => [c.id, c.rank]));
  return DATA;
}

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const SUIT_NAME = {
  moons: 'Moons', suns: 'Suns', waves: 'Waves',
  leaves: 'Leaves', daemons: 'Daemons', crowns: 'Crowns',
};
export const SUIT_COLOR = {
  moons: '#c9ccd1', suns: '#f2933a', waves: '#6fb3e6',
  leaves: '#c2915f', daemons: '#5cc45e', crowns: '#efd94f',
};

/**
 * Rank as a comparable number: Ace 1 … 9, Crown 10.
 *
 * These are the values the rules score with (Adaman's eleven personalities
 * total 66 with Crowns at 10).  The sheet's extended-deck order is
 * Ace, 1…9, Pawn, Court, Crown — i.e. Pawns and Courts sit above the 9s and
 * below the Crown — which no game in this app needs to compare, so the two
 * conventions are not reconciled here; Court/Pawn are simply above Crown.
 */
export function rankValue(card) {
  if (card.rank === 'crown') return 10;
  if (card.rank === 'court') return 11;
  if (card.rank === 'pawn') return 12;
  if (card.rank == null) return 0;          // the Excuse
  return card.rank;
}

export function rankLabel(card) {
  if (card.rank === 'crown') return 'Crown';
  if (card.rank === 'court') return 'Court';
  if (card.rank === 'pawn') return 'Pawn';
  if (card.rank === 1) return 'Ace';
  if (card.rank == null) return '—';
  return String(card.rank);
}

/* --------------------------------------------------------------- card DOM */

/** Strip a two-deck instance suffix: "the-author#2" → "the-author". */
export const baseId = (id) => String(id).split('#')[0];

/** Strip a two-deck instance suffix: "the-author#2" → "the-author". */
export const cardUrl = (id, kind = 'web') => {
  const b = baseId(id);
  return kind === 'png' ? url(`cards/${b}.png`) : url(`cards/${kind}/${b}.webp`);
};

/**
 * Build a card element.
 * opts: { selected, legal, dim, faceDown, badge, onPick, cls }
 */
export function cardEl(card, opts = {}) {
  const el = document.createElement(opts.tag || 'button');
  el.type = 'button';
  el.className = 'card' + (opts.cls ? ' ' + opts.cls : '');
  el.dataset.id = card.id;
  el.setAttribute('aria-label', describe(card));
  if (opts.selected) el.classList.add('is-selected');
  if (opts.legal) el.classList.add('is-legal');
  if (opts.dim) el.classList.add('is-dim');
  if (opts.static) el.classList.add('is-static');
  if (opts.faceDown) el.classList.add('is-face-down');
  if (opts.disabled) el.disabled = true;

  const img = document.createElement('img');
  img.src = cardUrl(card.id, 'web');
  img.width = 750;
  img.height = 1050;
  img.alt = '';
  img.loading = opts.eager ? 'eager' : 'lazy';
  img.decoding = 'async';
  el.appendChild(img);

  if (opts.badge) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = opts.badge;
    el.appendChild(b);
  }
  if (opts.onPick) el.addEventListener('click', () => opts.onPick(card, el));
  return el;
}

export function describe(card) {
  const suits = card.suits.map((s) => SUIT_NAME[s]).join(' and ');
  if (card.rank == null) return 'the Excuse';
  if (!card.suits.length) return card.name;
  if (card.rank === 'crown') return `Crown of ${suits}`;
  if (card.rank === 'court') return `Court of ${suits}`;
  if (card.rank === 'pawn') return `Pawn of ${suits}`;
  if (card.rank === 1) return `Ace of ${suits}`;
  return `${card.rank} of ${suits}`;
}

export function suitChip(suit) {
  const img = document.createElement('img');
  img.className = 'suit-inline';
  img.src = url(`cards/icons/suits/${suit}.png`);
  img.alt = SUIT_NAME[suit];
  img.width = 115;
  img.height = 114;
  return img;
}

/** Fill a container with card elements. items = [{id}] or card objects. */
export function renderCards(container, items, opts = {}) {
  const data = DATA;
  container.textContent = '';
  for (const item of items) {
    // a two-deck game passes instance ids like "the-author#2"
    const card = typeof item === 'string'
      ? (data.byId[baseId(item)] ? { ...data.byId[baseId(item)], id: item } : null)
      : item;
    if (!card) continue;
    const o = typeof opts === 'function' ? opts(item, card) : opts;
    container.appendChild(cardEl(card, o));
  }
  if (!items.length) {
    const cfg = typeof opts === 'function' ? opts(null, null) : opts;
    if (cfg && cfg.emptyText) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = cfg.emptyText;
      container.appendChild(p);
    }
  }
  return container;
}

/* ------------------------------------------------------------ shuffle / rng */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The ids of a deck: 'basic' (36), 'extended' (9), 'all' (45). */
export function deckIds(kind = 'basic') {
  if (kind === 'basic') return DATA.basicDeck.slice();
  if (kind === 'extended') return DATA.extendedDeck.slice();
  return DATA.cards.map((c) => c.id);
}

/* ------------------------------------------------------------ status / toast */

let toastTimer = null;
export function toast(message, ms = 2200) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), ms);
}

export function setStatus(el, html, isError = false) {
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle('is-error', !!isError);
}

/* --------------------------------------------------------------- dialogues */

export function overlay({ title, titleCls = '', body = '', actions = [] }) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  const dlg = document.createElement('div');
  dlg.className = 'dialog';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');

  const h = document.createElement('h3');
  h.className = titleCls;
  h.textContent = title;
  dlg.appendChild(h);

  if (body instanceof Node) dlg.appendChild(body);
  else if (body) {
    const p = document.createElement('p');
    p.innerHTML = body;
    dlg.appendChild(p);
  }

  const row = document.createElement('div');
  row.className = 'btnrow';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (a.cls || '');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      if (a.keepOpen !== true) close();
      a.onClick && a.onClick();
    });
    row.appendChild(b);
  }
  dlg.appendChild(row);
  wrap.appendChild(dlg);
  document.body.appendChild(wrap);

  function close() {
    wrap.remove();
  }
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap && !actions.some((a) => a.sticky)) close();
  });
  return { close, el: wrap, dialog: dlg };
}

export function confirmBox({ title, message, okLabel = 'Yes', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const o = overlay({
      title,
      body: message,
      actions: [
        { label: cancelLabel, onClick: () => { if (!done) { done = true; resolve(false); } } },
        { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => { if (!done) { done = true; resolve(true); } } },
      ],
    });
    o.el.addEventListener('click', (e) => {
      if (e.target === o.el && !done) { done = true; resolve(false); o.close(); }
    });
  });
}

/* ------------------------------------------------------- settings / saves */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('decktet.' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('decktet.' + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
  del(key) {
    try { localStorage.removeItem('decktet.' + key); } catch { /* ignore */ }
  },
};

export const getSetting = (k, fb) => store.get('setting.' + k, fb);
export const setSetting = (k, v) => store.set('setting.' + k, v);

export const saveGame = (game, state) => store.set('save.' + game, state);
export const loadGame = (game, fb) => store.get('save.' + game, fb);
export const clearGame = (game) => store.del('save.' + game);

export function records(game) {
  return store.get('records.' + game, { played: 0, won: 0, best: null, last: null });
}

export function record(game, { win = null, score = null, played = 1 } = {}) {
  const r = records(game);
  r.played = (r.played || 0) + played;
  if (win === true) r.won = (r.won || 0) + 1;
  if (score != null) r.best = r.best == null ? score : Math.max(r.best, score);
  r.last = { win, score, at: Date.now() };
  store.set('records.' + game, r);
  return r;
}

/* ------------------------------------------------------------------- misc */

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function on(id, ev, fn) {
  const e = document.getElementById(id);
  if (e) e.addEventListener(ev, fn);
  return e;
}

/** Wire the service worker + "install" button if the page has one. */
export async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(url('sw.js'), { scope: url('') });
  } catch (err) {
    console.warn('service worker not registered', err);
  }
}

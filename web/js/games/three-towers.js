/* Three Towers — UI.  The rules live in three-towers-core.js. */

import { mountGame, D, pile as pileEl } from '../gamikit.js';
import * as C from './three-towers-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const describe = (id) => D.describe(data.byId[D.baseId(id)]);
const setting = (k, fb) => D.getSetting(`three-towers.${k}`, fb);

let selected = null;          // 'deck' | 0 … 4 — the card being held
let note = '';                // what just happened, shown in the status line

const api = mountGame({
  id: 'three-towers',
  title: 'Three Towers',
  subtitle: 'three descending towers, suit matching all the way down',
  rules: '../rules/three-towers.html',
  newGame: (seed) => {
    selected = null;
    note = '';
    return C.newGame(seed, data.basicDeck, {
      level: setting('level', 9),
      ivory: setting('ivory', false),
    });
  },
  restore: (s) => s && Array.isArray(s.spaces) && s.spaces.length === C.SPACES
    && typeof s.level === 'number',

  render(state, api) {
    if (selected != null && !C.cardOf(state, selected)) selected = null;
    const picking = state.ivoryMode && !state.ivory;
    const legal = new Set((selected == null || picking) ? [] : C.destinations(state, selected));

    const board = document.createElement('div');
    board.className = 'tt-board';

    board.appendChild(toolbar(state));

    if (picking) board.appendChild(suitPicker());

    /* --- the five tower spaces -------------------------------------- */
    const row = document.createElement('div');
    row.className = 'tt-spaces';
    state.spaces.forEach((space, i) => {
      const s = document.createElement('div');
      s.className = 'tt-slot';
      s.setAttribute('role', 'button');
      s.tabIndex = 0;
      s.setAttribute('aria-label', space.length
        ? `Space ${i + 1}: ${space.length} card${space.length === 1 ? '' : 's'}, top ${describe(C.topOf(space))}`
        : `Space ${i + 1}: empty`);
      s.appendChild(fanEl(space));
      if (!space.length) s.appendChild(emptyMark('empty'));

      if (!picking) {
        if (selected != null) {
          if (legal.has(i)) s.classList.add('is-legal');
          else if (selected !== i) s.classList.add('is-dim');
        }
        if (selected === i) s.classList.add('is-held');
        s.addEventListener('click', () => onSpace(state, i, legal, picking));
      } else {
        s.classList.add('is-dim');
      }
      row.appendChild(s);
    });
    board.appendChild(row);

    /* --- the deck --------------------------------------------------- */
    const deckRow = document.createElement('div');
    deckRow.className = 'tt-deck';
    const dp = pileEl('deck');
    dp.set(state.deck.length);
    deckRow.appendChild(dp.el);

    if (state.up) {
      const picked = D.cardEl({ ...data.byId[D.baseId(state.up)], id: state.up }, {
        tag: 'div',
        static: true,
        eager: true,
        selected: selected === 'deck',
        legal: [...legal].length > 0,
      });
      picked.addEventListener('click', () => {
        if (state.over || picking) return;
        selected = selected === 'deck' ? null : 'deck';
        note = '';
        api.refresh();
      });
      deckRow.appendChild(picked);
    } else {
      const spent = document.createElement('div');
      spent.className = 'tt-spent';
      spent.textContent = 'deck empty';
      deckRow.appendChild(spent);
    }

    const stuck = !picking && !state.over && (state.up == null || !C.destinations(state, 'deck').length);
    const quit = !picking && !state.over;
    if (quit) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small tt-giveup';
      button.textContent = 'Give up';
      button.addEventListener('click', async () => {
        const ok = await api.confirm({
          title: 'Give up?',
          message: 'The game ends now and is recorded as a loss.',
          okLabel: 'Give up',
          danger: true,
        });
        if (!ok) return;
        note = 'You gave up.';
        selected = null;
        api.pushHistory();
        api.setState(C.abandon(api.state));
      });
      deckRow.appendChild(button);
    }
    board.appendChild(deckRow);

    /* --- chrome ------------------------------------------------------ */
    api.table.textContent = '';
    api.table.appendChild(board);

    const hint = document.createElement('p');
    hint.className = 'tt-hint';
    hint.innerHTML = picking
      ? 'Pick the suit one of your towers will hold entirely — the Ivory variant.'
      : state.over
        ? ''
        : stuck
          ? 'The deck card fits in no space. Move tower tops around to make a gap — or give up.'
          : selected == null
            ? 'Tap the deck card — or the top card of a space — to pick it up, then tap a space to place it. Lower rank, shared suit.'
            : 'A card stacks on a space when it is lower than that space’s top card and shares a suit with it. Empty spaces take anything.';
    api.table.appendChild(hint);

    api.setStatus(
      `<strong>Moves ${state.moves}</strong>` +
      ` · deck <strong>${state.deck.length + (state.up ? 1 : 0)}</strong>` +
      ` · towers <strong>${C.towersBuilt(state)}/3</strong>` +
      ` · level <strong>${state.level}</strong>` +
      (state.ivoryMode ? ` · ivory: <strong>${state.ivory ? D.SUIT_NAME[state.ivory] : '—'}</strong>` : '') +
      (note ? ` · ${note}` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    const built = C.towersBuilt(state);
    return {
      title: o.title,
      cls: o.cls,
      score: built,
      body: `<p>${o.text}</p>` +
        `<p class="muted">${built} complete tower${built === 1 ? '' : 's'} at level ` +
        `${state.level} in ${state.moves} moves.` +
        (state.ivoryMode && state.ivory ? ` One of them is all ${D.SUIT_NAME[state.ivory]}.` : '') +
        '</p>',
    };
  },

  record: (state) => ({ win: state.over === 'won', score: C.towersBuilt(state) }),
});

/* ------------------------------------------------------------- helpers */

/** Level buttons and the Ivory-variant switch. */
function toolbar(state) {
  const bar = document.createElement('div');
  bar.className = 'tt-bar';

  const levels = document.createElement('div');
  levels.className = 'tt-levels';
  for (const n of C.LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = String(n);
    b.setAttribute('aria-pressed', String(n === state.level));
    b.setAttribute('aria-label', `Difficulty level ${n}`);
    b.addEventListener('click', () => {
      if (n === state.level) return;
      restartWith(`level ${n}`, () => D.setSetting('three-towers.level', n));
    });
    levels.appendChild(b);
  }
  const label = document.createElement('span');
  label.className = 'tt-barlabel';
  label.textContent = 'Level';
  bar.appendChild(label);
  bar.appendChild(levels);

  const sw = document.createElement('label');
  sw.className = 'tt-ivory';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'tt-switch';
  box.checked = !!state.ivoryMode;
  box.setAttribute('aria-label', 'Ivory variant');
  box.addEventListener('change', () => {
    const on = box.checked;
    restartWith(on ? 'Ivory variant' : 'level play', () => D.setSetting('three-towers.ivory', on));
  });
  sw.appendChild(box);
  sw.appendChild(document.createTextNode('Ivory variant'));
  bar.appendChild(sw);

  return bar;
}

/** The suit picker of the Ivory Three Towers variant. */
function suitPicker() {
  const box = document.createElement('div');
  box.className = 'tt-picker';
  const head = document.createElement('p');
  head.className = 'tt-pickerhead';
  head.textContent = 'Ivory Three Towers: choose the suit one tower must hold entirely.';
  box.appendChild(head);
  const row = document.createElement('div');
  row.className = 'tt-pickrow';
  for (const suit of D.SUITS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.appendChild(D.suitChip(suit));
    b.appendChild(document.createTextNode(D.SUIT_NAME[suit]));
    b.addEventListener('click', () => {
      const next = C.chooseSuit(api.state, suit);
      note = `The ivory tower will be ${D.SUIT_NAME[suit]}.`;
      selected = null;
      api.pushHistory();
      api.setState(next);
    });
    row.appendChild(b);
  }
  box.appendChild(row);
  return box;
}

async function restartWith(what, change) {
  if (api.state && !api.state.over && api.state.moves > 0) {
    const ok = await api.confirm({
      title: 'Start a new game?',
      message: `Changing to ${what} starts a new deal and discards this game.`,
      okLabel: 'New game',
      danger: true,
    });
    if (!ok) return;
  }
  change();
  selected = null;
  note = '';
  api.newGame();
}

function emptyMark(text) {
  const e = document.createElement('span');
  e.className = 'tt-empty';
  e.textContent = text;
  return e;
}

/** A tower: every card but the last shows a thin strip of its top edge, the
 *  last one — the playable top card — face up in full. */
function fanEl(ids) {
  const fan = document.createElement('div');
  fan.className = 'tt-fan';
  ids.forEach((id, k) => {
    if (k === ids.length - 1) {
      fan.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
        tag: 'div', static: true, eager: true,
      }));
    } else {
      const strip = document.createElement('div');
      strip.className = 'tt-strip';
      const img = document.createElement('img');
      img.src = D.cardUrl(id, 'web');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      strip.appendChild(img);
      fan.appendChild(strip);
    }
  });
  return fan;
}

/** Tapping a space: place the held card there, or pick that space's top card. */
function onSpace(state, i, legal, picking) {
  if (state.over || picking) return;
  if (selected != null && selected !== i) {
    if (legal.has(i)) {
      const src = selected;
      const held = C.cardOf(state, src);
      const next = C.applyMove(state, { src, dest: i });
      note = `${describe(held)} → space ${i + 1}.`;
      selected = null;
      api.pushHistory();
      api.setState(next);
      return;
    }
    if (selected !== 'deck') {
      api.toast(whyNot(state, selected, i));
      return;
    }
  }
  if (!state.spaces[i].length) {
    api.toast('That space is empty — any card may start a tower there.');
    return;
  }
  selected = selected === i ? null : i;
  note = '';
  api.refresh();
}

function whyNot(state, src, dest) {
  const id = C.cardOf(state, src);
  const top = C.topOf(state.spaces[dest]);
  if (!top) return 'Any card may be placed on an empty space.';
  if (C.rankOf(id) >= C.rankOf(top)) {
    return `A tower descends: ${describe(top)} needs something lower beneath it.`;
  }
  return `${describe(id)} and ${describe(top)} share no suit.`;
}

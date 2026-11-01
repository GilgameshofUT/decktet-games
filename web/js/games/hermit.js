/* Hermit — UI.  Two players, one device: the hand is hidden behind the
   pass-the-device screen between turns.  The rules live in hermit-core.js.

   Several tricks are in progress at once: tap a card, then (if it fits more
   than one trick) tap the trick to play it on.  In the Cottage / start phases
   each player picks one card behind the pass screen. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './hermit-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealed = null;      // { state, player } — whose hand is on screen
let staged = null;        // { state, id } — a card chosen, waiting for a trick

const api = mountGame({
  id: 'hermit',
  title: 'Hermit',
  subtitle: 'avoid the tricks with personalities',
  rules: '../rules/hermit.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (staged && staged.state !== state) staged = null;
    const actor = actorOf(state);
    const showing = !!state.over ||
      (!!revealed && revealed.state === state && revealed.player === actor);

    const table = document.createElement('div');
    table.className = 'hm-table';

    /* ---- score pad ---- */
    const top = document.createElement('div');
    top.className = 'hm-top';
    top.appendChild(scoreChip(state, 0));
    const mid = document.createElement('div');
    mid.className = 'hm-mid';
    mid.innerHTML = `<span class="hm-hand">Hand ${state.handNo} of ${C.HANDS}</span>`
      + `<span class="hm-cottage">Cottage · <b>${state.cottage.length}</b> face down</span>`;
    top.appendChild(mid);
    top.appendChild(scoreChip(state, 1));
    table.appendChild(top);

    /* ---- the tricks in progress (or the last one taken) ---- */
    const tricks = document.createElement('div');
    tricks.className = 'hm-tricks';
    const list = state.tricks.length
      ? state.tricks.map((tr, i) => ({ tr, i }))
      : (state.lastTrick ? [{ tr: { plays: state.lastTrick.plays, control: state.lastTrick.winner }, i: -1 }] : []);
    if (!list.length) {
      tricks.appendChild(D.el('div', 'hm-empty',
        state.over ? 'The match is over.' : 'Pick a card to start the first trick.'));
    }
    for (const { tr, i } of list) {
      const eligible = i >= 0 && staged && staged.state === state &&
        C.followsTricks(state, staged.id).includes(i);
      const box = document.createElement(eligible ? 'button' : 'div');
      box.type = 'button';
      box.className = 'hm-trick' + (eligible ? ' is-target' : '') +
        (i < 0 ? ' is-past' : '');
      box.dataset.who = String(tr.control);

      const cards = document.createElement('div');
      cards.className = 'hm-cards';
      tr.plays.forEach((p, k) => {
        cards.appendChild(D.cardEl({ ...data.byId[D.baseId(p.id)], id: p.id }, {
          tag: 'div', static: true, eager: k === 0, cls: 'hm-card', badge: String(k + 1),
        }));
      });
      box.appendChild(cards);
      box.appendChild(D.el('div', 'hm-tlabel',
        `${i < 0 ? 'Last trick — to Player ' + (tr.control + 1) : `Player ${tr.control + 1} controls`}`
        + ` · ${tr.plays.length}/${C.TRICK_SIZE}`));
      if (eligible) box.addEventListener('click', () => onTrick(state, i));
      tricks.appendChild(box);
    }
    table.appendChild(tricks);

    const note = document.createElement('div');
    note.className = 'hm-note';
    note.textContent = noteText(state, showing);
    table.appendChild(note);

    /* ---- the hand (or the revealed Cottage at the end) ---- */
    const panel = document.createElement('section');
    panel.className = 'panel';
    const h = document.createElement('h2');
    if (state.over) {
      h.innerHTML = `The Cottage<span class="count">${state.cottage.length} cards</span>`;
    } else {
      const who = picker(state);
      const what = state.phase === 'cottage' ? 'adds to the Cottage'
        : state.phase === 'start' ? 'starts a trick' : "'s hand";
      h.innerHTML = `Player ${who + 1} ${what}`
        + `<span class="count">${(state.hands[who] || []).length} cards</span>`;
    }
    panel.appendChild(h);

    const row = document.createElement('div');
    row.className = 'cardrow';
    if (state.over) {
      for (const id of state.cottage) {
        row.appendChild(cardFor(id, { cls: 'is-static', disabled: true }));
      }
      if (!state.cottage.length) row.appendChild(D.el('div', 'empty', 'No cards.'));
    } else if (showing) {
      const who = picker(state);
      const hand = state.hands[who] || [];
      const legal = new Set(state.over ? [] : C.legalPlays(state));
      for (const id of hand) {
        const ok = legal.has(id);
        row.appendChild(cardFor(id, {
          cls: (ok ? 'is-legal' : 'is-dim') + (staged && staged.id === id ? ' is-selected' : ''),
          onPick: (c) => onTap(state, c.id),
          disabled: state.over,
        }));
      }
      if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards left.'));
    } else {
      row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
    }
    panel.appendChild(row);
    table.appendChild(panel);

    /* ---- hand summary ---- */
    if (state.lastHand) {
      const lh = state.lastHand;
      const sum = document.createElement('p');
      sum.className = 'hm-sum';
      sum.innerHTML = `<b>Hand ${lh.handNo}:</b> Player 1 took ${lh.tricks[0]}, `
        + `Player 2 took ${lh.tricks[1]} — ${lh.points[0]} to ${lh.points[1]} points. `
        + (lh.cottageTo == null
          ? 'Equal tricks: the Cottage was discarded.'
          : `The Cottage (${lh.cottagePts}) went to Player ${lh.cottageTo + 1}.`);
      table.appendChild(sum);
    }

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- status + subtitle ---- */
    api.setSubtitle(state.over ? 'the match is over' : subtitleFor(state));
    api.setStatus(statusText(state, showing));

    /* ---- the hand-off ---- */
    if (!state.over && !showing) {
      passDevice(actor + 1, () => {
        revealed = { state: api.state, player: actor };
        api.refresh();
      });
    }
  },

  endOf(state) {
    if (!state.over) return null;
    const w = state.winner;
    const lh = state.lastHand;
    return {
      title: w == null ? 'The match is a draw' : `Player ${w + 1} wins the match`,
      cls: 'win',
      body: `<p>Four hands — each player deals twice. The lowest score wins.</p>
             <p class="muted">Final: Player 1 — ${state.total[0]} · Player 2 — ${state.total[1]}</p>
             ${lh ? `<p class="muted">Last hand: ${lh.points[0]} to ${lh.points[1]} — `
        + (lh.cottageTo == null ? 'Cottage discarded.'
          : `Cottage (${lh.cottagePts}) to Player ${lh.cottageTo + 1}.`) + '</p>' : ''}`,
    };
  },

  record: (state) => ({ played: state.over ? 1 : 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function cardFor(id, opts) {
  const base = data.byId[D.baseId(id)];
  return D.cardEl(base ? { ...base, id } : { id, name: id, suits: [], rank: 2 }, opts);
}

function actorOf(state) {
  if (state.over) return 0;
  if (state.phase === 'cottage' || state.phase === 'start') return state.pick;
  return state.turn;
}

/** Whose hand is on screen: the picker during the pick phases, else the player. */
function picker(state) {
  return actorOf(state) == null ? state.turn : actorOf(state);
}

function scoreChip(state, p) {
  const el = D.el('span', 'hm-score');
  const on = !state.over && actorOf(state) === p;
  el.classList.toggle('on', on);
  el.innerHTML = `Player ${p + 1} · tricks <b>${state.tricksWon[p]}</b>`
    + ` · points <b>${C.pointsOf(state.piles[p])}</b>`;
  return el;
}

function subtitleFor(state) {
  if (state.phase === 'cottage' && state.pick != null) return `Player ${state.pick + 1} adds to the Cottage`;
  if (state.phase === 'start' && state.pick != null) return `Player ${state.pick + 1} starts a trick`;
  return `Player ${state.turn + 1} to play`;
}

function noteText(state, showing) {
  if (state.over) return 'Lowest score wins — the Cottage stayed face down until now.';
  if (state.phase === 'cottage') {
    return 'The table is clear: each player secretly adds one card to the Cottage, '
      + 'then starts new tricks.';
  }
  if (state.phase === 'start') return 'Pick a card face up — both are revealed together.';
  if (staged && staged.state === state) {
    return `Playing ${data.byId[D.baseId(staged.id)].name} — tap which trick it goes on.`;
  }
  const name = `Player ${state.turn + 1}`;
  const hand = state.hands[state.turn];
  const fitting = C.legalPlays(state);
  if (fitting.length < hand.length) {
    return `${name} must follow suit — only ${fitting.length} of ${hand.length} cards fit a trick.`;
  }
  if (!state.tricks.some((tr) => {
    const last = tr.plays[tr.plays.length - 1];
    return hand.some((id) => last && C.shareSuit(id, last.id));
  })) {
    return `${name} is void in every trick in progress — start a new one with any card.`;
  }
  return `${name}: tap a card to add it to a trick. Avoid Personality cards — `
    + `they score their rank against whoever takes them.`;
}

function statusText(state, showing) {
  if (state.over) {
    return '<strong>The match is over.</strong> '
      + `Player 1 — ${state.total[0]} · Player 2 — ${state.total[1]}. Start a new game when ready.`;
  }
  if (state.phase === 'cottage' && state.pick != null) {
    return `<strong>Player ${state.pick + 1}:</strong> pick one card to add to the Cottage — `
      + 'it stays face down and is scored for whoever took fewer tricks.';
  }
  if (state.phase === 'start' && state.pick != null) {
    return `<strong>Player ${state.pick + 1}:</strong> pick one card to start a trick. `
      + 'Both choices are revealed once they are made.';
  }
  const name = `Player ${state.turn + 1}`;
  if (!showing) return `<strong>${name}:</strong> pass the device and reveal their hand.`;
  if (staged && staged.state === state) {
    return `<strong>${name}:</strong> now tap the trick to play `
      + `${data.byId[D.baseId(staged.id)].name} on (or tap the card again to cancel).`;
  }
  const legal = C.legalPlays(state);
  const hand = state.hands[state.turn];
  if (legal.length < hand.length) {
    return `<strong>${name}:</strong> you must follow suit — `
      + `${legal.length} card${legal.length === 1 ? '' : 's'} fit${legal.length === 1 ? 's' : ''} `
      + 'a trick in progress. Tap one.';
  }
  return `<strong>${name}:</strong> tap a card to play it. `
    + 'Personality cards you take score against you.';
}

function onTap(state, id) {
  if (state.over || !currentlyShowing(state)) return;

  if (state.phase === 'cottage' || state.phase === 'start') {
    const why = C.explainPick(state, id);
    if (why) { api.setStatus(why, true); D.toast(why); return; }
    const next = C.pickCard(state, id);
    handOff(next);
    api.pushHistory();
    api.setState(next);
    return;
  }

  const why = C.explainPlay(state, id, undefined);
  if (why) { api.setStatus(why, true); D.toast(why); return; }
  const fits = C.followsTricks(state, id);
  if (!fits.length) return commit(state, id, null);
  if (fits.length === 1) return commit(state, id, fits[0]);
  staged = staged && staged.state === state && staged.id === id ? null : { state, id };
  api.refresh();
}

function onTrick(state, i) {
  if (!staged || staged.state !== state || state.over || !currentlyShowing(state)) return;
  const fits = C.followsTricks(state, staged.id);
  if (!fits.includes(i)) {
    const msg = `${data.byId[D.baseId(staged.id)].name} does not share a suit with the last card `
      + 'on that trick.';
    api.setStatus(msg, true);
    D.toast(msg);
    return;
  }
  commit(state, staged.id, i);
}

function commit(state, id, target) {
  const why = C.explainPlay(state, id, target);
  if (why) { api.setStatus(why, true); D.toast(why); return; }
  staged = null;
  const next = C.playCard(state, id, target);
  handOff(next);
  api.pushHistory();
  api.setState(next);
}

/** Keep the hand on screen only when the same player still has the move. */
function handOff(next) {
  const actor = actorOf(next);
  revealed = revealed && revealed.player === actor ? { state: next, player: actor } : null;
}

function currentlyShowing(state) {
  if (state.over) return true;
  const actor = actorOf(state);
  return !!revealed && revealed.state === state && revealed.player === actor;
}

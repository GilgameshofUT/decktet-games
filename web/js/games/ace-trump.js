/* Ace Trump — UI.  Two players, one device: the hand is hidden behind the
   pass-the-device screen between turns.  The rules live in ace-trump-core.js. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './ace-trump-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealedState = null;    // the state object whose hand is on screen

const api = mountGame({
  id: 'ace-trump',
  title: 'Ace Trump',
  subtitle: 'trick-taking with shifting trumps',
  rules: '../rules/ace-trump.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    const table = document.createElement('div');
    table.className = 'at-table';

    /* ---- score pad + trump ---- */
    const top = document.createElement('div');
    top.className = 'at-top';
    top.appendChild(scoreChip(state, 0));
    const trump = document.createElement('div');
    trump.className = 'at-trump';
    if (state.trump != null) {
      const chip = D.suitChip(state.trump);
      chip.className = 'suit-inline at-trumpsuit';
      trump.appendChild(chip);
    }
    trump.appendChild(D.el('span', null, C.trumpText(state)));
    top.appendChild(trump);
    top.appendChild(scoreChip(state, 1));
    table.appendChild(top);

    /* ---- the trick ---- */
    const plays = state.trick.length
      ? state.trick
      : (state.lastTrick ? state.lastTrick.plays : []);
    const trick = document.createElement('div');
    trick.className = 'at-trick';
    for (let p = 0; p < 2; p++) {
      const slot = document.createElement('div');
      slot.className = 'at-slot';
      const play = plays.find((pl) => pl.player === p);
      if (play) {
        const won = state.trick.length === 0 && state.lastTrick && state.lastTrick.winner === p;
        slot.appendChild(D.cardEl({ ...data.byId[D.baseId(play.id)], id: play.id }, {
          tag: 'div', static: true, eager: true,
          cls: won ? 'is-winner' : '',
          badge: won ? 'trick' : null,
        }));
        slot.appendChild(D.el('div', 'at-slotlabel',
          `Player ${p + 1} ${state.trick.length ? 'led' : (won ? 'took it' : 'played')}`));
      } else {
        slot.appendChild(D.el('div', 'at-blank', '—'));
        slot.appendChild(D.el('div', 'at-slotlabel', `Player ${p + 1}`));
      }
    }
    table.appendChild(trick);
    const note = document.createElement('div');
    note.className = 'at-note';
    if (state.trick.length) {
      const leader = state.trick[0].player + 1;
      note.textContent = `Player ${leader} led — Player ${2 - state.trick[0].player} is choosing a card.`;
    } else if (state.lastTrick) {
      const t = C.trumpText(state);
      note.textContent = `Trick to Player ${state.lastTrick.winner + 1}. ${t[0].toUpperCase()}${t.slice(1)}.`;
    } else {
      note.textContent = 'The first trick: lead any card.';
    }
    table.appendChild(note);
    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- the current hand ---- */
    const panel = document.createElement('section');
    panel.className = 'panel';
    const h = document.createElement('h2');
    const who = state.over ? 'Hands' : `Player ${state.turn + 1}'s hand`;
    h.innerHTML = `${who}<span class="count">${state.hands[state.turn].length} cards</span>`;
    panel.appendChild(h);

    const row = document.createElement('div');
    row.className = 'cardrow';
    if (revealedState === state || state.over) {
      const hand = state.hands[state.turn];
      const legal = new Set(state.over ? [] : C.legalPlays(state));
      for (const id of hand) {
        const ok = legal.has(id);
        row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
          cls: ok ? 'is-legal' : 'is-dim',
          onPick: (c) => onPlay(state, c.id),
          disabled: state.over,
        }));
      }
      if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards.'));
    } else {
      row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
    }
    panel.appendChild(row);
    table.appendChild(panel);

    /* ---- hand summary ---- */
    if (state.lastHand) {
      const sum = document.createElement('p');
      sum.className = 'at-sum';
      sum.innerHTML = `Hand ${state.lastHand.handNo}: Player 1 took <b>${state.lastHand.tricks[0]}</b>, `
        + `Player 2 took <b>${state.lastHand.tricks[1]}</b>. `
        + `Hand ${state.handNo} of ${C.HANDS} — set aside ${state.setAside.length} cards.`;
      table.appendChild(sum);
    }
    api.table.appendChild(table);

    /* ---- status + subtitle ---- */
    api.setSubtitle(state.over
      ? 'the match is over'
      : `Player ${state.turn + 1} to play · ${C.trumpText(state)}`);
    api.setStatus(statusText(state));

    /* ---- the hand-off ---- */
    if (!state.over && revealedState !== state) {
      passDevice(state.turn + 1, () => {
        revealedState = api.state;
        api.refresh();
      });
    }
  },

  endOf(state) {
    if (!state.over) return null;
    const w = state.winner;
    return {
      title: w == null ? 'The match is a draw' : `Player ${w + 1} wins the match`,
      cls: 'win',
      body: `<p>Five hands of nine tricks — one point per trick.</p>
             <p class="muted">Final: Player 1 — ${state.total[0]} · Player 2 — ${state.total[1]}</p>`,
    };
  },

  record: (state) => ({ played: state.over ? 1 : 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function scoreChip(state, p) {
  const el = D.el('span', 'at-score');
  el.classList.toggle('on', !state.over && state.turn === p);
  el.innerHTML = `Player ${p + 1} · tricks <b>${state.tricksWon[p]}</b>`
    + ` · match <b>${state.total[p]}</b>`;
  return el;
}

function statusText(state) {
  if (state.over) return '<strong>The match is over.</strong> Start a new game when ready.';
  const hand = state.hands[state.turn];
  const name = `Player ${state.turn + 1}`;
  if (!state.trick.length) {
    return `${name} leads trick ${9 - hand.length + 1} of hand ${state.handNo}. `
      + `Lead any card. ${C.trumpText(state)[0].toUpperCase()}${C.trumpText(state).slice(1)}.`;
  }
  const legal = C.legalPlays(state);
  if (legal.length === hand.length) {
    return `${name}: play any card — ${data.byId[D.baseId(state.trick[0].id)].name} was led.`;
  }
  if (legal.length === 1) {
    return `${name}: you must follow suit — only ${data.byId[D.baseId(legal[0])].name} fits.`;
  }
  return `${name}: follow suit — play a card matching the lead.`;
}

function onPlay(state, id) {
  if (state.over || revealedState !== state) return;
  const why = C.explainPlay(state, id);
  if (why) {
    api.setStatus(why, true);
    D.toast(why);
    return;
  }
  revealedState = null;
  api.pushHistory();
  api.setState(C.playCard(state, id));
}

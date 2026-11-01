/* Tinker, Sailor, Soldier, Spy — UI.  The rules live in tinker-sailor-soldier-spy-core.js */

import { mountGame, D, panel, pile } from '../gamikit.js';
import * as C from './tinker-sailor-soldier-spy-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const ALL = data.cards.map((c) => c.id);
const SUIT_NAME = {
  moons: 'Moons', suns: 'Suns', waves: 'Waves',
  leaves: 'Leaves', daemons: 'Daemons', crowns: 'Crowns',
};
const SUIT_OLD = {
  moons: 'moons', suns: 'suns', waves: 'waves',
  leaves: 'leaves', daemons: 'wyrms', crowns: 'knots',
};

let shownNote = null;

const api = mountGame({
  id: 'tinker-sailor-soldier-spy',
  title: 'Tinker, Sailor, Soldier, Spy',
  subtitle: 'spend amulets to beat challenges — a Friday-like',
  rules: '../rules/tinker-sailor-soldier-spy.html',
  newGame: (seed) => {
    shownNote = null;
    return C.newGame(seed, ALL);
  },

  render(state, api) {
    api.table.textContent = '';
    if (state.lastNote && state.lastNote !== shownNote) {
      shownNote = state.lastNote;
      api.toast(state.lastNote);
    }

    /* ---- round header ---- */
    const head = document.createElement('p');
    head.className = 'tss-head';
    head.textContent = state.round === 1
      ? `Round 1 — recruiting · challenge ${Math.min(state.challengesDone + 1, 11)} of 11`
      : `Round 2 — the journey · location ${Math.min(13 - state.locations.length, 13)} of 13`;
    api.table.appendChild(head);

    /* ---- the offered challenge (round 1) ---- */
    if (state.phase === 'choose' && state.choice) {
      const offer = document.createElement('div');
      offer.className = 'tss-offer';
      state.choice.forEach((id, i) => {
        if (!id) return;
        const c = data.byId[id];
        const box = document.createElement('button');
        box.type = 'button';
        box.className = 'tss-offer-card';
        box.appendChild(D.cardEl({ ...c, id }, { tag: 'div', static: true, eager: true }));
        const lab = document.createElement('span');
        lab.textContent = i === 0 ? `Personality — needs ${C.val(id)}` : `Event — needs ${C.val(id)}`;
        box.appendChild(lab);
        box.addEventListener('click', () => act(state, () => C.choose(state, i)));
        offer.appendChild(box);
      });
      api.table.appendChild(offer);
    }

    /* ---- the current fight ---- */
    if (state.phase === 'fight' && state.challenge) {
      const c = data.byId[state.challenge];
      const arena = document.createElement('div');
      arena.className = 'tss-arena';

      const goalBox = document.createElement('div');
      goalBox.className = 'tss-goal';
      goalBox.appendChild(D.cardEl({ ...c, id: state.challenge }, {
        tag: 'div', static: true, eager: true, badge: `≥${C.goal(state)}`,
      }));
      const suits = document.createElement('span');
      suits.className = 'tss-suits';
      suits.textContent = c.suits.map((s) => SUIT_OLD[s]).join(' + ');
      goalBox.appendChild(suits);
      arena.appendChild(goalBox);

      const right = document.createElement('div');
      right.className = 'tss-fightright';

      const sum = C.sum(state);
      const need = C.goal(state);
      const meter = document.createElement('div');
      meter.className = 'tss-meter';
      meter.innerHTML = `<div class="tss-meter-fill" style="width:${Math.min(100, Math.round((sum / Math.max(need, 1)) * 100))}%"></div>`;
      const meterText = document.createElement('div');
      meterText.className = 'tss-metertext';
      meterText.innerHTML = `sum <strong>${sum}</strong> / needs <strong>${need}</strong>`;
      meter.appendChild(meterText);
      right.appendChild(meter);

      const play = document.createElement('div');
      play.className = 'tss-play';
      for (const id of state.played) {
        play.appendChild(D.cardEl({ ...data.byId[id], id }, { tag: 'div', static: true }));
      }
      for (const suit of state.chipPlay) {
        const chip = document.createElement('span');
        chip.className = 'tss-playchip';
        chip.appendChild(D.suitChip(suit));
        play.appendChild(chip);
      }
      right.appendChild(play);
      arena.appendChild(right);
      api.table.appendChild(arena);
    }

    /* ---- the amulet chips ---- */
    const chipPanel = panel('Amulets', (() => {
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(C.chipsLeft(state));
      return n;
    })());
    chipPanel.row.className = 'tss-chips';
    for (const suit of C.SUITS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tss-chip' + (state.chips[suit] === 0 ? ' is-out' : '');
      b.appendChild(D.suitChip(suit));
      const n = document.createElement('span');
      n.className = 'tss-chipn';
      n.textContent = String(state.chips[suit]);
      b.appendChild(n);
      b.setAttribute('aria-label', `${SUIT_NAME[suit]} amulets: ${state.chips[suit]}. Spend one`);
      b.addEventListener('click', () => {
        if (state.over) return void api.toast('The game is over — start a New game.');
        if (state.phase !== 'fight') {
          return void api.toast('Pick a challenge first — amulets only spend during a fight.');
        }
        act(state, () => C.playChip(state, suit),
          (err) => {
            if (err.message.includes('no cards')) {
              api.toast('No cards left to draw — you cannot press on. Back down instead.');
            } else {
              api.toast(`No ${SUIT_NAME[suit]} amulets left.`);
            }
          });
      });
      chipPanel.row.appendChild(b);
    }
    api.table.appendChild(chipPanel.section);

    /* ---- give up (round 1 only) ---- */
    if (state.phase === 'fight' && state.round === 1) {
      const row = document.createElement('div');
      row.className = 'btnrow tss-actions';
      const quit = document.createElement('button');
      quit.type = 'button';
      quit.className = 'btn small';
      quit.textContent = 'Back down from this challenge';
      quit.addEventListener('click', async () => {
        if (state.over) return;
        const ok = await api.confirm({
          title: 'Back down?',
          message: 'The challenge card is trashed and everything you played is ' +
            'discarded. You gain no team member and no knowledge.',
          okLabel: 'Back down',
          danger: true,
        });
        if (ok) act(state, () => C.giveUp(state));
      });
      row.appendChild(quit);
      api.table.appendChild(row);
    }

    /* ---- the piles ---- */
    const piles = document.createElement('div');
    piles.className = 'piles tss-piles';
    const mk = (label, n, hot) => {
      const p = pile(label);
      p.set(n);
      if (hot) p.el.classList.add('is-hot');
      return p.el;
    };
    piles.append(
      mk('deck', state.draw.length),
      mk('discard', state.discard.length),
      mk('trashed', state.trash.length),
      mk('weary Aces', state.aces.length, state.aces.length === 0),
    );
    api.table.appendChild(piles);

    /* ---- hint ---- */
    const hint = document.createElement('p');
    hint.className = 'tss-hint';
    hint.textContent = state.over
      ? ''
      : state.phase === 'choose'
        ? 'Tap the card to fight. You beat it with a sum of matching cards and ' +
          'amulets at least its value; the other card is trashed.'
        : state.round === 1
          ? 'The first card was free. Tap an amulet to spend it and draw one more ' +
            'card — only amulets and cards matching the challenge’s suits count.'
          : 'You cannot back down from a location. Spend amulets until the sum ' +
            'reaches its value — every location must fall.';
    api.table.appendChild(hint);

    api.setStatus(
      `Amulets <strong>${C.chipsLeft(state)}</strong>` +
      ` · deck <strong>${state.draw.length}</strong>` +
      ` · discard <strong>${state.discard.length}</strong>` +
      ` · weary Aces <strong>${6 - state.aces.length}</strong>` +
      ` · challenges <strong>${state.challengesDone}</strong>`
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    return {
      title: o.title,
      cls: o.cls,
      body: `<p>${o.text}</p>` +
        `<p class="muted">${state.challengesDone} challenges fought · ` +
        `${6 - state.aces.length} weary Aces joined the deck · ` +
        `${C.chipsLeft(state)} amulets left.</p>`,
    };
  },

  record: (state) => ({ win: state.over === 'won', score: null }),
});

function act(state, move, onErr) {
  try {
    const next = move();
    api.pushHistory();
    api.setState(next);
  } catch (err) {
    api.toast(onErr ? onErr(err) : err.message);
  }
}

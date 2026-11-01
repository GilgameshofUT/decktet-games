/* Shed — UI.  Two players, one device: the hand is hidden behind the
   pass-the-device screen between turns.  The rules live in shed-core.js.

   A trick is led by type (Personality / Location / Event) or by an Ace's
   suit; after the fourth card the winner sheds a token — the table shows
   every pool, the supply and the Kingmaker rule switch. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './shed-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealed = null;      // { state, player } — whose hand is on screen
let announce = null;      // { state, view } — the Location/Event dialog, if open

const api = mountGame({
  id: 'shed',
  title: 'Shed',
  subtitle: 'shed every token you hold',
  rules: '../rules/shed.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    // a New game / undo invalidates an open "announce" dialog
    if (announce && announce.state !== state) {
      announce.view.close();
      announce = null;
    }
    const actor = state.turn;
    const showing = !!state.over ||
      (!!revealed && revealed.state === state && revealed.player === actor);

    const table = document.createElement('div');
    table.className = 'sd-table';

    /* ---- the token pools, the supply, the tools ---- */
    const top = document.createElement('div');
    top.className = 'sd-top';
    top.appendChild(poolBox(state, 0));
    const supply = document.createElement('div');
    supply.className = 'sd-supply';
    const sh = document.createElement('span');
    sh.className = 'sd-slabel';
    sh.textContent = 'Supply';
    supply.appendChild(sh);
    for (const s of C.SUITS) supply.appendChild(tokChip(s, state.supply[s]));
    top.appendChild(supply);
    top.appendChild(poolBox(state, 1));
    table.appendChild(top);

    const tools = document.createElement('div');
    tools.className = 'sd-tools';
    const kmLabel = state.kingmaker === 'shared'
      ? 'Kingmaker: shared victory'
      : 'Kingmaker: supply penalty';
    const km = btn(kmLabel, false, () => {
      const next = C.setKingmaker(state, state.kingmaker === 'shared' ? 'supply' : 'shared');
      keepScreen(next);
      api.setState(next);
      D.toast(next.kingmaker === 'shared'
        ? 'Option 1: a forced take that empties your opponent ends the game there.'
        : 'Option 2: that take comes from the supply instead, so play continues.');
    });
    km.className = 'btn small sd-km';
    km.title = 'Choose how the Kingmaker Scenario ends (see the rules).';
    tools.appendChild(km);
    const info = document.createElement('span');
    info.className = 'sd-round';
    info.innerHTML = `Round ${state.round} · dealer Player ${state.dealer + 1} `
      + `· draw <b>${state.draw.length}</b> · set aside <b>${state.remainder.length}</b>`
      + `<br>scores (they never decide the game): `
      + `P1 <b>${state.scores[0]}</b> · P2 <b>${state.scores[1]}</b>`;
    tools.appendChild(info);
    table.appendChild(tools);

    /* ---- the trick ---- */
    const trickBox = document.createElement('div');
    trickBox.className = 'sd-trickbox';
    if (state.trick.length || state.lastTrick) {
      const lead = state.trick.length ? state.leadId : state.lastTrick.lead;
      const type = state.trick.length ? state.trickType : state.lastTrick.type;
      const head = document.createElement('div');
      head.className = 'sd-lead';
      head.innerHTML = type === 'ace'
        ? `<b>Ace trick</b> — follow ${C.cap(state.trick.length ? state.trickSuit : leadSuit(state.lastTrick.lead))}, `
          + 'rank decides, and the Ace wins if its matching Crown shows up.'
        : `<b>${C.TYPE_LABEL[type]} trick</b> — led by ${data.byId[D.baseId(lead)].name}`;
      trickBox.appendChild(head);

      const slots = document.createElement('div');
      slots.className = 'sd-slots';
      const plays = state.trick.length ? state.trick : state.lastTrick.plays;
      const past = !state.trick.length;
      for (let k = 0; k < C.TRICK_SIZE; k++) {
        const slot = document.createElement('div');
        slot.className = 'sd-slot';
        const play = plays[k];
        if (play) {
          const won = past && state.lastTrick.winner === play.player;
          slot.appendChild(D.cardEl({ ...data.byId[D.baseId(play.id)], id: play.id }, {
            tag: 'div', static: true, eager: k === 0,
            cls: won ? 'is-winner' : '', badge: String(k + 1),
          }));
          slot.appendChild(D.el('div', 'sd-slotlabel',
            `P${play.player + 1}${won && past ? ' took it' : ''}`));
        } else {
          slot.appendChild(D.el('div', 'sd-blank', '—'));
          slot.appendChild(D.el('div', 'sd-slotlabel', state.trick.length ? 'next' : ''));
        }
        slots.appendChild(slot);
      }
      trickBox.appendChild(slots);
    } else {
      trickBox.appendChild(D.el('div', 'sd-empty', 'No trick yet — lead one.'));
    }
    table.appendChild(trickBox);

    const note = document.createElement('div');
    note.className = 'sd-note';
    note.textContent = noteText(state);
    table.appendChild(note);

    /* ---- the shed choice ---- */
    if (!state.over && state.phase === 'shed') {
      const bar = document.createElement('div');
      bar.className = 'btnrow sd-shed';
      const opts = C.shedOptions(state);
      if (!opts.length) {
        bar.appendChild(btn('Nothing to take — carry on', false,
          () => commit(() => C.continueAfterTrick(api.state))));
      }
      for (const o of opts) {
        const label = o.source === 'own'
          ? `Shed ${C.cap(o.suit)}`
          : o.source === 'opponent'
            ? `Take ${C.cap(o.suit)} from Player ${2 - state.turn}`
            : `Take ${C.cap(o.suit)} from supply`;
        const b = btn(label, false, () => commitShed(api.state, o.suit));
        b.insertBefore(D.suitChip(o.suit), b.firstChild);
        bar.appendChild(b);
      }
      table.appendChild(bar);
    }

    /* ---- the current hand ---- */
    const panel = document.createElement('section');
    panel.className = 'panel';
    const h = document.createElement('h2');
    const who = actor;
    const label = state.phase === 'shed'
      ? `Player ${who + 1} — choose a token`
      : state.over ? 'Hand' : `Player ${who + 1}'s hand`;
    h.innerHTML = `${label}<span class="count">${(state.hands[who] || []).length} cards</span>`;
    panel.appendChild(h);

    const row = document.createElement('div');
    row.className = 'cardrow';
    if (showing) {
      const hand = state.hands[who] || [];
      const legal = new Set(state.over || state.phase === 'shed' ? [] : C.legalPlays(state));
      for (const id of hand) {
        const ok = legal.has(id);
        row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
          cls: ok ? 'is-legal' : 'is-dim',
          onPick: (c) => onPick(state, c.id),
          disabled: state.over || state.phase === 'shed',
        }));
      }
      if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards left.'));
    } else {
      row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
    }
    panel.appendChild(row);
    table.appendChild(panel);

    /* ---- the last shed ---- */
    if (state.lastShed) {
      const line = document.createElement('p');
      line.className = 'sd-last';
      const src = state.lastShed.source === 'own'
        ? 'shed it to the supply'
        : state.lastShed.source === 'opponent'
          ? `took it from Player ${2 - state.lastShed.player}`
          : 'took it from the supply';
      line.innerHTML = `Player ${state.lastShed.player + 1} ${src} `
        + `<b>${C.cap(state.lastShed.suit)}</b>.`;
      table.appendChild(line);
    }

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- status + subtitle ---- */
    api.setSubtitle(state.over ? 'the game is over' : `Player ${state.turn + 1} to play`);
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
    const kmNote = state.over === 'kingmaker'
      ? `<p>The forced penalty take would have emptied Player ${2 - w}'s pool. `
        + 'Under the shared-victory rule (option 1 of the Kingmaker Scenario) the game '
        + 'ends there, and Player ' + (w + 1) + ' — the only candidate at two players — wins.</p>'
      : '<p>The game ends the moment a player\'s last token leaves their pool.</p>';
    return {
      title: state.over === 'kingmaker'
        ? `Player ${w + 1} wins — Kingmaker Scenario`
        : `Player ${w + 1} sheds their last token`,
      cls: 'win',
      body: `${kmNote}
             <p class="muted">Rounds played: ${state.round} · combined scores: `
        + `Player 1 — ${state.scores[0]} · Player 2 — ${state.scores[1]}</p>`,
    };
  },

  record: (state) => ({ played: state.over ? 1 : 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function poolBox(state, p) {
  const box = document.createElement('div');
  box.className = 'sd-pool';
  box.classList.toggle('on', !state.over && state.turn === p);
  const head = document.createElement('span');
  head.className = 'sd-ph';
  head.innerHTML = `Player ${p + 1} · <b>${C.tokensOf(state, p)}</b> left`;
  box.appendChild(head);
  const rowEl = document.createElement('span');
  rowEl.className = 'sd-toks';
  for (const s of C.SUITS) rowEl.appendChild(tokChip(s, state.tokens[p][s]));
  box.appendChild(rowEl);
  return box;
}

function tokChip(suit, n) {
  const chip = document.createElement('span');
  chip.className = 'sd-tok' + (n > 0 ? '' : ' is-out');
  chip.appendChild(D.suitChip(suit));
  const b = document.createElement('b');
  b.textContent = String(n);
  chip.appendChild(b);
  return chip;
}

function btn(label, disabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function leadSuit(id) { return C.suitsOf(id)[0]; }

function noteText(state) {
  if (state.over) return 'Someone has no tokens left.';
  if (state.phase === 'shed') {
    return `${data.byId[D.baseId(state.leadId)].name} was led, so only a `
      + `${C.suitsOf(state.leadId).map(C.cap).join(' or ')} token can be shed.`;
  }
  if (state.phase === 'lead') {
    return `Player ${state.turn + 1} leads. The lead sets the type — `
      + 'Personalities, Locations, Events, or an Ace\'s suit.';
  }
  const hand = state.hands[state.turn];
  const legal = C.legalPlays(state);
  if (legal.length < hand.length) {
    return `Player ${state.turn + 1} must follow ${
      state.trickType === 'ace' ? C.cap(state.trickSuit) : C.TYPE_LABEL[state.trickType]}
      — ${legal.length} of ${hand.length} cards fit.`;
  }
  return `Player ${state.turn + 1}: ${
    state.trickType === 'ace' ? `follow ${C.cap(state.trickSuit)} — rank decides`
      : `play ${C.TYPE_LABEL[state.trickType]} or be void`}
    — the highest combined score of matching cards takes it.`;
}

function statusText(state, showing) {
  if (state.over) return '<strong>The game is over.</strong> Start a new game when ready.';
  const name = `Player ${state.turn + 1}`;
  if (state.phase === 'shed') {
    const opts = C.shedOptions(state);
    return `<strong>${name} won the trick.</strong> `
      + (opts.length
        ? 'Choose a token to shed (or take, if you hold none that match) — the buttons above.'
        : 'There is nothing to take.');
  }
  if (!showing) return `<strong>${name}:</strong> pass the device and reveal their hand.`;
  if (state.phase === 'lead') {
    return `<strong>${name}:</strong> lead any card — it sets the type of the trick. `
      + 'The Origin, the Market and the End must announce Location or Event.';
  }
  const legal = C.legalPlays(state);
  const hand = state.hands[state.turn];
  if (legal.length < hand.length) {
    return `<strong>${name}:</strong> you must follow ${
      state.trickType === 'ace' ? `the Ace's suit (${C.cap(state.trickSuit)})`
        : `the ${C.TYPE_LABEL[state.trickType]} of the lead`} — `
      + `${legal.length} card${legal.length === 1 ? ' fits' : 's fit'}. Tap one.`;
  }
  return `<strong>${name}:</strong> play a card — `
    + `${legal.length} of ${hand.length} can go on this trick.`;
}

function onPick(state, id) {
  if (state.over || !currentlyShowing(state) || state.phase === 'shed') return;

  if (state.phase === 'lead') {
    if (C.isDual(id)) { askAnnounce(state, id); return; }
    const why = C.explainLead(state, id, undefined);
    if (why) { api.setStatus(why, true); D.toast(why); return; }
    commitLead(state, id, undefined);
    return;
  }

  const why = C.explainPlay(state, id);
  if (why) { api.setStatus(why, true); D.toast(why); return; }
  commit(() => C.playCard(state, id));
}

function askAnnounce(state, id) {
  const name = data.byId[D.baseId(id)].name;
  if (announce) { announce.view.close(); announce = null; }
  const view = api.overlay({
    title: `${name} is ambiguous`,
    body: `<p>${name} is both a Location and an Event. Announce which type of trick it leads.</p>`,
    actions: [
      { label: 'Location', cls: 'primary', sticky: true, onClick: () => commitLead(state, id, 'location') },
      { label: 'Event', sticky: true, onClick: () => commitLead(state, id, 'event') },
    ],
  });
  announce = { state, view };
}

function commitLead(state, id, announceType) {
  const why = C.explainLead(state, id, announceType);
  if (why) { api.setStatus(why, true); D.toast(why); return; }
  announce = null;
  commit(() => C.lead(state, id, announceType));
}

function commitShed(state, suit) {
  const why = C.explainShed(state, suit);
  if (why) { api.setStatus(why, true); D.toast(why); return; }
  commit(() => C.shedToken(state, suit));
}

function commit(make) {
  const next = make();                     // pure: the old state is untouched
  keepScreen(next);                        // cover the screen only if the move passes
  api.pushHistory();
  api.setState(next);
}

/** Keep the hand on screen only when the same player still has the move. */
function keepScreen(next) {
  revealed = revealed && revealed.player === next.turn
    ? { state: next, player: next.turn }
    : null;
}

function currentlyShowing(state) {
  if (state.over) return true;
  return !!revealed && revealed.state === state && revealed.player === state.turn;
}

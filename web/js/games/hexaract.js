/* Hexaract — UI.  The rules live in hexaract-core.js. */

import { mountGame, D } from '../gamikit.js';
import * as C from './hexaract-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const TYPE_LABEL = { personality: 'personality', location: 'location', event: 'event' };

let selDice = [];        // indices into state.dice
let selSlot = null;      // journey slot index
let chooser = null;      // pending pick: { mode:'suit'|'ace', slot, d1, d2, suit }

const api = mountGame({
  id: 'hexaract',
  title: 'Hexaract',
  subtitle: 'retrieve the six pieces of the artifact',
  rules: '../rules/hexaract.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    selDice = selDice.filter((i) => i < state.dice.length);
    if (selSlot != null && !state.journey[selSlot]) selSlot = null;
    if (chooser && chooser.mode === 'ace' && !state.acesReserve.length) chooser = null;

    api.table.textContent = '';

    /* ---- dice ---- */
    const dicePanel = document.createElement('section');
    dicePanel.className = 'panel';
    dicePanel.innerHTML = `<h2>Dice <span class="count">${state.dice.length ? `${state.dice.length} on the table` : 'not rolled'}</span></h2>`;
    const diceRow = document.createElement('div');
    diceRow.className = 'hx-dice';
    if (!state.dice.length) {
      const roll = document.createElement('button');
      roll.type = 'button';
      roll.className = 'btn primary';
      roll.textContent = 'Roll 5d6';
      roll.addEventListener('click', () => act(state, { type: 'roll' }));
      diceRow.appendChild(roll);
    } else {
      state.dice.forEach((v, i) => {
        const die = document.createElement('button');
        die.type = 'button';
        die.className = 'hx-die' + (selDice.includes(i) ? ' is-selected' : '') + (v === 6 ? ' is-wild' : '');
        die.setAttribute('aria-label', `die ${i + 1}: ${v}${v === 6 ? ', wild' : ''}`);
        for (let p = 1; p <= 9; p++) {
          const pip = document.createElement('i');
          if (pipOn(v, p)) pip.className = 'is-on';
          die.appendChild(pip);
        }
        die.addEventListener('click', () => {
          if (selDice.includes(i)) selDice = selDice.filter((x) => x !== i);
          else if (selDice.length < 2) selDice = [...selDice, i];
          else selDice = [selDice[1], i];
          api.refresh();
        });
        diceRow.appendChild(die);
      });
      const left = document.createElement('span');
      left.className = 'hx-dice-note';
      left.textContent = selDice.length === 2 ? 'two dice picked' : 'tap two dice to make a couplet';
      diceRow.appendChild(left);
    }
    dicePanel.appendChild(diceRow);
    api.table.appendChild(dicePanel);

    /* ---- journey ---- */
    const jr = document.createElement('section');
    jr.className = 'panel';
    jr.innerHTML = `<h2>Your journey <span class="count">${C.journeyCount(state)} / 3 cards</span></h2>`;
    const jrow = document.createElement('div');
    jrow.className = 'hx-journey';
    state.journey.forEach((slot, i) => {
      const cell = document.createElement('div');
      cell.className = 'hx-slot';
      if (!slot) {
        cell.classList.add('is-empty');
        cell.textContent = 'clear';
        cell.setAttribute('aria-label', `Journey slot ${i + 1}: clear`);
      } else {
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        const c = data.byId[D.baseId(slot.id)];
        const type = C.typeOf(slot.id);
        const wrap = document.createElement('div');
        wrap.className = 'hx-cardwrap' + (slot.exhausted ? ' is-exhausted' : '');
        wrap.appendChild(D.cardEl({ ...c, id: slot.id }, { tag: 'div', static: true, eager: i === 0 }));
        cell.appendChild(wrap);
        const meta = document.createElement('div');
        meta.className = 'hx-meta';
        const rank = C.rankOf(slot.id);
        meta.innerHTML = `<b>${TYPE_LABEL[type]}</b><span>rank ${rank}${rank === 10 ? ' (crown)' : ''}</span>`;
        cell.appendChild(meta);
        if (type === 'location') {
          const toks = document.createElement('div');
          toks.className = 'hx-tokens';
          for (let t = 0; t < C.neededTokens(slot.id); t++) {
            const chip = document.createElement('span');
            chip.className = 'hx-token' + (slot.tokens[t] ? ' is-full' : '');
            if (slot.tokens[t]) chip.appendChild(D.suitChip(slot.tokens[t]));
            else chip.textContent = '?';
            toks.appendChild(chip);
          }
          meta.appendChild(toks);
        }
        if (slot.exhausted) {
          const ex = document.createElement('span');
          ex.className = 'hx-exhausted-tag';
          ex.textContent = type === 'event' ? 'spent' : 'weary';
          meta.appendChild(ex);
        }
        cell.setAttribute('aria-label',
          `Journey slot ${i + 1}: ${D.describe(c)}, ${type}${slot.exhausted ? ', exhausted' : ''}` +
          (type === 'location' ? `, ${slot.tokens.length} of ${C.neededTokens(slot.id)} tokens` : ''));
        const legalHere = selDice.length === 2 && C.coupletFits(
          state.dice[selDice[0]], state.dice[selDice[1]], C.rankOf(slot.id));
        if (legalHere) cell.classList.add('is-legal');
        if (selSlot === i) cell.classList.add('is-selected');
        cell.addEventListener('click', () => {
          selSlot = selSlot === i ? null : i;
          api.refresh();
        });
      }
      jrow.appendChild(cell);
    });
    jr.appendChild(jrow);
    api.table.appendChild(jr);

    /* ---- aces + supply + harm ---- */
    const aces = document.createElement('section');
    aces.className = 'panel';
    aces.innerHTML = `<h2>Face-up Aces <span class="count">${state.acesReserve.length} left</span></h2>`;
    const arow = document.createElement('div');
    arow.className = 'cardrow hx-aces';
    state.acesReserve.forEach((id) => {
      arow.appendChild(D.cardEl({ ...data.byId[id], id }, { tag: 'div', static: true }));
    });
    const an = document.createElement('div');
    an.className = 'empty';
    an.textContent = 'Spend one when you resolve a Crown-ranked card for a second matching token.';
    aces.appendChild(arow);
    if (!state.acesReserve.length) aces.appendChild(an);
    api.table.appendChild(aces);

    const sup = document.createElement('section');
    sup.className = 'panel';
    sup.innerHTML = `<h2>Your supply <span class="count">${C.supplyTotal(state)} tokens</span></h2>`;
    const srow = document.createElement('div');
    srow.className = 'hx-supply';
    for (const s of C.SUITS) {
      const chip = document.createElement('div');
      chip.className = 'hx-chip' + (state.supply[s] ? '' : ' is-zero');
      chip.appendChild(D.suitChip(s));
      const n = document.createElement('b');
      n.textContent = state.supply[s];
      chip.appendChild(n);
      chip.setAttribute('aria-label', `${s}: ${state.supply[s]} tokens`);
      srow.appendChild(chip);
    }
    sup.appendChild(srow);
    api.table.appendChild(sup);

    const harm = document.createElement('section');
    harm.className = 'panel';
    const shownHarm = Math.min(state.harm, C.HARM_TO_LOSE);
    harm.innerHTML = `<h2>Harm <span class="count${state.harm >= 7 ? ' is-hot' : ''}">${shownHarm} / ${C.HARM_TO_LOSE}</span></h2>`;
    const track = document.createElement('div');
    track.className = 'hx-harm';
    for (let i = 0; i < C.HARM_TO_LOSE; i++) {
      const seg = document.createElement('i');
      if (i < state.harm) seg.className = 'is-on';
      track.appendChild(seg);
    }
    harm.appendChild(track);
    const deckLine = document.createElement('p');
    deckLine.className = 'hx-deckline';
    deckLine.textContent = `${state.deck.length} cards still in the deck · ${state.discard.length} resolved.`;
    harm.appendChild(deckLine);
    api.table.appendChild(harm);

    /* ---- the pending chooser (suit, then ace) ---- */
    if (chooser) api.table.appendChild(chooserEl(state));

    /* ---- action bar ---- */
    api.table.appendChild(actionBar(state));

    const hint = document.createElement('p');
    hint.className = 'hx-hint';
    hint.textContent = hintFor(state);
    api.table.appendChild(hint);

    api.setStatus(
      `<strong>Turn ${state.turn}</strong> · harm <strong>${Math.min(state.harm, C.HARM_TO_LOSE)}</strong>/${C.HARM_TO_LOSE}` +
      ` · tokens <strong>${C.supplyTotal(state)}</strong>` +
      ` · deck <strong>${state.deck.length}</strong>` +
      (state.log ? `<br><span class="muted">${state.log}</span>` : '')
    );
  },

  endOf(state) {
    if (!state.over) return null;
    const won = state.over === 'won';
    const missing = C.SUITS.filter((s) => !state.supply[s]);
    return {
      title: won ? 'The artifact is complete' : 'The adventure ends',
      cls: won ? 'win' : 'lose',
      body: `<p>${won
        ? `You crossed the whole deck and reached the chamber with all six suits, in ${state.turn} turns and ${state.harm} harm.`
        : state.harm >= C.HARM_TO_LOSE
          ? `Harm reached ${state.harm}. The kingdom's doom must find another hero.`
          : `The deck ran out and your supply still lacks ${missing.join(', ')}.`}</p>` +
        `<p class="muted">Turns ${state.turn} · harm ${state.harm} · tokens ${C.supplyTotal(state)}.</p>`,
    };
  },

  record(state) {
    return { win: state.over === 'won', score: null };
  },
});

/* ------------------------------------------------------------- rendering */

/** Which of the six faces shows a pip at position p (1-6, LTR row-wise). */
function pipOn(v, p) {
  const on = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  return on[v].includes(p);
}

function chooserEl(state) {
  const box = document.createElement('div');
  box.className = 'hx-chooser';
  const slot = state.journey[chooser.slot];
  if (!slot) { chooser = null; return box; }
  const name = D.describe(data.byId[D.baseId(slot.id)]);
  const head = document.createElement('p');
  box.appendChild(head);

  const suitButtons = (suits, label, onPick) => {
    head.textContent = label;
    const row = document.createElement('div');
    row.className = 'btnrow';
    for (const s of suits) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.appendChild(D.suitChip(s));
      b.append(` ${s}`);
      b.addEventListener('click', () => onPick(s));
      row.appendChild(b);
    }
    box.appendChild(row);
  };

  if (chooser.mode === 'suit') {
    // The reward of a two-suit card: which token do you take?
    suitButtons(C.suitsOf(slot.id), `${name}: which token do you take?`,
      (s) => afterSuit(state, s));
    return box;
  }

  if (chooser.mode === 'spend-suit') {
    const suits = C.suitsOf(slot.id).filter((s) => state.supply[s] > 0);
    suitButtons(suits, `Spend which token on ${name}?`, (s) => {
      chooser = null;
      act(state, { type: 'spend', slot: selSlot, suit: s });
    });
    return box;
  }

  // mode 'ace': the crown bonus.
  head.textContent = `Crown-ranked: spend a face-up Ace for a second ${chooser.suit} token?`;
  const row = document.createElement('div');
  row.className = 'btnrow';
  state.acesReserve.forEach((id, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.appendChild(D.cardEl({ ...data.byId[id], id }, { tag: 'span', static: true, cls: 'hx-acebtn' }));
    b.addEventListener('click', () => runAssign(state, i));
    row.appendChild(b);
  });
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn small';
  skip.textContent = 'Keep the Ace';
  skip.addEventListener('click', () => runAssign(state, null));
  row.appendChild(skip);
  box.appendChild(row);
  return box;
}

/** The suit of the reward is settled; a crown-ranked card may still buy the bonus. */
function afterSuit(state, suit) {
  const slot = state.journey[chooser.slot];
  if (C.rankOf(slot.id) === 10 && state.acesReserve.length) {
    chooser = { ...chooser, mode: 'ace', suit };
    api.refresh();
    return;
  }
  runAssign(state, null, suit);
}

function runAssign(state, aceIndex = null, suit = null) {
  const { slot, d1, d2, suit: chosenSuit } = chooser;
  chooser = null;
  selDice = [];
  selSlot = null;
  act(state, { type: 'assign', slot, d1, d2, suit: suit ?? chosenSuit, aceIndex });
}

function actionBar(state) {
  const bar = document.createElement('div');
  bar.className = 'btnrow hx-actions';

  const mk = (label, ready, why, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small' + (ready ? '' : ' is-off');
    b.textContent = label;
    if (!ready) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => { ready ? fn() : api.toast(why()); });
    bar.appendChild(b);
  };

  const slotCard = selSlot != null ? state.journey[selSlot] : null;
  const fits = selDice.length === 2 && slotCard &&
    C.coupletFits(state.dice[selDice[0]], state.dice[selDice[1]], C.rankOf(slotCard.id));

  mk('Assign couplet', !!fits,
    () => (!state.dice.length ? 'Roll the dice first.'
      : selDice.length !== 2 ? 'Tap two dice first — a couplet is two dice.'
        : !slotCard ? 'Now tap the journey card the couplet is aimed at.'
          : `Those dice cannot sum to ${C.rankOf(slotCard.id)}.`),
    () => {
      const suits = C.suitsOf(slotCard.id);
      const [va, vb] = C.resolveWilds(state.dice[selDice[0]], state.dice[selDice[1]], C.rankOf(slotCard.id));
      chooser = { mode: 'suit', slot: selSlot, d1: selDice[0], d2: selDice[1] };
      if (suits.length > 1) {
        api.refresh();
        api.toast(`Couplet ${va} + ${vb}.`);
      } else {
        afterSuit(state, suits[0]);
      }
    });

  const spendable = slotCard && C.typeOf(slotCard.id) === 'location' && !state.spentThisTurn &&
    C.suitsOf(slotCard.id).some((s) => state.supply[s] > 0);
  mk('Spend a token', !!spendable,
    () => (!slotCard ? 'Tap a location card first.'
      : C.typeOf(slotCard.id) !== 'location' ? 'Only a location can be enhanced with a resource.'
        : state.spentThisTurn ? 'You have already spent a resource this turn.'
          : 'You have no matching token in your supply.'),
    () => {
      const suits = C.suitsOf(slotCard.id).filter((s) => state.supply[s] > 0);
      if (suits.length > 1) {
        chooser = { mode: 'spend-suit', slot: selSlot };
        api.refresh();
      } else {
        act(state, { type: 'spend', slot: selSlot, suit: suits[0] });
      }
    });

  const end = document.createElement('button');
  end.type = 'button';
  end.className = 'btn small primary';
  end.textContent = 'End turn';
  end.addEventListener('click', () => {
    selDice = []; selSlot = null; chooser = null;
    act(state, { type: 'endTurn' });
  });
  bar.appendChild(end);
  return bar;
}

function hintFor(state) {
  if (state.over) return '';
  if (!state.dice.length) return 'Roll the dice, then group two of them into a couplet whose sum matches a card on your journey.';
  if (selDice.length < 2) return 'Tap two dice — a 6 is wild and counts as any number from 1 to 5.';
  if (selSlot == null) return 'Now tap the journey card you want to resolve with that couplet.';
  return 'Press “Assign couplet”, or tap another card to aim elsewhere. A 6 counts as whichever number makes the sum.';
}

function act(state, action) {
  let next;
  try {
    next = C.applyMove(state, action);
  } catch (err) {
    api.toast(err.message);
    return;
  }
  api.pushHistory();
  api.setState(next);
}

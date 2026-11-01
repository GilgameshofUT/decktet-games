/* Magnate — UI.  Two players, one device: hands are hidden behind the
   pass-the-device screen between turns.  The dice live in the state (seeded,
   so a reload keeps them), resource tokens are per-suit counters, and the
   five districts are shared chains of property cards. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './magnate-core.js';

const data = await D.loadDeck();
C.init(data.byId);
const ALL = data.cards.map((c) => c.id);

let revealedFor = null;      // whose hand may be on screen right now
let passShown = false;
let passOverlay = null;      // the open hand-off screen, if any
let lastSig = '';
let lastSeed = null;
let selected = null;         // the tapped hand card
let pending = null;          // { kind: 'develop'|'deed', handIndex } waiting for a district

const api = mountGame({
  id: 'magnate',
  title: 'Magnate',
  subtitle: 'build the duchy',
  rules: '../rules/magnate.html',
  newGame: (seed) => C.newGame(seed, ALL),

  render(state, api) {
    const actor = state.over ? null : state.turn;
    if (state.seed !== lastSeed) {                  // a fresh match: nobody has looked yet
      lastSeed = state.seed;
      revealedFor = null;
      passShown = false;
      selected = null;
      pending = null;
    }
    const sig = `${state.seed}:${state.moves}:${state.phase}:${actor}:${state.rolls}`;
    if (sig !== lastSig) { lastSig = sig; selected = null; pending = null; }

    const table = D.el('div', 'mg-table');

    /* ---- dice + phase ---- */
    const diceBox = D.el('div', 'mg-dice');
    if (state.dice) {
      diceBox.appendChild(die(String(state.dice.a)));
      diceBox.appendChild(die(String(state.dice.b)));
      if (state.dice.tax != null) {
        diceBox.appendChild(die(`d6 ${state.dice.tax}`));
        diceBox.appendChild(D.suitChip(C.TAX_BY_DIE[state.dice.tax - 1]));
        diceBox.appendChild(D.el('span', 'mg-taxlabel', 'taxed'));
      }
    } else {
      diceBox.appendChild(D.el('span', 'mg-diceempty', 'Dice not yet rolled this turn.'));
    }
    if (state.phase === 'roll' && !state.over && revealedFor === actor) {
      diceBox.appendChild(btn('Roll the dice', 'primary', () => commit(api, () => C.rollPhase(api.state))));
    }
    table.appendChild(diceBox);

    /* ---- supplies ---- */
    const supplies = D.el('section', 'panel');
    supplies.appendChild(D.el('h2', '', 'Resource tokens'));
    for (let p = 0; p < 2; p++) {
      const row = D.el('div', 'mg-supply' + (actor === p ? ' on' : ''));
      row.appendChild(D.el('span', 'mg-owner', `Player ${p + 1}`));
      for (const s of C.SUITS) {
        const chip = D.el('span', 'mg-token');
        chip.appendChild(D.suitChip(s));
        chip.appendChild(D.el('b', '', String(state.supply[p][s])));
        chip.setAttribute('aria-label', `${D.SUIT_NAME[s]}: ${state.supply[p][s]}`);
        row.appendChild(chip);
      }
      supplies.appendChild(row);
    }
    table.appendChild(supplies);

    /* ---- districts ---- */
    const districts = D.el('section', 'panel');
    districts.appendChild(D.el('h2', '', 'The five districts'));
    const grid = D.el('div', 'mg-districts');
    state.districts.forEach((d, i) => {
      const box = D.el('div', 'mg-district');
      const head = D.el('div', 'mg-districthead');
      const thumb = D.cardEl({ ...data.byId[D.baseId(d.marker)], id: d.marker },
        { tag: 'div', static: true });
      head.appendChild(thumb);
      head.appendChild(D.el('div', 'mg-districtname',
        `${C.districtName(i)}\n${data.byId[D.baseId(d.marker)].name}`));
      box.appendChild(head);

      const chain = D.el('div', 'mg-chain');
      if (!d.props.length) chain.appendChild(D.el('div', 'mg-emptydistrict', 'empty'));
      for (const prop of d.props) {
        const spent = Object.values(prop.spent).reduce((n, x) => n + x, 0);
        const spendable = !state.over && revealedFor === actor &&
          (state.phase === 'action' || state.phase === 'draw') &&
          prop.owner === actor && !prop.developed;
        const el = D.cardEl({ ...data.byId[D.baseId(prop.id)], id: prop.id }, {
          tag: 'div', static: true,
          cls: 'mg-prop' + (prop.developed ? ' is-built' : ' is-deed') + (spendable ? ' is-legal' : ''),
          badge: prop.developed ? `P${prop.owner + 1}` : `P${prop.owner + 1} · ${spent}/${C.cost(prop.id)}`,
        });
        chain.appendChild(el);
        if (spendable) {
          const spendRow = D.el('div', 'mg-spend');
          for (const s of C.suitsOf(prop.id)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn small mg-spendbtn';
            b.appendChild(D.suitChip(s));
            b.setAttribute('aria-label', `Put a ${s} token on ${data.byId[D.baseId(prop.id)].name}`);
            b.addEventListener('click', () => commit(api, () => C.spend(api.state, i, s)));
            spendRow.appendChild(b);
          }
          chain.appendChild(spendRow);
        }
      }
      box.appendChild(chain);
      grid.appendChild(box);
    });
    districts.appendChild(grid);
    table.appendChild(districts);

    /* ---- piles ---- */
    const piles = D.el('div', 'mg-piles');
    piles.appendChild(pileEl('draw pile', state.deck.length));
    piles.appendChild(pileEl('discard', state.discard.length));
    table.appendChild(piles);

    /* ---- actions ---- */
    const actions = D.el('div', 'trp-actions mg-actions');
    if (!state.over && revealedFor === actor && state.phase !== 'roll') {
      if (state.phase === 'action' && !state.played) {
        actions.appendChild(buildCardActions(state, api, actor));
      } else if (state.phase === 'draw') {
        actions.appendChild(D.el('div', 'trp-note', 'Now draw a card — this ends your turn.'));
        actions.appendChild(btn('Draw a card', 'primary', () => commit(api, () => C.drawPhase(api.state))));
      }
      actions.appendChild(buildTrade(state, api));
    }
    table.appendChild(actions);

    /* ---- the hand(s) ---- */
    if (state.over) {
      for (let p = 0; p < 2; p++) table.appendChild(handPanel(state, `Player ${p + 1}’s hand`, state.hands[p]));
    } else if (revealedFor === actor) {
      table.appendChild(handPanel(state, `Player ${actor + 1}’s hand`, state.hands[actor], actor));
    } else {
      table.appendChild(handPanel(state, `Player ${actor + 1}’s hand`, null));
    }

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- chrome ---- */
    api.setSubtitle(state.over ? 'the Grand Duke has decided'
      : `Player ${actor + 1} · ${state.phase === 'roll' ? 'roll' : state.phase === 'action' ? 'play a card' : 'draw'}`);
    api.setStatus(statusText(state));

    /* ---- the hand-off ---- */
    if (!state.over && actor != null && revealedFor !== actor && !passShown) {
      showPass(actor, api);
    }
  },

  endOf(state) {
    if (!state.over) return null;
    const f = state.final;
    const rows = state.districts.map((d, i) => {
      const [a, b] = f.totals[i];
      const win = a > b ? ' · P1' : b > a ? ' · P2' : '';
      return `<tr><td>${data.byId[D.baseId(d.marker)].name}</td>` +
        `<td class="oc-num">${a}</td><td class="oc-num">${b}</td><td>${win}</td></tr>`;
    }).join('');
    const how = f.how === 'districts' ? 'more districts won'
      : f.how === 'ranks' ? 'equal districts, higher total ranks'
      : f.how === 'tokens' ? 'equal districts and ranks, more resources left'
      : 'everything was equal';
    return {
      title: f.winner == null ? 'The Grand Duke names neither' : `Player ${f.winner + 1} becomes Grand Duke`,
      cls: f.winner == null ? '' : 'win',
      body: `<div class="oc-table"><table><thead><tr><th>District</th>` +
        `<th>P1</th><th>P2</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` +
        `<p class="muted">Districts: Player 1 — ${f.vps[0]}, Player 2 — ${f.vps[1]}. ` +
        `Decided by ${how}.</p>`,
    };
  },

  record: (state) => (state.over === 'done'
    ? { played: 1, win: null, score: state.final ? state.final.vps[state.final.winner ?? 0] : null }
    : { played: 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function die(text) {
  const d = D.el('span', 'mg-die', text);
  return d;
}

function pileEl(label, n) {
  const d = document.createElement('div');
  d.className = 'pile' + (n === 0 ? ' is-empty' : '');
  d.innerHTML = `<span class="n">${n}</span><small>${label}</small>`;
  return d;
}

function commit(api, fn) {
  try {
    const next = fn();
    // The pass screen only moves with the turn: a phase change inside one
    // player's turn keeps their hand on screen.
    api.pushHistory();
    api.setState(next);
    return true;
  } catch (e) {
    api.setStatus(e.message, true);
    return false;
  }
}

/** Develop / deed / sell buttons for the selected card, or a district picker. */
function buildCardActions(state, api, actor) {
  const wrap = D.el('div', 'mg-cardactions');
  if (selected == null || !state.hands[actor][selected]) {
    wrap.appendChild(D.el('div', 'trp-note', 'Tap a card in your hand, then choose what to do with it.'));
    return wrap;
  }
  const id = state.hands[actor][selected];
  const name = data.byId[D.baseId(id)].name;

  if (pending) {
    wrap.appendChild(D.el('div', 'trp-note',
      `${pending.kind === 'develop' ? 'Develop' : 'Deed for'} ${name} — tap a district.`));
    const row = D.el('div', 'btnrow');
    state.districts.forEach((d, i) => {
      row.appendChild(btn(`${i + 1}${i === 4 ? ' · Excuse' : ''}`, '', () => {
        const done = commit(api, () => (pending.kind === 'develop'
          ? C.playDevelop(api.state, pending.handIndex, i)
          : C.playDeed(api.state, pending.handIndex, i)));
        if (done) { selected = null; pending = null; }
      }));
    });
    row.appendChild(btn('Cancel', '', () => { pending = null; api.refresh(); }));
    wrap.appendChild(row);
    return wrap;
  }

  wrap.appendChild(D.el('div', 'trp-note', `${name} — develop outright, buy the deed, or sell.`));
  const row = D.el('div', 'btnrow');
  const sellN = C.saleTokens(id);
  row.appendChild(btn('Develop outright', 'primary', () => {
    pending = { kind: 'develop', handIndex: selected };
    api.refresh();
  }));
  row.appendChild(btn(`Buy deed (${C.deedCost(id)} token${C.deedCost(id) === 1 ? '' : 's'})`, '',
    () => { pending = { kind: 'deed', handIndex: selected }; api.refresh(); }));
  row.appendChild(btn(`Sell for ${sellN}`, '', () => {
    if (commit(api, () => C.playSell(api.state, selected))) selected = null;
  }));
  wrap.appendChild(row);
  return wrap;
}

/** The 3-for-1 bank trade. */
function buildTrade(state, api) {
  const wrap = D.el('div', 'mg-trade');
  const from = suitSelect();
  const to = suitSelect();
  to.value = 'waves';
  from.value = 'moons';
  wrap.appendChild(from);
  wrap.appendChild(D.el('span', 'mg-tradearrow', '→'));
  wrap.appendChild(to);
  wrap.appendChild(btn('Trade 3 for 1', '', () => commit(api, () => C.trade(api.state, from.value, to.value))));
  return wrap;
}

function suitSelect() {
  const sel = document.createElement('select');
  sel.className = 'oc-input mg-suit';
  for (const s of C.SUITS) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = D.SUIT_NAME[s];
    sel.appendChild(o);
  }
  return sel;
}

function handPanel(state, title, hand, p) {
  const panel = D.el('section', 'panel');
  const h = D.el('h2', '', title);
  if (hand) h.appendChild(D.el('span', 'count', `${hand.length} cards`));
  panel.appendChild(h);
  const row = D.el('div', 'cardrow');
  if (hand) {
    hand.forEach((id, i) => {
      row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
        cls: selected === i && p != null ? 'is-selected' : '',
        badge: selected === i && p != null ? '✓' : null,
        onPick: p == null ? null : () => {
          if (state.phase !== 'action' || state.played || state.over) {
            api.setStatus(state.phase === 'roll' ? 'Roll the dice first.'
              : state.played ? 'You have already played your card this turn.'
              : 'The game is over.', true);
            return;
          }
          selected = selected === i ? null : i;
          pending = null;
          api.refresh();
        },
      }));
    });
    if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards.'));
  } else {
    row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
  }
  panel.appendChild(row);
  return panel;
}

function statusText(state) {
  if (state.over === 'done') return '<strong>The Grand Duke has decided.</strong>';
  const actor = state.turn;
  if (revealedFor !== actor) return `Player ${actor + 1} to play.`;
  if (state.phase === 'roll') return `Player ${actor + 1}: roll the dice — income, maybe taxation.`;
  return state.note;
}

function showPass(p, api) {
  if (passOverlay) passOverlay.close();             // never stack two hand-off screens
  passShown = true;
  passOverlay = passDevice(p + 1, () => {
    revealedFor = p;
    passShown = false;
    passOverlay = null;
    api.refresh();
  });
}

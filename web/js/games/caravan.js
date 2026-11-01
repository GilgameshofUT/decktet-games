/* Caravan — UI.  Two players, one device: the hand is hidden behind the
   pass-the-device screen between turns.  The rules live in caravan-core.js.
   Tap cards in play order to build a caravan or bandit, then Play. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './caravan-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealedState = null;    // the state object whose hand is on screen
let buildFor = null;         // the state the current build belongs to
let build = [];              // ids tapped, in play order

const api = mountGame({
  id: 'caravan',
  title: 'Caravan',
  subtitle: 'caravans versus bandits',
  rules: '../rules/caravan.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    if (buildFor !== state) { buildFor = state; build = []; }
    const table = document.createElement('div');
    table.className = 'cv-table';

    /* ---- market + scores ---- */
    const top = document.createElement('div');
    top.className = 'cv-top';

    const market = document.createElement('div');
    market.className = 'cv-market';
    for (const id of state.market) {
      const wrap = document.createElement('div');
      wrap.className = 'cv-mcard';
      wrap.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id },
        { tag: 'div', static: true, eager: true }));
      wrap.appendChild(D.el('div', 'cv-mlabel',
        `${data.byId[D.baseId(id)].suits.map((s) => s[0].toUpperCase() + s.slice(1)).join('/')} `
        + (C.isCrown(id) ? 'pay' : 'cost')));
      market.appendChild(wrap);
    }
    top.appendChild(market);

    const scores = document.createElement('div');
    scores.className = 'cv-scores';
    for (const p of [0, 1]) {
      const row = document.createElement('span');
      row.innerHTML = `Player ${p + 1} · <b>${state.scores[p]}</b> · collected ${state.collected[p].length}`;
      row.classList.toggle('on', !state.over && state.turn === p);
      scores.appendChild(row);
    }
    scores.appendChild(D.el('span', 'cv-hand',
      `Hand ${state.handNo} of ${C.HANDS}`));
    top.appendChild(scores);
    table.appendChild(top);

    /* ---- the season so far ---- */
    const season = document.createElement('section');
    season.className = 'panel';
    const sh = document.createElement('h2');
    sh.innerHTML = state.phase === 'season-start'
      ? `New season<span class="count">Player ${state.turn + 1} opens</span>`
      : (state.phase === 'reply'
        ? `Final reply<span class="count">Player ${state.turn + 1}</span>`
        : `Beat this<span class="count">Player ${state.turn + 1} to answer</span>`);
    season.appendChild(sh);

    const log = document.createElement('div');
    log.className = 'cv-log';
    if (!state.seasonPlays.length) {
      log.appendChild(D.el('div', 'empty', state.over
        ? 'The match is over.'
        : 'Play a caravan to open the season — any run of numbers where neighbours share a suit.'));
    }
    for (const play of state.seasonPlays) {
      const line = document.createElement('div');
      line.className = 'cv-play';
      line.appendChild(D.el('span', 'cv-who', `Player ${play.player + 1}`));
      const cards = document.createElement('span');
      cards.className = 'cv-playcards';
      for (const id of play.ids) {
        cards.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id },
          { tag: 'div', static: true, cls: 'cv-mini' }));
      }
      line.appendChild(cards);
      line.appendChild(D.el('span', 'cv-desc', play.label));
      log.appendChild(line);
    }
    season.appendChild(log);
    table.appendChild(season);

    /* ---- the play being built ---- */
    if (!state.over && revealedState === state) {
      const bpanel = document.createElement('section');
      bpanel.className = 'panel';
      const bh = document.createElement('h2');
      bh.textContent = 'Build your play';
      bpanel.appendChild(bh);

      const strip = document.createElement('div');
      strip.className = 'cv-build';
      build.forEach((id, i) => {
        const c = D.cardEl({ ...data.byId[D.baseId(id)], id }, {
          tag: 'div', static: true, cls: 'cv-mini',
          badge: String(i + 1),
          onPick: () => { build = build.filter((x) => x !== id); api.refresh(); },
        });
        strip.appendChild(c);
      });
      if (!build.length) strip.appendChild(D.el('div', 'empty', 'Tap cards in play order.'));
      bpanel.appendChild(strip);

      const verdict = document.createElement('p');
      verdict.className = 'cv-verdict';
      const why = build.length ? C.explainPlay(state, build) : null;
      if (!build.length) {
        verdict.textContent = state.phase === 'season-start'
          ? 'A caravan needs at least one number card (2–9); Aces and Crowns may stand in for numbers.'
          : `Answer with a higher caravan (${state.last.label}) or any bandit — or pass.`;
      } else if (why) {
        verdict.textContent = why;
        verdict.classList.add('is-bad');
      } else {
        const p = C.describePlay(build);
        verdict.textContent = `Ready: ${p.label}.`;
        verdict.classList.add('is-ok');
      }
      bpanel.appendChild(verdict);

      const actions = document.createElement('div');
      actions.className = 'btnrow';
      actions.appendChild(btn('Play', !build.length, () => doPlay(state)));
      if (C.canPass(state)) actions.appendChild(btn('Pass', false, () => doPass(state)));
      if (build.length) actions.appendChild(btn('Clear', false, () => { build = []; api.refresh(); }));
      bpanel.appendChild(actions);
      table.appendChild(bpanel);
    }

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
      hand.forEach((id) => {
        const picked = build.indexOf(id);
        row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
          cls: picked >= 0 ? 'is-selected' : '',
          badge: picked >= 0 ? String(picked + 1) : null,
          onPick: (c) => onTap(state, c.id),
          disabled: state.over,
        }));
      });
      if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards.'));
    } else {
      row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
    }
    panel.appendChild(row);
    table.appendChild(panel);

    /* ---- last season / last hand notes ---- */
    if (state.lastSeason && !state.seasonPlays.length) {
      const n = document.createElement('p');
      n.className = 'cv-note';
      n.innerHTML = `Last season: <b>Player ${state.lastSeason.collector + 1}</b> collected `
        + `${state.lastSeason.cards} card${state.lastSeason.cards === 1 ? '' : 's'}.`;
      table.appendChild(n);
    }
    if (state.lastHand) {
      const n = document.createElement('p');
      n.className = 'cv-note';
      n.innerHTML = handSummary(state.lastHand);
      table.appendChild(n);
    }

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- status + subtitle ---- */
    api.setSubtitle(state.over ? 'the match is over' : statusTitle(state));
    api.setStatus(statusText(state));

    /* ---- the hand-off ---- */
    if (!state.over && revealedState !== state) {
      passDevice(state.turn + 1, () => {
        revealedState = api.state;
        buildFor = api.state;
        api.refresh();
      });
    }
  },

  endOf(state) {
    if (!state.over) return null;
    const w = state.winner;
    return {
      title: w == null ? 'The match is a draw' : `Player ${w + 1} wins Caravan`,
      cls: 'win',
      body: `<p>Five hands of trading between Jacynth and the Valley.</p>
             <p class="muted">Final: Player 1 — ${state.scores[0]} · Player 2 — ${state.scores[1]}</p>`,
    };
  },

  record: (state) => ({ played: state.over ? 1 : 0, win: null, score: null }),
});

/* --------------------------------------------------------------- helpers */

function btn(label, disabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function statusTitle(state) {
  if (state.phase === 'season-start') return `Player ${state.turn + 1} opens a season`;
  if (state.phase === 'reply') return `Player ${state.turn + 1} may finish the hand`;
  return `Player ${state.turn + 1} to answer`;
}

function statusText(state) {
  if (state.over) return '<strong>The match is over.</strong> Start a new game when ready.';
  const name = `Player ${state.turn + 1}`;
  if (state.phase === 'season-start') {
    return `${name} opens a trade season with a caravan. `
      + `Tap cards in order, then <strong>Play</strong>.`;
  }
  if (state.phase === 'reply') {
    return `${name} played their last card — one play to finish the season `
      + `against ${state.last.label}, or <strong>Pass</strong>.`;
  }
  return `${name} must beat ${state.last.label} with a higher caravan or a bandit — `
    + `or <strong>Pass</strong>.`;
}

function fmt(n) { return n >= 0 ? `+${n}` : `${n}`; }

function handSummary(lh) {
  const parts = [`Hand ${lh.handNo} done:`];
  if (lh.out != null) {
    parts.push(`Player ${lh.out + 1} went out (+${lh.bonus[lh.out]}`
      + `${lh.leftover[1 - lh.out] ? `, ${lh.leftover[1 - lh.out]} cards left over` : ''}).`);
  } else {
    parts.push('Neither could open a season.');
  }
  parts.push(`Goods: Player 1 ${fmt(lh.goods[0])}, Player 2 ${fmt(lh.goods[1])}.`);
  parts.push(`Totals: ${lh.total[0]} – ${lh.total[1]}.`);
  return `<b>${parts[0]}</b> ${parts.slice(1).join(' ')}`;
}

function onTap(state, id) {
  if (state.over || revealedState !== state) return;
  if (build.includes(id)) build = build.filter((x) => x !== id);
  else build.push(id);
  api.refresh();
}

function doPlay(state) {
  const why = C.explainPlay(state, build);
  if (why) { api.setStatus(why, true); D.toast(why); return; }
  const ids = build.slice();
  build = [];
  revealedState = null;
  api.pushHistory();
  api.setState(C.play(state, ids));
}

function doPass(state) {
  build = [];
  revealedState = null;
  api.pushHistory();
  api.setState(C.pass(state));
}

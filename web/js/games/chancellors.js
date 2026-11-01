/* Chancellors — UI.  Two players, one device: hands are hidden behind a
   pass-the-device screen whenever the player who must act changes. */

import { mountGame, D, passDevice } from '../gamikit.js';
import * as C from './chancellors-core.js';

const data = await D.loadDeck();
C.init(data.byId);

let revealedFor = null;      // whose hand may be on screen right now
let passShown = false;
let lastSig = '';
let selected = [];           // cards tapped for a solve
let pendingPart = null;      // { pi } while picking which die to set aside

const api = mountGame({
  id: 'chancellors',
  title: 'Chancellors',
  subtitle: 'control the services, solve the problems',
  rules: '../rules/chancellors.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),

  render(state, api) {
    const act = C.actor(state);
    const sig = `${state.seed}:${state.moves}:${state.phase}:${act}`;
    if (sig !== lastSig) { lastSig = sig; selected = []; pendingPart = null; }

    const table = D.el('div', 'chan-table');

    /* ---- the services ---- */
    const svcRow = D.el('div', 'chan-services');
    for (const svc of state.services) {
      const wrap = D.el('div', 'chan-service');
      const id = svc.id;
      wrap.appendChild(D.cardEl({ ...data.byId[id], id }, {
        tag: 'div', static: true, eager: true,
        badge: svc.holder == null ? 'centre' : `P${svc.holder + 1}`,
      }));
      const meta = D.el('div', 'chan-svcname', svc.name);
      wrap.appendChild(meta);
      svcRow.appendChild(wrap);
    }
    table.appendChild(svcRow);

    /* ---- the problems ---- */
    const problems = D.el('section', 'panel');
    const ph = D.el('h2', '', 'Problems');
    ph.appendChild(D.el('span', 'count', `${state.problems.length} at a time`));
    problems.appendChild(ph);
    state.problems.forEach((prob, i) => {
      const row = D.el('div', 'chan-problem');
      row.appendChild(D.el('span', 'chan-probname', `Problem ${i + 1}`));
      row.appendChild(D.el('span', 'chan-dice', C.describeProblem(prob)));
      const st = D.el('span', 'chan-probstate', '');
      if (prob.status === 'solved') st.textContent = `solved by P${prob.solver + 1}`;
      else if (prob.status === 'partial') st.textContent = 'partly solved';
      else st.textContent = state.phase === 'service' || state.phase === 'open' ? 'open' : '';
      row.appendChild(st);
      problems.appendChild(row);
    });
    table.appendChild(problems);

    /* ---- scores, deck, discard ---- */
    const info = D.el('div', 'chan-info');
    const scores = D.el('div', 'chan-scores');
    for (let p = 0; p < 2; p++) {
      const s = D.el('span', act === p && !state.over ? 'on' : '');
      s.innerHTML = `Player ${p + 1} · <b>${state.scores[p]}</b>`;
      scores.appendChild(s);
    }
    info.appendChild(scores);
    info.appendChild(D.el('div', 'chan-target', `Turn ${state.turn} · first to ${C.TARGET} — a 6-and-6 sacks you both`));
    const piles = D.el('div', 'chan-piles');
    piles.appendChild(pileEl('deck', state.draw.length));
    piles.appendChild(pileEl('discard', state.discard.length));
    info.appendChild(piles);
    table.appendChild(info);

    /* ---- the reveal ---- */
    if (state.phase === 'reveal' && state.reveal) {
      const box = D.el('div', 'chan-reveal');
      const played = D.el('div', 'chan-played');
      state.reveal.cards.forEach((id, p) => {
        const w = D.el('div', 'chan-playedcard');
        w.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, { tag: 'div', static: true, eager: true }));
        w.appendChild(D.el('div', 'chan-byline', `Player ${p + 1}`));
        played.appendChild(w);
      });
      box.appendChild(played);
      for (const e of state.reveal.entries) box.appendChild(D.el('div', 'chan-revent', e.text));
      table.appendChild(box);
    }

    /* ---- actions ---- */
    const actions = D.el('div', 'btnrow');
    if (!state.over && state.phase === 'reveal') {
      actions.appendChild(btn('Continue', true, () => commit(() => C.endReveal(state))));
    } else if (!state.over && act != null && revealedFor === act) {
      buildActions(state, act, actions);
    }
    table.appendChild(actions);

    /* ---- hands ---- */
    if (state.over) {
      table.appendChild(handPanel('Player 1’s hand', state.hands[0], state, null));
      table.appendChild(handPanel('Player 2’s hand', state.hands[1], state, null));
    } else if (act == null) {
      // between phases: nothing to see
    } else if (revealedFor === act) {
      table.appendChild(handPanel(`Player ${act + 1}’s hand`, state.hands[act], state, act));
    } else {
      table.appendChild(handPanel(`Player ${act + 1}’s hand`, null, state, null));
    }

    api.table.textContent = '';
    api.table.appendChild(table);

    /* ---- chrome ---- */
    api.setSubtitle(state.over
      ? (state.over === 'catastrophe' ? 'the kingdom collapsed' : 'the game is over')
      : state.phase === 'reveal' ? 'the bids are revealed'
        : `Player ${act + 1} to play · turn ${state.turn}`);
    api.setStatus(statusText(state, act));

    /* ---- the hand-off ---- */
    if (!state.over && act != null && revealedFor !== act && !passShown) showPass(act, api);
  },

  endOf(state) {
    if (!state.over) return null;
    const [a, b] = state.scores;
    const line = `<p class="muted">Player 1 — ${a} · Player 2 — ${b}</p>`;
    if (state.over === 'catastrophe') {
      const w = state.winner;
      return {
        title: C.OUTCOME.catastrophe.title,
        cls: C.OUTCOME.catastrophe.cls,
        score: Math.max(a, b),
        body: `<p>A problem escalated to 6 and 6. The King decides you are all terrible
               counselors and sacks the lot of you — <strong>the lowest score wins</strong>.</p>` +
          (w == null ? `<p>Dead heat: the King cannot decide who to keep.</p>` : `<p><strong>Player ${w + 1} wins.</strong></p>`) + line,
      };
    }
    const w = state.winner;
    return {
      title: w == null ? 'The King cannot choose' : `Player ${w + 1} wins`,
      cls: C.OUTCOME.score.cls,
      score: Math.max(a, b),
      body: `<p>${C.TARGET} or more points: the winner is named Lord High Chancellor.</p>` +
        (w == null ? `<p>Level scores — the matter is settled by fisticuffs, off screen.</p>`
          : `<p><strong>Player ${w + 1} becomes Lord High Chancellor.</strong></p>`) + line,
    };
  },

  record: (state) => ({ played: 1, win: null, score: Math.max(...state.scores) }),
});

/* --------------------------------------------------------------- helpers */

function btn(label, enabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.disabled = !enabled;
  b.addEventListener('click', onClick);
  return b;
}

function pileEl(label, n) {
  const d = document.createElement('div');
  d.className = 'pile' + (n === 0 ? ' is-empty' : '');
  d.innerHTML = `<span class="n">${n}</span><small>${label}</small>`;
  return d;
}

function commit(fn) {
  try {
    const next = fn();
    api.pushHistory();
    api.setState(next);
    return true;
  } catch (e) {
    api.setStatus(e.message, true);
    return false;
  }
}

function buildActions(state, act, actions) {
  const open = (i) => state.problems[i].status === 'open';
  if (state.phase === 'control') {
    const note = D.el('div', 'chan-note', 'Secretly tap one card — it is discarded after the reveal.');
    actions.appendChild(note);
    return;
  }
  if (state.phase === 'trim') {
    const left = state.hands[act].length - C.HAND_CAP;
    actions.appendChild(D.el('div', 'chan-note',
      `Discard down to six — tap ${left} card${left === 1 ? '' : 's'} in your hand.`));
    return;
  }
  if (state.phase === 'service') {
    state.problems.forEach((prob, i) => {
      if (!open(i)) return;
      const sum = C.total(prob);
      actions.appendChild(btn(`Solve problem ${i + 1} fully (${sum}+)`, selected.length > 0,
        () => commit(() => C.serviceSolveFull(state, i, selected.slice()))));
      if (selected.length === 1) {
        actions.appendChild(btn(`Solve problem ${i + 1} in part`, true,
          () => { pendingPart = { pi: i }; api.refresh(); }));
      }
    });
    if (pendingPart && open(pendingPart.pi)) {
      const pi = pendingPart.pi;
      const prob = state.problems[pi];
      prob.dice.forEach((v, d) => {
        actions.appendChild(btn(`Set aside the ${v}`, true,
          () => { pendingPart = null; commit(() => C.serviceSolvePart(state, pi, selected[0], d)); }));
      });
    }
    actions.appendChild(btn('Pass', true, () => commit(() => C.servicePass(state, false))));
    actions.appendChild(btn('Pass & abdicate', true, () => commit(() => C.servicePass(state, true))));
    return;
  }
  if (state.phase === 'open') {
    state.problems.forEach((prob, i) => {
      if (!open(i)) return;
      const need = 2 * C.total(prob);
      actions.appendChild(btn(`Solve problem ${i + 1} (needs ${need}+)`, selected.length > 0,
        () => commit(() => C.openSolveFull(state, i, selected.slice()))));
    });
    actions.appendChild(btn('Pass', true, () => commit(() => C.openPass(state))));
  }
}

function handPanel(title, hand, state, viewer) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = title;
  if (hand) h.appendChild(D.el('span', 'count', `${hand.length} cards`));
  panel.appendChild(h);

  const row = document.createElement('div');
  row.className = 'cardrow';
  if (hand) {
    for (const id of hand) {
      const isSel = selected.includes(id);
      row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
        cls: isSel ? 'is-selected' : (state.phase === 'service' || state.phase === 'open' ? 'is-legal' : ''),
        badge: isSel ? '✓' : null,
        onPick: (c) => onHandTap(state, viewer, c.id),
        disabled: false,
      }));
    }
    if (!hand.length) row.appendChild(D.el('div', 'empty', 'No cards.'));
  } else {
    row.appendChild(D.el('div', 'empty', 'Hidden until this player is ready.'));
  }
  panel.appendChild(row);
  return panel;
}

function onHandTap(state, viewer, id) {
  if (state.over || viewer == null) return;
  if (state.phase === 'control') {
    commit(() => C.selectControl(state, id));
    return;
  }
  if (state.phase === 'trim') {
    commit(() => C.trimDiscard(state, id));
    return;
  }
  if (state.phase === 'service' || state.phase === 'open') {
    const i = selected.indexOf(id);
    if (i >= 0) selected.splice(i, 1);
    else selected.push(id);
    pendingPart = null;
    api.refresh();
  }
}

function statusText(state, act) {
  if (state.over === 'catastrophe') return '<strong>The kingdom is in serious trouble.</strong> Lowest score wins.';
  if (state.over === 'score') return '<strong>The game is over.</strong> Highest score wins.';
  if (state.phase === 'reveal') {
    return state.reveal.entries.map((e) => e.text).join(' ');
  }
  if (state.phase === 'control') {
    return `Player ${act + 1}: secretly tap one card to influence the services.`;
  }
  if (state.phase === 'service') {
    const svc = C.currentService(state);
    const meta = C.SERVICES.find((m) => m.key === svc.key);
    return `Player ${act + 1} holds the ${meta.name} (${data.byId[svc.id].suits.map((s) => D.SUIT_NAME[s]).join(' and ')}): ` +
      `solve a problem with matching cards, or pass.`;
  }
  if (state.phase === 'open') {
    const i = state.problems.findIndex((p) => p.status === 'open');
    const need = i >= 0 ? 2 * C.total(state.problems[i]) : 0;
    return `Player ${act + 1} controls no service: solve a whole problem — cards must total at least twice the dice${i >= 0 ? ` (problem ${i + 1} needs ${need}+)` : ''} — or pass.`;
  }
  if (state.phase === 'trim') {
    return `Player ${act + 1}: your hand is over six cards — discard down to six.`;
  }
  return state.notes[state.notes.length - 1] || '';
}

function showPass(p, api) {
  passShown = true;
  passDevice(p + 1, () => {
    revealedFor = p;
    passShown = false;
    api.refresh();
  });
}

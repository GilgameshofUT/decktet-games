/* Dueling Runes — UI.  The rules live in dueling-runes-core.js. */

import { mountGame, D, panel } from '../gamikit.js';
import * as C from './dueling-runes-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const HP_CHOICES = [12, 8, 5, 1];
let playerHp = D.getSetting('dueling-runes.hp', 8);
if (!HP_CHOICES.includes(playerHp)) playerHp = 8;

let sel = [];                 // card ids chosen for the reveal, in play order
let special = null;           // 'counter' | 'mirror' | null
let draft = [];               // energies, per revealed card, per activation rune

const api = mountGame({
  id: 'dueling-runes',
  title: 'Dueling Runes',
  subtitle: 'cast rune sequences at a rival mage',
  rules: '../rules/dueling-runes.html',
  newGame: (seed) => {
    sel = []; special = null; draft = [];
    return C.newGame(seed, [...data.basicDeck, ...data.extendedDeck], { playerHp });
  },

  render(state, api) {
    api.table.textContent = '';

    /* ---- your health, the d12 you start the duel with ---- */
    const hpRow = document.createElement('div');
    hpRow.className = 'dr-hprow';
    const hpLabel = document.createElement('label');
    hpLabel.className = 'dr-hplabel';
    hpLabel.textContent = 'Your health: ';
    const hpSel = document.createElement('select');
    hpSel.className = 'dr-hpsel';
    for (const n of HP_CHOICES) {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = String(n);
      if (n === state.hpChoice) o.selected = true;
      hpSel.appendChild(o);
    }
    hpSel.addEventListener('change', () => changeHp(state, Number(hpSel.value)));
    hpLabel.appendChild(hpSel);
    const hpHint = document.createElement('span');
    hpHint.className = 'dr-hphint';
    hpHint.textContent = 'the wiki suggests fewer hit points for the solo player';
    hpRow.append(hpLabel, hpHint);
    api.table.appendChild(hpRow);

    /* ---- the two mages ---- */
    api.table.appendChild(magePanel(state, 'foe', 'Rival mage'));
    api.table.appendChild(magePanel(state, 'you', 'You'));

    /* ---- the turn ---- */
    if (state.over) {
      renderLog(state, api);
      hintEl('The duel is over — start a new game from the top bar.', api);
      api.setStatus(
        `You <strong>${state.you.hp}</strong> · rival <strong>${state.foe.hp}</strong>` +
        ` · turns <strong>${state.turn - 1}</strong> · deck <strong>${state.deck.length}</strong>`);
      return;
    }

    if (state.phase === 'casting') renderCasting(state, api);
    else renderChoosing(state, api);

    renderLog(state, api);

    const rec = api.records();
    api.setStatus(
      `You <strong>${state.you.hp}</strong> · rival <strong>${state.foe.hp}</strong>` +
      ` · turn <strong>${state.turn}</strong> · deck <strong>${state.deck.length}</strong>` +
      (rec.played ? ` · wins <strong>${rec.won}/${rec.played}</strong>` : ''));
  },

  endOf(state) {
    if (!state.over) return null;
    const o = C.OUTCOME[state.over];
    return {
      title: o.title,
      cls: o.cls,
      body: `<p>${o.text}</p><p class="muted">The duel lasted ${state.turn - 1} turn${state.turn - 1 === 1 ? '' : 's'}` +
        ` — you finish on ${state.you.hp} HP, the rival on ${state.foe.hp}.</p>`,
    };
  },

  record(state) {
    return { win: state.over === 'won', score: null };
  },
});

/* ---------------------------------------------------------------- pieces */

function magePanel(state, who, title) {
  const p = state[who];
  const sec = document.createElement('section');
  sec.className = 'panel dr-mage';
  sec.dataset.who = who;

  const h = document.createElement('h2');
  h.textContent = title;
  const hp = document.createElement('span');
  hp.className = 'dr-hp' + (p.hp <= 3 ? ' is-low' : '');
  hp.innerHTML = `${p.hp}<small>/${p.maxHp}</small>`;
  hp.title = `${p.hp} of ${p.maxHp} hit points (a d12 used as a counter)`;
  h.appendChild(hp);
  sec.appendChild(h);

  if (p.status.length) {
    const chips = document.createElement('div');
    chips.className = 'dr-chips';
    for (const s of p.status) {
      const c = document.createElement('span');
      c.className = 'dr-chip' + (s.pending ? ' is-pending' : '');
      c.textContent = `${C.SPELL_NAME[s.name] || s.name} ${s.turns}`;
      c.title = s.pending
        ? `starts next turn, lasts ${s.turns} turn${s.turns === 1 ? '' : 's'}`
        : `${s.turns} turn${s.turns === 1 ? '' : 's'} left`;
      chips.appendChild(c);
    }
    sec.appendChild(chips);
  }

  const seq = document.createElement('div');
  seq.className = 'dr-seq';
  if (!p.seq.length) {
    const empty = document.createElement('span');
    empty.className = 'dr-seqempty';
    empty.textContent = 'no runes in play';
    seq.appendChild(empty);
  }
  for (const e of p.seq) {
    seq.appendChild(D.cardEl({ ...data.byId[D.baseId(e.id)], id: e.id }, {
      tag: 'div', static: true, faceDown: e.down, cls: 'dr-seqcard',
    }));
  }
  sec.appendChild(seq);

  const runes = document.createElement('div');
  runes.className = 'dr-runes';
  const counts = C.visibleRunes(state, who);
  for (const s of [...C.ENERGY, ...C.ACTIVATION]) {
    if (!counts[s]) continue;
    const chip = document.createElement('span');
    chip.className = 'dr-rune';
    chip.appendChild(D.suitChip(s));
    chip.appendChild(document.createTextNode(`${C.RUNE_NAME[s]} ×${counts[s]}`));
    runes.appendChild(chip);
  }
  sec.appendChild(runes);

  return sec;
}

function renderLog(state, api) {
  if (!state.log.length) return;
  const p = panel('Spell log');
  p.row.className = 'dr-log';
  for (const line of state.log.slice(-7).reverse()) {
    const li = document.createElement('div');
    li.className = 'dr-logline';
    li.textContent = line;
    p.row.appendChild(li);
  }
  api.table.appendChild(p.section);
}

function hintEl(text, api) {
  const p = document.createElement('p');
  p.className = 'dr-hint';
  p.textContent = text;
  api.table.appendChild(p);
  return p;
}

/* ------------------------------------------------- phase: choose your card */

function renderChoosing(state, api) {
  const confused = C.anyStatus(state, 'you', 'confusion');
  const need = C.playNeed(state, 'you');

  if (confused && !state.confused) {
    const box = document.createElement('div');
    box.className = 'dr-confused';
    box.innerHTML = '<strong>You are Confused</strong> — your card is drawn at random.';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn primary';
    b.textContent = '🎲 Draw your card';
    b.addEventListener('click', () => {
      try {
        const next = C.confusedDraw(state, 1);
        api.pushHistory();
        api.setState(next);
      } catch (err) { api.toast(err.message, 4000); }
    });
    box.appendChild(b);
    api.table.appendChild(box);
    return;
  }

  if (state.confused) {
    const box = document.createElement('div');
    box.className = 'dr-confused';
    const card = D.cardEl({ ...data.byId[D.baseId(state.confused.card)], id: state.confused.card },
      { tag: 'div', static: true, eager: true, cls: 'dr-drawcard' });
    const info = document.createElement('div');
    info.className = 'dr-confused-text';
    info.innerHTML = `Confused — you drew <strong>${D.describe(data.byId[D.baseId(state.confused.card)])}</strong> at random.`;
    const row = document.createElement('div');
    row.className = 'btnrow';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn primary';
    play.textContent = 'Play this card';
    play.addEventListener('click', () => revealNow(state));
    row.appendChild(play);
    if (!state.confused.redrawn) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn';
      again.textContent = '🎲 Draw again (once)';
      again.addEventListener('click', () => {
        try {
          const next = C.confusedDraw(state, 2);
          api.pushHistory();
          api.setState(next);
        } catch (err) { api.toast(err.message, 4000); }
      });
      row.appendChild(again);
    }
    info.appendChild(row);
    box.append(card, info);
    api.table.appendChild(box);
    return;
  }

  /* special spells, paid from the hand */
  const rest = state.you.hand.filter((id) => !sel.includes(id));
  const spec = panel('Special spells');
  spec.row.className = 'dr-specials';
  for (const kind of ['counter', 'mirror']) {
    const eligible = C.specialEligible(rest, kind);
    const cost = eligible ? C.specialCost(rest, kind) : null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'iconbtn';
    b.setAttribute('aria-pressed', String(special === kind));
    b.textContent = C.SPELL_NAME[kind];
    b.disabled = !eligible && special !== kind;
    if (!eligible) b.title = `needs ${kind === 'counter' ? 'two' : 'all three'} different activation runes in hand`;
    else b.title = `discards ${cost.cards.map((id) => D.describe(data.byId[id])).join(' and ')}`;
    b.addEventListener('click', () => {
      if (!eligible) { api.toast(`Your hand cannot pay for ${C.SPELL_NAME[kind]}.`, 3000); return; }
      special = special === kind ? null : kind;
      api.refresh();
    });
    spec.row.appendChild(b);
  }
  const note = document.createElement('span');
  note.className = 'dr-specialnote';
  note.textContent = special
    ? `will discard ${C.specialCost(rest, special).cards.map((id) => data.byId[D.baseId(id)].name).join(' + ')}`
    : 'cast from your hand instead of your sequence';
  spec.row.appendChild(note);
  api.table.appendChild(spec.section);

  /* your hand */
  const hand = panel('Your hand', count(String(state.you.hand.length)));
  for (const id of state.you.hand) {
    const chosen = sel.includes(id);
    hand.row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, {
      selected: chosen,
      dim: sel.length > 0 && !chosen,
      onPick: () => pickCard(state, id),
    }));
  }
  api.table.appendChild(hand.section);

  /* reveal */
  const bar = document.createElement('div');
  bar.className = 'btnrow dr-action';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn primary';
  btn.textContent = `Reveal ${sel.length > 1 || need > 1 ? `(${sel.length}/${need})` : 'and cast'}`;
  btn.addEventListener('click', () => revealNow(state));
  bar.appendChild(btn);
  api.table.appendChild(bar);

  hintEl(sel.length
    ? (need > 1
      ? `Haste! Tap a second card — the first card resolves in the extra mini-turn.`
      : 'Tap Reveal: both cards come out at once, then you pick the spells.')
    : C.hasStatus(state, 'you', 'haste')
      ? 'You are Hasted: pick 2 cards — the first resolves in an extra mini-turn before the regular turn.'
      : `Tap a card to play it${need > 1 ? ` (you play ${need})` : ''}. Special spells are optional.`, api);
}

function pickCard(state, id) {
  if (state.over) return;
  if (C.anyStatus(state, 'you', 'confusion')) {
    api.toast('You are Confused — your card is drawn at random.', 3000);
    return;
  }
  const need = C.playNeed(state, 'you');
  if (sel.includes(id)) {
    sel = sel.filter((x) => x !== id);
  } else if (sel.length >= need) {
    api.toast(need > 1
      ? `Haste lets you play ${need} cards this turn — you already picked ${sel.length}.`
      : 'You play one card per turn. Tap a selected card to swap it out.', 3200);
    return;
  } else {
    sel = [...sel, id];
  }
  // keep the special only if the hand can still pay for it
  const rest = state.you.hand.filter((x) => !sel.includes(x));
  if (special && !C.specialEligible(rest, special)) special = null;
  api.refresh();
}

function revealNow(state) {
  if (state.over) return;
  const confused = C.anyStatus(state, 'you', 'confusion');
  if (confused && !state.confused) { api.toast('Draw your confused card first.', 3000); return; }
  const cards = confused ? [state.confused.card] : sel;
  try {
    const next = C.reveal(state, { you: cards, youSpecial: special });
    api.pushHistory();            // one undo step per turn, from before the reveal
    const planned = C.bestPlan(next, next.pending.you);
    draft = planned.map((p) => p.map((c) => c.energy));
    sel = [];
    special = null;
    api.setState(next);
    const foe = next.pending.foe.map((id) => D.describe(data.byId[D.baseId(id)])).join(' and ');
    api.toast(`The rival plays ${foe}.`, 2600);
  } catch (err) {
    api.toast(err.message, 4200);
  }
}

/* ------------------------------------------------ phase: choose your spells */

function renderCasting(state, api) {
  const counts = C.visibleRunes(state, 'you');
  const pending = state.pending;

  /* both cards are out */
  const shown = document.createElement('div');
  shown.className = 'dr-revealed';
  for (const [who, title] of [['you', 'You play'], ['foe', 'Rival plays']]) {
    const row = document.createElement('div');
    row.className = 'dr-revealed-row';
    const lab = document.createElement('span');
    lab.className = 'dr-revealed-label';
    lab.textContent = title;
    row.appendChild(lab);
    for (const id of pending[who]) {
      row.appendChild(D.cardEl({ ...data.byId[D.baseId(id)], id }, { tag: 'div', static: true, eager: who === 'you' }));
    }
    if (pending[who + 'Special']) {
      const sp = document.createElement('span');
      sp.className = 'dr-chip is-special';
      sp.textContent = C.SPELL_NAME[pending[who + 'Special']];
      row.appendChild(sp);
    }
    shown.appendChild(row);
  }
  api.table.appendChild(shown);

  /* one row per activation rune */
  ensureDraft(state);
  const castPanel = panel('Your spells', count(String(castsOf(pending))));
  castPanel.row.className = 'dr-casts';
  pending.you.forEach((id, ci) => {
    const acts = C.activationsOf(id);
    acts.forEach((act, ai) => {
      const usedElsewhere = new Set();
      draft.forEach((row, ri) => row.forEach((e, rj) => {
        if ((ri !== ci || rj !== ai) && e) usedElsewhere.add(e);
      }));
      const options = C.energyOptions(counts, usedElsewhere);
      if (!options.includes(draft[ci][ai])) draft[ci][ai] = options[0];

      const row = document.createElement('div');
      row.className = 'dr-cast';
      const rune = document.createElement('span');
      rune.className = 'dr-cast-rune';
      rune.appendChild(D.suitChip(act));
      rune.appendChild(document.createTextNode(C.RUNE_NAME[act]));
      row.appendChild(rune);

      const opts = document.createElement('div');
      opts.className = 'dr-opts';
      for (const e of options) {
        const info = C.castInfo(act, e, counts);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dr-opt';
        b.setAttribute('aria-pressed', String((draft[ci][ai] || '') === e));
        b.textContent = info.amount > 1 ? `${info.name} ×${info.amount}` : info.name;
        if (e) {
          const ic = D.suitChip(e);
          ic.className = 'suit-inline dr-opt-suit';
          b.appendChild(ic);
        }
        b.title = `${info.name}${info.amount > 1 ? ` — ${info.amount} ${C.RUNE_NAME[e]}` : ''}`;
        b.addEventListener('click', () => {
          draft[ci][ai] = e;
          // one rune type powers one spell: clear any other row using it
          if (e) {
            draft.forEach((r, ri) => r.forEach((v, rj) => {
              if ((ri !== ci || rj !== ai) && v === e) r[rj] = '';
            }));
          }
          api.refresh();
        });
        opts.appendChild(b);
      }
      row.appendChild(opts);

      const info = C.castInfo(act, draft[ci][ai], counts);
      const tgt = document.createElement('span');
      tgt.className = 'dr-target';
      tgt.textContent = info.target === 'self' ? '→ you' : '→ rival';
      row.appendChild(tgt);
      castPanel.row.appendChild(row);
    });
  });
  api.table.appendChild(castPanel.section);

  const bar = document.createElement('div');
  bar.className = 'btnrow dr-action';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn primary';
  btn.textContent = 'Resolve the spells';
  btn.addEventListener('click', () => resolveNow(state));
  bar.appendChild(btn);
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn';
  back.textContent = '↺ Redo reveal';
  back.title = 'Undo the reveal and choose your card again';
  back.addEventListener('click', () => api.undo());
  bar.appendChild(back);
  api.table.appendChild(bar);

  hintEl('Effects resolve Moons first, then Wyrms, then Knots — the highest card goes first in each phase.', api);
}

function count(text) {
  const n = document.createElement('span');
  n.className = 'count';
  n.textContent = text;
  return n;
}

/** How many spells your reveal must choose: one per activation rune. */
function castsOf(pending) {
  return pending.you.reduce((n, id) => n + C.activationsOf(id).length, 0);
}

function ensureDraft(state) {
  const shape = state.pending.you.map((id) => C.activationsOf(id).length);
  const ok = Array.isArray(draft) && draft.length === shape.length
    && draft.every((row, i) => Array.isArray(row) && row.length === shape[i]);
  if (!ok) {
    draft = C.bestPlan(state, state.pending.you).map((p) => p.map((c) => c.energy));
  }
}

function resolveNow(state) {
  const plan = state.pending.you.map((id, i) =>
    C.activationsOf(id).map((act, j) => ({ act, energy: draft[i][j] || '' })));
  const used = new Set();
  for (const row of plan) {
    for (const c of row) {
      if (!c.energy) continue;
      if (used.has(c.energy)) {
        api.toast(`Each rune type powers one spell per turn — pick one ${C.RUNE_NAME[c.energy]} spell.`, 3600);
        return;
      }
      used.add(c.energy);
    }
  }
  try {
    draft = [];
    api.setState(C.resolveTurn(state, plan));
  } catch (err) {
    api.toast(err.message, 4200);
  }
}

/* ---------------------------------------------------------------- misc */

async function changeHp(state, n) {
  if (n === state.hpChoice) return;
  if (state.turn > 1 && !state.over) {
    const ok = await api.confirm({
      title: 'Start over at ' + n + ' HP?',
      message: 'Changing your health starts a new duel.',
      okLabel: 'New duel',
      danger: true,
    });
    if (!ok) return;
  }
  playerHp = n;
  D.setSetting('dueling-runes.hp', n);
  api.newGame(state.seed);         // same deal, new hit points
}

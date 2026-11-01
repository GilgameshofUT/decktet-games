import { loadDeck, url, registerSW, records, loadGame } from './decktet.js';

const GAMES = [
  {
    id: 'adaman',
    title: 'Adaman',
    href: 'games/adaman.html',
    rules: 'rules/adaman.html',
    thumb: 'cards/web/the-author.webp',
    blurb: 'Buy, trick or eliminate everyone who might stand between you and the throne.',
    meta: ['1 player', '~5 minutes', 'solitaire'],
  },
  {
    id: 'jacynth',
    title: 'Jacynth',
    href: 'games/jacynth.html',
    rules: 'rules/jacynth.html',
    thumb: 'cards/web/the-window.webp',
    blurb: 'Lay out a city of cards and claim as many districts as you can control.',
    meta: ['1 player', 'solitaire variant', 'territory'],
  },
  {
    id: 'gongor-whist',
    title: 'Gongor Whist',
    href: 'games/gongor-whist.html',
    rules: 'rules/gongor-whist.html',
    thumb: 'cards/web/the-huntress.webp',
    blurb: 'A trick-taking game against a dummy hand, with a trump you can change at will.',
    meta: ['1 player', 'quick', 'trick-taking'],
  },
];

function recordLine(id) {
  const saved = loadGame(id);
  const inProgress = !!saved && !(saved.state?.over || saved.over);
  const r = records(id);
  const bits = [];
  if (inProgress) bits.push('<span class="tag">in progress</span>');
  if (r.played) {
    if (r.won != null) {
      const rate = r.played ? Math.round((100 * r.won) / r.played) : 0;
      bits.push(`<span class="tag plain">${r.won}/${r.played} won · ${rate}%</span>`);
    } else {
      bits.push(`<span class="tag plain">played ${r.played}</span>`);
    }
  }
  return bits.join('');
}

async function main() {
  await loadDeck();

  const list = document.getElementById('gamelist');
  list.textContent = '';
  for (const g of GAMES) {
    const a = document.createElement('a');
    a.className = 'gamecard';
    a.href = url(g.href);
    a.innerHTML = `
      <img class="thumb" src="${url(g.thumb)}" alt="" width="750" height="1050" loading="lazy" decoding="async">
      <div style="flex:1;min-width:0">
        <h2>${g.title}</h2>
        <p>${g.blurb}</p>
        <div class="meta">
          ${g.meta.map((m) => `<span class="tag">${m}</span>`).join('')}
          ${recordLine(g.id)}
        </div>
      </div>
      <div style="color:var(--gold);font-size:20px" aria-hidden="true">›</div>`;
    list.appendChild(a);
  }

  registerSW();

  // install prompt
  let deferred = null;
  const btn = document.getElementById('install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (btn) btn.hidden = false;
  });
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      btn.hidden = true;
    });
  }
}

main().catch((err) => {
  console.error(err);
  const list = document.getElementById('gamelist');
  if (list) list.innerHTML = `<div class="empty">Could not load the deck: ${err.message}</div>`;
});

import { loadDeck, url, registerSW, records, loadGame } from './decktet.js';

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

function gameCard(g) {
  if (g.planned) {
    return `
      <div class="gamecard is-planned" aria-disabled="true">
        <img class="thumb" src="${url(g.thumb)}" alt="" width="750" height="1050" loading="lazy" decoding="async">
        <div style="flex:1;min-width:0">
          <h2>${g.title}</h2>
          <p>${g.blurb}</p>
          <div class="meta">
            ${g.meta.map((m) => `<span class="tag">${m}</span>`).join('')}
            <span class="tag plain">coming soon</span>
          </div>
        </div>
      </div>`;
  }
  return `
    <a class="gamecard" href="${url(g.href)}">
      <img class="thumb" src="${url(g.thumb)}" alt="" width="750" height="1050" loading="lazy" decoding="async">
      <div style="flex:1;min-width:0">
        <h2>${g.title}</h2>
        <p>${g.blurb}</p>
        <div class="meta">
          ${g.meta.map((m) => `<span class="tag">${m}</span>`).join('')}
          ${recordLine(g.id)}
        </div>
      </div>
      <div style="color:var(--gold);font-size:20px" aria-hidden="true">›</div>
    </a>`;
}

async function main() {
  await loadDeck();

  const res = await fetch(url('games.json'), { cache: 'no-cache' });
  if (!res.ok) throw new Error('cannot read games.json');
  const catalogue = await res.json();

  const list = document.getElementById('gamelist');
  list.textContent = '';

  for (const section of catalogue.sections) {
    const games = catalogue.games.filter((g) => g.section === section.id);
    if (!games.length) continue;

    const h = document.createElement('h2');
    h.className = 'sectionhead';
    h.innerHTML = `${section.title}<span class="sub">${section.blurb}</span>`;
    list.appendChild(h);

    const wrap = document.createElement('div');
    wrap.className = 'gamelist';
    wrap.innerHTML = games.map(gameCard).join('');
    list.appendChild(wrap);
  }

  registerSW();

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

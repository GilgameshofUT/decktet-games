# Adding a game

Every game in this app is built the same way. Follow this contract and the
home page, the service worker, the tests and the deploy all pick the game up
without anyone editing shared files.

## What one game adds

**Read the exemplar first**: `web/js/games/window.js`,
`web/js/games/window-core.js`, `web/games/window.html`,
`web/css/window.css`, `web/rules/window.html` and `test/window.test.mjs`.
Copy that shape.

| File | Required | Purpose |
|---|---|---|
| `web/js/games/<id>-core.js` | yes | the rules: pure functions, no DOM, node-testable |
| `web/js/games/<id>.js` | yes | the UI: draws the table, wires taps, calls `mountGame` |
| `web/games/<id>.html` | yes | 15-line page shell |
| `web/css/<id>.css` | if needed | only this game's layout (grid, track, chips…) |
| `web/rules/<id>.html` | yes | a faithful copy of the official rules, offline |
| `test/<id>.test.mjs` | yes | headless tests of the core |

`<id>` is the registry id in `web/games.json` (e.g. `tinker-sailor-soldier-spy`).
The save key, the record key, the file names and the registry id are all the
same string.

**Never edit** `web/games.json`, `web/sw.js`, `web/index.html`,
`web/js/decktet.js`, `web/js/gamikit.js`, `web/js/app.css` or another game's
files. The home page entry is flipped from `planned` to live by the integrator
when your work lands. If you genuinely need something shared, put it in your own
`css/<id>.css` or your own module and say so in your report.

## The page

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#113a2b">
<meta name="mobile-web-app-capable" content="yes">
<title>Window</title>
<link rel="manifest" href="../manifest.webmanifest">
<link rel="icon" href="../icons/icon-192.png" sizes="192x192" type="image/png">
<link rel="stylesheet" href="../css/app.css">
<link rel="stylesheet" href="../css/window.css">   <!-- optional -->
</head>
<body>
<main id="table"></main>
<script type="module" src="../js/games/window.js"></script>
</body>
</html>
```

`mountGame` builds the top bar, the status line and the table container, so the
page body really is just that one `<main>`.

## The module

```js
import { mountGame, D } from '../gamikit.js';
import * as C from './window-core.js';

const data = await D.loadDeck();
C.init(data.byId);

const api = mountGame({
  id: 'window',                       // save key, record key, file names
  title: 'Window',
  subtitle: 'a 3×3 merging puzzle',
  rules: '../rules/window.html',
  newGame: (seed) => C.newGame(seed, data.basicDeck),
  render: (state, api) => { /* draw into api.table */ },
  endOf: (state) => state.over
    ? { title: 'You win', cls: 'win', score: C.score(state), body: '<p>…</p>' }
    : null,
  record: (state, result) => ({ win: result.title.startsWith('You win'), score: result.score ?? null }),
});
```

What `mountGame` gives you back: `api.state`, `api.table`, `api.status`,
`api.setSubtitle(text)`, `api.setStatus(html, isError)`, `api.setState(next)`,
`api.pushHistory()`, `api.refresh()`, `api.save()`, `api.undo()`,
`api.newGame()`, `api.toast()`, `api.overlay()`, `api.confirm()`,
`api.records()`, `api.over`.

* **Mutating state** — build the next state in the core (a fresh object), then
  `api.pushHistory()` and `api.setState(next)`. Never mutate `api.state`
  in place.

* **Undo** — call `api.pushHistory()` *before* you mutate state (clone the old
  state first). Ctrl/Cmd-Z and the Undo button then work for free.
* **Save** — happens automatically on undo/new; call `api.save()` after each
  move so a reload resumes exactly.
* **End of game** — set `state.over` (a truthy string is fine: `'won'`,
  `'lost'`) and `endOf` returns the dialog. It is shown once; the record is
  written once.
* **Status line** — `api.setStatus('…')` after every action; say what just
  happened and what to do next.

## The core (`<id>-core.js`)

Pure logic, no `document`, no `localStorage`, no `Date.now()` (take a seed).

```js
import { mulberry32, rankValue, deckIds, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];   // handles two-deck ids

export function newGame(seed, deck) { … }        // returns plain JSON state
export function applyMove(state, …) { … }        // returns a NEW state
```

Rules:

* state = plain JSON: arrays of card **instance** ids, numbers, strings,
  booleans. `structuredClone` and `JSON.parse(JSON.stringify(x))` must survive
  a round trip.
* two-deck games (Myrmex, Kittyhawk) use instance ids `"<id>#2"`; look cards up
  with `card()`/`baseId()` and the art still resolves.
* `rankValue(card)` is the official rank: Ace 1 … 9, Crown 10. Suit order in
  `manifest.json` is `moons, suns, waves, leaves, daemons, crowns`.
* never throw on legal play; throw on an illegal one (tests assert that).

## Rules page (`web/rules/<id>.html`)

Copy the wiki text faithfully — the whole page, not a summary. Keep the
structure of `web/rules/adaman.html`: top bar with Home and Play links, an
`<img class="rulethumb">` of a card, the sections as `<h2>`, and a
`.credit` block at the end that names **P.D. Magnus**, links
`https://wiki.decktet.com/game:<slug>`, and states **CC BY-NC-SA 3.0**.
Where you had to interpret an ambiguous rule, add a short
"Note on this implementation" paragraph — that is expected and welcome.

## Tests (`test/<id>.test.mjs`)

Run with `node test/<id>.test.mjs`, exit 0, no dependencies beyond node.
At minimum:

1. **invariants over ≥300 seeds** — card conservation (no card created or
   lost), legal setup sizes, no illegal state (e.g. duplicate card, hand larger
   than allowed).
2. **every rule branch** — one focused test per rule you implemented,
   including illegal moves (must throw or be refused).
3. **full random playouts** — a scripted random legal player reaches `over`
   every time within a sane move limit, and the final score matches an
   independently computed expectation.
4. **scoring fixtures** — at least two hand-built states whose score you can
   compute on paper.

Print one line of useful output (e.g. average score) before the pass line.

## Emulating extra material

* **dice** — a `rollDie()`/`rollDice(n)` in the core taking `rng`, and a button
  in the UI showing the result; keep the roll in state so reload is stable.
* **chips / tokens** — counters in state, drawn as `.badge`-style marks or
  numbered chips; use the suit icons from `cards/icons/suits/<suit>.png`.
* **score pad / pen & paper** — an on-screen table or a running total in the
  status line.
* **two Decktetts** — instance ids as above; say "two decks" in the UI.

## Two-player pass-and-play

**Exemplar**: `web/js/games/bharg.js` + `bharg-core.js` — a complete hidden-hand
game (hand-off screen, bound/unbound marks, rounds and a match target).

* One device, alternating turns. Your hand is visible only to the player whose
  turn it is: after each turn show `passDevice(player, onReady, { names })`
  from `gamikit.js`, which covers the screen until they tap **Reveal**.
* Keep each player's hand in state as usual; the interstitial is the only
  privacy you get, and it is enough.
* Say whose turn it is in the status line and in the top bar subtitle
  (`api.header.querySelector('.sub')` or pass `subtitle` and update it).
* No hidden information can be peeked at: don't render the opponent's hand
  face-up anywhere, including in dialogs or the DOM of a "review" screen.

## Verification before you report

```sh
node test/<id>.test.mjs      # your tests, exit 0
node test/assets.test.mjs    # still passes (registry + links intact)
```

Then in the browser tool, at a **390×844 mobile viewport**:

1. open `http://localhost:8090/games/<id>.html` — no console errors;
2. play several turns, including an illegal move (should explain itself);
3. reload mid-game — the game resumes;
4. reach the end — the dialog and the record work, **New game** restarts;
5. check there is no horizontal scrolling.

Report: files created, test output, screenshots paths, and every rule you had
to interpret.

# Decktet

Printable Decktet cards cut into individual graphic assets, plus a mobile-first,
installable web app that plays solitaire Decktet games: **Adaman**, **Jacynth**
(solitaire variant) and **Gongor Whist**.

Cards and rules are by P.D. Magnus, offered under
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).

## Layout

```
decktet/
├── scripts/            asset pipeline (python + pillow/numpy venv in .venv)
│   ├── detect_cards.py   find the 45 card rectangles on each sheet
│   ├── extract_cards.py  cut them out, knock out the paper outside the corners
│   ├── analyze_cards.py  read each card's rank glyph and suit pips
│   ├── build_manifest.py web/cards/manifest.json + suit/rank icons
│   └── build_icons.py    PWA icons
├── src/                rendered sheets (300 dpi), rects/pips analysis, debug montages
├── web/                ← the app; this is the server document root
│   ├── index.html        home / game picker
│   ├── gallery.html      browse all 45 cards
│   ├── games/*.html      one page per game
│   ├── js/decktet.js     shared library (deck data, card UI, storage, dialogs)
│   ├── js/games/*-core.js  pure game logic (node-testable, no DOM)
│   ├── js/games/*.js     UI wiring
│   ├── rules/*.html      a full copy of each game's official rules, offline
│   ├── cards/            the assets: cards/<id>.png (750×1050), cards/web/*.webp,
│   │                     cards/thumb/*.webp, icons/suits, icons/ranks, manifest.json
│   ├── manifest.webmanifest  PWA manifest
│   └── sw.js             service worker (offline shell + cached cards)
└── test/*.test.mjs      headless rule tests: node test/adaman.test.mjs
```

## The cards

45 cards were cut from `~/Downloads/decktet.pdf` (6 letter sheets, 2.5″×3.5″ cards):

| | |
|---|---|
| Basic deck | 36 cards — 6 aces, 24 number cards (ranks 2–9), 6 crowns (rank 10) |
| Extended deck | 9 cards — the Excuse, 4 Pawns, 4 Courts |
| Personalities | the 11 portrait cards of the basic deck (what Adaman is about) |

Each card is stored three ways: `cards/<id>.png` (full 750×1050 with the paper
outside the rounded corners cut away), `cards/web/<id>.webp` (480 px, what the
app loads) and `cards/thumb/<id>.webp` (144 px). `cards/manifest.json` holds the
metadata the games need: id, name, rank, suits, deck, and personality/portrait
flags — suits and ranks were read off the artwork itself, not typed by hand.

Re-run the pipeline (needs `.venv` with pillow + numpy):

```sh
python3 scripts/detect_cards.py      # → src/rects.json
python3 scripts/extract_cards.py     # → web/cards/*.png|webp
python3 scripts/analyze_cards.py     # → src/pips.json + src/debug/glyphs.png
python3 scripts/build_manifest.py    # → web/cards/manifest.json (validated)
python3 scripts/build_icons.py       # → web/icons/*
```

`build_manifest.py` refuses to write if the deck does not come out as a real
Decktet (36 + 9 cards, 11 personalities, correct number of suit pips per rank).

## Running the app

```sh
python3 -m http.server 8090 --directory web --bind 0.0.0.0   # or: npm run serve
```

Then open `http://localhost:8090/` on this machine, or
`http://192.168.86.3:8090/` (or the tailscale address) from another device on
the network.

### Installing it on a phone (LAN, plain HTTP)

Android Chrome only offers “Add to Home screen” for apps served over a secure
context. On the phone:

1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add
   `http://192.168.86.3:8090` (or your tailscale address), set it to *Enabled*
   and relaunch Chrome.
2. Open the app, tap ⋮ → **Add to Home screen** (or the install button on the
   home page).

With the flag set, the service worker registers, the app caches itself and the
cards, and it keeps working offline. Serving `web/` from any HTTPS host (GitHub
Pages, Netlify, a reverse proxy) needs no flag at all.

## Tests

```sh
npm test        # assets + links + the three rule suites
```

`test/assets.test.mjs` checks that all 45 cards exist at every size, that the
suit/rank icons are there, that every relative link in every page resolves, and
that the service worker only precaches files that exist.

Each game keeps its rules in a `*-core.js` module with no DOM, so the rules can
be exercised headlessly: invariants over thousands of seeds, full random
playouts, scoring fixtures, and a refusal of illegal moves.

## Status

- **Adaman** — implemented, rules copy at `web/rules/adaman.html`.
- **Jacynth** (solitaire, 4×4) — implemented, rules at `web/rules/jacynth.html`.
- **Gongor Whist** — implemented, both scoring systems, rules at `web/rules/gongor-whist.html`.

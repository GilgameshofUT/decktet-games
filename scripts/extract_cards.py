#!/usr/bin/env python3
"""Cut the individual cards out of the rendered decktet.pdf pages.

For every rectangle found by detect_cards.py we crop the card, knock out the
white paper outside the rounded corners (so the card can sit on any table
colour), and write:
  cards/<slug>.png        full resolution (750 x 1050 @ 300dpi), alpha
  cards/web/<slug>.webp   480px wide, for the PWA
  cards/thumb/<slug>.webp 144px wide, for lists / narrow phones
"""
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RECTS = ROOT / "src" / "rects.json"
PAGES = ROOT / "src" / "pages"
OUT_PNG = ROOT / "web" / "cards"
OUT_WEB = ROOT / "web" / "cards" / "web"
OUT_THUMB = ROOT / "web" / "cards" / "thumb"

WHITE = 250

# Order matters: it is the reading order of the printed sheets.
CARDS = [
    # page 1 - the six aces
    (1, "ace-of-moons"), (1, "ace-of-suns"), (1, "ace-of-waves"),
    (1, "ace-of-leaves"), (1, "ace-of-daemons"), (1, "ace-of-crowns"),
    # page 2
    (2, "the-author"), (2, "the-origin"), (2, "the-savage"), (2, "the-battle"),
    (2, "the-desert"), (2, "the-painter"), (2, "the-journey"), (2, "the-sailor"),
    # page 3
    (3, "the-mountain"), (3, "the-soldier"), (3, "the-penitent"), (3, "the-market"),
    (3, "the-discovery"), (3, "the-forest"), (3, "the-lunatic"), (3, "the-castle"),
    # page 4
    (4, "the-chance-meeting"), (4, "the-betrayal"), (4, "the-mill"), (4, "the-merchant"),
    (4, "the-cave"), (4, "the-diplomat"), (4, "the-pact"), (4, "the-darkness"),
    # page 5 - crowns (rank 10) then the Excuse
    (5, "the-huntress"), (5, "the-bard"), (5, "the-windfall"),
    (5, "the-end"), (5, "the-calamity"), (5, "the-sea"), (5, "the-excuse"),
    # page 6 - pawns and courts of the extended deck
    (6, "the-watchman"), (6, "the-harvest"), (6, "the-consul"), (6, "the-window"),
    (6, "the-borderland"), (6, "the-light-keeper"), (6, "the-rite"), (6, "the-island"),
]


def knock_out_corners(rgba):
    """Make the paper outside the card's rounded border transparent."""
    px = rgba.load()
    w, h = rgba.size
    seen = [[False] * h for _ in range(w)]
    q = deque()
    for cx, cy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if px[cx, cy][0] >= WHITE and not seen[cx][cy]:
            seen[cx][cy] = True
            q.append((cx, cy))
    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny] and px[nx, ny][0] >= WHITE:
                seen[nx][ny] = True
                q.append((nx, ny))
    return rgba


def main():
    rects = {r["page"]: r["rects"] for r in json.loads(RECTS.read_text())}
    for d in (OUT_PNG, OUT_WEB, OUT_THUMB):
        d.mkdir(parents=True, exist_ok=True)

    pages = {n: Image.open(PAGES / f"page-{n}.png").convert("RGB")
             for n in range(1, 7)}
    index = {}
    for page_no, slug in CARDS:
        box = rects[f"page-{page_no}.png"].pop(0)
        card = pages[page_no].crop(tuple(box))
        card = knock_out_corners(card.convert("RGBA"))
        card.save(OUT_PNG / f"{slug}.png", optimize=True)
        web = card.resize((480, 672), Image.LANCZOS)
        web.save(OUT_WEB / f"{slug}.webp", quality=88, method=6)
        thumb = card.resize((144, 202), Image.LANCZOS)
        thumb.save(OUT_THUMB / f"{slug}.webp", quality=85, method=6)
        index[slug] = {"page": page_no, "box": box,
                       "size": [card.size[0], card.size[1]]}
        print(f"page {page_no}  {slug:22s} {box}  {card.size}")

    leftover = {p: r["rects"] for p, r in rects.items() if r}
    if leftover:
        print(f"WARNING: unclaimed rectangles: {leftover}")
        return 1
    (ROOT / "src" / "cards.json").write_text(json.dumps(index, indent=2))
    print(f"cut {len(index)} cards")
    return 0


if __name__ == "__main__":
    sys.exit(main())

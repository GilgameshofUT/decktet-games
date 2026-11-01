#!/usr/bin/env python3
"""Assemble cards/manifest.json from the card cuts, the index analysis and the
transcribed rank glyphs, and cut the little suit / rank icons used by the UI.

Validation is strict: the numbers have to come out as a real Decktet
(36 basic cards + 9 extended cards, 11 personalities in the basic deck).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_cards import knock_out_corners  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "web" / "cards"
ICONS = CARDS / "icons"

SUITS = ["moons", "suns", "waves", "leaves", "daemons", "crowns"]
SUIT_COLOR = {
    "moons": [199, 200, 202],
    "suns": [247, 144, 30],
    "waves": [132, 182, 226],
    "leaves": [187, 137, 93],
    "daemons": [85, 185, 86],
    "crowns": [240, 236, 107],
}
SUIT_NAME = {
    "moons": "Moons", "suns": "Suns", "waves": "Waves",
    "leaves": "Leaves", "daemons": "Daemons", "crowns": "Crowns",
}

# rank glyph read off src/debug/glyphs.png (None = no glyph: aces, the Excuse)
RANK = {
    "the-author": 2, "the-bard": "crown", "the-battle": 4, "the-betrayal": 8,
    "the-borderland": "pawn", "the-calamity": "crown", "the-castle": 7,
    "the-cave": 7, "the-chance-meeting": 7, "the-consul": "court",
    "the-darkness": 9, "the-desert": 2, "the-diplomat": 8, "the-discovery": 5,
    "the-end": "crown", "the-forest": 5, "the-harvest": "pawn",
    "the-huntress": "crown", "the-island": "court", "the-journey": 3,
    "the-light-keeper": "pawn", "the-lunatic": 6, "the-market": 6,
    "the-merchant": 9, "the-mill": 8, "the-mountain": 4, "the-origin": 2,
    "the-pact": 9, "the-painter": 3, "the-penitent": 6, "the-rite": "court",
    "the-sailor": 4, "the-savage": 3, "the-sea": "crown", "the-soldier": 5,
    "the-watchman": "pawn", "the-windfall": "crown", "the-window": "court",
}

# the basic deck's eleven portraits: the people Adaman is about
PERSONALITIES = [
    "the-author", "the-savage", "the-painter", "the-sailor", "the-soldier",
    "the-penitent", "the-lunatic", "the-merchant", "the-diplomat",
    "the-huntress", "the-bard",
]

EXTENDED_PORTRAITS = ["the-watchman", "the-consul", "the-light-keeper"]

PAGE_OF = {}
for line in """
ace-of-moons:1 ace-of-suns:1 ace-of-waves:1 ace-of-leaves:1 ace-of-daemons:1 ace-of-crowns:1
the-author:2 the-origin:2 the-savage:2 the-battle:2 the-desert:2 the-painter:2 the-journey:2 the-sailor:2
the-mountain:3 the-soldier:3 the-penitent:3 the-market:3 the-discovery:3 the-forest:3 the-lunatic:3 the-castle:3
the-chance-meeting:4 the-betrayal:4 the-mill:4 the-merchant:4 the-cave:4 the-diplomat:4 the-pact:4 the-darkness:4
the-huntress:5 the-bard:5 the-windfall:5 the-end:5 the-calamity:5 the-sea:5 the-excuse:5
the-watchman:6 the-harvest:6 the-consul:6 the-window:6 the-borderland:6 the-light-keeper:6 the-rite:6 the-island:6
""".split():
    slug, page = line.split(":")
    PAGE_OF[slug] = int(page)


def suit_of(color):
    return min(SUITS, key=lambda s: sum(
        (a - b) ** 2 for a, b in zip(SUIT_COLOR[s], color)))


def bbox_of_ink(rgb, y0, y1, x0=6, x1=130):
    seg = rgb[y0:y1 + 1, x0:x1]
    ink = (seg.mean(axis=2) < 245)
    cols = np.where(ink.any(axis=0))[0]
    rows = np.where(ink.any(axis=1))[0]
    if not len(cols) or not len(rows):
        return None
    return (x0 + cols[0], y0 + rows[0], x0 + cols[-1] + 1, y0 + rows[-1] + 1)


def save_icon(rgb, box, path, pad=6):
    x0, y0, x1, y1 = box
    crop = rgb[max(y0 - pad, 0):y1 + pad, max(x0 - pad, 0):x1 + pad]
    icon = knock_out_corners(Image.fromarray(crop).convert("RGBA"))
    icon.save(path, optimize=True)
    return icon.size


def main():
    analysis = json.loads((ROOT / "src" / "pips.json").read_text())
    cards = {}
    for slug in sorted(PAGE_OF):
        png = CARDS / f"{slug}.png"
        if not png.exists():
            print(f"MISSING {png}")
            return 1
        rgb = np.asarray(Image.open(png).convert("RGB"))
        entry = analysis[slug]
        pips = [p for p in entry["pips"] if p["y"][1] - p["y"][0] + 1 >= 40]
        suits = [suit_of(p["color"]) for p in pips]

        if slug.startswith("ace-of-"):
            rank = 1
        elif slug == "the-excuse":
            rank = None
        else:
            rank = RANK[slug]

        if slug.startswith("the-"):
            name = "the " + slug[4:].replace("-", " ").title()
        else:
            name = "Ace of " + slug[7:].title()

        cards[slug] = {
            "id": slug,
            "name": name,
            "rank": rank,
            "suits": suits,
            "page": PAGE_OF[slug],
            "deck": ("extended" if PAGE_OF[slug] == 6 or slug == "the-excuse"
                     else "basic"),
            "portrait": slug in PERSONALITIES or slug in EXTENDED_PORTRAITS,
            "personality": slug in PERSONALITIES,
        }

    # ---- validation ------------------------------------------------------
    basic = [c for c in cards.values() if c["deck"] == "basic"]
    extended = [c for c in cards.values() if c["deck"] == "extended"]
    errors = []
    if len(basic) != 36:
        errors.append(f"basic deck has {len(basic)} cards, expected 36")
    if len(extended) != 9:
        errors.append(f"extended deck has {len(extended)} cards, expected 9")
    personalities = [c["id"] for c in cards.values() if c["personality"]]
    if sorted(personalities) != sorted(PERSONALITIES):
        errors.append("personality set mismatch")
    for c in cards.values():
        r = c["rank"]
        if r is None:
            want = 0                    # the Excuse
        elif r == "crown" or r == 1:
            want = 1                    # crown-rank cards and aces
        elif isinstance(r, int):
            want = 2                    # ranks 2..9
        else:
            want = 3                    # pawns and courts
        if len(c["suits"]) != want:
            errors.append(f"{c['id']}: {len(c['suits'])} suits, expected {want}")
        if len(set(c["suits"])) != len(c["suits"]):
            errors.append(f"{c['id']}: duplicate suits {c['suits']}")
    if errors:
        for e in errors:
            print("ERROR:", e)
        return 1

    # ---- icons -----------------------------------------------------------
    (ICONS / "suits").mkdir(parents=True, exist_ok=True)
    (ICONS / "ranks").mkdir(parents=True, exist_ok=True)
    suit_icon_size = {}
    for suit in SUITS:
        slug = f"ace-of-{suit}"
        rgb = np.asarray(Image.open(CARDS / f"{slug}.png").convert("RGB"))
        box = bbox_of_ink(rgb, *analysis[slug]["pips"][0]["y"])
        suit_icon_size[suit] = save_icon(rgb, box, ICONS / "suits" / f"{suit}.png")
    rank_icon_size = {}
    seen = set()
    for slug, rank in RANK.items():
        if rank in seen:
            continue
        seen.add(rank)
        rgb = np.asarray(Image.open(CARDS / f"{slug}.png").convert("RGB"))
        box = bbox_of_ink(rgb, *analysis[slug]["glyph"])
        name = str(rank)
        rank_icon_size[name] = save_icon(rgb, box, ICONS / "ranks" / f"{name}.png")

    manifest = {
        "source": "decktet.pdf (decktet-for-bgg01, P.D. Magnus 2008-10)",
        "license": "Decktet cards and wiki text: CC BY-NC-SA 3.0",
        "cardSize": {"width": 750, "height": 1050},
        "suits": [SUIT_NAME[s] for s in SUITS],
        "ranks": {"ace": 1, "crown": 10},
        "files": {"png": "cards/{id}.png", "web": "cards/web/{id}.webp",
                  "thumb": "cards/thumb/{id}.webp"},
        "icons": {"suits": suit_icon_size, "ranks": rank_icon_size},
        "cards": [{**cards[s],
                   "suits": sorted(cards[s]["suits"], key=SUITS.index)}
                  for s in sorted(cards)],
        "basicDeck": sorted(c["id"] for c in basic),
        "extendedDeck": sorted(c["id"] for c in extended),
        "personalities": sorted(PERSONALITIES),
    }
    (ROOT / "web" / "cards" / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"manifest: {len(cards)} cards "
          f"({len(basic)} basic + {len(extended)} extended), "
          f"{len(personalities)} personalities -> web/cards/manifest.json")
    print(f"suit icons: {suit_icon_size}")
    print(f"rank icons: {rank_icon_size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Read the index corners of every cut card: rank glyph + suit pips.

The left margin of a card carries, top to bottom, the rank glyph (absent on
aces) and one pip per suit. We split that margin into runs of ink, classify the
first run as glyph or pip by how dark it is, take the median colour of every
pip, and build a montage of the glyphs so the ranks can be transcribed.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "web" / "cards"
DEBUG = ROOT / "src" / "debug"

STRIP_X0 = 8         # skip the card's own border stroke
STRIP_Y0 = 20        # skip the top border stroke, keep the rank glyph
STRIP_W = 110        # left margin width; artwork frames start at x=122
STRIP_H = 430        # rank glyph + up to three pips live in this band
MAX_RUN = 115        # a pip/glyph run is never taller or wider than this
INK = 100            # below this a pixel counts as glyph ink


def runs_of_ink(strip):
    """Vertical runs (y0, y1) where the margin has ink."""
    rows = (strip < 245).any(axis=1).any(axis=1)
    out, start = [], None
    for y, r in enumerate(rows):
        if r and start is None:
            start = y
        elif not r and start is not None:
            if y - start > 8:
                out.append((start, y - 1))
            start = None
    if start is not None and len(rows) - start > 8:
        out.append((start, len(rows) - 1))
    # drop runs that are artwork poking into the margin, not an index element
    keep = []
    for y0, y1 in out:
        cols = np.where((strip[y0:y1 + 1] < 245).any(axis=2).any(axis=0))[0]
        if y1 - y0 <= MAX_RUN and len(cols) <= MAX_RUN:
            keep.append((y0, y1))
    return keep


def main():
    DEBUG.mkdir(parents=True, exist_ok=True)
    result = {}
    glyph_crops = []
    for png in sorted(CARDS.glob("*.png")):
        rgb = np.asarray(Image.open(png).convert("RGB"))
        strip = rgb[STRIP_Y0:STRIP_H, STRIP_X0:STRIP_X0 + STRIP_W]
        ink = runs_of_ink(strip)

        entry = {"glyph": None, "pips": []}
        for i, (y0, y1) in enumerate(ink):
            blob = strip[y0:y1 + 1]
            mask = (blob.mean(axis=2) < 245)
            px = blob[mask]
            non_black = px[px.mean(axis=1) >= INK]
            if i == 0 and (len(non_black) == 0 or
                           len(non_black) / len(px) < 0.25):
                # a rank glyph: pure black strokes, no coloured interior
                entry["glyph"] = [y0 + STRIP_Y0, y1 + STRIP_Y0]
                glyph_crops.append((png.stem, rgb[
                    max(y0 + STRIP_Y0 - 25, 0):y1 + STRIP_Y0 + 25,
                    0:STRIP_X0 + STRIP_W]))
            else:
                color = np.median(non_black, axis=0).astype(int).tolist() \
                    if len(non_black) else None
                entry["pips"].append({"y": [y0 + STRIP_Y0, y1 + STRIP_Y0],
                                      "color": color})
        result[png.stem] = entry
        print(f"{png.stem:22s} glyph={entry['glyph']} "
              f"pips={[p['color'] for p in entry['pips']]}")

    # montage of every rank glyph, in file order, for transcription
    cols = 8
    cw, ch = STRIP_X0 + STRIP_W, 140
    rows = (len(glyph_crops) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (cw + 10), rows * (ch + 26)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (name, crop) in enumerate(glyph_crops):
        x = (i % cols) * (cw + 10)
        y = (i // cols) * (ch + 26)
        c = Image.fromarray(crop).resize((cw, ch))
        sheet.paste(c, (x, y))
        draw.text((x + 2, y + ch + 4), f"{i}: {name}", fill="black")
    sheet.save(DEBUG / "glyphs.png")
    (ROOT / "src" / "pips.json").write_text(json.dumps(result, indent=2))
    print(f"wrote {DEBUG / 'glyphs.png'} and src/pips.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())

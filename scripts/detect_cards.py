#!/usr/bin/env python3
"""Detect the card rectangles on each rendered page of decktet.pdf.

Cards are rounded-rect outlines printed on white paper on a regular
2.5in x 3.5in grid. We collect every long dark line as a candidate edge, chain
candidates that are exactly one card width / height apart, and keep only the
rectangles whose four borders are genuinely continuous (artwork inside the card
makes long lines too, but they never reach the card's own edges).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "src" / "pages"
OUT = ROOT / "src" / "rects.json"

CARD_W_PT = 180.0   # 2.5in
CARD_H_PT = 252.0   # 3.5in
CAND_FRAC = 0.30    # candidate edge: this fraction of the longest dark run
BORDER_FRAC = 0.80  # a real card edge must be dark over this much of its length
K = 2               # analysis happens at half the render resolution


def profile_edges(mask, axis, frac=CAND_FRAC):
    profile = mask.sum(axis=axis)
    if profile.max() == 0:
        return []
    thr = profile.max() * frac
    above = profile >= thr
    runs, start = [], None
    for i, a in enumerate(above):
        if a and start is None:
            start = i
        elif not a and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(above) - 1))
    return [int(round((a + b) / 2)) for a, b in runs]


def cluster(values, gap):
    values = sorted(values)
    out, group = [], [values[0]]
    for v in values[1:]:
        if v - group[-1] <= gap:
            group.append(v)
        else:
            out.append(int(round(sum(group) / len(group))))
            group = [v]
    out.append(int(round(sum(group) / len(group))))
    return out


def chains(edges, step, tol):
    return [(a, b) for a in edges for b in edges
            if b > a and abs((b - a) - step) <= tol]


def edge_is_border(mask, x0, y0, x1, y1, vertical):
    """True when the segment is dark along (nearly) its whole length."""
    if vertical:                      # column x0..? over rows y0..y1
        strip = mask[y0:y1 + 1, max(x0 - 1, 0):x0 + 2]
        if strip.size == 0:
            return False
        return (strip.any(axis=1)).mean() >= BORDER_FRAC
    strip = mask[max(y0 - 1, 0):y0 + 2, x0:x1 + 1]
    if strip.size == 0:
        return False
    return (strip.any(axis=0)).mean() >= BORDER_FRAC


def detect(path):
    img = Image.open(path).convert("L")
    dpi = img.info.get("dpi", (300, 300))[0] or 300
    small = img.resize((img.width // K, img.height // K), Image.BILINEAR)
    mask = np.asarray(small) < 128

    w = int(round(CARD_W_PT * dpi / 72 / K))   # half-res px
    h = int(round(CARD_H_PT * dpi / 72 / K))

    xs = cluster(profile_edges(mask, axis=0), gap=4)
    ys = cluster(profile_edges(mask, axis=1), gap=4)

    rects = []
    for x0, x1 in chains(xs, w, w * 0.05):
        for y0, y1 in chains(ys, h, h * 0.05):
            ok = (edge_is_border(mask, x0, y0, x1, y0, False) and
                  edge_is_border(mask, x0, y1, x1, y1, False) and
                  edge_is_border(mask, x0, y0, x0, y1, True) and
                  edge_is_border(mask, x1, y0, x1, y1, True))
            if ok:
                rects.append([x0 * K, y0 * K, x1 * K, y1 * K])
    rects.sort(key=lambda r: (r[1], r[0]))
    return {"page": path.name, "dpi": dpi, "size": [img.width, img.height],
            "edges_x": [v * K for v in xs], "edges_y": [v * K for v in ys],
            "rects": rects}


def main():
    results, total = [], 0
    for page in sorted(PAGES.glob("page-*.png")):
        res = detect(page)
        results.append(res)
        total += len(res["rects"])
        print(f"{page.name}: {len(res['rects'])} cards")
        for r in res["rects"]:
            print(f"    {r}")
    print(f"total cards: {total}")
    OUT.write_text(json.dumps(results, indent=2))
    print(f"wrote {OUT}")
    return 0 if total == 45 else 1


if __name__ == "__main__":
    sys.exit(main())

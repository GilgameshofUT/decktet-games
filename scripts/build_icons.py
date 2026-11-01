#!/usr/bin/env python3
"""Build the PWA icons from an actual card face."""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "web" / "cards"
ICONS = ROOT / "web" / "icons"

BG = (18, 62, 42, 255)          # felt green
SOURCE = "ace-of-crowns.png"


def compose(size, card_frac, shadow=True):
    """Card centred on a solid background, scaled to `card_frac` of the size."""
    canvas = Image.new("RGBA", (size, size), BG)
    card = Image.open(CARDS / SOURCE).convert("RGBA")
    h = int(size * card_frac)
    w = int(card.width * h / card.height)
    card = card.resize((w, h), Image.LANCZOS)
    x = (size - w) // 2
    y = (size - h) // 2
    if shadow:
        sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        alpha = card.getchannel("A").point(lambda a: a * 55 // 100)
        sh.paste(Image.new("RGBA", card.size, (0, 0, 0, 255)),
                 (x + int(size * 0.012), y + int(size * 0.018)), alpha)
        sh = sh.filter(ImageFilter.GaussianBlur(size * 0.02))
        canvas = Image.alpha_composite(canvas, sh)
    canvas.alpha_composite(card, (x, y))
    return canvas


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("icon-192.png", compose(192, 0.76)),
        ("icon-512.png", compose(512, 0.76)),
        ("icon-maskable-512.png", compose(512, 0.58, shadow=False)),
        ("apple-touch-icon.png", compose(180, 0.74, shadow=False)),
    ]
    for name, img in jobs:
        img.save(ICONS / name, optimize=True)
        print(f"icons/{name}  {img.size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

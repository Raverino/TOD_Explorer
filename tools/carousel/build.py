"""Builds the social media carousel: 8 slides, 1080 × 1350, as one PDF (LinkedIn) and PNGs (Instagram).

Usage: python tools/carousel/build.py
First run `python tools/capture.py tools/carousel/shots "Utrecht, Netherlands" BAL` so the
screenshots exist. The slide texts live in carousel.html; slide 7 quotes numbers from that run,
so update them if the run gives different ones. Output goes to tools/carousel/out/."""
import pathlib
import sys

import pymupdf

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from chrome import Chrome  # noqa: E402

SHOTS, OUT = HERE / "shots", HERE / "out"
OUT.mkdir(exist_ok=True)


def crop(src, dst, box):
    """Saves the part `box` (x0, y0, x1, y1 in pixels) of a screenshot."""
    pix = pymupdf.Pixmap(str(SHOTS / src))
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    part = pymupdf.Pixmap(pix, pix.width, pix.height, pymupdf.IRect(*box))
    out = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, box[2] - box[0], box[3] - box[1]), False)
    part.set_origin(0, 0)
    out.copy(part, out.irect)
    out.save(str(SHOTS / dst))


# The whole game screen without the page footer, and the New transit panel on its own
# (pixel positions of a 1440 × 900 screenshot at 2×).
crop("02-growth.png", "c-growth.png", (0, 0, 2880, 1700))
crop("04-changes.png", "c-changes.png", (0, 0, 2880, 1700))
crop("05-transit.png", "c-transit.png", (1912, 176, 2840, 1500))

with Chrome(1080, 1350) as c:
    c.open((HERE / "carousel.html").as_uri(), wait=6)
    c.pdf(str(OUT / "TOD-Explorer-carousel.pdf"))

doc = pymupdf.open(str(OUT / "TOD-Explorer-carousel.pdf"))
for k, page in enumerate(doc):
    m = pymupdf.Matrix(1080 / page.rect.width, 1350 / page.rect.height)
    page.get_pixmap(matrix=m, alpha=False).save(str(OUT / f"TOD-Explorer-{k + 1}.png"))
print(len(doc), "slides in", OUT)

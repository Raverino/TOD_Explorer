"""Prints a real results page to PDF, as the Download PDF button does, to check page breaks.

Usage: python tools/print_report.py OUT_DIR [PLACE] [POLICY] [URL]
  defaults: "Vila Franca de Xira, Portugal", BAL, http://localhost:5173/

Saves report.pdf and one page-N.png per page, plus pages.png with all pages side by side.
Needs `pip install pymupdf` for the pictures."""
import os
import sys

import pymupdf

from chrome import NEXT, Chrome, build_city

out = sys.argv[1]
place = sys.argv[2] if len(sys.argv) > 2 else "Vila Franca de Xira, Portugal"
policy = sys.argv[3] if len(sys.argv) > 3 else "BAL"
url = sys.argv[4] if len(sys.argv) > 4 else "http://localhost:5173/"
os.makedirs(out, exist_ok=True)

with Chrome(1280, 900) as c:
    c.open(url)
    print(build_city(c, place))
    c.js(NEXT + f"""
      await sleep(2000); await go();
      document.querySelector('[data-strategy="{policy}"]').click(); await sleep(4000);
      await go(); document.getElementById('auto-stations').click(); await sleep(8000);
      await go(); await sleep(3000);
      window.print = () => {{}};
      document.querySelector('[data-pdf]').click(); await sleep(1500); return 1;""")
    c.pdf(f"{out}/report.pdf")

doc = pymupdf.open(f"{out}/report.pdf")
pages = [p.get_pixmap(dpi=55) for p in doc]
for k, pix in enumerate(pages):
    pix.save(f"{out}/page-{k + 1}.png")
sheet = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, sum(p.width + 10 for p in pages), pages[0].height), False)
sheet.clear_with(120)
x = 0
for p in pages:
    p.set_origin(x, 0)
    sheet.copy(p, p.irect)
    x += p.width + 10
sheet.save(f"{out}/pages.png")
print(len(pages), "pages")

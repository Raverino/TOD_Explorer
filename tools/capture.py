"""Plays the game once in headless Chrome and saves a screenshot of every step.

Usage: python tools/capture.py OUT_DIR [PLACE] [POLICY] [URL]
  PLACE   default "Utrecht, Netherlands"
  POLICY  BASE, IB, RETRO, BAL or CUSTOM (default BAL)
  URL     default http://localhost:5173/ (start `npm run dev` first)

Saves 01-pick … 06-results (1440 × 900 at 2×), 07-city (the city alone, transparent)
and 08-share (the share image)."""
import os
import sys

from chrome import NEXT, Chrome, build_city, save_data_url

out = sys.argv[1]
place = sys.argv[2] if len(sys.argv) > 2 else "Utrecht, Netherlands"
policy = sys.argv[3] if len(sys.argv) > 3 else "BAL"
url = sys.argv[4] if len(sys.argv) > 4 else "http://localhost:5173/"
os.makedirs(out, exist_ok=True)

with Chrome(1440, 900, 2, port=9334) as c:
    shot = lambda name: (c.screenshot(f"{out}/{name}.png"), print("saved", name))
    c.open(url)
    shot("01-pick")
    print(build_city(c, place))
    shot("02-growth")
    c.js(NEXT + f"""
      await go();
      document.querySelector('[data-strategy="{policy}"]').click(); await sleep(4000);
      const y = document.getElementById('year'); y.value = y.max;
      y.dispatchEvent(new Event('input', {{ bubbles: true }})); y.dispatchEvent(new Event('change', {{ bubbles: true }}));
      await sleep(6000); return 1;""")
    shot("03-policy-2050")
    c.js("document.querySelector('[data-overlay=\"changes\"]')?.click(); await sleep(2500); return 1;")
    shot("04-changes")
    c.js(NEXT + """document.querySelector('[data-overlay="none"]')?.click(); await sleep(1500);
      await go(); document.getElementById('auto-stations').click(); await sleep(8000); return 1;""")
    shot("05-transit")
    c.js(NEXT + "await go(); await sleep(2000); return 1;")
    shot("06-results")
    save_data_url(f"{out}/07-city.png", c.js("""window.print = () => {};
      document.querySelector('[data-pdf]').click(); await sleep(1500);
      return document.querySelector('.print-snap').src;"""))
    print("saved 07-city")
    save_data_url(f"{out}/08-share.png", c.js("""document.querySelector('.final-share [data-share]').click();
      for (let k = 0; k < 20 && document.getElementById('share-out').classList.contains('hidden'); k++) await sleep(1000);
      const img = document.querySelector('#share-out img');
      for (let k = 0; k < 20 && !img.naturalWidth; k++) await sleep(500);
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0); return cv.toDataURL('image/png');"""))
    print("saved 08-share")

# Tools

Helper scripts that drive the game in a headless Chrome. They are not part of the website.

Setup: Python 3 and `pip install websocket-client pymupdf`. Chrome is found in its usual place;
otherwise set `CHROME` to its path. Start the game first with `npm run dev`.

| Script | What it does |
|---|---|
| `chrome.py` | Shared helper: starts headless Chrome, runs JavaScript in the page, screenshots, PDF. |
| `capture.py OUT [PLACE] [POLICY]` | Plays the game once and saves a screenshot of every step, the city alone and the share image. |
| `print_report.py OUT [PLACE] [POLICY]` | Prints a real results page to PDF, like the Download PDF button, and renders every page, to check that nothing is split across pages. |
| `carousel/build.py` | Builds the 8-slide social media carousel (1080 × 1350) as a PDF and PNGs from `carousel/carousel.html` and the screenshots in `carousel/shots/`. |

Example, the carousel from scratch:

```
python tools/capture.py tools/carousel/shots "Utrecht, Netherlands" BAL
python tools/carousel/build.py
```


Screenshots and outputs (`carousel/shots/`, `carousel/out/`) are not committed.

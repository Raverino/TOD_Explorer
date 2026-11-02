"""Starts a headless Chrome and drives one page through the DevTools protocol.

Shared by the tools in this folder. Needs `pip install websocket-client`.
Set CHROME to the browser's path if it is not in a usual place."""
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request

import websocket

CANDIDATES = [
    os.environ.get("CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]


def find_chrome() -> str:
    for c in CANDIDATES:
        if c and os.path.exists(c):
            return c
    raise SystemExit("Chrome not found: set the CHROME environment variable to its path.")


class Chrome:
    """A headless browser with one page; use it in a `with` block."""

    def __init__(self, width=1280, height=900, scale=1, port=9333):
        self.size = (width, height, scale)
        self.port = port

    def __enter__(self):
        self.proc = subprocess.Popen(
            [find_chrome(), "--headless=new", f"--remote-debugging-port={self.port}",
             f"--user-data-dir={tempfile.mkdtemp()}", "--enable-unsafe-swiftshader", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json"))
                page = next(p for p in pages if p["type"] == "page")
                break
            except Exception:
                time.sleep(0.2)
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=600, suppress_origin=True)
        self.n = 0
        w, h, s = self.size
        self.cmd("Page.enable")
        self.cmd("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=s, mobile=False)
        return self

    def __exit__(self, *_):
        try:
            self.ws.close()
        finally:
            self.proc.kill()

    def cmd(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.n:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})

    def open(self, url, wait=4):
        self.cmd("Page.navigate", url=url)
        time.sleep(wait)

    def js(self, code):
        """Runs `code` as the body of an async function (with `sleep(ms)`) and returns its value."""
        r = self.cmd("Runtime.evaluate", awaitPromise=True, returnByValue=True,
                     expression=f"(async () => {{ const sleep = (t) => new Promise((r) => setTimeout(r, t)); {code} }})()")
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"])
        return r["result"].get("value")

    def screenshot(self, path):
        open(path, "wb").write(base64.b64decode(self.cmd("Page.captureScreenshot", format="png")["data"]))

    def pdf(self, path, print_media=True):
        if print_media:
            self.cmd("Emulation.setEmulatedMedia", media="print")
        data = self.cmd("Page.printToPDF", printBackground=True, preferCSSPageSize=True, displayHeaderFooter=False)["data"]
        open(path, "wb").write(base64.b64decode(data))


def save_data_url(path, url):
    open(path, "wb").write(base64.b64decode(url.split(",", 1)[1]))


# Steps of the game, as JavaScript run inside the page.
NEXT = "const go = async () => { const n = document.getElementById('next-step'); if (n && n.offsetParent) { n.click(); await sleep(3000); } };"


def build_city(c: Chrome, place: str):
    """Searches `place`, builds the cube city and waits until it is ready (step 2)."""
    return c.js(f"""
      const i = document.querySelector('input[type=search]'); i.value = {json.dumps(place)};
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Search').click();
      await sleep(4000);
      [...document.querySelectorAll('button')].find((b) => /Build cube city/.test(b.textContent)).click();
      await sleep(3000);
      for (let k = 0; k < 120 && (/…/.test(document.getElementById('status').textContent) || document.getElementById('city').classList.contains('hidden')); k++) await sleep(1000);
      await sleep(3000);
      return document.getElementById('status').textContent;""")

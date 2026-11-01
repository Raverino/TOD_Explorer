// Step 5: the results page, printable as a PDF report, plus a square-ish share image for social media.

import type { Insight, Question } from "./insights";

export interface FinalMetric {
  label: string;
  value: string;
  /** the change against the comparison, e.g. "▼ 0.02 t"; "0" when there is none */
  change: string;
  /** whether the change is an improvement; undefined when unchanged */
  good?: boolean;
  note: string;
}

export interface FinalData {
  place: string;
  strategy: string;
  tagline: string;
  year: number;
  growth: string;
  compareLabel: string;
  metrics: FinalMetric[];
  insights: Insight[];
  questions: Question[];
  references: string[];
  changesHtml: string;
  growthText: string;
  /** what the new stations did, empty without them */
  transitText: string;
  /** headline cards, TOD Standard table and indicators from the city screen */
  detailsHtml: string;
  tod: { principle: string; got: number; max: number }[];
  todScore: [number, number];
}

/** What the page needs from the 3D city. */
export interface CityHooks {
  /** moves the live 3D view into the element */
  mount: (el: HTMLElement) => void;
  zoom: (factor: number) => void;
  rotate: (radians: number) => void;
  reset: () => void;
  overlay: (mode: "none" | "changes") => void;
  /** the current view as a PNG data URL, cropped to the city */
  snapshot: () => Promise<string>;
  /** the current view, uncropped, synchronously (for printing) */
  snapshotNow: () => string;
}

/** Loads an image; the load event is used because img.decode() can stall in background tabs. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The city picture could not be made."));
    img.src = src;
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Renders the results page into `root`; `onBack` returns to the city. */
export function renderFinal(root: HTMLElement, data: FinalData, city: CityHooks, onBack: () => void) {
  const badge = (m: FinalMetric) => `<span class="delta ${m.good === undefined ? "same" : m.good ? "good" : "bad"}">${m.change}</span>`;
  const cite = (c?: string) => (c ? `<span class="cite">${esc(c)}</span>` : "");
  root.innerHTML = `
    <div class="final-bar">
      <button class="btn" data-back>← Back to the city</button>
      <div class="final-actions">
        <button class="btn" data-pdf>Download PDF</button>
        <button class="btn primary" data-share>Share your results</button>
      </div>
    </div>
    <article class="report" id="report">
      <header class="report-head">
        <span class="kicker">TOD Explorer · results</span>
        <h1><input id="final-place" value="${esc(data.place)}" aria-label="Place name" spellcheck="false" /></h1>
        <p><b>${esc(data.strategy)}</b> · ${data.year} · ${esc(data.growth)}. ${esc(data.tagline)}</p>
      </header>

      <div class="viewer">
        <div class="viewer-stage" data-stage></div>
        <img class="print-snap" alt="" />
        <div class="viewer-ui">
          <div class="seg" role="group" aria-label="Colours">
            <button data-ov="none" class="on">Land use</button>
            <button data-ov="changes">Changes</button>
          </div>
          <div class="seg" role="group" aria-label="Zoom">
            <button data-zoom="1.25" aria-label="Zoom in">+</button>
            <button data-zoom="0.8" aria-label="Zoom out">−</button>
            <button data-turn="-0.3927" aria-label="Turn left">↺</button>
            <button data-turn="0.3927" aria-label="Turn right">↻</button>
            <button data-reset>Reset</button>
          </div>
        </div>
        <p class="viewer-hint"><span class="mouse-only">Drag to turn the city, double-click and drag to move it, Ctrl + scroll or the buttons to zoom.</span><span class="touch-only">Two fingers move and zoom the city; ↺ ↻ turn it.</span> The share image and the PDF use this view.</p>
      </div>

      <div class="report-cards">
        ${data.metrics.map((m) => `<div class="report-card"><span>${m.label}</span><b>${m.value}</b>${badge(m)}</div>`).join("")}
      </div>
      <p class="muted small">Changes compared with ${esc(data.compareLabel)}.</p>

      <section>
        <h2>What this means</h2>
        <div class="insights">
          ${data.insights.map((i) => `<div class="insight ${i.tone}"><b>${esc(i.title)}</b><p>${esc(i.text)}</p>${cite(i.cite)}</div>`).join("")}
        </div>
      </section>

      <section>
        <h2>Questions to explore</h2>
        <div class="questions">
          ${data.questions.map((q) => `<details><summary>${esc(q.q)}</summary><p>${esc(q.a)} ${cite(q.cite)}</p></details>`).join("")}
        </div>
      </section>

      <details class="more">
        <summary>All the details</summary>
        <h3>What changed</h3>
        <div class="summary">${data.changesHtml}</div>
        ${data.growthText ? `<div class="summary">${data.growthText}</div>` : ""}
        ${data.transitText ? `<h3>New transit</h3><p class="summary">${data.transitText}</p>` : ""}
        <h3>TOD Standard: ${data.todScore[0]} of ${data.todScore[1]} points</h3>
        <div class="principle-bars">
          ${data.tod
            .map((t) => `<div><span>${t.principle}</span><i><em style="width:${t.max ? (t.got / t.max) * 100 : 100}%"></em></i><b>${t.max ? `${t.got} / ${t.max}` : "must pass"}</b></div>`)
            .join("")}
        </div>
        <div class="final-details">${data.detailsHtml}</div>
      </details>

      ${data.references.length ? `<section class="report-refs"><h2>Sources</h2><ol>${data.references.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></section>` : ""}

      <footer class="report-foot">
        Indicative only: a what-if from open data, not a forecast. Based on Dimas (2025), Modeling Transit-Oriented Development,
        University of Twente. Map data © OpenStreetMap contributors; population EU Census 2021 grid (© European Union) and GHS-POP R2023A (European Commission JRC).
        Made with TOD Explorer on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
      </footer>
    </article>
    <section class="final-share">
      <h2>Share your results</h2>
      <p class="muted">An image of your city with its key numbers, ready for social media.</p>
      <button class="btn primary big" data-share>Create share image</button>
    </section>
    <div class="share-out hidden" id="share-out">
      <img alt="Share image preview" />
      <div class="share-actions">
        <button class="btn primary" data-download>Download image</button>
        <button class="btn" data-native-share>Share…</button>
      </div>
    </div>`;

  city.mount(root.querySelector<HTMLElement>("[data-stage]")!);
  root.querySelectorAll<HTMLButtonElement>("[data-ov]").forEach((b) =>
    b.addEventListener("click", () => {
      root.querySelectorAll("[data-ov]").forEach((o) => o.classList.toggle("on", o === b));
      city.overlay(b.dataset.ov as "none" | "changes");
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((b) => b.addEventListener("click", () => city.zoom(Number(b.dataset.zoom))));
  root.querySelectorAll<HTMLButtonElement>("[data-turn]").forEach((b) => b.addEventListener("click", () => city.rotate(Number(b.dataset.turn))));
  root.querySelector("[data-reset]")!.addEventListener("click", city.reset);

  const place = () => root.querySelector<HTMLInputElement>("#final-place")!.value.trim() || "My city";
  root.querySelector("[data-back]")!.addEventListener("click", onBack);
  root.querySelector("[data-pdf]")!.addEventListener("click", () => {
    // The browser's print dialog saves the report as a PDF; the print styles show only the report,
    // with a still picture of the current view in place of the live 3D city.
    root.querySelector<HTMLImageElement>(".print-snap")!.src = city.snapshotNow();
    const title = document.title;
    document.title = `TOD Explorer - ${place()} ${data.year}`;
    root.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => (d.open = true));
    window.print();
    document.title = title;
  });

  let blob: Blob | undefined;
  const out = root.querySelector<HTMLElement>("#share-out")!;
  root.querySelectorAll("[data-share]").forEach((btn) => btn.addEventListener("click", async () => {
    blob = await shareImage({ ...data, place: place() }, await city.snapshot());
    out.querySelector("img")!.src = URL.createObjectURL(blob);
    out.classList.remove("hidden");
    const file = new File([blob], "city-of-the-future.png", { type: "image/png" });
    out.querySelector<HTMLElement>("[data-native-share]")!.classList.toggle("hidden", !navigator.canShare?.({ files: [file] }));
    out.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  out.querySelector("[data-download]")!.addEventListener("click", () => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `city-of-the-future-${place().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    a.click();
  });
  out.querySelector("[data-native-share]")!.addEventListener("click", () => {
    if (!blob) return;
    const file = new File([blob], "city-of-the-future.png", { type: "image/png" });
    navigator.share({ files: [file], title: "The city of the future", text: `${place()} in ${data.year} with ${data.strategy}. #CityOfTheFuture #TOD` }).catch(() => {});
  });
}

/** Draws a 1080 × 1350 (4:5, the Instagram portrait size) image of the result. */
async function shareImage(d: FinalData, snapshot: string): Promise<Blob> {
  await document.fonts.ready;
  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const ink = "#23262f", sun = "#f5c542", card = "#ffffff", muted = "#646a78";
  const head = (size: number) => `600 ${size}px Fredoka, system-ui, sans-serif`;
  const body = (size: number, weight = 500) => `${weight} ${size}px Inter, system-ui, sans-serif`;
  const box = (x: number, y: number, w: number, h: number, r: number, fill: string, shadow = true) => {
    if (shadow) {
      g.fillStyle = ink;
      g.beginPath();
      g.roundRect(x, y + 8, w, h, r);
      g.fill();
    }
    g.fillStyle = fill;
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
    g.stroke();
  };

  g.fillStyle = "#eef5e6";
  g.fillRect(0, 0, W, H);

  // Title
  g.fillStyle = ink;
  g.font = head(30);
  g.fillText("SHARE THE", 60, 92);
  g.font = head(76);
  g.fillText("City of the future", 60, 170);
  g.font = body(30, 600);
  const placeLine = `${d.place} · ${d.year}`;
  g.fillText(placeLine.length > 34 ? `${placeLine.slice(0, 33)}…` : placeLine, 60, 222);
  const tag = d.strategy;
  g.font = head(28);
  const tw = g.measureText(tag).width + 40;
  box(W - 60 - tw, 186, tw, 50, 25, sun, false);
  g.fillStyle = ink;
  g.fillText(tag, W - 60 - tw + 20, 220);

  // The cube city, fitted inside a sky-coloured card
  const cy = 262, ch = 600;
  box(60, cy, W - 120, ch, 28, "#e3f0f9");
  const img = await loadImage(snapshot);
  const scale = Math.min((W - 160) / img.width, (ch - 40) / img.height);
  const iw = img.width * scale, ih = img.height * scale;
  g.save();
  g.beginPath();
  g.roundRect(62, cy + 2, W - 124, ch - 4, 26);
  g.clip();
  g.drawImage(img, (W - iw) / 2, cy + (ch - ih) / 2, iw, ih);
  g.restore();

  // Four scores in a 2 × 2 grid
  const tiles = d.metrics.slice(0, 4);
  const tW = (W - 120 - 24) / 2, tH = 150, ty = cy + ch + 34;
  tiles.forEach((m, k) => {
    const x = 60 + (k % 2) * (tW + 24), y = ty + Math.floor(k / 2) * (tH + 24);
    box(x, y, tW, tH, 22, card);
    g.fillStyle = muted;
    g.font = body(24);
    g.fillText(m.label, x + 24, y + 42);
    g.fillStyle = ink;
    g.font = head(48);
    g.fillText(m.value, x + 24, y + 102);
    const change = m.change || "0";
    g.font = body(22, 600);
    const cw = g.measureText(change).width + 24;
    g.fillStyle = m.good === undefined ? "#eef5e6" : m.good ? "#e3f4d6" : "#fbe1df";
    g.beginPath();
    g.roundRect(x + 24, y + 114, cw, 30, 15);
    g.fill();
    g.fillStyle = m.good === undefined ? muted : m.good ? "#2f6d12" : "#a1302b";
    g.fillText(change, x + 36, y + 137);
  });

  g.fillStyle = muted;
  g.font = body(20);
  g.fillText(`Compared with ${d.compareLabel}. Indicative, from open data.`, 60, H - 62);
  g.fillText("Made with TOD Explorer · based on Dimas (2025), University of Twente", 60, H - 32);
  g.fillStyle = ink;
  g.font = body(22, 600);
  const hash = "#CityOfTheFuture";
  g.fillText(hash, W - 60 - g.measureText(hash).width, H - 32);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

/** Crops a city snapshot to its drawn pixels (the 3D view has a transparent background), with a small margin. */
export async function trimSnapshot(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (data[(y * c.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return dataUrl;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(c.width - 1, x1 + pad);
  y1 = Math.min(c.height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

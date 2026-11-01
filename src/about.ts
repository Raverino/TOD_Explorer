// "How it works": a short slide deck that explains TOD and the game in pictures.

import { CLASSES, STATION_COLOR } from "./classes";

/** An isometric stack of cubes in the cube-city colours, as inline SVG. */
export function cubeStack(ground: string, block?: string, roof?: string, blocks = 0, extra = "") {
  const w = 30, h = 15, unit = 16;
  const top = (y: number, fill: string) => `<path d="M40 ${y} L${40 + w} ${y + h} L40 ${y + 2 * h} L${40 - w} ${y + h} Z" fill="${fill}" stroke="rgba(0,0,0,.25)"/>`;
  const sides = (y: number, height: number, fill: string) =>
    `<path d="M${40 - w} ${y + h} L40 ${y + 2 * h} L40 ${y + 2 * h + height} L${40 - w} ${y + h + height} Z" fill="${fill}" filter="url(#dark1)"/>` +
    `<path d="M${40 + w} ${y + h} L40 ${y + 2 * h} L40 ${y + 2 * h + height} L${40 + w} ${y + h + height} Z" fill="${fill}" filter="url(#dark2)"/>`;
  const baseY = 100;
  let svg = sides(baseY, 8, ground) + top(baseY, ground);
  for (let b = 0; b < blocks; b++) {
    const y = baseY - (b + 1) * unit;
    svg += sides(y + 6, unit, block!) + top(y + 6, b === blocks - 1 ? roof ?? block! : block!);
  }
  return `<svg viewBox="0 0 80 150" class="cube" aria-hidden="true">
    <defs><filter id="dark1"><feColorMatrix type="matrix" values=".78 0 0 0 0 0 .78 0 0 0 0 0 .78 0 0 0 0 0 1 0"/></filter>
    <filter id="dark2"><feColorMatrix type="matrix" values=".6 0 0 0 0 0 .6 0 0 0 0 0 .6 0 0 0 0 0 1 0"/></filter></defs>
    ${svg}${extra}</svg>`;
}

const tree = `<circle cx="40" cy="86" r="11" fill="#3f8f2a"/><rect x="38" y="94" width="4" height="10" fill="#7a5230"/>`;
/** A small cube picture of a land-use class. */
export function classCube(id: number) {
  const k = CLASSES[id];
  if (id === 7) return cubeStack(k.ground, undefined, undefined, 0, tree);
  return cubeStack(k.ground, k.block, k.roof, k.block ? Math.min(k.stack?.[1] ?? 1, 4) : 0);
}

const pole = `<rect x="54" y="78" width="7" height="30" fill="${STATION_COLOR}" stroke="rgba(0,0,0,.3)"/>`;

const PRINCIPLES = [
  ["Walk", "Safe, lively streets for walking"],
  ["Cycle", "A safe cycle network and parking"],
  ["Connect", "Short blocks and direct routes"],
  ["Transit", "Good public transport within walking distance"],
  ["Mix", "Homes, shops and services close together"],
  ["Densify", "Enough people and jobs near stations"],
  ["Compact", "Build in and next to the existing city"],
  ["Shift", "Less space for cars, more for people"],
];
/** Principles the thesis studied, and the ones the game scores on top with free, Europe-wide open data. */
const THESIS = new Set(["Transit", "Densify", "Compact", "Shift"]);
const ADDED = new Set(["Connect", "Mix"]);

interface Slide {
  title: string;
  body: string;
  visual: string;
}

const c = CLASSES;
const img = (name: string) => `${import.meta.env.BASE_URL}img/${name}.jpg`;
const SLIDES: Slide[] = [
  {
    title: "What is Transit-Oriented Development?",
    body: "TOD means building homes, jobs and shops within walking distance of good public transport, so people can live well without needing a car.",
    visual: `<img src="${img("base")}" alt="Isometric illustration of a city block with houses, apartment towers, a factory, shops, roads and a station" />`,
  },
  {
    title: "Why it matters",
    body: "Homes and daily travel are a large part of a city's CO₂. Streets and buildings last for decades, so where we build today decides how people travel for generations.",
    visual: `<div class="stats">
      <div><b>49%</b><span>of a European city's emissions come from its buildings <small>(Croci et al., 2021)</small></span></div>
      <div><b>3.2 kg</b><span>of CO₂ a day: what the average city dweller emits by car <small>(Brand et al., 2021)</small></span></div>
      <div><b>−39%</b><span>less driving by people who live in a TOD <small>(Park et al., 2018)</small></span></div>
    </div>`,
  },
  {
    title: "Eight principles",
    body: "The TOD Standard (ITDP, 2017) judges station areas on eight principles. The thesis that inspired this game studied four of them (yellow). The game also scores Connect and Mix (green), using the metrics that free, Europe-wide open data measures reliably: 45 of the 100 points in all. Walk and Cycle (grey) are left out, because sidewalks, crossings and bike parking are mapped too unevenly.",
    visual: `<div class="principles">${PRINCIPLES.map(([name, text]) => `<div class="${THESIS.has(name) ? "on" : ADDED.has(name) ? "added" : ""}"><b>${name}</b><span>${text}</span></div>`).join("")}</div>
      <p class="principles-key"><span class="on">Studied in the thesis and scored</span><span class="added">Also scored by the game</span><span>Not scored</span></p>`,
  },
  {
    title: "Reading the cube city",
    body: "Every cube is a small square of land, coloured by what it is used for. The taller the stack, the more floors the buildings have.",
    visual: `<div class="cubes-legend">
      <figure>${cubeStack(c[3].ground, c[3].block, c[3].roof, 1)}<figcaption>Low buildings<br><small>houses</small></figcaption></figure>
      <figure>${cubeStack(c[2].ground, c[2].block, c[2].roof, 3)}<figcaption>Mid buildings<br><small>apartment blocks</small></figcaption></figure>
      <figure>${cubeStack(c[1].ground, c[1].block, c[1].roof, 5)}<figcaption>High buildings<br><small>towers</small></figcaption></figure>
      <figure>${cubeStack(c[4].ground, c[4].block, c[4].roof, 2)}<figcaption>Shops and work</figcaption></figure>
      <figure>${cubeStack(c[7].ground, undefined, undefined, 0, tree)}<figcaption>Parks and green</figcaption></figure>
      <figure>${cubeStack(c[8].ground)}<figcaption>Farmland</figcaption></figure>
      <figure>${cubeStack(c[9].ground)}<figcaption>Water</figcaption></figure>
      <figure>${cubeStack(c[5].ground, undefined, undefined, 0, pole)}<figcaption>Roads and a<br>transit stop</figcaption></figure>
    </div>`,
  },
  {
    title: "Four strategies",
    body: "Pick how the city should change near transit. Each strategy turns some land into another use, only close to stations and never in protected nature. Tap a picture to see what changes.",
    visual: `<div class="strategies-grid">
      <button data-zoom="base"><img src="${img("base")}" alt="" /><span><b>Baseline</b> today's trends</span></button>
      <button data-zoom="ib-labels"><img src="${img("ib")}" alt="" /><span><b>Intense Building</b> build up near stations</span></button>
      <button data-zoom="retro-labels"><img src="${img("retro")}" alt="" /><span><b>Retrofitting</b> reuse industry, parking and roads</span></button>
      <button data-zoom="bal-labels"><img src="${img("bal")}" alt="" /><span><b>Balanced</b> a bit of both</span></button>
    </div>`,
  },
  {
    title: "Growing to 2050",
    body: "First choose how many people will live here by 2050 (Eurostat's projection for the country, or your own) and how much new land the city may build on. Then pick a policy and press Play: each year the newcomers need homes, and the policy decides where they go. It is a what-if, not a forecast.",
    visual: `<div class="steps-row">
      <div><b>1</b><span>New residents need homes each year</span></div><i>→</i>
      <div><b>2</b><span>TOD policies build up near transit first, at a steady pace</span></div><i>→</i>
      <div><b>3</b><span>Then new land at the edge, up to what you allowed, near roads or transit</span></div><i>→</i>
      <div><b>4</b><span>Anyone left over has no home here</span></div>
    </div>`,
  },
  {
    title: "Your scores",
    body: "Every change updates the scoreboard next to the city. Green arrows mean better than Baseline, red arrows mean worse.",
    visual: `<div class="score-cards">
      <div><b>CO₂ per resident</b><span>tonnes a year from homes' land, travel and daily life. Lower is better.</span></div>
      <div><b>Residents near transit</b><span>share who can walk to a station or a connecting bus or tram. Higher is better.</span></div>
      <div><b>Housing capacity</b><span>people the homes could house at 40 m² each.</span></div>
      <div><b>TOD Standard score</b><span>points on the TOD Standard metrics that free European open data measures reliably (45 of the Standard's 100).</span></div>
    </div>`,
  },
  {
    title: "Free data, any city",
    body: "Everything comes from free, open data: OpenStreetMap for buildings and streets, measured population from the EU's Global Human Settlement Layer, and the TOD Standard for the scores. Based on the MSc thesis Modeling Transit-Oriented Development (Dimas, University of Twente, 2025); illustrations by Anastasia Logvinenko.",
    visual: `<div class="final"><button class="btn primary big" data-start>Start: pick a place</button></div>`,
  },
];

/** Renders the deck into the container; `onStart` is called by the last slide's button. */
export function renderAbout(container: HTMLElement, onStart: () => void) {
  let index = 0;
  container.innerHTML = `
    <div class="deck">
      <div class="slide" aria-live="polite"></div>
      <div class="deck-nav">
        <button class="btn" data-prev aria-label="Previous slide">←</button>
        <div class="dots">${SLIDES.map((_, k) => `<button data-dot="${k}" aria-label="Slide ${k + 1}"></button>`).join("")}</div>
        <button class="btn primary" data-next aria-label="Next slide">→</button>
      </div>
    </div>`;
  const slide = container.querySelector<HTMLElement>(".slide")!;
  const show = (k: number) => {
    index = Math.max(0, Math.min(SLIDES.length - 1, k));
    const s = SLIDES[index];
    slide.innerHTML = `<div class="slide-text"><span class="count">${index + 1} / ${SLIDES.length}</span><h2>${s.title}</h2><p>${s.body}</p></div><div class="slide-visual">${s.visual}</div>`;
    container.querySelectorAll<HTMLButtonElement>("[data-dot]").forEach((d) => d.classList.toggle("on", Number(d.dataset.dot) === index));
    container.querySelector<HTMLButtonElement>("[data-prev]")!.disabled = index === 0;
    container.querySelector<HTMLButtonElement>("[data-next]")!.style.visibility = index === SLIDES.length - 1 ? "hidden" : "visible";
    slide.querySelector<HTMLButtonElement>("[data-start]")?.addEventListener("click", onStart);
    // A strategy picture opens its labelled version; the back button returns to the grid.
    slide.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((b) =>
      b.addEventListener("click", () => {
        const visual = slide.querySelector<HTMLElement>(".slide-visual")!;
        visual.innerHTML = `<div class="zoomed"><img src="${img(b.dataset.zoom!)}" alt="${b.textContent!.trim()}, with labels describing each change" /><button class="btn" data-back>← All strategies</button></div>`;
        visual.querySelector("[data-back]")!.addEventListener("click", () => show(index));
      }),
    );
  };
  container.querySelector("[data-prev]")!.addEventListener("click", () => show(index - 1));
  container.querySelector("[data-next]")!.addEventListener("click", () => show(index + 1));
  container.querySelectorAll<HTMLButtonElement>("[data-dot]").forEach((d) => d.addEventListener("click", () => show(Number(d.dataset.dot))));
  container.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(index + 1);
    if (e.key === "ArrowLeft") show(index - 1);
  });
  show(0);
}

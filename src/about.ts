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

/** The eight TOD Standard principles; the game scores six of them. `how` says, in plain words, what each scores in the game. */
const PRINCIPLES: { name: string; text: string; scored: boolean; how: string }[] = [
  { name: "Walk", text: "Safe, lively streets for walking", scored: false, how: "This is not scored in the game. Good sidewalks and safe crossings matter, but open maps record them too unevenly across Europe to compare places fairly." },
  { name: "Cycle", text: "A safe cycle network and parking", scored: false, how: "This is not scored in the game. Cycle lanes and bike parking matter, but open maps record them too unevenly across Europe to compare places fairly." },
  { name: "Connect", text: "Short blocks and direct routes", scored: true, how: "This scores up to 10 points. Short blocks give people many direct routes on foot. Policies do not change the streets, so it depends on where the station is: try a new station in an area of small blocks." },
  { name: "Transit", text: "Good public transport within walking distance", scored: true, how: "This scores no points, but every TOD has to pass it. Most residents need a station, bus or tram stop within walking distance. Add stations in step 4 where many people live." },
  { name: "Mix", text: "Homes, shops and services close together", scored: true, how: "This scores up to 4 points. People should reach food shops, schools, doctors and a park on foot. Shops and schools come from the map, so policies change only the park point: Retrofitting and Balanced add parks." },
  { name: "Densify", text: "Enough people and jobs near stations", scored: true, how: "This scores up to 15 points. It wants many residents near the station, and more shops and offices there than in the rest of the city. Intense Building and Balanced add homes; turning shops into homes can lower it." },
  { name: "Compact", text: "Build in and next to the existing city", scored: true, how: "This scores up to 10 points. The land around the station should already be built on, not fields, with bike share or buses nearby. Policies change little here: a station inside the city scores higher than one at its edge." },
  { name: "Shift", text: "Less space for cars, more for people", scored: true, how: "This scores up to 6 points. Less land for roads leaves more room for people. Retrofitting and Balanced turn roads near transit into green streets, and in Custom you choose how many." },
];

/** Small person icons for the growth loop. */
const people = (fill: string, n = 3) =>
  `<svg viewBox="0 0 80 64" aria-hidden="true">${[...Array(n)]
    .map((_, k) => {
      const x = 40 + (k - (n - 1) / 2) * 22;
      return `<circle cx="${x}" cy="24" r="8" fill="${fill}" stroke="#23262f" stroke-width="2"/><path d="M${x - 11} 56 a11 13 0 0 1 22 0 Z" fill="${fill}" stroke="#23262f" stroke-width="2"/>`;
    })
    .join("")}</svg>`;

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
    body: "The TOD Standard (ITDP, 2017) judges station areas on eight principles. The thesis that inspired this game studied four of them; the game scores six, marked in yellow, using what free, Europe-wide open data measures reliably: 45 of the 100 points.",
    visual: `<p class="tap-hint">Tap a principle to see what it scores</p>
      <div class="principles">${PRINCIPLES.map((p, k) => `<button data-principle="${k}" class="${p.scored ? "on" : ""}${k === 2 ? " sel" : ""}"><b>${p.name}</b><span>${p.text}</span></button>`).join("")}</div>
      <p class="principle-tip" aria-live="polite"><b>${PRINCIPLES[2].name}.</b> ${PRINCIPLES[2].how}</p>`,
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
    visual: `<div class="growth-loop">
      <div class="g1">${people("#f5c542")}<span><b>1</b> Newcomers need homes</span></div><i class="a12">→</i>
      <div class="g2"><span class="mini">${cubeStack(c[1].ground, c[1].block, c[1].roof, 4)}</span><span><b>2</b> TOD policies build up near stations first</span></div>
      <i class="a41">↑</i><div class="hub">↻<small>every year<br>to 2050</small></div><i class="a23">↓</i>
      <div class="g4">${people("#e3e6dc")}<span><b>4</b> Anyone left over has no home here</span></div><i class="a34">←</i>
      <div class="g3"><span class="mini">${cubeStack(c[8].ground, c[3].block, c[3].roof, 1)}</span><span><b>3</b> Then new land at the edge, if you allowed it</span></div>
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
    // Each principle opens how the game scores it.
    slide.querySelectorAll<HTMLButtonElement>("[data-principle]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = PRINCIPLES[Number(b.dataset.principle)];
        slide.querySelectorAll("[data-principle]").forEach((o) => o.classList.toggle("sel", o === b));
        slide.querySelector(".principle-tip")!.innerHTML = `<b>${p.name}.</b> ${p.how}`;
      }),
    );
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

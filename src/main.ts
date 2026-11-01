import "leaflet/dist/leaflet.css";
import "./style.css";
import L from "leaflet";
import { Area, bboxOf, makeGrid } from "./geo";
import { fetchMapData } from "./tiles";
import { fetchPopulation } from "./population";
import { DATA_SOURCES, SOURCES } from "./sources";
import { classCube, cubeStack, renderAbout } from "./about";
import { FinalMetric, renderFinal, trimSnapshot } from "./final";
import { explain, Housing, referencesFor } from "./insights";
import { fetchTerrain } from "./elevation";
import { CityModel, classify, TOD_BUS_M, TOD_RAPID_M, withStations } from "./classify";
import { findPlace } from "./inventory";
import { livingM2PerPerson, SETTLEMENT, settlementType } from "./housing";
import { applyCensus, censusBBox } from "./census";
import { stationNeed, suggestStations } from "./stations";
import { computeIndicators, computeRanges, Indicators, NET_LIVING_SHARE, PRINCIPLES, Ranges, REFS, residentsByCell } from "./indicators";
import { CLASSES, CLASS_IDS, STATION_COLOR } from "./classes";
import { CubeCity, Overlay, OVERLAY_COLORS, PIN_ICON } from "./voxel";
import { applyStrategy, CUSTOM_RULES, PRESETS, Rule, ScenarioResult, Strategy } from "./scenarios";
import { END_YEAR, GrowthResult, LAND_PRESETS, simulateGrowth, START_YEAR } from "./growth";
import { simCity, simulate, Simulation, YearState } from "./simulate";
import { FAST_GROWTH, populationTrend } from "./projection";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Step 1: pick a place ----------

const map = L.map("map", { zoomControl: true }).setView([50.5, 10], 4); // Europe; the player searches or zooms to a city
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const sizeInput = $<HTMLInputElement>("size");
const selection = L.rectangle([[0, 0], [0, 0]], { color: "#23262f", weight: 3, fillColor: "#f5c542", fillOpacity: 0.18, interactive: false }).addTo(map);

function currentArea(): Area {
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng, sizeM: Number(sizeInput.value) * 1000 };
}

function updateSelection() {
  const area = currentArea();
  const b = bboxOf(area);
  selection.setBounds([[b.south, b.west], [b.north, b.east]]);
  const grid = makeGrid(area);
  $("size-out").textContent = `${sizeInput.value} km`;
  $("grid-out").textContent = `${grid.n} × ${grid.n} cubes, each ${Math.round(grid.cellM)} m wide`;
}
map.on("move", updateSelection);
sizeInput.addEventListener("input", () => {
  updateSelection();
  const b = selection.getBounds();
  if (!map.getBounds().contains(b)) map.fitBounds(b, { padding: [20, 20] });
});
updateSelection();

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>("q").value.trim();
  const msg = $("search-msg");
  msg.textContent = "";
  if (!q) {
    msg.textContent = "Enter a place to search for.";
    return;
  }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    const hits = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string }[];
    if (!hits.length) {
      msg.textContent = "No place found. Try adding the country.";
      return;
    }
    map.setView([Number(hits[0].lat), Number(hits[0].lon)], 13);
    placeName = hits[0].name || hits[0].display_name.split(",")[0];
  } catch {
    msg.textContent = "Search is unavailable right now. Drag the map instead.";
  }
});

/** The searched place, used as the title of the results. */
let placeName = "";

// ---------- Step 2: build the cube city ----------

const tip = $("tip");
/** The city as built from the map (Baseline) and the city after the chosen strategy. */
let baseModel: CityModel | undefined;
let baseInd: Indicators | undefined;
let model: CityModel | undefined;
const city = new CubeCity($("three"), (cell, x, y) => {
  if (cell === null || !model || !$("final").classList.contains("hidden")) {
    tip.classList.add("hidden");
    return;
  }
  const c = CLASSES[model.cls[cell]];
  tip.innerHTML =
    `<b>${c.name}</b><br>` +
    `Buildings cover ${Math.round(model.coverage[cell] * 100)}% of the cell` +
    (model.height[cell] > 0 ? `, about ${Math.round(model.height[cell])} m tall<br>` : "<br>") +
    `Nearest stop ${fmtM(model.distTransitM[cell])} · road ${fmtM(model.distRoadM[cell])}<br>` +
    `About ${nf(model.residents[cell])} residents · ${nf(model.floorM2[cell])} m² floor area<br>` +
    `Walk to rapid transit ${fmtWalk(model.walkRapidM[cell])} · to bus or tram ${fmtWalk(model.walkDirectM[cell])}<br>` +
    `Slope ${model.terrain.slope[cell].toFixed(1)}° · ${model.todStd[cell] ? "meets" : "misses"} the TOD transit standard` +
    (model.zoning[cell] ? "" : "<br>Protected area");
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tip.classList.remove("hidden");
});

const wideLayout = window.matchMedia("(min-width: 900px)");
wideLayout.addEventListener("change", () => (city.wheelZooms = !$("city").classList.contains("hidden") && wideLayout.matches));

/** The About slides open over whatever screen is showing and return to it. */
let screenBeforeAbout = 1;
function openAbout() {
  screenBeforeAbout = $("pick").classList.contains("hidden") ? 2 : 1;
  $("pick").classList.add("hidden");
  $("city").classList.add("hidden");
  $("final").classList.add("hidden");
  $("about").classList.remove("hidden");
  document.body.classList.remove("city-view");
  $("about-btn").textContent = "Back to the game";
  $("about").focus();
}
function closeAbout() {
  $("about").classList.add("hidden");
  $("about-btn").textContent = "How it works";
  const active = Number(document.querySelector<HTMLLIElement>("#steps li.active")?.dataset.step ?? 1);
  setStep(screenBeforeAbout === 1 ? 1 : Math.max(2, Math.min(4, active)));
}
renderAbout($("about"), () => {
  closeAbout();
  setStep(1);
});
$("about-btn").addEventListener("click", () => ($("about").classList.contains("hidden") ? openAbout() : closeAbout()));
$("about-link").addEventListener("click", (e) => {
  e.preventDefault();
  openAbout();
});

/**
 * Steps: 1 pick a place, 2 strategy, 3 growth, 4 new transit (one panel at a time beside the city,
 * with the live results on it), 5 results page.
 */
function setStep(step: number) {
  document.querySelectorAll<HTMLLIElement>("#steps li").forEach((li) => {
    li.classList.toggle("active", Number(li.dataset.step) === step);
    li.classList.toggle("done", Number(li.dataset.step) < step);
  });
  const inCity = step >= 2 && step <= 4;
  $("pick").classList.toggle("hidden", step !== 1);
  $("city").classList.toggle("hidden", !inCity);
  $("final").classList.toggle("hidden", step !== 5);
  document.body.classList.toggle("city-view", inCity);
  if (inCity) showPanel(step);
  window.scrollTo(0, 0);
  // Where the page cannot scroll behind the city (wide screens), the wheel zooms the city directly.
  city.wheelZooms = inCity && wideLayout.matches;
  $("wheel-hint").textContent = city.wheelZooms ? "Drag to turn · double-click and drag to move · scroll to zoom" : "Drag to turn · double-click and drag to move · Ctrl + scroll to zoom";
  if (step === 1) map.invalidateSize();
}

function status(text: string) {
  $("status").textContent = text;
}

/** Where today's residents come from: the census where it covers the area, else GHS-POP. */
let residentsSource = "GHS-POP 2020";

$("build").addEventListener("click", async () => {
  if (map.getZoom() < 10) {
    $("search-msg").textContent = "Search for a place or zoom in on the map first.";
    return;
  }
  const grid = makeGrid(currentArea());
  $("loading").classList.remove("hidden");
  try {
    status("Downloading elevation…");
    const [mapData, terrain, census, place] = await Promise.all([
      fetchMapData(grid.bbox, status),
      fetchTerrain(grid),
      fetchPopulation(censusBBox(grid.bbox)).then(applyCensus),
      findPlace(grid.area.lat, grid.area.lon),
    ]);
    residentsSource = census.covered > 0.5 ? "EU Census 2021, placed with GHS-POP" : "GHS-POP 2020";
    status(`Sorting ${mapData.buildings.length.toLocaleString("en")} buildings into land-use classes…`);
    await new Promise((r) => setTimeout(r, 30));
    baseModel = model = classify(grid, mapData, terrain, census.pop);
    baseInd = computeIndicators(baseModel);
    // Anchor today's city to official figures: CO₂ of the municipality and living space per person.
    if (place.inventory) baseModel.co2Anchor = { ...place.inventory, todayIndex: baseInd.co2Index, todayCar: baseInd.carCo2Total };
    const landKm2 = (baseModel.cls.filter((c) => c !== 9).length * grid.cellM ** 2) / 1e6;
    const settlement = settlementType(baseInd.population, landKm2);
    const living = livingM2PerPerson(place.country, settlement);
    baseModel.housingAnchor = { m2PerPerson: living.m2, national: living.national, settlement, todayHomesFloor: baseInd.homesFloorM2, todayPopulation: baseInd.population };
    baseInd = computeIndicators(baseModel);
    growthCache.clear();
    runCache.clear();
    trend = populationTrend(place.country);
    popShare = trend.share;
    landShare = LAND_PRESETS[1].share;
    stopPlay();
    year = START_YEAR;
    $<HTMLInputElement>("year").value = String(year);
    $("year-out").textContent = String(year);
    renderDemand();
    newStations = [];
    transitCache = undefined;
    renderTransit();
    if (import.meta.env.DEV) Object.assign(window, { __debug: { model, mapData } });
    setStep(2);
    $("final").innerHTML = "";
    status("Stacking cubes…");
    await new Promise((r) => setTimeout(r, 30));
    setOverlay("none");
    current = "BASE";
    selectStrategy("BASE", false);
  } catch (err) {
    setStep(1);
    $("search-msg").textContent = err instanceof Error ? err.message : String(err);
  } finally {
    $("loading").classList.add("hidden");
  }
});

$("back").addEventListener("click", () => setStep(1));

// ---------- Guided steps beside the city ----------

const NEXT_LABEL: Record<number, string> = { 2: "Next: choose a policy →", 3: "Next: new transit →", 4: "See your results →" };

function showPanel(step: number) {
  document.querySelectorAll<HTMLElement>(".panel-step").forEach((p) => p.classList.toggle("hidden", Number(p.dataset.panel) !== step));
  $("prev-step").textContent = step === 2 ? "← New place" : "← Back";
  $("next-step").textContent = NEXT_LABEL[step];
  // Stations are placed only on their own step.
  if (step !== 4 && placing) {
    placing = false;
    renderTransit();
  }
  document.querySelector<HTMLElement>("#city > .side")?.scrollTo(0, 0);
}

function activeStep() {
  return Number(document.querySelector<HTMLLIElement>("#steps li.active")?.dataset.step ?? 1);
}

$("prev-step").addEventListener("click", () => setStep(activeStep() - 1));
$("next-step").addEventListener("click", () => {
  const step = activeStep();
  if (step === 4) return showResults();
  setStep(step + 1);
  // The policy step opens by growing the city.
  if (step === 2 && year === START_YEAR) play(true);
});
$("zoom-in").addEventListener("click", () => city.zoomBy(1.3));
$("zoom-out").addEventListener("click", () => city.zoomBy(1 / 1.3));

function setOverlay(mode: Overlay) {
  document.querySelectorAll<HTMLButtonElement>("[data-overlay]").forEach((b) => b.classList.toggle("on", b.dataset.overlay === mode));
  city.setOverlay(mode);
  renderLegend(mode);
}
document.querySelectorAll<HTMLButtonElement>("[data-overlay]").forEach((b) => b.addEventListener("click", () => setOverlay(b.dataset.overlay as Overlay)));

/** The colour you mostly see from above: roofs for houses, walls for taller blocks, the ground otherwise. */
function legendColor(id: number) {
  const c = CLASSES[id];
  if (id === 3) return c.roof!;
  return c.block ?? c.ground;
}

/** The legend follows the overlay: land-use classes, or what the highlighted cubes mean. */
function renderLegend(mode: Overlay) {
  const item = (color: string, text: string) => `<span><i style="background:${color}"></i>${text}</span>`;
  const faded = item("#e4e6ea", "Everything else");
  const legends: Record<Overlay, string> = {
    none: CLASS_IDS.map((id) => item(legendColor(id), CLASSES[id].short)).join("") + item(STATION_COLOR, "Transit stop"),
    tod: item(OVERLAY_COLORS.tod, "Meets the TOD transit standard") + faded,
    zoning: item(OVERLAY_COLORS.protected, "Protected area: no new building") + faded,
    changes:
      item(OVERLAY_COLORS.converted, "New land use from the strategy") +
      item(OVERLAY_COLORS.green, "New urban green from the strategy") +
      item(OVERLAY_COLORS.grown, "New urban land from growth") +
      item(OVERLAY_COLORS.retrofit, "Homes retrofitted") +
      faded,
  };
  $("legend").innerHTML = legends[mode];
  $("legend").classList.toggle("single", mode !== "none");
}
renderLegend("none");

// ---------- Step 3: choose a strategy ----------

let current = "BASE";
const custom: Strategy = {
  id: "CUSTOM",
  name: "Custom",
  tagline: "Mix your own rules within the TOD Standard.",
  form: "Your own urban form",
  todDistanceM: 1000,
  decay: true,
  decayRate: PRESETS[0].decayRate,
  cluster: 0.7,
  retrofit: 0,
  rules: CUSTOM_RULES.map(({ label: _label, ...r }) => ({ ...r })),
};

function strategyById(id: string): Strategy {
  return id === "CUSTOM" ? custom : PRESETS.find((p) => p.id === id)!;
}

function renderStrategyCards() {
  $("strategies").innerHTML = [...PRESETS, custom]
    .map(
      (s) => `<button class="scard${s.id === current ? " on" : ""}" role="radio" aria-checked="${s.id === current}" data-strategy="${s.id}">
        <span class="sname">${s.name}${s.id === "CUSTOM" ? "" : `<b>${s.id}</b>`}</span>
        <span class="stag">${s.tagline}</span>
        <span class="sform">${s.form}</span>
      </button>`,
    )
    .join("");
  // Picking a policy grows the city from today, so its changes appear year by year.
  document.querySelectorAll<HTMLButtonElement>("[data-strategy]").forEach((b) =>
    b.addEventListener("click", () => {
      selectStrategy(b.dataset.strategy!);
      play(true);
    }),
  );
}

/** Copies a preset's values into the custom sliders, so players can start from a thesis strategy and tweak it. */
function loadCustomFrom(s: Strategy) {
  custom.todDistanceM = s.todDistanceM;
  custom.decay = s.decay;
  custom.cluster = s.cluster;
  custom.retrofit = s.retrofit;
  custom.rules.forEach((r) => {
    const match = s.rules.find((p) => p.from === r.from && p.to === r.to && p.where === r.where);
    r.share = match?.share ?? 0;
    if (match?.bufferM) r.bufferM = match.bufferM;
  });
}

function renderCustom() {
  $<HTMLInputElement>("tod").value = String(custom.todDistanceM);
  $("tod-out").textContent = `${custom.todDistanceM} m`;
  $<HTMLInputElement>("decay").checked = custom.decay;
  $<HTMLInputElement>("cluster").value = String(Math.round(custom.cluster * 100));
  $("cluster-out").textContent = `${Math.round(custom.cluster * 100)}%`;
  $<HTMLInputElement>("retrofit").value = String(Math.round(custom.retrofit * 100));
  $("retrofit-out").textContent = `${Math.round(custom.retrofit * 100)}%`;
  $("rule-sliders").innerHTML = CUSTOM_RULES.map(
    (r, k) => `<label class="field">
      <span>${r.label} <b id="rule-out-${k}">${Math.round(custom.rules[k].share * 100)}%</b></span>
      <input type="range" min="0" max="100" step="5" value="${Math.round(custom.rules[k].share * 100)}" data-rule="${k}" />
    </label>`,
  ).join("");
  document.querySelectorAll<HTMLInputElement>("[data-rule]").forEach((input) =>
    input.addEventListener("input", () => {
      const k = Number(input.dataset.rule);
      const rule = custom.rules[k];
      rule.share = Number(input.value) / 100;
      // Rules that draw from the same class share one pool, so together they can't exceed 100 %.
      custom.rules.forEach((other, j) => {
        if (j === k || other.from !== rule.from || other.where !== rule.where) return;
        if (other.share + rule.share > 1) {
          other.share = 1 - rule.share;
          document.querySelector<HTMLInputElement>(`[data-rule="${j}"]`)!.value = String(Math.round(other.share * 100));
          $(`rule-out-${j}`).textContent = `${Math.round(other.share * 100)}%`;
        }
      });
      $(`rule-out-${k}`).textContent = `${input.value}%`;
      rerunSoon();
    }),
  );
}

$("tod").addEventListener("input", () => {
  custom.todDistanceM = Number($<HTMLInputElement>("tod").value);
  $("tod-out").textContent = `${custom.todDistanceM} m`;
  rerunSoon();
});
$("cluster").addEventListener("input", () => {
  custom.cluster = Number($<HTMLInputElement>("cluster").value) / 100;
  $("cluster-out").textContent = `${$<HTMLInputElement>("cluster").value}%`;
  rerunSoon();
});
$("retrofit").addEventListener("input", () => {
  custom.retrofit = Number($<HTMLInputElement>("retrofit").value) / 100;
  $("retrofit-out").textContent = `${$<HTMLInputElement>("retrofit").value}%`;
  rerunSoon();
});
$("decay").addEventListener("change", () => {
  custom.decay = $<HTMLInputElement>("decay").checked;
  rerunSoon();
});

let rerunTimer = 0;
function rerunSoon() {
  clearTimeout(rerunTimer);
  rerunTimer = window.setTimeout(() => run(true), 150);
}

function selectStrategy(id: string, keepView = true) {
  if (id === "CUSTOM" && current !== "CUSTOM") loadCustomFrom(strategyById(current));
  current = id;
  renderStrategyCards();
  $("custom").classList.toggle("hidden", id !== "CUSTOM");
  if (id === "CUSTOM") renderCustom();
  run(keepView);
}

// ---------- Step 2: growth and land ----------

/** New residents by 2050, as a share of today's, and new urban land allowed, as a share of today's urban land. */
let popShare = 0;
let landShare: number = LAND_PRESETS[1].share;
let trend = populationTrend(undefined);
let year = START_YEAR;
/** Growth runs once per land allowance and mode (Baseline roads vs TOD transit + zoning) and is reused for every year and demand. */
const growthCache = new Map<string, GrowthResult>();
// Baseline grows along roads and ignores transit, so only TOD growth depends on new stations.
const growthKey = (tod: boolean) => `${landShare}|${tod}|${tod ? newStations.join(",") : ""}`;
function growth(tod: boolean): GrowthResult {
  const key = growthKey(tod);
  if (!growthCache.has(key)) growthCache.set(key, simulateGrowth(tod ? transitBase() : baseModel!, landShare, tod));
  return growthCache.get(key)!;
}

/** The first growth run of a setting takes a few seconds, so say so before the page freezes. */
async function ensureGrowth(tod: boolean) {
  if (!landShare || (growthCache.has(growthKey(tod)) && growthCache.has(growthKey(false)))) return;
  status("Simulating growth to 2050…");
  $("loading").classList.remove("hidden");
  await new Promise((r) => setTimeout(r, 30));
  growth(tod);
  growth(false);
  $("loading").classList.add("hidden");
}

interface Run {
  start: CityModel;
  plan: ScenarioResult;
  g?: GrowthResult;
  sim: Simulation;
}
/** Policy runs are cached per settings, so replaying a year is instant and identical. */
const runCache = new Map<string, Run>();
function scenario(s: Strategy, stations: boolean): Run {
  const key = `${JSON.stringify(s)}|${popShare}|${landShare}|${stations ? newStations.join(",") : ""}`;
  if (!runCache.has(key)) {
    const start = stations ? transitBase() : baseModel!;
    const plan = applyStrategy(start, s);
    const g = landShare ? growth(s.id !== "BASE") : undefined;
    runCache.set(key, { start, plan, g, sim: simulate(start, plan, g, baseInd!.population * popShare) });
  }
  return runCache.get(key)!;
}

const signed = (v: number, d = 0) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(Math.abs(v), d)}`;

function renderDemand() {
  const options = [
    { label: "No change", share: 0 },
    { label: "Country trend", share: trend.share },
    { label: "Fast growth", share: FAST_GROWTH },
  ];
  $("demand").innerHTML = options
    .map((d) => `<button data-pop="${d.share}" class="${Math.abs(d.share - popShare) < 1e-6 ? "on" : ""}">${d.label}${d.share ? ` ${signed(d.share * 100, 1)}%` : ""}</button>`)
    .join("");
  document.querySelectorAll<HTMLButtonElement>("[data-pop]").forEach((b) => b.addEventListener("click", () => setPop(Number(b.dataset.pop))));
  $<HTMLInputElement>("share").value = String(Math.round(popShare * 100));
  $("share-out").textContent = `${signed(popShare * 100, 1)}%`;
  $("land").innerHTML = LAND_PRESETS.map(
    (d) => `<button data-land="${d.share}" class="${Math.abs(d.share - landShare) < 1e-6 ? "on" : ""}">${d.label}${d.share ? ` +${nf(d.share * 100)}%` : ""}</button>`,
  ).join("");
  document.querySelectorAll<HTMLButtonElement>("[data-land]").forEach((b) => b.addEventListener("click", () => setLand(Number(b.dataset.land))));
  $<HTMLInputElement>("land-share").value = String(Math.round(landShare * 100));
  $("land-out").textContent = `+${nf(landShare * 100)}%`;
  renderGrowthSummary();
}

function setPop(share: number) {
  popShare = share;
  renderDemand();
  run(true);
}

function setLand(share: number) {
  landShare = share;
  renderDemand();
  run(true);
}

$("share").addEventListener("input", () => {
  popShare = Number($<HTMLInputElement>("share").value) / 100;
  renderDemand();
  rerunSoon();
});
$("land-share").addEventListener("input", () => {
  landShare = Number($<HTMLInputElement>("land-share").value) / 100;
  renderDemand();
  rerunSoon();
});

/** Step 2 in words: how many people to house and how much land the city may use. */
function renderGrowthSummary() {
  if (!baseModel || !baseInd) return;
  const ha = baseModel.grid.cellM ** 2 / 10_000;
  let urban = 0;
  for (const c of baseModel.cls) if (c >= 1 && c <= 6) urban++;
  const people = baseInd!.population * popShare;
  const where = trend.national ? "this country" : "the EU (no figure for this country)";
  const source =
    Math.abs(popShare - trend.share) < 1e-6
      ? `This is Eurostat's projection for ${where} (EUROPOP2023); cities often grow faster than their country.`
      : `Eurostat projects ${signed(trend.share * 100, 1)}% for ${where} (EUROPOP2023).`;
  $("growth-summary").innerHTML =
    (people >= 1
      ? `By 2050 <b>${nf(people)} more people</b> live here (${signed(popShare * 100, 1)}% on today's ${nf(baseInd!.population)}) and need homes. `
      : people <= -1
        ? `By 2050 <b>${nf(-people)} fewer people</b> live here (${signed(popShare * 100, 1)}%): no new homes are needed. `
        : "The population stays as it is: no new homes are needed. ") +
    `${source} ` +
    (landShare
      ? `The city may build on up to <b>${nf(Math.round(urban * landShare) * ha)} ha</b> of new land at its edge (${nf(landShare * 100)}% of today's ${nf(urban * ha)} ha of urban land), but only uses it when homes are needed.`
      : `<b>No new land:</b> every new home has to fit inside today's city.`);
}

function setYear(y: number) {
  year = y;
  $<HTMLInputElement>("year").value = String(y);
  $("year-out").textContent = String(y);
  run(true);
}

$("year").addEventListener("input", () => {
  stopPlay();
  setYear(Number($<HTMLInputElement>("year").value));
});

let playToken = 0;
let playing = false;
function stopPlay() {
  playToken++;
  playing = false;
  $("play").textContent = "▶ Play";
}
/** Grows the city year by year, from 2025 when asked or when it already reached 2050. */
async function play(fromStart = false) {
  const token = ++playToken;
  playing = true;
  $("play").textContent = "❚❚ Pause";
  await ensureGrowth(current !== "BASE");
  for (let y = fromStart || year >= END_YEAR ? START_YEAR : year; y <= END_YEAR; y++) {
    if (token !== playToken) return;
    setYear(y);
    await new Promise((r) => setTimeout(r, 120));
  }
  if (token === playToken) stopPlay();
}
$("play").addEventListener("click", () => (playing ? stopPlay() : play()));

// ---------- Step 4: new transit ----------

/** Cells of new rail or metro stations, placed by the player or suggested. */
let newStations: number[] = [];
let transitCache: CityModel | undefined;
let placing = false;

/** Today's city with the new stations. */
function transitBase(): CityModel {
  transitCache ??= withStations(baseModel!, newStations);
  return transitCache;
}

function setStations(cells: number[]) {
  newStations = cells;
  transitCache = undefined;
  renderTransit();
  run(true);
}

/** How a new station works, in three pictures. */
function renderTransitHow() {
  const homes = CLASSES[2], low = CLASSES[3];
  const walk = `<svg viewBox="0 0 80 64" aria-hidden="true"><ellipse cx="40" cy="40" rx="36" ry="20" fill="#d9f0c8" stroke="#23262f" stroke-width="2" stroke-dasharray="4 4"/>${PIN_ICON.replace("<svg ", '<svg x="28" y="4" width="24" height="36" ')}</svg>`;
  $("transit-how").innerHTML = `
    <div>${PIN_ICON}<span>Put a station where people live or where the city will grow</span></div><i>→</i>
    <div>${walk}<span>Everyone within a 1 km walk (10–15 min) can take the train</span></div><i>→</i>
    <div><span class="mini">${cubeStack(homes.ground, homes.block, homes.roof, 3)}${cubeStack(low.ground, low.block, low.roof, 1)}</span><span>TOD policies build homes around it, and its station area is scored</span></div>`;
}
renderTransitHow();

/** Steps the player can jump back to from the transit step. */
function nudge(text: string, button: string, step: number) {
  $("transit-nudge").innerHTML = `<span>${text}</span><button class="btn" data-go="${step}">${button}</button>`;
  $("transit-nudge").classList.remove("hidden");
  $("transit-nudge").querySelector("button")!.addEventListener("click", () => setStep(step));
}

function renderTransit() {
  $("clear-stations").classList.toggle("hidden", !newStations.length);
  $("place-station").textContent = placing ? "Done placing" : "Place stations";
  city.onPick = placing ? toggleStation : undefined;
  city.placing = placing;
  if (!baseModel || !baseInd || !model) return;
  // People each new station reaches within the TOD Standard's 1000 m walk, in the shown year.
  const people = residentsByCell(model);
  const reach = (model.addedAreas ?? []).map((a) => {
    let sum = 0;
    for (let i = 0; i < people.length; i++) if (a.walkM[i] <= TOD_RAPID_M) sum += people[i];
    return { cell: a.cell, sum };
  });
  city.setPinLabels(reach.map((r) => ({ cell: r.cell, text: `${nf(r.sum)} people` })));

  if (!newStations.length) {
    $("transit-summary").textContent = placing
      ? "Click on the city to place a station; click a pin to remove it."
      : "No new stations yet. Place them yourself, or let the game place them where they reach the most people.";
  } else {
    // Of them, residents who had no rail or metro within a 1000 m walk before.
    let fresh = 0;
    for (let i = 0; i < people.length; i++) if (model.walkRapidM[i] <= TOD_RAPID_M && baseModel.walkRapidM[i] > TOD_RAPID_M) fresh += people[i];
    const scored = lastResult?.x.todStation;
    $("transit-summary").innerHTML =
      `<b>${newStations.length} new station${newStations.length > 1 ? "s" : ""}</b>: the label on each pin shows the people within a 1 km walk in ${year}. ` +
      `${nf(fresh)} of them had no train or metro within walking distance before. ` +
      (scored === "new"
        ? "The TOD score now rates the area of your best new station."
        : baseModel.mainStation
          ? "The TOD score still rates the main station's area, which scores higher."
          : "") +
      (placing ? " Click to add more; click a pin to remove it." : "");
  }

  $("transit-nudge").classList.add("hidden");
  if (newStations.length && popShare <= 0)
    nudge("Nobody new moves here by 2050, so no new homes gather around the stations.", "← Add growth", 2);
  else if (newStations.length && current === "BASE") nudge("Baseline ignores new stations and keeps building along roads.", "← Pick a TOD policy", 3);
}

function toggleStation(cell: number) {
  if (!baseModel) return;
  const n = baseModel.grid.n;
  const near = newStations.find((s) => Math.abs(Math.floor(s / n) - Math.floor(cell / n)) <= 1 && Math.abs((s % n) - (cell % n)) <= 1);
  if (near !== undefined) setStations(newStations.filter((s) => s !== near));
  else if (baseModel.cls[cell] !== 9) setStations([...newStations, cell]);
}

$("place-station").addEventListener("click", () => {
  placing = !placing;
  renderTransit();
});
$("auto-stations").addEventListener("click", async () => {
  if (!baseModel) return;
  await ensureGrowth(current !== "BASE");
  // Where the city sprawls: new urban land of Baseline by 2050, or, without it, today's
  // residents who cannot walk to transit.
  const start = transitBase();
  const b = scenario(PRESETS[0], false);
  const sprawl = b.sim.years[b.sim.years.length - 1].land ? simCity(b.start, b.sim, b.g, END_YEAR).model.cls : undefined;
  const picks = suggestStations(start, stationNeed(start, sprawl), Number($<HTMLSelectElement>("auto-count").value));
  if (!picks.length) {
    $("transit-summary").textContent = "Everything is already within walking distance of rapid transit: no new station needed.";
    return;
  }
  setStations([...newStations, ...picks]);
});
$("clear-stations").addEventListener("click", () => setStations([]));

/** What the policy changed by the shown year, for the summary and the results page. */
interface Changes {
  converted: number[];
  retrofitted: Uint8Array;
}
/** Newcomers and their homes by the shown year, for the results page. */
let lastHousing: Housing | undefined;

/** New urban land used by a year, and the part of it on parks and urban green (ha). */
function landUsed(r: Run, st: YearState) {
  const ha = baseModel!.grid.cellM ** 2 / 10_000;
  let green = 0;
  for (let k = 0; k < st.land; k++) if (baseModel!.cls[r.sim.landCells[k]] === 7) green++;
  return { landHa: st.land * ha, greenHa: green * ha };
}

function run(keepView: boolean) {
  if (!baseModel || !baseInd) return;
  const s = strategyById(current);
  const tod = s.id !== "BASE";
  if (landShare && (!growthCache.has(growthKey(tod)) || !growthCache.has(growthKey(false)))) {
    ensureGrowth(tod).then(() => run(keepView));
    return;
  }
  const r = scenario(s, true);
  const { model: m, changed, state } = simCity(r.start, r.sim, r.g, year);
  model = m;
  // Conversions done by this year, per rule.
  const converted = s.rules.map(() => 0);
  for (let i = 0; i < changed.length; i++)
    if (changed[i] === 1 || changed[i] === 4) {
      const k = s.rules.findIndex((rule) => rule.from === r.start.cls[i] && rule.to === m.cls[i]);
      if (k >= 0) converted[k]++;
    }
  const changes: Changes = { converted, retrofitted: m.retrofitted! };
  lastPlan = changes;
  city.show(model, changed, keepView);

  // Policies are compared with Baseline in the same year with the same growth (as in the thesis),
  // without new stations; Baseline itself with today.
  let baseline: Indicators | undefined;
  lastHousing = { need: state.need + state.displaced, housed: state.housed, inside: state.housedInside, ...landUsed(r, state) };
  if (tod) {
    const b = scenario(PRESETS[0], false);
    const bc = simCity(b.start, b.sim, b.g, year);
    baseline = computeIndicators(bc.model);
    lastHousing.base = { housed: bc.state.housed, ...landUsed(b, bc.state) };
  } else if (year > START_YEAR || newStations.length) baseline = baseInd;
  renderSummary(s, changes);
  renderHousingSummary(s, r, state);
  renderResults(model, computeIndicators(model), computeRanges(model), baseline, tod ? `Baseline ${year}` : "today");
  renderTransit();
}

/** Step 3 in words: how many newcomers have a home by the shown year, and where. */
function renderHousingSummary(s: Strategy, r: Run, st: YearState) {
  const ha = baseModel!.grid.cellM ** 2 / 10_000;
  const tod = s.id !== "BASE";
  hudHousing = "";
  if (year === START_YEAR) {
    $("housing-summary").textContent = "Press Play to watch the city grow to 2050, or move the year.";
    return;
  }
  if (r.sim.newResidents < 1 && st.displaced < 1) {
    $("housing-summary").innerHTML =
      `${r.sim.newResidents <= -1 ? "The population falls" : "The population stays the same"}: no new homes are needed. ` +
      (tod ? `${s.name} still adds the parks, green streets, shops and retrofits it plans near transit.` : "Baseline leaves the city as it is.");
    return;
  }
  let farm = 0, green = 0;
  for (let k = 0; k < st.land; k++) {
    const c = baseModel!.cls[r.sim.landCells[k]];
    if (c === 8) farm++;
    else if (c === 7) green++;
  }
  // Residents whose homes became shops or parks need a new home as well as the newcomers.
  const total = st.need + st.displaced;
  const housed = Math.min(st.housed, total);
  const short = total - st.housed;
  const unhoused = short >= Math.max(1, total * 0.005);
  // Growth stops early when no free land is left (TOD keeps parks and protected areas free).
  const landFull = !!r.g && st.land >= r.sim.landCells.length && r.sim.landCells.length < r.g.requested;
  const landText = !landShare
    ? "no new land is allowed"
    : landFull
      ? `only ${nf(r.sim.landCells.length * ha)} ha of free land ${tod ? "outside parks and protected areas " : ""}is left in this area`
      : st.land >= r.sim.landCells.length
        ? "the new land allowed is used up"
        : "new land opens a little each year";
  const insideText = year === END_YEAR ? `${s.name}'s rules are used up` : `${s.name} builds at a steady pace to 2050`;
  const parts: string[] = [];
  if (st.housedInside >= 1) parts.push(`${nf(st.housedInside)} by building up near transit`);
  if (st.land) parts.push(`${nf(st.housedOnLand)} on <b>${nf(st.land * ha)} ha</b> of new land (${nf(farm * ha)} ha of it farmland, ${nf(green * ha)} ha urban green)`);
  $("housing-summary").innerHTML =
    `By <b>${year}</b>, <b>${nf(housed)}</b> of ${[
      st.need >= 1 ? `the ${nf(st.need)} newcomers` : "",
      st.displaced >= 1 ? `${nf(st.displaced)} residents whose homes became shops or parks` : "",
    ]
      .filter(Boolean)
      .join(" and ")} have a home${parts.length ? `: ${parts.join(", and ")}` : ""}.` +
    (unhoused
      ? ` <b>${nf(short)} have no home here</b>: ${
          tod
            ? `${insideText} and ${landText}. ${landFull ? "Raise the shares in Custom." : "Allow more land in step 2, or raise the shares in Custom."}`
            : `Baseline only builds on new land, and ${landText}. ${landFull ? "TOD policies can also build up inside the city." : "Allow more land in step 2, or pick a TOD policy."}`
        }`
      : "") +
    (st.land ? " Orange cubes in <i>Changes</i> show the new land." : "");
  hudHousing = `${nf(housed)} of ${nf(total)} ${st.displaced >= 1 ? "newcomers and displaced" : "newcomers"} housed${unhoused ? ` · ${nf(short)} without a home` : ""}`;
}

function renderSummary(s: Strategy, r: Changes) {
  if (s.id === "BASE") {
    $("strategy-summary").textContent = "Baseline: nothing changes inside the city, and newcomers get homes on new land only. Pick a TOD policy to see what it would change.";
    return;
  }
  // Shares of the land the strategy may touch: everything within its distance of transit, water aside.
  let near = 0;
  for (let i = 0; i < baseModel!.cls.length; i++) if (baseModel!.cls[i] !== 9 && baseModel!.distTransitM[i] <= s.todDistanceM) near++;
  const share = (cells: number) => {
    const v = near ? (cells / near) * 100 : 0;
    return v > 0 && v < 0.1 ? "<0.1%" : `${nf(v, v < 10 ? 1 : 0)}%`;
  };
  const total = r.converted.reduce((a, b) => a + b, 0);
  let retro = 0;
  for (const v of r.retrofitted) retro += v;
  const rows = s.rules
    .map((rule: Rule, k) => ({ rule, cells: r.converted[k] }))
    .filter((x) => x.cells)
    .map(
      ({ rule, cells }) =>
        `<div class="change"><span class="mini">${classCube(rule.from)}<i>→</i>${classCube(rule.to)}</span><b>${share(cells)}</b><span>${CLASSES[rule.from].short} → ${CLASSES[rule.to].short.toLowerCase()}</span></div>`,
    );
  if (retro) {
    const low = CLASSES[3];
    rows.push(`<div class="change"><span class="mini">${classCube(3)}<i>→</i>${cubeStack(low.ground, low.block, OVERLAY_COLORS.retrofit, 1)}</span><b>${share(retro)}</b><span>Homes retrofitted, 30% less building CO₂</span></div>`);
  }
  $("strategy-summary").innerHTML = total || retro
    ? `<b>${s.name}</b> changed <b>${share(total + retro)}</b> of the land within ${s.todDistanceM} m of transit.
       <details class="tipbox"><summary>See what changed</summary>
         <div class="changes">${rows.join("")}</div>
         <span class="muted small">Each % is a share of the land within ${s.todDistanceM} m of transit. Turn on <i>Changes</i> to see where (pink: new use, blue: retrofit).</span>
       </details>`
    : `<b>${s.name}</b> found nothing to change here: no matching land use within ${s.todDistanceM} m of transit.`;
}

// ---------- Results: headlines first, details below ----------

const nf = (v: number, d = 0) => v.toLocaleString("en", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v: number) => `${nf(v * 100, 1)}%`;
function fmtWalk(m: number) {
  return Number.isFinite(m) ? `${nf(m)} m` : "far";
}
function fmtM(m: number) {
  return m > 1e8 ? "none" : m >= 1000 ? `${nf(m / 1000, 1)} km` : `${nf(m)} m`;
}
function fmtCo2(kg: number) {
  const a = Math.abs(kg);
  if (a >= 1e9) return `${nf(kg / 1e9, 2)} Mt`;
  if (a >= 1e6) return `${nf(kg / 1e6, 1)} kt`;
  if (a >= 1e3) return `${nf(kg / 1e3, 0)} t`;
  return `${nf(kg)} kg`;
}

/** A yearly CO₂ saving, or "none" when there is nothing to save. */
function savedCo2(kg: number) {
  return kg < 1000 ? "none" : `−${fmtCo2(kg)} /yr`;
}

function group(title: string, rows: [string, string][]) {
  return `<div class="group"><h3>${title}</h3><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table></div>`;
}

/** What each scored principle asks, in a few words. */
const PRINCIPLE_TEXT: Record<(typeof PRINCIPLES)[number], string> = {
  Connect: "short, direct walking routes",
  Transit: "walk to public transport",
  Mix: "daily needs and parks nearby",
  Densify: "enough people and jobs",
  Compact: "build within the city",
  Shift: "less space for cars",
};

/** A badge with the change against Baseline; `better` says which direction is good. */
let compareLabel = "Baseline";
/** The latest strategy plan, for the results page. */
let lastPlan: Changes | undefined;
/** Newcomers housed, for the scoreboard. */
let hudHousing = "";
/** The latest scores, for the results page. */
let lastResult: { x: Indicators; b: Indicators | undefined; label: string } | undefined;

function delta(value: number, base: number | undefined, better: "higher" | "lower", fmt: (v: number) => string) {
  if (base === undefined) return "";
  const d = value - base;
  if (fmt(Math.abs(d)) === fmt(0)) return `<span class="delta same">same as ${compareLabel}</span>`;
  const good = d > 0 === (better === "higher");
  return `<span class="delta ${good ? "good" : "bad"}">${d > 0 ? "▲ +" : "▼ −"}${fmt(Math.abs(d))} vs ${compareLabel}</span>`;
}

/** Compact live scoreboard on the 3D view, so changes show without scrolling. */
/** The four scores with their change against the comparison; shared by the scoreboard and the results page. */
function scoreRows(x: Indicators, b: Indicators | undefined): FinalMetric[] {
  const change = (value: number, base: number | undefined, better: "higher" | "lower", fmt: (v: number) => string) => {
    if (base === undefined || fmt(Math.abs(value - base)) === fmt(0)) return { change: "0" };
    const d = value - base;
    return { change: `${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}`, good: d > 0 === (better === "higher") };
  };
  return [
    { label: "CO₂ per resident", value: `${nf(x.co2PerCapita / 1000, 2)} t/yr`, note:
        x.co2Source === "inventory"
          ? "Official figure for the municipality (buildings and road fuel), changed by the plan. Lower is better."
          : x.sparse
            ? "Overstated in a place this sparse: compare strategies, not places."
            : "Estimated from land use: homes' land, travel and daily life. Lower is better.", ...change(x.co2PerCapita / 1000, b && b.co2PerCapita / 1000, "lower", (v) => `${nf(v, 2)} t`) },
    { label: "Residents near transit", value: pct(x.popStdShare), note: "Can walk to a station or a connecting bus or tram.", ...change(x.popStdShare * 100, b && b.popStdShare * 100, "higher", (v) => `${nf(v, 1)} pts`) },
    { label: "Housing capacity", value: `${nf(x.housingCapacity)} people`, note: "People the homes could house at 40 m² each.", ...change(x.housingCapacity, b?.housingCapacity, "higher", (v) => nf(v)) },
    { label: "TOD Standard score", value: `${x.todPoints} / ${x.todMax} pts`, note: "TOD Standard metrics open data measures reliably, main station area.", ...change(x.todPoints, b?.todPoints, "higher", (v) => nf(v)) },
  ];
}

/** Compact live scoreboard on the 3D view, in fixed columns so values stay put between strategies. */
function renderHud(x: Indicators, b: Indicators | undefined, label: string) {
  $("hud").innerHTML =
    scoreRows(x, b)
      .map((m) => `<div class="row"><span>${m.label}</span><b>${m.value}</b><span class="delta ${m.good === undefined ? "same" : m.good ? "good" : "bad"}">${m.change}</span></div>`)
      .join("") +
    `<div class="context">${nf(x.population)} residents · ${b ? `changes vs ${label}` : "today, nothing to compare yet"}</div>` +
    (hudHousing ? `<div class="context">${hudHousing}</div>` : "") +
    (x.sparse
      ? `<div class="context caution">${
          x.co2Source === "inventory"
            ? "Few residents: the official CO₂ figure includes hotels, holiday homes and visitors' fuel."
            : "Sparse settlement: CO₂ per resident is overstated here. Compare strategies, not places."
        }</div>`
      : "");
}

/** A calculation drawn as a row of value chips joined by operators. */
function formula(parts: ([string, string] | string)[]) {
  return `<div class="formula">${parts
    .map((p) => (typeof p === "string" ? `<i class="op">${p}</i>` : `<div class="chip"><span>${p[0]}</span><b>${p[1]}</b></div>`))
    .join("")}</div>`;
}

/** Footprint of the homes as built, used to show how floor area is formed. */
function homesFootprintM2(m: CityModel) {
  let sum = 0;
  for (let i = 0; i < m.cls.length; i++) if (m.baseCls[i] >= 1 && m.baseCls[i] <= 3) sum += m.coverage[i] * m.grid.cellM ** 2;
  return sum;
}

/** Places a cube picture (an 80 × 150 SVG) inside a larger SVG at x, y with the given width. */
const placeCube = (svg: string, x: number, y: number, w: number) => svg.replace("<svg ", `<svg x="${x}" y="${y}" width="${w}" height="${(w * 150) / 80}" `);

/** A rounded label, sized roughly to its text. */
const pill = (x: number, y: number, text: string) => {
  const w = text.length * 7 + 18;
  return `<rect x="${x - w / 2}" y="${y - 13}" width="${w}" height="20" rx="10" fill="#f5c542" stroke="#23262f" stroke-width="2"/><text x="${x}" y="${y + 1}" text-anchor="middle" font-size="12" font-weight="700">${text}</text>`;
};

/** The TOD transit rule drawn with the city's cubes: a home, a 1000 m walk to rapid transit, or 500 m to a feeder stop. */
const TRANSIT_DIAGRAM = (() => {
  const low = CLASSES[3], road = CLASSES[5].ground;
  // Stop poles stand on the centre of the top face (cube coordinates: 80 × 150).
  const tallPole = `<rect x="36" y="38" width="8" height="51" fill="${STATION_COLOR}" stroke="rgba(0,0,0,.35)"/>`;
  const shortPole = `<rect x="37" y="76" width="7" height="39" fill="${STATION_COLOR}" stroke="rgba(0,0,0,.35)"/>`;
  const label = (x: number, y: number, lines: string[], muted = false) =>
    lines.map((t, k) => `<text x="${x}" y="${y + k * 14}" text-anchor="middle" font-size="${muted ? 11 : 12}" font-weight="${muted ? 500 : 600}"${muted ? ' style="fill:#646a78"' : ""}>${t}</text>`).join("");
  return `<svg class="diagram" viewBox="0 0 300 222" role="img" aria-label="A home counts when a train, metro or rapid-bus station is within a 1000 metre walk, or a bus, tram or ferry stop within 500 metres that connects to a station within 5 kilometres">
  <path d="M54 146 C 100 92, 180 82, 234 104" fill="none" stroke="#23262f" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/>
  <path d="M50 172 C 74 198, 112 204, 140 190" fill="none" stroke="#23262f" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/>
  <path d="M180 184 C 206 178, 232 158, 250 124" fill="none" stroke="#8a8f99" stroke-width="2" stroke-dasharray="4 4"/>
  ${placeCube(cubeStack(low.ground, low.block, low.roof, 1), 0, 70, 64)}
  ${placeCube(cubeStack(road, "#a9d2f2", "#e9eef4", 2, tallPole), 226, 12, 70)}
  ${placeCube(cubeStack(road, undefined, undefined, 0, shortPole), 128, 110, 56)}
  ${pill(142, 76, "walk ≤ 1000 m")}
  ${pill(114, 148, "walk ≤ 500 m")}
  ${label(250, 16, ["Train, metro", "or rapid bus"])}
  ${label(32, 202, ["Home"])}
  ${label(150, 214, ["Bus, tram, ferry"])}
  ${label(250, 196, ["line reaches a", "station ≤ 5 km"], true)}
</svg>`;
})();

/** The likely range under a headline value. */
function range([lo, hi]: [number, number], fmt: (v: number) => string) {
  return fmt(lo) === fmt(hi) ? "" : `<div class="range">likely ${fmt(lo)} – ${fmt(hi)}</div>`;
}

function renderResults(m: CityModel, x: Indicators, r: Ranges, b?: Indicators, label = "Baseline") {
  compareLabel = label;
  const anchor = m.co2Anchor;
  const h = m.housingAnchor;
  const ha = (m.grid.cellM ** 2) / 10_000;
  const cellKm2 = (m.grid.cellM ** 2) / 1e6;
  const resLandKm2 = ((x.cells[1] ?? 0) + (x.cells[2] ?? 0) + (x.cells[3] ?? 0)) * cellKm2;
  const footprintKm2 = homesFootprintM2(m) / 1e6;
  $("headlines").innerHTML = `
    <div class="headline co2">
      <div class="label">Urban CO₂ per resident</div>
      <div class="value">${nf(x.co2PerCapita / 1000, 2)} t/yr</div>
      ${range(r.co2PerCapita.map((v) => (v * x.co2PerCapita) / Math.max(1, x.co2PerCapitaModel)) as [number, number], (v) => `${nf(v / 1000, 2)} t`)}
      ${delta(x.co2PerCapita / 1000, b && b.co2PerCapita / 1000, "lower", (v) => `${nf(v, 2)} t`)}
      ${
        anchor
          ? `<div class="sub">Starts from the official figure for <b>${anchor.name}</b> (2018): fuel burned in its buildings and road fuel, ${nf(anchor.perResident, 2)} t per resident. Strategies change it by the modelled change of this area.</div>`
          : `<div class="sub">Estimated from land use: no official figure was found for this place. Whole area, including shops and green uptake: ${fmtCo2(x.co2Total)} per year.</div>`
      }
      ${
        x.sparse
          ? anchor
            ? `<div class="sub caution">Few residents for this much building (${nf(x.residentsPerHa)} per hectare of housing land). The official figure counts hotels, holiday homes and fuel sold to visitors and through traffic per resident, which is why it is high.</div>`
            : `<div class="sub caution">${nf(x.residentsPerHa)} residents per hectare of housing land, sparser than the city blocks the emission factors come from (cities in Europe: about 100–400). Each resident carries a lot of land here, so this number is overstated. Use it to compare strategies, not to compare this place with a city.</div>`
          : ""
      }
      <details class="how"><summary>How is this calculated?</summary>
        ${
          anchor
            ? formula([
                [`Official, ${anchor.name}`, `${nf(anchor.perResident, 2)} t`],
                "×",
                ["Change from this plan", `${x.co2Index >= anchor.todayIndex ? "+" : "−"}${nf(Math.abs(x.co2Index / anchor.todayIndex - 1) * 100, 1)}%`],
                "=",
                ["Per resident", `${nf(x.co2PerCapita / 1000, 2)} t/yr`],
              ])
            : ""
        }
        ${anchor ? `<p class="how-note">The change comes from the thesis method below, applied to the whole area: homes, shops and offices, green uptake (new parks count) and car travel, per resident.</p>` : ""}
        ${formula([
          ["Homes' land", `${nf(resLandKm2, 2)} km²`],
          "×",
          ["CO₂ per m² a year", `${REFS.co2Class1.value}–${REFS.co2Class3.value} kg`],
          "−",
          ["Retrofits", fmtCo2(x.retrofitSavings)],
          "÷",
          ["Residents", nf(x.population)],
          "=",
          ["Per resident", `${nf(x.co2PerCapita / 1000, 2)} t/yr`],
        ])}
        <div class="bars">${(["High", "Medium", "Low"] as const)
          .map((name, k) => `<div><span>${name} density</span><i style="width:${Math.min(100, (x.co2PerCapitaByClass[k] / Math.max(...x.co2PerCapitaByClass, 1)) * 100)}%;background:${legendColor(k + 1)}"></i><b>${nf(x.co2PerCapitaByClass[k] / 1000, 1)} t</b></div>`)
          .join("")}</div>
        <p class="how-note">The kg per m² are measured block totals (energy, travel, daily life). Lower-density land holds fewer people, so each resident carries more.</p>
      </details>
    </div>
    <div class="headline transit">
      <div class="label">Residents meeting the TOD transit standard</div>
      <div class="value">${pct(x.popStdShare)}</div>
      ${range(r.popStdShare, pct)}
      ${delta(x.popStdShare * 100, b && b.popStdShare * 100, "higher", (v) => `${nf(v, 1)} pts`)}
      <div class="sub">${nf(x.popStd)} of ${nf(x.population)} residents can walk ${TOD_RAPID_M} m to rail, metro or BRT, or ${TOD_BUS_M} m to a connecting bus, tram or ferry.</div>
      <details class="how"><summary>How is this calculated?</summary>
        ${TRANSIT_DIAGRAM}
        <p class="how-note">Walked along streets and paths. A bus or tram only counts if a station is within 5 km. Bus frequency is unknown, so this is an upper bound. Straight-line thesis measure: ${pct(x.popThesisShare)}.</p>
      </details>
    </div>
    <div class="headline housing">
      <div class="label">Housing capacity</div>
      <div class="value">${nf(x.housingCapacity)}</div>
      ${range(r.housingCapacity, (v) => nf(Math.round(v / 100) * 100))}
      ${delta(x.housingCapacity, b?.housingCapacity, "higher", (v) => nf(v))}
      <div class="sub">people at ${REFS.spacePerPerson.value} m² each; ${nf(x.population)} people live here now.</div>
      <details class="how"><summary>How is this calculated?</summary>
        ${
          h
            ? formula([
                ["Residents today", nf(h.todayPopulation)],
                "×",
                [`Living space, ${SETTLEMENT[h.settlement]}`, `${nf(h.m2PerPerson, 1)} m²`],
                "+",
                ["Floor area added", `${x.homesFloorM2 >= h.todayHomesFloor ? "" : "−"}${nf(Math.abs(x.homesFloorM2 - h.todayHomesFloor) / 1e6, 2)} km² × ${NET_LIVING_SHARE}`],
                "÷",
                ["Per person", `${REFS.spacePerPerson.value} m²`],
                "=",
                ["Capacity", nf(x.housingCapacity)],
              ])
            : ""
        }
        <p class="how-note">${
          h
            ? `Today's homes hold the official living space per person ${h.national ? "for this country" : "of the EU (no figure for this country)"} in a ${SETTLEMENT[h.settlement]} (Eurostat, 2012). Homes a strategy or growth adds or removes count ${NET_LIVING_SHARE * 100}% of their floor area as living space, the share that matches Eurostat across 13 countries. Residents are measured (${residentsSource}).`
            : `Residents are measured (${residentsSource}): ${nf(x.population)}.`
        } Map floor area: ${nf(footprintKm2, 2)} km² of footprints × ${nf(footprintKm2 ? x.residentialFloorM2 / 1e6 / footprintKm2 : 0, 1)} floors.</p>
      </details>
    </div>`;

  renderHud(x, b, label);
  lastResult = { x, b, label };

  const s = m.stats;
  const sign = (v: number, f: (v: number) => string) => (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v));
  $("tod-standard").innerHTML = `
    <div class="tod-head">
      <h3>TOD Standard check</h3>
      <span class="tod-score">${x.todPoints} / ${x.todMax} points</span>
      ${b ? `<span class="delta ${x.todPoints > b.todPoints ? "good" : x.todPoints < b.todPoints ? "bad" : "same"}">${x.todPoints === b.todPoints ? `same as ${label}` : `${x.todPoints > b.todPoints ? "▲ +" : "▼ −"}${Math.abs(x.todPoints - b.todPoints)} vs ${label}`}</span>` : ""}
    </div>
    <p class="muted small">How well does the station area follow the TOD Standard (ITDP, 2017)? Only the metrics that free, Europe-wide open data measures reliably are scored: 45 of its 100 points. Walking comfort, cycling, affordable housing and parking are left out because the data is too patchy across Europe. ${
      x.todStation === "new"
        ? "The app scores one station area, as the Standard does: here the area within a 1 km walk of your best new station, which scores higher than the station nearest the centre of the frame."
        : x.todStation === "main"
          ? "The app scores the station nearest the centre of your frame and everything within a 1 km walk of it; new stations you add in step 4 are scored too, and the best station area counts."
          : "Your frame has no train, metro or rapid-bus station, so there is no station area to score. Add one in step 4 and its area is scored."
    }</p>
    ${PRINCIPLES.map((principle) => {
      const rows = x.tod.filter((t) => t.principle === principle);
      if (!rows.length) return "";
      const got = rows.reduce((a, t) => a + t.points, 0), max = rows.reduce((a, t) => a + t.max, 0);
      return `<div class="principle">
        <div class="principle-head"><b>${principle}</b><span class="muted">${PRINCIPLE_TEXT[principle]}</span><span class="sub-score">${max ? `${got} / ${max}` : "must pass"}</span></div>
        ${rows
          .map(
            (t) => `<div class="metric">
              <div class="metric-top"><span>${t.name}</span>${
                t.max
                  ? `<span class="pts-pill ${t.points === t.max ? "full" : t.points ? "part" : "none"}">${t.points} of ${t.max} pts</span>`
                  : `<span class="pts-pill ${t.met ? "full" : "none"}">${t.met ? "✓ passed" : "✗ not passed"}</span>`
              }</div>
              <div class="metric-value">${t.value}${t.detail ? `<small>${t.detail}</small>` : ""}</div>
              <details class="why"><summary>What does this mean?</summary><p>${t.note}</p><span class="ref">TOD Standard metric ${t.id}</span></details>
            </div>`,
          )
          .join("")}
      </div>`;
    }).join("")}`;

  // The compact score beside the city: one bar per principle, with the change.
  $("tod-mini").innerHTML = `
    <div class="tod-mini-head"><b>TOD Standard score</b><span>${x.todPoints} / ${x.todMax}</span>${
      b && x.todPoints !== b.todPoints ? `<span class="delta ${x.todPoints > b.todPoints ? "good" : "bad"}">${x.todPoints > b.todPoints ? "▲" : "▼"} ${Math.abs(x.todPoints - b.todPoints)}</span>` : ""
    }</div>
    ${PRINCIPLES.map((principle) => {
      const rows = x.tod.filter((t) => t.principle === principle);
      const got = rows.reduce((a, t) => a + t.points, 0), max = rows.reduce((a, t) => a + t.max, 0);
      const width = max ? (got / max) * 100 : rows.every((t) => t.met) ? 100 : 0;
      return `<div class="bar" title="${PRINCIPLE_TEXT[principle]}"><span>${principle}</span><i><em style="width:${width}%"></em></i><b>${max ? `${got}/${max}` : rows.every((t) => t.met) ? "✓" : "✗"}</b></div>`;
    }).join("")}
    ${
      x.todStation === "none"
        ? `<p class="muted small scored">No train, metro or rapid-bus station in the frame: nothing to score yet. Add one in step 4.</p>`
        : x.todStation === "new"
          ? `<p class="muted scored">Scored around your best new station.</p>`
          : ""
    }`;

  $("details").innerHTML = [
    b
      ? group(`Compared with ${label}`, [
          ["Residents", sign(x.population - b.population, (v) => nf(v))],
          ["Residents meeting the TOD transit standard", sign(x.popStd - b.popStd, (v) => nf(v))],
          ["Car travel CO₂", `${sign(x.carCo2Total - b.carCo2Total, fmtCo2)} /yr`],
          ["Building CO₂ saved by retrofits", savedCo2(x.retrofitSavings - b.retrofitSavings)],
          ["Building and land-use CO₂", `${sign(x.co2Total - b.co2Total, fmtCo2)} /yr`],
          ["Housing capacity", `${sign(x.housingCapacity - b.housingCapacity, (v) => nf(v))} people`],
          ["Urban green", `${sign(((x.cells[7] ?? 0) - (b.cells[7] ?? 0)) * ha, (v) => nf(v))} ha`],
        ])
      : "",
    group("Transit (TOD Standard 4.A.1)", [
      ["Residents meeting the standard", `${nf(x.popStd)} (${pct(x.popStdShare)})`],
      ["High-density residents", pct(x.stdShareByClass[0])],
      ["Medium-density residents", pct(x.stdShareByClass[1])],
      ["Low-density residents", pct(x.stdShareByClass[2])],
      ["Thesis measure (straight line, any bus)", pct(x.popThesisShare)],
      ["Rapid transit stops (rail, metro, BRT)", nf(s.rapidStops)],
      ["Bus, tram and ferry stops", nf(s.stops - s.rapidStops)],
      ["Car travel CO₂, all residents", `${fmtCo2(x.carCo2Total)} /yr (${nf(x.carCo2PerResident / 1000, 2)} t each)`],
      ["…avoided because residents meet the TOD standard", savedCo2(x.transportCo2AvoidedYearly)],
      ["…from home density compared with today", Math.abs(x.carDensityEffect) < 1000 ? "no change" : `${x.carDensityEffect > 0 ? "+" : "−"}${fmtCo2(Math.abs(x.carDensityEffect))} /yr`],
    ]),
    group("Housing (densify)", [
      [`Residents (${residentsSource})`, nf(x.population)],
      ["Residential floor area", `${nf(x.residentialFloorM2 / 1e6, 2)} km²`],
      ["Floor area per resident", `${nf(x.spacePerPersonM2)} m²`],
      ["Housing capacity at 40 m² each", `${nf(x.housingCapacity)} people`],
      ["Density within 500 m of the main station", `${nf(x.density500)} residents/ha`],
      ["Density within 1000 m of the main station", `${nf(x.density1000)} residents/ha`],
    ]),
    group("Urban carbon (compact)", [
      ["High-density homes", `${fmtCo2(x.co2ByClass[0])} /yr`],
      ["Medium-density homes", `${fmtCo2(x.co2ByClass[1])} /yr`],
      ["Low-density homes", `${fmtCo2(x.co2ByClass[2])} /yr`],
      ["Commercial and industrial", `${fmtCo2(x.co2Commercial)} /yr`],
      ["Saved by retrofitting homes", savedCo2(x.retrofitSavings)],
      ["Uptake by urban green", `${fmtCo2(x.co2Green)} /yr`],
      ["Total", `${fmtCo2(x.co2Total)} /yr`],
      ["Per resident, high / medium / low", x.co2PerCapitaByClass.map((v) => `${nf(v / 1000, 1)}`).join(" / ") + " t"],
    ]),
    group("Green opportunity (shift)", [
      [`Green roofs on ${REFS.roofShare.value * 100}% of roofs`, `−${fmtCo2(x.greenRoofSavings)} /yr`],
      [`Greening ${REFS.surroundShare.value * 100}% of ground around homes`, `−${fmtCo2(x.surroundingGreenSavings)} /yr`],
      ["TOD transport savings", `−${fmtCo2(x.transportCo2AvoidedYearly)} /yr`],
      ["All measures together", `−${fmtCo2(x.totalReduction)} /yr`],
      ["Share of the area's CO₂", pct(x.totalReductionShare)],
    ]),
    group(
      "Land use",
      CLASS_IDS.map((id) => [CLASSES[id].name, `${nf((x.cells[id] ?? 0) * ha)} ha`] as [string, string]),
    ),
    group("Data used", [
      ["Grid", `${m.grid.n} × ${m.grid.n} cells of ${nf(m.grid.cellM)} m`],
      ["Map tiles read", nf(s.tiles)],
      ["Building shapes read", nf(s.buildings)],
      ["Land-use areas read", nf(s.areas)],
      ["Transit stops in the area", nf(s.stops)],
    ]),
  ].join("");

  $("refs").innerHTML = `<h4>Locked values</h4><table>${Object.values(REFS)
    .map((r) => `<tr><td>${r.label}</td><td><b>${r.value}</b> ${r.unit}</td><td class="muted">${r.source}</td></tr>`)
    .join("")}</table>
    <h4>References</h4><ol class="sources">${SOURCES.map((s) => `<li>${s}</li>`).join("")}</ol>
    <h4>Data</h4><ul class="sources">${DATA_SOURCES.map((s) => `<li>${s}</li>`).join("")}</ul>`;
}

// ---------- Step 5: results to save and share ----------

function showResults() {
  if (!lastResult || !baseModel || !lastPlan) return;
  const s = strategyById(current);
  const { x, b, label } = lastResult;
  const conversions = s.rules.filter((_, k) => lastPlan!.converted[k]).map((r) => ({ from: r.from, to: r.to }));
  const { insights, questions } = explain({
    strategyId: s.id,
    strategyName: s.name,
    x,
    b,
    conversions,
    retrofitted: lastPlan.retrofitted.some(Boolean),
    grows: popShare > 0 && year > START_YEAR,
    newStations: newStations.length,
    housing: lastHousing,
  });
  const overlayBefore = document.querySelector<HTMLButtonElement>("[data-overlay].on")?.dataset.overlay as Overlay | undefined;
  renderFinal(
    $("final"),
    {
      place: placeName || "My city",
      strategy: s.name,
      tagline: s.tagline,
      year,
      growth: `${popShare ? `${signed(popShare * 100, 1)}% residents` : "no population change"}, ${landShare ? `up to +${nf(landShare * 100)}% new land` : "no new land"} by 2050`,
      compareLabel: b ? label : "today",
      metrics: scoreRows(x, b),
      insights,
      questions,
      references: referencesFor([...insights.map((i) => i.cite), ...questions.map((q) => q.cite), "ITDP, 2017", "Dimas, 2025"]),
      changesHtml: $("strategy-summary").innerHTML,
      transitText: newStations.length ? $("transit-summary").innerHTML : "",
      detailsHtml: $("city-details").innerHTML,
      growthText: popShare > 0 || landShare ? `${$("growth-summary").innerHTML} ${$("housing-summary").innerHTML}` : "",
      tod: PRINCIPLES.map((principle) => {
        const rows = x.tod.filter((t) => t.principle === principle);
        return { principle, got: rows.reduce((a, t) => a + t.points, 0), max: rows.reduce((a, t) => a + t.max, 0) };
      }),
      todScore: [x.todPoints, x.todMax],
    },
    {
      mount: (el) => city.moveTo(el),
      zoom: (f) => city.zoomBy(f),
      reset: () => city.resetView(),
      overlay: (mode) => city.setOverlay(mode),
      snapshot: () => trimSnapshot(city.snapshot()),
      snapshotNow: () => city.snapshot(),
    },
    () => {
      // Back to the city: the 3D view returns to the stage with the colours it had there.
      city.moveTo($("three"));
      setOverlay(overlayBefore ?? "none");
      setStep(4);
      city.fit();
    },
  );
  placing = false;
  renderTransit();
  setOverlay("none");
  setStep(5);
  city.fit();
}

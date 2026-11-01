// Indicators: the thesis transport, housing and carbon calculations (Dimas, 2025,
// chapter 9) on measured residents and real floor area, plus the parts of the TOD
// Standard (ITDP, 2017) that open map data can measure. Every input is a locked
// reference value, checked against its source paper.

import { CityModel, FloorSet, TOD_BUS_M, TOD_RAPID_M, WALK_DETOUR } from "./classify";
import { distanceTransform, walkDistance } from "./raster";

export interface Reference {
  value: number;
  unit: string;
  label: string;
  source: string;
}

// Urban trees: 0.28 kg C per m² of canopy per year (Nowak et al., 2013), × 44/12 for CO₂.
const TREE_SINK = -0.28 * (44 / 12);
// Extensive Sedum green roof: 0.375 kg C per m² stored over two years (Getter et al., 2009,
// as reported in Whittinghill et al., 2014), × 44/12 for CO₂.
const ROOF_SINK = -(0.375 / 2) * (44 / 12);
const WANG = "Wang, Han & de Vries (2019), Table 5 (cited as Yang et al., 2019 in Dimas, 2025)";

export const REFS = {
  spacePerPerson: { value: 40, unit: "m²/person", label: "Living space standard per person", source: "Dimas (2025); legal minimums from 28 m² in Appolloni & D'Alessandro (2021)" },
  travelCo2: { value: 3.2, unit: "kg CO₂/person/day", label: "Daily travel CO₂ per person (life cycle, all modes)", source: "Brand et al. (2021), seven European cities" },
  carShare: { value: 0.7, unit: "share", label: "Share of travel CO₂ from cars", source: "Brand et al. (2021)" },
  todDriveCut: { value: 0.39, unit: "share", label: "Less car distance for TOD residents than near stations without TOD", source: "Park et al. (2018), after controlling for self-selection" },
  co2Class1: { value: 24.84, unit: "kg CO₂/m² land/yr", label: "Urban emissions, high-rise fabric (HBLB)", source: WANG },
  co2Class2: { value: 27.31, unit: "kg CO₂/m² land/yr", label: "Urban emissions, low- and mid-rise fabric (LBMB)", source: WANG },
  co2Class3: { value: 29.8, unit: "kg CO₂/m² land/yr", label: "Urban emissions, terraced housing (TH)", source: WANG },
  co2Commercial: { value: 45.31, unit: "kg CO₂/m² land/yr", label: "Urban emissions, retail", source: WANG },
  co2Green: { value: +TREE_SINK.toFixed(2), unit: "kg CO₂/m²/yr", label: "Uptake by urban green (tree canopy rate, upper estimate)", source: "Nowak et al. (2013), Environmental Pollution 178" },
  co2GreenRoof: { value: +ROOF_SINK.toFixed(2), unit: "kg CO₂/m²/yr", label: "Uptake by extensive green roofs", source: "Getter et al. (2009), in Whittinghill et al. (2014)" },
  roofShare: { value: 0.2, unit: "share", label: "Buildings whose roofs can be greened", source: "Joshi et al. (2020)" },
  surroundShare: { value: 0.1, unit: "share", label: "Ground around homes turned green", source: "Dimas (2025)" },
  buildingShare: { value: 0.49, unit: "share", label: "Share of city emissions from buildings", source: "Croci et al. (2021), 124 European cities" },
  retrofitCut: { value: 0.3, unit: "share", label: "Building CO₂ cut by an energy retrofit (low end 18%, Pasichnyi et al., 2019)", source: "Shu et al. (2024)" },
  densityDrive: { value: 0.055, unit: "share per 3.86 homes/ha", label: "More car fuel per 1,000 fewer homes per square mile", source: "Brownstone & Golob (2009)" },
  householdSize: { value: 2.3, unit: "people/home", label: "Average household size, EU", source: "Eurostat (2023)" },
} satisfies Record<string, Reference>;

/** Median emissions of the same land-use types (Wang et al., 2019, Table 5), the low end of the CO₂ range. */
const MEDIAN_CO2 = [21.45, 26.56, 28.95];
/** Low end of the retrofit saving: 18% less heat demand (Pasichnyi et al., 2019). */
const RETROFIT_CUT_LOW = 0.18;
/**
 * Below this many residents per hectare of housing land a place is sparser than the city blocks
 * the land-use emission factors were measured on, and CO₂ per resident is overstated: a scan of
 * 20 European places gave 99–410 for cities, 50–116 for towns and 14–32 for villages.
 */
export const SPARSE_RESIDENTS_HA = 40;
/** Neighbourhood radius for residential density, about a census block group as in Brownstone & Golob (2009). */
const DENSITY_RADIUS_M = 500;

/** Emission factor multiplier for a home cell: retrofits cut the building part of the land-use total. */
function retrofitFactor(m: CityModel, i: number, cut = R("retrofitCut")) {
  return m.retrofitted?.[i] ? 1 - R("buildingShare") * cut : 1;
}

/** Homes per hectare around each cell (box of about 2 × DENSITY_RADIUS_M, water excluded). */
function homeDensity(m: CityModel, people: Float32Array) {
  return perHectare(m, Float32Array.from(people, (p) => p / R("householdSize")));
}

/** A per-cell quantity summed over a box of about 2 × DENSITY_RADIUS_M and divided by its land (water excluded), per hectare. */
function perHectare(m: CityModel, values: Float32Array) {
  const { n, cellM } = m.grid;
  const rad = Math.max(1, Math.round(DENSITY_RADIUS_M / cellM));
  const W = n + 1;
  const sumP = new Float64Array(W * W), sumA = new Float64Array(W * W);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const i = r * n + c, k = (r + 1) * W + (c + 1);
      sumP[k] = values[i] + sumP[k - 1] + sumP[k - W] - sumP[k - W - 1];
      sumA[k] = (m.cls[i] === 9 ? 0 : 1) + sumA[k - 1] + sumA[k - W] - sumA[k - W - 1];
    }
  const box = (t: Float64Array, r0: number, c0: number, r1: number, c1: number) => t[r1 * W + c1] - t[r0 * W + c1] - t[r1 * W + c0] + t[r0 * W + c0];
  const cellHa = (cellM * cellM) / 10_000;
  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const r0 = Math.max(0, r - rad), c0 = Math.max(0, c - rad), r1 = Math.min(n, r + rad + 1), c1 = Math.min(n, c + rad + 1);
      const ha = box(sumA, r0, c0, r1, c1) * cellHa;
      out[r * n + c] = ha ? box(sumP, r0, c0, r1, c1) / ha : 0;
    }
  return out;
}

/** Reference home density of the city as built (resident-weighted), cached per city. */
const referenceDensity = new WeakMap<Float32Array, number>();
function baseDensity(m: CityModel) {
  if (!referenceDensity.has(m.residents)) {
    const d = homeDensity({ ...m, cls: m.baseCls }, m.residents);
    let w = 0, s = 0;
    for (let i = 0; i < d.length; i++) { s += d[i] * m.residents[i]; w += m.residents[i]; }
    referenceDensity.set(m.residents, w ? s / w : 0);
  }
  return referenceDensity.get(m.residents)!;
}

/**
 * Car travel CO₂ per cell: European car CO₂ per person (Brand et al., 2021), adjusted for
 * local home density (Brownstone & Golob, 2009: 5.5% more fuel per 3.86 fewer homes per
 * hectare) and cut by 39% for residents who meet the TOD transit standard (Park et al., 2018).
 */
function carTravel(m: CityModel, people: Float32Array) {
  const perPerson = R("travelCo2") * R("carShare") * 365;
  const d = homeDensity(m, people), d0 = baseDensity(m);
  let total = 0, tod = 0, density = 0;
  for (let i = 0; i < people.length; i++) {
    if (!(people[i] > 0)) continue;
    const factor = Math.min(1.5, Math.max(0.5, 1 - (R("densityDrive") * (d[i] - d0)) / 3.86));
    const base = people[i] * perPerson;
    density += base * (factor - 1);
    const car = base * factor;
    if (m.todStd[i]) tod += car * R("todDriveCut");
    total += car * (m.todStd[i] ? 1 - R("todDriveCut") : 1);
  }
  return { total, tod, density };
}

const R = (k: keyof typeof REFS) => REFS[k].value;

/** One measured TOD Standard metric. */
export interface TodMetric {
  principle: (typeof PRINCIPLES)[number];
  id: string;
  name: string;
  value: string;
  points: number;
  max: number;
  /** what the metric asks, in plain words */
  note: string;
  /** the measured numbers behind the value, for readers who want them */
  detail?: string;
  /** for a requirement without points: whether it is met */
  met?: boolean;
}

export interface Indicators {
  cells: Record<number, number>;
  population: number;
  popByClass: [number, number, number];
  /** residents meeting TOD Standard 4.A.1 (walking distance to qualifying transit) */
  popStd: number;
  popStdShare: number;
  stdShareByClass: [number, number, number];
  /** residents in the thesis catchment (straight line, any bus stop) */
  popThesis: number;
  popThesisShare: number;
  transportCo2AvoidedYearly: number;
  /** car travel CO₂ of all residents per year, after density and TOD effects */
  carCo2Total: number;
  carCo2PerResident: number;
  /** change in car CO₂ from home density compared with the city as built (negative = less) */
  carDensityEffect: number;
  /** building CO₂ saved by retrofits per year */
  retrofitSavings: number;
  residentialFloorM2: number;
  /** gross home floor area without shop ground floors */
  homesFloorM2: number;
  /** living space: official m² per person for today's homes, plus added floor × NET_LIVING_SHARE */
  livingSpaceM2: number;
  housingCapacity: number;
  spacePerPersonM2: number;
  /** residents per hectare of housing land (classes 1–3) */
  residentsPerHa: number;
  /** sparser than SPARSE_RESIDENTS_HA: CO₂ per resident is overstated */
  sparse: boolean;
  co2ByClass: [number, number, number];
  co2Residential: number;
  co2Commercial: number;
  co2Green: number;
  co2Total: number;
  /** CO₂ per resident, kg/yr: the official figure of the municipality scaled by the modelled change
   *  when an inventory value exists, otherwise the land-use estimate */
  co2PerCapita: number;
  /** land-use estimate per resident (thesis method): residential land only */
  co2PerCapitaModel: number;
  /** modelled CO₂ per resident of the whole area: homes, shops, green uptake and the change in car travel */
  co2Index: number;
  co2Source: "inventory" | "model";
  co2PerCapitaByClass: [number, number, number];
  greenRoofSavings: number;
  surroundingGreenSavings: number;
  totalReduction: number;
  totalReductionShare: number;
  density500: number;
  density1000: number;
  tod: TodMetric[];
  todPoints: number;
  todMax: number;
  /** which station area is scored: the main station, a new one the player built, or none */
  todStation: "main" | "new" | "none";
}

/** Floor area and residents per cell; cells a strategy or growth changed take the typical values of their new class. */
function cellValues(m: CityModel, set: FloorSet = m) {
  const N = m.cls.length;
  const floor = new Float32Array(N), people = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = m.cls[i];
    if (c === m.baseCls[i]) {
      floor[i] = set.floorM2[i];
      people[i] = m.residents[i];
    } else {
      floor[i] = c >= 1 && c <= 4 ? set.typicalFloorM2[c] : 0;
      people[i] = c >= 1 && c <= 3 ? floor[i] * set.peoplePerFloorM2 : 0;
    }
  }
  return { floor, people };
}

/**
 * Share of mapped home floor area (footprint × storeys) that is lived in: walls, stairs, offices
 * and shops the map shows as homes, and empty homes take the rest. Median against Eurostat's
 * living space per person in 15 cities and towns of 13 countries; the range is the middle half
 * of them (0.45–0.75). Used only for floor area that a strategy or growth adds or removes, and
 * for today's homes where no official figure exists.
 */
export const NET_LIVING_SHARE = 0.6;
const NET_LIVING_LOW = 0.45, NET_LIVING_HIGH = 0.75;

/** Low and high living space ÷ 40 m²: ±20% on the official figure, and the share range on modelled floor area. */
function housingRange(m: CityModel, resFloor: (set: FloorSet) => number): [number, number] {
  const h = m.housingAnchor;
  const per = R("spacePerPerson");
  if (!h) return [(resFloor(m.floorLow) * NET_LIVING_LOW) / per, (resFloor(m.floorHigh) * NET_LIVING_HIGH) / per];
  const today = h.todayPopulation * h.m2PerPerson;
  const added = homesFloor(m, cellValues(m).floor) - h.todayHomesFloor;
  return [(today * 0.8 + added * (added > 0 ? NET_LIVING_LOW : NET_LIVING_HIGH)) / per, (today * 1.2 + added * (added > 0 ? NET_LIVING_HIGH : NET_LIVING_LOW)) / per];
}

/** Home floor area without the ground floors that hold shops, cafés or offices (gross m²). */
function homesFloor(m: CityModel, floor: Float32Array) {
  const cellM2 = m.grid.cellM ** 2;
  let sum = 0;
  for (let i = 0; i < m.cls.length; i++)
    if (m.cls[i] >= 1 && m.cls[i] <= 3) sum += floor[i] - (m.business[i] ? Math.min(floor[i], m.coverage[i] * cellM2) : 0);
  return sum;
}

export interface Ranges {
  co2PerCapita: [number, number];
  popStdShare: [number, number];
  housingCapacity: [number, number];
}

/**
 * Plausible low and high values for the three headlines: median to mean emissions of
 * each land-use type in the source study; whether bus and tram stops run often enough
 * to count and how far people detour around blocks; and storey height (2.7–3.3 m),
 * floors of buildings without a height and the share of floor area that is living space.
 */
export function computeRanges(m: CityModel): Ranges {
  const resFloor = (set: FloorSet) => homesFloor(m, cellValues(m, set).floor);
  const cellM2 = m.grid.cellM ** 2;
  const mean = [R("co2Class1"), R("co2Class2"), R("co2Class3")];
  const { people } = cellValues(m);
  let total = 0, lowStd = 0, highStd = 0, co2Median = 0, co2Mean = 0;
  for (let i = 0; i < m.cls.length; i++) {
    total += people[i];
    if (m.todStdLow[i]) lowStd += people[i];
    if (m.todStdHigh[i]) highStd += people[i];
    const c = m.cls[i];
    if (c >= 1 && c <= 3) {
      co2Median += cellM2 * MEDIAN_CO2[c - 1] * retrofitFactor(m, i);
      co2Mean += cellM2 * mean[c - 1] * retrofitFactor(m, i, RETROFIT_CUT_LOW);
    }
  }
  return {
    co2PerCapita: total ? [co2Median / total, co2Mean / total] : [0, 0],
    popStdShare: total ? [lowStd / total, highStd / total] : [0, 0],
    housingCapacity: housingRange(m, resFloor),
  };
}

export function computeIndicators(m: CityModel): Indicators {
  const cellM2 = m.grid.cellM ** 2;
  const { floor, people } = cellValues(m);
  const cells: Record<number, number> = {};
  const popByClass: [number, number, number] = [0, 0, 0];
  const stdByClass = [0, 0, 0];
  const floorByClass = [0, 0, 0, 0];
  let population = 0, popStd = 0, popThesis = 0, baseFootprint = 0, baseResFloor = 0, green = 0, housingLand = 0;
  for (let i = 0; i < m.cls.length; i++) {
    const c = m.cls[i];
    cells[c] = (cells[c] ?? 0) + 1;
    population += people[i];
    if (m.todStd[i]) popStd += people[i];
    if (m.tod[i]) popThesis += people[i];
    if (c >= 1 && c <= 3) {
      housingLand += cellM2;
      popByClass[c - 1] += people[i];
      if (m.todStd[i]) stdByClass[c - 1] += people[i];
    }
    if (c >= 1 && c <= 4) floorByClass[c - 1] += floor[i];
    if (c === 7) green += cellM2;
    if (m.baseCls[i] >= 1 && m.baseCls[i] <= 3) {
      baseFootprint += m.coverage[i] * cellM2;
      baseResFloor += m.floorM2[i];
    }
  }
  const residentialFloorM2 = floorByClass[0] + floorByClass[1] + floorByClass[2];
  // Today's homes hold the official living space per person; floor area that a strategy or
  // growth adds or removes changes it at the calibrated share.
  const homesFloorM2 = homesFloor(m, floor);
  const h = m.housingAnchor;
  const livingSpaceM2 = h
    ? Math.max(0, h.todayPopulation * h.m2PerPerson + (homesFloorM2 - h.todayHomesFloor) * NET_LIVING_SHARE)
    : homesFloorM2 * NET_LIVING_SHARE;
  // Average storeys of homes here, to turn floor area back into roof area.
  const storeys = baseFootprint ? baseResFloor / baseFootprint : 2;
  const footprint = residentialFloorM2 / Math.max(1, storeys);

  // Transport (thesis Figures 17–19, corrected): car CO₂ per resident, adjusted for home density
  // and cut for residents who meet the TOD transit standard.
  const car = carTravel(m, people);
  const transportCo2AvoidedYearly = car.tod;

  // Urban emissions per m² of land by land-use type (thesis Figures 26–29; Wang et al., 2019),
  // with the building part cut where homes were retrofitted.
  const f = [R("co2Class1"), R("co2Class2"), R("co2Class3")];
  const co2ByClass: [number, number, number] = [0, 0, 0];
  let commercialArea = 0, retrofitSavings = 0;
  for (let i = 0; i < m.cls.length; i++) {
    const c = m.cls[i];
    if (c >= 1 && c <= 3) {
      const full = cellM2 * f[c - 1];
      const kept = full * retrofitFactor(m, i);
      co2ByClass[c - 1] += kept;
      retrofitSavings += full - kept;
    } else if (c === 4) commercialArea += cellM2;
  }
  const co2Residential = co2ByClass[0] + co2ByClass[1] + co2ByClass[2];
  const co2Commercial = commercialArea * R("co2Commercial");
  const co2Green = green * R("co2Green");
  const co2Total = co2Residential + co2Commercial + co2Green;

  // Green infrastructure (thesis Figures 30–34) with yearly uptake rates.
  const greenRoofSavings = -footprint * R("roofShare") * R("co2GreenRoof");
  const surroundingGreenSavings = -footprint * R("surroundShare") * R("co2Green");
  const totalReduction = transportCo2AvoidedYearly + greenRoofSavings + surroundingGreenSavings;

  const tod = bestStationArea(m, people);

  // CO₂ per resident starts from the official figure of the municipality (buildings and road fuel,
  // Moran et al., 2022) and changes by the modelled change of the whole area per resident: homes,
  // shops and offices, green uptake (so new parks count) and car travel against the city as built.
  const a = m.co2Anchor;
  const co2Index = population ? (co2Total + car.total - (a?.todayCar ?? car.total)) / population : 0;
  const anchored = a && a.todayIndex > 0 ? a.perResident * 1000 * (co2Index / a.todayIndex) : undefined;

  return {
    cells,
    population,
    popByClass,
    popStd,
    popStdShare: population ? popStd / population : 0,
    stdShareByClass: popByClass.map((p, k) => (p ? stdByClass[k] / p : 0)) as [number, number, number],
    popThesis,
    popThesisShare: population ? popThesis / population : 0,
    transportCo2AvoidedYearly,
    carCo2Total: car.total,
    carCo2PerResident: population ? car.total / population : 0,
    carDensityEffect: car.density,
    retrofitSavings,
    residentialFloorM2,
    homesFloorM2,
    livingSpaceM2,
    housingCapacity: livingSpaceM2 / R("spacePerPerson"),
    spacePerPersonM2: population ? residentialFloorM2 / population : 0,
    residentsPerHa: housingLand ? population / (housingLand / 10_000) : 0,
    sparse: housingLand > 0 && population / (housingLand / 10_000) < SPARSE_RESIDENTS_HA,
    co2ByClass,
    co2Residential,
    co2Commercial,
    co2Green,
    co2Total,
    co2PerCapita: anchored ?? (population ? co2Residential / population : 0),
    co2PerCapitaModel: population ? co2Residential / population : 0,
    co2Index,
    co2Source: anchored === undefined ? "model" : "inventory",
    co2PerCapitaByClass: co2ByClass.map((c, k) => (popByClass[k] ? c / popByClass[k] : 0)) as [number, number, number],
    greenRoofSavings,
    surroundingGreenSavings,
    totalReduction,
    totalReductionShare: co2Total > 0 ? totalReduction / co2Total : 0,
    density500: tod.density500,
    density1000: tod.density1000,
    tod: tod.metrics,
    todPoints: tod.metrics.reduce((s, t) => s + t.points, 0),
    todMax: tod.metrics.reduce((s, t) => s + t.max, 0),
    todStation: tod.station,
  };
}

/** Residents per cell, as the indicators count them (new homes at the area's residents per m²). */
export function residentsByCell(m: CityModel) {
  return cellValues(m).people;
}

/**
 * The Standard scores one station area at a time. Without new stations that is the main station;
 * with them, every new station is scored too and the best station area is shown, so a station
 * the player builds counts as soon as it does better than the one already there.
 */
function bestStationArea(m: CityModel, people: Float32Array) {
  const total = (r: ReturnType<typeof todStandard>) => r.metrics.reduce((s, t) => s + t.points, 0);
  let best: ReturnType<typeof todStandard> & { station: Indicators["todStation"]; cell?: number } = { ...todStandard(m, people), station: m.mainStation ? "main" : "none", cell: m.mainStation?.cell };
  for (const a of m.addedAreas ?? []) {
    const r = todStandard({ ...m, mainStation: { cell: a.cell, kind: "rail", added: true }, walkMainM: a.walkM }, people);
    if (best.station === "none" || total(r) > total(best)) best = { ...r, station: "new", cell: a.cell };
  }
  return best;
}

/**
 * The TOD Standard principles with at least one metric that free, Europe-wide open data measures
 * with confidence, in the Standard's order. Walk and Cycle have none: sidewalks, crossings, active
 * frontages and bike parking are mapped too unevenly across Europe.
 */
export const PRINCIPLES = ["Connect", "Transit", "Mix", "Densify", "Compact", "Shift"] as const;

/** Walking distance (m) to a public park or playground, counting new green from a strategy or growth. */
const parkWalks = new WeakMap<Uint8Array, Float32Array>();
function parkWalkM(m: CityModel) {
  if (!parkWalks.has(m.cls)) {
    const parks = m.parkMask.slice();
    for (let i = 0; i < parks.length; i++) if (m.cls[i] === 7 && m.baseCls[i] !== 7) parks[i] = 1;
    parkWalks.set(m.cls, walkDistance(parks, m.walkCosts.central, m.grid.n, m.grid.cellM * WALK_DETOUR, 600));
  }
  return parkWalks.get(m.cls)!;
}

/**
 * Gross residential density target near stations: at least 15,000 people per km² (UN-Habitat, 2014),
 * 150 residents per hectare of urban land.
 */
export const TARGET_RESIDENTS_HA = 150;

/** Urban land: everything but water and farmland, so a station by a field is not punished for the field. */
const urbanLand = (c: number) => c !== 8 && c !== 9;

/** Residents per hectare of urban land in the cells `inside` accepts. */
function residentDensity(m: CityModel, cls: Uint8Array, people: Float32Array, inside: (i: number) => boolean) {
  let pop = 0, cells = 0;
  for (let i = 0; i < cls.length; i++) {
    if (!inside(i) || !urbanLand(cls[i])) continue;
    pop += people[i];
    cells++;
  }
  return cells ? pop / ((cells * m.grid.cellM ** 2) / 10_000) : 0;
}

/**
 * Share of urban land with shops, cafés, offices or services: commercial land, and homes where the
 * map shows a business (OpenStreetMap points of interest).
 */
function activity(m: CityModel, cls: Uint8Array, inside: (i: number) => boolean) {
  let active = 0, cells = 0;
  for (let i = 0; i < cls.length; i++) {
    if (!inside(i) || !urbanLand(cls[i])) continue;
    cells++;
    if (cls[i] === 4 || (cls[i] >= 1 && cls[i] <= 3 && m.business[i])) active++;
  }
  return cells ? active / cells : 0;
}

/** Today's activity in the built-up part of the frame, the yardstick for the station area. */
const cityActivities = new WeakMap<Float32Array, number>();
function cityActivity(m: CityModel) {
  if (!cityActivities.has(m.residents)) {
    // Only the built-up part: cells within 200 m of urban fabric, so parks inside the city count but open land around it does not.
    const { n, cellM } = m.grid;
    const built = new Uint8Array(m.baseCls.length);
    for (let i = 0; i < built.length; i++) built[i] = m.baseCls[i] >= 1 && m.baseCls[i] <= 4 ? 1 : 0;
    const near = distanceTransform(built, n);
    cityActivities.set(m.residents, activity(m, m.baseCls, (i) => near[i] * cellM <= 200));
  }
  return cityActivities.get(m.residents)!;
}

/**
 * Metrics of the thesis principles that open map data can measure, with the Standard's
 * station-area point tables, for the catchment of the main station.
 */
function todStandard(m: CityModel, people: Float32Array) {
  const N = m.cls.length;
  const cellM2 = m.grid.cellM ** 2;
  const main = m.mainStation;
  const inCatchment = (i: number) => m.walkMainM[i] <= TOD_RAPID_M;
  let pop = 0, met = 0;
  let road = 0, land = 0, developable = 0, built = 0;
  for (let i = 0; i < N; i++) {
    const c = m.cls[i];
    pop += people[i];
    if (m.todStd[i]) met += people[i];
    if (!inCatchment(i)) continue;
    if (c !== 9) {
      land += cellM2;
      road += m.roadAreaM2[i];
    }
    // Developable sites (7.A.1): land outside protected areas, parks, water and transport. Built-up
    // includes building sites and previously developed open land (squares, car parks, cleared lots);
    // only land the map shows as farmland or nature is not built-up.
    if (m.zoning[i] === 1 && ((c >= 1 && c <= 4) || c === 6 || c === 8)) {
      developable++;
      if (c !== 8 || !m.openLand[i]) built++;
    }
  }
  const share = (v: number) => (pop ? v / pop : 0);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const fmt = (v: number) => v.toLocaleString("en", { maximumFractionDigits: 0 });
  const nf = fmt;

  // Densify, from what open data shows for every city: residents (EU census grid) against a
  // published target, and shops and services (OpenStreetMap) against the rest of the city. Floor
  // space and jobs are not in open data everywhere, and the Standard's benchmark district cannot be
  // found without property values.
  const inWalk = (d: number) => (i: number) => m.walkMainM[i] <= d;
  const d1000 = main ? residentDensity(m, m.cls, people, inWalk(1000)) : 0;
  const d500 = main ? residentDensity(m, m.cls, people, inWalk(500)) : 0;
  const targetPoints = main ? Math.round(8 * Math.min(1, d1000 / TARGET_RESIDENTS_HA)) : 0;
  const a1000 = main ? activity(m, m.cls, inWalk(1000)) : 0;
  const a500 = main ? activity(m, m.cls, inWalk(500)) : 0;
  const city = cityActivity(m);
  const busierThanCity = !!main && a1000 > city;
  const peaksAtStation = !!main && a500 > a1000;

  // Connect (3.A.1): block faces whose middle lies within a 1000 m walk of the station; the
  // Standard scores the length that 90% of blocks stay under.
  const faces = main ? m.blockFaces.filter((f) => inCatchment(f.cell)).map((f) => f.m).sort((a, b) => a - b) : [];
  const block90 = faces.length ? faces[Math.min(faces.length - 1, Math.floor(faces.length * 0.9))] : 0;
  const blockPoints = !faces.length ? 0 : block90 < 110 ? 10 : block90 < 130 ? 8 : block90 < 150 ? 6 : block90 < 170 ? 4 : block90 < 190 ? 2 : 0;

  // Mix (5.A.2, 5.A.3): share of built cells (buildings) within walking distance of each service.
  const parks = parkWalkM(m);
  let buildings = 0, food = 0, school = 0, health = 0, park = 0;
  if (main)
    for (let i = 0; i < N; i++) {
      if (!inCatchment(i) || !(m.cls[i] >= 1 && m.cls[i] <= 4)) continue;
      buildings++;
      if (m.serviceWalkM.food[i] <= 500) food++;
      if (m.serviceWalkM.school[i] <= 1000) school++;
      if (m.serviceWalkM.health[i] <= 1000) health++;
      if (parks[i] <= 500) park++;
    }
  const of = (v: number) => (buildings ? v / buildings : 0);
  const serviceTypes = [of(food), of(school), of(health)].filter((v) => v >= 0.8).length;

  // Compact
  const builtShare = developable ? built / developable : 0;
  const bikeShare = !!main && m.bikeShareM[main.cell] <= 1000;
  const local = !!main && m.walkDirectM[main.cell] <= 1000;
  const optionPoints = bikeShare ? 2 : local ? 1 : 0;

  const roadShare = land ? road / land : 0;

  const metrics: TodMetric[] = [
    {
      principle: "Connect", id: "3.A.1", name: "Short blocks",
      value: !main ? "no station" : faces.length ? `90% under ${fmt(block90)} m` : "no streets found",
      detail: main && faces.length ? `${fmt(faces.length)} block sides between corners within a 1000 m walk` : undefined,
      points: blockPoints, max: 10,
      note: "Short blocks give people many direct routes, so walking is quicker than driving. The streets, footpaths and steps on the map are joined into a walking network and each side of a block is measured from corner to corner; links under 25 m (crossings, slip lanes) are left out. Full points when 90% of block sides near the station are shorter than 110 m, 2 points up to 190 m.",
    },
    {
      principle: "Transit", id: "4.A.1", name: "Can residents walk to transit?",
      value: `${pct(share(met))} can`, points: 0, max: 0, met: share(met) >= 0.8,
      note: `Every TOD has to pass this first, and it earns no points. A home counts when a train, metro or rapid-bus station is within a ${nf(TOD_RAPID_M)} m walk, or a bus or tram stop within ${TOD_BUS_M} m. It passes when at least 80% of residents can. Open data does not show how often services run (the Standard asks for every 15 minutes), so this is the best case.`,
    },
    {
      principle: "Mix", id: "5.A.2", name: "Daily needs on foot",
      value: !main ? "no station" : `${serviceTypes} of 3 within reach`,
      detail: main ? `buildings within reach: fresh food ${pct(of(food))} (500 m), school ${pct(of(school))}, health care or pharmacy ${pct(of(health))} (1000 m)` : undefined,
      points: main ? serviceTypes : 0, max: 3,
      note: "Shops, schools and doctors near home let people do daily errands on foot. For each of fresh food (supermarket, greengrocer, butcher, market or corner shop) within a 500 m walk, a school within 1000 m, and a doctor, clinic, hospital or pharmacy within 1000 m: 1 point when at least 80% of the buildings near the station reach it. Places from OpenStreetMap, where these are among the best-mapped things in Europe.",
    },
    {
      principle: "Mix", id: "5.A.3", name: "Parks and playgrounds nearby",
      value: !main ? "no station" : `${pct(of(park))} of buildings`,
      points: main && of(park) >= 0.8 ? 1 : 0, max: 1,
      note: "A public park, village green or playground of at least 300 m² within a 500 m walk. 1 point when at least 80% of the buildings near the station have one. Private gardens do not count; new green from a strategy does.",
    },
    {
      principle: "Densify", id: "6.A.2", name: "People living near the station",
      value: main ? `${fmt(d1000)} residents/ha` : "no station",
      detail: `target ${TARGET_RESIDENTS_HA} residents per hectare (UN-Habitat, 2014)`,
      points: targetPoints, max: 8,
      note: `More people near a station means more people who can leave the car at home. Residents per hectare of urban land within a 1000 m walk of the main station (EU census 2021 grid), against UN-Habitat's target of ${TARGET_RESIDENTS_HA}. Points grow in step with density: full points at the target, half at half of it.`,
    },
    {
      principle: "Densify", id: "6.A.1", name: "Shops and services by the station",
      value: !main ? "no station" : busierThanCity && peaksAtStation ? "busiest by the station" : busierThanCity ? "busier than the city" : "quieter than the city",
      detail: main ? `share of cubes with shops, cafés, offices or services: ${pct(a500)} within 500 m, ${pct(a1000)} within 1000 m, ${pct(city)} in the built-up city` : undefined,
      points: (busierThanCity ? 4 : 0) + (peaksAtStation ? 3 : 0), max: 7,
      note: "Stations work best when people also travel to them for work and shopping, so trains are full in both directions and all day. Counts the cubes with shops, cafés, offices or public services on the map (OpenStreetMap). 4 points when the 1000 m walk around the main station has more of them than the built-up city today, 3 more when they are densest within 500 m.",
    },
    {
      principle: "Compact", id: "7.A.1", name: "Building inside the city",
      value: main ? `${pct(builtShare)} already built` : "no station",
      points: !main ? 0 : builtShare > 0.9 ? 8 : builtShare > 0.8 ? 6 : builtShare > 0.7 ? 4 : builtShare > 0.6 ? 2 : 0, max: 8,
      note: "Rewards using land that is already urban instead of fields. Of the land within a 1 km walk of the station that could be built on (not parks, water, transport or protected nature), the share that is already developed: buildings, building sites, squares and car parks. Only land the map shows as farmland or open nature counts as not built. Full points above 90%.",
    },
    {
      principle: "Compact", id: "7.B.1", name: "Other ways to travel on",
      value: !main ? "no station" : bikeShare ? "bike share nearby" : local ? "buses or trams" : "none found",
      points: optionPoints, max: 2,
      note: "2 points for a bike-share or bike-rental station within 1 km of the station, 1 point for bus or tram stops. The Standard asks that these run every 20 minutes or better, which open data does not show, so this is the best case.",
    },
    {
      principle: "Shift", id: "8.A.3", name: "Space taken by roads",
      value: main ? `${pct(roadShare)} of the land` : "no station", points: !main ? 0 : roadShare <= 0.15 ? 6 : roadShare <= 0.2 ? 3 : 0, max: 6,
      note: "Less road means more room for homes, parks and people. Road length comes from the map; the width of each road is a typical value for its type (25 m motorway, 14 m main road, 7 m street, 4 m service road, with parking lanes), as the map rarely records widths. Pedestrian streets, cycle paths, bus lanes, parking aisles and driveways do not count. Full points when roads cover 15% of the station area or less, half points up to 20%.",
    },
  ];
  return { metrics, density500: d500, density1000: d1000 };
}

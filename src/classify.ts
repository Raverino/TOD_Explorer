// Turns OpenStreetMap map-tile features into the 10 land-use classes of the thesis.
//
// Urban Atlas separates urban fabric by sealing degree (>80 %, 50–80 %, ...)
// of whole blocks (minimum 0.25 ha). OSM has no sealing data, so the share of
// a ~125 m neighbourhood covered by building footprints is used instead.
// The thresholds were calibrated so that class 1–3 areas match Copernicus Urban
// Atlas 2018 in validation samples. Residents do not depend on these classes: they
// come from the measured GHS-POP grid (see population.ts).

import type { Inventory } from "./inventory";
import { Grid, toGrid } from "./geo";
import { LonLat, MapData, StopKind } from "./tiles";
import { PopulationGrid } from "./population";
import { Terrain } from "./elevation";
import { distanceTransform, drawLine, fillPolygon, walkDistance } from "./raster";
import { BlockFace, blockFaces } from "./blocks";

/** The inventory value that CO₂ per resident starts from, and the modelled values it is scaled by. */
export interface Co2Anchor extends Inventory {
  /** modelled CO₂ index per resident of the city as built, kg */
  todayIndex: number;
  /** modelled car CO₂ of the city as built, kg */
  todayCar: number;
}

/** Today's homes hold the official living space per person; only added or removed floor area is modelled. */
export interface HousingAnchor {
  m2PerPerson: number;
  /** true when the figure is for this country, false for the EU average */
  national: boolean;
  /** Eurostat degree of urbanisation of the frame: 0 city, 1 town or suburb, 2 rural area */
  settlement: 0 | 1 | 2;
  todayHomesFloor: number;
  todayPopulation: number;
}

export interface Station {
  cell: number;
  /** brt: a bus stop on a dedicated busway */
  kind: StopKind | "brt";
  /** a new station placed in the game */
  added?: boolean;
}

export interface CityModel {
  grid: Grid;
  /** land-use class 1–10 per cell */
  cls: Uint8Array;
  /** classes as built from the map, before any strategy or growth */
  baseCls: Uint8Array;
  /** share of the cell covered by building footprints (0–1) */
  coverage: Float32Array;
  /** mean height of the buildings in the cell, metres (0 when unknown) */
  height: Float32Array;
  /** 1 = developable, 0 = protected (thesis zoning raster) */
  zoning: Uint8Array;
  /** 1 where the map shows farmland or natural open land (not an untagged gap in the city) */
  openLand: Uint8Array;
  /** 1 on public parks and playgrounds of at least 300 m² (TOD Standard 5.A.3) */
  parkMask: Uint8Array;
  /** walking distance (m) to fresh food, a school and health care or a pharmacy (TOD Standard 5.A.2) */
  serviceWalkM: { food: Float32Array; school: Float32Array; health: Float32Array };
  /** block faces of the walking network (TOD Standard 3.A.1) */
  blockFaces: BlockFace[];
  /** thesis catchment: straight line 1000 m to rail, metro, tram or ferry, 500 m to bus */
  tod: Uint8Array;
  /** TOD Standard 4.A.1: walking 1000 m to rapid transit or 500 m to a connected bus or tram */
  todStd: Uint8Array;
  /** range of 4.A.1: rapid transit only with long detours, and every connected stop with short detours */
  todStdLow: Uint8Array;
  todStdHigh: Uint8Array;
  stations: Station[];
  distTransitM: Float32Array;
  distRoadM: Float32Array;
  terrain: Terrain;
  /** walking distances (m) along streets and paths; Infinity beyond the search limit */
  walkRapidM: Float32Array;
  walkDirectM: Float32Array;
  /** the station area the TOD Standard check evaluates: the rail or metro station nearest the
   *  centre of the frame (BRT when there is none); absent without rapid transit */
  mainStation?: Station;
  /** walking distance (m) to the main station */
  walkMainM: Float32Array;
  /** walking cost grids, kept so transit access can be recomputed when stations are added */
  walkCosts: WalkCosts;
  /** cells of new stations placed in the game */
  addedStations?: number[];
  /** walking distance (m) to each new station, so its station area can be scored like the main one */
  addedAreas?: { cell: number; walkM: Float32Array }[];
  /** gross floor area per cell (m²): footprint × floors */
  floorM2: Float32Array;
  /** typical floor area of a cell of each class here (index = class) */
  typicalFloorM2: number[];
  /** measured residents per cell (GHS-POP 2020, spread by residential floor area) */
  residents: Float32Array;
  /** residents per m² of residential floor area in this area */
  peoplePerFloorM2: number;
  /** motor-vehicle carriageway area per cell (m²) */
  roadAreaM2: Float32Array;
  /** straight-line distance (m) to a bike-share station (TOD Standard 7.B.1) */
  bikeShareM: Float32Array;
  /** 1 where the map shows a shop, café, office or public service in the cell */
  business: Uint8Array;
  /** official CO₂ of the municipality at the centre, with the modelled index of the city as built */
  co2Anchor?: Co2Anchor;
  /** official living space per person, with the home floor area and residents of the city as built */
  housingAnchor?: HousingAnchor;
  /** homes a strategy retrofitted (set by the strategy, absent on the built city) */
  retrofitted?: Uint8Array;
  /** floor area with 3.3 m storeys (low) and 2.7 m storeys (high), for the uncertainty range */
  floorLow: FloorSet;
  floorHigh: FloorSet;
  stats: { buildings: number; stops: number; rapidStops: number; areas: number; tiles: number };
}

/** Floor area per cell and the values used for cells whose class changes. */
export interface FloorSet {
  floorM2: Float32Array;
  typicalFloorM2: number[];
  peoplePerFloorM2: number;
}

/** Neighbourhood footprint coverage thresholds that turn cells into urban fabric classes 1–3. */
export interface FabricParams {
  /** coverage needed for high density (class 1) */
  highCoverage: number;
  /** coverage needed for medium density (class 2) */
  mediumCoverage: number;
  /** coverage needed for any urban fabric (class 3) */
  lowCoverage: number;
  /** side of the neighbourhood window in metres */
  windowM: number;
}

/** Calibrated against Copernicus Urban Atlas 2018 (see the comment at the top). */
export const DEFAULT_FABRIC: FabricParams = { highCoverage: 0.275, mediumCoverage: 0.125, lowCoverage: 0.085, windowM: 125 };

/** Sub-cells per cell side used to measure building coverage. */
const SUPERSAMPLE = 4;

/** Ferries count as a direct service: open map data cannot tell a frequent ferry from a tourist boat. */
const isRapid = (s: Station) => s.kind === "rail" || s.kind === "brt";

/** Walking cost per cell: the central estimate, and longer and easier detours for the range. */
export interface WalkCosts {
  central: Float32Array;
  long: Float32Array;
  easy: Float32Array;
}

/** Station cells are always walkable (a station sits on its own platform or square). */
function withStationCells(cost: Float32Array, stations: Station[]) {
  const c = cost.slice();
  for (const s of stations) c[s.cell] = 1;
  return c;
}

/**
 * Everything that depends on where the stops are: the thesis catchment (straight line, 1000 m to
 * rail, metro, tram or ferry, 500 m to bus), distance to any stop, and TOD Standard 4.A.1 along
 * streets with its range. Rerun when stations are added.
 */
function transitAccess(grid: Grid, stations: Station[], costs: WalkCosts) {
  const { n, cellM } = grid;
  const N = n * n;
  const mask = (pred: (s: Station) => boolean) => {
    const m = new Uint8Array(N);
    for (const s of stations) if (pred(s)) m[s.cell] = 1;
    return m;
  };
  const far = new Float32Array(N).fill(1e9);
  const euclid = (m: Uint8Array) => (m.some(Boolean) ? distanceTransform(m, n).map((v) => v * cellM) : far);
  const thesisRapid = euclid(mask((s) => s.kind !== "bus"));
  const thesisBus = euclid(mask((s) => s.kind === "bus"));
  const distTransitM = euclid(mask(() => true));
  const tod = new Uint8Array(N);
  for (let i = 0; i < N; i++) tod[i] = thesisRapid[i] <= TOD_RAPID_M || thesisBus[i] <= TOD_BUS_M ? 1 : 0;

  // Grid paths are shorter than real routes; scaling each step by the detour factor corrects that.
  const walkCellM = cellM * WALK_DETOUR;
  const cost = withStationCells(costs.central, stations);
  const rapidMask = mask(isRapid);
  const distRapidEuclid = euclid(rapidMask);
  const directMask = mask((s) => (s.kind === "bus" || s.kind === "tram" || s.kind === "ferry") && distRapidEuclid[s.cell] <= FEEDER_KM * 1000);
  const walkRapidM = walkDistance(rapidMask, cost, n, walkCellM, 1500);
  const walkDirectM = walkDistance(directMask, cost, n, walkCellM, 800);
  const todStd = new Uint8Array(N);
  for (let i = 0; i < N; i++) todStd[i] = walkRapidM[i] <= TOD_RAPID_M || walkDirectM[i] <= TOD_BUS_M ? 1 : 0;
  // Range: the low end counts only rapid transit (no bus or tram runs every 15 minutes) with
  // longer detours around blocks; the high end counts every connected stop with shorter detours.
  const todStdLow = new Uint8Array(N), todStdHigh = new Uint8Array(N);
  const rapidLow = walkDistance(rapidMask, withStationCells(costs.long, stations), n, walkCellM, 1100);
  const easy = withStationCells(costs.easy, stations);
  const rapidHigh = walkDistance(rapidMask, easy, n, walkCellM, 1100);
  const directHigh = walkDistance(directMask, easy, n, walkCellM, 600);
  for (let i = 0; i < N; i++) {
    todStdLow[i] = rapidLow[i] <= TOD_RAPID_M ? 1 : 0;
    todStdHigh[i] = rapidHigh[i] <= TOD_RAPID_M || directHigh[i] <= TOD_BUS_M ? 1 : 0;
  }
  return { tod, todStd, todStdLow, todStdHigh, distTransitM, walkRapidM, walkDirectM };
}

/**
 * The city with new rail or metro stations at `cells` (added by the player, or suggested where
 * the city grows). Transit-dependent fields are recomputed, and each new station gets a station
 * area of its own for the TOD Standard check.
 */
export function withStations(m: CityModel, cells: number[]): CityModel {
  if (!cells.length) return m;
  const stations = [...m.stations.filter((s) => !s.added), ...cells.map((cell): Station => ({ cell, kind: "rail", added: true }))];
  const { n, cellM } = m.grid;
  const costs = withStationCells(m.walkCosts.central, stations);
  const addedAreas = cells.map((cell) => {
    const mask = new Uint8Array(n * n);
    mask[cell] = 1;
    return { cell, walkM: walkDistance(mask, costs, n, cellM * WALK_DETOUR, 1100) };
  });
  return { ...m, stations, addedStations: cells, addedAreas, ...transitAccess(m.grid, stations, m.walkCosts) };
}

/** TOD Standard walking distances (ITDP, 2017): rapid transit and direct services. */
export const TOD_RAPID_M = 1000;
export const TOD_BUS_M = 500;

export function classify(grid: Grid, map: MapData, terrain: Terrain, pop: PopulationGrid, fabricParams: FabricParams = DEFAULT_FABRIC): CityModel {
  const { highCoverage, mediumCoverage, lowCoverage, windowM } = fabricParams;
  const { n, cellM } = grid;
  const N = n * n;
  const project = (ring: LonLat[], scale = 1) =>
    ring.map(([lon, lat]) => {
      const [x, y] = toGrid(grid, lon, lat);
      return [x * scale, y * scale] as [number, number];
    });

  // 1. Land-use areas, painted from low to high priority.
  const land = new Uint8Array(N);
  const zoning = new Uint8Array(N).fill(1);
  const protectedMask = new Uint8Array(N);
  for (const a of map.areas.filter((a) => a.kind === "protected"))
    fillPolygon(a.rings.map((r) => project(r)), n, (i) => (protectedMask[i] = 1));
  map.areas
    .filter((a) => a.kind !== "protected")
    .sort((a, b) => a.priority - b.priority)
    .forEach((a) => {
      // Residential land use leaves the class to the building coverage rule below.
      const value = a.kind === "residential" ? 0 : (a.kind as number);
      fillPolygon(a.rings.map((r) => project(r)), n, (i) => (land[i] = value));
    });

  // 2. Building footprint coverage per cell, measured on a finer sub-grid. Where smaller building
  //    parts lie inside a bigger outline (a tower on a podium), the parts give the height: some
  //    outlines carry the height of their tallest part over the whole footprint (Warsaw's Palace
  //    of Culture: 237 m over 2 ha). An outline is a building that smaller ones cover for 10% or more.
  const sub = n * SUPERSAMPLE;
  const shapes = map.buildings.map((b) => b.rings.map((r) => project(r, SUPERSAMPLE)));
  const size = new Int32Array(shapes.length);
  shapes.forEach((s, k) => fillPolygon(s, sub, () => size[k]++));
  const bySize = shapes.map((_, k) => k).sort((a, b) => size[b] - size[a]);
  const owner = new Int32Array(sub * sub).fill(-1);
  const overlapped = new Int32Array(shapes.length);
  for (const k of bySize)
    fillPolygon(shapes[k], sub, (i) => {
      if (owner[i] >= 0) overlapped[owner[i]]++;
      owner[i] = k;
    });
  const isOutline = (k: number) => overlapped[k] >= 0.1 * size[k];
  const built = new Float32Array(sub * sub).fill(-1);
  for (const k of bySize) if (!isOutline(k)) fillPolygon(shapes[k], sub, (i) => (built[i] = Math.max(built[i], map.buildings[k].height)));
  // Outlines fill only what no part covers, inner ones first.
  for (const k of bySize.slice().reverse())
    if (isOutline(k)) fillPolygon(shapes[k], sub, (i) => built[i] < 0 && (built[i] = map.buildings[k].height));
  const coverage = new Float32Array(N);
  const height = new Float32Array(N);
  const perCell = 1 / (SUPERSAMPLE * SUPERSAMPLE);
  for (let i = 0; i < sub * sub; i++)
    if (built[i] >= 0) {
      const cell = Math.floor(i / sub / SUPERSAMPLE) * n + Math.floor((i % sub) / SUPERSAMPLE);
      coverage[cell] += perCell;
      height[cell] += built[i];
    }
  for (let i = 0; i < N; i++) if (coverage[i] > 0) height[i] /= coverage[i] / perCell;

  // 3. Linear networks. All streets feed the road distance raster; motorways, big roads and
  //    rail become class 5 cells on a fine grid. Streets and paths form the walking network.
  const roadSrc = new Uint8Array(N);
  const transportCell = new Uint8Array(N);
  const riverCell = new Uint8Array(N);
  const walkable = new Uint8Array(N);
  const motorway = new Uint8Array(N);
  const railLine = new Uint8Array(N);
  const busway = new Uint8Array(N);
  const roadAreaM2 = new Float32Array(N);
  const fine = cellM <= 50;
  for (const l of map.lines) {
    const pts = project(l.coords);
    if (l.kind === "motorway" || l.kind === "major-road" || l.kind === "road" || l.kind === "service") {
      // A one-way motorway or main road is usually one carriageway of a dual road, so it gets
      // half the width; one-way local streets are ordinary single streets.
      const dual = l.oneway && (l.kind === "motorway" || l.kind === "major-road");
      const width = ROAD_WIDTH_M[l.kind] * (dual ? 0.5 : 1);
      drawLine(pts, n, (i) => (roadSrc[i] = 1));
      if (!l.offStreet) alongLine(pts, n, (i, lenCells) => (roadAreaM2[i] += lenCells * cellM * width));
      if ((l.kind === "motorway" || l.kind === "major-road") && fine) drawLine(pts, n, (i) => (transportCell[i] = 1));
    }
    if (l.kind === "motorway") drawLine(pts, n, (i) => (motorway[i] = 1));
    if (l.kind === "major-road" || l.kind === "road" || l.kind === "service" || l.kind === "walk") drawLine(pts, n, (i) => (walkable[i] = 1));
    if (l.kind === "busway") drawLine(pts, n, (i) => (busway[i] = 1));
    if (l.kind === "rail") {
      drawLine(pts, n, (i) => (railLine[i] = 1));
      if (fine) drawLine(pts, n, (i) => (transportCell[i] = 1));
    } else if (l.kind === "river" && fine) drawLine(pts, n, (i) => (riverCell[i] = 1));
  }

  // 4. Neighbourhood coverage: mean footprint coverage in a window of about windowM.
  const rad = Math.max(0, Math.round((windowM / cellM - 1) / 2));
  const blockCoverage = new Float32Array(N);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      let sum = 0, count = 0;
      for (let rr = Math.max(0, r - rad); rr <= Math.min(n - 1, r + rad); rr++)
        for (let cc = Math.max(0, c - rad); cc <= Math.min(n - 1, c + rad); cc++) {
          sum += coverage[rr * n + cc];
          count++;
        }
      blockCoverage[r * n + c] = sum / count;
    }

  // Mapped farmland and natural land; untagged open cells in a city are mostly squares, car parks
  // and cleared lots, which the TOD Standard counts as built-up (7.A.1).
  const openLand = new Uint8Array(N);
  for (let i = 0; i < N; i++) openLand[i] = land[i] === 8 ? 1 : 0;

  // 5. Final class per cell. Mapped land uses win; the rest is urban fabric when enough is built around it.
  const cls = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const l = land[i], cov = blockCoverage[i];
    if (l === 9 || riverCell[i]) cls[i] = 9;
    else if (l === 10 || l === 7 || l === 6 || l === 4 || l === 5) cls[i] = l;
    else if (transportCell[i]) cls[i] = 5;
    else if (cov >= lowCoverage) cls[i] = cov >= highCoverage ? 1 : cov >= mediumCoverage ? 2 : 3;
    else cls[i] = 8;
  }

  // 6. Zoning: protected areas are closed to development, existing urban land stays allowed (thesis Listing 3).
  for (let i = 0; i < N; i++) if (protectedMask[i] && !(cls[i] >= 1 && cls[i] <= 4)) zoning[i] = 0;

  // 7. Floor area from real footprints × floors (building height ÷ storey height). Cells
  //    without a height use the median floors of their class in this area. The central
  //    estimate uses 3 m storeys; the range uses 3.3 m and 2.7 m storeys, with one floor
  //    less or more where the height is unknown.
  const floorSet = (storeyM: number, unknownDelta: number) => {
    const floors = new Float32Array(N);
    const known: number[][] = Array.from({ length: 11 }, () => []);
    for (let i = 0; i < N; i++)
      if (coverage[i] > 0 && height[i] > 0) {
        floors[i] = Math.max(1, Math.min(60, Math.round(height[i] / storeyM)));
        known[cls[i]].push(floors[i]);
      }
    const medianFloors = known.map((v, k) => Math.max(1, (v.length ? median(v) : DEFAULT_FLOORS[k] ?? 1) + unknownDelta));
    const floorM2 = new Float32Array(N);
    for (let i = 0; i < N; i++) floorM2[i] = coverage[i] * cellM * cellM * (floors[i] || medianFloors[cls[i]]);
    // Typical floor area of a cell per class, used when a strategy or growth changes the class of a cell.
    const typicalFloorM2 = Array.from({ length: 11 }, (_, k) => {
      const v: number[] = [];
      for (let i = 0; i < N; i++) if (cls[i] === k && floorM2[i] > 0) v.push(floorM2[i]);
      return v.length >= 20 ? median(v) : (FALLBACK_FAR[k] ?? 0) * cellM * cellM;
    });
    return { floorM2, typicalFloorM2, peoplePerFloorM2: 0 };
  };
  const central = floorSet(STOREY_M, 0);
  const floorLow = floorSet(STOREY_HIGH_M, -1);
  const floorHigh = floorSet(STOREY_LOW_M, 1);
  const { floorM2, typicalFloorM2 } = central;

  // 8. Residents: measured GHS-POP counts spread onto the cells of each ~90 m pixel in
  //    proportion to residential floor area (by area where a pixel has no housing).
  const residents = distributePopulation(grid, pop, (i) => (cls[i] >= 1 && cls[i] <= 3 ? floorM2[i] : 0), (i) => cls[i] !== 9);
  for (const set of [central, floorLow, floorHigh]) {
    let resFloor = 0, resPeople = 0;
    for (let i = 0; i < N; i++)
      if (cls[i] >= 1 && cls[i] <= 3 && set.floorM2[i] > 0) {
        resFloor += set.floorM2[i];
        resPeople += residents[i];
      }
    set.peoplePerFloorM2 = resFloor ? resPeople / resFloor : 0;
  }
  const peoplePerFloorM2 = central.peoplePerFloorM2;

  // 9. Transit stops and the thesis catchment (straight line: 1000 m to rail, metro, tram or ferry, 500 m to bus).
  const stations: Station[] = [];
  const stopCell = new Map<number, StopKind>();
  for (const s of map.stops) {
    const [x, y] = toGrid(grid, s.lon, s.lat);
    const c = Math.floor(x), r = Math.floor(y);
    if (c < 0 || r < 0 || c >= n || r >= n) continue;
    const cell = r * n + c;
    const prev = stopCell.get(cell);
    if (!prev || STOP_RANK[s.kind] > STOP_RANK[prev]) stopCell.set(cell, s.kind);
  }
  // A bus stop on a dedicated busway is treated as bus rapid transit.
  for (const [cell, kind] of stopCell) stations.push({ cell, kind: kind === "bus" && nearMask(busway, cell, n, 1) ? "brt" : kind });
  const toM = (d: Float32Array) => d.map((v) => v * cellM);
  const distRoadM = roadSrc.some(Boolean) ? toM(distanceTransform(roadSrc, n)) : new Float32Array(N).fill(1e9);

  // 10. TOD Standard 4.A.1 (strict): walking distance along streets and paths, 1000 m to rapid
  //     transit (rail, metro, ferry, BRT) or 500 m to a direct service (bus or tram) that
  //     connects to rapid transit within 5 km. Service frequency is not in open map data.
  const makeCost = (offStreet: number) => {
    const cost = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const barrier = fine && !walkable[i] && (cls[i] === 9 || motorway[i] || railLine[i]);
      cost[i] = barrier ? Infinity : walkable[i] ? 1 : offStreet;
    }
    return cost;
  };
  const walkCosts: WalkCosts = { central: makeCost(OFF_STREET_COST), long: makeCost(OFF_STREET_COST_HIGH), easy: makeCost(OFF_STREET_COST_LOW) };
  const access = transitAccess(grid, stations, walkCosts);

  // 11. The station area the TOD Standard check evaluates, as the Standard scores one station
  //     area at a time: the rail or metro station nearest the centre of the frame.
  const rapid = stations.filter(isRapid);
  const pool = rapid.some((s) => s.kind === "rail") ? rapid.filter((s) => s.kind === "rail") : rapid;
  const fromCentre = (s: Station) => (Math.floor(s.cell / n) - n / 2) ** 2 + ((s.cell % n) - n / 2) ** 2;
  const mainStation = pool.reduce<Station | undefined>((best, s) => (!best || fromCentre(s) < fromCentre(best) ? s : best), undefined);
  const mainMask = new Uint8Array(N);
  if (mainStation) mainMask[mainStation.cell] = 1;
  const walkMainM = mainStation ? walkDistance(mainMask, withStationCells(walkCosts.central, stations), n, cellM * WALK_DETOUR, 1100) : new Float32Array(N).fill(1e9);

  // 12. Services: bike-share stations (7.B.1), businesses for the mix of uses (6.A.1), fresh food,
  //     schools and health care (5.A.2), and parks and playgrounds (5.A.3).
  const marks = { bike_share: new Uint8Array(N), business: new Uint8Array(N), food: new Uint8Array(N), school: new Uint8Array(N), health: new Uint8Array(N), play: new Uint8Array(N) };
  for (const v of map.services) {
    const [x, y] = toGrid(grid, v.lon, v.lat);
    const c = Math.floor(x), r = Math.floor(y);
    if (c >= 0 && r >= 0 && c < n && r < n) marks[v.kind][r * n + c] = 1;
  }
  const { business } = marks;
  const bikeShareM = marks.bike_share.some(Boolean) ? toM(distanceTransform(marks.bike_share, n)) : new Float32Array(N).fill(1e9);
  const parkMask = marks.play.slice();
  for (const a of map.areas) {
    if (!a.park) continue;
    const rings = a.rings.map((r) => project(r));
    // Parks and playgrounds count from 300 m² (TOD Standard 5.A.3); small ones mark the cell at their centre.
    const outer = rings[0];
    let area = 0, cx = 0, cy = 0;
    for (let k = 0, j = outer.length - 1; k < outer.length; j = k++) area += (outer[j][0] * outer[k][1] - outer[k][0] * outer[j][1]) / 2;
    for (const [x, y] of outer) {
      cx += x / outer.length;
      cy += y / outer.length;
    }
    if (Math.abs(area) * cellM * cellM < 300) continue;
    fillPolygon(rings, n, (i) => (parkMask[i] = 1));
    const c = Math.floor(cx), r = Math.floor(cy);
    if (c >= 0 && r >= 0 && c < n && r < n) parkMask[r * n + c] = 1;
  }
  const walkTo = (mask: Uint8Array) => walkDistance(mask, walkCosts.central, n, cellM * WALK_DETOUR, 1100);
  const serviceWalkM = { food: walkTo(marks.food), school: walkTo(marks.school), health: walkTo(marks.health) };

  return {
    grid, cls, baseCls: cls.slice(), coverage, height, zoning, openLand, stations, ...access, distRoadM, terrain, walkCosts,
    mainStation, walkMainM,
    floorM2, typicalFloorM2, residents, peoplePerFloorM2, roadAreaM2, floorLow, floorHigh, bikeShareM, business,
    parkMask, serviceWalkM, blockFaces: blockFaces(grid, map.lines),
    stats: {
      buildings: map.buildings.length,
      stops: stations.length,
      rapidStops: stations.filter(isRapid).length,
      areas: map.areas.length,
      tiles: map.tiles,
    },
  };
}

/** Assumed carriageway width (m) including on-street parking, for TOD Standard 8.A.3 (roadway area). */
const ROAD_WIDTH_M = { motorway: 25, "major-road": 14, road: 7, service: 4 };
/** Storey height used to turn building height into floors (central, and the range ends). */
const STOREY_M = 3;
const STOREY_LOW_M = 2.7;
const STOREY_HIGH_M = 3.3;
/** Floors assumed per class when no building in the area has a height. */
const DEFAULT_FLOORS: Record<number, number> = { 1: 5, 2: 3, 3: 2, 4: 2, 10: 1 };
/** Floor area ratio assumed when an area has too few cells of a class to measure it. */
const FALLBACK_FAR: Record<number, number> = { 1: 2.0, 2: 1.0, 3: 0.3, 4: 0.8 };
/** Walking effort to cut through a block instead of using a street or path (central, and the range ends). */
const OFF_STREET_COST = 2.5;
const OFF_STREET_COST_LOW = 1.5;
const OFF_STREET_COST_HIGH = 4;
/**
 * Real walking routes are about 20% longer than paths on the grid: the median ratio over 63
 * homes in Utrecht and Rome, compared with OSRM foot routes on OpenStreetMap.
 */
export const WALK_DETOUR = 1.2;
/** TOD Standard: a direct service must connect to rapid transit within 5 km. */
const FEEDER_KM = 5;
const STOP_RANK: Record<StopKind, number> = { bus: 0, tram: 1, ferry: 2, rail: 3 };

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function nearMask(m: Uint8Array, cell: number, n: number, rad: number) {
  const r = Math.floor(cell / n), c = cell % n;
  for (let dr = -rad; dr <= rad; dr++)
    for (let dc = -rad; dc <= rad; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && m[rr * n + cc]) return true;
    }
  return false;
}

/** Calls back with every cell a polyline crosses and the length (in cells) it runs through it. */
function alongLine(coords: [number, number][], n: number, add: (i: number, lenCells: number) => void) {
  for (let k = 0; k < coords.length - 1; k++) {
    const [x0, y0] = coords[k], [x1, y1] = coords[k + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 4));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const c = Math.floor(x0 + (x1 - x0) * t), r = Math.floor(y0 + (y1 - y0) * t);
      if (c >= 0 && r >= 0 && c < n && r < n) add(r * n + c, len / steps);
    }
  }
}

/**
 * Spreads each population pixel over the grid cells it overlaps (3 × 3 samples per
 * pixel), in proportion to `weight` (residential floor area). Pixels whose cells have
 * no weight are spread by area over cells allowed by `fallback`.
 */
function distributePopulation(grid: Grid, pop: PopulationGrid, weight: (i: number) => number, fallback: (i: number) => boolean) {
  const { n } = grid;
  const residents = new Float32Array(n * n);
  const S = 3;
  const cells: number[] = [];
  for (let py = 0; py < pop.height; py++)
    for (let px = 0; px < pop.width; px++) {
      const people = pop.data[py * pop.width + px];
      if (!(people > 0)) continue;
      cells.length = 0;
      for (let a = 0; a < S; a++)
        for (let b = 0; b < S; b++) {
          const lon = pop.west + (px + (b + 0.5) / S) * pop.res;
          const lat = pop.north - (py + (a + 0.5) / S) * pop.res;
          const [x, y] = toGrid(grid, lon, lat);
          const c = Math.floor(x), r = Math.floor(y);
          if (c >= 0 && r >= 0 && c < n && r < n) cells.push(r * n + c);
        }
      if (!cells.length) continue;
      // Only the part of the pixel inside the area counts.
      const share = (people * cells.length) / (S * S);
      let w = 0;
      for (const i of cells) w += weight(i);
      if (w > 0) for (const i of cells) residents[i] += (share * weight(i)) / w;
      else {
        const ok = cells.filter(fallback);
        for (const i of ok) residents[i] += share / ok.length;
      }
    }
  return residents;
}

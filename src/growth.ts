// Speculative urban growth to 2050: a browser port of the SIMLANDER "typical
// model, summed" (TM_S) used in the thesis, followed by the traceback algorithm
// that gives every new urban cell a land-use class (Dimas, 2025, sections 6.1–6.4).

import { CityModel } from "./classify";
import { distanceTransform } from "./raster";
import { mulberry32 } from "./scenarios";

export const START_YEAR = 2025;
export const END_YEAR = 2050;

/**
 * New urban land the city may open by 2050, as a share of today's urban land. "Plenty" is about
 * the thesis high urban demand (+29.5%, Table 6); "a little" about its regular demand (+4.7%).
 */
export const LAND_PRESETS = [
  { id: "none", label: "No new land", share: 0 },
  { id: "little", label: "A little", share: 0.05 },
  { id: "plenty", label: "Plenty", share: 0.3 },
] as const;

export interface GrowthResult {
  /** year a cell became urban (0 = not grown) */
  yearAdded: Int16Array;
  /** traceback class of every grown cell */
  tbClass: Uint8Array;
  /** cells added per year */
  perYear: number[];
  /** grown cells in the order they were allocated */
  order: Int32Array;
  /** cells the demand asked for by 2050 (more than were placed when the area runs out of room) */
  requested: number;
}

const URBAN = (c: number) => c >= 1 && c <= 6;
/** Allocation rounds per simulated year. */
const ROUNDS_PER_YEAR = 4;
/**
 * Land the city can grow onto: agricultural and open land, plus urban green in Baseline.
 * TOD strategies protect green areas through zoning (thesis 8.1.2), as well as OSM protected areas.
 */
const VACANT = (c: number, tod: boolean) => c === 8 || (!tod && c === 7);

/** SIMLANDER slope suitability (allocator.R reclass table, degrees → score). */
function slopeScore(deg: number) {
  return deg <= 1 ? 1 : deg <= 2 ? 0.9 : deg <= 3 ? 0.8 : deg <= 4 ? 0.5 : 0.1;
}

function normalise(a: Float32Array, mask?: Uint8Array) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < a.length; i++) if (!mask || mask[i]) { min = Math.min(min, a[i]); max = Math.max(max, a[i]); }
  const span = max - min || 1;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - min) / span;
  return a;
}

/**
 * Grows the city year by year. `tod` selects the thesis TOD setup: accessibility
 * weighted 20 % roads / 80 % transit, with protected areas and urban green closed by zoning.
 * Without it (Baseline) growth follows roads only and ignores protected areas.
 */
export function simulateGrowth(base: CityModel, demandShare: number, tod: boolean): GrowthResult {
  const { n, cellM } = base.grid;
  const N = n * n;
  const yearAdded = new Int16Array(N);
  const tbClass = new Uint8Array(N);
  const perYear: number[] = [];
  const urban = new Uint8Array(N);
  let urbanCount = 0;
  for (let i = 0; i < N; i++) if (URBAN(base.cls[i])) { urban[i] = 1; urbanCount++; }
  const totalNew = Math.round(urbanCount * demandShare);
  if (totalNew === 0) return { yearAdded, tbClass, perYear, order: new Int32Array(0), requested: 0 };
  const order: number[] = [];

  // Static terms: accessibility (White's equation, 1/(1+d) with d in metres) and slope suitability.
  const access = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const road = 1 / (1 + base.distRoadM[i]);
    const transit = 1 / (1 + base.distTransitM[i]);
    access[i] = tod ? 0.2 * road + 0.8 * transit : road;
  }
  normalise(access);
  const suit = normalise(base.terrain.slope.map(slopeScore));

  // Neighbourhood: distance-weighted share of urban cells within ~100 m (SIMLANDER uses up to 11 × 11 cells of 10 m).
  const rad = Math.max(1, Math.round(100 / cellM));
  const kernel: [number, number, number][] = [];
  for (let dr = -rad; dr <= rad; dr++)
    for (let dc = -rad; dc <= rad; dc++) {
      const d = Math.hypot(dr, dc);
      if (d <= rad + 0.5) kernel.push([dr, dc, 1 / (1 + d)]);
    }

  const random = mulberry32(7);
  const nhood = new Float32Array(N);
  const noise = new Float32Array(N);
  const vacant = new Uint8Array(N);
  let added = 0;
  for (let year = START_YEAR + 1; year <= END_YEAR; year++) {
    const target = Math.round((totalNew * (year - START_YEAR)) / (END_YEAR - START_YEAR));
    const yearStart = added;
    // Each year is allocated in a few rounds so the neighbourhood sees cells added earlier
    // in the same year; this keeps growth in compact fronts instead of scattered cells.
    for (let round = 1; round <= ROUNDS_PER_YEAR; round++) {
      const want = yearStart + Math.round(((target - yearStart) * round) / ROUNDS_PER_YEAR) - added;
      if (want <= 0) continue;
      // Cells where people already live (farms, homes the map does not show) are not open land.
      for (let i = 0; i < N; i++) vacant[i] = !urban[i] && VACANT(base.cls[i], tod) && base.residents[i] < 0.5 && (!tod || base.zoning[i] === 1) ? 1 : 0;

      for (let i = 0; i < N; i++) {
        if (!vacant[i]) { nhood[i] = 0; continue; }
        const r = Math.floor(i / n), c = i % n;
        let sum = 0;
        for (const [dr, dc, w] of kernel) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < n && cc < n && urban[rr * n + cc]) sum += w;
        }
        nhood[i] = sum;
      }
      normalise(nhood, vacant);
      // SIMLANDER random block: 1 + (−ln(1−x))·e^½ on vacant land.
      for (let i = 0; i < N; i++) noise[i] = vacant[i] ? 1 + -Math.log(1 - random()) * Math.exp(0.5) : 0;
      normalise(noise, vacant);

      // TM_S: transition potential = neighbourhood + random + accessibility + suitability (inertia keeps existing urban).
      const ranked: { i: number; p: number }[] = [];
      for (let i = 0; i < N; i++) if (vacant[i]) ranked.push({ i, p: nhood[i] + noise[i] + access[i] + suit[i] });
      ranked.sort((a, b) => b.p - a.p);
      const take = Math.min(want, ranked.length);
      for (let k = 0; k < take; k++) {
        const i = ranked[k].i;
        urban[i] = 1;
        yearAdded[i] = year;
        order.push(i);
      }
      added += take;
      if (take < want) break;
    }
    perYear.push(added - yearStart);
  }

  traceback(base, yearAdded, tbClass);
  return { yearAdded, tbClass, perYear, order: Int32Array.from(order), requested: totalNew };
}

/**
 * Thesis traceback (scripts 02_Stats_Raster.R and 03_TB_Vector.R): assigns a land-use
 * class to each new urban cell from its distance to transit, roads and urban poles and
 * its slope. As in the thesis, the thresholds are the 75th percentiles of each class's
 * values, here measured in the chosen area so the rules fit any city. Urban poles are
 * the area's high-density cells.
 */
function traceback(base: CityModel, yearAdded: Int16Array, out: Uint8Array) {
  const { n, cellM } = base.grid;
  const N = n * n;
  const poles = new Uint8Array(N);
  for (let i = 0; i < N; i++) poles[i] = base.cls[i] === 1 ? 1 : 0;
  const distPole = poles.some(Boolean) ? distanceTransform(poles, n).map((v) => v * cellM) : new Float32Array(N).fill(1e6);

  // 75th percentile of each criterion per existing class (thesis Tables 27–30, q75 column).
  const q75 = (cls: number, values: ArrayLike<number>) => {
    const v: number[] = [];
    for (let i = 0; i < N; i++) if (base.cls[i] === cls) v.push(values[i]);
    if (!v.length) return -1; // class absent here: its rule never fires
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length * 0.75)];
  };
  const t = (c: number) => q75(c, base.distTransitM), r = (c: number) => q75(c, base.distRoadM);
  const s = (c: number) => q75(c, base.terrain.slope), u = (c: number) => q75(c, distPole);
  // Order and criteria follow 03_TB_Vector.R: dense classes first, then the fallbacks.
  const rules: [number, number, number, number, number][] = [1, 2, 3, 4, 6].map((c) => [c, t(c), r(c), s(c), u(c)]);
  const green = [t(7), u(7)];

  for (let i = 0; i < N; i++) {
    if (!yearAdded[i]) continue;
    const dt = base.distTransitM[i], dr = base.distRoadM[i], sl = base.terrain.slope[i], du = distPole[i];
    let c = 0;
    for (const [cls, qt, qr, qs, qu] of rules) {
      if (qt >= 0 && dt <= qt && dr <= qr && sl <= qs && du <= qu) { c = cls; break; }
    }
    if (!c && dr <= cellM / 2) c = 5;
    if (!c && green[0] >= 0 && dt <= green[0] && du <= green[1]) c = 7;
    if (!c) c = dr <= 2 * cellM ? 4 : 2;
    out[i] = c;
  }
}

/** The city in a given year: grown cells take their traceback class. */
export function cityInYear(base: CityModel, g: GrowthResult, year: number): CityModel {
  if (year <= START_YEAR) return base;
  const cls = base.cls.slice();
  for (let i = 0; i < cls.length; i++) if (g.yearAdded[i] && g.yearAdded[i] <= year) cls[i] = g.tbClass[i];
  return { ...base, cls };
}

// New rail or metro stations, after Hong Kong's Rail plus Property model: the rail company is given
// the right to develop the land around new stations, builds there with private developers, and the
// rise in land value helps pay for the line (Cervero & Murakami, 2009).

import { CityModel, TOD_RAPID_M } from "./classify";

/** New stations need a street within this distance to be reachable. */
const MAX_ROAD_M = 100;
/** Suggestions are searched on blocks of about this size. */
const BLOCK_M = 100;

/**
 * Suggests up to `count` stations that each reach as much of `need` as possible within the TOD
 * Standard's 1000 m (greedy maximum coverage: each pick removes what it reaches before the next).
 * `need` is the weight per cell: new urban land from growth, or residents beyond walking reach.
 */
export function suggestStations(m: CityModel, need: Float32Array, count: number): number[] {
  const { n, cellM } = m.grid;
  const b = Math.max(1, Math.round(BLOCK_M / cellM));
  const nb = Math.ceil(n / b);
  // Need per block, and the best cell of each block to put a station on (land, next to a street).
  const blockNeed = new Float32Array(nb * nb);
  const site = new Int32Array(nb * nb).fill(-1);
  for (let i = 0; i < n * n; i++) {
    const k = Math.floor(Math.floor(i / n) / b) * nb + Math.floor((i % n) / b);
    blockNeed[k] += need[i];
    if (m.cls[i] !== 9 && m.distRoadM[i] <= MAX_ROAD_M && (site[k] < 0 || m.distRoadM[i] < m.distRoadM[site[k]])) site[k] = i;
  }
  const rad = TOD_RAPID_M / (b * cellM);
  const offsets: [number, number][] = [];
  for (let dr = -Math.ceil(rad); dr <= Math.ceil(rad); dr++)
    for (let dc = -Math.ceil(rad); dc <= Math.ceil(rad); dc++) if (dr * dr + dc * dc <= rad * rad) offsets.push([dr, dc]);

  const picks: number[] = [];
  for (let p = 0; p < count; p++) {
    let best = -1, bestSum = 0;
    for (let k = 0; k < nb * nb; k++) {
      if (site[k] < 0) continue;
      const r = Math.floor(k / nb), c = k % nb;
      let sum = 0;
      for (const [dr, dc] of offsets) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < nb && cc < nb) sum += blockNeed[rr * nb + cc];
      }
      if (sum > bestSum) {
        bestSum = sum;
        best = k;
      }
    }
    if (best < 0) break;
    picks.push(site[best]);
    const r = Math.floor(best / nb), c = best % nb;
    for (const [dr, dc] of offsets) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < nb && cc < nb) blockNeed[rr * nb + cc] = 0;
    }
  }
  return picks;
}

/** Weight per cell for suggestions: new urban land since today, or else residents beyond walking reach of rail or metro. */
export function stationNeed(m: CityModel, grownCls?: Uint8Array): Float32Array {
  const need = new Float32Array(m.cls.length);
  for (let i = 0; i < need.length; i++) {
    if (m.walkRapidM[i] <= TOD_RAPID_M) continue;
    if (grownCls) need[i] = grownCls[i] >= 1 && grownCls[i] <= 6 && !(m.baseCls[i] >= 1 && m.baseCls[i] <= 6) ? 1 : 0;
    else need[i] = m.residents[i];
  }
  return need;
}

// Official resident counts from the EU Census 2021 population grid (Eurostat GISCO, 1 km cells in
// ETRS89-LAEA, EPSG:3035; © European Union, 2026). GHS-POP places people at ~90 m; the census sets
// how many live in each square kilometre. Pixels of every 1 km cell are scaled so their sum matches
// the census count. Cells without a census value (confidential, or outside the EU and EFTA, such as
// the UK) keep the GHS-POP count. Modified from the source: counts are spread onto 90 m pixels.

import { BBox } from "./geo";
import { PopulationGrid } from "./population";

/** EPSG:3035 (Lambert azimuthal equal-area on GRS80, centre 52° N 10° E), metres east and north. */
export function toLaea(lon: number, lat: number): [number, number] {
  const a = 6378137, e2 = 0.00669438002290, e = Math.sqrt(e2);
  const rad = Math.PI / 180;
  const q = (phi: number) => {
    const s = Math.sin(phi);
    return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
  };
  const qp = q(Math.PI / 2);
  const phi1 = 52 * rad, lam = (lon - 10) * rad;
  const beta = Math.asin(q(lat * rad) / qp), beta1 = Math.asin(q(phi1) / qp);
  const rq = a * Math.sqrt(qp / 2);
  const d = (a * Math.cos(phi1)) / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2) / (rq * Math.cos(beta1));
  const b = rq * Math.sqrt(2 / (1 + Math.sin(beta1) * Math.sin(beta) + Math.cos(beta1) * Math.cos(beta) * Math.cos(lam)));
  return [4321000 + b * d * Math.cos(beta) * Math.sin(lam), 3210000 + (b / d) * (Math.cos(beta1) * Math.sin(beta) - Math.sin(beta1) * Math.cos(beta) * Math.cos(lam))];
}

const BLOCK_KM = 100;
const blocks = new Map<string, Promise<number[] | null>>();

function block(be: number, bn: number) {
  const key = `${be}_${bn}`;
  if (!blocks.has(key))
    blocks.set(
      key,
      fetch(`${import.meta.env.BASE_URL}data/census/${key}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<number[]>) : null))
        .catch(() => null),
    );
  return blocks.get(key)!;
}

/** Census count of the 1 km cell (km east, km north); undefined where there is none. */
async function censusCount(ekm: number, nkm: number) {
  const v = await block(Math.floor(ekm / BLOCK_KM), Math.floor(nkm / BLOCK_KM));
  if (!v) return undefined;
  const t = v[(nkm % BLOCK_KM) * BLOCK_KM + (ekm % BLOCK_KM)];
  return t >= 0 ? t : undefined;
}

/** The area plus a margin wide enough to hold every 1 km census cell it touches. */
export function censusBBox(b: BBox): BBox {
  const dLat = 1500 / 110_540, dLon = 1500 / (111_320 * Math.cos((((b.north + b.south) / 2) * Math.PI) / 180));
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLon, east: b.east + dLon };
}

export interface CensusResult {
  pop: PopulationGrid;
  /** share of GHS-POP residents in cells the census covers */
  covered: number;
}

/** Scales GHS-POP pixels to the census count of their 1 km cell. */
export async function applyCensus(pop: PopulationGrid): Promise<CensusResult> {
  const cellOf = new Int32Array(pop.data.length);
  const cells = new Map<number, { ekm: number; nkm: number; ghs: number }>();
  for (let py = 0; py < pop.height; py++)
    for (let px = 0; px < pop.width; px++) {
      const i = py * pop.width + px;
      const [e, n] = toLaea(pop.west + (px + 0.5) * pop.res, pop.north - (py + 0.5) * pop.res);
      const ekm = Math.floor(e / 1000), nkm = Math.floor(n / 1000);
      const key = ekm * 100_000 + nkm;
      cellOf[i] = key;
      const c = cells.get(key) ?? { ekm, nkm, ghs: 0 };
      c.ghs += pop.data[i];
      cells.set(key, c);
    }
  const factor = new Map<number, number>();
  let ghsAll = 0, ghsCovered = 0;
  await Promise.all(
    [...cells].map(async ([key, c]) => {
      ghsAll += c.ghs;
      const t = await censusCount(c.ekm, c.nkm);
      // A census count with no GHS-POP pixel to carry it cannot be placed, so the cell is left as is.
      if (t === undefined || (t > 0 && c.ghs <= 0)) return;
      factor.set(key, c.ghs > 0 ? t / c.ghs : 0);
      ghsCovered += c.ghs;
    }),
  );
  const data = Float32Array.from(pop.data, (v, i) => v * (factor.get(cellOf[i]) ?? 1));
  return { pop: { ...pop, data, total: data.reduce((a, v) => a + v, 0) }, covered: ghsAll ? ghsCovered / ghsAll : 0 };
}

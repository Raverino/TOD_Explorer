// TOD scenario algorithm (Dimas, 2025, section 6.5 and scripts 04–06): a cell
// replacement system that converts a share of one land-use class into another,
// only inside the TOD zone and outside protected areas.

import { CityModel } from "./classify";
import { distanceTransform } from "./raster";

export interface Rule {
  from: number;
  to: number;
  /** share of the eligible cells that change (0–1) */
  share: number;
  /**
   * "tod": eligible within the strategy's TOD distance of a transit stop.
   * "near-dense": eligible within bufferM of high or medium density (mixed use, thesis IB step 3).
   */
  where: "tod" | "near-dense";
  bufferM?: number;
}

export interface Strategy {
  id: string;
  name: string;
  tagline: string;
  /** urban form after Jabareen (2006), as discussed in the thesis conclusion */
  form: string;
  todDistanceM: number;
  /** development probability decays with distance to transit, exp(−rate·d) */
  decay: boolean;
  decayRate: number;
  /**
   * Patch clustering (thesis CLUSTER_THRESHOLD, 0–1): the chance that the next
   * converted cell joins an existing patch instead of starting a new one.
   */
  cluster: number;
  /**
   * Share of homes (classes 1–3) within the TOD distance that get an energy retrofit.
   * Not part of the thesis scenarios: an app setting, adjustable in Custom.
   */
  retrofit: number;
  rules: Rule[];
}

const DECAY_RATE = 0.005; // per metre, thesis TOD_DECAY_RATE
const CLUSTER = 0.7; // thesis CLUSTER_THRESHOLD (Listing 9)

/** Thesis Table 5 and scripts 04–06. Rules with the same origin and condition share one pool, as in the R scripts. */
export const PRESETS: Strategy[] = [
  {
    id: "BASE",
    name: "Baseline",
    tagline: "Keep today's trends. Nothing changes around transit.",
    form: "Car-oriented growth",
    todDistanceM: 1000,
    decay: false,
    decayRate: DECAY_RATE,
    cluster: CLUSTER,
    retrofit: 0,
    rules: [],
  },
  {
    id: "IB",
    name: "Intense Building",
    tagline: "Build up around stations: denser housing and local shops.",
    form: "Compact city",
    todDistanceM: 1000,
    decay: true,
    decayRate: DECAY_RATE,
    cluster: CLUSTER,
    retrofit: 0,
    rules: [
      { from: 2, to: 1, share: 0.25, where: "tod" },
      { from: 3, to: 2, share: 0.35, where: "tod" },
      { from: 3, to: 4, share: 0.1, where: "near-dense", bufferM: 200 },
    ],
  },
  {
    id: "RETRO",
    name: "Retrofitting",
    tagline: "Reuse what exists: offices and lots become homes and parks.",
    form: "Eco-city",
    todDistanceM: 1000,
    decay: true,
    decayRate: DECAY_RATE,
    cluster: CLUSTER,
    retrofit: 0.3,
    rules: [
      { from: 4, to: 1, share: 0.15, where: "tod" },
      { from: 4, to: 2, share: 0.15, where: "tod" },
      { from: 10, to: 7, share: 0.25, where: "tod" },
      { from: 10, to: 1, share: 0.25, where: "tod" },
      { from: 5, to: 7, share: 0.2, where: "tod" },
    ],
  },
  {
    id: "BAL",
    name: "Balanced",
    tagline: "A bit of both: moderate density, mixed use and greener streets.",
    form: "Compact city + eco-city",
    todDistanceM: 800,
    decay: true,
    decayRate: DECAY_RATE,
    cluster: CLUSTER,
    retrofit: 0.15,
    rules: [
      { from: 2, to: 1, share: 0.15, where: "tod" },
      { from: 3, to: 2, share: 0.25, where: "tod" },
      { from: 3, to: 4, share: 0.15, where: "near-dense", bufferM: 300 },
      { from: 5, to: 7, share: 0.3, where: "tod" },
      { from: 10, to: 7, share: 0.15, where: "tod" },
    ],
  },
];

/** The conversions a custom strategy can tune, in the order they are applied. */
export const CUSTOM_RULES: (Rule & { label: string })[] = [
  { label: "Medium → high density", from: 2, to: 1, share: 0, where: "tod" },
  { label: "Low → medium density", from: 3, to: 2, share: 0, where: "tod" },
  { label: "Low density → shops (mixed use)", from: 3, to: 4, share: 0, where: "near-dense", bufferM: 200 },
  { label: "Commercial → high-density homes", from: 4, to: 1, share: 0, where: "tod" },
  { label: "Commercial → medium-density homes", from: 4, to: 2, share: 0, where: "tod" },
  { label: "Special zones and parking → parks", from: 10, to: 7, share: 0, where: "tod" },
  { label: "Special zones and parking → homes", from: 10, to: 1, share: 0, where: "tod" },
  { label: "Roads → green streets", from: 5, to: 7, share: 0, where: "tod" },
];

/** Small seeded generator so the same strategy always gives the same city (thesis set.seed(42)). */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScenarioResult {
  model: CityModel;
  /** 1 where the strategy changed the cell */
  changed: Uint8Array;
  /** cells converted per rule, same order as strategy.rules */
  converted: number[];
  /** 1 where homes were retrofitted */
  retrofitted: Uint8Array;
  /**
   * When each change happens, as a share of the way to 2050 (0–1]: every rule and the retrofits
   * run at an even pace, nearest to transit first, so their shares are reached in 2050.
   */
  progress: Float32Array;
  retrofitProgress: Float32Array;
}

export function applyStrategy(base: CityModel, s: Strategy): ScenarioResult {
  const { n, cellM } = base.grid;
  const cls = base.cls.slice();
  const changed = new Uint8Array(cls.length);
  const converted = s.rules.map(() => 0);
  const progress = new Float32Array(cls.length);
  const random = mulberry32(42);
  // Existing urban land (classes 1–6) may always change; elsewhere protected areas are closed.
  const allowed = (i: number) => base.zoning[i] === 1 || (cls[i] >= 1 && cls[i] <= 6);

  for (let k = 0; k < s.rules.length; ) {
    // Rules with the same origin and condition draw from one pool (e.g. RETRO: 30 % of class 4, half to 1, half to 2).
    const group = [k];
    while (k + group.length < s.rules.length && sameGroup(s.rules[k], s.rules[k + group.length])) group.push(k + group.length);
    const first = s.rules[k];

    let near: Float32Array | undefined;
    if (first.where === "near-dense") {
      const dense = new Uint8Array(cls.length);
      for (let i = 0; i < cls.length; i++) dense[i] = cls[i] === 1 || cls[i] === 2 ? 1 : 0;
      near = dense.some(Boolean) ? distanceTransform(dense, n) : undefined;
    }
    const pool: number[] = [];
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== first.from || !allowed(i)) continue;
      // Roads → green streets: only cells with a street on them, not rail yards or stations.
      if (first.from === 5 && !(base.roadAreaM2[i] > 0)) continue;
      if (first.where === "tod" ? base.distTransitM[i] <= s.todDistanceM : near && near[i] * cellM <= (first.bufferM ?? 200)) pool.push(i);
    }

    // Weighted sampling without replacement (Efraimidis–Spirakis): with decay, cells nearer transit come first.
    const keyed = pool.map((i) => {
      const w = s.decay ? Math.exp(-s.decayRate * base.distTransitM[i]) : 1;
      return { i, key: Math.log(random()) / Math.max(w, 1e-9) };
    });
    keyed.sort((a, b) => b.key - a.key);
    const need = group.reduce((sum, r) => sum + Math.floor(pool.length * s.rules[r].share), 0);
    const order = clusterOrder(keyed.map((k) => k.i), n, Math.min(need, pool.length), s.cluster, random);

    let taken = 0;
    for (const r of group) {
      const count = Math.min(Math.floor(pool.length * s.rules[r].share), order.length - taken);
      for (let c = 0; c < count; c++, taken++) {
        const i = order[taken];
        cls[i] = s.rules[r].to;
        changed[i] = 1;
        progress[i] = (c + 1) / count;
      }
      converted[r] = count;
    }
    k += group.length;
  }

  // Energy retrofit of homes near transit, after the land-use conversions, in patches like the rest.
  const retrofitted = new Uint8Array(cls.length);
  const retrofitProgress = new Float32Array(cls.length);
  if (s.retrofit > 0) {
    const homes: number[] = [];
    for (let i = 0; i < cls.length; i++) if (cls[i] >= 1 && cls[i] <= 3 && base.distTransitM[i] <= s.todDistanceM) homes.push(i);
    const keyed = homes.map((i) => ({ i, key: Math.log(random()) / Math.max(s.decay ? Math.exp(-s.decayRate * base.distTransitM[i]) : 1, 1e-9) }));
    keyed.sort((a, b) => b.key - a.key);
    const order = clusterOrder(keyed.map((k) => k.i), n, Math.floor(homes.length * s.retrofit), s.cluster, random);
    order.forEach((i, k) => {
      retrofitted[i] = 1;
      retrofitProgress[i] = (k + 1) / order.length;
    });
  }

  // A street turned green no longer carries traffic, so it leaves the roadway area (8.A.3).
  const roadAreaM2 = base.roadAreaM2.slice();
  for (let i = 0; i < cls.length; i++) if (changed[i] && base.cls[i] === 5 && cls[i] === 7) roadAreaM2[i] = 0;

  return { model: { ...base, cls, retrofitted, roadAreaM2 }, changed, converted, retrofitted, progress, retrofitProgress };
}

/**
 * Orders up to `need` pool cells into patches: with probability `cluster` the next
 * cell is a pool neighbour of one already chosen, otherwise the best-ranked unused
 * cell starts a new patch. With cluster = 0 this is the plain ranked order.
 */
function clusterOrder(ranked: number[], n: number, need: number, cluster: number, random: () => number): number[] {
  const inPool = new Set(ranked);
  const used = new Set<number>();
  const frontier: number[] = [];
  const order: number[] = [];
  let next = 0;
  const take = (i: number) => {
    used.add(i);
    order.push(i);
    const r = Math.floor(i / n), c = i % n;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      const j = rr * n + cc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && inPool.has(j) && !used.has(j)) frontier.push(j);
    }
  };
  while (order.length < need) {
    if (frontier.length && random() < cluster) {
      const k = Math.floor(random() * frontier.length);
      const j = frontier[k];
      frontier[k] = frontier[frontier.length - 1];
      frontier.pop();
      if (!used.has(j)) take(j);
      continue;
    }
    while (next < ranked.length && used.has(ranked[next])) next++;
    if (next >= ranked.length) break;
    take(ranked[next]);
  }
  return order;
}

function sameGroup(a: Rule, b: Rule) {
  return a.from === b.from && a.where === b.where && a.bufferM === b.bufferM;
}

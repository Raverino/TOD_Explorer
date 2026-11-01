// TOD Standard 3.A.1 (small blocks): block faces of the walking network, measured corner to corner
// between intersections of streets and paths open to the public (ITDP, 2017).

import { Grid, toGrid } from "./geo";
import { MapLine } from "./tiles";

/** A block face: its length and the cell at its middle. */
export interface BlockFace {
  m: number;
  cell: number;
}

/**
 * Links shorter than this are crossings, slip lanes and sidewalk connectors rather than blocks;
 * counting them would make places that map sidewalks as separate paths look finer-grained.
 */
const MIN_FACE_M = 25;
/** A line end this close to another line meets it (map vertices are rounded to about half a metre). */
const SNAP_M = 1;
const BUCKET_M = 20;

type XY = [number, number];

/**
 * Builds the walking network (streets, service roads open to the public, footways, paths and
 * steps; not motorways, parking aisles or driveways), joins lines where they meet or cross,
 * prunes dead ends, and returns the faces between intersections.
 *
 * Vector tiles simplify lines and drop many of the shared points where streets meet (a third of
 * line ends in central Utrecht stop on another line without a shared point), so junctions are
 * found geometrically instead of from shared map nodes. Bridges and tunnels are not in the data
 * kept here, so a path crossing under a street counts as a junction.
 */
export function blockFaces(grid: Grid, lines: MapLine[]): BlockFace[] {
  const { n, cellM } = grid;
  const walk = lines.filter((l) => l.kind === "walk" || ((l.kind === "major-road" || l.kind === "road" || l.kind === "service") && !l.offStreet));
  const polys: XY[][] = walk.map((l) =>
    l.coords.map(([lon, lat]) => {
      const [x, y] = toGrid(grid, lon, lat);
      return [x * cellM, y * cellM];
    }),
  );

  // Segments in a spatial hash.
  const segs: { line: number; k: number; a: XY; b: XY }[] = [];
  polys.forEach((p, line) => {
    for (let k = 1; k < p.length; k++) segs.push({ line, k, a: p[k - 1], b: p[k] });
  });
  const hash = new Map<string, number[]>();
  segs.forEach((s, idx) => {
    const x0 = Math.floor((Math.min(s.a[0], s.b[0]) - SNAP_M) / BUCKET_M), x1 = Math.floor((Math.max(s.a[0], s.b[0]) + SNAP_M) / BUCKET_M);
    const y0 = Math.floor((Math.min(s.a[1], s.b[1]) - SNAP_M) / BUCKET_M), y1 = Math.floor((Math.max(s.a[1], s.b[1]) + SNAP_M) / BUCKET_M);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        if (!hash.has(key)) hash.set(key, []);
        hash.get(key)!.push(idx);
      }
  });

  // Extra points per segment (as positions 0–1 along it) where another line meets or crosses it.
  const splits = new Map<number, { t: number; p: XY }[]>();
  const addSplit = (idx: number, t: number, p: XY) => {
    if (!splits.has(idx)) splits.set(idx, []);
    splits.get(idx)!.push({ t, p });
  };
  const checked = new Set<string>();
  for (const bucket of hash.values())
    for (let u = 0; u < bucket.length; u++)
      for (let v = u + 1; v < bucket.length; v++) {
        const i = bucket[u], j = bucket[v];
        const s = segs[i], r = segs[j];
        if (s.line === r.line && Math.abs(s.k - r.k) <= 1) continue;
        const pair = i < j ? `${i}|${j}` : `${j}|${i}`;
        if (checked.has(pair)) continue;
        checked.add(pair);
        // Proper crossing.
        const d1: XY = [s.b[0] - s.a[0], s.b[1] - s.a[1]], d2: XY = [r.b[0] - r.a[0], r.b[1] - r.a[1]];
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) > 1e-9) {
          const t = ((r.a[0] - s.a[0]) * d2[1] - (r.a[1] - s.a[1]) * d2[0]) / den;
          const w = ((r.a[0] - s.a[0]) * d1[1] - (r.a[1] - s.a[1]) * d1[0]) / den;
          if (t > 0 && t < 1 && w > 0 && w < 1) {
            const p: XY = [s.a[0] + t * d1[0], s.a[1] + t * d1[1]];
            addSplit(i, t, p);
            addSplit(j, w, p);
            continue;
          }
        }
        // A line that ends on the middle of another segment (a T-junction).
        for (const [end, seg, idx] of [[s.a, r, j], [s.b, r, j], [r.a, s, i], [r.b, s, i]] as [XY, typeof s, number][]) {
          const dx = seg.b[0] - seg.a[0], dy = seg.b[1] - seg.a[1];
          const len2 = dx * dx + dy * dy;
          if (!len2) continue;
          const t = ((end[0] - seg.a[0]) * dx + (end[1] - seg.a[1]) * dy) / len2;
          if (t <= 0 || t >= 1) continue;
          const q: XY = [seg.a[0] + t * dx, seg.a[1] + t * dy];
          if (Math.hypot(end[0] - q[0], end[1] - q[1]) <= SNAP_M) addSplit(idx, t, end);
        }
      }

  // The graph: vertices keyed on a half-metre grid, so points that meet share a key.
  const keyOf = (p: XY) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const pos = new Map<string, XY>();
  const adj = new Map<string, Map<string, number>>();
  const link = (a: XY, b: XY) => {
    const ka = keyOf(a), kb = keyOf(b);
    if (ka === kb) return;
    pos.set(ka, a);
    pos.set(kb, b);
    if (!adj.has(ka)) adj.set(ka, new Map());
    if (!adj.has(kb)) adj.set(kb, new Map());
    // Tiles repeat lines near their edges: a shared segment is stored once.
    const m = Math.hypot(b[0] - a[0], b[1] - a[1]);
    adj.get(ka)!.set(kb, m);
    adj.get(kb)!.set(ka, m);
  };
  segs.forEach((s, idx) => {
    const pts = (splits.get(idx) ?? []).sort((x, y) => x.t - y.t).map((x) => x.p);
    let prev = s.a;
    for (const p of [...pts, s.b]) {
      link(prev, p);
      prev = p;
    }
  });

  // Dead ends, and the stubs left where tiles cut lines, are not block faces: prune them away.
  const stack = [...adj.keys()].filter((k) => adj.get(k)!.size === 1);
  while (stack.length) {
    const k = stack.pop()!;
    const nb = adj.get(k);
    if (!nb || nb.size !== 1) continue;
    const [other] = nb.keys();
    adj.delete(k);
    const o = adj.get(other)!;
    o.delete(k);
    if (o.size === 1) stack.push(other);
    if (o.size === 0) adj.delete(other);
  }

  // Walk each chain of plain vertices between two intersections.
  const faces: BlockFace[] = [];
  const done = new Set<string>();
  for (const [start, nb] of adj) {
    if (nb.size === 2) continue;
    for (const first of nb.keys()) {
      if (done.has(`${start}|${first}`)) continue;
      let len = nb.get(first)!;
      const path = [start, first];
      let prev = start, cur = first;
      while (adj.get(cur)!.size === 2 && cur !== start) {
        const next = [...adj.get(cur)!.keys()].find((k) => k !== prev)!;
        len += adj.get(cur)!.get(next)!;
        prev = cur;
        cur = next;
        path.push(cur);
      }
      done.add(`${start}|${first}`);
      done.add(`${cur}|${prev}`);
      if (len < MIN_FACE_M) continue;
      const [x, y] = pos.get(path[Math.floor(path.length / 2)])!;
      const c = Math.floor(x / cellM), r = Math.floor(y / cellM);
      if (c >= 0 && r >= 0 && c < n && r < n) faces.push({ m: len, cell: r * n + c });
    }
  }
  return faces;
}

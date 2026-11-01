// Small raster helpers: polygon fill, line drawing and distance transforms on the cell grid.

/** Fills polygon parts (in grid coordinates) using the even-odd rule at cell centres. */
export function fillPolygon(parts: [number, number][][], n: number, set: (i: number) => void) {
  const edges: [number, number, number, number][] = [];
  let minY = Infinity, maxY = -Infinity;
  for (const ring of parts)
    for (let k = 0; k < ring.length - 1; k++) {
      const [x0, y0] = ring[k], [x1, y1] = ring[k + 1];
      if (y0 === y1) continue;
      edges.push([x0, y0, x1, y1]);
      minY = Math.min(minY, y0, y1);
      maxY = Math.max(maxY, y0, y1);
    }
  const r0 = Math.max(0, Math.floor(minY)), r1 = Math.min(n - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges)
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(n - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) set(r * n + c);
    }
  }
}

/** Marks every cell a polyline passes through (sampled at quarter-cell steps). */
export function drawLine(coords: [number, number][], n: number, set: (i: number) => void) {
  for (let k = 0; k < coords.length - 1; k++) {
    const [x0, y0] = coords[k], [x1, y1] = coords[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4));
    for (let s = 0; s <= steps; s++) {
      const c = Math.floor(x0 + ((x1 - x0) * s) / steps), r = Math.floor(y0 + ((y1 - y0) * s) / steps);
      if (c >= 0 && r >= 0 && c < n && r < n) set(r * n + c);
    }
  }
}

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), in cells.
 * Returns the distance from every cell to the nearest source cell, like the
 * QGIS "Proximity" rasters used in the thesis.
 */
export function distanceTransform(source: Uint8Array, n: number): Float32Array {
  const INF = 1e12;
  const f = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) f[i] = source[i] ? 0 : INF;
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), line = new Float64Array(n);
  const pass = (get: (k: number) => number, put: (k: number, val: number) => void) => {
    for (let q = 0; q < n; q++) line[q] = get(q);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + line[v[k]];
    }
    for (let q = 0; q < n; q++) put(q, d[q]);
  };
  for (let c = 0; c < n; c++) pass((r) => f[r * n + c], (r, val) => (f[r * n + c] = val));
  for (let r = 0; r < n; r++) pass((c) => f[r * n + c], (c, val) => (f[r * n + c] = val));
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = Math.sqrt(f[i]);
  return out;
}

/**
 * Walking distance in metres from the source cells, found with Dijkstra on the
 * 8-connected grid. `cost` is the effort to cross a cell relative to a street
 * (1 on streets and paths, higher inside blocks, Infinity for barriers such as
 * water, motorways and railway tracks). Source cells always start at 0.
 */
export function walkDistance(sources: Uint8Array, cost: Float32Array, n: number, cellM: number, limitM = Infinity): Float32Array {
  const N = n * n;
  const dist = new Float32Array(N).fill(Infinity);
  // Binary min-heap of (distance, cell).
  let heapD = new Float64Array(1024), heapI = new Int32Array(1024), size = 0;
  const push = (d: number, i: number) => {
    if (size === heapD.length) {
      const nd = new Float64Array(size * 2), ni = new Int32Array(size * 2);
      nd.set(heapD); ni.set(heapI); heapD = nd; heapI = ni;
    }
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= d) break;
      heapD[k] = heapD[p]; heapI[k] = heapI[p]; k = p;
    }
    heapD[k] = d; heapI[k] = i;
  };
  const pop = () => {
    const top = heapI[0];
    const d = heapD[--size], i = heapI[size];
    let k = 0;
    while (true) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && heapD[c + 1] < heapD[c]) c++;
      if (heapD[c] >= d) break;
      heapD[k] = heapD[c]; heapI[k] = heapI[c]; k = c;
    }
    heapD[k] = d; heapI[k] = i;
    return top;
  };
  for (let i = 0; i < N; i++) if (sources[i]) { dist[i] = 0; push(0, i); }
  const STEPS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (size) {
    const i = pop();
    const d = dist[i];
    if (d > limitM) break;
    const r = Math.floor(i / n), c = i % n;
    for (const [dr, dc, len] of STEPS) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const j = rr * n + cc;
      const step = ((cost[i] + cost[j]) / 2) * len * cellM;
      if (!Number.isFinite(step)) continue;
      const nd = d + step;
      if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
    }
  }
  return dist;
}

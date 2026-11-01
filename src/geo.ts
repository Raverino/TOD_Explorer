// Study area, local metric projection and the cell grid.

export interface Area {
  lat: number;
  lon: number;
  /** side length of the square study area in metres */
  sizeM: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Grid {
  area: Area;
  bbox: BBox;
  /** cells per side */
  n: number;
  /** cell side in metres */
  cellM: number;
}

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;

/** Largest grid we simulate: 200 × 200 = 40 000 cells. */
const MAX_CELLS_PER_SIDE = 200;
/** Smallest cell, close to the 10 m Urban Atlas pixels without exploding the grid. */
const MIN_CELL_M = 25;

export function bboxOf(area: Area): BBox {
  const half = area.sizeM / 2;
  const dLat = half / M_PER_DEG_LAT;
  const dLon = half / (M_PER_DEG_LON * Math.cos((area.lat * Math.PI) / 180));
  return { south: area.lat - dLat, north: area.lat + dLat, west: area.lon - dLon, east: area.lon + dLon };
}

export function makeGrid(area: Area): Grid {
  const n = Math.min(MAX_CELLS_PER_SIDE, Math.round(area.sizeM / MIN_CELL_M));
  return { area, bbox: bboxOf(area), n, cellM: area.sizeM / n };
}

/**
 * Projects lon/lat to fractional grid coordinates (column, row), with row 0 at
 * the north edge. A local equirectangular projection is accurate enough for
 * areas up to 20 km.
 */
export function toGrid(grid: Grid, lon: number, lat: number): [number, number] {
  const { area } = grid;
  const half = area.sizeM / 2;
  const x = (lon - area.lon) * M_PER_DEG_LON * Math.cos((area.lat * Math.PI) / 180) + half;
  const y = half - (lat - area.lat) * M_PER_DEG_LAT;
  return [x / grid.cellM, y / grid.cellM];
}

export function bboxString(b: BBox): string {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

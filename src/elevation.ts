// Elevation and slope from the free AWS Terrain Tiles (Terrarium encoding).
// Sources include SRTM, Copernicus/EU-DEM and others; see the Terrain Tiles attribution.

import { Grid } from "./geo";

/** The same bucket under its two S3 addresses: a retry tries the other one. */
const TILE_URLS = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium", "https://elevation-tiles-prod.s3.amazonaws.com/terrarium"];
const TRIES = 3;
const TIMEOUT_MS = 45_000;

function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}
function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    // Images have no timeout of their own, and a stalled tile would hang the whole build.
    const timer = setTimeout(() => {
      img.src = "";
      reject(new Error(`Elevation tile timed out: ${url}`));
    }, TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Couldn't load elevation tile ${url}`));
    };
    img.src = url;
  });
}

/** A tile, retried on the other address when the server fails or stalls. */
async function loadTile(path: string): Promise<HTMLImageElement> {
  for (let k = 0; ; k++) {
    try {
      return await loadImage(`${TILE_URLS[k % TILE_URLS.length]}/${path}`);
    } catch (err) {
      if (k + 1 >= TRIES) throw new Error("Couldn't download the elevation data. Please try again in a moment.");
      await new Promise((r) => setTimeout(r, 500 * (k + 1)));
    }
  }
}

export interface Terrain {
  /** metres above sea level per cell */
  elevation: Float32Array;
  /** slope in degrees per cell */
  slope: Float32Array;
}

export async function fetchTerrain(grid: Grid): Promise<Terrain> {
  const { bbox, n, area } = grid;
  // Choose the zoom whose pixel size is close to the cell size.
  const mPerPx0 = 156_543 * Math.cos((area.lat * Math.PI) / 180);
  const z = Math.max(8, Math.min(14, Math.round(Math.log2(mPerPx0 / grid.cellM))));

  const x0 = Math.floor(lonToTileX(bbox.west, z));
  const x1 = Math.floor(lonToTileX(bbox.east, z));
  const y0 = Math.floor(latToTileY(bbox.north, z));
  const y1 = Math.floor(latToTileY(bbox.south, z));

  const canvas = document.createElement("canvas");
  canvas.width = (x1 - x0 + 1) * 256;
  canvas.height = (y1 - y0 + 1) * 256;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let tx = x0; tx <= x1; tx++)
    for (let ty = y0; ty <= y1; ty++)
      jobs.push(loadTile(`${z}/${tx}/${ty}.png`).then((img) => ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256)));
  await Promise.all(jobs);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  const elevation = new Float32Array(n * n);
  const latStep = (bbox.north - bbox.south) / n;
  const lonStep = (bbox.east - bbox.west) / n;
  for (let r = 0; r < n; r++) {
    const lat = bbox.north - (r + 0.5) * latStep;
    const py = Math.min(canvas.height - 1, Math.floor((latToTileY(lat, z) - y0) * 256));
    for (let c = 0; c < n; c++) {
      const lon = bbox.west + (c + 0.5) * lonStep;
      const pxx = Math.min(canvas.width - 1, Math.floor((lonToTileX(lon, z) - x0) * 256));
      const i = (py * canvas.width + pxx) * 4;
      elevation[r * n + c] = px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768;
    }
  }

  // Slope from central differences, like the slope map of the thesis (degrees 0–90).
  const slope = new Float32Array(n * n);
  const at = (r: number, c: number) => elevation[Math.max(0, Math.min(n - 1, r)) * n + Math.max(0, Math.min(n - 1, c))];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const dzdx = (at(r, c + 1) - at(r, c - 1)) / (2 * grid.cellM);
      const dzdy = (at(r + 1, c) - at(r - 1, c)) / (2 * grid.cellM);
      slope[r * n + c] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  return { elevation, slope };
}

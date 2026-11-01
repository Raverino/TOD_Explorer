// Measured residents from the JRC Global Human Settlement Layer: GHS-POP R2023A,
// epoch 2020, 3 arc-seconds (~90 m), EPSG:4326, CC BY 4.0. Read straight from a
// cloud-optimised GeoTIFF mirror, so only the window around the chosen area is downloaded.
// Schiavina et al. (2023), doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE.

import { addDecoder, BaseDecoder, fromUrl, GeoTIFFImage } from "geotiff";
import { ZSTDDecoder } from "zstddec";
import { BBox } from "./geo";

const GHS_POP_URL = "https://data.source.coop/cboettig/population/raw/ghs-pop-2020-cog.tif";

const zstd = new ZSTDDecoder();
const zstdReady = zstd.init();

/** geotiff.js has no ZSTD decoder (TIFF compression 50000), so one is registered here. */
class ZstdDecoder extends BaseDecoder {
  private size: number;
  constructor(fd: { TileWidth: number; TileLength: number; BitsPerSample: number | number[]; SamplesPerPixel?: number }) {
    super();
    const bits = Array.isArray(fd.BitsPerSample) ? fd.BitsPerSample[0] : fd.BitsPerSample;
    this.size = fd.TileWidth * fd.TileLength * (bits / 8) * (fd.SamplesPerPixel || 1);
  }
  decodeBlock(buffer: ArrayBuffer): ArrayBuffer {
    return zstd.decode(new Uint8Array(buffer), this.size).slice().buffer;
  }
}
addDecoder(50000, () => ZstdDecoder as never);

export interface PopulationGrid {
  /** persons per pixel, row-major from the north-west corner */
  data: Float32Array;
  width: number;
  height: number;
  west: number;
  north: number;
  /** pixel size in degrees */
  res: number;
  total: number;
}

let image: Promise<GeoTIFFImage> | undefined;

export async function fetchPopulation(b: BBox): Promise<PopulationGrid> {
  await zstdReady;
  image ??= fromUrl(GHS_POP_URL).then((t) => t.getImage());
  const img = await image;
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const x0 = Math.floor((b.west - ox) / rx) - 1, x1 = Math.ceil((b.east - ox) / rx) + 1;
  const y0 = Math.floor((b.north - oy) / ry) - 1, y1 = Math.ceil((b.south - oy) / ry) + 1;
  const [band] = await img.readRasters({ window: [x0, y0, x1, y1] });
  const data = Float32Array.from(band as ArrayLike<number>, (v) => (v > 0 ? v : 0));
  return {
    data,
    width: x1 - x0,
    height: y1 - y0,
    west: ox + x0 * rx,
    north: oy + y0 * ry,
    res: rx,
    total: data.reduce((a, v) => a + v, 0),
  };
}

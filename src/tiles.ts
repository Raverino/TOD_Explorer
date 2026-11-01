// Reads OpenStreetMap data from free vector tiles (OpenFreeMap, OpenMapTiles
// schema). Tiles come from a CDN with no account or rate limit, which is much
// sturdier for a public site than live Overpass queries.
// Data © OpenStreetMap contributors (ODbL); tiles © OpenMapTiles, served by OpenFreeMap.

import { VectorTile, VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { BBox } from "./geo";

export type LonLat = [number, number];

/** A land-use class 1–10, a residential zone (urban fabric decided by buildings) or a protected area. */
export type AreaKind = number | "residential" | "protected";

export interface MapArea {
  kind: AreaKind;
  /** draw order: higher priority overwrites lower */
  priority: number;
  rings: LonLat[][];
  /** a public park, village green, recreation ground or playground (TOD Standard 5.A.3) */
  park?: boolean;
}

export interface MapLine {
  /**
   * motorway: motorways and trunk roads (not walkable); major-road / road: streets;
   * walk: footways, paths, pedestrian streets, steps and cycleways; busway: dedicated bus lanes.
   */
  kind: "motorway" | "major-road" | "road" | "service" | "walk" | "busway" | "rail" | "river";
  coords: LonLat[];
  /** one carriageway of a dual road (OpenMapTiles oneway) */
  oneway?: boolean;
  /** a parking aisle or driveway: off-street parking, not roadway (TOD Standard 8.A.1, not 8.A.3) */
  offStreet?: boolean;
}

/** rail: train, metro or light-rail station; ferry: ferry terminal; tram and bus: stops on street services. */
export type StopKind = "rail" | "ferry" | "tram" | "bus";

export interface MapStop {
  lon: number;
  lat: number;
  kind: StopKind;
}

/**
 * bike_share: TOD Standard 7.B.1; business: a shop, café, office or public service, which marks
 * mixed use (6.A.1); food, school, health: local services (5.A.2); play: a park or playground (5.A.3).
 */
export type ServiceKind = "bike_share" | "business" | "food" | "school" | "health" | "play";

export interface MapService {
  lon: number;
  lat: number;
  kind: ServiceKind;
}

export interface MapBuilding {
  rings: LonLat[][];
  /** height in metres (OpenMapTiles render_height, estimated from levels when untagged) */
  height: number;
}

export interface MapData {
  areas: MapArea[];
  lines: MapLine[];
  stops: MapStop[];
  services: MapService[];
  buildings: MapBuilding[];
  tiles: number;
}

const TILEJSON = "https://tiles.openfreemap.org/planet";

function lonToX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}
function latToY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
function yToLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** Stop type from an OpenMapTiles poi; the TOD Standard treats rail, metro and ferry as rapid transit. */
function stopKind(cls: string, sub: string): StopKind | null {
  if ((cls === "railway" && /^(station|halt|subway)$/.test(sub)) || (cls === "entrance" && sub === "subway_entrance")) return "rail";
  if (cls === "ferry_terminal") return "ferry";
  if (cls === "railway" && sub === "tram_stop") return "tram";
  if (cls === "bus" && /^(bus_stop|bus_station)$/.test(sub)) return "bus";
  return null;
}

/** OpenMapTiles point classes of places where people work, shop or use a service. */
const BUSINESS = new Set([
  "shop", "grocery", "clothing_store", "alcohol_shop", "bakery", "butcher", "jewelry", "books", "furniture", "hardware",
  "florist", "gift", "mobile_phone", "optician", "electronics", "stationery", "toys", "pet", "beauty", "hairdresser",
  "laundry", "music", "cafe", "restaurant", "fast_food", "bar", "beer", "ice_cream", "bank", "office", "post",
  "pharmacy", "dentist", "doctors", "veterinary", "lodging", "cinema", "theatre", "library", "museum", "art_gallery",
  "college", "school", "hospital", "town_hall", "police",
]);

/** Services named by the TOD Standard metrics in use; a point can be more than one (a pharmacy is a business and health care). */
function serviceKinds(cls: string, sub: string): ServiceKind[] {
  const kinds: ServiceKind[] = [];
  if (cls === "bicycle_rental") kinds.push("bike_share");
  if (BUSINESS.has(cls)) kinds.push("business");
  // Fresh food: grocery stores of any size and markets (TOD Standard 5.A.2).
  if ((cls === "grocery" && /^(supermarket|greengrocer|marketplace|deli)$/.test(sub)) || cls === "butcher" || (cls === "shop" && sub === "convenience")) kinds.push("food");
  if (cls === "school" && sub === "school") kinds.push("school");
  if (cls === "pharmacy" || cls === "doctors" || (cls === "hospital" && /^(hospital|clinic)$/.test(sub))) kinds.push("health");
  if ((cls === "playground" && sub === "playground") || (cls === "park" && sub === "park")) kinds.push("play");
  return kinds;
}

/** Maps OpenMapTiles polygon features onto the thesis classes (Table 4). */
function areaKind(layer: string, cls: string, sub: string): [AreaKind, number] | null {
  switch (layer) {
    case "water":
      return cls === "swimming_pool" ? null : [9, 90];
    case "aeroway":
      return [10, 80];
    case "park":
      return cls === "national_park" || cls === "nature_reserve" || cls === "protected_area" ? ["protected", 0] : null;
    case "landcover":
      if (cls === "wetland") return [9, 85];
      if (cls === "wood" || (cls === "grass" && /^(park|garden|grass|recreation_ground|village_green|golf_course)$/.test(sub))) return [7, 70];
      return [8, 20];
    case "landuse":
      // suburb, quarter and neighbourhood are place boundaries, not housing, so they are ignored.
      if (cls === "residential") return ["residential", 40];
      if (/^(commercial|retail|industrial|garages|school|university|college|kindergarten|library|hospital)$/.test(cls)) return [4, 60];
      if (/^(railway|bus_station)$/.test(cls)) return [5, 50];
      if (/^(cemetery|stadium|pitch|playground|track|theme_park|zoo)$/.test(cls)) return [7, 70];
      if (/^(military|quarry|landfill|dam)$/.test(cls)) return [10, 80];
      if (/^(construction|brownfield|greenfield)$/.test(cls)) return [6, 55];
      return null;
  }
  return null;
}

function lineKind(layer: string, cls: string, sub: string): MapLine["kind"] | null {
  if (layer === "transportation") {
    if (/^(motorway|trunk)$/.test(cls)) return "motorway";
    if (cls === "primary" || cls === "secondary") return "major-road";
    if (cls === "tertiary" || cls === "minor") return "road";
    if (cls === "service") return "service";
    if (cls === "path" && /^(pedestrian|footway|path|steps|cycleway|living_street)$/.test(sub)) return "walk";
    if (cls === "busway") return "busway";
    if (cls === "rail" || cls === "transit") return "rail";
  }
  if (layer === "waterway" && (cls === "river" || cls === "canal")) return "river";
  return null;
}

export async function fetchMapData(b: BBox, onStatus: (msg: string) => void): Promise<MapData> {
  const tilejson = (await (await fetch(TILEJSON)).json()) as { tiles: string[] };
  const template = tilejson.tiles[0];
  // Zoom 14 is the only level with every building and bus stop (zoom 13 merges buildings and drops stops).
  const z = 14;
  const x0 = Math.floor(lonToX(b.west, z)), x1 = Math.floor(lonToX(b.east, z));
  const y0 = Math.floor(latToY(b.north, z)), y1 = Math.floor(latToY(b.south, z));
  const jobs: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);

  const data: MapData = { areas: [], lines: [], stops: [], services: [], buildings: [], tiles: jobs.length };
  let done = 0;
  const seen = new Set<string>();
  onStatus(`Downloading ${jobs.length} map tiles…`);

  await Promise.all(
    jobs.map(async ([x, y]) => {
      const url = template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't download map tile ${z}/${x}/${y} (${res.status}).`);
      const tile = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
      readTile(tile, x, y, z, data, seen);
      onStatus(`Downloading map tiles… ${++done} of ${jobs.length}`);
    }),
  );
  return data;
}

function readTile(tile: VectorTile, tx: number, ty: number, z: number, data: MapData, seen: Set<string>) {
  for (const [layerName, layer] of Object.entries(tile.layers)) {
    const toLL = (p: { x: number; y: number }): LonLat => [
      ((tx + p.x / layer.extent) / 2 ** z) * 360 - 180,
      yToLat(ty + p.y / layer.extent, z),
    ];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const cls = String(f.properties.class ?? "");
      const sub = String(f.properties.subclass ?? "");
      const geomType = VectorTileFeature.types[f.type];

      if (layerName === "poi" && geomType === "Point") {
        const stop = stopKind(cls, sub);
        const services = serviceKinds(cls, sub);
        if (stop || services.length) {
          const [lon, lat] = toLL(f.loadGeometry()[0][0]);
          // Tiles repeat features near their edges, so each point is kept once.
          const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
          if (stop && !seen.has(`s${key}${stop}`)) {
            seen.add(`s${key}${stop}`);
            data.stops.push({ lon, lat, kind: stop });
          }
          for (const service of services)
            if (!seen.has(`v${key}${service}`)) {
              seen.add(`v${key}${service}`);
              data.services.push({ lon, lat, kind: service });
            }
        }
      } else if (geomType === "Polygon") {
        const rings = f.loadGeometry().map((ring) => ring.map(toLL));
        if (layerName === "building") data.buildings.push({ rings, height: Number(f.properties.render_height ?? 0) });
        else {
          const k = areaKind(layerName, cls, sub);
          // Public green open to all: parks, village greens and recreation grounds, and playgrounds (not private gardens).
          const park = (layerName === "landcover" && cls === "grass" && /^(park|village_green|recreation_ground)$/.test(sub)) || (layerName === "landuse" && cls === "playground");
          if (k) data.areas.push({ kind: k[0], priority: k[1], rings, park });
        }
      } else if (geomType === "LineString") {
        const kind = lineKind(layerName, cls, sub);
        const oneway = Number(f.properties.oneway ?? 0) !== 0;
        const offStreet = kind === "service" && /^(parking_aisle|driveway|drive-through)$/.test(String(f.properties.service ?? ""));
        if (kind) for (const part of f.loadGeometry()) data.lines.push({ kind, coords: part.map(toLL), oneway, offStreet });
      }
    }
  }
}

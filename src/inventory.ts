// Official CO₂ per resident of the municipality at the centre of the frame, from the inventory of
// 108,000 European cities (Moran et al., 2022; national inventories for 2018 spread to
// municipalities). Only the sectors a land-use plan changes are used: fuel burned in buildings
// (homes, shops, offices) and road fuel. Electricity from power plants is counted where it is
// generated, so it is not in a city's figure.

export interface Inventory {
  /** municipality name as in the inventory */
  name: string;
  population: number;
  /** buildings + road fuel, t CO₂ per resident per year */
  perResident: number;
  buildingsPerResident: number;
  roadPerResident: number;
}

/** OpenStreetMap country codes → inventory file (public/data/co2). */
const COUNTRY: Record<string, string> = {
  at: "austria", be: "belgium", bg: "bulgaria", hr: "croatia", cy: "cyprus", cz: "czech-republic", dk: "denmark",
  ee: "estonia", fi: "finland", fr: "france", de: "germany", gb: "great-britain", gr: "greece", hu: "hungary",
  is: "iceland", ie: "ireland-and-northern-ireland", it: "italy", lv: "latvia", li: "liechtenstein", lt: "lithuania",
  lu: "luxembourg", mt: "malta", nl: "netherlands", no: "norway", pl: "poland", pt: "portugal", ro: "romania",
  sk: "slovakia", si: "slovenia", es: "spain", se: "sweden", ch: "switzerland", tr: "turkey", ua: "ukraine",
};

// Same rules as the script that builds the files: municipality names carry local prefixes and
// suffixes ("Stadt_Freiburg im Breisgau", "Aarhus Kommune", "Stockholms kommun").
const PREFIX = /^(gemeinde|marktgemeinde|stadtgemeinde|stadt|gmina miejska|gmina|miasto|obec|město|mesto|comune di|ville de|municipio de|london borough of|royal borough of|concelho de|dimos|δήμος)\s+/;
const SUFFIX = /\s+(kommune|kommun|kunta|stad|vald|linn|novads|sav\.|savivaldybė|rajono savivaldybė|miesto savivaldybė)$/;
const plain = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").trim();

function normKeys(name: string): string[] {
  const s = name.toLowerCase().trim().split("_").pop()!;
  const out = new Set<string>();
  for (const part of [s, ...s.split(" - ").map((p) => p.trim())]) {
    const p = part.replace(PREFIX, "");
    const p2 = p.replace(SUFFIX, "");
    for (const k of [p, p2, ...(p2 !== p && p2.endsWith("s") ? [p2.slice(0, -1)] : [])]) if (plain(k)) out.add(plain(k));
  }
  return [...out];
}

const files = new Map<string, Promise<Record<string, [string, number, number, number]>>>();

export interface Place {
  /** OpenStreetMap country code, e.g. "nl" */
  country?: string;
  /** inventory entry of the municipality; absent outside the inventory's 34 countries or when no name matches */
  inventory?: Inventory;
}

/** Country and official CO₂ of the municipality at (lat, lon). */
export async function findPlace(lat: number, lon: number): Promise<Place> {
  let country: string | undefined;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=xx&lat=${lat}&lon=${lon}`);
    const place = (await res.json()) as { name?: string; address?: Record<string, string> };
    const a = place.address ?? {};
    country = a.country_code;
    return { country, inventory: await match(place.name, a) };
  } catch {
    // No inventory value: the app falls back to its own estimate.
    return { country };
  }
}

async function match(placeName: string | undefined, a: Record<string, string>): Promise<Inventory | undefined> {
  const file = COUNTRY[a.country_code ?? ""];
  if (!file) return undefined;
  if (!files.has(file)) files.set(file, fetch(`${import.meta.env.BASE_URL}data/co2/${file}.json`).then((r) => r.json()));
  const table = await files.get(file)!;
  // accept-language=xx has no translations, so names come in the local language, as in the inventory.
  // The municipality is usually the city, town or village; a village inside a larger
  // municipality falls through to the municipality.
  const names = [a.city, a.town, a.village, a.municipality, placeName, a.borough, a.city_district, a.county].filter((v): v is string => !!v);
  for (const n of names)
    for (const k of normKeys(n)) {
      const e = table[k];
      if (e) {
        const [name, population, buildings, road] = e;
        return { name: name.split("_").pop()!, population, perResident: (buildings + road) / population, buildingsPerResident: buildings / population, roadPerResident: road / population };
      }
    }
  return undefined;
}

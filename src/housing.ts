// Living space per person by country and settlement type: Eurostat average dwelling size
// (ilc_hcmh02, EU-SILC 2012) ÷ average household size (ilc_lvph01, 2012). Today's homes are
// anchored to this official figure; only floor area a strategy or growth adds or removes is
// modelled from the map.

/** m² of dwelling per person in cities, towns and suburbs, rural areas. */
const LIVING_M2: Record<string, [number, number, number]> = {
  eu: [37.3, 41.4, 43.7], be: [48.0, 56.2, 59.3], bg: [25.8, 26.6, 26.1], cz: [28.5, 31.6, 37.1], dk: [47.4, 62.5, 67.7],
  de: [38.7, 50.5, 56.8], ee: [26.4, 29.2, 35.2], gr: [31.9, 37.8, 35.7], es: [34.6, 40.5, 43.2], fr: [37.0, 43.4, 50.4],
  hr: [26.2, 30.3, 30.6], it: [36.8, 40.9, 40.4], cy: [49.4, 50.5, 52.9], lv: [23.0, 25.4, 29.7], lt: [25.0, 25.0, 30.3],
  lu: [43.6, 50.3, 62.6], hu: [27.0, 31.5, 36.0], nl: [42.9, 53.4, 57.4], at: [33.0, 43.2, 53.0], pl: [22.0, 27.2, 32.2],
  pt: [38.7, 42.3, 43.0], ro: [15.4, 16.7, 16.7], si: [28.8, 32.3, 33.7], sk: [26.0, 32.1, 33.5], fi: [35.8, 39.1, 46.0],
  se: [40.1, 47.4, 50.2], no: [55.3, 61.6, 62.4], ch: [42.7, 52.2, 58.7],
};

export const SETTLEMENT = ["city", "town or suburb", "rural area"] as const;

/**
 * Eurostat degree of urbanisation, applied to the frame: a city has 50,000 residents or more at
 * 1,500 per km² or more, a town or suburb 5,000 or more at 300 per km² or more.
 */
export function settlementType(population: number, landKm2: number): 0 | 1 | 2 {
  const density = landKm2 ? population / landKm2 : 0;
  return population >= 50_000 && density >= 1500 ? 0 : population >= 5000 && density >= 300 ? 1 : 2;
}

/** Official living space per person; countries outside the table use the EU average. */
export function livingM2PerPerson(country: string | undefined, type: 0 | 1 | 2) {
  const row = LIVING_M2[country ?? ""];
  return { m2: (row ?? LIVING_M2.eu)[type], national: !!row };
}

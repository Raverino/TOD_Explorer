// Population change 2025–2050 by country: Eurostat EUROPOP2023 baseline projection (proj_23np,
// population on 1 January, both sexes, all ages). National figures only: cities often grow faster
// than their country and villages slower, so the player can change it.

/** Change in population from 2025 to 2050, as a share of 2025. Keys are OpenStreetMap country codes. */
const CHANGE_2050: Record<string, number> = {
  eu: -0.0117, be: 0.0617, bg: -0.1462, cz: -0.0245, dk: 0.0284, de: -0.0046, ee: -0.027, ie: 0.143, gr: -0.1313,
  es: 0.038, fr: 0.0289, hr: -0.1314, it: -0.0243, cy: 0.0432, lv: -0.2131, lt: -0.1829, lu: 0.3056, hu: -0.0429,
  mt: 0.3445, nl: 0.0385, at: 0.0456, pl: -0.0979, pt: -0.0696, ro: -0.1271, si: -0.0126, sk: -0.0619, fi: -0.0322,
  se: 0.1331, is: 0.3375, no: 0.1283, ch: 0.0914,
};

/** Projected change to 2050; countries outside the projection use the EU figure. */
export function populationTrend(country: string | undefined) {
  const v = CHANGE_2050[country ?? ""];
  return { share: v ?? CHANGE_2050.eu, national: v !== undefined };
}

/** Fast growth: a booming city, about +0.9% a year. */
export const FAST_GROWTH = 0.25;

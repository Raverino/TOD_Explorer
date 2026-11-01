// The city year by year to 2050: new residents need homes, and the policy decides where they come
// from. TOD strategies first build up near transit at an even pace (their rule shares are reached
// in 2050), then open new land; Baseline only opens new land. New land never exceeds what the
// player allowed, and the growth model (growth.ts) decides where it goes. Whatever is left over is
// demand the city cannot house.

import { CityModel } from "./classify";
import { END_YEAR, GrowthResult, START_YEAR } from "./growth";
import { ScenarioResult } from "./scenarios";

interface Move {
  cell: number;
  to: number;
  /** residents it houses (negative when homes go) */
  gain: number;
  /** share of the way to 2050 from which it may happen */
  at: number;
  retrofit?: boolean;
}

export interface YearState {
  year: number;
  /** new residents to house by this year */
  need: number;
  /**
   * residents whose homes became shops, parks or streets by this year and need new homes too (in a
   * shrinking city, only those the homes it leaves empty cannot take)
   */
  displaced: number;
  /** residents given a new home by this year (newcomers and the displaced) */
  housed: number;
  /** housed by building up within the city, and on new land */
  housedInside: number;
  housedOnLand: number;
  /** moves done: home-adding changes, other changes, new-land cells */
  inside: number;
  other: number;
  land: number;
}

export interface Simulation {
  /** residents added by 2050; negative when the population falls */
  newResidents: number;
  years: YearState[];
  inside: Move[];
  other: Move[];
  landCells: Int32Array;
  landGain: Float32Array;
  /** new-land cells the player allowed */
  landAllowed: number;
}

/**
 * Residents of cell i when it holds class c: measured today, and for new homes the typical floor
 * area of the class at the area's residents per m² of home floor, as in the indicators.
 */
function residentsOf(m: CityModel, i: number, c: number) {
  if (c === m.baseCls[i]) return m.residents[i];
  return c >= 1 && c <= 3 ? m.typicalFloorM2[c] * m.peoplePerFloorM2 : 0;
}

export function simulate(base: CityModel, plan: ScenarioResult, g: GrowthResult | undefined, newResidents: number): Simulation {
  const residents = (i: number, to: number) => residentsOf(base, i, to) - residentsOf(base, i, base.cls[i]);
  const inside: Move[] = [], other: Move[] = [];
  for (let i = 0; i < base.cls.length; i++) {
    if (plan.changed[i]) {
      const to = plan.model.cls[i];
      const gain = residents(i, to);
      // Turning homes into other homes only happens where it adds room for people.
      if (to >= 1 && to <= 3) {
        if (gain > 0) inside.push({ cell: i, to, gain, at: plan.progress[i] });
      } else other.push({ cell: i, to, gain, at: plan.progress[i] });
    }
    if (plan.retrofitted[i]) other.push({ cell: i, to: base.cls[i], gain: 0, at: plan.retrofitProgress[i], retrofit: true });
  }
  inside.sort((a, b) => a.at - b.at);
  other.sort((a, b) => a.at - b.at);
  const landCells = g?.order ?? new Int32Array(0);
  const landGain = Float32Array.from(landCells, (i) => residents(i, g!.tbClass[i]));

  const years: YearState[] = [];
  let displaced = 0, housedInside = 0, housedOnLand = 0, a = 0, o = 0, l = 0;
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const t = (year - START_YEAR) / (END_YEAR - START_YEAR) + 1e-6;
    // Parks, green streets, shops and retrofits follow the policy's pace whatever the demand.
    while (o < other.length && other[o].at <= t) displaced -= other[o++].gain;
    const need = Math.max(0, newResidents) * (t - 1e-6);
    // A shrinking city has room for the displaced in the homes it leaves empty.
    const target = Math.max(0, newResidents * (t - 1e-6) + displaced);
    while (housedInside + housedOnLand < target && a < inside.length && inside[a].at <= t) housedInside += inside[a++].gain;
    while (housedInside + housedOnLand < target && l < landCells.length && g!.yearAdded[landCells[l]] <= year) housedOnLand += landGain[l++];
    years.push({ year, need, displaced: target - need, housed: housedInside + housedOnLand, housedInside, housedOnLand, inside: a, other: o, land: l });
  }
  return { newResidents, years, inside, other, landCells, landGain, landAllowed: g?.requested ?? 0 };
}

/**
 * The city in a given year. Changes overlay: 1 = new land use from the strategy, 2 = new urban
 * land, 3 = retrofitted homes, 4 = new urban green from the strategy.
 */
export function simCity(base: CityModel, sim: Simulation, g: GrowthResult | undefined, year: number) {
  const st = sim.years[Math.max(0, Math.min(sim.years.length - 1, year - START_YEAR))];
  const cls = base.cls.slice();
  const changed = new Uint8Array(cls.length);
  const retrofitted = new Uint8Array(cls.length);
  const roadAreaM2 = base.roadAreaM2.slice();
  for (let k = 0; k < st.inside; k++) {
    const { cell, to } = sim.inside[k];
    cls[cell] = to;
    changed[cell] = 1;
  }
  for (let k = 0; k < st.other; k++) {
    const { cell, to, retrofit } = sim.other[k];
    if (retrofit) continue;
    cls[cell] = to;
    changed[cell] = to === 7 ? 4 : 1;
    // A street turned green no longer carries traffic, so it leaves the roadway area (8.A.3).
    if (to === 7 && base.cls[cell] === 5) roadAreaM2[cell] = 0;
  }
  for (let k = 0; k < st.other; k++) {
    const { cell, retrofit } = sim.other[k];
    if (!retrofit || !(cls[cell] >= 1 && cls[cell] <= 3)) continue;
    retrofitted[cell] = 1;
    if (!changed[cell]) changed[cell] = 3;
  }
  for (let k = 0; k < st.land; k++) {
    const i = sim.landCells[k];
    cls[i] = g!.tbClass[i];
    changed[i] = 2;
  }
  return { model: { ...base, cls, retrofitted, roadAreaM2 } as CityModel, changed, state: st };
}

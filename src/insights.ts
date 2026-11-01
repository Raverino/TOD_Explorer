// Plain-language explanations of a result, chosen from what actually changed, each with its source.

import { Indicators } from "./indicators";
import { SOURCES } from "./sources";

export interface Insight {
  title: string;
  text: string;
  /** short citation, e.g. "Park et al., 2018" */
  cite?: string;
  tone: "good" | "bad" | "neutral";
}

export interface Question {
  q: string;
  a: string;
  cite?: string;
}

export interface ExplainInput {
  strategyId: string;
  strategyName: string;
  x: Indicators;
  /** the comparison (Baseline in the same year, or today) */
  b?: Indicators;
  /** land-use changes the strategy made: class ids */
  conversions: { from: number; to: number }[];
  retrofitted: boolean;
  grows: boolean;
  /** new stations placed in step 4 */
  newStations: number;
  /** newcomers and their homes by the shown year, and Baseline's in the same year */
  housing?: Housing;
}

export interface Housing {
  need: number;
  housed: number;
  /** housed by building up within the city */
  inside: number;
  /** new urban land used, ha, and the part of it taken from parks and urban green */
  landHa: number;
  greenHa: number;
  base?: { housed: number; landHa: number; greenHa: number };
}

/** Short citation → the start of its full reference in SOURCES. */
const CITES: Record<string, string> = {
  "ITDP, 2017": "ITDP (2017)",
  "Wang et al., 2019": "Wang, G.",
  "Park et al., 2018": "Park, K.",
  "Shu et al., 2024": "Shu, L.",
  "Croci et al., 2021": "Croci, E.",
  "Dimas, 2025": "Dimas, P.",
  "Hewitt et al., 2013": "Hewitt, R.",
  "Moran et al., 2022": "Moran, D.",
  "Cervero & Murakami, 2009": "Cervero, R.",
};

/** Full references for the citations used, in alphabetical order. */
export function referencesFor(cites: (string | undefined)[]) {
  const keys = new Set(cites.filter((c): c is string => !!c).flatMap((c) => c.split("; ")));
  return SOURCES.filter((s) => [...keys].some((k) => CITES[k] && s.startsWith(CITES[k])));
}


const fmt = (v: number) => Math.round(v).toLocaleString("en");

export function explain(d: ExplainInput): { insights: Insight[]; questions: Question[] } {
  const { x, b } = d;
  const insights: Insight[] = [];
  const metric = (ind: Indicators | undefined, id: string) => ind?.tod.find((t) => t.id === id)?.points ?? 0;
  const delta = (id: string) => metric(x, id) - metric(b, id);

  if (b && d.strategyId !== "BASE") {
    // TOD score
    if (delta("6.A.1") < 0)
      insights.push({
        tone: "bad",
        title: "Why did the TOD score fall?",
        text: `${d.strategyName} turned land with shops, offices or services near the station into homes. Fewer of them stay within walking distance, so the station area loses points on "Shops and services by the station". The TOD Standard asks for a mix: when people travel to a station area as well as away from it, trains are used in both directions and all day.`,
        cite: "ITDP, 2017",
      });
    if (delta("6.A.2") > 0)
      insights.push({ tone: "good", title: "More homes by the station", text: "Building up near the station brings more residents within walking distance, closer to UN-Habitat's target of 150 per hectare, which earns Densify points.", cite: "ITDP, 2017" });
    if (delta("5.A.3") > 0)
      insights.push({ tone: "good", title: "A park within reach", text: "The new green brings a park or green street within a 500 m walk of at least 80% of the buildings near the station, which earns a Mix point.", cite: "ITDP, 2017" });
    if (delta("8.A.3") > 0)
      insights.push({ tone: "good", title: "Roads became parks", text: "Turning road and parking space into green space shrinks the area taken by cars, which earns Shift points.", cite: "ITDP, 2017" });
    if (delta("7.A.1") < 0)
      insights.push({ tone: "bad", title: "Building on fields", text: "New buildings on farmland near the station lower the share of building inside the existing city, which costs Compact points.", cite: "ITDP, 2017" });
    if (x.todPoints === b.todPoints && x.todPoints < x.todMax)
      insights.push({ tone: "neutral", title: "Why did the TOD score not change?", text: "The TOD Standard gives points in steps, for example at set numbers of residents per hectare near the station or a set share of land taken by roads. This policy moved the numbers, but not across a step." });

    // CO₂ per resident
    const co2 = x.co2PerCapita - b.co2PerCapita;
    if (co2 < -5)
      insights.push({
        tone: "good",
        title: "Why does CO₂ per resident fall?",
        text: `More people live on the same land, so each resident's share of its emissions is smaller: land with high-rise homes emits about 17% less CO₂ per m² than land with terraced houses, and holds many more people.${d.retrofitted ? " Retrofits cut a home's energy use by about 30%, and buildings cause about half of a European city's emissions." : ""}`,
        cite: d.retrofitted ? "Wang et al., 2019; Shu et al., 2024; Croci et al., 2021" : "Wang et al., 2019",
      });
    else if (co2 > 5)
      insights.push({ tone: "bad", title: "Why does CO₂ per resident rise?", text: "More residents end up on lower-density land, which emits more CO₂ per person because each home has more land and energy to itself.", cite: "Wang et al., 2019" });

    // Land saved against Baseline
    const h = d.housing;
    if (h?.base && h.base.landHa - h.landHa >= 1)
      insights.push({
        tone: "good",
        title: `${fmt(h.base.landHa - h.landHa)} ha of land saved`,
        text: `Baseline houses its newcomers on ${fmt(h.base.landHa)} ha of new land${h.base.greenHa >= 1 ? `, ${fmt(h.base.greenHa)} ha of it parks and urban green` : ""}. ${d.strategyName} builds up near transit first and uses ${h.landHa >= 1 ? `${fmt(h.landHa)} ha` : "no new land"}${h.housed > h.base.housed + 1 ? `, and still houses ${fmt(h.housed - h.base.housed)} more people` : h.housed < h.base.housed - 1 ? `, but houses ${fmt(h.base.housed - h.housed)} fewer people` : ""}.`,
        cite: "Dimas, 2025",
      });
    if (Math.abs(x.popStdShare - b.popStdShare) < 0.01 && !d.newStations)
      insights.push({ tone: "neutral", title: "Why does the share near transit barely move?", text: "Policies change what is built around the stations that exist. Reaching more people needs new stations: try step 4." });
  }

  // Newcomers and their homes
  const h = d.housing;
  if (h && h.need >= 1 && d.grows) {
    const short = h.need - h.housed;
    if (short >= Math.max(1, h.need * 0.005))
      insights.push({
        tone: "bad",
        title: `${fmt(short)} newcomers without a home`,
        text: `Of the ${fmt(h.need)} people expected, ${fmt(Math.max(0, h.housed))} find a home here. The rest would have to live elsewhere and travel in, or crowd into today's homes. ${d.strategyId === "BASE" ? "Baseline only builds on new land: a TOD policy also builds up inside the city." : "Raise the shares in Custom, or allow more new land where some is still free."}`,
      });
    else
      insights.push({
        tone: "good",
        title: "Everyone has a home",
        text: `All ${fmt(h.need)} newcomers find a home${h.inside >= 1 ? `, ${fmt(h.inside)} of them by building up near transit` : ""}${h.landHa >= 1 ? ` and the rest on ${fmt(h.landHa)} ha of new land` : ", without new land"}.`,
      });
  }
  if (x.sparse && x.co2Source === "inventory")
    insights.push({
      tone: "neutral",
      title: "Why is CO₂ per resident so high here?",
      text: `Only about ${Math.round(x.residentsPerHa)} people live on each hectare of housing land; city neighbourhoods hold about 100 to 400. The official figure divides all fuel burned in buildings and sold at petrol stations by residents, so hotels, holiday homes, visitors and through traffic all land on the few people who live here.`,
      cite: "Moran et al., 2022",
    });
  else if (x.sparse)
    insights.push({
      tone: "neutral",
      title: "Why is CO₂ per resident so high here?",
      text: `Only about ${Math.round(x.residentsPerHa)} people live on each hectare of housing land; city neighbourhoods hold about 100 to 400. The emission factors are measured per m² of city land, so in a place this sparse each resident carries a lot of it, and holiday homes or hotels add floor space without residents. The number is overstated: compare strategies with each other, not this place with a city.`,
      cite: "Wang et al., 2019",
    });
  if (d.newStations)
    insights.push({
      tone: "good",
      title: "Stations and homes planned together",
      text: `You added ${d.newStations} rail or metro station${d.newStations > 1 ? "s" : ""}. In Hong Kong, the rail company is given the right to develop the land around new stations and builds homes, offices and shops there with private developers. Rail and buildings are planned together, and the rise in land value helps pay for the line. In this game, TOD strategies build around the new stations and TOD growth moves towards them.`,
      cite: "Cervero & Murakami, 2009",
    });
  if (d.grows)
    insights.push({
      tone: "neutral",
      title: "About the growth",
      text: "Each year the newcomers need homes. TOD policies build up near transit first, at a steady pace; new land goes where it is most attractive: next to the city, on flat land and near roads or transit. It is a possible future, not a forecast.",
      cite: "Hewitt et al., 2013",
    });
  if (!insights.length)
    insights.push({ tone: "neutral", title: "This is the city today", text: "Pick a strategy to see how Transit-Oriented Development would change it, then come back here to compare." });

  const next: Record<string, string> = {
    BASE: "Try Intense Building to see what building up around the stations does.",
    IB: "Try Retrofitting: it reuses industry, parking and roads instead of building up homes.",
    RETRO: "Try Balanced: it also adds homes and green space, but keeps more jobs near the station, so the TOD score holds up better.",
    BAL: "Go back to step 2, pick fast growth and compare how Baseline and Balanced house the newcomers.",
    CUSTOM: "Change one rule at a time and watch which score moves.",
  };
  const questions: Question[] = [
    { q: "What should I try next?", a: next[d.strategyId] ?? next.CUSTOM },
    { q: "Is denser always better?", a: "Not by itself. The TOD Standard pairs density with walkable streets, parks and a mix of homes and jobs. A dense area without them is not a good TOD.", cite: "ITDP, 2017" },
    { q: "Why does everything centre on the station?", a: "People who live within about a 10-minute walk of good public transport use it far more and drive less: TOD residents drive about 39% less than people near stations without TOD.", cite: "Park et al., 2018" },
    { q: "Why does land use matter for climate?", a: "Buildings and streets last for decades. Where homes, jobs and stations are placed decides how much energy people use at home and how they travel, long after a plan is made.", cite: "Dimas, 2025" },
    { q: "How exact are these numbers?", a: "They are estimates from open data (OpenStreetMap and measured population). Use them to compare strategies with each other, not as a forecast for the city." },
  ];
  return { insights, questions };
}

// The 10 land-use classes of the thesis (Dimas, 2025, Table 4), with the
// colours used for the cube city. Colours follow the isometric illustrations
// by Anastasia Logvinenko (2025).

export interface LandUseClass {
  id: number;
  name: string;
  short: string;
  /** top face colour of the ground block */
  ground: string;
  /** colour of building blocks stacked on top (if any) */
  block?: string;
  /** roof colour of the top building block */
  roof?: string;
  /** min/max number of building blocks stacked on a cell */
  stack?: [number, number];
}

export const CLASSES: Record<number, LandUseClass> = {
  1: { id: 1, name: "High-density urban fabric", short: "High density", ground: "#b8bcc6", block: "#a9d2f2", roof: "#e9eef4", stack: [3, 5] },
  2: { id: 2, name: "Medium-density urban fabric", short: "Medium density", ground: "#c9c3b4", block: "#f1dcb0", roof: "#c98a5a", stack: [2, 3] },
  3: { id: 3, name: "Low-density urban fabric", short: "Low density", ground: "#9fd36a", block: "#fbf1dc", roof: "#d9534f", stack: [1, 1] },
  4: { id: 4, name: "Commercial and industrial", short: "Commercial", ground: "#b5b3bd", block: "#f0a35e", roof: "#8c8a96", stack: [1, 2] },
  5: { id: 5, name: "Transportation infrastructure", short: "Roads and rail", ground: "#5d6069" },
  6: { id: 6, name: "Development opportunity zones", short: "Development site", ground: "#c8a77a" },
  7: { id: 7, name: "Urban green and recreation", short: "Urban green", ground: "#6cbf3c" },
  8: { id: 8, name: "Agricultural and rural", short: "Agricultural", ground: "#d6e49a" },
  9: { id: 9, name: "Water and wetlands", short: "Water", ground: "#5bb3e8" },
  10: { id: 10, name: "Excluded industrial and special zones", short: "Special zone", ground: "#8d7fa8", block: "#b4a8cc", roof: "#6f6390", stack: [1, 1] },
};

export const CLASS_IDS = Object.keys(CLASSES).map(Number);


/** Colour of a transit station block. */
export const STATION_COLOR = "#f5c542";

/** A new station placed in the game is drawn as a pin: a red cube on a grey stick. */
export const NEW_STATION_COLOR = "#e0262b";
export const PIN_STICK_COLOR = "#c3c8d0";

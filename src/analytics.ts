// Counts visits and a few moments in the game with GoatCounter (goatcounter.com):
// no cookies and no personal data, only page views and named events such as "results".

/** The site's GoatCounter endpoint; the dashboard is at darthraven.goatcounter.com. */
const GOATCOUNTER = "https://darthraven.goatcounter.com/count";

declare global {
  interface Window {
    goatcounter?: { count: (vars: { path: string; title?: string; event?: boolean }) => void };
  }
}

/** Off on the local dev server, so testing is not counted. */
const enabled = !import.meta.env.DEV;

/** Loads the counter, which records the page view. */
export function startCounting() {
  if (!enabled) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = GOATCOUNTER;
  document.head.appendChild(s);
}

/** Records a moment in the game, e.g. "city-built" or "results". */
export function track(event: string) {
  if (enabled) window.goatcounter?.count({ path: event, title: event, event: true });
}

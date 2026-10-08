export const TZ = process.env.APP_TZ || "America/New_York";

/** YYYY-MM-DD in the app's timezone. */
export function dayOf(d: Date | number) {
  const date = typeof d === "number" ? new Date(d * 1000) : d;
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function today() {
  return dayOf(new Date());
}

export function addDays(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string) {
  return Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);
}

/** "2026-10" for a day */
export function monthOf(day: string) {
  return day.slice(0, 7);
}

export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, next, days };
}

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortDay(day: string) {
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

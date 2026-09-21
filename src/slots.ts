import type { BusinessHours } from "./types";

export const DAY_START = "08:00";
export const DAY_END = "22:00";
export const ALL_DAY_START = "00:00";
export const ALL_DAY_END = "24:00";

export function halfHours(from = DAY_START, to = DAY_END): string[] {
  const out: string[] = [];
  let [h, m] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  while (h < th || (h === th && m < tm)) {
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 30;
    if (m >= 60) { m = 0; h += 1; }
  }
  return out;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function upcomingDates(count = 31, base = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(toDateStr(d));
  }
  return out;
}

export function defaultBusinessHours(): BusinessHours {
  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => [
    String(day), { enabled: true, start: DAY_START, end: DAY_END },
  ]));
}

export function normalizeBusinessHours(value?: BusinessHours): BusinessHours {
  const defaults = defaultBusinessHours();
  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
    const key = String(day);
    const entry = value?.[key];
    return [key, entry ? { ...entry } : defaults[key]];
  }));
}

export function isWithinBusinessHours(hours: BusinessHours | undefined, date: string, start: string): boolean {
  const day = String(new Date(`${date}T00:00:00Z`).getUTCDay());
  const entry = normalizeBusinessHours(hours)[day];
  return entry.enabled && start >= entry.start && start < entry.end;
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export function weekday(dateStr: string): string {
  return `周${WEEK[new Date(dateStr + "T00:00:00").getDay()]}`;
}

export function shortDate(dateStr: string): string {
  const [, mm, dd] = dateStr.split("-");
  return `${mm}/${dd}`;
}

export function slotKey(date: string, start: string): string {
  return `${date} ${start}`;
}

export function parseKey(key: string): { date: string; start: string } {
  const [date, start] = key.split(" ");
  return { date, start };
}

// Group a list of "date start" keys by date, sorted.
export function groupKeys(keys: string[]): { date: string; starts: string[] }[] {
  const map = new Map<string, string[]>();
  for (const k of keys) {
    const { date, start } = parseKey(k);
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(start);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, starts]) => ({ date, starts: starts.sort() }));
}

// Pure schedule-matching logic. No I/O; unit-testable and shared by the Function.
// A slot key is `${date} ${start}`, e.g. "2026-09-25 14:30".

export function slotKey(slot) {
  return `${slot.date} ${slot.start}`;
}

export function parseKey(key) {
  const [date, start] = key.split(" ");
  return { date, start };
}

const DEFAULT_DAY = Object.freeze({ enabled: true, start: "08:00", end: "22:00" });
export const DEFAULT_BUSINESS_HOURS = Object.freeze(Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [String(day), DEFAULT_DAY]),
));

export function normalizeBusinessHours(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
    const entry = source[String(day)];
    if (!entry || typeof entry !== "object") return [String(day), { ...DEFAULT_DAY }];
    return [String(day), {
      enabled: entry.enabled !== false,
      start: typeof entry.start === "string" ? entry.start : DEFAULT_DAY.start,
      end: typeof entry.end === "string" ? entry.end : DEFAULT_DAY.end,
    }];
  }));
}

export function isWithinBusinessHours(businessHours, date, start) {
  const day = String(new Date(`${date}T00:00:00Z`).getUTCDay());
  const hours = normalizeBusinessHours(businessHours)[day];
  return hours.enabled && start >= hours.start && start < hours.end;
}

const normalizeCity = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");

function classifyLocation(city, preferredCities, proximities) {
  if (preferredCities.length === 0) {
    return { level: "neutral", rank: 0, nearbyTo: null, priority: null };
  }
  if (preferredCities.includes(city)) {
    return { level: "preferred", rank: 0, nearbyTo: city, priority: 0 };
  }

  const nearby = proximities
    .filter((p) => preferredCities.includes(p.city) && p.nearby_city === city)
    .sort((a, b) => a.priority - b.priority || a.city.localeCompare(b.city))[0];
  if (nearby) {
    return { level: "nearby", rank: 1, nearbyTo: nearby.city, priority: nearby.priority };
  }
  return { level: "other", rank: 2, nearbyTo: null, priority: null };
}

function compareLocation(a, b) {
  return a.location.rank - b.location.rank
    || (a.location.priority ?? 1000) - (b.location.priority ?? 1000);
}

function compareStable(a, b) {
  return a.name.localeCompare(b.name) || a.studioId.localeCompare(b.studioId);
}

function reasonCodes(studio, isFull) {
  const reasons = [];
  if (isFull) reasons.push("single_studio_full_cover");
  if (studio.location.level === "preferred") reasons.push("preferred_city");
  if (studio.location.level === "nearby") reasons.push("nearby_city");
  if (studio.location.level === "other") reasons.push("other_city");
  return reasons;
}

export function computeMatches(desiredKeys, studios, options = {}) {
  const desired = [...new Set(desiredKeys)];
  const desiredSet = new Set(desired);
  const preferredCities = [...new Set((options.preferredCities ?? []).map(normalizeCity).filter(Boolean))];
  const matchMode = options.matchMode === "location_first" && preferredCities.length > 0
    ? "location_first"
    : "schedule_first";
  const proximities = (options.proximities ?? []).map((p) => ({
    city: normalizeCity(p.city),
    nearby_city: normalizeCity(p.nearby_city),
    priority: Number.isInteger(p.priority) ? p.priority : 999,
  }));

  const scored = studios.map((s) => {
    const freeKeys = [...new Set(s.freeKeys ?? [])].sort();
    const free = new Set(freeKeys);
    const covered = desired.filter((key) => free.has(key));
    const location = classifyLocation(normalizeCity(s.city), preferredCities, proximities);
    const result = {
      studioId: s.id,
      name: s.name,
      city: normalizeCity(s.city),
      address: s.address,
      covered,
      missing: desired.filter((key) => !free.has(key)),
      location,
      alternativeSlots: freeKeys.filter((key) => !desiredSet.has(key)),
    };
    return { ...result, reasonCodes: reasonCodes(result, covered.length === desired.length && desired.length > 0) };
  });

  const fullCover = scored
    .filter((s) => s.covered.length === desired.length && desired.length > 0)
    .sort((a, b) => compareLocation(a, b) || compareStable(a, b));
  const p0 = preferredCities.length === 0
    ? fullCover
    : fullCover.filter((studio) => studio.location.level === "preferred");
  const p1 = preferredCities.length === 0
    ? []
    : fullCover.filter((studio) => studio.location.level !== "preferred");
  const tier = p0.length > 0 ? "P0" : p1.length > 0 ? "P1" : "P2";

  const comparePartial = matchMode === "location_first"
    ? (a, b) => compareLocation(a, b) || b.covered.length - a.covered.length || compareStable(a, b)
    : (a, b) => b.covered.length - a.covered.length || compareLocation(a, b) || compareStable(a, b);

  const partial = scored
    .filter((s) => s.covered.length > 0 && s.covered.length < desired.length)
    .sort(comparePartial);

  const combination = fullCover.length === 0 && desired.length > 0
    ? greedyCombination(desired, scored, matchMode)
    : null;

  const adjustmentOptions = matchMode === "location_first"
    ? scored
      .filter((s) => s.alternativeSlots.length > 0)
      .sort((a, b) => compareLocation(a, b) || b.alternativeSlots.length - a.alternativeSlots.length || compareStable(a, b))
      .map((s) => ({
        studioId: s.studioId,
        name: s.name,
        city: s.city,
        address: s.address,
        location: s.location,
        available: s.alternativeSlots.slice(0, 24),
        reasonCodes: s.reasonCodes,
      }))
    : [];

  return {
    desired,
    preferredCities,
    matchMode: options.matchMode === "location_first" ? "location_first" : "schedule_first",
    effectiveMode: matchMode,
    tier,
    p0,
    p1,
    fullCover,
    partial,
    combination,
    adjustmentOptions,
  };
}

function greedyCombination(desired, scored, matchMode) {
  const remaining = new Set(desired);
  const chosen = [];
  const pool = scored.filter((s) => s.covered.length > 0);

  while (remaining.size > 0) {
    const candidates = pool
      .filter((s) => !chosen.some((c) => c.studioId === s.studioId))
      .map((s) => ({ studio: s, gain: s.covered.filter((key) => remaining.has(key)) }))
      .filter((candidate) => candidate.gain.length > 0)
      .sort((a, b) => {
        if (matchMode === "location_first") {
          return compareLocation(a.studio, b.studio)
            || b.gain.length - a.gain.length
            || compareStable(a.studio, b.studio);
        }
        return b.gain.length - a.gain.length
          || compareLocation(a.studio, b.studio)
          || compareStable(a.studio, b.studio);
      });

    const best = candidates[0];
    if (!best) break;
    chosen.push({
      studioId: best.studio.studioId,
      name: best.studio.name,
      city: best.studio.city,
      address: best.studio.address,
      assigned: best.gain,
      location: best.studio.location,
      reasonCodes: best.studio.reasonCodes,
    });
    for (const key of best.gain) remaining.delete(key);
  }

  return {
    studios: chosen,
    coversAll: remaining.size === 0,
    covered: desired.filter((key) => !remaining.has(key)),
    uncovered: [...remaining],
  };
}

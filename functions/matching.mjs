// Pure schedule-matching logic. No I/O; unit-testable and shared by the Function.
// A slot key is `${date} ${start}`, e.g. "2026-09-25 14:30".

export function slotKey(slot) {
  return `${slot.date} ${slot.start}`;
}

export function parseKey(key) {
  const [date, start] = key.split(" ");
  return { date, start };
}

// desiredKeys: string[] (unique). studios: [{id,name,city,address,freeKeys:string[]}].
// Returns single-studio full covers, ranked partial covers, and (when no single
// studio covers everything) a greedy multi-studio combination proposal.
export function computeMatches(desiredKeys, studios) {
  const desired = [...new Set(desiredKeys)];
  const desiredSet = new Set(desired);

  const scored = studios.map((s) => {
    const free = new Set(s.freeKeys);
    const covered = desired.filter((k) => free.has(k));
    return {
      studioId: s.id,
      name: s.name,
      city: s.city,
      address: s.address,
      covered,
      missing: desired.filter((k) => !free.has(k)),
    };
  });

  const fullCover = scored
    .filter((s) => s.covered.length === desired.length && desired.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const partial = scored
    .filter((s) => s.covered.length > 0 && s.covered.length < desired.length)
    .sort((a, b) => b.covered.length - a.covered.length || a.name.localeCompare(b.name));

  let combination = null;
  if (fullCover.length === 0 && desired.length > 0) {
    combination = greedyCombination(desired, scored, desiredSet);
  }

  return { desired, fullCover, partial, combination };
}

function greedyCombination(desired, scored, desiredSet) {
  const remaining = new Set(desired);
  const chosen = [];
  const pool = scored.filter((s) => s.covered.length > 0);

  while (remaining.size > 0) {
    let best = null;
    let bestGain = [];
    for (const s of pool) {
      if (chosen.some((c) => c.studioId === s.studioId)) continue;
      const gain = s.covered.filter((k) => remaining.has(k));
      if (gain.length > bestGain.length) {
        best = s;
        bestGain = gain;
      }
    }
    if (!best || bestGain.length === 0) break;
    chosen.push({
      studioId: best.studioId,
      name: best.name,
      city: best.city,
      address: best.address,
      assigned: bestGain,
    });
    for (const k of bestGain) remaining.delete(k);
  }

  const covered = desired.filter((k) => !remaining.has(k));
  return {
    studios: chosen,
    coversAll: remaining.size === 0,
    covered,
    uncovered: [...remaining],
  };
}

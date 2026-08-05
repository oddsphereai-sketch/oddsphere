import type { MarketEdgeDto } from "./labTypes";

export type DisplayOddsTrailStop = NonNullable<MarketEdgeDto["oddsTrail"]>[number];

function sameOddsStop(a: DisplayOddsTrailStop | undefined, b: DisplayOddsTrailStop): boolean {
  return a !== undefined && a.american === b.american && a.line === b.line;
}

function makeFallbackOddsStop(
  american: number | null,
  label: DisplayOddsTrailStop["label"],
  source: DisplayOddsTrailStop["source"],
): DisplayOddsTrailStop | null {
  if (typeof american !== "number" || !Number.isFinite(american)) return null;
  return {
    american,
    line: null,
    observedAt: null,
    sportsbook: null,
    source,
    label,
  };
}

function sortTrailByObservedAt(stops: DisplayOddsTrailStop[]): DisplayOddsTrailStop[] {
  return [...stops].sort((a, b) => {
    const aTime = a.observedAt ? Date.parse(a.observedAt) : Number.NaN;
    const bTime = b.observedAt ? Date.parse(b.observedAt) : Number.NaN;
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return 0;
  });
}

function lastWithLabel(
  trail: DisplayOddsTrailStop[],
  label: DisplayOddsTrailStop["label"],
): DisplayOddsTrailStop | undefined {
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    if (trail[index]?.label === label) return trail[index];
  }
  return undefined;
}

/** Keep a locked recommendation's final trail stop immutable. */
export function summarizePersistedOddsTrail(
  trail: NonNullable<MarketEdgeDto["oddsTrail"]>,
  fallback: {
    open: number | null;
    prev: number | null;
    current: number | null;
    locked: boolean;
  },
): NonNullable<MarketEdgeDto["oddsTrail"]> {
  const orderedTrail = sortTrailByObservedAt(trail);
  const deduped = orderedTrail.filter((stop, index) => {
    return !sameOddsStop(orderedTrail[index - 1], stop);
  });
  const fallbackOpen = makeFallbackOddsStop(fallback.open, "first", "line_history");
  const fallbackPrev = makeFallbackOddsStop(fallback.prev, "move", "line_history");
  const fallbackCurrent = makeFallbackOddsStop(
    fallback.current,
    fallback.locked ? "locked" : "current",
    fallback.locked ? "locked_snapshot" : "current_line",
  );

  const first = deduped.find((stop) => stop.label === "first") ?? fallbackOpen ?? deduped[0] ?? null;
  const last =
    lastWithLabel(deduped, "locked") ??
    lastWithLabel(deduped, "current") ??
    fallbackCurrent ??
    deduped[deduped.length - 1] ??
    null;
  if (first === null && last === null) return [];

  const middleCandidates = [
    ...deduped.filter((stop) => !sameOddsStop(first ?? undefined, stop) && !sameOddsStop(last ?? undefined, stop)),
    fallbackPrev,
  ].filter((stop): stop is DisplayOddsTrailStop => stop !== null);
  const middle =
    middleCandidates
      .filter((stop) => !sameOddsStop(first ?? undefined, stop) && !sameOddsStop(last ?? undefined, stop))
      .sort((a, b) => {
        const aTime = a.observedAt ? Date.parse(a.observedAt) : Number.NaN;
        const bTime = b.observedAt ? Date.parse(b.observedAt) : Number.NaN;
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
        if (a.label === "move" && b.label !== "move") return -1;
        if (a.label !== "move" && b.label === "move") return 1;
        return 0;
      })[0] ?? null;

  const summary = [
    first ? { ...first, label: "first" as const } : null,
    middle ? { ...middle, label: "move" as const } : null,
    last
      ? {
          ...last,
          label: fallback.locked ? "locked" as const : "current" as const,
        }
      : null,
  ].filter((stop): stop is DisplayOddsTrailStop => stop !== null);
  return summary.filter((stop, index, arr) => {
    const previous = arr[index - 1];
    return previous === undefined || !sameOddsStop(previous, stop) || previous.label !== stop.label;
  });
}

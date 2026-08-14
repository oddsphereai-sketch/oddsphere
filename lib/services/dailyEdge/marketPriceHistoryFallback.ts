export type DisplayLineHistoryRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  odds_american: number | null;
  line_value: number | null;
  recorded_at: string;
  id: number;
};

export type CanonicalPriceObservationRow = {
  id: number;
  canonical_event_id: string;
  market_type: string;
  selection_key: string;
  sportsbook: string;
  american_price: number | null;
  line: number | null;
  provider_timestamp: string | null;
  fetched_at: string;
};

function observationSide(row: CanonicalPriceObservationRow): string | null {
  const side = row.selection_key.split(":").at(-1)?.toLowerCase() ?? null;
  if (row.market_type === "moneyline" && (side === "home" || side === "away")) return side;
  if (row.market_type === "total" && (side === "over" || side === "under")) return side;
  if (
    (row.market_type === "first_inning" || row.market_type === "first_inning_total") &&
    (side === "over" || side === "under")
  ) return side;
  return null;
}

function displayMarketType(marketType: string): string | null {
  if (marketType === "moneyline" || marketType === "total") return marketType;
  if (marketType === "first_inning" || marketType === "first_inning_total") {
    return "first_inning_total";
  }
  return null;
}

function hasSameBookTrail(rows: readonly DisplayLineHistoryRow[]): boolean {
  const timestampsByBook = new Map<string, Set<string>>();
  for (const row of rows) {
    if (typeof row.odds_american !== "number" || !Number.isFinite(row.odds_american)) continue;
    const timestamps = timestampsByBook.get(row.sportsbook) ?? new Set<string>();
    timestamps.add(row.recorded_at);
    timestampsByBook.set(row.sportsbook, timestamps);
  }
  return Array.from(timestampsByBook.values()).some((timestamps) => timestamps.size >= 2);
}

/**
 * Fill reader-only movement gaps from the canonical append-only observation
 * lane. The recommendation writer continues to use its frozen line_history
 * inputs; this helper changes no pick, probability, grade, or stake.
 *
 * A canonical fallback is added only when the legacy side lacks a verified
 * two-observation same-book trail. Values are never complemented or invented.
 */
export function mergeCanonicalPriceHistoryForDisplay(opts: {
  legacy: Map<string, DisplayLineHistoryRow[]>;
  eventToGameId: ReadonlyMap<string, number>;
  observations: readonly CanonicalPriceObservationRow[];
  blockedSportsbook?: (sportsbook: string) => boolean;
}): Map<string, DisplayLineHistoryRow[]> {
  const out = new Map<string, DisplayLineHistoryRow[]>();
  for (const [key, rows] of opts.legacy) out.set(key, [...rows]);

  const fallbackByKey = new Map<string, DisplayLineHistoryRow[]>();
  for (const observation of opts.observations) {
    if (opts.blockedSportsbook?.(observation.sportsbook) === true) continue;
    const gameId = opts.eventToGameId.get(String(observation.canonical_event_id));
    const marketType = displayMarketType(observation.market_type);
    const side = observationSide(observation);
    if (gameId === undefined || marketType === null || side === null) continue;
    const recordedAt = observation.provider_timestamp ?? observation.fetched_at;
    if (!Number.isFinite(Date.parse(recordedAt))) continue;
    const key = `${gameId}::${marketType}::${side}`;
    const rows = fallbackByKey.get(key) ?? [];
    rows.push({
      game_id: gameId,
      market_type: marketType,
      sportsbook: observation.sportsbook,
      side,
      odds_american: observation.american_price,
      line_value: observation.line,
      recorded_at: recordedAt,
      id: observation.id,
    });
    fallbackByKey.set(key, rows);
  }

  for (const [key, fallbackRows] of fallbackByKey) {
    const legacyRows = out.get(key) ?? [];
    if (hasSameBookTrail(legacyRows)) continue;
    const deduped = new Map<string, DisplayLineHistoryRow>();
    for (const row of [...legacyRows, ...fallbackRows]) {
      const fingerprint = [
        row.sportsbook,
        row.recorded_at,
        row.odds_american ?? "null",
        row.line_value ?? "null",
      ].join("|");
      if (!deduped.has(fingerprint)) deduped.set(fingerprint, row);
    }
    out.set(
      key,
      Array.from(deduped.values()).sort(
        (a, b) => a.recorded_at.localeCompare(b.recorded_at) || a.id - b.id,
      ),
    );
  }

  return out;
}

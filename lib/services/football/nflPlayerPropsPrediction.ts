export type NflPlayerPropsTouchdownForecastRow = {
  gameId: string;
  playerName: string;
  team: string;
  market: string;
  side: "over" | "under" | "yes";
  finalProbability: number;
};

export type NflPlayerPropsOverUnderForecastRow = NflPlayerPropsTouchdownForecastRow & { line: number };

/**
 * Selects a team's highest-probability players until the binary forecast count
 * matches the rounded sum of its distinct-player scoring probabilities.
 */
export function selectNflPlayerPropsTouchdownScorers<T extends NflPlayerPropsTouchdownForecastRow>(
  rows: readonly T[],
): ReadonlySet<string> {
  const playersByTeam = new Map<string, Map<string, T>>();
  for (const row of rows) {
    if (row.market !== "anytime_td" || row.side !== "yes" || !Number.isFinite(row.finalProbability)) continue;
    const teamKey = `${row.gameId}|${row.team}`;
    const playerKey = nflPlayerPropsTouchdownPlayerKey(row);
    const players = playersByTeam.get(teamKey) ?? new Map<string, T>();
    const previous = players.get(playerKey);
    if (!previous || row.finalProbability > previous.finalProbability) players.set(playerKey, row);
    playersByTeam.set(teamKey, players);
  }
  const selected = new Set<string>();
  for (const players of playersByTeam.values()) {
    const ranked = [...players.values()].sort((a, b) => b.finalProbability - a.finalProbability || a.playerName.localeCompare(b.playerName));
    const expectedDistinctScorers = ranked.reduce((sum, row) => sum + clampProbability(row.finalProbability), 0);
    const count = Math.min(ranked.length, Math.max(0, Math.round(expectedDistinctScorers)));
    for (const row of ranked.slice(0, count)) selected.add(nflPlayerPropsTouchdownPlayerKey(row));
  }
  return selected;
}

export function nflPlayerPropsTouchdownPlayerKey(
  row: Pick<NflPlayerPropsTouchdownForecastRow, "gameId" | "playerName">,
): string {
  return `${row.gameId}|${row.playerName.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/**
 * Produces a discriminating Over/Under forecast set without changing any
 * probability, price, grade, or actionability rule. Within each market the
 * expected number of Overs is the sum of the calibrated Over probabilities;
 * the highest-probability outcomes fill that expected count.
 */
export function selectNflPlayerPropsOverForecasts<T extends NflPlayerPropsOverUnderForecastRow>(
  rows: readonly T[],
): ReadonlySet<string> {
  const pairs = new Map<string, T[]>();
  for (const row of rows) {
    if (row.market === "anytime_td" || (row.side !== "over" && row.side !== "under")) continue;
    const key = nflPlayerPropsOverUnderMarketKey(row);
    pairs.set(key, [...(pairs.get(key) ?? []), row]);
  }
  const candidatesByMarket = new Map<string, Array<{ key: string; probability: number }>>();
  for (const [key, marketRows] of pairs) {
    const over = marketRows.find((row) => row.side === "over");
    const under = marketRows.find((row) => row.side === "under");
    const probability = over?.finalProbability ?? (under ? 1 - under.finalProbability : NaN);
    if (!Number.isFinite(probability)) continue;
    const values = candidatesByMarket.get(marketRows[0]!.market) ?? [];
    values.push({ key, probability: clampProbability(probability) });
    candidatesByMarket.set(marketRows[0]!.market, values);
  }
  const selected = new Set<string>();
  for (const candidates of candidatesByMarket.values()) {
    candidates.sort((a, b) => b.probability - a.probability || a.key.localeCompare(b.key));
    const count = Math.min(candidates.length, Math.max(0, Math.round(candidates.reduce((sum, row) => sum + row.probability, 0))));
    for (const candidate of candidates.slice(0, count)) selected.add(candidate.key);
  }
  return selected;
}

export function nflPlayerPropsOverUnderMarketKey(
  row: Pick<NflPlayerPropsOverUnderForecastRow, "gameId" | "playerName" | "market" | "line">,
): string {
  return `${row.gameId}|${row.playerName.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}|${row.market}|${row.line}`;
}

function clampProbability(value: number): number { return Math.max(0, Math.min(1, value)); }

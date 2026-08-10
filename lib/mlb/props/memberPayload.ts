import type {
  PlayerPropPreviewRow,
  PlayerPropsDashboardData,
} from "@/app/mlb/props/components/PlayerPropsDashboard";

export const MLB_PROPS_INITIAL_MEMBER_BOARD_MAX_ROWS = 600;

export function buildMlbPropsMemberBoardData(data: PlayerPropsDashboardData): PlayerPropsDashboardData {
  return { ...data, research: undefined };
}

export function buildMlbPropsInitialMemberBoardData(data: PlayerPropsDashboardData): PlayerPropsDashboardData {
  const bestRows = dedupeBestPrices(selectPrimaryPropLines(data.props));
  const rank = (row: PlayerPropPreviewRow) => {
    const grade = row.playGrade === "BEST_ANGLE" ? 5 : row.playGrade === "LEAN" ? 4 : row.playGrade === "WATCHLIST" ? 3 : 1;
    return grade * 1_000_000 + (row.expectedValue ?? -1) * 10_000 + (row.modelEdge ?? -1) * 1_000 + row.odds / 10_000;
  };
  const ranked = [...bestRows].sort((a, b) => rank(b) - rank(a));
  const groups = groupMarketRows(ranked)
    .map((rows) => ({
      rows,
      rank: Math.max(...rows.map(rank)),
      playerKey: `${rows[0]!.player}|${rows[0]!.team}`,
      market: rows[0]!.market,
      actionable: rows.some((row) => row.playGrade === "BEST_ANGLE" || row.playGrade === "LEAN"),
    }))
    .sort((a, b) => b.rank - a.rank);
  const groupsByMarket = new Map<string, typeof groups>();
  const groupsByPlayer = new Map<string, typeof groups>();
  for (const group of groups) {
    groupsByMarket.set(group.market, [...(groupsByMarket.get(group.market) ?? []), group]);
    groupsByPlayer.set(group.playerKey, [...(groupsByPlayer.get(group.playerKey) ?? []), group]);
  }
  const selected = new Map<string, PlayerPropPreviewRow>();
  const selectedGroups = new Set<string>();
  const selectedPlayers = new Set<string>();
  const selectedMarkets = new Set<string>();
  const addGroup = (group: (typeof groups)[number]): boolean => {
    const key = marketGroupKey(group.rows[0]!);
    if (selectedGroups.has(key)) return true;
    const additions = group.rows.filter((row) => !selected.has(row.id));
    if (selected.size + additions.length > MLB_PROPS_INITIAL_MEMBER_BOARD_MAX_ROWS) return false;
    for (const row of additions) selected.set(row.id, row);
    selectedGroups.add(key);
    selectedPlayers.add(group.playerKey);
    selectedMarkets.add(group.market);
    return true;
  };

  // Never split a posted over/under pair. Selecting individual sides made the
  // compact board claim that the counterpart was "Not offered" even when it
  // existed in the canonical snapshot.
  for (const group of groups) {
    if (group.actionable) addGroup(group);
  }

  // Keep every posted market discoverable. Prefer a complete pair where the
  // provider supplies one, while preserving legitimate milestone offers.
  for (const [market, candidates] of groupsByMarket) {
    if (selectedMarkets.has(market)) continue;
    const preferred = candidates.find((group) => group.rows.length === 2) ?? candidates[0];
    if (preferred) addGroup(preferred);
  }

  // Add one useful starting market per player. Favor paired quotes while
  // reserving the minimum rows required by players still to come, so the
  // pairing fix does not silently shrink player discovery.
  const uncoveredPlayers = [...groupsByPlayer]
    .filter(([playerKey]) => !selectedPlayers.has(playerKey));
  let reservedPlayerRows = uncoveredPlayers.reduce(
    (sum, [, candidates]) => sum + Math.min(...candidates.map((group) => group.rows.length)),
    0,
  );
  for (const [, candidates] of uncoveredPlayers) {
    const minimumSize = Math.min(...candidates.map((group) => group.rows.length));
    reservedPlayerRows -= minimumSize;
    const minimum = candidates.find((group) => group.rows.length === minimumSize);
    const paired = candidates.find((group) => group.rows.length === 2);
    const preferred = paired
      && selected.size + paired.rows.length + reservedPlayerRows <= MLB_PROPS_INITIAL_MEMBER_BOARD_MAX_ROWS
      ? paired
      : minimum;
    if (preferred) addGroup(preferred);
  }

  for (const group of groups) {
    if (selected.size >= MLB_PROPS_INITIAL_MEMBER_BOARD_MAX_ROWS) break;
    addGroup(group);
  }

  return {
    ...data,
    props: [...selected.values()],
    research: undefined,
  };
}

function groupMarketRows(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[][] {
  const groups = new Map<string, PlayerPropPreviewRow[]>();
  for (const row of rows) {
    const key = marketGroupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

function marketGroupKey(row: PlayerPropPreviewRow): string {
  return `${row.player}|${row.team}|${row.opponent}|${row.gameStartTime}|${row.market}|${row.line}`;
}

export type MlbPropsMemberBoardScope = {
  market?: string;
  family?: PlayerPropPreviewRow["marketFamily"];
  gameId?: string;
};

export function buildMlbPropsScopedMemberBoardData(
  data: PlayerPropsDashboardData,
  scope: MlbPropsMemberBoardScope,
): PlayerPropsDashboardData {
  return {
    ...data,
    props: data.props.filter((row) => (
      (!scope.market || row.market === scope.market)
      && (!scope.family || row.marketFamily === scope.family)
      && (!scope.gameId || row.providerIds?.gameId === scope.gameId)
    )),
    research: undefined,
  };
}

function selectPrimaryPropLines(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const groups = new Map<string, Map<number, PlayerPropPreviewRow[]>>();
  for (const row of rows) {
    const key = `${row.player}|${row.team}|${row.opponent}|${row.gameStartTime}|${row.market}`;
    const lines = groups.get(key) ?? new Map<number, PlayerPropPreviewRow[]>();
    lines.set(row.line, [...(lines.get(row.line) ?? []), row]);
    groups.set(key, lines);
  }
  const selected = new Map<string, number>();
  for (const [key, lines] of groups) {
    const ranked = [...lines.entries()].map(([line, lineRows]) => ({
      line,
      sides: new Set(lineRows.map((row) => row.side)).size,
      books: new Set(lineRows.map((row) => row.book)).size,
      balance: lineRows.reduce((sum, row) => sum + Math.abs(impliedProbability(row.odds) - 0.5), 0) / lineRows.length,
    })).sort((a, b) => b.sides - a.sides || b.books - a.books || a.balance - b.balance || a.line - b.line);
    selected.set(key, ranked[0]?.line ?? 0);
  }
  return rows.filter((row) => selected.get(`${row.player}|${row.team}|${row.opponent}|${row.gameStartTime}|${row.market}`) === row.line);
}

function dedupeBestPrices(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const best = new Map<string, PlayerPropPreviewRow>();
  for (const row of rows) {
    const key = `${row.player}|${row.team}|${row.opponent}|${row.market}|${row.side}|${row.line}`;
    const current = best.get(key);
    if (!current || row.odds > current.odds || (row.odds === current.odds && row.lastUpdated > current.lastUpdated)) best.set(key, row);
  }
  return [...best.values()];
}

function impliedProbability(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

export function selectMlbPropsResearchForRows(
  data: PlayerPropsDashboardData,
  rows: PlayerPropPreviewRow[],
): NonNullable<PlayerPropsDashboardData["research"]> {
  return Object.fromEntries(rows.flatMap((row) => {
    if (!row.researchKey) return [];
    const evidence = data.research?.[row.researchKey];
    return evidence ? [[row.researchKey, evidence] as const] : [];
  }));
}

export function mlbPropsPlayerResearchGaps(
  rows: PlayerPropPreviewRow[],
  research: PlayerPropsDashboardData["research"],
): string[] {
  const gaps = new Set<string>();
  const uniqueRows = new Map(rows.map((row) => [row.researchKey ?? row.id, row]));
  for (const row of uniqueRows.values()) {
    if (!row.researchKey) {
      gaps.add(`${row.id}:research_key`);
      continue;
    }
    const evidence = research?.[row.researchKey];
    if (!evidence) {
      gaps.add(`${row.researchKey}:evidence`);
      continue;
    }
    if (!evidence.recentForm?.logs.length) gaps.add(`${row.researchKey}:recent_form`);
    if (!evidence.environment) gaps.add(`${row.researchKey}:environment`);
    if (row.marketFamily === "pitcher") {
      if (!evidence.opponentProfile) gaps.add(`${row.researchKey}:opponent_profile`);
      if (!evidence.pitchArsenal) gaps.add(`${row.researchKey}:pitch_arsenal`);
    } else {
      if (!evidence.pitchMatchup) gaps.add(`${row.researchKey}:pitch_matchup`);
      if (!evidence.matchupHistory) gaps.add(`${row.researchKey}:matchup_history`);
    }
  }
  return [...gaps];
}

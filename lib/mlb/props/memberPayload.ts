import type {
  PlayerPropPreviewRow,
  PlayerPropsDashboardData,
} from "@/app/mlb/props/components/PlayerPropsDashboard";

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
  const selected = new Map<string, PlayerPropPreviewRow>();
  // Keep every actionable row plus one useful starting row per player, then
  // fill a bounded initial board. The complete board hydrates in background.
  for (const row of ranked) {
    if (row.playGrade === "BEST_ANGLE" || row.playGrade === "LEAN") selected.set(row.id, row);
  }
  for (const row of ranked) {
    const playerKey = `${row.player}|${row.team}`;
    if (![...selected.values()].some((item) => `${item.player}|${item.team}` === playerKey)) selected.set(row.id, row);
  }
  for (const row of ranked) {
    if (selected.size >= 600) break;
    selected.set(row.id, row);
  }
  return {
    ...data,
    props: [...selected.values()],
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

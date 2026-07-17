import type {
  PlayerPropPreviewRow,
  PlayerPropsDashboardData,
} from "@/app/mlb/props/components/PlayerPropsDashboard";

export function buildMlbPropsMemberBoardData(data: PlayerPropsDashboardData): PlayerPropsDashboardData {
  return { ...data, research: undefined };
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

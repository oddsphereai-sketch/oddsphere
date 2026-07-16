import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { MlbPropBacktestResult } from "./backtest";
import type { RealPropsDryRunReport } from "./realScoring";

export type MlbPropsLocalReport = {
  date: string;
  providerMode: "mock" | "real";
  marketCounts: Record<string, number>;
  candidates: number;
  rejectedByReasonCode: Record<string, number>;
  recommendedPicks: number;
  averageEv: number;
  averageEdge: number;
  staleOddsCount: number;
  mappingFailures: number;
  modelVersion: string;
  paperTradingEnabled: boolean;
  realPublishEnabled: boolean;
  displayEnabled: boolean;
};

export async function writeMlbPropsLocalReport(args: {
  date: string;
  providerMode: "mock" | "real";
  scored: MlbPropBacktestResult;
  outputDir?: string;
}): Promise<{ path: string; report: MlbPropsLocalReport }> {
  const outputDir = args.outputDir ?? path.join(process.cwd(), "tmp/mlb-props/reports");
  await mkdir(outputDir, { recursive: true });
  const report = buildReport(args);
  const filePath = path.join(outputDir, `${args.date}-${args.providerMode}-props-report.json`);
  await writeFile(filePath, JSON.stringify(report, null, 2));
  return { path: filePath, report };
}

export type MlbPropsRealPaperRunReport = {
  date: string;
  providerMode: "real";
  propsDetected: number;
  supportedPitcherProps: number;
  mappedPitcherProps: number;
  twoWayPitcherMarkets: number;
  candidatesScored: number;
  recommendationsPassingEvEdge: number;
  recommendationsPersisted: number;
  rejectedReasonCounts: Record<string, number>;
  hardRockRows: number;
  hardRockDetected: boolean;
  booksDetected: string[];
  staleOddsCount: number;
  mappingFailures: number;
  featureWarnings: Record<string, number>;
  flags: {
    paperTradingEnabled: boolean;
    realPublishEnabled: boolean;
    displayEnabled: boolean;
  };
  supabaseWritesCount: number;
  runId: number | null;
};

export async function writeMlbPropsRealPaperRunReport(args: {
  date: string;
  summary: RealPropsDryRunReport;
  recommendationsPersisted: number;
  supabaseWritesCount: number;
  runId: number | null;
  outputDir?: string;
}): Promise<{ path: string; report: MlbPropsRealPaperRunReport }> {
  const outputDir = args.outputDir ?? path.join(process.cwd(), "tmp/mlb-props/reports");
  await mkdir(outputDir, { recursive: true });
  const report: MlbPropsRealPaperRunReport = {
    date: args.date,
    providerMode: "real",
    propsDetected: args.summary.propsCount,
    supportedPitcherProps: args.summary.supportedPitcherProps,
    mappedPitcherProps: args.summary.mappedPitcherProps,
    twoWayPitcherMarkets: args.summary.twoWayPitcherMarkets,
    candidatesScored: args.summary.candidatesScored,
    recommendationsPassingEvEdge: args.summary.recommendationsPassingEvEdge,
    recommendationsPersisted: args.recommendationsPersisted,
    rejectedReasonCounts: args.summary.rejectedCountByReasonCode,
    hardRockRows: args.summary.hardRockRows,
    hardRockDetected: args.summary.hardRockDetected,
    booksDetected: args.summary.sportsbooksDetected,
    staleOddsCount: args.summary.staleOddsCount,
    mappingFailures: args.summary.mappingFailures,
    featureWarnings: args.summary.featureAvailabilityWarnings,
    flags: {
      paperTradingEnabled: process.env.ODDSPHERE_PROPS_PAPER_TRADING_ENABLED === "true",
      realPublishEnabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
      displayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
    },
    supabaseWritesCount: args.supabaseWritesCount,
    runId: args.runId,
  };
  const filePath = path.join(outputDir, `${args.date}-real-paper-run.json`);
  await writeFile(filePath, JSON.stringify(report, null, 2));
  return { path: filePath, report };
}

function buildReport(args: {
  date: string;
  providerMode: "mock" | "real";
  scored: MlbPropBacktestResult;
}): MlbPropsLocalReport {
  const marketCounts: Record<string, number> = {};
  const rejectedByReasonCode: Record<string, number> = {};
  for (const row of args.scored.recommendations) {
    marketCounts[row.marketKey] = (marketCounts[row.marketKey] ?? 0) + 1;
    if (row.recommendation.status === "no_play") {
      for (const reason of row.recommendation.reasonCodes) {
        rejectedByReasonCode[reason] = (rejectedByReasonCode[reason] ?? 0) + 1;
      }
    }
  }
  return {
    date: args.date,
    providerMode: args.providerMode,
    marketCounts,
    candidates: args.scored.recommendations.length,
    rejectedByReasonCode,
    recommendedPicks: args.scored.bets,
    averageEv: args.scored.avgEv,
    averageEdge: args.scored.avgEdge,
    staleOddsCount: args.scored.recommendations.filter((row) => row.recommendation.reasonCodes.includes("STALE_ODDS")).length,
    mappingFailures: args.scored.recommendations.filter((row) => row.recommendation.reasonCodes.includes("MAPPING_RISK")).length,
    modelVersion: "mlb_props_phase_2_5",
    paperTradingEnabled: process.env.ODDSPHERE_PROPS_PAPER_TRADING_ENABLED === "true",
    realPublishEnabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
    displayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
  };
}

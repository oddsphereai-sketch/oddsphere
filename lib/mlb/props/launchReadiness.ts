import {
  loadRecentMlbPropsBoardSnapshots,
  type MlbPropsBoardSnapshot,
} from "./boardSnapshotStore";
import {
  readMlbPropsTrackingHealth,
  type MlbPropsTrackingHealth,
} from "./internalTracking";

export type MlbPropsLaunchCheck = {
  code: string;
  ok: boolean;
  critical: boolean;
  message: string;
};

export type MlbPropsLaunchReadiness = {
  slateDate: string;
  evaluatedAt: string;
  readyToOpen: boolean;
  mustClosePublic: boolean;
  publicState: "closed" | "open" | "misconfigured";
  consecutiveSnapshotsRequired: number;
  consecutiveSnapshotsFound: number;
  checks: MlbPropsLaunchCheck[];
  blockers: string[];
  warnings: string[];
  latestSnapshot: {
    id: string;
    asOfTimestamp: string;
    ageMinutes: number;
    sourceRows: number;
    mappedRows: number;
    props: number;
    games: number;
    books: number;
    markets: number;
  } | null;
  tracking: MlbPropsTrackingHealth;
};

export async function loadMlbPropsLaunchReadiness(
  slateDate: string,
  now = new Date(),
): Promise<MlbPropsLaunchReadiness> {
  const required = envPositiveInteger("ODDSPHERE_PROPS_LAUNCH_CONSECUTIVE_SNAPSHOTS", 3);
  const [snapshots, tracking] = await Promise.all([
    loadRecentMlbPropsBoardSnapshots(slateDate, required).catch(() => []),
    readMlbPropsTrackingHealth(),
  ]);
  return evaluateMlbPropsLaunchReadiness({ slateDate, snapshots, tracking, now, env: process.env });
}

export function evaluateMlbPropsLaunchReadiness(args: {
  slateDate: string;
  snapshots: MlbPropsBoardSnapshot[];
  tracking: MlbPropsTrackingHealth;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): MlbPropsLaunchReadiness {
  const env = args.env ?? process.env;
  const now = args.now ?? new Date();
  const required = envPositiveIntegerFrom(env, "ODDSPHERE_PROPS_LAUNCH_CONSECUTIVE_SNAPSHOTS", 3);
  const latest = args.snapshots[0] ?? null;
  const ageMinutes = latest ? (now.getTime() - Date.parse(latest.asOfTimestamp)) / 60_000 : Number.POSITIVE_INFINITY;
  const maxAge = envPositiveIntegerFrom(env, "ODDSPHERE_PROPS_MAX_SNAPSHOT_AGE_MINUTES", 25);
  const recent = args.snapshots.slice(0, required);
  const minimumSequenceSpan = envPositiveIntegerFrom(env, "ODDSPHERE_PROPS_LAUNCH_MIN_SEQUENCE_SPAN_MINUTES", 15);
  const sequenceSpanMinutes = recent.length >= required
    ? (Date.parse(recent[0].asOfTimestamp) - Date.parse(recent[recent.length - 1].asOfTimestamp)) / 60_000
    : 0;
  const display = env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true";
  const api = env.ODDSPHERE_PROPS_PUBLIC_API_ENABLED === "true";
  const publish = env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true";
  const publicFlags = [display, api, publish];
  const publicState = publicFlags.every(Boolean) ? "open" : publicFlags.every((flag) => !flag) ? "closed" : "misconfigured";
  const mappedCoverage = latest && latest.validation.sourceRows > 0
    ? latest.validation.mappedRows / latest.validation.sourceRows
    : 0;
  const research = latest ? summarizeSnapshotResearch(latest) : null;
  const checks: MlbPropsLaunchCheck[] = [
    check("REFRESH_CRON_ENABLED", env.MLB_PLAYER_PROPS_CRON_ENABLED === "true", true, "Live board refresh cron is enabled."),
    check("TRACKING_ENABLED", args.tracking.enabled, true, "Private immutable result tracking is enabled."),
    check("TRACKING_TABLE_AVAILABLE", args.tracking.tableAvailable, true, "Private tracking ledger is available to the service role."),
    check("SETTLEMENT_CRON_ENABLED", args.tracking.settlementEnabled, true, "Official MLB settlement cron is enabled."),
    check("PUBLIC_FLAGS_COHERENT", publicState !== "misconfigured", true, "Display, API, and real-publish flags move together."),
    check("SNAPSHOT_PRESENT", latest !== null, true, "A persisted valid board snapshot exists."),
    check("SNAPSHOT_FRESH", latest !== null && ageMinutes >= 0 && ageMinutes <= maxAge, true, `Latest snapshot is no older than ${maxAge} minutes.`),
    check("CONSECUTIVE_VALID_SNAPSHOTS", recent.length >= required && recent.every(snapshotIsLaunchValid), true, `${required} consecutive persisted snapshots contain live, publishable odds.`),
    check("SNAPSHOT_SEQUENCE_SPAN", recent.length >= required && new Set(recent.map((snapshot) => snapshot.snapshotId)).size === required && sequenceSpanMinutes >= minimumSequenceSpan, true, `The valid snapshot sequence spans at least ${minimumSequenceSpan} minutes of scheduled refreshes.`),
    check("SOURCE_ODDS_PRESENT", Boolean(latest && latest.validation.sourceRows > 0), true, "The provider returned player-prop prices."),
    check("MAPPING_COVERAGE", Boolean(latest && mappedCoverage >= 0.9), true, "At least 90% of source rows map to one MLB game."),
    check("NO_STALE_BOARD_ODDS", Boolean(latest && latest.validation.staleOddsRows === 0), true, "The board contains no stale prices."),
    check("BOARD_ROWS_PRESENT", Boolean(latest && latest.data.props.length > 0), true, "The member board contains mapped prop rows."),
    check("GAMES_PRESENT", Boolean(latest && latest.data.summary.gamesWithProps > 0), true, "At least one game has mapped prop markets."),
    check("BOOKS_PRESENT", Boolean(latest && latest.data.summary.booksCovered > 0), true, "At least one sportsbook is represented."),
    check("MARKETS_PRESENT", Boolean(latest && latest.data.summary.marketsAvailable > 0), true, "At least one prop market is represented."),
    check("PLAYER_IDENTITY_COVERAGE", Boolean(research?.playerIdentitiesComplete), true, "Every displayed player resolves to BDL and official MLB identifiers."),
    check("RECENT_FORM_COVERAGE", Boolean(research?.recentFormComplete), true, "Every displayed prop has at least five completed official MLB game logs."),
    check("MODEL_OUTPUT_COVERAGE", Boolean(research?.modelOutputComplete), true, "Every promoted pitcher market has a model probability."),
    check("MODEL_CONTEXT_INTEGRATED", Boolean(research?.modelContextIntegrated), true, "Promoted model outputs consume every required live context input."),
    check("RESEARCH_INPUTS_COMPLETE", Boolean(research?.researchInputsComplete), true, "Required research modules are complete for every displayed prop."),
    check("DIRECT_MATCHUP_VERIFIED", Boolean(research?.directMatchupComplete), true, "Every hitter prop has official matchup history or an explicit no-history result."),
    check("STARTER_CONTEXT", Boolean(latest?.data.slate?.matchups.some((matchup) => matchup.starterStatus !== "pending")), true, "Probable-pitcher context is present for the slate."),
    check("ENVIRONMENT_CONTEXT", Boolean(research?.environmentComplete), true, "Every displayed prop has park and game-time weather context."),
    check("LINEUP_CONTEXT", Boolean(research?.lineupsComplete), false, "Posted lineups are available for every hitter prop."),
    check("LATEST_SETTLEMENT_HEALTHY", String(args.tracking.latestSettlementRun?.status ?? "none") !== "failed", false, "The latest settlement run did not fail."),
  ];
  const blockers = checks.filter((item) => item.critical && !item.ok).map((item) => item.code);
  const warnings = checks.filter((item) => !item.critical && !item.ok).map((item) => item.code);
  const readyToOpen = blockers.length === 0;
  return {
    slateDate: args.slateDate,
    evaluatedAt: now.toISOString(),
    readyToOpen,
    mustClosePublic: publicState === "open" && !readyToOpen,
    publicState,
    consecutiveSnapshotsRequired: required,
    consecutiveSnapshotsFound: recent.length,
    checks,
    blockers,
    warnings,
    latestSnapshot: latest ? {
      id: latest.snapshotId,
      asOfTimestamp: latest.asOfTimestamp,
      ageMinutes: round(ageMinutes, 2),
      sourceRows: latest.validation.sourceRows,
      mappedRows: latest.validation.mappedRows,
      props: latest.data.props.length,
      games: latest.data.summary.gamesWithProps,
      books: latest.data.summary.booksCovered,
      markets: latest.data.summary.marketsAvailable,
    } : null,
    tracking: args.tracking,
  };
}

function snapshotIsLaunchValid(snapshot: MlbPropsBoardSnapshot): boolean {
  const research = summarizeSnapshotResearch(snapshot);
  return snapshot.validation.publishable &&
    snapshot.validation.errors.length === 0 &&
    snapshot.validation.sourceRows > 0 &&
    snapshot.validation.mappedRows / snapshot.validation.sourceRows >= 0.9 &&
    snapshot.validation.staleOddsRows === 0 &&
    snapshot.data.props.length > 0 &&
    research.playerIdentitiesComplete &&
    research.recentFormComplete &&
    research.modelOutputComplete &&
    research.modelContextIntegrated &&
    research.researchInputsComplete &&
    research.directMatchupComplete &&
    research.environmentComplete;
}

function summarizeSnapshotResearch(snapshot: MlbPropsBoardSnapshot) {
  const rows = snapshot.data.props;
  const evidence = rows.map((row) => {
    const shared = row.researchKey ? snapshot.data.research?.[row.researchKey] : null;
    return {
      row,
      recentForm: row.recentForm ?? shared?.recentForm ?? null,
      matchupHistory: row.matchupHistory ?? shared?.matchupHistory ?? null,
      environment: row.environment ?? shared?.environment ?? null,
    };
  });
  const hitterRows = evidence.filter(({ row }) => row.marketFamily !== "pitcher");
  const promotedPitcherRows = evidence.filter(({ row }) => row.market === "pitcher_strikeouts" || row.market === "pitcher_outs");
  return {
    playerIdentitiesComplete: rows.length > 0 && rows.every((row) => Boolean(
      row.providerIds?.gameId && row.providerIds.bdlGameId && row.providerIds.bdlPlayerId && row.providerIds.mlbStatsPlayerId,
    )),
    recentFormComplete: evidence.length > 0 && evidence.every(({ recentForm }) => (recentForm?.logs.length ?? 0) >= 5),
    modelOutputComplete: promotedPitcherRows.length > 0 && promotedPitcherRows.every(({ row }) => row.finalProbability !== null && row.modelProbability !== null),
    modelContextIntegrated: promotedPitcherRows.length > 0 && promotedPitcherRows.every(({ row }) => (row.modelInputWarnings ?? []).every((warning) => ![
      "bdl_stat_bundle_pending_baseline_used",
      "low_feature_confidence",
      "opponent_k_profile_unavailable_non_blocking",
      "recent_logs_unavailable_non_blocking",
      "weather_unavailable_non_blocking",
      "weak_pitcher_baseline",
    ].includes(warning))),
    researchInputsComplete: rows.length > 0 && rows.every((row) => row.missingFeatures.length === 0),
    directMatchupComplete: hitterRows.every(({ matchupHistory }) => matchupHistory !== null),
    environmentComplete: evidence.length > 0 && evidence.every(({ environment }) => Boolean(
      environment?.park.status === "available" && (environment.weather.status === "available" || environment.roofStatus === "dome"),
    )),
    lineupsComplete: hitterRows.every(({ row }) => row.lineupStatus?.status === "posted" || row.lineupStatus?.status === "confirmed"),
  };
}

function check(code: string, ok: boolean, critical: boolean, message: string): MlbPropsLaunchCheck {
  return { code, ok, critical, message };
}

function envPositiveInteger(name: string, fallback: number): number {
  return envPositiveIntegerFrom(process.env, name, fallback);
}

function envPositiveIntegerFrom(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = Number(env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

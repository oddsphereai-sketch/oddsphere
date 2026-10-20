import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CfbForwardEvidencePayload } from "./cfbForwardEvidence";
import { readCfbForwardWriterEvidence } from "./cfbForwardEvidenceStore";
import { runCfbForwardEvidenceWriter } from "./cfbForwardEvidenceWriter";
import { selectLatestCfbMemberEvidenceRows } from "./cfbMemberFixture";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "./cfbWeeklyWindow";
import { fetchCfbTheOddsApiFallback } from "./cfbTheOddsApiFallback";

export const CFB_MIDWEEK_RECOVERY_AUDIT_RELEASE =
  "cfb_midweek_recovery_audit_2026_10_20_r2_durable_sanitized_result" as const;
export const CFB_MIDWEEK_RECOVERY_AUDIT_SNAPSHOT_KEY =
  "cfb::operator-audit::2026-10-20-midweek-recovery" as const;

type Market = "moneyline" | "spread" | "total";
const MARKETS: readonly Market[] = ["moneyline", "spread", "total"];

export async function runCfbMidweekRecoveryAudit(args: {
  client: SupabaseClient;
  season: number;
  now: string;
  runId?: string;
  balldontlieApiKey: string;
  playbookApiKey: string;
  sharpApiKey: string;
  collegeFootballDataApiKey?: string | null;
  theOddsApiKey: string;
}): Promise<Record<string, unknown>> {
  const all = (await readCfbForwardWriterEvidence({ client: args.client, season: args.season, now: args.now })).evidence;
  const window = resolveCfbForwardWindow({ now: args.now, evidence: all, advanceWithoutNextEvidence: true });
  const before = selectLatestCfbMemberEvidenceRows(
    all.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)),
    args.now,
  ).map((row) => row.payload);
  let after: readonly CfbForwardEvidencePayload[] = [];
  const writerResult = await runCfbForwardEvidenceWriter({
    client: args.client,
    season: args.season,
    runId: args.runId ?? `audit-${randomUUID()}`,
    now: args.now,
    apply: false,
    balldontlieApiKey: args.balldontlieApiKey,
    playbookApiKey: args.playbookApiKey,
    sharpApiKey: args.sharpApiKey,
    collegeFootballDataApiKey: args.collegeFootballDataApiKey ?? null,
    theOddsApiKey: args.theOddsApiKey,
    weatherProvider: null,
    auditForceUnlocked: true,
    auditForceTheOddsApi: true,
    auditUseMidweekRecoveryCandidate: true,
    auditIgnoreTheOddsApiCreditReserve: true,
    auditPayloads: (payloads) => { after = payloads; },
  });
  const beforeByGame = new Map(before.map((payload) => [payload.game.providerGameId, payload]));
  const changes = after.flatMap((payload) => {
    const prior = beforeByGame.get(payload.game.providerGameId);
    if (!prior) return [];
    return MARKETS.flatMap((market) => {
      const oldOutlook = prior.decisions.marketOutlooks?.[market] ?? null;
      const nextOutlook = payload.decisions.marketOutlooks?.[market] ?? null;
      const oldGrade = prior.decisions.evaluatedBets.find((row) => row.market === market)?.grade ?? "Held";
      const nextGrade = payload.decisions.evaluatedBets.find((row) => row.market === market)?.grade ?? "Held";
      if (oldOutlook?.side === nextOutlook?.side && oldOutlook?.line === nextOutlook?.line && oldGrade === nextGrade) return [];
      return [{
        matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
        market,
        before: { side: oldOutlook?.side ?? null, line: oldOutlook?.line ?? null, grade: oldGrade },
        after: { side: nextOutlook?.side ?? null, line: nextOutlook?.line ?? null, grade: nextGrade },
      }];
    });
  });
  const actionable = (grade: string) => grade === "Best Angle" || grade === "Lean";
  const audit = {
    release: CFB_MIDWEEK_RECOVERY_AUDIT_RELEASE,
    mode: "live_provider_select_only_zero_prediction_writes",
    apiCallsMaximum: writerResult.apiCallsMaximum,
    now: args.now,
    window: { start: window.boardStartDate, end: window.boardEndDate },
    writer: {
      release: writerResult.writerRelease,
      collectionReason: writerResult.collectionReason,
      proposed: writerResult.proposed,
      games: writerResult.games,
      providerErrors: writerResult.providerErrors,
      healthHolds: writerResult.healthHolds,
      publicationAttempted: writerResult.publicationAttempted,
      trackingAttempted: writerResult.trackingAttempted,
    },
    before: summarize(before),
    candidate: summarize(after),
    changes,
    changesCount: changes.length,
    promotions: changes.filter((change) => !actionable(change.before.grade) && actionable(change.after.grade)).length,
    demotions: changes.filter((change) => actionable(change.before.grade) && !actionable(change.after.grade)).length,
  };
  const nowMs = Date.parse(args.now);
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: CFB_MIDWEEK_RECOVERY_AUDIT_SNAPSHOT_KEY,
    kind: "daily_edge",
    sport: "cfb",
    slate_date: window.boardStartDate,
    payload: audit,
    payload_version: CFB_MIDWEEK_RECOVERY_AUDIT_RELEASE,
    source: "cfb_midweek_recovery_operator_audit",
    generated_at: args.now,
    expires_at: new Date(nowMs + 24 * 60 * 60_000).toISOString(),
    stale_until: new Date(nowMs + 7 * 24 * 60 * 60_000).toISOString(),
    updated_at: args.now,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`CFB midweek recovery audit result persistence failed: ${error.message}`);
  return audit;
}

function summarize(payloads: readonly CfbForwardEvidencePayload[]): Record<string, unknown> {
  const scopes = ["all", "fbs_involved", "fcs_only"] as const;
  return Object.fromEntries(scopes.map((scope) => {
    const rows = payloads.filter((payload) => scope === "all" || (scope === "fbs_involved"
      ? payload.game.away.fbs || payload.game.home.fbs
      : !payload.game.away.fbs && !payload.game.home.fbs));
    return [scope, {
      games: rows.length,
      pairedPriceMarkets: Object.fromEntries(MARKETS.map((market) => [market, rows.filter((payload) => payload.market.currentBooks.some((book) => book[market] !== null)).length])),
      lineSpecificPredictions: Object.fromEntries(MARKETS.map((market) => [market, rows.filter((payload) => {
        const outlook = payload.decisions.marketOutlooks?.[market] ?? null;
        return outlook !== null && (market === "moneyline" || outlook.line !== null);
      }).length])),
      grades: gradeCounts(rows),
      conferenceReports: rows.filter((payload) => payload.availability.report?.source === "Conference").length,
      unavailableReports: rows.filter((payload) => payload.availability.report === null).length,
    }];
  }));
}

function gradeCounts(payloads: readonly CfbForwardEvidencePayload[]): Record<string, number> {
  const counts: Record<string, number> = { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0, Held: 0 };
  for (const payload of payloads) {
    for (const decision of payload.decisions.evaluatedBets) counts[decision.grade] = (counts[decision.grade] ?? 0) + 1;
    counts.Held += payload.decisions.heldMarkets.length;
  }
  return counts;
}

export async function runCfbFcsProviderDiagnostic(args: {
  client: SupabaseClient;
  season: number;
  now: string;
  theOddsApiKey: string;
}): Promise<Record<string, unknown>> {
  const all = (await readCfbForwardWriterEvidence({ client: args.client, season: args.season, now: args.now })).evidence;
  const window = resolveCfbForwardWindow({ now: args.now, evidence: all, advanceWithoutNextEvidence: true });
  const current = selectLatestCfbMemberEvidenceRows(
    all.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)),
    args.now,
  ).map((row) => row.payload);
  const games = current
    .filter((payload) => !payload.game.away.fbs && !payload.game.home.fbs)
    .map((payload) => payload.game);
  const result = await fetchCfbTheOddsApiFallback({ games, capturedAt: args.now, apiKey: args.theOddsApiKey });
  const matchupById = new Map(games.map((game) => [game.providerGameId, `${game.away.abbreviation}@${game.home.abbreviation}`]));
  return {
    mode: "authenticated_fcs_provider_identity_diagnostic",
    now: args.now,
    window: { start: window.boardStartDate, end: window.boardEndDate },
    requestedGames: games.length,
    providerEvents: result.providerEvents,
    providerEventCount: result.providerEvents.length,
    matchedGames: result.matchedGames,
    matchedMatchups: Object.keys(result.booksByGame).map((gameId) => matchupById.get(gameId) ?? gameId),
    failures: Object.fromEntries(Object.entries(result.failuresByGame).map(([gameId, reason]) => [matchupById.get(gameId) ?? gameId, reason])),
    creditsUsed: result.creditsUsed,
    creditsRemaining: result.creditsRemaining,
  };
}

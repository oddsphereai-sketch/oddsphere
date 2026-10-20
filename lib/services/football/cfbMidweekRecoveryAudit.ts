import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CfbForwardEvidencePayload } from "./cfbForwardEvidence";
import { readCfbForwardWriterEvidence } from "./cfbForwardEvidenceStore";
import { runCfbForwardEvidenceWriter } from "./cfbForwardEvidenceWriter";
import { selectLatestCfbMemberEvidenceRows } from "./cfbMemberFixture";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "./cfbWeeklyWindow";

export const CFB_MIDWEEK_RECOVERY_AUDIT_RELEASE =
  "cfb_midweek_recovery_audit_2026_10_20_r1_zero_write" as const;

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
  return {
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

#!/usr/bin/env tsx

/** Live-provider, SELECT-only replay of the CFB FCS price and official-injury continuity candidate. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { CfbForwardEvidencePayload } from "../../lib/services/football/cfbForwardEvidence";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { runCfbForwardEvidenceWriter } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { selectLatestCfbMemberEvidenceRows } from "../../lib/services/football/cfbMemberFixture";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
  const playbookApiKey = process.env.PLAYBOOK_API_KEY;
  const sharpApiKey = process.env.SHARPAPI_KEY;
  if (!url || !serviceKey || !balldontlieApiKey || !playbookApiKey || !sharpApiKey) {
    throw new Error("CFB candidate audit requires configured Supabase and provider credentials.");
  }
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const all = (await readCfbForwardWriterEvidence({ client, season: Number(now.slice(0, 4)) })).evidence;
  const window = resolveCfbForwardWindow({ now, evidence: all, advanceWithoutNextEvidence: true });
  const before = selectLatestCfbMemberEvidenceRows(
    all.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)),
    now,
  );
  let after: readonly CfbForwardEvidencePayload[] = [];
  const result = await runCfbForwardEvidenceWriter({
    client,
    season: Number(now.slice(0, 4)),
    runId: `audit-${randomUUID()}`,
    now,
    apply: false,
    balldontlieApiKey,
    playbookApiKey,
    sharpApiKey,
    collegeFootballDataApiKey: process.env.CFBD_API_KEY ?? null,
    weatherProvider: null,
    auditPayloads: (payloads) => { after = payloads; },
  });
  const beforePayloads = before.map((row) => row.payload);
  const beforeByGame = new Map(beforePayloads.map((payload) => [payload.game.providerGameId, payload]));
  const changes = after.flatMap((payload) => {
    const prior = beforeByGame.get(payload.game.providerGameId);
    if (!prior) return [];
    return (["moneyline", "spread", "total"] as const).flatMap((market) => {
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
  const compact = process.argv.includes("--compact");
  console.log(JSON.stringify({
    release: "cfb_fcs_price_official_injury_candidate_2026_10_07_r1",
    mode: "live_provider_select_only_zero_writes",
    now,
    window: { start: window.boardStartDate, end: window.boardEndDate },
    writerResult: result,
    before: summarize(beforePayloads),
    after: summarize(after),
    changedOutlooksOrGrades: compact
      ? changes.filter((change) => change.before.grade !== "Held" || change.after.grade !== "Held")
      : changes,
    changedOutlooksOrGradesCount: changes.length,
  }, null, 2));
}

function summarize(payloads: readonly CfbForwardEvidencePayload[]) {
  const markets = ["moneyline", "spread", "total"] as const;
  const scopes = ["all", "fbs_involved", "fcs_only"] as const;
  return Object.fromEntries(scopes.map((scope) => {
    const rows = payloads.filter((payload) => scope === "all" || (scope === "fbs_involved"
      ? payload.game.away.fbs || payload.game.home.fbs
      : !payload.game.away.fbs && !payload.game.home.fbs));
    return [scope, {
      games: rows.length,
      pairedPriceMarkets: Object.fromEntries(markets.map((market) => [market, rows.filter((payload) => payload.market.currentBooks.some((book) => book[market] !== null)).length])),
      lineSpecificPredictions: Object.fromEntries(markets.map((market) => [market, rows.filter((payload) => {
        const outlook = payload.decisions.marketOutlooks?.[market] ?? null;
        return outlook !== null && (market === "moneyline" || outlook.line !== null);
      }).length])),
      evaluatedMarkets: rows.reduce((sum, payload) => sum + payload.decisions.evaluatedBets.length, 0),
      heldMarkets: rows.reduce((sum, payload) => sum + payload.decisions.heldMarkets.length, 0),
      grades: gradeCounts(rows),
      sharpExchangeContextGames: rows.filter((payload) => (payload.market.displayBooks ?? []).some((book) =>
        book.provider === "sharpapi" && ["novig", "sxbet"].includes(book.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, ""))
      )).length,
      conferenceReports: rows.filter((payload) => payload.availability.report?.source === "Conference").length,
      playbookReports: rows.filter((payload) => payload.availability.report?.source === "Playbook").length,
      operationalOpening: rows.filter((payload) => payload.market.operationalOpening !== null).length,
      firstObservedOpening: rows.filter((payload) => payload.market.operationalOpening?.provenance === "first_observed").length,
    }];
  }));
}

function gradeCounts(payloads: readonly CfbForwardEvidencePayload[]): Record<string, number> {
  const counts: Record<string, number> = { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0 };
  for (const payload of payloads) for (const decision of payload.decisions.evaluatedBets) counts[decision.grade] = (counts[decision.grade] ?? 0) + 1;
  return counts;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

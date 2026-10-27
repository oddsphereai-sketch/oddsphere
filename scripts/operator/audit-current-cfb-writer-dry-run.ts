#!/usr/bin/env tsx

/** Live-provider, zero-write replay of the sole CFB writer. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { runCfbForwardEvidenceWriter } from "../../lib/services/football/cfbForwardEvidenceWriter";
import type { CfbForwardEvidencePayload } from "../../lib/services/football/cfbForwardEvidence";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
  const playbookApiKey = process.env.PLAYBOOK_API_KEY;
  const sharpApiKey = process.env.SHARPAPI_KEY;
  if (!url || !serviceKey || !balldontlieApiKey || !playbookApiKey || !sharpApiKey) {
    throw new Error("CFB dry replay requires the configured Supabase and provider credentials.");
  }
  const focusMatchups = new Set(process.argv
    .filter((value) => value.startsWith("--matchup="))
    .map((value) => value.slice(10).toUpperCase()));
  let focusedPayloads: readonly CfbForwardEvidencePayload[] = [];
  const result = await runCfbForwardEvidenceWriter({
    client: createClient(url, serviceKey, { auth: { persistSession: false } }),
    season: 2026,
    runId: `audit-${randomUUID()}`,
    now: new Date().toISOString(),
    apply: false,
    balldontlieApiKey,
    playbookApiKey,
    sharpApiKey,
    collegeFootballDataApiKey: process.env.CFBD_API_KEY ?? null,
    theOddsApiKey: process.env.THE_ODDS_API_KEY ?? null,
    sportsDataIoApiKey: process.env.SPORTSDATAIO_CFB_API_KEY ?? null,
    weatherProvider: null,
    auditPayloads: (payloads) => {
      focusedPayloads = focusMatchups.size > 0
        ? payloads.filter((payload) => focusMatchups.has(`${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`.toUpperCase()))
        : [];
    },
    auditForceUnlocked: process.argv.includes("--force-unlocked"),
    auditDisableNearTiePmfCoherence: process.argv.includes("--disable-near-tie-pmf-coherence"),
  });
  console.log(JSON.stringify({
    audit: "cfb_writer_live_provider_dry_run_2026_09_26_r1",
    apply: false,
    writes: 0,
    result,
    focus: focusedPayloads.map((payload) => ({
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      stage: payload.stage,
      capturedAt: payload.capturedAt,
      expectedScore: {
        away: payload.decisions.forecast.expectedAwayPoints,
        home: payload.decisions.forecast.expectedHomePoints,
      },
      availability: {
        injuryStatus: payload.availability.injuryStatus,
        reportSource: payload.availability.report?.source ?? null,
        reportUpdatedAt: payload.availability.report?.reportUpdatedAt ?? null,
        unavailablePlayers: payload.availability.report?.teams.reduce((sum, team) => sum + team.players.filter((player) => player.status === "Out" || player.status === "Unavailable").length, 0) ?? 0,
      },
      currentBooks: payload.market.currentBooks.map((book) => ({
        sportsbook: book.sportsbook,
        provider: book.provider,
        moneyline: book.moneyline,
        spread: book.spread,
        total: book.total,
      })),
      sharpApiSplits: (payload.market.sharpApiSplits ?? []).map((split) => ({
        sportsbook: split.sportsbook,
        sourceSemantics: split.sourceSemantics,
        capturedAt: split.capturedAt,
        hasMoneyline: split.moneyline !== null,
        hasSpread: split.spread !== null,
        hasTotal: split.total !== null,
        moneyline: split.moneyline,
        spread: split.spread,
        total: split.total,
      })),
      hasPlaybookSplits: payload.market.playbookSplits !== null,
      evaluated: payload.decisions.evaluatedBets.map((decision) => ({
        market: decision.market,
        side: decision.side,
        line: decision.evaluatedQuote.line,
        price: decision.evaluatedQuote.price,
        sportsbook: decision.evaluatedQuote.sportsbook,
        probability: decision.forecastProbability,
        grade: decision.grade,
      })),
      held: payload.decisions.heldMarkets,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

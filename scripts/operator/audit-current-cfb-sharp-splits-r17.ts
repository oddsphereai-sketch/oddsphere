#!/usr/bin/env tsx

/**
 * Bounded, read-only SharpAPI NCAAF split coverage audit for the active CFB
 * Daily Edge window. One SharpAPI request, one SELECT-only evidence read, and
 * no provider payload persistence or production mutation.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import { __TEST__ as cfbSharpIdentity } from "../../lib/services/football/cfbSharpApiOdds";

type Json = Record<string, unknown>;

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sharpKey = process.env.SHARPAPI_KEY;
  if (!supabaseUrl || !serviceKey || !sharpKey) throw new Error("Supabase read credentials and SHARPAPI_KEY are required.");

  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const rows = await readCfbForwardEvidence({
    client: createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }),
    season: 2026,
  });
  const window = activeCfbWeeklyWindow(now);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)) continue;
    const prior = latest.get(row.providerGameId);
    if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row);
  }

  const sharp = new SharpApiClient(sharpKey);
  const response = await sharp.fetch<unknown[]>({ path: "/splits", query: { league: "ncaaf", limit: 200 } });
  if (!Array.isArray(response.data)) throw new Error("SharpAPI NCAAF splits returned malformed data.");
  const splitRows = response.data.map(record);

  const games = [...latest.values()]
    .sort((first, second) => first.gameStartAt.localeCompare(second.gameStartAt))
    .map((row) => {
      const game = row.payload.game;
      const matches = splitRows.filter((split) => strictSplitIdentity({
        split,
        scheduledStart: game.scheduledStart,
        awayName: game.away.name,
        awayAbbreviation: game.away.abbreviation,
        homeName: game.home.name,
        homeAbbreviation: game.home.abbreviation,
      }));
      if (matches.length > 1) {
        throw new Error(`Ambiguous SharpAPI NCAAF split identity for ${game.away.abbreviation}@${game.home.abbreviation}.`);
      }
      const match = matches[0] ?? null;
      return {
        providerGameId: game.providerGameId,
        matchup: `${game.away.abbreviation}@${game.home.abbreviation}`,
        scheduledStart: game.scheduledStart,
        matched: match !== null,
        eventId: text(match?.event_id),
        sportsbook: text(match?.sportsbook),
        fetchedAt: iso(match?.fetched_at),
        markets: {
          moneyline: splitMarket(match, "moneyline", ["away", "home"]),
          spread: splitMarket(match, "spread", ["away", "home"]),
          total: splitMarket(match, "total", ["over", "under"]),
        },
      };
    });

  console.log(JSON.stringify({
    release: "cfb_current_sharpapi_split_coverage_2026_08_28_r17",
    mode: "read_only",
    providerRequests: 1,
    databaseWrites: 0,
    evidenceRowsRead: rows.length,
    currentGames: games.length,
    rawSplitRows: splitRows.length,
    matchedGames: games.filter((game) => game.matched).length,
    completeMoneylineGames: games.filter((game) => game.markets.moneyline.complete).length,
    completeSpreadGames: games.filter((game) => game.markets.spread.complete).length,
    completeTotalGames: games.filter((game) => game.markets.total.complete).length,
    pagination: response.pagination ?? null,
    quota: sharp.getQuotaState(),
    games,
  }, null, 2));
}

function strictSplitIdentity(args: {
  split: Json;
  scheduledStart: string;
  awayName: string;
  awayAbbreviation: string;
  homeName: string;
  homeAbbreviation: string;
}): boolean {
  if (text(args.split.league)?.toLowerCase() !== "ncaaf") return false;
  const eventId = text(args.split.event_id);
  const eventDate = eventId?.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  const acceptedDates = new Set([
    args.scheduledStart.slice(0, 10),
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(args.scheduledStart)),
  ]);
  return eventDate !== null && acceptedDates.has(eventDate) &&
    cfbSharpIdentity.teamMatches(args.split.away_team, args.awayName, args.awayAbbreviation) &&
    cfbSharpIdentity.teamMatches(args.split.home_team, args.homeName, args.homeAbbreviation);
}

function splitMarket(row: Json | null, market: "moneyline" | "spread" | "total", sides: [string, string]) {
  const slot = record(row?.[market]);
  const bets = record(slot.bets_pct);
  const handle = record(slot.handle_pct);
  const firstBets = percentage(bets[sides[0]]);
  const secondBets = percentage(bets[sides[1]]);
  const firstHandle = percentage(handle[sides[0]]);
  const secondHandle = percentage(handle[sides[1]]);
  const complete = complementary(firstBets, secondBets) && complementary(firstHandle, secondHandle);
  return {
    complete,
    line: market === "total" ? finite(slot.line) : null,
    betsPct: complete ? { [sides[0]]: firstBets, [sides[1]]: secondBets } : null,
    moneyPct: complete ? { [sides[0]]: firstHandle, [sides[1]]: secondHandle } : null,
  };
}

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percentage(value: unknown): number | null {
  const parsed = finite(value);
  if (parsed === null) return null;
  return parsed <= 1 ? 100 * parsed : parsed;
}

function complementary(first: number | null, second: number | null): boolean {
  return first !== null && second !== null && Math.abs(first + second - 100) <= 1;
}

function iso(value: unknown): string | null {
  const parsed = text(value);
  return parsed && Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

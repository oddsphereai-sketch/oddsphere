#!/usr/bin/env tsx

/** SELECT-only inventory of retained NFL player-props book and movement evidence. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

const MARKET_NAMES: Record<string, string> = {
  td: "anytime_td",
  pa: "passing_attempts",
  pc: "passing_completions",
  py: "passing_yards",
  ry: "receiving_yards",
  rc: "receptions",
  ra: "rushing_attempts",
  ru: "rushing_yards",
};

async function main(): Promise<void> {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const season = numberArgument("season", 2026);
  const week = numberArgument("week", 5);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const record = await readNflPlayerPropsSnapshotRecord({ client, season, week });
  if (!record) throw new Error(`NFL props snapshot is unavailable for ${season} Week ${week}.`);
  const capture = record.snapshot.board.marketEvidence;
  if (!capture) throw new Error("NFL props market-evidence capture is unavailable.");

  const decisionLines = new Map(record.snapshot.board.decisions
    .filter((decision) => decision.marketEvidenceId)
    .map((decision) => [decision.marketEvidenceId!, decision.line]));
  const identities = capture.i.map((identity) => ({
    id: identity[0],
    market: MARKET_NAMES[identity[1]] ?? identity[1],
    books: identity[2],
    currentLine: decisionLines.get(identity[0]) ?? null,
  }));
  const books = identities.flatMap((identity) => identity.books.map((book) => ({
    market: identity.market,
    book: book[0],
    provider: book[1],
    sourceClass: book[2],
    hasOpening: book[6] !== null,
    hasOpeningLine: book[7] !== null,
    hasOpeningPrice: book[11] !== null || book[12] !== null || book[13] !== null,
    lineMoved: identity.currentLine !== null && book[7] !== null && identity.currentLine !== book[7],
    priceMoved: priceChanged(book[8], book[11]) || priceChanged(book[9], book[12])
      || priceChanged(book[10], book[13]),
  })));
  const markets = [...new Set(identities.map((identity) => identity.market))].sort();
  const report = {
    auditRelease: "nfl_player_props_current_market_sources_2026_10_08_r1",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    season,
    week,
    generatedAt: record.generatedAt,
    snapshotRelease: record.snapshot.release,
    capture: {
      release: capture.r,
      identitiesAvailable: capture.n,
      identitiesRetained: capture.k,
      identitiesOmitted: capture.o,
    },
    overall: summarize(identities.length, books),
    byMarket: Object.fromEntries(markets.map((market) => [market, summarize(
      identities.filter((identity) => identity.market === market).length,
      books.filter((book) => book.market === market),
    )])),
    byBook: Object.fromEntries([...new Set(books.map((book) => book.book))].sort().map((book) => [book, {
      observations: books.filter((row) => row.book === book).length,
      markets: [...new Set(books.filter((row) => row.book === book).map((row) => row.market))].sort(),
      sourceClass: books.find((row) => row.book === book)?.sourceClass ?? null,
      provider: books.find((row) => row.book === book)?.provider ?? null,
    }])),
  };
  console.log(JSON.stringify(report, null, 2));
}

function summarize(identities: number, rows: Array<{
  book: string;
  sourceClass: string;
  hasOpening: boolean;
  hasOpeningLine: boolean;
  hasOpeningPrice: boolean;
  lineMoved: boolean;
  priceMoved: boolean;
}>): Record<string, unknown> {
  const sharp = rows.filter((row) => row.sourceClass === "s");
  return {
    identities,
    retainedBookObservations: rows.length,
    distinctBooks: [...new Set(rows.map((row) => row.book))].sort(),
    sharpBookObservations: sharp.length,
    sharpBooks: [...new Set(sharp.map((row) => row.book))].sort(),
    observationsWithOpening: rows.filter((row) => row.hasOpening).length,
    observationsWithOpeningLine: rows.filter((row) => row.hasOpeningLine).length,
    observationsWithOpeningPrice: rows.filter((row) => row.hasOpeningPrice).length,
    observedLineChanges: rows.filter((row) => row.lineMoved).length,
    observedPriceChanges: rows.filter((row) => row.priceMoved).length,
  };
}

function priceChanged(current: number | null, opening: number | null): boolean {
  return current !== null && opening !== null && current !== opening;
}

function numberArgument(name: string, fallback: number): number {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`);
  return parsed;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

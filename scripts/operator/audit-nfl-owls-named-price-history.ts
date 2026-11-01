#!/usr/bin/env tsx

/** SELECT-only coverage and pairing audit of the existing Owl's named-price tape. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflOwlsNamedPriceHistory } from "../../lib/services/football/nflOwlsNamedPriceHistory";

loadEnvConfig(process.cwd());

async function main() {
  const gameIds = process.argv.slice(2).filter((value) => value.startsWith("--game-id="))
    .map((value) => value.slice("--game-id=".length)).filter(Boolean);
  if (gameIds.length === 0) throw new Error("Pass at least one --game-id=<canonical NFL game ID>.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const evaluatedAt = new Date().toISOString();
  const tape = await readNflOwlsNamedPriceHistory({
    client: createClient(url, key, { auth: { persistSession: false } }), gameIds, evaluatedAt,
  });
  console.log(JSON.stringify({
    readOnly: true, writes: 0, evaluatedAt, release: tape.release, queries: tape.queries,
    rows: tape.rows, rejectedPairs: tape.rejectedPairs,
    games: Object.fromEntries(gameIds.map((gameId) => [gameId, {
      chronologicalReceipts: tape.historyByGame[gameId]?.length ?? 0,
      earliest: (tape.earliestByGame[gameId] ?? []).map((book) => ({
        sportsbook: book.sportsbook, source: book.provider, sourceAt: book.observedAt,
        markets: [book.moneyline && "moneyline", book.spread && "spread", book.total && "total"].filter(Boolean),
      })),
      latest: (tape.latestByGame[gameId] ?? []).map((book) => ({
        sportsbook: book.sportsbook, source: book.provider, sourceAt: book.observedAt,
        markets: [book.moneyline && "moneyline", book.spread && "spread", book.total && "total"].filter(Boolean),
      })),
    }])),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

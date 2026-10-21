#!/usr/bin/env tsx

import { supabase } from "../../lib/db/supabase";
import {
  readNflPlayerPropsMarketObserverHistory,
  type NflPlayerPropsMarketObserverRow,
} from "../../lib/services/football/nflPlayerPropsMarketObserverStore";
import {
  nflPlayerPropsObserverClosingQuotes,
  updateNflPlayerPropsClosingPricesFromObserver,
} from "../../lib/services/football/nflPlayerPropsTrackingStore";

type MissingRecord = {
  id: number;
  tracking_key: string;
  decision_release: string;
  sportsbook: string;
  result: string;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const seasonArg = process.argv.find((value) => value.startsWith("--season="));
  const throughWeekArg = process.argv.find((value) => value.startsWith("--through-week="));
  const season = Number(seasonArg?.slice(9) ?? "2026");
  const throughWeek = Number(throughWeekArg?.slice(15) ?? "18");
  if (!Number.isInteger(season) || !Number.isInteger(throughWeek) || throughWeek < 1 || throughWeek > 25) {
    throw new Error("Valid --season and --through-week values are required.");
  }

  const histories = await Promise.all(Array.from({ length: throughWeek }, async (_, index) => {
    const week = index + 1;
    const history = await readNflPlayerPropsMarketObserverHistory({ client: supabase, season, week }).catch(() => null);
    return { week, history };
  }));
  const rows = histories.flatMap(({ history }) => [...(history?.rows ?? [])]);
  const quotes = nflPlayerPropsObserverClosingQuotes(rows);
  const { data, error } = await supabase.from("nfl_player_prop_records")
    .select("id,tracking_key,decision_release,sportsbook,result")
    .is("closing_price", null)
    .limit(5_000);
  if (error) throw new Error(`NFL player props missing-close read failed: ${error.message}`);
  const missing = (data ?? []) as MissingRecord[];
  const quoteIdentities = new Set(quotes.map((quote) => [
    quote.trackingKey,
    quote.decisionRelease,
    normalize(quote.sportsbook),
  ].join("|")));
  const recoverable = missing.filter((record) => quoteIdentities.has([
    record.tracking_key,
    record.decision_release,
    normalize(record.sportsbook),
  ].join("|")));
  let updated = 0;
  if (apply) updated = await updateNflPlayerPropsClosingPricesFromObserver({ client: supabase, rows: rows as NflPlayerPropsMarketObserverRow[] });

  console.log(JSON.stringify({
    release: "nfl_player_props_close_recovery_audit_2026_10_21_r1",
    readOnly: !apply,
    season,
    throughWeek,
    historyWeeks: histories.filter(({ history }) => history !== null).map(({ week }) => week),
    observerRows: rows.length,
    exactT60Quotes: quotes.length,
    missingClosingRecords: missing.length,
    recoverableFromExactT60: recoverable.length,
    unrecoverableWithoutFabrication: missing.length - recoverable.length,
    recoverableByResult: Object.fromEntries([...new Set(recoverable.map((record) => record.result))].sort().map((result) => [
      result,
      recoverable.filter((record) => record.result === result).length,
    ])),
    updated,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

/** Read-only NBA player-props directional-mix audit. No provider or database writes. */
import { readFile } from "node:fs/promises";

import { supabase } from "../../../lib/db/supabase";
import { nbaPlayerPropsSlateDate } from "../../../lib/services/nba/nbaPlayerPropsLifecycle";
import { readNbaPlayerPropsPrivateSnapshot } from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";

type Side = "over" | "under";
type AuditRow = Readonly<{
  market: string;
  grade: string;
  line: number;
  independentProjection: number;
  side: Side;
  marketEvidenceMode: string;
}>;
type HistoricalRow = Readonly<{
  market: string;
  grade: string;
  finalSide: Side;
  outcomeSide: Side;
}>;

function optionalValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : null;
}

function actionable(grade: string): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function independentSide(row: AuditRow): Side {
  return row.independentProjection >= row.line ? "over" : "under";
}

function countSides(rows: readonly AuditRow[], side: (row: AuditRow) => Side) {
  const over = rows.filter((row) => side(row) === "over").length;
  const under = rows.length - over;
  return { records: rows.length, over, under, overShare: rows.length ? over / rows.length : null, underShare: rows.length ? under / rows.length : null };
}

function currentSummary(rows: readonly AuditRow[]) {
  const actionables = rows.filter((row) => actionable(row.grade));
  const flipped = rows.filter((row) => independentSide(row) !== row.side);
  const markets = [...new Set(rows.map((row) => row.market))].sort();
  return {
    all: {
      final: countSides(rows, (row) => row.side),
      independent: countSides(rows, independentSide),
      finalSideFlips: flipped.length,
      overToUnder: flipped.filter((row) => independentSide(row) === "over" && row.side === "under").length,
      underToOver: flipped.filter((row) => independentSide(row) === "under" && row.side === "over").length,
    },
    actionable: {
      final: countSides(actionables, (row) => row.side),
      independent: countSides(actionables, independentSide),
      finalSideFlips: actionables.filter((row) => independentSide(row) !== row.side).length,
    },
    byMarket: Object.fromEntries(markets.map((market) => {
      const marketRows = rows.filter((row) => row.market === market);
      return [market, {
        final: countSides(marketRows, (row) => row.side),
        independent: countSides(marketRows, independentSide),
        actionable: countSides(marketRows.filter((row) => actionable(row.grade)), (row) => row.side),
      }];
    })),
    marketEvidenceModes: Object.fromEntries([...new Set(rows.map((row) => row.marketEvidenceMode))].sort().map((mode) => [mode, rows.filter((row) => row.marketEvidenceMode === mode).length])),
  };
}

function historicalSummary(rows: readonly HistoricalRow[]) {
  const summarize = (selected: readonly HistoricalRow[]) => Object.fromEntries((["over", "under"] as const).map((side) => {
    const sideRows = selected.filter((row) => row.finalSide === side);
    const wins = sideRows.filter((row) => row.finalSide === row.outcomeSide).length;
    return [side, { records: sideRows.length, wins, losses: sideRows.length - wins, hitRate: sideRows.length ? wins / sideRows.length : null }];
  }));
  return {
    all: summarize(rows),
    actionable: summarize(rows.filter((row) => actionable(row.grade))),
  };
}

async function main(): Promise<void> {
  const slateDate = optionalValue("--slate-date") ?? nbaPlayerPropsSlateDate();
  const snapshot = await readNbaPlayerPropsPrivateSnapshot({ client: supabase, slateDate });
  if (!snapshot) throw new Error(`No stored NBA player-props snapshot exists for ${slateDate}.`);
  const historicalPath = optionalValue("--historical-parity");
  const historical = historicalPath
    ? JSON.parse(await readFile(historicalPath, "utf8")) as { release: string; rows: HistoricalRow[] }
    : null;
  process.stdout.write(`${JSON.stringify({
    mode: "read_only",
    actionable: false,
    noProviderCalls: true,
    slateDate,
    generatedAt: snapshot.generatedAt,
    releases: {
      product: snapshot.productRelease,
      snapshot: snapshot.snapshotRelease,
      historical: historical?.release ?? null,
    },
    current: currentSummary(snapshot.decisions),
    historical: historical ? historicalSummary(historical.rows) : null,
  }, null, 2)}\n`);
}

void main();

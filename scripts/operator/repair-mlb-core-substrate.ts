/**
 * Targeted MLB core-substrate repair.
 *
 * Fills only missing prediction_records substrate for MLB moneyline/total rows:
 *   - odds_american from line_history at/before lock, using Daily Edge book priority
 *   - market_probability from odds_american when null
 *   - edge from model_probability - market_probability when null
 *
 * Does not change pick, side, line_value, confidence, play_grade, best_angle,
 * no_bet, locked_at, prediction_grades, or snapshot_json.
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const FROM = process.argv.find((arg) => arg.startsWith("--from="))?.slice("--from=".length) ?? "2026-07-07";
const TO = process.argv.find((arg) => arg.startsWith("--to="))?.slice("--to=".length) ?? FROM;

const BOOK_PRIORITY = [
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
] as const;

type PredictionRow = {
  id: number;
  game_id: number;
  slate_date: string;
  matchup: string | null;
  market: "moneyline" | "total";
  pick: string | null;
  side: string | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  locked_at: string | null;
  held: boolean | null;
  snapshot_json: Record<string, unknown> | null;
};

type HistoryRow = {
  sportsbook: string;
  odds_american: number | null;
  recorded_at: string;
};

function americanToImplied(american: number | null): number | null {
  if (typeof american !== "number" || !Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundEdge(modelProbability: number, marketProbability: number): number {
  return Math.round((modelProbability - marketProbability) * 1000) / 10;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function snapshotOddsSourcePrice(row: PredictionRow): number | null {
  const marketKey = row.market === "moneyline" ? "ml" : "ou";
  const raw = row.snapshot_json?.[`odds_source_at_lock_${marketKey}`];
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const sideRaw = row.side ? obj[row.side] : null;
  if (sideRaw && typeof sideRaw === "object") {
    const sideObj = sideRaw as Record<string, unknown>;
    return num(sideObj.odds) ?? num(sideObj.odds_american);
  }
  return num(obj.odds) ?? num(obj.odds_american);
}

function snapshotLinesAtLockPrice(row: PredictionRow): number | null {
  const raw = row.snapshot_json?.lines_at_lock;
  if (!Array.isArray(raw)) return null;
  const match = raw.find((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object") return false;
    const line = entry as Record<string, unknown>;
    return str(line.market_type) === row.market &&
      (!row.side || str(line.side) === row.side) &&
      num(line.odds_american) !== null;
  });
  return match ? num(match.odds_american) : null;
}

function snapshotAuditPrice(row: PredictionRow): number | null {
  if (row.market !== "total") return null;
  const audit = row.snapshot_json?.v2_2_audit;
  if (!audit || typeof audit !== "object") return null;
  const obj = audit as Record<string, unknown>;
  if (row.side === "over") return num(obj.over_odds_american);
  if (row.side === "under") return num(obj.under_odds_american);
  return null;
}

function snapshotPostedLinePrice(row: PredictionRow): number | null {
  const key = row.market === "moneyline" ? "moneyline" : "total";
  const postedLines = row.snapshot_json?.posted_lines;
  const raw = postedLines && typeof postedLines === "object"
    ? (postedLines as Record<string, unknown>)[key]
    : null;
  if (!raw || typeof raw !== "object") return null;
  const line = raw as Record<string, unknown>;
  const side = str(line.side);
  if (side && row.side && side !== row.side) return null;
  return num(line.odds_american);
}

function lockedPriceFromSnapshot(row: PredictionRow): number | null {
  return snapshotOddsSourcePrice(row) ??
    snapshotLinesAtLockPrice(row) ??
    snapshotAuditPrice(row) ??
    snapshotPostedLinePrice(row);
}

async function lockedPriceFromHistory(sb: { from: ReturnType<typeof createClient>["from"] }, row: PredictionRow): Promise<number | null> {
  if (row.locked_at === null || row.side === null) return null;
  const { data, error } = await sb
    .from("line_history")
    .select("sportsbook, odds_american, recorded_at")
    .eq("game_id", row.game_id)
    .eq("market_type", row.market)
    .eq("side", row.side)
    .lte("recorded_at", row.locked_at)
    .not("odds_american", "is", null)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  const hist = (data ?? []) as HistoryRow[];
  for (const book of BOOK_PRIORITY) {
    const hit = hist.find((entry) => entry.sportsbook === book && typeof entry.odds_american === "number");
    if (hit) return hit.odds_american;
  }
  return hist.find((entry) => typeof entry.odds_american === "number")?.odds_american ?? null;
}

async function main(): Promise<void> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from("prediction_records")
    .select("id, game_id, slate_date, matchup, market, pick, side, odds_american, model_probability, market_probability, edge, locked_at, held, snapshot_json")
    .eq("sport", "mlb")
    .gte("slate_date", FROM)
    .lte("slate_date", TO)
    .in("market", ["moneyline", "total"]);
  if (error) throw error;

  const rows = ((data ?? []) as PredictionRow[]).filter((row) =>
    row.held !== true &&
    row.pick !== null &&
    (
      row.odds_american === null ||
      row.market_probability === null ||
      row.edge === null
    )
  );

  console.log(`MLB core substrate repair ${FROM}..${TO} apply=${APPLY}`);
  console.log(`Candidate rows: ${rows.length}`);
  let updates = 0;

  for (const row of rows) {
    const odds = row.odds_american ?? await lockedPriceFromHistory(sb, row) ?? lockedPriceFromSnapshot(row);
    const marketProbability = row.market_probability ?? americanToImplied(odds);
    const edge = row.edge ?? (
      typeof row.model_probability === "number" && marketProbability !== null
        ? roundEdge(row.model_probability, marketProbability)
        : null
    );
    const patch: Record<string, number> = {};
    if (row.odds_american === null && odds !== null) patch.odds_american = odds;
    if (row.market_probability === null && marketProbability !== null) patch.market_probability = roundProbability(marketProbability);
    if (row.edge === null && edge !== null) patch.edge = edge;
    if (Object.keys(patch).length === 0) {
      console.log(`  skip rec=${row.id} ${row.slate_date} ${row.matchup} ${row.market}: no deterministic repair`);
      continue;
    }
    console.log(`  rec=${row.id} ${row.slate_date} ${String(row.matchup).padEnd(10)} ${row.market.padEnd(9)} patch=${JSON.stringify(patch)}`);
    if (!APPLY) continue;
    const { error: updateError } = await sb
      .from("prediction_records")
      .update(patch)
      .eq("id", row.id);
    if (updateError) throw updateError;
    updates += 1;
  }

  console.log(`Updates applied: ${updates}`);
  if (!APPLY) console.log("Dry run only; pass --apply to write.");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});

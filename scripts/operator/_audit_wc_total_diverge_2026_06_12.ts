/**
 * READ-ONLY — TOTAL_LINES_DIVERGE deep audit (2026-06-12).
 *
 * Pulls every `lines` row with market_type='total' for the two WC
 * fixtures (15754 BIH@CAN, 15755 PAR@USA), grouped per sportsbook and
 * per line_value, then reconstructs what the model's divergence rule
 * (median-of-distinct-lines per provider) would see and prints the
 * MAIN line per book (closest to balanced -110/-110) so we can judge
 * whether the books actually disagree on the main total.
 *
 * It also reads the persisted snapshot_json for the total market on
 * each fixture to recover any provider line sets / total_reconciliation
 * captured at lock time.
 *
 * Pure read. No mutations.
 *
 * Usage: npx tsx scripts/operator/_audit_wc_total_diverge_2026_06_12.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m === null) continue;
  if (!(m[1] in process.env)) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const GAMES = [
  { id: 15754, label: "BIH@CAN" },
  { id: 15755, label: "PAR@USA" },
];

type LineRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string | null;
  odds_american: number | null;
  line_value: number | null;
  recorded_at?: string | null;
};

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Closest-to-balanced main line per book: the line_value whose
// over/under American prices are closest to even (|odds+100| minimized,
// summed over the two sides present).
function mainLinePerBook(rows: LineRow[]): Map<string, { line: number; score: number }> {
  const byBook = new Map<string, LineRow[]>();
  for (const r of rows) {
    const book = r.sportsbook ?? "?";
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book)!.push(r);
  }
  const out = new Map<string, { line: number; score: number }>();
  for (const [book, brs] of byBook) {
    const byLine = new Map<number, LineRow[]>();
    for (const r of brs) {
      if (r.line_value === null) continue;
      if (!byLine.has(r.line_value)) byLine.set(r.line_value, []);
      byLine.get(r.line_value)!.push(r);
    }
    let best: { line: number; score: number } | null = null;
    for (const [line, lrs] of byLine) {
      // score = sum over sides of |odds+100|; lower = more balanced
      let score = 0;
      let n = 0;
      for (const r of lrs) {
        if (r.odds_american === null) continue;
        score += Math.abs(r.odds_american + 100);
        n++;
      }
      const finalScore = n > 0 ? score : Number.POSITIVE_INFINITY;
      if (best === null || finalScore < best.score) best = { line, score: finalScore };
    }
    if (best !== null) out.set(book, best);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("\nREAD-ONLY — TOTAL_LINES_DIVERGE deep audit  2026-06-12");
  console.log("=".repeat(78));

  for (const g of GAMES) {
    console.log("\n" + "#".repeat(78));
    console.log(`GAME ${g.id}  ${g.label}`);

    const { data, error } = await supabase
      .from("lines")
      .select("game_id, market_type, side, sportsbook, odds_american, line_value")
      .eq("game_id", g.id)
      .eq("market_type", "total");
    if (error !== null) {
      console.error("lines query failed:", error);
      continue;
    }
    const rows = (data as LineRow[] | null) ?? [];
    console.log(`\ntotal lines rows: ${rows.length}`);

    if (rows.length === 0) {
      console.log("  (no total rows in `lines`)");
    } else {
      // Per-book × per-line table.
      const books = Array.from(new Set(rows.map((r) => r.sportsbook ?? "?"))).sort();
      console.log("\nPer-book × per-line (over/under American):");
      for (const book of books) {
        const brs = rows.filter((r) => (r.sportsbook ?? "?") === book);
        const lines = Array.from(new Set(brs.map((r) => r.line_value))).sort((a, b) => (a ?? 0) - (b ?? 0));
        const parts: string[] = [];
        for (const lv of lines) {
          const over = brs.find((r) => r.line_value === lv && r.side === "over");
          const under = brs.find((r) => r.line_value === lv && r.side === "under");
          parts.push(`${lv}: O ${over?.odds_american ?? "-"} / U ${under?.odds_american ?? "-"}`);
        }
        console.log(`  ${book.padEnd(16)} ${parts.join("   |   ")}`);
      }

      // Distinct lines across ALL books (what the model's set would be
      // if all rows were one provider).
      const allLines = Array.from(new Set(rows.filter((r) => r.line_value !== null).map((r) => r.line_value as number))).sort((a, b) => a - b);
      console.log(`\nDistinct total line_values across all books: [${allLines.join(", ")}]`);
      console.log(`  median of distinct lines: ${medianOf(allLines)}`);

      // Main line per book (closest to balanced).
      const mains = mainLinePerBook(rows);
      console.log("\nMAIN line per book (closest to balanced -110/-110):");
      const mainValues: number[] = [];
      for (const [book, info] of mains) {
        console.log(`  ${book.padEnd(16)} main=${info.line}  (balance_score=${info.score === Infinity ? "inf" : info.score})`);
        mainValues.push(info.line);
      }
      const distinctMains = Array.from(new Set(mainValues)).sort((a, b) => a - b);
      console.log(`\n  Distinct MAIN lines across books: [${distinctMains.join(", ")}]`);
      console.log(`  span of main lines: ${distinctMains.length > 0 ? (Math.max(...distinctMains) - Math.min(...distinctMains)) : "n/a"}`);
      console.log(`  most common main line: ${(() => {
        const counts = new Map<number, number>();
        for (const v of mainValues) counts.set(v, (counts.get(v) ?? 0) + 1);
        let bestV = mainValues[0]; let bestC = 0;
        for (const [v, c] of counts) if (c > bestC) { bestC = c; bestV = v; }
        return `${bestV} (in ${bestC}/${mainValues.length} books)`;
      })()}`);
    }

    // Snapshot recovery for the total market.
    const { data: pdata } = await supabase
      .from("prediction_records")
      .select("market, pick, confidence, play_grade, held, no_bet, no_bet_reason, snapshot_json")
      .eq("game_id", g.id)
      .eq("market", "total");
    const prec = (pdata as Array<Record<string, unknown>> | null) ?? [];
    for (const p of prec) {
      const snap = p.snapshot_json as Record<string, unknown> | null;
      console.log(`\n  prediction_records[total]: pick=${p.pick} grade=${p.play_grade} held=${p.held} no_bet=${p.no_bet}`);
      console.log(`    no_bet_reason=${p.no_bet_reason}`);
      // Try to recover any provider total-line sets stored in snapshot.
      const model = snap?.["model"] as Record<string, unknown> | undefined;
      const totalRec = model?.["total_reconciliation"] ?? snap?.["total_reconciliation"];
      const bookCounts = (model?.["market_book_counts"] ?? snap?.["market_book_counts"]) as unknown;
      const implied = (model?.["market_implied"] ?? snap?.["market_implied"]) as Record<string, unknown> | undefined;
      const devig = (model?.["market_devig"] ?? snap?.["market_devig"]) as Record<string, unknown> | undefined;
      if (totalRec !== undefined && totalRec !== null) {
        const tr = totalRec as Record<string, unknown>;
        console.log(`    total_reconciliation: reconciled_side=${tr.reconciled_total_side} conf=${tr.reconciled_confidence_pct} grade_cap=${tr.grade_cap} hold=${tr.hold} mean_dir=${tr.mean_direction_side} edge=${tr.reconciled_edge_pp}`);
      }
      if (bookCounts !== undefined) console.log(`    market_book_counts=${JSON.stringify(bookCounts)}`);
      if (implied !== undefined) {
        const totalKeys = Object.keys(implied).filter((k) => k.startsWith("total"));
        console.log(`    market_implied(total)=${JSON.stringify(Object.fromEntries(totalKeys.map((k) => [k, implied[k]])))}`);
      }
      if (devig !== undefined) {
        const totalKeys = Object.keys(devig).filter((k) => k.startsWith("total"));
        console.log(`    market_devig(total)=${JSON.stringify(Object.fromEntries(totalKeys.map((k) => [k, devig[k]])))}`);
      }
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log("Read-only — no DB writes occurred.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

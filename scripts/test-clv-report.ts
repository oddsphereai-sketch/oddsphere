/**
 * Unit tests for lib/streaming/clvReport.ts (pure aggregation).
 * Run: npx tsx scripts/test-clv-report.ts
 */
import { aggregateClv, priceBucket, type ClvReportRow } from "../lib/streaming/clvReport";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

// priceBucket boundaries
check("heavy_fav -250", priceBucket(-250) === "heavy_fav");
check("fav -150", priceBucket(-150) === "fav");
check("pickem +110", priceBucket(110) === "pickem");
check("dog +180", priceBucket(180) === "dog");
check("big_dog +400", priceBucket(400) === "big_dog");
check("unpriced null", priceBucket(null) === "unpriced");

function row(o: Partial<ClvReportRow>): ClvReportRow {
  return {
    sport: "mlb", market: "moneyline", side: "home", grade: "best_angle",
    oddsAmerican: -120, clvPct: 2, beatClosing: true, result: "win", ...o,
  };
}

const rows: ClvReportRow[] = [
  row({ grade: "best_angle", clvPct: 4, beatClosing: true, result: "win" }),
  row({ grade: "best_angle", clvPct: -2, beatClosing: false, result: "loss" }),
  row({ grade: "lean", clvPct: 1, beatClosing: true, result: "loss", market: "total", side: "over" }),
  row({ grade: "lean", clvPct: null, beatClosing: null, result: "win", market: "total", side: "under" }),
];

const rep = aggregateClv(rows);

check("total n=4", rep.total.n === 4);
check("total withClv=3 (one null)", rep.total.withClv === 3);
check("total avgClv = (4-2+1)/3 = 1.00", rep.total.avgClvPct === 1);
check("total beatCloseRate = 2/3 = 66.67", rep.total.beatCloseRate === 66.67);
check("total winRate = 2/4 = 50", rep.total.winRate === 50);

const ba = rep.byGrade.find((b) => b.key === "best_angle");
check("byGrade best_angle n=2", ba?.n === 2);
check("byGrade best_angle avgClv = (4-2)/2 = 1", ba?.avgClvPct === 1);
check("byGrade best_angle winRate 50", ba?.winRate === 50);

const lean = rep.byGrade.find((b) => b.key === "lean");
check("byGrade lean withClv=1 (one null)", lean?.withClv === 1);
check("byGrade lean avgClv = 1", lean?.avgClvPct === 1);

check("byMarket has moneyline + total", rep.byMarket.length === 2);
check("bySport mlb n=4", rep.bySport.find((b) => b.key === "mlb")?.n === 4);
check("byPriceBucket fav (all -120)", rep.byPriceBucket.find((b) => b.key === "fav")?.n === 4);

// empty input → safe zeros
const empty = aggregateClv([]);
check("empty total n=0", empty.total.n === 0);
check("empty avgClv null", empty.total.avgClvPct === null);
check("empty byGrade []", empty.byGrade.length === 0);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

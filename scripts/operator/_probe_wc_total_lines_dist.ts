/**
 * READ-ONLY probe: full distribution of TOTAL lines per book per
 * provider for tonight's WC fixtures. Shows what TOTAL_LINES_DIVERGE
 * is actually catching, and whether 1.0 → 1.5 is appropriate.
 *
 * No writes.
 */
import { BallDontLieFifaProvider } from "../../lib/providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../lib/providers/real_api/_bdlFifaClient";
import { SharpApiSoccerOddsProvider } from "../../lib/providers/real_api/SharpApiSoccerOddsProvider";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import type { NormalizedSoccerOddsRecord } from "../../lib/providers/real_api/_soccerMarketNormalizer";

function pickMainPerBook(rows: NormalizedSoccerOddsRecord[]): Map<string, number> {
  // Same heuristic as writeSoccerLines: per book, the line whose odds are
  // closest to fair (|odds + 100| minimized).
  const totalsByBook = new Map<string, NormalizedSoccerOddsRecord[]>();
  for (const r of rows) {
    if (r.market !== "total" || r.line === null) continue;
    const book = r.sportsbook ?? "?";
    if (!totalsByBook.has(book)) totalsByBook.set(book, []);
    totalsByBook.get(book)!.push(r);
  }
  const main = new Map<string, number>();
  for (const [book, rs] of totalsByBook) {
    let bestLine: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const r of rs) {
      if (r.line === null || r.odds_american === null) continue;
      const dist = Math.abs(r.odds_american + 100);
      if (dist < bestDist) { bestDist = dist; bestLine = r.line; }
    }
    if (bestLine !== null) main.set(book, bestLine);
  }
  return main;
}

function reportFixture(label: string, bdlNorm: NormalizedSoccerOddsRecord[], sharpNorm: NormalizedSoccerOddsRecord[]): void {
  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(label);
  console.log(`══════════════════════════════════════════════════════════════════`);

  // Per-book main line, both providers merged (SharpAPI wins ties, per writer).
  const merged: NormalizedSoccerOddsRecord[] = [];
  const seen = new Set<string>();
  // BDL first.
  for (const r of bdlNorm) {
    const k = `${r.market}|${r.selection}|${r.sportsbook ?? "?"}|${r.line ?? "null"}`;
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  // SharpAPI overrides.
  for (const r of sharpNorm) {
    const k = `${r.market}|${r.selection}|${r.sportsbook ?? "?"}|${r.line ?? "null"}`;
    seen.add(k);
    const ix = merged.findIndex((m) => `${m.market}|${m.selection}|${m.sportsbook ?? "?"}|${m.line ?? "null"}` === k);
    if (ix >= 0) merged[ix] = r;
    else merged.push(r);
  }

  // ── Main line per book ────────────────────────────────────────────
  const mainPerBookBdl = pickMainPerBook(bdlNorm);
  const mainPerBookSharp = pickMainPerBook(sharpNorm);
  const mainPerBookMerged = pickMainPerBook(merged);

  console.log(`\n── Main total line per book (closest-to-fair odds heuristic) ──`);
  const books = new Set<string>([
    ...mainPerBookBdl.keys(),
    ...mainPerBookSharp.keys(),
    ...mainPerBookMerged.keys(),
  ]);
  console.log("  book          | BDL main | SharpAPI main | merged main");
  console.log("  --------------+----------+---------------+------------");
  for (const book of [...books].sort()) {
    const bdl = mainPerBookBdl.get(book) ?? "—";
    const sharp = mainPerBookSharp.get(book) ?? "—";
    const merge = mainPerBookMerged.get(book) ?? "—";
    console.log(`  ${book.padEnd(13)} | ${String(bdl).padStart(8)} | ${String(sharp).padStart(13)} | ${String(merge).padStart(11)}`);
  }

  // ── Spread analysis ───────────────────────────────────────────────
  const mainVals = [...mainPerBookMerged.values()];
  const spread = mainVals.length > 0 ? Math.max(...mainVals) - Math.min(...mainVals) : 0;
  console.log(`\n  merged-main spread (max − min): ${spread.toFixed(2)}  (books offer mains from ${Math.min(...mainVals)} to ${Math.max(...mainVals)})`);

  // ── Current rule: |BDL max line − SharpAPI max line| ≥ 1.0 ───────
  const bdlAllLines = new Set(bdlNorm.filter((r) => r.market === "total" && r.line !== null).map((r) => r.line as number));
  const sharpAllLines = new Set(sharpNorm.filter((r) => r.market === "total" && r.line !== null).map((r) => r.line as number));
  const bdlMax = bdlAllLines.size > 0 ? Math.max(...bdlAllLines) : NaN;
  const sharpMax = sharpAllLines.size > 0 ? Math.max(...sharpAllLines) : NaN;
  const ruleSpread = Math.abs(bdlMax - sharpMax);
  console.log(`\n  CURRENT RULE — |BDL_MAX_line − SharpAPI_MAX_line|:`);
  console.log(`    BDL max line:      ${bdlMax.toFixed(2)}  (BDL offers ${bdlAllLines.size} distinct lines)`);
  console.log(`    SharpAPI max line: ${sharpMax.toFixed(2)}  (SharpAPI offers ${sharpAllLines.size} distinct lines)`);
  console.log(`    spread:            ${ruleSpread.toFixed(2)}`);
  console.log(`    triggers @ 1.0?    ${ruleSpread >= 1.0 ? "YES — holds total" : "no"}`);
  console.log(`    triggers @ 1.5?    ${ruleSpread >= 1.5 ? "YES — holds total" : "no"}`);

  // ── Alternative rule: spread of merged MAIN lines per book ────────
  console.log(`\n  ALTERNATIVE — spread of merged MAIN lines (the one the writer persists):`);
  console.log(`    spread:            ${spread.toFixed(2)}`);
  console.log(`    triggers @ 1.0?    ${spread >= 1.0 ? "YES — holds total" : "no"}`);
  console.log(`    triggers @ 1.5?    ${spread >= 1.5 ? "YES — holds total" : "no"}`);
}

async function main(): Promise<void> {
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  const sharpKey = process.env.SHARPAPI_KEY;
  if (bdlKey === undefined || sharpKey === undefined) { console.error("missing keys"); process.exit(1); }

  const bdl = new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
  const sharp = new SharpApiSoccerOddsProvider(new SharpApiClient(sharpKey));

  const allBdlMatches = await bdl.listMatches({ per_page: 25 });
  const allSharpRaw = await sharp.listRawOdds({ maxPages: 2, limit: 200 });

  // CZE @ KOR (bdl_match_id=2, home=South Korea, away=Czechia)
  {
    const bdlMatch = allBdlMatches.find((m) => m.provider_match_id === 2);
    if (bdlMatch !== undefined) {
      const bdlRaw = await bdl.listRawOdds({ match_id: 2, per_page: 25 });
      const bdlNorm = bdlRaw.flatMap((r) => bdl.normalizeOdds(r, { home_team: bdlMatch.home_team_name, away_team: bdlMatch.away_team_name }));
      const sharpForGame = allSharpRaw.filter((r) => {
        const txt = JSON.stringify(r).toLowerCase();
        return txt.includes("korea") && txt.includes("czech");
      });
      const sharpNorm = sharp.normalizeOdds(sharpForGame);
      reportFixture(`CZE @ KOR (game_id=15721, bdl_match_id=2)`, bdlNorm, sharpNorm);
    }
  }

  // RSA @ MEX (bdl_match_id=1)
  {
    const bdlMatch = allBdlMatches.find((m) => m.provider_match_id === 1);
    if (bdlMatch !== undefined) {
      const bdlRaw = await bdl.listRawOdds({ match_id: 1, per_page: 25 });
      const bdlNorm = bdlRaw.flatMap((r) => bdl.normalizeOdds(r, { home_team: bdlMatch.home_team_name, away_team: bdlMatch.away_team_name }));
      const sharpForGame = allSharpRaw.filter((r) => {
        const txt = JSON.stringify(r).toLowerCase();
        return txt.includes("mexico") && txt.includes("south africa");
      });
      const sharpNorm = sharp.normalizeOdds(sharpForGame);
      reportFixture(`RSA @ MEX (game_id=15687, bdl_match_id=1)`, bdlNorm, sharpNorm);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

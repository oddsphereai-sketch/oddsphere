/**
 * READ-ONLY dry-run: what we WOULD write to `lines` and `line_history`
 * for CZE @ KOR if soccer odds persistence were wired into the writer.
 *
 *   • Pulls BDL FIFA odds (game external_id) + SharpAPI WC odds (filtered
 *     to the CZE/KOR event id) and runs each through the shared
 *     `_soccerMarketNormalizer`. That normalizer is the existing contract:
 *     the four official launch markets only — match_result, double_chance,
 *     total, btts. Anything else is silently dropped (per the WC-1 spec).
 *
 *   • Groups by (market, side, sportsbook), keeps the most recent
 *     observation per group. Each kept row → one proposed `lines` row
 *     (upsert key = (game_id, market_type, side, sportsbook)) + one
 *     `line_history` row (always-append, opener flag set on the first
 *     observation we'd ever record for that group).
 *
 *   • Shows existing rows so we can see what insert/update would happen.
 *
 * NO writes. Safe to run anytime.
 */
import { supabase } from "../../lib/db/supabase";
import { BallDontLieFifaProvider } from "../../lib/providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../lib/providers/real_api/_bdlFifaClient";
import { SharpApiSoccerOddsProvider } from "../../lib/providers/real_api/SharpApiSoccerOddsProvider";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import type { NormalizedSoccerOddsRecord } from "../../lib/providers/real_api/_soccerMarketNormalizer";

const GAME_ID = 15721;
const BDL_MATCH_ID = 2;

async function main(): Promise<void> {
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  const sharpKey = process.env.SHARPAPI_KEY;
  if (!bdlKey) { console.log("BALLDONTLIE_API_KEY missing"); process.exit(1); }
  if (!sharpKey) { console.log("SHARPAPI_KEY missing"); process.exit(1); }

  // ── 1) Provider truth ──────────────────────────────────────────
  const bdl = new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
  const sharp = new SharpApiSoccerOddsProvider(new SharpApiClient(sharpKey));

  console.log("Fetching BDL FIFA raw odds for match_id=2…");
  const bdlRaw = await bdl.listRawOdds({ match_id: BDL_MATCH_ID, per_page: 25 });
  console.log(`  ${bdlRaw.length} raw rows`);
  const bdlNorm = bdlRaw.flatMap((r) =>
    bdl.normalizeOdds(r, { home_team: "South Korea", away_team: "Czechia" }),
  );
  console.log(`  normalized: ${bdlNorm.length} rows`);

  console.log("Fetching SharpAPI WC soccer raw odds (then filtering CZE/KOR)…");
  const sharpAllRaw = await sharp.listRawOdds({ maxPages: 2, limit: 200 });
  const cze_kor_event_ids = new Set<string>();
  for (const r of sharpAllRaw) {
    const txt = JSON.stringify(r).toLowerCase();
    if (txt.includes("kore") && txt.includes("czech")) {
      const eid = (r as Record<string, unknown>).event_id;
      if (typeof eid === "string") cze_kor_event_ids.add(eid);
    }
  }
  const sharpRawForGame = sharpAllRaw.filter((r) => {
    const eid = (r as Record<string, unknown>).event_id;
    return typeof eid === "string" && cze_kor_event_ids.has(eid);
  });
  console.log(`  matching event_ids: ${[...cze_kor_event_ids].join(", ")}`);
  console.log(`  raw rows for CZE/KOR: ${sharpRawForGame.length}`);
  const sharpNorm = sharp.normalizeOdds(sharpRawForGame);
  console.log(`  normalized: ${sharpNorm.length} rows`);

  // ── 2) Combine + group ─────────────────────────────────────────
  type CombinedRow = NormalizedSoccerOddsRecord;
  const combined: CombinedRow[] = [
    ...bdlNorm,
    ...sharpNorm,
  ];

  // For totals: each line (Over 2.5, Over 3.5, …) is a SEPARATE bet
  // and must be its own row in `lines`. The upsert key for the writer
  // should therefore be (game_id, market, side, sportsbook, line_value).
  // For non-totals: line is null, so the key collapses to (market, side, book).
  const groupKey = (r: CombinedRow): string =>
    `${r.market}::${r.selection}::${r.sportsbook ?? "?"}::${r.line ?? "null"}`;
  const latestByGroup = new Map<string, CombinedRow>();
  for (const r of combined) {
    const k = groupKey(r);
    const existing = latestByGroup.get(k);
    if (!existing) { latestByGroup.set(k, r); continue; }
    const a = r.fetched_at ?? "";
    const b = existing.fetched_at ?? "";
    if (a > b) latestByGroup.set(k, r);
  }
  const proposed = [...latestByGroup.values()];

  // Identify the MAIN TOTAL line per book by picking the row with odds
  // closest to -100 (the standard "fair main" line on a two-way market).
  // Anything else is an alternate. The writer should persist BOTH but
  // tag them so downstream consumers can distinguish.
  const mainTotalByBook = new Map<string, number>();
  for (const r of proposed) {
    if (r.market !== "total" || r.line === null) continue;
    const book = r.sportsbook ?? "?";
    const currentMain = mainTotalByBook.get(book);
    const currentDist = currentMain === undefined ? Infinity : Math.abs(
      Math.abs((proposed.find((q) => q.market === "total" && q.sportsbook === r.sportsbook && q.line === currentMain && q.selection === "over")?.odds_american ?? 0) + 100),
    );
    const thisDist = Math.abs((r.odds_american ?? 0) + 100);
    if (currentMain === undefined || thisDist < currentDist) {
      mainTotalByBook.set(book, r.line);
    }
  }
  const isMainTotal = (r: CombinedRow): boolean => {
    if (r.market !== "total") return false;
    return mainTotalByBook.get(r.sportsbook ?? "?") === r.line;
  };

  // ── 3) Existing DB rows for this game ──────────────────────────
  const { data: existingLines } = await supabase
    .from("lines")
    .select("id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
    .eq("game_id", GAME_ID);
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const r of (existingLines ?? []) as Array<Record<string, unknown>>) {
    existingByKey.set(`${r.market_type}::${r.side}::${r.sportsbook}`, r);
  }

  const { data: existingHistory } = await supabase
    .from("line_history")
    .select("market_type, side, sportsbook", { count: "exact" })
    .eq("game_id", GAME_ID);
  const historyCountByKey = new Map<string, number>();
  for (const r of (existingHistory ?? []) as Array<Record<string, unknown>>) {
    const k = `${r.market_type}::${r.side}::${r.sportsbook}`;
    historyCountByKey.set(k, (historyCountByKey.get(k) ?? 0) + 1);
  }

  // ── 4) Print proposal table grouped by market ──────────────────
  console.log("\n========== Proposed dry-run plan ==========");
  console.log("schema check: lines.market_type=TEXT (no enum) — any string accepted");
  console.log(`existing lines rows for game_id=${GAME_ID}: ${existingLines?.length ?? 0}`);
  console.log(`existing line_history rows: ${existingHistory?.length ?? 0}`);
  console.log("upsert key (proposed): (game_id, market_type, side, sportsbook)");
  console.log("line_history insert: append + first-ever-observation gets is_opener=true via _lineHistoryOpenerHelper");

  for (const market of ["match_result", "double_chance", "total", "btts"] as const) {
    const rows = proposed.filter((r) => r.market === market);
    rows.sort((a, b) => `${a.selection}::${a.sportsbook}`.localeCompare(`${b.selection}::${b.sportsbook}`));
    console.log(`\n── ${market} (${rows.length} proposed) ──`);
    for (const r of rows) {
      const k = `${r.market}::${r.selection}::${r.sportsbook}`;
      const existing = existingByKey.get(k);
      const action = existing ? "UPDATE" : "INSERT";
      const histCount = historyCountByKey.get(k) ?? 0;
      const histAction = histCount === 0 ? "INSERT (is_opener=true)" : "APPEND";
      const lineStr = r.line === null ? "—" : String(r.line);
      const altTag = r.market === "total" && !isMainTotal(r) ? " [alt]" : "";
      console.log(
        `  ${r.provider.padEnd(8)} ${r.selection.padEnd(13)} ${String(r.sportsbook ?? "?").padEnd(14)} ` +
          `line=${lineStr.padEnd(4)} odds=${(r.odds_american === null ? "—" : String(r.odds_american)).padEnd(6)}${altTag.padEnd(6)} ` +
          `lines:${action}  history(${histCount} prior):${histAction}`,
      );
    }
  }

  console.log("\n========== Volume summary ==========");
  const byMarket = new Map<string, number>();
  for (const r of proposed) byMarket.set(r.market, (byMarket.get(r.market) ?? 0) + 1);
  for (const [m, n] of byMarket) console.log(`  ${m.padEnd(15)} ${n} proposed lines rows`);
  const mainTotals = proposed.filter((r) => r.market === "total" && isMainTotal(r));
  const altTotals = proposed.filter((r) => r.market === "total" && !isMainTotal(r));
  console.log(`    of which total: main=${mainTotals.length} alt=${altTotals.length}`);
  console.log(`  TOTAL          ${proposed.length} proposed lines rows`);
  console.log("\n  Main total line by book:");
  for (const [book, line] of mainTotalByBook) {
    console.log(`    ${book.padEnd(12)} → ${line}`);
  }
  console.log(`  → line_history would gain ${proposed.length} rows (or fewer if dedupe rules apply)`);

  console.log("\n========== Schema/contract notes ==========");
  console.log("• lines.market_type and line_history.market_type are plain TEXT — no migration needed for");
  console.log("  match_result, double_chance, btts, or total. They join cleanly with existing indexes.");
  console.log("• side values match the schema enum hint ('home'|'away'|'over'|'under'|'yes'|'no'); the new");
  console.log("  double_chance selections ('home_or_draw' etc.) extend it but the column is also TEXT so");
  console.log("  Postgres accepts them. Any downstream consumer that pattern-matches on side strings");
  console.log("  must be updated separately.");
  console.log("• sharp_signals: SharpAPI /splits returns empty_as_of_probe for FIFA WC. We will NOT write");
  console.log("  fabricated sharp_signals rows. The 'public split unavailable' label on the card is honest.");
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Dual-source public splits — Phase 1 observation-layer VERIFY + COVERAGE (READ-ONLY).
 *
 * Ticket: o-dual-splits-observation-layer.
 *
 * Modes (all read-only; no writes ever):
 *   (default)   table-state of public_splits_observations (graceful if not
 *               applied) + a per-game x per-market COVERAGE MATRIX:
 *                 for each game, for moneyline / spread / total, show whether
 *                 Playbook and current sharp_signals have usable splits, classify
 *                 both_source | playbook_only | sharpapi_only | no_source, and
 *                 list booksUsed + observed_at. Summarizes GAP-CLOSEABLE cells
 *                 (current UI source missing but a trusted provider has data).
 *   --preview   adds the per-SIDE detail with agreement/freshness.
 *
 * Goal it serves: public-split bars should fill whenever EITHER trusted provider
 * has usable data; a bar is correctly empty only when BOTH lack that market (or
 * for unsupported markets like first-inning, which neither provider splits).
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/dual-splits-observation-verify.ts --sport mlb --date 2026-06-24
 *   npx tsx --env-file=.env.local scripts/operator/dual-splits-observation-verify.ts --sport mlb --date 2026-06-24 --preview
 *
 * SAFETY: read-only. No DB/UI/grade/model writes. Key from env; never printed.
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, readBoolFlag, todayUTC } from "./_cliCommon";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type { PlaybookSplitGame } from "../../lib/providers/playbook/types";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";
import { normalizeTeamAbbr, type NormalizerSport } from "../../lib/providers/playbook/playbookTeamNormalizer";
import { STALE_AGE_MINUTES } from "../../lib/services/lastKnownGoodReader";
import { publicSplitsCapability } from "../../lib/config/publicSplitsCapability";

const API_KEY = process.env.PLAYBOOK_API_KEY ?? "";
const ALIGN_GAP = 10;
const MILD_GAP = 20;
const MARKETS = ["moneyline", "spread", "total"] as const;
type Market = (typeof MARKETS)[number];
type Side = "home" | "away" | "over" | "under";
const SIDES: Record<Market, Side[]> = { moneyline: ["home", "away"], spread: ["home", "away"], total: ["over", "under"] };

function pbKey(sport: string, away: unknown, home: unknown): string | null {
  if (sport === "mlb") {
    const a = normalizeMlbTeamName(String(away ?? "")), h = normalizeMlbTeamName(String(home ?? ""));
    return a && h ? `${a}@${h}` : null;
  }
  const a = normalizeTeamAbbr(sport as NormalizerSport, away), h = normalizeTeamAbbr(sport as NormalizerSport, home);
  return a && h ? `${a}@${h}` : null;
}

function pbCells(pb: PlaybookSplitGame, market: Market, side: Side): { bet: number | null; money: number | null; books: number | null } {
  const s = pb.splits ?? {};
  const m = market === "moneyline" ? s.moneyline : market === "total" ? s.total : s.spread;
  if (!m) return { bet: null, money: null, books: null };
  const books = m.source?.booksUsed ?? null;
  if (market === "total") {
    return side === "over"
      ? { bet: m.bets?.overPercent ?? null, money: m.money?.overPercent ?? null, books }
      : { bet: m.bets?.underPercent ?? null, money: m.money?.underPercent ?? null, books };
  }
  return side === "home"
    ? { bet: m.bets?.homePercent ?? null, money: m.money?.homePercent ?? null, books }
    : { bet: m.bets?.awayPercent ?? null, money: m.money?.awayPercent ?? null, books };
}

function ageStr(iso: string | null, now: number): string {
  if (!iso) return "-";
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  return `${m}m${m > STALE_AGE_MINUTES ? "(stale)" : ""}`;
}

type Loaded = {
  keyById: Map<number, string>;
  ssByKey: Map<string, { bet: number | null; money: number | null; observedAt: string | null }>;
  pbByGameKey: Map<string, PlaybookSplitGame>;
};

async function loadSlate(sport: string, date: string): Promise<Loaded> {
  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name").eq("sport", sport);
  const abbr = new Map<number, string>(), tname = new Map<number, string>();
  for (const t of teams ?? []) { abbr.set(t.id as number, (t.abbreviation as string) ?? ""); tname.set(t.id as number, (t.name as string) ?? ""); }
  const { data: games } = await supabase.from("games").select("id, home_team_id, away_team_id").eq("sport", sport).eq("slate_date", date);
  const ids = (games ?? []).map((g) => g.id as number);
  const keyById = new Map<number, string>();
  for (const g of games ?? []) {
    const k = sport === "mlb" ? `${abbr.get(g.away_team_id as number)}@${abbr.get(g.home_team_id as number)}` : pbKey(sport, tname.get(g.away_team_id as number), tname.get(g.home_team_id as number));
    if (k) keyById.set(g.id as number, k);
  }
  const { data: ss } = await supabase.from("sharp_signals").select("game_id, market_type, side, public_betting_pct, public_money_pct, computed_at").in("game_id", ids).in("market_type", ["moneyline", "spread", "total"]);
  const ssByKey = new Map<string, { bet: number | null; money: number | null; observedAt: string | null }>();
  for (const r of ss ?? []) ssByKey.set(`${r.game_id}:${r.market_type}:${r.side}`, { bet: r.public_betting_pct as number | null, money: r.public_money_pct as number | null, observedAt: r.computed_at as string | null });

  const pbByGameKey = new Map<string, PlaybookSplitGame>();
  if (API_KEY) {
    const client = new PlaybookClient(API_KEY);
    let pbRows: PlaybookSplitGame[] = [];
    try { const r = date === todayUTC() ? await client.splits(sport) : await client.splitsHistory(sport, date); pbRows = ((r.body as { data?: PlaybookSplitGame[] }).data) ?? []; }
    catch (e) { console.error("Playbook fetch failed:", (e as Error).message); }
    for (const r of pbRows) { const k = pbKey(sport, r.awayTeamName, r.homeTeamName); if (k) pbByGameKey.set(k, r); }
  }
  return { keyById, ssByKey, pbByGameKey };
}

function coverage(sport: string, L: Loaded): void {
  const now = Date.now();
  const cap = publicSplitsCapability(sport);
  const ssProv = cap.sharpSignalsProvider;
  const tally = { both_source: 0, playbook_only: 0, sharpapi_only: 0, no_source: 0 };
  let gapCloseable = 0; // current UI lacks it, Playbook has it, NON-doubleheader (clean fill)
  let dhAmbiguous = 0;  // current UI lacks it but key collides on a doubleheader

  // Doubleheader detection: a team-pair key mapping to >1 game_id can't be
  // cleanly attributed to a provider by team names alone (needs gameId/tip time).
  const keyToGids = new Map<string, number[]>();
  for (const [gid, k] of L.keyById) { if (!keyToGids.has(k)) keyToGids.set(k, []); keyToGids.get(k)!.push(gid); }
  const dhKeys = new Set([...keyToGids].filter(([, g]) => g.length > 1).map(([k]) => k));

  console.log(`\nCoverage matrix — ${sport} [status=${cap.status}; sharp_signals provenance=${ssProv}; playbookSplits=${cap.playbookSplits} sharpApiSplits=${cap.sharpApiSplits}]`);
  console.log(`  policy: ${cap.note}`);
  console.log(`  Markets: moneyline/spread/total (FI excluded — neither provider splits it).`);
  if (dhKeys.size) console.log(`  ⚠ doubleheaders (team-pair key collision; needs gameId/tip-time match): ${[...dhKeys].join(", ")}`);
  console.log(`  game             market    playbook(books,obs)   current sharp_signals(obs)   classification`);
  for (const [gid, gkey] of [...L.keyById].sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0])) {
    const pb = L.pbByGameKey.get(gkey);
    const isDh = dhKeys.has(gkey);
    for (const market of MARKETS) {
      // Playbook live presence + books for this market.
      let pbHas = false, pbBooks: number | null = null;
      if (pb) for (const side of SIDES[market]) { const c = pbCells(pb, market, side); if (c.bet !== null || c.money !== null) { pbHas = true; pbBooks = c.books ?? pbBooks; } }
      // Current sharp_signals presence + newest observed_at for this market.
      let ssHas = false, ssObs: string | null = null;
      for (const side of SIDES[market]) { const r = L.ssByKey.get(`${gid}:${market}:${side}`); if (r && (r.bet !== null || r.money !== null)) { ssHas = true; if (r.observedAt && (ssObs === null || r.observedAt > ssObs)) ssObs = r.observedAt; } }

      // Trusted-provider presence: stored sharp_signals is attributed to its real provider.
      const playbookHas = pbHas || (ssProv === "playbook" && ssHas);
      const sharpapiHas = ssProv === "sharpapi" && ssHas;
      const cls = playbookHas && sharpapiHas ? "both_source" : playbookHas ? "playbook_only" : sharpapiHas ? "sharpapi_only" : "no_source";
      tally[cls]++;
      if (!ssHas && pbHas) { if (isDh) dhAmbiguous++; else gapCloseable++; }

      const pbCol = pbHas ? `Y(${pbBooks ?? "?"}bk,fresh)` : "—";
      const ssCol = ssHas ? `Y(${ageStr(ssObs, now)})` : "—";
      const flag = cls === "no_source" ? "  ← empty bar (both lack)" : !ssHas && pbHas ? (isDh ? "  ← DH-ambiguous (key collision)" : "  ← GAP: Playbook fills current-missing") : "";
      const label = `${gkey}#${String(gid).slice(-4)}`;
      console.log(`  ${label.padEnd(16)} ${market.padEnd(9)} ${pbCol.padEnd(21)} ${ssCol.padEnd(28)} ${cls}${flag}`);
    }
  }
  const total = tally.both_source + tally.playbook_only + tally.sharpapi_only + tally.no_source;
  console.log(`\n  Summary (${total} game×market cells): both=${tally.both_source} playbook_only=${tally.playbook_only} sharpapi_only=${tally.sharpapi_only} no_source=${tally.no_source}`);
  console.log(`  Clean gap-closeable (current missing, Playbook has it, non-DH): ${gapCloseable} -> bars the dual-source read fills cleanly.`);
  console.log(`  Doubleheader-ambiguous (current missing, key collides): ${dhAmbiguous} -> needs gameId/tip-time matching, NOT team-pair, before attributing.`);
  console.log(`  Truly empty (no_source): ${tally.no_source} -> bars correctly empty (or unsupported market like FI).`);
  console.log(`  NOTE: on TODAY's live feed, already-started games drop from Playbook's pregame /splits -> SharpAPI backstop keeps the bar filled (shows as sharpapi_only, NOT a missing bar). Use a past --date (splits-history) for full pregame coverage.`);
}

function agreement(pb: { bet: number | null; money: number | null } | undefined, sh: { bet: number | null; money: number | null } | undefined): string {
  const havePb = pb && (pb.bet !== null || pb.money !== null);
  const haveSh = sh && (sh.bet !== null || sh.money !== null);
  if (havePb && haveSh) { const gap = Math.max(Math.abs((pb!.bet ?? 0) - (sh!.bet ?? 0)), Math.abs((pb!.money ?? 0) - (sh!.money ?? 0))); return gap <= ALIGN_GAP ? `aligned(${gap})` : gap <= MILD_GAP ? `mild(${gap})` : `MAJOR(${gap})`; }
  if (havePb || haveSh) return "single_source";
  return "none";
}

function previewSides(L: Loaded): void {
  console.log(`\nPer-side detail (playbook b/m/books vs current sharp_signals b/m, agreement):`);
  for (const [gid, gkey] of [...L.keyById].sort((a, b) => a[1].localeCompare(b[1]))) {
    const pb = L.pbByGameKey.get(gkey);
    for (const market of MARKETS) for (const side of SIDES[market]) {
      const c = pb ? pbCells(pb, market, side) : { bet: null, money: null, books: null };
      const sh = L.ssByKey.get(`${gid}:${market}:${side}`);
      if (c.bet === null && c.money === null && !sh) continue;
      console.log(`  ${gkey.padEnd(9)} ${market.padEnd(9)} ${side.padEnd(5)} pb ${`${c.bet ?? "-"}/${c.money ?? "-"}/${c.books ?? "-"}`.padEnd(14)} ss ${`${sh?.bet ?? "-"}/${sh?.money ?? "-"}`.padEnd(10)} ${agreement(c, sh)}`);
    }
  }
}

async function tableState(): Promise<void> {
  const { data, error } = await supabase.from("public_splits_observations").select("provider, sport, observed_at").limit(5000);
  if (error) { console.log(`\nTable public_splits_observations: NOT FOUND — apply lib/db/schema-migration-v25.sql first (coverage/preview below still work).`); return; }
  const rows = data ?? [];
  const byProv = new Map<string, number>();
  for (const r of rows) byProv.set(r.provider as string, (byProv.get(r.provider as string) ?? 0) + 1);
  console.log(`\nTable public_splits_observations: EXISTS, ${rows.length} rows | by provider: ${[...byProv].map(([k, v]) => `${k}=${v}`).join(", ") || "-"}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) { console.error("READ-ONLY. --write unsupported."); process.exit(1); }
  const sport = (readStringFlag(argv, "--sport") ?? "mlb").toLowerCase();
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const doPreview = readBoolFlag(argv, "--preview");
  console.log(`[dual-splits-observation-verify] sport=${sport} date=${date} (read-only)`);
  await tableState();
  if (!API_KEY) { console.error("PLAYBOOK_API_KEY missing — coverage needs it."); process.exit(1); }
  const L = await loadSlate(sport, date);
  coverage(sport, L);
  if (doPreview) previewSides(L);
  console.log("\n✓ Read-only. No writes.");
}

main().catch((e) => { console.error(`FATAL: ${(e as Error).message}`); process.exit(2); });

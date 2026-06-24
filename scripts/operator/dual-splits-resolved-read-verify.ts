/**
 * Dual-source public splits — Phase 2 resolved-read VERIFY (READ-ONLY).
 *
 * Ticket: o-dual-splits-resolved-read-ui.
 *
 * Runs resolveSlatePublicSplits over the observation table and prints, per
 * game/market, the RESOLVED display (source + bet%/money% the UI would show),
 * agreement state, and model confidence — proving the dual-source read works
 * end-to-end BEFORE any UI/DTO wiring. No writes.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/dual-splits-resolved-read-verify.ts --sport mlb --date 2026-06-24
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, todayUTC } from "./_cliCommon";
import { resolveSlatePublicSplits } from "../../lib/services/resolveSlatePublicSplits";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) { console.error("READ-ONLY."); process.exit(1); }
  const sport = (readStringFlag(argv, "--sport") ?? "mlb").toLowerCase();
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  console.log(`[dual-splits-resolved-read-verify] sport=${sport} date=${date} (read-only)`);

  const { data: teams } = await supabase.from("teams").select("id, abbreviation").eq("sport", sport);
  const abbr = new Map<number, string>();
  for (const t of teams ?? []) abbr.set(t.id as number, (t.abbreviation as string) ?? "");
  const { data: games } = await supabase.from("games").select("id, home_team_id, away_team_id").eq("sport", sport).eq("slate_date", date);
  const label = new Map<number, string>();
  for (const g of games ?? []) label.set(g.id as number, `${abbr.get(g.away_team_id as number)}@${abbr.get(g.home_team_id as number)}`);

  const cells = await resolveSlatePublicSplits({ supabase, sport, slateDate: date });
  if (cells.length === 0) { console.log("\nNo observations (table absent or empty for this slate). Run the observation sync --write first."); process.exit(0); }

  // Group by game:market.
  type Key = string;
  const byMarket = new Map<Key, typeof cells>();
  for (const c of cells) { const k = `${c.gameId}:${c.market}`; if (!byMarket.has(k)) byMarket.set(k, []); byMarket.get(k)!.push(c); }

  const conf = { high: 0, medium: 0, low: 0, none: 0 } as Record<string, number>;
  const agr = { aligned: 0, mild_disagreement: 0, major_disagreement: 0, single_source: 0, no_data: 0 } as Record<string, number>;
  const srcCount = { playbook: 0, sharpapi: 0, none: 0 } as Record<string, number>;
  let displayed = 0, total = 0;

  console.log(`\nResolved display per game/market (what the UI would show; source preferred Playbook-fresh else SharpAPI):`);
  console.log(`  game        market    side   display(src bet/money books)   agreement        confidence`);
  for (const [k, arr] of [...byMarket.entries()].sort((a, b) => (label.get(Number(a[0].split(":")[0])) ?? "").localeCompare(label.get(Number(b[0].split(":")[0])) ?? ""))) {
    const gid = Number(k.split(":")[0]); const market = k.split(":")[1];
    for (const c of arr.sort((x, y) => x.side.localeCompare(y.side))) {
      total++;
      const r = c.resolved;
      const src = r.displaySource ?? "none";
      srcCount[src] = (srcCount[src] ?? 0) + 1;
      if (r.displaySource) displayed++;
      conf[r.modelConfidence]++; agr[r.agreementState]++;
      const disp = r.displaySource ? `${src} ${r.displayBettingPct}/${r.displayMoneyPct} ${r.displayBooksUsed ?? "-"}bk` : "— (stale/none)";
      console.log(`  ${(label.get(gid) ?? gid).toString().padEnd(9)} ${market.padEnd(9)} ${c.side.padEnd(5)} ${disp.padEnd(28)} ${r.agreementState.padEnd(16)} ${r.modelConfidence}`);
    }
  }
  console.log(`\n  cells: ${total} | displayed(bar fills): ${displayed} | empty: ${total - displayed}`);
  console.log(`  display source: ${Object.entries(srcCount).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  agreement: ${Object.entries(agr).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  confidence: ${Object.entries(conf).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log("\n✓ Read-only. No writes. (Display wiring into the DTO is a separate gated step.)");
}

main().catch((e) => { console.error(`FATAL: ${(e as Error).message}`); process.exit(2); });

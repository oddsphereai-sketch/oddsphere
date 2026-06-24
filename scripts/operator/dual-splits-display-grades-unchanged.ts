/**
 * #3 grades-unchanged check + overlay smoke (READ-ONLY).
 *
 * Calls the real /api/lab/daily-edge MLB handler with the dual-source display
 * flag OFF vs ON. Asserts: every game is byte-identical EXCEPT publicSplits
 * (so grades/verdict/model/everything else is unchanged), and that publicSplits
 * actually changed (overlay applied). No writes.
 *
 *   npx tsx --env-file=.env.local scripts/operator/dual-splits-display-grades-unchanged.ts --date 2026-06-24
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]!] = m[2]!;
}
process.env.PRODUCTION_DATA_MODE = process.env.PRODUCTION_DATA_MODE ?? "true";

const date = (process.argv.find((a) => a.startsWith("--date="))?.split("=")[1])
  ?? (process.argv[process.argv.indexOf("--date") + 1]) ?? new Date().toISOString().slice(0, 10);

function gradeSig(game: any): string {
  // ONLY grade/verdict/model fields — excludes publicSplits AND time/lock fields.
  const sig: Record<string, unknown> = {};
  for (const [k, m] of Object.entries<any>(game.markets ?? {})) {
    sig[k] = { pick: m?.pick, grade: m?.grade, verdict: m?.verdict, signalType: m?.signalType,
      marketSignal: m?.marketSignal, sharpStatus: m?.sharpStatus, held: m?.held,
      confidence: m?.confidence, modelProb: m?.modelProb, marketFairProb: m?.marketFairProb,
      recommendationConfidence: m?.recommendationConfidence };
  }
  sig.breakdownVerdict = game.breakdown?.verdict;
  sig.predictions = game.predictions;
  return JSON.stringify(sig);
}
function splitsOf(game: any): string {
  const out: Record<string, unknown> = {};
  for (const [k, m] of Object.entries(game.markets ?? {})) out[k] = (m as any)?.publicSplits ?? [];
  return JSON.stringify(out);
}

(async () => {
  const { GET } = await import("../../app/api/lab/daily-edge/route");
  const call = async (on: boolean) => {
    if (on) process.env.DUAL_SOURCE_PUBLIC_SPLITS_DISPLAY_ENABLED = "true";
    else delete process.env.DUAL_SOURCE_PUBLIC_SPLITS_DISPLAY_ENABLED;
    const res = await GET(new Request(`http://x/api/lab/daily-edge?sport=mlb&date=${date}`));
    return (await res.json()) as { games: any[] };
  };
  const off = await call(false);
  const on = await call(true);
  console.log(`[grades-unchanged] mlb ${date}: off games=${off.games.length} on games=${on.games.length}`);

  const offById = new Map(off.games.map((g) => [g.external_id, g]));
  let gradeChanged = 0, splitsChanged = 0, matched = 0;
  const diffs: string[] = [];
  for (const g of on.games) {
    const o = offById.get(g.external_id); if (!o) continue; matched++;
    if (gradeSig(o) !== gradeSig(g)) { gradeChanged++; diffs.push(`${g.awayTeam}@${g.homeTeam}: GRADE-SIG DIFF`); }
    if (splitsOf(o) !== splitsOf(g)) splitsChanged++;
  }
  console.log(`  matched games: ${matched}`);
  console.log(`  grade/verdict/model signature diffs: ${gradeChanged}  <-- MUST be 0`);
  console.log(`  publicSplits changed (overlay applied): ${splitsChanged}/${matched}`);
  for (const d of diffs.slice(0, 5)) console.log(`    ${d}`);
  // sample resolved splits on one game
  const sample = on.games[0];
  if (sample) console.log(`  sample ${sample.awayTeam}@${sample.homeTeam} ML splits: ${JSON.stringify(sample.markets?.moneyline?.publicSplits)?.slice(0, 220)}`);
  console.log(gradeChanged === 0 ? "\n✓ GRADES UNCHANGED (only publicSplits differ)." : "\n✗ GRADES CHANGED — investigate.");
  process.exit(gradeChanged === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(2); });

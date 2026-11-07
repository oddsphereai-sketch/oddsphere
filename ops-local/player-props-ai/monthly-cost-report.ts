/** Local measured-load projections. Does not schedule reviews or authorize a live budget. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bill, type Model } from "./validation";
import { invariant } from "./core";
type Profile = { sport: string; model: Model; suitableForLoadProjection: boolean; parts: { inputTokens: number; scopes: number }[] };
export function allocation(costs: { primary: number; upgrade: number }[], ceiling = 50) {
  invariant(Number.isFinite(ceiling) && ceiling >= 0 && costs.every(c => [c.primary, c.upgrade].every(v => Number.isFinite(v) && v >= 0)), "Invalid monthly cost bounds");
  const reserve = 5, allowance = 1.2, base = costs.reduce((n, c) => n + 2 * c.primary, 0);
  const upgrades = costs.map(c => c.upgrade).sort((a, b) => b - a).slice(0, Math.floor(costs.length * 0.1));
  let affordable = 0, extra = 0;
  for (const cost of upgrades) {
    if ((base + extra + cost) * allowance + reserve > ceiling) break;
    extra += cost; affordable++;
  }
  return { games: costs.length, logicalReviews: costs.length * 2, primaryOnly: base * allowance + reserve,
    fixedTenPercent: (base + upgrades.reduce((a, b) => a + b, 0)) * allowance + reserve,
    adaptive: (base + extra) * allowance + reserve, affordableStrongerFinals: affordable,
    affordableStrongerFraction: costs.length ? affordable / costs.length : 0, primaryFits: base * allowance + reserve <= ceiling };
}
function main() {
  const [profilesFile, calendarFile, receiptsRoot, out] = process.argv.slice(2);
  invariant(out?.startsWith("/private/tmp/"), "Private NEW output path required");
  const source = JSON.parse(readFileSync(profilesFile, "utf8")); invariant(source.complete && !source.errors.length, "Incomplete profiles");
  const profiles = source.profiles as Profile[];
  const observed: Record<string, number[]> = { nba: [], nfl: [], mlb: [] };
  const samples: { file: string; sport: string; scopes: number; output: number }[] = [];
  for (const name of readdirSync(receiptsRoot)) {
    if (!/^(nba_full_day_probabilistic_luna_r7_g\d+_p\d+|nfl_full_probabilistic_luna_r7_part\d+|mlb_full_probabilistic_luna_r7_part\d+|nba_current_required_scopes_terra_r5)\.response\.json$/.test(name)) continue;
    const file = path.join(receiptsRoot, name), receipt = JSON.parse(readFileSync(file, "utf8"));
    const request = JSON.parse(readFileSync(file.replace(/\.json$/, ".request.json"), "utf8"));
    const input = JSON.parse(request.body.input), scopes = input.players.reduce((n: number, p: { markets: string[] }) => n + p.markets.length, 0);
    observed[input.sport].push(receipt.response.usage.output_tokens / scopes);
    samples.push({ file, sport: input.sport, scopes, output: receipt.response.usage.output_tokens });
  }
  const density = Object.fromEntries(Object.entries(observed).map(([sport, v]) => { invariant(v.length, `Missing measured ${sport} output`); return [sport, Math.ceil(Math.max(...v))]; }));
  const costs: Record<string, { mean: number; maximum: number; meanDoubleOutput: number; cappedOutput: number; sampledGames: number }> = {};
  for (const sport of Object.keys(observed)) {
    const selected = profiles.filter(p => p.sport === sport && p.model === "gpt-6-luna" && p.suitableForLoadProjection);
    invariant(selected.length > 0, `No complete load profiles for ${sport}`);
    const price = (p: Profile, scale: number, capped = false) => p.parts.reduce((n, part) => n + bill("gpt-6-luna", { input: part.inputTokens, output: capped ? 16000 : Math.ceil(part.scopes * density[sport] * scale) }), 0);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    costs[sport] = { mean: mean(selected.map(p => price(p, 1))), maximum: Math.max(...selected.map(p => price(p, 1))),
      meanDoubleOutput: mean(selected.map(p => price(p, 2))), cappedOutput: mean(selected.map(p => price(p, 1, true))), sampledGames: selected.length };
  }
  const calendar = JSON.parse(readFileSync(calendarFile, "utf8"));
  const months = calendar.months.map((m: { month: string; fullCalendarAvailable: boolean; counts: Record<string, number>; maxGamesInDay: number }) => {
    invariant(m.fullCalendarAvailable, "Incomplete monthly calendar");
    const scenario = (key: "mean" | "maximum" | "meanDoubleOutput" | "cappedOutput") => allocation(Object.entries(m.counts).flatMap(([sport, n]) => Array.from({ length: n }, () => ({ primary: costs[sport][key], upgrade: 9 * costs[sport][key] }))));
    return { month: m.month, counts: m.counts, maxGamesInDay: m.maxGamesInDay, measuredDensity: scenario("mean"),
      allGamesAtLargestSample: scenario("maximum"), doubleObservedOutput: scenario("meanDoubleOutput"), everyRequestAt16000Output: scenario("cappedOutput") };
  });
  const ledger = JSON.parse(readFileSync(path.join(receiptsRoot, "ledger.json"), "utf8"));
  const report = { generatedAt: new Date().toISOString(), inputProfiles: profilesFile, calendar: calendarFile, density, costs, samples, months,
    test: { knownUsd: ledger.attempts.reduce((n: number, a: { actualUsd: number | null }) => n + (a.actualUsd ?? 0), 0), unknownReserveUsd: ledger.attempts.reduce((n: number, a: { actualUsd: number | null; reservedUsd: number }) => n + (a.actualUsd === null ? a.reservedUsd : 0), 0), ceilingUsd: ledger.ceilingUsd, attempts: ledger.attempts.length },
    assumptions: ["Two final-sized reviews per game; all catalog scopes, no hourly generation", "Per-request billing, no cache/read or Batch discount; explicit no-write configuration must be verified", "Largest observed total output per scope by sport, including stronger NBA output; output stress separately reported", "Stronger output density assumed equal: measured once on NBA, NFL/MLB stronger behavior not yet established", "20% cost allowance and $5 monthly evaluation reserve included", "10% stronger upgrade chooses highest-cost sport first; a replacement final, never a third review", "Calendar counts are complete selected 2026 month analogs, not a bound for every future month", "Typical loads sampled; expanded history, postseason context, retries, overtime slates and future product scope can exceed them", "Existing data, hosting/database, taxes and other AI products excluded"],
    productionReady: false, qualityGaps: ["One of nine current NBA games failed physical projection consistency", "Current NBA sample is prospective but outcomes are pending; NFL/MLB cost rehearsals do not prove accuracy", "New NFL passing-TD/INT heads and executable prices not qualified", "Joint-law, calibration and grade/stake adapters not qualified", "No production monthly cap/reservation or scheduler deployed"] };
  writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ out, density, months: months.map((m: { month: string; measuredDensity: unknown; doubleObservedOutput: unknown }) => ({ month: m.month, measuredDensity: m.measuredDensity, doubleObservedOutput: m.doubleObservedOutput })), test: report.test }));
}
if (process.argv[1]?.endsWith("monthly-cost-report.ts")) main();

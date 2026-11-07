/** Current full-source joint-forecast cost replay. Offline; private artifacts only. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { etDate, invariant } from "../../lib/playerPropsAi/evidence";
import { usageMicroUsd } from "../../lib/playerPropsAi/budget";
import { reviewSlots } from "../../lib/playerPropsAi/schedule";
import { PROPS_AI_RELEASE, PROPS_AI_MAX_INPUT_PER_REQUEST, PROPS_AI_MAX_OUTPUT_PER_REQUEST } from "../../lib/playerPropsAi/releases";
import { forecastCostPlan, type CostSlot } from "./forecast-cost-plan";
type Sport = "nba" | "nfl" | "mlb";
type Profile = { sport: Sport; players: number; scopes: number; parts: { inputTokens: number; players: number }[] };
type Game = { sport: Sport; id: string; start: string };
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const [profilesFile, calendarFile, receiptsRoot, boundaryFile, out] = process.argv.slice(2);
invariant(out?.startsWith("/private/tmp/"), "Private NEW report path required");
const source = read(profilesFile) as { complete: boolean; errors: unknown[]; profiles: Profile[] };
invariant(source.complete && !source.errors.length && source.profiles.length > 0, "Incomplete full-source profiles");
const density: Record<Sport, number> = { nba: 0, nfl: 0, mlb: 0 }, samples = [];
for (const sport of Object.keys(density) as Sport[]) {
  const result = read(path.join(receiptsRoot, `${sport}_physical_rows_r11_20261107.joint-result.json`));
  invariant(result.allProcessChecksPassed && result.reviewedPlayers === result.players, "Unaccepted reference forecasts");
  for (const r of result.receipts) {
    const saved = read(r.file), request = read(r.file.replace(/\.json$/, ".request.json")).body;
    invariant(saved.response.status === "completed" && r.qualityError === null, "Incomplete/invalid reference receipt");
    const players = JSON.parse(request.input).document.players.length;
    density[sport] = Math.max(density[sport], saved.response.usage.output_tokens / players);
    samples.push({ sport, players, input: r.input, output: r.output, usd: r.cost, receipt: r.file });
  }
}
const price = (input: number, output: number, tier?: string) => usageMicroUsd("gpt-6-luna", { input_tokens: input, output_tokens: output }, tier);
const costs = Object.fromEntries((Object.keys(density) as Sport[]).map(sport => {
  const profiles = source.profiles.filter(p => p.sport === sport); invariant(profiles.length > 0, `Missing ${sport} profiles`);
  const expected = profiles.map(p => p.parts.reduce((n, part) => {
    const output = Math.ceil(density[sport] * part.players);
    invariant(output <= PROPS_AI_MAX_OUTPUT_PER_REQUEST && part.inputTokens <= PROPS_AI_MAX_INPUT_PER_REQUEST, "Profile exceeds request envelope");
    return n + price(part.inputTokens, output);
  }, 0));
  const capped = profiles.map(p => p.parts.reduce((n, part) => n + price(part.inputTokens + 2048, PROPS_AI_MAX_OUTPUT_PER_REQUEST), 0));
  const expectedFlex = profiles.map(p => p.parts.reduce((n, part) => n + price(part.inputTokens, Math.ceil(density[sport] * part.players), "flex"), 0));
  const cappedFlex = profiles.map(p => p.parts.reduce((n, part) => n + price(part.inputTokens + 2048, PROPS_AI_MAX_OUTPUT_PER_REQUEST, "flex"), 0));
  const mean = (v: number[]) => Math.ceil(v.reduce((a, b) => a + b, 0) / v.length);
  const maxParts = Math.max(...profiles.map(p => p.parts.length));
  const strongBound = maxParts * usageMicroUsd("gpt-6.1-terra", { input_tokens: PROPS_AI_MAX_INPUT_PER_REQUEST + 2048, output_tokens: PROPS_AI_MAX_OUTPUT_PER_REQUEST });
  return [sport, { samples: profiles.length, expectedMicro: mean(expected), meanCappedMicro: mean(capped), largestCappedMicro: Math.max(...capped), expectedFlexMicro: mean(expectedFlex), meanCappedFlexMicro: mean(cappedFlex), largestCappedFlexMicro: Math.max(...cappedFlex), strongBoundMicro: strongBound, maxParts }];
})) as Record<Sport, { samples: number; expectedMicro: number; meanCappedMicro: number; largestCappedMicro: number; expectedFlexMicro: number; meanCappedFlexMicro: number; largestCappedFlexMicro: number; strongBoundMicro: number; maxParts: number }>;
const calendar = read(calendarFile);
const games: Game[] = calendar.months.flatMap((m: { games: Game[]; fullCalendarAvailable: boolean }) => { invariant(m.fullCalendarAvailable, "Incomplete published calendar"); return m.games; });
// Prior ET December 31 can have final reviews in UTC January. Retain those slots too.
for (const event of read(boundaryFile).events) games.push({ sport: "nba", id: event.id, start: event.date });
const identities = new Set<string>();
for (const game of games) { const key = `${game.sport}|${game.id}|${etDate(game.start)}`; invariant(!identities.has(key), "Duplicate calendar game date"); identities.add(key); }
const schedulingExceptions: { sport: Sport; id: string; start: string; error: string }[] = [];
const slots = games.flatMap(g => {
  try { return reviewSlots({ ...g, lock: new Date(Date.parse(g.start) - 3600000).toISOString() }); }
  catch (error) {
    schedulingExceptions.push({ ...g, error: (error as Error).message });
    // Published TBD/midnight placeholders still consume two cost obligations. These
    // are NOT executable jobs; actual start/lock clocks must be resolved before launch.
    return (["early", "final"] as const).map(stage => ({ key: `cost-only|${g.sport}|${g.id}|${etDate(g.start)}|${stage}`, sport: g.sport, gameId: g.id,
      gameDay: etDate(g.start), start: g.start, lock: g.start, dueAt: g.start, stage, billingMonth: g.start.slice(0, 7) }));
  }
});
const months = calendar.months.map((month: { month: string; counts: Record<Sport, number>; maxGamesInDay: number }) => {
  const selected = slots.filter(s => s.billingMonth === month.month);
  const flexKey = { expectedMicro: "expectedFlexMicro", meanCappedMicro: "meanCappedFlexMicro", largestCappedMicro: "largestCappedFlexMicro" } as const;
  const quote = (key: "expectedMicro" | "meanCappedMicro" | "largestCappedMicro", strongBound = false): CostSlot[] => selected.map(s => ({ key: s.key, stage: s.stage,
    standardMicro: costs[s.sport][key], flexMicro: costs[s.sport][flexKey[key]], strongerMicro: strongBound ? costs[s.sport].strongBoundMicro : 10 * costs[s.sport][key] }));
  return { month: month.month, etGameCounts: month.counts, maxGamesInDay: month.maxGamesInDay,
    standardObservedDensity: forecastCostPlan(quote("expectedMicro"), { earlyFlex: false }),
    flexObservedDensity: forecastCostPlan(quote("expectedMicro", true)),
    flexMeanInputFullOutput: forecastCostPlan(quote("meanCappedMicro", true)),
    flexAllLargestInputFullOutput: forecastCostPlan(quote("largestCappedMicro", true)),
    flexUnavailableEveryEarlyReview: forecastCostPlan(quote("largestCappedMicro", true), { fallbackFraction: 1 }) };
});
const ledger = read(path.join(receiptsRoot, "ledger.json")) as { ceilingUsd: number; attempts: { actualUsd: number | null; reservedUsd: number }[] };
const knownUsd = ledger.attempts.reduce((n, a) => n + (a.actualUsd ?? 0), 0), unknownHeldUsd = ledger.attempts.reduce((n, a) => n + (a.actualUsd === null ? a.reservedUsd : 0), 0);
invariant(knownUsd + unknownHeldUsd <= ledger.ceilingUsd && ledger.ceilingUsd === 2, "Test cap exceeded");
const report = { generatedAt: new Date().toISOString(), release: PROPS_AI_RELEASE, profilesFile, calendarFile, boundaryFile, costs, density, samples, months, schedulingExceptions,
  test: { knownUsd, unknownHeldUsd, totalHeldUsd: knownUsd + unknownHeldUsd, ceilingUsd: ledger.ceilingUsd },
  assumptions: ["Published 2026 game calendar, all supported mainstream markets and offered players; NBA/NFL preseason included, MLB spring/exhibition excluded",
    "UTC billing allocation uses existing two-window schedule and an illustrative lock sixty minutes before start; live calendars must use each actual lock",
    "Calendar rows with no executable same-day windows retain both cost obligations in the published UTC start month and are listed as schedulingExceptions; they are not executable jobs",
    "Includes prior ET December 31 NBA reviews crossing into UTC January; published schedules can later change; original and rescheduled dates are retained conservatively as separate two-review obligations",
    "Two final-sized full-source reviews per game; no hourly generation and no third stronger review",
    "Primary models: early Luna Flex, final Luna Standard; stronger optional replacement uses Terra Standard",
    "Flex confirmed in the complete NFL rehearsal only; NBA/MLB Flex reliability and full-game Terra completion remain untested",
    "Every capped scenario includes 2048 input-token headroom per request and the entire 7000-token output allowance",
    "Strong cost envelope uses the maximum request input/output bounds and largest partition count sampled per sport; upgrade eligibility requires actual independent strong token counts",
    "No cache-read savings; explicit no-write prompt configuration and ordinary short-context pricing; unknown tier billed Standard conservatively",
    "Core funds precede upgrades: two reviews, additional Standard attempts for ten percent of early games, plus three dollars of recovery reserve",
    "Most expensive eligible finals consume upgrade envelope first as adverse cost accounting; actual need-based selection is separate",
    "Finite sample envelopes are NOT future workload guarantees; unbounded data, more partitions, Flex shortages/retries, calendar changes or longer model output can exceed them",
    "No silent reduction of games, players or markets; if the complete primary plan cannot fit, report it before enabling that month",
    "Model API cost only; existing sports-data subscriptions, hosting/database, taxes and other API products excluded"],
  productionReady: false, remainingEngineering: ["Replace obsolete fixed per-sport wallet reservations with actual full-calendar request envelopes", "Persist service tier, fallback eligibility, exact UTC obligations and rolling remaining-month funding in the atomic wallet", "Refresh complete live sources through the existing sport writer/lease and preserve locked payloads exactly", "Validate full-game stronger-model completion and deadline-safe early Flex recovery before enabling it"] };
writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ out, costs, test: report.test, months: months.map((m: { month: string; standardObservedDensity: ReturnType<typeof forecastCostPlan>; flexAllLargestInputFullOutput: ReturnType<typeof forecastCostPlan> }) => ({ month: m.month, standardTenPercentUsd: m.standardObservedDensity.fixedTenPercentMicro / 1e6, conservativeCoreUsd: m.flexAllLargestInputFullOutput.coreMicro / 1e6, conservativeAdaptiveUsd: m.flexAllLargestInputFullOutput.adaptiveMicro / 1e6, strongerFinals: m.flexAllLargestInputFullOutput.affordableStrongerFinals, primaryFits: m.flexAllLargestInputFullOutput.primaryFits })) }));

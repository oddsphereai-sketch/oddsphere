import { createHash } from "node:crypto";
import { CBB_CURRENT_SCORE_RELEASE,CBB_PREVIOUS_CURRENT_SCORE_RELEASE } from "./currentScoreRuntime";
import { cbbEvidenceAvailableAt, cbbAvailabilityUpperBoundMs } from "./marketReceiptTime";
import { normalCdf } from "./model";
import type { CbbForecast, CbbMarket, CbbQuote } from "./types";

export const CBB_RETAINED_LEVEL_INPUT_RELEASE = "cbb_retained_level_input_2026_11_03_r1" as const;
export const CBB_RETAINED_LEVEL_INPUT_MAX_BYTES = 16 * 1024;
type AttestedQuote = CbbQuote & { orientationVerified?: boolean };
export type CbbRetainedLevelQuarantine = { book: string; market: CbbMarket; sourceAt?: string; reason: string };
/** These rejections occur only after exact fixture and current response-clock
 * qualification. The normalizer did not retain an axis/time descriptor, so
 * preserve family uncertainty rather than inventing a current contract. */
export function cbbRetainedNormalizationQuarantine(rejected:Array<{book:string|null;reason:string}>):CbbRetainedLevelQuarantine[]{
  return rejected.filter(row=>row.book&&["incoherent_quote","ambiguous_or_incomplete_selection_pair","conflicting_same_book_market"].includes(row.reason))
    .flatMap(row=>(["moneyline","spread","total"] as const).map(market=>({book:row.book!,market,reason:`qualified_current_normalization_${row.reason}`})));
}
type Completeness = { price: boolean; split: boolean };
type InputBody = {
  release: typeof CBB_RETAINED_LEVEL_INPUT_RELEASE;
  authority: "as_of_input_only_no_forecast_path_calibration_or_grade_authority";
  gameId: number; startsAt: string; asOf: string; hoursToStart: number;
  independent: CbbForecast; independentInputKey: string;
  sourceQuotes: AttestedQuote[]; targets: AttestedQuote[];
  excludedTargetFamilies: string[]; excludedQuarantinedFamilies: string[];
  quarantinedSources: CbbRetainedLevelQuarantine[];
  historyCompleteness: Completeness | null;
  historyStatus: "provided" | "unknown_not_recorded";
};
export type CbbRetainedLevelInput = InputBody & { sha256: string };
export type CbbRetainedLevelInputArgs = {
  existing?: unknown; independent: CbbForecast; independentInputKey: string;
  startsAt: string; asOf: string; sourceQuotes: AttestedQuote[]; targets: AttestedQuote[];
  quarantinedSources?: CbbRetainedLevelQuarantine[]; historyCompleteness?: Completeness;
};
export type CbbRetainedLevelInputResult = {
  /** Existing values, including invalid legacy values, always retain identity. */
  checkpoint: unknown | null;
  disposition: "captured" | "preserved_valid" | "preserved_invalid" | "unavailable";
  reason: string; bytes: number | null;
};
const family = (book: string) => {
  const key = book.trim().toLowerCase();
  return key === "ps3838" ? "pinnacle" : key;
};
const professional = new Set(["circa", "pinnacle", "bookmaker"]);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const clock = (x: unknown) => typeof x === "string" ? Date.parse(x) : NaN;
const upperClock = (x: unknown) => typeof x === "string" ? cbbAvailabilityUpperBoundMs(x) : NaN;
const availableAt = (q: AttestedQuote) => q.canonicalReceipt === undefined ? upperClock(q.fetchedAt) : cbbEvidenceAvailableAt(q);
const positiveId = (x: number) => Number.isSafeInteger(x) && x > 0;
const probability = (price: number) => price < 0 ? -price / (100 - price) : 100 / (100 + price);
const tuple = (q: AttestedQuote) => JSON.stringify([q.line, q.firstPrice, q.secondPrice]);
/** Sorted JSON makes the content binding independent of object-key insertion order. */
function canonical(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Nonfinite retained input");
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Non-JSON retained input");
  return result;
}
const digest = (body: InputBody) => createHash("sha256").update(canonical(body)).digest("hex");
function byteSize(value: unknown): number | null {
  try { const json = JSON.stringify(value); return json === undefined ? null : Buffer.byteLength(json, "utf8"); } catch { return null; }
}
function validForecast(f: CbbForecast, asOf: string): boolean {
  if (!f || ![CBB_CURRENT_SCORE_RELEASE,CBB_PREVIOUS_CURRENT_SCORE_RELEASE].includes(f.release as typeof CBB_CURRENT_SCORE_RELEASE) || f.inputStatus !== "complete" || !positiveId(f.gameId) ||
    !positiveId(f.homeId) || !positiveId(f.awayId) || f.homeId === f.awayId || clock(f.asOf) !== clock(asOf) ||
    !Array.isArray(f.issues) || !f.issues.every(issue => typeof issue === "string")) return false;
  if (![f.homeScore, f.awayScore, f.margin, f.total, f.possessions, f.homeWinProbability].every(finite) ||
    f.homeScore <= 0 || f.awayScore <= 0 || f.possessions <= 0 || f.homeWinProbability <= 0 || f.homeWinProbability >= 1 ||
    Math.abs(f.homeScore + f.awayScore - f.total) > 1e-8 || Math.abs(f.homeScore - f.awayScore - f.margin) > 1e-8) return false;
  const u = f.uncertainty;
  if (!u || ![u.marginSd, u.totalSd, u.marginTotalCorrelation, u.marginCorrection, u.totalCorrection].every(finite) ||
    u.marginSd <= 0 || u.totalSd <= 0) return false;
  const zero = normalCdf((.5-f.margin)/u.marginSd)-normalCdf((-.5-f.margin)/u.marginSd);
  const home = (1-normalCdf((.5-f.margin)/u.marginSd))/(1-zero);
  return Math.abs(home-f.homeWinProbability) <= 1e-8 &&
    u.marginSd > 0 && u.totalSd > 0 && Math.abs(u.marginTotalCorrelation) <= 1 &&
    Number.isSafeInteger(u.fitThroughSeason) && u.fitThroughSeason > 0 && Number.isSafeInteger(u.games) && u.games > 0;
}
/** Identity/receipt eligibility is separate from contract validity: an invalid
 * latest native price must not cause silent fallback to an older valid one. */
function recognizable(q: AttestedQuote, gameId: number, at: number, target=false): boolean {
  // BDL targets are joined by the provider's native canonical game ID and
  // explicit home/away fields. Preserve their absent named-team attestation;
  // never manufacture orientationVerified or relax professional-source proof.
  const orientation=q?.orientationVerified===true || target && q?.provider==="balldontlie" && q.orientationVerified===undefined;
  if (!q || q.gameId !== gameId || !orientation || q.phase !== "current" ||
    !["owls", "sharpapi", "balldontlie"].includes(q.provider ?? "") || typeof q.sportsbook !== "string" || !q.sportsbook.trim() ||
    !["moneyline", "spread", "total"].includes(q.market) || q.canonicalReceipt === null) return false;
  const observed = upperClock(q.providerObservedAt), available = availableAt(q);
  return Number.isFinite(observed) && Number.isFinite(available) && observed <= available && available <= at &&
    at - clock(q.providerObservedAt) <= 3600_000 && (q.requestedAt === undefined || Number.isFinite(clock(q.requestedAt)) && clock(q.requestedAt) <= clock(q.fetchedAt));
}
function validContract(q: AttestedQuote): boolean {
  if (![q.firstPrice, q.secondPrice].every(p => finite(p) && Math.abs(p) >= 100)) return false;
  if (q.market === "moneyline" ? q.line !== null : !finite(q.line) || !Number.isInteger(q.line * 2) || q.market === "total" && q.line <= 0) return false;
  const hold = probability(q.firstPrice) + probability(q.secondPrice);
  return hold >= .98 && hold <= 1.3;
}
function complete(value: unknown): value is Completeness {
  return !!value && typeof value === "object" && typeof (value as Completeness).price === "boolean" && typeof (value as Completeness).split === "boolean";
}
function buildBody(args: Omit<CbbRetainedLevelInputArgs, "existing">): { body: InputBody | null; reason: string } {
  const at = clock(args.asOf), start = clock(args.startsAt), f = args.independent;
  if (!Number.isFinite(at) || !Number.isFinite(start) || at >= start - 3600_000) return { body: null, reason: "not_open_pre_t60" };
  if (!validForecast(f, args.asOf) || typeof args.independentInputKey !== "string" || !args.independentInputKey.trim())
    return { body: null, reason: "invalid_pristine_r3_input" };
  if (!Array.isArray(args.targets) || !args.targets.length || args.targets.some(q =>
    !recognizable(q, f.gameId, at,true) || !validContract(q) || q.canonicalReceipt !== undefined)) return { body: null, reason: "invalid_current_targets" };
  if (!Array.isArray(args.sourceQuotes) || args.historyCompleteness !== undefined && !complete(args.historyCompleteness))
    return { body: null, reason: "invalid_evidence_metadata" };
  const quarantinedSources = [...args.quarantinedSources ?? []];
  if (!Array.isArray(quarantinedSources) || quarantinedSources.some(q => !q || typeof q.book !== "string" || !q.book.trim() ||
    !["moneyline", "spread", "total"].includes(q.market) || typeof q.reason !== "string" || !q.reason ||
    q.sourceAt !== undefined && (!Number.isFinite(clock(q.sourceAt)) || clock(q.sourceAt) > at))) return { body: null, reason: "invalid_quarantine_metadata" };
  const excludedTargetFamilies = [...new Set(args.targets.map(q => family(q.sportsbook)))].sort();
  // Known physical-family quarantine persists across contracts and both axes.
  let excludedQuarantinedFamilies = [...new Set(quarantinedSources.map(q => family(q.book)))].sort();
  const excluded = new Set([...excludedTargetFamilies, ...excludedQuarantinedFamilies]);
  const groups = new Map<string, AttestedQuote[]>();
  for (const q of args.sourceQuotes) {
    if (!recognizable(q, f.gameId, at) || !professional.has(family(q.sportsbook)) || excluded.has(family(q.sportsbook)) || q.market === "moneyline") continue;
    // A verified direct response establishes its own point-level state despite
    // missing history. A native-history-derived state needs a complete price
    // window to assert that it is the current retained frontier.
    if (q.canonicalReceipt !== undefined && args.historyCompleteness?.price !== true) continue;
    const key = `${family(q.sportsbook)}:${q.market}`;
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  const sourceQuotes: AttestedQuote[] = [];
  // A contradiction anywhere in the supplied actual history remains known;
  // a later clean state cannot silently rehabilitate that physical source.
  for (const [key, rows] of groups) {
    const frames=new Map<number,Set<string>>();
    for (const q of rows) {const at=clock(q.providerObservedAt), values=frames.get(at)??new Set<string>(); values.add(tuple(q)); frames.set(at,values);}
    for (const [at, values] of frames) if (values.size>1) {
      const [book,market]=key.split(":"); excluded.add(book);
      quarantinedSources.push({book,market:market as CbbMarket,sourceAt:rows.find(q=>clock(q.providerObservedAt)===at)!.providerObservedAt,reason:"same_source_time_conflict_persistent_quarantine"});
    }
  }
  excludedQuarantinedFamilies=[...new Set(quarantinedSources.map(q=>family(q.book)))].sort();
  for (const [, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (excluded.has(family(rows[0].sportsbook))) continue;
    const latestAt = Math.max(...rows.map(q => clock(q.providerObservedAt))), latest = rows.filter(q => clock(q.providerObservedAt) === latestAt);
    if (latest.some(q => !validContract(q)) || new Set(latest.map(tuple)).size !== 1) continue;
    // Equivalent source receipts retain the actual latest available response.
    sourceQuotes.push(latest.reduce((a, b) => availableAt(b) > availableAt(a) ? b : a));
  }
  if (!["spread", "total"].every(market => sourceQuotes.some(q => q.market === market))) return { body: null, reason: "joint_qualified_spread_total_unavailable" };
  return { reason: "first_qualified_as_of_input", body: {
    release: CBB_RETAINED_LEVEL_INPUT_RELEASE, authority: "as_of_input_only_no_forecast_path_calibration_or_grade_authority",
    gameId: f.gameId, startsAt: args.startsAt, asOf: args.asOf, hoursToStart: (start - at) / 3600_000,
    independent: f, independentInputKey: args.independentInputKey, sourceQuotes, targets: args.targets,
    excludedTargetFamilies, excludedQuarantinedFamilies, quarantinedSources,
    historyCompleteness: args.historyCompleteness ?? null, historyStatus: args.historyCompleteness === undefined ? "unknown_not_recorded" : "provided",
  } };
}
function validExisting(existing: unknown, args: CbbRetainedLevelInputArgs): boolean {
  try {
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
    const { sha256, ...body } = existing as CbbRetainedLevelInput;
    if (body.release !== CBB_RETAINED_LEVEL_INPUT_RELEASE || body.authority !== "as_of_input_only_no_forecast_path_calibration_or_grade_authority" ||
      body.gameId !== args.independent.gameId || body.startsAt !== args.startsAt || clock(body.asOf) > clock(args.asOf) ||
      typeof sha256 !== "string" || sha256 !== digest(body) || (byteSize(existing) ?? Infinity) > CBB_RETAINED_LEVEL_INPUT_MAX_BYTES) return false;
    const rebuilt = buildBody({ ...body, historyCompleteness: body.historyCompleteness ?? undefined });
    return !!rebuilt.body && canonical(rebuilt.body) === canonical(body);
  } catch { return false; }
}
/** Retention only: no model invocation, forecast generation, fitting, grades,
 * provider calls or writes. The leased caller owns persistence and lock guards. */
export function retainCbbLevelInput(args: CbbRetainedLevelInputArgs): CbbRetainedLevelInputResult {
  if (args.existing !== undefined && args.existing !== null) {
    const valid = validExisting(args.existing, args);
    return { checkpoint: args.existing, disposition: valid ? "preserved_valid" : "preserved_invalid", reason: valid ? "immutable_first_input" : "immutable_prior_failed_validation", bytes: byteSize(args.existing) };
  }
  try {
    const result = buildBody(args);
    if (!result.body) return { checkpoint: null, disposition: "unavailable", reason: result.reason, bytes: null };
    // JSON is the actual persisted representation; never truncate evidence.
    canonical(result.body); // Reject nonfinite/non-JSON extras before serialization can silently change them.
    const body = JSON.parse(JSON.stringify(result.body)) as InputBody;
    const checkpoint: CbbRetainedLevelInput = { ...body, sha256: digest(body) }, bytes = byteSize(checkpoint);
    if (bytes === null || bytes > CBB_RETAINED_LEVEL_INPUT_MAX_BYTES) return { checkpoint: null, disposition: "unavailable", reason: "input_checkpoint_exceeds_16kib", bytes };
    return { checkpoint, disposition: "captured", reason: result.reason, bytes };
  } catch { return { checkpoint: null, disposition: "unavailable", reason: "invalid_or_non_json_input", bytes: null }; }
}

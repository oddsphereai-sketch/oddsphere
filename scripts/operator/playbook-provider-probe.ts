/**
 * Playbook API — read-only SHADOW COVERAGE AUDIT.
 *
 * Ticket: o-playbook-shadow-audit (ops-local/overhaul-todos.json).
 * Source of truth: docs/ODDSPHERE_PRODUCT_DATA_OPERATING_PLAN.md
 *                  docs/ODDSPHERE_THIS_MORNING_EXECUTION_BRIEF.md
 *
 * Drives the typed read-only PlaybookClient (lib/providers/playbook) to
 * answer, per the operating plan: which sports/markets does Playbook cover
 * on a real slate, how well does it match the OddSphere slate, is booksUsed
 * populated, and what is the request burn.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/playbook-provider-probe.ts \
 *     [--date YYYY-MM-DD] [--json] [--base-url https://www.oddsphereai.com] \
 *     [--history]
 *
 * SAFETY CONTRACT:
 *   - READ-ONLY. No DB writes, no production-table writes, no UI/grading/
 *     line-movement changes. Reads our games/teams ONLY for match rate.
 *   - Key read ONLY from process.env.PLAYBOOK_API_KEY. Never hardcoded,
 *     never printed/logged/echoed. redact() strips it from every output line.
 *   - Playbook lines are CONSENSUS; splits are bet%/money% only. This audit
 *     never labels them +EV/steam/RLM/Pinnacle/CLV.
 */

import { supabase } from "../../lib/db/supabase";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";
import { readStringFlag, readBoolFlag, todayUTC } from "./_cliCommon";
import { PlaybookClient, PlaybookClientError } from "../../lib/providers/playbook/playbookClient";
import type {
  PlaybookSplitsResponse,
  PlaybookLinesResponse,
  PlaybookSplitGame,
  PlaybookLineGame,
  PlaybookMe,
} from "../../lib/providers/playbook/types";

// Documented splits/lines league enum + homepage-marketed extras + aliases.
const LEAGUES_DOCUMENTED = ["mlb", "nba", "nhl", "nfl", "ncaaf", "ncaab"];
const LEAGUES_PROBE_EXTRA = ["wnba", "mls", "cfb", "cbb"];

const API_KEY = process.env.PLAYBOOK_API_KEY ?? "";

function redact(s: string): string {
  let out = s;
  if (API_KEY) out = out.split(API_KEY).join("***REDACTED***");
  out = out.replace(/api_key=[^&\s"']+/gi, "api_key=***REDACTED***");
  return out;
}
function log(s = ""): void {
  console.log(redact(s));
}
function err(s: string): void {
  console.error(redact(s));
}

// ─────────────────────────────────────────────────────────────────────────
// Per-endpoint probe (via the typed client)
// ─────────────────────────────────────────────────────────────────────────

type ProbeResult<T = unknown> = {
  endpoint: string;
  ok: boolean;
  status: number | null;
  count: number | null;
  dataShape: "array" | "object" | "n/a";
  requestsRemaining: number | null;
  freshnessFields: string[];
  sample: unknown[];
  raw?: T;
  error?: string;
};

const FRESHNESS_KEY_HINTS = [
  "updated", "updatedat", "lastupdated", "timestamp", "fetched",
  "asof", "as_of", "generated", "retrieved", "freshness", "starttime",
];

function findFreshnessFields(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const found: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    const path = prefix ? `${prefix}.${k}` : k;
    if (FRESHNESS_KEY_HINTS.some((h) => lk.includes(h))) found.push(path);
    if (v && typeof v === "object" && !Array.isArray(v)) found.push(...findFreshnessFields(v, path));
  }
  return found;
}

/** Run a single client call, normalizing success/failure into ProbeResult. */
async function probe<T>(
  label: string,
  call: () => Promise<{ status: number; body: T; requestsRemaining: number | null }>
): Promise<ProbeResult<T>> {
  const res: ProbeResult<T> = {
    endpoint: label, ok: false, status: null, count: null,
    dataShape: "n/a", requestsRemaining: null, freshnessFields: [], sample: [],
  };
  try {
    const r = await call();
    res.status = r.status;
    res.ok = r.status >= 200 && r.status < 300;
    res.requestsRemaining = r.requestsRemaining;
    res.raw = r.body;
    const body = r.body as unknown;
    const data = (body as { data?: unknown })?.data;
    if (Array.isArray(data)) {
      res.dataShape = "array";
      const cnt = (body as { count?: number })?.count;
      res.count = typeof cnt === "number" ? cnt : data.length;
      res.sample = data.slice(0, 3);
    } else if (Array.isArray(body)) {
      res.dataShape = "array";
      res.count = body.length;
      res.sample = body.slice(0, 3);
    } else {
      res.dataShape = "object";
      res.sample = [body];
    }
    const freshSet = new Set<string>();
    findFreshnessFields(body).forEach((f) => freshSet.add(f));
    if (res.sample[0]) findFreshnessFields(res.sample[0]).forEach((f) => freshSet.add(f));
    res.freshnessFields = [...freshSet];
  } catch (e) {
    if (e instanceof PlaybookClientError) {
      res.status = e.status;
      res.error = redact(`${e.name}: ${e.message}`);
    } else {
      res.error = redact((e as Error).message ?? String(e));
    }
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────
// Field extractors (sanitized samples)
// ─────────────────────────────────────────────────────────────────────────

function extractSplitRow(row: PlaybookSplitGame): Record<string, unknown> {
  const s = row.splits ?? {};
  return {
    gameId: row.gameId, league: row.league ?? row.sportKey, date: row.date,
    startTime: row.startTime ?? row.startTimeEst,
    homeTeamName: row.homeTeamName, awayTeamName: row.awayTeamName,
    spread: {
      betsHome: s.spread?.bets?.homePercent, betsAway: s.spread?.bets?.awayPercent,
      moneyHome: s.spread?.money?.homePercent, moneyAway: s.spread?.money?.awayPercent,
      booksUsed: s.spread?.source?.booksUsed,
    },
    moneyline: {
      betsHome: s.moneyline?.bets?.homePercent, betsAway: s.moneyline?.bets?.awayPercent,
      moneyHome: s.moneyline?.money?.homePercent, moneyAway: s.moneyline?.money?.awayPercent,
      booksUsed: s.moneyline?.source?.booksUsed,
    },
    total: {
      betsOver: s.total?.bets?.overPercent, betsUnder: s.total?.bets?.underPercent,
      moneyOver: s.total?.money?.overPercent, moneyUnder: s.total?.money?.underPercent,
      booksUsed: s.total?.source?.booksUsed,
    },
  };
}

function extractLineRow(row: PlaybookLineGame): Record<string, unknown> {
  return {
    gameId: row.gameId, league: row.league, date: row.date,
    startTime: row.startTime ?? row.startTimeEst,
    homeTeamName: row.homeTeamName, awayTeamName: row.awayTeamName,
    homeMoneyline: row.lines?.moneyline?.home, awayMoneyline: row.lines?.moneyline?.away,
    homeSpread: row.lines?.spread?.home, awaySpread: row.lines?.spread?.away,
    total: row.lines?.total, lineSourceTier: row.lineSourceTier,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Slate-match + SharpAPI cross-audits
// ─────────────────────────────────────────────────────────────────────────

type OurGame = {
  id: number; homeAbbr: string | null; awayAbbr: string | null;
  homeName: string | null; awayName: string | null;
};

async function loadOurSlate(sport: string, date: string): Promise<OurGame[]> {
  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name");
  const abbr = new Map<number, string>();
  const name = new Map<number, string>();
  for (const t of teams ?? []) {
    abbr.set(t.id as number, (t.abbreviation as string) ?? "");
    name.set(t.id as number, (t.name as string) ?? "");
  }
  const { data: games } = await supabase
    .from("games")
    .select("id, home_team_id, away_team_id, slate_date, sport")
    .eq("sport", sport).eq("slate_date", date);
  return (games ?? []).map((gm) => ({
    id: gm.id as number,
    homeAbbr: abbr.get(gm.home_team_id as number) ?? null,
    awayAbbr: abbr.get(gm.away_team_id as number) ?? null,
    homeName: name.get(gm.home_team_id as number) ?? null,
    awayName: name.get(gm.away_team_id as number) ?? null,
  }));
}

function nameSlug(n: unknown): string {
  return typeof n === "string" ? n.toLowerCase().replace(/[^a-z]/g, "").slice(-12) : "";
}
function teamKey(sport: string, fullName: unknown): string | null {
  if (typeof fullName !== "string" || !fullName.trim()) return null;
  if (sport === "mlb") {
    const ab = normalizeMlbTeamName(fullName);
    if (ab) return ab;
  }
  return nameSlug(fullName) || null;
}
function ourGameKey(sport: string, gm: OurGame): string {
  if (sport === "mlb") return `${gm.awayAbbr}@${gm.homeAbbr}`;
  return `${nameSlug(gm.awayName ?? gm.awayAbbr)}@${nameSlug(gm.homeName ?? gm.homeAbbr)}`;
}
function pbGameKey(sport: string, row: PlaybookSplitGame | PlaybookLineGame): string | null {
  const a = teamKey(sport, row.awayTeamName);
  const h = teamKey(sport, row.homeTeamName);
  return a && h ? `${a}@${h}` : null;
}

function runSlateAudit(
  sport: string, our: OurGame[],
  splits: ProbeResult<PlaybookSplitsResponse>, lines: ProbeResult<PlaybookLinesResponse>
): Record<string, unknown> {
  const splitRows = (splits.raw?.data ?? []) as PlaybookSplitGame[];
  const lineRows = (lines.raw?.data ?? []) as PlaybookLineGame[];

  const ourKeys = new Set(our.map((gm) => ourGameKey(sport, gm)));
  const splitKeyById = new Map<string, string>();
  const splitTeamKeys = new Set<string>();
  for (const r of splitRows) {
    const k = pbGameKey(sport, r);
    if (k) { splitTeamKeys.add(k); if (r.gameId) splitKeyById.set(r.gameId, k); }
  }
  const lineKeyById = new Map<string, string>();
  const lineTeamKeys = new Set<string>();
  for (const r of lineRows) {
    const k = pbGameKey(sport, r);
    if (k) { lineTeamKeys.add(k); if (r.gameId) lineKeyById.set(r.gameId, k); }
  }

  let withMl = 0, withTotal = 0, withSpread = 0, booksUsedPop = 0;
  for (const r of splitRows) {
    const s = r.splits ?? {};
    if (s.moneyline?.bets?.homePercent != null) withMl++;
    if (s.total?.bets?.overPercent != null) withTotal++;
    if (s.spread?.bets?.homePercent != null) withSpread++;
    const bu = s.moneyline?.source?.booksUsed ?? s.total?.source?.booksUsed ?? s.spread?.source?.booksUsed;
    if (bu != null && Number(bu) > 0) booksUsedPop++;
  }

  const sharedIds = [...splitKeyById.keys()].filter((id) => lineKeyById.has(id));
  const idStable = sharedIds.length > 0 && sharedIds.every((id) => splitKeyById.get(id) === lineKeyById.get(id));

  return {
    ourSlateGames: our.length,
    playbookSplitsGames: splitRows.length,
    playbookLinesGames: lineRows.length,
    ourPresentInSplits: [...ourKeys].filter((k) => splitTeamKeys.has(k)).length,
    ourPresentInLines: [...ourKeys].filter((k) => lineTeamKeys.has(k)).length,
    playbookSplitsUnmatched: [...splitTeamKeys].filter((k) => !ourKeys.has(k)).length,
    ourUnmatched: [...ourKeys].filter((k) => !splitTeamKeys.has(k) && !lineTeamKeys.has(k)).length,
    teamNamesMatchable: sport === "mlb" ? "yes (MLB normalizer)" : "best-effort (no non-MLB normalizer yet)",
    gameIdsStableSplitsVsLines: splitKeyById.size && lineKeyById.size ? idStable : "n/a",
    everyLineHasSplits: lineTeamKeys.size ? [...lineTeamKeys].every((k) => splitTeamKeys.has(k)) : "n/a",
    everySplitHasLines: splitTeamKeys.size ? [...splitTeamKeys].every((k) => lineTeamKeys.has(k)) : "n/a",
    splitsWithMlData: `${withMl}/${splitRows.length}`,
    splitsWithTotalData: `${withTotal}/${splitRows.length}`,
    splitsWithSpreadData: `${withSpread}/${splitRows.length}`,
    booksUsedPopulated: `${booksUsedPop}/${splitRows.length}`,
    splitsFreshnessFields: splits.freshnessFields,
    linesFreshnessFields: lines.freshnessFields,
    stalenessNote: "no data-as-of/updated-at field exposed; only event startTime. Stamp freshness at ingest.",
  };
}

async function runSharpComparison(
  sport: string, date: string, baseUrl: string | undefined,
  lines: ProbeResult<PlaybookLinesResponse>
): Promise<Record<string, unknown>> {
  if (!baseUrl) {
    return { status: "skipped", reason: "no --base-url; pass e.g. https://www.oddsphereai.com to compare vs our market data" };
  }
  let dto: { games?: unknown[] };
  try {
    const r = await fetch(`${baseUrl}/api/lab/daily-edge?sport=${sport}&date=${date}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { status: "skipped", reason: `DTO HTTP ${r.status} from ${baseUrl}` };
    dto = await r.json();
  } catch (e) {
    return { status: "skipped", reason: redact((e as Error).message) };
  }
  const pbByKey = new Map<string, PlaybookLineGame>();
  for (const r of (lines.raw?.data ?? []) as PlaybookLineGame[]) {
    const k = pbGameKey(sport, r);
    if (k) pbByKey.set(k, r);
  }
  const diffs: Array<Record<string, unknown>> = [];
  let totalClose = 0, compared = 0;
  for (const game of (dto.games as Array<Record<string, any>>) ?? []) {
    const a = (game.away_team?.abbreviation ?? game.away_abbr ?? "").toString();
    const h = (game.home_team?.abbreviation ?? game.home_abbr ?? "").toString();
    if (sport !== "mlb") continue;
    const pb = pbByKey.get(`${a}@${h}`);
    if (!pb) continue;
    compared++;
    const pbTotal = Number(pb.lines?.total ?? NaN);
    const ourTotal = Number(game?.markets?.total?.line ?? game?.total?.line ?? game?.total_line ?? NaN);
    if (Number.isFinite(pbTotal) && Number.isFinite(ourTotal) && Math.abs(pbTotal - ourTotal) <= 0.5) totalClose++;
    diffs.push({ game: `${a}@${h}`, playbookTotal: pbTotal, ourTotal });
  }
  return {
    status: "compared", baseUrl, gamesCompared: compared,
    totalsWithinHalfPoint: `${totalClose}/${compared}`,
    sampleDiffs: diffs.slice(0, 5),
    note: "Playbook /lines is a CONSENSUS CURRENT SNAPSHOT — no opener/lock/history/CLV/streaming. SharpAPI remains the movement/CLV provider.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    err("✗ This audit is READ-ONLY. --write is not supported.");
    process.exit(1);
  }
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const json = readBoolFlag(argv, "--json");
  const baseUrl = readStringFlag(argv, "--base-url");
  const doHistory = readBoolFlag(argv, "--history");

  log(`[playbook-shadow-audit] mode=READ-ONLY date=${date} json=${json}`);
  log(`  base=https://api.playbook-api.com  auth=api_key query param  (key never printed)`);

  if (!API_KEY) {
    err(
      "\n✗ PLAYBOOK_API_KEY is not set.\n" +
        "  Add a line to .env.local naming PLAYBOOK_API_KEY (do NOT commit it), then re-run.\n" +
        "  The audit will not contact Playbook without a key.\n"
    );
    process.exit(1);
  }

  const client = new PlaybookClient(API_KEY);
  const report: Record<string, unknown> = { date };

  // ── Account / health + rate-usage baseline ────────────────────────────
  log("\n── Account / health ──");
  const health = await probe("/v1/health", () => client.health());
  const me = await probe<PlaybookMe>("/v1/me", () => client.me());
  const meBody = me.raw as PlaybookMe | undefined;
  const startRemaining = client.getQuotaState().requestsRemaining;
  log(`  /v1/health status=${health.status} ok=${health.ok}` + (health.error ? ` err=${health.error}` : ""));
  log(
    `  /v1/me     status=${me.status} plan=${meBody?.plan ?? "?"} label=${meBody?.planLabel ?? "?"} ` +
      `monthlyLimit=${meBody?.monthlyLimit ?? "?"}` + (me.error ? ` err=${me.error}` : "")
  );
  report.account = {
    health: { status: health.status, ok: health.ok, error: health.error },
    plan: meBody?.plan, planLabel: meBody?.planLabel, monthlyLimit: meBody?.monthlyLimit,
    // NOTE: meBody.apiKey deliberately excluded from the report.
  };

  // ── Per-league splits + lines (coverage table) ────────────────────────
  log("\n── Coverage by league (splits / lines) ──");
  const leagues = [...LEAGUES_DOCUMENTED, ...LEAGUES_PROBE_EXTRA];
  const splitsByLeague: Record<string, ProbeResult<PlaybookSplitsResponse>> = {};
  const linesByLeague: Record<string, ProbeResult<PlaybookLinesResponse>> = {};
  const endpointErrors: string[] = [];
  for (const lg of leagues) {
    const s = await probe<PlaybookSplitsResponse>(`/v1/splits?league=${lg}`, () => client.splits(lg));
    const l = await probe<PlaybookLinesResponse>(`/v1/lines?league=${lg}`, () => client.lines(lg));
    splitsByLeague[lg] = s;
    linesByLeague[lg] = l;
    if (s.error) endpointErrors.push(`splits:${lg} ${s.error}`);
    if (l.error) endpointErrors.push(`lines:${lg} ${l.error}`);
    const doc = LEAGUES_DOCUMENTED.includes(lg) ? "doc" : "extra";
    log(
      `  ${lg.padEnd(6)}(${doc}) splits=${String(s.count ?? "err").padStart(3)} ` +
        `lines=${String(l.count ?? "err").padStart(3)}` +
        (s.error || l.error ? `  ⚠ ${s.error ?? ""}${l.error ?? ""}` : "")
    );
  }
  report.coverage = leagues.map((lg) => ({
    league: lg, documented: LEAGUES_DOCUMENTED.includes(lg),
    splits: { status: splitsByLeague[lg].status, count: splitsByLeague[lg].count, error: splitsByLeague[lg].error },
    lines: { status: linesByLeague[lg].status, count: linesByLeague[lg].count, error: linesByLeague[lg].error },
  }));
  report.endpointErrors = endpointErrors;

  // ── Optional: splits-history probe (verify endpoint shape) ────────────
  if (doHistory) {
    log("\n── splits-history (yesterday, mlb) ──");
    const yday = new Date(`${date}T00:00:00Z`);
    yday.setUTCDate(yday.getUTCDate() - 1);
    const ydayStr = yday.toISOString().slice(0, 10);
    const hist = await probe(`/v1/splits-history?league=mlb&date=${ydayStr}`, () => client.splitsHistory("mlb", ydayStr));
    log(`  status=${hist.status} shape=${hist.dataShape} count=${hist.count ?? "-"}` + (hist.error ? ` err=${hist.error}` : ""));
    report.splitsHistory = { date: ydayStr, status: hist.status, count: hist.count, dataShape: hist.dataShape, error: hist.error };
  }

  // ── Sanitized samples (first 3, MLB + WNBA) ───────────────────────────
  log("\n── Sanitized samples (first 3) ──");
  for (const lg of ["mlb", "wnba"]) {
    log(`  [${lg}] splits:`);
    for (const row of (splitsByLeague[lg]?.sample ?? []).slice(0, 3) as PlaybookSplitGame[]) {
      log("    " + JSON.stringify(extractSplitRow(row)));
    }
    log(`  [${lg}] lines:`);
    for (const row of (linesByLeague[lg]?.sample ?? []).slice(0, 3) as PlaybookLineGame[]) {
      log("    " + JSON.stringify(extractLineRow(row)));
    }
  }
  report.samples = {
    mlbSplits: ((splitsByLeague.mlb?.sample ?? []) as PlaybookSplitGame[]).map(extractSplitRow),
    mlbLines: ((linesByLeague.mlb?.sample ?? []) as PlaybookLineGame[]).map(extractLineRow),
    wnbaSplits: ((splitsByLeague.wnba?.sample ?? []) as PlaybookSplitGame[]).map(extractSplitRow),
    wnbaLines: ((linesByLeague.wnba?.sample ?? []) as PlaybookLineGame[]).map(extractLineRow),
  };

  // ── Slate-match audit (MLB + WNBA) ────────────────────────────────────
  log("\n── Slate-match audit ──");
  const slateAudits: Record<string, unknown> = {};
  for (const sport of ["mlb", "wnba"]) {
    let our: OurGame[] = [];
    try {
      our = await loadOurSlate(sport, date);
    } catch (e) {
      slateAudits[sport] = { error: redact((e as Error).message) };
      log(`  [${sport}] DB slate load failed: ${redact((e as Error).message)}`);
      continue;
    }
    const audit = runSlateAudit(sport, our, splitsByLeague[sport], linesByLeague[sport]);
    slateAudits[sport] = audit;
    log(`  [${sport}] ${JSON.stringify(audit)}`);
  }
  report.slateAudit = slateAudits;

  // ── SharpAPI / market comparison ──────────────────────────────────────
  log("\n── SharpAPI / market comparison ──");
  const sharp: Record<string, unknown> = {};
  for (const sport of ["mlb", "wnba"]) {
    sharp[sport] = await runSharpComparison(sport, date, baseUrl, linesByLeague[sport]);
    log(`  [${sport}] ${JSON.stringify(sharp[sport])}`);
  }
  report.sharpComparison = sharp;

  // ── Rate usage ────────────────────────────────────────────────────────
  // Only splits/lines responses carry requestsRemaining; /health and /me do
  // not. Reconstruct the value sequence in call order, then derive burn from
  // first→last reported reading and divide over the calls BETWEEN them.
  const remainingSeq: number[] = [];
  for (const lg of leagues) {
    if (splitsByLeague[lg].requestsRemaining != null) remainingSeq.push(splitsByLeague[lg].requestsRemaining!);
    if (linesByLeague[lg].requestsRemaining != null) remainingSeq.push(linesByLeague[lg].requestsRemaining!);
  }
  const firstRemaining = remainingSeq[0] ?? startRemaining ?? null;
  const endRemaining = client.getQuotaState().requestsRemaining;
  const reportedReadings = remainingSeq.length;
  const burn = firstRemaining != null && endRemaining != null ? firstRemaining - endRemaining : null;
  // Intervals between consecutive reported readings = reportedReadings-1 calls.
  const unitsPerCall = burn != null && reportedReadings > 1 ? burn / (reportedReadings - 1) : null;
  const totalCalls = 2 + leagues.length * 2 + (doHistory ? 1 : 0);
  log("\n── Rate usage ──");
  log(
    `  totalCalls=${totalCalls} reportedReadings=${reportedReadings}  ` +
      `requestsRemaining: first=${firstRemaining ?? "?"} end=${endRemaining ?? "?"} burn=${burn ?? "?"}  ` +
      `unitsPerReportedCall≈${unitsPerCall != null ? unitsPerCall.toFixed(2) : "?"}  monthlyLimit=${meBody?.monthlyLimit ?? "?"}`
  );
  report.rateUsage = {
    totalCalls, reportedReadings, firstRemaining, endRemaining, burn,
    unitsPerReportedCall: unitsPerCall != null ? Number(unitsPerCall.toFixed(2)) : null,
    monthlyLimit: meBody?.monthlyLimit ?? null,
    note: "Only splits/lines responses report requestsRemaining. Burn is measured over reported readings; size the plan on measured units, not raw call count.",
  };

  if (json) {
    log("\n── JSON report ──");
    log(JSON.stringify(report, null, 2));
  }
  log("\n✓ Shadow audit complete (read-only; no DB/UI/grading/line-movement writes).");
}

main().catch((e) => {
  err(`FATAL: ${redact((e as Error).message ?? String(e))}`);
  process.exit(2);
});

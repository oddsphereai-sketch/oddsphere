import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE } from "@/lib/services/football/nflForwardEvidence";
import {
  mergeNflForwardCollectionSlate, readNflForwardCollectionSlate,
  type NflCollectionSlateRow,
} from "@/lib/services/marketIntelligenceV2/nflForwardCollectionSlate";
import { nflOwlsIdentityCandidates, syncMarketIntelligenceV2Shadow, buildOwlsSharpPriceObservations } from "@/lib/services/marketIntelligenceV2/shadowSync";

const at = "2026-10-28T15:00:00.000Z";
const base: NflCollectionSlateRow = {
  id: "row-1", provider_game_id: "1392300", stage: "unlocked", captured_at: at,
  game_start_at: "2026-10-30T00:15:00.000Z", payload_schema: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  payload_captured_at: at, payload_stage: "unlocked",
  game: { providerGameId: "1392300", providerWeek: 8, season: 2026,
    scheduledStart: "2026-10-30T00:15:00.000Z", status: "scheduled",
    home: { id: 7, abbreviation: "WSH", name: "Washington Commanders" },
    away: { id: 8, abbreviation: "PHI", name: "Philadelphia Eagles" } },
};
const args = { from: "2026-10-28", through: "2026-11-03", availableAt: at, canonical: [] };
const source = JSON.stringify(base);
const games = mergeNflForwardCollectionSlate({ ...args, rows: [base] });
assert.equal(games.length, 1);
assert.equal(games[0]!.externalId, 1392300);
assert.equal(games[0]!.id, null, "a provider game ID cannot be repurposed as a generic games-table ID");
assert.equal(games[0]!.homeTeamId, null, "provider team IDs cannot impersonate generic team IDs");
assert.equal(games[0]!.slateDate, "2026-10-29", "football uses ET, not the following UTC date");
assert.equal(JSON.stringify(base), source, "source snapshots are immutable");
for (const status of ["Scheduled", " scheduled ", "SCHEDULED", "pre", " PRE "]) {
  const mixedCase = structuredClone(base);
  mixedCase.game.status = status;
  assert.equal(mergeNflForwardCollectionSlate({ ...args, rows: [mixedCase] }).length, 1,
    "provider status casing and whitespace cannot silently erase a legitimate future game");
}
for (const status of ["Final", "Postponed", "Cancelled", "unknown"]) {
  const inactive = structuredClone(base);
  inactive.game.status = status;
  assert.equal(mergeNflForwardCollectionSlate({ ...args, rows: [inactive] }).length, 0);
}
assert.equal(nflOwlsIdentityCandidates(games, "nfl:PHI@WSH-20261029").length, 1);
assert.equal(nflOwlsIdentityCandidates(games, "nfl:PHI@WSH-20261105").length, 0,
  "even a lone same-team game cannot absorb another week's split");
assert.equal(nflOwlsIdentityCandidates(games, "event", "2026-11-06T00:15:00.000Z").length, 0);
assert.equal(nflOwlsIdentityCandidates(games, "event", "invalid").length, 0);
const generic = { ...games[0]!, id: 555, homeTeamId: 11, awayTeamId: 12, homeAbbr: "WAS" };
assert.equal(mergeNflForwardCollectionSlate({ ...args, canonical: [generic], rows: [base] })[0], generic,
  "an exact generic identity keeps its real internal IDs and common NFL aliases");
const otherNamespace = { ...generic, externalId: 999001 };
const bridged = mergeNflForwardCollectionSlate({ ...args, canonical: [otherNamespace], rows: [base] });
assert.equal(bridged.length, 1);
assert.equal(bridged[0]!.id, generic.id, "the exact-match bridge retains the genuine generic line ID");
assert.equal(bridged[0]!.externalId, Number(base.provider_game_id), "NFL chronology keeps the writer's canonical BDL event identity");
assert.equal(bridged[0]!.genericExternalId, 999001, "the other provider namespace remains explicit provenance");
const secondForward = structuredClone(base);
secondForward.provider_game_id = secondForward.game.providerGameId = "1392301";
assert.throws(() => mergeNflForwardCollectionSlate({ ...args, rows: [base, secondForward] }), /multiple forward IDs|re-bridge/);
assert.throws(() => mergeNflForwardCollectionSlate({ ...args, canonical: bridged, rows: [secondForward] }), /re-bridge/);
assert.throws(() => mergeNflForwardCollectionSlate({ ...args, canonical: [generic, otherNamespace], rows: [base] }), /ambiguous cross-provider/);
const tied = buildOwlsSharpPriceObservations({ sport: "nfl", games: [generic, otherNamespace], fetchedAt: new Date(at),
  rows: [{ sport: "nfl", providerEventId: "nfl:PHI@WSH-20261029", providerNumericEventId: null,
    scheduledStart: base.game.scheduledStart, homeTeam: base.game.home.name, awayTeam: base.game.away.name,
    sportsbook: "circa", observedAt: at, market: "moneyline", side: "home", line: null,
    americanPrice: -150, decimalPrice: 5 / 3, noVigProbability: 0.6 }] });
assert.equal(tied.observations.length, 0, "equal-time duplicate identities cannot pick the first event silently");
assert.equal(tied.rejected.length, 1);
assert.throws(() => mergeNflForwardCollectionSlate({ ...args, canonical: [{ ...generic, awayAbbr: "DAL" }], rows: [base] }), /identity conflict/);
const duplicate = structuredClone(base);
duplicate.game.home.abbreviation = "DAL";
assert.throws(() => mergeNflForwardCollectionSlate({ ...args, rows: [base, duplicate] }), /same-time identity/);
const future = { ...base, captured_at: "2026-10-28T15:01:00.000Z" };
assert.equal(mergeNflForwardCollectionSlate({ ...args, rows: [future] }).length, 0);
const malformed = structuredClone(base);
malformed.game.providerGameId = "different";
assert.throws(() => mergeNflForwardCollectionSlate({ ...args, rows: [malformed] }), /immutable identity/);
const started = structuredClone(base);
started.game_start_at = "2026-10-28T14:00:00.000Z";
started.game.scheduledStart = started.game_start_at;
assert.equal(mergeNflForwardCollectionSlate({ ...args, rows: [started] }).length, 0);
const finished = structuredClone(base);
finished.game.status = "final";
assert.equal(mergeNflForwardCollectionSlate({ ...args, rows: [finished] }).length, 0);
const older = { ...base, id: "old", captured_at: "2026-10-28T14:00:00.000Z", payload_captured_at: "2026-10-28T14:00:00.000Z" };
for (const status of ["postponed", "cancelled"] as const) {
  const canceled = structuredClone(base);
  canceled.game.status = status as typeof canceled.game.status;
  assert.equal(mergeNflForwardCollectionSlate({ ...args, rows: [older, canceled] }).length, 0,
    "latest cancellation/postponement must not resurrect an older scheduled row");
}
const moved = structuredClone(base);
moved.game.scheduledStart = moved.game_start_at = "2026-11-08T18:00:00.000Z";
assert.equal(mergeNflForwardCollectionSlate({ ...args, rows: [older, moved] }).length, 0,
  "latest moved-week state must win before window eligibility is applied");
assert.equal(mergeNflForwardCollectionSlate({ ...args, from: "2026-10-30", rows: [base] }).length, 0);

let queries = 0;
const builder: object = new Proxy({}, { get(_target, property) {
  if (property === "then") return (resolve: (value: unknown) => unknown) => resolve({ data: [base], error: null });
  return () => builder;
} });
const client = { from(table: string) { assert.equal(table, "nfl_forward_evidence_snapshots"); queries++; return builder; } };
void (async () => {
const read = await readNflForwardCollectionSlate({ ...args, client: client as never });
assert.equal(read.length, 1);
assert.equal(queries, 2, "one seed read plus one exact latest-state read for the small slate");
const collector = readFileSync("lib/services/marketIntelligenceV2/shadowSync.ts", "utf8");
assert.match(collector, /sport === "nfl" \? readNflForwardCollectionSlate/);
assert.match(collector, /canonicalGames = opts\.games\.filter\(\(game\) => game\.id !== null\)/);
assert.match(collector, /if \(canonicalGames\.length === 0\) return \[\]/,
  "forward-only slate identities cannot read unrelated generic line IDs");
assert.equal((collector.match(/\.odds<RawOwlsOddsResponse>\(owlsSport\)/g) ?? []).length, 1);
assert.equal((collector.match(/\.splits<RawOwlsSplitsResponse>\(owlsSport\)/g) ?? []).length, 1,
  "restored collection remains one request per league/feed, not per game");
const originalFetch = globalThis.fetch;
const requestCounts: Record<string, number> = {};
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  requestCounts[url.pathname] = (requestCounts[url.pathname] ?? 0) + 1;
  if (url.hostname.includes("playbook")) return new Response(JSON.stringify({ error: "test unauthorized" }), { status: 401 });
  if (url.pathname.endsWith("/splits")) return Response.json({ sport: "nfl", data: [], meta: { status: "partial" } });
  return Response.json({ data: [{ eventId: "nfl:PHI@WSH-20261029", sport: "nfl",
    commence_time: base.game.scheduledStart, home_team: base.game.home.name, away_team: base.game.away.name,
    bookmakers: [{ key: "circa", last_update: at, markets: [{ key: "h2h", outcomes: [
      { name: base.game.home.name, price: -150 }, { name: base.game.away.name, price: 130 },
    ] }] }],
  }] });
};
const mockDb = { from(table: string) {
  assert.notEqual(table, "lines", "forward IDs must never query the generic line namespace");
  const data = table === "nfl_forward_evidence_snapshots" ? [base] : [];
  const query: object = new Proxy({}, { get(_target, property) {
    if (property === "then") return (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
    if (["insert", "upsert", "update", "delete"].includes(String(property))) throw new Error("Unexpected write");
    return () => query;
  } });
  return query;
} };
try {
  const report = await syncMarketIntelligenceV2Shadow({ supabase: mockDb as never, sport: "nfl",
    slateDate: args.from, slateDateThrough: args.through, todayUtc: args.from, now: new Date(at),
    playbookApiKey: "explicit-test-key", owlsApiKey: "explicit-owl-test-key", apply: false });
  assert.equal(report.gamesLoaded, 1);
  assert.equal(report.priceObservationsBuilt, 2, "a failed optional public feed must not discard valid Owl prices");
  assert.equal(report.priceObservationsWritten, 0);
  assert.equal(report.errors.length, 1, "optional-feed failure remains a visible partial-health finding");
  assert.equal(requestCounts["/api/v1/nfl/odds"], 1);
  assert.equal(requestCounts["/api/v1/nfl/splits"], 1);
  assert.equal(requestCounts["/v1/splits"], 1, "an authentication failure must not retry a paid request");
  const lineFailureDb = { from(table: string) {
    if (table === "nfl_forward_evidence_snapshots") return mockDb.from(table);
    const data = table === "teams" ? [{ id: 11, abbreviation: "WSH", name: base.game.home.name }, { id: 12, abbreviation: "PHI", name: base.game.away.name }]
      : table === "games" ? [{ id: 555, external_id: Number(base.provider_game_id), slate_date: "2026-10-29",
        game_date: base.game.scheduledStart, home_team_id: 11, away_team_id: 12 }] : [];
    const query: object = new Proxy({}, { get(_target, property) {
      if (property === "then") return (resolve: (value: unknown) => unknown) => resolve({ data, count: 0,
        error: table === "lines" ? { message: "test line query failure" } : null });
      return () => query;
    } });
    return query;
  } };
  const partial = await syncMarketIntelligenceV2Shadow({ supabase: lineFailureDb as never, sport: "nfl",
    slateDate: args.from, slateDateThrough: args.through, todayUtc: args.from, now: new Date(at),
    playbookApiKey: "explicit-test-key", owlsApiKey: "explicit-owl-test-key", apply: false });
  assert.equal(partial.priceObservationsBuilt, 2, "optional generic line failure cannot discard valid Owl prices");
  assert.ok(partial.errors.some((error) => error.startsWith("Canonical line collection failed")));
} finally { globalThis.fetch = originalFetch; }
console.log("NFL authoritative collection slate: exact identity, ET date, missing generic IDs, clocks, bounded reads, and request shape passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { __NBA_ROSTER_REGIME_TEST__, applyNbaRosterRegime, fetchNbaLiveRosterSnapshot } from "../lib/automodel/nba/nbaRosterRegime";
import { NBA_PROFESSIONAL_MODEL_ARTIFACT } from "../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import { buildNbaProfessionalCandidate } from "../lib/services/nba/nbaProfessionalCandidate";
import { gradeNbaMarket } from "../lib/services/nba/nbaMarketReview";
import { createNbaRequestRosterLoader } from "../lib/services/nba/nbaRequestRoster";
import { markNbaReaderBuildFailure } from "../lib/services/nba/nbaReaderBuildPhase";
import { nbaReaderUnavailableResponse } from "../lib/services/nba/nbaReaderPublication";
import { refreshDailyEdgeResponseSnapshot } from "../lib/services/labResponseSnapshotWriter";

export async function testNbaRequestRoster() {
  const previousFetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => { network++; throw Error("unexpected real IO"); };
  try {
    const artifact = __NBA_ROSTER_REGIME_TEST__.artifact, now = "2026-11-23T14:00:00Z";
    const players = artifact.teamRosters.flatMap((team, i) =>
      // Include genuine correction paths, not just stable-roster identity.
      (i % 3 === 0 ? artifact.teamRosters[(i + 1) % artifact.teamRosters.length]!.playerIds.slice(0, 10) : team.playerIds)
        .map(id => ({ id, team: { id: team.teamId } })));
    let requests = 0;
    const fetchImpl: typeof fetch = async input => {
      requests++;
      const url = new URL(String(input)), offset = Number(url.searchParams.get("cursor") ?? 0);
      return Response.json({ data: players.slice(offset, offset + 100), meta: { next_cursor: offset + 100 < players.length ? offset + 100 : null } });
    };
    let lazyCalls = 0;
    createNbaRequestRosterLoader(async () => { lazyCalls++; throw Error("empty slate must not fetch"); });
    assert.equal(lazyCalls, 0);
    const load = createNbaRequestRosterLoader(() => fetchNbaLiveRosterSnapshot({ apiKey: "mock", now, fetchImpl }));
    const shared = await Promise.all(Array.from({ length: 7 }, () => load()));
    assert(shared.every(s => s === shared[0]));
    assert.equal(shared[0]!.status, "complete");
    assert.equal(requests, Math.ceil(players.length / 100), "seven slate consumers collect one pagination set");
    const before = JSON.stringify([...shared[0]!.playerIdsByTeam]);
    let pairs = 0, corrected = 0;
    const counts: Record<string, number> = {};
    for (let i = 0; i < artifact.teamRosters.length; i++) {
      const home = artifact.teamRosters[i]!, away = artifact.teamRosters[(i + 1) % artifact.teamRosters.length]!;
      const marginHome = (i % 11 - 5) * 3, total = 205 + i * 1.5;
      const args = { independent: { homeScore: (total + marginHome) / 2, awayScore: (total - marginHome) / 2, marginHome, total },
        providerSeason: artifact.providerSeason, homeTeam: home.team, awayTeam: away.team,
        homeCurrentGames: i % 7, awayCurrentGames: i % 7 + 1, homeInjuries: [], awayInjuries: [] };
      const separate = { ...shared[0]!, playerIdsByTeam: new Map([...shared[0]!.playerIdsByTeam].map(([id, ids]) => [id, [...ids]])) };
      const original = applyNbaRosterRegime({ ...args, liveRoster: separate });
      const requestScoped = applyNbaRosterRegime({ ...args, liveRoster: shared[0]! });
      assert.deepEqual(requestScoped, original);
      if (original.audit.status === "applied") corrected++;
      const lines = [
        { market_type: "moneyline", side: "home", line_value: null, odds_american: -125 },
        { market_type: "moneyline", side: "away", line_value: null, odds_american: 110 },
        { market_type: "spread", side: "home", line_value: -3.5, odds_american: -110 },
        { market_type: "spread", side: "away", line_value: 3.5, odds_american: -110 },
        { market_type: "total", side: "over", line_value: 225.5, odds_american: -110 },
        { market_type: "total", side: "under", line_value: 225.5, odds_american: -110 },
      ].map(row => ({ ...row, sportsbook: "draftkings", fetched_at: now }));
      const evaluate = (independentOverride: typeof original.score) => {
        const candidate = buildNbaProfessionalCandidate({ artifact: NBA_PROFESSIONAL_MODEL_ARTIFACT,
          featureRow: {}, lines, history: [], externalGameId: i + 1, independentOverride });
        const grades = (["moneyline", "spread", "total"] as const).map(market => {
          const probability = market === "moneyline" ? candidate.probabilities.ml_home_win_prob
            : market === "spread" ? candidate.probabilities.spread_home_cover_prob : candidate.probabilities.total_over_prob;
          assert.notEqual(probability, null);
          const p = Math.max(probability!, 1 - probability!);
          const price = market === "moneyline" ? [-125, 110, -300, -8000][i % 4]! : -110;
          return gradeNbaMarket({ market, pick: candidate.picks[market]!, confidence: p * 100,
            modelProbabilityOnPick: p, currentPriceAmerican: price, band: "support", edge: p - .5,
            injuriesKnown: true, dataQualityTier: "high" });
        });
        return { candidate, grades };
      };
      const old = evaluate(original.score), next = evaluate(requestScoped.score);
      assert.deepEqual(next, old, "same observed source preserves every numerical prediction, selection and grade");
      for (const grade of next.grades) counts[grade.grade] = (counts[grade.grade] ?? 0) + 1;
      pairs++;
    }
    assert(corrected > 0, "parity must exercise nonzero roster residuals");
    assert(Object.keys(counts).length > 1, "parity must exercise more than a single board tier");
    assert.equal(JSON.stringify([...shared[0]!.playerIdsByTeam]), before, "forecasts cannot mutate another slate's source");
    const fresh = createNbaRequestRosterLoader(() => fetchNbaLiveRosterSnapshot({ apiKey: "mock", now, fetchImpl }));
    await fresh();
    assert.equal(requests, 2 * Math.ceil(players.length / 100), "a new request never reuses process-level state");

    // An already supported unavailable result is shared exactly, not retried.
    let unavailableCalls = 0;
    const unavailable = createNbaRequestRosterLoader(() => fetchNbaLiveRosterSnapshot({ apiKey: "mock", now,
      fetchImpl: async () => { unavailableCalls++; return new Response(null, { status: 503 }); } }));
    const unavailableRows = await Promise.all(Array.from({ length: 7 }, () => unavailable()));
    assert(unavailableRows.every(s => s === unavailableRows[0]));
    assert.equal(unavailableRows[0]!.reason, "active_roster_http_503");
    assert.equal(unavailableCalls, 1);

    // A failed body keeps its original rejection semantics: preserve the last
    // complete board; never publish an independent-only replacement or partial map.
    const old = { as_of: "2026-11-23T13:00:00Z", games: [{ id: "locked", grade: "lean", price: -125,
      projection: { total: 221.5 }, lockedAt: "2026-11-23T12:00:00Z" }] };
    let writes = 0, expirations = 0;
    const stored = structuredClone(old), bytes = JSON.stringify(stored);
    for (const kind of ["timeout", "malformed_json", "partial_later_page"] as const) {
      let calls = 0;
      const error = Object.freeze(kind === "malformed_json" ? new SyntaxError("private invalid JSON")
        : new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      const failingFetch: typeof fetch = async () => {
        calls++;
        if (kind === "partial_later_page" && calls === 1) return Response.json({ data: players.slice(0, 100), meta: { next_cursor: 100 } });
        const response = Response.json({});
        response.json = async () => { throw error; };
        return response;
      };
      const faultLoad = createNbaRequestRosterLoader(() => fetchNbaLiveRosterSnapshot({ apiKey: "mock", now, fetchImpl: failingFetch }));
      const results = await Promise.allSettled(Array.from({ length: 7 }, () => faultLoad()));
      assert(results.every(r => r.status === "rejected" && r.reason === error), "all slates retain the exact same source error");
      assert.equal(calls, kind === "partial_later_page" ? 2 : 1, "no independent retry after rejection");
      markNbaReaderBuildFailure(error, "active_roster");
      const result = await refreshDailyEdgeResponseSnapshot({ sport: "nba", date: "2026-11-23" }, {
        buildResponse: async () => nbaReaderUnavailableResponse({ date: "2026-11-23", now, error }),
        saveSnapshot: async () => { writes++; throw Error("failed source cannot publish"); },
        expireMemberCache: async () => { expirations++; },
      });
      assert.equal(result.ok, false);
      assert(result.error?.includes("nba_build_phase_active_roster"));
      assert.equal(JSON.stringify(stored), bytes);
    }
    assert.equal(writes, 0); assert.equal(expirations, 0); assert.equal(network, 0);
    const pipeline = readFileSync(new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url), "utf8");
    assert.match(pipeline, /const rosterRegimeRosterLoader = createNbaRequestRosterLoader\(\)/);
    assert.match(pipeline, /buildNbaDailyEdgePipeline\(slateDate, \{ rosterRegimeRosterLoader \}\)/);
    assert.match(pipeline, /NBA_ROLLING_ANALYSIS_CONCURRENCY = 3/);
    console.log(JSON.stringify({ result: "PASS", sameInputTeamPairs: pairs, correctedRosterPairs: corrected,
      sameInputMarketEvaluations: pairs * 3, gradeCounts: counts, completeSourcePaginationSetsPerSevenDates: 1,
      priorPaginationSetsPerSevenDates: 7, failedBodiesPreserveBoard: 3, sourceFailureWrites: writes,
      realNetworkRequests: network, projectionChangesOnSameInput: 0, promotions: 0, demotions: 0 }));
  } finally { globalThis.fetch = previousFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  testNbaRequestRoster().catch(error => { console.error(error); process.exitCode = 1; });
}

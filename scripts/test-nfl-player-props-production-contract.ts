import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attachNflPlayerPropsClosingPrice,
  buildNflPlayerPropsMemberSnapshot,
  buildNflPlayerPropsTrackingRows,
  NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
  NFL_PLAYER_PROPS_WRITER_LEASE_GROUP,
  reconcileNflPlayerPropsProductionSnapshot,
} from "../lib/services/football/nflPlayerPropsProductionContract";
import {
  NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM,
  NFL_PLAYER_PROPS_PRODUCTION_INCLUDE_OPENINGS,
  NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM,
  NFL_PLAYER_PROPS_WRITER_RELEASE,
} from "../lib/services/football/nflPlayerPropsProductionWriter";
import {
  NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE,
  NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE,
  NFL_PLAYER_PROPS_SETTLEMENT_RELEASE,
} from "../lib/services/football/nflPlayerPropsSettlement";
import { NFL_PLAYER_PROPS_TRACKING_RELEASE } from "../lib/services/football/nflPlayerPropsTrackingStore";
import { NFL_PLAYER_PROPS_BOARD_RELEASE, type NflPlayerPropsRuntimeBoard, type NflPlayerPropsRuntimeDecision } from "../lib/services/football/nflPlayerPropsRuntime";

const decision: NflPlayerPropsRuntimeDecision = {
  gameId: "game", providerPlayerId: "1", playerName: "Player", team: "NE", opponent: "NYJ",
  scheduledStart: "2026-09-01T12:00:00.000Z", market: "receptions", line: 4.5, side: "over",
  sportsbook: "book", provider: "balldontlie", americanPrice: 110, observedAt: "2026-08-25T11:00:00.000Z",
  bookEvidence: [{ sportsbook: "book", provider: "balldontlie", americanPrice: 110, observedAt: "2026-08-25T11:00:00.000Z", openingObservedAt: null, openingAmericanPrice: null }],
  lockAt: "2026-09-01T11:00:00.000Z", state: "unlocked", roleFingerprint: "role-a", projection: 5.2,
  projectionRange: { lower: 2.1, upper: 8.4, centralCoverage: 0.8, source: "empirical_residual_distribution" },
  forecastContext: {
    featureAsOf: "2026-08-25T10:00:00.000Z", position: "WR",
    expectedQuarterback: { name: "Quarterback", starterStatus: "projected", capturedAt: "2026-08-25T10:00:00.000Z" },
    availability: { listed: false, status: null, detail: null, reportedAt: null, reportUpdatedAt: "2026-08-25T09:00:00.000Z", source: "BALLDONTLIE" },
    teamImpliedPoints: 24.5, teamImpliedTouchdowns: 3.5,
    recentProduction: { label: "Recent receptions", value: 5.1, format: "count" },
    roleOpportunity: [{ label: "Recent targets", value: 7.4, format: "count" }],
    opponentAllowance: { label: "Opponent targets allowed", value: 31.2, format: "count" },
  },
  participationProbability: 0.9, rawModelProbability: 0.61, marketProbability: 0.5, finalProbability: 0.53,
  probabilityEdge: 0.03, expectedValue: 0.11, grade: "Best Angle", healthHolds: [], provisional: false,
  modelRelease: "model", calibrationRelease: "calibration", decisionRelease: "decision",
};
function board(row: NflPlayerPropsRuntimeDecision): NflPlayerPropsRuntimeBoard {
  return {
    release: NFL_PLAYER_PROPS_BOARD_RELEASE, generatedAt: "2026-08-25T12:00:00.000Z",
    evaluatedAt: "2026-08-25T12:00:00.000Z", provisional: false, publicationEnabled: false, trackingEnabled: false,
    decisions: [row], counts: { "Best Angle": 1, Lean: 0, Watchlist: 0, "No Play": 0, Held: 0, actionable: 1 },
    diagnostics: {
      inputOffers: 1, completeExactOffers: 1, incompleteExactOffers: 0, lockedOffers: 0,
      unavailableNoIndependentBenchmark: 0, unavailableStaleQuotes: 0, unavailableFeatureContext: 0,
      completedEvaluations: row.grade === "Held" ? 0 : 1,
      operationalExceptions: row.grade === "Held" ? 1 : 0,
      recoveryEligibleOperationalExceptions: row.grade === "Held" && row.state === "unlocked" ? 1 : 0,
      roleOrIdentityHeld: row.grade === "Held" ? 1 : 0,
    },
  };
}
function emptyBoard(): NflPlayerPropsRuntimeBoard {
  return {
    ...board(decision),
    decisions: [],
    counts: { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0, Held: 0, actionable: 0 },
  };
}

const unlocked = reconcileNflPlayerPropsProductionSnapshot({ season: 2026, week: 1, evaluatedAt: "2026-08-25T12:00:00.000Z", nextBoard: board(decision) });
assert.equal(NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE, "nfl_player_props_member_2026_08_27_r6_projection_context");
assert.equal(NFL_PLAYER_PROPS_WRITER_RELEASE, "nfl_player_props_writer_2026_08_27_r7_projection_context");
assert.equal(NFL_PLAYER_PROPS_TRACKING_RELEASE, "nfl_player_props_tracking_2026_08_25_r4_regular_t60_shared_context");
assert.equal(NFL_PLAYER_PROPS_SETTLEMENT_RELEASE, "nfl_player_props_settlement_2026_08_25_r3_bounded_finality");
assert.equal(NFL_PLAYER_PROPS_PRODUCTION_INCLUDE_OPENINGS, false, "recurring production does not duplicate historical-opening requests");
assert.equal(NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM, 30, "slate/current props/player identity/Sharp pagination is explicitly bounded");
assert.equal(NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE, 18);
assert.equal(NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE, 1_000);
assert.equal(NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM, 48, "collection plus settlement has one declared incremental-call ceiling");
for (const release of [NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE, NFL_PLAYER_PROPS_WRITER_RELEASE, NFL_PLAYER_PROPS_TRACKING_RELEASE, NFL_PLAYER_PROPS_SETTLEMENT_RELEASE]) {
  assert.ok(!/(shadow|provisional|review)/i.test(release), `production release must not carry non-production semantics: ${release}`);
}
assert.equal(unlocked.writerLeaseGroup, NFL_PLAYER_PROPS_WRITER_LEASE_GROUP);
assert.equal(unlocked.lifecycle.recomputedUnlocked, 1);
assert.equal(buildNflPlayerPropsTrackingRows(unlocked).length, 0);

const operationalHeld = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026, week: 1, evaluatedAt: "2026-08-25T12:00:00.000Z",
  nextBoard: board({ ...decision, grade: "Held", healthHolds: ["historical_identity_ambiguous"] }),
});
assert.equal(operationalHeld.board.counts.Held, 1, "Held remains visible in the audit payload as an operational exception");
assert.equal(operationalHeld.board.diagnostics.completedEvaluations, 0);
assert.equal(operationalHeld.board.diagnostics.operationalExceptions, 1);
assert.equal(operationalHeld.board.diagnostics.recoveryEligibleOperationalExceptions, 1);
assert.equal(operationalHeld.memberDecisions.length, 0, "Held is excluded from member completeness rather than treated as a completed grade");
assert.equal(buildNflPlayerPropsTrackingRows(operationalHeld).length, 0, "Held is never official tracking eligibility");
const operationalMemberView = buildNflPlayerPropsMemberSnapshot(operationalHeld);
assert.equal(operationalMemberView.memberDecisions.length, 0, "the public DTO excludes internal operational exceptions");
assert.deepEqual(operationalMemberView.board.counts, { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0, actionable: 0 });
assert.equal(operationalMemberView.board.diagnostics.completedEvaluations, 0);
assert.ok(!JSON.stringify(operationalMemberView).includes("Held"), "the public DTO serializes no Held grade, count, or diagnostic");
assert.ok(!("operationalExceptions" in operationalMemberView.board.diagnostics));
assert.ok(!("recoveryEligibleOperationalExceptions" in operationalMemberView.board.diagnostics));
const recoveredIdentity = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026, week: 1, evaluatedAt: "2026-08-25T12:05:00.000Z",
  previous: operationalHeld,
  nextBoard: board(decision),
});
assert.equal(recoveredIdentity.memberDecisions.length, 1, "a later coherent unlocked identity/role evaluation may recover the row");
assert.equal(recoveredIdentity.memberDecisions[0]?.grade, "Best Angle", "recovery uses the newly coherent scored decision, not a Held-to-No-Edge conversion");

const changed = { ...decision, americanPrice: 120, roleFingerprint: "role-b" };
const locked = reconcileNflPlayerPropsProductionSnapshot({ season: 2026, week: 1, evaluatedAt: "2026-09-01T11:00:00.000Z", previous: unlocked, nextBoard: board(changed) });
assert.equal(locked.board.decisions[0]?.americanPrice, changed.americanPrice, "latest authorized T-60 quote freezes at boundary");
assert.equal(locked.board.decisions[0]?.roleFingerprint, changed.roleFingerprint, "latest authorized T-60 role freezes at boundary");
assert.equal(locked.board.decisions[0]?.state, "locked");
assert.equal(locked.generatedAt, "2026-09-01T11:00:00.000Z", "snapshot timestamp is the authorized evaluation time");
const tracking = buildNflPlayerPropsTrackingRows(locked);
assert.equal(tracking.length, 1);
assert.equal(tracking[0]?.clvProbabilityPoints, null, "CLV is unobserved until a closing quote exists");
const closed = attachNflPlayerPropsClosingPrice(tracking[0]!, -110);
assert.ok(closed.clvProbabilityPoints! > 0, "a +120 lock beating a -110 close has positive CLV");

const retained = reconcileNflPlayerPropsProductionSnapshot({ season: 2026, week: 1, evaluatedAt: "2026-09-01T12:00:00.000Z", previous: locked, nextBoard: board({ ...changed, americanPrice: 130 }) });
assert.equal(retained.board.decisions[0]?.americanPrice, changed.americanPrice);
assert.equal(retained.lifecycle.retainedPreviouslyLocked, 1);
assert.equal(retained.riskLabel, "forward_monitoring_2025_exact_price_confirmation");

const freshBeforeRemoval = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026,
  week: 1,
  evaluatedAt: "2026-09-01T10:30:00.000Z",
  nextBoard: board({ ...decision, observedAt: "2026-09-01T10:15:00.000Z" }),
});
const removedAtBoundary = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026,
  week: 1,
  evaluatedAt: "2026-09-01T11:00:00.000Z",
  previous: freshBeforeRemoval,
  nextBoard: emptyBoard(),
});
assert.equal(removedAtBoundary.board.decisions.length, 1, "a removed but fresh pre-lock offer is retained at T-60");
assert.equal(removedAtBoundary.board.decisions[0]?.state, "locked");

const staleBeforeRemoval = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026,
  week: 1,
  evaluatedAt: "2026-09-01T04:30:00.000Z",
  nextBoard: board({ ...decision, observedAt: "2026-09-01T04:00:00.000Z" }),
});
const staleRemovedAtBoundary = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026,
  week: 1,
  evaluatedAt: "2026-09-01T11:00:00.000Z",
  previous: staleBeforeRemoval,
  nextBoard: emptyBoard(),
});
assert.equal(staleRemovedAtBoundary.board.decisions.length, 0, "a stale removed offer is unavailable, not frozen or held");
const memberReader = readFileSync("app/player-props/components/NflPlayerPropsDashboard.tsx", "utf8");
assert.ok(!memberReader.includes("Provisional model"), "the live member reader must not label the production model provisional");
assert.ok(memberReader.includes('reviewMode ? "Production candidate" : "NFL model"'));
for (const productHierarchy of ["Top Rated", "Our Model Read", "Worth a Look", "Markets", "Build your board"]) {
  assert.ok(memberReader.includes(productHierarchy), `NFL member board preserves MLB-style product hierarchy: ${productHierarchy}`);
}
assert.ok(memberReader.includes('data-product-zone="top-rated"'));
assert.ok(memberReader.includes('data-product-zone="worth-a-look"'));
assert.ok(memberReader.includes('data-product-zone="markets"'));
for (const truthfulCoverageCopy of ["Current graded board", "Available NFL markets", "market families currently graded"]) {
  assert.ok(memberReader.includes(truthfulCoverageCopy), `NFL board scopes coverage truthfully: ${truthfulCoverageCopy}`);
}
for (const overclaim of ["Every market is modeled", "All NFL props", ">All props<"]) {
  assert.ok(!memberReader.includes(overclaim), `NFL board does not overclaim category coverage: ${overclaim}`);
}
for (const diagnostic of ["unavailableNoIndependentBenchmark", "incompleteExactOffers", "unavailableStaleQuotes", "unavailableFeatureContext", "completedEvaluations"]) {
  assert.ok(memberReader.includes(diagnostic), `NFL member coverage discloses ${diagnostic}`);
}
for (const internalOnly of ["Held", "operationalExceptions", "recoveryEligibleOperationalExceptions", "roleOrIdentityHeld"]) {
  assert.ok(!memberReader.includes(internalOnly), `NFL member component must not expose internal alert state: ${internalOnly}`);
}
for (const readerEvidence of ["Available Exact Prices", "Same-Book Movement", "row.bookEvidence", "row.opponent", "row.scheduledStart", "provider(row.provider)", "OddSphere Forecast", "Projection Context", "Empirical 80% model range"]) {
  assert.ok(memberReader.includes(readerEvidence), `NFL reader exposes conformance evidence: ${readerEvidence}`);
}
assert.ok(!memberReader.includes("No Edge"), "NFL uses the current universal No Play member vocabulary");
assert.ok(memberReader.includes("Offers without a complete public evaluation are excluded from the board; they are not relabeled as No Play."));
assert.ok(memberReader.includes("PlayerPropReaderDialog"), "NFL uses the shared MLB/NFL reader behavior contract");
assert.ok(memberReader.includes("initialSelectedKey"));
assert.ok(memberReader.includes('url.searchParams.set("reader", selectedKey)'));
assert.ok(memberReader.includes("window.history.replaceState"), "reader selection remains URL-addressable like MLB");
const sharedReader = readFileSync("app/player-props/components/PlayerPropReaderDialog.tsx", "utf8");
for (const readerBehavior of [
  'document.body.style.overflow = "hidden"',
  'event.key === "Escape"',
  'event.key !== "Tab"',
  "previousFocus?.focus()",
  "event.currentTarget === event.target",
  'aria-label="Close reader"',
  'sm:max-w-[980px]',
  'h-[100dvh]',
]) assert.ok(sharedReader.includes(readerBehavior), `shared props reader preserves: ${readerBehavior}`);
const mlbReader = readFileSync("app/mlb/props/components/PlayerPropsDashboard.tsx", "utf8");
assert.ok(mlbReader.includes("PlayerPropReaderDialog"), "MLB and NFL execute the same reader shell");
const productionWriter = readFileSync("lib/services/football/nflPlayerPropsProductionWriter.ts", "utf8");
assert.ok(productionWriter.includes("buildNflPlayerPropsInferenceContextFromForwardEvidence"));
assert.ok(productionWriter.includes("readNflForwardEvidence"));
assert.ok(!productionWriter.includes("collectNflPlayerPropsInferenceContext"), "production must not duplicate direct roster/injury/main-market calls");
assert.ok(productionWriter.includes("includeOpenings: NFL_PLAYER_PROPS_PRODUCTION_INCLUDE_OPENINGS"));
assert.ok(productionWriter.includes("now: args.now"), "settlement finality uses the authorized writer timestamp");
const cronRoute = readFileSync("app/api/cron/nfl-forward-evidence/route.ts", "utf8");
assert.ok(cronRoute.includes('process.env.NFL_PLAYER_PROPS_ENABLED === "true"'), "props writer is exact-string opt-in");
assert.equal((cronRoute.match(/playerProps = await runNflPlayerPropsProductionWriter/g) ?? []).length, 1, "one NFL cron invokes props exactly once and sequentially");
assert.ok(cronRoute.includes('sport: "nfl"') && cronRoute.includes('leaseGroup: "prediction_pipeline"') && cronRoute.includes("requireLease: true"));
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string }> };
assert.equal(vercel.crons.filter((cron) => cron.path === "/api/cron/nfl-forward-evidence").length, 1, "no second NFL props timer exists");
assert.equal(vercel.crons.filter((cron) => /nfl.*props|props.*nfl/i.test(cron.path)).length, 0, "props does not add an independent cron");
const memberPage = readFileSync("app/player-props/page.tsx", "utf8");
assert.ok(memberPage.includes('process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true"'));
assert.ok(memberPage.includes('if (!enabled || query.league !== "nfl") redirect("/mlb/props")'));
assert.ok(memberPage.includes("requestedReader") && memberPage.includes("initialSelectedKey"));
assert.ok(memberPage.includes("buildNflPlayerPropsMemberSnapshot(snapshot)"), "the live route serializes the public DTO, not the stored audit snapshot");
const mlbPage = readFileSync("app/mlb/props/page.tsx", "utf8");
assert.ok(mlbPage.includes('nflEnabled={process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true"}'), "MLB hides the NFL pill until the member flag is enabled");
const leaguePills = readFileSync("app/player-props/components/PlayerPropsLeaguePills.tsx", "utf8");
const leagueLink = readFileSync("app/player-props/components/PlayerPropsLeagueLink.tsx", "utf8");
assert.ok(leaguePills.includes('href: reviewMode ? "/dev/mlb-props-preview" : "/mlb/props"'));
assert.ok(leaguePills.includes('reviewMode ? "/dev/nfl-props-preview" : "/player-props?league=nfl"'));
assert.ok(leaguePills.includes('active ? "Active" : item.href ? "View props" : "Coming soon"'));
assert.ok(leaguePills.includes("<PlayerPropsLeagueLink"), "both live league pills use the shared intent-prefetch link");
assert.ok(leaguePills.includes("prefetchOnMount={!active}"), "only the inactive league destination is warmed when the shared rail mounts");
assert.ok(leagueLink.includes('from "next/link"') && leagueLink.includes('from "next/navigation"'));
assert.ok(leagueLink.includes("router.prefetch(href)"), "league intent warms the exact canonical destination");
assert.ok(leagueLink.includes("if (prefetchOnMount) router.prefetch(href)"), "dynamic opposite-league RSC payload warms before click intent");
assert.ok(leagueLink.includes("onPointerEnter={prefetch}") && leagueLink.includes("onFocus={prefetch}"), "pointer and keyboard intent prefetch without replacing Link navigation");
assert.ok(!leagueLink.includes("router.push") && !leagueLink.includes("preventDefault"), "prefetch does not replace native Link history behavior");
assert.equal((mlbPage.match(/<PlayerPropsLeaguePills/g) ?? []).length, 3, "each MLB page result renders exactly one shared league rail");
assert.equal((mlbReader.match(/PropLeagueRail/g) ?? []).length, 0, "MLB dashboard does not render a second stale league rail");
const productShellRoutes = readFileSync("lib/navigation/productShellRoutes.ts", "utf8");
for (const route of ["/mlb/props", "/player-props", "/dev/mlb-props-preview", "/dev/nfl-props-preview"]) assert.ok(productShellRoutes.includes(`"${route}"`));
const labAppNav = readFileSync("app/lab/components/LabAppNav.tsx", "utf8");
assert.ok(labAppNav.includes('"/player-props": "/mlb/props"'));
assert.ok(labAppNav.includes('"/dev/nfl-props-preview": "/mlb/props"'));
const migration = readFileSync("lib/db/schema-migration-v39-nfl-player-props-tracking.sql", "utf8");
for (const required of [
  "CREATE TABLE IF NOT EXISTS public.nfl_player_prop_records",
  "UNIQUE (tracking_key, decision_release)",
  "ENABLE ROW LEVEL SECURITY",
  "REVOKE ALL ON TABLE public.nfl_player_prop_records FROM anon, authenticated",
  "GRANT SELECT, INSERT, UPDATE ON TABLE public.nfl_player_prop_records TO service_role",
]) assert.ok(migration.includes(required), `NFL props tracking migration must preserve: ${required}`);

console.log("NFL player-props one-writer lifecycle, T-60 freeze, tracking, and CLV contract passed.");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import { NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE, NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, type NflForwardEvidencePayload, type NflForwardStoredEvidence, } from "../lib/services/football/nflForwardEvidence";
import { buildNflWeekOneHeldMemberFixture, } from "../lib/services/football/nflWeekOneHeldMemberFixture";
import { getNflV1WeekOneOutcomeForecast, } from "../lib/services/football/nflV1WeekOneOutcome";
import { buildNflV1ActionableGradeBundle,  } from "../lib/services/football/nflV1ActionableGradeCandidate";
import { NFL_R6_MONEYLINE_CALIBRATION_RELEASE, NFL_R6_MONEYLINE_DECISION_RELEASE, NFL_R6_MONEYLINE_MODEL_RELEASE, NFL_R6_RUNTIME_ARTIFACT_RELEASE, NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE, NFL_R6_SOURCE_POINT_MODEL_RELEASE, type NflR6ShadowMoneylineDecision, } from "../lib/services/football/nflR6MoneylineShadow";
import { hashNflForwardEvidencePayload } from "../lib/services/football/nflForwardEvidence";
import { planNflPublishedDeadlineLocks, buildNflPublishedDeadlineTrackingRecords, validateNflPublishedLock, withNflPublishedDeadlineLocks, readNflPublishedDeadlineLocks, nflPublishedGameSha256, planNflOwnerPublishedRecovery, type NflPublishedLockProposal } from "../lib/services/football/nflPublishedDeadlineTracking";
import { buildNflForwardMemberSnapshot } from "../lib/services/football/nflForwardMemberSnapshotStore";
import { writeOfficialTrackingFromPayloads } from "../lib/services/football/nflForwardEvidenceWriter";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import { selectTrackingRecordsByScope } from "../lib/services/trackingAggregateService";
import { comparePublishedNflSlate } from "../lib/services/audit/trackingIntegrityAudit";
import { gradePrediction } from "../lib/services/predictionGrader";
const capturedAt = "2026-09-10T16:50:00.000Z";
const weekOneSlate = [["NE", "SEA"], ["SF", "LAR"]] as const;
function syntheticRow(index: number): NflForwardStoredEvidence {
    const providerGameId = String(1392215 + index);
    const [away, home] = weekOneSlate[index - 1]!;
    const scheduledStart = new Date(Date.parse("2026-09-10T17:00:00.000Z") + index * 3600000).toISOString();
    const quote = (observedAt: string, offset: number) => ({
        providerGameId,
        sportsbook: "fanduel",
        observedAt,
        moneyline: { awayPrice: 110 + offset, homePrice: -130 - offset },
        spread: { awayLine: 2.5, awayPrice: -105 + offset, homeLine: -2.5, homePrice: -115 - offset },
        total: { line: 44.5, overPrice: -108 - offset, underPrice: -112 + offset },
    });
    const split = {
        provider: "playbook" as const,
        capturedAt,
        booksUsed: 5,
        homeMoneyPct: 54,
        awayMoneyPct: 46,
        homeBetsPct: 51,
        awayBetsPct: 49,
        overMoneyPct: 55,
        underMoneyPct: 45,
        overBetsPct: 48,
        underBetsPct: 52,
    };
    const teamDepth = (team: string, quarterback: string) => ({
        provider: "balldontlie" as const,
        team,
        capturedAt,
        sourceSnapshotId: `depth-${team}`,
        starterStatus: "projected" as const,
        expectedStartingQuarterback: {
            playerId: `qb-${team}`,
            name: quarterback,
            position: "QB",
            depth: "QB1",
            depthRank: 1,
            injuryStatus: null,
            explicitStarter: false,
        },
        quarterbackDepth: [],
        roster: [],
    });
    const current = quote(capturedAt, 0);
    const currentComparableBooks = comparableBooks(current);
    const openingQuote = quote("2026-08-22T03:40:02.901Z", 2);
    const outcome = getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam: away, homeTeam: home });
    const selectHome = outcome.homeWinProbability >= outcome.awayWinProbability;
    const selectedTeam = selectHome ? home : away;
    const selectedProbability = selectHome ? outcome.homeWinProbability : outcome.awayWinProbability;
    const shadowMoneyline: NflR6ShadowMoneylineDecision = {
        schemaRelease: NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
        decisionKind: "shadow_exact_price_bet",
        shadowOnly: true,
        publicationEligible: false,
        trackingEligible: false,
        providerGameId,
        market: "moneyline",
        grade: index <= 8 ? "Lean" : "Held",
        side: selectHome ? "home" : "away",
        team: selectedTeam,
        modelProbability: selectedProbability,
        otherBooksConsensusFairProbability: 0.5,
        targetBookFairProbability: 0.5,
        otherBookCount: 4,
        evaluatedQuote: {
            sportsbook: current.sportsbook,
            line: null,
            price: selectHome ? current.moneyline!.homePrice : current.moneyline!.awayPrice,
            observedAt: current.observedAt,
        },
        expectedValuePerUnit: 0.02,
        edgePercentagePoints: (selectedProbability - 0.5) * 100,
        decisionStage: "opening_evaluation",
        evaluatedAt: current.observedAt,
        gameStartsAt: scheduledStart,
        lockedAt: null,
        reason: index <= 8 ? "uncapped_market_led_exact_price_candidate" : "exact_price_does_not_clear_candidate_thresholds",
        footballProjection: null,
        quarterbackContext: {
            away: { name: `Away QB ${index}`, historyMatched: true, historySource: "frozen_artifact", status: "projected" },
            home: { name: `Home QB ${index}`, historyMatched: true, historySource: "frozen_artifact", status: "projected" },
        },
        health: {
            blockingReasons: [],
            quarterbackReasons: ["away_quarterback_projected_not_confirmed", "home_quarterback_projected_not_confirmed"],
            contextReasons: ["sharpapi_splits_unavailable"],
        },
        runtimeArtifactRelease: NFL_R6_RUNTIME_ARTIFACT_RELEASE,
        modelRelease: NFL_R6_MONEYLINE_MODEL_RELEASE,
        calibrationRelease: NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
        decisionRelease: NFL_R6_MONEYLINE_DECISION_RELEASE,
        sourcePointModelRelease: NFL_R6_SOURCE_POINT_MODEL_RELEASE,
    };
    const production = buildNflV1ActionableGradeBundle({
        providerGameId,
        awayTeam: away,
        homeTeam: home,
        gameStartsAt: scheduledStart,
        current,
        comparableCurrentBooks: currentComparableBooks,
        shadowMoneyline,
    });
    return {
        id: `row-${providerGameId}`,
        providerGameId,
        stage: "unlocked",
        capturedAt,
        gameStartAt: scheduledStart,
        payloadSha256: "",
        payload: {
            schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
            collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
            runId: "test-run",
            season: 2026,
            week: 1,
            slateGameCount: 1,
            stage: "unlocked",
            captureTiming: "on_time",
            capturedAt,
            cutoffAt: null,
            t60LagMinutes: null,
            game: {
                providerGameId,
                providerWeek: 1,
                season: 2026,
                scheduledStart,
                status: "Scheduled",
                away: { id: index * 2, abbreviation: away, name: `Away ${index}` },
                home: { id: index * 2 + 1, abbreviation: home, name: `Home ${index}` },
            },
            market: {
                current,
                currentBooks: currentComparableBooks,
                comparableCurrentBooks: currentComparableBooks,
                providerOpening: openingQuote,
                providerOpeningBooks: [openingQuote],
                comparableProviderOpeningBooks: [openingQuote],
                operationalOpening: {
                    provenance: "provider_opening",
                    capturedAt: openingQuote.observedAt,
                    quote: openingQuote,
                },
                playbookLine: null,
                playbookSplits: { moneyline: split, spread: split, total: split },
                sharpApiSplits: null,
            },
            startersAndDepth: {
                away: teamDepth(away, `Away QB ${index}`),
                home: teamDepth(home, `Home QB ${index}`),
            },
            injuries: {
                eventId: providerGameId,
                awayTeam: away,
                homeTeam: home,
                source: "BALLDONTLIE",
                sourceLabel: "BALLDONTLIE NFL injuries",
                sourceUrl: null,
                reportUpdatedAt: capturedAt,
                teams: [
                    { abbreviation: away, teamName: `Away ${index}`, players: [] },
                    { abbreviation: home, teamName: `Home ${index}`, players: [] },
                ],
            },
            weather: {
                venueTeam: home,
                venueName: "Test Stadium",
                roofType: "outdoor",
                status: "outside_forecast_window",
                capturedAt,
                forecast: null,
            },
            outcomeForecast: outcome,
            decisions: {
                evaluatedBets: production.evaluatedBets,
                outcomeConfidence: production.outcomeConfidence,
                modelPromotionStatus: production.modelPromotionStatus,
                publicationEnabled: production.publicationEnabled,
                trackingEnabled: production.trackingEnabled,
            },
            coverage: {
                currentOdds: true,
                currentBookCount: 1,
                comparableCurrentBookCount: 1,
                multibookConsensusReady: false,
                operationalOpening: true,
                rosterAndDepth: true,
                expectedQuarterbacks: true,
                injuries: true,
                playbookSplits: true,
                sharpApiSplits: false,
                weather: false,
                healthHolds: ["sharpapi_splits_unavailable"],
            },
            requestBudget: {
                balldontlieSlate: 1,
                balldontlieRoster: 1,
                balldontlieInjuriesMaximum: 1,
                playbook: 1,
                sharpApi: 1,
                weather: 1,
                totalMaximum: 6,
            },
        },
    };
}
function comparableBooks(current: NflPreviewBookOdds): NflPreviewBookOdds[] {
    return [
        current,
        { ...structuredClone(current), sportsbook: "draftkings" },
        { ...structuredClone(current), sportsbook: "caesars" },
    ];
}
async function main() {
    const source = syntheticRow(1) as NflPublishedLockProposal['source'];
    source.payloadSha256 = hashNflForwardEvidencePayload(source.payload);
    const before = JSON.stringify(source);
    const fixture = buildNflWeekOneHeldMemberFixture([source]);
    const previous = buildNflForwardMemberSnapshot({ fixture, season: 2026, week: 1, publishedAt: '2026-09-10T16:51:00.000Z' });
    const now = '2026-09-10T17:08:00.000Z';
    const plan = (clock = now, failures: ReadonlySet<string> = new Set([source.providerGameId])) => planNflPublishedDeadlineLocks({ rows: [source], previous, now: clock, failedFinalGameIds: failures });
    assert.equal(plan(now, new Set()).length, 0, 'never preempt a healthy final capture');
    assert.equal(plan('2026-09-10T16:59:00.000Z').length, 0);
    assert.equal(plan('2026-09-11T17:08:00.000Z').length, 0, 'never automatically recover past games');
    const [proposal] = plan();
    assert(proposal);
    validateNflPublishedLock(proposal, true);
    const records = buildNflPublishedDeadlineTrackingRecords(proposal, 42);
    assert.equal(records.length, 3);
    assert.equal(JSON.stringify(source), before);
    for (const record of records) {
        const original = source.payload.decisions.evaluatedBets.find(b => b.market === record.market)!;
        assert.deepEqual(record.snapshot_json?.decision_tuple, original);
        assert.equal(record.locked_at, now);
        assert.equal(record.odds_american, original.evaluatedQuote.price);
        assert.equal(record.model_probability, original.modelProbability);
        assert.equal(record.model_version, original.decisionRelease);
    }
    const failed=structuredClone(source);failed.id='failed';failed.capturedAt=now;
    failed.payload.capturedAt=now;failed.payload.captureAttempt={requestedStage:'t60',status:'failed',reason:'test_final_failed',cutoffAt:'2026-09-10T17:00:00.000Z'};
    failed.payload.decisions.publicationEnabled=false;failed.payload.decisions.evaluatedBets=[];
    failed.payloadSha256=hashNflForwardEvidencePayload(failed.payload);
    const recoveryArgs={rows:[source,failed],previous,sourceId:source.id,failedId:failed.id,ownerApproval:'Test-only explicit owner approval',now:'2026-09-11T18:00:00.000Z'};
    const recovered=planNflOwnerPublishedRecovery(recoveryArgs);
    assert.equal(buildNflPublishedDeadlineTrackingRecords(recovered,42)[0]!.locked_at,recoveryArgs.now);
    assert.throws(()=>planNflOwnerPublishedRecovery({...recoveryArgs,ownerApproval:''}),/owner receipt/);
    const wrongFailed=structuredClone(recovered);wrongFailed.failed!.payload.coverage.healthHolds.push('changed');
    assert.throws(()=>validateNflPublishedLock(wrongFailed),/capture proof/);
    const corrupted = structuredClone(proposal);
    corrupted.memberGame.markets.total.priceAmerican = -999;
    assert.throws(() => validateNflPublishedLock(corrupted), /card differs/);
    corrupted.receipt.memberGameSha256 = nflPublishedGameSha256(corrupted.memberGame);
    assert.throws(() => validateNflPublishedLock(corrupted, true), /prices\/picks/);
    const old = structuredClone(previous);
    old.fixture.snapshot.games[0]!.lockedAt = 'old-lock';
    old.fixture.snapshot.games[0]!.lockState = 'locked';
    assert.equal(planNflPublishedDeadlineLocks({ rows: [source], previous: old, now, failedFinalGameIds: new Set([source.providerGameId]) }).length, 0);
    const legacyCard=structuredClone(old.fixture.snapshot.games[0]!);
    legacyCard.markets.total.verdict!.label='Legacy frozen label';
    old.fixture.snapshot.games[0]=legacyCard;
    assert.deepEqual(withNflPublishedDeadlineLocks(old,[proposal])!.fixture.snapshot.games[0],legacyCard,'already locked legacy DTO always wins byte-for-byte');
    const frozen = withNflPublishedDeadlineLocks(previous, [proposal]);
    assert.deepEqual(frozen?.fixture.snapshot.games[0], proposal.memberGame);
    assert.equal(previous.fixture.snapshot.games[0]!.lockedAt, null, 'reader cannot mutate its input');
    const inserted: PredictionRecordRow[] = [];
    let stored: unknown[] = [];
    let reads = 0;
    const client = { from(table: string) {
            let writing = false;
            const q = { select() { return q; }, eq() { return q; }, in() { return q; }, limit() { return q; },
                insert(rows: PredictionRecordRow[]) { assert.equal(table, 'prediction_records'); writing = true; inserted.push(...rows); return q; },
                upsert() { assert.equal(table, 'teams', 'existing final fixture must never be upserted'); return q; },
                then(resolve: (r: unknown) => void) { if (table === 'prediction_records')
                    reads++; resolve({ error: null, data: table === 'games' ? [{ id: 42, external_id: Number(source.providerGameId), game_date: source.gameStartAt, status: 'final', home_score: 27, away_score: 10 }] : table === 'teams' ? [{ id: 1, external_id: 2 }, { id: 2, external_id: 3 }] : writing ? [{ id: 1 }, { id: 2 }, { id: 3 }] : stored }); } };
            return q;
        } } as unknown as SupabaseClient;
    const args = { client, payloads: [source.payload], apply: true, publishedDeadlineLocks: [proposal] };
    assert.equal((await writeOfficialTrackingFromPayloads(args)).trackingRecordsInserted, 3);
    stored = inserted.map((r, i) => ({ ...r, id: i + 1, public_source: source.payloadSha256 }));
    assert.equal((await writeOfficialTrackingFromPayloads(args)).trackingRecordsInserted, 0);
    stored = stored.slice(0, 1);
    await assert.rejects(writeOfficialTrackingFromPayloads(args), /partial or different/);
    assert.equal(inserted.length, 3);
    stored = [{ external_id: Number(source.providerGameId), locked_at: now, sourceHash: source.payloadSha256, receipt: proposal.receipt, game: proposal.memberGame }];
    assert.deepEqual((await readNflPublishedDeadlineLocks({ client, rows: [source] }))[0]!.memberGame, proposal.memberGame);
    assert(reads > 0);
    const slate = Array.from({ length: 14 }, (_, i) => ({ externalId: i + 1, startsAt: i === 13 ? '2026-09-11T17:00:00Z' : '2026-09-10T18:00:00Z', source: 'fixture' }));
    const ten = Array.from({ length: 10 }, (_, i) => (['moneyline', 'spread', 'total'] as const).map(market => ({ ...records[0]!, external_id: i + 1, market }))).flat();
    assert.equal(comparePublishedNflSlate(ten, slate, '2026-09-11T01:00:00Z').length, 9, 'all three markets of an absent game are checked; future game excluded');
    const operational = records.map(r => ({ ...r, source_quality: 'nfl_public_operational_forecast_r1' }));
    assert.equal(selectTrackingRecordsByScope(operational).calendarRecords.length, 3);
    assert.equal(selectTrackingRecordsByScope(operational).currentReleaseRecords.length, 0);
    console.log('PASS published NFL fallback: normal T60 priority, copy-only prices/grades, real lock clock, immutable existing card and final fixture, atomic/idempotent/refused partial writes, bounded reader, full-slate audit and operational separation');
    const path = process.argv.find(a => a.startsWith('--frozen='))?.slice(9);
    if (path) {
        const data = JSON.parse(gunzipSync(readFileSync(path)).toString()) as {
      rows:Array<{id:string;provider_game_id:string;stage:NflForwardStoredEvidence['stage'];captured_at:string;game_start_at:string;payload_sha256:string;payload:NflForwardEvidencePayload}>;
      published:{payload:ReturnType<typeof buildNflForwardMemberSnapshot>};
    };
        const rows = data.rows.map((r) => ({ id: r.id, providerGameId: r.provider_game_id, stage: r.stage, capturedAt: new Date(r.captured_at).toISOString(), gameStartAt: new Date(r.game_start_at).toISOString(), payloadSha256: r.payload_sha256, payload: r.payload }));
        for (const id of ['1392358', '1392362']) {
            const source = rows.find((r) => r.providerGameId === id && !r.payload.captureAttempt) as NflPublishedLockProposal['source'];
            const snapshot = structuredClone(data.published.payload);
            snapshot.publishedAt = source.capturedAt;
            const now = new Date(Date.parse(source.gameStartAt) - 52 * 60000).toISOString();
            const [p] = planNflPublishedDeadlineLocks({ rows, previous: snapshot, now, failedFinalGameIds: new Set([id]) });
            assert(p);
            const built = buildNflPublishedDeadlineTrackingRecords(p, 42);
            console.log(JSON.stringify({ id, exception: p.receipt.operationalException, records: built.map(r => ({ market: r.market, pick: r.pick, line: r.line_value, price: r.odds_american, grade: r.play_grade, result: gradePrediction({ record: { ...r, id: 1 }, game: { status: 'final', away_score: id === '1392358' ? 22 : 34, home_score: id === '1392358' ? 24 : 6, first_inning_runs: null }, source: 'manual_operator' }).result })) }));
            assert.equal(JSON.stringify(data.rows.find((r) => r.id === source.id)!.payload), JSON.stringify(source.payload));
        }
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

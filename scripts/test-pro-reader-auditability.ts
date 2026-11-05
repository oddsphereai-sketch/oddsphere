import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";
import {
  buildNbaSnapshotEvidenceMetadata,
  NBA_SNAPSHOT_EVIDENCE_METADATA_RELEASE,
} from "../lib/services/nba/buildNbaPredictionRecords";
import {
  buildNbaMarketPosturePresentation,
  NBA_MEMBER_POSTURE_PRESENTATION_RELEASE,
} from "../lib/services/nba/adaptNbaToDailyEdgeResponse";
import type { MarketIntelligence } from "../lib/services/nba/buildNbaDailyEdgeDto";
import {
  buildNhlMarketPosturePresentation,
  NHL_MEMBER_POSTURE_PRESENTATION_RELEASE,
} from "../lib/services/nhl/adaptNhlToDailyEdgeResponse";
import type { NhlReaderMarketReceipt } from "../lib/services/nhl/nhlReaderReceipt";
import { resolveDailyEdgeAuditHttpPayload } from "../lib/services/dailyEdgeAuditTransport";

const memberGame = {
  markets: {
    moneyline: {
      publicSplits: [
        { side: "home", label: "HME", moneyPct: 61, betsPct: 54 },
        { side: "away", label: "AWY", moneyPct: 39, betsPct: 46 },
      ],
      sportsbookSplits: null,
      currentPriceAmerican: -125,
      currentPriceSportsbook: "caesars",
      currentPriceObservedAt: "2026-11-04T15:00:00.000Z",
      oddsTrail: [
        { label: "first", american: -110, line: null, observedAt: "2026-11-04T12:00:00.000Z" },
        { label: "current", american: -125, line: null, observedAt: "2026-11-04T15:00:00.000Z" },
      ],
      lineTrail: [],
    },
    total: {
      publicSplits: [],
      sportsbookSplits: { rows: [
        { side: "over", label: "Over", moneyPct: 63, betsPct: 51 },
        { side: "under", label: "Under", moneyPct: 37, betsPct: 49 },
      ] },
      priceAmerican: -110,
      marketSource: "pinnacle",
      oddsTrail: [{ label: "current", american: -110, line: 226.5, observedAt: "2026-11-04T15:00:00.000Z" }],
      lineTrail: [],
    },
    first_inning: { publicSplits: [], sportsbookSplits: null, oddsTrail: [], lineTrail: [] },
  },
} as unknown as DailyEdgeGameDto;

const mlMetadata = buildNbaSnapshotEvidenceMetadata({ memberGame, market: "moneyline", pickSide: "home" });
assert.equal(mlMetadata.release, NBA_SNAPSHOT_EVIDENCE_METADATA_RELEASE);
assert.equal(mlMetadata.splits_state, "available");
assert.equal(mlMetadata.current_price.movement_state, "tracked");
assert.deepEqual(mlMetadata.public_splits, {
  picked_side: "home", picked_handle_pct: 61, picked_bets_pct: 54,
  opp_handle_pct: 39, opp_bets_pct: 46,
});
const totalMetadata = buildNbaSnapshotEvidenceMetadata({ memberGame, market: "total", pickSide: "over" });
assert.equal(totalMetadata.splits_state, "available", "professional splits in the embedded DTO cannot be mislabeled unavailable");
assert.equal(totalMetadata.public_splits, null, "professional evidence is not relabeled as public consensus");
assert.equal(totalMetadata.current_price.movement_state, "current_only");

const nbaIntel = (posture: Record<string, unknown>) => ({
  market: "spread", pick_side: "home", named_book_posture: {
    release: "nba_named_book_posture_2026_11_04_r9_own_book_pressure",
    evaluatedAt: "2026-11-04T15:00:00.000Z", market: "spread", pickedSide: "home",
    supportingSources: [], opposingSources: [], conflictingSources: [], forecastAuthorityGranted: false,
    ...posture,
  },
} as unknown as MarketIntelligence);
const nbaResistance = buildNbaMarketPosturePresentation(nbaIntel({ opposingSources: ["circa"] }));
assert.equal(nbaResistance.release, NBA_MEMBER_POSTURE_PRESENTATION_RELEASE);
assert.equal(nbaResistance.marketSignal, "market_resistance");
assert.match(nbaResistance.explanation ?? "", /circa/i);
const nbaConflict = buildNbaMarketPosturePresentation(nbaIntel({ conflictingSources: ["circa", "pinnacle"] }));
assert.equal(nbaConflict.marketSignal, "market_neutral");
assert.match(nbaConflict.explanation ?? "", /conflicts/i);
const nbaHeld = buildNbaMarketPosturePresentation(nbaIntel({ heldResistanceSupportingSources: ["pinnacle"] }));
assert.equal(nbaHeld.marketSignal, "market_neutral");
assert.match(nbaHeld.explanation ?? "", /hold|held/i);

const receipt = (state: NhlReaderMarketReceipt["interpretation"]["state"], side: "home" | "away" | null) => ({
  interpretation: { state, side, authoritySource: "market_episode", reasonCodes: [] },
} as unknown as NhlReaderMarketReceipt);
const nhlSupport = buildNhlMarketPosturePresentation({ receipt: receipt("confirmation", "home"),
  fallbackRead: "unavailable", fallbackSide: null, finalSide: "home" });
assert.equal(nhlSupport.release, NHL_MEMBER_POSTURE_PRESENTATION_RELEASE);
assert.equal(nhlSupport.marketSignal, "market_confirmed");
assert.match(nhlSupport.explanation ?? "", /confirms/i);
const nhlOpposition = buildNhlMarketPosturePresentation({ receipt: receipt("confirmation", "away"),
  fallbackRead: "confirmation", fallbackSide: "home", finalSide: "home" });
assert.equal(nhlOpposition.marketSignal, "market_resistance", "stored receipt posture wins over the coarse model-layer signal");
const nhlConflict = buildNhlMarketPosturePresentation({ receipt: receipt("disagreement", null),
  fallbackRead: "confirmation", fallbackSide: "home", finalSide: "home" });
assert.equal(nhlConflict.marketSignal, "market_neutral");
assert.match(nhlConflict.explanation ?? "", /conflicting/i);

const diagnostic = resolveDailyEdgeAuditHttpPayload({ status: 409, ok: false, payload: {
  ok: false, result: { ok: false, summary: { criticalIssues: 2 }, issues: [{ reason: "reader_failed" }] },
  boards: { nba: { games: [] } },
} });
assert.equal(diagnostic.diagnosticResponse, true);
assert.equal(diagnostic.hasCriticals, true);
assert.deepEqual(diagnostic.boards.nba, { games: [] });
assert.equal(resolveDailyEdgeAuditHttpPayload({ status: 200, ok: true, payload: {
  ok: true, result: { ok: true, summary: { criticalIssues: 0 } }, boards: { nba: { games: [] } },
} }).hasCriticals, false);
assert.throws(() => resolveDailyEdgeAuditHttpPayload({ status: 500, ok: false, payload: { boards: { nba: {} } } }), /HTTP 500/);
assert.throws(() => resolveDailyEdgeAuditHttpPayload({ status: 409, ok: false, payload: { boards: { nba: {} } } }), /omitted its audit result/);

const nhlAdapterSource = readFileSync("lib/services/nhl/adaptNhlToDailyEdgeResponse.ts", "utf8");
assert.match(nhlAdapterSource, /input\.lockedAt === null \? input\.readerReceipt\?\.markets : undefined/,
  "new posture presentation must never reinterpret an immutable locked card");

console.log("pro reader auditability tests passed");

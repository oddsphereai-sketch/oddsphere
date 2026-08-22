/**
 * Score a read-only latest-row export with the same r6 shadow function used by
 * the leased NFL writer. This operator never publishes, tracks, or writes a DB.
 */

import fs from "node:fs";
import path from "node:path";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
} from "../../lib/services/football/nflForwardEvidence";
import {
  buildNflR6ShadowMoneylineDecision,
  NFL_R6_MONEYLINE_DECISION_RELEASE,
  NFL_R6_MONEYLINE_MODEL_RELEASE,
} from "../../lib/services/football/nflR6MoneylineShadow";

type ExportRow = { id: string; payloadSha256: string; payload: NflForwardEvidencePayload };
type EvidenceExport = {
  exportRelease: string;
  evidenceRelease: string;
  exportedAt: string;
  readOnly: boolean;
  season: number;
  week: number;
  storedRowsRead: number;
  latestRows: ExportRow[];
};

function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

const input = argument("input");
if (!input) throw new Error("--input=<read-only evidence export> is required.");
const inputPath = path.resolve(process.cwd(), input);
const evidence = JSON.parse(fs.readFileSync(inputPath, "utf8")) as EvidenceExport;
if (
  evidence.readOnly !== true
  || evidence.evidenceRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE
  || evidence.season !== 2026
  || evidence.week !== 1
  || evidence.latestRows.length !== 16
  || new Set(evidence.latestRows.map((row) => row.payload.game.providerGameId)).size !== 16
) throw new Error("Latest authoritative Week 1 evidence export contract mismatch.");

const decisions = evidence.latestRows.map((row) => {
  const payload = row.payload;
  return buildNflR6ShadowMoneylineDecision({
    game: payload.game,
    opening: payload.market.operationalOpening,
    comparableCurrentBooks: payload.market.comparableCurrentBooks,
    startersAndDepth: payload.startersAndDepth,
    injuries: payload.injuries,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    t60LagMinutes: payload.t60LagMinutes,
    coverageHealthHolds: payload.coverage.healthHolds,
  });
});
if (decisions.some((decision) => decision.publicationEligible || decision.trackingEligible)) {
  throw new Error("Shadow audit crossed the publication/tracking boundary.");
}

const leans = decisions.filter((decision) => decision.grade === "Lean");
const held = decisions.filter((decision) => decision.grade === "Held");
const output = {
  auditRelease: "nfl_r6_authoritative_forward_shadow_audit_2026_08_22_r1",
  generatedAt: new Date().toISOString(),
  input: {
    path: inputPath,
    exportRelease: evidence.exportRelease,
    exportedAt: evidence.exportedAt,
    evidenceRelease: evidence.evidenceRelease,
    storedRowsRead: evidence.storedRowsRead,
    latestCapturedAt: decisions.map((decision) => decision.evaluatedAt).sort().at(-1) ?? null,
  },
  modelRelease: NFL_R6_MONEYLINE_MODEL_RELEASE,
  decisionRelease: NFL_R6_MONEYLINE_DECISION_RELEASE,
  season: 2026,
  week: 1,
  shadowOnly: true,
  publicationEnabled: false,
  trackingEnabled: false,
  boardCounts: {
    moneylineMarkets: decisions.length,
    shadowLeans: leans.length,
    shadowHeld: held.length,
    productionPromotions: 0,
    productionDemotions: 0,
  },
  proposedShadowPromotions: leans.map((decision) => ({
    providerGameId: decision.providerGameId,
    team: decision.team,
    sportsbook: decision.evaluatedQuote?.sportsbook ?? null,
    price: decision.evaluatedQuote?.price ?? null,
    modelProbability: decision.modelProbability,
    otherBooksConsensusFairProbability: decision.otherBooksConsensusFairProbability,
    edgePercentagePoints: decision.edgePercentagePoints,
    expectedValuePerUnit: decision.expectedValuePerUnit,
    evaluatedAt: decision.evaluatedAt,
    quoteObservedAt: decision.evaluatedQuote?.observedAt ?? null,
    quarterbackReasons: decision.health.quarterbackReasons,
  })),
  held: held.map((decision) => ({
    providerGameId: decision.providerGameId,
    team: decision.team,
    reason: decision.reason,
    blockingReasons: decision.health.blockingReasons,
  })),
};

const outputArg = argument("output");
if (outputArg) {
  const outputPath = path.resolve(process.cwd(), outputArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(output, null, 2));

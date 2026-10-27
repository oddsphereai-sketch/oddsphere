import { marketBrainCanonicalJson, marketBrainSha256 } from
  "../lib/services/marketBrain/marketBrainCanonical";
import {
  buildMarketBrainCase,
  MARKET_BRAIN_BLIND_SPOTS,
  MARKET_BRAIN_CONTRACT_RELEASE,
} from "../lib/services/marketBrain/marketBrainContract";
import { NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE } from
  "../lib/services/marketBrain/nflMarketBrainResearchInput";
import { NFL_MARKET_BRAIN_SHADOW_RELEASE } from
  "../lib/services/football/nflMarketBrainShadow";

const base = new Date(Math.floor(Date.now() / 1_000) * 1_000);
const at = (offsetMs: number) => new Date(base.getTime() + offsetMs).toISOString();
const eventId = "proof-decision-envelope-event";
const manifestId = "proof-decision-envelope-manifest";
const attemptId = "00000000-0000-4000-8000-000000000501";
const shadowId = "00000000-0000-4000-8000-000000000502";
const captureId = "00000000-0000-4000-8000-000000000503";
const inputId = "00000000-0000-4000-8000-000000000504";
const capturedAt = at(-8.5 * 60_000);
const evaluatedAt = at(-8.4 * 60_000);
const cutoffAt = at(-7 * 60_000);
const startsAt = at(60 * 60_000);

const awayQuote = {
  identity: "spread:proof-book:away:-3.5:-110",
  family: "proof-book:spread:main",
  selection: "away" as const,
  line: -3.5,
  price: -110,
  observedAt: capturedAt,
  settlementTerms: "standard full-game spread including overtime",
};
const homeQuote = {
  identity: "spread:proof-book:home:3.5:-110",
  family: "proof-book:spread:main",
  selection: "home" as const,
  line: 3.5,
  price: -110,
  observedAt: capturedAt,
  settlementTerms: "standard full-game spread including overtime",
};
const decisionEnvelopes = {
  spread: {
    schema: "market_brain_decision_envelope_v1" as const,
    market: "spread" as const,
    incumbentDecision: {
      decision: "action" as const,
      grade: "Lean",
      quoteIdentity: awayQuote.identity,
      decisionRelease: "proof-incumbent-decision-release",
    },
    quoteMenu: [awayQuote, homeQuote],
  },
};

const marketCase = buildMarketBrainCase({
  sport: "nfl",
  eventId,
  evaluatedAt,
  captureBoundary: "raw_provider_response",
  captureLimitations: ["synthetic PostgreSQL decision-envelope proof"],
  subject: {
    kind: "two_team_game",
    awayId: "proof-away",
    homeId: "proof-home",
    startsAt,
  },
  prior: {
    kind: "unavailable",
    release: "proof-independent-model-release",
    reason: "synthetic PostgreSQL decision-envelope proof",
  },
  evaluatedTargets: { spread: awayQuote },
  decisionEnvelopes,
  observations: [],
  sourceManifests: [],
  expectedInputs: [],
  blindSpots: MARKET_BRAIN_BLIND_SPOTS,
});
if (marketBrainCanonicalJson(marketCase.decisionEnvelopes) !==
  marketBrainCanonicalJson(decisionEnvelopes)) {
  throw new Error("v50 proof fixture decision envelope changed during contract materialization");
}

const shadow = {
  release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
  capturedAt,
  case: marketCase,
  bytes: 0,
};
for (let previous = -1; previous !== shadow.bytes;) {
  previous = shadow.bytes;
  shadow.bytes = Buffer.byteLength(JSON.stringify(shadow));
}
const shadowPayload = marketBrainCanonicalJson(shadow);
const shadowSha = marketBrainSha256(shadow);

const manifestPayload = {
  storageId: manifestId,
  candidateRelease: "proof-decision-envelope-candidate",
  release: "proof-decision-envelope-manifest-release",
  createdAt: at(-10 * 60_000),
  partitions: [{
    role: "prospective_shadow",
    events: [{
      eventId,
      captureWindowOpensAt: at(-9 * 60_000),
      captureWindowClosesAt: at(-8 * 60_000),
      cutoffAt,
      startsAt,
      expectedCaptureAttempts: [{ runId: attemptId, stage: "unlocked" }],
    }],
  }],
};
const manifestSha = marketBrainSha256(manifestPayload);

const capturePayload = {
  release: "proof-decision-envelope-capture-set-release",
  eventId,
  shadowRelease: NFL_MARKET_BRAIN_SHADOW_RELEASE,
  contractRelease: MARKET_BRAIN_CONTRACT_RELEASE,
  manifestChecksum: manifestSha,
  partitionRole: "prospective_shadow",
  foldId: "proof-decision-envelope-fold",
  captureWindowOpensAt: at(-9 * 60_000),
  captureWindowClosesAt: at(-8 * 60_000),
  cutoffAt,
  startsAt,
  expectedCaptureAttempts: [{ runId: attemptId, stage: "unlocked" }],
  membership: [{
    recordId: shadowId,
    runId: attemptId,
    stage: "unlocked",
    capturedAt,
    serverCreatedAt: evaluatedAt,
    shadowSha256: shadowSha,
    status: "captured",
  }],
  successfulCaptures: 1,
  failedCaptures: 0,
};
const captureSha = marketBrainSha256(capturePayload);
const sequenceSha = "5".repeat(64);
const featureSha = "6".repeat(64);

const inputPayload = {
  release: NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE,
  eventId,
  cutoffAt,
  startsAt,
  manifestChecksum: manifestSha,
  captureSetRecordId: captureId,
  captureSetChecksum: captureSha,
  sequence: {
    release: "proof-decision-envelope-sequence-release",
    checksum: sequenceSha,
    eventId,
    cutoffAt,
    startsAt,
  },
  features: {
    release: "proof-decision-envelope-feature-release",
    checksum: featureSha,
    eventId,
    cutoffAt,
    inputSequenceChecksum: sequenceSha,
    inputSequenceRelease: "proof-decision-envelope-sequence-release",
  },
  decisionEnvelopes,
  sequenceChecksum: sequenceSha,
  featureChecksum: featureSha,
};
const forgedInputPayload = {
  ...inputPayload,
  decisionEnvelopes: {
    ...decisionEnvelopes,
    spread: {
      ...decisionEnvelopes.spread,
      incumbentDecision: {
        ...decisionEnvelopes.spread.incumbentDecision,
        quoteIdentity: homeQuote.identity,
      },
    },
  },
};

const fixtures: Array<[string, string, string]> = [
  ["base_time", base.toISOString(), ""],
  ["manifest", marketBrainCanonicalJson(manifestPayload), manifestSha],
  ["shadow", shadowPayload, shadowSha],
  ["capture", marketBrainCanonicalJson(capturePayload), captureSha],
  ["input", marketBrainCanonicalJson(inputPayload), marketBrainSha256(inputPayload)],
  ["forged_input", marketBrainCanonicalJson(forgedInputPayload), marketBrainSha256(forgedInputPayload)],
];

function literal(value: string): string {
  if (value.includes("$market_brain_v50$")) throw new Error("fixture contains SQL quote delimiter");
  return `$market_brain_v50$${value}$market_brain_v50$`;
}

process.stdout.write([
  "CREATE TEMP TABLE market_brain_v50_fixture (name text PRIMARY KEY, payload text NOT NULL, sha256 text NOT NULL);",
  ...fixtures.map(([name, payload, sha]) =>
    `INSERT INTO market_brain_v50_fixture VALUES (${literal(name)}, ${literal(payload)}, ${literal(sha)});`),
  `CREATE TEMP TABLE market_brain_v50_ids AS SELECT ${literal(manifestId)}::text manifest_id,`,
  `  ${literal(eventId)}::text event_id, ${literal(attemptId)}::uuid attempt_id,`,
  `  ${literal(shadowId)}::uuid shadow_id, ${literal(captureId)}::uuid capture_id,`,
  `  ${literal(inputId)}::uuid input_id, ${literal(NFL_MARKET_BRAIN_SHADOW_RELEASE)}::text shadow_release,`,
  `  ${literal(MARKET_BRAIN_CONTRACT_RELEASE)}::text contract_release,`,
  `  ${literal(NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE)}::text input_release;`,
  "",
].join("\n"));

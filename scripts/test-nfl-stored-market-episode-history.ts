import assert from "node:assert/strict";
import { nflStoredMarketEpisodeHistory } from "../lib/services/football/nflStoredMarketEpisodeHistory";
import { selectNflNamedMoneylineEpisodeAfterKnowledge, selectNflNamedPricedLineEpisodeAfterKnowledge } from "../lib/services/football/nflMoneylineEpisodeTransport";
import type { NflForwardContextCapture, NflForwardContextFamily } from "../lib/services/football/nflForwardEvidenceCapture";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";

type Market = "moneyline" | "spread" | "total";
const gameId = "1392335";
const originalAt = "2026-10-27T13:35:27.561Z";
const compactOpeningAt = "2026-08-01T12:00:00.000Z";
const capturedAt = "2026-10-27T13:40:00.000Z";
const evaluatedAt = "2026-11-01T17:30:00.000Z";
const family = (market: Market, provider: "s" | "o" | "b" = "s"): NflForwardContextFamily => [
  "circa", provider, "n", null,
  [compactOpeningAt, 0, "s", market === "moneyline" ? null : market === "spread" ? -2 : 45, 120, -140],
  [originalAt, 4.54, "f", market === "moneyline" ? null : market === "spread" ? -4 : 46.5,
    market === "moneyline" ? 180 : -110, market === "moneyline" ? -210 : -110],
];
const capture = (families: Partial<Record<Market, NflForwardContextFamily[]>> = {},
  overrides: Partial<Pick<NflForwardContextCapture, "gameId" | "capturedAt">> = {}): NflForwardContextCapture => ({
  gameId, capturedAt, ...overrides,
  markets: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market,
    { families: families[market] ?? [] }])),
} as unknown as NflForwardContextCapture);
const stored = capture(Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market, [family(market)]])));
const before = JSON.stringify(stored);
const decoded = nflStoredMarketEpisodeHistory({ providerGameId: gameId, evaluatedAt, captures: [stored] });
assert.equal(decoded.length, 3);
assert.equal(JSON.stringify(stored), before, "stored context is never mutated");
for (const row of decoded) {
  assert.equal(row.provider, "sharpapi", "stored source s remains SharpAPI rather than masquerading as Owl");
  assert.equal(row.providerEventId, undefined, "a missing original provider ID is never invented");
  assert.equal(row.observedAt, originalAt);
  assert.equal(row.targetEligible, false);
  assert.deepEqual(row.storedCanonicalEvent, { provenance: "stored_context_capture", canonicalGameId: gameId,
    sourceProvider: "sharpapi", sourceEventId: null, sourceObservedAt: originalAt });
  assert.equal(Object.values(row.marketObservedAt ?? {}).length, 1, "per-market original clocks remain separate");
  assert.equal(Object.values(row.marketObservedAt ?? {})[0], originalAt);
}
assert.deepEqual(decoded.find((row) => row.moneyline)?.moneyline, { awayPrice: 180, homePrice: -210 });
assert.deepEqual(decoded.find((row) => row.spread)?.spread,
  { homeLine: -4, awayLine: 4, awayPrice: -110, homePrice: -110 });
assert.deepEqual(decoded.find((row) => row.total)?.total, { line: 46.5, overPrice: -110, underPrice: -110 });
assert.equal(decoded.some((row) => row.observedAt === compactOpeningAt), false,
  "compact opening has no separate provider lineage and must never inherit current source identity");
const owl = nflStoredMarketEpisodeHistory({ providerGameId: gameId, evaluatedAt,
  captures: [capture({ moneyline: [family("moneyline", "o")] })] });
assert.equal(owl[0]?.provider, "owls");
assert.equal(owl[0]?.storedCanonicalEvent?.sourceProvider, "owls");
assert.equal(owl[0]?.providerEventId, undefined);
assert.deepEqual(nflStoredMarketEpisodeHistory({ providerGameId: gameId, evaluatedAt, captures: [
  null, undefined,
  capture({ moneyline: [family("moneyline")] }, { gameId: "wrong-game" }),
  capture({ moneyline: [family("moneyline")] }, { capturedAt: "2026-11-01T17:31:00Z" }),
  capture({ moneyline: [family("moneyline")] }, { capturedAt: "not-a-time" }),
  capture({ moneyline: [family("moneyline", "b")] }),
] }), [], "wrong game, future/invalid capture and unsupported source cannot contribute chronology");
const badCurrent: NflForwardContextFamily[] = [
  ["circa", "s", "n", null, null, ["2026-10-27T13:41:00Z", -1, "f", null, 180, -210]],
  ["circa", "s", "n", null, null, ["invalid-clock", 0, "f", null, 180, -210]],
  ["circa", "s", "n", null, null, [originalAt, 0, "x", null, 180, -210]],
  ["not-circa", "s", "n", null, null, [originalAt, 0, "f", null, 180, -210]],
];
assert.deepEqual(nflStoredMarketEpisodeHistory({ providerGameId: gameId, evaluatedAt,
  captures: [capture({ moneyline: badCurrent })] }), [], "future source observation and invalid lineage are rejected");

// The actual raw-pair selector proves usable continuity without changing the old quote's identity.
const rawCurrent: NflPreviewBookOdds = { providerGameId: gameId, sportsbook: "circa", provider: "owls",
  providerEventId: "real-owl-event", observedAt: "2026-11-01T17:00:00Z", targetEligible: false,
  marketObservedAt: { moneyline: "2026-11-01T17:00:00Z", spread: "2026-11-01T17:00:00Z", total: "2026-11-01T17:00:00Z" },
  moneyline: { awayPrice: 225, homePrice: -265 },
  spread: { homeLine: -6.5, awayLine: 6.5, homePrice: -110, awayPrice: -110 },
  total: { line: 43, overPrice: -110, underPrice: -110 } };
const common = { history: [...decoded, rawCurrent], providerGameId: gameId, sportsbook: "circa",
  evaluatedAt, gameStartsAt: "2026-11-02T01:20:00Z", statisticalKnowledgeAt: null,
  informationOverlap: "not_attested" as const };
const ml = selectNflNamedMoneylineEpisodeAfterKnowledge(common);
assert.ok(ml);
assert.equal(ml.openingAt, originalAt);
assert.equal(ml.sourceProvenance?.opening.provider, "sharpapi");
assert.equal(ml.sourceProvenance?.opening.providerEventId, null);
assert.equal(ml.sourceProvenance?.current.provider, "owls");
assert.equal(ml.sourceProvenance?.current.providerEventId, "real-owl-event");
for (const market of ["spread", "total"] as const) {
  const episode = selectNflNamedPricedLineEpisodeAfterKnowledge({ ...common, market });
  assert.ok(episode);
  assert.equal(episode.openingAt, originalAt);
  assert.equal(episode.openingNumber, market === "spread" ? 4 : 46.5);
  assert.equal(episode.currentNumber, market === "spread" ? 6.5 : 43);
}
assert.equal(selectNflNamedMoneylineEpisodeAfterKnowledge({ ...common,
  history: [...decoded.map(({ storedCanonicalEvent: _attestation, ...row }) => row), rawCurrent] }), null,
  "the paired selector cannot borrow an un-attested older provider quote");
console.log("NFL stored market episodes: exact canonical identity, current-only original provenance/clocks, future exclusion and raw-pair continuity passed");

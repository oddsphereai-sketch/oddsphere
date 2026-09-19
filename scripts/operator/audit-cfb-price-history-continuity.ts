import { supabase } from "../../lib/db/supabase";
import type { MarketEdgeDto } from "../../app/lab/lib/labTypes";
import { readCfbForwardMarketHistory, readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { buildCfbMemberFixture, type CfbMemberFixture } from "../../lib/services/football/cfbMemberFixture";
import {
  buildCfbForwardMemberSnapshot,
  encodeCfbForwardMemberSnapshotPayload,
  readCfbForwardMemberSnapshot,
} from "../../lib/services/football/cfbForwardMemberSnapshotStore";

const now = new Date().toISOString();

type AuditMarketRow = { gameId: string; market: string; value: MarketEdgeDto };

function markets(fixture: CfbMemberFixture): AuditMarketRow[] {
  return fixture.snapshot.games.flatMap((game) =>
    Object.entries(game.markets ?? {}).map(([market, value]) => ({
      gameId: game.id,
      market,
      value,
    })),
  );
}

function gradeCounts(rows: AuditMarketRow[]) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const grade = row.value?.verdict?.label ?? "Missing";
    counts[grade] = (counts[grade] ?? 0) + 1;
    return counts;
  }, {});
}

function trailCounts(rows: AuditMarketRow[]) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const length = row.value?.oddsTrail?.length ?? 0;
    counts[String(length)] = (counts[String(length)] ?? 0) + 1;
    return counts;
  }, {});
}

function decisionIdentity(row: AuditMarketRow) {
  const market = row.value;
  return {
    gameId: row.gameId,
    market: row.market,
    pick: market?.pick ?? null,
    held: market?.held ?? null,
    line: market?.line ?? null,
    modelProb: market?.modelProb ?? null,
    marketFairProb: market?.marketFairProb ?? null,
    priceAmerican: market?.priceAmerican ?? null,
    currentPriceAmerican: market?.currentPriceAmerican ?? null,
    grade: market?.grade ?? null,
    rawGrade: market?.rawGrade ?? null,
    finalGrade: market?.finalGrade ?? null,
    verdict: market?.verdict ?? null,
    actionabilityLabel: market?.actionabilityLabel ?? null,
  };
}

async function main() {
  const before = await readCfbForwardMemberSnapshot({ client: supabase, season: 2026, now });
  if (!before) throw new Error("current production CFB compact snapshot unavailable");
  const writer = await readCfbForwardWriterEvidence({ client: supabase, season: 2026 });
  const visibleIds = [...new Set(before.fixture.snapshot.games.map((game) => String(game.id).replace(/^cfb-/, "")))];
  const history = await readCfbForwardMarketHistory({ client: supabase, season: 2026, providerGameIds: visibleIds });
  const candidateFixture = buildCfbMemberFixture(writer.evidence, now, history);
  const candidateSnapshot = buildCfbForwardMemberSnapshot({ fixture: candidateFixture, season: 2026, publishedAt: now });
  const envelope = encodeCfbForwardMemberSnapshotPayload(candidateSnapshot);
  const beforeRows = markets(before.fixture);
  const candidateRows = markets(candidateFixture);
  const beforeIdentity = new Map(beforeRows.map((row) => [`${row.gameId}:${row.market}`, decisionIdentity(row)]));
  const changedDecisions = candidateRows.flatMap((row) => {
    const key = `${row.gameId}:${row.market}`;
    const prior = beforeIdentity.get(key);
    const next = decisionIdentity(row);
    return JSON.stringify(prior) === JSON.stringify(next) ? [] : [{ key, prior, next }];
  });
  const multiPoint = (rows: AuditMarketRow[]) => rows.filter((row) => (row.value?.oddsTrail?.length ?? 0) >= 2).length;
  const openingAndTerminal = (rows: AuditMarketRow[]) => rows.filter((row) => {
    const labels = new Set((row.value?.oddsTrail ?? []).map((stop) => stop.label));
    return (labels.has("open") || labels.has("first")) && (labels.has("current") || labels.has("locked"));
  }).length;
  console.log(JSON.stringify({
    audit: "cfb_price_history_release_continuity_2026_09_19_r1",
    generatedAt: now,
    apply: false,
    historyRows: history.length,
    before: {
      games: before.fixture.snapshot.games.length,
      predictions: beforeRows.length,
      grades: gradeCounts(beforeRows),
      trailLengths: trailCounts(beforeRows),
      multiPointTrails: multiPoint(beforeRows),
      openingAndTerminalTrails: openingAndTerminal(beforeRows),
    },
    candidate: {
      games: candidateFixture.snapshot.games.length,
      predictions: candidateRows.length,
      grades: gradeCounts(candidateRows),
      trailLengths: trailCounts(candidateRows),
      multiPointTrails: multiPoint(candidateRows),
      openingAndTerminalTrails: openingAndTerminal(candidateRows),
      uncompressedBytes: envelope.uncompressedBytes,
      compressedBytes: envelope.compressedBytes,
    },
    changedDecisionCount: changedDecisions.length,
    changedDecisionSample: changedDecisions.slice(0, 10),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

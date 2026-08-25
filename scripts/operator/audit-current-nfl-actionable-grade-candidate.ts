/** SELECT-only Week 1 replay for the NFL actionable-grade candidate. */

import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import {
  buildNflV1ActionableGradeBundle,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
} from "../../lib/services/football/nflV1ActionableGradeCandidate";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stored = await readNflForwardEvidence({ client, season: 2026, week: 1 });
  const latest = latestRows(stored);
  if (latest.length !== 16) throw new Error(`Expected 16 Week 1 games; received ${latest.length}.`);

  const rows = latest.flatMap((row) => {
    if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
      throw new Error(`Latest NFL row ${row.id} is not the current evidence schema.`);
    }
    const payload = row.payload as NflForwardEvidencePayload;
    const shadow = payload.decisions.shadowEvaluatedBets?.[0];
    if (!shadow) throw new Error(`NFL r6 tuple missing for ${row.providerGameId}.`);
    const candidate = buildNflV1ActionableGradeBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
    });
    if (!candidate.publicationEnabled || candidate.trackingEnabled ||
        candidate.evaluatedBets.length !== 3) {
      throw new Error(`NFL production bundle boundary failed for ${row.providerGameId}.`);
    }
    const baseline = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision.grade]));
    return candidate.evaluatedBets.map((decision) => ({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      providerGameId: row.providerGameId,
      market: decision.market,
      side: decision.side,
      probability: decision.modelProbability,
      marketFairProbability: decision.marketFairProbability,
      edgePercentagePoints: 100 * (decision.modelProbability - decision.marketFairProbability),
      expectedValue: decision.expectedValue,
      sportsbook: decision.evaluatedQuote.sportsbook,
      line: decision.evaluatedQuote.line,
      price: decision.evaluatedQuote.price,
      grade: decision.grade,
      previousGrade: baseline.get(decision.market) ?? "Held",
      changed: decision.grade !== baseline.get(decision.market),
      evaluatedAt: decision.evaluatedAt,
    }));
  });
  if (rows.length !== 48) throw new Error(`NFL candidate produced ${rows.length}/48 decisions.`);
  const grades = count(rows.map((row) => row.grade));
  const byMarket = Object.fromEntries(["moneyline", "spread", "total"].map((market) => [
    market,
    count(rows.filter((row) => row.market === market).map((row) => row.grade)),
  ]));
  const promotions = rows.filter((row) => rank(row.grade) > rank(row.previousGrade));
  const demotions = rows.filter((row) => rank(row.grade) < rank(row.previousGrade));
  console.log(JSON.stringify({
    readOnly: true,
    productionRelease: true,
    sourceRowsRead: stored.length,
    latestGames: latest.length,
    sourceCapturedAt: latest[0]!.capturedAt,
    decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
    policyRelease: NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
    grades,
    byMarket,
    promotions: promotions.length,
    demotions: demotions.length,
    netActionableChange: rows.filter((row) => rank(row.grade) >= rank("Lean")).length -
      rows.filter((row) => rank(row.previousGrade) >= rank("Lean")).length,
    changedRows: [...promotions, ...demotions],
    rows,
  }, null, 2));
}

function count(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function rank(grade: string): number {
  return grade === "Best Angle" ? 4 : grade === "Lean" ? 3 : grade === "Watchlist" ? 2 :
    grade === "No Play" ? 1 : 0;
}

function latestRows(rows: NflForwardStoredEvidence[]): NflForwardStoredEvidence[] {
  const latest = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) {
      latest.set(row.providerGameId, row);
    }
  }
  return [...latest.values()].sort((first, second) =>
    first.payload.game.scheduledStart.localeCompare(second.payload.game.scheduledStart));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

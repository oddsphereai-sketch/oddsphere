import { createClient } from "@supabase/supabase-js";
import { computeSlateDate } from "../../lib/dates/slateDate";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { candidateTrackingMarkets, cfbTrackingCandidatesForRun } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { CFB_V1_DECISION_RELEASE } from "../../lib/services/football/cfbV1Decision";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");

const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
const date = process.argv.find((value) => value.startsWith("--date="))?.slice(7) ?? null;

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const { evidence } = await readCfbForwardWriterEvidence({ client, season: Number(now.slice(0, 4)) });
  const candidates = cfbTrackingCandidatesForRun(evidence, [], now).filter(({ payload }) =>
    !date || computeSlateDate("cfb", payload.game.scheduledStart) === date
  );
  const planned = candidates.flatMap((candidate) => {
    const { payload, mode } = candidate;
    const markets = candidateTrackingMarkets(candidate);
    return markets.map((market) => ({
      externalId: Number(payload.game.providerGameId),
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      startsAt: payload.game.scheduledStart,
      capturedAt: payload.capturedAt,
      market,
      mode,
    }));
  });
  const externalIds = [...new Set(planned.map((row) => row.externalId))];
  const { data, error } = externalIds.length === 0
    ? { data: [], error: null }
    : await client.from("prediction_records")
        .select("external_id,market")
        .eq("sport", "cfb")
        .eq("model_version", CFB_V1_DECISION_RELEASE)
        .in("external_id", externalIds);
  if (error) throw new Error(`CFB tracking audit read failed: ${error.message}`);
  const existing = new Set((data ?? []).map((row) => `${row.external_id}:${row.market}`));
  const byMarket = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market, planned.filter((row) => row.market === market).length]));
  const unpublishedMarkets = candidates.flatMap((candidate) => {
    const { payload } = candidate;
    const markets = new Set(candidateTrackingMarkets(candidate));
    return (["moneyline", "spread", "total"] as const)
      .filter((market) => !markets.has(market))
      .map((market) => ({
        externalId: Number(payload.game.providerGameId),
        matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
        startsAt: payload.game.scheduledStart,
        capturedAt: payload.capturedAt,
        market,
        evaluatedDecision: payload.decisions.evaluatedBets.some((decision) => decision.market === market),
        publishedOutlook: payload.decisions.marketOutlooks?.[market] ?? null,
        playbookLine: market === "spread" ? payload.market.playbookLine?.homeSpread ?? null
          : market === "total" ? payload.market.playbookLine?.total ?? null : null,
        currentLine: market === "spread" ? payload.market.current?.spread?.homeLine ?? null
          : market === "total" ? payload.market.current?.total?.line ?? null : null,
        espnReferenceLine: market === "spread" ? payload.market.espnReferenceLine?.homeSpread ?? null
          : market === "total" ? payload.market.espnReferenceLine?.total ?? null : null,
      }));
  });
  process.stdout.write(`${JSON.stringify({
    now,
    date,
    games: candidates.length,
    officialT60Games: candidates.filter((row) => row.mode === "official_t60").length,
    recoveryGames: candidates.filter((row) => row.mode === "published_pregame_accuracy_recovery").length,
    predictions: planned.length,
    byMarket,
    existingByMarket: Object.fromEntries(([
      "moneyline",
      "spread",
      "total",
    ] as const).map((market) => [market, planned.filter((row) => row.market === market && existing.has(`${row.externalId}:${row.market}`)).length])),
    existing: planned.filter((row) => existing.has(`${row.externalId}:${row.market}`)).length,
    missing: planned.filter((row) => !existing.has(`${row.externalId}:${row.market}`)).length,
    missingRows: planned.filter((row) => !existing.has(`${row.externalId}:${row.market}`)),
    unpublishedMarkets,
  }, null, 2)}\n`);
}

void main();

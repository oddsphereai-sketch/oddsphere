import { supabase } from "../../lib/db/supabase";
import { UCL_EXTERNAL_ID_OFFSET, UCL_EXTERNAL_ID_UPPER_BOUND } from "../../lib/services/ucl/uclCompetitionContext";
import { readUclStoredPriceHistory } from "../../lib/services/ucl/uclLineHistoryStore";

function implied(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function probabilityMetrics(
  rows: Array<{ probability: number; actual: boolean }>,
): { brier: number | null; logLoss: number | null } {
  if (!rows.length) return { brier: null, logLoss: null };
  const brier = rows.reduce((sum, row) => sum + (row.probability - Number(row.actual)) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((sum, row) => {
    const probability = Math.min(1 - 1e-9, Math.max(1e-9, row.probability));
    return sum - (row.actual ? Math.log(probability) : Math.log(1 - probability));
  }, 0) / rows.length;
  return { brier, logLoss };
}

async function main() {
  const [{ data, error }, { data: locks, error: lockError }] = await Promise.all([
    supabase.from("games")
      .select("id,external_id,game_date,status,home_score,away_score")
      .eq("sport", "soccer")
      .gte("external_id", UCL_EXTERNAL_ID_OFFSET)
      .lt("external_id", UCL_EXTERNAL_ID_UPPER_BOUND)
      .eq("status", "completed")
      .order("game_date", { ascending: true })
      .limit(1000),
    supabase.from("prediction_records")
      .select("external_id,market,locked_at,snapshot_json")
      .eq("sport", "soccer")
      .gte("external_id", UCL_EXTERNAL_ID_OFFSET)
      .lt("external_id", UCL_EXTERNAL_ID_UPPER_BOUND)
      .not("locked_at", "is", null)
      .limit(1000),
  ]);
  if (error) throw error;
  if (lockError) throw lockError;
  const games = (data ?? []) as Array<{ id: number; external_id: number; game_date: string; status: string; home_score: number; away_score: number }>;
  const lockByProviderId = new Map<number, string>();
  const uclLockSnapshots: Array<{ providerId: number; lockedAt: string; snapshot: Record<string, unknown> }> = [];
  const allUclLockSnapshots: Array<{ providerId: number; market: string; lockedAt: string; snapshot: Record<string, unknown> }> = [];
  for (const row of (locks ?? []) as Array<{ external_id: number; market: string; locked_at: string; snapshot_json: Record<string, unknown> | null }>) {
    if (row.snapshot_json?.competition !== "uefa_champions_league") continue;
    const providerId = row.external_id - UCL_EXTERNAL_ID_OFFSET;
    allUclLockSnapshots.push({ providerId, market: row.market, lockedAt: row.locked_at, snapshot: row.snapshot_json });
    if (row.market !== "btts") continue;
    uclLockSnapshots.push({ providerId, lockedAt: row.locked_at, snapshot: row.snapshot_json });
    const prior = lockByProviderId.get(providerId);
    if (!prior || Date.parse(row.locked_at) < Date.parse(prior)) lockByProviderId.set(providerId, row.locked_at);
  }
  const providerIds = games.map((game) => game.external_id - UCL_EXTERNAL_ID_OFFSET);
  const history = await readUclStoredPriceHistory(providerIds);
  const rows = games.flatMap((game) => {
    const providerId = game.external_id - UCL_EXTERNAL_ID_OFFSET;
    const lockedAt = lockByProviderId.get(providerId);
    if (!lockedAt) return [];
    const cutoff = Date.parse(lockedAt);
    const observations = history.filter((row) => row.providerId === providerId && row.market === "btts"
      && row.sportsbook && Date.parse(row.recordedAt) <= cutoff);
    const byBook = new Map<string, Partial<Record<"yes" | "no", typeof observations[number]>>>();
    for (const row of observations) {
      if (row.side !== "yes" && row.side !== "no") continue;
      const book = row.sportsbook!.toLowerCase();
      const bucket = byBook.get(book) ?? {};
      const prior = bucket[row.side];
      if (!prior || Date.parse(row.recordedAt) > Date.parse(prior.recordedAt)) bucket[row.side] = row;
      byBook.set(book, bucket);
    }
    const vectors = [...byBook.entries()].flatMap(([book, sides]) => {
      if (!sides.yes || !sides.no || Math.abs(Date.parse(sides.yes.recordedAt) - Date.parse(sides.no.recordedAt)) > 90_000) return [];
      const yes = implied(sides.yes.american);
      const no = implied(sides.no.american);
      return [{ book, yes: yes / (yes + no) }];
    });
    if (!vectors.length) return [];
    const consensus = vectors.length >= 2 ? median(vectors.map((row) => row.yes)) : null;
    const actual = game.home_score > 0 && game.away_score > 0 ? "Yes" : "No";
    return [{ providerId, kickoff: game.game_date, lockedAt, score: `${game.away_score}-${game.home_score}`, books: vectors.length,
      consensusYes: consensus, consensusSide: consensus === null ? null : consensus >= 0.5 ? "Yes" : "No", actual }];
  });
  const eligible = rows.filter((row) => row.consensusSide !== null);
  const capturedBoards = uclLockSnapshots.flatMap(({ snapshot }) => {
    const board = snapshot.complete_price_board as { rows?: Array<Record<string, unknown>> } | undefined;
    return board?.rows ?? [];
  });
  const gameByProvider = new Map(games.map((game) => [game.external_id - UCL_EXTERNAL_ID_OFFSET, game]));
  const lockedMarketBenchmark = (market: "total" | "btts") => {
    const sideA = market === "total" ? "over" : "yes";
    const sideB = market === "total" ? "under" : "no";
    const earliest = new Map<number, typeof allUclLockSnapshots[number]>();
    for (const entry of allUclLockSnapshots.filter((row) => row.market === market)) {
      const prior = earliest.get(entry.providerId);
      if (!prior || Date.parse(entry.lockedAt) < Date.parse(prior.lockedAt)) earliest.set(entry.providerId, entry);
    }
    const reads = [...earliest.values()].flatMap(({ providerId, lockedAt, snapshot }) => {
      const game = gameByProvider.get(providerId);
      const board = snapshot.complete_price_board as { rows?: Array<Record<string, unknown>> } | undefined;
      const a = board?.rows?.find((row) => row.side === sideA);
      const b = board?.rows?.find((row) => row.side === sideB);
      const marketA = Number(a?.market_probability);
      const marketB = Number(b?.market_probability);
      const modelA = Number(a?.model_probability);
      if (!game || !Number.isFinite(marketA) || !Number.isFinite(marketB) || !Number.isFinite(modelA)) return [];
      const modelSide = modelA >= 0.5 ? sideA : sideB;
      const marketSide = marketA >= marketB ? sideA : sideB;
      const actual = market === "total"
        ? game.home_score + game.away_score > 2.5 ? "over" : "under"
        : game.home_score > 0 && game.away_score > 0 ? "yes" : "no";
      const weakModelDisagreement = modelSide !== marketSide && Math.max(modelA, 1 - modelA) < 0.6;
      const candidateProbabilityA = weakModelDisagreement ? marketA : modelA;
      const candidateSide = candidateProbabilityA >= 0.5 ? sideA : sideB;
      return [{
        providerId,
        lockedAt,
        sportsbook: snapshot.current_sportsbook ?? null,
        modelProbabilityA: modelA,
        marketProbabilityA: marketA,
        candidateProbabilityA,
        weakModelDisagreement,
        modelSide,
        marketSide,
        candidateSide,
        actual,
      }];
    });
    const summarize = (sample: typeof reads) => {
      const sampleActualB = sample.filter((row) => row.actual === sideB);
      const metrics = (key: "modelProbabilityA" | "marketProbabilityA" | "candidateProbabilityA") =>
        probabilityMetrics(sample.map((row) => ({ probability: row[key], actual: row.actual === sideA })));
      return {
        rows: sample.length,
        model: {
          sideA: sample.filter((row) => row.modelSide === sideA).length,
          accuracy: sample.length ? sample.filter((row) => row.modelSide === row.actual).length / sample.length : null,
          sideBRecall: sampleActualB.length ? sampleActualB.filter((row) => row.modelSide === sideB).length / sampleActualB.length : null,
          ...metrics("modelProbabilityA"),
        },
        market: {
          sideA: sample.filter((row) => row.marketSide === sideA).length,
          accuracy: sample.length ? sample.filter((row) => row.marketSide === row.actual).length / sample.length : null,
          sideBRecall: sampleActualB.length ? sampleActualB.filter((row) => row.marketSide === sideB).length / sampleActualB.length : null,
          ...metrics("marketProbabilityA"),
        },
        candidate: {
          sideA: sample.filter((row) => row.candidateSide === sideA).length,
          corrections: sample.filter((row) => row.weakModelDisagreement).length,
          accuracy: sample.length ? sample.filter((row) => row.candidateSide === row.actual).length / sample.length : null,
          sideBRecall: sampleActualB.length ? sampleActualB.filter((row) => row.candidateSide === sideB).length / sampleActualB.length : null,
          ...metrics("candidateProbabilityA"),
        },
      };
    };
    return {
      ...summarize(reads),
      byLockMonth: Object.fromEntries(
        [...new Set(reads.map((row) => row.lockedAt.slice(0, 7)))].sort().map((month) => [
          month,
          summarize(reads.filter((row) => row.lockedAt.startsWith(month))),
        ]),
      ),
      disagreements: reads.filter((row) => row.marketSide !== row.modelSide),
    };
  };
  console.log(JSON.stringify({
    mode: "read_only_no_runtime_change",
    completedGames: games.length,
    gamesWithImmutableBttsLock: lockByProviderId.size,
    storedPriceRows: history.length,
    storedBttsRows: history.filter((row) => row.market === "btts").length,
    completedGamesWithStoredBttsRows: new Set(history.filter((row) => row.market === "btts").map((row) => row.providerId)).size,
    lockedSnapshotKeys: [...new Set(uclLockSnapshots.flatMap(({ snapshot }) => Object.keys(snapshot)))].sort(),
    lockedSnapshotsWithCompletePriceBoard: uclLockSnapshots.filter(({ snapshot }) => snapshot.complete_price_board && typeof snapshot.complete_price_board === "object").length,
    lockedCompletePriceBoardRows: capturedBoards.length,
    lockedCompletePriceBoardRowKeys: [...new Set(capturedBoards.flatMap((row) => Object.keys(row)))].sort(),
    lockedCompletePriceBoardSportsbooks: [...new Set(capturedBoards.map((row) => row.sportsbook).filter((value): value is string => typeof value === "string"))].sort(),
    lockedMarketBenchmarks: {
      total: lockedMarketBenchmark("total"),
      btts: lockedMarketBenchmark("btts"),
    },
    capturedAtT60: rows.length,
    multiBookAtT60: eligible.length,
    accuracy: eligible.length ? eligible.filter((row) => row.consensusSide === row.actual).length / eligible.length : null,
    rows,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

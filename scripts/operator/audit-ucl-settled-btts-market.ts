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

async function main() {
  const { data, error } = await supabase.from("games")
    .select("id,external_id,game_date,status,home_score,away_score")
    .eq("sport", "soccer")
    .gte("external_id", UCL_EXTERNAL_ID_OFFSET)
    .lt("external_id", UCL_EXTERNAL_ID_UPPER_BOUND)
    .eq("status", "completed")
    .order("game_date", { ascending: true })
    .limit(1000);
  if (error) throw error;
  const games = (data ?? []) as Array<{ id: number; external_id: number; game_date: string; status: string; home_score: number; away_score: number }>;
  const providerIds = games.map((game) => game.external_id - UCL_EXTERNAL_ID_OFFSET);
  const history = await readUclStoredPriceHistory(providerIds);
  const rows = games.flatMap((game) => {
    const providerId = game.external_id - UCL_EXTERNAL_ID_OFFSET;
    const cutoff = Date.parse(game.game_date) - 60 * 60_000;
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
    return [{ providerId, kickoff: game.game_date, score: `${game.away_score}-${game.home_score}`, books: vectors.length,
      consensusYes: consensus, consensusSide: consensus === null ? null : consensus >= 0.5 ? "Yes" : "No", actual }];
  });
  const eligible = rows.filter((row) => row.consensusSide !== null);
  console.log(JSON.stringify({
    mode: "read_only_no_runtime_change",
    completedGames: games.length,
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

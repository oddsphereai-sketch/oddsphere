import { supabase } from "../../lib/db/supabase";
import { writeNhlPredictionRecords } from "../../lib/services/nhl/buildNhlPredictionRecords";
import { NHL_REGULAR_MODEL_RELEASE } from "../../lib/automodel/nhlRegularModelV1";

type Verdict = "pass" | "watchlist" | "lean" | "best_angle";
type Preview = {
  matchup: string;
  market: "moneyline" | "total" | "spread";
  pick: string;
  verdict: Verdict;
  awayScore: number;
  homeScore: number;
  totalRead: string;
  totalSource: string;
};

const gradeRank: Record<Verdict, number> = { pass: 0, watchlist: 1, lean: 2, best_angle: 3 };
const storedVerdict = (playGrade: string | null, noBet: boolean | null): Verdict => {
  if (noBet) return "pass";
  if (playGrade === "best_signal" || playGrade === "best_angle") return "best_angle";
  if (playGrade === "market_watch" || playGrade === "watchlist") return "watchlist";
  return "lean";
};

async function main(): Promise<void> {
  const slateDate = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7) ?? "2026-11-03";
  const previews: Preview[] = [];
  const pattern = /^\s*\[dry-run\] (.+) (moneyline|total|spread)\/(home|away|over|under)\s+pick=(.*?)\s+prob=([\d.]+)\s+verdict=(\w+)\s+score=([\d.]+)-([\d.]+)\s+price=(-?\d+|null).*?total_read=([^\s]+)\s+total_source=([^\s]+)/;
  const result = await writeNhlPredictionRecords({
    slateDate,
    apply: false,
    deferLock: true,
    logger: (message) => {
      const match = pattern.exec(message);
      if (!match) return;
      previews.push({
        matchup: match[1]!,
        market: match[2] as Preview["market"],
        pick: match[4]!,
        verdict: match[6] as Verdict,
        awayScore: Number(match[7]),
        homeScore: Number(match[8]),
        totalRead: match[10]!,
        totalSource: match[11]!,
      });
    },
  });

  const { data, error } = await supabase.from("prediction_records")
    .select("matchup,market,pick,play_grade,no_bet,snapshot_json,locked_at,published_at")
    .eq("sport", "nhl")
    .eq("slate_date", slateDate)
    .eq("model_version", "nhl_regular_2026_r24_categorical_market_consequence")
    .is("locked_at", null)
    .order("published_at", { ascending: false });
  if (error) throw new Error(error.message);
  const baseline = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    const key = `${row.matchup}|${row.market}`;
    if (!baseline.has(key)) baseline.set(key, row);
  }

  const changes = previews.map((preview) => {
    const before = baseline.get(`${preview.matchup}|${preview.market}`);
    const beforeVerdict = before ? storedVerdict(before.play_grade, before.no_bet) : null;
    const beforeModel = (before?.snapshot_json as { model_output?: {
      projected_away_goals?: number;
      projected_home_goals?: number;
    } } | null)?.model_output;
    return {
      matchup: preview.matchup,
      market: preview.market,
      before: before ? { pick: before.pick, verdict: beforeVerdict } : null,
      after: { pick: preview.pick, verdict: preview.verdict },
      pickChanged: before ? before.pick !== preview.pick : null,
      gradeDelta: beforeVerdict === null ? null : gradeRank[preview.verdict] - gradeRank[beforeVerdict],
      scoreBefore: beforeModel ? [beforeModel.projected_away_goals, beforeModel.projected_home_goals] : null,
      scoreAfter: [preview.awayScore, preview.homeScore],
      totalRead: preview.totalRead,
      totalSource: preview.totalSource,
    };
  });
  const games = [...new Set(previews.map((row) => row.matchup))];
  console.log(JSON.stringify({
    slateDate,
    candidate: NHL_REGULAR_MODEL_RELEASE,
    result,
    games: games.length,
    markets: previews.length,
    promotions: changes.filter((row) => (row.gradeDelta ?? 0) > 0).length,
    demotions: changes.filter((row) => (row.gradeDelta ?? 0) < 0).length,
    pickChanges: changes.filter((row) => row.pickChanged).length,
    actionableBefore: changes.filter((row) => row.before && ["lean", "best_angle"].includes(row.before.verdict!)).length,
    actionableAfter: previews.filter((row) => row.verdict === "lean" || row.verdict === "best_angle").length,
    reads: Object.fromEntries(games.map((game) => {
      const row = previews.find((preview) => preview.matchup === game)!;
      return [game, { total: row.totalRead, source: row.totalSource }];
    })),
    changes: changes.filter((row) => row.pickChanged || row.gradeDelta !== 0 || JSON.stringify(row.scoreBefore) !== JSON.stringify(row.scoreAfter)),
  }, null, 2));
}

void main();

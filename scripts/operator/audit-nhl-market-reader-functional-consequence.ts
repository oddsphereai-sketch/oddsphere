import { supabase } from "../../lib/db/supabase";
import { writeNhlPredictionRecords } from "../../lib/services/nhl/buildNhlPredictionRecords";
import { NHL_REGULAR_MODEL_RELEASE } from "../../lib/automodel/nhlRegularModelV1";

type Verdict = "pass" | "watchlist" | "lean" | "best_angle";
type Preview = {
  matchup: string;
  market: "moneyline" | "total" | "spread";
  side: string;
  pick: string;
  probability: number;
  verdict: Verdict;
  awayScore: number;
  homeScore: number;
  price: number | null;
  mlRead: string;
  mlSource: string;
  puckRead: string;
  puckSource: string;
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
  const messages: string[] = [];
  const pattern = /^\s*\[dry-run\] (.+) (moneyline|total|spread)\/(home|away|over|under)\s+pick=(.*?)\s+prob=([\d.]+)\s+verdict=(\w+)\s+score=([\d.]+)-([\d.]+)\s+price=(-?\d+|null)\s+ml_read=([^\s]+)\s+ml_source=([^\s]+)\s+puck_read=([^\s]+)\s+puck_source=([^\s]+)\s+total_read=([^\s]+)\s+total_source=([^\s]+)/;
  const result = await writeNhlPredictionRecords({
    slateDate,
    apply: false,
    deferLock: true,
    logger: (message) => {
      messages.push(message);
      const match = pattern.exec(message);
      if (!match) return;
      previews.push({
        matchup: match[1]!,
        market: match[2] as Preview["market"],
        side: match[3]!,
        pick: match[4]!,
        probability: Number(match[5]),
        verdict: match[6] as Verdict,
        awayScore: Number(match[7]),
        homeScore: Number(match[8]),
        price: match[9] === "null" ? null : Number(match[9]),
        mlRead: match[10]!,
        mlSource: match[11]!,
        puckRead: match[12]!,
        puckSource: match[13]!,
        totalRead: match[14]!,
        totalSource: match[15]!,
      });
    },
  });

  const { data, error } = await supabase.from("prediction_records")
    .select("matchup,market,pick,side,play_grade,no_bet,published_at,snapshot_json")
    .eq("sport", "nhl")
    .eq("slate_date", slateDate)
    .eq("model_version", "nhl_regular_2026_r25_categorical_total_response")
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
    const gradeDelta = beforeVerdict === null ? null : gradeRank[preview.verdict] - gradeRank[beforeVerdict];
    return {
      matchup: preview.matchup,
      market: preview.market,
      before: before ? { pick: before.pick, side: before.side, verdict: beforeVerdict } : null,
      after: { pick: preview.pick, side: preview.side, verdict: preview.verdict },
      pickChanged: before ? before.pick !== preview.pick : null,
      gradeDelta,
      scoreBefore: beforeModel ? [beforeModel.projected_away_goals, beforeModel.projected_home_goals] : null,
      scoreAfter: [preview.awayScore, preview.homeScore],
      mlRead: preview.mlRead,
      mlSource: preview.mlSource,
      puckRead: preview.puckRead,
      puckSource: preview.puckSource,
      totalRead: preview.totalRead,
      totalSource: preview.totalSource,
    };
  });
  const games = [...new Set(previews.map((row) => row.matchup))];
  const gradeCounts = Object.fromEntries((["pass", "watchlist", "lean", "best_angle"] as Verdict[])
    .map((grade) => [grade, previews.filter((row) => row.verdict === grade).length]));
  const uniqueReads = Object.fromEntries(games.map((game) => {
    const row = previews.find((preview) => preview.matchup === game)!;
    return [game, {
      moneyline: row.mlRead,
      moneylineSource: row.mlSource,
      puckLine: row.puckRead,
      puckLineSource: row.puckSource,
      total: row.totalRead,
      totalSource: row.totalSource,
    }];
  }));
  console.log(JSON.stringify({
    slateDate,
    candidate: NHL_REGULAR_MODEL_RELEASE,
    result,
    games: games.length,
    markets: previews.length,
    gradeCounts,
    promotions: changes.filter((row) => (row.gradeDelta ?? 0) > 0).length,
    demotions: changes.filter((row) => (row.gradeDelta ?? 0) < 0).length,
    pickChanges: changes.filter((row) => row.pickChanged).length,
    actionableBefore: changes.filter((row) => row.before && ["lean", "best_angle"].includes(row.before.verdict!)).length,
    actionableAfter: previews.filter((row) => row.verdict === "lean" || row.verdict === "best_angle").length,
    reads: uniqueReads,
    changes: changes.filter((row) => row.pickChanged || row.gradeDelta !== 0 || JSON.stringify(row.scoreBefore) !== JSON.stringify(row.scoreAfter)),
    unparsedMessages: messages.filter((message) => message.includes("[dry-run]")).length - previews.length,
  }, null, 2));
}

void main();

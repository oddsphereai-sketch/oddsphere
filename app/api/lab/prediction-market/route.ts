import { readPredictionMarketDisplayFeed } from "@/lib/services/dailyEdge/predictionMarketDisplayFeed";
import { matchPredictionMarketGame, PREDICTION_MARKET_TARGETS, type PredictionMarketSport } from "@/lib/providers/owls/owlsPredictionMarkets";

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const sport = query.get("sport") ?? "";
  if (!Object.hasOwn(PREDICTION_MARKET_TARGETS, sport)) return Response.json({market:null}, {status:200});
  const awayTeam = query.get("away") ?? "";
  const homeTeam = query.get("home") ?? "";
  const gameStartAt = query.get("start") ?? "";
  if (!/^[A-Z0-9& -]{1,12}$/.test(awayTeam) || !/^[A-Z0-9& -]{1,12}$/.test(homeTeam) || awayTeam === homeTeam || !Number.isFinite(Date.parse(gameStartAt))) {
    return Response.json({market:null}, {status:400});
  }
  const feed = await readPredictionMarketDisplayFeed(sport as PredictionMarketSport).catch(() => null);
  const market = matchPredictionMarketGame(feed, {sport:sport as PredictionMarketSport,awayTeam,homeTeam,gameStartAt,
    awayName:query.get("awayName")?.slice(0,100),homeName:query.get("homeName")?.slice(0,100)});
  return Response.json({market}, {headers:{"Cache-Control":"private, max-age=30, stale-while-revalidate=60"}});
}

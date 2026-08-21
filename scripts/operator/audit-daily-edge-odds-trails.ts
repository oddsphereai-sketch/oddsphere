/** READ ONLY. Verify every displayed Daily Edge price/line stop against persisted market rows. */
import { GET as getDailyEdge } from "../../app/api/lab/daily-edge/route";
import { supabase } from "../../lib/db/supabase";

// The audit intentionally inspects heterogeneous JSON/SQL rows from several schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type TrailStop = { american: number; line: number | null; observedAt: string | null; sportsbook: string | null; source: string; label: string };

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const sports = ["mlb", "wnba"] as const;
const close = (a: unknown, b: unknown) => a == null || b == null ? a === b : Math.abs(Number(a) - Number(b)) < 0.001;
const sameTime = (a: unknown, b: unknown) => Date.parse(String(a ?? "")) === Date.parse(String(b ?? ""));

function selectedSide(game: Row, key: string, market: Row): string | null {
  const pick = String(market.pick ?? "").toUpperCase();
  if (key === "moneyline" || (game.sport === "wnba" && key === "first_inning")) {
    if (pick.startsWith(String(game.homeTeam).toUpperCase())) return "home";
    if (pick.startsWith(String(game.awayTeam).toUpperCase())) return "away";
  }
  if (key === "total") {
    if (pick.startsWith("OVER")) return "over";
    if (pick.startsWith("UNDER")) return "under";
  }
  if (key === "first_inning") {
    if (pick === "YRFI") return "over";
    if (pick === "NRFI") return "under";
  }
  return null;
}

function dbMarket(sport: string, key: string): string {
  if (key === "first_inning") return sport === "wnba" ? "spread" : "first_inning_total";
  return key;
}

async function allHistory(gameIds: number[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("line_history")
      .select("id,game_id,market_type,side,sportsbook,line_value,odds_american,recorded_at")
      .in("game_id", gameIds)
      .order("recorded_at")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

async function main() {
  const failures: string[] = [];
  let verifiedHistoryStops = 0;
  let verifiedCurrentStops = 0;
  let verifiedLockedStops = 0;
  let verifiedFirstInningBoardPrices = 0;
  let verifiedTrails = 0;
  let verifiedLineTrails = 0;

  for (const sport of sports) {
    const response = await getDailyEdge(new Request(`https://internal/api/lab/daily-edge?sport=${sport}&date=${date}&snapshotBypass=true`));
    if (!response.ok) throw new Error(`${sport} route returned ${response.status}`);
    const body = await response.json() as Row;
    const externalIds = (body.games ?? []).map((game: Row) => game.external_id);
    const { data: gameRows, error: gameError } = await supabase
      .from("games")
      .select("id,external_id")
      .eq("sport", sport)
      .in("external_id", externalIds);
    if (gameError) throw gameError;
    const internalByExternal = new Map((gameRows ?? []).map((row) => [row.external_id, row.id]));
    const gameIds = (gameRows ?? []).map((row) => row.id);
    const history = await allHistory(gameIds);
    const { data: current, error: currentError } = await supabase
      .from("lines")
      .select("game_id,market_type,side,sportsbook,line_value,odds_american")
      .in("game_id", gameIds);
    if (currentError) throw currentError;
    const { data: locked, error: lockedError } = await supabase
      .from("prediction_records")
      .select("game_id,market,side,line_value,odds_american,locked_at")
      .eq("sport", sport)
      .eq("slate_date", date)
      .in("game_id", gameIds);
    if (lockedError) throw lockedError;

    for (const game of body.games ?? []) {
      const gameId = internalByExternal.get(game.external_id);
      if (!gameId) { failures.push(`${sport}/${game.id}: internal game id missing`); continue; }
      for (const [key, market] of Object.entries(game.markets ?? {}) as Array<[string, Row]>) {
        const marketType = dbMarket(sport, key);
        const marketLineTrail = (market.lineTrail ?? []) as TrailStop[];
        const terminalTrackedLine = marketLineTrail[marketLineTrail.length - 1]?.line ?? null;
        const supportsPointLineTrail = key === "total" || (sport === "wnba" && key === "first_inning");
        const hasPointLineTransition = supportsPointLineTrail && marketLineTrail.some(
          (stop) => stop.line !== null && terminalTrackedLine !== null && !close(stop.line, terminalTrackedLine),
        );
        const trails = [
          { name: "selected", side: selectedSide(game, key, market), stops: market.oddsTrail ?? [] },
          { name: "opposing", side: market.opposingOddsTrail?.side ?? null, stops: market.opposingOddsTrail?.stops ?? [] },
        ];
        for (const trail of trails) {
          if (trail.stops.length === 0) continue;
          verifiedTrails += 1;
          const terminal = trail.stops[trail.stops.length - 1] as TrailStop | undefined;
          // Two timestamped same-book observations are sufficient for a
          // truthful coherent trail. The reader uses the first observation as
          // Prior when no distinct middle observation exists, so all three
          // display fields remain populated without inventing a market quote.
          // A single WNBA opposing-side capture is allowed as current context
          // only. The reader renders it as unverified/current and never calls
          // it movement; preserving the row is more truthful than hiding the
          // other side when the current `lines` table is temporarily empty.
          const currentOnlyContext =
            sport === "wnba" &&
            trail.name === "opposing" &&
            trail.stops.length === 1 &&
            terminal?.label === "current";
          if (trail.stops.length < 2 && !hasPointLineTransition && !currentOnlyContext) failures.push(`${sport}/${game.id}/${key}/${trail.name}: fewer than two verified observations`);
          if (trail.stops.length > 1 && trail.stops[0]?.label !== "first") failures.push(`${sport}/${game.id}/${key}/${trail.name}: first observation is not labeled first`);
          if (terminal?.label !== "current" && terminal?.label !== "locked") failures.push(`${sport}/${game.id}/${key}/${trail.name}: terminal observation is not current/locked`);
          const books = new Set(trail.stops.map((stop: TrailStop) => stop.sportsbook).filter(Boolean));
          if (books.size !== 1) failures.push(`${sport}/${game.id}/${key}/${trail.name}: mixed or missing sportsbook`);
          let priorTime = -Infinity;
          for (const stop of trail.stops as TrailStop[]) {
            const time = stop.observedAt ? Date.parse(stop.observedAt) : priorTime;
            if (Number.isFinite(time) && time < priorTime) failures.push(`${sport}/${game.id}/${key}/${trail.name}: timestamps out of order`);
            if (Number.isFinite(time)) priorTime = time;
            const identity = (row: Row) => row.game_id === gameId && row.market_type === marketType && row.side === trail.side && row.sportsbook === stop.sportsbook && row.odds_american === stop.american && close(row.line_value, stop.line);
            if (stop.source === "line_history") {
              if (!history.some((row) => identity(row) && sameTime(row.recorded_at, stop.observedAt))) failures.push(`${sport}/${game.id}/${key}/${trail.name}: history stop not found ${JSON.stringify(stop)}`);
              else verifiedHistoryStops += 1;
            } else if (stop.source === "current_line") {
              if (!(current ?? []).some(identity)) failures.push(`${sport}/${game.id}/${key}/${trail.name}: current stop not found`);
              else verifiedCurrentStops += 1;
            } else if (stop.source === "locked_snapshot") {
              if (!(locked ?? []).some((row) => row.game_id === gameId && row.side === trail.side && row.odds_american === stop.american && close(row.line_value, stop.line) && sameTime(row.locked_at, stop.observedAt))) failures.push(`${sport}/${game.id}/${key}/${trail.name}: locked stop not found`);
              else verifiedLockedStops += 1;
            }
          }
        }
        const lineTrail = marketLineTrail;
        if (lineTrail.length > 0) {
          verifiedLineTrails += 1;
          if (!supportsPointLineTrail) failures.push(`${sport}/${game.id}/${key}: unexpected point line trail`);
          if (lineTrail.some((stop) => stop.line === null)) failures.push(`${sport}/${game.id}/${key}: null point in line trail`);
          if (new Set(lineTrail.map((stop) => stop.sportsbook).filter(Boolean)).size !== 1) failures.push(`${sport}/${game.id}/${key}: mixed-book line trail`);
        }
        if (sport === "mlb" && key === "first_inning" && market.fiMarketBoard) {
          const board = market.fiMarketBoard as Row;
          const rawSource = String(board.source ?? "");
          const sportsbook = rawSource.startsWith("fi_market_ok_")
            ? rawSource.replace(/^fi_market_ok_/, "").replaceAll(" ", "_").toLowerCase()
            : null;
          for (const [side, currentPrice, openPrice, previousPrice] of [
            ["under", board.nrfiAmerican, board.nrfiOpenAmerican, board.nrfiPreviousAmerican],
            ["over", board.yrfiAmerican, board.yrfiOpenAmerican, board.yrfiPreviousAmerican],
          ] as const) {
            const identity = (row: Row, price: unknown) => row.game_id === gameId && row.market_type === "first_inning_total" && row.side === side && (sportsbook === null || row.sportsbook === sportsbook) && row.odds_american === price && close(row.line_value, board.line);
            if (currentPrice !== null && !(current ?? []).some((row) => identity(row, currentPrice)) && !history.some((row) => identity(row, currentPrice))) failures.push(`${sport}/${game.id}/first_inning/${side}: board current not found`);
            else if (currentPrice !== null) verifiedFirstInningBoardPrices += 1;
            for (const [label, price] of [["open", openPrice], ["previous", previousPrice]] as const) {
              if (price !== null && !history.some((row) => identity(row, price))) failures.push(`${sport}/${game.id}/first_inning/${side}: board ${label} not found`);
              else if (price !== null) verifiedFirstInningBoardPrices += 1;
            }
          }
        }
      }
    }
  }

  console.log(JSON.stringify({ date, verifiedTrails, verifiedLineTrails, verifiedHistoryStops, verifiedCurrentStops, verifiedLockedStops, verifiedFirstInningBoardPrices, failures: failures.length, details: failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });

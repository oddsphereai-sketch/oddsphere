import { canonicalCbbTeamName } from "./dataset";
import { cbbImpliedProbability } from "./marketEvidence";
import type { CbbGame, CbbMarket, CbbQuote } from "./types";

export type CbbNamedOddsRow = {
  id: string; sportsbook: string; league: string; event_id: string;
  home_team: string; away_team: string; event_start_time: string;
  market_type: string; selection: string; selection_type: string;
  odds_american: number; line: number | null; timestamp: string;
  is_live: boolean; is_active: boolean; is_alternate_line?: boolean;
  external_event_id?: string; market_id?: string;
};

/** Match names, sport, competition, start and market on each row, never on a polluted event bucket alone. */
export function normalizeCbbNamedBookOdds(game: CbbGame, rows: CbbNamedOddsRow[], fetchedAt: string, asOf: string) {
  if (![game.date, fetchedAt, asOf].every(value => Number.isFinite(Date.parse(value)))) throw new Error("invalid CBB named-price clock");
  const home = [game.home_team.full_name, game.home_team.college].filter(Boolean).map(name => canonicalCbbTeamName(name!));
  const away = [game.visitor_team.full_name, game.visitor_team.college].filter(Boolean).map(name => canonicalCbbTeamName(name!));
  const groups = new Map<string, Array<{ row: CbbNamedOddsRow; market: CbbMarket; side: "first" | "second" }>>();
  const rejected: Array<{ rowId: string; reason: string }> = [];
  for (const row of rows) {
    const reject = (reason: string) => rejected.push({ rowId: row.id, reason });
    const rh = canonicalCbbTeamName(row.home_team ?? ""), ra = canonicalCbbTeamName(row.away_team ?? "");
    const namesMatch = (home.includes(rh) && away.includes(ra)) || (home.includes(ra) && away.includes(rh));
    if (row.league !== "ncaab" || !namesMatch ||
      !Number.isFinite(Date.parse(row.event_start_time)) || Math.abs(Date.parse(row.event_start_time) - Date.parse(game.date)) > 10 * 60_000 ||
      /KXNCAAWB/.test(row.external_event_id ?? "")) { reject("event_identity_or_competition_mismatch"); continue; }
    if (row.is_live || !row.is_active || row.is_alternate_line ||
      ["kalshi", "robinhood", "prophetx", "novig"].includes(row.sportsbook)) { reject("not_active_main_sportsbook_quote"); continue; }
    if (!Number.isFinite(Date.parse(row.timestamp)) || Date.parse(row.timestamp) > Date.parse(asOf) ||
      Date.parse(fetchedAt) > Date.parse(asOf) || Date.parse(row.timestamp) > Date.parse(fetchedAt) ||
      Date.parse(row.timestamp) >= Date.parse(game.date)) { reject("invalid_or_future_timestamp"); continue; }
    const market: CbbMarket | null = row.market_type === "moneyline" ? "moneyline" : row.market_type === "point_spread" ? "spread" : row.market_type === "total_points" ? "total" : null;
    if (!market || !Number.isFinite(row.odds_american) || Math.abs(row.odds_american) < 100 ||
      (market !== "moneyline" && (row.line === null || !Number.isFinite(row.line) || !Number.isInteger(row.line * 2)))) { reject("unsupported_or_incomplete_market"); continue; }
    const selection = canonicalCbbTeamName(row.selection ?? "");
    const side = market === "total" ? row.selection_type === "over" ? "first" : row.selection_type === "under" ? "second" : null :
      home.includes(selection) ? "first" : away.includes(selection) ? "second" : null;
    if (!side) { reject("selection_identity_mismatch"); continue; }
    const threshold = market === "spread" ? (side === "first" ? row.line : -row.line!) : row.line;
    const key = `${row.event_id}:${row.external_event_id ?? ""}:${row.sportsbook}:${market}:${threshold}`;
    groups.set(key, [...(groups.get(key) ?? []), { row, market, side }]);
  }
  const quotes: Array<CbbQuote & { provider: "sharpapi"; orientationVerified: true; sourceRowIds: string[] }> = [];
  for (const group of groups.values()) {
    const first = group.filter(row => row.side === "first"), second = group.filter(row => row.side === "second");
    if (first.length !== 1 || second.length !== 1) {
      for (const { row } of group) rejected.push({ rowId: row.id, reason: "ambiguous_or_incomplete_pair" });
      continue;
    }
    const a = first[0].row, b = second[0].row, market = first[0].market;
    const hold = cbbImpliedProbability(a.odds_american) + cbbImpliedProbability(b.odds_american);
    if (hold < 0.98 || hold > 1.3 || Math.abs(Date.parse(a.timestamp) - Date.parse(b.timestamp)) > 60_000) {
      rejected.push({ rowId: a.id, reason: "incoherent_pair" }, { rowId: b.id, reason: "incoherent_pair" }); continue;
    }
    quotes.push({ gameId: game.id, sportsbook: a.sportsbook, market, line: market === "moneyline" ? null : a.line,
      firstPrice: a.odds_american, secondPrice: b.odds_american, providerObservedAt: a.timestamp > b.timestamp ? a.timestamp : b.timestamp,
      fetchedAt, phase: "current", provider: "sharpapi", orientationVerified: true, sourceRowIds: [a.id, b.id] });
  }
  return { quotes, rejected };
}

/** A reversed neutral listing is corrected only when named same-book exact values prove the orientation. */
export function bindCbbQuoteOrientation(quote: CbbQuote, references: CbbQuote[]) {
  if (quote.phase !== "current") return { quote, orientation: "unverified" as const, reference: null };
  const candidates = references.filter(ref => ref.gameId === quote.gameId && ref.sportsbook === quote.sportsbook && ref.market === quote.market);
  const direct = candidates.filter(ref => ref.line === quote.line && ref.firstPrice === quote.firstPrice && ref.secondPrice === quote.secondPrice);
  const reversed = quote.market === "total" ? [] : candidates.filter(ref =>
    ref.line === (quote.line === null ? null : -quote.line) && ref.firstPrice === quote.secondPrice && ref.secondPrice === quote.firstPrice);
  if (direct.length === 1 && reversed.length === 0) return { quote, orientation: "verified" as const, reference: direct[0] };
  if (reversed.length === 1 && direct.length === 0) return {
    quote: { ...quote, line: quote.line === null ? null : -quote.line, firstPrice: quote.secondPrice, secondPrice: quote.firstPrice },
    orientation: "verified_reversed" as const, reference: reversed[0],
  };
  return { quote, orientation: "unverified" as const, reference: null };
}

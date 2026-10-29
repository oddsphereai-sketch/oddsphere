import { canonicalCbbTeamName } from "./dataset";
import { cbbImpliedProbability } from "./marketEvidence";
import type { CbbGame, CbbMarket, CbbQuote } from "./types";
import type { RawOwlsOddsResponse } from "../providers/owls/owlsSharpBookOdds";
export type CbbOwlsHistoryRow = { book: string; market: string; side: string; price: number; point?: string | number | null;
  pointValue?: number | null; recordedAt: string; recordedAtUtc?: string | null; inPlay?: boolean };
export type CbbQualifiedNamedQuote = CbbQuote & { provider: "owls"; orientationVerified: true };
const books = new Set(["draftkings", "fanduel", "betmgm", "caesars", "pinnacle", "ps3838", "circa", "bet365", "bovada", "betrivers", "betr", "stations", "south_point", "westgate", "wynn", "hardrock", "betonline"]);
const market = (key: string): CbbMarket | null => key === "h2h" ? "moneyline" : key === "spreads" ? "spread" : key === "totals" ? "total" : null;
const names = (team: CbbGame["home_team"]) => [team.full_name, team.college].filter(Boolean).map(n => canonicalCbbTeamName(n!));
const validPair = (a: number, b: number) => {
  if (![a, b].every(p => typeof p === "number" && Number.isFinite(p) && Math.abs(p) >= 100)) return false;
  const hold = cbbImpliedProbability(a) + cbbImpliedProbability(b);
  return hold >= 0.98 && hold <= 1.3;
};
export function normalizeCbbOwlsCurrent(game: CbbGame, response: RawOwlsOddsResponse, fetchedAt: string, asOf: string) {
  if (![game.date, fetchedAt, asOf].every(t => Number.isFinite(Date.parse(t))) || Date.parse(asOf) >= Date.parse(game.date)) throw new Error("CBB current evidence requires valid pregame cutoff");
  if (response.success === false) return { quotes: [] as CbbQualifiedNamedQuote[], rejected: [{ reason: "provider_reported_failure", book: null as string | null }] };
  const quotes: CbbQualifiedNamedQuote[] = [], rejected: Array<{ reason: string; book: string | null }> = [];
  const home = names(game.home_team), away = names(game.visitor_team);
  const events = Array.isArray(response.data) ? response.data : Object.values(response.data ?? {}).flatMap(v => v ?? []);
  for (const event of events) {
    const h = canonicalCbbTeamName(event.home_team ?? ""), a = canonicalCbbTeamName(event.away_team ?? "");
    if (event.sport !== "ncaab" || !((home.includes(h) && away.includes(a)) || (home.includes(a) && away.includes(h))) ||
      !Number.isFinite(Date.parse(event.commence_time ?? "")) || Math.abs(Date.parse(event.commence_time!) - Date.parse(game.date)) > 600000) {
      rejected.push({ reason: "event_identity_time_or_competition", book: null }); continue;
    }
    for (const book of event.bookmakers ?? []) {
      const key = book.key?.toLowerCase() ?? "";
      if (!books.has(key)) { rejected.push({ reason: "unsupported_or_exchange_book", book: key }); continue; }
      for (const m of book.markets ?? []) {
        const kind = market(m.key ?? ""); if (!kind) continue;
        const update = (m as typeof m & { last_update?: string }).last_update ?? book.last_update ?? "";
        const observed = Date.parse(update), receipt = Date.parse(fetchedAt), cutoff = Date.parse(asOf);
        if (![observed, receipt, cutoff].every(Number.isFinite) || observed > receipt || receipt > cutoff || observed >= Date.parse(game.date) || cutoff - observed > 3600000) {
          rejected.push({ reason: "invalid_future_or_stale_time", book: key }); continue;
        }
        const outcomes = m.outcomes ?? [];
        const side = (n: string) => kind === "total" ? n.toLowerCase() === "over" ? "first" : n.toLowerCase() === "under" ? "second" : null :
          home.includes(canonicalCbbTeamName(n)) ? "first" : away.includes(canonicalCbbTeamName(n)) ? "second" : null;
        const first = outcomes.filter(o => side(o.name ?? "") === "first"), second = outcomes.filter(o => side(o.name ?? "") === "second");
        if (outcomes.length !== 2 || first.length !== 1 || second.length !== 1) { rejected.push({ reason: "ambiguous_or_incomplete_selection_pair", book: key }); continue; }
        const priceA = Number(first[0].price), priceB = Number(second[0].price);
        const pointA = first[0].point == null ? null : Number(first[0].point), pointB = second[0].point == null ? null : Number(second[0].point);
        if (!validPair(priceA, priceB) || (kind !== "moneyline" && (pointA === null || pointB === null || !Number.isInteger(pointA * 2) ||
          (kind === "spread" ? pointA !== -pointB : pointA !== pointB || pointA <= 0)))) { rejected.push({ reason: "incoherent_quote", book: key }); continue; }
        quotes.push({ gameId: game.id, sportsbook: key, market: kind, line: kind === "moneyline" ? null : pointA,
          firstPrice: priceA, secondPrice: priceB, providerObservedAt: update, fetchedAt, phase: "current", provider: "owls", orientationVerified: true });
      }
    }
  }
  const unique = new Map<string, CbbQualifiedNamedQuote[]>();
  for (const q of quotes) { const key = `${q.sportsbook}:${q.market}`; unique.set(key, [...(unique.get(key) ?? []), q]); }
  return { quotes: [...unique.values()].flatMap(group => {
    const values = new Set(group.map(q => JSON.stringify([q.line, q.firstPrice, q.secondPrice, q.providerObservedAt])));
    if (values.size !== 1) { rejected.push({ reason: "conflicting_same_book_market", book: group[0].sportsbook }); return []; }
    return [group[0]];
  }), rejected };
}

export function normalizeCbbOwlsHistory(game: CbbGame, source: { homeTeam: string; awayTeam: string }, rows: CbbOwlsHistoryRow[], fetchedAt: string, cutoff: string) {
  const home = names(game.home_team), away = names(game.visitor_team), sh = canonicalCbbTeamName(source.homeTeam), sa = canonicalCbbTeamName(source.awayTeam);
  const direct = home.includes(sh) && away.includes(sa), reversed = home.includes(sa) && away.includes(sh);
  if (!direct && !reversed) throw new Error("CBB history participant identity mismatch");
  if (![fetchedAt, cutoff, game.date].every(d => Number.isFinite(Date.parse(d))) || Date.parse(cutoff) >= Date.parse(game.date)) throw new Error("invalid CBB history cutoff");
  const groups = new Map<string, CbbOwlsHistoryRow[]>(), rejected: Record<string, number> = {};
  const reject = (why: string) => { rejected[why] = (rejected[why] ?? 0) + 1; };
  for (const row of rows) {
    const kind = market(row.market), at = Date.parse(row.recordedAtUtc ?? "");
    if (!kind || !books.has(row.book)) { reject("unsupported_market_or_exchange"); continue; }
    if (!Number.isFinite(at)) { reject("unknown_UTC_capture_time"); continue; }
    if (at > Date.parse(cutoff) || at > Date.parse(fetchedAt) || row.inPlay === true) { reject("post_cutoff_or_in_play"); continue; }
    if (row.book === "circa" && at >= Date.parse("2026-04-03T00:00:00Z") && at < Date.parse("2026-08-25T00:00:00Z")) { reject("known_source_misattribution"); continue; }
    const key = `${row.book}:${kind}:${row.recordedAtUtc}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const quotes: CbbQualifiedNamedQuote[] = [];
  for (const group of groups.values()) {
    const kind = market(group[0].market)!;
    const firstSide = kind === "total" ? "over" : direct ? "home" : "away", secondSide = kind === "total" ? "under" : direct ? "away" : "home";
    const first = group.filter(r => r.side === firstSide), second = group.filter(r => r.side === secondSide);
    if (group.length !== 2 || first.length !== 1 || second.length !== 1) { reject("ambiguous_or_incomplete_pair"); continue; }
    const a = first[0], b = second[0], line = a.pointValue ?? (a.point == null ? null : Number(a.point)), opposite = b.pointValue ?? (b.point == null ? null : Number(b.point));
    if (!validPair(a.price, b.price) || (kind !== "moneyline" && (line === null || opposite === null || !Number.isInteger(line * 2) ||
      (kind === "spread" ? line !== -opposite : line !== opposite || line <= 0)))) { reject("incoherent_pair"); continue; }
    quotes.push({ gameId: game.id, sportsbook: a.book, market: kind, line: kind === "moneyline" ? null : line,
      firstPrice: a.price, secondPrice: b.price, providerObservedAt: a.recordedAtUtc!, fetchedAt, phase: "current", provider: "owls", orientationVerified: true });
  }
  return { quotes: quotes.sort((a, b) => a.providerObservedAt.localeCompare(b.providerObservedAt)), rejected };
}

/** Actual observed window, not a fabricated opener or a causal sharp-money label. */
export function cbbObservedPricePaths(quotes: CbbQualifiedNamedQuote[], excludedBook: string) {
  const groups = new Map<string, CbbQualifiedNamedQuote[]>();
  const family = (b: string) => ["pinnacle", "ps3838", "pinnacle_mqtt"].includes(b) ? "pinnacle" : b;
  for (const quote of quotes) {
    if (family(quote.sportsbook) === family(excludedBook)) continue;
    const key = `${quote.sportsbook}:${quote.market}`; groups.set(key, [...(groups.get(key) ?? []), quote]);
  }
  return [...groups.values()].map(rows => {
    rows.sort((a, b) => a.providerObservedAt.localeCompare(b.providerObservedAt));
    const changes = rows.filter((q, i) => !i || q.line !== rows[i - 1].line || q.firstPrice !== rows[i - 1].firstPrice || q.secondPrice !== rows[i - 1].secondPrice);
    return { book: rows[0].sportsbook, market: rows[0].market, observations: rows.length, distinctStates: changes.length,
      windowStart: rows[0].providerObservedAt, windowEnd: rows.at(-1)!.providerObservedAt,
      changes: changes.map(q => ({ at: q.providerObservedAt, line: q.line, firstPrice: q.firstPrice, secondPrice: q.secondPrice })),
      trueOpeningKnown: false, causalLeadership: "unknown" as const };
  });
}

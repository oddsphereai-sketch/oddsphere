import { cbbSplitOrientation } from "./exactSplitIdentity";
import { computeSlateDate } from "../dates/slateDate";
import type { CbbGame, CbbMarket } from "./types";
import type { RawOwlsOddsResponse } from "../providers/owls/owlsSharpBookOdds";
import { normalizeOwlsSharpBookSplits, selectAllInternalNamedBookSplits,
  type RawOwlsSplitsResponse } from "../providers/owls/owlsSharpBookSplits";

export const CBB_SPLIT_EVIDENCE_RELEASE = "cbb_split_evidence_2026_11_03_r4_shared_market_identity" as const;
type CbbSplitSelection = "first" | "second";
const MARKETS: CbbMarket[] = ["moneyline", "spread", "total"];
/** Private evidence only: source split percentages do not yet move CBB predictions. */
export function cbbCurrentSplitEvidence(game: CbbGame, odds: RawOwlsOddsResponse,
  splits: RawOwlsSplitsResponse, fetchedAt: string, asOf: string) {
  const cutoff = Date.parse(asOf), receipt = Date.parse(fetchedAt), start = Date.parse(game.date);
  if (![cutoff, receipt, start].every(Number.isFinite) || receipt > cutoff || cutoff >= start) {
    throw new Error("CBB split evidence invalid pregame cutoff");
  }
  const own={homeTeamDisplayName:game.home_team.full_name,awayTeamDisplayName:game.visitor_team.full_name,cbbHomeCollege:game.home_team.college,cbbAwayCollege:game.visitor_team.college};
  const events = Array.isArray(odds.data) ? odds.data : Object.values(odds.data ?? {}).flatMap(rows => rows ?? []);
  const exact = events.filter(event => event.sport === "ncaab" &&
    cbbSplitOrientation(event.away_team??"",event.home_team??"",own)!==null &&
    Number.isFinite(Date.parse(event.commence_time ?? "")) &&
    Math.abs(Date.parse(event.commence_time!) - start) <= 600_000);
  const ids = [...new Set(exact.map(event => String(event.id ?? event.eventId ?? "")).filter(Boolean))];
  const normalized = normalizeOwlsSharpBookSplits(splits, "ncaab");
  // Each book may use its own odds ID. The verified participant/time pair
  // establishes the physical fixture; the split endpoint keeps its own ID.
  if (ids.length === 0) return { release: CBB_SPLIT_EVIDENCE_RELEASE,
    eventId: null, feedStatus: normalized.feedStatus, rows: [],
    reason: ids.length === 0 ? "exact_odds_event_unavailable" : "ambiguous_odds_event" };
  const dates = new Set([game.date.slice(0,10).replaceAll("-",""),computeSlateDate("cbb",game.date).replaceAll("-","")]);
  const providerEvent = (splits.data ?? []).filter(row => {
    const id=String(row.event_id??""),date=id.match(/-(\d{8})$/)?.[1];
    return ids.includes(id)||date&&dates.has(date)&&cbbSplitOrientation(String(row.away_team??""),String(row.home_team??""),own)!==null;
  });
  if (providerEvent.length !== 1) return { release: CBB_SPLIT_EVIDENCE_RELEASE,
    eventId: ids[0], feedStatus: normalized.feedStatus, rows: [],
    reason: providerEvent.length === 0 ? "event_split_unavailable" : "ambiguous_split_event" };
  const splitEventId=String(providerEvent[0].event_id);
  const orientation=cbbSplitOrientation(String(providerEvent[0].away_team??""),String(providerEvent[0].home_team??""),own);
  const direct=orientation==="direct",reversed=orientation==="reversed";
  if (!direct && !reversed) return { release: CBB_SPLIT_EVIDENCE_RELEASE,
    eventId: ids[0], feedStatus: normalized.feedStatus, rows: [], reason: "split_participant_mismatch" };
  const rows = MARKETS.flatMap(market => selectAllInternalNamedBookSplits(normalized.observations, {
    providerEventId: splitEventId, market, nowMs: cutoff, maxAgeMs: 3 * 60 * 60_000,
  }).filter(row => Date.parse(row.observedAt) <= receipt && Date.parse(row.observedAt) < start)
    .map(row => {
      const selection: CbbSplitSelection = market === "total" ? row.side === "over" ? "first" : "second" :
        (row.side === "home") === direct ? "first" : "second";
      return { market, sourceBook: row.sourceBook, observedAt: row.observedAt, selection,
        gameId:game.id,sourceLine:market==="moneyline"?null:market==="total"?row.line:selection==="first"?row.line:row.line===null?null:-row.line,
        sourceEventId:splitEventId,fetchedAt,orientationVerified:true,
        ticketsPct: row.betsPct, moneyPct: row.moneyPct,
        moneyMinusTicketsPoints: row.moneyPct === null || row.betsPct === null ? null :
          (row.moneyPct - row.betsPct) * 100 };
    }));
  return { release: CBB_SPLIT_EVIDENCE_RELEASE, eventId: splitEventId, feedStatus: normalized.feedStatus,
    rows, reason: rows.length ? "observed_no_prediction_authority" : "no_fresh_coherent_split_pair" };
}

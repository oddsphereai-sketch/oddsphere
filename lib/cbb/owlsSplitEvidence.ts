import { canonicalCbbTeamName } from "./dataset";
import type { CbbGame, CbbMarket } from "./types";
import type { RawOwlsOddsResponse } from "../providers/owls/owlsSharpBookOdds";
import { normalizeOwlsSharpBookSplits, selectAllInternalNamedBookSplits,
  type RawOwlsSplitsResponse } from "../providers/owls/owlsSharpBookSplits";

export const CBB_SPLIT_EVIDENCE_RELEASE = "cbb_candidate_2026_10_29_r1_exact_event_split_evidence" as const;
type CbbSplitSelection = "first" | "second";
const MARKETS: CbbMarket[] = ["moneyline", "spread", "total"];
const names = (team: CbbGame["home_team"]) => [team.full_name, team.college].filter(Boolean)
  .map(name => canonicalCbbTeamName(name!));

/** Private evidence only: source split percentages do not yet move CBB predictions. */
export function cbbCurrentSplitEvidence(game: CbbGame, odds: RawOwlsOddsResponse,
  splits: RawOwlsSplitsResponse, fetchedAt: string, asOf: string) {
  const cutoff = Date.parse(asOf), receipt = Date.parse(fetchedAt), start = Date.parse(game.date);
  if (![cutoff, receipt, start].every(Number.isFinite) || receipt > cutoff || cutoff >= start) {
    throw new Error("CBB split evidence invalid pregame cutoff");
  }
  const home = names(game.home_team), away = names(game.visitor_team);
  const events = Array.isArray(odds.data) ? odds.data : Object.values(odds.data ?? {}).flatMap(rows => rows ?? []);
  const exact = events.filter(event => event.sport === "ncaab" &&
    ((home.includes(canonicalCbbTeamName(event.home_team ?? "")) && away.includes(canonicalCbbTeamName(event.away_team ?? ""))) ||
      (home.includes(canonicalCbbTeamName(event.away_team ?? "")) && away.includes(canonicalCbbTeamName(event.home_team ?? "")))) &&
    Number.isFinite(Date.parse(event.commence_time ?? "")) &&
    Math.abs(Date.parse(event.commence_time!) - start) <= 600_000);
  const ids = [...new Set(exact.map(event => String(event.id ?? event.eventId ?? "")).filter(Boolean))];
  const normalized = normalizeOwlsSharpBookSplits(splits, "ncaab");
  // Owl's may repeat one event ID once per book. Distinct event IDs are ambiguous;
  // repeated rows for the same verified fixture are not.
  if (ids.length !== 1) return { release: CBB_SPLIT_EVIDENCE_RELEASE,
    eventId: null, feedStatus: normalized.feedStatus, rows: [],
    reason: ids.length === 0 ? "exact_odds_event_unavailable" : "ambiguous_odds_event" };
  const providerEvent = (splits.data ?? []).filter(row => String(row.event_id ?? "") === ids[0]);
  if (providerEvent.length !== 1) return { release: CBB_SPLIT_EVIDENCE_RELEASE,
    eventId: ids[0], feedStatus: normalized.feedStatus, rows: [],
    reason: providerEvent.length === 0 ? "event_split_unavailable" : "ambiguous_split_event" };
  const splitHome = canonicalCbbTeamName(String(providerEvent[0].home_team ?? ""));
  const splitAway = canonicalCbbTeamName(String(providerEvent[0].away_team ?? ""));
  const direct = home.includes(splitHome) && away.includes(splitAway);
  const reversed = home.includes(splitAway) && away.includes(splitHome);
  if (!direct && !reversed) return { release: CBB_SPLIT_EVIDENCE_RELEASE,
    eventId: ids[0], feedStatus: normalized.feedStatus, rows: [], reason: "split_participant_mismatch" };
  const rows = MARKETS.flatMap(market => selectAllInternalNamedBookSplits(normalized.observations, {
    providerEventId: ids[0], market, nowMs: cutoff, maxAgeMs: 60 * 60_000,
  }).filter(row => Date.parse(row.observedAt) <= receipt && Date.parse(row.observedAt) < start)
    .map(row => {
      const selection: CbbSplitSelection = market === "total" ? row.side === "over" ? "first" : "second" :
        (row.side === "home") === direct ? "first" : "second";
      return { market, sourceBook: row.sourceBook, observedAt: row.observedAt, selection,
        ticketsPct: row.betsPct, moneyPct: row.moneyPct,
        moneyMinusTicketsPoints: row.moneyPct === null || row.betsPct === null ? null :
          (row.moneyPct - row.betsPct) * 100 };
    }));
  return { release: CBB_SPLIT_EVIDENCE_RELEASE, eventId: ids[0], feedStatus: normalized.feedStatus,
    rows, reason: rows.length ? "observed_no_prediction_authority" : "no_fresh_coherent_split_pair" };
}

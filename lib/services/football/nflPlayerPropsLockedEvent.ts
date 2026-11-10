/** Prospective exact events for newly inserted AI locks. Legacy absence is a
 * separate contract; never reconstruct this metadata onto an existing record. */
import type { NflPlayerPropsRuntimeDecision } from "./nflPlayerPropsRuntime";
import type { Quote } from "../../playerPropsAi/evidenceContract";
import { CATALOG } from "../../playerPropsAi/evidenceContract";
import { PROPS_AI_EXECUTION_EVIDENCE_RELEASE } from "../../playerPropsAi/publicationContract";
import { digest } from "../../playerPropsAi/evidence";

export const NFL_PROPS_LOCKED_EVENT_RELEASE = "nfl_props_locked_event_2026_11_10_r1_exact_contract" as const;
// Deliberately pinned: importing a later moving release must not opt old locks in.
const EXACT_EVENT_DECISION_RELEASE = "player_props_ai_nfl_decision_2026_11_10_r12_source_participation";
export type NflPropsLockedEvent = {
  release: typeof NFL_PROPS_LOCKED_EVENT_RELEASE;
  gameId: string; providerPlayerId: string; provider: string; decisionRelease: string; modelRelease: string;
  market: string; line: number; side: "over" | "under" | "yes";
  contract: "two_way" | "milestone" | "binary_anytime_td";
  sourceQuote: Quote;
};
const book = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const time = (s: string) => typeof s === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(s) ? Date.parse(s) : NaN;

/** undefined means an unchanged legacy decision; null is a new-contract failure
 * that must be persisted explicitly and held, never silently settled as legacy.
 * A newly published R12 decision may retain an older accepted law/review release. */
export function buildNflPropsLockedEvent(row: NflPlayerPropsRuntimeDecision): NflPropsLockedEvent | null | undefined {
  if (row.decisionRelease !== EXACT_EVENT_DECISION_RELEASE) return undefined;
  try {
    const e = row.aiReview, proof = e?.executionEvidence, q = proof?.selectedQuote;
    if (row.state !== "locked" || !e || !proof || proof.release !== PROPS_AI_EXECUTION_EVIDENCE_RELEASE || !q
      || !["decision", "member_row"].includes(proof.operation) || row.modelRelease !== e.release
      || !q.id || !q.provider || !row.gameId || !["over", "under", "yes"].includes(q.side)
      || !e.inputHash || !e.lawHash || !row.providerPlayerId || !(CATALOG.nfl.required as readonly string[]).includes(row.market)
      || q.playerId !== `nfl-bdl-player:${row.providerPlayerId}` || q.market !== row.market || q.line !== row.line || q.side !== row.side
      || q.provider !== row.provider || book(q.book) !== book(row.sportsbook) || q.american !== row.americanPrice
      || !Number.isFinite(row.line) || !Number.isInteger(q.american) || Math.abs(q.american) < 100
      || q.opening !== false || q.live !== false || q.receivedAtProvenance !== "provider_response"
      || time(q.observedAt) !== time(row.observedAt) || time(q.receivedAt) !== time(e.quoteConfirmedAt)
      || ![q.observedAt, q.receivedAt, proof.pricedAt, e.reviewedAt, row.lockAt].every(s => Number.isFinite(time(s)))
      || time(q.observedAt) > time(q.receivedAt) || time(q.receivedAt) > time(proof.pricedAt)
      || time(proof.pricedAt) >= time(row.lockAt) || time(e.reviewedAt) >= time(row.lockAt)
      || !Array.isArray(proof.pricingQuotes) || !proof.pricingQuotes.some(candidate => digest(candidate) === digest(q))) return null;
    // NFL's normalizers retain the declared milestone as side=yes. Explicit
    // contradictory contract metadata cannot override that source declaration.
    if (q.offerContract !== undefined && !["two_way", "milestone"].includes(q.offerContract)
      || (q.side === "yes" ? q.offerContract === "two_way" : q.offerContract === "milestone")) return null;
    if (row.market === "anytime_td" && (q.side !== "yes" || ![0.5, 1].includes(q.line))) return null;
    return { release: NFL_PROPS_LOCKED_EVENT_RELEASE, gameId: row.gameId, providerPlayerId: row.providerPlayerId, provider: row.provider,
      decisionRelease: row.decisionRelease, modelRelease: row.modelRelease, market: row.market, line: row.line, side: row.side,
      contract: row.market === "anytime_td" ? "binary_anytime_td" : q.side === "yes" ? "milestone" : "two_way",
      sourceQuote: structuredClone(q) };
  } catch { return null; }
}

type SettlementRow = { provider_game_id: string; provider_player_id: string | null; market: string; line: number;
  side: "over" | "under" | "yes"; sportsbook?: string; locked_price?: number; decision_release?: string;
  model_release?: string; locked_at: string; locked_event?: unknown };
/** The writer already bound the event to its exact original execution evidence.
 * Read only that compact stored event, checking its immutable record columns;
 * never transfer a full AI coverage/decision payload merely to settle a stat. */
export function nflPropsSettlementEvent(row: SettlementRow): { status: "legacy" } | { status: "invalid" } | { status: "exact"; event: NflPropsLockedEvent } {
  if (row.locked_event == null && row.decision_release !== EXACT_EVENT_DECISION_RELEASE) return { status: "legacy" };
  try {
    const event = row.locked_event as NflPropsLockedEvent, q = event?.sourceQuote;
    if (!event || event.release !== NFL_PROPS_LOCKED_EVENT_RELEASE || event.decisionRelease !== EXACT_EVENT_DECISION_RELEASE
      || event.decisionRelease !== row.decision_release || event.modelRelease !== row.model_release
      || event.gameId !== row.provider_game_id || event.providerPlayerId !== row.provider_player_id
      || event.market !== row.market || event.line !== row.line || event.side !== row.side || !q
      || !(CATALOG.nfl.required as readonly string[]).includes(event.market) || !Number.isFinite(event.line)
      || !["over", "under", "yes"].includes(event.side) || !q.id || !q.provider || q.provider !== event.provider
      || q.playerId !== `nfl-bdl-player:${row.provider_player_id}` || q.market !== row.market || q.line !== row.line || q.side !== row.side
      || q.american !== row.locked_price || book(q.book) !== book(row.sportsbook!) || !Number.isInteger(q.american) || Math.abs(q.american) < 100
      || q.opening !== false || q.live !== false || q.receivedAtProvenance !== "provider_response"
      || ![q.observedAt, q.receivedAt, row.locked_at].every(s => Number.isFinite(time(s)))
      || time(q.observedAt) > time(q.receivedAt) || time(q.receivedAt) >= time(row.locked_at)
      || q.offerContract !== undefined && !["two_way", "milestone"].includes(q.offerContract)
      || (q.side === "yes" ? q.offerContract === "two_way" : q.offerContract === "milestone")) return { status: "invalid" };
    const contract = event.market === "anytime_td" ? "binary_anytime_td" : q.side === "yes" ? "milestone" : "two_way";
    if (event.contract !== contract || event.market === "anytime_td" && (q.side !== "yes" || ![0.5, 1].includes(q.line))) return { status: "invalid" };
    return { status: "exact", event };
  } catch { return { status: "invalid" }; }
}

export function settleNflPropsExactEvent(event: NflPropsLockedEvent, actual: number): "win" | "loss" | "push" {
  if (event.contract === "binary_anytime_td") return actual >= 1 ? "win" : "loss";
  if (event.contract === "milestone") return actual >= event.line ? "win" : "loss";
  return actual === event.line ? "push" : (event.side === "over" ? actual > event.line : actual < event.line) ? "win" : "loss";
}

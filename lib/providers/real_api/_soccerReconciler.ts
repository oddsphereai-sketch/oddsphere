/**
 * Soccer (WC) reconciler — WC-2.
 *
 * Pure module. No DB. No HTTP. Inputs:
 *   • NormalizedBdlMatch[]                 (BDL primary fixtures)
 *   • { event_id, home_team, away_team,    (SharpAPI events extracted from
 *       event_start_time? }[]                /odds rows or /opportunities/ev)
 *
 * Output: a list of `ReconciliationRecord` rows. Each record is either:
 *   • MATCHED   — BDL match + SharpAPI event_id agreed on team pair + start
 *   • BDL_ONLY  — BDL match with no SharpAPI counterpart (still ingestible;
 *                  odds will come from BDL only)
 *   • SHARP_ONLY — SharpAPI event with no BDL counterpart (suspicious;
 *                  likely a polymarket-novelty row that slipped through
 *                  or a match BDL hasn't catalogued; do NOT silently fold
 *                  into the writer — flag for operator review)
 *
 * Why this matters: BDL is the primary fixtures source (clean per-match
 * provider_match_id, team names, stage/group context). SharpAPI gives
 * market overlay + EV/sharp-read substrate. Reconciliation prevents:
 *   1. Double-counting the same fixture in tracking/auditor.
 *   2. SharpAPI polymarket-novelty rows leaking into the slate as if
 *      they were real matches.
 *
 * Match rule (must satisfy ALL):
 *   1. Team-name pair matches (asciiFolded, order-agnostic — handle the
 *      home/away convention flipping between providers).
 *   2. Start time matches within ±6 hours, OR same calendar date in UTC
 *      (defensive — providers can disagree by a few hours on kickoff).
 */

import type { NormalizedBdlMatch } from "./BallDontLieFifaProvider";

export type SharpApiEventCandidate = {
  event_id: string;
  home_team: string;
  away_team: string;
  event_start_time?: string | null;
};

export type ReconciliationKind = "MATCHED" | "BDL_ONLY" | "SHARP_ONLY";

export type ReconciliationRecord = {
  kind: ReconciliationKind;
  bdl_match: NormalizedBdlMatch | null;
  sharp_event: SharpApiEventCandidate | null;
  /** Diagnostic — why this kind, what we matched on. */
  match_notes: string;
};

function asciiFold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamPairKey(a: string, b: string): string {
  const [x, y] = [asciiFold(a), asciiFold(b)].sort();
  return `${x}__${y}`;
}

function parseDateOrNull(s: string | null | undefined): Date | null {
  if (s === null || s === undefined || s.length === 0) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function withinStartTimeWindow(
  bdlIso: string,
  sharpIso: string | null | undefined,
  windowHours = 6,
): boolean {
  const bdl = parseDateOrNull(bdlIso);
  const sharp = parseDateOrNull(sharpIso ?? null);
  if (bdl === null || sharp === null) return false;
  const diffHours = Math.abs(bdl.getTime() - sharp.getTime()) / 3600_000;
  return diffHours <= windowHours;
}

function sameUtcDate(bdlIso: string, sharpIso: string | null | undefined): boolean {
  const bdl = parseDateOrNull(bdlIso);
  const sharp = parseDateOrNull(sharpIso ?? null);
  if (bdl === null || sharp === null) return false;
  return bdl.toISOString().slice(0, 10) === sharp.toISOString().slice(0, 10);
}

/** Group SharpAPI candidates by deduped team-pair key. Multiple bucket
 *  suffixes (`..._b0`, `..._b1`, …) collapse to the same event for
 *  reconciliation purposes. */
function dedupSharpCandidates(
  candidates: SharpApiEventCandidate[],
): Map<string, SharpApiEventCandidate[]> {
  const out = new Map<string, SharpApiEventCandidate[]>();
  for (const c of candidates) {
    const key = teamPairKey(c.home_team, c.away_team);
    const arr = out.get(key) ?? [];
    arr.push(c);
    out.set(key, arr);
  }
  return out;
}

export function reconcileSoccerEvents(
  bdlMatches: NormalizedBdlMatch[],
  sharpCandidates: SharpApiEventCandidate[],
): ReconciliationRecord[] {
  const records: ReconciliationRecord[] = [];

  // Index BDL matches by team-pair key for O(1) lookup.
  const bdlByPair = new Map<string, NormalizedBdlMatch[]>();
  for (const m of bdlMatches) {
    const k = teamPairKey(m.home_team_name, m.away_team_name);
    const arr = bdlByPair.get(k) ?? [];
    arr.push(m);
    bdlByPair.set(k, arr);
  }

  const sharpByPair = dedupSharpCandidates(sharpCandidates);
  const consumedBdlIds = new Set<number>();

  // Pass 1 — every SharpAPI pair tries to find a BDL match.
  for (const [pairKey, sharpRows] of sharpByPair.entries()) {
    const candidates = bdlByPair.get(pairKey) ?? [];

    // Pick the first SharpAPI row in the bucket as representative — they
    // share team pair + start time by construction.
    const representativeSharp = sharpRows[0];

    if (candidates.length === 0) {
      records.push({
        kind: "SHARP_ONLY",
        bdl_match: null,
        sharp_event: representativeSharp,
        match_notes: `no BDL match for team pair ${pairKey} (likely SharpAPI-only row — investigate before ingest)`,
      });
      continue;
    }

    // Find the candidate whose datetime is closest to the SharpAPI start.
    let best: { m: NormalizedBdlMatch; notes: string } | null = null;
    for (const m of candidates) {
      if (consumedBdlIds.has(m.provider_match_id)) continue;
      const sharpStart = representativeSharp.event_start_time ?? null;
      const within6h = withinStartTimeWindow(m.datetime, sharpStart, 6);
      const sameDay = sameUtcDate(m.datetime, sharpStart);
      if (within6h || sameDay) {
        best = {
          m,
          notes: within6h
            ? `team pair + start time within 6h (bdl=${m.datetime}, sharp=${sharpStart ?? "null"})`
            : `team pair + same UTC date (bdl=${m.datetime}, sharp=${sharpStart ?? "null"})`,
        };
        break;
      }
    }
    if (best === null) {
      // Team pair matched but start time didn't — could be a SharpAPI
      // alt-bucket whose date drifted, or a polymarket event with a
      // generic start. Flag, don't silently match.
      records.push({
        kind: "SHARP_ONLY",
        bdl_match: null,
        sharp_event: representativeSharp,
        match_notes: `team pair matched but no BDL match within 6h or same UTC date (sharp_start=${representativeSharp.event_start_time ?? "null"})`,
      });
      continue;
    }
    consumedBdlIds.add(best.m.provider_match_id);
    records.push({
      kind: "MATCHED",
      bdl_match: best.m,
      sharp_event: representativeSharp,
      match_notes: best.notes,
    });
  }

  // Pass 2 — any BDL match not consumed = BDL_ONLY.
  for (const m of bdlMatches) {
    if (consumedBdlIds.has(m.provider_match_id)) continue;
    records.push({
      kind: "BDL_ONLY",
      bdl_match: m,
      sharp_event: null,
      match_notes: "BDL match has no SharpAPI counterpart at probe time",
    });
  }

  return records;
}

/** Convenience: extract SharpApiEventCandidate[] from raw SharpAPI /odds rows. */
export function extractSharpEventCandidates(
  rows: Array<{ event_id?: string; home_team?: string; away_team?: string; event_start_time?: string }>,
): SharpApiEventCandidate[] {
  const out: SharpApiEventCandidate[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.event_id || !r.home_team || !r.away_team) continue;
    const key = `${r.event_id}__${r.home_team}__${r.away_team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      event_id: r.event_id,
      home_team: r.home_team,
      away_team: r.away_team,
      event_start_time: r.event_start_time ?? null,
    });
  }
  return out;
}

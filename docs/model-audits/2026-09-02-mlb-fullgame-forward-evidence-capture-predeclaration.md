# MLB full-game forward evidence capture predeclaration

Date: 2026-09-02

## Purpose

This release adds bounded, forward-only evidence to the existing authoritative
MLB Moneyline and Total `prediction_records.snapshot_json`. It does not change
the r76 forecast, score, side, probability, grade, stake, evaluated price,
writer, lease, lock, tracking, provider, cron, reader, or model release.

The capture exists to evaluate two structural questions on future
release-separated natural cycles:

1. Can a side-specific target-excluded named-book cohort improve the coherent
   full-game forecast without letting the evaluated quote validate itself?
2. When a legacy publication correction changes the displayed side, does that
   change agree with the authoritative decimal score/winner and improve
   prediction quality separately from exact-price grade economics?

No outcome is inspected to select the capture schema. Missing evidence is
explicitly unavailable and has zero behavioral effect.

## Frozen capture contract

- Snapshot key: `mlb_fullgame_market_evidence_v1`.
- Contract: `mlb_fullgame_market_evidence_capture_2026_09_02_r1`.
- Schema: `mlbfgme1`.
- Mode: `capture_only`; `production_gate_enabled=false`.
- Markets: Moneyline and exact listed-line Total only.
- Pair identity: same normalized sportsbook, same market, complementary sides,
  exact Total line, finite nonzero American prices, no more than two minutes of
  side skew, and no future timestamp relative to the model cycle.
- Fresh current pair: no more than 90 minutes old at the model cycle. Stale,
  future, invalid, unmatched, and beyond-skew evidence is counted but omitted.
- Opening movement: earliest valid same-book complementary pair for that
  market and line. No cross-book or one-sided movement is permitted.
- Source classes: supported sharp, supported retail, or other named book.
  Price rows are never labeled ticket/handle splits.
- The exact evaluated sportsbook/side/line/price remains available for
  economics. A deterministic target-excluded cohort omits that sportsbook and
  records remaining source breadth and incumbent r76 eligibility.
- Genuine source-aware Consensus/Circa observations and legacy sharp-signal
  provenance are retained only when present and valid. Missing classes are
  neutral and never synthesized.
- Authoritative independent scores, final game-prediction scores/sides, final
  public record tuple, r76 coherent-map aggregate, and legacy publication-side
  correction provenance are copied separately. Capture code does not recompute
  or replace any of them.

## Bounds and failure isolation

- At most 16 named-book pair landmarks per market.
- At most eight source-aware split rows per market.
- At most four legacy sharp-signal rows per market.
- Strings are bounded to 160 characters.
- Each market artifact must serialize to at most 12,288 bytes.
- Combined Moneyline plus Total capture added for a game must be at most
  24,576 bytes.
- Retention is deterministic: evaluated book first, then supported sharp,
  supported retail, other named books, freshness, and normalized identity.
- Omitted and rejected evidence is represented by deterministic reason counts;
  raw line-history arrays are never copied.
- Any exception, serialization failure, per-market overflow, or combined-game
  overflow returns the original prediction record objects byte-for-byte. The
  capture cannot fail the authoritative writer.
- Locked records are never augmented or rewritten. Existing lock-preservation
  and tracking precedence remain authoritative.

## Runtime topology

The capture reuses inputs already loaded by `createPredictionRecords`:

- current `lines` rows;
- bounded 24-hour `line_history` rows and derived opener rows;
- `sharp_signals`;
- source-aware split observations;
- the current `game_predictions` row and final proposed record.

There is no new or widened query, provider call, table, migration, cron, writer,
upsert, or reader path. The only persistence change is one bounded additive JSON
key on the two existing unlocked full-game record upserts.

## Required tests before local checkpoint

- every forecast, score, side, probability, grade, stake-equivalent field,
  price, tracking identity, and lock field remains identical after removing only
  the capture key;
- locked record identity is exact;
- target exclusion and evaluated-book identity are exact;
- opening/current movement is same-book and exact-line only;
- missing evidence is neutral and rejection counters are truthful;
- stress input respects the per-market and combined byte caps deterministically;
- a throwing or oversize capture returns the original records by reference;
- static query/provider/write topology remains unchanged.

This branch is local-review only. It may not be pushed, opened as a pull request,
or merged while the current S7 contention correction is unresolved.

# NFL sharp-book price-trail continuity — predeclaration

Date: 2026-09-26

## Scope

- Sport: NFL Daily Edge.
- Layer: additive, capture-only forward context evidence for Circa, Pinnacle, and Bookmaker
  price trails.
- Authoritative writer: the existing `nflForwardEvidenceWriter` under the existing
  `prediction_pipeline:nfl` lease.
- Member behavior: unchanged. No prediction, probability, score, side, grade, stake, copy,
  label, layout, provider cadence, or schedule change is authorized.

## Diagnosis

The Week 3 evidence store contains 518 Circa and 486 Pinnacle observations per market across
all 16 games, but zero chronological opening/current pairs for all six sportsbook-market
combinations. The writer adds the current SharpAPI observations to each compact capture, but
the next cycle rebuilds its history only from ordinary provider opening books. Prior compact
Circa/Pinnacle landmarks therefore do not survive to become the next cycle's opening landmark.

## Candidate

Advance only the additive context-capture and writer identifiers. Reconstruct capture-only,
target-ineligible SharpAPI books from the preceding compact landmark and add them to the
existing opening-history input. The reconstructed books remain excluded from production
decisions and exact-price selection. The writer must also treat a changed context-capture
release as a one-cycle unlocked refresh requirement; otherwise a successful cadence check can
defer activation of the new capture contract. After that one refresh, normal request-bounded
cadence resumes.

## Gates

- Focused context-capture and NFL production tests pass.
- TypeScript, model-change verification, build, and integration safety pass.
- Existing lease, per-cycle request budget, and member output remain unchanged. The release
  transition intentionally adds one unlocked collection cycle, then returns to normal cadence.
- Before/after SELECT-only audit proves chronological Circa/Pinnacle pairs begin accumulating.
- No locked evidence is rewritten; prior rows remain immutable.

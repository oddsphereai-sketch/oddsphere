# MLB official short-slate single-starter continuity

## Owner direction

On 2026-10-16 Daniel Mengel explicitly approved repairing the live MLB board after the
official ALCS slate disappeared while one probable pitcher remained TBD. The repair must
publish the real playoff matchup, remain conservative while the starter is unknown, and
automatically refresh to the ordinary fully specified model after the pitcher is announced.

## Production failure

The exact 2026-10-16 production state contained the scheduled Tampa Bay-Cleveland game.
Tampa Bay's Nick Martinez was present and Cleveland's probable starter was null. The G2
starter gate calculated complete-starter coverage as 0/1 (0%) and classified the entire
slate as catastrophic, even though the existing V2.2 model and completeness controls have
a neutral-starter/bullpen fallback for an officially verified short postseason slate.
Every hourly slate cycle therefore stopped before prediction publication and the member
snapshot truthfully—but incorrectly—contained zero games.

## Declared correction

Future unlocked MLB rows may bypass the percentage-based slate-wide catastrophe only when:

1. MLB's successful official schedule contains one or two supported games;
2. the official game id exactly matches the stored game;
3. each missing stored starter side exactly matches the official probable-pitcher omission;
4. the game remains unstarted and otherwise passes the existing pipeline gates.

The exact verified game reaches the existing neutral-starter/bullpen model. Its completeness
status is degraded, every Best Angle eligibility flag remains false, and ordinary market,
price, score, grade, lock, and publication controls continue to apply. A mismatched game id,
a stored omission where MLB names a probable pitcher, a larger slate, a failed official
schedule request, or any other unverified missing-starter pattern retains the existing
fail-closed behavior.

The ordinary leased hourly writer re-evaluates the official schedule and stored starters on
every run. When Cleveland's starter is populated, the exception no longer applies and the
ordinary complete-starter model replaces the unlocked fallback. No locked payload is changed
or reconstructed.

## Release and validation contract

- Input eligibility: `mlb_input_eligibility_v3_official_short_slate_single_starter_continuity_2026_10_16`
- Projection, calibration, decision, rule-bundle, grade, price, market-reader, stake, lock,
  writer, lease, and schedule releases remain unchanged.
- Current-board expectation: one previously suppressed scheduled game becomes publishable;
  zero Best Angles may be created by the starter exception.
- Required validation: focused G2, MLB completeness, pipeline-safety, Daily Edge, model-change,
  TypeScript, and integration-safety checks; no-write current-board rehearsal; protected PR;
  live release, game-count, degraded-status, Best-Angle block, cron, and lock verification.
- Rollback: restore input eligibility v2 and the previous G2 official-short-slate behavior for
  future unlocked computation only. Stored locked records remain immutable.

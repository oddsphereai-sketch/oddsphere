# Daily Edge actionable-promotion stability predeclaration

Frozen before the cross-sport transition replay and before production code
changes on base `ec513d36c33a2af2a078d1c6327d6a14f9df6d22`.

## Scope

The observed production defect is an unlocked MLB Moneyline decision that moved
`No Play -> Best Angle -> No Play` while its selected side, model probability,
and target-excluded fair probability remained materially unchanged. The
temporary promotion coincided with a fresh coherent evaluated sportsbook
replacing another book at the 60-minute freshness boundary. The promoted exact
price had negative model expected value.

This audit treats that sequence as a system-level promotion-integrity problem,
not as a Mets-specific exception. The first production candidate owns the pure
shared writer-side contract and MLB integration. WNBA, NFL, CFB, and EPL/Soccer
must integrate it in separate fresh-main releases after their own chronological
validation. NBA and NHL remain dormant and receive contract tests before their
adapters can return to production.

No reader-side grade override, cache-only continuity, manual provider call,
parallel writer, unlocked historical rewrite, or locked-row mutation is allowed.

## Stable identity, cycles, and exact economics

A promotion attempt is the same candidate only when all of these remain equal:

- sport and game identity;
- market;
- selected side;
- normalized evaluated line when the market has a line;
- forecast/probability release.

Sportsbook is deliberately excluded. A normal best-price book rotation must not
invent a new model opinion or erase valid persistence. Each current exact
sportsbook/line/price/time tuple must nevertheless pass coherence, freshness,
and the sport's configured minimum expected-value rule independently.

Persistence requires two distinct successful natural leased writer cycles.
Duplicate writes, retries, and line-only refreshes inside the same model cycle
cannot advance it. Each sport supplies its canonical cycle ID, monotonic capture
time, minimum elapsed duration, and required count. For MLB the existing
`game_predictions.computed_at` is both the stable cycle ID and capture time;
retries reuse it. The frozen duration grid selects two distinct cycles plus at
least twenty elapsed minutes for MLB; the selection and untouched holdout
counts are recorded in the release audit.

While a promotion is pending, publication retains the last coherent lower grade
and its reason. The candidate exact tuple and persistence evidence are stored in
the authoritative snapshot, but no probability, price, action, or lower tier is
fabricated. If there is no prior coherent record, the deterministic lower tier
is No Play.

## Frozen alternatives

The incumbent is the current sport decision without a persistence gate.

1. **Economics only:** require nonnegative exact-price EV for a new actionable
   promotion. Demote immediately when the live tuple no longer qualifies.
2. **Persistence only:** require the same canonical candidate to qualify in a
   grid of two or three distinct authoritative writer cycles with a minimum
   continuous duration of 10, 20, or 30 minutes. Select on pre-August-20
   transition evidence and confirm on August 20-28; August 29 is replay-only.
3. **Minimum duration only:** require 10, 20, or 30 elapsed minutes of
   continuous qualification in authoritative writer evidence.
4. **Economics plus persistence (primary before return validation):** require
   nonnegative exact EV plus the selected cycle/duration rule.
5. **Economics plus two cycles plus same book:** retained as a falsification
   comparator only. It is expected to be too brittle because a coherent book
   rotation is not a prediction change.

Safety demotions caused by adverse price economics, market resistance,
incomplete health/coherence, a changed side/line/release, or a lock are always
immediate under every candidate. Locks are immutable.

## Selection and confirmation

For each sport, select only on an earlier chronological release-separated
period and confirm on an untouched later period. Report, where the stored
evidence supports it:

- qualifying rows and unique game-lock observations;
- record, flat-stake units/ROI, exact-price EV and CLV;
- Brier score/calibration for the probability head (which this policy does not
  change);
- largest-win removal and game/day-cluster bootstrap;
- Best Angle, Lean, Watchlist, and No Play counts;
- promotions blocked, later confirmed, reset by identity, and immediate
  demotions;
- direct `nonaction -> action -> nonaction` cliff frequency;
- market mix and net actionable-board impact.

Today's HOU-NYM transition is replayed only after the policy is frozen and is
not used to select thresholds.

## Pass/fail contract

The primary candidate may ship for a sport only if:

- it removes single-cycle actionable promotions and negative-EV Best Angle
  promotions by construction;
- it does not delay a safety demotion or alter a locked decision;
- held-out evidence does not show worse value/calibration than the incumbent;
- board impact is explicit and is not an action quota;
- the single authoritative sport writer and `prediction_pipeline:<sport>` lease
  remain unchanged;
- the new decision/grade/publication identifiers are stamped coherently.

If a sport lacks adequate immutable evidence, the shared helper may exist but
that sport's production integration remains unactivated until its own release
passes this contract.

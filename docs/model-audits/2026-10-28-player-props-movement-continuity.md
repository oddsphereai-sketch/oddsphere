# Player-props movement continuity repair — 2026-10-28

## Scope and base

- Starting production base: `7545f7438d41dedb6491e1c44191022b36aed05a`.
- NBA and NFL member price/line movement only.
- MLB was audited read-only and did not require a change.
- No projection, probability, side, grade, evaluated price, actionability, stake,
  lock time, or tracking result changes.
- Existing locked records retain byte-for-byte precedence. NBA's existing lifecycle
  immutability test remains green; NFL presentation reads stored evidence only.

## Findings

### NBA

The live October 28 private member snapshot contained 941 decisions and 941 movement
objects, but 57 displayed movement endpoints did not match the evaluated member line
or price. The old projection grouped by sportsbook and side only, so alternate ladders
could be interpreted as chronological movement. It also selected the freshest matching
book/side observation even when that observation came from a different provider price
than the exact quote evaluated by the model.

The repair:

1. binds the movement endpoint to the exact evaluated sportsbook, line, side, and price;
2. retains one provider throughout a same-book trail;
3. permits a changed line only when that timestamp contains one unambiguous complete
   Over/Under pair;
4. rejects simultaneous alternate ladders as movement; and
5. always ends the member trail at the exact evaluated quote.

A read-only counterfactual over all 941 stored October 28 decisions found 941 exact
targets, 941 movement objects, zero endpoint mismatches, and 730 genuine opening/prior
changes under the corrected rule.

### NFL

The live Week 8 snapshot contained 1,076 decisions. A comparable opening existed at the
evaluated-price book for 888 decisions and at some retained same-line book for 1,052
decisions. The member reader used only the evaluated-price book, hiding 164 valid stored
same-book trails.

The presentation now prefers the evaluated-price book when it has a comparable opening.
Otherwise it displays a deterministic retained comparison-book trail, with that book and
provider shown next to the movement. The evaluated pick, sportsbook, line, price, model
probability, and grade remain unchanged. Alternate Anytime Touchdown ladders still fail
closed.

### MLB

The live October 28 member payload contained 390 props. All 390 had opening/prior/current
movement, all 390 current endpoints exactly matched the displayed line and price, and 322
contained a real line or price change. No MLB code was changed.

## Board impact

- Actionable promotions: 0.
- Actionable demotions: 0.
- Side changes: 0.
- Grade changes: 0.
- Evaluated-price changes: 0.
- Locked-record changes: 0.

## Verification

- `scripts/test-nba-player-props-movement-integrity.ts`
- `scripts/test-nba-player-props-lifecycle.ts`
- `scripts/test-nfl-player-props-production-contract.ts`
- read-only live NBA exact-target counterfactual
- read-only live MLB endpoint/coverage audit

## Rollback

Revert this commit. No database migration or locked-record rewrite is involved.

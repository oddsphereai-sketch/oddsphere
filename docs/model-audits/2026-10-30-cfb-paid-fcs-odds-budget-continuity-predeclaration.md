# CFB paid FCS odds budget continuity — predeclaration

Date: 2026-10-30

## Incident and frozen baseline

The production CFB board contains 100 games. All 56 FBS-involved games have
current prices, while 43 upcoming FCS-only games are missing Moneyline, Spread,
and Total prices (129 market gaps). The paid The Odds API fallback has supplied
zero current books since its last attempt on 2026-10-28.

The last stored provider balance is 2,262 credits. The incumbent gate blocks a
request below a fixed 2,310-credit threshold because it assumes every `us,us2`
three-market request costs six credits and reserves 192 such requests for each
of two weeks. That fixed pull-count reserve is not a valid shared-key spending
control and currently strands paid credits while price gaps remain.

Starting production base: `92f6332167db4b54c498bffabccd6c645f450d51`.

## Predeclared repair

The candidate may change only the paid FCS fallback's request-budget and retry
policy:

1. Make the quota-free `/v4/sports` request immediately before a paid recovery
   pull and use its `x-requests-remaining` receipt as the live shared balance.
2. Use each paid request's `x-requests-last` receipt for distinct-attempt weekly
   spend, preserve a 250-credit shared-account floor, and require room for a
   conservative 12-credit next request. The documented request costs at most
   six credits (three returned markets times two regions).
3. Cap ordinary current-price spend at 60 credits per CFB week and the T-60
   emergency lane at 90 credits per CFB week.
4. Retry unresolved gaps no more often than every twelve hours beyond 48 hours
   and every four hours inside 48 hours. A new gap may receive one immediate
   opening seed, and a T-60 capture may receive one due refresh, subject to the
   same credit floor and weekly emergency budget.
5. Continue to accept only real, complete, strict-identity named-book quotes.
   No opening, current line, price, event identity, or missing market may be
   synthesized.

The candidate keeps the sole `prediction_pipeline:cfb` writer, existing
provider hierarchy, exact-book precedence, and immutable-lock behavior. It may
make future-unlocked exact prices available where the incumbent has no market;
it cannot mutate an existing locked projection, pick, probability, grade,
price, stake, or evidence field.

## Gates

- Unit tests must prove that a sub-1,000-credit balance can make one bounded
  recovery request, while balances below the shared floor plus conservative
  next-request allowance fail closed.
- Unit tests must prove that the quota-free balance probe prevents the paid
  odds request below that floor.
- Unit tests must prove spend is deduplicated by attempt timestamp, ordinary
  and T-60 weekly budgets fail closed, and historical-opening spend is not
  misclassified as current-price spend.
- Unit tests must prove immediate opening seeding, two-/six-hour retry cadence,
  strict event identity, provider hierarchy, and no-replacement behavior.
- `npm run verify:model-change` and affected CFB tests must pass.
- Immediately before publication, the branch must be integrated with the
  latest remote `main` and pass `scripts/verify-integration-safety.mjs`.
- Live success requires a post-deploy writer run and a fresh board audit. Code
  or preview success alone is not production success.

## Board impact and rollback

This is a missing-market recovery, not a grade-policy demotion. The pre-change
board has 129 missing FCS-only market rows. The candidate is accepted only if it
removes real provider-supported gaps without demoting an already actionable
market on identical input. Any newly actionable market is a promotion from an
unavailable exact-price state and must still pass the incumbent economics and
grade policy.

Rollback is atomic: restore the immediately prior paid-fallback and sole-writer
release identifiers and their prior fixed gate. Stored locked records remain
untouched in either direction.

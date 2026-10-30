# CBB named-book split identity and capture-health repair

Base: `1b7bbcc19e852e615a054745ba683d4cd329887c` (`origin/main`, October 30, 2026).
Scope: unlocked CBB reader display matching and the existing five-minute
named-book capture health result. No prediction, grade, stake, or locked-record
change.

## Observed production state before the repair

- The October 30 CBB writer published seven analyzed, exact-price games.
- Playbook public consensus had complete two-sided Moneyline, Spread, and
  Total observations for six of seven games, including Villanova–Notre Dame.
  Liberty–High Point had no matched public pair.
- The CBB named-book durable snapshot did not exist, and the current CBB
  market-split observation table contained no named-book rows. The sharp-book
  capture logged success with 279 updated records because those records were
  Kalshi prediction-market observations; named-book split rows were zero.
- A direct read of the existing DraftKings Network fallback returned its
  upstream-maintenance response, so it could not supply a current verified
  pair. The local paid SharpAPI credential was stale; it was not used to infer
  provider absence or create replacement data.

## Defect and repair

The generic Owl's overlay required source names to equal a CBB abbreviation
or full mascot name. It rejected institution-only names such as `Villanova`
and `Notre Dame`, and did not remap a neutral site's reversed home/away split
percentages. The DraftKings Network fallback used a permissive name prefix
match instead of verified institution identity and could select the first of
two indistinguishable same-day matchups.

Both display fallbacks now require exact verified CBB institution or full-name
identity. The Owl's path maps source away/home percentages to canonical sides
when the provider orientation is reversed, and rejects a source start more
than ten minutes from the canonical game when a start timestamp exists. Both
paths reject same-day ambiguous fixtures. The CBB named-book cron reports
partial health whenever its named-book row count is zero, independently of
Kalshi success. Other sports' mapping is unchanged.

## Decision and board impact

The repair operates after the existing CBB writer has stored its independent
score and three market decisions. It changes no score, probability, selection,
grade, target book, evaluated price, stake, prediction writer, or lock. On the
observed seven-game board there are no named-book source rows to map, so
the same-input impact is **zero side changes, zero promotions, zero demotions,
and zero actionable-count change**. The existing symmetric CBB provisional
grade policy is untouched. No historical locked record is reconstructed.

The remaining source gap cannot be called healthy until the feed returns a
complete verified pair and the live member reader displays it for the exact
game. This release is a mapping and health repair, not a claim of a validated
sharp-informed CBB prediction improvement.

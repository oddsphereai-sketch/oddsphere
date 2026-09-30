# NHL Sharp-split identity recovery r7

## Incident

The September 30 NHL board contained three games and nine prediction markets,
and production had current SharpAPI and DraftKings split feeds. The Sharp Book
Splits section nevertheless appeared only for PIT-PHI Moneyline/Total. The
current SharpAPI overlay compared provider names with generic normalized text,
so `NY Islanders` did not match `NYI` and `LA Kings` did not match `LAK`. The
DraftKings fallback had the same identity gap. Separately, the NHL adapter could
fall through from an absent Total block to the spread block and display a
puck-line pair as Total evidence.

## Repair

- Use the existing strict NHL team normalizer in both split overlays.
- Keep the established source priority and exact date/team matching.
- Keep the existing Sharp Book Splits section and silent continuity behavior;
  add no member copy, labels, timestamps, or stale state.
- Return no Total split rows when the Total block is absent.

The repair is presentation-only. It changes no independent projection, market
movement input, score, side, probability, decision, grade, stake, lock, or
tracking row. There are zero paired promotions or demotions and zero board
count change.

## Production-feed replay

Using the stored September 30 feeds against the repaired matcher:

- SharpAPI matched 3/3 games and populated 9/9 market sections.
- DraftKings Network matched 3/3 games and populated its 6/6 available
  Moneyline/Total sections.
- Every populated section had two complementary money and ticket rows.
- Missing market blocks stayed empty rather than borrowing another market.

## Acceptance

- SharpAPI current-split, DraftKings fallback, and NHL regular-model suites
  pass.
- TypeScript, model-change verification, production build, and integration
  safety pass.
- The deployed member reader shows the established Sharp Book Splits section
  for every market with a retained complete provider pair.

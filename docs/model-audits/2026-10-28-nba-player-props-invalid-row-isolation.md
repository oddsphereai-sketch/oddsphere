# NBA player-props invalid-row isolation

Date: 2026-10-28

## Production finding

After the r6 market archive accepted the current slate, the private writer
correctly identified six non-positive forecasts and preserved the preceding
snapshot. All six belonged to one newly offered rookie with no usable current
NBA history. The existing 941-row member snapshot did not contain those rows.
The all-or-nothing gate therefore froze 1,078 otherwise valid current decisions
to prevent six unpublished invalid decisions from entering the product.

## Repair

- Advance the sole private writer from r9 to r10.
- Keep the non-positive forecast rule unchanged.
- Exclude each invalid unpublished row before member DTO construction, grading,
  tracking, or locking.
- Continue publication only when at least one valid forward decision remains and
  the existing 80% feature-coverage gate passes.
- Preserve every prior locked row through the existing lifecycle.
- Do not synthesize a projection from market prices or weaken the independent
  model requirement.

## Board impact

Relative to the live r8 member snapshot: zero promotions, zero demotions, zero
side changes, and zero price changes. The six invalid rows were never published;
one would otherwise have entered as a Lean and is deliberately prevented from
becoming a member pick without a positive independent projection.

## Release

`nba_player_props_private_writer_2026_10_28_r10_invalid_row_isolation`

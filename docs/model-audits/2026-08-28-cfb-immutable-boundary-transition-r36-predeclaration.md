# CFB immutable-boundary release transition r36 predeclaration

Date: 2026-08-28

## Scope

- Sport: CFB Daily Edge member release selection only.
- Runtime: the existing member fixture; no provider, writer, cron, database, model,
  probability, projection, price, decision, grade, stake, tracking, or lock change.
- Release: bump only the member fixture release. Every selected evidence row retains its
  original immutable schema, member, decision, tuple, capture, and lock identifiers.

## Observed production boundary

The first untouched post-r35 cycle completed successfully at 20:39 ET with 33 new r20 rows.
The five games not rewritten were four already-started games plus WEB at UNCO, whose valid r19
row had already reached the immutable T-60 boundary. The r24 selector allowed only started-game
carry, so that one future-but-locked game caused it to reject the otherwise coherent r20 wave
and continue serving the prior 19:09 release. USC Spread and Total therefore remained hidden
even though their repaired r20 evidence had been stored successfully.

## Predeclared rule

1. Prefer a complete current release.
2. Otherwise build the exact preceding release board using the same bounded transition rule.
3. A partial current release may replace rows in that preceding board only when every missing
   game is either already started or represented by an immutable `t60` row.
4. A future missing row that is not `t60` still rejects the partial wave.
5. Never relabel, recompute, or overwrite a carried row. Never publish fewer than the expected
   slate count.

## Acceptance

- The production-shaped 33 current + one prior T-60 + four prior started rows select as one
  38-game / 114-market board.
- A future unlocked missing row still retains the preceding board.
- Exact prediction and grade counts are unchanged for all retained tuples; r20 USC Spread and
  Total become visible from their already-written exact evidence.
- Focused CFB tests, TypeScript, `npm run verify:model-change`, webpack build, integration
  safety, protected PR, deployed-commit verification, and signed-in live QA pass.

## Rollback

Restore fixture r24. Append-only evidence and immutable T-60 rows are unchanged.

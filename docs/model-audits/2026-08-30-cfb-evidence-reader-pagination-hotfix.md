# CFB evidence reader pagination hotfix

## Production defect

The natural 2026-08-30 20:39 UTC run completed in 12.3 seconds and inserted all 106 current-release week-ahead rows. The refresh log recorded `records_updated=106`, writer status `partial`, and only the expected game-scoped `authoritative_market_anchor_unavailable` hold.

The member page nevertheless remained on its fallback because `readCfbForwardEvidence` issued one unbounded Supabase select. Supabase returned its default first 1,000 historical rows. That page contained only 101 of the 106 new r21 games, so the complete-wave reader correctly refused the apparent partial release. The missing five rows existed in the database and were hidden only by transport pagination.

## Correction

- read the same immutable season/release set in stable `captured_at`, then `id`, order;
- request inclusive 1,000-row pages until a short page is observed;
- impose an explicit 50,000-row season hard cap and fail visibly if reached;
- change no provider call, model input, probability, projection, grade, exact tuple, stake, lock, tracking row, database row, writer, cron, or lease;
- version only the member fixture/read contract.

The already-written 106-game release becomes readable immediately after deployment; no manual writer or database mutation is needed.

## Validation

Required proof is the focused CFB production suite, repository model-safety suite, TypeScript, touched-file lint, production build, fresh-main integration safety, exact protected-PR tree, production deployment, a SELECT-only count of all 106 current-release games, and signed-in CFB/MLB browser QA.

# CFB exact-event split-history continuity result

Date: 2026-10-27

Status: local candidate verified; publication and post-deploy verification pending

## Result

The bounded exact-event recovery restores Delaware-Western Kentucky from the
configured SharpAPI history source:

- requests: 3 (current split slate, exact-date event catalog, exact-event history)
- history rows inspected: 106
- matched games: 1/1
- source: DraftKings
- source timestamp: `2026-10-26T14:33:26.130Z`
- complete markets: Moneyline, Spread, Total

The provider observation remains older than the established 120-minute reader
freshness gate. It therefore restores member evidence continuity without
changing the current game's forecast or betting tuple.

## Fail-closed NBA/NHL finding

No code-side alias or serializer defect can truthfully restore the missing NBA
and NHL named-book pairs today. SharpAPI currently provides BetMGM ticket
shares without handle shares, and the DraftKings/Circa source is absent. The
repair deliberately does not duplicate Public Consensus into the Sharp Book
panel, infer money shares, or grant ticket-only rows market-reader authority.

## Verification

- `node --import tsx scripts/test-cfb-provider-team-identity.ts`: pass
- `node --import tsx scripts/test-cfb-sharpapi-splits.ts`: pass
- `npx tsc --noEmit --incremental false`: pass
- `npm run test:cfb-v1-production`: pass
- `npm run verify:model-change`: pass
- live-provider exact-event rehearsal: pass, 1/1 game and 3/3 markets

Remaining publication gates are integration safety against the latest
`origin/main`, PR checks, merge, and live card verification.

# Soccer Owls + The Odds API provider cutover — candidate results

Date: 2026-10-28

Status: candidate verification complete; production publication remains held
until the authenticated zero-write production probe proves the production The
Odds API credential, paid-event coverage, freshness, and credit reserve.

## Provider contract

- Owls supplies one cached soccer board per build. Only rows with exact club
  orientation, kickoff within 90 minutes, a provider timestamp no older than 30
  minutes, and complete same-book vectors are eligible.
- The Odds API free event catalog supplies exact event identity and the
  remaining-credit header. A paid event request is made only for markets still
  missing after Owls and cadence-valid stored quotes. The cycle is capped at 20
  paid requests and preserves a 1,000-credit reserve.
- A missing key, stale quote, incomplete vector, reversed or ambiguous event,
  exhausted request ceiling, or reserve breach fails closed. Unit fixtures
  cover each of those boundaries. Provider probes bypass the five-minute
  preview cache but cannot write line history, predictions, or member output.
- The active EPL and UCL builders contain no SharpAPI client, key, or runtime
  provider dependency. Remaining `EplSharp*` names are compile-time legacy DTO
  names only and emit no Sharp import at runtime.

## Read-only current-board impact

### Premier League

- Incumbent: 10 games, 40 markets, 40 priced, 9 actionables.
- Local candidate: 10 games, 40 markets, 39 priced, 7 actionables. The one
  missing Double Chance price is expected locally because the production The
  Odds API secret is intentionally absent from `.env.local`; production proof
  is therefore still mandatory.
- All 40 forecast sides and every model probability are unchanged. There are
  zero promotions. Two BTTS Yes Leans become Watchlists solely because fresher
  exact prices reduce their expected value: Brighton at Manchester City moves
  from -194 to -226; Crystal Palace at Tottenham moves from -141 to -152.

### Champions League

- Incumbent and candidate: 18 games, 72 markets, 72 priced, 12 actionables.
- Same-input comparison: zero promotions, zero demotions, and the actionable
  count remains 12. Fresher current 1X2 input changes three Match Result sides
  and their derived Double Chance sides (six of 72 rows); all six remain No
  Play. Thirty-two probabilities move, with maximum absolute change
  0.14441693597606253. This is the declared market-input effect, not a formula,
  threshold, stake, or writer change.
- Compared with the deployed member snapshot, all 72 sides and all 12
  actionables are preserved; the maximum probability delta is
  0.008883353695676721 from refreshed upstream data.

## Verification

- `npx tsc --noEmit --pretty false`
- `npm run test:soccer-current-market-provider`
- affected EPL coherent-outcome, score-model, shadow, lock, and UCL production
  suites
- `npm run verify:model-change`
- `npm run build`

All completed successfully. The local Market Brain PostgreSQL proof was
skipped by the repository harness because `MARKET_BRAIN_POSTGRES_URL` is not
configured; this cutover does not touch that shadow system.

## Publication hold and rollback

After protected merge and deployment, run the authenticated `provider_probe=1`
routes for EPL and UCL. The probe must report live Owls requests, The Odds API
catalog/paid-request telemetry where supplemental markets are needed, remaining
credits above the reserve, and coherent four-market coverage. Only then may the
ordinary sole-writer refresh publish the new release family. Any failure keeps
the existing member snapshot. Rollback removes the provider/release family
together and never modifies a locked record.

# September 30 market-evidence source integrity repair

## Scope

This release repairs two production evidence-integrity failures without changing
member copy, labels, layout, model coefficients, projected scores, stored picks,
grade thresholds, stakes, locks, or tracking records.

1. NHL Public Consensus could display the same SharpAPI named-book observation
   already displayed in Sharp Book Splits when Playbook was unavailable. The
   NYI-TOR puck-line card proved the two panels were not independent: both showed
   NYI 20% money / 67% tickets and TOR 80% money / 33% tickets, while the stored
   public observation and retained DraftKings Sharp Book fallback came from the
   same SharpAPI evidence family.
2. MLB's CHC-SD market trail accepted an isolated Circa SD -425 / CHC +345 pair
   while the complete named-book board remained approximately SD -133 through
   -155. The exact-price card correctly remained SD -135, but the movement panel
   and shared market-intelligence resolver could treat the anomalous pair as real
   movement.

## Released behavior

- NHL Public Consensus renders only independently resolved Playbook multi-book
  evidence. SharpAPI named-book observations and the DraftKings Network fallback
  remain eligible for the existing Sharp Book Splits section and last-known-good
  continuity. If independent Playbook and Sharp Book values happen to agree,
  both may display because their provenance is genuinely distinct.
- A complete two-sided pair is checked against the current cross-book no-vig
  center before it can own the member movement trail. At least three complete
  pairs are required; a pair more than four percentage points from the median is
  excluded from the trail selector.
- The shared market-intelligence resolver requires at least four current books
  before quarantining any provider. A selected-side probability more than six
  percentage points from the median is excluded together with that book's own
  history. Thin boards retain all evidence. Circa and Pinnacle retain their normal
  priority whenever their observations are coherent with the wider market.

The NHL reader advances to
`nhl_daily_edge_reader_2026_09_30_r8_split_source_independence`. The shared
resolver advances to
`market-intelligence-v2.3-unified-price-map-0.6.0-coherent-observation`.

## Board and model impact

- NHL retains every scheduled game, all three markets, the existing Sharp Book
  fallback, all projected scores, sides, probabilities, grades, actions, stakes,
  locks, and tracking rows. Only a non-independent duplicate Public Consensus
  panel is withheld when no Playbook observation exists. Promotions/demotions:
  0/0. Actionable-count change: 0.
- MLB retains the SD -135 exact-price recommendation and all existing projected
  scores, sides, probabilities, grades, actions, stakes, locks, and tracking rows.
  The isolated -425/+345 pair can no longer become the visible movement trail or
  a resolver input while the coherent multi-book board is present.
- No provider call, cron cadence, writer, lease, or query volume is added.

## Verification

- `npx tsx --env-file=.env.local scripts/test-nhl-regular-model.ts`
- `npx tsx --env-file=.env.local scripts/test-market-intelligence-v2-resolver.ts`
- `npx tsx --env-file=.env.local scripts/test-lab-daily-edge.ts` (249/249)
- `npx tsc --noEmit`
- `npm run verify:model-change`
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main`

The focused NHL test proves a SharpAPI fallback cannot populate Public Consensus,
while an independent Playbook pair still can. The route test reproduces the
Circa -425/+345 anomaly beside coherent Pinnacle and DraftKings pairs and proves
Circa is excluded only for that incoherent observation. The resolver test proves
the outlier is recorded as rejected evidence and coherent Pinnacle evidence
remains usable.

## Rollback

Roll back the NHL reader r8 guard, route coherence filter, and resolver 0.6.0
together if a coherent multi-book board is excluded, the Sharp Book fallback
disappears, any scheduled game or market disappears, or predictions/grades change
unexpectedly. Preserve all immutable prediction, lock, and tracking rows.

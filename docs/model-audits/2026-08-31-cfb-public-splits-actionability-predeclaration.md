# CFB public-consensus market integration predeclaration

Date: 2026-08-31

## Scope and authority

This release changes only the active CFB Daily Edge forecast/grade/publication wave. The current
champion is the r44/r8 market-dominant authority recorded in `docs/current-model-releases.md`:
25% immutable independent-football PMF plus 75% canonical current-market PMF, with a strictly
matched fresh Circa money-versus-ticket adjustment capped at 1.5 points. The sole authoritative
writer remains `runCfbForwardEvidenceWriter` under `prediction_pipeline:cfb`; no reader override,
parallel writer, provider request, stake path, historical rewrite, or lock mutation is authorized.

Playbook public splits are currently fetched, stored, and displayed, but do not enter the active
forecast or grade adjustment. This release makes that existing evidence a separately labeled
`public_consensus` input. It must never be labeled verified sharp evidence. Fresh exact-source
Circa remains the stronger `sharp_adjacent` input.

## Frozen semantics before implementation

- Public ticket/handle evidence is eligible only when it is matched to the same scheduled game,
  captured no later than evaluation, still fresh under the existing CFB near/far cadence, and has
  both finite ticket and money percentages for the selected market side.
- Spread and Total public evidence additionally require the Playbook context line to match the
  canonical market anchor within 0.5 points. Moneyline requires the same matched game but no line.
- Public divergence begins outside an 8 percentage-point neutral band, reaches full strength at
  20 percentage points, and may move the canonical market anchor by at most 0.75 margin/Total
  points. A qualifying Circa divergence retains its existing 1.5-point maximum. When both exist,
  Circa owns the full primary shift and public consensus contributes at half strength, with the
  combined shift still capped at 1.5 points. Thus Circa remains at least twice as influential.
- The adjusted anchor continues through the one authoritative joint PMF. Expected scores,
  representative score, winner probability, exact-line probabilities, sides, EV, and grades are
  recomputed from that same PMF.
- Grade provenance records strict Circa, public-consensus, and same-book movement separately.
  Public support may promote only a complete exact-price positive-EV near-threshold Watchlist to
  Lean. Strong public resistance may demote an actionable grade, while strict Circa and same-book
  resistance retain priority. No public signal can bypass price, same-line fair consensus, health,
  freshness, side/line coherence, T-60, or lock requirements.
- The same outcome-free current-slate inspection exposed three structural ladder gaps, which are
  frozen before measuring their board count: a complete Moneyline Watchlist may become Lean at
  probability >=55%, target-excluded edge >=2pp, EV >=1%, and price -300..+300; a Spread from
  10.5 through 24 points may become Lean only at probability >=54%, edge >=3pp, EV >=3%, and the
  existing -500..+500 price band; and the existing Total Lean edge floor is 2pp rather than
  2.5pp while retaining probability >=52% and EV >=1.5%. Every lane requires no strict-sharp,
  strong-public, or same-book resistance. These are exact-economics rules, not outcome-selected
  thresholds; spreads above 24 and negative-EV tuples remain nonactionable.
- The current-slate replay must report promotions, demotions, net actionable change, market mix,
  side changes, score/probability changes, public coverage, and unchanged tuples. Counts are
  outputs, not quotas. The release must not manufacture action to reach a target percentage.
- No stake creation or increase is authorized. Prior T-60/started/settled rows remain immutable
  under their original release tuples.

## Owned files

- `docs/current-model-releases.md`
- `docs/model-audits/2026-08-31-cfb-public-splits-actionability-predeclaration.md`
- `docs/model-audits/2026-08-31-cfb-public-splits-actionability.md`
- `lib/services/football/cfbV1Decision.ts`
- `lib/services/football/cfbMarketSharpAwareShadow.ts`
- `lib/services/football/cfbForwardEvidence.ts`
- `lib/services/football/cfbForwardEvidenceStore.ts` (release-read allowlist only)
- `lib/services/football/cfbForwardEvidenceWriter.ts`
- `lib/services/football/cfbMemberFixture.ts`
- `lib/services/football/cfbOfficialTrackingRecord.ts`
- `app/lab/lib/dailyEdgeMarketPresentation.ts`
- `scripts/operator/audit-current-cfb-public-splits-candidate.ts`
- `scripts/operator/audit-current-cfb-market-sharp-aware-shadow.ts`
- `scripts/test-cfb-market-sharp-aware-shadow.ts`
- `scripts/test-cfb-v1-production.ts`
- `scripts/test-daily-edge-experience.ts`
- `package.json` only for a named audit/test command.

Explicit exclusions: independent artifact coefficients, weekly feature model, providers, cron
routes, database schema, migrations, tracking settlement, NFL/MLB/WNBA/EPL behavior, reader-side
grade overrides, and logo-source behavior. The already-deployed CFB abbreviation fallback remains
the protection against MLB logo leakage.

## Required proof and rollback

Focused CFB tests, current-slate SELECT-only comparison, `npm run verify:model-change`,
`npm run verify`, TypeScript, focused lint, production build, fresh-main integration safety,
protected PR checks, exact-tree deployment, a natural leased writer wave, release coherence,
board coverage, and desktop/mobile reader QA are required. Roll back to the exact r44/r8 release
set on mixed identifiers, a provider/load increase, any locked-row mutation, missing evidence
presented as a normal evaluation, reader/writer incoherence, or an unexplained actionable collapse.

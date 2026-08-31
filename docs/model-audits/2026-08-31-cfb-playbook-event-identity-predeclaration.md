# CFB Playbook event-identity repair predeclaration

Date: 2026-08-31
Starting production base: `0f6b4ab9eab872f417f8def81aeba15e208b89a2`

## Defect and objective

The current CFB writer matches Playbook line and public-split rows by exact normalized full team
name plus kickoff time. A read-only production/provider reconciliation found that 10 of 11
FBS-involved games reported without Playbook splits actually have current Playbook rows. The rows
are discarded because provider-supported school-name variants such as `Youngstown St`, `Houston
Baptist`, `Sam Houston State`, `Albany`, and `LIU` do not equal BALLDONTLIE's canonical names.

The repair must recover only proven identities. It must not use mascot-only or edit-distance fuzzy
matching, guess across duplicate events, relabel public consensus as Circa, add a provider call,
create a writer, alter the grade ladder, target a board count, or modify a locked row. Missing
Playbook data remains a valid unknown input and never holds the game projection.

## Frozen implementation contract

- Bind each verified Playbook alias to the exact BALLDONTLIE NCAAF team ID and canonical
  abbreviation.
- Require both away and home identities plus a kickoff within the existing three-hour tolerance.
- Resolve a row only when all matching payload entries collapse to one non-empty Playbook game ID;
  conflicting event IDs fail closed.
- Require the separately returned line and split rows to resolve to the same Playbook game ID before
  either is attached to the game.
- Preserve Circa priority and every existing public-support/resistance bound. The recovered public
  input may change the authoritative PMF, prediction side, probability, exact-price economics, and
  grade only through the existing writer-owned model path.
- Keep T-60/started rows immutable. Release refresh applies only to unlocked games.

## Frozen evaluation and publication gates

The paired current-slate report will show exact event coverage before/after, unmatched and
ambiguous rows, forecast/side/probability changes, promotions, demotions, actionable counts by
market, and all changed tuples. It will separately identify legitimately unpublished games.
Focused matcher tests must cover every verified alias, exact-name matches, kickoff rejection,
home/away reversal, and duplicate-event rejection. The full CFB production suite,
`verify:model-change`, TypeScript, focused lint, production build, fresh-main integration safety,
protected PR checks, deployment, and a natural leased writer cycle are required before this release
is called live.

## Task-owned files

- `lib/services/football/cfbPlaybookEvidence.ts`
- `lib/services/football/cfbForwardEvidenceWriter.ts`
- `lib/services/football/cfbV1Decision.ts`
- `lib/services/football/modelArtifacts/cfbV1MarketSharpGradePolicy.json` (release identity only)
- `lib/services/football/cfbMarketSharpAwareShadow.ts`
- `lib/services/football/cfbForwardEvidence.ts`
- `lib/services/football/cfbForwardEvidenceStore.ts`
- `lib/services/football/cfbMemberFixture.ts`
- `lib/services/football/cfbOfficialTrackingRecord.ts`
- `docs/current-model-releases.md`
- this predeclaration and its result document
- `scripts/test-cfb-playbook-event-identity.ts`
- `scripts/operator/audit-current-cfb-playbook-event-identity.ts`
- `package.json` (focused test registration only)
- existing CFB focused tests only where release assertions must move

Reader copy, grade names, thresholds, stakes, provider clients, cron routes, database schema, NFL,
NFL props, MLB, WNBA, EPL, and all locked historical rows are explicitly excluded.

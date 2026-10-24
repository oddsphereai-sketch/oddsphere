# CFB complete current-school split identity

Date: 2026-10-24

Status: production candidate; publication and live verification required

## Owner direction and defect

The owner reported that Tennessee-South Carolina still showed `Sharp Splits ·
Pending` after the earlier Indiana-Michigan and Oklahoma-Mississippi State
repair. A bounded read-only audit fetched 44 current DraftKings Network CFB
games, each with complete Moneyline, Spread, and Total pairs, and compared them
with the 96-game stored production board. Only 30 provider games and 90 market
panels attached.

The rejected inventory contained 14 exact scheduled games. Seventeen shortened
school labels were blocked by the global ambiguity guard because another
cataloged program shared the same school prefix (for example Tennessee State,
South Carolina State, Kansas State, Oklahoma, and New Mexico State). This was
an identity defect, not provider absence or stale evidence.

## Bounded repair

Add abbreviation-scoped exact authority only for the 17 rejected labels observed in the
current provider feed: Northwestern, Florida Atlantic, Kansas, Oregon,
Illinois, Tennessee, South Carolina, Michigan State, Louisiana Tech, Colorado,
Oklahoma State, Virginia Tech, Texas, North Carolina, Arizona, New Mexico, and
Houston. Adding those exact roots would make six already-working current labels
newly ambiguous, so Texas Tech, Texas A&M, Kansas State, Arizona State, Colorado
State, and Texas State also receive exact abbreviation-scoped authority. Exact
collision tests keep every neighboring program rejected. Existing generic
prefix matching remains fail-closed.

Advance the CFB split identity release from r5 to r6 and the sole writer from
r136 to r137. Provider hierarchy, request cadence, one writer, and the
`prediction_pipeline:cfb` lease remain unchanged.

## Same-input board and lock contract

The exact current-feed overlay must move from 30/44 matched provider games and
90/132 populated panels to 44/44 and 132/132. Tennessee-South Carolina must
receive all three verified fallback panels. Forecasts, probabilities, scores,
picks, exact prices, grades, stakes, promotions, and demotions must remain
unchanged. Existing locked payloads retain unconditional stored precedence.

DraftKings Network remains the established lower-authority display fallback;
it does not impersonate Circa and does not gain new decision authority through
this repair. Any genuine future provider absence remains unavailable rather
than synthesized.

## Acceptance gates

- All 23 exact and paired-preservation labels resolve only to their intended abbreviations.
- Collision tests reject every neighboring State/Tech program.
- The 14 rejected-game fixtures plus the paired-regression fixtures attach
  Moneyline, Spread, and Total for every audited matchup.
- A live zero-write overlay reports 44/44 exact games and 132/132 panels.
- The focused CFB suite, TypeScript, `npm run verify:model-change`, clean
  latest-main integration safety, protected PR checks, and post-deploy live
  verification pass before success is declared.

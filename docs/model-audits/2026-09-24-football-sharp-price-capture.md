# NFL and CFB internal sharp-book price-trail capture

Date: 2026-09-24

## Scope and release boundary

This release adds evidence-only Circa and Pinnacle moneyline, spread, total, and American-price
observations to the existing NFL and CFB forward contextual captures. It does not
change the model, calibration, distribution, probability, projected score, side,
evaluated quote, grade, actionability, stake, member snapshot, tracking contract,
page structure, copy, or labels.

The sole existing writers remain authoritative under the existing
`prediction_pipeline:nfl` and `prediction_pipeline:cfb` leases. Their new release
identifiers are:

- `nfl_forward_evidence_writer_2026_09_24_r38_sharp_price_capture`
- `cfb_forward_evidence_writer_2026_09_24_r68_sharp_price_capture`

The contextual capture identifiers are:

- `nfl_daily_edge_forward_context_capture_2026_09_24_r2_sharp_price_trail` (`nflfec2`)
- `cfb_daily_edge_forward_context_capture_2026_09_24_r2_sharp_price_trail` (`cfbfec2`)

## Provider and identity rules

The existing SharpAPI `/odds` interface is queried once per configured sharp
book per league capture wave, not once per game. The current verified account
selection supplies Circa and Pinnacle; Bookmaker is not selected in the provider
dashboard and is therefore not treated as available. Every request is restricted
to one named book, pregame, and main markets. Pagination is bounded at twelve
200-row pages per book and each book request has a 20-second abort deadline.

Rows are admitted only when all of these conditions hold:

- exact league request;
- strict home and away identity plus kickoff within 15 minutes;
- exactly one provider event identity for the scheduled game;
- exact configured sportsbook identity;
- active, non-live, non-stale, non-player-prop main-line quote;
- coherent two-sided tuple for the market;
- valid paired American prices and timestamps;
- opposite spread lines or identical total lines, as appropriate.

Each captured book is stamped `provider=sharpapi`, its provider event identity,
per-market observed timestamps, and `targetEligible=false`. Circa and Pinnacle
remain distinct families and distinct source-class codes; they are never blended
into a synthetic sharp price. A verified tuple replaces an older same-family row
only inside the contextual capture. It is not passed to the production
current-book or consensus arrays.

## Health and failure isolation

The sharp-book requests run in parallel with the existing writer dependencies. Any
error, timeout, incomplete pagination, ambiguous game match, invalid tuple, or
empty provider response produces no evidence for that book in that wave and does not
hold or remove a game, suppress a board, clear a prior member snapshot, or alter
a prediction. Each provider request fails independently; an impossible
cross-game identity collision fails the optional evidence capture closed while
the board continues. Failed-call telemetry conservatively counts the full
twelve-page-per-book cap.
No additional cron, writer, database table, or per-card request path is added.

The existing bounded contextual-capture family count is preserved, so capture
storage remains capped. Sharp families are retained ahead of ordinary non-target
families, while the evaluated family still has first priority. NFL typically uses
one bulk page per book. CFB may use additional pages but can never exceed the
declared per-book cap.

Direct provider verification on September 24 returned both complete Circa and
Pinnacle three-market tuples for the live NFL Atlanta–Green Bay matchup in six
bulk requests and for the live CFB Liberty–Coastal Carolina matchup in thirteen
bulk requests. The full CFB response was 2,516 rows and completed within the
fixed cap; only the two strictly matched game/book tuples enter a game's compact
capture. Both books reported the same canonical event identity for each verified
matchup, while retaining their own line, price, and observation timestamps.

## Prediction and board impact

This is a forward-evidence release, not a predictive-weight release:

- promotions: 0;
- demotions: 0;
- side changes: 0;
- probability or projected-score changes: 0;
- actionable-board net change: 0;
- member-facing changes: 0.

The captured sequences are intended to measure each named sharp book's same-book
opening/current movement and implied-price movement against settled outcomes. A later weight may
enter the model-market marriage only after release-pure, locked-time forward
evaluation and a separate versioned model change with paired promotion/demotion
evidence. Circa, Pinnacle, and any later provider-selected sharp book will be
evaluated separately and weighted only where its own validation supports it—not
as automatic vetoes and not as equivalent to an unvalidated fallback.

## Verification and rollback

Focused tests cover pagination, duplicate-page rejection, strict team/start
matching, stale/alternate/non-main rejection, paired main-line construction,
SharpAPI provenance, target exclusion, capture-family replacement, NFL and CFB
context serialization, and existing NFL/CFB production behavior. TypeScript,
model-change verification, production build, clean-current-main integration
safety, required protected-PR checks, deployment, writer health, and live evidence
capture remain release gates.

Rollback is the prior writer/context pair. Existing append-only contextual
evidence remains release-stamped and is not rewritten.

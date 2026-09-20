# CFB reference-coverage cursor — 2026-09-20

## Predeclaration and observed production state

The r71 historical repair is complete and immutable: the September 19 CFB slate has 291 graded records
across 97 games, every game has Moneyline, Spread, and Total, and there are zero duplicate tuples or
pending grades. Its exact new-release contribution is 52 rows—26 Spreads and 26 Totals—with zero
reconstructed economic fields.

Postdeploy browser verification also proved the current CFB board remained healthy (106 Division I
forecasts, 70 FBS-involved games by default), but exposed a forward-only coverage defect. Of 106 latest
r25 games, 42 had all three market forecasts, 64 lacked a Spread or Total reference, zero had received an
ESPN reference, 56 were deferred, and eight had been attempted but the DraftKings opening was not yet
published. A read-only 32-game provider probe returned 26 exact events with no published complete
DraftKings opening and six missing team-identity mappings. The model forecast exists for every game; a
truthful Spread or Total side still requires a real market line.

## Authorized change

The sole `/api/cron/cfb-forward-evidence` writer remains under `prediction_pipeline:cfb`. The score model,
PMF, probability and calibration releases, market/sharp synthesis, exact-price decision, grade,
promotion/demotion rules, stakes, tracking settlement, UI copy, labels, and structure are unchanged.

The reference collector now:

1. Uses the existing provider-wide maximum of 32 prospective games per run and six concurrent summaries.
2. Carries a previously verified ESPN/DraftKings opening reference into later immutable captures.
3. Prioritizes deferred/unattempted candidates ahead of previously attempted unavailable openings.
4. Runs targeted completion batches only while a current-release row is explicitly deferred. After every
   candidate has been attempted, unpublished openings return to the ordinary six-hour/hourly cadence.
5. Adds schedule-verified ESPN identities for TCU (2628), UTSA (2636), Robert Morris (2523), Lehigh
   (2329), UT Martin (2630), and East Tennessee State (2193).

Targeted reference-completion batches do not invoke the optional SharpAPI odds fallback, so this context
repair cannot create a new exact-price decision or actionable promotion outside the normal refresh path.

No synthetic line is permitted. Playbook remains primary per market. The ESPN fallback still requires an
exact away/home pair, a kickoff within 90 minutes, one unambiguous event, DraftKings attribution, and a
complete symmetric opening Spread plus equal opening Total pair. Missing provider publication remains
missing until a later bounded refresh.

## Load, acceptance, and rollback

Each ESPN batch remains bounded by seven scoreboard dates, at most 32 summaries, 46 maximum provider
requests, six concurrent summaries, and six-second request timeouts. Completion refreshes publish only
the explicitly deferred games after the initial release handoff; they do not rebuild the whole slate or
create another writer/timer. The member reader retains the exact r16/r25/r37/r57 snapshot tuple during
the r17/r26/r38/r58 handoff.

Acceptance requires focused CFB tests, the repository model-change suite, TypeScript, lint, production
build, latest-main integration safety, protected PR checks, live release/snapshot verification, a healthy
visible board, and read-only evidence that deferred work decreases monotonically without repeat selection
or request-bound violations. Promotions, demotions, and actionable-board count changes must remain zero.

The predeployment production-input dry run selected the upcoming 106-game window, proposed one immutable
opening capture per game, reported zero capture failures, and bounded the whole writer to 74 maximum API
calls. A second 32-game ESPN probe after the identity additions matched every exact event: all 32 remaining
failures were solely `draftkings_complete_opening_line_unavailable`, with zero identity, orientation,
kickoff, or ambiguity failures. Those lines must remain unavailable until the named book publishes them.

Roll back the complete r72 publication family together if a verified reference is lost between captures,
the same unavailable batch blocks deferred games, completion continues after deferred work reaches zero,
the request bound is exceeded, snapshot publication fails, the board disappears, any existing tracking
record changes, or any decision/grade/stake changes. Preserve all append-only r71 evidence and tracking
records.

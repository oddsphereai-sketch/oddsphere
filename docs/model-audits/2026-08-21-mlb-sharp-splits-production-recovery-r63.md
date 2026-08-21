# MLB Sharp-splits production recovery — r63

Date: 2026-08-21

## Release boundary

- Candidate decision release: `mlb_daily_edge_decision_2026_08_21_r63`
- Base: production r62 at `1a181fa`
- Projection, probability, calibration, side, grade, action, price, stake,
  first-inning, Moneyline, and Total champion logic: unchanged
- Writer: existing Market Intelligence v2 collection under the sport-scoped
  `prediction_pipeline` lease

## Incident evidence

The read-only member-data audit at 2026-08-21T12:08:15Z found all 15 MLB
games missing SharpAPI money and ticket observations. Playbook consensus was
healthy on all 15 games and price history was healthy, isolating the incident
to the Sharp source-aware ingestion path rather than a general odds outage or
reader-only rendering bug.

A no-write live SharpAPI probe returned ten split rows with complete
Moneyline/Total ticket and handle cells. The production all-or-nothing slate
gate rejected the complete payload because only one row aligned to the current
slate while nine aligned to the prior slate. Current production also lacked
the tested exact-date partial-row recovery, bounded event-history discovery,
and early-day 15-minute recovery cadence. Those safeguards existed in the
forward r49-r53 incident history but were not present on production `main`.

## Repair

The r49-r53 ingestion safeguards are reconciled onto r62 without restoring
their superseded model registry:

1. Accept only exact-date, exact-current-matchup rows from a mixed payload and
   keep the overall job partial/unhealthy while coverage is incomplete.
2. Discover current MLB provider events and poll bounded split history through
   the existing writer; never synthesize unavailable values.
3. Retain correct bucket-before-game doubleheader event identity and reject
   ambiguous unsuffixed evidence.
4. Treat BetMGM rows as verified ticket share only; never reinterpret its
   handle field as verified money share.
5. Refresh current Sharp context every 15 minutes from 07:00 ET onward through
   the existing leased collector. The minute-cadence T-60 lock-only path keeps
   only its entering-game line/signal filters and cannot invoke full-slate
   Market Intelligence or history recovery.
6. Load current Sharp consensus independently from capped per-event history so
   valid current rows cannot be crowded out, while the reader strips
   ambiguous doubleheader copies.

## Board impact and safety

This candidate adds no promotion, demotion, flip, grade, stake, or threshold
rule. Missing Sharp values remain missing, and Playbook consensus cannot
activate SharpAPI-validated rules. Any future board difference is attributable
only to authentic current Sharp observations re-entering the same r62 rules.
The repaired collector's live no-write run built 96 split observations: 90
Playbook consensus rows plus six BetMGM ticket-only observations for LAA-TEX.
It rejected nine wrong-matchup aggregate rows, matched all 15 current games to
the event catalog, made 30 bounded history requests, and received zero history
rows. A separate event-scoped probe likewise returned zero current or history
rows for every tested game except the same LAA-TEX BetMGM ticket row. Therefore
the current provider inventory contains zero verified Sharp money-share rows;
the remaining games must continue to fail closed until authentic data appears.
The prior r49-r53 paired incident
audits cover the same code paths and reported explicit lower-tier board impact
without flattening the premium board.

No production write, merge, deploy, or refresh was performed from this
worktree. Production validation must rerun the current-slate paired comparison
after authentic rows are collected and must report promotions, demotions, net
actions, live r63 stamps, source coverage, cron health, reader rendering, and
snapshot coherence before declaring the incident closed.

## Consolidation safety correction

The first isolated r63 candidate incorrectly removed the pre-existing
`if (!lockOnly)` guard around Market Intelligence v2 in `pregame-sweep`.
Because the collector loads the slate and defaults Sharp history on, that
would have expanded a one-game minute-cadence lock transition into a
full-slate/history refresh. The candidate was never published. The replacement
tip restores the guard, retains scoped `externalIdsFilter` calls for the
entering game's lines and legacy signal refresh, and adds a focused assertion
that the lock-only block cannot request Sharp history.

## Rollback

Rollback is r62. It preserves every current model champion but removes the
partial-row/history recovery and returns the reader to Sharp-context
unavailable when the aggregate provider payload is mixed or incomplete.

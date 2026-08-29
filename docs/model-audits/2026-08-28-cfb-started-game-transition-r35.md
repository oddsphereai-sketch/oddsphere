# CFB started-game and canonical-event transition r35

Date: 2026-08-28

## Outcome

r35 closes two launch-boundary failures without changing the CFB prediction model, PMF,
calibration, grade thresholds, stakes, tracking rules, or reader layout.

1. The member fixture can atomically select current evidence for every refreshed game plus the
   last immutable pregame evidence for only those current-missing games that have already
   started. It never rewrites or re-evaluates a started game.
2. The sole writer can resolve duplicate current Sharp event catalog rows only through one
   unique canonical event ID already proven by immutable evidence for that same game and still
   present among the current strict team/time matches. Any absent or conflicting prior identity
   leaves the game ambiguous and triggers zero odds calls.

## Immutable-store evidence before deployment

The SELECT-only audit at 2026-08-28T23:19:23.471Z read 367 rows and selected:

- 38 unique games / 114 market slots;
- 35 r32 member rows plus three r15 immutable pregame rows;
- 23 evaluated markets and 91 unavailable markets;
- 2 Best Angles / 2 Leans / 10 Watchlists / 9 evaluated No Plays;
- Moneyline 8 evaluated / 30 unavailable;
- Spread 7 evaluated / 31 unavailable;
- Total 8 evaluated / 30 unavailable;
- FBS-vs-FBS 15 evaluated / 3 unavailable;
- FCS-including matchups 8 evaluated / 88 unavailable.

The only unavailable FBS markets were all three SJSU-USC markets. Its r32 row recorded
`sharpapi_canonical_event_ambiguous`. Historical SELECT-only identity proof found exactly one
Sharp event ID across immutable SJSU-USC price evidence:
`ncaaf_sanjosestatespartans_usctrojans_2026-08-29_b2`.

The only unavailable markets that contained any display book were four FCS-including states:
Colgate-Fordham Spread and all three East Texas A&M-Mercer markets. Their books were unsupported
comparison/display books, not qualified target tuples, so they correctly remained operational No
Plays. No offered target-book FBS Spread or Total was silently discarded outside USC's diagnosed
canonical ambiguity.

Strict split evidence matched two games. All unmatched split rows remained hidden.

## Release impact

- Prediction/model/distribution/probability/representative score: unchanged.
- Decision release and tuple schema: unchanged r15/r9; current exact evidence is evaluated under
  the same already-qualified rules.
- Sharp fallback: r10 to r11.
- Evidence/collector/member: r10/r17/r19 to r11/r18/r20.
- Writer: r23 to r24; still the sole leased writer and sole append boundary.
- Member fixture: r23 to r24.
- Before natural refresh: 23 evaluated / 91 unavailable.
- After natural refresh: must be recorded from the deployed immutable wave. Expected code-path
  impact is limited to recovering USC's offered exact markets; there is no formula-driven
  promotion or demotion.

## Tests

- Focused SharpAPI test proves untrusted ambiguity makes zero odds calls.
- Focused SharpAPI test proves one prior ID still present in the current exact catalog makes one
  exact-event odds call.
- A stale prior ID absent from the current catalog makes zero odds calls.
- Conflicting immutable prior IDs disable trust.
- Member selection test proves an upcoming missing game retains the complete prior wave.
- Member selection test proves a newly started missing game retains its exact prior row while a
  current sibling advances.
- CFB production contract and TypeScript pass.

## Deployment acceptance

The change is not announcement-ready until the protected PR is merged, a natural sole-writer
cycle produces r20 evidence, and signed-in production QA confirms:

- 38 games / 114 public market states;
- current USC Spread and Total exact book/line/price/timestamp tuples;
- honest USC Moneyline No Play if a pair is still unavailable;
- independent PMF score/winner/Spread/Total direction coherence;
- no Toss-Up or Held public labels;
- only exact matched Sharp split rows;
- desktop and 390px mobile MLB-parity reader behavior.

## Rollback

Restore Sharp r10, evidence/collector/member r10/r17/r19, writer r23, and fixture r23. Immutable
rows from both release eras remain append-only and started games remain protected.

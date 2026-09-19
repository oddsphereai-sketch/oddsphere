# CFB same-book price-history release continuity

## Predeclaration

- Date: 2026-09-19.
- Scope: CFB Daily Edge member movement history only. The affected path is the existing
  `cfb_forward_evidence_snapshots` market-only reader, sole CFB forward writer, compact member
  fixture, compact snapshot, and snapshot transition reader.
- Production base: `4c6b6531b9bb47a522b91b320a2638a501af595a`.
- Current prediction releases remain the contained Spread counter-signal r69 family recorded in
  `docs/current-model-releases.md`. The sole write path remains
  `/api/cron/cfb-forward-evidence` under `prediction_pipeline:cfb`.
- Incident hypothesis: the market-history reader filters immutable rows to only the current
  prediction evidence release. The September 19 r23 and r24 prediction release bumps therefore
  hide compatible r22/r23 same-book observations even though those rows retain the same
  append-only market-price contract. The current 97-game snapshot consequently has zero markets
  with a two-point `oddsTrail`.
- Candidate: allow the bounded market-only query to read exactly the declared compatible r22,
  r23, and r24 evidence releases. Require each row's database release and embedded release to
  match one another, preserve exact game/stage/capture identity, and continue to reject any
  undeclared release. Do not load historical forecast or decision payloads.
- Invariants: no provider call, cron, database write, probability, side, score projection, grade,
  promotion, demotion, actionability, stake, T-60 lock, tracking, or settlement change. The
  current prediction release remains authoritative; older rows contribute only real same-book
  price/opening/split chronology to the member DTO.
- Load bounds remain 100 visible game IDs per query batch, 1,000 rows per page, and 12,000
  visible-board rows maximum. Failure remains fail-closed and preserves the preceding compact
  snapshot.
- Acceptance: a SELECT-only production replay must preserve all 97 games, 291 predictions,
  picks, model probabilities, grades, and actionable counts while restoring multi-point
  same-book trails where immutable history exists. The compact snapshot must remain below its
  existing size caps. Focused CFB tests, typecheck, lint, `npm run verify:model-change`, and
  integration safety must pass before a protected pull request can merge.

## Result

The SELECT-only production replay at `2026-09-19T11:37:15.407Z` loaded 5,100 compact immutable
market-history rows across the declared compatible releases. The live r14 snapshot had 97 games,
291 market predictions, 201 one-point trails, 90 legitimately unpriced/empty trails, and zero
multi-point opening/current trails. The r15 candidate retains the same 97 games, 291 predictions,
40 Leans, 7 Best Angles, 80 Watchlists, and 164 No Plays, with zero changes across pick, held
state, line, model probability, market fair probability, evaluated/current price, raw/final grade,
verdict, or actionability label.

The candidate restores 200 multi-point same-book trails, and all 200 contain a real `open` or
`first` observation plus a `current` or `locked` terminal observation. One priced market has only
one immutable observation; it remains truthful rather than being manufactured. The other 90
markets remain unpriced/empty. The compact snapshot is 3,401,798 bytes uncompressed and 265,290
bytes compressed, within the existing 8,000,000 / 1,000,000 byte limits. No provider call or write
occurred.

Disposition: qualified for the protected operational release. Roll back writer r65, fixture r56,
snapshot r15, and reader r4 together to r64/r55/r14/r3 if a natural writer run changes a decision,
exceeds the existing history/snapshot bounds, fails publication, loses the CFB board, or violates
same-book identity. Preserve all immutable evidence, locks, and tracking records.

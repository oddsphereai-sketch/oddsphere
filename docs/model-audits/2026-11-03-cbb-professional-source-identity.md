# CBB professional-source institution identity repair

Starting production base: `77110c89d962fa9eb58fe52f18d6e8b03549dbe6`.
Isolated branch: `codex/cbb-professional-source-audit-20261103`.

## Confirmed defect and source evidence

A bounded read at 2026-11-03T12:27:30.468Z found zero canonical price observations
for games 10882593 (Purdue Fort Wayne–Duquesne) and 10882602 (South Dakota State–Kansas
State) since midnight UTC. All 336 split observations were Playbook consensus;
neither R5 receipt contained professional anchors, streams or current pairs.
The stored Owls discovery receipt from 11:41:02.074Z nevertheless contained:

- IPFW @ Duquesne, 00:00Z November 4: Pinnacle, Circa and retail book metadata.
- Purdue FW @ Duquesne, same time: separate retail book metadata.
- S Dakota St @ Kansas St, 01:00Z November 4: Pinnacle and retail book metadata.

The sanitized exact discovery fixture stores original event identity, time and
book/market metadata; no unrecorded price is reconstructed. The three institution
labels failed the shared exact alias map. The evidence establishes a matching
bug; metadata alone does not establish current paired prices or source movement.

## Repair and unchanged contracts

Add only these three institution aliases. Existing shared capture, current and
history normalizers and canonical native-event-ID pairing consume the same map.
Exact opponent, competition, event time/date, two-sided completeness, original
source/receipt clocks, duplicate/conflict quarantine and signed own-side lines
remain required. Purdue alone, South Dakota and San Diego State remain distinct.

Identity R2 / capture R24 / publisher R16 version the input repair. The numerical R5
score, grade R5, board R9, tracking R6 and adapter R7 rules remain exact. No inferred
sharp confirmation, arbitrary promotion/demotion, static winner override, new
writer, cron change, paid request or manual collector cycle. Existing locks are
opaque and retain reader precedence; future inputs flow through the existing
sport-scoped prediction_pipeline lease and sole publisher. Restored evidence may
change future decisions through existing rules; no improved win rate is claimed.

## Verification and publication

Focused tests exercise the actual source labels through current two-sided
normalization, neutral-site reversal, history pairing, native-event reader
identity, shared capture, wrong opponent/date/league, ambiguous duplicates and
negative school identities. Numeric test prices are synthetic contract fixtures.
Required full model safety, affected focused suites, TypeScript/build and clean
fresh-main integration checks precede protected publication. Live proof must
show the normal collector and subsequent R16 board actually receiving qualified
professional inputs, coherent rows/counts, and immutable existing locks/tracking.

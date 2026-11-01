# NFL movement versus current contract

Starting production base: `b572163d335d7b51efe6c5b3af6e9514c8de2164`.
Isolated branch: `codex/nfl-market-semantic-correction-20261101`.

The owner asked whether a substantive game reasoning check had actually been
done. Prior proof established source presence and arithmetic, but did not
establish correct market adjudication. The follow-up found a concrete semantic
defect after PR908 merged; that earlier green check is not sufficient signoff.

## Prospective examples, without outcome labels

PHI–WSH: independent PHI21.5571–WSH20.8282. Circa ML+180/-210 moved to+220/-260;
Pinnacle+189/-219 to+222/-262. WSH spread-4/-4.5 moved to-6.5/-6. Target-free
ML implied WSH margin7.2786, Spread6.3635 at WSH-6.5. Opposing qualified ML flow
remains evidence of price resistance. The incumbent incorrectly rejected the
winner correction because6.3635 does not cover6.5. WSH winning and PHI covering
are compatible. The Spread coordinate can locate the margin while ML supports
the winner; neither line crossing nor a cover is manufactured.

ATL–TB: independent Total46.6035; named Total46.5 fell to43.5/43. The coherent
paired Total44.1829 is a downward correction while still above43.5. The incumbent
wrongly held46.6035 because it demanded an Under bet at the new line before
allowing the lower-scoring environment. The final probability law owns the bet
side and grade after correction.

ML-only weakening is also required: home margin8 can become4 as the away price
strengthens while retaining a home winner. A downward path cannot raise42 to44
merely because both are below an old quote. Genuine named disagreement and
contrary independent-relative corrections remain explicit holds.

## Correction and checks

Episode corroboration, partial-retrace/flow checks and coordinate selection now
distinguish movement direction, independent-relative score correction and current
contract direction. Margin correction does not require an unrelated Total read.
The decision receipt records correction and contract directions separately.
Candidate family: writer102/model46/cal45/decision54/grade54/member51/fixture66/
snapshot58, arbiter27/runtime12. Existing source controls and sole sport-scoped
writer remain. Exact old snapshots and locks retain precedence.

Functional regressions and current-board reasoning must pass before publication.
This is a product-correctness correction, not a prediction of any game result or
a measured improvement in win rate. No shadow is written to production.

The scheduled r101 publication exposed a separate serialization defect on two
unlocked rows (MIN and LV): optional marketEvidence/noWeightMarketReader keys were
undefined, hashed as null, then omitted by JSON transport. Their original digest
matches exactly when those two null slots are supplied in a hash-only copy. The
compatibility verifier is restricted to that release, unlocked stage, both absent
keys and an exact original digest match. It returns the unmodified stored payload;
no record, digest, prediction or lock is rewritten. New appends hash and store the
same JSON-normalized object. All other mismatches, including locked rows, fail.

## Complete current-input reasoning pass

At `2026-11-01T13:05:40.224Z`, the no-write writer included all13 eligible unlocked
games/39 markets, zero output-contract findings, zero held games, and stable
evaluated targets. Source prices were observed around13:04Z, named trails around
13:01Z. Local public flow uses stored timestamped production fallback because the
local Playbook key is absent. Off-line/unqualified Owl's splits remain context;
they are not promoted to model authority. No prediction, tracking or shadow was
written by this run.

| Game | Independent-relative consequence | Actual current contract and conclusion |
| --- | --- | --- |
| PHI–WSH | PHI21.56–WSH20.83 becomes17.50–23.86; WSH margin6.3635, Total41.3644 | WSH-5.5 at-115 is selected after target stabilization, not the original-6.5. WSH is the outright/cover leader but both prices yield negative EV and No Play; TotalOver40.5 is50% and No Play. A separate-6.5 fixture correctly retains PHIcover. |
| ATL–TB | Total46.6035 falls to43.9322 while margin0.4408 is held | Both named numbers fell46.5→43.5/43. The final discrete law givesUnder43.5 a51.08% majority despite mean43.93; negativeEV, No Play. No forced Under crossing or margin change. |
| BAL–BUF | BUF margin8.9116 falls to3.5378, stillBUFwinner; Total55.3614 held | Both MLprices weakenBUF; Circa spread-3.5→-3. BUFML60.05% at-170 is negativeEV/NoPlay. BUF-3.5 at+100 is50.05%/Watchlist. No forced winner flip. |
| LV–NYJ | LVwinner becomesNYJmargin1.0378, Total47.4497 held | Mixed flow does not erase the named MLprice direction. NYJML52.94% at-118 is negativeEV/NoPlay; LV+1.5 remains51.33%/Watchlist. |
| KC–DEN | RetainDENmargin3.1258/Total38.6896 | CircaMLheld, Pinnacle weakenedKC; spread towardDEN but price-impliedmargin remainsKC-0.9038. That cannot justify increasing alreadyDEN-biased independentmargin. NamedTotaldown cannot justify raising the already-lower independentTotal. Existing independent-selectedDENML/spread andUnder remain; this is a deliberate hold, not an ignored movement. |

This pass also exposed an unchanged-axis distribution defect: rebuilding a held
fractional Total distribution changed its majority while retaining the old pick.
The semantic runtime now opts into exact distribution preservation for every
unchanged coordinate. Other users of the shared constructor keep prior behavior.
Real runtime tests prove margin-only changes preserve the Total law and Total-only
changes preserve the margin/winner law.

Board impact is material and explicit: 4 Best Angles /1 Lean /9 Watchlists /
25 No Plays. Same-run upstream12 actionables become5 through7 demotions and
zero promotions. These are consequence-of-score/price changes, not new grade
caps. Existing exact-value promotion paths and the corresponding demotion remain
tested; no quota manufactures replacement picks. This is not a comparison with
the old production release on frozen full-provider inputs or evidence of a higher
win rate. Forward results must be evaluated by release and lock timestamp.

Verification passed: full NFL production suite; new prospective reasoning tests
(also shown to fail the incumbent), exact old snapshot/lock precedence,
JSON-transport roundtrip and corruption rejection, unchanged fractional-axis PMF
runtime regressions, full TypeScript, webpack production build, and full
`npm run verify:model-change` including post-verification. Local PostgreSQL proof
is skipped because its URL is unset; the protected PR runs the hosted proof.
Independent review examined the actual named price paths, evaluated offers and
consequences in the five contrasting cases above and found no further material
defect in that scope. Open PR intersections are documentation or distinct package
scripts; no overlapping NFL runtime change was found. Latest main still equals
the recorded base. Protected publication and live release/writer/reader/lock
verification remain required; this paragraph does not itself assert activation.

## Final source-authority correction and repeat

The14:08 pre-merge repeat was complete but PHI reverted because an unavailable
Spread coordinate's partial-buyback guard vetoed valid ML authority. Publication
was held. Missing numeric axes now retain their raw interpreted context without
owning or vetoing another axis's correction. A sole qualified Spread coordinate
can strengthen, weaken, cross the winner boundary or resolve a tie; an unrelated
static ML price cannot lend it a numeric correction. These missing-axis and
ownership cases are explicit regression tests.

The14:47 read also found fresh Circa/Pinnacle paired quotes were present in the
tape but omitted from numeric score anchors. For ATL, target exclusion left only
two retail families at43; the two named pairs produce four valid families at43.
Semantic anchors now receive those existing named quotes as forecast-only input.
Executable member prices still use the unchanged retail list. Anchor helpers use
each market's original source clock and select whole paired observations per
canonical family AFTER freshness/pair validation; a partial/invalid newer row
cannot erase another valid axis. No opposing sides are stitched. The existing
three-family exact-line qualification remains. Target outcome release is r26.

The final14:52:35.695Z no-write pass again includes all13 games/39 markets,
zero findings/held games and stable targets. Grades are3 Best Angles/2 Leans/
8 Watchlists/26 No Plays; same-input upstream11 actionables become5 through
six demotions and zero promotions. This supersedes earlier-clock board counts.
PHI21.56–WSH20.83 becomes17.62–23.75 (WSHwinner, PHI+6.5cover); ATLTotal46.60
becomes43.84 withOver43 at50%/NoPlay; BUFmargin8.91 falls to3.47 and Total53.42
rises to55.36, reflecting separate side/scoring evidence. All use real current
targets and distribution-derived probabilities. No historical result is used.

# CFB provider team identity result — 2026-10-12

## Outcome

The provider identity defect is confirmed and repaired. The active CFB schedule correctly
identified App State as team ID 123, abbreviation `APP`, and the independent model had a
current 13-game profile. The missing market evidence occurred downstream: SharpAPI published
the same team as "Appalachian State," which the prior matcher did not accept.

One abbreviation-scoped resolver now owns CFB identity matching across the active odds and
split adapters. It uses canonical abbreviation/display name, explicit verified aliases, and
only globally unique prefix completion. Uncataloged FCS opponents retain a shorter prefix path
only when neither the abbreviation nor shorthand can collide with a cataloged team.

## Full-slate identity audit

The pre-change current-week audit covered 98 stored production games, approximately 190 live
SharpAPI event rows, and all 51 rows in the current SharpAPI split response. The independent
model had 98/98 current team profiles. Six distinct provider identity gaps were found:

| Matchup | Canonical team | Provider label |
| --- | --- | --- |
| APP@CCU | App State Mountaineers | Appalachian State |
| SFA@NICH | Nicholls Colonels | Nicholls State Colonels |
| FSU@MIA | Miami Hurricanes | Miami Florida / Miami FL |
| WKU@SHSU | Sam Houston Bearkats | Sam Houston State Bearkats |
| DEL@MTSU | Middle Tennessee Blue Raiders | Middle Tenn ST Blue Raiders |
| MASS@BUF | Massachusetts Minutemen | UMass |

Regression coverage also retains the prior Playbook and FCS aliases for UConn, NC State,
Louisiana, Southern Miss, UAlbany, Houston Christian/Houston Baptist, Southeastern Louisiana,
LIU, Youngstown State, The Citadel, and William & Mary.

Collision tests prove that generic `Florida` cannot attach to Florida State, generic
`Alabama` cannot attach to Alabama State, and `Miami FL` cannot attach to Miami (Ohio).

## Zero-write live replay

The sole production writer was run with `apply=false` and forced unlocked cadence over the
same 99-game current board. No database or member-snapshot write occurred. The immediately
prior production code was replayed in a clean detached worktree, followed by the candidate.
Because the providers are live, the two full-board responses were captured several minutes
apart; aggregate counts are therefore a short-interval operational comparison, not a causal
accuracy experiment. The affected-game comparisons below were checked against stable quoted
lines and explicit source provenance.

| Board measure | Prior production replay | Candidate replay | Change |
| --- | ---: | ---: | ---: |
| Evaluated markets | 174 | 177 | +3 |
| Best Angle | 24 | 24 | 0 |
| Lean | 65 | 68 | +3 |
| Watchlist | 60 | 58 | -2 |
| No Play | 25 | 27 | +2 |
| Internal Holds | 123 | 120 | -3 |
| Actionable (Best Angle + Lean) | 89 | 92 | +3 |

The candidate does not flatten the board. The three newly complete tuples are APP@CCU:

- Moneyline: APP at -118, Lean.
- Spread: APP -1.5 at -108, No Play.
- Total: Over 51.5 at -110, Watchlist.
- Expected score remains coherent at APP 27.33–25.52 CCU.

The recovered DraftKings split labels itself `public_recreational`, not verified sharp:
APP had 80% of tickets and 57% of handle on its Moneyline but 0% of reported Spread tickets
and handle at -1.5. The existing researched release correctly does not grant fallback public
Moneyline or Spread splits the authority of Circa or another verified sharp source.

MASS@BUF recovered a DraftKings Total row with tickets 50/50 and reported handle 100% Under.
Under 43.5 replaces Over 43.5 while retaining Best Angle; the coherent expected score moves
from approximately MASS 22.62–27.19 BUF to 16.41–20.98. This is the already-approved fallback-
Total specialization in the frozen artifact, not a new threshold or weight introduced by this
repair. WKU@SHSU, DEL@MTSU, FSU@MIA, and SFA@NICH did not receive a new actionable direction in
the focused replay; SFA@NICH still lacks a usable named-book quote despite its event identity
now resolving.

## Transition and cache continuity

The first candidate replay exposed and rejected a release-transition flaw: a new evidence
schema initially skipped the October 11 r44 history and behaved like a fresh opening wave.
The published candidate explicitly reads r44 as its immediate transition predecessor and r47
as the compact member-snapshot predecessor. SharpAPI and DraftKings durable split caches use
new matching releases but read the immediately previous cache key/feed before fetching and
merge it into the new current release. A deploy therefore cannot erase last-known evidence.

No locked record is changed, reconstructed, or reinterpreted. The new resolver affects only
unlocked and future captures. The October 11 release family remains the immediate rollback.

## Validation

- Central alias and cross-team collision tests: pass.
- SharpAPI named-book odds and stored splits: pass.
- Sharp-book capture, current-split durable overlay, and DraftKings Network fallback: pass.
- Playbook, CollegeFootballData, The Odds API FCS, and FCS continuity: pass.
- Full CFB production/coherence suite: pass.
- Repository-wide TypeScript check with an 8 GB heap: pass.
- Mandatory `npm run verify:model-change`: pass.
- Live provider replay: 99 games, 177 evaluated markets, zero writes, zero capture failures.

Integration-safety verification, PR checks, and post-merge live release verification remain
publication gates.

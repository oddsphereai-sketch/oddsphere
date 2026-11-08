# NFL props verified current actors — November 8

Base: `6b1285c70787f66fe761bfed9d4ebb1b6579fb88`.

The ordinary producer reported `nfl_captured_player_ambiguous` for remaining games.
Legacy suffix/name groups for the same verified native actor were being treated
as different actors. R1 merges all of that actor's captured evidence after checking
every group's stored provider IDs; conflicting IDs still reject. Identical facts
are deduplicated semantically while different supplied facts remain present.

The source resolver also previously depended on a usable member-model row to obtain a
native player ID. It found a matching depth player but did not adopt that roster
ID. A correctly identified actor whose old forecast was Held could therefore
block its entire game before review. The corrected current-source contract uses
same-game native provider observations, the complete stored board and an exact
current roster match. It verifies game clocks and participants and refuses
conflicting provider IDs or teams. Identity does not depend on numerical-model
eligibility. Missing source names can use their supplied exact roster ID.

Explicit aliases bridge only the separately verified native ID: Marquise/
Hollywood Brown (666), Kenneth/Kenny Gainwell (12), Kevin/KC Concepcion
(33934397), and Chigoziem/Chig Okonkwo (734, already verified in the preceding
native alias contract). Punctuation and suffix normalization remain deterministic;
there is no fuzzy, surname-only, price-based or opponent-based identity guess.
Primary name references:

- [NFL Brown identity](https://www.nfl.com/news/marquise-brown-eagles-sign-wr-one-year-deal)
- [Buccaneers Kenneth/Kenny reference](https://www.buccaneers.com/news/baker-mayfield-discusses-kenneth-gainwell-overwhelming-talent-ted-hurst-iii-growth-more-bucs-bliz)
- [NC State Kevin/KC reference](https://gopack.com/news/2024/8/1/football-concepcion-and-white-land-on-preseason-all-acc-team)
- [Current Cleveland actor](https://www.clevelandbrowns.com/news/browns-sign-wr-kc-concepcion)

Current, confirmed, non-live observations define offered actors. Verified opening
history supplements those actors and active markets. An orphan historical opening
cannot create another current actor or make an otherwise complete game fail.
Unresolved current actors still fail the complete-source contract. All raw source
history remains in the existing captures; no stored locked field is edited.

The source-input release is recorded on the packet. Native-ID individual history
joins apply only to that verified contract; legacy cached inputs keep their own
name/ID semantics. Source decision R7/writer R72/member R56/lifecycle R38 identify
future publication. Accepted R15 laws, confidence/grade formulas, familiar reader
R4, wallet R4, schedule R3, sport lease, jobs and provider request budgets stay
exact. Current accepted numerical laws are neither regenerated nor relabeled.
R6 and R7 both retain their own-side receipt capability at future lock.

A GET-only saved-source audit found three unique roster IDs behind unresolved
native actor names. This is source-identity evidence, not a claim that every
original live collector row has been reproduced. Offline controls cover Held-only
and roster-only/native-only identity, missing names, documented aliases and wrong
ID/team/game/clock negatives, orphan opening versus unresolved current coverage,
and verified-ID history joins. Existing site tests prove paired actionable
promotion/demotion; no Over/Under or actionable-count quota is introduced. New
coverage can generate decisions where a review previously could not run, so a
zero overall forecast/grade change is not claimed for future newly eligible games.

Required before release: focused identity/site/reader/store/lock/cadence/codec
checks, lint, TypeScript/build, full model safety gate, clean latest-main protected
PR, then actual normal writer/source coverage/member reader and exact legacy-lock
proof. No paid testing or manual cron. Closed windows stay closed; this does not
retroactively add a missed review or change an already locked native forecast.

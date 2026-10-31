# CFB first-wave market-reader incident — October 31

This is a read-only pre-lock audit, not a published model change or an accuracy claim. The dedicated worktree started from `origin/main` at `0ad30e17a8901dafad6634fd6a4fea4ad8940cdb`. Production still stamped complete reader r6 when inspected at 14:50 UTC.

The current member snapshot at 14:50:48 UTC covered 100 games, with 19 scheduled from 16:00 through 16:45 UTC. Every selected game below was still unlocked at the audit instant. Preserve its later T-60 record exactly if it locks before a verified release.

| Game | Independent total | Published total | Evaluated total | Evidence requiring adjudication |
| --- | ---: | ---: | --- | --- |
| Notre Dame–Navy | 51.51 | 59.18 | DraftKings 55.5 | Circa 56.5→55 and Pinnacle 57→55.5; Circa Over money/tickets 54/62 at 55; DraftKings Over 80/72 at the evaluated 55.5. The r6 reader's +7.67 total shift and Over Best Angle conflict with the named-book number path, and the positive exact-line split is self-evaluated. |
| Auburn–Ole Miss | 49.17 | 66.15 | BetMGM 58.5 | Circa held 58; Pinnacle 57.5→58.5; Circa Over 64/67 at 58 and DraftKings Over 77/81 at 58.5. The +16.98 total shift is not explained by aligned positive Over money-ticket gaps or two aligned named moves. |
| SMU–Syracuse | 52.31 | 64.43 | Caesars 58.5 | Circa 58→58.5, Pinnacle 57.5→58; DraftKings Over 94/70 at 58.5, Circa 100/100. There is directional Over evidence, but the +12.12 score shift is not yet qualified as the correct magnitude. |
| California–NC State | 53.91 | 59.03 | BetMGM 56.5 | Circa held 56.5 and Pinnacle held 57 while DraftKings Over was 88/70 at 56.5. The +5.13 shift needs source-provenance review. |

The code-level defect is that r6 `splitReads` can select an older nonzero-gap observation and `consensusSplitSide` does not require current source freshness, exact evaluated line, or exclusion of the evaluated sportsbook. Its `alignTotalPmfSide` can then force a directional Total and enlarge the projected score shift. The private r7 candidate adds source/line/time gates and named-book economic-path adjudication; focused synthetic tests pass, but this worktree has not cleared full CFB release-family compatibility, same-board impact, clean integration, PR checks, or live verification. It must not be deployed or used to alter an existing lock merely to meet the first-wave deadline.

No result in this document is a betting recommendation. A line move or split is evidence, not proof of the winner or total.

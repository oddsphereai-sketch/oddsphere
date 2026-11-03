# Complete CBB source identity audit and repair

Starting base: `d8690e1cff30ac6c9d944dacb193f995fb01d26c` (PR951 included).
Isolated branch: `codex/cbb-complete-market-identity-audit-20261103`.

## Evidence and scope

Read-only stored-source audit at 2026-11-03T13:14:46.885Z covered 299 canonical
fixtures over November 3–9, 18 current unlocked member games, 21 current Owls
odds discovery entries, 395 retained named-split source rows and 108 fresh public
side observations. Public observations cover 18 source games, but only 17 of the 18 published
games have public panels (51/54 panels). The retained current collector rejection
log at 13:15:26.570Z identifies the exact missing full name: Playbook sends
North Florida Ospreys @ Cal Baptist Lancers at 03:00Z November 4. The public
source has 19 games; this alias is its sole current rejection. Retained prior-day named-source entries do not authorize current games.

Additional real source spellings failed: AR-Pine Bluff @ Arkansas, North
Florida @ CA Baptist (odds) and North Florida Ospreys @ Cal Baptist Lancers
(public splits). The current compiler/display paths were also inconsistent:
16 source-proven full names and own-mascot variants worked in capture but were
not shared consistently by quote/split/native-event/reader identity; chart code
used its older naming path. PFW has two complementary native IDs (IPFW for
Pinnacle/Circa, Purdue FW for retail books), which a single unscoped event lookup
could reject as ambiguous. Source data has not been fetched again to establish
these defects. The wrong-opponent Colorado St @ San Diego St entry stays rejected;
it must not be relabeled as Fullerton. LSU–New Orleans game 10882595 maps in the
source correctly but has a preexisting independent evaluation gap; this repair
does not hide that separate finding.

## Repair

One authoritative exact market-team matcher serves capture, current/history
quotes, direct and canonical splits, stored split display and unlocked charts.
It reuses the 16 already verified full-name aliases and each school's own complete
mascot, adds only the three source-proven institution spellings and still rejects
mascot-only matches, wrong institutions/opponents, duplicate physical fixtures,
wrong date/time/competition, invalid source clocks and incomplete opposing pairs.
No fuzzy join or generic State/Saint/USC/Miami assumption is introduced.

Chart discovery resolves the unique native event that actually owns the chosen
book. Complementary catalogs work without merging IDs or book histories;
duplicate same-book ownership remains ambiguous. Locked legacy contract matching
stays on its original semantics; writer/reader locked precedence remains exact.
Existing CBB-specific chart versioning preserves other sports' cache/schema keys.

The existing collector logs at most 20 unmatched Owls identities per run so an
upstream spelling change is inspectable without an extra paid probe. No new
cron, collector, writer, provider call, request ceiling or polling is introduced.
New fixture identity does not depend on a fixed game ID or today's date.

## Verification and publication

The sanitized actual-source fixture contains all 299 rolling canonical games and
21 discovery entries. Tests prove direct and reverse joins for every fixture,
next-week rollover, duplicate rejection and all 20 valid source entries across
capture/current/history/split/chart paths, plus same-book ambiguity and immutable
legacy matching. Test numeric prices are synthetic contracts, not recreated odds.
This suite is imported by the required shared capture suite, so future model
safety checks run it automatically. Existing lock writer/reader/tracking, source
clock, display, grade and other-sport neutrality tests remain required.

Identity R4, exact matcher R3, split R4, canonical input R2, capture R26, chart R4
and publisher R18 version only the source/reader repair. R5 numerical score and
grade rules, R9 board, R6 tracking writer and R7 adapter are unchanged. Restored
source inputs may change unlocked decisions through those existing rules. Report
actual board impact; no predictive accuracy or all-provider availability claim.
Full model safety, focused suites, TypeScript/lint/build, fresh-main integration,
protected PR, exact trees and live normal capture/publication/locked proof precede
completion. Preserve PR951's transport/high-water read improvements.

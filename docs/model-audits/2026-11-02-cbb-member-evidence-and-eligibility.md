# CBB member evidence and eligibility repair — November 2

Base: `1196af6b0b1550d42f97a25c69f1f7376453090a` (includes CBB917 and NFL918).

The owner explicitly requested an independent product coverage review, then
removed the proposed collapsed full schedule from scope: incomplete, untracked
fixtures must disappear from the member betting page. The raw ingestion schedule
is retained. Existing priced and evaluated rows remain eligible without requiring
all three markets, a complete same-book bundle, or Hard Rock availability.

The independent review checked today's 182 official/provider fixtures: 119 D1/D1,
62 D1/non-D1, and one neither-D1 event (Southeastern Baptist/West Florida). ESPN
scoreboard membership alone is not proof of D1 eligibility. Eleven of the 62 have
real Kalshi winner contracts, so they must not be described as permanently
unbettable. Those contracts do not supply the named sportsbook pair, calibrated
model input history, or exchange fee/bid/ask grade required for a completed Daily
Edge evaluation. Hard Rock absence is not an exclusion criterion.

The writer now ingests fixtures with at least one provider-verified D1 participant
and publishes future unlocked cards only when the existing forecast is complete
and at least one row has a real evaluated price and probability. Incomplete prior
unlocked records stay unchanged and retryable internally; they cannot become a
completed lock. All existing locks keep exact precedence. No prediction, exact
quote, probability, grade threshold, stake, provider poller or sport lease changes.

The review found one currently published fully incomplete unlocked card:
10882515 St. Thomas–Minnesota/Presbyterian. It has real market quotes but no team332
rating in the frozen prior; its three rows are Held. Its exclusion changes the
member count 118→117 with zero evaluated/actionable rows removed. It is a real
historical-stat recovery finding, not a permanent lower-division or school ban.
The other absent D1/D1 game, 13575807 Northern Illinois/Grambling, already finished
without a pregame record; no retroactive prediction will be invented.

## Concrete locked-record owner decision

10882480 App State/Merrimack is locked at `2026-11-02T10:02:10.038Z`, but all three
stored markets lack an evaluated price/selection. The tracking writer skips such
rows. A provider subsequently reversed the home/away orientation. This is a
legacy incomplete public record, not a valid three-market tracked evaluation.

Proposed owner decision: exclude this exact game from the member betting board
while preserving its stored snapshot and all existing audit data byte-for-byte.
No score, probability, pick, price, grade, stake, result or performance record is
rewritten or invented. The owner explicitly approved this exact exclusion on November2: “Let’s just
get rid of it,” while directing prevention of future incomplete records. The
new scope release matches only this exact game ID, locked timestamp and three
entirely unevaluated markets. Other games/locks/evaluated values do not qualify.
The original snapshot remains unchanged. Together with the unlocked St.Thomas
exclusion, the member cohort becomes116 fully evaluated games /348 priced
markets. No evaluated or actionable row is removed. The skipped archived source
conflict remains in detailed seed audit evidence without poisoning current-board
health; the missing St.Thomas input remains an explicit internal warning.

## Underlying evidence repairs

The CBB writer incorrectly equated each book's native odds event ID with the
splits feed's institutional/date ID. It now requires a verified paired-institution
odds fixture and an unambiguous source split pair/date, preserving competition,
source clocks, orientation and three-hour source age already used by the display
lane. Different book-native IDs no longer erase one physical fixture. The current
raw receipt recovers 83 games /640 source split rows without a provider call.
The adapter converts normalized fractions to display percentages exactly once.

The sole writer reads the existing collector's bounded history tape and persists
that real history alongside unlocked decisions. It also retains its prior source
observations. A future lock freezes that exact existing DTO/evidence rather than
rebuilding it with empty split and quote arguments. Already locked v1/v2 records
return unchanged before any merge or adaptation. Equivalent ISO timestamp formats
are deduplicated by actual instant, not raw text; no extra observations or opening
prices are invented. Source prices, selected book, current tuple and cutoff remain
unchanged. Existing collector budgets and provider cadence are unchanged.

An intercepted current-record replay made zero database writes/provider requests:
120 stored games, four existing locks byte-exact, 116 proposed unlocked writes,
360 stored markets, 354 priced markets, 238 retained split panels and 276 multi-point
line histories. Same-input prediction, quote, grade and actionable changes: zero.
The live member cohort is 118, so those storage-wide totals include prior-day locks.
The separate live reader audit found 348/354 prices, 242 named split panels and
336 multi-point line trails on that member cohort after the existing overlay.

CBB full names now use word-preserving wrapping and a full row; Quick Read places
logos above the names on phones. Search remains local across stored full names
and abbreviations. Unmodeled schedule fixtures no longer create member cards,
empty prediction readers, pending count badges or extra schedule DB reads.

Current releases: member pipeline r7 durable market evidence; member store r2
preserved market evidence (accepts immutable r1); adapter r5 source split
percentages; split evidence r2 verified source event identity; reader evidence r4
instant deduplication. Locked migration/writer/reader precedence and real source
history/percentages have focused regressions. Full model verification, TypeScript,
lint, webpack build, fresh-main integration, protected PR and live source/member
proof are required before declaring the repair live.

## Independent exchange coverage evidence

Read-only source review found these eleven real winner events in the retained
14:21 UTC Kalshi feed. Their absence from Hard Rock alone proves nothing about
eligibility. They remain internal recovery candidates because the checked
Owl/BDL receipts lacked their sportsbook quote and the model lacked their lower-
division input ratings; exchange fee/execution grading is not implemented here.

| Game | Fixture | Kalshi suffix after KXNCAAMBGAME-26NOV02 |
| --- | --- | --- |
|10882410|Fresno Pacific at Fresno State|FPUFRES|
|10882413|Fisk at Middle Tennessee|FISKMTU|
|10882417|Midway at Kennesaw State|MIDKENN|
|10882421|Colorado College at Northern Colorado|CCUNCO|
|10882487|West Coast Baptist at Southern Utah|WCBCSUU|
|10882504|Kentucky Christian at Eastern Kentucky|KCUEKY|
|10882506|Mount Olive at UNC Wilmington|MNTOUNCW|
|10882511|Rivier at UMass Lowell|RIVMASSL|
|10882542|Oakwood at Alabama A&M|OAKAAMU|
|10882564|Willamette at Portland|WLMTPORT|
|10882583|La Verne at UC Riverside|LAVUUCRV|

Six required official paired-fixture identity to resolve incomplete provider
institution names. A global mascot alias is not safe. Another negative check:
Betr calls North Alabama's opponent California, while the canonical and other-
book fixture is UC Davis. That quote must not be borrowed for Adams State at
California10882455. Existing paired-opponent/time guards reject that false join.

# CFB injury-news player identity — November 3

Starting base: `201ba909d7f1a70144290a42cf36bafb743ff056`.

The read-only Daily Edge review found retained ESPN partial-news reports with
`close and who's` and `possession to close` recorded as unavailable safeties.
The real Bubble Watch description discusses teams contending for the playoff;
it is not an injury report. Case-insensitive status regexes also made the
proper-name and position subpatterns case-insensitive, admitting ordinary
prose and the possessive lowercase s as safety position S.

The repair keeps status matching tolerant but independently checks proper-name
case and exact uppercase position tokens. Genuine named injury reports retain
their original source timestamp. Only ESPN public injury-news reports are
requalified when selected from previous raw evidence or retained by the next
unlocked capture. Invalid partial news is absent evidence, never an official
clear report. Mixed reports preserve valid players. Raw source records and
stored locked snapshots are not modified or migrated.

Source release R2 and the existing sole forward writer R148 identify the input
repair. Numerical coefficients, grades/stakes, source precedence, report ages,
request limits, leases, jobs and snapshot schema remain unchanged. Public ESPN
news has zero numerical model authority in the current runtime; only qualified
Playbook reports feed the existing injury/QB path. Thus this fixes false injury
panel data, not a score adjustment or a claim to solve full injury-model coverage.
Same-input promotion/demotion impact is zero. No arbitrary injury penalty.

Tests cover the reproduced prose, genuine Out/Questionable/Available reports,
original clocks, source precedence, corrupt retained and mixed reports, raw
immutability, and unchanged model authority. Full required model safety,
TypeScript/lint/build and fresh-main protected integration precede deployment;
normal cron and exact locked-record proof must follow. The broader Daily Edge
market interpretation review continues separately, including UCL uniform picks
and named retail versus professional split authority.

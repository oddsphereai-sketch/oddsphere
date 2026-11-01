# College reader loading and exchange display repair — November 1, 2026

Starting production base: `6a246d64a252222b78b34c0e94a1da5d1bfc66b2`.

The CBB initial page synchronously hydrated every analyzed game's market evidence.
A stored 48-game slate expanded from 357,025 bytes to 3,530,997 bytes, and named
split matching alone took 13.9 seconds. Request-scoped date/uniqueness memoization
now produces byte-identical split output in about 0.6 seconds on that frozen
4,427-row receipt. No matching, freshness, source priority or eligibility rule
changes in that optimization.

The initial CBB board retains the exact writer payload and immutable member-lock
overlay. Optional history/splits hydrate only a selected game through the existing
immediate-open, deduplicated, authenticated detail/retry mechanism. Linked readers
hydrate that one game server-side. Full-board identity remains available to reject
ambiguous split joins even when only one game is requested. Client detail caches
are scoped to the board publication; later publications take precedence.

Display tracking release:
`cbb_market_tracking_2026_11_01_r2_exact_exchange_names_provider_date`.
Eight explicit exchange institution aliases recover named CBB events; codes or
nicknames alone cannot authorize them. Aliases apply only to future open games.
An exact independent odds event's encoded date may resolve the final minute
before midnight; both original start times are preserved, both named institutions
must match, source time must remain within one minute, and multiple matching
source events reject the proof. Existing locked identity semantics remain first.

Frozen current winner coverage improves from 39/48 to 48/48. A bounded direct
public Kalshi audit (two pages per spread/total series) found usable source
contracts for 40 spread and 41 total selections; six events had no open contracts
in those series, and UT Martin/Tulane spread quotes were too wide for the existing
parser. The completed Notre Dame/Villanova game is excluded from open-series
coverage and its original locked reader evidence remains unchanged. Missing
contracts are never invented, and future eligible contracts use the existing
five-minute collector, sport lease and request budgets. No new writer, provider
poller, prediction, grade, pick, stake or executable-price path is introduced.

Validation: college reader regression; CBB continuous tracking, member-store
writer immutability/reader precedence and exchange display tests; shared split
parity; prediction-market suites; TypeScript, lint, production build and model
verification. Production verification and final deployment are recorded in the PR.

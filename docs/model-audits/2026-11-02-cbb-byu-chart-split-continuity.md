# CBB BYU chart and named-source continuity repair

Base: `a7387fc8b525bbff7904c8e4ca7357d5a15a888b`.

At19:08 UTC the published 117-game array was8,080,817 bytes. The chart API
inflated this entire array under an8,000,000-byte ceiling for each selected
game, caught the error and returned event_unavailable. Ohio State–BYU's actual
Kalshi winner contracts were present, correctly matched and contained48 real
quotes plus actual candles. All its sportsbook histories were also stored.

The CBB API now caches a small sole-board membership index and reads only the
selected complete member detail under a separate30-second cache. Exact ID,
teams and original start must match the index. Excluded/unpublished records
cannot be requested directly. The current member payload, including a lock
formed after the index capture, wins unchanged. Other sports retain their
existing path; the sole collector still reads full original board evidence.
There is no point thinning, invented history, new provider request or writer.
Reader release: prediction_market_published_reader_2026_11_02_r3_cbb_indexed_details.

A single current Owl NCAAB split request at19:09 UTC reported partial /
book_unavailable, advertised only Circa and BetMGM, and omitted Ohio State–BYU.
The durable exact-game feed retains its last complete DraftKings pair from
15:00:04.150 UTC. CBB's display qualifier erased that pair after three hours,
although its exact game/date, side orientation, percentages and original clock
were valid. The new display path retains the last complete named-event receipt,
with the original time visible. Fresh eligible sources take priority; among
retained sources, newer actual receipts take priority. No row is retimestamped
or counted as a fresh provider update. Invalid/partial/ambiguous/wrong-event or
future receipts remain rejected.

Reader evidence r6 and the existing sole publisher r12 carry this display field
into future snapshots. The strict three-hour raw split-input gate is unchanged.
Retained display cannot alter any score, probability, selected side, grade,
price, stake, model evidence or market history. Score r3, board r6, grade r2,
tracking r4, store schema r2, lease and cadence remain unchanged. Every existing
locked member payload returns before enrichment and remains exact.

Regression tests exercise the actual service path above8 MB, warm cache/DB
avoidance, exact full quote preservation, original locked-detail precedence,
excluded membership, changed fixtures, source-time retention, fresh-source
preference and decision neutrality. Deployment still requires focused/full
functional verification, build/TypeScript/lint, clean fresh-main integration,
protected PR and exact live chart/reader/cron/lock checks. Roll back the new API
reader and display enrichment if identity, source chronology, lock equality,
cache capacity or normal refresh health fails; never rewrite existing locks.

Same-input19:20 UTC replay:117 games/351 markets; named display panels294→327,
including all three Ohio State–BYU markets. Every other market field compares
exactly unchanged, including forecast, probabilities, prices, grades, model
references and full quote trails. Promotions/demotions0/0. The shared published
identity cache is15,760 bytes instead of7,839,653 bytes for that later board
(the prior19:08 board exceeded8 MB, explaining intermittent graph loss).
All seven current locked snapshots and18 immutable tracking rows were archived
at19:20 UTC for exact post-deploy comparison. No provider request or write was
made by this replay. Focused regression suites, full model verification,
production webpack build, standalone TypeScript and affected-file ESLint pass;
optional local Market Brain PostgreSQL proof is skipped because its URL is unset.

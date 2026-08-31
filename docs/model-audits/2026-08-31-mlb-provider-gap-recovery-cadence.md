# MLB provider-gap recovery cadence — 2026-08-31

## Scope

Operational availability recovery only. This release changes no model,
probability, projection, side, line selector, price selector, grade, stake,
writer, lock, tracking, settlement, reader, or provider identity rule.

## Production evidence

The 2026-08-31 MLB slate had one operational exception: BAL@COL lacked
Baltimore's probable starter. The natural targeted recovery runs at 10:35,
12:35, and 14:35 UTC each queried the same bounded source chain:

- MLB Stats probable pitchers: success, one request;
- BallDontLie games: success, one request;
- ESPN scoreboard: success, two requests.

All three sources still reported no Baltimore starter. The system therefore
correctly retained public No Play for MLB Moneyline, Total, and First Inning
without fabricating a pitcher or exact-price evaluation.

The old targeted schedule ran every two hours. Combined with the rule that the
starter-only lane never rewrites predictions or grades, a starter published
just after an hourly slate cycle could wait nearly two hours for targeted
discovery and the following authoritative writer cycle.

## Change

The same existing `/api/cron/daily-edge-data-health?repair=starter` path now
runs hourly at minute :35 during 10:00–23:59 UTC and 00:00–03:59 UTC. It keeps
all existing bounds:

- shared `prediction_pipeline` lease;
- at most three explicitly flagged games;
- four provider requests per cycle for the current three-source slate reads;
- locked/started games excluded;
- no prediction, grade, response-snapshot, or tracking write;
- the next normal authoritative slate writer exclusively incorporates newly
  resolved starter evidence.

This halves the targeted-discovery interval without creating a second writer.
When no high-severity starter finding exists, the lane makes no starter-provider
request.

## Sharp splits

No Sharp model-input change is made. Sharp history recovery already runs every
15 minutes with strict event identity, one bounded transient retry, a cycle-wide
retry budget, and explicit failure classes. On the audited slate, current
source-aware observations were fetched at 15:31 UTC for all 24 MLB Moneyline
and Total panels; five panels lacked fresh complete Circa inventory but had
authentic source-labeled DraftKings/consensus rows. DraftKings remains a
presentation fallback only and is not relabeled or substituted into the
validated Circa decision input. Missing upstream Circa evidence continues to
fail closed rather than change a recommendation.

## Impact and rollback

Board, grade, probability, stake, and provider-identity impact at publication:
zero. Maximum targeted starter provider load increases from four calls every
two hours to four calls hourly only while an eligible unresolved starter exists.
Rollback restores the single two-hour schedule expression in `vercel.json`.

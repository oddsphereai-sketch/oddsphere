# MLB Playbook Context Scoping — projection-moving lanes (read-only)

Status: read-only scoping (ticket `o-mlb-playbook-context`)
Date: 2026-06-24
Author: Claude
Note: scoping ONLY — no model/code change. These lanes MOVE projections (unlike public splits), so each needs the strictest gate (forward dual-capture + model-impact replay) before promotion; Playbook context is a supplement/cross-check, not a blind replacement.

## Live endpoint inventory (probed read-only, MLB, 2026-06-24)
| Endpoint | Returns | Key fields | Freshness |
| --- | --- | --- | --- |
| `/v1/mlb/starting-pitchers` | 22 (per game) | gameId, startTime, home/away, `starters.{home,away}` = {name, throws (L/R), playerKey, status, firstSeenAt, lastSeenAt} | per-starter firstSeenAt/lastSeenAt |
| `/v1/venue-weather` | 30 (per team/venue) | venue {park, **parkProfile (HITTER/PITCHER)**, roof, **roofStatus {status, confidence}**}, conditions {tempF, wind {dir,mph,type}, precipProb, isDay}, **stale** + staleReason | explicit `stale` flag |
| `/v1/injuries` | 30 (per team) | teamAbbr, players[] {name, status, statusContext, reason}; top-level reportDate, **updatedAt** | updatedAt |
| `/v1/recent-form` | 10 (recent results) | gameId, date, winner, score, margins, completed | per-game date |
| `/v1/teams` | 30 | teams (includeInjuries option) | — |
| `/v1/games`, `/v1/odds-games` | schedule/odds metadata | — | — |

Not at probed paths (need doc confirm / params): `team-stats` (404), `pitcher-stats` (404 — likely embedded via `playerKey` or a separate endpoint), `strikeout-predictor` (404), `head-to-head` (400 — needs team params).

## Per-lane assessment vs current source

| Lane | Playbook offering | Current OddSphere source | Projection impact | Recommendation |
| --- | --- | --- | --- | --- |
| **Venue weather + park factors** | park profile + **roof status (w/ confidence)** + temp/wind/precip + `stale` flag, per venue | OpenWeather (weather only); **park factors are MOCKED** (MockParkFactorProvider; FanGraphs deferred) | HIGH — park factor + roof drive totals/run projections | **Top candidate.** Replaces the mocked park factors and adds roof status (closed roof = neutralize weather). Promote as a real park-factor + weather lane with OpenWeather fallback + the `stale` gate. Needs model-impact replay (it moves totals). |
| **Starting pitchers** | confirmed starters + `throws` + firstSeenAt/lastSeenAt | BDL starters (+ operator-only resolver fallback; see the CWS missed-starter incident) | HIGH — starter/handedness is a core MLB model input | **Strong candidate as a cross-check/secondary.** Use to detect/auto-fill BDL misses (the incident the resolver fallback was built for). Same-pitcher agreement → confidence; disagreement → flag. Don't blind-replace BDL; reconcile. |
| **Injuries** | per-team injury list + updatedAt | BDL / ESPN injuries | MEDIUM — confidence/data-quality input | Supplement/cross-check (agreement → higher data quality). Lower projection impact than weather/starters. |
| **Recent form** | recent game results + margins | (model uses Elo-ish / pitcher+team stats; recent-form not a confirmed input) | LOW–MEDIUM | Audit whether the model would use it before wiring; defer. |
| **Pitcher / team stats, K-predictor** | path unconfirmed | BDL pitcher/team stats | TBD | Confirm endpoints (doc/params) before assessment. |

## Promotion approach (per the operating plan: one lane at a time, gated)
1. **Observe-first** (mirror the dual-splits pattern): capture Playbook context read-only alongside current sources; compare coverage, freshness, agreement. No model change.
2. **Reconcile, don't replace:** Playbook context is a supplement/cross-check. Agreement raises confidence; disagreement flags for review. Keep the current source as primary/fallback until validated.
3. **Model-impact gate:** because these MOVE projections, each lane needs a forward dual-capture + model-impact replay (which games' run/total projections change, by how much) BEFORE it feeds the model — stricter than the splits gate.
4. **Freshness:** honor Playbook's `stale` flag (venue-weather) + firstSeenAt/lastSeenAt (starters) + updatedAt (injuries); never let stale context override fresher current data.

## Recommended sequencing
- **Lane 1 — venue-weather/park-factors** (highest, cleanest win: replaces a MOCK; roof status is genuinely new) → observe + model-impact replay → gated promotion.
- **Lane 2 — starting-pitchers cross-check** (directly addresses the missed-starter incident; safety value even before projection use).
- Defer injuries/recent-form/stats pending the above + endpoint confirmation.

No code/model change in this scoping. Each lane is its own gated sub-ticket; nothing promotes without the model-impact replay.

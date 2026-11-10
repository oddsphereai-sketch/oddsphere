# UCL upcoming schedule during a forecast outage

Starting main: `6906b56d49e5b3d61ebd6599439ce750fdcdc217`.

Read-only production inspection on November 10 found all 18 November 24–25
fixtures already seeded, but no current-week member snapshot. The canonical
UCL refresh repeatedly fails with `UCL official strength source status 403`;
the latest recorded successful refresh was November 5 at 22:17 UTC. The old
snapshot's cache retention has elapsed. The member page treated its absence
as an empty schedule and incorrectly said there were no Champions League games.

This presentation-only repair reads exact existing soccer game/team foreign
keys in the reserved UCL external-ID range. It finds the next scheduled game,
then fetches its three-day round (at most 64 fixtures) and renders names and
kickoffs with an explicit forecast-unavailable label. The member page and API
share this path. No providers run on member reads. Existing visible forecasts
remain authoritative. Missing forecasts create no prediction, grade, price,
stake, or historical lock. There is no model/input/release or writer change.

The schedule fallback restores fixture visibility; it does not resolve or hide
the source's HTTP 403, establish healthy prediction generation, or substitute
stale/invented ratings. The canonical leased refresh continues to report failure.
Source access and a successful canonical refresh remain operational follow-up.

Validation: focused regression covers two-week gaps, next-round rollover,
competition/identity rejection, minimal schedule-only output, exact existing
locked forecast precedence and shared page/API usage. Production-read check must
confirm 18 fixtures and no forecasts fabricated. Build/type checks and the
fresh-main protected publication/integration checks are required before release.

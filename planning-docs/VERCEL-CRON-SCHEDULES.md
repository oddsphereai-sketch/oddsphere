# Vercel Cron Schedules — preservation doc

**Status:** All 10 production cron schedules are **temporarily removed from `vercel.json`** to unblock Vercel Hobby deployments. Restore when upgrading to Vercel Pro (or any plan that allows sub-daily cron schedules).

**Why removed:** Vercel Hobby accounts cap cron frequency at 1/day. The pre-launch slate has two crons that fire multiple times per day (`lineup-watch` every 30 minutes during the evening window; `pregame-sweep` every 15 minutes pre-first-pitch). Even though most of the schedule is daily, Vercel's schema validator rejects the entire `crons` array if any single entry is sub-daily.

**Member-visible impact while removed:** Scheduled automation does not run. The data pipeline (slate refresh, sharp signal updates, results resolution) does not advance automatically. Daniel runs manual updates via admin tooling (Phase 7.25 upload path) until the cron block is restored.

**Code unaffected:** Each `/api/cron/*` route still exists, still validates `CRON_SECRET`, and can be invoked manually (e.g., via `curl` with the proper `Authorization: Bearer ${CRON_SECRET}` header). The middleware excludes `/api/cron/*` from the beta-password gate; the existing `cronHandler` wrapper continues to gate by secret.

---

## Schedules to restore on plan upgrade

All times are UTC. Daniel's brand-voice convention: cron names use the labeled ET wall-clock time even though the actual execution is one hour earlier during EDT (March–November). V1 launches during EDT so the labeled "morning" cron at `0 13 * * *` (13:00 UTC) actually fires at **9:00 AM ET** (= 13:00 UTC − 4 hours).

| Cron path | Schedule (UTC) | ET interpretation (during EDT) | Frequency | Purpose |
|---|---|---|---|---|
| `/api/cron/daily-refresh` | `0 9 * * *` | 5:00 AM ET | daily | Overnight refresh: scores model, park factors, calibration buckets |
| `/api/cron/morning-slate` | `0 13 * * *` | 9:00 AM ET | daily | Build today's slate: lines, signals, weather, predictions, grades, publish |
| `/api/cron/midday-refresh` | `0 17 * * *` | 1:00 PM ET | daily | Refresh sharp signals + lines as midday liquidity builds |
| `/api/cron/afternoon-refresh` | `0 20 * * *` | 4:00 PM ET | daily | Late-afternoon refresh ahead of evening games |
| `/api/cron/evening-refresh` | `0 22 * * *` | 6:00 PM ET | daily | Pre-first-pitch refresh: lineups, props, weather, predictions, grades |
| `/api/cron/lineup-watch` | `*/30 22-23,0-2 * * *` | every 30 min, 6:00–10:00 PM ET | sub-daily | Track lineup changes near gametime; re-derive props |
| `/api/cron/pregame-sweep` | `*/15 23,0-2 * * *` | every 15 min, 7:00–10:00 PM ET | sub-daily | Final pre-game sweep: lines, signals, market signals, grades |
| `/api/cron/post-game-results` | `0 6 * * *` | 2:00 AM ET (next day) | daily | Resolve last night's games + record prediction_results |
| `/api/cron/weekly-park-factors` | `0 9 * * 1` | 5:00 AM ET Monday | weekly | Rebuild park factors from last 7 days of data |
| `/api/cron/weekly-calibration` | `0 8 * * 0` | 4:00 AM ET Sunday | weekly | Rebuild calibration buckets across all prediction types |

**Cron schedules are UTC.** Times labeled here for EST (UTC-5); during EDT (March–November, UTC-4) every cron fires one hour later than the labeled ET time. V1 launch in 2026 begins during EDT so all schedules effectively run at (labeled ET + 1 hour). Phase 8 may introduce per-cron schedules with a DST-aware wrapper if exact ET alignment becomes necessary.

---

## How to restore

When upgrading to Vercel Pro (or any plan that allows sub-daily crons), replace the `crons` field in `vercel.json` with the full block:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/daily-refresh",       "schedule": "0 9 * * *" },
    { "path": "/api/cron/morning-slate",       "schedule": "0 13 * * *" },
    { "path": "/api/cron/midday-refresh",      "schedule": "0 17 * * *" },
    { "path": "/api/cron/afternoon-refresh",   "schedule": "0 20 * * *" },
    { "path": "/api/cron/evening-refresh",     "schedule": "0 22 * * *" },
    { "path": "/api/cron/lineup-watch",        "schedule": "*/30 22-23,0-2 * * *" },
    { "path": "/api/cron/pregame-sweep",       "schedule": "*/15 23,0-2 * * *" },
    { "path": "/api/cron/post-game-results",   "schedule": "0 6 * * *" },
    { "path": "/api/cron/weekly-park-factors", "schedule": "0 9 * * 1" },
    { "path": "/api/cron/weekly-calibration",  "schedule": "0 8 * * 0" }
  ]
}
```

Restoration steps:
1. Upgrade the Vercel project to a plan that allows the desired frequency.
2. Replace `vercel.json` contents with the block above.
3. Commit + push. Vercel picks up the schedules on next deploy.
4. Verify in `vercel.com → Project → Deployments → Crons` that each entry shows green.
5. Delete this preservation doc if the cron block is now documented inline in the repo via comments-as-keys or a sibling JSON doc.

---

## Related history

- **Pre-Fix-5.1 hotfix:** `vercel.json` previously included a `_comment` property documenting the EST/EDT semantics. Vercel's schema validator rejects unknown top-level properties, so the comment was removed in `9720cb5` and the DST note relocated to this doc.
- **Phase 4E (`scripts/test-refresh-cycle-crons.ts`):** validates that each cron route invokes its handler correctly. Test suite is unaffected by this removal — tests invoke handlers directly, not via Vercel's scheduler.
- **Phase 4E (`lib/cron/runCron.ts:24`):** `cronHandler` wrapper validates `CRON_SECRET` on every invocation. Manual `curl` calls work today via the same auth path Vercel's scheduler would use.

**Last update:** Vercel Hobby cron limit hit during initial production deploy (`9720cb5` predecessor commit). Crons removed in the follow-up hotfix.

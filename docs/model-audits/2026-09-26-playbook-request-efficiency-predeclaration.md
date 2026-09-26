# Playbook request-efficiency r1 predeclaration

Date: 2026-09-26

## Scope

This is an operational provider-read change for the existing MLB, WNBA, NHL,
NFL, and CFB Playbook consumers. It does not change member copy, labels,
layout, prediction math, probabilities, projected scores, sides, grades,
stakes, locks, tracking rules, writer ownership, or cron schedules.

The current production callers independently purchase identical league-wide
`/splits` and `/lines` responses. The largest duplication is within the WNBA
daily refresh: seed, line fallback, three public-split passes, and three market
intelligence passes can issue nine Playbook calls in one run. MLB's public
split refresh separately requests the same `/splits` payload in its legacy and
market-intelligence paths.

## Candidate

- Add one authoritative server-only Playbook read broker around the existing
  typed `PlaybookClient`; do not add a provider or writer.
- Coalesce identical in-flight requests and reuse successful current
  league-wide splits/lines for at most 10 minutes. This is strictly below the
  existing 15-minute split-freshness contract.
- Reuse frozen `/splits-history` responses for 24 hours.
- Reuse venue/weather for at most 10 minutes and injuries for at most 15
  minutes. Existing football collection cadence is hourly or six-hourly, so
  its natural captures continue to make fresh provider requests.
- Use current `/splits` and `/lines` for today or future slates. Reserve
  `/splits-history` for dates before today, matching Playbook's documented
  historical/frozen endpoint contract.
- Stop polling Playbook splits after all relevant slate games have started.
  Stored last-known-good observations are never deleted or cleared.
- Keep operator probes and audits on the uncached `PlaybookClient` so explicit
  provider diagnostics remain truthful.

## Safety and acceptance gates

1. Unit proof: concurrent and sequential identical calls use one upstream
   request; different leagues/endpoints remain isolated; failures are not
   converted into successful cache entries.
2. WNBA topology proof: an active three-date refresh falls from as many as
   nine Playbook calls to two current upstream calls (one splits, one lines)
   while retaining the same league-wide response inputs.
3. MLB topology proof: the public-splits writer and market-intelligence writer
   share the same current `/splits` response inside the freshness window.
4. Historical endpoint proof: only past dates use `/splits-history`.
5. Existing public-split fallback and last-known-good tests remain green; no
   member-visible stale/copy/label behavior changes.
6. Run focused Playbook, WNBA, NHL, football, model-change, typecheck, lint,
   build, and integration-safety gates from the clean task worktree.
7. Publish only through an up-to-date protected pull request, then verify the
   production release, cron health, current data coverage, and provider quota
   telemetry before declaring success.

Rollback is the removal of the broker from production call sites. It never
rewrites or deletes stored observations, predictions, or locks.

# CFB official-score fallback — 2026-10-08

## Scope

- Sport / markets: CFB Moneyline, Spread, and Total settlement only.
- Sole path: the existing `tracking-refresh` CFB branch and deterministic grader.
- Previous score-ingest release: `cfb_score_ingest_2026_08_30_r2_supported_date_filter`.
- Candidate release: `cfb_score_ingest_2026_10_08_r3_official_score_fallback`.
- No prediction writer, schedule, lease, model, probability, projection, side,
  quote, line, grade policy, stake, copy, label, or layout changes.

## Production finding

The October 7 slate contained two correctly locked games and six immutable market
records. JXST–KENN settled normally. BALLDONTLIE omitted exact game `457739`
(NMSU–FIU) from its dated result response, leaving all three locked records
pending even though the game was final.

Official FIU and ESPN results both report FIU 22, NMSU 3. The exact production
game row was corrected to that verified final, the existing deterministic grader
settled all six records, and both tracking response snapshots were refreshed.
The resulting release-pure October 7 record is:

- Moneyline: 2–0.
- Spread: 1–1.
- Total: 1–1.
- Six settled markets, zero pending markets, and zero aggregate mismatches.

## Repair behavior

BALLDONTLIE remains primary. Only a tracked game omitted by the primary response
or still non-final at least five hours after its scheduled kickoff enters the
fallback. ESPN is read at slate scope for groups 80 and 81. A fallback score is
eligible only when:

1. canonical ESPN IDs prove the away/home team pair;
2. kickoff differs by no more than 90 minutes;
3. exactly one event matches;
4. ESPN marks the event completed/final; and
5. both scores are nonnegative integers with a nonzero combined score.

The postgame gate prevents reads for upcoming and normally in-progress games.
The fallback is bounded to 200 tracked games, six scoreboard dates, and twelve
requests per run. A failed or ambiguous fallback writes nothing and preserves the
existing pending state. It cannot create, rewrite, or relabel a locked prediction.

## Verification

- Focused CFB production contract passes, including a simulated missing-primary
  NMSU–FIU result recovered through the strict ESPN path.
- Live dry run against October 7: two already-final games, zero pending, zero
  errors, three total provider requests.
- Tracking consistency audit: six source rows, six graded rows, six settled rows,
  and zero mismatches.
- Board impact: zero promotions, zero demotions, zero side changes, zero price or
  line changes, and zero actionable-count changes. Only the verified results and
  deterministic win/loss settlement become complete.

## Rollback

Revert the score-ingest release and ESPN fallback module. Do not alter any locked
prediction record. The verified October 7 game result and its deterministic
grades remain historical truth and must not be rolled back.

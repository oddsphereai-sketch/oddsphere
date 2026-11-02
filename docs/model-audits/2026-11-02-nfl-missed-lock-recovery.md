# NFL Eagles–Commanders missed-lock recovery

Starting production base: `84e2f5a9b7e33f64693c9953146123b979f003f2`.
Task branch: `codex/nfl-missed-lock-recovery-20261102`.

## Owner direction and evidence

On November 2 Daniel Mengel explicitly directed recovery of the existing
Eagles–Commanders prediction and repair of the missed lock. Week 8 has thirteen
completed games, but production has only twelve tracked games / thirty-six markets.
Provider game `1392335` has no game row or prediction records. Both team rows exist.

The attempted 7:21 and 7:36 p.m. ET locks failed with
`forecast_winner_score_disagreement`: expected home margin −0.040872215829566017
versus home win probability 0.5046474547165343. The empty 7:51 p.m. final-slot
observation arrived 31.6316 minutes after the 7:20 cutoff, outside the twenty-minute
window. It has no evaluated decisions and cannot truthfully become an on-time lock.

Failed evidence: `1d7a6194-4f9e-49d5-84a8-8e8220c700c9`, hash
`6d7b1539b4171348b330f51fdedfbd4887caacad37fad1ec669d598e6da293fa`.

The deterministic source is the latest stored publication-enabled complete
decision before the original cutoff: `cbf096d7-ecc8-4832-b5f7-92d76f56cf51`,
captured `2026-11-01T23:06:36.644Z`, hash
`12cc72a851d4e0fb17e8cd15f06839e2fb068992ae4c5d2bfff2179926295213`.
No earlier preferred pick or later observation is substituted.

| Market | Original prediction | Price / book | Original grade | Final result |
| --- | --- | --- | --- | --- |
| Moneyline | WSH | −260 FanDuel | No Play | Win |
| Spread | PHI +6 | −108 BetMGM | Best Angle | Loss |
| Total | Over 40.5 | −105 FanDuel | No Play | Loss |

Original model47 / calibration46 / decision55 relative-market-innovation identifiers
and market-specific head identifiers remain authoritative. This historical source
is not relabeled as today's model. No projection, probability, grade, price or
stake is calculated by the recovery. The source decision tuples retain their
original `unlocked` stage and null `lockedAt` inside the appended record.

## Recovery contract

Recovery release: `nfl_published_pregame_tracking_recovery_2026_11_02_r1`.
The existing `writeOfficialTrackingFromPayloads` insertion path gains an explicit
operator-only receipt. Normal cron calls and T-60 eligibility are unchanged.
The incident operator holds `prediction_pipeline:nfl`, proves both exact hashes,
rejects any existing partial/full locked decision across all releases, and appends
all three original decisions together. The actual recovery time is the new
tracking record's freeze time, never a fabricated pregame lock. The original
capture clock, empty failed-slot hash, owner instruction and `onTimeT60Lock:false`
are retained in `published_pregame_recovery`; source is
`nfl_published_pregame_recovery`. Original evidence and member snapshots stay intact.

Existing game rows are SELECT-only in the recovery path. If absent, the sole
writer inserts the exact missing game using the two existing team identities;
it cannot upsert stale pregame status over an existing final. The usual exact-ID
score ingest and pure grading services then settle the records. Repeated identical
recovery is a no-op; any different/partial prior record stops the operation.

This adds one original historical Best Angle and two original No Plays, not a new
grade-policy promotion. Existing nine actionables remain unchanged; the historical
tracked actionable denominator gains the omitted losing Best Angle. There are zero
prospective promotions, demotions, forecast changes, additional schedules or writers.
The expected Week 8 public denominators become thirteen games / thirty-nine markets:
Moneyline 11–2, Spread 7–6, Total 5–8. These totals span historical releases and must
not be called current-release performance.

## Prospective lock repair and verification

The starting production base already contains writer104 / collector30's
source-qualified repair: a constrained coherent-law correction preserves inferred
conditional ML/Spread probabilities while reconciling the mean, and failed attempts
stay append-only unlocked attempts so the unique successful final slot remains
available for retries inside the original window. Existing locks, including partial
ones, take precedence. No post-deadline or started-game lock is generated.
Do not reimplement this model under another identifier or loosen the strict validator.

Required proof: the new recovery test, joint-mean and T-60 retry tests, focused NFL
suite, full `verify:model-change`, TypeScript, build, clean fresh-main integration,
protected PR and exact production-tree verification. Before apply, run the incident
operator without `--apply`; after merge, run from the clean verified commit, compare
original evidence hashes, verify all three settled rows and public denominators,
refresh the existing tracking snapshot/cache, and verify the deployed leased writer
and member snapshot. Preserve valid locked rows on any later release.

Open PR921 changes prospective grades and shares the writer, package scripts and
registry. Integrate latest production main and preserve its changes before either
publication; do not replace its forecast or historical-card continuity work.

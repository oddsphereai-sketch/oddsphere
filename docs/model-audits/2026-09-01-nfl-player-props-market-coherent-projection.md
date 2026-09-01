# NFL Player Props Market-Coherent Projection

Date: 2026-09-01  
Status: production candidate; no provider, cron, writer, or database mutation was used for this evaluation.

## Defect and frozen rule

The active player-props probability is already an explicit market-residual probability: it starts from a target-book-excluded no-vig benchmark and applies the qualified independent-model residual at its versioned weight. The member-facing projection, however, continued to display the uncalibrated independent point estimate for receiving yards, receptions, and rushing yards. That allowed a card to show a projection dramatically below its posted line while its displayed probability was much closer to the mature market. The two published prediction surfaces did not describe the same distribution.

The candidate keeps the independent point estimate as versioned evidence, leaves the final probability and exact-price grade calculation unchanged, and publishes the point on the existing empirical residual distribution whose Over probability equals the final market-calibrated Over probability. Over and Under therefore share one projection and complementary probabilities. Quarterback passing yards retains its separately qualified 90% current-market / 10% recent-role projection repair.

The anytime-touchdown ladder is no longer permanently unreachable. Lean or Best Angle requires at least one current Pinnacle, Circa, or Bookmaker reference in addition to the existing independent-book, role, probability-edge, and exact offered-price EV gates. DraftKings and FanDuel cannot label each other as sharp. Retail-only evidence remains capped at Watchlist. A missing sharp reference never Holds or suppresses a completed read.

## Frozen Week 1 board

Inputs:

- exact offer board SHA-256 `32528c7cbecdcc50ab43975f304820d1fa8e1e56e9d6948a03ce6dd1d8cfe4e4`
- incumbent runtime board SHA-256 `bb51cb012fb1a52239ff53e8e705cb2228258c3a170b3d2b662e43ab808c5a94`
- 1,040 decisions: 4 Best Angles / 23 Leans / 80 Watchlists / 876 No Plays / 57 Held; 27 actionable

Current exact prop coverage contains DraftKings and FanDuel only for the five supplied families. It contains zero Pinnacle, Circa, or Bookmaker prop pairs. The candidate therefore changes zero probabilities, sides, grades, stakes, prices, locks, or tracking rows on this board. Touchdown remains 34 Watchlists / 205 No Plays / 23 Held, with zero action grades until a real sharp reference is supplied.

The projection correction is material and directionally balanced:

| Market | Rows | Independent median | Published coherent median | Median line | Published range |
| --- | ---: | ---: | ---: | ---: | ---: |
| Receiving yards | 139 | 31.01 | 43.79 | 42.5 | 15.73–90.49 |
| Receptions | 93 | 2.89 | 3.79 | 3.5 | 1.73–7.02 |
| Rushing yards | 96 | 20.81 | 38.83 | 39.5 | 9.33–83.22 |

Examples of repaired coherence include Ladd McConkey receiving yards moving from a raw 15.93-yard display to 43.91 at a 55.5 line while retaining the same 33.97% Over probability, and George Pickens receptions moving from 2.38 to 4.41 at 5.5 while retaining the same 31.63% Over probability. These are not promotions or copied market lines; they are the point estimates implied by the already-published calibrated probabilities.

Passing attempts, completions, and rushing attempts remain absent because neither active provider supplies safely classified current offers. Generic unnamed `player_prop` rows are not guessed into a category.

## Authority, load, and rollback

The existing `nfl-forward-evidence` endpoint remains the sole writer under `prediction_pipeline:nfl`. Provider calls, database reads and writes, tables, schedules, collection limits, settlement, T-60 freezes, and immutable tracking are unchanged. The change adds no quota and no reader-side grade override.

Rollback triggers are a projection that does not invert to its final probability within empirical-distribution resolution, noncomplementary Over/Under probabilities, any unexpected grade or stake change on the frozen retail-only board, a touchdown action without a named sharp reference, mixed release identifiers, writer/reader failure, or tuple incoherence.

# CBB r7: basketball mechanism interactions (private)

Declared after r6's four fixed structural tests finished. R6's selected season-end
prior candidate did not earn replacement: on the already-opened 2025 diagnostic,
19 winner corrections versus 26 harms, margin MAE 9.2534 versus 9.2789, total MAE
13.6406 versus 13.6378. R2 remains frozen and is the comparator for r7.

R3 added shooting profiles mainly as linear sums and differences. R7 asks whether
the *interaction* among those inputs is useful: shooting percentages and shot
mix determine points per attempt; turnovers remove possessions; offensive
rebounds recover missed shots; free-throw rate and accuracy affect scoring.

Use a bounded accounting feature, not an automatic score adjustment:

`PPP = (1 - turnover_rate) * (2*eFG + FTA/FGA*FT%) /
       (1 - OREB%*(1 - FG%) + 0.475*FTA/FGA)`.

This follows the same approximate possession accounting already used in the
dataset. It is not an exact generative model: team rebounds, and-ones and other
play-sequence dependencies are unobserved. Opponent shooting/rate matchup inputs
combine on the log-odds scale around fixed neutral reference values. FT accuracy
remains shooter-owned. New inputs are explicitly tested features, not assumed
true forecasts. Existing profiles retain their prior/current-season shrinkage.

Also test expected pace-control gap, absolute projected margin, and smooth
closeness/free-throw interactions. No actual overtime indicator, actual current
pace, current box score or future result is a predictive input.

Exactly six residual heads: penalties 10/100/1000 crossed with squared/Huber loss;
same trainer and training guards as r3. Fit 2023, select 2024 against R2: both MAEs
must improve, Brier cannot worsen, winner accuracy may fall at most 0.5pp. Rank by
mean normalized MAE. Refit the selected head on 2023+2024 and evaluate only that
head on 2025 (already opened, not pristine holdout). Report actual opening-line
ML/spread/total W/L/push and harmful changes, not just score error.

No market input is used to train the independent score. No provider calls,
production writes, live shadow, new refresh process, deployment, grades or stakes.
Both team scores and all market probabilities remain derived from one margin and
one total; a learned correction can change the predicted winner.

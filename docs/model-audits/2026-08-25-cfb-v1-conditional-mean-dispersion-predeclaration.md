# CFB v1 conditional-mean dispersion correction

Date: 2026-08-25

Status: frozen before the qualifying rerun

The r1 and r2 experiments exposed a problem in the original anti-clustering
gate, not an excuse to ignore clustering. The gate compared dispersion of a
conditional expected score across games with dispersion of realized outcomes.
Realized score variance includes irreducible within-game noise, so a calibrated
mean forecast should not reproduce all of it. The market itself confirms the
distinction: in 2024/2025, archived market totals had standard deviations of
7.16/6.10 while realized totals had standard deviations of 16.79/16.29.

Before rerunning the selected r1 elastic-net score architecture, the
scientifically appropriate anti-clustering gate is frozen as follows:

- expected margin SD must be at least 75% of archived market spread-implied
  margin SD in 2023, 2024, and 2025;
- expected total SD must be at least 75% of archived market-total SD in each
  season;
- combined expected team-score SD must be at least 75% of market-implied
  team-score SD in each season;
- the joint residual distribution must retain 70%-85% empirical coverage for
  its nominal 80% total interval in each confirmation season;
- all previously frozen accuracy, calibration, bias, stability, and source
  integrity gates remain unchanged.

This gate compares forecast means with another forecast mean, while interval
coverage tests the full outcome distribution. It does not change a prediction,
coefficient, calibration, display value, or grade threshold after observing an
outcome.

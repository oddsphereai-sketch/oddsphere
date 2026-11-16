# NFL player props: passing touchdowns result

Date: 2026-10-15

Verdict: keep the football-structured Poisson tree as the passing-TD research foundation, but do not add Passing TD to the live product yet.

## What improved

The predeclared Poisson tree won model selection on 2025 and improved every point-estimate gate on 2026 Weeks 2-5 without using market inputs.

| 2026 Weeks 2-5, 132 QB-games | Opportunity foundation | Poisson GLM | Poisson tree |
|---|---:|---:|---:|
| MAE | 0.9051 | 0.9053 | **0.8822** |
| RMSE | 1.1252 | 1.1129 | **1.0996** |
| Mean Poisson deviance | 1.0709 | 1.0547 | **1.0468** |
| Mean Poisson log score | 1.4641 | 1.4560 | **1.4521** |
| Average threshold Brier | 0.15235 | 0.15093 | **0.14851** |

The tree improved Brier score at all four tested thresholds (over 0.5, 1.5, 2.5, and 3.5 passing touchdowns). Its mean projection was 1.364 versus an observed mean of 1.424, so it was mildly low but not grossly miscalibrated.

The model used 58 pregame, non-market features spanning quarterback workload/efficiency, team and opponent pass volume, pass tendency, red-zone passing opportunity/efficiency, pressure/sack context, NGS/PFR quarterback signals, depth, home/roof, wind, and temperature. Model selection used 578 QB-games from 2025; fitting used 4,399 rows from 2017-2024 before the selected architecture was refit through 2025.

## How strong is the result?

The direction is encouraging, but not statistically settled. A 2,000-draw paired bootstrap over 63 current-season games produced candidate-minus-foundation intervals of:

| Metric delta | Mean | 95% interval | Probability candidate improves |
|---|---:|---:|---:|
| MAE | -0.0224 | [-0.0659, +0.0225] | 84.4% |
| Mean Poisson deviance | -0.0236 | [-0.1285, +0.1083] | 68.1% |
| Average threshold Brier | -0.00380 | [-0.01211, +0.00529] | 81.3% |

All intervals cross zero. This is a better current-season point estimate, not proof of a durable edge.

The Poisson variance assumption was adequate in this sample: actual variance was 1.376, mean predicted Poisson variance was 1.364, and residual variance divided by predicted mean was 0.89. A negative-binomial repair was therefore not justified after seeing results.

## OddSphere archived-game slice

The exact two games represented in OddSphere's Week 5 private archive contain only four quarterbacks. On that tiny slice, the opportunity foundation beat both learned models.

| Model | MAE | Mean Poisson deviance | Average threshold Brier |
|---|---:|---:|---:|
| Opportunity foundation | **0.5691** | **0.2483** | **0.09595** |
| Poisson GLM | 0.5893 | 0.2751 | 0.10009 |
| Poisson tree | 0.7368 | 0.4255 | 0.11435 |

The tree projected Josh Allen 1.58 (actual 1), Matthew Stafford 1.87 (actual 3), Dak Prescott 1.66 (actual 1), and Jalon Daniels 0.42 (actual 1). The Jalon Daniels undercall is the clearest cold-start/young-quarterback failure to investigate before runtime use.

## Why this architecture is appropriate

The external research supports the modeling choices rather than a market blend:

- A published study found a Poisson distribution to be a reasonable description of Tom Brady's game-level passing-touchdown counts, supporting Poisson as a baseline rather than a Gaussian point model. This does not prove universal Poisson behavior, so the current-season dispersion audit remains necessary. [Journal of Student Research paper](https://www.jsr.org/index.php/path/article/download/1724/1189/8698)
- nflfastR's published modeling work uses football-state variables such as field position, down/distance, time, score, roof, and pass context, uses nonlinear boosted trees, and validates calibration with seasons held out. That supports the red-zone/state decomposition and year-held-out selection used here. [nflfastR model documentation](https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd)
- NFL Next Gen Stats confirms that tracking-derived formation, route-detection, and completion-probability signals exist, but OddSphere's retained public NGS feed does not contain the complete raw tracking layer. The tournament therefore used only retained licensed/public features. [NFL Football Operations: Next Gen Stats](https://operations.nfl.com/gameday/technology/nfl-next-gen-stats)
- Research on NFL play-call prediction shows that play choice is a predictable state-dependent process, supporting explicit pass-tendency and red-zone opportunity inputs rather than treating touchdown rate as a quarterback-only constant. [Play-call prediction study](https://arxiv.org/abs/2003.10791)

## Product decision

The selected model clears the predeclared point-estimate accuracy gate but is not authorized for production because:

1. OddSphere retained no release-pure Passing TD offers or prices in the Week 5 private archive or market observer;
2. economic value, exact-line record, and market-reader behavior therefore cannot be measured;
3. the current-season bootstrap intervals cross zero;
4. the four-quarterback archived slice favored the foundation;
5. Passing TD is not in the current production family set, so adding it would require a new versioned model/calibration/decision path and prospective exact-offer capture.

This is still a concrete result: the Poisson tree becomes the research foundation for Passing TD, while the immediate next work is the interception family and a separate proposal to retain exact offers for currently research-only markets. No production model, grade, stake, writer, reader, or public page changed.

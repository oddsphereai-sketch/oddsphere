# OddSphere Sharp Analyst Research Pack

Generated: 2026-06-29T18:46:40.762Z
Sport: MLB
Rows loaded: 950
Settled rows: 791

## Sharp Analyst Principles
- A good prediction is not automatically a good bet.
- Price and juice matter; a high probability at bad juice may be a pass.
- Judge edge against no-vig market implied probability where possible.
- Calibration matters more than raw accuracy.
- CLV is useful only when computed from reliable close/no-vig close data.
- Mixed market does not automatically mean Caution.
- Market resistance does not automatically mean No Play.
- Missing FI market/split signal is low materiality by default and does not downgrade FI by itself.
- Missing historical source fields are replay limitations, not live data failures.
- Public consensus is context, not truth.
- Sharp-book signal is meaningful only if fresh, mapped correctly, and material.
- Promote only when edge, price, data quality, and market context justify it.
- Downgrade only when risk materially hurts EV or confidence.
- Preserve profitable historical cohorts unless a high-materiality issue exists.

## Market Snapshots
### moneyline
Sample: {"count":324,"settled":303,"wins":171,"losses":132,"pushes":0,"voids":0,"pending":21,"unknown":0,"units":-3.6755,"roi":-0.0121,"winRate":0.5644,"avgModelProbabilityPct":58.7434,"avgEdgePct":5.0898,"avgPrice":-62.1877,"brier":0.246024,"logLoss":0.684492}
Grade performance: {"Best Angle":{"count":102,"settled":97,"wins":53,"losses":44,"pushes":0,"voids":0,"pending":5,"unknown":0,"units":-6.3706,"roi":-0.0657,"winRate":0.5464,"avgModelProbabilityPct":64.8237,"avgEdgePct":9.5161,"avgPrice":-126.9505,"brier":0.248083,"logLoss":0.688466},"Lean":{"count":52,"settled":48,"wins":22,"losses":26,"pushes":0,"voids":0,"pending":4,"unknown":0,"units":-6.3552,"roi":-0.1324,"winRate":0.4583,"avgModelProbabilityPct":53.4331,"avgEdgePct":6.2463,"avgPrice":29.1277,"brier":0.256223,"logLoss":0.705886},"No Play":{"count":137,"settled":128,"wins":77,"losses":51,"pushes":0,"voids":0,"pending":9,"unknown":0,"units":5.4255,"roi":0.0424,"winRate":0.6016,"avgModelProbabilityPct":57.1322,"avgEdgePct":1.8369,"avgPrice":-107.4231,"brier":0.243298,"logLoss":0.679367},"Watchlist":{"count":33,"settled":30,"wins":19,"losses":11,"pushes":0,"voids":0,"pending":3,"unknown":0,"units":3.6248,"roi":0.1208,"winRate":0.6333,"avgModelProbabilityPct":55.0063,"avgEdgePct":1.3264,"avgPrice":200.0645,"brier":0.234679,"logLoss":0.659277}}
Direction performance: {"dog":{"count":78,"settled":76,"wins":40,"losses":36,"pushes":0,"voids":0,"pending":2,"unknown":0,"units":-1.01,"roi":-0.0133,"winRate":0.5263,"avgModelProbabilityPct":53.2674,"avgEdgePct":7.1818,"avgPrice":271.0794,"brier":0.240262,"logLoss":0.67146},"favorite":{"count":246,"settled":227,"wins":131,"losses":96,"pushes":0,"voids":0,"pending":19,"unknown":0,"units":-2.6655,"roi":-0.0117,"winRate":0.5771,"avgModelProbabilityPct":60.4797,"avgEdgePct":4.5645,"avgPrice":-147.5366,"brier":0.247953,"logLoss":0.688854}}
Support assessment: {"sample":{"count":324,"settled":303,"wins":171,"losses":132,"pushes":0,"voids":0,"pending":21,"unknown":0,"units":-3.6755,"roi":-0.0121,"winRate":0.5644,"avgModelProbabilityPct":58.7434,"avgEdgePct":5.0898,"avgPrice":-62.1877,"brier":0.246024,"logLoss":0.684492},"supportsProtectingLean":false,"bestAngleNeedsScrutiny":false,"watchlistPromotionPossible":true,"cautionPromotionPossible":false,"missingSourceOftenReplayLimitation":{"historical_source_not_persisted":{"count":34,"settled":33,"wins":23,"losses":10,"pushes":0,"voids":0,"pending":1,"unknown":0,"units":0.3459,"roi":0.0105,"winRate":0.697,"avgModelProbabilityPct":59.1825,"avgEdgePct":8.4184,"avgPrice":-120.5263,"brier":0.210665,"logLoss":0.609973},"source_context_present_or_partial":{"count":290,"settled":270,"wins":148,"losses":122,"pushes":0,"voids":0,"pending":20,"unknown":0,"units":-4.0214,"roi":-0.0149,"winRate":0.5481,"avgModelProbabilityPct":58.6919,"avgEdgePct":4.9828,"avgPrice":-58.3655,"brier":0.250346,"logLoss":0.693599}},"marketReadPerformance":{"historical_market_read_not_persisted":{"count":35,"settled":34,"wins":24,"losses":10,"pushes":0,"voids":0,"pending":1,"unknown":0,"units":1.3859,"roi":0.0408,"winRate":0.7059,"avgModelProbabilityPct":59.0732,"avgEdgePct":8.4515,"avgPrice":-109.3,"brier":0.21033,"logLoss":0.609425},"no_clear_signal":{"count":289,"settled":269,"wins":147,"losses":122,"pushes":0,"voids":0,"pending":20,"unknown":0,"units":-5.0614,"roi":-0.0188,"winRate":0.5465,"avgModelProbabilityPct":58.7034,"avgEdgePct":4.9693,"avgPrice":-58.9273,"brier":0.250536,"logLoss":0.69398}},"sampleWarning":"use_as_directional_memory_not_hard_rule"}

### total
Sample: {"count":324,"settled":295,"wins":152,"losses":143,"pushes":8,"voids":0,"pending":21,"unknown":0,"units":-11.2128,"roi":-0.038,"winRate":0.5153,"avgModelProbabilityPct":55.4551,"avgEdgePct":5.2972,"avgPrice":-84.3539,"brier":0.250251,"logLoss":0.693417}
Grade performance: {"Best Angle":{"count":91,"settled":84,"wins":43,"losses":41,"pushes":3,"voids":0,"pending":4,"unknown":0,"units":-3.1068,"roi":-0.037,"winRate":0.5119,"avgModelProbabilityPct":60.8877,"avgEdgePct":10.2423,"avgPrice":-74.7176,"brier":0.256744,"logLoss":0.706317},"Lean":{"count":65,"settled":59,"wins":28,"losses":31,"pushes":1,"voids":0,"pending":5,"unknown":0,"units":-8.0941,"roi":-0.1372,"winRate":0.4746,"avgModelProbabilityPct":53.644,"avgEdgePct":4.053,"avgPrice":-71.75,"brier":0.252418,"logLoss":0.697959},"No Play":{"count":115,"settled":102,"wins":50,"losses":52,"pushes":3,"voids":0,"pending":10,"unknown":0,"units":-7.0727,"roi":-0.0693,"winRate":0.4902,"avgModelProbabilityPct":53.6369,"avgEdgePct":3.5091,"avgPrice":-90.307,"brier":0.248818,"logLoss":0.690421},"Watchlist":{"count":53,"settled":50,"wins":31,"losses":19,"pushes":1,"voids":0,"pending":2,"unknown":0,"units":7.0608,"roi":0.1412,"winRate":0.62,"avgModelProbabilityPct":52.2938,"avgEdgePct":2.1969,"avgPrice":-102.6531,"brier":0.239709,"logLoss":0.672499}}
Direction performance: {"over":{"count":143,"settled":130,"wins":65,"losses":65,"pushes":0,"voids":0,"pending":13,"unknown":0,"units":-6.8328,"roi":-0.0526,"winRate":0.5,"avgModelProbabilityPct":55.5944,"avgEdgePct":4.8611,"avgPrice":-78.1232,"brier":0.251297,"logLoss":0.695254},"under":{"count":181,"settled":165,"wins":87,"losses":78,"pushes":8,"voids":0,"pending":8,"unknown":0,"units":-4.38,"roi":-0.0265,"winRate":0.5273,"avgModelProbabilityPct":55.345,"avgEdgePct":5.6196,"avgPrice":-89.4118,"brier":0.249426,"logLoss":0.69197}}
Support assessment: {"sample":{"count":324,"settled":295,"wins":152,"losses":143,"pushes":8,"voids":0,"pending":21,"unknown":0,"units":-11.2128,"roi":-0.038,"winRate":0.5153,"avgModelProbabilityPct":55.4551,"avgEdgePct":5.2972,"avgPrice":-84.3539,"brier":0.250251,"logLoss":0.693417},"supportsProtectingLean":false,"bestAngleNeedsScrutiny":false,"watchlistPromotionPossible":true,"cautionPromotionPossible":false,"missingSourceOftenReplayLimitation":{"historical_source_not_persisted":{"count":30,"settled":29,"wins":15,"losses":14,"pushes":0,"voids":0,"pending":1,"unknown":0,"units":-6.0123,"roi":-0.2073,"winRate":0.5172,"avgModelProbabilityPct":58.1459,"avgEdgePct":7.9382,"avgPrice":-99.2667,"brier":0.248063,"logLoss":0.686498},"source_context_present_or_partial":{"count":294,"settled":266,"wins":137,"losses":129,"pushes":8,"voids":0,"pending":20,"unknown":0,"units":-5.2005,"roi":-0.0196,"winRate":0.515,"avgModelProbabilityPct":55.1805,"avgEdgePct":5.2503,"avgPrice":-83.5904,"brier":0.250489,"logLoss":0.694172}},"marketReadPerformance":{"historical_market_read_not_persisted":{"count":31,"settled":30,"wins":15,"losses":15,"pushes":0,"voids":0,"pending":1,"unknown":0,"units":-7.0123,"roi":-0.2337,"winRate":0.5,"avgModelProbabilityPct":58.3383,"avgEdgePct":9.22,"avgPrice":-86.4375,"brier":0.253495,"logLoss":0.697772},"no_clear_signal":{"count":293,"settled":265,"wins":137,"losses":128,"pushes":8,"voids":0,"pending":20,"unknown":0,"units":-4.2005,"roi":-0.0159,"winRate":0.517,"avgModelProbabilityPct":55.1501,"avgEdgePct":5.2134,"avgPrice":-84.2397,"brier":0.249883,"logLoss":0.692924}},"sampleWarning":"use_as_directional_memory_not_hard_rule"}

### first_inning
Sample: {"count":302,"settled":193,"wins":113,"losses":80,"pushes":0,"voids":99,"pending":10,"unknown":0,"units":-21.8852,"roi":-0.1134,"winRate":0.5855,"avgModelProbabilityPct":54.5662,"avgEdgePct":0.0335,"avgPrice":-114.1846,"brier":0.245454,"logLoss":0.684043}
Grade performance: {"Lean":{"count":31,"settled":29,"wins":19,"losses":10,"pushes":0,"voids":0,"pending":2,"unknown":0,"units":1.0412,"roi":0.0359,"winRate":0.6552,"avgModelProbabilityPct":60.7419,"avgEdgePct":0.073,"avgPrice":-131.9524,"brier":0.228752,"logLoss":0.650128},"No Play":{"count":266,"settled":159,"wins":92,"losses":67,"pushes":0,"voids":99,"pending":8,"unknown":0,"units":-21.1386,"roi":-0.1329,"winRate":0.5786,"avgModelProbabilityPct":53.7632,"avgEdgePct":0.0253,"avgPrice":-108.1635,"brier":0.247531,"logLoss":0.688266},"Watchlist":{"count":5,"settled":5,"wins":2,"losses":3,"pushes":0,"voids":0,"pending":0,"unknown":0,"units":-1.7878,"roi":-0.3576,"winRate":0.4,"avgModelProbabilityPct":59,"avgEdgePct":0.0078,"avgPrice":-164.8,"brier":0.27626,"logLoss":0.746432}}
Direction performance: {"nrfi":{"count":125,"settled":121,"wins":69,"losses":52,"pushes":0,"voids":0,"pending":4,"unknown":0,"units":-19.4155,"roi":-0.1605,"winRate":0.5702,"avgModelProbabilityPct":56.1856,"avgEdgePct":0.0487,"avgPrice":-112.8955,"brier":0.245144,"logLoss":0.683349},"unknown":{"count":97,"settled":0,"wins":0,"losses":0,"pushes":0,"voids":97,"pending":0,"unknown":0,"units":0,"roi":null,"winRate":null,"avgModelProbabilityPct":52,"avgEdgePct":null,"avgPrice":null,"brier":null,"logLoss":null},"yrfi":{"count":80,"settled":72,"wins":44,"losses":28,"pushes":0,"voids":2,"pending":6,"unknown":0,"units":-2.4697,"roi":-0.0343,"winRate":0.6111,"avgModelProbabilityPct":55.1475,"avgEdgePct":0.0104,"avgPrice":-115.5556,"brier":0.245974,"logLoss":0.685208}}
Support assessment: {"sample":{"count":302,"settled":193,"wins":113,"losses":80,"pushes":0,"voids":99,"pending":10,"unknown":0,"units":-21.8852,"roi":-0.1134,"winRate":0.5855,"avgModelProbabilityPct":54.5662,"avgEdgePct":0.0335,"avgPrice":-114.1846,"brier":0.245454,"logLoss":0.684043},"supportsProtectingLean":true,"bestAngleNeedsScrutiny":true,"watchlistPromotionPossible":false,"cautionPromotionPossible":false,"missingSourceOftenReplayLimitation":{"historical_source_not_persisted":{"count":302,"settled":193,"wins":113,"losses":80,"pushes":0,"voids":99,"pending":10,"unknown":0,"units":-21.8852,"roi":-0.1134,"winRate":0.5855,"avgModelProbabilityPct":54.5662,"avgEdgePct":0.0335,"avgPrice":-114.1846,"brier":0.245454,"logLoss":0.684043}},"marketReadPerformance":{"historical_market_read_not_persisted":{"count":302,"settled":193,"wins":113,"losses":80,"pushes":0,"voids":99,"pending":10,"unknown":0,"units":-21.8852,"roi":-0.1134,"winRate":0.5855,"avgModelProbabilityPct":54.5662,"avgEdgePct":0.0335,"avgPrice":-114.1846,"brier":0.245454,"logLoss":0.684043}},"sampleWarning":"use_as_directional_memory_not_hard_rule"}

## Candidate Logic
{
  "promotions": [
    "Watchlist -> Lean when model edge clears market-specific historical threshold, price is playable, data is clean, and market resistance is non-material or historically noisy.",
    "Caution -> Watchlist/Lean only when caution source is low-materiality and historical cohort performance supports actionability.",
    "No Play -> Watchlist only for clear under-graded winners pattern; never jump straight to live Best Angle.",
    "FI Watchlist -> Lean when price + edge + starter freshness support actionability; missing FI split source alone should not block."
  ],
  "downgrades": [
    "Best Angle -> Lean/Watchlist when heavy juice, thin edge, critical data warning, or material market resistance historically damages ROI.",
    "Lean -> Watchlist/Caution only when risk materially hurts EV/confidence, not because the card is imperfect.",
    "Historical source-not-persisted is a non-escalating replay limitation.",
    "Market resistance is a downgrade reason only when material relative to edge, price, and historical cohort."
  ]
}

## Playbooks
{
  "moneyline": {
    "focus": [
      "price/juice discipline",
      "favorite/dog behavior",
      "heavy favorite risk",
      "model calibration",
      "edge vs implied",
      "market resistance",
      "sharp-source materiality",
      "Watchlist promotion",
      "Best Angle caps"
    ],
    "cohortNotes": {
      "gradePerformance": {
        "Best Angle": {
          "count": 102,
          "settled": 97,
          "wins": 53,
          "losses": 44,
          "pushes": 0,
          "voids": 0,
          "pending": 5,
          "unknown": 0,
          "units": -6.3706,
          "roi": -0.0657,
          "winRate": 0.5464,
          "avgModelProbabilityPct": 64.8237,
          "avgEdgePct": 9.5161,
          "avgPrice": -126.9505,
          "brier": 0.248083,
          "logLoss": 0.688466
        },
        "Lean": {
          "count": 52,
          "settled": 48,
          "wins": 22,
          "losses": 26,
          "pushes": 0,
          "voids": 0,
          "pending": 4,
          "unknown": 0,
          "units": -6.3552,
          "roi": -0.1324,
          "winRate": 0.4583,
          "avgModelProbabilityPct": 53.4331,
          "avgEdgePct": 6.2463,
          "avgPrice": 29.1277,
          "brier": 0.256223,
          "logLoss": 0.705886
        },
        "No Play": {
          "count": 137,
          "settled": 128,
          "wins": 77,
          "losses": 51,
          "pushes": 0,
          "voids": 0,
          "pending": 9,
          "unknown": 0,
          "units": 5.4255,
          "roi": 0.0424,
          "winRate": 0.6016,
          "avgModelProbabilityPct": 57.1322,
          "avgEdgePct": 1.8369,
          "avgPrice": -107.4231,
          "brier": 0.243298,
          "logLoss": 0.679367
        },
        "Watchlist": {
          "count": 33,
          "settled": 30,
          "wins": 19,
          "losses": 11,
          "pushes": 0,
          "voids": 0,
          "pending": 3,
          "unknown": 0,
          "units": 3.6248,
          "roi": 0.1208,
          "winRate": 0.6333,
          "avgModelProbabilityPct": 55.0063,
          "avgEdgePct": 1.3264,
          "avgPrice": 200.0645,
          "brier": 0.234679,
          "logLoss": 0.659277
        }
      },
      "favoriteDog": {
        "dog": {
          "count": 78,
          "settled": 76,
          "wins": 40,
          "losses": 36,
          "pushes": 0,
          "voids": 0,
          "pending": 2,
          "unknown": 0,
          "units": -1.01,
          "roi": -0.0133,
          "winRate": 0.5263,
          "avgModelProbabilityPct": 53.2674,
          "avgEdgePct": 7.1818,
          "avgPrice": 271.0794,
          "brier": 0.240262,
          "logLoss": 0.67146
        },
        "favorite": {
          "count": 246,
          "settled": 227,
          "wins": 131,
          "losses": 96,
          "pushes": 0,
          "voids": 0,
          "pending": 19,
          "unknown": 0,
          "units": -2.6655,
          "roi": -0.0117,
          "winRate": 0.5771,
          "avgModelProbabilityPct": 60.4797,
          "avgEdgePct": 4.5645,
          "avgPrice": -147.5366,
          "brier": 0.247953,
          "logLoss": 0.688854
        }
      },
      "priceBands": {
        "dog_101_150": {
          "count": 52,
          "settled": 51,
          "wins": 26,
          "losses": 25,
          "pushes": 0,
          "voids": 0,
          "pending": 1,
          "unknown": 0,
          "units": 4.99,
          "roi": 0.0978,
          "winRate": 0.5098,
          "avgModelProbabilityPct": 53.5112,
          "avgEdgePct": 7.4542,
          "avgPrice": 116.8846,
          "brier": 0.246549,
          "logLoss": 0.685192
        },
        "dog_150_plus": {
          "count": 1,
          "settled": 1,
          "wins": 0,
          "losses": 1,
          "pushes": 0,
          "voids": 0,
          "pending": 0,
          "unknown": 0,
          "units": -1,
          "roi": -1,
          "winRate": 0,
          "avgModelProbabilityPct": 11.8712,
          "avgEdgePct": 10,
          "avgPrice": 10000,
          "brier": 0.014093,
          "logLoss": 0.126371
        },
        "heavy_juice_200_plus": {
          "count": 14,
          "settled": 13,
          "wins": 7,
          "losses": 6,
          "pushes": 0,
          "voids": 0,
          "pending": 1,
          "unknown": 0,
          "units": -3.0148,
          "roi": -0.2319,
          "winRate": 0.5385,
          "avgModelProbabilityPct": 70.0521,
          "avgEdgePct": 3.4434,
          "avgPrice": -271.2143,
          "brier": 0.252708,
          "logLoss": 0.701005
        },
        "juice_111_130": {
          "count": 64,
          "settled": 59,
          "wins": 31,
          "losses": 28,
          "pushes": 0,
          "voids": 0,
          "pending": 5,
          "unknown": 0,
          "units": -2.3604,
          "roi": -0.04,
          "winRate": 0.5254,
          "avgModelProbabilityPct": 57.7081,
          "avgEdgePct": 5.3864,
          "avgPrice": -120.4688,
          "brier": 0.249093,
          "logLoss": 0.690034
        },
        "juice_131_150": {
          "count": 71,
          "settled": 64,
          "wins": 41,
          "losses": 23,
          "pushes": 0,
          "voids": 0,
          "pending": 7,
          "unknown": 0,
          "units": 6.1206,
          "roi": 0.0956,
          "winRate": 0.6406,
          "avgModelProbabilityPct": 59.8443,
          "avgEdgePct": 4.1747,
          "avgPrice": -141.1127,
          "brier": 0.241872,
          "logLoss": 0.67648
        },
        "juice_151_175": {
          "count": 43,
          "settled": 41,
          "wins": 23,
          "losses": 18,
          "pushes": 0,
          "voids": 0,
          "pending": 2,
          "unknown": 0,
          "units": -3.8395,
          "roi": -0.0936,
          "winRate": 0.561,
          "avgModelProbabilityPct": 63.3599,
          "avgEdgePct": 4.1751,
          "avgPrice": -162.9535,
          "brier": 0.254872,
          "logLoss": 0.702565
        },
        "juice_176_200": {
          "count": 24,
          "settled": 23,
          "wins": 14,
          "losses": 9,
          "pushes": 0,
          "voids": 0,
          "pending": 1,
          "unknown": 0,
          "units": -1.6028,
          "roi": -0.0697,
          "winRate": 0.6087,
          "avgModelProbabilityPct": 65.5097,
          "avgEdgePct": 3.4433,
          "avgPrice": -190.1667,
          "brier": 0.239955,
          "logLoss": 0.673781
        },
        "missing_price": {
          "count": 15,
          "settled": 14,
          "wins": 9,
          "losses": 5,
          "pushes": 0,
          "voids": 0,
          "pending": 1,
          "unknown": 0,
          "units": -5,
          "roi": -0.3571,
          "winRate": 0.6429,
          "avgModelProbabilityPct": 54.5867,
          "avgEdgePct": null,
          "avgPrice": null,
          "brier": 0.239869,
          "logLoss": 0.672117
        },
        "near_even": {
          "count": 40,
          "settled": 37,
          "wins": 20,
          "losses": 17,
          "pushes": 0,
          "voids": 0,
          "pending": 3,
          "unknown": 0,
          "units": 2.0314,
          "roi": 0.0549,
          "winRate": 0.5405,
          "avgModelProbabilityPct": 54.9975,
          "avgEdgePct": 5.7618,
          "avgPrice": -54.925,
          "brier": 0.247806,
          "logLoss": 0.68914
        }
      }
    },
    "analystRules": [
      "Require real edge after price; do not promote a favorite simply because win probability is high.",
      "Treat heavy juice as an EV tax; cap Best Angle unless model edge and market support are both strong.",
      "Dog Watchlists can promote when edge is meaningful, price is playable, and data is clean.",
      "Market resistance matters most when edge is thin or price is expensive; resistance can be noise when historical cohort says similar setups win."
    ]
  },
  "total": {
    "focus": [
      "projection vs line",
      "edge size",
      "Over/Under direction",
      "line movement",
      "market resistance vs noise",
      "Watchlist promotion",
      "Best Angle caps"
    ],
    "cohortNotes": {
      "gradePerformance": {
        "Best Angle": {
          "count": 91,
          "settled": 84,
          "wins": 43,
          "losses": 41,
          "pushes": 3,
          "voids": 0,
          "pending": 4,
          "unknown": 0,
          "units": -3.1068,
          "roi": -0.037,
          "winRate": 0.5119,
          "avgModelProbabilityPct": 60.8877,
          "avgEdgePct": 10.2423,
          "avgPrice": -74.7176,
          "brier": 0.256744,
          "logLoss": 0.706317
        },
        "Lean": {
          "count": 65,
          "settled": 59,
          "wins": 28,
          "losses": 31,
          "pushes": 1,
          "voids": 0,
          "pending": 5,
          "unknown": 0,
          "units": -8.0941,
          "roi": -0.1372,
          "winRate": 0.4746,
          "avgModelProbabilityPct": 53.644,
          "avgEdgePct": 4.053,
          "avgPrice": -71.75,
          "brier": 0.252418,
          "logLoss": 0.697959
        },
        "No Play": {
          "count": 115,
          "settled": 102,
          "wins": 50,
          "losses": 52,
          "pushes": 3,
          "voids": 0,
          "pending": 10,
          "unknown": 0,
          "units": -7.0727,
          "roi": -0.0693,
          "winRate": 0.4902,
          "avgModelProbabilityPct": 53.6369,
          "avgEdgePct": 3.5091,
          "avgPrice": -90.307,
          "brier": 0.248818,
          "logLoss": 0.690421
        },
        "Watchlist": {
          "count": 53,
          "settled": 50,
          "wins": 31,
          "losses": 19,
          "pushes": 1,
          "voids": 0,
          "pending": 2,
          "unknown": 0,
          "units": 7.0608,
          "roi": 0.1412,
          "winRate": 0.62,
          "avgModelProbabilityPct": 52.2938,
          "avgEdgePct": 2.1969,
          "avgPrice": -102.6531,
          "brier": 0.239709,
          "logLoss": 0.672499
        }
      },
      "overUnder": {
        "over": {
          "count": 143,
          "settled": 130,
          "wins": 65,
          "losses": 65,
          "pushes": 0,
          "voids": 0,
          "pending": 13,
          "unknown": 0,
          "units": -6.8328,
          "roi": -0.0526,
          "winRate": 0.5,
          "avgModelProbabilityPct": 55.5944,
          "avgEdgePct": 4.8611,
          "avgPrice": -78.1232,
          "brier": 0.251297,
          "logLoss": 0.695254
        },
        "under": {
          "count": 181,
          "settled": 165,
          "wins": 87,
          "losses": 78,
          "pushes": 8,
          "voids": 0,
          "pending": 8,
          "unknown": 0,
          "units": -4.38,
          "roi": -0.0265,
          "winRate": 0.5273,
          "avgModelProbabilityPct": 55.345,
          "avgEdgePct": 5.6196,
          "avgPrice": -89.4118,
          "brier": 0.249426,
          "logLoss": 0.69197
        }
      },
      "marketReads": {
        "historical_market_read_not_persisted": {
          "count": 31,
          "settled": 30,
          "wins": 15,
          "losses": 15,
          "pushes": 0,
          "voids": 0,
          "pending": 1,
          "unknown": 0,
          "units": -7.0123,
          "roi": -0.2337,
          "winRate": 0.5,
          "avgModelProbabilityPct": 58.3383,
          "avgEdgePct": 9.22,
          "avgPrice": -86.4375,
          "brier": 0.253495,
          "logLoss": 0.697772
        },
        "no_clear_signal": {
          "count": 293,
          "settled": 265,
          "wins": 137,
          "losses": 128,
          "pushes": 8,
          "voids": 0,
          "pending": 20,
          "unknown": 0,
          "units": -4.2005,
          "roi": -0.0159,
          "winRate": 0.517,
          "avgModelProbabilityPct": 55.1501,
          "avgEdgePct": 5.2134,
          "avgPrice": -84.2397,
          "brier": 0.249883,
          "logLoss": 0.692924
        }
      }
    },
    "analystRules": [
      "A total needs a playable number and edge against that number, not just an Over/Under label.",
      "Do not downgrade Totals Lean just because market is mixed; ask whether the conflict is material to EV.",
      "Thin edge plus worse price or sharp resistance should cap promotion.",
      "Watchlist can promote when edge is large, price is reasonable, and there is no critical data warning."
    ]
  },
  "first_inning": {
    "focus": [
      "protect FI Lean cohort",
      "NRFI/YRFI split",
      "starter/top-order data",
      "missing FI splits low materiality",
      "edge/price/starter freshness",
      "Watchlist promotion"
    ],
    "cohortNotes": {
      "gradePerformance": {
        "Lean": {
          "count": 31,
          "settled": 29,
          "wins": 19,
          "losses": 10,
          "pushes": 0,
          "voids": 0,
          "pending": 2,
          "unknown": 0,
          "units": 1.0412,
          "roi": 0.0359,
          "winRate": 0.6552,
          "avgModelProbabilityPct": 60.7419,
          "avgEdgePct": 0.073,
          "avgPrice": -131.9524,
          "brier": 0.228752,
          "logLoss": 0.650128
        },
        "No Play": {
          "count": 266,
          "settled": 159,
          "wins": 92,
          "losses": 67,
          "pushes": 0,
          "voids": 99,
          "pending": 8,
          "unknown": 0,
          "units": -21.1386,
          "roi": -0.1329,
          "winRate": 0.5786,
          "avgModelProbabilityPct": 53.7632,
          "avgEdgePct": 0.0253,
          "avgPrice": -108.1635,
          "brier": 0.247531,
          "logLoss": 0.688266
        },
        "Watchlist": {
          "count": 5,
          "settled": 5,
          "wins": 2,
          "losses": 3,
          "pushes": 0,
          "voids": 0,
          "pending": 0,
          "unknown": 0,
          "units": -1.7878,
          "roi": -0.3576,
          "winRate": 0.4,
          "avgModelProbabilityPct": 59,
          "avgEdgePct": 0.0078,
          "avgPrice": -164.8,
          "brier": 0.27626,
          "logLoss": 0.746432
        }
      },
      "nrfiYrfi": {
        "nrfi": {
          "count": 125,
          "settled": 121,
          "wins": 69,
          "losses": 52,
          "pushes": 0,
          "voids": 0,
          "pending": 4,
          "unknown": 0,
          "units": -19.4155,
          "roi": -0.1605,
          "winRate": 0.5702,
          "avgModelProbabilityPct": 56.1856,
          "avgEdgePct": 0.0487,
          "avgPrice": -112.8955,
          "brier": 0.245144,
          "logLoss": 0.683349
        },
        "unknown": {
          "count": 97,
          "settled": 0,
          "wins": 0,
          "losses": 0,
          "pushes": 0,
          "voids": 97,
          "pending": 0,
          "unknown": 0,
          "units": 0,
          "roi": null,
          "winRate": null,
          "avgModelProbabilityPct": 52,
          "avgEdgePct": null,
          "avgPrice": null,
          "brier": null,
          "logLoss": null
        },
        "yrfi": {
          "count": 80,
          "settled": 72,
          "wins": 44,
          "losses": 28,
          "pushes": 0,
          "voids": 2,
          "pending": 6,
          "unknown": 0,
          "units": -2.4697,
          "roi": -0.0343,
          "winRate": 0.6111,
          "avgModelProbabilityPct": 55.1475,
          "avgEdgePct": 0.0104,
          "avgPrice": -115.5556,
          "brier": 0.245974,
          "logLoss": 0.685208
        }
      },
      "dataWarnings": {
        "critical_warning": {
          "count": 302,
          "settled": 193,
          "wins": 113,
          "losses": 80,
          "pushes": 0,
          "voids": 99,
          "pending": 10,
          "unknown": 0,
          "units": -21.8852,
          "roi": -0.1134,
          "winRate": 0.5855,
          "avgModelProbabilityPct": 54.5662,
          "avgEdgePct": 0.0335,
          "avgPrice": -114.1846,
          "brier": 0.245454,
          "logLoss": 0.684043
        }
      }
    },
    "analystRules": [
      "Do not downgrade FI solely because FI consensus/sharp split source is missing.",
      "Protect profitable FI Lean cohorts unless starter, lineup, stale-data, price, or edge issues are high materiality.",
      "FI Watchlist can promote when price is present, edge is real, starter/top-order context is fresh, and no critical data warning exists.",
      "YRFI/NRFI price quality matters; do not chase heavy juice without calibrated edge."
    ]
  }
}

No OpenAI calls were made. This pack is offline research context only.

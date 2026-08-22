#!/usr/bin/env python3
"""Tournament a market-led NFL moneyline baseline with bounded football influence.

This is isolated shadow research. It does not publish predictions, grades,
stakes, tracking rows, or member snapshots. The probability family and weekly
policy are selected on 2023 provider-native DraftKings openings, then opened
once on 2024-2025 confirmation. The football signal is a fixed r2 margin
projection; the market remains the probability prior and exact offered price.
"""

from __future__ import annotations

import json
import math
import os
import pathlib
import time
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import logit
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import tournament_nfl_opening_residual_v2 as r2


TOURNAMENT_RELEASE = "nfl_market_led_baseline_tournament_2026_08_22_r4"
MODEL_RELEASE = "nfl_market_led_moneyline_shadow_2026_08_22_r4"
CALIBRATION_RELEASE = "nfl_market_led_price_calibration_shadow_2026_08_22_r4"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
RANDOM_STATE = 22082026

FEATURE_FAMILIES = {
    "market": ("market_logit",),
    "football_base": ("market_logit", "margin_edge", "signed_sqrt_margin"),
    "price_regime": (
        "market_logit",
        "market_logit_squared",
        "market_logit_cubed",
        "margin_edge",
        "signed_sqrt_margin",
        "market_margin_interaction",
        "absolute_margin",
        "favorite_margin_interaction",
    ),
}
REGULARIZATION = (0.003, 0.01, 0.03, 0.10, 0.30, 1.00)
PRICE_BANDS = {
    "all_bounded": (-300.0, 300.0),
    "competitive": (-200.0, 200.0),
    "favorite": (-300.0, -101.0),
    "underdog": (100.0, 300.0),
}


@dataclass(frozen=True)
class Policy:
    minimum_ev: float
    minimum_edge_pp: float
    price_band: str
    maximum_actions_per_week: int | None

    @property
    def name(self) -> str:
        return (
            f"moneyline__{self.price_band}__ev{self.minimum_ev:.3f}"
            f"__edge{self.minimum_edge_pp:.1f}__max"
            f"{self.maximum_actions_per_week if self.maximum_actions_per_week is not None else 'all'}"
        )


def probability_metrics(rows: pd.DataFrame, probability: str) -> dict[str, Any]:
    p = np.clip(rows[probability].to_numpy(float), 0.001, 0.999)
    y = rows["outcome"].to_numpy(int)
    bins = np.minimum(9, np.floor(p * 10).astype(int))
    ece = 0.0
    for index in range(10):
        mask = bins == index
        if mask.any():
            ece += float(mask.mean()) * abs(float(p[mask].mean()) - float(y[mask].mean()))
    return {
        "rows": int(len(rows)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
        "ece10": ece,
        "meanProbability": float(p.mean()),
        "outcomeRate": float(y.mean()),
    }


def build_probability_rows(
    openings: pd.DataFrame,
    margin_values: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    margin_map = margin_values.set_index("row")["prediction"]
    rows = openings[openings["season"].between(2021, 2025)].copy()
    rows["row"] = rows.index
    rows["margin_projection"] = rows["row"].map(margin_map)
    rows = rows.dropna(subset=["margin_projection", "opening_home_ml_fair"]).copy()
    rows["outcome"] = rows["actual_margin"].gt(0).astype(int)
    rows = rows[~rows["actual_margin"].eq(0)].copy()
    rows["market_probability"] = rows["opening_home_ml_fair"].clip(0.01, 0.99)
    rows["market_logit"] = logit(rows["market_probability"])
    rows["margin_edge"] = rows["margin_projection"] / 7.0
    rows["signed_sqrt_margin"] = (
        np.sign(rows["margin_projection"])
        * np.sqrt(np.abs(rows["margin_projection"]))
        / math.sqrt(7.0)
    )
    rows["market_logit_squared"] = rows["market_logit"] ** 2
    rows["market_logit_cubed"] = rows["market_logit"] ** 3
    rows["market_margin_interaction"] = rows["market_logit"] * rows["margin_edge"]
    rows["absolute_margin"] = np.abs(rows["margin_edge"])
    rows["favorite_margin_interaction"] = (
        rows["margin_edge"] * (rows["market_probability"] - 0.50)
    )

    development = rows["season"].le(2022)
    selection = rows["season"].eq(SELECTION_SEASON)
    ranking: list[dict[str, Any]] = []
    for family, features in FEATURE_FAMILIES.items():
        for c_value in REGULARIZATION:
            model = probability_model(c_value)
            model.fit(rows.loc[development, list(features)], rows.loc[development, "outcome"])
            prediction = model.predict_proba(rows.loc[selection, list(features)])[:, 1]
            candidate = rows.loc[selection, ["outcome"]].copy()
            candidate["probability"] = prediction
            candidate["market_probability"] = rows.loc[selection, "market_probability"]
            ranking.append({
                "family": family,
                "features": list(features),
                "c": c_value,
                "candidate": probability_metrics(candidate, "probability"),
                "market": probability_metrics(candidate, "market_probability"),
            })
    ranking.sort(key=lambda value: (
        value["candidate"]["brier"],
        value["candidate"]["logLoss"],
        value["family"],
        value["c"],
    ))
    selected = ranking[0]
    rows["probability"] = np.nan
    for season in (SELECTION_SEASON, *CONFIRMATION_SEASONS):
        train = rows["season"].lt(season)
        test = rows["season"].eq(season)
        model = probability_model(float(selected["c"]))
        model.fit(rows.loc[train, selected["features"]], rows.loc[train, "outcome"])
        rows.loc[test, "probability"] = model.predict_proba(
            rows.loc[test, selected["features"]]
        )[:, 1]
    rows = rows[rows["season"].ge(SELECTION_SEASON)].copy()
    evaluation = {
        "selected": selected,
        "topCandidates": ranking[:20],
        "selection": period_probability_metrics(rows, (SELECTION_SEASON,)),
        "confirmation": period_probability_metrics(rows, CONFIRMATION_SEASONS),
        "confirmationBySeason": {
            str(season): period_probability_metrics(rows, (season,))
            for season in CONFIRMATION_SEASONS
        },
    }
    return rows, evaluation


def probability_model(c_value: float) -> Pipeline:
    return Pipeline([
        ("scale", StandardScaler()),
        ("model", LogisticRegression(
            C=c_value,
            max_iter=5000,
            solver="lbfgs",
            random_state=RANDOM_STATE,
        )),
    ])


def period_probability_metrics(rows: pd.DataFrame, seasons: tuple[int, ...]) -> dict[str, Any]:
    period = rows[rows["season"].isin(seasons)]
    return {
        "candidate": probability_metrics(period, "probability"),
        "market": probability_metrics(period, "market_probability"),
    }


def build_decisions(openings: pd.DataFrame, probabilities: pd.DataFrame) -> pd.DataFrame:
    decisions: list[dict[str, Any]] = []
    for row in probabilities.itertuples(index=False):
        sides = (
            (True, float(row.probability), float(row.market_probability), float(row.moneylineHome), bool(row.outcome)),
            (False, 1.0 - float(row.probability), 1.0 - float(row.market_probability), float(row.moneylineAway), not bool(row.outcome)),
        )
        game: list[dict[str, Any]] = []
        for first, probability, market_probability, price, won in sides:
            expected_value = probability * r2.profit_one(price) - (1.0 - probability)
            game.append({
                "row": int(row.row),
                "season": int(row.season),
                "week": int(row.week),
                "first": first,
                "probability": probability,
                "marketProbability": market_probability,
                "price": price,
                "expectedValue": expected_value,
                "edgePp": 100.0 * (probability - market_probability),
                "won": won,
                "units": r2.profit_one(price) if won else -1.0,
                "clv": r2.clv_for_row(openings, int(row.row), "moneyline", first),
            })
        decisions.append(max(game, key=lambda value: (value["expectedValue"], value["edgePp"])))
    return pd.DataFrame(decisions)


def policies() -> list[Policy]:
    return [
        Policy(ev, edge, band, maximum)
        for ev in (0.0, 0.005, 0.01, 0.02, 0.03, 0.04, 0.05)
        for edge in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0)
        for band in PRICE_BANDS
        for maximum in (1, 2, 3)
    ]


def policy_result(rows: pd.DataFrame, seasons: tuple[int, ...], policy: Policy) -> dict[str, Any]:
    low, high = PRICE_BANDS[policy.price_band]
    eligible = rows[
        rows["season"].isin(seasons)
        & rows["price"].between(low, high, inclusive="both")
        & rows["expectedValue"].ge(policy.minimum_ev)
        & rows["edgePp"].ge(policy.minimum_edge_pp)
    ].copy()
    ranked = eligible.sort_values(
        ["season", "week", "expectedValue", "edgePp"],
        ascending=[True, True, False, False],
    )
    selected = (
        ranked
        if policy.maximum_actions_per_week is None
        else ranked.groupby(["season", "week"], as_index=False).head(policy.maximum_actions_per_week)
    )
    all_weeks = rows[rows["season"].isin(seasons)][["season", "week"]].drop_duplicates()
    action_weeks = selected[["season", "week"]].drop_duplicates()
    units = float(selected["units"].sum())
    return {
        "policy": asdict(policy),
        "policyName": policy.name,
        "actions": int(len(selected)),
        "wins": int(selected["won"].sum()),
        "losses": int((~selected["won"]).sum()),
        "units": units,
        "roi": units / len(selected) if len(selected) else None,
        "weeks": int(len(all_weeks)),
        "weeksWithAction": int(len(action_weeks)),
        "weeklyCoverage": float(len(action_weeks) / len(all_weeks)) if len(all_weeks) else None,
        "positiveClvRate": float(selected["clv"].gt(0).mean()) if len(selected) else None,
        "meanClv": float(selected["clv"].mean()) if len(selected) else None,
        "bySeason": {
            str(season): summarize_selected(selected[selected["season"].eq(season)])
            for season in seasons
        },
        "selectedRows": selected.to_dict(orient="records"),
    }


def summarize_selected(rows: pd.DataFrame) -> dict[str, Any]:
    units = float(rows["units"].sum())
    return {
        "actions": int(len(rows)),
        "wins": int(rows["won"].sum()),
        "losses": int((~rows["won"]).sum()),
        "units": units,
        "roi": units / len(rows) if len(rows) else None,
        "positiveClvRate": float(rows["clv"].gt(0).mean()) if len(rows) else None,
        "meanClv": float(rows["clv"].mean()) if len(rows) else None,
    }


def selection_eligible(result: dict[str, Any]) -> bool:
    return bool(
        result["actions"] >= 12
        and result["weeklyCoverage"] >= 0.50
        and result["units"] > 0
        and result["positiveClvRate"] is not None
        and result["positiveClvRate"] >= 0.50
    )


def confirmation_gates(
    probability: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, bool]:
    by_season = result["bySeason"].values()
    return {
        "pooledProbabilityImprovement": (
            probability["candidate"]["brier"] < probability["market"]["brier"]
            and probability["candidate"]["logLoss"] < probability["market"]["logLoss"]
        ),
        "boundedSeasonProbabilityRegression": all(
            value["candidate"]["brier"] - value["market"]["brier"] <= 0.0015
            for value in probability["bySeason"].values()
        ),
        "minimumActions": result["actions"] >= 36,
        "weeklyCoverage": result["weeklyCoverage"] >= 0.80,
        "positiveLockedValue": result["units"] > 0,
        "boundedWorstSeason": all(
            season["actions"] >= 15 and season["roi"] is not None and season["roi"] >= -0.05
            for season in by_season
        ),
        "positiveClvRate": result["positiveClvRate"] is not None and result["positiveClvRate"] >= 0.50,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get("NFL_RESEARCH_SOURCE_ROOT", str(root))).resolve()
    features, feature_manifest = r2.load_features(source_root)
    openings, opening_evidence = r2.load_openings(source_root, features)
    engineered, feature_sets = r2.engineer(openings)
    margin_predictions, _ = r2.expanding_predictions(
        openings,
        engineered,
        feature_sets["margin"],
        "actual_margin",
        "opening_home_margin",
    )
    margin_name, _, _ = r2.select_candidate(
        openings,
        margin_predictions,
        "actual_margin",
        "opening_home_margin",
    )
    probabilities, probability_evidence = build_probability_rows(
        openings,
        margin_predictions[margin_name],
    )
    decisions = build_decisions(openings, probabilities)
    selection_results = [policy_result(decisions, (SELECTION_SEASON,), policy) for policy in policies()]
    eligible = [result for result in selection_results if selection_eligible(result)]
    eligible.sort(key=lambda result: (
        -result["units"],
        -result["positiveClvRate"],
        -result["meanClv"],
        -result["weeklyCoverage"],
        result["actions"],
        result["policyName"],
    ))
    selected = eligible[0] if eligible else None
    confirmation = None
    gates: dict[str, bool] = {}
    if selected:
        policy = Policy(**selected["policy"])
        confirmation = policy_result(decisions, CONFIRMATION_SEASONS, policy)
        gates = confirmation_gates({
            **probability_evidence["confirmation"],
            "bySeason": probability_evidence["confirmationBySeason"],
        }, confirmation)
    accepted = bool(selected and confirmation and all(gates.values()))
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "gradesChanged": False,
        "stakesChanged": False,
        "trackingChanged": False,
        "featureRelease": feature_manifest["featureRelease"],
        "featureSha256": feature_manifest["featureFileSha256"],
        "openingEvidence": opening_evidence,
        "marginCandidate": margin_name,
        "selectionSeason": SELECTION_SEASON,
        "confirmationSeasons": list(CONFIRMATION_SEASONS),
        "probability": probability_evidence,
        "decisionRows": decisions.to_dict(orient="records"),
        "policyCandidateCount": len(selection_results),
        "policySelectionEligibleCount": len(eligible),
        "topPolicySelectionCandidates": [
            {key: value for key, value in candidate.items() if key != "selectedRows"}
            for candidate in eligible[:50]
        ],
        "selectedPolicy": selected,
        "confirmation": confirmation,
        "confirmationGates": gates,
        "baselineLeanAuthorized": accepted,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
        "limitations": [
            "2024-2025 have been inspected by prior NFL research and are historical confirmation, not a pristine future holdout.",
            "Only provider-native DraftKings opening prices are used; production FanDuel unlocked and T-60 tuples remain forward evidence.",
            "Final-week availability in the r2 margin feature set is valid only for a near-kick overlay.",
            "Public and sharp split history is unavailable and cannot promote this policy.",
            "Even a passing historical baseline remains shadow-only until a coherent current Week 1 tuple is scored and reviewed.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "selectedProbability": probability_evidence["selected"],
        "probabilityConfirmation": probability_evidence["confirmation"],
        "policyCandidateCount": len(selection_results),
        "policySelectionEligibleCount": len(eligible),
        "topPolicySelectionCandidates": [
            {key: value for key, value in candidate.items() if key != "selectedRows"}
            for candidate in eligible[:20]
        ],
        "selectedPolicy": None if selected is None else {
            key: value for key, value in selected.items() if key != "selectedRows"
        },
        "confirmation": None if confirmation is None else {
            key: value for key, value in confirmation.items() if key != "selectedRows"
        },
        "confirmationGates": gates,
        "baselineLeanAuthorized": accepted,
        "report": str(report_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

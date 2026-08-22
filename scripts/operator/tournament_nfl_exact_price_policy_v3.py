#!/usr/bin/env python3
"""Tournament a bounded NFL exact-price policy over the accepted r2 shadow forecast.

This is local shadow research only. The policy family is selected on 2023 and
opened once on 2024-2025 confirmation. It explicitly tests price bands so
large American-odds payouts cannot masquerade as a repeatable model edge.
Nothing in this file publishes, grades, tracks, or changes a production model.
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

import tournament_nfl_opening_residual_v2 as r2


TOURNAMENT_RELEASE = "nfl_exact_price_policy_tournament_2026_08_22_r3"
DECISION_RELEASE = "nfl_exact_price_policy_shadow_2026_08_22_r3"
SELECTION_SEASONS = (2023,)
CONFIRMATION_SEASONS = (2024, 2025)


@dataclass(frozen=True)
class Policy:
    markets: tuple[str, ...]
    price_band: str
    minimum_ev: float
    minimum_edge_pp: float
    minimum_probability: float
    maximum_actions_per_week: int

    @property
    def name(self) -> str:
        markets = "_".join(self.markets)
        return (
            f"{markets}__{self.price_band}__ev{self.minimum_ev:.2f}"
            f"__edge{self.minimum_edge_pp:.1f}__p{self.minimum_probability:.2f}"
            f"__max{self.maximum_actions_per_week}"
        )


PRICE_BANDS: dict[str, tuple[float, float]] = {
    "bounded": (-300.0, 200.0),
    "favorite": (-300.0, -101.0),
    "competitive": (-150.0, 150.0),
    "short_dog": (100.0, 200.0),
}


def policies() -> list[Policy]:
    return [
        Policy(markets, band, ev, edge, probability, maximum)
        for markets in (("moneyline",), ("spread",), ("moneyline", "spread"))
        for band in PRICE_BANDS
        for ev in (0.01, 0.02, 0.03, 0.04, 0.05)
        for edge in (0.0, 1.0, 2.0)
        for probability in (0.50, 0.52, 0.55)
        for maximum in (1, 2)
    ]


def policy_result(rows: pd.DataFrame, seasons: tuple[int, ...], policy: Policy) -> dict[str, Any]:
    low, high = PRICE_BANDS[policy.price_band]
    period = rows[
        rows["season"].isin(seasons)
        & rows["market"].isin(policy.markets)
        & rows["price"].between(low, high, inclusive="both")
        & rows["expectedValue"].ge(policy.minimum_ev)
        & rows["edgePp"].ge(policy.minimum_edge_pp)
        & rows["probability"].ge(policy.minimum_probability)
    ].copy()
    selected = (
        period.sort_values(
            ["season", "week", "expectedValue", "edgePp"],
            ascending=[True, True, False, False],
        )
        .groupby(["season", "week"], sort=True, as_index=False)
        .head(policy.maximum_actions_per_week)
    )
    all_weeks = rows[rows["season"].isin(seasons)][["season", "week"]].drop_duplicates()
    action_weeks = selected[["season", "week"]].drop_duplicates()
    resolved = selected[~selected["push"]]
    units = float(selected["units"].sum())
    by_season = {
        str(season): summarize_selected(selected[selected["season"].eq(season)])
        for season in seasons
    }
    weekly_units = (
        selected.groupby(["season", "week"])["units"].sum()
        .reindex(pd.MultiIndex.from_frame(all_weeks), fill_value=0.0)
        .to_numpy(float)
    )
    return {
        "policy": asdict(policy),
        "policyName": policy.name,
        "actions": int(len(selected)),
        "wins": int(resolved["won"].sum()),
        "losses": int((~resolved["won"]).sum()),
        "pushes": int(selected["push"].sum()),
        "units": units,
        "roi": units / len(selected) if len(selected) else None,
        "weeks": int(len(all_weeks)),
        "weeksWithAction": int(len(action_weeks)),
        "weeklyCoverage": float(len(action_weeks) / len(all_weeks)) if len(all_weeks) else None,
        "positiveClvRate": float(selected["clv"].gt(0).mean()) if len(selected) else None,
        "meanClv": float(selected["clv"].mean()) if len(selected) else None,
        "meanExpectedValue": float(selected["expectedValue"].mean()) if len(selected) else None,
        "meanEdgePp": float(selected["edgePp"].mean()) if len(selected) else None,
        "marketMix": {str(key): int(value) for key, value in selected["market"].value_counts().sort_index().items()},
        "bySeason": by_season,
        "worstWeekUnits": float(np.min(weekly_units)) if len(weekly_units) else None,
        "selectedRows": selected[
            ["row", "season", "week", "market", "first", "probability", "marketProbability", "price", "expectedValue", "edgePp", "won", "push", "units", "clv"]
        ].to_dict(orient="records"),
    }


def summarize_selected(rows: pd.DataFrame) -> dict[str, Any]:
    resolved = rows[~rows["push"]]
    units = float(rows["units"].sum())
    return {
        "actions": int(len(rows)),
        "wins": int(resolved["won"].sum()),
        "losses": int((~resolved["won"]).sum()),
        "pushes": int(rows["push"].sum()),
        "units": units,
        "roi": units / len(rows) if len(rows) else None,
        "positiveClvRate": float(rows["clv"].gt(0).mean()) if len(rows) else None,
        "meanClv": float(rows["clv"].mean()) if len(rows) else None,
    }


def selection_eligible(result: dict[str, Any]) -> bool:
    seasons = result["bySeason"].values()
    return bool(
        result["actions"] >= 10
        and result["weeklyCoverage"] >= 0.40
        and result["units"] > 0
        and result["positiveClvRate"] is not None
        and result["positiveClvRate"] >= 0.50
        and all(season["actions"] >= 8 and season["units"] > 0 for season in seasons)
    )


def confirmation_gate(result: dict[str, Any]) -> dict[str, bool]:
    seasons = result["bySeason"].values()
    return {
        "minimumActions": result["actions"] >= 20,
        "weeklyCoverage": result["weeklyCoverage"] >= 0.40,
        "positiveLockedValue": result["units"] > 0,
        "positiveEachSeason": all(season["actions"] >= 8 and season["units"] > 0 for season in seasons),
        "positiveClvRate": result["positiveClvRate"] is not None and result["positiveClvRate"] >= 0.50,
    }


def build_decisions(root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    source_root = pathlib.Path(os.environ.get("NFL_RESEARCH_SOURCE_ROOT", str(root))).resolve()
    features, feature_manifest = r2.load_features(source_root)
    openings, opening_evidence = r2.load_openings(source_root, features)
    engineered, feature_sets = r2.engineer(openings)
    margin_predictions, _ = r2.expanding_predictions(
        openings, engineered, feature_sets["margin"], "actual_margin", "opening_home_margin"
    )
    total_predictions, _ = r2.expanding_predictions(
        openings, engineered, feature_sets["total"], "actual_total", "opening_total"
    )
    margin_name, _, _ = r2.select_candidate(
        openings, margin_predictions, "actual_margin", "opening_home_margin"
    )
    total_name, _, _ = r2.select_candidate(
        openings, total_predictions, "actual_total", "opening_total"
    )
    margin_evaluation = r2.evaluate_period(
        openings, margin_predictions[margin_name], "actual_margin", "opening_home_margin", CONFIRMATION_SEASONS
    )
    total_evaluation = r2.evaluate_period(
        openings, total_predictions[total_name], "actual_total", "opening_total", CONFIRMATION_SEASONS
    )
    margin_pass = bool(
        margin_evaluation["pooled"]["maeImprovement"] > 0
        and all(value["maeImprovement"] >= 0 for value in margin_evaluation["bySeason"].values())
    )
    total_pass = bool(
        total_evaluation["pooled"]["maeImprovement"] > 0
        and all(value["maeImprovement"] >= 0 for value in total_evaluation["bySeason"].values())
    )
    zero = "residual__zero__zero__w0.00"
    r2.PROBABILITY_SEASONS = (2023, 2024, 2025)
    probabilities, probability_report = r2.chronological_probabilities(
        openings,
        margin_predictions[margin_name if margin_pass else zero],
        total_predictions[total_name if total_pass else zero],
        price_stage="opening",
        identity_markets={"total"} if not total_pass else set(),
    )
    decisions = r2.decision_rows(openings, probabilities)
    return decisions, {
        "featureSha256": feature_manifest["featureFileSha256"],
        "openingEvidence": opening_evidence,
        "marginCandidate": margin_name,
        "marginConfirmation": margin_evaluation,
        "marginGate": margin_pass,
        "totalCandidate": total_name,
        "totalConfirmation": total_evaluation,
        "totalGate": total_pass,
        "probabilities": probability_report,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    decisions, model_evidence = build_decisions(root)
    selection_results = [policy_result(decisions, SELECTION_SEASONS, policy) for policy in policies()]
    eligible = [result for result in selection_results if selection_eligible(result)]
    eligible.sort(
        key=lambda result: (
            -min(season["units"] for season in result["bySeason"].values()),
            -result["units"],
            -result["positiveClvRate"],
            result["actions"],
            result["policyName"],
        )
    )
    selected = eligible[0] if eligible else None
    confirmation = None
    gates: dict[str, bool] = {}
    if selected:
        policy = Policy(**{
            **selected["policy"],
            "markets": tuple(selected["policy"]["markets"]),
        })
        confirmation = policy_result(decisions, CONFIRMATION_SEASONS, policy)
        gates = confirmation_gate(confirmation)
    accepted = bool(selected and confirmation and all(gates.values()))
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "gradesChanged": False,
        "stakesChanged": False,
        "trackingChanged": False,
        "selectionSeasons": list(SELECTION_SEASONS),
        "confirmationSeasons": list(CONFIRMATION_SEASONS),
        "modelEvidence": model_evidence,
        "candidateCount": len(selection_results),
        "selectionEligibleCount": len(eligible),
        "selectedPolicy": selected,
        "confirmation": confirmation,
        "confirmationGates": gates,
        "actionablePolicyAccepted": accepted,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
        "limitations": [
            "2024-2025 have been inspected by earlier NFL research and are historical confirmation, not a pristine future holdout.",
            "Only provider-native DraftKings opening prices are used; no T-60 price history is synthesized.",
            "Public and sharp split history is unavailable and is not used.",
            "A passing historical policy would remain shadow-only until timestamp-locked 2026 evidence exists.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "candidateCount": len(selection_results),
        "selectionEligibleCount": len(eligible),
        "selectedPolicy": None if selected is None else {
            key: value for key, value in selected.items() if key != "selectedRows"
        },
        "confirmation": None if confirmation is None else {
            key: value for key, value in confirmation.items() if key != "selectedRows"
        },
        "confirmationGates": gates,
        "actionablePolicyAccepted": accepted,
        "report": str(report_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Chronological NHL independent-model plus market-reading arbitration research.

Joins the frozen r7 pregame model state to public same-game opening/closing odds.
The experiment tests actual side changes: strong same-book movement may replace an
uncertain independent winner instead of being reduced to a fixed point nudge.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


TEAM = {
    "Ducks": "ANA", "Coyotes": "ARI", "Arizonas": "ARI", "Bruins": "BOS",
    "Sabres": "BUF", "Flames": "CGY", "Hurricanes": "CAR", "Blackhawks": "CHI",
    "Avalanche": "COL", "Blue Jackets": "CBJ", "Stars": "DAL", "Red Wings": "DET",
    "Oilers": "EDM", "Panthers": "FLA", "Kings": "LAK", "Wild": "MIN",
    "Canadiens": "MTL", "Predators": "NSH", "Devils": "NJD", "NY Islanders": "NYI",
    "Islanders": "NYI", "Rangers": "NYR", "Senators": "OTT", "Flyers": "PHI",
    "Penguins": "PIT", "Sharks": "SJS", "St.Louis": "STL", "Lightning": "TBL",
    "Tampa": "TBL", "Tampa Bay": "TBL", "Maple Leafs": "TOR", "Canucks": "VAN",
    "Golden Knights": "VGK", "Capitals": "WSH", "Jets": "WPG", "Kraken": "SEA",
    "SeattleKraken": "SEA",
}
TRICODE = {"L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "T.B": "TBL"}


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def implied(price: Any) -> float | None:
    try:
        price = float(price)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(price) or price == 0:
        return None
    return 100 / (price + 100) if price > 0 else -price / (-price + 100)


def no_vig(home: Any, away: Any) -> float | None:
    hp, ap = implied(home), implied(away)
    return None if hp is None or ap is None else hp / (hp + ap)


def sbr_markets(path: Path) -> dict[tuple[int, str, str, str], dict[str, float]]:
    output = {}
    for row in json.loads(path.read_text()):
        season = int(row["season"])
        if not 2018 <= season <= 2021:
            continue
        home, away = TEAM.get(str(row["home_team"])), TEAM.get(str(row["away_team"]))
        opening = no_vig(row.get("home_open_ml"), row.get("away_open_ml"))
        closing = no_vig(row.get("home_close_ml"), row.get("away_close_ml"))
        try:
            home_goals = float(row["home_final"])
            away_goals = float(row["away_final"])
        except (KeyError, TypeError, ValueError):
            continue
        if not home or not away or opening is None or closing is None:
            continue
        date = str(int(float(row["date"])))
        output[(season, date, home, away)] = {
            "open_home": opening,
            "close_home": closing,
            "move": closing - opening,
            "home_goals": home_goals,
            "away_goals": away_goals,
        }
    return output


def normalized(row: dict[str, Any]) -> tuple[int, str, str, str]:
    return (
        int(row["season"]), str(row["date"]).replace("-", ""),
        TRICODE.get(row["home"], row["home"]), TRICODE.get(row["away"], row["away"]),
    )


def home_win_probability(coherent: Any, home: float, away: float) -> float:
    return float(coherent.distribution(home, away)["home_win"])


def report(rows: list[dict[str, Any]], threshold: float, uncertainty: float) -> dict[str, Any]:
    independent_correct = final_correct = fixed_correct = 0
    final_brier = independent_brier = fixed_brier = 0.0
    flips = corrected = worsened = movement_correct = 0
    for row in rows:
        independent = row["independent"]
        move = row["market"]["move"]
        independent_side = independent >= 0.5
        move_side = move > 0
        eligible = abs(move) >= threshold and abs(independent - 0.5) <= uncertainty and move_side != independent_side
        final_side = move_side if eligible else independent_side
        # A flip is represented as a real probability crossing, not a capped
        # score nudge. Strength comes from the observed move but remains modest.
        flip_probability = 0.5 + min(0.10, 0.50 * abs(move))
        final_probability = (flip_probability if move_side else 1 - flip_probability) if eligible else independent
        fixed_probability = 0.8 * independent + 0.2 * row["market"]["close_home"]
        actual = row["actual_home"]
        independent_hit = independent_side == actual
        final_hit = final_side == actual
        independent_correct += int(independent_hit)
        final_correct += int(final_hit)
        fixed_correct += int((fixed_probability >= 0.5) == actual)
        independent_brier += (independent - actual) ** 2
        final_brier += (final_probability - actual) ** 2
        fixed_brier += (fixed_probability - actual) ** 2
        if eligible:
            flips += 1
            corrected += int(not independent_hit and final_hit)
            worsened += int(independent_hit and not final_hit)
            movement_correct += int(move_side == actual)
    count = len(rows)
    return {
        "n": count,
        "threshold_pp": 100 * threshold,
        "independent_uncertainty_pp": 100 * uncertainty,
        "independent_accuracy": independent_correct / count,
        "fixed_20pct_close_blend_accuracy": fixed_correct / count,
        "conditional_arbitration_accuracy": final_correct / count,
        "independent_brier": independent_brier / count,
        "fixed_20pct_close_blend_brier": fixed_brier / count,
        "conditional_arbitration_brier": final_brier / count,
        "flips": flips,
        "corrected": corrected,
        "worsened": worsened,
        "flip_net": corrected - worsened,
        "movement_accuracy_on_flips": movement_correct / flips if flips else None,
    }


def score(report: dict[str, Any]) -> float:
    return report["conditional_arbitration_brier"] - 0.12 * report["conditional_arbitration_accuracy"]


def safe_logit(probability: float) -> float:
    value = min(0.97, max(0.03, probability))
    return math.log(value / (1 - value))


def learned_features(row: dict[str, Any], family: str) -> list[float]:
    independent = float(row["independent"])
    opening = float(row["market"]["open_home"])
    closing = float(row["market"]["close_home"])
    move = closing - opening
    if family == "independent_calibration":
        return [safe_logit(independent)]
    if family == "model_market":
        return [safe_logit(independent), safe_logit(closing)]
    return [
        safe_logit(independent), safe_logit(opening), move, abs(move),
        closing - independent, abs(independent - 0.5),
        move * abs(independent - 0.5),
    ]


def fit_learned(rows: list[dict[str, Any]], family: str, c_value: float):
    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(C=c_value, max_iter=1000, random_state=23),
    )
    model.fit(
        np.asarray([learned_features(row, family) for row in rows]),
        np.asarray([row["actual_home"] for row in rows]),
    )
    return model


def learned_report(model: Any, rows: list[dict[str, Any]], family: str) -> dict[str, Any]:
    probabilities = model.predict_proba(np.asarray([learned_features(row, family) for row in rows]))[:, 1]
    actual = np.asarray([row["actual_home"] for row in rows], dtype=float)
    independent = np.asarray([row["independent"] for row in rows], dtype=float)
    picked = probabilities >= 0.5
    independent_pick = independent >= 0.5
    flips = picked != independent_pick
    corrected = (~(independent_pick == actual.astype(bool))) & (picked == actual.astype(bool)) & flips
    worsened = (independent_pick == actual.astype(bool)) & (~(picked == actual.astype(bool))) & flips
    clipped = np.clip(probabilities, 0.01, 0.99)
    return {
        "n": len(rows),
        "accuracy": float(np.mean(picked == actual.astype(bool))),
        "brier": float(np.mean((probabilities - actual) ** 2)),
        "logloss": float(np.mean(-(actual * np.log(clipped) + (1 - actual) * np.log(1 - clipped)))),
        "flips": int(np.sum(flips)),
        "corrected": int(np.sum(corrected)),
        "worsened": int(np.sum(worsened)),
        "flip_net": int(np.sum(corrected) - np.sum(worsened)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--goalies", required=True, type=Path)
    parser.add_argument("--sbr", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    coherent = load("nhl_arb_coherent", root / "scripts/operator/research-nhl-coherent-score-r8.py")
    audit = load("nhl_arb_audit", root / "scripts/operator/audit-nhl-r7-predictiveness.py")
    base = load("nhl_arb_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    research = load("nhl_arb_features", root / "scripts/operator/research-nhl-matchup-features-r6.py")
    stability = load("nhl_arb_stability", root / "scripts/operator/research-nhl-training-stability-r6.py")
    games = stability.load_games(args.moneypuck, base)
    markets = sbr_markets(args.sbr)
    # MoneyPuck's team-game export excludes the synthetic shootout winner.
    # Restore the official final from SBR before building any rolling state or
    # settled label so market-reading conclusions cannot inherit false ties.
    for game in games:
        market = markets.get(normalized(game))
        if market is not None:
            game["home_goals"] = market["home_goals"]
            game["away_goals"] = market["away_goals"]
    starter, goalie_results = research.read_goalies(args.goalies)
    rows = research.build_examples(base, games, 0.085, ["opponent_adjusted"], starter, goalie_results)
    joined = []
    for row in rows:
        market = markets.get(normalized(row))
        if market:
            independent_row = {**row, "market": {"home_prob": None}}
            home, away = audit.r7_predictions([independent_row], coherent, research)[0]
            joined.append({
                **row,
                "market": market,
                "independent": home_win_probability(coherent, home, away),
                "actual_home": int(row["home_goals"] > row["away_goals"]),
            })
    selection = [row for row in joined if row["season"] in {2018, 2019}]
    confirmation = [row for row in joined if row["season"] in {2020, 2021}]
    candidates = []
    for threshold in (0.02, 0.03, 0.04, 0.05, 0.06):
        for uncertainty in (0.03, 0.05, 0.08, 0.10, 0.15):
            result = report(selection, threshold, uncertainty)
            candidates.append({"threshold": threshold, "uncertainty": uncertainty, "score": score(result), "selection": result})
    selected = min(candidates, key=lambda candidate: candidate["score"])
    learned_candidates = []
    learned_train = [row for row in joined if row["season"] == 2018]
    learned_tune = [row for row in joined if row["season"] == 2019]
    for family in ("independent_calibration", "model_market", "market_reading"):
        for c_value in (0.01, 0.03, 0.1, 0.3, 1.0):
            model = fit_learned(learned_train, family, c_value)
            result = learned_report(model, learned_tune, family)
            learned_candidates.append({
                "family": family,
                "c": c_value,
                "objective": result["brier"] + 0.08 * result["logloss"] - 0.12 * result["accuracy"],
                "tune_2019": result,
            })
    learned_selected = min(learned_candidates, key=lambda candidate: candidate["objective"])
    learned_model = fit_learned(selection, learned_selected["family"], learned_selected["c"])
    payload = {
        "release": "nhl_market_arbitration_research_2026_09_29_r1",
        "protocol": {
            "independent": "frozen r7 state with no market blend",
            "selection": "2018-2019",
            "untouched_confirmation": "2020-2021",
            "market": "SBR consensus opening-to-closing no-vig moneyline probability movement",
            "behavior": "conditional side replacement only for validated strong moves that oppose an uncertain independent pick",
        },
        "selected": selected,
        "confirmation": report(confirmation, selected["threshold"], selected["uncertainty"]),
        "all_joined": report(joined, selected["threshold"], selected["uncertainty"]),
        "learned_arbitration": {
            "selected": learned_selected,
            "confirmation": learned_report(learned_model, confirmation, learned_selected["family"]),
            "top_candidates": sorted(learned_candidates, key=lambda candidate: candidate["objective"])[:10],
        },
        "top_candidates": sorted(candidates, key=lambda candidate: candidate["score"])[:10],
        "counts": {"joined": len(joined), "selection": len(selection), "confirmation": len(confirmation)},
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()

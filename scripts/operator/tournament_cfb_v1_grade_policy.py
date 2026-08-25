#!/usr/bin/env python3
"""Frozen CFB v1 ML/Spread/Total grade-policy tournament."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from tournament_cfb_v1_model import META_COLUMNS, build_dataset, model_families, nearest_football_scores, read_sources


RELEASE = "cfb_v1_exact_price_grade_policy_tournament_2026_08_25_r1"
POLICY_RELEASE = "cfb_v1_grade_policy_2026_08_25_r1"
DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_25_r1"
WEIGHTS = (0.25, 0.35, 0.50, 0.65, 1.00)
EDGE_THRESHOLDS = (0.01, 0.02, 0.03, 0.04, 0.05)
EV_THRESHOLDS = (0.00, 0.01, 0.02, 0.03)
MARKETS = ("moneyline", "spread", "total")


def american_from_implied(probability: float) -> int:
    probability = min(0.995, max(0.005, probability))
    return int(round(-100 * probability / (1-probability))) if probability >= 0.5 else int(round(100 * (1-probability) / probability))


def profit(price: int) -> float:
    return 100 / abs(price) if price < 0 else price / 100


def units(result: str, price: int) -> float:
    return profit(price) if result == "win" else 0.0 if result == "push" else -1.0


def settle(market: str, side: str, home_score: float, away_score: float, home_line: float | None, total_line: float | None) -> str:
    if market == "moneyline": value = home_score-away_score if side == "home" else away_score-home_score
    elif market == "spread": value = home_score+(home_line or 0)-away_score if side == "home" else away_score-(home_line or 0)-home_score
    else: value = home_score+away_score-(total_line or 0) if side == "over" else (total_line or 0)-home_score-away_score
    return "win" if value > 0 else "push" if value == 0 else "loss"


def empirical_market_home_probability(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    available = train.home_spread.notna()
    model = LogisticRegression(C=4.0, max_iter=5000)
    model.fit((-train.loc[available, "home_spread"].to_numpy(float)).reshape(-1,1), (train.loc[available,"home_score"]>train.loc[available,"away_score"]).astype(int))
    spread = -test.home_spread.fillna(0).to_numpy(float)
    return model.predict_proba(spread.reshape(-1,1))[:,1]


def forecast_season(data: pd.DataFrame, season: int, seed: int) -> list[dict[str, Any]]:
    train = data[data.season < season]
    test = data[(data.season == season) & data.home_spread.notna() & data.market_total.notna()].copy()
    features = sorted(column for column in train.columns if column not in META_COLUMNS)
    home_model = model_families(seed)["elastic_net"]
    away_model = model_families(seed+1)["elastic_net"]
    home_model.fit(train[features],train.home_score);away_model.fit(train[features],train.away_score)
    train_ph=home_model.predict(train[features]);train_pa=away_model.predict(train[features])
    residuals=np.column_stack([train.home_score.to_numpy()-train_ph,train.away_score.to_numpy()-train_pa])
    ph=home_model.predict(test[features]);pa=away_model.predict(test[features])
    market_home=empirical_market_home_probability(train,test)
    rng=np.random.default_rng(seed+season)
    output=[]
    for index,(_,game) in enumerate(test.iterrows()):
        picks=rng.integers(0,len(residuals),5000)
        home=nearest_football_scores(np.clip(ph[index]+residuals[picks,0],0,90))
        away=nearest_football_scores(np.clip(pa[index]+residuals[picks,1],0,90))
        margin=home-away;total=home+away
        home_line=float(game.home_spread);total_line=float(game.market_total)
        p_home=float((margin>0).mean()+0.5*(margin==0).mean())
        p_home_cover=float((margin+home_line>0).mean()+0.5*(margin+home_line==0).mean())
        p_over=float((total>total_line).mean()+0.5*(total==total_line).mean())
        rows={
            "moneyline": (p_home,float(market_home[index]),"home","away"),
            "spread": (p_home_cover,0.5,"home","away"),
            "total": (p_over,0.5,"over","under"),
        }
        for market,(primary_probability,market_primary,primary,opposing) in rows.items():
            if market=="moneyline":
                primary_price=american_from_implied(min(0.99,market_primary+0.0225));opposing_price=american_from_implied(min(0.99,1-market_primary+0.0225))
            else:primary_price=opposing_price=-110
            for side,p_ind,p_market,price in ((primary,primary_probability,market_primary,primary_price),(opposing,1-primary_probability,1-market_primary,opposing_price)):
                output.append({
                    "season":season,"week":int(game.week),"gameId":str(int(game.game_id)),"market":market,"side":side,
                    "independentProbability":p_ind,"marketFairProbability":p_market,"price":price,
                    "homeLine":home_line,"totalLine":total_line,
                    "result":settle(market,side,float(game.home_score),float(game.away_score),home_line,total_line),
                })
    return output


def selected_rows(rows: list[dict[str,Any]], market: str, weight: float, min_edge: float, min_ev: float) -> list[dict[str,Any]]:
    by_game: dict[str,list[dict[str,Any]]] = {}
    for row in rows:
        if row["market"]!=market:continue
        probability=weight*row["independentProbability"]+(1-weight)*row["marketFairProbability"]
        edge=probability-row["marketFairProbability"]
        ev=probability*profit(row["price"])-(1-probability)
        enriched={**row,"decisionProbability":probability,"edge":edge,"ev":ev,"units":units(row["result"],row["price"])}
        by_game.setdefault(row["gameId"],[]).append(enriched)
    chosen=[]
    for values in by_game.values():
        best=max(values,key=lambda value:(value["ev"],value["edge"]))
        if best["edge"]>=min_edge and best["ev"]>=min_ev:chosen.append(best)
    return chosen


def summarize(rows: list[dict[str,Any]]) -> dict[str,float]:
    values=[row["units"] for row in rows];total=float(sum(values));largest=max(values,default=0.0)
    return {"actions":len(rows),"units":total,"roi":total/len(rows) if rows else 0.0,"largestWin":largest,"unitsWithoutLargestWin":total-largest if rows else 0.0}


def bootstrap_weekly(rows: list[dict[str,Any]], seed: int) -> dict[str,float]:
    buckets: dict[tuple[int,int],list[float]]={}
    for row in rows:buckets.setdefault((row["season"],row["week"]),[]).append(row["units"])
    weeks=list(buckets.values())
    if not weeks:return {"medianRoi":0.0,"lowerRoi":0.0,"upperRoi":0.0}
    rng=np.random.default_rng(seed);samples=[]
    for _ in range(4000):
        chosen=[weeks[index] for index in rng.integers(0,len(weeks),len(weeks))];flat=[unit for week in chosen for unit in week]
        samples.append(sum(flat)/len(flat))
    return {"medianRoi":float(np.median(samples)),"lowerRoi":float(np.quantile(samples,0.05)),"upperRoi":float(np.quantile(samples,0.95))}


def choose_policy(selection: list[dict[str,Any]], market: str) -> dict[str,Any]:
    minimum=15 if market=="moneyline" else 20;candidates=[]
    for weight in WEIGHTS:
        for edge in EDGE_THRESHOLDS:
            for ev in EV_THRESHOLDS:
                rows=selected_rows(selection,market,weight,edge,ev);summary=summarize(rows)
                if summary["actions"]<minimum or summary["unitsWithoutLargestWin"]<=0:continue
                weekly=bootstrap_weekly(rows,20260825)
                score=summary["roi"]+0.35*weekly["lowerRoi"]+0.002*math.log1p(summary["actions"])
                candidates.append({"weight":weight,"minEdge":edge,"minEv":ev,"selection":summary,"weeklyBootstrap":weekly,"score":score})
    if not candidates:raise RuntimeError(f"No selection-qualified {market} policy")
    return max(candidates,key=lambda value:value["score"])


def main() -> None:
    parser=argparse.ArgumentParser();parser.add_argument("--source-dir",default="football-research/cache/cfb-model/source");parser.add_argument("--qualification",default="football-research/reports/cfb_v1_independent_joint_distribution_2026_08_25_r3.json");parser.add_argument("--output",default="football-research/reports/cfb_v1_grade_policy_2026_08_25_r1.json");parser.add_argument("--artifact",default="lib/services/football/modelArtifacts/cfbV1GradePolicy.json");parser.add_argument("--seed",type=int,default=20260825);args=parser.parse_args()
    qualification=json.loads(Path(args.qualification).read_text())
    if not qualification.get("promotable"):raise RuntimeError("CFB grade tournament requires qualified r3 distribution")
    frames,checksums=read_sources(Path(args.source_dir));data=build_dataset(frames).replace([np.inf,-np.inf],np.nan)
    yearly={str(season):forecast_season(data,season,args.seed) for season in (2023,2024,2025)}
    policies={};all_gates={}
    for market in MARKETS:
        policy=choose_policy(yearly["2023"],market)
        confirmation={str(season):summarize(selected_rows(yearly[str(season)],market,policy["weight"],policy["minEdge"],policy["minEv"])) for season in (2024,2025)}
        pooled=selected_rows(yearly["2024"]+yearly["2025"],market,policy["weight"],policy["minEdge"],policy["minEv"]);pooled_summary=summarize(pooled);weekly=bootstrap_weekly(pooled,args.seed+1)
        lean_qualified=pooled_summary["units"]>0 and pooled_summary["unitsWithoutLargestWin"]>0 and all(confirmation[str(s)]["roi"]>=-0.03 for s in (2024,2025)) and weekly["medianRoi"]>0
        best_edge=policy["minEdge"]+0.02;best_ev=policy["minEv"]+0.02
        best_confirmation={str(season):summarize(selected_rows(yearly[str(season)],market,policy["weight"],best_edge,best_ev)) for season in (2024,2025)}
        best_qualified=lean_qualified and all(best_confirmation[str(s)]["actions"]>=5 and best_confirmation[str(s)]["units"]>0 and best_confirmation[str(s)]["unitsWithoutLargestWin"]>0 for s in (2024,2025))
        policies[market]={**{key:policy[key] for key in ("weight","minEdge","minEv")},"selection":policy["selection"],"selectionWeeklyBootstrap":policy["weeklyBootstrap"],"confirmation":confirmation,"pooledConfirmation":pooled_summary,"pooledWeeklyBootstrap":weekly,"leanQualified":lean_qualified,"bestAngle":{"minEdge":best_edge,"minEv":best_ev,"qualified":best_qualified,"confirmation":best_confirmation}}
        all_gates[market]=lean_qualified
    report={"release":RELEASE,"policyRelease":POLICY_RELEASE,"decisionRelease":DECISION_RELEASE,"generatedAt":pd.Timestamp.utcnow().isoformat(),"qualificationRelease":qualification["release"],"sourceChecksums":checksums,"chronology":{"selection":2023,"confirmation":[2024,2025],"confirmationStatus":"repeated"},"policies":policies,"gates":all_gates,"promotable":all(all_gates.values()),"historicalExecutionLimitation":"spread_total_minus110_moneyline_empirical_spread_curve_no_historical_named_price_or_clv"}
    output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    artifact={"policyRelease":POLICY_RELEASE,"decisionRelease":DECISION_RELEASE,"qualificationRelease":qualification["release"],"researchReportSha256":hashlib.sha256(output.read_bytes()).hexdigest(),"policies":policies}
    artifact_path=Path(args.artifact);artifact_path.parent.mkdir(parents=True,exist_ok=True);artifact_path.write_text(json.dumps(artifact,separators=(",",":"),sort_keys=True)+"\n")
    print(json.dumps({"output":str(output),"artifact":str(artifact_path),"promotable":report["promotable"],"policies":{market:{"weight":value["weight"],"minEdge":value["minEdge"],"minEv":value["minEv"],"leanQualified":value["leanQualified"],"bestAngleQualified":value["bestAngle"]["qualified"],"confirmation":value["confirmation"]} for market,value in policies.items()}},indent=2))


if __name__=="__main__":main()

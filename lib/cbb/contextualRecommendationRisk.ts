/** Grade-only sensitivity of the released forecast, never a replacement forecast.
 * These are explicit product risk preferences, not confidence intervals. */
import {createCbbContextualScoreLaw,cbbWorkingNormalExpectedDownside,type CbbContextualLatentGaussian,type CbbScoreLawNumerics} from "./contextualScoreLawResearch";
import type {CbbMarket} from "./types";

export const CBB_CONTEXTUAL_RECOMMENDATION_RISK_RELEASE="cbb_recommendation_risk_2026_11_05_r1_expected_downside" as const;
export const CBB_CONTEXTUAL_RECOMMENDATION_RISK_POLICY=Object.freeze({
 release:CBB_CONTEXTUAL_RECOMMENDATION_RISK_RELEASE,
 locationRadiiMarginalStandardErrors:{lean:1,best:1},
 leanRiskMeaning:"nominal_EV_minus_expected_negative_excursion_of_a_declared_linearized_working_Normal_EV_sensitivity;no_worst_case_scenario_veto",
 sensitivityMeaning:"exact_price_EV_axis_differences_at_plus_minus_one_fitted_location_SE;L1_scale_for_unknown_cross_axis_dependence_of_the_linearized_working_model;not_a_bound_for_actual_nonlinear_EV",
 adverseCalibrationCases:1,
 locationMeaning:"eight_coordinate_and_corner_sensitivity_scenarios_of_the_released_predictive_law;not_a_posterior_quantile_or_continuous_worst_case_bound",
 scaleMeaning:"calibrated_source_location_plus_GP_function_variance_only;no_remaining_game_noise_in_the_location_radius;released_predictive_scales_unchanged",
 adverseCaseMeaning:"one_additional_adverse_resolved_case_product_stress;N_is_unique_calibration_games_not_effective_independent_tail_evidence",
 reserveMeaning:"conditional_stress_value=(N*local_value-1)/(N+1);implies_data_sized_1/N_reserve_before_location_sensitivity;not_threshold_free",
 forecastMeaning:"selected_side_score_probability_price_and_nominal_EV_remain_the_authoritative_released_forecast",
 evidenceMeaning:"full_market_context_already_shapes_forecast_and_fitted_uncertainty;no_source_votes_confirmation_gate_or_opposition_veto",
});
export type CbbRecommendationRiskContext={marginLocationSd:number;totalLocationSd:number;calibrationGames:number};
export function createCbbRecommendationRiskEvaluator(args:{latent:CbbContextualLatentGaussian;context:CbbRecommendationRiskContext;numerics?:CbbScoreLawNumerics;assessmentTier?:"lean"|"best"}){
 const {context:c}=args;
 const assessmentTier=args.assessmentTier??"lean",radius=CBB_CONTEXTUAL_RECOMMENDATION_RISK_POLICY.locationRadiiMarginalStandardErrors[assessmentTier];
 if(!Number.isSafeInteger(c.calibrationGames)||c.calibrationGames<1||![c.marginLocationSd,c.totalLocationSd].every(x=>Number.isFinite(x)&&x>=0))
  throw Error("CBB recommendation risk requires finite fitted location uncertainty and unique calibration games");
 // Keep normalizers and threshold results shared by the game's three markets.
 // No GP rerun, PMF/score summary, source request or per-market artifact load.
 let scenarios:null|{marginShift:number;totalShift:number;law:ReturnType<typeof createCbbContextualScoreLaw>}[]=null;
 return (target:{market:CbbMarket;line:number|null;selection:"first"|"second";price:number;expectedValue:number;resolvedMass:number;numericalValueErrorEstimate:number;probabilityErrorEstimate:number})=>{
  const profit=target.price>0?target.price/100:100/-target.price;
  const maximumPossibleStressedValue=(c.calibrationGames*profit-1)/(c.calibrationGames+1);
  const priceCanSupportRecommendation=maximumPossibleStressedValue>32*Number.EPSILON*(profit+1);
  if(priceCanSupportRecommendation&&!scenarios){
   const unique=new Map<string,[number,number]>();
   for(const [m,t] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){
    const shift:[number,number]=[radius*m*c.marginLocationSd,radius*t*c.totalLocationSd];
    if(shift[0]!==0||shift[1]!==0)unique.set(JSON.stringify(shift),shift);
   }
   scenarios=[...unique.values()].map(([marginShift,totalShift])=>({marginShift,totalShift,
    law:createCbbContextualScoreLaw({...args.latent,marginMean:args.latent.marginMean+marginShift,totalMean:args.latent.totalMean+totalShift},args.numerics)}));
  }
  const evaluate=(win:number,loss:number,push:number,error:number)=>{
   const resolved=win+loss,expectedValue=win*profit-loss;
   const stressedExpectedValue=(c.calibrationGames*expectedValue-resolved)/(c.calibrationGames+1);
   const errorEstimate=((c.calibrationGames*(profit+1)+2)/(c.calibrationGames+1))*error+32*Number.EPSILON*(Math.abs(expectedValue)+Math.abs(stressedExpectedValue)+1);
   return {winProbability:win,loseProbability:loss,pushProbability:push,expectedValue,
    conditionalExpectedValue:resolved>0?expectedValue/resolved:null,stressedExpectedValue,errorEstimate};
  };
  // Nominal value participates even when the uncertainty radius is zero.
  let minimumStressedValue=(c.calibrationGames*target.expectedValue-target.resolvedMass)/(c.calibrationGames+1);
  let maximumError=(c.calibrationGames*target.numericalValueErrorEstimate+2*target.probabilityErrorEstimate)/(c.calibrationGames+1)+32*Number.EPSILON;
  let minimumLocalValue=target.expectedValue;
  const observations=(priceCanSupportRecommendation?scenarios??[]:[]).map(s=>{
   const p=s.law.probabilitiesFast(target.market,target.line),win=target.selection==="first"?p.first:p.second,loss=target.selection==="first"?p.second:p.first;
   const value=evaluate(win,loss,p.push,p.omittedMassUpperBound+p.quadratureErrorEstimate+p.normalizerErrorEstimate+p.summationRoundoffUpperBound);
   minimumStressedValue=Math.min(minimumStressedValue,value.stressedExpectedValue);
   minimumLocalValue=Math.min(minimumLocalValue,value.expectedValue);maximumError=Math.max(maximumError,value.errorEstimate);
   return {marginShift:s.marginShift,totalShift:s.totalShift,...value};
  });
  const axis=(coordinate:"margin"|"total",sign:1|-1)=>observations.find(s=>coordinate==="margin"?
   Math.sign(s.marginShift)===sign&&s.totalShift===0:Math.sign(s.totalShift)===sign&&s.marginShift===0)?.expectedValue??target.expectedValue;
  const marginValueSensitivity=(axis("margin",1)-axis("margin",-1))/2,totalValueSensitivity=(axis("total",1)-axis("total",-1))/2;
  const workingValueSensitivityScale=Math.abs(marginValueSensitivity)+Math.abs(totalValueSensitivity);
  const linearizationResiduals=observations.map(s=>({marginShift:s.marginShift,totalShift:s.totalShift,
   residual:s.expectedValue-target.expectedValue-Math.sign(s.marginShift)*marginValueSensitivity-Math.sign(s.totalShift)*totalValueSensitivity}));
  const expectedDownsidePenalty=cbbWorkingNormalExpectedDownside(target.expectedValue,workingValueSensitivityScale);
  const riskAdjustedExpectedValue=target.expectedValue-expectedDownsidePenalty;
  const decisionRiskExpectedValue=assessmentTier==="lean"?(c.calibrationGames*riskAdjustedExpectedValue-target.resolvedMass)/(c.calibrationGames+1):minimumStressedValue;
  // The working downside transform is Lipschitz in its mean and scale. Keep
  // arithmetic resolution separate from the explicit recommendation policy.
  const decisionNumericalErrorEstimate=5*maximumError;
  const supported=decisionRiskExpectedValue>decisionNumericalErrorEstimate;
  return {release:CBB_CONTEXTUAL_RECOMMENDATION_RISK_RELEASE,policy:CBB_CONTEXTUAL_RECOMMENDATION_RISK_POLICY,context:{...c},assessmentTier,radiusMarginalStandardErrors:radius,
   nominalExpectedValue:target.expectedValue,minimumLocalExpectedValue:minimumLocalValue,minimumStressedExpectedValue:minimumStressedValue,
   marginValueSensitivity,totalValueSensitivity,workingValueSensitivityScale,expectedDownsidePenalty,riskAdjustedExpectedValue,decisionRiskExpectedValue,
   linearizationDiagnostics:{maximumAbsoluteResidual:Math.max(0,...linearizationResiduals.map(s=>Math.abs(s.residual))),residuals:linearizationResiduals},
   numericalErrorEstimate:decisionNumericalErrorEstimate,supported,priceCanSupportRecommendation,maximumPossibleStressedValue,scenarios:observations,
   reason:!priceCanSupportRecommendation?"price_return_cannot_support_declared_model_risk_even_at_certain_win":supported?"price_advantage_survives_declared_model_sensitivity":
    (assessmentTier==="best"?minimumLocalValue:riskAdjustedExpectedValue)<=decisionNumericalErrorEstimate?"price_advantage_sensitive_to_fitted_location_uncertainty":"price_advantage_too_thin_for_adverse_case_stress"};
 };
}

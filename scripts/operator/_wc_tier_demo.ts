import { deriveSoccerGrade } from "../../lib/services/soccer/soccerConfidenceGrade";
function g(edge:number, fav=true){return deriveSoccerGrade({market:"match_result",selection:"home",model_p:0.55,edge_pp:edge,model_market_agreement:true,ctx:{calibration_evidence_level:"external_priors_only",market_supports_pick:true,is_stale_market:false,is_single_source:false,is_far_from_market:false,is_short_price_dc:false,short_price_dc_market_implied_p:null,splits_provider_error:false,is_draw_pick:false,lambda_total:2.6,is_btts_yes_pick:false,lambda_min:1.2,is_match_favorite:fav,market_moving_against_pick:false}}).grade;}
console.log("MR favorite edge tiers (external_priors_only):");
for(const e of [-4,-2,-1,0,2,2.5,3,4,6]) console.log(`  edge ${e>=0?"+":""}${e}pp -> ${g(e)}`);

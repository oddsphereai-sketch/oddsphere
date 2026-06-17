import { deriveMarketImpliedLambdas } from "../../lib/services/soccer/marketImpliedLambda";
import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
const tau=-0.12;
function rates(lh:number,la:number){const j=bivariatePoissonScoreDistribution(lh,la,tau);let H=0,D=0,A=0,btts=0,over=0,tot=0;for(let h=0;h<j.length;h++)for(let a=0;a<j[h].length;a++){const p=j[h][a];tot+=p;if(h>a)H+=p;else if(h===a)D+=p;else A+=p;if(h>=1&&a>=1)btts+=p;if(h+a>2.5)over+=p;}return{H:H/tot,D:D/tot,A:A/tot,btts:btts/tot,over:over/tot};}
function show(label:string,inp:any){const r=deriveMarketImpliedLambdas(inp);if(!r.ok){console.log(`${label}: NOT ok (${r.reason})`);return;}const rr=rates(r.lambdaHome!,r.lambdaAway!);console.log(`${label}: λh=${r.lambdaHome} λa=${r.lambdaAway} | implied H=${(rr.H*100).toFixed(0)}% D=${(rr.D*100).toFixed(0)}% A=${(rr.A*100).toFixed(0)}% BTTS=${(rr.btts*100).toFixed(0)}% Over2.5=${(rr.over*100).toFixed(0)}%`);}
// even matchup
show("even 50/26/24 tot2.5", {pHome:0.40,pAway:0.35,totalLine:2.5,tau});
// median-ish balanced
show("balanced 38/28/34 tot2.5",{pHome:0.38,pAway:0.34,totalLine:2.5,tau});
// strong favorite (Switzerland-style: market home 25%? no, away fav)
show("home-fav 0.60/0.18 tot2.5",{pHome:0.60,pAway:0.18,totalLine:2.5,tau});
// the SUI@QAT case: market had Qatar(home) ~? Switzerland(away) fav. Use pHome=0.25,pAway=0.55
show("SUI@QAT-ish home0.25/away0.55 tot~2.7",{pHome:0.25,pAway:0.55,totalLine:2.7,tau});
// missing total
show("no total",{pHome:0.4,pAway:0.35,totalLine:null,tau});

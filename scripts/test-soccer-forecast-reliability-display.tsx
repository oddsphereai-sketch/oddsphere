import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SoccerThreeWayForecast} from "../app/lab/components/SoccerThreeWayForecast";
import type {DailyEdgeGameDto,MarketEdgeDto} from "../app/lab/lib/labTypes";
const golden=[
 [.65,"b158855cda9fc226aedd68c1d787c3122b2ea40808c80e0180e2a377f00ed2a4"],
 [.55,"430127ab12637a44a6c62f172f7e89aab87f9e4ee7bfb7436d73d2cb21dcdacf"],
 [.45,"a4f6b655fff123be5422811cd882c0a7d885211b3ebf0f30ed863f9b88d11b17"],
 [.35,"070f9d7371cedde2ba27dc34a431b5894e6ddbd73070edae12c9aef959946b53"],
] as const;
for(const [p,hash] of golden){
 const game={awayTeam:"ARS",homeTeam:"SLP",lockState:"locked",lockedAt:"2026-11-03T19:00:00Z"} as DailyEdgeGameDto;
 const market={soccerMatchResultContext:{displayed_side:"away",model:{away:p,draw:(1-p)/2,home:(1-p)/2},market:{away:.6,draw:.2,home:.2}}} as MarketEdgeDto;
 const before=JSON.stringify({game,market});
 const html=renderToStaticMarkup(createElement(SoccerThreeWayForecast,{game,market}));
 assert.equal(createHash("sha256").update(html).digest("hex"),hash,"legacy captured forecast markup is exact after removing only the global never-stored r2 paragraph");
 for(const release of ["ucl_goals_coherent_2026_11_04_r22_current_strength_scoring_prior","epl_goals_coherent_2026_10_31_r23_partial_price_publication"]){
  const open={...game,lockState:"open",lockedAt:null,soccerModelProvenance:{release}} as unknown as DailyEdgeGameDto;
  const current=renderToStaticMarkup(createElement(SoccerThreeWayForecast,{game:open,market}));
  assert(!current.includes("untouched final quarter"));assert(!current.includes("model-probability band won"),"an unbound historical result cannot claim current release reliability");
  assert(current.includes((p*100).toFixed(1)+"%"),"actual current probabilities remain visible");
  const newlyLocked=renderToStaticMarkup(createElement(SoccerThreeWayForecast,{game:{...open,lockState:"locked",lockedAt:"2026-11-05T19:00:00Z"},market}));
  assert.equal(newlyLocked,current,"a future real lock cannot gain unrelated historical evidence");
  const elapsed=renderToStaticMarkup(createElement(SoccerThreeWayForecast,{game:{...open,lockState:"locked"},market}));
  assert(!elapsed.includes("model-probability band won"),"a calculated elapsed flag is not a stored legacy lock");
 }
 assert.equal(JSON.stringify({game,market}),before,"rendering never alters stored forecasts or market fields");
}
console.log("PASS soccer confidence display: no unbound r2 performance on current releases; exact four-band stored-forecast markup and input immutability");

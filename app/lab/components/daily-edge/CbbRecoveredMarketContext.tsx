import React from "react";
import type {DailyEdgeGameDto} from "../../lib/labTypes";

const odds=(value:number)=>value>0?`+${value}`:String(value);
const line=(value:number)=>value>0?`+${value}`:String(value);

/** Historical source context is kept separate from the frozen model wager. */
export function CbbRecoveredMarketContext({game,market}:{game:DailyEdgeGameDto;market:"moneyline"|"total"|"first_inning"}){
  const recovery=game.cbbRecoveredMarketData;
  if(game.sport!=="cbb"||!game.lockedAt||!recovery)return null;
  const row=recovery.markets.find(row=>row.market===(market==="first_inning"?"spread":market));
  if(!row)return null;
  const home=game.cbbHomeCollege??game.homeTeam,away=game.cbbAwayCollege??game.awayTeam;
  const first=market==="total"?`Over ${row.line}`:`${home}${row.line===null?"":` ${line(row.line)}`}`;
  const second=market==="total"?`Under ${row.line}`:`${away}${row.line===null?"":` ${line(-row.line)}`}`;
  const at=new Date(row.observedAt).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"});
  return <section aria-label="Recovered pre-lock market data" className="my-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-gray-300">
    <p className="font-semibold">Pinnacle · Recovered pre-lock odds</p>
    <p className="tabular-nums">{first} ({odds(row.firstPrice)}) · {second} ({odds(row.secondPrice)})</p>
    <p className="mt-1 text-[10px] text-gray-500">Observed {at} ET; retrieved after lock. Original prediction and grades retained.</p>
  </section>;
}

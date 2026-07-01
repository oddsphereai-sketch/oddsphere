/* Track A Step 2 — collect ESPN box scores for BDL games (resumable, cached).
   Matches BDL game -> ESPN event by date + final score. Writes per-game team+player
   box stats to espn-features.jsonl. Safe to re-run; skips already-collected games. */
import fs from "fs";
const SB="https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";
const CACHE="wnba-research/espn-cache"; const OUT="wnba-research/espn-features.jsonl";
fs.mkdirSync(CACHE,{recursive:true});
type G={id:number;date:string;season:number;post:boolean;h:number;a:number;hs:number;as:number};
async function jget(u:string,cacheFile:string){ if(fs.existsSync(cacheFile)){try{return JSON.parse(fs.readFileSync(cacheFile,"utf8"));}catch{}}
  try{const r=await fetch(u); if(!r.ok)return null; const j=await r.json(); fs.writeFileSync(cacheFile,JSON.stringify(j)); return j;}catch{return null;} }
const num=(s:any)=>{const n=parseFloat(String(s).split("-")[0]); return isNaN(n)?null:n;};
function teamStat(t:any,name:string){ const s=(t.statistics||[]).find((x:any)=>x.name===name); return s?s.displayValue:null; }
function parsePair(v:string|null){ if(!v)return[null,null]; const [a,b]=v.split("-").map(x=>parseInt(x)); return [a,b]; }
(async()=>{
  const games:G[]=JSON.parse(fs.readFileSync("wnba-research/games.json","utf8")).filter((g:G)=>g.season>=2022);
  const done=new Set<number>();
  if(fs.existsSync(OUT)) for(const l of fs.readFileSync(OUT,"utf8").split("\n")) if(l.trim()){try{done.add(JSON.parse(l).gameId);}catch{}}
  console.log(`target games(2022+): ${games.length}, already done: ${done.size}`);
  const shift=(d:string,n:number)=>{const dt=new Date(d+"T12:00:00Z");dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10);};
  // fetch scoreboards for every game date AND its ±1 neighbors (BDL UTC vs ESPN ET off-by-one)
  const baseDates=[...new Set(games.map(g=>g.date))];
  const allDates=[...new Set(baseDates.flatMap(d=>[shift(d,-1),d,shift(d,1)]))];
  const evByDate=new Map<string,any[]>();
  let dcount=0;
  for(const d of allDates){ const yyyymmdd=d.replace(/-/g,"");
    const sb=await jget(`${SB}/scoreboard?dates=${yyyymmdd}`,`${CACHE}/sb-${yyyymmdd}.json`);
    const evs=(sb?.events||[]).map((e:any)=>{const c=e.competitions?.[0]; const home=c?.competitors?.find((x:any)=>x.homeAway==="home"); const away=c?.competitors?.find((x:any)=>x.homeAway==="away");
      return {id:e.id, hs:parseInt(home?.score), as:parseInt(away?.score)};});
    evByDate.set(d,evs); if(++dcount%80===0)console.log(`  scoreboards ${dcount}/${allDates.length}`);
  }
  let written=0,matched=0,unmatched=0;
  const stream=fs.createWriteStream(OUT,{flags:"a"});
  for(const g of games){ if(done.has(g.id))continue;
    // exact home/away score match across date-1/date/date+1 (keeps home/away aligned)
    const cands=[...(evByDate.get(g.date)||[]),...(evByDate.get(shift(g.date,-1))||[]),...(evByDate.get(shift(g.date,1))||[])];
    const ev=cands.find(e=>e.hs===g.hs&&e.as===g.as);
    if(!ev){unmatched++;continue;}
    const sum=await jget(`${SB}/summary?event=${ev.id}`,`${CACHE}/sum-${ev.id}.json`);
    const bs=sum?.boxscore; if(!bs?.teams){unmatched++;continue;}
    const tm=(idx:number)=>{const t=bs.teams[idx]; const fg=parsePair(teamStat(t,"fieldGoalsMade-fieldGoalsAttempted")); const tp=parsePair(teamStat(t,"threePointFieldGoalsMade-threePointFieldGoalsAttempted")); const ft=parsePair(teamStat(t,"freeThrowsMade-freeThrowsAttempted"));
      return {fgm:fg[0],fga:fg[1],tpm:tp[0],tpa:tp[1],ftm:ft[0],fta:ft[1],oreb:num(teamStat(t,"offensiveRebounds")),dreb:num(teamStat(t,"defensiveRebounds")),tov:num(teamStat(t,"turnovers"))||num(teamStat(t,"totalTurnovers")),ast:num(teamStat(t,"assists")),homeAway:t.homeAway};};
    const teams=[tm(0),tm(1)];
    // player minutes concentration (top-heaviness) from players section
    let starConc=null;
    try{ const ps=bs.players?.[0]; const a=ps?.statistics?.[0]?.athletes||[]; const mins=a.map((x:any)=>parseFloat(x.stats?.[0]||"0")).filter((x:number)=>x>0).sort((p:number,q:number)=>q-p); const tot=mins.reduce((s:number,v:number)=>s+v,0); starConc=tot?mins.slice(0,3).reduce((s:number,v:number)=>s+v,0)/tot:null; }catch{}
    stream.write(JSON.stringify({gameId:g.id,date:g.date,season:g.season,eventId:ev.id,teams,starConc})+"\n");
    written++; matched++;
    if(written%100===0)console.log(`  collected ${written} (unmatched ${unmatched})`);
  }
  stream.end();
  console.log(`DONE: written=${written} matched=${matched} unmatched=${unmatched} total done now=${done.size+written}`);
})();

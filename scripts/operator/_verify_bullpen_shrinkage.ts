import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
const P=(s:any,n:number)=>{const t=String(s??"—");return t.length>=n?t.slice(0,n):t+" ".repeat(n-t.length);};
(async()=>{
  const { buildFeatureSnapshots } = await import("../../lib/automodel/featureSnapshot");
  const isoToday = new Date().toISOString().slice(0,10);
  const snaps = await buildFeatureSnapshots("mlb", isoToday);
  console.log(`built ${snaps.length} snapshots for ${isoToday}\n`);
  const AVG=4.0;
  let inRange=0, rescued=0, total=0, maxDelta=0;
  console.log(`${P("matchup",10)}${P("team",6)}${P("rawERA",8)}${P("shrunkERA",10)}${P("ip",7)}${P("rawFactor",10)}${P("shrunkF",9)}${P("inRange?",9)}`);
  for(const s of snaps as any[]){
    for(const side of ["away_team","home_team"] as const){
      const t=s[side]; if(!t) continue;
      const raw=t.bullpen_era_proxy_raw, shrunk=t.bullpen_era_proxy, ip=t.bullpen_ip;
      if(raw==null && shrunk==null) continue;
      total++;
      const rawF = raw!=null ? raw/AVG : null;
      const shrunkF = shrunk!=null ? shrunk/AVG : null;
      const inR = shrunkF!=null && shrunkF>=0.5 && shrunkF<=2.0;
      if(inR) inRange++;
      if(rawF!=null && (rawF<0.5||rawF>2.0) && inR) rescued++;
      if(rawF!=null&&shrunkF!=null) maxDelta=Math.max(maxDelta,Math.abs(shrunkF-rawF));
      console.log(`${P(s.matchup??s.game_external_id,10)}${P(t.abbreviation,6)}${P(raw?.toFixed(2),8)}${P(shrunk?.toFixed(2),10)}${P(ip?.toFixed(0),7)}${P(rawF?.toFixed(3),10)}${P(shrunkF?.toFixed(3),9)}${P(inR?"yes":"NO",9)}`);
    }
  }
  console.log(`\nsummary: ${inRange}/${total} shrunk factors in [0.5,2.0]; ${rescued} rescued from out-of-range; max |Δfactor|=${maxDelta.toFixed(3)}`);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});

/* Tests for selectMainTotalLine — consensus modal line, blocked-book + alt-line safe.
   Run: npx tsx scripts/test-select-main-total-line.ts */
import { selectMainTotalLine } from "../lib/services/selectMainTotalLine";
let pass=0,fail=0; const F:string[]=[];
const ck=(l:string,ok:boolean,d?:string)=>{ok?(pass++,console.log("  ✓ "+l)):(fail++,F.push(l+(d?" — "+d:"")),console.log("  ✗ "+l+(d?" — "+d:"")));};
const R=(sb:string,lv:number|null)=>({sportsbook:sb,line_value:lv});
const S=(sb:string,lv:number,side:"over"|"under",fetched_at:string)=>({sportsbook:sb,line_value:lv,side,fetched_at});

// HOU/TOR: pinnacle 9.5/10 outlier (juiced) vs 8.5 consensus (4 books) → 8.5
{ const lines=[R("pinnacle",9.5),R("pinnacle",10),R("betmgm",8.5),R("betrivers",8.5),R("ballybet",8.5),R("splits_consensus",8.5)];
  ck("HOU/TOR: picks 8.5 consensus (not pinnacle 9.5/10)", selectMainTotalLine(lines)===8.5, String(selectMainTotalLine(lines))); }
// blocked books ignored even if numerous
{ const lines=[R("fliff",7.5),R("fliff",7.5),R("kalshi",7.5),R("pinnacle",8.5),R("draftkings",8.5)];
  ck("blocked books (fliff/kalshi) excluded → 8.5", selectMainTotalLine(lines)===8.5, String(selectMainTotalLine(lines))); }
// stale line clusters should not beat the fresher main market at lock
{ const lines=[
    S("betmgm",11.5,"over","2026-07-11T18:00:59.100Z"),
    S("betmgm",11.5,"under","2026-07-11T18:00:59.100Z"),
    S("betrivers",11.5,"over","2026-07-11T18:00:59.100Z"),
    S("betrivers",11.5,"under","2026-07-11T18:00:59.100Z"),
    S("bet365 us",8.5,"over","2026-07-11T19:07:21.953Z"),
    S("bet365 us",8.5,"under","2026-07-11T19:07:21.953Z"),
    S("splits_consensus",8.5,"over","2026-07-11T18:49:36.916Z"),
    S("splits_consensus",8.5,"under","2026-07-11T18:49:36.916Z"),
  ];
  ck("MIL/PIT: fresher 8.5 cluster beats stale 11.5 two-book cluster", selectMainTotalLine(lines)===8.5, String(selectMainTotalLine(lines))); }
// clean unanimous
{ ck("unanimous 9.0 → 9.0", selectMainTotalLine([R("a",9),R("b",9),R("c",9)])===9.0); }
// tie → modal nearest median
{ const lines=[R("a",8),R("b",8),R("c",9),R("d",9),R("e",8.5)]; // 8 and 9 tie at 2; median of {8,8.5,9}=8.5 → nearest is 8 or 9 (both 0.5) → first
  const r=selectMainTotalLine(lines); ck("tie resolves to a modal value", r===8||r===9, String(r)); }
// null/empty
{ ck("no lines → null", selectMainTotalLine([])===null); }
{ ck("all null line_value → null", selectMainTotalLine([R("a",null),R("b",null)])===null); }
// single divergent trusted book is still returned if it's all we have
{ ck("single book → that line", selectMainTotalLine([R("pinnacle",9.5)])===9.5); }
console.log(`\n  ${pass} pass · ${fail} fail`); if(fail){console.log("FAILURES:\n"+F.map(x=>"  - "+x).join("\n"));process.exit(1);}
console.log("✅ selectMainTotalLine tests passed.");

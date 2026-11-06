/** Frozen R29 -> R30 stored-input replay. No DB, provider or prediction writes.
 * --capture=/absolute/records.json --out=/absolute/impact.json */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gradeNbaMarket,gradeNbaR29MarketForAudit,type GradeInput} from "../../lib/services/nba/nbaMarketReview";
import {pairedNbaOpposingPrice,type NbaLineRow} from "../../lib/services/nba/nbaMarketIntelligence";
const flag=(k:string)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3);
const path=flag("capture"),out=flag("out");if(!path||!out)throw Error("Supply --capture and --out");
const bytes=readFileSync(path,"utf8"),nba=JSON.parse(bytes),before=JSON.stringify(nba);
const models=[...new Set(nba.map((r:any)=>r.model_version))];assert.equal(models.length,1,"Do not blend numerical model releases");
const nbaRows: any[] = [], seen = new Set<number>();
for (const stored of nba) {
  if (stored.locked_at !== null || seen.has(stored.game_id)) continue;
  seen.add(stored.game_id);
  const g = stored.snapshot_json.nba_game_dto_at_capture;
  for (const slot of ["ml", "spread", "total"] as const) {
    const m = g.intelligence[slot], market = m.market;
    const selectedLine = market === "moneyline" ? null : m.consensus_line;
    const prices: NbaLineRow[] = [...m.per_book_pick_side, ...m.per_book_other_side].map((r: any) => ({ ...r, market_type: market }));
    const selected = prices.find(r => r.sportsbook === m.current_price.sportsbook && r.side === m.pick_side &&
      r.odds_american === m.current_price.odds_american && r.line_value === selectedLine &&
      Date.parse(r.fetched_at ?? "") === Date.parse(m.current_price.fetched_at));
    const input: GradeInput = { market, pick: m.pick_side, confidence: m.model_confidence, band: m.conflict_band,
      edge: market === "moneyline" ? (m.edge_prob_pp ?? 0) / 100 : (m.edge_points ?? 0) / (market === "spread" ? 10 : 15),
      dataQualityTier: g.data_quality_tier, injuriesKnown: g.injuries.home_known && g.injuries.away_known,
      modelProbabilityOnPick: m.model_prob_on_pick, currentPriceAmerican: m.current_price.odds_american,
      pairedOpposingPriceAmerican: pairedNbaOpposingPrice(prices, selected ?? null), namedBookPosture: m.named_book_posture };
    const previous = gradeNbaR29MarketForAudit(input), next = gradeNbaMarket(input);
    assert.equal(previous.grade, m.grade, `${g.matchup}/${market}: current R29 reproduction failed`);
    nbaRows.push({ gameId: g.game_external_id, matchup: g.matchup, market, previous: previous.grade, next: next.grade,
      probability: m.model_prob_on_pick, price: m.current_price.odds_american, opposingPrice: input.pairedOpposingPriceAmerican,
      expectedValue: m.model_prob_on_pick * (input.currentPriceAmerican! > 0 ? input.currentPriceAmerican! / 100 : 100 / -input.currentPriceAmerican!) - (1 - m.model_prob_on_pick),
      qualificationBasis: next.qualificationBasis ?? "existing_value_and_evidence_policy", rationale: next.rationale });
  }
}

assert.equal(JSON.stringify(nba),before,"Captured source payloads changed");
const count=(v:string[])=>v.reduce<Record<string,number>>((a,x)=>(a[x]=(a[x]??0)+1,a),{});
const active=(g:string)=>g==="best_angle"||g==="lean";
const report={at:new Date().toISOString(),captureSha256:createHash("sha256").update(bytes).digest("hex"),models,
 sourceAsOf:[...new Set(nba.map((r:any)=>r.snapshot_json.as_of))],games:seen.size,markets:nbaRows.length,
 before:count(nbaRows.map(r=>r.previous)),after:count(nbaRows.map(r=>r.next)),
 promotions:nbaRows.filter(r=>!active(r.previous)&&active(r.next)).length,demotions:nbaRows.filter(r=>active(r.previous)&&!active(r.next)).length,
 bestToLean:nbaRows.filter(r=>r.previous==="best_angle"&&r.next==="lean").length,changed:nbaRows.filter(r=>r.previous!==r.next),
 providerCalls:0,productionWrites:0,modelFits:0,unchangedSourceInputs:true,
 limits:"Stored canonical writer capture only; independently refreshed member snapshots may use different inputs. This is qualification consistency, not accuracy evidence."};
writeFileSync(out,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));

import assert from "node:assert/strict";
import { fitUclOpponentModel } from "../lib/services/ucl/uclModel";
import { deriveUclStrengthScoreJoint } from "../lib/services/ucl/uclEloConsensus";
import { canonicalUclEloFoundation, uclEloPair, normalizeUclEloClub, type UclEloStrengthFoundationPayload } from "../lib/services/ucl/uclEloStrengthFoundation";
import { bivariatePoissonScoreDistribution } from "../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../lib/services/soccer/soccerMarketProbabilities";
import type { EplTrainingMatch } from "../lib/services/epl/eplShadowModel";

export function testUclOpponentStrengthScoreLaw() {
  let id = 1;
  const rows:EplTrainingMatch[]=[];
  for(let repeat=0;repeat<8;repeat++)for(const[h,a,hg,ag]of[[1,2,1,0],[3,4,1,0],[2,4,4,0],[2,3,3,0],[4,1,0,3]]){
    rows.push({id:id++,date:`2026-10-${String(repeat+1).padStart(2,'0')}T12:00:00Z`,season:2026,
      name:'Test fixture',short_name:'A @ H',home_team_id:h!,away_team_id:a!,home_score:hg!,away_score:ag!,
      home_xg:null,away_xg:null,status:'STATUS_FULL_TIME',status_state:'final',status_detail:'FT',
      venue_name:null,venue_city:null,round_number:null});
  }
  const fit=fitUclOpponentModel(rows,'2026-11-04T17:45:00Z');
  assert.equal(fit.opponentFit?.converged,true);
  assert.equal(fit.opponentFit?.uniqueMatches,rows.length);
  assert.ok(fit.strengths.get(1)!.homeAttack>fit.strengths.get(3)!.homeAttack,
    'scoring against the stronger defense is distinguished from raw scoring against weak opponents');
  assert.equal(fit.strengths.get(1)!.homeAttack,fit.strengths.get(1)!.awayAttack,'shared club attack, not sparse separate venue estimates');
  const duplicate=fitUclOpponentModel([...rows,...rows],'2026-11-04T17:45:00Z');
  assert.deepEqual(duplicate,fit,'identical provider fixtures are counted once');
  assert.throws(()=>fitUclOpponentModel([...rows,{...rows[0]!,home_score:9}],'2026-11-04T17:45:00Z'),/Conflicting UCL scoring fixture/,
    'contradictory duplicates cannot silently pick a new training label');
  const future=fitUclOpponentModel([...rows,{...rows[0]!,id:999,date:'2026-11-05T12:00:00Z',home_score:100,away_score:100}], '2026-11-04T17:45:00Z');
  assert.deepEqual(future,fit,'future labels cannot change independent inputs');
  const zero=fitUclOpponentModel(rows.map(r=>({...r,home_score:0,away_score:0})),'2026-11-04T17:45:00Z');
  assert.equal(zero.opponentFit?.converged,true);
  assert.ok([...fit.strengths.values()].every(s=>Number.isFinite(s.homeAttack)&&s.homeAttack>0&&Number.isFinite(s.homeDefense)&&s.homeDefense>0));

  const base=bivariatePoissonScoreDistribution(1.5,1.5,-.1);
  const strong=deriveUclStrengthScoreJoint(base,{homeLocal:1900,awayLocal:1400,homePublic:1950,awayPublic:1450,
    homeGames:100,awayGames:100,sourceRelease:'ucl_elo_strength_foundation_2026_11_04_r2_canonical_club_lineages'});
  const before=deriveSoccerMarketProbabilities({joint:base,totalLine:2.5}),after=deriveSoccerMarketProbabilities({joint:strong,totalLine:2.5});
  assert.ok(after.match_result.home>before.match_result.home);
  assert.ok(after.btts.yes<before.btts.yes-.01,'strength separation changes clean-sheet and BTTS probability');
  assert.ok(Math.abs(after.total.over-before.total.over)<.003,
    'Elo primarily reallocates scoring; the opponent-adjusted fit owns total level (small truncated-tail differences remain)');
  assert.ok(Math.abs(strong.flat().reduce((s,p)=>s+p,0)-1)<1e-10);
  assert.ok(strong.flat().every(p=>Number.isFinite(p)&&p>=0));

  const legacy:UclEloStrengthFoundationPayload={schemaVersion:1,
    release:'ucl_elo_strength_foundation_2026_10_14_r1_local_public_consensus',generatedAt:'2026-10-28T17:47:39Z',
    domesticMatches:11113,uclMatches:401,clubs:{aek:{localElo:1708,localGames:107,publicElo:1614},
      'aek athens':{localElo:1494,localGames:3,publicElo:null},'real madrid':{localElo:1757,localGames:142,publicElo:1932},
      lask:{localElo:1500,localGames:0,publicElo:1458},'lask linz':{localElo:1502,localGames:3,publicElo:null},
      viking:{localElo:1500,localGames:0,publicElo:1519},'viking fk':{localElo:1493,localGames:3,publicElo:null}}};
  const unchanged=JSON.stringify(legacy),migrated=canonicalUclEloFoundation(legacy);
  assert.equal(JSON.stringify(legacy),unchanged,'old raw foundation is immutable');
  assert.equal(migrated.generatedAt,legacy.generatedAt,'migration cannot refresh source time');
  assert.equal(Object.keys(migrated.clubs).length,4);
  assert.equal(migrated.clubs.aek!.localGames,107,'select an intact lineage; never add games or average ratings');
  const pair=uclEloPair(legacy,'AEK Athens','Real Madrid');
  assert.equal(pair.homeLocal,1708);assert.equal(pair.homePublic,1614);assert.equal(pair.awayPublic,1932);
  assert.equal(uclEloPair(legacy,'LASK Linz','Viking FK').homePublic,1458);
  assert.equal(normalizeUclEloClub('Viking FK'),'viking');
  const noPublic=deriveUclStrengthScoreJoint(base,{...pair,homePublic:null});
  const noPublicOther=deriveUclStrengthScoreJoint(base,{...pair,homePublic:null,awayPublic:9999});
  assert.deepEqual(noPublic,noPublicOther,'a missing paired public rating cannot create a comparison across incompatible scales');
  console.log('PASS UCL opponent-adjusted fit, source cutoff/deduplication, scoring separation, alias lineage and public/local scale contracts.');
}

if(process.argv[1]?.endsWith('test-ucl-opponent-strength-score-law.ts'))testUclOpponentStrengthScoreLaw();

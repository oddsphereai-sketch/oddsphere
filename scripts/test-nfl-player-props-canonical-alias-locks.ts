import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const deny = () => { throw Error('Round62 network denial'); };
globalThis.fetch = deny;
http.get = http.request = https.get = https.request = deny;
net.connect = net.createConnection = tls.connect = deny;

async function main(){
Object.assign(process.env,{NODE_ENV:"test"});

const currentLock = await import('../lib/playerPropsAi/nflLockAuthority');

const currentPub = await import('../lib/services/football/nflPlayerPropsProductionContract');
const store = await import('../lib/services/football/nflPlayerPropsSnapshotStore');
let checks=0;

for (const c of [
  {id:'33934589',full:'Matt Hibner',alias:'Matthew Hibner',team:'BAL'},
  {id:'13873931',full:'Cam Ward',alias:'Cameron Ward',team:'TEN'},
  {id:'697',full:'Bam Knight',alias:'Zonovan Knight',team:'ARI'},
]) {
  const at='2030-11-17T19:50:00Z', ready='2030-11-17T19:51:00Z';
  const start='2030-11-17T21:00:00Z', lock='2030-11-17T20:00:00Z';
  const now='2030-11-17T20:01:00Z', context={featureAsOf:at};
  const row={
    gameId:'game', providerPlayerId:c.id, playerName:c.full, team:c.team,
    opponent:'CHI', scheduledStart:start, market:'receptions', line:3.5,
    side:'over', sportsbook:'old-book', provider:'balldontlie',
    americanPrice:110, observedAt:at, bookEvidence:[], lockAt:lock,
    state:'locked', roleFingerprint:'old-role', projection:4.125,
    projectionRange:null, forecastContext:context, participationProbability:.9,
    rawModelProbability:.65, marketProbability:.5, finalProbability:.57,
    probabilityEdge:.07, expectedValue:.197, grade:'Lean',
    marketMovement:'neutral', healthHolds:[], provisional:false,
    modelRelease:'synthetic-model', calibrationRelease:'old-calibration',
    decisionRelease:'old-decision',
  } as unknown as Parameters<ReturnType<typeof currentLock.testNflHandoffCapture>>[0][number];
  const candidate={...row,state:'unlocked' as const,playerName:c.alias,
    projection:5.125,finalProbability:.61};
  const q={
    id:'q',playerId:'nfl-bdl-player:'+c.id,market:'receptions',line:3.5,
    side:'over',book:'old-book',provider:'balldontlie',american:110,
    observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response',
    opening:false,live:false,
  };
  const packet={
    release:'player_props_ai_offline_full_product_2026_11_06_r1',
    sport:'nfl',gameId:'game',start,lock,stage:'final',cutoff:at,
    quotes:[q],executionQuotes:[q],sourceLimitations:[],
    players:[{
      id:'nfl-bdl-player:'+c.id,name:c.full,team:c.team,opponent:'CHI',
      markets:['receptions'],missing:[],
      evidence:[{id:'native',kind:'independent_model',
        source:'synthetic-model',availableAt:at,
        value:{market:'receptions',context}}],
    }],
  };
  const board=(rows:typeof row[])=>({
    release:'synthetic-board',generatedAt:now,evaluatedAt:now,decisions:rows,
    counts:{'Best Angle':0,Lean:rows.length,Watchlist:0,'No Play':0,Held:0},
    diagnostics:{},
  } as unknown as Parameters<typeof currentPub.reconcileNflPlayerPropsProductionSnapshot>[0]['nextBoard']);
  const previous={
    release:'synthetic',season:2030,week:11,
    generatedAt:'2030-11-17T20:00:01Z',
    writerLeaseGroup:'prediction_pipeline:nfl',
    publicationEligible:true,trackingEligible:true,
    board:board([row]),memberDecisions:[row],lifecycle:{},
  } as unknown as NonNullable<Parameters<typeof currentPub.reconcileNflPlayerPropsProductionSnapshot>[0]['previous']>;
  const capture=currentLock.testNflHandoffCapture(()=>ready);
  const h=capture([candidate],packet as Parameters<typeof capture>[1],null,'native');
  assert.equal(h.nativeProofs.length,1);checks++;
  const reconcile=(prev:unknown=previous,rows=[candidate],handoff:typeof h|undefined=undefined)=>currentPub.reconcileNflPlayerPropsProductionSnapshot({season:2030,week:11,evaluatedAt:now,previous:prev as typeof previous,nextBoard:board(rows),lockHandoff:handoff});
  const original=JSON.stringify(previous);
  const r=reconcile(previous,[candidate],h);
  assert.deepEqual(r.board.decisions,[row]);checks++;
  assert.deepEqual(r.memberDecisions,[row]);checks++;
  assert.equal(currentPub.buildNflPlayerPropsMemberSnapshot(r,now).memberDecisions.length,1);checks++;
  assert.equal(JSON.stringify(previous),original);checks++;
  const duplicate={...row,sportsbook:'second-book',projection:3.125};
  const historical={...previous,board:board([row,row,duplicate]),memberDecisions:[duplicate,row,row]};
  const preserved=reconcile(historical,[candidate],h);
  assert.deepEqual(preserved.board.decisions,[row,row,duplicate]);checks++;
  assert.deepEqual(preserved.memberDecisions,[duplicate,row,row]);checks++;
  assert.deepEqual(currentPub.buildNflPlayerPropsMemberSnapshot(preserved,now).memberDecisions,[duplicate,row,row]);checks++;
  // Even a prior unlocked alias cannot re-enter behind the stored first lock.
  const oldUnlocked={...previous,board:board([row,candidate]),memberDecisions:[row]};
  assert.deepEqual(reconcile(oldUnlocked,[]).board.decisions,[row]);checks++;
  // A different exact actor/event remains independently eligible. Name guard
  // behavior is unchanged; use the newly recognized alternate spelling here.
  for(const delta of [{providerPlayerId:'other-id'},{providerPlayerId:null},{providerPlayerId:''},{gameId:'other-game'},{team:'NYJ'},{opponent:'MIA'},{scheduledStart:'2030-11-17T22:00:00Z'},{lockAt:'2030-11-17T19:59:00Z'},{market:'receiving_yards' as const},{side:'under' as const}]){
    const next={...candidate,...delta};
    assert.equal(reconcile(previous,[next]).board.decisions.length,2,JSON.stringify(delta));checks++;
  }
  for(const id of [null,'']){
    const legacy={...row,providerPlayerId:id};
    const p={...previous,board:board([legacy]),memberDecisions:[legacy]};
    assert.equal(reconcile(p,[candidate]).board.decisions.length,2);checks++;
    assert.deepEqual(reconcile(p,[{...candidate,playerName:row.playerName}]).board.decisions,[legacy]);checks++;
  }
  // UTC formatting equivalence is the same event, while different instants above
  // are not collapsed. All lines/books of the already locked outcome stay owned.
  for(const delta of [{scheduledStart:'2030-11-17T21:00:00.000Z',lockAt:'2030-11-17T20:00:00.000Z'},{line:4.5},{sportsbook:'new-book'}]){
    assert.deepEqual(reconcile(previous,[{...candidate,...delta}]).board.decisions,[row]);checks++;
  }
  for(const reverse of [false,true]){
    for(const aliases of [false,true]){
      const old={...row,state:'unlocked' as const,playerName:reverse?c.alias:c.full,
        team:aliases&&c.team==='ARI'?'AZ':c.team,opponent:aliases?'JAC':'JAX'};
      const next={...candidate,playerName:reverse?c.full:c.alias,team:c.team,opponent:'JAX'};
      const input={...packet,players:packet.players.map(p=>({...p,opponent:'JAX'}))};
      const pre={...previous,generatedAt:'2030-11-17T19:55:00Z',board:board([old]),memberDecisions:[old]};
      const handoff=capture([next],input as Parameters<typeof capture>[1],null,'native');
      assert.equal(handoff.nativeProofs.length,1);checks++;
      const first=reconcile(pre,[next],handoff);
      assert.equal(first.board.decisions.length,1);checks++;
      assert.equal(currentPub.buildNflPlayerPropsMemberSnapshot(first,now).memberDecisions.length,1);checks++;
      assert.equal(currentPub.buildNflPlayerPropsTrackingEntries(first).length,1);checks++;
      const locked={...old,state:'locked' as const};
      const priorLock={...pre,board:board([locked]),memberDecisions:[locked]};
      const kept=reconcile(priorLock,[next],handoff);
      assert.deepEqual(kept.board.decisions,[locked]);checks++;
      assert.deepEqual(kept.memberDecisions,[locked]);checks++;
    }
  }
  const legacySnapshot={...historical,release:'nfl_player_props_member_2026_11_10_r60_current_execution_authority'};
  const decoded=store.decodeNflPlayerPropsSnapshotPayload(legacySnapshot);
  assert.ok(decoded);assert.deepEqual(decoded.memberDecisions,historical.memberDecisions);checks++;
  assert.equal(decoded.release,legacySnapshot.release);checks++;
}
console.log(`Canonical locked alias precedence: ${checks} checks passed; no network or stored-row changes.`);

}
main().catch(error=>{console.error(error);process.exitCode=1;});

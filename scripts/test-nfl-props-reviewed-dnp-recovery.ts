/** No network or database operations. The fixture tests exact owner-reviewed source binding. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function main(){
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:9';process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test-service';
 const {reviewedDnpProposal}=await import('./operator/recover-nfl-props-settlement-identities');
 const path=join(tmpdir(),`nfl-dnp-binding-test-${process.pid}.pdf`),bytes=Buffer.from('%PDF-1.7\nsynthetic binding fixture; not an actual gamebook\n');
 writeFileSync(path,bytes,{flag:'wx'});
 try{
  const row={id:1,provider_game_id:'100',provider_player_id:'7',player_name:'Example Player',team:'SEA',result:'pending',snapshot_json:{projection:2.718,probability:.5678,grade:'Lean',price:-113}};
  const source={id:1,gameId:'100',playerId:'7',playerName:'Example Player',team:'SEA',sourceUrl:'https://static.www.nfl.com/image/upload/fixture.pdf',sourcePath:path,sourceSha256:createHash('sha256').update(bytes).digest('hex'),reviewedPage:1,providerConflict:true};
  const before=JSON.stringify(row);assert.deepEqual(reviewedDnpProposal(row,source),{id:1,gameId:'100',resolvedPlayerId:'7',actual:null,result:'void'});assert.equal(JSON.stringify(row),before);
  for(const invalid of [{...source,id:2},{...source,gameId:'101'},{...source,playerId:'8'},{...source,playerName:'Other Player'},{...source,team:'ARI'},{...source,sourceUrl:'https://example.com/fixture.pdf'},{...source,sourceUrl:'http://static.www.nfl.com/fixture.pdf'},{...source,sourceSha256:'0'.repeat(64)},{...source,reviewedPage:0}])assert.throws(()=>reviewedDnpProposal(row,invalid),/bind|changed/);
  writeFileSync(path,Buffer.from('%PDF-1.7\nchanged source'));assert.throws(()=>reviewedDnpProposal(row,source),/changed/);
  assert.equal(JSON.stringify(row),before,'recovery proof never mutates original lock or source fields');
 }finally{unlinkSync(path);}
 console.log('Reviewed NFL DNP recovery: exact source bytes/game/player/team, outcome-only proposal, conflict disclosure and original lock preservation passed; zero network.');
}
void main().catch(e=>{console.error(e);process.exitCode=1});

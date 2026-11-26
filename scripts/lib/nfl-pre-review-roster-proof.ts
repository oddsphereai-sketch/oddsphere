import assert from 'node:assert/strict';
import {needsNflPreReviewRoster,nflPreReviewRosterDueGames,withNflPreReviewRosterCaptures} from '../../lib/services/football/nflPreReviewRosterFreshness';
import {determineNflForwardCollectionNeed,planNflForwardEvidenceCaptures,type NflForwardStoredEvidence} from '../../lib/services/football/nflForwardEvidence';
import {fetchBalldontlieNflTeamDepthSnapshots} from '../../lib/services/football/balldontlieNflRoster';
import {resolveNflPropSourcePlayer} from '../../lib/playerPropsAi/nflPlayerIdentity';
import {reviewSlots} from '../../lib/playerPropsAi/schedule';

export async function proveNflPreReviewRosterSources() {
  const start = '2026-11-26T21:30:00Z', old = '2026-11-24T05:06:11Z';
  const check = (now: string, capturedAt: string | null = old) =>
    needsNflPreReviewRoster({start, now, capturedAt});
  assert.equal(check('2026-11-26T13:14:59.999Z'), false);
  assert.equal(check('2026-11-26T13:15:00Z'), true);
  assert.equal(check('2026-11-26T13:21:00Z', '2026-11-26T13:15:00Z'), false);
  assert.equal(check('2026-11-26T19:49:59.999Z', '2026-11-26T13:21:00Z'), false);
  assert.equal(check('2026-11-26T19:50:00Z', '2026-11-26T13:21:00Z'), true);
  assert.equal(check('2026-11-26T20:06:00Z', '2026-11-26T19:51:00Z'), false);
  assert.equal(check('2026-11-26T20:29:59Z', null), true);
  assert.equal(check('2026-11-26T20:30:00Z', null), false);
  assert.equal(check('2026-11-26T20:31:00Z', old), false);
  assert.equal(check('2026-11-26T19:51:00Z', '2026-11-26T19:52:00Z'), true);
  assert.equal(check('2026-11-26T19:51:00Z', 'invalid'), true);
  assert.equal(check('2026-11-26T19:51:00Z', '2026-11-26T19:50:00'), true);
  assert.equal(needsNflPreReviewRoster({start:'invalid',now:old,capturedAt:null}), false);
  assert.equal(needsNflPreReviewRoster({start:'2026-11-27T05:30:00Z',now:'2026-11-27T03:00:00Z',capturedAt:old}),
    false,'A fixture with no valid original day-of pair cannot invent preparation authority');
  // The actual existing midnight/day-of rule owns early eligibility too.
  const midnightStart = '2026-11-27T06:30:00Z';
  const slots = reviewSlots({sport:'nfl',id:'synthetic',start:midnightStart,
    lock:'2026-11-27T05:30:00Z'});
  const boundary = Date.parse(slots[0].dueAt) - 15 * 60_000;
  assert.equal(needsNflPreReviewRoster({start:midnightStart,now:new Date(boundary-1).toISOString(),capturedAt:old}),false);
  assert.equal(needsNflPreReviewRoster({start:midnightStart,now:new Date(boundary).toISOString(),capturedAt:old}),true);
  assert.deepEqual(slots.map(s=>s.stage), ['early','final']);

  const cutoff='2026-11-26T19:51:00Z', game={id:'synthetic-game',start,home:'DAL',away:'PHI'};
  const row={canonicalGameId:game.id,scheduledStart:start,provider:'balldontlie',
    providerPlayerId:'900001',playerName:'Synthetic Runner',playerTeam:null,
    isOpening:false,isLive:false,receivedAt:cutoff,observedAt:cutoff,fetchedAt:cutoff};
  const empty={team:'DAL',capturedAt:old,roster:[]};
  const source={row,rows:[],observations:[row],game,cutoff,observationsAvailableAt:cutoff,
    context:{capturedAt:cutoff,games:[{canonicalGameId:game.id,scheduledStart:start,
      awayTeam:'PHI',homeTeam:'DAL',awayDepth:{...empty,team:'PHI'},homeDepth:empty}]}};
  const original=JSON.stringify(source);
  const resolve=(input:unknown)=>resolveNflPropSourcePlayer(input as Parameters<typeof resolveNflPropSourcePlayer>[0]);
  assert.equal(resolve(source),null,'Old roster cannot invent the offered player team');
  let requests=0;
  const result=await fetchBalldontlieNflTeamDepthSnapshots({
    teams:[{id:7,abbreviation:'DAL',name:'Synthetic Home Team'}],
    season:2026,capturedAt:cutoff,apiKey:'mock-only',fetchImpl:async input=>{
      requests++;const url=new URL(String(input));
      assert.equal(url.href,'https://api.balldontlie.io/nfl/v1/teams/7/roster?season=2026');
      return new Response(JSON.stringify({data:[{player:{id:900001,first_name:'Synthetic',last_name:'Runner',position_abbreviation:'RB'},depth:3}]}),{status:200});
    }});
  assert.equal(requests,1);assert.equal(result.requests,1);
  assert.equal(JSON.stringify(source),original,'Original source is immutable');
  const fresh={...source,context:{...source.context,games:[{...source.context.games[0],homeDepth:result.byTeam.DAL}]}};
  const identity=resolve(fresh);
  assert(identity);assert.equal(identity.providerId,'900001');assert.equal(identity.team,'DAL');
  assert.equal(identity.opponent,'PHI');assert.equal(identity.rosterPosition,'RB');
  assert.equal(check('2026-11-26T20:06:00Z',result.byTeam.DAL.capturedAt),false,
    'An already prepared roster adds no repeated request in the same window');
  assert.deepEqual(slots,reviewSlots({sport:'nfl',id:'synthetic',start:midnightStart,lock:'2026-11-27T05:30:00Z'}),
    'Source preparation cannot add, shift or replay a review');
  // Actual hourly gates reproduce the original hole: recent price publication
  // does not mean the retained roster was prepared for this review window.
  const storedPayload={slateGameCount:1,decisions:{evaluatedBets:[]},
    startersAndDepth:{away:{capturedAt:old},home:{capturedAt:old}}};
  const stored=[{providerGameId:'synthetic-game',gameStartAt:start,capturedAt:old,
    stage:'opening',payload:storedPayload},{providerGameId:'synthetic-game',gameStartAt:start,
    capturedAt:'2026-11-26T19:42:00Z',stage:'unlocked',payload:storedPayload}] as unknown as NflForwardStoredEvidence[];
  const fixture={providerGameId:'synthetic-game',scheduledStart:start,providerWeek:12,season:2026,
    status:'scheduled',home:{id:7,abbreviation:'DAL',name:'Synthetic Home'},
    away:{id:8,abbreviation:'PHI',name:'Synthetic Away'}};
  const baseNeed=determineNflForwardCollectionNeed({existing:stored,now:cutoff});
  assert.equal(baseNeed.collect,false);assert.equal(baseNeed.reason,'cadence_not_due');
  assert.deepEqual(planNflForwardEvidenceCaptures({games:[fixture],existing:stored,
    capturedAt:cutoff,unlockedCadenceMinutes:60}),[]);
  const sourceBefore=JSON.stringify(stored),emptyFrozen=new Set<string>();
  assert.deepEqual([...nflPreReviewRosterDueGames({existing:stored,now:cutoff,frozenGameIds:emptyFrozen})],['synthetic-game']);
  const added=withNflPreReviewRosterCaptures({planned:[],games:[fixture],existing:stored,
    now:cutoff,frozenGameIds:emptyFrozen});
  assert.equal(added.length,1);assert.equal(added[0].stage,'unlocked');
  assert.equal(added[0].cutoffAt,'2026-11-26T20:30:00.000Z');
  assert.equal(withNflPreReviewRosterCaptures({planned:added,games:[fixture,fixture],existing:stored,
    now:cutoff,frozenGameIds:emptyFrozen}).length,1,'One original capture wins; no duplicate preparation');
  assert.deepEqual([...nflPreReviewRosterDueGames({existing:stored,now:cutoff,frozenGameIds:new Set(['synthetic-game'])})],[]);
  assert.deepEqual(withNflPreReviewRosterCaptures({planned:[],games:[fixture],existing:stored,
    now:cutoff,frozenGameIds:new Set(['synthetic-game'])}),[]);
  assert.deepEqual(withNflPreReviewRosterCaptures({planned:[],games:[{...fixture,scheduledStart:'2026-11-29T21:30:00Z'}],
    existing:stored,now:cutoff,frozenGameIds:emptyFrozen}),[],'Fresh provider fixture requalifies the original stored clock');
  const failedT60={...stored[1],stage:'t60'} as NflForwardStoredEvidence;
  assert.equal(nflPreReviewRosterDueGames({existing:[...stored,failedT60],now:cutoff,frozenGameIds:emptyFrozen}).size,0,
    'A legacy final-slot failure cannot be evaded with another preparation capture');
  const future={...stored[0],capturedAt:'2026-11-26T20:00:00Z'};
  assert.equal(nflPreReviewRosterDueGames({existing:[future],now:cutoff,frozenGameIds:emptyFrozen}).size,0,
    'Future stored metadata cannot authorize a current source window');
  const freshStored={...stored[1],capturedAt:cutoff,payload:{...stored[1].payload,
    startersAndDepth:{...stored[1].payload.startersAndDepth,
      away:{...stored[1].payload.startersAndDepth.away,capturedAt:cutoff},
      home:{...stored[1].payload.startersAndDepth.home,capturedAt:cutoff}}}};
  assert.equal(nflPreReviewRosterDueGames({existing:[...stored,freshStored],now:'2026-11-26T20:06:00Z',frozenGameIds:emptyFrozen}).size,0);
  assert.equal(JSON.stringify(stored),sourceBefore,'Original metadata and locked authorities are never mutated');
  console.log('NFL pre-review roster controls passed: original paired clocks, bounded mocked roster, late offered exact-ID identity, no invented team or original mutation.');
}

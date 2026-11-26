import assert from 'node:assert/strict';
import {needsNflPreReviewRoster} from '../../lib/services/football/nflPreReviewRosterFreshness';
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
  console.log('NFL pre-review roster controls passed: original paired clocks, bounded mocked roster, late offered exact-ID identity, no invented team or original mutation.');
}

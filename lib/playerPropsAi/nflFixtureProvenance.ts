/** Private submitted-input provenance; never a public card or price clock. */
import type {NflPlayerPropPriceObservation,NflPlayerPropGameIdentity} from '../services/football/nflPlayerPropsContract';
import {NFL_PLAYER_PROPS_RECONCILED_FIXTURE_RELEASE} from '../services/football/nflPlayerPropsContract';
import type {LivePropsGame} from './liveSources';
import {instant,invariant,stable} from './evidence';
import {propsTeam} from './teamIdentity';
export const PROPS_AI_NFL_FIXTURE_PROVENANCE_RELEASE='player_props_ai_nfl_fixture_provenance_2026_11_26_r1_submitted_source' as const;
/** One full original declaration per provider event/binding, deduplicated across
 * every price/actor. Existing metadata codec and immutable review archive retain
 * it verbatim. It is not medical context, an independent model, or price time. */
export function nflFixtureProvenanceLimitations(args:{rows:readonly NflPlayerPropPriceObservation[];
 game:LivePropsGame;cutoff:string;sourceAvailableAt:string;games:readonly NflPlayerPropGameIdentity[]|undefined}):string[]{
 const declarations=new Set<string>(),cutoff=instant(args.cutoff),source=instant(args.sourceAvailableAt);
 for(const row of args.rows){const b=row.reconciledFixture;if(!b)continue;
  const norm=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
  const matches=(value:string,full:string,abbr:string)=>[norm(full),norm(abbr)].includes(norm(value));
  const fixtures=(args.games??[]).filter(g=>Math.abs(instant(g.scheduledStart)-instant(b.providerScheduledStart))<=15*60_000
   &&matches(b.providerHomeTeam,g.homeTeamName,g.homeTeam)&&matches(b.providerAwayTeam,g.awayTeamName,g.awayTeam));
  invariant(fixtures.length===1&&fixtures[0].providerGameId===args.game.id
   &&instant(fixtures[0].scheduledStart)===instant(args.game.start),'NFL reconciled fixture source schedule ambiguous');
  invariant(typeof row.providerEventId==='string'&&row.providerEventId.trim().length>0&&row.provider==='owls'&&!row.isLive&&!row.isOpening&&source<=cutoff
   &&b.release===NFL_PLAYER_PROPS_RECONCILED_FIXTURE_RELEASE
   &&row.canonicalGameId===args.game.id&&b.canonicalGameId===args.game.id
   &&instant(row.scheduledStart!)===instant(args.game.start)&&instant(b.scheduledStart)===instant(args.game.start)
   &&propsTeam(b.homeTeam)===propsTeam(args.game.home)&&propsTeam(b.awayTeam)===propsTeam(args.game.away)
   &&b.providerHomeTeam===row.homeTeam&&b.providerAwayTeam===row.awayTeam
   &&Math.abs(instant(b.providerScheduledStart)-instant(b.scheduledStart))<=15*60_000
   &&typeof row.receivedAt==='string'&&instant(b.availableAt)===instant(row.receivedAt)
   &&instant(row.receivedAt)<=source&&instant(row.observedAt)<=instant(row.receivedAt)
   &&instant(row.fetchedAt)<=instant(row.receivedAt),'NFL reconciled fixture provenance invalid');
  declarations.add(stable({provenanceRelease:PROPS_AI_NFL_FIXTURE_PROVENANCE_RELEASE,provider:row.provider,
   providerEventId:row.providerEventId,...b}));
 }
 return [...declarations].sort().map(value=>'Original provider fixture and canonical schedule binding; collection context only, not quote/update timing or an independent forecast: '+value);
}

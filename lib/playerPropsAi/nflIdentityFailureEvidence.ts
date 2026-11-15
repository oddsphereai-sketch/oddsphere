/** INTERNAL ONLY. Capture pre-claim identity failures; never an inference/claim path. */
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {NflPlayerPropsProductionSnapshot} from '../services/football/nflPlayerPropsProductionContract';
import type {NflPlayerPropsObservationSnapshot,NflPlayerPropPriceObservation} from '../services/football/nflPlayerPropsContract';
import type {NflPlayerPropsInferenceContext} from '../services/football/nflPlayerPropsInferenceContext';
import type {LivePropsGame} from './liveSources';
import type {CapturedReviewWindow} from './liveWindow';
import type {PropsAiJob} from './budget';
import {CATALOG} from './evidenceContract';
import {stable,invariant} from './evidence';
import {PROPS_AI_RELEASE} from './releases';
import {resolveNflPropSourcePlayer,PROPS_AI_NFL_IDENTITY_RELEASE,PROPS_AI_NFL_SOURCE_RELEASE} from './nflPlayerIdentity';

export const LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE='player_props_ai_nfl_source_failure_2026_11_10_r1_private_exact_input' as const;
export const NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE='player_props_ai_nfl_source_failure_2026_11_14_r2_bounded_semantic_archive' as const;
export const NFL_IDENTITY_FAILURE_RAW_LIMIT=8_000_000;
export const NFL_IDENTITY_FAILURE_GZIP_LIMIT=262_144;
export const NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT=128_000;
export const NFL_IDENTITY_FAILURE_RECORD_LIMIT=600_000;
export type NflIdentityFailureJob=Pick<PropsAiJob,'job_key'|'sport'|'game_id'|'stage'|'scheduled_start'|'lock_at'|'due_at'|'state'>;
export type NflIdentityFailureArgs={
  purpose:string;job:NflIdentityFailureJob;writerRunId:string;writerRelease:string;
  game:LivePropsGame;window:CapturedReviewWindow;observedAt:string;capturedAt:string;
  snapshot:NflPlayerPropsProductionSnapshot;observations:NflPlayerPropsObservationSnapshot;context:NflPlayerPropsInferenceContext;
  /** Sanitized static code only; never an exception message containing source text. */
  failureCode:string;
};
export type NflIdentityFailureArchive={encoding:'gzip-base64';bytes:number;sha256:string;gzipBytes:number;gzipSha256:string;data:string};
export type NflIdentityFailureRecord={
  release:typeof NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE|typeof LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE;identityRelease:typeof PROPS_AI_NFL_IDENTITY_RELEASE;eventSourceRelease:typeof PROPS_AI_NFL_SOURCE_RELEASE;purpose:'scheduled_review';
  writerRelease:string;writerRunId:string;generationRelease:string;failureCode:string;jobKey:string;fundedGameId:string;nativeGameId:string;stage:'early'|'final';
  start:string;lock:string;observedAt:string;observedAtMeaning:'requested_source_cutoff';capturedAt:string;captureAfterLock:boolean;status:'captured'|'archive_unavailable';
  semanticCanonical:string;semanticSha256:string;counts:{sourceRows:number;relevantRows:number;candidateRows:number;failedRows:number;nativeRows:number;memberRows:number;contexts:number};
  sourceHashes:Record<string,string|null>;archive:NflIdentityFailureArchive|null;archiveUnavailable:string|null;
};
export type NflIdentityFailureCapture={kind:'ready';writerRunId:string;record:NflIdentityFailureRecord}|{kind:'skipped';reason:string};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const at=(value:unknown)=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const hashJson=(value:unknown):string|null=>{try{const text=JSON.stringify(value);return typeof text==='string'?sha(text):null;}catch{return null;}};
const finiteBefore=(value:unknown,limit:number)=>Number.isFinite(at(value))&&at(value)<=limit;
const distinct=(rows:unknown[])=>[...new Map(rows.map(row=>[stable(row),row])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);
function sourceClass(row:NflPlayerPropPriceObservation,args:NflIdentityFailureArgs){
  const cutoff=at(args.window.cutoff),source=at(args.observations.generatedAt),receipt=at(row.receivedAt);
  return{exactGame:row.canonicalGameId===args.game.id,exactStart:at(row.scheduledStart)===at(args.game.start),
    receiptByCutoff:finiteBefore(row.receivedAt,cutoff),receiptBySource:finiteBefore(row.receivedAt,source),
    observedByReceipt:finiteBefore(row.observedAt,receipt),fetchedByReceipt:finiteBefore(row.fetchedAt,receipt),
    sourceByCutoff:finiteBefore(args.observations.generatedAt,cutoff),live:row.isLive,opening:row.isOpening};
}
const triggerCodes=new Set(['nfl_offered_player_identity_incomplete','nfl_provider_identity_conflict','nfl_player_name_conflict','nfl_player_team_conflict','nfl_roster_game_identity_conflict','nfl_roster_team_identity_conflict','nfl_captured_player_ambiguous']);
/** Only actual identity guards may produce this private capture. */
export function nflIdentityFailureTrigger(error:unknown):string|null{
  if(!(error instanceof Error))return null;
  if(/^NFL offered-player identity coverage incomplete:[0-9]+$/.test(error.message))return 'nfl_offered_player_identity_incomplete';
  return ({'Conflicting NFL provider player identity':'nfl_provider_identity_conflict','Conflicting NFL player-name identity':'nfl_player_name_conflict',
    'Conflicting NFL player-team identity':'nfl_player_team_conflict','NFL roster game identity mismatch':'nfl_roster_game_identity_conflict',
    'NFL roster team identity mismatch':'nfl_roster_team_identity_conflict','Ambiguous NFL captured player':'nfl_captured_player_ambiguous'} as Record<string,string>)[error.message]??null;
}
const conflictCode=(message:string)=>({
  'Conflicting NFL provider player identity':'provider_id_conflict','Conflicting NFL player-name identity':'name_conflict',
  'Conflicting NFL player-team identity':'team_conflict','NFL roster game identity mismatch':'roster_game_conflict',
  'NFL roster team identity mismatch':'roster_team_conflict',
} as Record<string,string>)[message]??'identity_diagnostic_unavailable';
function metadata(args:NflIdentityFailureArgs):Omit<NflIdentityFailureRecord,'semanticCanonical'|'semanticSha256'|'status'|'counts'|'sourceHashes'|'archive'|'archiveUnavailable'>{
  return{release:NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE,identityRelease:PROPS_AI_NFL_IDENTITY_RELEASE,eventSourceRelease:PROPS_AI_NFL_SOURCE_RELEASE,purpose:'scheduled_review',writerRelease:args.writerRelease,writerRunId:args.writerRunId,failureCode:args.failureCode,
    generationRelease:PROPS_AI_RELEASE,jobKey:args.job.job_key,fundedGameId:args.job.game_id,nativeGameId:args.game.id,stage:args.job.stage,
    start:args.game.start,lock:args.job.lock_at,observedAt:args.observedAt,observedAtMeaning:'requested_source_cutoff',capturedAt:args.capturedAt,captureAfterLock:at(args.capturedAt)>=at(args.job.lock_at)};
}
function semanticText(base:ReturnType<typeof metadata>,state:unknown){
  return stable({release:base.release,identityRelease:base.identityRelease,eventSourceRelease:base.eventSourceRelease,purpose:base.purpose,writerRelease:base.writerRelease,generationRelease:base.generationRelease,failureCode:base.failureCode,
    jobKey:base.jobKey,fundedGameId:base.fundedGameId,nativeGameId:base.nativeGameId,stage:base.stage,start:base.start,lock:base.lock,state});
}
/** Capture consumes only already collected inputs. It does not alter resolver acceptance. */
export function buildNflIdentityFailureEvidence(args:NflIdentityFailureArgs):NflIdentityFailureCapture{
  if(args.purpose!=='scheduled_review')return{kind:'skipped',reason:'not_scheduled_review'};
  const observed=at(args.observedAt),lock=at(args.job.lock_at),due=at(args.job.due_at),captured=at(args.capturedAt);
  if(args.job.sport!=='nfl'||!args.writerRunId.trim()||!args.writerRelease.trim()||!args.game.id||args.window.gameId!==args.game.id||args.window.stage!==args.job.stage
    ||at(args.window.lock)!==lock||at(args.game.start)!==at(args.job.scheduled_start)||at(args.window.cutoff)!==observed
    ||!Number.isFinite(due)||!(due<=observed&&observed<lock&&lock<=at(args.game.start)&&observed<=captured&&captured<=lock+600000)
    ||!['pending','failed','expired','completed','cancelled'].includes(args.job.state)||!triggerCodes.has(args.failureCode))return{kind:'skipped',reason:'invalid_scheduled_source_failure_binding'};
  const base=metadata(args),counts={sourceRows:args.observations.observations.length,relevantRows:0,candidateRows:0,failedRows:0,nativeRows:0,memberRows:0,contexts:0};
  const sourceHashes={observations:hashJson(args.observations),nativeSnapshot:hashJson(args.snapshot),context:hashJson(args.context)};
  let semanticCanonical=semanticText(base,{unavailable:'capture_construction_failed',failureCode:args.failureCode});
  try{
    const relevant=args.observations.observations.flatMap((row,index)=>row.canonicalGameId===args.game.id&&(CATALOG.nfl.required as readonly string[]).includes(row.market)?[{index,row:copy(row),eligibility:sourceClass(row,args)}]:[]);
    const candidates=relevant.filter(({row,eligibility:c})=>!row.isOpening&&!row.isLive&&c.receiptByCutoff&&c.observedByReceipt);
    counts.relevantRows=relevant.length;counts.candidateRows=candidates.length;
    const native=args.snapshot.board.decisions.flatMap((row,index)=>row.gameId===args.game.id?[{index,identity:{gameId:row.gameId,scheduledStart:row.scheduledStart,
      providerPlayerId:row.providerPlayerId??null,playerName:row.playerName,team:row.team,observedAt:row.observedAt,featureAsOf:row.forecastContext?.featureAsOf??null},
      eligible:Boolean(row.providerPlayerId?.trim())&&finiteBefore(args.snapshot.generatedAt,observed)&&at(row.scheduledStart)===at(args.game.start)&&finiteBefore(row.observedAt,at(args.snapshot.generatedAt))&&finiteBefore(row.forecastContext?.featureAsOf,at(args.snapshot.generatedAt))}]:[]);
    const member=args.snapshot.memberDecisions.flatMap((row,index)=>row.gameId===args.game.id?[{index,identity:{gameId:row.gameId,scheduledStart:row.scheduledStart,
      providerPlayerId:row.providerPlayerId??null,playerName:row.playerName,team:row.team,opponent:row.opponent,market:row.market,observedAt:row.observedAt,featureAsOf:row.forecastContext?.featureAsOf??null}}]:[]);
    const contexts=args.context.games.flatMap((game,index)=>game.canonicalGameId===args.game.id?[{index,game:copy(game)}]:[]);
    counts.nativeRows=native.length;counts.memberRows=member.length;counts.contexts=contexts.length;
    const outcomes=candidates.map(({index,row})=>{
      try{const identity=resolveNflPropSourcePlayer({row,rows:args.snapshot.board.decisions,observations:candidates.map(c=>c.row),context:args.context,game:args.game,
        cutoff:args.window.cutoff,observationsAvailableAt:args.observations.generatedAt,storedAvailableAt:args.snapshot.generatedAt});
        return{index,code:identity?'resolved':'unresolved',identity};
      }catch(error){return{index,code:conflictCode(error instanceof Error?error.message:''),identity:null};}
    });
    counts.failedRows=outcomes.filter(outcome=>outcome.code!=='resolved').length;
    const rawIdentity=(row:NflPlayerPropPriceObservation)=>({provider:row.provider,providerPlayerId:row.providerPlayerId,playerName:row.playerName,playerTeam:row.playerTeam,
      canonicalGameId:row.canonicalGameId,providerEventId:row.providerEventId,scheduledStart:row.scheduledStart,market:row.market,providerMarket:row.providerMarket});
    const state={failureCode:args.failureCode,game:copy(args.game),sourceClasses:{observationsByCutoff:finiteBefore(args.observations.generatedAt,observed),
      storedByCutoff:finiteBefore(args.snapshot.generatedAt,observed),contextByCutoff:finiteBefore(args.context.capturedAt,observed),collectionComplete:args.observations.collectionComplete,contextCount:contexts.length},
      offered:distinct(relevant.map(({row,eligibility})=>({identity:rawIdentity(row),eligibility}))),
      stored:distinct(native.map(({identity,eligible})=>({providerPlayerId:identity.providerPlayerId,playerName:identity.playerName,team:identity.team,gameId:identity.gameId,scheduledStart:identity.scheduledStart,eligible}))),
      memberStored:distinct(member.map(({identity:m})=>({gameId:m.gameId,scheduledStart:m.scheduledStart,providerPlayerId:m.providerPlayerId,playerName:m.playerName,team:m.team,opponent:m.opponent,market:m.market}))),
      contextIdentities:distinct(contexts.map(({game})=>({canonicalGameId:game.canonicalGameId,scheduledStart:game.scheduledStart,awayTeam:game.awayTeam,homeTeam:game.homeTeam}))),
      rosters:distinct(contexts.flatMap(({game})=>[game.awayDepth,game.homeDepth].map(depth=>({team:depth.team,eligible:finiteBefore(depth.capturedAt,observed)&&finiteBefore(depth.capturedAt,at(args.context.capturedAt)),
        rows:distinct(depth.roster.map(player=>({playerId:player.playerId,name:player.name,position:player.position??null})))})))),
      outcomes:distinct(outcomes.map(outcome=>({identity:rawIdentity(candidates.find(row=>row.index===outcome.index)!.row),code:outcome.code}))) };
    const fullSemanticCanonical=semanticText(base,state);
    // Dedup retains a bounded digest/length of the complete semantic state.
    // Unlike R1, semantic overflow alone must not discard bounded exact input.
    semanticCanonical=Buffer.byteLength(fullSemanticCanonical)>NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT
      ?semanticText(base,{unavailable:'semantic_bound',bytes:Buffer.byteLength(fullSemanticCanonical),sha256:sha(fullSemanticCanonical)})
      :fullSemanticCanonical;
    const {observations:ignoredObservations,...observationHeader}=args.observations;void ignoredObservations;
    const {games:ignoredGames,...contextHeader}=args.context;void ignoredGames;
    const input={release:base.release,identityRelease:base.identityRelease,binding:base,job:copy(args.job),game:copy(args.game),window:copy(args.window),writerRunId:args.writerRunId,
      observationsHeader:copy(observationHeader),relevantObservations:relevant,candidateSourceIndices:candidates.map(c=>c.index),
      nativeHeader:{release:args.snapshot.release,season:args.snapshot.season,week:args.snapshot.week,generatedAt:args.snapshot.generatedAt,writerLeaseGroup:args.snapshot.writerLeaseGroup,
        boardRelease:args.snapshot.board.release,boardGeneratedAt:args.snapshot.board.generatedAt,boardEvaluatedAt:args.snapshot.board.evaluatedAt},nativeIdentityRows:native,memberIdentityRows:member,
      contextHeader:copy(contextHeader),contexts,sourceHashes,outcomes,semanticCanonical:fullSemanticCanonical,callerIdentityFailure:{code:args.failureCode,independentlyReplayed:false},
      meaning:'Exact normalized relevant collector rows and declared native identity projection; not raw HTTP or all numerical model inputs. observedAt is the requested source cutoff, not an independent receipt or failure-occurrence time. capturedAt is the actual writer failure-capture time; captureAfterLock explicitly identifies late diagnostic capture. Clock/hash metadata are writer assertions, not independent attestations. Outcomes replay the identity resolver only. Later cached-member ambiguity is caller-reported with complete member identity inputs, not a separately invented per-row verdict. All outcomes are diagnostic only; any failure still blocks the game.'};
    const text=JSON.stringify(input),raw=Buffer.from(text),rawHash=sha(raw);
    if(raw.length>NFL_IDENTITY_FAILURE_RAW_LIMIT)return{kind:'ready',writerRunId:args.writerRunId,record:{...base,status:'archive_unavailable',semanticCanonical,semanticSha256:sha(semanticCanonical),counts,sourceHashes:{...sourceHashes,identityInput:rawHash},archive:null,archiveUnavailable:'raw_input_bound'}};
    const gzip=gzipSync(raw);
    if(gzip.length>NFL_IDENTITY_FAILURE_GZIP_LIMIT)return{kind:'ready',writerRunId:args.writerRunId,record:{...base,status:'archive_unavailable',semanticCanonical,semanticSha256:sha(semanticCanonical),counts,sourceHashes:{...sourceHashes,identityInput:rawHash},archive:null,archiveUnavailable:'gzip_input_bound'}};
    const archive:NflIdentityFailureArchive={encoding:'gzip-base64',bytes:raw.length,sha256:rawHash,gzipBytes:gzip.length,gzipSha256:sha(gzip),data:gzip.toString('base64')};
    const record:NflIdentityFailureRecord={...base,status:'captured',semanticCanonical,semanticSha256:sha(semanticCanonical),counts,sourceHashes:{...sourceHashes,identityInput:rawHash},archive,archiveUnavailable:null};
    if(Buffer.byteLength(JSON.stringify(record))>NFL_IDENTITY_FAILURE_RECORD_LIMIT)return{kind:'ready',writerRunId:args.writerRunId,record:{...record,status:'archive_unavailable',archive:null,archiveUnavailable:'record_bound'}};
    return{kind:'ready',writerRunId:args.writerRunId,record};
  }catch{return{kind:'ready',writerRunId:args.writerRunId,record:{...base,status:'archive_unavailable',semanticCanonical,semanticSha256:sha(semanticCanonical),counts,sourceHashes,archive:null,archiveUnavailable:'capture_construction_failed'}};}
}
/** Private observer primitive; fails before decompressing an unbounded payload. */
export function decodeNflIdentityFailureArchive(record:NflIdentityFailureRecord):unknown{
  invariant((record.release===NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE||record.release===LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE)&&record.identityRelease===PROPS_AI_NFL_IDENTITY_RELEASE,'Unknown NFL source failure evidence release');
  invariant(Buffer.byteLength(record.semanticCanonical)<=NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT&&sha(record.semanticCanonical)===record.semanticSha256,'NFL source semantic hash mismatch');
  const archive=record.archive;invariant(record.status==='captured'&&archive?.encoding==='gzip-base64','NFL source archive unavailable');
  invariant(Number.isSafeInteger(archive.bytes)&&archive.bytes>0&&archive.bytes<=NFL_IDENTITY_FAILURE_RAW_LIMIT&&Number.isSafeInteger(archive.gzipBytes)&&archive.gzipBytes>0&&archive.gzipBytes<=NFL_IDENTITY_FAILURE_GZIP_LIMIT,'NFL source archive bounds invalid');
  invariant(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(archive.data)&&archive.data.length<=4*Math.ceil(NFL_IDENTITY_FAILURE_GZIP_LIMIT/3),'NFL source archive base64 invalid');
  const gzip=Buffer.from(archive.data,'base64');invariant(gzip.length===archive.gzipBytes&&sha(gzip)===archive.gzipSha256,'NFL source compressed hash mismatch');
  const raw=gunzipSync(gzip,{maxOutputLength:NFL_IDENTITY_FAILURE_RAW_LIMIT});invariant(raw.length===archive.bytes&&sha(raw)===archive.sha256&&record.sourceHashes.identityInput===archive.sha256,'NFL source raw hash mismatch');
  const parsed=JSON.parse(raw.toString()) as {binding:unknown;semanticCanonical:string};
  const binding={release:record.release,identityRelease:record.identityRelease,eventSourceRelease:record.eventSourceRelease,purpose:record.purpose,writerRelease:record.writerRelease,writerRunId:record.writerRunId,generationRelease:record.generationRelease,failureCode:record.failureCode,jobKey:record.jobKey,fundedGameId:record.fundedGameId,nativeGameId:record.nativeGameId,stage:record.stage,start:record.start,lock:record.lock,observedAt:record.observedAt,observedAtMeaning:record.observedAtMeaning,capturedAt:record.capturedAt,captureAfterLock:record.captureAfterLock};
  invariant(stable(parsed.binding)===stable(binding),'NFL source archive binding mismatch');
  if(record.release===LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE){
    // R1 exact archives retain their original semantic-equality contract.
    invariant(parsed.semanticCanonical===record.semanticCanonical,'NFL source archive binding mismatch');
  }else{
    invariant(typeof parsed.semanticCanonical==='string','NFL source semantic archive missing');
    const full=parsed.semanticCanonical,semantic=JSON.parse(full) as {state?:unknown};
    invariant(semantic!==null&&typeof semantic==='object'&&!Array.isArray(semantic)&&semantic.state!==null&&typeof semantic.state==='object'&&!Array.isArray(semantic.state)
      &&full===semanticText(binding,semantic.state),'NFL source full semantic binding mismatch');
    const bounded=Buffer.byteLength(full)>NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT
      ?semanticText(binding,{unavailable:'semantic_bound',bytes:Buffer.byteLength(full),sha256:sha(full)}):full;
    invariant(record.semanticCanonical===bounded,'NFL source bounded semantic binding mismatch');
  }
  return parsed;
}
/** One bounded DB append, never a retry or an AI request. Raw records stay private. */
export async function appendNflIdentityFailureEvidence(client:Pick<SupabaseClient,'rpc'>,capture:NflIdentityFailureCapture):Promise<{status:string;reason?:string}>{
  if(capture.kind!=='ready')return{status:'skipped',reason:capture.reason};
  try{
    const record=capture.record;invariant(record.writerRunId===capture.writerRunId&&Buffer.byteLength(JSON.stringify(record))<=NFL_IDENTITY_FAILURE_RECORD_LIMIT&&(record.release===NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE||record.release===LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE)&&sha(record.semanticCanonical)===record.semanticSha256,'Invalid bounded NFL failure capture');
    if(record.status==='captured')decodeNflIdentityFailureArchive(record);
    const {data,error}=await client.rpc('player_props_ai_append_source_failure_v1',{p_writer_run:capture.writerRunId,p_capture:record}).abortSignal(AbortSignal.timeout(5000));
    if(error)return{status:'unavailable',reason:'source_failure_storage_unavailable'};
    const result=data as {status?:unknown};return{status:['stored','duplicate','overflow','overflow_already_recorded'].includes(String(result?.status))?String(result.status):'unavailable',...(result?.status==='unavailable'?{reason:'source_failure_append_refused'}:{})};
  }catch{return{status:'unavailable',reason:'source_failure_storage_unavailable'};}
}

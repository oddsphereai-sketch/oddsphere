/** Read completeness is different from source agreement. An observed absence
 * is legitimate context; a failed lookup cannot masquerade as no opposition.
 * No forecast or grade runs under this guard's failure path. */
export const NBA_READER_PUBLICATION_RELEASE="nba_reader_publication_2026_11_06_r1_complete_reads" as const;
const safeCode=(code:string)=>/^(price|split)_observation_(high_water_failed|lookup_failed|id_order_invalid|coverage_incomplete)$/.test(code)?code:"reader_evidence_unavailable";
/** A short page may be a server-imposed limit. Only the scoped high-water
 * frontier proves completion; an empty page before it is incomplete evidence. */
export function nbaEvidenceHighWaterError(family:"price"|"split",value:number,previouslyObserved=false){
 if(!Number.isSafeInteger(value)||value<0)return `${family}_observation_high_water_failed`;
 if(value===0&&previouslyObserved)return `${family}_observation_coverage_incomplete`;
 return null;
}
export function advanceNbaEvidencePage(args:{family:"price"|"split";cursor:number;highWater:number;rows:readonly {id:number}[]}){
 const {family,cursor,highWater,rows}=args;
 const frontierError=nbaEvidenceHighWaterError(family,highWater);if(frontierError)return {cursor,error:frontierError};
 if(rows.some((row,i)=>!Number.isSafeInteger(row.id)||row.id<=(i===0?cursor:rows[i-1]!.id)||row.id>highWater))
  return {cursor,error:`${family}_observation_id_order_invalid`};
 if(!rows.length)return {cursor,error:cursor<highWater?`${family}_observation_coverage_incomplete`:null};
 return {cursor:rows.at(-1)!.id,error:null};
}
export class NbaReaderEvidenceUnavailable extends Error {
 readonly codes:readonly string[];
 constructor(errors:readonly string[]){
  const codes=[...new Set(errors.map(safeCode))].sort();
  super(`${NBA_READER_PUBLICATION_RELEASE}: ${codes.join(",")}; previous published board retained`);this.codes=codes;
 }
}
export function assertNbaReaderEvidenceComplete(errors:readonly string[]):void {
 if(!errors.length)return;
 throw new NbaReaderEvidenceUnavailable(errors);
}

/** A failed rebuild is not a successful empty slate. Existing snapshot writers
 * reject this non-OK response before any write or freshness/cache advancement.
 * SQL/provider details stay in server logs, outside the member response. */
export function nbaReaderUnavailableResponse(args:{date:string;now:string;cacheControl?:string;error?:unknown}):Response {
 return Response.json({as_of:args.now,sport:"nba",date:args.date,requested_date:args.date,fallback_used:false,
  slateState:"no_data",slate_status:null,last_slate_update_at:null,games:[],
  error:"NBA evidence is temporarily unavailable; the previous published board is retained."},
  {status:503,headers:{"Cache-Control":args.cacheControl??"no-store",
   "X-Oddsphere-Nba-Reader-Failure":args.error instanceof NbaReaderEvidenceUnavailable?args.error.codes.join(","):"nba_pipeline_build_failed"}});
}

/** Allowlisted diagnostic receipt for the existing cron log, never SQL text. */
export function nbaReaderFailureReceipt(response:Response){
 const raw=response.headers.get("X-Oddsphere-Nba-Reader-Failure");
 if(!raw||raw.length>512)return undefined;
 const codes=raw.split(",");
 if(codes.some(c=>c!=="nba_pipeline_build_failed"&&safeCode(c)!==c))return undefined;
 return {release:NBA_READER_PUBLICATION_RELEASE,codes};
}

/** Diagnostic-only contract: callers already persist result.error in their
 * existing data_refresh_log row. No new log writer or prediction path. */
export const NBA_READER_FAILURE_LOG_RELEASE="nba_reader_failure_log_2026_11_06_r1_allowlisted_phase" as const;
export function nbaReaderFailureLogSuffix(receipt:ReturnType<typeof nbaReaderFailureReceipt>):string {
 if(!receipt)return "";
 const codes=[...new Set(receipt.codes.map(code=>code==="nba_pipeline_build_failed"?code:safeCode(code)))].sort();
 return ` [${NBA_READER_FAILURE_LOG_RELEASE}: ${codes.join(",")}]`;
}

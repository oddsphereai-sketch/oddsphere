/** Display identity only. Never changes the authoritative scheduled kickoff. */
const MONTHS=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
export const KALSHI_EVENT_DATE_MATCH_RELEASE="kalshi_event_date_match_2026_10_30_r1_rule_verified";

/** Retain only a postponement policy actually stated by this full-game CFB
 * contract. Expiration/close times are not kickoff times and cannot prove it. */
export function kalshiRescheduleWindow(raw:Record<string,unknown>,sport:string,originalDate:string):48|undefined{
 if(sport!=="cfb"||typeof raw.rules_primary!=="string"||typeof raw.rules_secondary!=="string")return undefined;
 const date=new Date(originalDate+"T12:00:00Z");if(!Number.isFinite(date.getTime()))return undefined;
 const primary=raw.rules_primary.replace(/\s+/g," ").toLowerCase(),secondary=raw.rules_secondary.replace(/\s+/g," ").toLowerCase();
 const original=`college football game originally scheduled for ${MONTHS[date.getUTCMonth()].toLowerCase()} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
 return primary.includes(original)&&secondary.includes("if the game is postponed but begins within 48 hours of its originally scheduled start time, the market will remain open and resolve based on the official final result")?48:undefined;
}

/** Both identities must be independently proven by the caller. Only the next
 * calendar day is safe without knowing the original kickoff: every such start
 * is inside a stated 48-hour window. No generic +/- date tolerance. */
export function canMatchNextDayContract(originalDate:string,gameDate:string,window:48|undefined,game:{sport:string;gameStartAt:string;lockState?:string;lockedAt?:string|null},now:number):boolean{
 const lock=Date.parse(game.lockedAt??"");
 return game.sport==="cfb"&&game.lockState==="open"&&Date.parse(game.gameStartAt)>now&&
  (game.lockedAt==null||Number.isFinite(lock)&&lock>now)&&window===48&&
  Date.parse(gameDate+"T12:00:00Z")-Date.parse(originalDate+"T12:00:00Z")===86_400_000;
}

/** Keep the provider's exact team-code suffix while selecting a separate
 * spread/total event issued on the game's current published calendar date. */
export function kalshiEventSuffixForDate(suffix:string,date:string):string{
 const d=new Date(date+"T12:00:00Z");
 return suffix.replace(/^\d{2}[A-Z]{3}\d{2}/,`${String(d.getUTCFullYear()).slice(-2)}${MONTHS[d.getUTCMonth()]}${String(d.getUTCDate()).padStart(2,"0")}`);
}

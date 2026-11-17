import {quoteBook,executionContractKey} from '../../playerPropsAi/executionQuotes';
/** Current collection boundary only. Original normalizers and stored rows stay exact. */
import {canonicalNbaPropsTeam} from './nbaPlayerPropsTeamIdentity';
type Row=Record<string,unknown>;
function fail(field:string):never{throw new Error(`NBA current identity contract invalid: ${field}`);}
function object(value:unknown,field:string):Row{if(value===null||typeof value!=='object'||Array.isArray(value))fail(field);return value as Row;}
function optionalObject(value:unknown,field:string):Row|null{return value===undefined||value===null?null:object(value,field);}
function optionalText(value:unknown,field:string):string|null{if(value===undefined||value===null)return null;if(typeof value!=='string')fail(field);return value.trim()||null;}
function identifier(value:unknown,field:string,required=false):string|null{
 if(value===undefined||value===null){if(required)fail(field);return null;}
 const text=typeof value==='number'&&Number.isSafeInteger(value)?String(value):typeof value==='string'?value.trim():'';
 if(!/^[1-9][0-9]*$/.test(text)||!Number.isSafeInteger(Number(text)))fail(field);return text;
}
function clock(value:string,field:string):number{
 const at=Date.parse(value),parts=/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
 if(!Number.isFinite(at))fail(field);
 if(parts){const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]),date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)fail(field);}
 return at;
}
function observationId(value:unknown):string{if(typeof value==='string'&&value.trim())return value.trim();if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);return fail('observation id');}
function records(body:unknown):Row[]{const raw=object(body,'response').data;if(!Array.isArray(raw))fail('data array');return raw.map(value=>object(value,'data record'));}
function agree(values:(string|null)[],field:string):string|null{const supplied=[...new Set(values.filter((value):value is string=>value!==null))];if(supplied.length>1)fail(field);return supplied[0]??null;}
function name(player:Row):string|null{return[optionalText(player.first_name,'first_name'),optionalText(player.last_name,'last_name')].filter(Boolean).join(' ')||null;}
function nameKey(value:string|null):string|null{return value===null?null:value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function teams(player:Row,extra:unknown,coherent:boolean):string|null{
 const team=optionalObject(player.team,'team');const values=[identifier(extra,'quote team_id'),identifier(player.team_id,'player team_id'),identifier(team?.id,'team.id')];
 return coherent?agree(values,'simultaneous team IDs'):values.find(value=>value!==null)??null;
}
function label(team:Row):string{
 const abbreviation=optionalText(team.abbreviation,'team abbreviation'),full=optionalText(team.full_name,'team full_name');
 const names=[abbreviation,full].filter((value):value is string=>value!==null).map(canonicalNbaPropsTeam);
 return agree(names,'simultaneous team labels')??fail('team label');
}
export function validatedNbaScheduleRecords(bodies:readonly unknown[]):Row[]{
 const rows=bodies.flatMap(records),seen=new Map<string,{fixture:string;row:Row;precise:number|null;fallback:number}>();
 for(const row of rows){
  const id=identifier(row.id,'game.id',true)!,home=object(row.home_team,'home_team'),away=object(row.visitor_team,'visitor_team');
  const homeId=identifier(home.id,'home_team.id',true)!,awayId=identifier(away.id,'visitor_team.id',true)!,homeName=label(home),awayName=label(away);
  if(homeId===awayId||homeName===awayName)fail('distinct fixture teams');
  const datetime=optionalText(row.datetime,'datetime'),date=optionalText(row.date,'date'),calendarOnly=date!==null&&/^\d{4}-\d{2}-\d{2}$/.test(date);
  if(date!==null)clock(date,'calendar date');
  if(datetime!==null&&date!==null&&!calendarOnly&&clock(datetime,'game clock')!==clock(date,'game clock'))fail('simultaneous precise game clocks');
  const start=datetime??date;if(start===null)fail('game clock');const startAt=clock(start,'game clock'),precise=datetime!==null||date!==null&&!calendarOnly?startAt:null;
  const fixture=JSON.stringify([id,homeId,awayId,homeName,awayName]),old=seen.get(id);
  if(old){
   if(old.fixture!==fixture||old.precise!==null&&precise!==null&&old.precise!==precise||old.precise===null&&precise===null&&old.fallback!==startAt)fail('duplicate game identity');
   // Select an actually supplied precise record, never a midnight reconstructed
   // from calendar-only data; either raw response order produces that same time.
   if(old.precise!==null&&precise===null)continue;
  }
  seen.set(id,{fixture,row,precise,fallback:startAt});
 }
 return[...seen.values()].map(entry=>entry.row);
}
export function validatedNbaQuoteRecords(body:unknown,requestedGame:string,opening=false):{rows:Row[];aliases:readonly (readonly [string,string])[]}{
 const expected=identifier(requestedGame,'requested game',true),rows=records(body),aliases:(readonly[string,string])[]=[],seen=new Map<string,(string|null)[]>();
 for(const row of rows){
  const game=identifier(row.game_id,'quote game_id',true);if(game!==expected)fail('quote requested game');
  const player=optionalObject(row.player,'player'),id=identifier(row.player_id,'quote player_id',true)!,nested=identifier(player?.id,'player.id');agree([id,nested],'simultaneous player IDs');
  const team=teams(player??{},row.team_id,!opening),playerName=player?name(player):null;
  if(playerName)aliases.push([playerName,`nba-bdl-player:${id}`]);
  const key=observationId(row.id),identity=[game,id,...(!opening?[team,nameKey(playerName)]:[])];
  if(!opening){optionalObject(row.market,'quote market');optionalText(row.vendor,'quote book');optionalText(row.prop_type,'quote market name');optionalText(row.updated_at,'quote clock');}
  const previous=seen.get(key);if(previous){for(let i=0;i<identity.length;i++)if(previous[i]!==null&&identity[i]!==null&&previous[i]!==identity[i])fail('duplicate observation identity');seen.set(key,identity.map((value,i)=>value??previous[i]));}else seen.set(key,identity);
 }
 return{rows,aliases};
}
export function validatedNbaPlayerRecords(body:unknown,requestedIds:readonly string[]):Row[]{
 const rows=records(body);if(rows.length!==requestedIds.length)fail('metadata cardinality');
 const found=new Set<string>();for(const row of rows){const id=identifier(row.id,'metadata player.id',true)!;if(!requestedIds.includes(id)||found.has(id))fail('metadata requested IDs');found.add(id);name(row);teams(row,undefined,true);}
 return rows;
}
type ReferenceKind='owls'|'odds';
function array(value:unknown,field:string,optional=false):unknown[]{if(value===undefined||value===null){if(optional)return[];fail(field);}if(!Array.isArray(value))fail(field);return value;}
function referenceHeader(event:Row,kind:ReferenceKind){
 const id=observationId(event[kind==='owls'?'gameId':'id']);
 const home=optionalText(event[kind==='owls'?'homeTeam':'home_team'],'reference home'),away=optionalText(event[kind==='owls'?'awayTeam':'away_team'],'reference away'),start=optionalText(event[kind==='owls'?'commenceTime':'commence_time'],'reference start');
 if(!home||!away||!start||canonicalNbaPropsTeam(home)===canonicalNbaPropsTeam(away))fail('reference fixture');
 if(event.isLive!==undefined&&event.isLive!==null&&typeof event.isLive!=='boolean')fail('reference live status');
 return{id,home:canonicalNbaPropsTeam(home),away:canonicalNbaPropsTeam(away),start:clock(start,'reference clock')};
}
function census(seen:Map<string,string>,key:string,value:unknown,field:string){const signature=JSON.stringify(value);if(seen.has(key)&&seen.get(key)!==signature)fail(field);seen.set(key,signature);}
export function validatedNbaReferenceEvents(value:unknown,kind:ReferenceKind):Row[]{
 const events=array(kind==='owls'?object(value,'Owls response').data:value,'reference events').map(value=>object(value,'reference event'));
 const headers=new Map<string,string>(),props=new Map<string,string>();
 for(const event of events){
  const header=referenceHeader(event,kind);census(headers,header.id,header,'duplicate reference event');
  for(const bookValue of array(event[kind==='owls'?'books':'bookmakers'],'reference books',true)){
   const book=object(bookValue,'reference book'),bookName=optionalText(book.key,'book key')??optionalText(book.title,'book title');if(!bookName)fail('reference book identity');
   if(kind==='owls')for(const propValue of array(book.props,'reference props',true)){
    const prop=object(propValue,'reference prop'),player=optionalText(prop.playerName,'reference player name'),category=optionalText(prop.category,'reference category'),team=optionalText(prop.team,'reference player team');
    if(!player||!category)fail('reference prop identity');
    const id=prop.propId===undefined||prop.propId===null?JSON.stringify([player,category,prop.line]):observationId(prop.propId);
    // IDs live inside provider/event/book namespaces; preserving another book
    // never permits the same book's ID to select a different actor by order.
    census(props,JSON.stringify([header.id,quoteBook(bookName),id]),[nameKey(player),team?canonicalNbaPropsTeam(team):null],'duplicate reference prop identity');
   }
   else for(const marketValue of array(book.markets,'reference markets',true)){
    const market=object(marketValue,'reference market');optionalText(market.key,'reference market key');
    for(const outcomeValue of array(market.outcomes,'reference outcomes',true)){
     const outcome=object(outcomeValue,'reference outcome');optionalText(outcome.description,'reference player name');optionalText(outcome.name,'reference side');
    }
   }
  }
 }
 return events;
}
export function assertNbaReferenceResponse(value:unknown,eventId:string,game:{homeTeam:string;awayTeam:string;scheduledStart:string}):Row{
 const event=object(value,'targeted odds response'),header=referenceHeader(event,'odds');
 if(header.id!==eventId||header.home!==canonicalNbaPropsTeam(game.homeTeam)||header.away!==canonicalNbaPropsTeam(game.awayTeam)||Math.abs(header.start-Date.parse(game.scheduledStart))>30*60000)fail('targeted odds fixture');
 validatedNbaReferenceEvents([event],'odds');return event;
}
export function assertNbaCurrentQuoteFixtures(rows:readonly {provider:string;scheduledStart?:string|null;homeTeam?:string|null;awayTeam?:string|null}[],game:{start:string;home:string;away:string}){
 for(const row of rows){
  if(row.scheduledStart!==undefined&&row.scheduledStart!==null){const at=Date.parse(row.scheduledStart),limit=row.provider==='balldontlie'?0:30*60000;if(!Number.isFinite(at)||Math.abs(at-Date.parse(game.start))>limit)fail('current quote fixture clock');}
  if(row.homeTeam!==undefined&&row.homeTeam!==null&&canonicalNbaPropsTeam(row.homeTeam)!==canonicalNbaPropsTeam(game.home))fail('current quote home');
  if(row.awayTeam!==undefined&&row.awayTeam!==null&&canonicalNbaPropsTeam(row.awayTeam)!==canonicalNbaPropsTeam(game.away))fail('current quote away');
 }
}

type CurrentPriceQuote={provider:string;canonicalGameId:string|null;canonicalPlayerId:string|null;providerPlayerId:string|null;playerName:string|null;sportsbook:string;market:string;offerType:string;line:number;side:string;americanPrice:number;observedAt:string;isOpening:boolean};
/** Exact economic contract, independent of provider record IDs and input order. */
export function assertNbaCurrentQuotePrices(rows:readonly CurrentPriceQuote[]){
 const seen=new Map<string,string>();
 for(const row of rows){if(row.isOpening)continue;const actor=row.canonicalPlayerId??row.providerPlayerId??nameKey(row.playerName??null);const contract=executionContractKey({playerId:actor??'unresolved',market:row.market,provider:row.provider,book:row.sportsbook,line:row.line,side:row.side==='yes'?'yes':row.side==='under'?'under':'over',offerContract:row.offerType==='milestone'?'milestone':'two_way'});census(seen,JSON.stringify([row.canonicalGameId,contract,row.side,Date.parse(row.observedAt)]),row.americanPrice,'same-clock normalized quote price conflict');}
}

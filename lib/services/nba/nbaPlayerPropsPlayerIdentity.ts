/** One ambiguity-preserving identity join. No market, line or team guesses. */
export function resolveNbaPlayerAliases(entries:Iterable<readonly [string,string]>):Record<string,string>{
 const owners=new Map<string,Set<string>>();
 for(const [label,id] of entries){
  const name=label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  if(!name||!id)continue;
  const ids=owners.get(name)??new Set<string>();ids.add(id);owners.set(name,ids);
 }
 return Object.fromEntries([...owners].filter(([,ids])=>ids.size===1).sort(([a],[b])=>a.localeCompare(b)).map(([name,ids])=>[name,[...ids][0]]));
}

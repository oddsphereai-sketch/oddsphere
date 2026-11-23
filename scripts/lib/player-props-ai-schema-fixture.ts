/* eslint-disable @typescript-eslint/no-explicit-any -- Test-only JSON Schema introspection. */
/** Resolve local schema definitions for structural assertions, never runtime admission. */
export function resolveReviewSchema(root:any,node:any):any{
 if(Array.isArray(node))return node.map(value=>resolveReviewSchema(root,value));
 if(node===null||typeof node!=='object')return node;
 if(typeof node.$ref==='string'){
  if(!/^#\/\$defs\/[a-zA-Z0-9_]+$/.test(node.$ref))throw Error('Unexpected test schema reference');
  const target=root.$defs[node.$ref.slice('#/$defs/'.length)];
  if(!target)throw Error('Missing test schema definition');
  return resolveReviewSchema(root,target);
 }
 return Object.fromEntries(Object.entries(node).map(([key,value])=>[key,resolveReviewSchema(root,value)]));
}
export function reviewActorSchema(root:any,id:string):any{
 const actor=root.properties.players.properties[id];
 return resolveReviewSchema(root,actor.anyOf?.[0]??actor);
}

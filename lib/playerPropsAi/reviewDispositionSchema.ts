/** Express the existing law-or-explicit-exceptions invariant at generation.
 * Local definitions keep the same large actor-local claim catalogs single-copy.
 * This constrains output shape; it never generates, repairs or accepts a law. */
export function reviewDispositionSchema(args:{
  key:string;
  shared:Record<string,unknown>;
  law:unknown;
  qualified:boolean;
  marketCount:number;
  reasons:unknown;
  unsupportedException?:unknown;
  definitions:Record<string,unknown>;
}){
  const {key,shared,law,qualified,marketCount,reasons,definitions}=args;
  const ref=(field:string)=>({$ref:`#/$defs/${key}_${field}`});
  for(const [field,schema]of Object.entries(shared))definitions[`${key}_${field}`]=schema;
  definitions[`${key}_reason`]=reasons;
  const properties=Object.fromEntries(Object.keys(shared).map(field=>[field,ref(field)]));
  const vector=(items:unknown)=>({type:'array',items,minItems:marketCount,maxItems:marketCount});
  const branch=(supported:boolean)=>{
    const {confidence,...readerProperties}=properties;
    const fields={...readerProperties,
      gaps:{type:'array',items:ref('reason'),maxItems:6,...(supported?{}:{minItems:1})},
      law:supported?law:{type:'null'},
      confidence,
      exceptions:vector(supported?{anyOf:[ref('reason'),{type:'null'}]}:args.unsupportedException??ref('reason')),
    };
    return{type:'object',additionalProperties:false,required:Object.keys(fields),properties:fields};
  };
  // With no qualified event only the original explicit unsupported disposition
  // is valid. The parser continues to check each unresolved market's exact reason.
  return qualified?{anyOf:[branch(true),branch(false)]}:branch(false);
}

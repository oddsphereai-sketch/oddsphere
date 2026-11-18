globalThis.fetch=()=>{throw Error('Card-asof controls forbid network');};
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=process.cwd(),rq=createRequire(root+'/package.json'),ts=rq('typescript'),React=rq('react'),render=rq('react-dom/server').renderToStaticMarkup;
const source=fs.readFileSync(root+'/app/player-props/components/NbaPlayerPropsProductDashboard.tsx','utf8')+'\nexport {RadarCard as auditRadarCard,BoardRow as auditBoardRow,localTime as auditLocalTime};';
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const ex={};vm.runInNewContext(code,{module:{exports:ex},exports:ex,Date,console,require:name=>{
 if(name==='react'||name==='react/jsx-runtime')return rq(name);
 if(name.endsWith('/publicationContract'))return rq('./lib/playerPropsAi/publicationContract');
 return new Proxy({},{get:(_,prop)=>prop==='__esModule'?false:(props)=>React.createElement('section',null,props.children)});
}});
const f=rq('./scripts/test-player-props-ai-nba-lock-authority').nbaAuthorityFixture(),row=f.row();
const board=render(React.createElement(ex.auditBoardRow,{row,onSelect:()=>{}})),radar=render(React.createElement(ex.auditRadarCard,{row,onSelect:()=>{}}));
const proof={boardAsOf:board.includes('As of'),radarAsOf:radar.includes('As of'),radarContainsExactPrice:radar.includes(String(row.americanPrice)),evaluatedAtOriginal:row.evaluatedAt,networkCalls:0};
assert(proof.boardAsOf);assert(proof.radarAsOf);assert(board.includes(ex.auditLocalTime(row.evaluatedAt)));assert(radar.includes(ex.auditLocalTime(row.evaluatedAt)));const locked={...row,lockedAt:'2026-11-10T22:00:00Z'},before=JSON.stringify(locked);for(const component of [ex.auditBoardRow,ex.auditRadarCard]){const text=render(React.createElement(component,{row:locked,onSelect:()=>{}}));assert(text.includes(ex.auditLocalTime(locked.evaluatedAt)));assert(text.includes(String(locked.americanPrice)));}assert.equal(JSON.stringify(locked),before);console.log(JSON.stringify({...proof,status:'PASS',bothPublicSurfacesExactStoredAsOf:true,originalLockedRowUnchanged:true}));

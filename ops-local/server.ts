/**
 * Ops dashboard (LOCAL TOOL) — tiny local server.
 *
 * Your private internal control panel. NOT part of the OddSphere app and never
 * deployed — it only runs on your machine when you start it.
 *
 *   npm run ops          → starts the server, opens http://localhost:4317
 *
 * Serves a self-contained dashboard page (no build step) that fetches live
 * numbers from /api/data, which queries the same database read-only.
 */

import http from "http";
import { computeDashboard } from "./data";
import * as store from "./store";
import * as overhaulStore from "./overhaulStore";

const PORT = Number(process.env.OPS_PORT || 4317);

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HQ · OddSphere</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0b0e14; color:#d6dae3; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 20px 80px; }
  header { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:20px; }
  h1 { font-size:22px; margin:0; color:#fff; }
  h1 span { font-size:12px; color:#7a8395; font-weight:400; margin-left:8px; }
  .muted { color:#7a8395; font-size:12px; }
  select { background:#161b26; color:#d6dae3; border:1px solid #232a38; border-radius:6px; padding:6px 8px; }
  section { margin:28px 0; }
  .h2 { display:flex; align-items:baseline; justify-content:space-between; border-bottom:1px solid #1c2230; padding-bottom:6px; margin-bottom:12px; }
  .h2 b { font-size:16px; color:#fff; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px 40px; }
  @media (max-width:760px){ .grid2{grid-template-columns:1fr;} }
  .lbl { text-transform:uppercase; font-size:11px; color:#6b7488; letter-spacing:.04em; margin:10px 0 4px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:10px; text-transform:uppercase; color:#6b7488; font-weight:500; padding:4px 0; }
  th.r,td.r { text-align:right; }
  td { padding:6px 0; border-top:1px solid #141a25; font-variant-numeric:tabular-nums; }
  .pos{color:#34d399;} .neg{color:#fb7185;} .flat{color:#9aa3b2;}
  .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  @media (max-width:760px){ .cards{grid-template-columns:1fr 1fr;} }
  .card { background:#10151f; border:1px solid #1c2230; border-radius:8px; padding:12px; }
  .card .k { font-size:11px; color:#6b7488; } .card .v { font-size:15px; color:#eef1f6; margin-top:4px; font-weight:600; }
  .item { background:#10151f; border:1px solid #1c2230; border-radius:8px; padding:12px; margin-bottom:8px; }
  .chip { font-size:10px; text-transform:uppercase; padding:2px 7px; border-radius:5px; margin-right:6px; }
  .live{background:rgba(52,211,153,.14);color:#6ee7b7;} .partial{background:rgba(251,191,36,.14);color:#fcd34d;}
  .experimental{background:rgba(56,189,248,.14);color:#7dd3fc;} .off{background:rgba(148,163,184,.14);color:#94a3b8;}
  .P0{background:rgba(251,113,133,.14);color:#fda4af;} .P1{background:rgba(251,191,36,.14);color:#fcd34d;} .P2{background:rgba(148,163,184,.14);color:#94a3b8;}
  .Daniel{background:rgba(251,191,36,.12);color:#fde68a;} .Codex{background:rgba(96,165,250,.14);color:#93c5fd;} .Claude{background:rgba(167,139,250,.14);color:#c4b5fd;} .unassigned{background:rgba(148,163,184,.14);color:#cbd5e1;}
  .todo{background:rgba(148,163,184,.14);color:#cbd5e1;} .in_progress{background:rgba(56,189,248,.14);color:#7dd3fc;}
  .blocked{background:rgba(251,113,133,.14);color:#fda4af;} .done{background:rgba(52,211,153,.14);color:#6ee7b7;}
  .item .t { color:#fff; font-weight:600; } .item .d { color:#9aa3b2; margin-top:4px; padding-left:24px; } .item .e { color:#6b7488; font-size:12px; margin-top:4px; }
  .item.done { opacity:.5; }
  .trow { display:flex; align-items:center; gap:8px; }
  .trow input[type=checkbox] { width:16px; height:16px; cursor:pointer; accent-color:#34d399; flex:none; }
  .ctrls { margin-left:auto; display:flex; gap:2px; align-items:center; }
  .mv { background:none; border:1px solid #1c2230; color:#8b95a7; border-radius:4px; font-size:12px; line-height:1; cursor:pointer; padding:3px 6px; }
  .mv:hover { color:#fff; border-color:#2b3343; }
  .del { background:none; border:none; color:#6b7488; font-size:18px; line-height:1; cursor:pointer; padding:0 4px; }
  .del:hover { color:#fb7185; }
  .addrow { display:flex; gap:8px; margin-bottom:12px; }
  .addrow input { flex:1; background:#10151f; border:1px solid #1c2230; border-radius:6px; padding:9px 10px; color:#d6dae3; font-size:13px; }
  .addrow button { background:#1f6feb; border:none; color:#fff; border-radius:6px; padding:9px 16px; cursor:pointer; font-weight:600; }
  .addrow button:hover { background:#2b7bf5; }
  .row { display:flex; gap:12px; margin-bottom:10px; } .row .date { color:#6b7488; font-size:12px; width:88px; flex:none; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:#6b7488; font-size:11px; }
  ul.pr { color:#9aa3b2; padding-left:18px; } ul.pr li { margin:3px 0; }
  .err { background:rgba(251,113,133,.1); color:#fda4af; padding:12px; border-radius:8px; }
</style></head>
<body><div class="wrap">
  <header>
    <h1>HQ <span>OddSphere command center · local only</span></h1>
    <label class="muted">since
      <select id="since">
        <option value="2026-06-01">Jun 1</option>
        <option value="2026-06-08">last 2 wks</option>
        <option value="2026-06-15">last wk</option>
      </select>
    </label>
  </header>
  <div id="root"><div class="muted">Loading live data…</div></div>
</div>
<script>
const u = n => (n>=0?"+":"")+n.toFixed(1)+"u";
const uc = n => n>0.05?"pos":n<-0.05?"neg":"flat";
const ago = iso => { if(!iso) return "—"; const ms=Date.now()-new Date(iso).getTime(); const h=Math.floor(ms/3.6e6),m=Math.floor((ms%3.6e6)/6e4); return h>0?h+"h "+m+"m ago":m+"m ago"; };
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const boardEndpoint = board => board === 'overhaul' ? '/api/overhaul-todos' : '/api/todos';
function todosHtml(todos, board){
  board = board || 'main';
  var open=todos.filter(function(t){return !t.done;}).length;
  return '<div class="muted" style="margin-bottom:8px">'+open+' open · '+todos.length+' total</div>'+
    '<div class="addrow"><input id="newtodo-'+board+'" placeholder="Add a to-do…  (press Enter)"/><button class="addbtn" data-board="'+board+'">Add</button></div>'+
    todos.map(function(t){ return '<div class="item'+(t.done?' done':'')+'"><div class="trow">'+
      '<input type="checkbox" data-board="'+board+'" data-toggle="'+t.id+'"'+(t.done?' checked':'')+'/>'+
      '<span class="chip '+t.priority+'">'+t.priority+'</span>'+
      (t.done?'':'<span class="chip '+t.status+'">'+esc(t.status.replace("_"," "))+'</span>')+
      (t.owner?'<span class="chip '+esc(t.owner)+'">'+esc(t.owner)+'</span>':'')+
      '<span class="muted">'+esc(t.area)+'</span> <b class="t" style="'+(t.done?'text-decoration:line-through;color:#6b7488':'')+'">'+esc(t.title)+'</b>'+
      '<span class="ctrls"><button class="mv" data-board="'+board+'" data-up="'+t.id+'" title="move up">↑</button><button class="mv" data-board="'+board+'" data-down="'+t.id+'" title="move down">↓</button><button class="del" title="delete" data-board="'+board+'" data-del="'+t.id+'">×</button></span></div>'+
      (t.detail?'<div class="d">'+esc(t.detail)+'</div>':'')+
    '</div>'; }).join('');
}
function setTodos(todos, board){
  board = board || 'main';
  var el=document.getElementById(board === 'overhaul' ? 'overhaulTodos' : 'todos');
  if(el)el.innerHTML=todosHtml(todos, board);
}
async function tPost(p, board){ try{ var r=await fetch(boardEndpoint(board),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)}); var j=await r.json(); if(j.todos)setTodos(j.todos, board); }catch(e){} }
function tToggle(id, board){ tPost({action:'toggle',id:id}, board); }
function tDel(id, board){ tPost({action:'delete',id:id}, board); }
function tMove(id,dir,board){ tPost({action:'move',id:id,patch:{dir:dir}}, board); }
function tAdd(board){ var i=document.getElementById('newtodo-'+(board||'main')); var v=(i.value||'').trim(); if(!v)return; i.value=''; tPost({action:'add',todo:{title:v}}, board); }
document.addEventListener('change',function(e){ var id=e.target&&e.target.getAttribute&&e.target.getAttribute('data-toggle'); if(id)tToggle(id,e.target.getAttribute('data-board')||'main'); });
document.addEventListener('click',function(e){ var t=e.target; if(!t||!t.getAttribute)return;
  var board=t.getAttribute('data-board')||'main';
  var del=t.getAttribute('data-del'); if(del){tDel(del,board);return;}
  var up=t.getAttribute('data-up'); if(up){tMove(up,'up',board);return;}
  var dn=t.getAttribute('data-down'); if(dn){tMove(dn,'down',board);return;}
  if(t.classList&&t.classList.contains('addbtn'))tAdd(board); });
document.addEventListener('keydown',function(e){ if(e.target&&e.target.id&&e.target.id.indexOf('newtodo-')===0&&e.key==='Enter')tAdd(e.target.id.replace('newtodo-','')); });
function bucketTable(rows){
  return '<table><thead><tr><th>Bucket</th><th class="r">Record</th><th class="r">Win%</th><th class="r">Units</th></tr></thead><tbody>'+
    rows.map(b=>'<tr><td>'+esc(b.label)+'</td><td class="r">'+b.wins+'-'+b.losses+(b.pushes?'-'+b.pushes:'')+'</td><td class="r flat">'+(b.winPct===null?'—':b.winPct.toFixed(1)+'%')+'</td><td class="r '+uc(b.units)+'">'+u(b.units)+'</td></tr>').join('')+
    '</tbody></table>';
}
function render(d){
  const h=d.health;
  return [
    '<section><div class="h2"><b>Performance</b><span class="muted">'+(d.windowFrom?esc(d.windowFrom)+' → '+esc(d.windowTo)+' · actionable bets, No Play/Toss-Up excluded':'no graded bets')+'</span></div>'+
      '<div class="grid2"><div>'+
        '<div class="lbl">Overall (all sports)</div>'+bucketTable([d.overall])+
        '<div class="lbl">By sport</div>'+bucketTable(d.bySport)+
      '</div><div>'+
        '<div class="lbl">MLB by market</div>'+bucketTable(d.byMarketMlb)+
        '<div class="lbl">MLB by play grade</div>'+bucketTable(d.byPlayGradeMlb)+
      '</div></div>'+
      '<div class="muted" style="margin-top:8px">Local view: <b>only bets with recorded odds are counted</b>, so win% and units always cover the exact same bets.'+(d.excludedNoOdds?' '+d.excludedNoOdds+' bets excluded (no odds saved — mostly early First-inning before the 6/15 fix).':'')+' non-bet states excluded: No Play '+d.nonBet.noPlay+' · Toss-Up '+d.nonBet.tossUp+'.</div>'+
    '</section>',
    '<section><div class="h2"><b>Health</b><span class="muted">generated '+ago(d.generatedAt)+'</span></div>'+
      '<div class="cards">'+
        [['Last slate',h.lastSlateDate||'—'],['Last lock',ago(h.lastLockAt)],['Lines updated',ago(h.lastLinesAt)],['Today graded / pending',h.todayGraded+' / '+h.todayPending]]
          .map(c=>'<div class="card"><div class="k">'+c[0]+'</div><div class="v">'+esc(c[1])+'</div></div>').join('')+
      '</div><div class="muted" style="margin-top:8px">graded coverage (since 6/15): '+(h.gradedRowsBySport.map(s=>s.sport.toUpperCase()+' '+s.graded).join(' · ')||'none')+'</div>'+
    '</section>',
    '<section><div class="h2"><b>Active model rules</b><span class="muted">'+d.content.modelRules.filter(r=>r.status==='live').length+' live</span></div>'+
      d.content.modelRules.map(r=>'<div class="item"><div><span class="chip '+r.status+'">'+r.status+'</span><span class="muted">'+esc(r.sport)+' · '+esc(r.market)+'</span> <b class="t">'+esc(r.name)+'</b>'+(r.since?' <span class="muted">since '+r.since+'</span>':'')+'</div><div class="d">'+esc(r.what)+'</div>'+(r.evidence?'<div class="e">↳ '+esc(r.evidence)+'</div>':'')+'</div>').join('')+
    '</section>',
    '<section><div class="h2"><b>OddSphere Overhaul</b><span class="muted">separate board for Daniel · Codex · Claude</span></div><div id="overhaulTodos">'+todosHtml(d.content.overhaulTodos||[], 'overhaul')+'</div></section>',
    '<section><div class="h2"><b>To-dos</b><span class="muted">general HQ list</span></div><div id="todos">'+todosHtml(d.content.todos, 'main')+'</div></section>',
    '<section><div class="h2"><b>Changelog / decisions</b></div>'+
      d.content.changelog.map(c=>'<div class="row"><div class="date">'+esc(c.date)+'</div><div><div class="t" style="color:#eef1f6;font-weight:600">'+esc(c.title)+'</div><div class="d">'+esc(c.detail)+'</div>'+(c.refs?'<div class="mono">'+esc(c.refs)+'</div>':'')+'</div></div>').join('')+
    '</section>',
    '<section><div class="h2"><b>Standing principles</b></div><ul class="pr">'+d.content.principles.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ul></section>',
  ].join('');
}
async function load(){
  const since=document.getElementById('since').value;
  const root=document.getElementById('root');
  root.innerHTML='<div class="muted">Loading live data…</div>';
  try{
    const r=await fetch('/api/data?since='+since); const d=await r.json();
    if(d.error){ root.innerHTML='<div class="err">Error: '+esc(d.error)+'</div>'; return; }
    root.innerHTML=render(d);
  }catch(e){ root.innerHTML='<div class="err">Error: '+esc(e)+'</div>'; }
}
document.getElementById('since').addEventListener('change',load);
load();
</script>
</body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    // To-do mutations (add / toggle / edit / delete) — shared stores.
    if (req.method === "POST" && (req.url === "/api/todos" || req.url === "/api/overhaul-todos")) {
      const todoStore = req.url === "/api/overhaul-todos" ? overhaulStore : store;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { action, id, todo, patch } = JSON.parse(body || "{}");
          let todos;
          if (action === "add") todos = todoStore.add(todo);
          else if (action === "toggle") todos = todoStore.toggle(id);
          else if (action === "edit") todos = todoStore.update(id, patch);
          else if (action === "delete") todos = todoStore.remove(id);
          else if (action === "move") todos = todoStore.move(id, patch && patch.dir === "down" ? "down" : "up");
          else todos = todoStore.load();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ todos }));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      return;
    }
    if (req.url && req.url.startsWith("/api/data")) {
      const since = new URL(req.url, "http://localhost").searchParams.get("since") || "2026-06-01";
      const data = await computeDashboard(since);
      (data.content as Record<string, unknown>).todos = store.load(); // live, editable
      (data.content as Record<string, unknown>).overhaulTodos = overhaulStore.load();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  HQ · OddSphere command center → http://localhost:${PORT}\n  Local only — not on oddsphere, not deployed. Ctrl-C to stop.\n`);
});

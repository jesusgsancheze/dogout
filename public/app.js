(function(){
'use strict';
const COLS=['players','lineups','games'];
const TABS={roster:'Roster',pizarra:'Pizarra',juegos:'Juegos',stats:'Estadísticas'};
const POS_NAME={P:'Lanzador',C:'Receptor','1B':'Primera base','2B':'Segunda base','3B':'Tercera base',SS:'Campocorto',SC:'5.º infielder',LF:'Jardín izquierdo',LC:'Centro izquierdo',CF:'Jardín central',RC:'Centro derecho',RF:'Jardín derecho',BE:'Bateador extra'};
const ALL_POS=['P','C','1B','2B','3B','SS','SC','LF','LC','CF','RC','RF'];
const RESULTS=[['1B','H','Sencillo','hit'],['2B','2B','Doble','hit'],['3B','3B','Triple','hit'],['HR','HR','Jonrón','hit'],['BB','BB','Base por bolas','bb'],['K','K','Ponche','out'],['OUT','O','Out','out'],['ROE','E','Embasado por error','out'],['FC','BO','Bola ocupada','out'],['SF','SF','Fly de sacrificio','out'],['SH','SH','Toque de sacrificio','out']];
const RES={};RESULTS.forEach(r=>RES[r[0]]={short:r[1],name:r[2],kind:r[3]});
const AB_CODES={'1B':1,'2B':1,'3B':1,'HR':1,K:1,OUT:1,ROE:1,FC:1};
const MAX_ORDER=12;

const S={players:{},lineups:{},games:{}};
let me=null, mode='connecting'; // connecting | login | ready | offline
const ui={tab:'roster',lineupId:null,gameId:null,openPlayer:null,sel:null,confirm:null,statsView:'ofe',statsTour:'',sortKey:'AVG',sortDir:-1,sheet:null,users:null};
try{const saved=JSON.parse(localStorage.getItem('dogout-ui')||'{}');Object.assign(ui,{lineupId:saved.lineupId||null,gameId:saved.gameId||null,statsView:saved.statsView||'ofe'})}catch(e){}
function rememberUi(){try{localStorage.setItem('dogout-ui',JSON.stringify({lineupId:ui.lineupId,gameId:ui.gameId,statsView:ui.statsView}))}catch(e){}}

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const f3=v=>{if(!isFinite(v))v=0;const s=v.toFixed(3);return v<1?s.replace(/^0/,''):s};
const ip=o=>Math.floor((o||0)/3)+'.'+((o||0)%3);
const fdate=d=>{if(!d)return '';const [y,m,dd]=d.split('-');return dd+'/'+m+'/'+y};

/* ---------- API & storage ---------- */
async function api(method,url,body){
  let r;
  try{r=await fetch(url,{method,credentials:'same-origin',headers:{'X-Dogout':'1',...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined})}
  catch(e){const err=new Error('Sin conexión con el servidor.');err.status=0;throw err}
  let data=null;try{data=await r.json()}catch(_){}
  if(r.status===401&&url!=='/api/login'&&url!=='/api/me')onLoggedOut();
  if(!r.ok){const err=new Error((data&&data.error)||('Error '+r.status));err.status=r.status;throw err}
  return data;
}
const timers={},dirty={},inflight={},deleting=new Set();
function isPending(key){return key in dirty||inflight[key]||key in timers||deleting.has(key)}
function save(col,id,data,opts){
  data.updatedAt=Date.now();
  S[col]={...S[col],[id]:data};
  const key=col+'/'+id;dirty[key]=clone(data);
  clearTimeout(timers[key]);timers[key]=setTimeout(()=>{delete timers[key];flush(col,id)},450);
  if(!(opts&&opts.quiet))requestRender();
}
async function flush(col,id){
  const key=col+'/'+id;
  if(inflight[key]||!(key in dirty))return;
  const data=dirty[key];delete dirty[key];inflight[key]=true;
  try{await api('PUT','/api/'+col+'/'+encodeURIComponent(id),data)}
  catch(e){
    if(e.status===0||e.status>=500){if(!(key in dirty))dirty[key]=data;toast('No se pudo guardar. Reintentando…');setTimeout(()=>flush(col,id),5000)}
    else if(e.status!==401)toast(e.message);
  }
  inflight[key]=false;
  if(key in dirty&&!(key in timers))flush(col,id);
}
async function remove(col,id){
  const key=col+'/'+id;clearTimeout(timers[key]);delete timers[key];delete dirty[key];
  const m={...S[col]};delete m[id];S[col]=m;
  deleting.add(key);requestRender();
  try{await api('DELETE','/api/'+col+'/'+encodeURIComponent(id))}catch(e){if(e.status!==401)toast('No se pudo borrar: '+e.message)}
  deleting.delete(key);
}
async function loadData(){
  const d=await api('GET','/api/data');
  COLS.forEach(c=>{
    const m=d[c]||{};
    Object.keys(S[c]).forEach(id=>{if(isPending(c+'/'+id)&&S[c][id])m[id]=S[c][id]});
    deleting.forEach(k=>{const[cc,id]=k.split('/');if(cc===c)delete m[id]});
    S[c]=m;
  });
}
async function start(){
  try{me=await api('GET','/api/me');await loadData();mode='ready'}
  catch(e){mode=e.status===401?'login':'offline'}
  render();
}
function onLoggedOut(){me=null;mode='login';ui.sheet=null;COLS.forEach(c=>S[c]={});render()}
async function init(){
  const h=location.hash.slice(1);if(TABS[h])ui.tab=h;
  render();start();
}
// Pick up changes made from another device.
async function refresh(){if(mode!=='ready'||document.hidden)return;try{await loadData();requestRender()}catch(_){}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
setInterval(refresh,60000);
window.addEventListener('pagehide',()=>{Object.keys(dirty).forEach(key=>{const[c,id]=key.split('/');try{fetch('/api/'+c+'/'+encodeURIComponent(id),{method:'PUT',keepalive:true,credentials:'same-origin',headers:{'X-Dogout':'1','Content-Type':'application/json'},body:JSON.stringify(dirty[key])})}catch(_){}})});
window.addEventListener('beforeunload',e=>{if(Object.keys(dirty).length||Object.values(inflight).some(Boolean)){e.preventDefault();e.returnValue=''}});
const allLoaded=()=>mode==='ready';

/* ---------- render scheduling ---------- */
let needsRender=false,dragging=null,rTimer=null;
function busy(){const a=document.activeElement;return dragging||(a&&a.closest&&a.closest('#view,#sheet')&&/^(INPUT|TEXTAREA)$/.test(a.tagName)&&a.type!=='checkbox')}
function requestRender(){if(busy()){needsRender=true;return}render()}
function laterRender(){clearTimeout(rTimer);rTimer=setTimeout(()=>{if(busy()){needsRender=true}else render()},350)}
document.addEventListener('focusout',()=>setTimeout(()=>{if(needsRender&&!busy()){needsRender=false;render()}},300));

let toastT;function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3200)}

/* ---------- helpers ---------- */
const player=id=>S.players[id];
function pname(id){const p=player(id);return p?p.name:'Jugador eliminado'}
function pshort(id){const p=player(id);if(!p)return '—';const w=p.name.trim().split(/\s+/);return w.length>1?w[0]+' '+w[w.length-1][0]+'.':w[0]}
function pnum(id){const p=player(id);return p&&p.number!==''&&p.number!=null?p.number:'–'}
function playersSorted(onlyActive){return Object.entries(S.players).filter(([,p])=>!onlyActive||p.active!==false).sort((a,b)=>(+a[1].number||999)-(+b[1].number||999)||a[1].name.localeCompare(b[1].name)).map(([id,p])=>({id,...p}))}
function armed(key){return ui.confirm===key}
function arm(key){ui.confirm=key;render();setTimeout(()=>{if(ui.confirm===key){ui.confirm=null;render()}},4000)}
const hasExamples=()=>COLS.some(c=>Object.values(S[c]).some(d=>d.example));

/* ---------- stats ---------- */
function lineStats(l){
  const pa=l.pa||[];const c=k=>pa.filter(x=>x===k).length;
  const s={VB:pa.filter(x=>AB_CODES[x]).length,H2:c('2B'),H3:c('3B'),HR:c('HR'),SH:c('SH'),SF:c('SF'),BB:c('BB'),K:c('K'),CI:l.ci||0,CA:l.ca||0,BR:l.br||0,OUTS:l.outs||0,PO:l.po||0,A:l.a||0,E:l.e||0,DP:l.dp||0};
  s.H=c('1B')+s.H2+s.H3+s.HR;return s;
}
const ZERO=()=>({J:0,VB:0,H:0,H2:0,H3:0,HR:0,SH:0,SF:0,BB:0,K:0,CI:0,CA:0,BR:0,OUTS:0,PO:0,A:0,E:0,DP:0});
function addTo(t,s){for(const k in s)t[k]=(t[k]||0)+s[k];return t}
function rates(s){
  s.AL=s.VB+s.BB+s.SF+s.SH;s.TB=s.H+s.H2+2*s.H3+3*s.HR;
  s.AVG=s.VB?s.H/s.VB:0;const d=s.VB+s.BB+s.SF;s.PDE=d?(s.H+s.BB)/d:0;s.SLG=s.VB?s.TB/s.VB:0;s.OPS=s.PDE+s.SLG;
  s.LT=s.PO+s.A+s.E;s.PDF=s.LT?(s.PO+s.A)/s.LT:0;s.IJ=s.OUTS;return s;
}
function seasonStats(tour){
  const by={};
  Object.values(S.games).forEach(g=>{
    if(tour&&g.tournament!==tour)return;
    const ids=new Set([...(g.order||[]),...Object.keys(g.lines||{})]);
    ids.forEach(pid=>{const l=(g.lines||{})[pid]||{};by[pid]=by[pid]||ZERO();addTo(by[pid],lineStats(l));by[pid].J++});
  });
  Object.values(by).forEach(rates);return by;
}

/* ---------- field geometry (SVG units 100 x 80, home plate at 50,76) ---------- */
function makeSlots(ifc,ofc,prev){
  const pts={C:[50,78.5],P:[50,63],'1B':[64,59],'3B':[36,59]};
  if(ifc===5){pts['2B']=[59.5,51];pts.SS=[40.5,51];pts.SC=[50,44]}else{pts['2B']=[57.5,50.5];pts.SS=[42.5,50.5]}
  if(ofc===4){pts.LF=[19,37];pts.LC=[38.5,23];pts.RC=[61.5,23];pts.RF=[81,37]}else{pts.LF=[25,31];pts.CF=[50,20];pts.RF=[75,31]}
  const order=['LF','LC','CF','RC','RF','SS','SC','2B','3B','P','1B','C'].filter(p=>pts[p]);
  const old={};(prev||[]).forEach(s=>old[s.pos]=s);
  return order.map(pos=>{const o=old[pos];return {pos,x:o&&o.moved?o.x:pts[pos][0],y:o&&o.moved?o.y:pts[pos][1],moved:!!(o&&o.moved),playerId:o?o.playerId||null:null}});
}
function fieldSvg(){
  const H=[50,76],r=70,d=r/Math.SQRT2,dr=27,dd=dr/Math.SQRT2,b=16.8/Math.SQRT2;
  const L=[H[0]-d,H[1]-d],R=[H[0]+d,H[1]-d];
  const stripes=[];for(let i=1;i<7;i+=2){const r1=r*i/7,r2=r*(i+1)/7;const a1=r1/Math.SQRT2,a2=r2/Math.SQRT2;stripes.push(`<path class="f-stripe" d="M${H[0]-a1} ${H[1]-a1} A${r1} ${r1} 0 0 1 ${H[0]+a1} ${H[1]-a1} L${H[0]+a2} ${H[1]-a2} A${r2} ${r2} 0 0 0 ${H[0]-a2} ${H[1]-a2}Z" opacity=".55"/>`)}
  const base=(x,y)=>`<rect class="f-base" x="${x-1}" y="${y-1}" width="2" height="2" transform="rotate(45 ${x} ${y})"/>`;
  return `<svg viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect class="f-foul" x="0" y="0" width="100" height="80"/>
  <path class="f-fair" d="M${H[0]} ${H[1]} L${L[0]} ${L[1]} A${r} ${r} 0 0 1 ${R[0]} ${R[1]}Z"/>
  ${stripes.join('')}
  <path class="f-track" d="M${L[0]+1} ${L[1]-1} A${r+1.2} ${r+1.2} 0 0 1 ${R[0]-1} ${R[1]-1}"/>
  <path class="f-dirt" d="M${H[0]} ${H[1]+2.5} L${H[0]-dd-2} ${H[1]-dd+1} A${dr} ${dr} 0 0 1 ${H[0]+dd+2} ${H[1]-dd+1}Z"/>
  <path class="f-dirt-edge" d="M${H[0]-dd-2} ${H[1]-dd+1} A${dr} ${dr} 0 0 1 ${H[0]+dd+2} ${H[1]-dd+1}"/>
  <circle class="f-dirt" cx="${H[0]}" cy="${H[1]+.5}" r="4"/>
  <path class="f-chalk" d="M${H[0]} ${H[1]} L${L[0]} ${L[1]} M${H[0]} ${H[1]} L${R[0]} ${R[1]}"/>
  <path class="f-chalk" d="M${H[0]} ${H[1]} L${H[0]+b} ${H[1]-b} L${H[0]} ${H[1]-2*b} L${H[0]-b} ${H[1]-b}Z" opacity=".55"/>
  <circle class="f-circle" cx="50" cy="${H[1]-12}" r="2.3"/><rect class="f-base" x="49.3" y="${H[1]-12.2}" width="1.4" height=".4"/>
  ${base(H[0]+b,H[1]-b)}${base(H[0],H[1]-2*b)}${base(H[0]-b,H[1]-b)}
  <path class="f-base" d="M49 ${H[1]-.6} h2 v.8 l-1 .9 l-1 -.9z"/>
  </svg>`;
}

/* ---------- views ---------- */
function render(){
  needsRender=false;
  const ready=mode==='ready';
  $('#tabs').hidden=!ready;$('#account').hidden=!ready;
  if(ready)$('#account').textContent=me?me.username:'Cuenta';
  $('#tabs').innerHTML=ready?Object.entries(TABS).map(([k,v])=>`<button data-act="tab" data-tab="${k}" ${ui.tab===k?'aria-current="page"':''}>${v}</button>`).join(''):'';
  $('#banner').innerHTML=ready&&hasExamples()?`<div class="banner"><span>Estás viendo datos de ejemplo (jugadores, un borrador y un juego) para que pruebes la app.</span><button class="btn sm ${armed('ex')?'danger armed':''}" data-act="clear-examples">${armed('ex')?'Toca otra vez para borrarlos':'Borrar ejemplos'}</button></div>`:'';
  const v=$('#view');
  if(mode==='login'){v.innerHTML=viewLogin();renderSheet();const u=$('#l-user');if(u&&!u.value)u.focus();return}
  if(mode==='offline'){v.innerHTML=`<div class="empty" style="max-width:520px;margin:40px auto"><h3>No se pudo conectar</h3><p>El servidor no respondió. Si la app estaba dormida en Render, tarda alrededor de un minuto en despertar.</p><button class="btn primary" data-act="retry">Intentar de nuevo</button></div>`;return}
  if(!ready){v.innerHTML='<p class="loading">Cargando tu libreta… (si la app estaba dormida puede tardar un minuto)</p>';renderSheet();return}
  v.innerHTML=ui.tab==='roster'?viewRoster():ui.tab==='pizarra'?viewBoard():ui.tab==='juegos'?viewGames():viewStats();
  renderSheet();
}
function viewLogin(){
  return `<form class="card login" id="lform"><div class="brand-ball big" aria-hidden="true"></div><h2>Entrar al dogout</h2><p class="sub">Usa el usuario y la contraseña que te dio el administrador.</p>
    <label class="f">Usuario<input type="text" id="l-user" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
    <label class="f">Contraseña<input type="password" id="l-pass" autocomplete="current-password" required></label>
    <p class="err" id="l-err" hidden></p>
    <button class="btn primary" type="submit" id="l-btn">Entrar</button></form>`;
}

function viewRoster(){
  const ps=playersSorted(),st=seasonStats('');
  const act=ps.filter(p=>p.active!==false).length;
  let h=`<div class="head"><div><h2>Roster</h2><div class="sub">${ps.length} jugadores · ${act} activos</div></div><div class="actions"><button class="btn primary" data-act="new-player">+ Agregar jugador</button></div></div>`;
  if(!ps.length)return h+`<div class="empty"><h3>Tu roster está vacío</h3><p>Agrega a cada jugador con su número y las posiciones que puede jugar. Después podrás armarlos en la pizarra.</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" data-act="new-player">+ Agregar el primer jugador</button><button class="btn" data-act="load-examples">Cargar datos de ejemplo</button></div></div>`;
  h+='<div class="roster">'+ps.map(p=>{const s=st[p.id];return `<div class="card pcard ${p.active===false?'inactive':''}">
    <div class="jersey">${esc(p.number===''||p.number==null?'–':p.number)}</div>
    <div style="min-width:0"><h3>${esc(p.name)}</h3>
      <div class="chips">${(p.positions||[]).map(x=>`<span class="chip" title="${POS_NAME[x]}">${x}</span>`).join('')||'<span class="chip">Sin posición</span>'}</div>
      <div class="pmeta">Batea ${({D:'derecho',Z:'zurdo',A:'ambidiestro'})[p.bats]||'—'} · Lanza ${({D:'derecho',Z:'zurdo'})[p.throws]||'—'}${p.active===false?' · Inactivo':''}</div>
      <div class="pstats num"><div><b>${s?f3(s.AVG):'.000'}</b><span>AVG</span></div><div><b>${s?f3(s.OPS):'.000'}</b><span>OPS</span></div><div><b>${s?s.HR:0}</b><span>HR</span></div><div><b>${s?s.J:0}</b><span>J</span></div></div>
    </div>
    <div class="edit"><button class="btn sm ghost" data-act="edit-player" data-id="${p.id}">Editar</button></div></div>`}).join('')+'</div>';
  return h;
}

function curLineup(){if(ui.lineupId&&S.lineups[ui.lineupId])return ui.lineupId;const ids=Object.entries(S.lineups).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0));return ids.length?ids[0][0]:null}
function viewBoard(){
  const id=curLineup();ui.lineupId=id;
  const list=Object.entries(S.lineups).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0));
  let h=`<div class="head"><div><h2>Pizarra</h2><div class="sub">Arrastra las fichas al campo para armar tu próximo juego</div></div></div>`;
  if(!Object.keys(S.players).length)return h+`<div class="empty"><h3>Primero arma tu roster</h3><p>La pizarra usa a los jugadores del roster como fichas.</p><button class="btn primary" data-act="tab" data-tab="roster">Ir al roster</button></div>`;
  h+=`<div class="toolbar">${list.length?`<select id="lu-select" data-chg="lu-select" aria-label="Borrador">${list.map(([k,l])=>`<option value="${k}" ${k===id?'selected':''}>${esc(l.name||'Sin nombre')}${l.opponent?' · vs '+esc(l.opponent):''}</option>`).join('')}</select>`:''}
    <button class="btn primary" data-act="new-lineup">+ Nuevo borrador</button>${id?`<button class="btn" data-act="dup-lineup">Duplicar</button><button class="btn danger ${armed('dl'+id)?'armed':''}" data-act="del-lineup">${armed('dl'+id)?'¿Borrar? Toca otra vez':'Borrar'}</button>`:''}</div>`;
  if(!id)return h+`<div class="empty"><h3>Sin borradores todavía</h3><p>Crea un borrador para ensayar defensa y orden al bate. Puedes tener varios y compararlos.</p><button class="btn primary" data-act="new-lineup">+ Crear borrador</button></div>`;
  const L=S.lineups[id],slots=L.slots||[];
  const onField=new Set(slots.map(s=>s.playerId).filter(Boolean));
  const posOf={};slots.forEach(s=>{if(s.playerId)posOf[s.playerId]=s.pos});
  const bench=playersSorted(true).filter(p=>!onField.has(p.id));
  const filled=slots.filter(s=>s.playerId).length,order=(L.order||[]).filter(p=>S.players[p]);
  const notInOrder=playersSorted(true).filter(p=>!order.includes(p.id));
  const isSel=(t,v)=>ui.sel&&ui.sel.type===t&&ui.sel.v===v;
  h+=`<div class="board"><div>
    <div class="card fieldcard"><div class="field" id="field">${fieldSvg()}${slots.map((s,i)=>`<div class="tok ${s.playerId?'filled':'empty'} ${isSel('slot',i)?'sel':''}" data-slot="${i}" data-drag="slot" style="left:${s.x}%;top:${s.y/80*100}%" title="${POS_NAME[s.pos]}${s.playerId?': '+esc(pname(s.playerId)):''}"><div class="disc">${s.playerId?esc(pnum(s.playerId)):s.pos}${s.playerId?`<span class="pos">${s.pos}</span>`:''}</div>${s.playerId?`<span class="name">${esc(pshort(s.playerId))}</span>`:''}</div>`).join('')}</div>
    <p class="hint">Arrastra una ficha a una posición, o tócala y luego toca la posición. Suelta una ficha sobre otra para intercambiarlas, en el campo para moverla de profundidad, o en la banca para sacarla.</p></div>
    <div class="bench" id="bench"><h4>Banca · ${bench.length}</h4><div class="bench-list">${bench.length?bench.map(p=>`<div class="bchip ${isSel('bench',p.id)?'sel':''}" data-drag="bench" data-pid="${p.id}"><span class="n">${esc(p.number??'–')}</span>${esc(pshort(p.id))}${(p.positions||[]).length?`<span class="pp">${p.positions.slice(0,3).join('·')}</span>`:''}</div>`).join(''):'<span class="hint" style="margin:0">Todos los jugadores activos están en el campo.</span>'}</div></div>
  </div>
  <div class="card panel">
    <div class="row2"><label class="f">Nombre del borrador<input type="text" id="lu-name" data-chg="lu-field" data-k="name" value="${esc(L.name)}"></label><label class="f">Rival<input type="text" id="lu-opp" data-chg="lu-field" data-k="opponent" value="${esc(L.opponent)}" placeholder="Ej. Bufalos"></label></div>
    <div class="row2"><label class="f">Fecha del juego<input type="date" id="lu-date" data-chg="lu-field" data-k="date" value="${esc(L.date)}"></label><div></div></div>
    <div><h4>Formación</h4><div class="formation">
      <div><span class="lbl">Infield</span><span class="seg">${[4,5].map(n=>`<button data-act="lu-if" data-n="${n}" aria-pressed="${L.ifCount===n}">${n}</button>`).join('')}</span></div>
      <div><span class="lbl">Outfield</span><span class="seg">${[3,4].map(n=>`<button data-act="lu-of" data-n="${n}" aria-pressed="${L.ofCount===n}">${n}</button>`).join('')}</span></div>
      <button class="btn sm ghost" data-act="lu-reset-pos">Restablecer posiciones</button></div></div>
    <div class="counts"><span class="count ${filled===slots.length?'ok':''}">Defensa ${filled}/${slots.length}</span><span class="count ${order.length&&order.length<=MAX_ORDER?'ok':''}">Orden al bate ${order.length}/${MAX_ORDER}</span></div>
    <div><h4>Orden al bate</h4>${order.length?`<ol class="order">${order.map((pid,i)=>`<li><span class="k">${i+1}</span><span class="nm">#${esc(pnum(pid))} ${esc(pname(pid))}</span><span class="ps ${posOf[pid]?'':'be'}" title="${POS_NAME[posOf[pid]||'BE']}">${posOf[pid]||'BE'}</span><span class="mini"><button data-act="ord-up" data-i="${i}" aria-label="Subir">↑</button><button data-act="ord-down" data-i="${i}" aria-label="Bajar">↓</button><button data-act="ord-rm" data-i="${i}" aria-label="Quitar del orden">✕</button></span></li>`).join('')}</ol>`:'<p class="hint" style="margin:0">Al poner jugadores en el campo se agregan aquí. También puedes sumar bateadores extra (BE).</p>'}
      ${order.length<MAX_ORDER&&notInOrder.length?`<div style="margin-top:8px"><select id="lu-addbat" data-chg="lu-addbat" aria-label="Agregar bateador"><option value="">+ Agregar bateador al orden…</option>${notInOrder.map(p=>`<option value="${p.id}">#${esc(p.number??'–')} ${esc(p.name)}</option>`).join('')}</select></div>`:''}
      ${order.length>=MAX_ORDER?'<p class="hint">Llegaste al máximo de 12 bateadores.</p>':''}</div>
    <label class="f">Notas<textarea id="lu-notes" data-chg="lu-field" data-k="notes" placeholder="Ej. Si lanza zurdo, subir a Pérez al 2.º">${esc(L.notes)}</textarea></label>
    <button class="btn primary" data-act="start-game-from-lu" ${order.length?'':'disabled'}>Iniciar juego con este borrador</button>
  </div></div>`;
  return h;
}

function gameResult(g){if(g.status!=='final')return {c:'',t:'EC'};const f=+g.runsFor||0,a=+g.runsAgainst||0;return f>a?{c:'w',t:'G'}:f<a?{c:'l',t:'P'}:{c:'',t:'E'}}
function viewGames(){
  if(ui.gameId&&S.games[ui.gameId])return viewGame(ui.gameId);
  const list=Object.entries(S.games).sort((a,b)=>(b[1].date||'').localeCompare(a[1].date||'')||(b[1].updatedAt||0)-(a[1].updatedAt||0));
  let h=`<div class="head"><div><h2>Juegos</h2><div class="sub">Transcribe el rendimiento de tu equipo juego a juego</div></div><div class="actions"><button class="btn primary" data-act="new-game">+ Nuevo juego</button></div></div>`;
  if(!list.length)return h+`<div class="empty"><h3>Aún no hay juegos</h3><p>Crea un juego desde un borrador de la pizarra o desde cero, y anota cada turno al bate y cada jugada defensiva.</p><button class="btn primary" data-act="new-game">+ Registrar el primer juego</button></div>`;
  return h+'<div class="glist">'+list.map(([id,g])=>{const r=gameResult(g);return `<button class="grow" data-act="open-game" data-id="${id}"><span class="res ${r.c}" title="${r.t==='EC'?'En curso':r.t==='G'?'Ganado':r.t==='P'?'Perdido':'Empate'}">${r.t}</span><span><span class="opp">vs ${esc(g.opponent||'Rival')}</span><br><span class="meta">${fdate(g.date)}${g.tournament?' · '+esc(g.tournament):''}</span></span><span class="score">${+g.runsFor||0}–${+g.runsAgainst||0}</span><span aria-hidden="true" style="color:var(--muted)">›</span></button>`}).join('')+'</div>';
}
function stepper(act,val,label,extra){return `<span class="stepper" role="group" aria-label="${label}"><button data-act="${act}" data-d="-1" ${extra||''} aria-label="Restar">−</button><output>${val}</output><button data-act="${act}" data-d="1" ${extra||''} aria-label="Sumar">+</button></span>`}
function paChips(pa,editable,pid){return (pa||[]).map((c,i)=>{const r=RES[c]||{short:c,kind:'out'};const cls=c==='HR'?'hr':r.kind==='hit'?'hit':r.kind==='bb'?'bb':'';return editable?`<button class="r ${cls}" data-act="pa-rm" data-pid="${pid}" data-i="${i}" title="Quitar ${r.name}">${r.short} ✕</button>`:`<span class="r ${cls}" title="${r.name}">${r.short}</span>`}).join('')}
function viewGame(id){
  const g=S.games[id],order=g.order||[],lines=g.lines||{};
  const tours=[...new Set(Object.values(S.games).map(x=>x.tournament).filter(Boolean))];
  let h=`<div class="toolbar"><button class="btn ghost" data-act="close-game">‹ Todos los juegos</button><span style="margin-left:auto"></span><button class="btn danger ${armed('dg'+id)?'armed':''}" data-act="del-game">${armed('dg'+id)?'¿Borrar juego? Toca otra vez':'Borrar juego'}</button></div>
  <div class="card"><div class="ghead">
    <label class="f">Rival<input type="text" id="g-opp" data-chg="g-field" data-k="opponent" value="${esc(g.opponent)}"></label>
    <label class="f">Fecha<input type="date" id="g-date" data-chg="g-field" data-k="date" value="${esc(g.date)}"></label>
    <label class="f">Torneo<input type="text" id="g-tour" list="tours" data-chg="g-field" data-k="tournament" value="${esc(g.tournament)}" placeholder="Ej. Bola Puesta Empresarial"><datalist id="tours">${tours.map(t=>`<option value="${esc(t)}">`).join('')}</datalist></label>
    <label class="f">Estado<select id="g-status" data-chg="g-field" data-k="status"><option value="live" ${g.status!=='final'?'selected':''}>En curso</option><option value="final" ${g.status==='final'?'selected':''}>Final</option></select></label>
  </div><div class="bigscore">
    <div class="side"><span>Nosotros (CA)</span>${stepper('g-runs',+g.runsFor||0,'Carreras a favor','data-k="runsFor"')}</div>
    <div class="side"><span>Ellos (CP)</span>${stepper('g-runs',+g.runsAgainst||0,'Carreras en contra','data-k="runsAgainst"')}</div>
    <div class="side"><span>Innings jugados</span>${stepper('g-inn',+g.innings||0,'Innings')}</div>
    <div class="side" style="margin-left:auto"><span>&nbsp;</span><button class="btn sm" data-act="fill-ij" title="Asigna los innings del juego a todos los que jugaron a la defensa">Completar IJ de la defensa</button></div>
  </div></div>`;
  h+=`<div class="lines">`+(order.length?order.map((pid,i)=>{
    const l=lines[pid]||{},s=lineStats(l),open=ui.openPlayer===pid;
    const sum=`${s.H}-${s.VB}${s.HR?`, ${s.HR} HR`:''}${s.CI?`, ${s.CI} CI`:''}${s.CA?`, ${s.CA} CA`:''}${s.BB?`, ${s.BB} BB`:''}`;
    return `<div class="line ${open?'open':''}"><button class="lhead" data-act="toggle-line" data-pid="${pid}" aria-expanded="${open}"><span class="k">${i+1}</span><span style="min-width:0"><span class="nm">#${esc(pnum(pid))} ${esc(pname(pid))}<small>${l.pos||'BE'}</small></span><span class="pa">${paChips(l.pa)}</span></span><span class="sum">${sum}<br><span style="font-size:11px">${s.PO||s.A||s.E?`${s.PO} PO · ${s.A} A${s.E?` · ${s.E} E`:''}`:''}</span></span></button>
    ${open?`<div class="lbody">
      <div><h4>Turno al bate — toca el resultado</h4><div class="rgrid">${RESULTS.map(([c,sh,nm,k])=>`<button class="rbtn ${k}" data-act="pa-add" data-pid="${pid}" data-c="${c}"><b>${sh}</b><span>${nm}</span></button>`).join('')}</div>
      ${(l.pa||[]).length?`<h4>Turnos anotados (toca para quitar)</h4><div class="editpa pa">${paChips(l.pa,true,pid)}</div>`:''}</div>
      <div><h4>Ofensiva</h4><div class="steps">
        ${[['ci','CI','Carreras impulsadas'],['ca','CA','Carreras anotadas'],['br','BR','Bases robadas']].map(([k,ab,nm])=>`<div class="st"><span class="lb">${ab}<small>${nm}</small></span>${stepper('l-step',l[k]||0,nm,`data-pid="${pid}" data-k="${k}"`)}</div>`).join('')}</div></div>
      <div><h4>Defensiva</h4><div class="steps">
        <div class="st"><span class="lb">IJ<small>Innings jugados</small></span><span class="stepper"><button data-act="l-outs" data-pid="${pid}" data-d="-1" aria-label="Restar un out">−</button><output>${ip(l.outs)}</output><button data-act="l-outs" data-pid="${pid}" data-d="1" aria-label="Sumar un out">+⅓</button><button data-act="l-outs" data-pid="${pid}" data-d="3" aria-label="Sumar un inning">+1</button></span></div>
        ${[['po','PO','Outs realizados'],['a','A','Asistencias'],['e','E','Errores'],['dp','DP','Doble play']].map(([k,ab,nm])=>`<div class="st"><span class="lb">${ab}<small>${nm}</small></span>${stepper('l-step',l[k]||0,nm,`data-pid="${pid}" data-k="${k}"`)}</div>`).join('')}</div></div>
      <div class="lfoot"><label class="f" style="flex-direction:row;align-items:center;gap:8px">Posición<select data-chg="l-pos" data-pid="${pid}" id="lpos-${pid}">${['BE',...ALL_POS].map(p=>`<option value="${p}" ${(l.pos||'BE')===p?'selected':''}>${p} · ${POS_NAME[p]}</option>`).join('')}</select></label>
        <span class="mini"><button data-act="g-up" data-i="${i}" aria-label="Subir en el orden">↑</button><button data-act="g-down" data-i="${i}" aria-label="Bajar en el orden">↓</button></span>
        <button class="btn sm danger ${armed('gl'+pid)?'armed':''}" data-act="g-rm" data-pid="${pid}" style="margin-left:auto">${armed('gl'+pid)?'¿Quitar? Toca otra vez':'Quitar del juego'}</button></div>
    </div>`:''}</div>`}).join(''):`<div class="empty"><h3>Sin jugadores en este juego</h3><p>Agrega a los jugadores en el orden en que batearon.</p></div>`)+`</div>`;
  const notIn=playersSorted().filter(p=>!order.includes(p.id));
  if(notIn.length)h+=`<div style="margin-top:10px;max-width:420px"><select id="g-add" data-chg="g-add" aria-label="Agregar jugador"><option value="">+ Agregar jugador o emergente…</option>${notIn.map(p=>`<option value="${p.id}">#${esc(p.number??'–')} ${esc(p.name)}</option>`).join('')}</select></div>`;
  // box score
  const rows=order.map(pid=>({pid,s:rates(lineStats(lines[pid]||{}))}));
  const tot=rates(rows.reduce((t,r)=>addTo(t,r.s),ZERO()));
  h+=`<div class="section"><h3>Box score</h3>${tableOfe(rows,tot,false)}</div><div class="section"><h3>Defensiva</h3>${tableDef(rows,tot,false)}</div>`;
  return h;
}
const OFE_COLS=[['VB','Veces al bate'],['H','Hits'],['H2','Dobles'],['H3','Triples'],['HR','Jonrones'],['SH','Toques de sacrificio'],['SF','Flies de sacrificio'],['AL','Apariciones legales'],['CI','Carreras impulsadas'],['CA','Carreras anotadas'],['BR','Bases robadas'],['BB','Bases por bolas'],['K','Ponches'],['PDE','Porcentaje de embasado',1],['SLG','Slugging',1],['AVG','Promedio al bate',1],['OPS','Embasado + slugging',1]];
const DEF_COLS=[['IJ','Innings jugados',2],['PO','Outs realizados'],['A','Asistencias'],['E','Errores'],['DP','Doble play'],['LT','Lances totales'],['PDF','Porcentaje de fildeo',1]];
function cell(v,t){return t===1?f3(v):t===2?ip(v):v}
function statTable(cols,rows,tot,sortable,withJ){
  const sk=ui.sortKey,sd=ui.sortDir;
  const head=`<tr><th>Jugador</th>${withJ?`<th>${sortable?`<button data-act="sort" data-k="J">J</button>`:'J'}</th>`:''}${cols.map(([k,t])=>`<th class="${sortable&&sk===k?'on':''}" title="${t}">${sortable?`<button data-act="sort" data-k="${k}">${k}${sk===k?(sd<0?' ↓':' ↑'):''}</button>`:k}</th>`).join('')}</tr>`;
  const body=rows.map(r=>`<tr><td>#${esc(pnum(r.pid))} ${esc(pname(r.pid))}</td>${withJ?`<td>${r.s.J}</td>`:''}${cols.map(([k,,t])=>`<td class="${sortable&&sk===k?'hl':''}">${cell(r.s[k],t)}</td>`).join('')}</tr>`).join('');
  const foot=`<tr class="tot"><td>Totales</td>${withJ?`<td>${tot.J}</td>`:''}${cols.map(([k,,t])=>`<td>${k==='IJ'?'—':cell(tot[k],t)}</td>`).join('')}</tr>`;
  return `<div class="tablewrap"><table class="stats"><thead>${head}</thead><tbody>${body}${rows.length?foot:''}</tbody></table></div>`;
}
const tableOfe=(r,t,s,j)=>statTable(OFE_COLS,r,t,s,j);
const tableDef=(r,t,s,j)=>statTable(DEF_COLS,r,t,s,j);
function viewStats(){
  const tours=[...new Set(Object.values(S.games).map(x=>x.tournament).filter(Boolean))].sort();
  if(ui.statsTour&&!tours.includes(ui.statsTour))ui.statsTour='';
  const by=seasonStats(ui.statsTour);
  let rows=Object.entries(by).map(([pid,s])=>({pid,s}));
  const cols=ui.statsView==='ofe'?OFE_COLS:DEF_COLS;
  if(!cols.some(c=>c[0]===ui.sortKey)&&ui.sortKey!=='J')ui.sortKey=ui.statsView==='ofe'?'AVG':'PDF';
  rows.sort((a,b)=>((a.s[ui.sortKey]||0)-(b.s[ui.sortKey]||0))*ui.sortDir||b.s.AL-a.s.AL);
  const tot=rates(rows.reduce((t,r)=>addTo(t,r.s),ZERO()));
  const gs=Object.values(S.games).filter(g=>!ui.statsTour||g.tournament===ui.statsTour);
  const fin=gs.filter(g=>g.status==='final');let W=0,Lo=0,E=0,CA=0,CP=0;
  fin.forEach(g=>{const f=+g.runsFor||0,a=+g.runsAgainst||0;CA+=f;CP+=a;f>a?W++:f<a?Lo++:E++});
  tot.J=gs.length;
  let h=`<div class="head"><div><h2>Estadísticas</h2><div class="sub">Acumulado de los juegos que has transcrito</div></div><div class="actions">
    <select id="st-tour" data-chg="st-tour" aria-label="Torneo" style="width:auto"><option value="">Todos los torneos</option>${tours.map(t=>`<option ${t===ui.statsTour?'selected':''}>${esc(t)}</option>`).join('')}</select>
    <span class="seg"><button data-act="st-view" data-v="ofe" aria-pressed="${ui.statsView==='ofe'}">Ofensiva</button><button data-act="st-view" data-v="def" aria-pressed="${ui.statsView==='def'}">Defensiva</button></span></div></div>`;
  h+=`<div class="kpis"><div class="card kpi"><b>${W}-${Lo}${E?'-'+E:''}</b><span>Récord G-P</span></div><div class="card kpi"><b>${fin.length?f3(W/fin.length):'.000'}</b><span>AVG equipo</span></div><div class="card kpi"><b>${CA}</b><span>Carreras a favor</span></div><div class="card kpi"><b>${CP}</b><span>Carreras en contra</span></div><div class="card kpi"><b>${CA-CP>0?'+':''}${CA-CP}</b><span>Diferencia</span></div><div class="card kpi"><b>${f3(tot.AVG)}</b><span>Promedio al bate</span></div></div>`;
  if(!rows.length)return h+`<div class="empty"><h3>Todavía no hay estadísticas</h3><p>Se calculan solas a partir de los juegos que registres en la pestaña Juegos.</p><button class="btn primary" data-act="tab" data-tab="juegos">Ir a Juegos</button></div>`;
  h+=ui.statsView==='ofe'?tableOfe(rows,tot,true,true):tableDef(rows,tot,true,true);
  h+=ui.statsView==='ofe'?`<p class="gloss"><b>AL</b> = VB + BB + SF + SH. <b>AVG</b> = H / VB. <b>PDE</b> = (H + BB) / (VB + BB + SF). <b>SLG</b> = bases totales / VB. <b>OPS</b> = PDE + SLG. Un embasado por error o una bola ocupada cuentan como VB sin hit. Mismas columnas que usa beisbolysoftbol.com.</p>`:`<p class="gloss"><b>IJ</b> se muestra en innings y tercios (17.2 = 17 innings y 2 outs). <b>LT</b> = PO + A + E. <b>PDF</b> = (PO + A) / LT.</p>`;
  return h;
}

/* ---------- sheets ---------- */
function renderSheet(){
  const el=$('#sheet');
  if(!ui.sheet){el.innerHTML='';return}
  if(ui.sheet.type==='player'){
    const p=ui.sheet.id?S.players[ui.sheet.id]||{}:{positions:[],bats:'D',throws:'D',active:true};
    el.innerHTML=`<div class="overlay" data-act="close-sheet-bg"><form class="sheet" id="pform" role="dialog" aria-label="Jugador">
      <h3>${ui.sheet.id?'Editar jugador':'Nuevo jugador'}</h3>
      <div class="row2" style="grid-template-columns:2fr 1fr"><label class="f">Nombre y apellido<input type="text" id="pf-name" value="${esc(p.name)}" required autocomplete="off"></label><label class="f">Número<input type="number" id="pf-num" min="0" max="99" inputmode="numeric" value="${esc(p.number)}"></label></div>
      <div><label class="f" style="margin-bottom:6px">Posiciones que juega</label><div class="checks">${ALL_POS.map(x=>`<label title="${POS_NAME[x]}"><input type="checkbox" name="pf-pos" value="${x}" ${(p.positions||[]).includes(x)?'checked':''}>${x}</label>`).join('')}</div></div>
      <div class="row2"><label class="f">Batea<select id="pf-bats"><option value="D" ${p.bats==='D'?'selected':''}>Derecho</option><option value="Z" ${p.bats==='Z'?'selected':''}>Zurdo</option><option value="A" ${p.bats==='A'?'selected':''}>Ambidiestro</option></select></label><label class="f">Lanza<select id="pf-throws"><option value="D" ${p.throws==='D'?'selected':''}>Derecho</option><option value="Z" ${p.throws==='Z'?'selected':''}>Zurdo</option></select></label></div>
      <div class="checks"><label><input type="checkbox" id="pf-active" ${p.active!==false?'checked':''}>Activo (aparece en la banca de la pizarra)</label></div>
      <div class="foot">${ui.sheet.id?`<button type="button" class="btn danger ${armed('dp'+ui.sheet.id)?'armed':''}" data-act="del-player">${armed('dp'+ui.sheet.id)?'¿Borrar? Toca otra vez':'Borrar jugador'}</button>`:'<span style="margin-right:auto"></span>'}<button type="button" class="btn" data-act="close-sheet">Cancelar</button><button type="submit" class="btn primary">Guardar</button></div>
    </form></div>`;
    if(!ui.sheet.focused){ui.sheet.focused=1;setTimeout(()=>{const n=$('#pf-name');n&&n.focus()},30)}
  }else if(ui.sheet.type==='game'){
    const lus=Object.entries(S.lineups).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0));
    const tours=[...new Set(Object.values(S.games).map(x=>x.tournament).filter(Boolean))];
    el.innerHTML=`<div class="overlay" data-act="close-sheet-bg"><form class="sheet" id="gform" role="dialog" aria-label="Nuevo juego">
      <h3>Nuevo juego</h3>
      <div class="row2"><label class="f">Rival<input type="text" id="gf-opp" required autocomplete="off"></label><label class="f">Fecha<input type="date" id="gf-date" value="${today()}"></label></div>
      <label class="f">Torneo<input type="text" id="gf-tour" list="gf-tours" value="${esc(tours[0]||'')}"><datalist id="gf-tours">${tours.map(t=>`<option value="${esc(t)}">`).join('')}</datalist></label>
      <label class="f">Partir de un borrador<select id="gf-lu"><option value="">Empezar sin jugadores</option>${lus.map(([k,l])=>`<option value="${k}">${esc(l.name||'Sin nombre')}${l.opponent?' · vs '+esc(l.opponent):''}</option>`).join('')}</select></label>
      <div class="foot"><span style="margin-right:auto"></span><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button type="submit" class="btn primary">Crear juego</button></div>
    </form></div>`;
    if(!ui.sheet.focused){ui.sheet.focused=1;setTimeout(()=>{const n=$('#gf-opp');n&&n.focus()},30)}
  }else if(ui.sheet.type==='account'){
    const admin=me&&me.role==='admin';
    el.innerHTML=`<div class="overlay" data-act="close-sheet-bg"><div class="sheet" role="dialog" aria-label="Cuenta">
      <h3>Cuenta</h3><p class="sub" style="margin:0">Sesión iniciada como <b>${esc(me.username)}</b> · ${admin?'Administrador':'Miembro'}</p>
      <form id="cpform" class="subform"><h4>Cambiar contraseña</h4><div class="row2"><label class="f">Actual<input type="password" id="cp-cur" autocomplete="current-password" required></label><label class="f">Nueva (mín. 8)<input type="password" id="cp-new" autocomplete="new-password" minlength="8" required></label></div><div><button class="btn" type="submit">Cambiar contraseña</button></div></form>
      ${admin?`<div class="subform"><h4>Usuarios</h4>${ui.users?`<ul class="ulist">${ui.users.map(u=>`<li><span><b>${esc(u.username)}</b><small>${u.role==='admin'?'Administrador':'Miembro'}${u.lastLoginAt?' · último acceso '+new Date(u.lastLoginAt).toLocaleDateString('es-VE'):' · nunca ha entrado'}</small></span>${u.username!==me.username?`<button class="btn sm danger ${armed('du'+u.username)?'armed':''}" data-act="del-user" data-u="${esc(u.username)}">${armed('du'+u.username)?'¿Borrar? Toca otra vez':'Borrar'}</button>`:'<small>Tú</small>'}</li>`).join('')}</ul>`:'<p class="hint">Cargando usuarios…</p>'}
        <form id="uform" style="display:flex;flex-direction:column;gap:8px"><div class="row2"><label class="f">Nuevo usuario<input type="text" id="u-name" autocapitalize="none" autocomplete="off" spellcheck="false" required></label><label class="f">Contraseña (mín. 8)<input type="password" id="u-pass" autocomplete="new-password" minlength="8" required></label></div><div class="lfoot"><label class="f" style="flex-direction:row;align-items:center;gap:8px">Rol<select id="u-role"><option value="member">Miembro</option><option value="admin">Administrador</option></select></label><button class="btn" type="submit">Crear usuario</button></div></form></div>`:''}
      <div class="subform"><h4>Respaldo</h4><p class="hint" style="margin:0 0 8px">Descarga todos tus jugadores, borradores y juegos en un archivo JSON.</p><a class="btn" href="/api/export">Descargar respaldo</a></div>
      <div class="foot"><button type="button" class="btn danger" data-act="logout">Cerrar sesión</button><button type="button" class="btn" data-act="close-sheet">Cerrar</button></div>
    </div></div>`;
    if(admin&&!ui.users&&!ui.loadingUsers){ui.loadingUsers=true;api('GET','/api/users').then(l=>{ui.users=l}).catch(e=>toast(e.message)).finally(()=>{ui.loadingUsers=false;if(ui.sheet&&ui.sheet.type==='account')requestRender()})}
  }
}

/* ---------- example data ---------- */
function loadExamples(){
  const now=Date.now();
  const P=[["Luis Mendoza",7,["SS","2B"],"D","D"],["Carlos Rivas",12,["CF","LF"],"Z","Z"],["José Pérez",23,["1B","3B"],"D","D"],["Andrés Gómez",4,["3B","SS"],"D","D"],["Miguel Torres",9,["C"],"D","D"],["Daniel Rojas",15,["LF","RF"],"A","D"],["Ricardo Silva",21,["P","1B"],"D","D"],["Fernando Castro",2,["2B","SS"],"D","D"],["Jorge Herrera",30,["RF","CF"],"Z","Z"],["Pedro Morales",18,["P","3B"],"D","D"],["Óscar Medina",11,["C","1B"],"D","D"],["Víctor Paredes",5,["LF","CF","RF"],"D","D"]];
  const ids=P.map((_,i)=>'ex-p'+String(i+1).padStart(2,'0'));
  P.forEach(([name,number,positions,bats,throws],i)=>save('players',ids[i],{name,number,positions,bats,throws,active:true,example:true,createdAt:now},{quiet:1}));
  const assign={LF:5,CF:1,RF:8,SS:0,'2B':7,'3B':3,P:6,'1B':2,C:4};
  const slots=makeSlots(4,3).map(s=>({...s,playerId:ids[assign[s.pos]]}));
  const order=[1,0,2,3,8,4,5,7,6,11].map(i=>ids[i]);
  save('lineups','ex-lu1',{name:'Vs Bufalos (ejemplo)',opponent:'Bufalos',date:'',ifCount:4,ofCount:3,slots,order,notes:'Víctor Paredes entra como bateador extra (BE).',example:true,createdAt:now},{quiet:1});
  const posOf={};slots.forEach(s=>posOf[s.playerId]=s.pos);
  const pas=[["1B","OUT","2B","BB"],["1B","K","HR","1B"],["2B","OUT","1B","SF"],["OUT","1B","OUT","2B"],["HR","OUT","1B"],["BB","1B","K"],["OUT","1B","FC"],["1B","OUT","ROE"],["K","OUT","1B"],["OUT","BB","1B"]];
  const extra=[{ci:1,ca:2,br:1,po:1,a:4},{ci:1,ca:2,po:4},{ci:3,ca:1,po:8,e:1},{ci:1,ca:1,po:1,a:2},{ci:2,ca:1,po:2},{ca:1,po:2},{ca:1,po:3,a:3,dp:1},{ci:1,po:1,a:3,dp:1},{po:2,a:1},{ci:1,ca:1}];
  const lines={};order.forEach((pid,i)=>{const pos=posOf[pid]||'BE';lines[pid]={pos,pa:pas[i],...extra[i],...(pos!=='BE'?{outs:21}:{})}});
  save('games','ex-g1',{date:today(),opponent:'Astros',tournament:'Torneo de ejemplo',runsFor:11,runsAgainst:8,innings:7,status:'final',lineupId:'ex-lu1',order,lines,example:true,createdAt:now});
  toast('Datos de ejemplo cargados. Bórralos cuando quieras desde la barra amarilla.');
}

/* ---------- actions ---------- */
function editLineup(fn,quiet){const id=ui.lineupId;if(!id||!S.lineups[id])return;const d=clone(S.lineups[id]);fn(d);save('lineups',id,d,quiet?{quiet:1}:null)}
function editGame(fn,quiet){const id=ui.gameId;if(!id||!S.games[id])return;const d=clone(S.games[id]);d.lines=d.lines||{};d.order=d.order||[];fn(d);save('games',id,d,quiet?{quiet:1}:null)}
function newLineup(){const id=uid();save('lineups',id,{name:'Borrador '+(Object.keys(S.lineups).length+1),opponent:'',date:'',ifCount:4,ofCount:3,slots:makeSlots(4,3),order:[],notes:'',createdAt:Date.now()});ui.lineupId=id;rememberUi()}
function assignSlot(L,idx,pid){
  L.slots.forEach(s=>{if(s.playerId===pid)s.playerId=null});
  L.slots[idx].playerId=pid;
  L.order=L.order||[];if(!L.order.includes(pid)&&L.order.length<MAX_ORDER)L.order.push(pid);
}
function gameFromLineup(lid,meta){
  const L=lid&&S.lineups[lid];const order=L?(L.order||[]).filter(p=>S.players[p]):[];
  const posOf={};if(L)(L.slots||[]).forEach(s=>{if(s.playerId)posOf[s.playerId]=s.pos});
  const lines={};order.forEach(pid=>lines[pid]={pos:posOf[pid]||'BE',pa:[]});
  const id=uid();save('games',id,{date:meta.date||today(),opponent:meta.opponent||'',tournament:meta.tournament||'',runsFor:0,runsAgainst:0,innings:0,status:'live',lineupId:lid||null,order,lines,createdAt:Date.now()});
  ui.gameId=id;ui.openPlayer=order[0]||null;ui.tab='juegos';location.hash='juegos';rememberUi();
}

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el)return;
  const a=el.dataset.act,d=el.dataset;
  if(a==='close-sheet-bg'){if(e.target===el){ui.sheet=null;render()}return}
  switch(a){
    case 'tab':ui.tab=d.tab;ui.sel=null;try{history.replaceState(null,'','#'+d.tab)}catch(_){location.hash=d.tab}render();window.scrollTo(0,0);break;
    case 'new-player':ui.sheet={type:'player'};render();break;
    case 'edit-player':ui.sheet={type:'player',id:d.id};render();break;
    case 'close-sheet':ui.sheet=null;render();break;
    case 'account':ui.sheet={type:'account'};ui.users=null;render();break;
    case 'logout':api('POST','/api/logout').catch(()=>{}).finally(onLoggedOut);break;
    case 'retry':mode='connecting';render();start();break;
    case 'load-examples':loadExamples();break;
    case 'del-user':if(!armed('du'+d.u))return arm('du'+d.u);ui.confirm=null;api('DELETE','/api/users/'+encodeURIComponent(d.u)).then(()=>{ui.users=null;toast('Usuario borrado.');render()}).catch(e=>toast(e.message));break;
    case 'del-player':{const id=ui.sheet.id;if(!armed('dp'+id))return arm('dp'+id);ui.confirm=null;ui.sheet=null;remove('players',id);
      Object.entries(S.lineups).forEach(([lid,L])=>{if((L.slots||[]).some(s=>s.playerId===id)||(L.order||[]).includes(id)){const c=clone(L);c.slots.forEach(s=>{if(s.playerId===id)s.playerId=null});c.order=(c.order||[]).filter(x=>x!==id);save('lineups',lid,c,{quiet:1})}});
      toast('Jugador borrado. Sus estadísticas en juegos anteriores se mantienen.');break}
    case 'clear-examples':if(!armed('ex'))return arm('ex');ui.confirm=null;COLS.forEach(c=>Object.entries(S[c]).forEach(([id,doc])=>{if(doc.example)remove(c,id)}));ui.gameId=null;ui.lineupId=null;toast('Ejemplos borrados. Ya puedes cargar a tu equipo.');break;
    case 'new-lineup':newLineup();break;
    case 'dup-lineup':{const L=clone(S.lineups[ui.lineupId]);delete L.example;L.name=(L.name||'Borrador')+' (copia)';L.createdAt=Date.now();const id=uid();save('lineups',id,L);ui.lineupId=id;rememberUi();break}
    case 'del-lineup':{const id=ui.lineupId;if(!armed('dl'+id))return arm('dl'+id);ui.confirm=null;ui.lineupId=null;remove('lineups',id);break}
    case 'lu-if':editLineup(L=>{L.ifCount=+d.n;L.slots=makeSlots(L.ifCount,L.ofCount,L.slots)});ui.sel=null;break;
    case 'lu-of':editLineup(L=>{L.ofCount=+d.n;L.slots=makeSlots(L.ifCount,L.ofCount,L.slots)});ui.sel=null;break;
    case 'lu-reset-pos':editLineup(L=>{L.slots.forEach(s=>s.moved=false);L.slots=makeSlots(L.ifCount,L.ofCount,L.slots)});break;
    case 'ord-up':case 'ord-down':editLineup(L=>{L.order=(L.order||[]).filter(p=>S.players[p]);const i=+d.i,j=a==='ord-up'?i-1:i+1;if(j<0||j>=L.order.length)return;[L.order[i],L.order[j]]=[L.order[j],L.order[i]]});break;
    case 'ord-rm':editLineup(L=>{L.order=(L.order||[]).filter(p=>S.players[p]);L.order.splice(+d.i,1)});break;
    case 'start-game-from-lu':{const L=S.lineups[ui.lineupId];gameFromLineup(ui.lineupId,{opponent:L.opponent,date:L.date,tournament:[...new Set(Object.values(S.games).map(x=>x.tournament).filter(Boolean))][0]||''});break}
    case 'new-game':ui.sheet={type:'game'};render();break;
    case 'open-game':ui.gameId=d.id;const g=S.games[d.id];ui.openPlayer=null;rememberUi();render();window.scrollTo(0,0);break;
    case 'close-game':ui.gameId=null;rememberUi();render();break;
    case 'del-game':{const id=ui.gameId;if(!armed('dg'+id))return arm('dg'+id);ui.confirm=null;ui.gameId=null;rememberUi();remove('games',id);break}
    case 'g-runs':editGame(G=>{G[d.k]=Math.max(0,(+G[d.k]||0)+(+d.d))});break;
    case 'g-inn':editGame(G=>{G.innings=Math.max(0,(+G.innings||0)+(+d.d))});break;
    case 'fill-ij':{const G=S.games[ui.gameId];if(!(+G.innings)){toast('Primero indica cuántos innings se jugaron.');break}editGame(G=>{G.order.forEach(pid=>{const l=G.lines[pid]=G.lines[pid]||{pa:[]};if(l.pos&&l.pos!=='BE')l.outs=G.innings*3})});toast('IJ asignado a quienes jugaron a la defensa.');break}
    case 'toggle-line':ui.openPlayer=ui.openPlayer===d.pid?null:d.pid;render();break;
    case 'pa-add':editGame(G=>{const l=G.lines[d.pid]=G.lines[d.pid]||{pos:'BE'};l.pa=l.pa||[];l.pa.push(d.c);if(d.c==='HR'){l.ca=(l.ca||0)+1;l.ci=(l.ci||0)+1}});if(d.c==='HR')toast('Jonrón: sumé 1 CA y 1 CI. Ajusta las CI si había corredores.');break;
    case 'pa-rm':editGame(G=>{const l=G.lines[d.pid];if(l&&l.pa)l.pa.splice(+d.i,1)});break;
    case 'l-step':editGame(G=>{const l=G.lines[d.pid]=G.lines[d.pid]||{pos:'BE',pa:[]};l[d.k]=Math.max(0,(l[d.k]||0)+(+d.d))});break;
    case 'l-outs':editGame(G=>{const l=G.lines[d.pid]=G.lines[d.pid]||{pos:'BE',pa:[]};l.outs=Math.max(0,(l.outs||0)+(+d.d))});break;
    case 'g-up':case 'g-down':editGame(G=>{const i=+d.i,j=a==='g-up'?i-1:i+1;if(j<0||j>=G.order.length)return;[G.order[i],G.order[j]]=[G.order[j],G.order[i]]});break;
    case 'g-rm':if(!armed('gl'+d.pid))return arm('gl'+d.pid);ui.confirm=null;editGame(G=>{G.order=G.order.filter(x=>x!==d.pid);delete G.lines[d.pid]});ui.openPlayer=null;break;
    case 'st-view':ui.statsView=d.v;ui.sortKey=d.v==='ofe'?'AVG':'PDF';ui.sortDir=-1;rememberUi();render();break;
    case 'sort':if(ui.sortKey===d.k)ui.sortDir*=-1;else{ui.sortKey=d.k;ui.sortDir=d.k==='K'||d.k==='E'?1:-1}render();break;
  }
});
document.addEventListener('change',e=>{
  const el=e.target.closest('[data-chg]');if(!el)return;const c=el.dataset.chg,v=el.value;
  switch(c){
    case 'lu-select':ui.lineupId=v;ui.sel=null;rememberUi();render();break;
    case 'lu-field':editLineup(L=>{L[el.dataset.k]=v},true);laterRender();break;
    case 'lu-addbat':if(v)editLineup(L=>{L.order=(L.order||[]).filter(p=>S.players[p]);if(L.order.length<MAX_ORDER&&!L.order.includes(v))L.order.push(v)});break;
    case 'g-field':editGame(G=>{G[el.dataset.k]=v},el.tagName!=='SELECT');if(el.tagName!=='SELECT')laterRender();break;
    case 'g-add':if(v){editGame(G=>{if(!G.order.includes(v))G.order.push(v);G.lines[v]=G.lines[v]||{pos:'BE',pa:[]}});ui.openPlayer=v}break;
    case 'l-pos':editGame(G=>{const l=G.lines[el.dataset.pid]=G.lines[el.dataset.pid]||{pa:[]};l.pos=v});break;
    case 'st-tour':ui.statsTour=v;render();break;
  }
});
document.addEventListener('submit',async e=>{
  e.preventDefault();
  if(e.target.id==='lform'){
    const btn=$('#l-btn'),err=$('#l-err');btn.disabled=true;btn.textContent='Entrando…';err.hidden=true;
    try{me=await api('POST','/api/login',{username:$('#l-user').value,password:$('#l-pass').value});await loadData();mode='ready';render()}
    catch(x){err.textContent=x.message;err.hidden=false;btn.disabled=false;btn.textContent='Entrar';$('#l-pass').select()}
    return;
  }
  if(e.target.id==='cpform'){
    try{await api('POST','/api/me/password',{current:$('#cp-cur').value,next:$('#cp-new').value});$('#cp-cur').value='';$('#cp-new').value='';toast('Contraseña cambiada. Se cerró la sesión en tus otros dispositivos.')}catch(x){toast(x.message)}
    return;
  }
  if(e.target.id==='uform'){
    try{const r=await api('POST','/api/users',{username:$('#u-name').value,password:$('#u-pass').value,role:$('#u-role').value});ui.users=null;document.activeElement&&document.activeElement.blur();toast('Usuario "'+r.username+'" creado.');render()}catch(x){toast(x.message)}
    return;
  }
  if(e.target.id==='pform'){
    const name=$('#pf-name').value.trim();if(!name){toast('Escribe el nombre del jugador.');$('#pf-name').focus();return}
    const num=$('#pf-num').value.trim();
    const dup=Object.entries(S.players).find(([id,p])=>num!==''&&String(p.number)===num&&id!==ui.sheet.id&&p.active!==false);
    const data={...(ui.sheet.id?clone(S.players[ui.sheet.id]):{createdAt:Date.now()}),name,number:num===''?'':+num,positions:[...document.querySelectorAll('input[name=pf-pos]:checked')].map(x=>x.value),bats:$('#pf-bats').value,throws:$('#pf-throws').value,active:$('#pf-active').checked};
    const id=ui.sheet.id||uid();ui.sheet=null;save('players',id,data);
    if(dup)toast('Ojo: '+dup[1].name+' también usa el #'+num+'.');
  }else if(e.target.id==='gform'){
    const opp=$('#gf-opp').value.trim();if(!opp){toast('Escribe el nombre del rival.');$('#gf-opp').focus();return}
    const meta={opponent:opp,date:$('#gf-date').value,tournament:$('#gf-tour').value.trim()};const lid=$('#gf-lu').value;
    ui.sheet=null;gameFromLineup(lid||null,meta);
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ui.sheet){ui.sheet=null;render()}});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(TABS[h]&&h!==ui.tab){ui.tab=h;render()}});

/* ---------- drag & tap on the board ---------- */
document.addEventListener('pointerdown',e=>{
  const el=e.target.closest('[data-drag]');if(!el||e.button>0)return;
  const src=el.dataset.drag==='slot'?{type:'slot',v:+el.dataset.slot}:{type:'bench',v:el.dataset.pid};
  if(src.type==='slot'&&!S.lineups[ui.lineupId].slots[src.v])return;
  dragging={src,x0:e.clientX,y0:e.clientY,moved:false,ghost:null,label:el.querySelector('.disc,.n')?.textContent.replace(/[A-Z0-9]+$/,'')||''};
  const lbl=src.type==='bench'?pnum(src.v):(()=>{const s=S.lineups[ui.lineupId].slots[src.v];return s.playerId?pnum(s.playerId):s.pos})();
  dragging.label=lbl;
  try{el.setPointerCapture(e.pointerId)}catch(_){}
  e.preventDefault();
});
let lastOver=null;
document.addEventListener('pointermove',e=>{
  if(!dragging)return;
  if(!dragging.moved&&Math.hypot(e.clientX-dragging.x0,e.clientY-dragging.y0)>6){dragging.moved=true;const g=document.createElement('div');g.className='drag-ghost';g.textContent=dragging.label;document.body.appendChild(g);dragging.ghost=g}
  if(dragging.moved){dragging.ghost.style.left=e.clientX+'px';dragging.ghost.style.top=e.clientY+'px';
    const t=document.elementFromPoint(e.clientX,e.clientY);const over=t&&(t.closest('.tok')||t.closest('#bench'));
    if(lastOver!==over){lastOver&&lastOver.classList.remove('drop');over&&over.classList.add('drop');lastOver=over}}
});
function endDrag(e,cancel){
  if(!dragging)return;const D=dragging;dragging=null;
  if(D.ghost)D.ghost.remove();if(lastOver){lastOver.classList.remove('drop');lastOver=null}
  if(cancel){if(needsRender)render();return}
  if(!D.moved){tapBoard(D.src);return}
  const t=document.elementFromPoint(e.clientX,e.clientY);
  const slotEl=t&&t.closest('[data-slot]'),benchEl=t&&t.closest('#bench'),fieldEl=t&&t.closest('#field');
  ui.sel=null;
  editLineup(L=>{
    if(D.src.type==='bench'){if(slotEl)assignSlot(L,+slotEl.dataset.slot,D.src.v);return}
    const i=D.src.v,s=L.slots[i];
    if(slotEl&&+slotEl.dataset.slot!==i){const j=+slotEl.dataset.slot;const a=s.playerId,b=L.slots[j].playerId;s.playerId=b;L.slots[j].playerId=a;if(a&&!L.order.includes(a)&&L.order.length<MAX_ORDER)L.order.push(a);return}
    if(benchEl){s.playerId=null;return}
    if(fieldEl){const r=fieldEl.getBoundingClientRect();s.x=Math.round(Math.min(97,Math.max(3,(e.clientX-r.left)/r.width*100))*10)/10;s.y=Math.round(Math.min(78,Math.max(3,(e.clientY-r.top)/r.height*80))*10)/10;s.moved=true}
  });
}
document.addEventListener('pointerup',e=>endDrag(e,false));
document.addEventListener('pointercancel',e=>endDrag(e,true));
function tapBoard(src){
  const sel=ui.sel;
  if(src.type==='bench'){ui.sel=sel&&sel.type==='bench'&&sel.v===src.v?null:src;
    if(sel&&sel.type==='slot'){editLineup(L=>assignSlot(L,sel.v,src.v));ui.sel=null;return}
    render();return}
  if(sel&&sel.type==='bench'){editLineup(L=>assignSlot(L,src.v,sel.v));ui.sel=null;return}
  if(sel&&sel.type==='slot'&&sel.v!==src.v){editLineup(L=>{const a=L.slots[sel.v].playerId,b=L.slots[src.v].playerId;L.slots[sel.v].playerId=b;L.slots[src.v].playerId=a});ui.sel=null;return}
  ui.sel=sel&&sel.type==='slot'&&sel.v===src.v?null:src;render();
}
document.addEventListener('click',e=>{if(ui.sel&&e.target.closest('#bench')&&!e.target.closest('[data-drag]')&&ui.sel.type==='slot'){const i=ui.sel.v;ui.sel=null;editLineup(L=>{L.slots[i].playerId=null})}});

init();
})();

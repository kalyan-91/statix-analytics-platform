/* ============================================================
   STATIX — application state & engine
   ============================================================ */
const STATE = {
  fileName: null,
  rawData: [],        // array of row objects (current, post-cleaning)
  columns: [],         // [{name, type:'numeric'|'categorical'|'date', originalName}]
  cleaningHistory: [], // [{label, undo:fn}]
  activeTab: 'overview',
  table: { search:'', sortCol:null, sortDir:1, page:1, pageSize:12, filterCol:'', filterVal:'' },
  currentChart: null,
  pinnedCharts: [],
  celebrated: false,
  groupBy: { groupCol:'', metricCol:'', agg:'sum' },
  savedProjects: JSON.parse(sessionStorage.getItem('statix_projects') || '[]')
};

/* ---------------- Chart.js load guard ---------------- */
let _chartLibPromise = null;
function ensureChartLib(){
  if(_chartLibPromise) return _chartLibPromise;
  _chartLibPromise = new Promise((resolve)=>{
    function check(triesLeft){
      if(typeof Chart !== 'undefined'){ resolve(true); return; }
      if(triesLeft<=0){
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
        s.onload = ()=> resolve(typeof Chart !== 'undefined');
        s.onerror = ()=> resolve(false);
        document.head.appendChild(s);
        return;
      }
      setTimeout(()=>check(triesLeft-1), 150);
    }
    check(24); // poll for ~3.6s before falling back to a second CDN
  });
  return _chartLibPromise;
}

function toast(msg, icon){
  const t = document.getElementById('toast');
  t.innerHTML = (icon? `<span>${icon}</span>`:'') + `<span>${msg}</span>`;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ---------------- Ripple effect (delegated) ---------------- */
document.addEventListener('click', e=>{
  const el = e.target.closest('.btn, .mini-btn, .sidebar button, .primary-nav button');
  if(!el) return;
  el.classList.add('ripple-wrap');
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size/2) + 'px';
  el.appendChild(ripple);
  setTimeout(()=>ripple.remove(), 600);
});

/* ---------------- Count-up animation for KPI values ---------------- */
function animateCountUp(el, target){
  const isPlain = /^-?\d+$/.test(target.replace(/,/g,''));
  if(!isPlain){ el.textContent = target; return; }
  const end = parseInt(target.replace(/,/g,''),10);
  if(isNaN(end)){ el.textContent = target; return; }
  const dur = 650, start = performance.now();
  function step(now){
    const p = Math.min(1,(now-start)/dur);
    const eased = 1 - Math.pow(1-p,3);
    el.textContent = Math.round(end*eased).toLocaleString();
    if(p<1) requestAnimationFrame(step); else el.textContent = target;
  }
  requestAnimationFrame(step);
}

/* ---------------- Keyboard shortcuts ---------------- */
const TAB_ORDER = ['overview','dataview','clean','stats','visualize','insights','report'];
document.addEventListener('keydown', e=>{
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'){
    if(document.getElementById('app').style.display==='block'){ e.preventDefault(); openPalette(); }
    return;
  }
  if(!document.getElementById('paletteOverlay').classList.contains('hidden')) return;
  if(document.getElementById('app').style.display!=='block') return;
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  const n = parseInt(e.key,10);
  if(n>=1 && n<=7){ setTab(TAB_ORDER[n-1]); }
});
let _hintShown = false;
function maybeShowHint(){
  if(_hintShown) return; _hintShown = true;
  const h = document.getElementById('kbdHint');
  setTimeout(()=>h.classList.add('show'), 900);
  setTimeout(()=>h.classList.remove('show'), 5200);
}

/* ---------------- Command palette ---------------- */
const TAB_META = {
  overview:{label:'Overview', ic:'▦'}, dataview:{label:'Data', ic:'▤'}, clean:{label:'Clean', ic:'✦'},
  stats:{label:'Statistics', ic:'▮'}, visualize:{label:'Visualize', ic:'◔'}, insights:{label:'Insights', ic:'✧'}, report:{label:'Report', ic:'▧'}
};
let _paletteSel = 0, _paletteItems = [];
function paletteItemsFor(query){
  const q = query.trim().toLowerCase();
  const tabItems = TAB_ORDER.map(t=>({type:'tab', tab:t, label:TAB_META[t].label, meta:'Tab', ic:TAB_META[t].ic}));
  const colItems = STATE.columns.map(c=>({type:'column', tab:'stats', label:c.name, meta:c.type, ic:'#'}));
  const all = [...tabItems, ...colItems];
  if(!q) return all.slice(0,9);
  return all.filter(i=>i.label.toLowerCase().includes(q)).slice(0,9);
}
function openPalette(){
  const overlay = document.getElementById('paletteOverlay');
  const input = document.getElementById('paletteInput');
  overlay.classList.remove('hidden');
  input.value = '';
  _paletteSel = 0;
  renderPaletteList('');
  setTimeout(()=>input.focus(), 30);
}
function closePalette(){ document.getElementById('paletteOverlay').classList.add('hidden'); }
function renderPaletteList(query){
  _paletteItems = paletteItemsFor(query);
  const list = document.getElementById('paletteList');
  if(!_paletteItems.length){ list.innerHTML = `<div class="palette-empty">No matches</div>`; return; }
  list.innerHTML = _paletteItems.map((i,idx)=>`
    <div class="palette-item ${idx===_paletteSel?'sel':''}" data-idx="${idx}">
      <span class="p-ic">${i.ic}</span><span>${i.label}</span><span class="p-meta">${i.meta}</span>
    </div>`).join('');
  list.querySelectorAll('.palette-item').forEach(el=>{
    el.addEventListener('click', ()=> choosePaletteItem(parseInt(el.dataset.idx)));
    el.addEventListener('mouseenter', ()=>{ _paletteSel = parseInt(el.dataset.idx); renderPaletteList(document.getElementById('paletteInput').value); });
  });
}
function choosePaletteItem(idx){
  const item = _paletteItems[idx];
  if(!item) return;
  closePalette();
  setTab(item.tab);
  if(item.type==='column') toast(`Jumped to Statistics — see "${item.label}"`, '#');
}
document.getElementById('paletteInput').addEventListener('input', e=>{ _paletteSel = 0; renderPaletteList(e.target.value); });
document.getElementById('paletteInput').addEventListener('keydown', e=>{
  if(e.key==='Escape'){ closePalette(); return; }
  if(e.key==='ArrowDown'){ e.preventDefault(); _paletteSel = Math.min(_paletteSel+1, _paletteItems.length-1); renderPaletteList(e.target.value); }
  if(e.key==='ArrowUp'){ e.preventDefault(); _paletteSel = Math.max(_paletteSel-1, 0); renderPaletteList(e.target.value); }
  if(e.key==='Enter'){ e.preventDefault(); choosePaletteItem(_paletteSel); }
});
document.getElementById('paletteOverlay').addEventListener('click', e=>{
  if(e.target.id==='paletteOverlay') closePalette();
});

/* ---------------- File parsing ---------------- */
function handleFile(file){
  if(!file) return;
  resetAppState();
  showLoading();
  const stages = ['Reading your dataset...','Detecting columns...','Checking data quality...','Calculating statistics...','Finding patterns...','Generating insights...'];
  let stageIdx = 0;
  const stageTimer = setInterval(()=>{
    stageIdx = (stageIdx+1) % stages.length;
    document.getElementById('loadingMsg').textContent = stages[stageIdx];
  }, 480);

  const ext = file.name.split('.').pop().toLowerCase();
  const finish = (rows) => {
    clearInterval(stageTimer);
    STATE.fileName = file.name;
    STATE.rawData = rows;
    detectColumns();
    document.getElementById('loadingMsg').textContent = 'Your data is ready to explore!';
    setTimeout(()=>{ hideLoading(); enterApp(); }, 550);
  };

  if(ext === 'csv'){
    Papa.parse(file, {
      header:true, skipEmptyLines:true, dynamicTyping:false,
      complete: (res)=> finish(res.data)
    });
  } else {
    const reader = new FileReader();
    reader.onload = (e)=>{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, {defval:''});
      finish(json);
    };
    reader.readAsArrayBuffer(file);
  }
}

function loadSample(){
  resetAppState();
  showLoading();
  const rows = [];
  const genres = ['Drama','Action','Comedy','Sci-Fi','Documentary','Thriller','Animation'];
  const years = [2016,2017,2018,2019,2020,2021,2022,2023,2024];
  for(let i=0;i<160;i++){
    rows.push({
      Movie_Title: 'Sample Film ' + (i+1),
      Genre: genres[Math.floor(Math.random()*genres.length)],
      Rating: (Math.random()*4.5+5).toFixed(1),
      Release_Year: years[Math.floor(Math.random()*years.length)],
      Votes: Math.floor(Math.random()*900000)+1000,
      Duration_Min: Math.floor(Math.random()*90)+75
    });
  }
  // sprinkle some missing values + duplicates so cleaning tools have something to do
  for(let i=0;i<9;i++){ rows[Math.floor(Math.random()*rows.length)].Rating = ''; }
  for(let i=0;i<5;i++){ rows.push({...rows[Math.floor(Math.random()*rows.length)]}); }

  setTimeout(()=>{
    STATE.fileName = 'sample_movies.csv';
    STATE.rawData = rows;
    detectColumns();
    hideLoading();
    enterApp();
  }, 900);
}

function showLoading(){ document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoading(){ document.getElementById('loadingOverlay').classList.add('hidden'); }

/* ---------------- Connect Database ---------------- */
const DB_DEFAULT_PORTS = { mysql: 3306, postgresql: 5432, oracle: 1521 };
let dbActiveTab = 'native';

/* ---------- Generic prompt/confirm modal (replaces window.prompt/confirm, which are blocked in sandboxed environments) ---------- */
let _genericModalResolve = null;
function _closeGenericModal(){
  document.getElementById('genericModalOverlay').classList.add('hidden');
  _genericModalResolve = null;
}
function promptModal(title, defaultValue){
  return new Promise(resolve=>{
    _genericModalResolve = resolve;
    document.getElementById('genericModalTitle').textContent = title;
    document.getElementById('genericModalSub').style.display = 'none';
    const wrap = document.getElementById('genericModalInputWrap');
    wrap.style.display = 'flex';
    const input = document.getElementById('genericModalInput');
    input.value = defaultValue || '';
    document.getElementById('btnConfirmGeneric').textContent = 'Rename';
    document.getElementById('genericModalOverlay').classList.remove('hidden');
    setTimeout(()=>{ input.focus(); input.select(); }, 30);
    const onConfirm = ()=>{ const v = input.value; cleanup(); resolve(v); };
    const onCancel = ()=>{ cleanup(); resolve(null); };
    const onKey = e=>{ if(e.key==='Enter') onConfirm(); if(e.key==='Escape') onCancel(); };
    function cleanup(){
      document.getElementById('btnConfirmGeneric').removeEventListener('click', onConfirm);
      document.getElementById('btnCancelGeneric').removeEventListener('click', onCancel);
      document.getElementById('btnCloseGenericModal').removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      _closeGenericModal();
    }
    document.getElementById('btnConfirmGeneric').addEventListener('click', onConfirm);
    document.getElementById('btnCancelGeneric').addEventListener('click', onCancel);
    document.getElementById('btnCloseGenericModal').addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}
function confirmModal(message){
  return new Promise(resolve=>{
    document.getElementById('genericModalTitle').textContent = 'Please confirm';
    const sub = document.getElementById('genericModalSub');
    sub.textContent = message;
    sub.style.display = 'block';
    document.getElementById('genericModalInputWrap').style.display = 'none';
    document.getElementById('btnConfirmGeneric').textContent = 'Confirm';
    document.getElementById('genericModalOverlay').classList.remove('hidden');
    const onConfirm = ()=>{ cleanup(); resolve(true); };
    const onCancel = ()=>{ cleanup(); resolve(false); };
    function cleanup(){
      document.getElementById('btnConfirmGeneric').removeEventListener('click', onConfirm);
      document.getElementById('btnCancelGeneric').removeEventListener('click', onCancel);
      document.getElementById('btnCloseGenericModal').removeEventListener('click', onCancel);
      _closeGenericModal();
    }
    document.getElementById('btnConfirmGeneric').addEventListener('click', onConfirm);
    document.getElementById('btnCancelGeneric').addEventListener('click', onCancel);
    document.getElementById('btnCloseGenericModal').addEventListener('click', onCancel);
  });
}
document.getElementById('genericModalOverlay').addEventListener('click', e=>{ if(e.target.id==='genericModalOverlay') _closeGenericModal(); });

function openDbModal(){
  document.getElementById('dbModalOverlay').classList.remove('hidden');
  document.getElementById('dbError').classList.add('hidden');
}
function closeDbModal(){
  document.getElementById('dbModalOverlay').classList.add('hidden');
}
function setDbTab(tab){
  dbActiveTab = tab;
  document.getElementById('dbTabNative').classList.toggle('active', tab==='native');
  document.getElementById('dbTabApi').classList.toggle('active', tab==='api');
  document.getElementById('dbPanelNative').classList.toggle('hidden', tab!=='native');
  document.getElementById('dbPanelApi').classList.toggle('hidden', tab!=='api');
  document.getElementById('dbError').classList.add('hidden');
}
function applyDbPortDefault(){
  const type = document.getElementById('dbType').value;
  const portField = document.getElementById('dbPort');
  if(!portField.value) portField.placeholder = String(DB_DEFAULT_PORTS[type]);
}

async function connectDatabase(){
  if(dbActiveTab === 'native') return connectNativeDatabase();
  return connectViaApi();
}

async function connectNativeDatabase(){
  const dbType = document.getElementById('dbType').value;
  const host = document.getElementById('dbHost').value.trim();
  const port = document.getElementById('dbPort').value.trim() || DB_DEFAULT_PORTS[dbType];
  const database = document.getElementById('dbName').value.trim();
  const user = document.getElementById('dbUser').value.trim();
  const password = document.getElementById('dbPass').value;
  const sql = document.getElementById('dbQuery').value.trim();
  const connectorUrl = (document.getElementById('dbConnectorUrl').value.trim() || 'http://localhost:8420').replace(/\/$/, '');
  const errEl = document.getElementById('dbError');
  errEl.classList.add('hidden');

  if(!host || !database || !user || !sql){
    errEl.textContent = 'Host, database, username, and a SQL query are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitDb');
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'Connecting...'; submitBtn.disabled = true;

  let res;
  try{
    res = await fetch(connectorUrl + '/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db_type: dbType, host, port, database, user, password, query: sql })
    });
  }catch(networkErr){
    errEl.textContent = 'Could not reach the STATIX Connector at ' + connectorUrl + '. Make sure you ran "python statix_connector.py" and that window is still open.';
    errEl.classList.remove('hidden');
    submitBtn.textContent = originalLabel; submitBtn.disabled = false;
    return;
  }

  try{
    const data = await res.json();
    if(!data.success) throw new Error(data.error || 'The connector could not run that query.');
    if(!data.rows || !data.rows.length) throw new Error('The query returned no rows.');

    closeDbModal();
    resetAppState();
    showLoading();
    setTimeout(()=>{
      STATE.fileName = `${host}/${database} (${dbType})`;
      STATE.rawData = data.rows;
      detectColumns();
      hideLoading();
      enterApp();
    }, 500);
  }catch(err){
    errEl.textContent = 'Database error: ' + err.message;
    errEl.classList.remove('hidden');
  } finally {
    submitBtn.textContent = originalLabel; submitBtn.disabled = false;
  }
}

async function connectViaApi(){
  const url = document.getElementById('dbUrl').value.trim();
  const auth = document.getElementById('dbAuth').value.trim();
  const format = document.getElementById('dbFormat').value;
  const errEl = document.getElementById('dbError');
  errEl.classList.add('hidden');

  if(!url){ errEl.textContent = 'Please enter an endpoint URL.'; errEl.classList.remove('hidden'); return; }

  const submitBtn = document.getElementById('btnSubmitDb');
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'Connecting...'; submitBtn.disabled = true;

  try{
    const headers = {};
    if(auth) headers['Authorization'] = auth;
    const res = await fetch(url, { headers });
    if(!res.ok) throw new Error(`Server responded with ${res.status}`);
    const raw = await res.text();

    const tryJson = () => {
      const data = JSON.parse(raw);
      if(Array.isArray(data)) return data;
      if(data && Array.isArray(data.rows)) return data.rows;
      if(data && Array.isArray(data.data)) return data.data;
      if(data && Array.isArray(data.results)) return data.results;
      throw new Error('JSON response did not contain a recognizable array of records.');
    };
    const tryCsv = () => {
      const parsed = Papa.parse(raw, { header:true, skipEmptyLines:true });
      if(!parsed.data.length) throw new Error('No rows could be parsed from the response.');
      return parsed.data;
    };

    let rows;
    if(format==='json') rows = tryJson();
    else if(format==='csv') rows = tryCsv();
    else { try{ rows = tryJson(); } catch(e){ rows = tryCsv(); } }

    if(!rows || !rows.length) throw new Error('No records found at that endpoint.');

    let urlLabel;
    try{ urlLabel = new URL(url).hostname; }catch(e){ urlLabel = 'connected database'; }

    closeDbModal();
    resetAppState();
    showLoading();
    setTimeout(()=>{
      STATE.fileName = urlLabel + ' (live connection)';
      STATE.rawData = rows;
      detectColumns();
      hideLoading();
      enterApp();
    }, 500);
  }catch(err){
    errEl.textContent = 'Could not load data: ' + err.message + '. If this endpoint blocks cross-origin requests (CORS), it needs to allow requests from this page for STATIX to reach it.';
    errEl.classList.remove('hidden');
  } finally {
    submitBtn.textContent = originalLabel; submitBtn.disabled = false;
  }
}

function resetAppState(){
  STATE.rawData = [];
  STATE.columns = [];
  STATE.cleaningHistory = [];
  STATE.table = { search:'', sortCol:null, sortDir:1, page:1, pageSize:12, filterCol:'', filterVal:'' };
  STATE.activeTab = 'overview';
  STATE.pinnedCharts = [];
  STATE.celebrated = false;
  if(STATE.currentChart){ STATE.currentChart.destroy(); STATE.currentChart = null; }
}

/* ---------------- Column type detection ---------------- */
function looksLikeDate(v){
  if(v === '' || v === null || v === undefined) return false;
  if(typeof v === 'number') return false;
  const s = String(v).trim();
  if(!/[\/\-]/.test(s) && !/^\d{4}$/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime()) && /\d{4}/.test(s) && /[\/\-]/.test(s);
}
function looksLikeNumber(v){
  if(v === '' || v === null || v === undefined) return false;
  return !isNaN(parseFloat(v)) && isFinite(v - 0 === v - 0 ? v : parseFloat(v));
}

function detectColumns(){
  const cols = Object.keys(STATE.rawData[0] || {});
  STATE.columns = cols.map(name=>{
    let numCount=0, dateCount=0, total=0;
    for(const row of STATE.rawData){
      const v = row[name];
      if(v === '' || v === null || v === undefined) continue;
      total++;
      if(looksLikeDate(v)) dateCount++;
      else if(looksLikeNumber(v)) numCount++;
    }
    let type = 'categorical';
    if(total>0 && dateCount/total > 0.7) type = 'date';
    else if(total>0 && numCount/total > 0.7) type = 'numeric';
    return {name, type};
  });
}

/* ---------------- Derived data helpers ---------------- */
function colValues(name, opts={}){
  const {excludeMissing=true} = opts;
  return STATE.rawData
    .map(r=>r[name])
    .filter(v => !excludeMissing || (v!=='' && v!==null && v!==undefined));
}
function numericValues(name){
  return colValues(name).map(v=>parseFloat(v)).filter(v=>!isNaN(v));
}
function dateValues(name){
  return colValues(name).map(v=>new Date(v)).filter(d=>!isNaN(d.getTime()));
}
function missingCount(name){
  return STATE.rawData.filter(r=>{
    const v = r[name];
    return v==='' || v===null || v===undefined;
  }).length;
}
function duplicateRowCount(){
  const seen = new Set(); let dupes=0;
  for(const row of STATE.rawData){
    const key = JSON.stringify(row);
    if(seen.has(key)) dupes++; else seen.add(key);
  }
  return dupes;
}
function totalMissing(){
  return STATE.columns.reduce((sum,c)=>sum+missingCount(c.name),0);
}
function numericCols(){ return STATE.columns.filter(c=>c.type==='numeric'); }
function categoricalCols(){ return STATE.columns.filter(c=>c.type==='categorical'); }
function dateCols(){ return STATE.columns.filter(c=>c.type==='date'); }

function mean(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }
function median(arr){
  const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function mode(arr){
  const freq={}; let best=null, bestCount=0;
  arr.forEach(v=>{ freq[v]=(freq[v]||0)+1; if(freq[v]>bestCount){bestCount=freq[v]; best=v;} });
  return {value:best, count:bestCount};
}
function stddev(arr){
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length);
}
function arrMin(arr){ let m=Infinity; for(let i=0;i<arr.length;i++){ const v = arr[i] instanceof Date ? arr[i].getTime() : arr[i]; if(v<m) m=v; } return m; }
function arrMax(arr){ let m=-Infinity; for(let i=0;i<arr.length;i++){ const v = arr[i] instanceof Date ? arr[i].getTime() : arr[i]; if(v>m) m=v; } return m; }
function quantile(sortedArr, q){
  const pos = (sortedArr.length-1)*q;
  const base = Math.floor(pos), rest = pos-base;
  return sortedArr[base+1]!==undefined ? sortedArr[base]+rest*(sortedArr[base+1]-sortedArr[base]) : sortedArr[base];
}
function fmtNum(n){
  if(n===undefined || n===null || isNaN(n)) return '—';
  if(Math.abs(n)>=1000) return n.toLocaleString(undefined,{maximumFractionDigits:2});
  return Math.round(n*1000)/1000;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goHome(){
  document.getElementById('app').style.display='none';
  document.getElementById('projectsPage').classList.add('hidden');
  document.getElementById('aboutPage').classList.add('hidden');
  document.getElementById('landing').style.display='flex';
}
function enterApp(){
  document.getElementById('landing').style.display='none';
  document.getElementById('projectsPage').classList.add('hidden');
  document.getElementById('aboutPage').classList.add('hidden');
  document.getElementById('app').style.display='block';
  document.getElementById('pillFileName').textContent = STATE.fileName;
  document.getElementById('pillDims').textContent = STATE.rawData.length + ' rows × ' + STATE.columns.length + ' cols';
  setTab('overview');
  setTimeout(positionSideIndicator, 50);
  maybeShowHint();
}
function showProjectsPage(){
  document.getElementById('landing').style.display='none';
  document.getElementById('app').style.display='none';
  document.getElementById('aboutPage').classList.add('hidden');
  document.getElementById('projectsPage').classList.remove('hidden');
  renderProjects();
}
function showAboutPage(){
  document.getElementById('landing').style.display='none';
  document.getElementById('app').style.display='none';
  document.getElementById('projectsPage').classList.add('hidden');
  document.getElementById('aboutPage').classList.remove('hidden');
}

document.querySelectorAll('[data-page]').forEach(el=>{
  el.addEventListener('click', e=>{
    e.preventDefault();
    const p = el.dataset.page;
    if(p==='analyze'){ STATE.rawData.length ? enterApp() : document.getElementById('dropZone').scrollIntoView({behavior:'smooth'}); }
    if(p==='projects') showProjectsPage();
    if(p==='about') showAboutPage();
  });
});
document.querySelectorAll('[data-topnav]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-topnav]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.topnav;
    if(p==='analyze') enterApp();
    if(p==='projects') showProjectsPage();
    if(p==='about') showAboutPage();
  });
});

document.querySelectorAll('#workspaceSidebar button').forEach(btn=>{
  btn.addEventListener('click', ()=> setTab(btn.dataset.tab));
});
function setTab(tab){
  STATE.activeTab = tab;
  document.querySelectorAll('#workspaceSidebar button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  positionSideIndicator();
  render();
}
function positionSideIndicator(){
  const active = document.querySelector('#workspaceSidebar button.active');
  const ind = document.getElementById('sideIndicator');
  if(!active || !ind) return;
  ind.style.top = active.offsetTop + 'px';
  ind.style.height = active.offsetHeight + 'px';
}

/* ============================================================
   RENDER ROUTER
   ============================================================ */
function render(){
  const panel = document.getElementById('mainPanel');
  document.getElementById('pillDims').textContent = STATE.rawData.length + ' rows × ' + STATE.columns.length + ' cols';
  switch(STATE.activeTab){
    case 'overview': panel.innerHTML = renderOverview(); attachOverviewEvents(); break;
    case 'dataview': panel.innerHTML = renderDataView(); attachDataViewEvents(); break;
    case 'clean': panel.innerHTML = renderClean(); attachCleanEvents(); break;
    case 'stats': panel.innerHTML = renderStats(); attachStatsEvents(); break;
    case 'visualize': panel.innerHTML = renderVisualize(); attachVisualizeEvents(); break;
    case 'insights': panel.innerHTML = renderInsights(); attachInsightsEvents(); break;
    case 'report': panel.innerHTML = renderReport(); break;
  }
}

/* ============================================================
   OVERVIEW
   ============================================================ */
function renderOverview(){
  const missing = totalMissing();
  const dupes = duplicateRowCount();
  const kpis = [
    {label:'Total Rows', value: STATE.rawData.length.toLocaleString(), color:'var(--blue)', sub:'records in dataset', jump:'dataview'},
    {label:'Total Columns', value: STATE.columns.length, color:'var(--purple)', sub:'detected fields', jump:'dataview'},
    {label:'Missing Values', value: missing.toLocaleString(), color:missing? 'var(--orange)':'var(--green)', sub: missing? 'across all columns':'fully complete', jump:'clean'},
    {label:'Duplicate Rows', value: dupes.toLocaleString(), color:dupes? 'var(--orange)':'var(--green)', sub: dupes? 'exact repeats':'no repeats', jump:'clean'},
    {label:'Numeric Columns', value: numericCols().length, color:'var(--blue)', sub:'quantitative fields', jump:'stats'},
    {label:'Categorical Columns', value: categoricalCols().length, color:'var(--purple)', sub:'label / group fields', jump:'stats'},
    {label:'Date Columns', value: dateCols().length, color:'var(--cyan)', sub:'time-based fields', jump:'stats'},
  ];
  return `
    <div class="panel-header">
      <div><h2>Overview</h2><p>${STATE.fileName} · calculated live from your uploaded data</p></div>
    </div>
    <div class="kpi-grid">
      ${kpis.map(k=>`
        <div class="kpi-card" data-jump="${k.jump}" title="Click to explore in ${k.jump==='dataview'?'Data':k.jump==='clean'?'Clean':'Statistics'}"><div class="bar" style="background:${k.color}"></div>
          <div class="label">${k.label}<span class="go">View →</span></div>
          <div class="value" data-count="${String(k.value).replace(/,/g,'')}">0</div>
          <div class="sub">${k.sub}</div>
        </div>`).join('')}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="section-title">Column Structure <span style="font-weight:400;color:var(--text-light);font-size:11.5px;text-transform:none;letter-spacing:0;">— click a type badge to override it</span></div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${STATE.columns.map(c=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--bg);border-radius:10px;">
              <span style="font-weight:600;font-size:13.5px;">${c.name}</span>
              <span class="type-badge badge-${c.type} type-override" data-col="${c.name}" title="Click to change detected type">${c.type} <span class="cycle-ic">⟳</span></span>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="section-title">Data Quality</div>
        ${missing===0 ? `<div class="empty-msg" style="margin-bottom:10px;">✓ No missing values found.</div>` :
          `<p style="font-size:13.5px;color:var(--text-light);margin-bottom:10px;">${missing.toLocaleString()} missing values detected across ${STATE.columns.filter(c=>missingCount(c.name)>0).length} column(s). Head to <b>Clean</b> to fix them.</p>`}
        ${dupes===0 ? `<div class="empty-msg">✓ No duplicate rows found.</div>` :
          `<p style="font-size:13.5px;color:var(--text-light);">${dupes.toLocaleString()} duplicate row(s) detected. Head to <b>Clean</b> to remove them.</p>`}
      </div>
    </div>
  `;
}

function attachOverviewEvents(){
  document.querySelectorAll('.kpi-card .value[data-count]').forEach(el=>{
    animateCountUp(el, el.dataset.count);
  });
  document.querySelectorAll('.kpi-card[data-jump]').forEach(card=>{
    card.addEventListener('click', ()=> setTab(card.dataset.jump));
  });
  const TYPE_CYCLE = ['numeric','categorical','date'];
  document.querySelectorAll('.type-override').forEach(badge=>{
    badge.addEventListener('click', e=>{
      e.stopPropagation();
      const col = STATE.columns.find(c=>c.name===badge.dataset.col);
      if(!col) return;
      const next = TYPE_CYCLE[(TYPE_CYCLE.indexOf(col.type)+1) % TYPE_CYCLE.length];
      col.type = next;
      toast(`"${col.name}" marked as ${next}`, '⟳');
      render();
    });
  });
  maybeCelebrate();
}

/* ---------------- Celebration when data is fully clean ---------------- */
function maybeCelebrate(){
  if(STATE.celebrated) return;
  if(totalMissing()===0 && duplicateRowCount()===0 && STATE.rawData.length>0){
    STATE.celebrated = true;
    launchConfetti();
    toast('Dataset is fully clean — nice work!', '✓');
  }
}
function launchConfetti(){
  const colors = ['#3D5AFE','#8B5CF6','#06B6D4','#12B76A','#F97316'];
  for(let i=0;i<24;i++){
    const p = document.createElement('div');
    const size = 6 + Math.random()*6;
    p.style.cssText = `position:fixed;top:-10px;left:${Math.random()*100}vw;width:${size}px;height:${size}px;
      background:${colors[i%colors.length]};border-radius:${Math.random()>0.5?'50%':'3px'};z-index:1200;pointer-events:none;
      transform:rotate(${Math.random()*360}deg);`;
    document.body.appendChild(p);
    const dur = 1600 + Math.random()*900;
    const drift = (Math.random()-0.5)*160;
    p.animate([
      { transform:`translate(0,0) rotate(0deg)`, opacity:1 },
      { transform:`translate(${drift}px, 100vh) rotate(${360+Math.random()*360}deg)`, opacity:0.9 }
    ], { duration:dur, easing:'cubic-bezier(.25,.46,.45,.94)' });
    setTimeout(()=>p.remove(), dur+50);
  }
}

/* ============================================================
   DATA VIEW (table with search/sort/pagination)
   ============================================================ */
function getFilteredSortedData(){
  let rows = STATE.rawData.map((r,i)=>({...r, __idx:i}));
  const s = STATE.table.search.trim().toLowerCase();
  if(s){
    rows = rows.filter(r => STATE.columns.some(c => String(r[c.name]??'').toLowerCase().includes(s)));
  }
  if(STATE.table.filterCol && STATE.table.filterVal!==''){
    rows = rows.filter(r => String(r[STATE.table.filterCol]??'') === STATE.table.filterVal);
  }
  if(STATE.table.sortCol){
    const col = STATE.table.sortCol, dir = STATE.table.sortDir;
    const isNum = STATE.columns.find(c=>c.name===col)?.type === 'numeric';
    rows.sort((a,b)=>{
      let av=a[col], bv=b[col];
      if(isNum){ av=parseFloat(av); bv=parseFloat(bv); if(isNaN(av))av=-Infinity; if(isNaN(bv))bv=-Infinity; }
      if(av<bv) return -1*dir; if(av>bv) return 1*dir; return 0;
    });
  }
  return rows;
}

function renderDataView(){
  const all = getFilteredSortedData();
  const {page, pageSize, filterCol, filterVal} = STATE.table;
  const totalPages = Math.max(1, Math.ceil(all.length/pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = all.slice((curPage-1)*pageSize, curPage*pageSize);
  const filterColOptions = STATE.columns.filter(c=>c.type!=='numeric' || true); // any column filterable
  const valueOptions = filterCol ? uniqueValuesFor(filterCol) : [];

  return `
    <div class="panel-header"><div><h2>Data</h2><p>${all.length.toLocaleString()} rows shown${STATE.table.search? ' (search applied)':''}${filterCol&&filterVal? ' (filter applied)':''}</p></div></div>
    <div class="table-controls">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <div class="search-box"><input id="tableSearch" placeholder="Search all columns..." value="${STATE.table.search}">${STATE.table.search? `<button class="search-clear" id="clearSearch">×</button>`:''}</div>
        <select id="filterColSel" style="padding:9px 12px;border:1px solid var(--border);border-radius:11px;font-size:13px;background:#fff;">
          <option value="">+ Filter by column…</option>
          ${filterColOptions.map(c=>`<option value="${c.name}" ${c.name===filterCol?'selected':''}>${c.name}</option>`).join('')}
        </select>
        ${filterCol ? `
        <select id="filterValSel" style="padding:9px 12px;border:1px solid var(--border);border-radius:11px;font-size:13px;background:#fff;">
          <option value="">choose value…</option>
          ${valueOptions.map(v=>`<option value="${v}" ${v===filterVal?'selected':''}>${v}</option>`).join('')}
        </select>` : ''}
        ${filterCol && filterVal ? `<span class="filter-chip">${filterCol}: ${filterVal}<button id="clearFilter">×</button></span>` : ''}
      </div>
      <div style="font-size:12.5px;color:var(--text-light);">Click a column header to sort</div>
    </div>
    <div class="data-table-wrap">
      <table>
        <thead><tr>
          ${STATE.columns.map(c=>`<th data-col="${c.name}">${c.name}${STATE.table.sortCol===c.name ? (STATE.table.sortDir>0?' ▲':' ▼'):''}<span class="type-tag">${c.type}</span></th>`).join('')}
        </tr></thead>
        <tbody>
          ${pageRows.map(r=>`<tr>${STATE.columns.map(c=>`<td>${r[c.name]===''||r[c.name]==null ? '<span style="color:var(--red);font-style:italic;">missing</span>' : r[c.name]}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <span>Page ${curPage} of ${totalPages}</span>
      <button id="prevPage" ${curPage<=1?'disabled':''}>← Prev</button>
      <button id="nextPage" ${curPage>=totalPages?'disabled':''}>Next →</button>
    </div>
  `;
}
function uniqueValuesFor(colName, limit=50){
  const freq={};
  colValues(colName).forEach(v=>{ const k=String(v); freq[k]=(freq[k]||0)+1; });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(e=>e[0]);
}
function attachDataViewEvents(){
  const search = document.getElementById('tableSearch');
  if(search) search.addEventListener('input', e=>{ STATE.table.search = e.target.value; STATE.table.page=1; render(); });
  const clearBtn = document.getElementById('clearSearch');
  if(clearBtn) clearBtn.addEventListener('click', ()=>{ STATE.table.search=''; STATE.table.page=1; render(); });
  const filterColSel = document.getElementById('filterColSel');
  if(filterColSel) filterColSel.addEventListener('change', e=>{
    STATE.table.filterCol = e.target.value; STATE.table.filterVal=''; STATE.table.page=1; render();
  });
  const filterValSel = document.getElementById('filterValSel');
  if(filterValSel) filterValSel.addEventListener('change', e=>{
    STATE.table.filterVal = e.target.value; STATE.table.page=1; render();
    if(e.target.value) toast(`Filtered to ${STATE.table.filterCol}: ${e.target.value}`, '⏚');
  });
  const clearFilter = document.getElementById('clearFilter');
  if(clearFilter) clearFilter.addEventListener('click', ()=>{
    STATE.table.filterCol=''; STATE.table.filterVal=''; STATE.table.page=1; render();
  });
  document.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const col = th.dataset.col;
      if(STATE.table.sortCol===col) STATE.table.sortDir *= -1;
      else { STATE.table.sortCol = col; STATE.table.sortDir = 1; }
      render();
    });
  });
  const prev = document.getElementById('prevPage'), next = document.getElementById('nextPage');
  if(prev) prev.addEventListener('click', ()=>{ STATE.table.page = Math.max(1, STATE.table.page-1); render(); });
  if(next) next.addEventListener('click', ()=>{ STATE.table.page = STATE.table.page+1; render(); });
}

/* ============================================================
   CLEAN
   ============================================================ */
function pushHistory(label, undoFn){
  STATE.cleaningHistory.unshift({label, undo:undoFn, ts:Date.now()});
}

function textVariantGroups(colName){
  const groups = {};
  colValues(colName).forEach(v=>{
    const key = String(v).trim().toLowerCase();
    if(!key) return;
    groups[key] = groups[key] || {};
    groups[key][v] = (groups[key][v]||0)+1;
  });
  return Object.entries(groups).filter(([,variants])=>Object.keys(variants).length>1);
}
function renderTextQualityRows(){
  const issues = categoricalCols()
    .map(c=>({col:c.name, groups: textVariantGroups(c.name)}))
    .filter(x=>x.groups.length>0);
  if(!issues.length) return `<div class="empty-msg" style="margin-bottom:20px;">✓ No case or whitespace inconsistencies found.</div>`;
  return issues.map(({col,groups})=>{
    const examples = groups.slice(0,3).map(([,variants])=>Object.keys(variants).join(' / ')).join('  ·  ');
    return `<div class="clean-row">
      <div class="info"><div class="colname">${col}</div>
        <div class="meta">${groups.length} inconsistent value group(s) — e.g. ${examples}</div></div>
      <div class="clean-actions"><button class="mini-btn" data-action="standardizeText" data-col="${col}">Standardize text</button></div>
    </div>`;
  }).join('');
}

function renderClean(){
  const dupes = duplicateRowCount();
  return `
    <div class="panel-header"><div><h2>Clean Data</h2><p>Options adapt to real problems detected in your dataset</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" data-action="cleanAll" style="padding:9px 16px;font-size:13px;">✨ Clean Everything</button>
        <button class="btn btn-secondary" id="btnDownloadCleanTab" style="padding:9px 16px;font-size:13px;">⬇ Download Cleaned Dataset</button>
      </div>
    </div>

    <div class="section-title">Missing Values</div>
    ${STATE.columns.filter(c=>missingCount(c.name)>0).length===0 ? `<div class="empty-msg" style="margin-bottom:20px;">✓ No missing values found.</div>` :
      STATE.columns.filter(c=>missingCount(c.name)>0).map(c=>`
        <div class="clean-row">
          <div class="info">
            <div class="colname">${c.name} <span class="type-badge badge-${c.type}">${c.type}</span></div>
            <div class="meta">${missingCount(c.name)} missing value(s)</div>
          </div>
          <div class="clean-actions">
            <button class="mini-btn" data-action="removeRows" data-col="${c.name}">Remove rows</button>
            ${c.type==='numeric' ? `<button class="mini-btn" data-action="fillMean" data-col="${c.name}">Fill mean</button><button class="mini-btn" data-action="fillMedian" data-col="${c.name}">Fill median</button>` : ''}
            ${c.type==='categorical' ? `<button class="mini-btn" data-action="fillMode" data-col="${c.name}">Fill mode</button>` : ''}
          </div>
        </div>`).join('')
    }

    <div class="section-title" style="margin-top:24px;">Duplicate Rows</div>
    ${dupes===0 ? `<div class="empty-msg" style="margin-bottom:20px;">✓ No duplicate rows found.</div>` :
      `<div class="clean-row"><div class="info"><div class="colname">Exact duplicate rows</div><div class="meta">${dupes} duplicate row(s) detected</div></div>
        <div class="clean-actions"><button class="mini-btn danger" data-action="removeDupes">Remove duplicates</button></div></div>`
    }

    <div class="section-title" style="margin-top:24px;">Text Quality</div>
    ${renderTextQualityRows()}

    <div class="section-title" style="margin-top:24px;">Column Management</div>
    ${STATE.columns.map(c=>`
      <div class="clean-row">
        <div class="info"><div class="colname">${c.name} <span class="type-badge badge-${c.type}">${c.type}</span></div><div class="meta">Rename or remove this column</div></div>
        <div class="clean-actions">
          <button class="mini-btn" data-action="renameCol" data-col="${c.name}">Rename</button>
          <button class="mini-btn danger" data-action="removeCol" data-col="${c.name}">Remove</button>
        </div>
      </div>`).join('')}

    <div class="section-title" style="margin-top:24px;">Outlier Detection (IQR)</div>
    ${numericCols().length===0 ? `<p style="color:var(--text-light);font-size:13.5px;">No numeric columns available for outlier detection.</p>` :
      numericCols().map(c=>{
        const vals = numericValues(c.name).sort((a,b)=>a-b);
        if(vals.length<4) return '';
        const q1 = quantile(vals,0.25), q3 = quantile(vals,0.75), iqr=q3-q1;
        const lo=q1-1.5*iqr, hi=q3+1.5*iqr;
        const outliers = vals.filter(v=>v<lo||v>hi);
        return `<div class="clean-row"><div class="info"><div class="colname">${c.name}</div>
          <div class="meta">${outliers.length} outlier(s) outside [${fmtNum(lo)}, ${fmtNum(hi)}]</div></div>
          ${outliers.length>0 ? `<div class="clean-actions"><button class="mini-btn danger" data-action="removeOutliers" data-col="${c.name}" data-lo="${lo}" data-hi="${hi}">Remove outlier rows</button></div>` : '<span class="empty-msg" style="padding:6px 12px;">✓ clean</span>'}
        </div>`;
      }).join('')}

    <div class="section-title" style="margin-top:24px;">Cleaning History</div>
    ${STATE.cleaningHistory.length===0 ? `<p style="color:var(--text-light);font-size:13.5px;">No operations performed yet.</p>` :
      `<div class="history-list">${STATE.cleaningHistory.map((h,i)=>`<div class="history-item">✓ ${h.label}<span class="undo" data-undo="${i}">Undo</span></div>`).join('')}</div>`}
  `;
}

function attachCleanEvents(){
  document.querySelectorAll('[data-action]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const action = btn.dataset.action, col = btn.dataset.col;
      const before = JSON.parse(JSON.stringify(STATE.rawData));
      if(action==='removeRows'){
        STATE.rawData = STATE.rawData.filter(r=> !(r[col]===''||r[col]==null));
        pushHistory(`Removed rows with missing ${col}`, ()=>STATE.rawData=before);
      } else if(action==='fillMean'){
        const m = mean(numericValues(col));
        STATE.rawData = STATE.rawData.map(r=> (r[col]===''||r[col]==null) ? {...r,[col]:Math.round(m*100)/100} : r);
        pushHistory(`Filled missing values in ${col} with mean (${fmtNum(m)})`, ()=>STATE.rawData=before);
      } else if(action==='fillMedian'){
        const m = median(numericValues(col));
        STATE.rawData = STATE.rawData.map(r=> (r[col]===''||r[col]==null) ? {...r,[col]:m} : r);
        pushHistory(`Filled missing values in ${col} with median (${fmtNum(m)})`, ()=>STATE.rawData=before);
      } else if(action==='fillMode'){
        const m = mode(colValues(col)).value;
        STATE.rawData = STATE.rawData.map(r=> (r[col]===''||r[col]==null) ? {...r,[col]:m} : r);
        pushHistory(`Filled missing values in ${col} with mode (${m})`, ()=>STATE.rawData=before);
      } else if(action==='removeDupes'){
        const seen=new Set(); const before2 = STATE.rawData.length;
        STATE.rawData = STATE.rawData.filter(r=>{ const k=JSON.stringify(r); if(seen.has(k))return false; seen.add(k); return true; });
        pushHistory(`Removed ${before2-STATE.rawData.length} duplicate rows`, ()=>STATE.rawData=before);
      } else if(action==='removeCol'){
        const ok = await confirmModal(`Remove column "${col}"? This cannot be changed except via undo.`);
        if(!ok) return;
        STATE.rawData = STATE.rawData.map(r=>{ const {[col]:_,...rest}=r; return rest; });
        STATE.columns = STATE.columns.filter(c=>c.name!==col);
        pushHistory(`Removed column "${col}"`, ()=>{STATE.rawData=before; detectColumns();});
      } else if(action==='renameCol'){
        const nn = await promptModal(`Rename "${col}" to:`, col);
        if(!nn || nn===col) return;
        STATE.rawData = STATE.rawData.map(r=>{ const v=r[col]; const {[col]:_,...rest}=r; return {...rest,[nn]:v}; });
        detectColumns();
        pushHistory(`Renamed column "${col}" → "${nn}"`, ()=>{STATE.rawData=before; detectColumns();});
      } else if(action==='removeOutliers'){
        const lo = parseFloat(btn.dataset.lo), hi = parseFloat(btn.dataset.hi);
        const before3 = STATE.rawData.length;
        STATE.rawData = STATE.rawData.filter(r=>{ const v=parseFloat(r[col]); return isNaN(v) || (v>=lo && v<=hi); });
        pushHistory(`Removed ${before3-STATE.rawData.length} outlier rows in ${col}`, ()=>STATE.rawData=before);
      } else if(action==='standardizeText'){
        const groups = textVariantGroups(col);
        const mapping = {};
        groups.forEach(([,variants])=>{
          const sortedVariants = Object.entries(variants).sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
          const canonical = sortedVariants[0][0].trim();
          Object.keys(variants).forEach(orig=>{ if(orig !== canonical) mapping[orig] = canonical; });
        });
        STATE.rawData = STATE.rawData.map(r=>{
          const v = r[col];
          return (v!=null && Object.prototype.hasOwnProperty.call(mapping, v)) ? {...r,[col]:mapping[v]} : r;
        });
        pushHistory(`Standardized text values in "${col}"`, ()=>STATE.rawData=before);
      } else if(action==='cleanAll'){
        let filledCols = 0;
        STATE.columns.forEach(c=>{
          if(missingCount(c.name)===0) return;
          if(c.type==='numeric'){
            const vals = numericValues(c.name);
            if(!vals.length) return;
            const m = median(vals);
            STATE.rawData = STATE.rawData.map(r=> (r[c.name]===''||r[c.name]==null) ? {...r,[c.name]:m} : r);
          } else {
            const vals = colValues(c.name);
            if(!vals.length) return;
            const m = mode(vals).value;
            STATE.rawData = STATE.rawData.map(r=> (r[c.name]===''||r[c.name]==null) ? {...r,[c.name]:m} : r);
          }
          filledCols++;
        });
        const seen=new Set(); const beforeLen=STATE.rawData.length;
        STATE.rawData = STATE.rawData.filter(r=>{ const k=JSON.stringify(r); if(seen.has(k)) return false; seen.add(k); return true; });
        const dupesRemoved = beforeLen - STATE.rawData.length;
        let outliersRemoved = 0;
        numericCols().forEach(c=>{
          const vals = numericValues(c.name).sort((a,b)=>a-b);
          if(vals.length<4) return;
          const q1=quantile(vals,0.25), q3=quantile(vals,0.75), iqr=q3-q1;
          const lo=q1-1.5*iqr, hi=q3+1.5*iqr;
          const beforeLen2 = STATE.rawData.length;
          STATE.rawData = STATE.rawData.filter(r=>{ const v=parseFloat(r[c.name]); return isNaN(v) || (v>=lo && v<=hi); });
          outliersRemoved += beforeLen2 - STATE.rawData.length;
        });
        if(filledCols===0 && dupesRemoved===0 && outliersRemoved===0){
          toast('Dataset already looks clean', '✓');
          return;
        }
        const parts=[];
        if(filledCols) parts.push(`filled missing values in ${filledCols} column(s)`);
        if(dupesRemoved) parts.push(`removed ${dupesRemoved} duplicate row(s)`);
        if(outliersRemoved) parts.push(`removed ${outliersRemoved} outlier row(s)`);
        pushHistory(`Auto-cleaned dataset — ${parts.join(', ')}`, ()=>STATE.rawData=before);
      }
      render();
      toast('Change applied', '✓');
    });
  });
  document.querySelectorAll('[data-undo]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const idx = parseInt(el.dataset.undo);
      STATE.cleaningHistory[idx].undo();
      STATE.cleaningHistory.splice(idx,1);
      render();
      toast('Reverted', '↺');
    });
  });
}

/* ============================================================
   STATISTICS
   ============================================================ */
/* ---------------- Correlation & Group-Aggregate helpers ---------------- */
function pearsonPair(colA, colB){
  const xs=[], ys=[];
  STATE.rawData.forEach(r=>{
    const a=parseFloat(r[colA]), b=parseFloat(r[colB]);
    if(!isNaN(a) && !isNaN(b)){ xs.push(a); ys.push(b); }
  });
  if(xs.length<3) return null;
  const ma=mean(xs), mb=mean(ys);
  let num=0, da=0, db=0;
  for(let i=0;i<xs.length;i++){ num += (xs[i]-ma)*(ys[i]-mb); da += (xs[i]-ma)**2; db += (ys[i]-mb)**2; }
  const r = num/Math.sqrt(da*db);
  return isNaN(r) ? null : r;
}
function renderCorrelationSection(){
  const cols = numericCols().map(c=>c.name);
  if(cols.length<2) return '';
  const matrix = cols.map(a=>cols.map(b=> a===b ? 1 : pearsonPair(a,b)));
  function cellColor(r){
    if(r===null) return '#F1F3F9';
    const abs = Math.min(Math.abs(r),1);
    const alpha = (0.12 + abs*0.68).toFixed(2);
    return r>=0 ? `rgba(61,90,254,${alpha})` : `rgba(239,68,68,${alpha})`;
  }
  return `
    <div class="section-title" style="margin-top:8px;">Correlation Matrix</div>
    <div class="card" style="overflow:auto;">
      <table class="corr-table">
        <thead><tr><th></th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
        <tbody>
          ${cols.map((rowName,i)=>`<tr><th>${rowName}</th>${cols.map((colName,j)=>{
            const r = matrix[i][j];
            return `<td style="background:${cellColor(r)}" title="${rowName} vs ${colName}: r = ${r===null?'n/a':r.toFixed(2)}">${r===null?'—':r.toFixed(2)}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:12px;color:var(--text-light);margin:8px 0 0;">Blue = positive correlation, red = negative. Deeper color means a stronger relationship (closer to ±1).</p>
  `;
}
function computeGroupAgg(groupCol, metricCol, agg){
  const groups = {};
  STATE.rawData.forEach(r=>{
    const k = r[groupCol]; const v = parseFloat(r[metricCol]);
    if(k===''||k==null) return;
    if(agg!=='count' && isNaN(v)) return;
    groups[k] = groups[k] || [];
    groups[k].push(v);
  });
  const rows = Object.entries(groups).map(([label,arr])=>{
    let value;
    if(agg==='sum') value = arr.reduce((a,b)=>a+b,0);
    else if(agg==='avg') value = mean(arr);
    else if(agg==='count') value = arr.length;
    else if(agg==='min') value = arrMin(arr);
    else value = arrMax(arr);
    return {label, value};
  });
  return rows.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,15);
}
function renderGroupResultRows(rows){
  if(!rows.length) return `<p style="color:var(--text-light);font-size:13.5px;">No data for this combination.</p>`;
  const maxVal = Math.max(...rows.map(r=>Math.abs(r.value))) || 1;
  return rows.map(r=>`
    <div class="freq-bar-row">
      <span style="min-width:120px;font-weight:500;">${r.label}</span>
      <div class="freq-bar-track"><div class="freq-bar-fill" style="width:${(Math.abs(r.value)/maxVal*100).toFixed(0)}%"></div></div>
      <span class="mono" style="color:var(--text-light);min-width:76px;text-align:right;">${fmtNum(r.value)}</span>
    </div>`).join('');
}
function renderGroupAggSection(){
  const groupable = categoricalCols().concat(dateCols());
  const nums = numericCols();
  if(!groupable.length || !nums.length) return '';
  if(!STATE.groupBy.groupCol || !groupable.find(c=>c.name===STATE.groupBy.groupCol)) STATE.groupBy.groupCol = groupable[0].name;
  if(!STATE.groupBy.metricCol || !nums.find(c=>c.name===STATE.groupBy.metricCol)) STATE.groupBy.metricCol = nums[0].name;
  const rows = computeGroupAgg(STATE.groupBy.groupCol, STATE.groupBy.metricCol, STATE.groupBy.agg);
  return `
    <div class="section-title" style="margin-top:24px;">Group &amp; Aggregate</div>
    <div class="card">
      <div class="viz-controls" style="margin-bottom:16px;">
        <div class="control-group"><label>Group by</label>
          <select id="groupCol">${groupable.map(c=>`<option value="${c.name}" ${c.name===STATE.groupBy.groupCol?'selected':''}>${c.name}</option>`).join('')}</select>
        </div>
        <div class="control-group"><label>Metric</label>
          <select id="metricCol">${nums.map(c=>`<option value="${c.name}" ${c.name===STATE.groupBy.metricCol?'selected':''}>${c.name}</option>`).join('')}</select>
        </div>
        <div class="control-group"><label>Aggregation</label>
          <select id="aggType">${[['sum','Sum'],['avg','Average'],['count','Count'],['min','Min'],['max','Max']].map(([v,l])=>`<option value="${v}" ${v===STATE.groupBy.agg?'selected':''}>${l}</option>`).join('')}</select>
        </div>
      </div>
      <div id="groupResults">${renderGroupResultRows(rows)}</div>
    </div>
  `;
}
function attachStatsEvents(){
  const g = document.getElementById('groupCol'), m = document.getElementById('metricCol'), a = document.getElementById('aggType');
  if(!g || !m || !a) return;
  function refresh(){
    STATE.groupBy.groupCol = g.value; STATE.groupBy.metricCol = m.value; STATE.groupBy.agg = a.value;
    document.getElementById('groupResults').innerHTML = renderGroupResultRows(computeGroupAgg(g.value, m.value, a.value));
  }
  g.addEventListener('change', refresh);
  m.addEventListener('change', refresh);
  a.addEventListener('change', refresh);
}

function renderStats(){
  let html = `<div class="panel-header"><div><h2>Statistics</h2><p>Calculated only for the column types where it's meaningful</p></div></div>`;

  if(numericCols().length){
    html += `<div class="section-title">Numeric Columns</div>`;
    numericCols().forEach(c=>{
      const vals = numericValues(c.name).sort((a,b)=>a-b);
      if(!vals.length){ html+=`<div class="stat-card"><div class="head"><h4>${c.name}</h4></div><p style="color:var(--text-light);font-size:13px;">No numeric values available.</p></div>`; return; }
      const m = median(vals), mn=mean(vals), sd=stddev(vals);
      const q1=quantile(vals,0.25), q3=quantile(vals,0.75);
      const modeVal = mode(vals.map(v=>Math.round(v*100)/100));
      html += `<div class="stat-card"><div class="head"><span class="type-badge badge-numeric">numeric</span><h4>${c.name}</h4></div>
        <div class="stat-mini-grid">
          ${[['Count',vals.length],['Mean',fmtNum(mn)],['Median',fmtNum(m)],['Mode',fmtNum(modeVal.value)],
             ['Min',fmtNum(vals[0])],['Max',fmtNum(vals[vals.length-1])],['Range',fmtNum(vals[vals.length-1]-vals[0])],
             ['Std Dev',fmtNum(sd)],['Variance',fmtNum(sd*sd)],['Q1',fmtNum(q1)],['Q3',fmtNum(q3)]]
            .map(([k,v])=>`<div class="stat-mini"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
        </div></div>`;
    });
  }

  if(categoricalCols().length){
    html += `<div class="section-title" style="margin-top:8px;">Categorical Columns</div>`;
    categoricalCols().forEach(c=>{
      const vals = colValues(c.name);
      const freq = {};
      vals.forEach(v=>freq[v]=(freq[v]||0)+1);
      const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);
      const top5 = sorted.slice(0,5);
      const maxCount = top5.length ? top5[0][1] : 1;
      html += `<div class="stat-card"><div class="head"><span class="type-badge badge-categorical">categorical</span><h4>${c.name}</h4></div>
        <div class="stat-mini-grid" style="margin-bottom:12px;">
          <div class="stat-mini"><div class="k">Unique</div><div class="v">${sorted.length}</div></div>
          <div class="stat-mini"><div class="k">Most frequent</div><div class="v" style="font-size:13px;">${sorted[0]?sorted[0][0]:'—'}</div></div>
          <div class="stat-mini"><div class="k">Top count</div><div class="v">${sorted[0]?sorted[0][1]:0}</div></div>
        </div>
        ${top5.map(([label,count])=>`<div class="freq-bar-row"><span style="min-width:110px;font-weight:500;">${label}</span><div class="freq-bar-track"><div class="freq-bar-fill" style="width:${(count/maxCount*100).toFixed(0)}%"></div></div><span class="mono" style="color:var(--text-light);">${count}</span></div>`).join('')}
      </div>`;
    });
  }

  if(dateCols().length){
    html += `<div class="section-title" style="margin-top:8px;">Date Columns</div>`;
    dateCols().forEach(c=>{
      const dates = dateValues(c.name);
      if(!dates.length){ html+=`<div class="stat-card"><h4>${c.name}</h4><p style="color:var(--text-light);font-size:13px;">No valid dates parsed.</p></div>`; return; }
      const earliest = new Date(arrMin(dates)), latest = new Date(arrMax(dates));
      const rangeDays = Math.round((latest-earliest)/86400000);
      const byYear = {};
      dates.forEach(d=>{ const y=d.getFullYear(); byYear[y]=(byYear[y]||0)+1; });
      html += `<div class="stat-card"><div class="head"><span class="type-badge badge-date">date</span><h4>${c.name}</h4></div>
        <div class="stat-mini-grid">
          <div class="stat-mini"><div class="k">Earliest</div><div class="v" style="font-size:13px;">${earliest.toDateString()}</div></div>
          <div class="stat-mini"><div class="k">Latest</div><div class="v" style="font-size:13px;">${latest.toDateString()}</div></div>
          <div class="stat-mini"><div class="k">Range (days)</div><div class="v">${rangeDays}</div></div>
          <div class="stat-mini"><div class="k">Distinct years</div><div class="v">${Object.keys(byYear).length}</div></div>
        </div></div>`;
    });
  }

  if(!numericCols().length && !categoricalCols().length && !dateCols().length){
    html += `<p style="color:var(--text-light);">No columns detected.</p>`;
  }

  html += renderCorrelationSection();
  html += renderGroupAggSection();

  return html;
}

/* ============================================================
   VISUALIZE
   ============================================================ */
function chartOptionsFor(xType, yType){
  if(xType==='numeric' && yType==='numeric') return ['scatter','line'];
  if((xType==='categorical'||xType==='date') && yType==='numeric') return ['bar','line','area','box'];
  if(xType==='categorical' && yType==='categorical') return ['count','stacked_bar'];
  if(xType==='categorical' && !yType) return ['count','pie'];
  if(xType==='numeric' && !yType) return ['histogram','box'];
  if(xType==='date' && yType==='numeric') return ['line','area','bar'];
  return ['count'];
}

function pickDefaultViz(){
  const cats = categoricalCols(), nums = numericCols(), dates = dateCols();
  let xCol, yCol=null, type;
  if(cats.length && nums.length){
    xCol = cats[0]; yCol = nums[0]; type = 'bar';
  } else if(dates.length && nums.length){
    xCol = dates[0]; yCol = nums[0]; type = 'line';
  } else if(nums.length >= 2){
    xCol = nums[0]; yCol = nums[1]; type = 'scatter';
  } else if(nums.length === 1){
    xCol = nums[0]; yCol = null; type = 'histogram';
  } else if(cats.length){
    xCol = cats[0]; yCol = null; type = 'count';
  } else {
    xCol = STATE.columns[0]; yCol = null; type = 'count';
  }
  return {x:xCol.name, y:yCol?yCol.name:'', type};
}

function renderVisualize(){
  if(!STATE.columns.length) return `<p>No data.</p>`;
  const def = pickDefaultViz();
  const opts = (c, selected) => `<option value="${c.name}" ${c.name===selected?'selected':''}>${c.name} (${c.type})</option>`;
  return `
    <div class="panel-header"><div><h2>Visualize</h2><p>A chart is generated automatically — adjust the fields to explore other views</p></div></div>
    <div class="viz-controls">
      <div class="control-group"><label>X-Axis</label>
        <select id="vizX">${STATE.columns.map(c=>opts(c,def.x)).join('')}</select>
      </div>
      <div class="control-group"><label>Y-Axis (optional)</label>
        <select id="vizY"><option value="" ${!def.y?'selected':''}>— none (count) —</option>${STATE.columns.map(c=>opts(c,def.y)).join('')}</select>
      </div>
      <div class="control-group"><label>Chart Type</label>
        <select id="vizType"></select>
      </div>
      <div class="control-group"><label>Chart Title</label>
        <input type="text" id="vizTitle" placeholder="Untitled chart">
      </div>
      <div class="control-group" id="trendGroup" style="display:none;">
        <label>&nbsp;</label>
        <label style="display:flex;align-items:center;gap:7px;font-weight:500;color:var(--text);cursor:pointer;height:40px;">
          <input type="checkbox" id="vizTrend" style="width:16px;height:16px;cursor:pointer;"> Show trendline
        </label>
      </div>
      <button class="btn btn-secondary" id="btnRenderChart" style="height:40px;">↻ Refresh</button>
    </div>
    <div class="chart-wrap">
      <div class="chart-title-row"><h3 id="chartHeading">Building chart…</h3>
        <div style="display:flex;gap:8px;">
          <button class="mini-btn" id="btnPinChart">★ Pin to Dashboard</button>
          <button class="mini-btn" id="btnDownloadChart">⬇ Download PNG</button>
        </div>
      </div>
      <canvas id="vizCanvas" height="110"></canvas>
    </div>
    <div id="pinnedSection"></div>
  `;
}
function renderPinnedGallery(){
  const wrap = document.getElementById('pinnedSection');
  if(!wrap) return;
  if(!STATE.pinnedCharts.length){ wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="section-title" style="margin-top:26px;">Pinned Dashboard <span style="font-weight:400;color:var(--text-light);font-size:11.5px;text-transform:none;">— ${STATE.pinnedCharts.length} chart(s) saved this session</span></div>
    <div class="grid-3">
      ${STATE.pinnedCharts.map(p=>`
        <div class="card pinned-card" data-pin="${p.id}">
          <div class="pinned-card-head"><b>${p.title}</b><button class="mini-btn danger" data-unpin="${p.id}">✕</button></div>
          <img src="${p.img}" alt="${p.title}">
        </div>`).join('')}
    </div>
  `;
  wrap.querySelectorAll('[data-unpin]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      STATE.pinnedCharts = STATE.pinnedCharts.filter(p=>String(p.id)!==btn.dataset.unpin);
      renderPinnedGallery();
      toast('Removed from dashboard', '✕');
    });
  });
}

function attachVisualizeEvents(){
  const xSel = document.getElementById('vizX'), ySel = document.getElementById('vizY'), typeSel = document.getElementById('vizType');
  const titleInput = document.getElementById('vizTitle');
  function refreshTypeOptions(preferredType){
    const xCol = STATE.columns.find(c=>c.name===xSel.value);
    const yCol = ySel.value ? STATE.columns.find(c=>c.name===ySel.value) : null;
    const opts = chartOptionsFor(xCol.type, yCol ? yCol.type : null);
    typeSel.innerHTML = opts.map(o=>`<option value="${o}">${o.charAt(0).toUpperCase()+o.slice(1)}</option>`).join('');
    if(preferredType && opts.includes(preferredType)) typeSel.value = preferredType;
  }
  function autoBuild(preferredType){
    refreshTypeOptions(preferredType);
    document.getElementById('trendGroup').style.display = typeSel.value==='scatter' ? 'flex' : 'none';
    const heading = document.getElementById('chartHeading');
    heading.textContent = 'Loading chart engine…';
    ensureChartLib().then(ok=>{
      if(!ok){
        heading.textContent = 'Chart library failed to load';
        toast('Could not load the charting library — check your connection and hit Refresh', '!');
        return;
      }
      buildChart(xSel.value, ySel.value, typeSel.value, titleInput.value);
    });
  }
  // auto-generate immediately on entering the tab, using smart defaults
  autoBuild(pickDefaultViz().type);
  renderPinnedGallery();

  // auto-regenerate live whenever a field changes — no button press needed
  xSel.addEventListener('change', ()=>autoBuild());
  ySel.addEventListener('change', ()=>autoBuild());
  typeSel.addEventListener('change', ()=>{
    document.getElementById('trendGroup').style.display = typeSel.value==='scatter' ? 'flex' : 'none';
    ensureChartLib().then(ok=>{ if(ok) buildChart(xSel.value, ySel.value, typeSel.value, titleInput.value); });
  });
  document.getElementById('vizTrend').addEventListener('change', ()=>{
    ensureChartLib().then(ok=>{ if(ok) buildChart(xSel.value, ySel.value, typeSel.value, titleInput.value); });
  });
  titleInput.addEventListener('input', ()=>{
    document.getElementById('chartHeading').textContent = titleInput.value || `${xSel.value}${ySel.value?' vs '+ySel.value:''}`;
  });

  document.getElementById('btnRenderChart').addEventListener('click', ()=>{
    ensureChartLib().then(ok=>{
      if(!ok){ toast('Chart library still unavailable', '!'); return; }
      buildChart(xSel.value, ySel.value, typeSel.value, titleInput.value);
      toast('Chart refreshed', '↻');
    });
  });
  document.getElementById('btnPinChart').addEventListener('click', ()=>{
    if(!STATE.currentChart){ toast('Generate a chart first', '!'); return; }
    const img = document.getElementById('vizCanvas').toDataURL('image/png');
    const title = document.getElementById('chartHeading').textContent;
    STATE.pinnedCharts.push({ id: Date.now(), title, img });
    renderPinnedGallery();
    toast('Pinned to dashboard', '★');
  });
  document.getElementById('btnDownloadChart').addEventListener('click', ()=>{
    if(!STATE.currentChart){ toast('Generate a chart first', '!'); return; }
    const link = document.createElement('a');
    link.download = 'statix_chart.png';
    link.href = document.getElementById('vizCanvas').toDataURL('image/png');
    link.click();
  });
}

function aggregateByCategory(xCol, yCol){
  const groups = {};
  STATE.rawData.forEach(r=>{
    const k = r[xCol]; const v = parseFloat(r[yCol]);
    if(k==='' || k==null || isNaN(v)) return;
    groups[k] = groups[k] || [];
    groups[k].push(v);
  });
  return Object.entries(groups).map(([k,arr])=>({label:k, value: arr.reduce((a,b)=>a+b,0)/arr.length}));
}

function buildChart(xCol, yCol, type, title){
  if(typeof Chart === 'undefined'){
    toast('Chart library not ready yet — try Refresh in a moment', '!');
    return;
  }
  const ctx = document.getElementById('vizCanvas').getContext('2d');
  if(STATE.currentChart) STATE.currentChart.destroy();
  document.getElementById('chartHeading').textContent = title || `${xCol}${yCol?' vs '+yCol:''}`;

  const palette = ['#3D5AFE','#8B5CF6','#06B6D4','#12B76A','#F97316','#EF4444','#F59E0B','#0EA5E9'];
  let config;

  if(type==='count' || type==='pie'){
    const freq={};
    colValues(xCol).forEach(v=>freq[v]=(freq[v]||0)+1);
    const entries = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,12);
    config = {
      type: type==='pie'?'pie':'bar',
      data:{ labels: entries.map(e=>e[0]), datasets:[{label:'Count', data: entries.map(e=>e[1]), backgroundColor: entries.map((_,i)=>palette[i%palette.length]), borderRadius: type==='pie'?0:8 }]},
      options:{ responsive:true, plugins:{legend:{display:type==='pie'}}, scales: type==='pie'?{}:{y:{beginAtZero:true}} }
    };
  } else if(type==='histogram'){
    const vals = numericValues(xCol);
    const bins = 10;
    const min=arrMin(vals), max=arrMax(vals), width=(max-min)/bins || 1;
    const counts = new Array(bins).fill(0);
    vals.forEach(v=>{ let idx=Math.floor((v-min)/width); if(idx>=bins)idx=bins-1; if(idx<0)idx=0; counts[idx]++; });
    const labels = counts.map((_,i)=>`${fmtNum(min+i*width)}–${fmtNum(min+(i+1)*width)}`);
    config = { type:'bar', data:{labels, datasets:[{label:'Frequency', data:counts, backgroundColor:'#3D5AFE', borderRadius:6}]}, options:{responsive:true, scales:{y:{beginAtZero:true}}} };
  } else if(type==='box'){
    const vals = numericValues(xCol).sort((a,b)=>a-b);
    const q1=quantile(vals,0.25), q2=quantile(vals,0.5), q3=quantile(vals,0.75);
    const min=vals[0], max=vals[vals.length-1];
    config = { type:'bar', data:{ labels:['Min','Q1','Median','Q3','Max'], datasets:[{label:xCol, data:[min,q1,q2,q3,max], backgroundColor:palette.slice(0,5), borderRadius:8}]}, options:{responsive:true, plugins:{legend:{display:false}}} };
  } else if(type==='stacked_bar'){
    const xFreq={}; colValues(xCol).forEach(v=>xFreq[v]=(xFreq[v]||0)+1);
    const topXCats = Object.entries(xFreq).sort((a,b)=>b[1]-a[1]).slice(0,12).map(e=>e[0]);
    const yFreq={}; colValues(yCol).forEach(v=>yFreq[v]=(yFreq[v]||0)+1);
    const topYCats = Object.entries(yFreq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(e=>e[0]);
    const counts = {};
    STATE.rawData.forEach(r=>{
      const xv=r[xCol], yv=r[yCol];
      if(xv===''||xv==null||yv===''||yv==null) return;
      if(!topXCats.includes(xv) || !topYCats.includes(yv)) return;
      counts[xv] = counts[xv] || {};
      counts[xv][yv] = (counts[xv][yv]||0)+1;
    });
    const datasets = topYCats.map((yc,i)=>({
      label: String(yc),
      data: topXCats.map(xc => (counts[xc] && counts[xc][yc]) || 0),
      backgroundColor: palette[i % palette.length]
    }));
    config = { type:'bar', data:{ labels: topXCats, datasets }, options:{ responsive:true, plugins:{legend:{display:true}}, scales:{x:{stacked:true}, y:{stacked:true, beginAtZero:true}} } };
  } else if(type==='scatter'){
    const points = STATE.rawData.map(r=>({x:parseFloat(r[xCol]), y: yCol?parseFloat(r[yCol]):0})).filter(p=>!isNaN(p.x)&&!isNaN(p.y));
    const datasets = [{label:`${xCol} vs ${yCol}`, data:points, backgroundColor:'#8B5CF6'}];
    const showTrend = document.getElementById('vizTrend')?.checked;
    if(showTrend && points.length>=2){
      const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
      const mx=mean(xs), my=mean(ys);
      let num=0, den=0;
      for(let i=0;i<xs.length;i++){ num+=(xs[i]-mx)*(ys[i]-my); den+=(xs[i]-mx)**2; }
      const slope = den!==0 ? num/den : 0;
      const intercept = my - slope*mx;
      const minX = arrMin(xs), maxX = arrMax(xs);
      datasets.push({
        type:'line', label:'Trend line',
        data:[{x:minX,y:slope*minX+intercept},{x:maxX,y:slope*maxX+intercept}],
        borderColor:'#F97316', backgroundColor:'#F97316', borderWidth:2.5, pointRadius:0, fill:false, order:0
      });
    }
    config = { type:'scatter', data:{ datasets }, options:{responsive:true, plugins:{legend:{display:!!showTrend}}, scales:{x:{title:{display:true,text:xCol}}, y:{title:{display:true,text:yCol}}}} };
  } else if(type==='line' || type==='area'){
    let labels, data;
    const xType = STATE.columns.find(c=>c.name===xCol).type;
    if(xType==='date'){
      const byDate = {};
      STATE.rawData.forEach(r=>{ const d=new Date(r[xCol]); if(isNaN(d)) return; const key=d.getFullYear(); const v=yCol?parseFloat(r[yCol]):1; if(isNaN(v))return; byDate[key]=byDate[key]||[]; byDate[key].push(v); });
      labels = Object.keys(byDate).sort();
      data = labels.map(k=> yCol ? mean(byDate[k]) : byDate[k].length);
    } else {
      const agg = aggregateByCategory(xCol, yCol || xCol);
      labels = agg.map(a=>a.label); data = agg.map(a=>a.value);
    }
    config = { type:'line', data:{labels, datasets:[{label:yCol||'Value', data, borderColor:'#3D5AFE', backgroundColor: type==='area'?'rgba(61,90,254,0.15)':'transparent', fill: type==='area', tension:0.3, pointRadius:3}]}, options:{responsive:true, scales:{y:{beginAtZero:false}}} };
  } else { // bar (default categorical + numeric)
    let entries;
    if(yCol) entries = aggregateByCategory(xCol, yCol).sort((a,b)=>b.value-a.value).slice(0,15);
    else { const freq={}; colValues(xCol).forEach(v=>freq[v]=(freq[v]||0)+1); entries = Object.entries(freq).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value).slice(0,15); }
    config = { type:'bar', data:{ labels: entries.map(e=>e.label), datasets:[{label: yCol?`Avg ${yCol}`:'Count', data: entries.map(e=>e.value), backgroundColor: entries.map((_,i)=>palette[i%palette.length]), borderRadius:8 }]}, options:{responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}} };
  }

  STATE.currentChart = new Chart(ctx, config);
}

/* ============================================================
   INSIGHTS
   ============================================================ */
function generateInsights(){
  const insights = [];
  const missing = totalMissing(), dupes = duplicateRowCount();

  if(missing>0) insights.push({icon:'!',color:'var(--orange)',bg:'var(--orange-soft)',tag:'Data Quality',text:`${missing.toLocaleString()} missing value(s) were found across ${STATE.columns.filter(c=>missingCount(c.name)>0).length} column(s). Consider cleaning them before deeper analysis.`});
  else insights.push({icon:'✓',color:'var(--green)',bg:'var(--green-soft)',tag:'Data Quality',text:`No missing values were found — this dataset is fully complete.`});

  if(dupes>0) insights.push({icon:'!',color:'var(--orange)',bg:'var(--orange-soft)',tag:'Data Quality',text:`${dupes.toLocaleString()} duplicate row(s) detected, which may skew aggregated statistics.`});

  numericCols().forEach(c=>{
    const vals = numericValues(c.name);
    if(vals.length<2) return;
    const sorted=[...vals].sort((a,b)=>a-b);
    const m = mean(vals), sd = stddev(vals);
    insights.push({icon:'Σ',color:'var(--blue)',bg:'var(--blue-soft)',tag:c.name,text:`Average ${c.name} is ${fmtNum(m)}, ranging from ${fmtNum(sorted[0])} to ${fmtNum(sorted[sorted.length-1])} (std dev ${fmtNum(sd)}).`});
    const q1=quantile(sorted,0.25), q3=quantile(sorted,0.75), iqr=q3-q1;
    const outliers = sorted.filter(v=>v<q1-1.5*iqr||v>q3+1.5*iqr);
    if(outliers.length>0) insights.push({icon:'×',color:'var(--purple)',bg:'var(--purple-soft)',tag:c.name,text:`${outliers.length} outlier value(s) detected in ${c.name} outside the typical IQR range.`});
  });

  categoricalCols().forEach(c=>{
    const vals = colValues(c.name);
    if(!vals.length) return;
    const freq={}; vals.forEach(v=>freq[v]=(freq[v]||0)+1);
    const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);
    const top = sorted[0];
    insights.push({icon:'•',color:'var(--purple)',bg:'var(--purple-soft)',tag:c.name,text:`"${top[0]}" is the most frequent value in ${c.name}, appearing ${top[1]} time(s) (${((top[1]/vals.length)*100).toFixed(1)}% of records). ${sorted.length} unique value(s) total.`});
  });

  dateCols().forEach(c=>{
    const dates = dateValues(c.name);
    if(!dates.length) return;
    const earliest = new Date(arrMin(dates)), latest = new Date(arrMax(dates));
    insights.push({icon:'→',color:'#0891A8',bg:'var(--cyan-soft)',tag:c.name,text:`${c.name} spans from ${earliest.toDateString()} to ${latest.toDateString()}.`});
  });

  // simple correlation between first two numeric columns, if present
  const nc = numericCols();
  if(nc.length>=2){
    const a = numericValues(nc[0].name), b = numericValues(nc[1].name);
    const len = Math.min(a.length,b.length);
    if(len>3){
      const ma=mean(a.slice(0,len)), mb=mean(b.slice(0,len));
      let num=0, da=0, db=0;
      for(let i=0;i<len;i++){ num += (a[i]-ma)*(b[i]-mb); da += (a[i]-ma)**2; db += (b[i]-mb)**2; }
      const r = num/Math.sqrt(da*db);
      if(!isNaN(r)){
        const strength = Math.abs(r)>0.7?'strong':Math.abs(r)>0.4?'moderate':'weak';
        insights.push({icon:'≈',color:'var(--blue)',bg:'var(--blue-soft)',tag:'Correlation',text:`${nc[0].name} and ${nc[1].name} show a ${strength} ${r>0?'positive':'negative'} correlation (r ≈ ${r.toFixed(2)}).`});
      }
    }
  }

  return insights;
}

function renderInsights(){
  const insights = generateInsights();
  return `
    <div class="panel-header"><div><h2>Insights</h2><p>Generated live from calculations on your actual data — nothing pre-written</p></div></div>
    ${insights.map(i=>`
      <div class="insight-card" data-jump="${i.tag==='Correlation'?'visualize':'stats'}">
        <div class="insight-icon" style="background:${i.bg};">${i.icon}</div>
        <div><div class="tag">${i.tag}<span class="go">Explore →</span></div><p>${i.text}</p></div>
      </div>`).join('')}
  `;
}
function attachInsightsEvents(){
  document.querySelectorAll('.insight-card[data-jump]').forEach(card=>{
    card.addEventListener('click', ()=> setTab(card.dataset.jump));
  });
}

/* ============================================================
   REPORT
   ============================================================ */
function renderReport(){
  const insights = generateInsights().slice(0,6);
  return `
    <div class="panel-header"><div><h2>Report</h2><p>A shareable summary generated from ${STATE.fileName}</p></div>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-secondary" id="btnExportCsv" style="padding:9px 16px;font-size:13px;">⬇ Export Cleaned CSV</button>
        <button class="btn btn-primary" id="btnPrintReport" style="padding:9px 16px;font-size:13px;">Print / Save PDF</button>
      </div>
    </div>
    <div class="card">
      <div class="report-section"><h4>1. Dataset Overview</h4>
        <p style="font-size:13.5px;color:var(--text-light);">${STATE.rawData.length.toLocaleString()} rows × ${STATE.columns.length} columns · ${numericCols().length} numeric, ${categoricalCols().length} categorical, ${dateCols().length} date column(s).</p></div>
      <div class="report-section"><h4>2. Data Quality Summary</h4>
        <p style="font-size:13.5px;color:var(--text-light);">${totalMissing()} missing value(s), ${duplicateRowCount()} duplicate row(s).</p></div>
      <div class="report-section"><h4>3. Cleaning Operations Performed</h4>
        ${STATE.cleaningHistory.length===0 ? `<p style="font-size:13.5px;color:var(--text-light);">No cleaning operations performed yet.</p>` :
          `<ul style="padding-left:18px;font-size:13.5px;color:var(--text-light);">${STATE.cleaningHistory.slice().reverse().map(h=>`<li>${h.label}</li>`).join('')}</ul>`}
      </div>
      <div class="report-section"><h4>4. Key Insights</h4>
        ${insights.map(i=>`<p style="font-size:13.5px;color:var(--text-light);margin-bottom:6px;">• ${i.text}</p>`).join('')}
      </div>
      <div class="report-section"><h4>5. Recommendations</h4>
        <p style="font-size:13.5px;color:var(--text-light);">${totalMissing()>0 || duplicateRowCount()>0 ? 'Address remaining missing values and duplicates in the Clean tab before drawing final conclusions.' : 'Data quality looks solid — consider exploring correlations and category breakdowns further in Visualize.'}</p></div>
    </div>
  `;
}
function exportCsv(){
  const csv = Papa.unparse(STATE.rawData);
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='statix_cleaned_' + STATE.fileName.replace(/\.[^.]+$/,'') + '.csv'; a.click();
  URL.revokeObjectURL(url);
}
document.addEventListener('click', e=>{
  if(e.target.id==='btnExportCsv') exportCsv();
  if(e.target.id==='btnDownloadCleanTab'){ exportCsv(); toast('Cleaned dataset downloaded', '⬇'); }
  if(e.target.id==='btnPrintReport') window.print();
});

/* ============================================================
   PROJECTS
   ============================================================ */
function renderProjects(){
  const list = document.getElementById('projectsList');
  if(STATE.savedProjects.length===0){
    list.innerHTML = `<div class="card" style="text-align:center;color:var(--text-light);">No saved projects yet. Analyze a dataset, then click "Save current as project".</div>`;
    return;
  }
  list.innerHTML = STATE.savedProjects.map((p,i)=>`
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div><div style="font-weight:700;">${p.fileName}</div><div style="font-size:12.5px;color:var(--text-light);">${p.rowCount} rows × ${p.colCount} cols · saved ${new Date(p.savedAt).toLocaleString()}</div></div>
      <div style="display:flex;gap:8px;">
        <button class="mini-btn" data-load="${i}">Load</button>
        <button class="mini-btn danger" data-del="${i}">Delete</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-load]').forEach(b=>b.addEventListener('click', ()=>{
    const p = STATE.savedProjects[parseInt(b.dataset.load)];
    STATE.fileName = p.fileName; STATE.rawData = JSON.parse(JSON.stringify(p.rawData));
    STATE.cleaningHistory = []; detectColumns();
    enterApp();
  }));
  list.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
    STATE.savedProjects.splice(parseInt(b.dataset.del),1);
    sessionStorage.setItem('statix_projects', JSON.stringify(STATE.savedProjects));
    renderProjects();
  }));
}
document.getElementById('btnSaveProject').addEventListener('click', ()=>{
  if(!STATE.rawData.length){ toast('Analyze a dataset first', '!'); return; }
  STATE.savedProjects.push({ fileName: STATE.fileName, rawData: STATE.rawData, rowCount: STATE.rawData.length, colCount: STATE.columns.length, savedAt: Date.now() });
  sessionStorage.setItem('statix_projects', JSON.stringify(STATE.savedProjects));
  toast('Project saved for this session', '✓');
  renderProjects();
});

/* ============================================================
   UPLOAD WIRING
   ============================================================ */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
dropZone.addEventListener('click', ()=>fileInput.click());
document.getElementById('btnUploadHero').addEventListener('click', ()=>fileInput.click());
document.getElementById('btnNewUpload').addEventListener('click', ()=>{ goHome(); setTimeout(()=>fileInput.click(),100); });
document.getElementById('btnOpenPalette').addEventListener('click', openPalette);
document.getElementById('btnSample').addEventListener('click', loadSample);
document.getElementById('btnConnectDB').addEventListener('click', ()=>{ openDbModal(); setDbTab('native'); });
document.getElementById('btnCloseDbModal').addEventListener('click', closeDbModal);
document.getElementById('btnCancelDb').addEventListener('click', closeDbModal);
document.getElementById('btnSubmitDb').addEventListener('click', connectDatabase);
document.getElementById('dbModalOverlay').addEventListener('click', e=>{ if(e.target.id==='dbModalOverlay') closeDbModal(); });
document.getElementById('dbUrl').addEventListener('keydown', e=>{ if(e.key==='Enter') connectDatabase(); });
document.getElementById('dbTabNative').addEventListener('click', ()=>setDbTab('native'));
document.getElementById('dbTabApi').addEventListener('click', ()=>setDbTab('api'));
document.getElementById('dbType').addEventListener('change', applyDbPortDefault);
document.getElementById('dbConnectorHelp').addEventListener('click', e=>{
  e.preventDefault();
  alert('The STATIX Connector is a small local program that lets STATIX pull data using the real MySQL/PostgreSQL/Oracle driver — the same way MySQL Workbench or pgAdmin connect. It runs on your own machine, not in the browser.\\n\\nSetup:\\n1. pip install -r requirements.txt\\n2. python main.py\\n\\nIt starts at http://localhost:8420 and only talks to your browser session — your credentials never leave your machine.');
});
fileInput.addEventListener('change', e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });
['dragover','dragenter'].forEach(ev=>dropZone.addEventListener(ev, e=>{ e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev, e=>{ e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', e=>{ if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
window.addEventListener('resize', ()=>{ if(document.getElementById('app').style.display==='block') positionSideIndicator(); });

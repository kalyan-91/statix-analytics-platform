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
  savedProjects: JSON.parse(sessionStorage.getItem('statix_projects') || '[]'),
  outlierMethod: 'iqr',
  transformSubTab: 'derived',
  derivedForm: { name:'', formula:'' },
  pivot: { rowCol:'', colCol:'', valueCol:'', agg:'sum' },
  filterBuilder: { logic:'AND', conditions:[{ col:'', op:'contains', val:'' }] },
  findReplace: { col:'__all__', find:'', replace:'', matchCase:false },
  secondaryDataset: null,
  merge: { primaryKey:'', secondaryKey:'', joinType:'left', bringCols:[] },
  convertForm: { col:'', targetType:'number' },
  splitForm: { col:'', delimiter:',', removeOriginal:false },
  combineForm: { cols:[], separator:' ', name:'', removeOriginals:false },
  rowOpsIndex: 1,
  sortRules: [{ col:'', dir:'asc' }],
  rankForm: { col:'', dir:'desc', method:'standard', name:'' },
  transposeForm: { keyCol:'' },
  meltForm: { idCols:[], varName:'Variable', valName:'Value' },
  castForm: { groupCols:[], spreadCol:'', valueCol:'', agg:'sum' },
  recording: false,
  recipeSteps: [],
  recipeName: '',
  savedRecipes: JSON.parse(sessionStorage.getItem('statix_recipes') || '[]'),
  groupSummary: { groupCols:[], metrics:[{ col:'', agg:'sum' }] },
  colMathForm: { col:'', op:'add', operand:1, newCol:false, name:'' },
  condColForm: { name:'', conditions:[{ col:'', op:'gt', val:'', then:'' }], elseVal:'' },
  sampleForm: { method:'random', size:10, sizeType:'percent', stratifyCol:'' }
};

/* ---------------- Safe event binding ----------------
   Guards against a single missing element throwing and
   silently killing every addEventListener call after it. */
function on(id, event, handler){
  const el = document.getElementById(id);
  if(!el){ console.warn('STATIX: element #' + id + ' not found — skipping ' + event + ' binding'); return; }
  el.addEventListener(event, handler);
}

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
const TAB_ORDER = ['overview','dataview','clean','transform','stats','visualize','insights','report'];
document.addEventListener('keydown', e=>{
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'){
    if(document.getElementById('app').style.display==='block'){ e.preventDefault(); openPalette(); }
    return;
  }
  if(!document.getElementById('paletteOverlay').classList.contains('hidden')) return;
  if(document.getElementById('app').style.display!=='block') return;
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  const n = parseInt(e.key,10);
  if(n>=1 && n<=8){ setTab(TAB_ORDER[n-1]); }
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
  transform:{label:'Transform', ic:'⇄'},
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
on('paletteInput', 'input', e=>{ _paletteSel = 0; renderPaletteList(e.target.value); });
on('paletteInput', 'keydown', e=>{
  if(e.key==='Escape'){ closePalette(); return; }
  if(e.key==='ArrowDown'){ e.preventDefault(); _paletteSel = Math.min(_paletteSel+1, _paletteItems.length-1); renderPaletteList(e.target.value); }
  if(e.key==='ArrowUp'){ e.preventDefault(); _paletteSel = Math.max(_paletteSel-1, 0); renderPaletteList(e.target.value); }
  if(e.key==='Enter'){ e.preventDefault(); choosePaletteItem(_paletteSel); }
});
on('paletteOverlay', 'click', e=>{
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
    on('btnConfirmGeneric', 'click', onConfirm);
    on('btnCancelGeneric', 'click', onCancel);
    on('btnCloseGenericModal', 'click', onCancel);
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
    on('btnConfirmGeneric', 'click', onConfirm);
    on('btnCancelGeneric', 'click', onCancel);
    on('btnCloseGenericModal', 'click', onCancel);
  });
}
on('genericModalOverlay', 'click', e=>{ if(e.target.id==='genericModalOverlay') _closeGenericModal(); });

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
  STATE.outlierMethod = 'iqr';
  STATE.transformSubTab = 'derived';
  STATE.derivedForm = { name:'', formula:'' };
  STATE.pivot = { rowCol:'', colCol:'', valueCol:'', agg:'sum' };
  STATE.filterBuilder = { logic:'AND', conditions:[{ col:'', op:'contains', val:'' }] };
  STATE.findReplace = { col:'__all__', find:'', replace:'', matchCase:false };
  STATE.secondaryDataset = null;
  STATE.merge = { primaryKey:'', secondaryKey:'', joinType:'left', bringCols:[] };
  STATE.convertForm = { col:'', targetType:'number' };
  STATE.splitForm = { col:'', delimiter:',', removeOriginal:false };
  STATE.combineForm = { cols:[], separator:' ', name:'', removeOriginals:false };
  STATE.rowOpsIndex = 1;
  STATE.sortRules = [{ col:'', dir:'asc' }];
  STATE.rankForm = { col:'', dir:'desc', method:'standard', name:'' };
  STATE.transposeForm = { keyCol:'' };
  STATE.meltForm = { idCols:[], varName:'Variable', valName:'Value' };
  STATE.castForm = { groupCols:[], spreadCol:'', valueCol:'', agg:'sum' };
  STATE.recording = false;
  STATE.recipeSteps = [];
  STATE.recipeName = '';
  STATE.groupSummary = { groupCols:[], metrics:[{ col:'', agg:'sum' }] };
  STATE.colMathForm = { col:'', op:'add', operand:1, newCol:false, name:'' };
  STATE.condColForm = { name:'', conditions:[{ col:'', op:'gt', val:'', then:'' }], elseVal:'' };
  STATE.sampleForm = { method:'random', size:10, sizeType:'percent', stratifyCol:'' };
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
  // Preserve existing order & hidden flags for columns that still exist; append genuinely new columns at the end
  const prevMeta = {};
  (STATE.columns||[]).forEach(c=>{ prevMeta[c.name] = { hidden: !!c.hidden }; });
  const existingOrder = (STATE.columns||[]).map(c=>c.name).filter(n=>cols.includes(n));
  const newNames = cols.filter(n=>!existingOrder.includes(n));
  const orderedNames = [...existingOrder, ...newNames];
  STATE.columns = orderedNames.map(name=>{
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
    return {name, type, hidden: prevMeta[name]?.hidden || false};
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
    case 'transform': panel.innerHTML = renderTransform(); attachTransformEvents(); break;
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
  const visibleCols = STATE.columns.filter(c=>!c.hidden);
  const hiddenCount = STATE.columns.length - visibleCols.length;

  return `
    <div class="panel-header"><div><h2>Data</h2><p>${all.length.toLocaleString()} rows shown${STATE.table.search? ' (search applied)':''}${filterCol&&filterVal? ' (filter applied)':''}${hiddenCount? ` · ${hiddenCount} column(s) hidden (see Clean tab)`:''}</p></div></div>
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
          ${visibleCols.map(c=>`<th data-col="${c.name}">${c.name}${STATE.table.sortCol===c.name ? (STATE.table.sortDir>0?' ▲':' ▼'):''}<span class="type-tag">${c.type}</span></th>`).join('')}
        </tr></thead>
        <tbody>
          ${pageRows.map(r=>`<tr>${visibleCols.map(c=>`<td>${r[c.name]===''||r[c.name]==null ? '<span style="color:var(--red);font-style:italic;">missing</span>' : r[c.name]}</td>`).join('')}</tr>`).join('')}
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
function pushHistory(label, undoFn, step){
  STATE.cleaningHistory.unshift({label, undo:undoFn, ts:Date.now()});
  if(step) recordStep(step.type, step.params);
}
function recordStep(type, params){
  if(!STATE.recording) return;
  STATE.recipeSteps.push({type, params});
}
function uniqueColumnName(base){
  let name = base, n = 2;
  const existing = new Set(STATE.columns.map(c=>c.name));
  while(existing.has(name)){ name = `${base}_${n}`; n++; }
  return name;
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
    <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 12px;">Reorder with the arrows, hide columns from the Data table, or rename/remove them.</p>
    ${STATE.columns.map((c,idx)=>`
      <div class="clean-row" ${c.hidden?'style="opacity:0.55;"':''}>
        <div class="info"><div class="colname">${c.name} <span class="type-badge badge-${c.type}">${c.type}</span>${c.hidden?' <span class="type-badge" style="background:var(--bg);color:var(--text-light);">hidden</span>':''}</div><div class="meta">Position ${idx+1} of ${STATE.columns.length}</div></div>
        <div class="clean-actions">
          <button class="mini-btn" data-action="moveColUp" data-col="${c.name}" ${idx===0?'disabled':''} title="Move left">↑</button>
          <button class="mini-btn" data-action="moveColDown" data-col="${c.name}" ${idx===STATE.columns.length-1?'disabled':''} title="Move right">↓</button>
          <button class="mini-btn" data-action="toggleHideCol" data-col="${c.name}">${c.hidden?'Show':'Hide'}</button>
          <button class="mini-btn" data-action="renameCol" data-col="${c.name}">Rename</button>
          <button class="mini-btn danger" data-action="removeCol" data-col="${c.name}">Remove</button>
        </div>
      </div>`).join('')}

    <div class="section-title" style="margin-top:24px;">Outlier Detection</div>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;">
      <span style="font-size:12.5px;color:var(--text-light);">Method:</span>
      <button class="mini-btn subtab-btn ${STATE.outlierMethod!=='zscore'?'active':''}" data-outlier-method="iqr">IQR (1.5×)</button>
      <button class="mini-btn subtab-btn ${STATE.outlierMethod==='zscore'?'active':''}" data-outlier-method="zscore">Z-score (±3σ)</button>
    </div>
    ${numericCols().length===0 ? `<p style="color:var(--text-light);font-size:13.5px;">No numeric columns available for outlier detection.</p>` :
      numericCols().map(c=>{
        const vals = numericValues(c.name).sort((a,b)=>a-b);
        if(vals.length<4) return '';
        let lo, hi;
        if(STATE.outlierMethod==='zscore'){
          const m = mean(vals), sd = stddev(vals);
          lo = m-3*sd; hi = m+3*sd;
        } else {
          const q1 = quantile(vals,0.25), q3 = quantile(vals,0.75), iqr=q3-q1;
          lo=q1-1.5*iqr; hi=q3+1.5*iqr;
        }
        const outliers = vals.filter(v=>v<lo||v>hi);
        return `<div class="clean-row"><div class="info"><div class="colname">${c.name}</div>
          <div class="meta">${outliers.length} outlier(s) outside [${fmtNum(lo)}, ${fmtNum(hi)}]</div></div>
          ${outliers.length>0 ? `<div class="clean-actions">
            <button class="mini-btn" data-action="flagOutliers" data-col="${c.name}" data-lo="${lo}" data-hi="${hi}">Flag as column</button>
            <button class="mini-btn danger" data-action="removeOutliers" data-col="${c.name}" data-lo="${lo}" data-hi="${hi}">Remove outlier rows</button>
          </div>` : '<span class="empty-msg" style="padding:6px 12px;">✓ clean</span>'}
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
        pushHistory(`Removed rows with missing ${col}`, ()=>STATE.rawData=before, {type:'removeRowsMissing', params:{col}});
      } else if(action==='fillMean'){
        const m = mean(numericValues(col));
        STATE.rawData = STATE.rawData.map(r=> (r[col]===''||r[col]==null) ? {...r,[col]:Math.round(m*100)/100} : r);
        pushHistory(`Filled missing values in ${col} with mean (${fmtNum(m)})`, ()=>STATE.rawData=before, {type:'fillMean', params:{col}});
      } else if(action==='fillMedian'){
        const m = median(numericValues(col));
        STATE.rawData = STATE.rawData.map(r=> (r[col]===''||r[col]==null) ? {...r,[col]:m} : r);
        pushHistory(`Filled missing values in ${col} with median (${fmtNum(m)})`, ()=>STATE.rawData=before, {type:'fillMedian', params:{col}});
      } else if(action==='fillMode'){
        const m = mode(colValues(col)).value;
        STATE.rawData = STATE.rawData.map(r=> (r[col]===''||r[col]==null) ? {...r,[col]:m} : r);
        pushHistory(`Filled missing values in ${col} with mode (${m})`, ()=>STATE.rawData=before, {type:'fillMode', params:{col}});
      } else if(action==='removeDupes'){
        const seen=new Set(); const before2 = STATE.rawData.length;
        STATE.rawData = STATE.rawData.filter(r=>{ const k=JSON.stringify(r); if(seen.has(k))return false; seen.add(k); return true; });
        pushHistory(`Removed ${before2-STATE.rawData.length} duplicate rows`, ()=>STATE.rawData=before, {type:'removeDupes', params:{}});
      } else if(action==='removeCol'){
        const ok = await confirmModal(`Remove column "${col}"? This cannot be changed except via undo.`);
        if(!ok) return;
        STATE.rawData = STATE.rawData.map(r=>{ const {[col]:_,...rest}=r; return rest; });
        STATE.columns = STATE.columns.filter(c=>c.name!==col);
        pushHistory(`Removed column "${col}"`, ()=>{STATE.rawData=before; detectColumns();}, {type:'removeCol', params:{col}});
      } else if(action==='renameCol'){
        const nn = await promptModal(`Rename "${col}" to:`, col);
        if(!nn || nn===col) return;
        STATE.rawData = STATE.rawData.map(r=>{ const v=r[col]; const {[col]:_,...rest}=r; return {...rest,[nn]:v}; });
        detectColumns();
        pushHistory(`Renamed column "${col}" → "${nn}"`, ()=>{STATE.rawData=before; detectColumns();}, {type:'renameCol', params:{from:col, to:nn}});
      } else if(action==='removeOutliers'){
        const lo = parseFloat(btn.dataset.lo), hi = parseFloat(btn.dataset.hi);
        const before3 = STATE.rawData.length;
        STATE.rawData = STATE.rawData.filter(r=>{ const v=parseFloat(r[col]); return isNaN(v) || (v>=lo && v<=hi); });
        pushHistory(`Removed ${before3-STATE.rawData.length} outlier rows in ${col}`, ()=>STATE.rawData=before, {type:'outlierRemove', params:{col, method:STATE.outlierMethod}});
      } else if(action==='flagOutliers'){
        const lo = parseFloat(btn.dataset.lo), hi = parseFloat(btn.dataset.hi);
        const flagCol = uniqueColumnName(`${col}_outlier`);
        let flagged = 0;
        STATE.rawData = STATE.rawData.map(r=>{
          const v = parseFloat(r[col]);
          const isOut = !isNaN(v) && (v<lo || v>hi);
          if(isOut) flagged++;
          return {...r, [flagCol]: isOut ? 'Yes' : 'No'};
        });
        detectColumns();
        pushHistory(`Flagged ${flagged} outlier row(s) in "${col}" as new column "${flagCol}"`, ()=>{STATE.rawData=before; detectColumns();}, {type:'outlierFlag', params:{col, method:STATE.outlierMethod}});
      } else if(action==='moveColUp'){
        const idx = STATE.columns.findIndex(c=>c.name===col);
        if(idx>0){ const tmp=STATE.columns[idx-1]; STATE.columns[idx-1]=STATE.columns[idx]; STATE.columns[idx]=tmp; }
        render(); return;
      } else if(action==='moveColDown'){
        const idx = STATE.columns.findIndex(c=>c.name===col);
        if(idx>=0 && idx<STATE.columns.length-1){ const tmp=STATE.columns[idx+1]; STATE.columns[idx+1]=STATE.columns[idx]; STATE.columns[idx]=tmp; }
        render(); return;
      } else if(action==='toggleHideCol'){
        const c = STATE.columns.find(c=>c.name===col);
        if(c){ c.hidden = !c.hidden; toast(c.hidden ? `${col} hidden from Data table` : `${col} visible again`, c.hidden?'⊘':'✓'); }
        render(); return;
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
        pushHistory(`Standardized text values in "${col}"`, ()=>STATE.rawData=before, {type:'standardizeText', params:{col}});
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
        pushHistory(`Auto-cleaned dataset — ${parts.join(', ')}`, ()=>STATE.rawData=before, {type:'cleanAll', params:{}});
      }
      render();
      toast('Change applied', '✓');
    });
  });
  document.querySelectorAll('[data-outlier-method]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      STATE.outlierMethod = btn.dataset.outlierMethod;
      render();
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
   TRANSFORM — Derived Columns, Pivot, Filter Builder, Merge, Find&Replace
   ============================================================ */

/* ---------------- Safe formula evaluator (derived columns) ---------------- */
const SAFE_FUNCS = ['abs','round','sqrt','min','max','pow','log','exp','floor','ceil'];
function safeEvalExpr(expr){
  if(!/^[0-9+\-*/^().,\s a-zA-Z]*$/.test(expr)) throw new Error('Invalid characters in formula');
  const idents = expr.match(/[a-zA-Z]+/g) || [];
  for(const id of idents){ if(id!=='NaN' && !SAFE_FUNCS.includes(id)) throw new Error('Unknown function: '+id); }
  const jsExpr = expr.replace(/\^/g,'**').replace(/\b(abs|round|sqrt|min|max|pow|log|exp|floor|ceil)\b/g,'Math.$1');
  const fn = new Function('return (' + jsExpr + ');'); // eslint-disable-line no-new-func
  const result = fn();
  return typeof result === 'number' ? result : NaN;
}
function evalFormulaForRow(formula, row){
  const substituted = formula.replace(/\{([^}]+)\}/g, (m,name)=>{
    const v = parseFloat(row[name]);
    return isNaN(v) ? 'NaN' : '('+v+')';
  });
  return safeEvalExpr(substituted);
}
function addDerivedColumn(name, formula){
  const dummyRow = {};
  STATE.columns.forEach(c=> dummyRow[c.name] = 1);
  evalFormulaForRow(formula, dummyRow); // throws early on bad syntax / unknown function
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  STATE.rawData = STATE.rawData.map(row=>{
    let val;
    try{ val = evalFormulaForRow(formula, row); }catch(e){ val = NaN; }
    const clean = (val===undefined||val===null||isNaN(val)) ? '' : Math.round(val*10000)/10000;
    return {...row, [name]: clean};
  });
  detectColumns();
  pushHistory(`Added derived column "${name}" = ${formula}`, ()=>{STATE.rawData=before; detectColumns();}, {type:'addDerivedColumn', params:{name, formula}});
}
function renderDerivedPanel(){
  return `
    <div class="card">
      <div class="section-title">New Computed Column</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Click a column below to insert it into the formula. Supports + − * / () and abs(), round(), sqrt(), min(), max().</p>
      <div class="chip-row">
        ${STATE.columns.map(c=>`<span class="col-chip" data-insert-col="${c.name}">${c.name}</span>`).join('')}
      </div>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">New column name</label>
          <input id="derivedName" type="text" placeholder="e.g. Profit" value="${(STATE.derivedForm.name||'').replace(/"/g,'&quot;')}">
        </div>
        <div class="tform-field" style="flex:2;">
          <label class="field-label">Formula</label>
          <input id="derivedFormula" type="text" placeholder="e.g. {Revenue} - {Cost}" value="${(STATE.derivedForm.formula||'').replace(/"/g,'&quot;')}">
        </div>
        <button class="btn btn-primary" id="btnAddDerived" style="padding:10px 18px;font-size:13px;white-space:nowrap;">+ Add Column</button>
      </div>
      <div id="derivedError" style="color:var(--red);font-size:12.5px;"></div>
    </div>
  `;
}
function attachDerivedEvents(){
  document.querySelectorAll('[data-insert-col]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const input = document.getElementById('derivedFormula');
      const token = `{${chip.dataset.insertCol}}`;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0,start) + token + input.value.slice(end);
      STATE.derivedForm.formula = input.value;
      input.focus();
      const pos = start + token.length;
      input.setSelectionRange(pos,pos);
    });
  });
  const nameInput = document.getElementById('derivedName');
  const formulaInput = document.getElementById('derivedFormula');
  if(nameInput) nameInput.addEventListener('input', e=> STATE.derivedForm.name = e.target.value);
  if(formulaInput) formulaInput.addEventListener('input', e=> STATE.derivedForm.formula = e.target.value);
  on('btnAddDerived', 'click', ()=>{
    const name = (document.getElementById('derivedName').value||'').trim();
    const formula = (document.getElementById('derivedFormula').value||'').trim();
    const errEl = document.getElementById('derivedError');
    errEl.textContent = '';
    if(!name){ errEl.textContent = 'Give the new column a name.'; return; }
    if(!formula){ errEl.textContent = 'Enter a formula.'; return; }
    if(STATE.columns.some(c=>c.name===name)){ errEl.textContent = `A column named "${name}" already exists.`; return; }
    try{
      addDerivedColumn(name, formula);
      STATE.derivedForm = {name:'', formula:''};
      render();
      toast(`Added column "${name}"`, '✓');
    }catch(e){
      errEl.textContent = 'Could not evaluate that formula — check column names and syntax.';
    }
  });
}

/* ---------------- Pivot Table Builder ---------------- */
function computePivot(rowCol, colCol, valueCol, agg){
  const rowFreq = {}, colFreq = {};
  STATE.rawData.forEach(r=>{
    const rv = r[rowCol], cv = r[colCol];
    if(rv!=='' && rv!=null) rowFreq[rv] = (rowFreq[rv]||0)+1;
    if(cv!=='' && cv!=null) colFreq[cv] = (colFreq[cv]||0)+1;
  });
  const rowVals = Object.entries(rowFreq).sort((a,b)=>b[1]-a[1]).slice(0,60).map(e=>e[0]);
  const colVals = Object.entries(colFreq).sort((a,b)=>b[1]-a[1]).slice(0,15).map(e=>e[0]);
  const buckets = {};
  STATE.rawData.forEach(r=>{
    const rv = String(r[rowCol]??''), cv = String(r[colCol]??'');
    if(rv==='' || cv==='' || !rowVals.includes(rv) || !colVals.includes(cv)) return;
    const raw = agg==='count' ? 1 : parseFloat(r[valueCol]);
    if(agg!=='count' && isNaN(raw)) return;
    buckets[rv] = buckets[rv] || {};
    buckets[rv][cv] = buckets[rv][cv] || [];
    buckets[rv][cv].push(raw);
  });
  function aggOf(arr){
    if(!arr || !arr.length) return null;
    if(agg==='sum') return arr.reduce((a,b)=>a+b,0);
    if(agg==='avg') return mean(arr);
    if(agg==='count') return arr.length;
    if(agg==='min') return Math.min(...arr);
    if(agg==='max') return Math.max(...arr);
  }
  const rows = rowVals.map(rv=>{
    const values = colVals.map(cv=> aggOf(buckets[rv] && buckets[rv][cv]));
    const rowAllValues = colVals.flatMap(cv=> (buckets[rv] && buckets[rv][cv]) || []);
    return { label: rv, values, total: aggOf(rowAllValues) };
  });
  const colTotals = colVals.map(cv=> aggOf(rows.flatMap(r=> (buckets[r.label] && buckets[r.label][cv]) || [])));
  const grandTotal = aggOf(rows.flatMap(r=> colVals.flatMap(cv=> (buckets[r.label] && buckets[r.label][cv]) || [])));
  return { rowVals, colVals, rows, colTotals, grandTotal, truncatedRows: Object.keys(rowFreq).length>rowVals.length };
}
function renderPivotPanel(){
  const p = STATE.pivot;
  const ready = p.rowCol && p.colCol && (p.agg==='count' || p.valueCol);
  let tableHtml = `<div class="empty-msg">Choose a Rows column, Columns column, and Values column (or Count) to build a pivot.</div>`;
  if(ready){
    const result = computePivot(p.rowCol, p.colCol, p.valueCol, p.agg);
    tableHtml = `
      <div class="pivot-table-wrap" style="margin-top:18px;">
        <table>
          <thead><tr><th>${p.rowCol} \\ ${p.colCol}</th>${result.colVals.map(cv=>`<th>${cv}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>
            ${result.rows.map(r=>`<tr><td>${r.label}</td>${r.values.map(v=>`<td>${v===null?'—':fmtNum(v)}</td>`).join('')}<td>${fmtNum(r.total)}</td></tr>`).join('')}
            <tr class="total-row"><td>Total</td>${result.colTotals.map(v=>`<td>${v===null?'—':fmtNum(v)}</td>`).join('')}<td>${fmtNum(result.grandTotal)}</td></tr>
          </tbody>
        </table>
      </div>
      ${result.truncatedRows ? `<p style="font-size:12px;color:var(--text-light);margin-top:8px;">Showing top 60 "${p.rowCol}" values by frequency.</p>` : ''}
      <button class="btn btn-secondary" id="btnDownloadPivot" style="margin-top:14px;padding:9px 16px;font-size:13px;">⬇ Download Pivot as CSV</button>
    `;
  }
  return `
    <div class="card">
      <div class="section-title">Pivot Table Builder</div>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Rows</label>
          <select id="pivotRowCol">
            <option value="">Choose column…</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===p.rowCol?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Columns</label>
          <select id="pivotColCol">
            <option value="">Choose column…</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===p.colCol?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Values</label>
          <select id="pivotValueCol" ${p.agg==='count'?'disabled':''}>
            <option value="">Choose numeric column…</option>
            ${numericCols().map(c=>`<option value="${c.name}" ${c.name===p.valueCol?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Aggregation</label>
          <select id="pivotAgg">
            <option value="sum" ${p.agg==='sum'?'selected':''}>Sum</option>
            <option value="avg" ${p.agg==='avg'?'selected':''}>Average</option>
            <option value="count" ${p.agg==='count'?'selected':''}>Count</option>
            <option value="min" ${p.agg==='min'?'selected':''}>Min</option>
            <option value="max" ${p.agg==='max'?'selected':''}>Max</option>
          </select>
        </div>
      </div>
      ${tableHtml}
    </div>
  `;
}
function attachPivotEvents(){
  on('pivotRowCol','change', e=>{ STATE.pivot.rowCol = e.target.value; render(); });
  on('pivotColCol','change', e=>{ STATE.pivot.colCol = e.target.value; render(); });
  on('pivotValueCol','change', e=>{ STATE.pivot.valueCol = e.target.value; render(); });
  on('pivotAgg','change', e=>{ STATE.pivot.agg = e.target.value; if(e.target.value==='count') STATE.pivot.valueCol=''; render(); });
  on('btnDownloadPivot','click', ()=>{
    const p = STATE.pivot;
    const result = computePivot(p.rowCol, p.colCol, p.valueCol, p.agg);
    const rows = result.rows.map(r=>{
      const o = { [p.rowCol]: r.label };
      result.colVals.forEach((cv,i)=> o[cv] = r.values[i]===null ? '' : r.values[i]);
      o['Total'] = r.total===null ? '' : r.total;
      return o;
    });
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='statix_pivot.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('Pivot downloaded', '⬇');
  });
}

/* ---------------- Multi-condition Filter Builder ---------------- */
const FILTER_OPS = [
  {v:'contains', label:'contains'}, {v:'ncontains', label:'does not contain'},
  {v:'eq', label:'equals'}, {v:'neq', label:'not equals'},
  {v:'gt', label:'> greater than'}, {v:'gte', label:'≥ greater or equal'},
  {v:'lt', label:'< less than'}, {v:'lte', label:'≤ less or equal'},
  {v:'empty', label:'is empty'}, {v:'nempty', label:'is not empty'}
];
function evalCondition(row, cond){
  if(!cond.col) return true;
  const raw = row[cond.col];
  const sVal = raw===undefined||raw===null ? '' : String(raw);
  const num = parseFloat(raw);
  const needle = String(cond.val??'');
  switch(cond.op){
    case 'eq': return sVal.toLowerCase()===needle.toLowerCase();
    case 'neq': return sVal.toLowerCase()!==needle.toLowerCase();
    case 'contains': return sVal.toLowerCase().includes(needle.toLowerCase());
    case 'ncontains': return !sVal.toLowerCase().includes(needle.toLowerCase());
    case 'gt': return !isNaN(num) && num > parseFloat(needle);
    case 'gte': return !isNaN(num) && num >= parseFloat(needle);
    case 'lt': return !isNaN(num) && num < parseFloat(needle);
    case 'lte': return !isNaN(num) && num <= parseFloat(needle);
    case 'empty': return sVal==='';
    case 'nempty': return sVal!=='';
    default: return true;
  }
}
function matchesFilterBuilder(row){
  const conds = STATE.filterBuilder.conditions.filter(c=>c.col);
  if(!conds.length) return true;
  const results = conds.map(c=>evalCondition(row,c));
  return STATE.filterBuilder.logic==='AND' ? results.every(Boolean) : results.some(Boolean);
}
function refreshFilterPreview(){
  const badge = document.getElementById('filterPreviewBadge');
  const applyBtn = document.getElementById('btnApplyFilter');
  if(!badge) return;
  const hasActiveConds = STATE.filterBuilder.conditions.some(c=>c.col);
  const matchCount = STATE.rawData.filter(matchesFilterBuilder).length;
  badge.textContent = hasActiveConds ? `${matchCount.toLocaleString()} of ${STATE.rawData.length.toLocaleString()} rows match` : 'Set a condition to preview matches';
  if(applyBtn) applyBtn.disabled = !hasActiveConds;
}
function renderFilterPanel(){
  const fb = STATE.filterBuilder;
  const conds = fb.conditions;
  const needsValue = op => op!=='empty' && op!=='nempty';
  const hasActiveConds = conds.some(c=>c.col);
  const matchCount = STATE.rawData.filter(matchesFilterBuilder).length;
  return `
    <div class="card">
      <div class="section-title">Multi-condition Filter Builder</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <span style="font-size:12.5px;color:var(--text-light);">Match</span>
        <div class="logic-toggle">
          <button data-logic="AND" class="${fb.logic==='AND'?'active':''}">ALL (AND)</button>
          <button data-logic="OR" class="${fb.logic==='OR'?'active':''}">ANY (OR)</button>
        </div>
        <span style="font-size:12.5px;color:var(--text-light);">of the conditions below</span>
      </div>
      ${conds.map((c,i)=>`
        <div class="condition-row">
          <select data-cond="col" data-idx="${i}">
            <option value="">Column…</option>
            ${STATE.columns.map(col=>`<option value="${col.name}" ${col.name===c.col?'selected':''}>${col.name}</option>`).join('')}
          </select>
          <select data-cond="op" data-idx="${i}">
            ${FILTER_OPS.map(o=>`<option value="${o.v}" ${o.v===c.op?'selected':''}>${o.label}</option>`).join('')}
          </select>
          ${needsValue(c.op) ? `<input data-cond="val" data-idx="${i}" type="text" placeholder="value" value="${(c.val??'').toString().replace(/"/g,'&quot;')}">` : ''}
          <button class="mini-btn danger" data-remove-cond="${i}" ${conds.length===1?'disabled':''}>Remove</button>
        </div>`).join('')}
      <button class="mini-btn" id="btnAddCondition" style="margin-bottom:16px;">+ Add condition</button>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <span class="preview-badge" id="filterPreviewBadge">${hasActiveConds ? `${matchCount.toLocaleString()} of ${STATE.rawData.length.toLocaleString()} rows match` : 'Set a condition to preview matches'}</span>
        <button class="btn btn-primary" id="btnApplyFilter" style="padding:9px 16px;font-size:13px;" ${!hasActiveConds?'disabled':''}>Apply Filter (keep matching rows)</button>
        <button class="btn btn-secondary" id="btnResetFilter" style="padding:9px 16px;font-size:13px;">Reset</button>
      </div>
    </div>
  `;
}
function attachFilterEvents(){
  document.querySelectorAll('[data-logic]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ STATE.filterBuilder.logic = btn.dataset.logic; render(); });
  });
  document.querySelectorAll('[data-cond]').forEach(el=>{
    const evt = el.tagName==='SELECT' ? 'change' : 'input';
    el.addEventListener(evt, e=>{
      const idx = parseInt(el.dataset.idx), field = el.dataset.cond;
      STATE.filterBuilder.conditions[idx][field] = e.target.value;
      if(field==='op' && (e.target.value==='empty'||e.target.value==='nempty')){
        STATE.filterBuilder.conditions[idx].val = '';
      }
      if(el.tagName==='SELECT'){ render(); } else { refreshFilterPreview(); }
    });
  });
  document.querySelectorAll('[data-remove-cond]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      STATE.filterBuilder.conditions.splice(parseInt(btn.dataset.removeCond),1);
      render();
    });
  });
  on('btnAddCondition','click', ()=>{
    STATE.filterBuilder.conditions.push({col:'', op:'contains', val:''});
    render();
  });
  on('btnApplyFilter','click', async ()=>{
    const matchCount = STATE.rawData.filter(matchesFilterBuilder).length;
    const removeCount = STATE.rawData.length - matchCount;
    if(removeCount===0){ toast('All rows already match this filter', '✓'); return; }
    const ok = await confirmModal(`Apply this filter? ${removeCount.toLocaleString()} row(s) that don't match will be removed (undoable from the Clean tab).`);
    if(!ok) return;
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    STATE.rawData = STATE.rawData.filter(matchesFilterBuilder);
    pushHistory(`Applied filter builder — removed ${removeCount.toLocaleString()} row(s)`, ()=>STATE.rawData=before, {type:'filterApply', params:{logic:STATE.filterBuilder.logic, conditions:JSON.parse(JSON.stringify(STATE.filterBuilder.conditions))}});
    render();
    toast('Filter applied', '✓');
  });
  on('btnResetFilter','click', ()=>{
    STATE.filterBuilder = { logic:'AND', conditions:[{col:'', op:'contains', val:''}] };
    render();
  });
}

/* ---------------- Merge / Join two datasets ---------------- */
function handleSecondaryFile(file){
  if(!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const finish = rows=>{
    if(!rows.length){ toast('That file has no rows', '!'); return; }
    STATE.secondaryDataset = { fileName:file.name, rawData:rows, columns:Object.keys(rows[0]) };
    STATE.merge = { primaryKey:'', secondaryKey:'', joinType:'left', bringCols:[] };
    render();
    toast('Second dataset loaded', '✓');
  };
  if(ext==='csv'){
    Papa.parse(file, { header:true, skipEmptyLines:true, complete: res=>finish(res.data) });
  } else {
    const reader = new FileReader();
    reader.onload = e=>{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      finish(XLSX.utils.sheet_to_json(sheet, {defval:''}));
    };
    reader.readAsArrayBuffer(file);
  }
}
function mergeDatasets(){
  const { primaryKey, secondaryKey, joinType, bringCols } = STATE.merge;
  const sec = STATE.secondaryDataset;
  if(!primaryKey || !secondaryKey || !bringCols.length || !sec) return;
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  const secIndex = {};
  sec.rawData.forEach(r=>{
    const k = String(r[secondaryKey]??'');
    secIndex[k] = secIndex[k] || [];
    secIndex[k].push(r);
  });
  const colKeyMap = {};
  bringCols.forEach(c=>{ colKeyMap[c] = STATE.columns.some(sc=>sc.name===c) ? uniqueColumnName(c) : c; });
  const merged = [];
  STATE.rawData.forEach(r=>{
    const k = String(r[primaryKey]??'');
    const matches = secIndex[k];
    if(matches && matches.length){
      matches.forEach(m=>{
        const extra = {};
        bringCols.forEach(c=>{ extra[colKeyMap[c]] = m[c]; });
        merged.push({...r, ...extra});
      });
    } else if(joinType==='left'){
      const extra = {};
      bringCols.forEach(c=>{ extra[colKeyMap[c]] = ''; });
      merged.push({...r, ...extra});
    }
  });
  STATE.rawData = merged;
  detectColumns();
  pushHistory(`Merged with "${sec.fileName}" on ${primaryKey} = ${secondaryKey} (${joinType} join, +${bringCols.length} column(s))`, ()=>{STATE.rawData=before; detectColumns();});
}
function renderMergePanel(){
  const sec = STATE.secondaryDataset;
  const m = STATE.merge;
  return `
    <div class="card">
      <div class="section-title">Merge / Join a Second Dataset</div>
      ${!sec ? `
        <p style="color:var(--text-light);font-size:13px;margin-bottom:14px;">Upload a second CSV or Excel file to join onto your current dataset by a shared key column.</p>
        <button class="btn btn-secondary" id="btnUploadSecondary" style="padding:9px 16px;font-size:13px;">↑ Upload Second Dataset</button>
      ` : `
        <div class="clean-row" style="margin-bottom:18px;">
          <div class="info"><div class="colname">${sec.fileName}</div><div class="meta">${sec.rawData.length.toLocaleString()} rows × ${sec.columns.length} cols</div></div>
          <div class="clean-actions"><button class="mini-btn danger" id="btnClearSecondary">Remove</button></div>
        </div>
        <div class="tform-row">
          <div class="tform-field">
            <label class="field-label">Join key (this dataset)</label>
            <select id="mergePrimaryKey">
              <option value="">Choose column…</option>
              ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===m.primaryKey?'selected':''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="tform-field">
            <label class="field-label">Join key (second dataset)</label>
            <select id="mergeSecondaryKey">
              <option value="">Choose column…</option>
              ${sec.columns.map(c=>`<option value="${c}" ${c===m.secondaryKey?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="tform-field">
            <label class="field-label">Join type</label>
            <select id="mergeJoinType">
              <option value="left" ${m.joinType==='left'?'selected':''}>Left join (keep all current rows)</option>
              <option value="inner" ${m.joinType==='inner'?'selected':''}>Inner join (matches only)</option>
            </select>
          </div>
        </div>
        <label class="field-label" style="display:block;margin-bottom:8px;">Bring in these columns from the second dataset</label>
        <div class="merge-col-list" style="margin-bottom:18px;">
          ${sec.columns.filter(c=>c!==m.secondaryKey).map(c=>`
            <label><input type="checkbox" data-bring-col="${c}" ${m.bringCols.includes(c)?'checked':''}> ${c}</label>`).join('') || '<span style="color:var(--text-light);font-size:12.5px;">No other columns to bring in.</span>'}
        </div>
        <button class="btn btn-primary" id="btnMergeDatasets" style="padding:10px 18px;font-size:13px;" ${!(m.primaryKey && m.secondaryKey && m.bringCols.length) ? 'disabled':''}>⧉ Merge Datasets</button>
      `}
    </div>
  `;
}
function attachMergeEvents(){
  on('btnUploadSecondary','click', ()=> document.getElementById('secondaryFileInput').click());
  on('btnClearSecondary','click', ()=>{ STATE.secondaryDataset = null; STATE.merge = {primaryKey:'',secondaryKey:'',joinType:'left',bringCols:[]}; render(); });
  on('mergePrimaryKey','change', e=>{ STATE.merge.primaryKey = e.target.value; render(); });
  on('mergeSecondaryKey','change', e=>{ STATE.merge.secondaryKey = e.target.value; render(); });
  on('mergeJoinType','change', e=>{ STATE.merge.joinType = e.target.value; });
  document.querySelectorAll('[data-bring-col]').forEach(cb=>{
    cb.addEventListener('change', e=>{
      const col = cb.dataset.bringCol;
      if(e.target.checked){ if(!STATE.merge.bringCols.includes(col)) STATE.merge.bringCols.push(col); }
      else { STATE.merge.bringCols = STATE.merge.bringCols.filter(c=>c!==col); }
      render();
    });
  });
  on('btnMergeDatasets','click', ()=>{
    const fileName = STATE.secondaryDataset.fileName;
    mergeDatasets();
    STATE.secondaryDataset = null;
    STATE.merge = { primaryKey:'', secondaryKey:'', joinType:'left', bringCols:[] };
    render();
    toast(`Merged with "${fileName}"`, '✓');
  });
}

/* ---------------- Data Type Conversion ---------------- */
function attemptConvert(value, targetType){
  if(targetType==='number'){
    const cleaned = String(value).replace(/[, ]/g,'');
    const n = parseFloat(cleaned);
    return isNaN(n) ? {ok:false} : {ok:true, value:n};
  }
  if(targetType==='date'){
    const d = new Date(value);
    if(isNaN(d.getTime())) return {ok:false};
    return {ok:true, value: d.toISOString().slice(0,10)};
  }
  if(targetType==='text'){
    return {ok:true, value: String(value)};
  }
  return {ok:false};
}
function previewConversion(col, targetType){
  let success=0, fail=0; const failSamples=[];
  STATE.rawData.forEach(r=>{
    const v = r[col];
    if(v===''||v==null) return;
    const res = attemptConvert(v, targetType);
    if(res.ok) success++; else { fail++; if(failSamples.length<5) failSamples.push(String(v)); }
  });
  return {success, fail, failSamples};
}
function applyConversion(col, targetType){
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  let converted=0, blanked=0;
  STATE.rawData = STATE.rawData.map(r=>{
    const v = r[col];
    if(v===''||v==null) return r;
    const res = attemptConvert(v, targetType);
    const newRow = {...r};
    if(res.ok){ newRow[col]=res.value; converted++; } else { newRow[col]=''; blanked++; }
    return newRow;
  });
  detectColumns();
  pushHistory(`Converted "${col}" to ${targetType} (${converted} converted, ${blanked} blanked)`, ()=>{STATE.rawData=before; detectColumns();}, {type:'convertType', params:{col, targetType}});
  return {converted, blanked};
}
function renderConvertPanel(){
  const cf = STATE.convertForm;
  const preview = cf.col ? previewConversion(cf.col, cf.targetType) : null;
  return `
    <div class="card">
      <div class="section-title">Convert Column Type</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Values that can't convert are blanked out — preview first to see what would break.</p>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Column</label>
          <select id="convertCol">
            <option value="">Choose column…</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===cf.col?'selected':''}>${c.name} (${c.type})</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Convert to</label>
          <select id="convertTarget">
            <option value="number" ${cf.targetType==='number'?'selected':''}>Number</option>
            <option value="date" ${cf.targetType==='date'?'selected':''}>Date (YYYY-MM-DD)</option>
            <option value="text" ${cf.targetType==='text'?'selected':''}>Text</option>
          </select>
        </div>
      </div>
      ${!cf.col ? `<div class="empty-msg">Choose a column to preview the conversion.</div>` : `
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:${preview.fail>0?'10px':'18px'};">
          <span class="preview-badge">${preview.success.toLocaleString()} would convert</span>
          ${preview.fail>0 ? `<span class="preview-badge" style="background:#FEE2E2;color:var(--red);">${preview.fail.toLocaleString()} would blank</span>` : ''}
        </div>
        ${preview.fail>0 ? `<p style="font-size:12px;color:var(--text-light);margin:0 0 18px;">Examples that won't convert: ${preview.failSamples.map(s=>`"${s}"`).join(', ')}</p>` : ''}
        <button class="btn btn-primary" id="btnApplyConvert" style="padding:10px 18px;font-size:13px;">Convert Column</button>
      `}
    </div>
  `;
}
function attachConvertEvents(){
  on('convertCol','change', e=>{ STATE.convertForm.col = e.target.value; render(); });
  on('convertTarget','change', e=>{ STATE.convertForm.targetType = e.target.value; render(); });
  on('btnApplyConvert','click', async ()=>{
    const cf = STATE.convertForm;
    const preview = previewConversion(cf.col, cf.targetType);
    const ok = await confirmModal(`Convert "${cf.col}" to ${cf.targetType}? ${preview.fail>0 ? `${preview.fail} value(s) that can't convert will be blanked.` : ''} This is undoable.`);
    if(!ok) return;
    const result = applyConversion(cf.col, cf.targetType);
    render();
    toast(`Converted ${result.converted} value(s)`, '✓');
  });
}

/* ---------------- Split / Combine Columns ---------------- */
function splitColumn(col, delimiter, removeOriginal){
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  let maxParts = 1;
  STATE.rawData.forEach(r=>{
    const v = r[col];
    if(v==null||v==='') return;
    const parts = String(v).split(delimiter);
    if(parts.length>maxParts) maxParts=parts.length;
  });
  const newColNames = [];
  for(let i=0;i<maxParts;i++){ newColNames.push(uniqueColumnName(`${col}_${i+1}`)); }
  STATE.rawData = STATE.rawData.map(r=>{
    const v = r[col];
    const parts = (v==null||v==='') ? [] : String(v).split(delimiter).map(p=>p.trim());
    const newRow = {...r};
    newColNames.forEach((nc,i)=>{ newRow[nc] = parts[i]!==undefined ? parts[i] : ''; });
    if(removeOriginal) delete newRow[col];
    return newRow;
  });
  detectColumns();
  pushHistory(`Split "${col}" by "${delimiter}" into ${maxParts} column(s)`, ()=>{STATE.rawData=before; detectColumns();}, {type:'splitColumn', params:{col, delimiter, removeOriginal}});
  return {maxParts, newColNames};
}
function combineColumns(cols, separator, newName, removeOriginals){
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  const finalName = uniqueColumnName(newName || 'combined');
  STATE.rawData = STATE.rawData.map(r=>{
    const newRow = {...r};
    newRow[finalName] = cols.map(c=> (r[c]===''||r[c]==null) ? '' : String(r[c])).filter(v=>v!=='').join(separator);
    if(removeOriginals) cols.forEach(c=> delete newRow[c]);
    return newRow;
  });
  detectColumns();
  pushHistory(`Combined [${cols.join(', ')}] into "${finalName}"`, ()=>{STATE.rawData=before; detectColumns();}, {type:'combineColumns', params:{cols, separator, name:finalName, removeOriginals}});
  return finalName;
}
function renderSplitCombinePanel(){
  const sf = STATE.splitForm, cf = STATE.combineForm;
  let splitPreview = '';
  if(sf.col){
    const sample = STATE.rawData.find(r=> r[sf.col]!=null && r[sf.col]!=='');
    const parts = sample ? String(sample[sf.col]).split(sf.delimiter).map(p=>p.trim()) : [];
    splitPreview = `<p style="font-size:12px;color:var(--text-light);margin:10px 0 0;">Example: "${sample?sample[sf.col]:''}" → ${parts.length ? parts.map(p=>`"${p}"`).join(', ') : '(no sample rows)'}</p>`;
  }
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="section-title">Split a Column</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Splits a delimited column into several new columns (e.g. "City, State" → City / State).</p>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Column</label>
          <select id="splitCol">
            <option value="">Choose column…</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===sf.col?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Delimiter</label>
          <input id="splitDelimiter" type="text" placeholder="," value="${(sf.delimiter||'').replace(/"/g,'&quot;')}">
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px;">
        <input type="checkbox" id="splitRemoveOriginal" ${sf.removeOriginal?'checked':''}> Remove original column after split
      </label>
      ${splitPreview}
      <button class="btn btn-primary" id="btnApplySplit" style="margin-top:14px;padding:10px 18px;font-size:13px;" ${!sf.col||!sf.delimiter?'disabled':''}>Split Column</button>
    </div>
    <div class="card">
      <div class="section-title">Combine Columns</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Joins several columns into one text column, skipping blank values.</p>
      <div class="merge-col-list" style="margin-bottom:16px;">
        ${STATE.columns.map(c=>`<label><input type="checkbox" data-combine-col="${c.name}" ${cf.cols.includes(c.name)?'checked':''}> ${c.name}</label>`).join('')}
      </div>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Separator</label>
          <input id="combineSeparator" type="text" placeholder="space" value="${(cf.separator||'').replace(/"/g,'&quot;')}">
        </div>
        <div class="tform-field">
          <label class="field-label">New column name</label>
          <input id="combineName" type="text" placeholder="e.g. Full Address" value="${(cf.name||'').replace(/"/g,'&quot;')}">
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:16px;">
        <input type="checkbox" id="combineRemoveOriginals" ${cf.removeOriginals?'checked':''}> Remove original columns after combining
      </label>
      <button class="btn btn-primary" id="btnApplyCombine" style="padding:10px 18px;font-size:13px;" ${cf.cols.length<2||!cf.name.trim()?'disabled':''}>Combine Columns</button>
    </div>
  `;
}
function attachSplitCombineEvents(){
  on('splitCol','change', e=>{ STATE.splitForm.col = e.target.value; render(); });
  on('splitDelimiter','input', e=>{ STATE.splitForm.delimiter = e.target.value; });
  on('splitRemoveOriginal','change', e=>{ STATE.splitForm.removeOriginal = e.target.checked; });
  on('btnApplySplit','click', async ()=>{
    const sf = STATE.splitForm;
    const ok = await confirmModal(`Split "${sf.col}" by "${sf.delimiter}" into new columns? This is undoable.`);
    if(!ok) return;
    const result = splitColumn(sf.col, sf.delimiter, sf.removeOriginal);
    STATE.splitForm = { col:'', delimiter:',', removeOriginal:false };
    render();
    toast(`Split into ${result.maxParts} column(s)`, '✓');
  });
  document.querySelectorAll('[data-combine-col]').forEach(cb=>{
    cb.addEventListener('change', e=>{
      const col = cb.dataset.combineCol;
      if(e.target.checked){ if(!STATE.combineForm.cols.includes(col)) STATE.combineForm.cols.push(col); }
      else { STATE.combineForm.cols = STATE.combineForm.cols.filter(c=>c!==col); }
      render();
    });
  });
  on('combineSeparator','input', e=>{ STATE.combineForm.separator = e.target.value; });
  on('combineName','input', e=>{ STATE.combineForm.name = e.target.value; });
  on('combineRemoveOriginals','change', e=>{ STATE.combineForm.removeOriginals = e.target.checked; });
  on('btnApplyCombine','click', async ()=>{
    const cf = STATE.combineForm;
    const ok = await confirmModal(`Combine [${cf.cols.join(', ')}] into "${cf.name}"? This is undoable.`);
    if(!ok) return;
    const finalName = combineColumns(cf.cols, cf.separator, cf.name, cf.removeOriginals);
    STATE.combineForm = { cols:[], separator:' ', name:'', removeOriginals:false };
    render();
    toast(`Created column "${finalName}"`, '✓');
  });
}

/* ---------------- Row Operations ---------------- */
function renderRowOpsPanel(){
  const total = STATE.rawData.length;
  const idx = Math.min(Math.max(1, STATE.rowOpsIndex||1), total);
  const row = STATE.rawData[idx-1] || {};
  const visibleCols = STATE.columns.filter(c=>!c.hidden).slice(0,6);
  return `
    <div class="card">
      <div class="section-title">Row Operations</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">${total.toLocaleString()} row(s) total. Jump to a row to duplicate, delete, or reorder it.</p>
      <div class="tform-row" style="align-items:center;">
        <div class="tform-field" style="max-width:160px;">
          <label class="field-label">Row #</label>
          <input id="rowOpsIndex" type="number" min="1" max="${total}" value="${idx}">
        </div>
        <button class="mini-btn" id="rowOpsPrev" ${idx<=1?'disabled':''}>← Prev</button>
        <button class="mini-btn" id="rowOpsNext" ${idx>=total?'disabled':''}>Next →</button>
      </div>
      <div class="pivot-table-wrap" style="margin:14px 0 18px;">
        <table><thead><tr>${visibleCols.map(c=>`<th>${c.name}</th>`).join('')}</tr></thead>
        <tbody><tr>${visibleCols.map(c=>`<td>${row[c.name]===''||row[c.name]==null?'<span style="color:var(--red);font-style:italic;">missing</span>':row[c.name]}</td>`).join('')}</tr></tbody></table>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
        <button class="mini-btn" id="rowOpsDuplicate">⧉ Duplicate this row</button>
        <button class="mini-btn" id="rowOpsMoveUp" ${idx<=1?'disabled':''}>↑ Move up</button>
        <button class="mini-btn" id="rowOpsMoveDown" ${idx>=total?'disabled':''}>↓ Move down</button>
        <button class="mini-btn danger" id="rowOpsDelete">🗑 Delete this row</button>
      </div>
      <button class="btn btn-secondary" id="rowOpsAddBlank" style="padding:9px 16px;font-size:13px;">+ Add blank row at end</button>
    </div>
  `;
}
function attachRowOpsEvents(){
  on('rowOpsIndex','change', e=>{ STATE.rowOpsIndex = parseInt(e.target.value)||1; render(); });
  on('rowOpsPrev','click', ()=>{ STATE.rowOpsIndex = Math.max(1,(STATE.rowOpsIndex||1)-1); render(); });
  on('rowOpsNext','click', ()=>{ STATE.rowOpsIndex = Math.min(STATE.rawData.length,(STATE.rowOpsIndex||1)+1); render(); });
  on('rowOpsAddBlank','click', ()=>{
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    const blank = {}; STATE.columns.forEach(c=> blank[c.name]='');
    STATE.rawData.push(blank);
    pushHistory('Added a blank row at the end', ()=>STATE.rawData=before);
    STATE.rowOpsIndex = STATE.rawData.length;
    render();
    toast('Blank row added', '✓');
  });
  on('rowOpsDuplicate','click', ()=>{
    const idx = Math.min(Math.max(1, STATE.rowOpsIndex||1), STATE.rawData.length);
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    const copy = {...STATE.rawData[idx-1]};
    STATE.rawData.splice(idx, 0, copy);
    pushHistory(`Duplicated row ${idx}`, ()=>STATE.rawData=before);
    render();
    toast('Row duplicated', '✓');
  });
  on('rowOpsMoveUp','click', ()=>{
    const idx = Math.min(Math.max(1, STATE.rowOpsIndex||1), STATE.rawData.length);
    if(idx<=1) return;
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    const tmp = STATE.rawData[idx-2]; STATE.rawData[idx-2]=STATE.rawData[idx-1]; STATE.rawData[idx-1]=tmp;
    pushHistory(`Moved row ${idx} up`, ()=>STATE.rawData=before);
    STATE.rowOpsIndex = idx-1;
    render();
  });
  on('rowOpsMoveDown','click', ()=>{
    const idx = Math.min(Math.max(1, STATE.rowOpsIndex||1), STATE.rawData.length);
    if(idx>=STATE.rawData.length) return;
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    const tmp = STATE.rawData[idx]; STATE.rawData[idx]=STATE.rawData[idx-1]; STATE.rawData[idx-1]=tmp;
    pushHistory(`Moved row ${idx} down`, ()=>STATE.rawData=before);
    STATE.rowOpsIndex = idx+1;
    render();
  });
  on('rowOpsDelete','click', async ()=>{
    const idx = Math.min(Math.max(1, STATE.rowOpsIndex||1), STATE.rawData.length);
    const ok = await confirmModal(`Delete row ${idx}? This is undoable.`);
    if(!ok) return;
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    STATE.rawData.splice(idx-1,1);
    pushHistory(`Deleted row ${idx}`, ()=>STATE.rawData=before);
    if(STATE.rowOpsIndex > STATE.rawData.length) STATE.rowOpsIndex = STATE.rawData.length;
    render();
    toast('Row deleted', '✓');
  });
}

/* ---------------- Sort & Rank Builder ---------------- */
function sortRowsBy(rules){
  return [...STATE.rawData].sort((a,b)=>{
    for(const rule of rules){
      if(!rule.col) continue;
      const av=a[rule.col], bv=b[rule.col];
      const an=parseFloat(av), bn=parseFloat(bv);
      let cmp;
      if(!isNaN(an) && !isNaN(bn)){ cmp = an-bn; } else { cmp = String(av??'').localeCompare(String(bv??'')); }
      if(cmp!==0) return rule.dir==='desc' ? -cmp : cmp;
    }
    return 0;
  });
}
function applyMultiSort(rules){
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  STATE.rawData = sortRowsBy(rules);
  pushHistory(`Sorted by ${rules.map(r=>`${r.col} (${r.dir})`).join(', ')}`, ()=>STATE.rawData=before, {type:'sortApply', params:{rules}});
}
function computeRanks(col, dir, method){
  const isNumeric = STATE.columns.find(c=>c.name===col)?.type==='numeric';
  const indices = STATE.rawData.map((r,i)=>i);
  indices.sort((ia,ib)=>{
    const a=STATE.rawData[ia][col], b=STATE.rawData[ib][col];
    let cmp;
    if(isNumeric){ cmp = parseFloat(a)-parseFloat(b); } else { cmp = String(a??'').localeCompare(String(b??'')); }
    return dir==='desc' ? -cmp : cmp;
  });
  const ranks = new Array(STATE.rawData.length);
  let rank=1;
  for(let i=0;i<indices.length;i++){
    if(i>0){
      const prev = STATE.rawData[indices[i-1]][col], cur = STATE.rawData[indices[i]][col];
      const same = isNumeric ? parseFloat(prev)===parseFloat(cur) : String(prev)===String(cur);
      if(!same){ rank = method==='dense' ? rank+1 : i+1; }
    }
    ranks[indices[i]] = rank;
  }
  return ranks;
}
function addRankColumn(col, dir, method, newName){
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  const ranks = computeRanks(col, dir, method);
  const finalName = uniqueColumnName(newName || `${col}_rank`);
  STATE.rawData = STATE.rawData.map((r,i)=> ({...r, [finalName]: ranks[i]}));
  detectColumns();
  pushHistory(`Added rank column "${finalName}" based on ${col} (${dir}, ${method})`, ()=>{STATE.rawData=before; detectColumns();}, {type:'addRankColumn', params:{col, dir, method, name:finalName}});
  return finalName;
}
function renderSortRankPanel(){
  const sr = STATE.sortRules;
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="section-title">Multi-column Sort</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Reorders the underlying dataset — earlier rules break ties in later ones.</p>
      ${sr.map((rule,i)=>`
        <div class="condition-row">
          <select data-sort-col="${i}">
            <option value="">Column…</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===rule.col?'selected':''}>${c.name}</option>`).join('')}
          </select>
          <select data-sort-dir="${i}">
            <option value="asc" ${rule.dir==='asc'?'selected':''}>Ascending</option>
            <option value="desc" ${rule.dir==='desc'?'selected':''}>Descending</option>
          </select>
          <button class="mini-btn danger" data-remove-sort="${i}" ${sr.length===1?'disabled':''}>Remove</button>
        </div>`).join('')}
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="mini-btn" id="btnAddSortRule">+ Add sort rule</button>
        <button class="btn btn-primary" id="btnApplySort" style="padding:9px 16px;font-size:13px;" ${!sr.some(r=>r.col)?'disabled':''}>Apply Sort</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title">Add Rank Column</div>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Rank by</label>
          <select id="rankCol">
            <option value="">Choose column…</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===STATE.rankForm.col?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Direction</label>
          <select id="rankDir">
            <option value="desc" ${STATE.rankForm.dir==='desc'?'selected':''}>Highest first</option>
            <option value="asc" ${STATE.rankForm.dir==='asc'?'selected':''}>Lowest first</option>
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Method</label>
          <select id="rankMethod">
            <option value="standard" ${STATE.rankForm.method==='standard'?'selected':''}>Standard (1,2,2,4)</option>
            <option value="dense" ${STATE.rankForm.method==='dense'?'selected':''}>Dense (1,2,2,3)</option>
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">New column name</label>
          <input id="rankName" type="text" placeholder="e.g. Revenue_Rank" value="${(STATE.rankForm.name||'').replace(/"/g,'&quot;')}">
        </div>
      </div>
      <button class="btn btn-primary" id="btnAddRank" style="padding:10px 18px;font-size:13px;" ${!STATE.rankForm.col?'disabled':''}>Add Rank Column</button>
    </div>
  `;
}
function attachSortRankEvents(){
  document.querySelectorAll('[data-sort-col]').forEach(el=>{
    el.addEventListener('change', e=>{ STATE.sortRules[parseInt(el.dataset.sortCol)].col = e.target.value; render(); });
  });
  document.querySelectorAll('[data-sort-dir]').forEach(el=>{
    el.addEventListener('change', e=>{ STATE.sortRules[parseInt(el.dataset.sortDir)].dir = e.target.value; render(); });
  });
  document.querySelectorAll('[data-remove-sort]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ STATE.sortRules.splice(parseInt(btn.dataset.removeSort),1); render(); });
  });
  on('btnAddSortRule','click', ()=>{ STATE.sortRules.push({col:'', dir:'asc'}); render(); });
  on('btnApplySort','click', ()=>{
    applyMultiSort(STATE.sortRules.filter(r=>r.col));
    render();
    toast('Dataset sorted', '✓');
  });
  on('rankCol','change', e=>{ STATE.rankForm.col = e.target.value; render(); });
  on('rankDir','change', e=>{ STATE.rankForm.dir = e.target.value; });
  on('rankMethod','change', e=>{ STATE.rankForm.method = e.target.value; });
  const rankNameInput = document.getElementById('rankName');
  if(rankNameInput) rankNameInput.addEventListener('input', e=> STATE.rankForm.name = e.target.value);
  on('btnAddRank','click', ()=>{
    const rf = STATE.rankForm;
    const finalName = addRankColumn(rf.col, rf.dir, rf.method, rf.name);
    STATE.rankForm.name = '';
    render();
    toast(`Added column "${finalName}"`, '✓');
  });
}

/* ---------------- Reshape: Transpose / Melt / Cast ---------------- */
function transposeDataset(keyCol){
  const cols = STATE.columns.map(c=>c.name);
  const otherCols = cols.filter(c=>c!==keyCol);
  const rowLabels = STATE.rawData.map((r,i)=>{
    let label = keyCol ? String(r[keyCol]??'') : `Row ${i+1}`;
    if(!label) label = `Row ${i+1}`;
    return label;
  });
  const seen = {};
  const finalLabels = rowLabels.map(l=>{
    seen[l] = (seen[l]||0)+1;
    return seen[l]>1 ? `${l}_${seen[l]}` : l;
  });
  return otherCols.map(col=>{
    const obj = { Attribute: col };
    STATE.rawData.forEach((r,i)=>{ obj[finalLabels[i]] = r[col]; });
    return obj;
  });
}
function meltDataset(idCols, valueCols, varColName, valColName){
  const newRows = [];
  STATE.rawData.forEach(r=>{
    valueCols.forEach(vc=>{
      const obj = {};
      idCols.forEach(ic=> obj[ic]=r[ic]);
      obj[varColName] = vc;
      obj[valColName] = r[vc];
      newRows.push(obj);
    });
  });
  return newRows;
}
function castDataset(groupCols, spreadCol, valueCol, agg){
  const groups = {};
  STATE.rawData.forEach(r=>{
    const key = groupCols.map(c=>String(r[c]??'')).join('|~|');
    if(!groups[key]) groups[key] = { meta:{}, buckets:{} };
    groupCols.forEach(c=> groups[key].meta[c]=r[c]);
    const sv = String(r[spreadCol]??'');
    if(sv==='') return;
    const raw = agg==='count' ? 1 : parseFloat(r[valueCol]);
    if(agg!=='count' && isNaN(raw)) return;
    groups[key].buckets[sv] = groups[key].buckets[sv]||[];
    groups[key].buckets[sv].push(raw);
  });
  const spreadVals = [...new Set(STATE.rawData.map(r=>String(r[spreadCol]??'')).filter(v=>v!==''))].slice(0,40);
  function aggOf(arr){
    if(!arr||!arr.length) return '';
    if(agg==='sum') return arr.reduce((a,b)=>a+b,0);
    if(agg==='avg') return Math.round(mean(arr)*10000)/10000;
    if(agg==='count') return arr.length;
    if(agg==='min') return Math.min(...arr);
    if(agg==='max') return Math.max(...arr);
  }
  return Object.values(groups).map(g=>{
    const row = {...g.meta};
    spreadVals.forEach(sv=>{ row[sv] = aggOf(g.buckets[sv]); });
    return row;
  });
}
function renderReshapePanel(){
  const rows = STATE.rawData.length, colCount = STATE.columns.length;
  const tf = STATE.transposeForm;
  const mf = STATE.meltForm;
  const meltValueCols = STATE.columns.map(c=>c.name).filter(n=>!mf.idCols.includes(n));
  const cf = STATE.castForm;
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="section-title">Transpose</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Swaps rows and columns. Current shape ${rows.toLocaleString()} rows × ${colCount} cols would become ${(colCount-1).toLocaleString()} rows × ~${rows.toLocaleString()} cols.</p>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Use as new column headers (optional)</label>
          <select id="transposeKeyCol">
            <option value="">Row 1, Row 2, …</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===tf.keyCol?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
      </div>
      ${rows>300 ? `<p style="font-size:12px;color:var(--red);margin:0 0 14px;">⚠ ${rows.toLocaleString()} rows would become ${rows.toLocaleString()} columns — this may be slow or hard to read.</p>` : ''}
      <button class="btn btn-primary" id="btnApplyTranspose" style="padding:10px 18px;font-size:13px;">⇄ Transpose Dataset</button>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="section-title">Melt (Wide → Long)</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Pick the columns to keep as identifiers — every other column gets unpivoted into Variable/Value rows.</p>
      <div class="merge-col-list" style="margin-bottom:14px;">
        ${STATE.columns.map(c=>`<label><input type="checkbox" data-melt-id-col="${c.name}" ${mf.idCols.includes(c.name)?'checked':''}> ${c.name}</label>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--text-light);margin:0 0 14px;">${meltValueCols.length && mf.idCols.length ? `Will unpivot: ${meltValueCols.join(', ')}` : 'Select at least one ID column, leaving at least one column to unpivot.'}</p>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Variable column name</label>
          <input id="meltVarName" type="text" value="${(mf.varName||'').replace(/"/g,'&quot;')}">
        </div>
        <div class="tform-field">
          <label class="field-label">Value column name</label>
          <input id="meltValName" type="text" value="${(mf.valName||'').replace(/"/g,'&quot;')}">
        </div>
      </div>
      <button class="btn btn-primary" id="btnApplyMelt" style="padding:10px 18px;font-size:13px;" ${!mf.idCols.length || !meltValueCols.length ? 'disabled':''}>⇵ Melt Dataset</button>
    </div>

    <div class="card">
      <div class="section-title">Cast (Long → Wide)</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Pick columns to keep grouped, a column whose values become new headers, and a value column to fill them.</p>
      <div class="merge-col-list" style="margin-bottom:14px;">
        ${STATE.columns.map(c=>`<label><input type="checkbox" data-cast-group-col="${c.name}" ${cf.groupCols.includes(c.name)?'checked':''}> ${c.name}</label>`).join('')}
      </div>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Spread column (becomes headers)</label>
          <select id="castSpreadCol">
            <option value="">Choose column…</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===cf.spreadCol?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Values</label>
          <select id="castValueCol" ${cf.agg==='count'?'disabled':''}>
            <option value="">Choose numeric column…</option>
            ${numericCols().map(c=>`<option value="${c.name}" ${c.name===cf.valueCol?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Aggregation</label>
          <select id="castAgg">
            <option value="sum" ${cf.agg==='sum'?'selected':''}>Sum</option>
            <option value="avg" ${cf.agg==='avg'?'selected':''}>Average</option>
            <option value="count" ${cf.agg==='count'?'selected':''}>Count</option>
            <option value="min" ${cf.agg==='min'?'selected':''}>Min</option>
            <option value="max" ${cf.agg==='max'?'selected':''}>Max</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="btnApplyCast" style="padding:10px 18px;font-size:13px;" ${!cf.groupCols.length || !cf.spreadCol || (cf.agg!=='count' && !cf.valueCol) ? 'disabled':''}>⇈ Cast Dataset</button>
    </div>
  `;
}
function attachReshapeEvents(){
  on('transposeKeyCol','change', e=>{ STATE.transposeForm.keyCol = e.target.value; });
  on('btnApplyTranspose','click', async ()=>{
    const rows = STATE.rawData.length;
    const ok = await confirmModal(`Transpose the dataset? ${rows.toLocaleString()} rows will become ${rows.toLocaleString()} columns. This is undoable.`);
    if(!ok) return;
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    const keyCol = STATE.transposeForm.keyCol;
    STATE.rawData = transposeDataset(keyCol);
    detectColumns();
    pushHistory('Transposed dataset', ()=>{STATE.rawData=before; detectColumns();}, {type:'transpose', params:{keyCol}});
    render();
    toast('Dataset transposed', '✓');
  });
  document.querySelectorAll('[data-melt-id-col]').forEach(cb=>{
    cb.addEventListener('change', e=>{
      const col = cb.dataset.meltIdCol;
      if(e.target.checked){ if(!STATE.meltForm.idCols.includes(col)) STATE.meltForm.idCols.push(col); }
      else { STATE.meltForm.idCols = STATE.meltForm.idCols.filter(c=>c!==col); }
      render();
    });
  });
  on('meltVarName','input', e=> STATE.meltForm.varName = e.target.value);
  on('meltValName','input', e=> STATE.meltForm.valName = e.target.value);
  on('btnApplyMelt','click', async ()=>{
    const mf = STATE.meltForm;
    const valueCols = STATE.columns.map(c=>c.name).filter(n=>!mf.idCols.includes(n));
    const ok = await confirmModal(`Melt dataset into long format? ${STATE.rawData.length.toLocaleString()} rows will become ${(STATE.rawData.length*valueCols.length).toLocaleString()} rows. This is undoable.`);
    if(!ok) return;
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    const varName = mf.varName||'Variable', valName = mf.valName||'Value';
    STATE.rawData = meltDataset(mf.idCols, valueCols, varName, valName);
    detectColumns();
    pushHistory('Melted dataset to long format', ()=>{STATE.rawData=before; detectColumns();}, {type:'melt', params:{idCols:mf.idCols, varName, valName}});
    render();
    toast('Dataset melted', '✓');
  });
  document.querySelectorAll('[data-cast-group-col]').forEach(cb=>{
    cb.addEventListener('change', e=>{
      const col = cb.dataset.castGroupCol;
      if(e.target.checked){ if(!STATE.castForm.groupCols.includes(col)) STATE.castForm.groupCols.push(col); }
      else { STATE.castForm.groupCols = STATE.castForm.groupCols.filter(c=>c!==col); }
      render();
    });
  });
  on('castSpreadCol','change', e=>{ STATE.castForm.spreadCol = e.target.value; render(); });
  on('castValueCol','change', e=>{ STATE.castForm.valueCol = e.target.value; });
  on('castAgg','change', e=>{ STATE.castForm.agg = e.target.value; if(e.target.value==='count') STATE.castForm.valueCol=''; render(); });
  on('btnApplyCast','click', async ()=>{
    const cf = STATE.castForm;
    const ok = await confirmModal(`Cast dataset to wide format using "${cf.spreadCol}"? This is undoable.`);
    if(!ok) return;
    const before = JSON.parse(JSON.stringify(STATE.rawData));
    STATE.rawData = castDataset(cf.groupCols, cf.spreadCol, cf.valueCol, cf.agg);
    detectColumns();
    pushHistory('Cast dataset to wide format', ()=>{STATE.rawData=before; detectColumns();}, {type:'cast', params:{groupCols:cf.groupCols, spreadCol:cf.spreadCol, valueCol:cf.valueCol, agg:cf.agg}});
    render();
    toast('Dataset cast to wide format', '✓');
  });
}

/* ---------------- Bulk Find & Replace ---------------- */
function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function countFindMatches(col, find, matchCase){
  if(!find) return 0;
  const cols = col==='__all__' ? STATE.columns.map(c=>c.name) : [col];
  let count = 0;
  const re = new RegExp(escapeRegex(find), matchCase ? 'g' : 'gi');
  STATE.rawData.forEach(r=>{
    cols.forEach(c=>{
      const v = r[c];
      if(v==null) return;
      re.lastIndex = 0;
      const matches = String(v).match(re);
      if(matches) count += matches.length;
    });
  });
  return count;
}
function applyFindReplace(col, find, replace, matchCase){
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  const cols = col==='__all__' ? STATE.columns.map(c=>c.name) : [col];
  const re = new RegExp(escapeRegex(find), matchCase ? 'g' : 'gi');
  let changedCells = 0;
  STATE.rawData = STATE.rawData.map(r=>{
    let newRow = null;
    cols.forEach(c=>{
      const v = r[c];
      if(v==null) return;
      const s = String(v);
      re.lastIndex = 0;
      if(re.test(s)){
        re.lastIndex = 0;
        if(!newRow) newRow = {...r};
        newRow[c] = s.replace(re, replace);
        changedCells++;
      }
    });
    return newRow || r;
  });
  pushHistory(`Find & replace "${find}" → "${replace}" (${changedCells} cell(s) in ${col==='__all__'?'all columns':col})`, ()=>STATE.rawData=before, {type:'findReplace', params:{col, find, replace, matchCase}});
  return changedCells;
}
function refreshFindReplacePreview(){
  const badge = document.getElementById('frPreviewBadge');
  const btn = document.getElementById('btnApplyFindReplace');
  if(!badge) return;
  const fr = STATE.findReplace;
  const matchCount = fr.find ? countFindMatches(fr.col, fr.find, fr.matchCase) : 0;
  badge.textContent = fr.find ? `${matchCount.toLocaleString()} match(es) found` : 'Enter text to search for';
  if(btn) btn.disabled = !fr.find || matchCount===0;
}
function renderFindReplacePanel(){
  const fr = STATE.findReplace;
  const matchCount = fr.find ? countFindMatches(fr.col, fr.find, fr.matchCase) : 0;
  return `
    <div class="card">
      <div class="section-title">Bulk Find &amp; Replace</div>
      <div class="tform-row">
        <div class="tform-field">
          <label class="field-label">Scope</label>
          <select id="frCol">
            <option value="__all__" ${fr.col==='__all__'?'selected':''}>All columns</option>
            ${STATE.columns.map(c=>`<option value="${c.name}" ${c.name===fr.col?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="tform-field">
          <label class="field-label">Find</label>
          <input id="frFind" type="text" placeholder="text to find" value="${(fr.find||'').replace(/"/g,'&quot;')}">
        </div>
        <div class="tform-field">
          <label class="field-label">Replace with</label>
          <input id="frReplace" type="text" placeholder="replacement text" value="${(fr.replace||'').replace(/"/g,'&quot;')}">
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:16px;">
        <input type="checkbox" id="frMatchCase" ${fr.matchCase?'checked':''}> Match case
      </label>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <span class="preview-badge" id="frPreviewBadge">${fr.find ? `${matchCount.toLocaleString()} match(es) found` : 'Enter text to search for'}</span>
        <button class="btn btn-primary" id="btnApplyFindReplace" style="padding:9px 16px;font-size:13px;" ${!fr.find || matchCount===0?'disabled':''}>Replace All</button>
      </div>
    </div>
  `;
}
function attachFindReplaceEvents(){
  on('frCol','change', e=>{ STATE.findReplace.col = e.target.value; render(); });
  on('frFind','input', e=>{ STATE.findReplace.find = e.target.value; refreshFindReplacePreview(); });
  on('frReplace','input', e=>{ STATE.findReplace.replace = e.target.value; });
  on('frMatchCase','change', e=>{ STATE.findReplace.matchCase = e.target.checked; refreshFindReplacePreview(); });
  on('btnApplyFindReplace','click', async ()=>{
    const fr = STATE.findReplace;
    const ok = await confirmModal(`Replace all matches of "${fr.find}" with "${fr.replace}"? This is undoable from the Clean tab.`);
    if(!ok) return;
    const changed = applyFindReplace(fr.col, fr.find, fr.replace, fr.matchCase);
    render();
    toast(`Replaced ${changed} cell(s)`, '✓');
  });
}

/* ---------------- Saved Transform Recipes ---------------- */
function applyRecipeStep(step){
  const {type, params} = step;
  switch(type){
    case 'removeRowsMissing':
      STATE.rawData = STATE.rawData.filter(r=> !(r[params.col]===''||r[params.col]==null));
      break;
    case 'fillMean': {
      const m = mean(numericValues(params.col));
      STATE.rawData = STATE.rawData.map(r=> (r[params.col]===''||r[params.col]==null) ? {...r,[params.col]:Math.round(m*100)/100} : r);
      break;
    }
    case 'fillMedian': {
      const m = median(numericValues(params.col));
      STATE.rawData = STATE.rawData.map(r=> (r[params.col]===''||r[params.col]==null) ? {...r,[params.col]:m} : r);
      break;
    }
    case 'fillMode': {
      const m = mode(colValues(params.col)).value;
      STATE.rawData = STATE.rawData.map(r=> (r[params.col]===''||r[params.col]==null) ? {...r,[params.col]:m} : r);
      break;
    }
    case 'removeDupes': {
      const seen = new Set();
      STATE.rawData = STATE.rawData.filter(r=>{ const k=JSON.stringify(r); if(seen.has(k)) return false; seen.add(k); return true; });
      break;
    }
    case 'removeCol':
      if(!STATE.columns.some(c=>c.name===params.col)) break;
      STATE.rawData = STATE.rawData.map(r=>{ const {[params.col]:_x, ...rest}=r; return rest; });
      detectColumns();
      break;
    case 'renameCol':
      if(!STATE.columns.some(c=>c.name===params.from)) break;
      STATE.rawData = STATE.rawData.map(r=>{ const v=r[params.from]; const {[params.from]:_x, ...rest}=r; return {...rest,[params.to]:v}; });
      detectColumns();
      break;
    case 'outlierRemove': case 'outlierFlag': {
      if(!STATE.columns.some(c=>c.name===params.col && c.type==='numeric')) break;
      const vals = numericValues(params.col).sort((a,b)=>a-b);
      if(vals.length<4) break;
      let lo, hi;
      if(params.method==='zscore'){ const m=mean(vals), sd=stddev(vals); lo=m-3*sd; hi=m+3*sd; }
      else { const q1=quantile(vals,0.25), q3=quantile(vals,0.75), iqr=q3-q1; lo=q1-1.5*iqr; hi=q3+1.5*iqr; }
      if(type==='outlierRemove'){
        STATE.rawData = STATE.rawData.filter(r=>{ const v=parseFloat(r[params.col]); return isNaN(v) || (v>=lo && v<=hi); });
      } else {
        const flagCol = uniqueColumnName(`${params.col}_outlier`);
        STATE.rawData = STATE.rawData.map(r=>{ const v=parseFloat(r[params.col]); const isOut = !isNaN(v)&&(v<lo||v>hi); return {...r,[flagCol]: isOut?'Yes':'No'}; });
        detectColumns();
      }
      break;
    }
    case 'standardizeText': {
      if(!STATE.columns.some(c=>c.name===params.col)) break;
      const groups = textVariantGroups(params.col);
      const mapping = {};
      groups.forEach(([,variants])=>{
        const sortedVariants = Object.entries(variants).sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
        const canonical = sortedVariants[0][0].trim();
        Object.keys(variants).forEach(orig=>{ if(orig!==canonical) mapping[orig]=canonical; });
      });
      STATE.rawData = STATE.rawData.map(r=>{
        const v = r[params.col];
        return (v!=null && Object.prototype.hasOwnProperty.call(mapping,v)) ? {...r,[params.col]:mapping[v]} : r;
      });
      break;
    }
    case 'cleanAll': {
      STATE.columns.forEach(c=>{
        if(missingCount(c.name)===0) return;
        if(c.type==='numeric'){
          const vals = numericValues(c.name); if(!vals.length) return;
          const m = median(vals);
          STATE.rawData = STATE.rawData.map(r=> (r[c.name]===''||r[c.name]==null) ? {...r,[c.name]:m} : r);
        } else {
          const vals = colValues(c.name); if(!vals.length) return;
          const m = mode(vals).value;
          STATE.rawData = STATE.rawData.map(r=> (r[c.name]===''||r[c.name]==null) ? {...r,[c.name]:m} : r);
        }
      });
      const seen=new Set();
      STATE.rawData = STATE.rawData.filter(r=>{ const k=JSON.stringify(r); if(seen.has(k)) return false; seen.add(k); return true; });
      numericCols().forEach(c=>{
        const vals = numericValues(c.name).sort((a,b)=>a-b);
        if(vals.length<4) return;
        const q1=quantile(vals,0.25), q3=quantile(vals,0.75), iqr=q3-q1;
        const lo=q1-1.5*iqr, hi=q3+1.5*iqr;
        STATE.rawData = STATE.rawData.filter(r=>{ const v=parseFloat(r[c.name]); return isNaN(v) || (v>=lo && v<=hi); });
      });
      break;
    }
    case 'addDerivedColumn':
      if(STATE.columns.some(c=>c.name===params.name)) break;
      try{
        const dummyRow={}; STATE.columns.forEach(c=>dummyRow[c.name]=1);
        evalFormulaForRow(params.formula, dummyRow);
        STATE.rawData = STATE.rawData.map(row=>{
          let val; try{ val=evalFormulaForRow(params.formula,row); }catch(e){ val=NaN; }
          const clean = (val===undefined||val===null||isNaN(val)) ? '' : Math.round(val*10000)/10000;
          return {...row,[params.name]:clean};
        });
        detectColumns();
      }catch(e){ /* skip step if formula no longer resolves */ }
      break;
    case 'filterApply': {
      const savedFB = STATE.filterBuilder;
      STATE.filterBuilder = { logic: params.logic, conditions: params.conditions };
      STATE.rawData = STATE.rawData.filter(matchesFilterBuilder);
      STATE.filterBuilder = savedFB;
      break;
    }
    case 'findReplace': {
      const cols = params.col==='__all__' ? STATE.columns.map(c=>c.name) : (STATE.columns.some(c=>c.name===params.col) ? [params.col] : []);
      if(!cols.length) break;
      const re = new RegExp(escapeRegex(params.find), params.matchCase ? 'g' : 'gi');
      STATE.rawData = STATE.rawData.map(r=>{
        let newRow=null;
        cols.forEach(c=>{
          const v=r[c]; if(v==null) return;
          const s=String(v); re.lastIndex=0;
          if(re.test(s)){ re.lastIndex=0; if(!newRow) newRow={...r}; newRow[c]=s.replace(re,params.replace); }
        });
        return newRow||r;
      });
      break;
    }
    case 'convertType': {
      if(!STATE.columns.some(c=>c.name===params.col)) break;
      STATE.rawData = STATE.rawData.map(r=>{
        const v = r[params.col];
        if(v===''||v==null) return r;
        const res = attemptConvert(v, params.targetType);
        return {...r, [params.col]: res.ok ? res.value : ''};
      });
      detectColumns();
      break;
    }
    case 'splitColumn': {
      if(!STATE.columns.some(c=>c.name===params.col)) break;
      let maxParts=1;
      STATE.rawData.forEach(r=>{ const v=r[params.col]; if(v==null||v==='') return; const parts=String(v).split(params.delimiter); if(parts.length>maxParts) maxParts=parts.length; });
      const newColNames=[]; for(let i=0;i<maxParts;i++) newColNames.push(uniqueColumnName(`${params.col}_${i+1}`));
      STATE.rawData = STATE.rawData.map(r=>{
        const v=r[params.col];
        const parts=(v==null||v==='')?[]:String(v).split(params.delimiter).map(p=>p.trim());
        const newRow={...r};
        newColNames.forEach((nc,i)=>{ newRow[nc]=parts[i]!==undefined?parts[i]:''; });
        if(params.removeOriginal) delete newRow[params.col];
        return newRow;
      });
      detectColumns();
      break;
    }
    case 'combineColumns': {
      const availCols = params.cols.filter(c=>STATE.columns.some(sc=>sc.name===c));
      if(!availCols.length) break;
      const finalName = uniqueColumnName(params.name || 'combined');
      STATE.rawData = STATE.rawData.map(r=>{
        const newRow={...r};
        newRow[finalName] = availCols.map(c=> (r[c]===''||r[c]==null)?'':String(r[c])).filter(v=>v!=='').join(params.separator);
        if(params.removeOriginals) availCols.forEach(c=>delete newRow[c]);
        return newRow;
      });
      detectColumns();
      break;
    }
    case 'sortApply': {
      const rules = params.rules.filter(r=> STATE.columns.some(c=>c.name===r.col));
      if(!rules.length) break;
      STATE.rawData = sortRowsBy(rules);
      break;
    }
    case 'addRankColumn': {
      if(!STATE.columns.some(c=>c.name===params.col)) break;
      const ranks = computeRanks(params.col, params.dir, params.method);
      const finalName = uniqueColumnName(params.name || `${params.col}_rank`);
      STATE.rawData = STATE.rawData.map((r,i)=> ({...r, [finalName]: ranks[i]}));
      detectColumns();
      break;
    }
    case 'transpose': {
      STATE.rawData = transposeDataset(STATE.columns.some(c=>c.name===params.keyCol) ? params.keyCol : '');
      detectColumns();
      break;
    }
    case 'melt': {
      const idCols = params.idCols.filter(c=>STATE.columns.some(sc=>sc.name===c));
      const valueCols = STATE.columns.map(c=>c.name).filter(n=>!idCols.includes(n));
      if(!idCols.length || !valueCols.length) break;
      STATE.rawData = meltDataset(idCols, valueCols, params.varName||'Variable', params.valName||'Value');
      detectColumns();
      break;
    }
    case 'cast': {
      const groupCols = params.groupCols.filter(c=>STATE.columns.some(sc=>sc.name===c));
      if(!groupCols.length || !STATE.columns.some(c=>c.name===params.spreadCol)) break;
      if(params.agg!=='count' && !STATE.columns.some(c=>c.name===params.valueCol)) break;
      STATE.rawData = castDataset(groupCols, params.spreadCol, params.valueCol, params.agg);
      detectColumns();
      break;
    }
  }
}
function applyRecipeToCurrentDataset(recipe){
  const before = JSON.parse(JSON.stringify(STATE.rawData));
  recipe.steps.forEach(step=> applyRecipeStep(step));
  detectColumns();
  pushHistory(`Applied recipe "${recipe.name}" (${recipe.steps.length} step(s))`, ()=>{STATE.rawData=before; detectColumns();});
}
function recipeStepLabel(step){
  const p = step.params||{};
  switch(step.type){
    case 'removeRowsMissing': return `Remove rows with missing ${p.col}`;
    case 'fillMean': return `Fill missing ${p.col} with mean`;
    case 'fillMedian': return `Fill missing ${p.col} with median`;
    case 'fillMode': return `Fill missing ${p.col} with mode`;
    case 'removeDupes': return `Remove duplicate rows`;
    case 'removeCol': return `Remove column "${p.col}"`;
    case 'renameCol': return `Rename "${p.from}" → "${p.to}"`;
    case 'outlierRemove': return `Remove outliers in ${p.col} (${p.method})`;
    case 'outlierFlag': return `Flag outliers in ${p.col} (${p.method})`;
    case 'standardizeText': return `Standardize text in "${p.col}"`;
    case 'cleanAll': return `Clean Everything (auto)`;
    case 'addDerivedColumn': return `Add column "${p.name}" = ${p.formula}`;
    case 'filterApply': return `Apply filter (${p.logic}, ${p.conditions.length} condition(s))`;
    case 'findReplace': return `Replace "${p.find}" → "${p.replace}" in ${p.col==='__all__'?'all columns':p.col}`;
    case 'convertType': return `Convert "${p.col}" to ${p.targetType}`;
    case 'splitColumn': return `Split "${p.col}" by "${p.delimiter}"`;
    case 'combineColumns': return `Combine [${p.cols.join(', ')}] into "${p.name}"`;
    case 'sortApply': return `Sort by ${p.rules.map(r=>`${r.col} (${r.dir})`).join(', ')}`;
    case 'addRankColumn': return `Add rank column "${p.name}" based on ${p.col}`;
    case 'transpose': return `Transpose dataset`;
    case 'melt': return `Melt to long format (id: ${p.idCols.join(', ')})`;
    case 'cast': return `Cast to wide format using "${p.spreadCol}"`;
    default: return step.type;
  }
}
function renderRecipesPanel(){
  const steps = STATE.recipeSteps;
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="section-title">Record a Recipe</div>
      <p style="color:var(--text-light);font-size:12.5px;margin:-6px 0 14px;">Turn on recording, then perform your cleaning/transform steps as normal — fills, removals, derived columns, type conversion, split/combine, filter apply, find &amp; replace all get captured. Stop and save to replay the same steps on a future dataset. Merge/join isn't recorded since it depends on a second file.</p>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
        ${!STATE.recording ? `<button class="btn btn-primary" id="btnStartRecording" style="padding:9px 16px;font-size:13px;">● Start Recording</button>` :
          `<button class="btn btn-secondary" id="btnStopRecording" style="padding:9px 16px;font-size:13px;">■ Stop Recording</button>`}
        <span class="preview-badge ${STATE.recording?'recording':''}">${STATE.recording ? `● Recording — ${steps.length} step(s) captured` : `${steps.length} step(s) captured`}</span>
      </div>
      ${steps.length>0 ? `
        <div class="history-list" style="margin-bottom:14px;">
          ${steps.map(s=>`<div class="history-item">✓ ${recipeStepLabel(s)}</div>`).join('')}
        </div>
        <div class="tform-row">
          <div class="tform-field" style="flex:2;">
            <label class="field-label">Recipe name</label>
            <input id="recipeNameInput" type="text" placeholder="e.g. Monthly sales cleanup" value="${(STATE.recipeName||'').replace(/"/g,'&quot;')}">
          </div>
          <button class="btn btn-primary" id="btnSaveRecipe" style="padding:10px 18px;font-size:13px;white-space:nowrap;">💾 Save Recipe</button>
          <button class="btn btn-secondary" id="btnClearRecipeSteps" style="padding:10px 18px;font-size:13px;white-space:nowrap;">Clear Steps</button>
        </div>
      ` : ''}
    </div>
    <div class="card">
      <div class="section-title">Saved Recipes</div>
      ${STATE.savedRecipes.length===0 ? `<p style="color:var(--text-light);font-size:13.5px;">No recipes saved yet.</p>` :
        STATE.savedRecipes.map((r,i)=>`
          <div class="clean-row">
            <div class="info"><div class="colname">${r.name}</div><div class="meta">${r.steps.length} step(s) · saved ${new Date(r.ts).toLocaleDateString()}</div></div>
            <div class="clean-actions">
              <button class="mini-btn" data-apply-recipe="${i}">Apply to current dataset</button>
              <button class="mini-btn danger" data-delete-recipe="${i}">Delete</button>
            </div>
          </div>`).join('')}
    </div>
  `;
}
function attachRecipesEvents(){
  on('btnStartRecording','click', ()=>{ STATE.recording = true; STATE.recipeSteps = []; render(); toast('Recording started', '●'); });
  on('btnStopRecording','click', ()=>{ STATE.recording = false; render(); toast('Recording stopped', '■'); });
  const nameInput = document.getElementById('recipeNameInput');
  if(nameInput) nameInput.addEventListener('input', e=> STATE.recipeName = e.target.value);
  on('btnSaveRecipe','click', ()=>{
    const name = (document.getElementById('recipeNameInput').value||'').trim();
    if(!name){ toast('Give the recipe a name', '!'); return; }
    STATE.savedRecipes.push({ name, steps: STATE.recipeSteps, ts: Date.now() });
    sessionStorage.setItem('statix_recipes', JSON.stringify(STATE.savedRecipes));
    STATE.recipeSteps = []; STATE.recipeName = ''; STATE.recording = false;
    render();
    toast(`Recipe "${name}" saved`, '✓');
  });
  on('btnClearRecipeSteps','click', ()=>{ STATE.recipeSteps = []; render(); });
  document.querySelectorAll('[data-apply-recipe]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const recipe = STATE.savedRecipes[parseInt(btn.dataset.applyRecipe)];
      const ok = await confirmModal(`Apply recipe "${recipe.name}" (${recipe.steps.length} step(s)) to the current dataset? This is undoable as one step.`);
      if(!ok) return;
      applyRecipeToCurrentDataset(recipe);
      render();
      toast(`Recipe "${recipe.name}" applied`, '✓');
    });
  });
  document.querySelectorAll('[data-delete-recipe]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const idx = parseInt(btn.dataset.deleteRecipe);
      const name = STATE.savedRecipes[idx].name;
      const ok = await confirmModal(`Delete recipe "${name}"?`);
      if(!ok) return;
      STATE.savedRecipes.splice(idx,1);
      sessionStorage.setItem('statix_recipes', JSON.stringify(STATE.savedRecipes));
      render();
      toast('Recipe deleted', '✓');
    });
  });
}

/* ---------------- Transform tab router ---------------- */
function renderTransform(){
  const sub = STATE.transformSubTab || 'derived';
  return `
    <div class="panel-header"><div><h2>Transform</h2><p>Reshape your dataset — derived columns, pivots, filters, merges, conversions and recipes</p></div></div>
    <div class="subtab-row">
      <button class="mini-btn subtab-btn ${sub==='derived'?'active':''}" data-subtab="derived">ƒ Derived Columns</button>
      <button class="mini-btn subtab-btn ${sub==='pivot'?'active':''}" data-subtab="pivot">▦ Pivot Table</button>
      <button class="mini-btn subtab-btn ${sub==='filter'?'active':''}" data-subtab="filter">⏚ Filter Builder</button>
      <button class="mini-btn subtab-btn ${sub==='merge'?'active':''}" data-subtab="merge">⧉ Merge / Join</button>
      <button class="mini-btn subtab-btn ${sub==='convert'?'active':''}" data-subtab="convert">⇌ Convert Type</button>
      <button class="mini-btn subtab-btn ${sub==='splitcombine'?'active':''}" data-subtab="splitcombine">✂ Split / Combine</button>
      <button class="mini-btn subtab-btn ${sub==='rowops'?'active':''}" data-subtab="rowops">☰ Row Operations</button>
      <button class="mini-btn subtab-btn ${sub==='sortrank'?'active':''}" data-subtab="sortrank">⇅ Sort &amp; Rank</button>
      <button class="mini-btn subtab-btn ${sub==='reshape'?'active':''}" data-subtab="reshape">⬒ Reshape</button>
      <button class="mini-btn subtab-btn ${sub==='findreplace'?'active':''}" data-subtab="findreplace">⌕ Find &amp; Replace</button>
      <button class="mini-btn subtab-btn ${sub==='recipes'?'active':''}" data-subtab="recipes">📖 Recipes</button>
    </div>
    <div id="transformBody">
      ${sub==='derived' ? renderDerivedPanel() : ''}
      ${sub==='pivot' ? renderPivotPanel() : ''}
      ${sub==='filter' ? renderFilterPanel() : ''}
      ${sub==='merge' ? renderMergePanel() : ''}
      ${sub==='convert' ? renderConvertPanel() : ''}
      ${sub==='splitcombine' ? renderSplitCombinePanel() : ''}
      ${sub==='rowops' ? renderRowOpsPanel() : ''}
      ${sub==='sortrank' ? renderSortRankPanel() : ''}
      ${sub==='reshape' ? renderReshapePanel() : ''}
      ${sub==='findreplace' ? renderFindReplacePanel() : ''}
      ${sub==='recipes' ? renderRecipesPanel() : ''}
    </div>
  `;
}
function attachTransformEvents(){
  document.querySelectorAll('[data-subtab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ STATE.transformSubTab = btn.dataset.subtab; render(); });
  });
  const sub = STATE.transformSubTab || 'derived';
  if(sub==='derived') attachDerivedEvents();
  if(sub==='pivot') attachPivotEvents();
  if(sub==='filter') attachFilterEvents();
  if(sub==='merge') attachMergeEvents();
  if(sub==='convert') attachConvertEvents();
  if(sub==='splitcombine') attachSplitCombineEvents();
  if(sub==='rowops') attachRowOpsEvents();
  if(sub==='sortrank') attachSortRankEvents();
  if(sub==='reshape') attachReshapeEvents();
  if(sub==='findreplace') attachFindReplaceEvents();
  if(sub==='recipes') attachRecipesEvents();
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
  on('vizTrend', 'change', ()=>{
    ensureChartLib().then(ok=>{ if(ok) buildChart(xSel.value, ySel.value, typeSel.value, titleInput.value); });
  });
  titleInput.addEventListener('input', ()=>{
    document.getElementById('chartHeading').textContent = titleInput.value || `${xSel.value}${ySel.value?' vs '+ySel.value:''}`;
  });

  on('btnRenderChart', 'click', ()=>{
    ensureChartLib().then(ok=>{
      if(!ok){ toast('Chart library still unavailable', '!'); return; }
      buildChart(xSel.value, ySel.value, typeSel.value, titleInput.value);
      toast('Chart refreshed', '↻');
    });
  });
  on('btnPinChart', 'click', ()=>{
    if(!STATE.currentChart){ toast('Generate a chart first', '!'); return; }
    const img = document.getElementById('vizCanvas').toDataURL('image/png');
    const title = document.getElementById('chartHeading').textContent;
    STATE.pinnedCharts.push({ id: Date.now(), title, img });
    renderPinnedGallery();
    toast('Pinned to dashboard', '★');
  });
  on('btnDownloadChart', 'click', ()=>{
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

function getChartAnimation(type){
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced) return { duration: 0 };
  const base = { duration: 900, easing: 'easeOutQuart' };
  if(type==='pie'){
    return { ...base, duration: 800, animateRotate: true, animateScale: true };
  }
  if(type==='scatter'){
    return { ...base, duration: 700, delay(ctx){ return ctx.type==='data' ? ctx.dataIndex*6 : 0; } };
  }
  if(type==='line' || type==='area'){
    return { ...base, duration: 1100, delay(ctx){ return ctx.type==='data' && ctx.mode==='default' ? ctx.dataIndex*35 : 0; } };
  }
  // bar-family: count, histogram, box, stacked_bar, default bar
  return { ...base, delay(ctx){ return ctx.type==='data' && ctx.mode==='default' ? ctx.dataIndex*45 + (ctx.datasetIndex||0)*120 : 0; } };
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

  config.options = config.options || {};
  config.options.animation = getChartAnimation(type);

  const canvasEl = document.getElementById('vizCanvas');
  canvasEl.classList.remove('chart-pop');
  void canvasEl.offsetWidth; // force reflow so the entrance animation replays each time
  canvasEl.classList.add('chart-pop');

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
/* ---------------- Report data helpers (shared by live tab + standalone export) ---------------- */
function reportNumericRows(){
  return numericCols().map(c=>{
    const vals = numericValues(c.name).sort((a,b)=>a-b);
    if(!vals.length) return {name:c.name, empty:true};
    return {
      name:c.name, count:vals.length, mean:mean(vals), median:median(vals),
      min:vals[0], max:vals[vals.length-1], std:stddev(vals),
      q1:quantile(vals,0.25), q3:quantile(vals,0.75)
    };
  });
}
function reportCategoricalRows(){
  return categoricalCols().map(c=>{
    const vals = colValues(c.name);
    const freq={}; vals.forEach(v=>freq[v]=(freq[v]||0)+1);
    const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);
    return {
      name:c.name, unique: sorted.length,
      top: sorted[0] ? sorted[0][0] : '—',
      topCount: sorted[0] ? sorted[0][1] : 0,
      topPct: sorted[0] && vals.length ? (sorted[0][1]/vals.length*100) : 0
    };
  });
}
function reportDateRows(){
  return dateCols().map(c=>{
    const dates = dateValues(c.name);
    if(!dates.length) return {name:c.name, empty:true};
    const earliest=new Date(arrMin(dates)), latest=new Date(arrMax(dates));
    return {name:c.name, earliest: earliest.toDateString(), latest: latest.toDateString(), rangeDays: Math.round((latest-earliest)/86400000)};
  });
}
function buildReportBody(){
  const insights = generateInsights();
  const numRows = reportNumericRows();
  const catRows = reportCategoricalRows();
  const dateRows = reportDateRows();
  const corrCols = numericCols().map(c=>c.name);
  const groupable = categoricalCols().concat(dateCols());
  const hasGroupAgg = groupable.length && numericCols().length && STATE.groupBy.groupCol && STATE.groupBy.metricCol;
  const groupRows = hasGroupAgg ? computeGroupAgg(STATE.groupBy.groupCol, STATE.groupBy.metricCol, STATE.groupBy.agg).slice(0,8) : [];
  let n = 0;

  let html = `<div class="report-section"><h4>${++n}. Dataset Overview</h4>
    <p style="font-size:13.5px;color:var(--text-light);">${STATE.rawData.length.toLocaleString()} rows × ${STATE.columns.length} columns · ${numericCols().length} numeric, ${categoricalCols().length} categorical, ${dateCols().length} date column(s).</p></div>`;

  html += `<div class="report-section"><h4>${++n}. Data Quality Summary</h4>
    <p style="font-size:13.5px;color:var(--text-light);">${totalMissing().toLocaleString()} missing value(s), ${duplicateRowCount().toLocaleString()} duplicate row(s).</p></div>`;

  if(numRows.length){
    html += `<div class="report-section"><h4>${++n}. Numeric Summary</h4>
      <table class="report-table"><thead><tr><th>Column</th><th>Count</th><th>Mean</th><th>Median</th><th>Std Dev</th><th>Min</th><th>Max</th><th>Q1</th><th>Q3</th></tr></thead>
      <tbody>${numRows.map(r=> r.empty ? `<tr><td>${r.name}</td><td colspan="8" style="color:var(--text-light);">No numeric values</td></tr>` :
        `<tr><td>${r.name}</td><td>${r.count}</td><td>${fmtNum(r.mean)}</td><td>${fmtNum(r.median)}</td><td>${fmtNum(r.std)}</td><td>${fmtNum(r.min)}</td><td>${fmtNum(r.max)}</td><td>${fmtNum(r.q1)}</td><td>${fmtNum(r.q3)}</td></tr>`
      ).join('')}</tbody></table></div>`;
  }

  if(catRows.length){
    html += `<div class="report-section"><h4>${++n}. Categorical Summary</h4>
      <table class="report-table"><thead><tr><th>Column</th><th>Unique</th><th>Most Frequent</th><th>Count</th><th>Share</th></tr></thead>
      <tbody>${catRows.map(r=>`<tr><td>${r.name}</td><td>${r.unique}</td><td>${r.top}</td><td>${r.topCount}</td><td>${r.topPct.toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`;
  }

  if(dateRows.length){
    html += `<div class="report-section"><h4>${++n}. Date Summary</h4>
      <table class="report-table"><thead><tr><th>Column</th><th>Earliest</th><th>Latest</th><th>Range (days)</th></tr></thead>
      <tbody>${dateRows.map(r=> r.empty ? `<tr><td>${r.name}</td><td colspan="3" style="color:var(--text-light);">No valid dates</td></tr>` :
        `<tr><td>${r.name}</td><td>${r.earliest}</td><td>${r.latest}</td><td>${r.rangeDays}</td></tr>`).join('')}</tbody></table></div>`;
  }

  if(corrCols.length>=2){
    html += `<div class="report-section"><h4>${++n}. Correlation Matrix</h4>${renderCorrelationSection()}</div>`;
  }

  if(hasGroupAgg){
    html += `<div class="report-section"><h4>${++n}. Group &amp; Aggregate — ${STATE.groupBy.metricCol} by ${STATE.groupBy.groupCol} (${STATE.groupBy.agg})</h4>
      ${renderGroupResultRows(groupRows)}</div>`;
  }

  html += `<div class="report-section"><h4>${++n}. Visualizations</h4>
    ${STATE.pinnedCharts.length===0 ? `<p style="font-size:13.5px;color:var(--text-light);">No charts pinned yet — pin a chart from the Visualize tab to include it here.</p>` :
      `<div class="report-chart-grid">${STATE.pinnedCharts.map(p=>`<div class="report-chart"><div class="cap">${p.title}</div><img src="${p.img}" alt="${p.title}"></div>`).join('')}</div>`}
  </div>`;

  html += `<div class="report-section"><h4>${++n}. Cleaning Operations Performed</h4>
    ${STATE.cleaningHistory.length===0 ? `<p style="font-size:13.5px;color:var(--text-light);">No cleaning operations performed yet.</p>` :
      `<ul style="padding-left:18px;font-size:13.5px;color:var(--text-light);">${STATE.cleaningHistory.slice().reverse().map(h=>`<li>${h.label}</li>`).join('')}</ul>`}
  </div>`;

  html += `<div class="report-section"><h4>${++n}. Key Insights</h4>
    ${insights.map(i=>`<p style="font-size:13.5px;color:var(--text-light);margin-bottom:6px;">• ${i.text}</p>`).join('')}
  </div>`;

  html += `<div class="report-section"><h4>${++n}. Recommendations</h4>
    <p style="font-size:13.5px;color:var(--text-light);">${totalMissing()>0 || duplicateRowCount()>0 ? 'Address remaining missing values and duplicates in the Clean tab before drawing final conclusions.' : 'Data quality looks solid — consider exploring correlations and category breakdowns further in Visualize.'}</p></div>`;

  return html;
}

function renderReport(){
  return `
    <div class="panel-header"><div><h2>Report</h2><p>A shareable summary generated from ${STATE.fileName}</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-secondary" id="btnExportCsv" style="padding:9px 16px;font-size:13px;">⬇ Export Cleaned CSV</button>
        <button class="btn btn-secondary" id="btnDownloadReport" style="padding:9px 16px;font-size:13px;">⬇ Download Full Report (HTML)</button>
        <button class="btn btn-primary" id="btnPrintReport" style="padding:9px 16px;font-size:13px;">Print / Save PDF</button>
      </div>
    </div>
    <div class="card" id="reportBody">${buildReportBody()}</div>
  `;
}

function exportCsv(){
  const visibleCols = STATE.columns.filter(c=>!c.hidden);
  const orderedRows = STATE.rawData.map(r=>{
    const o = {};
    visibleCols.forEach(c=>{ o[c.name] = r[c.name]; });
    return o;
  });
  const csv = Papa.unparse(orderedRows);
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='statix_cleaned_' + STATE.fileName.replace(/\.[^.]+$/,'') + '.csv'; a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Standalone self-contained HTML report ---------------- */
function generateStandaloneReportHTML(){
  const body = buildReportBody();
  const generated = new Date().toLocaleString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>STATIX Report — ${STATE.fileName}</title>
<style>
  :root{
    --bg:#F5F6FC; --card:#FFFFFF; --border:#E7E9F4; --text:#161826; --text-light:#6C7086;
    --blue:#5546FF; --blue-soft:#EEEBFF; --purple:#FF6A3D; --cyan:#14C8B4; --green:#17B978; --orange:#FFB020;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Segoe UI',Inter,Arial,sans-serif;background:var(--bg);color:var(--text);padding:32px;line-height:1.5;}
  .wrap{max-width:900px;margin:0 auto;}
  .header{margin-bottom:24px;}
  .header .eyebrow{font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--blue);margin-bottom:6px;}
  .header h1{font-size:26px;margin-bottom:4px;}
  .header p{font-size:13px;color:var(--text-light);}
  .card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;box-shadow:0 1px 2px rgba(20,20,50,0.04);}
  .report-section{margin-bottom:22px;}
  .report-section:last-child{margin-bottom:0;}
  .report-section h4{font-size:14.5px;font-weight:700;margin-bottom:10px;color:var(--blue);}
  .report-table{width:100%;border-collapse:collapse;font-size:12.5px;}
  .report-table th, .report-table td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);}
  .report-table th{color:var(--text-light);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;}
  .corr-table{border-collapse:separate;border-spacing:4px;font-size:12px;}
  .corr-table th{font-weight:600;padding:6px 10px;color:var(--text-light);text-align:center;white-space:nowrap;}
  .corr-table td{padding:8px 12px;text-align:center;border-radius:8px;font-weight:700;min-width:48px;}
  .freq-bar-row{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:12.5px;}
  .freq-bar-track{flex:1;height:8px;background:var(--bg);border-radius:6px;overflow:hidden;}
  .freq-bar-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--blue),var(--purple));}
  .report-chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;}
  .report-chart{border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--bg);}
  .report-chart .cap{font-size:12px;font-weight:600;margin-bottom:8px;}
  .report-chart img{width:100%;border-radius:8px;background:#fff;}
  .footer{margin-top:20px;font-size:11px;color:var(--text-light);text-align:center;}
  @media print{ body{padding:0;background:#fff;} .card{border:none;box-shadow:none;} }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="eyebrow">STATIX Report</div>
    <h1>${STATE.fileName}</h1>
    <p>Generated ${generated} · self-contained snapshot, no data leaves this file</p>
  </div>
  <div class="card">${body}</div>
  <div class="footer">Generated by STATIX — Make Your Data Make Sense.</div>
</div>
</body>
</html>`;
}

function downloadReportHtml(){
  const html = generateStandaloneReportHTML();
  const blob = new Blob([html], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'statix_report_' + STATE.fileName.replace(/\.[^.]+$/,'') + '.html'; a.click();
  URL.revokeObjectURL(url);
  toast('Report downloaded', '⬇');
}

document.addEventListener('click', e=>{
  if(e.target.id==='btnExportCsv') exportCsv();
  if(e.target.id==='btnDownloadCleanTab'){ exportCsv(); toast('Cleaned dataset downloaded', '⬇'); }
  if(e.target.id==='btnPrintReport') window.print();
  if(e.target.id==='btnDownloadReport') downloadReportHtml();
});

/* ============================================================
   PROJECTS
   ============================================================ */
function downloadProject(p){
  const blob = new Blob([JSON.stringify(p)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'statix_project_' + p.fileName.replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]+/gi,'_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}
function renderProjects(){
  const list = document.getElementById('projectsList');
  if(STATE.savedProjects.length===0){
    list.innerHTML = `<div class="card" style="text-align:center;color:var(--text-light);">No saved projects yet. Open a dataset, then click "💾 Save as Project" in the top bar.</div>`;
    return;
  }
  list.innerHTML = STATE.savedProjects.map((p,i)=>`
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div><div style="font-weight:700;">${p.fileName}</div><div style="font-size:12.5px;color:var(--text-light);">${p.rowCount} rows × ${p.colCount} cols · saved ${new Date(p.savedAt).toLocaleString()}</div></div>
      <div style="display:flex;gap:8px;">
        <button class="mini-btn" data-load="${i}">Load</button>
        <button class="mini-btn" data-download="${i}">⬇ Download</button>
        <button class="mini-btn danger" data-del="${i}">Delete</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-load]').forEach(b=>b.addEventListener('click', ()=>{
    const p = STATE.savedProjects[parseInt(b.dataset.load)];
    STATE.fileName = p.fileName; STATE.rawData = JSON.parse(JSON.stringify(p.rawData));
    STATE.cleaningHistory = []; detectColumns();
    enterApp();
  }));
  list.querySelectorAll('[data-download]').forEach(b=>b.addEventListener('click', ()=>{
    downloadProject(STATE.savedProjects[parseInt(b.dataset.download)]);
  }));
  list.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
    STATE.savedProjects.splice(parseInt(b.dataset.del),1);
    sessionStorage.setItem('statix_projects', JSON.stringify(STATE.savedProjects));
    renderProjects();
  }));
}
on('btnSaveProject', 'click', ()=>{
  if(!STATE.rawData.length){ toast('Analyze a dataset first', '!'); return; }
  const project = { fileName: STATE.fileName, rawData: STATE.rawData, rowCount: STATE.rawData.length, colCount: STATE.columns.length, savedAt: Date.now() };
  STATE.savedProjects.push(project);
  sessionStorage.setItem('statix_projects', JSON.stringify(STATE.savedProjects));
  downloadProject(project);
  toast('Project saved & downloaded', '✓');
  renderProjects();
});
on('btnImportProject', 'click', ()=>document.getElementById('importProjectInput').click());
on('importProjectInput', 'change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const p = JSON.parse(reader.result);
      if(!p || !Array.isArray(p.rawData)) throw new Error('bad format');
      p.savedAt = p.savedAt || Date.now();
      STATE.savedProjects.push(p);
      sessionStorage.setItem('statix_projects', JSON.stringify(STATE.savedProjects));
      toast('Project imported', '✓');
      renderProjects();
    }catch(err){
      toast('Could not read that project file', '!');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ============================================================
   UPLOAD WIRING
   ============================================================ */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
if(!dropZone) console.warn('STATIX: element #dropZone not found');
if(!fileInput) console.warn('STATIX: element #fileInput not found');
if(dropZone && fileInput) dropZone.addEventListener('click', ()=>fileInput.click());
on('btnUploadHero', 'click', ()=>fileInput && fileInput.click());
on('btnNewUpload', 'click', ()=>{ goHome(); setTimeout(()=>fileInput.click(),100); });
on('btnOpenPalette', 'click', openPalette);
on('btnSample', 'click', loadSample);
on('btnConnectDB', 'click', ()=>{ openDbModal(); setDbTab('native'); });
on('btnCloseDbModal', 'click', closeDbModal);
on('btnCancelDb', 'click', closeDbModal);
on('btnSubmitDb', 'click', connectDatabase);
on('dbModalOverlay', 'click', e=>{ if(e.target.id==='dbModalOverlay') closeDbModal(); });
on('dbUrl', 'keydown', e=>{ if(e.key==='Enter') connectDatabase(); });
on('dbTabNative', 'click', ()=>setDbTab('native'));
on('dbTabApi', 'click', ()=>setDbTab('api'));
on('dbType', 'change', applyDbPortDefault);
on('dbConnectorHelp', 'click', e=>{
  e.preventDefault();
  alert('The STATIX Connector is a small local program that lets STATIX pull data using the real MySQL/PostgreSQL/Oracle driver — the same way MySQL Workbench or pgAdmin connect. It runs on your own machine, not in the browser.\\n\\nSetup:\\n1. pip install -r requirements.txt\\n2. python main.py\\n\\nIt starts at http://localhost:8420 and only talks to your browser session — your credentials never leave your machine.');
});
if(fileInput) fileInput.addEventListener('change', e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });
const secondaryFileInput = document.getElementById('secondaryFileInput');
if(secondaryFileInput) secondaryFileInput.addEventListener('change', e=>{ if(e.target.files[0]) handleSecondaryFile(e.target.files[0]); e.target.value=''; });
if(dropZone){
  ['dragover','dragenter'].forEach(ev=>dropZone.addEventListener(ev, e=>{ e.preventDefault(); dropZone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev, e=>{ e.preventDefault(); dropZone.classList.remove('drag'); }));
  dropZone.addEventListener('drop', e=>{ if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
}
window.addEventListener('resize', ()=>{ if(document.getElementById('app').style.display==='block') positionSideIndicator(); });

/* ============================================================
   STATIX — Launch Gate
   Self-contained, dependency-free. Injects its own overlay,
   styles, countdown, and rotating quotes. Drop this <script>
   tag in anywhere and it just works.
   ============================================================ */
(function(){
  'use strict';

  /* ---- Launch moment, fixed to IST (UTC+5:30) for every visitor ---- */
  // Aug 15, 2026, 12:00 AM IST = Aug 14, 2026, 18:30 UTC
  const LAUNCH_DATE = new Date(Date.UTC(2026, 7, 14, 18, 30, 0));
  const LAUNCH_LABEL = 'August 15, 2026';

  /* ---- Developer bypass ----
     Visit the site once with ?devkey=YOUR_CODE in the URL to unlock
     testing access on this browser. It's remembered after that, so
     you don't need to keep adding the query param.
     Visit with ?devkey=exit to turn bypass off again (to test the
     gate itself as a normal visitor would see it).
     NOTE: this is a client-side convenience, not real security —
     anyone who reads this file can find the code. For a real lock
     before launch, pair this with server/host-level password
     protection (e.g. Netlify's Visitor Access feature). */
  const DEV_ACCESS_CODE = 'PAVAN-STATIX-2026'; // change this to your own secret
  const DEV_STORAGE_KEY = 'sxlg_dev_unlocked';

  function checkDevBypass(){
    const params = new URLSearchParams(window.location.search);
    const key = params.get('devkey');
    if(key === DEV_ACCESS_CODE){
      localStorage.setItem(DEV_STORAGE_KEY, '1');
      return true;
    }
    if(key === 'exit'){
      localStorage.removeItem(DEV_STORAGE_KEY);
      return false;
    }
    return localStorage.getItem(DEV_STORAGE_KEY) === '1';
  }

  function showDevBadge(){
    const badge = document.createElement('div');
    badge.textContent = '👨‍💻 Developer Mode — gate bypassed';
    badge.style.cssText = `
      position:fixed; bottom:14px; right:14px; z-index:999999;
      background:#FFF3DC; color:#8A5A0A; font-family:'Inter',sans-serif;
      font-size:12px; font-weight:600; padding:8px 14px; border-radius:10px;
      border:1px solid #FADD9E; box-shadow:0 1px 2px rgba(20,20,50,0.04), 0 10px 26px -12px rgba(40,40,90,0.10);
    `;
    document.body.appendChild(badge);
  }

  const QUOTES = [
    "Data doesn't lie, but it also doesn't explain itself — that takes patience.",
    "Every dataset holds a story; analytics is simply learning to read it.",
    "The best decisions are the ones data was allowed to influence.",
    "In a world full of opinions, be the one with a dashboard.",
    "A single number rarely tells the truth — context always does.",
    "Analytics turns raw numbers into rational next steps.",
    "The goal isn't more data. The goal is better questions.",
    "Correlation invites curiosity. Causation demands proof.",
    "Clean data is a gift you give your future self.",
    "Visualization is empathy for numbers — it helps others feel what you found.",
    "Data rarely speaks for itself — someone still has to translate it.",
    "Insight is data that has finally found its purpose.",
    "Every outlier is either an error or an opportunity. Find out which.",
    "Great analysts don't predict the future — they prepare for several of them.",
    "Numbers inform. Stories persuade. Great analytics does both.",
    "The pattern you almost ignored is usually the one worth chasing.",
    "A chart's job isn't to impress — it's to make the truth unmissable.",
    "Behind every trend line is a decision waiting to be made.",
    "Data quality is a habit, not a one-time cleanup.",
    "The real return on analytics is confidence, not just accuracy."
  ];

  const CSS = `
    #sxlg-overlay{
      position:fixed; inset:0; z-index:999999;
      display:flex; align-items:center; justify-content:center;
      font-family:'Inter', sans-serif; color:#161826;
      overflow:hidden; transition:opacity .6s ease, visibility .6s ease;
      background:
        radial-gradient(1000px 560px at 10% -10%, rgba(85,70,255,0.14) 0%, transparent 60%),
        radial-gradient(820px 520px at 100% 0%, rgba(20,200,180,0.14) 0%, transparent 55%),
        radial-gradient(760px 480px at 46% 108%, rgba(255,106,61,0.13) 0%, transparent 58%),
        #F5F6FC;
    }
    #sxlg-overlay.sxlg-closing{ opacity:0; pointer-events:none; }
    #sxlg-overlay::before{
      content:''; position:absolute; inset:0; z-index:0; pointer-events:none;
      background-image:radial-gradient(circle, rgba(22,24,38,0.08) 1.5px, transparent 1.5px);
      background-size:26px 26px;
      -webkit-mask-image:radial-gradient(ellipse 78% 68% at 50% 15%, #000 15%, transparent 78%);
      mask-image:radial-gradient(ellipse 78% 68% at 50% 15%, #000 15%, transparent 78%);
    }
    #sxlg-overlay::after{
      content:''; position:absolute; inset:-10%; z-index:0; pointer-events:none;
      background:
        radial-gradient(760px 440px at 14% 8%, rgba(85,70,255,0.10) 0%, transparent 60%),
        radial-gradient(680px 420px at 100% 10%, rgba(20,200,180,0.10) 0%, transparent 55%);
      animation:sxlg-drift 26s ease-in-out infinite alternate;
    }
    @keyframes sxlg-drift{ 0%{ transform:translate(0,0) scale(1);} 100%{ transform:translate(-2.5%,2%) scale(1.06);} }

    .sxlg-card{
      position:relative; z-index:2; text-align:center;
      max-width:560px; width:92%; padding:48px 40px;
      background:#FFFFFF; border:1px solid #E7E9F4; border-radius:22px;
      box-shadow:0 20px 48px -18px rgba(40,40,90,0.20);
      animation:sxlg-rise .7s cubic-bezier(.2,.8,.2,1);
    }
    @keyframes sxlg-rise{ from{ opacity:0; transform:translateY(24px);} to{ opacity:1; transform:translateY(0);} }

    .sxlg-logo{ display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:20px; }
    .sxlg-logo span{
      font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:20px; letter-spacing:0.5px;
      background:linear-gradient(100deg,#5546FF,#FF6A3D 55%,#14C8B4);
      -webkit-background-clip:text; background-clip:text; color:transparent;
    }

    .sxlg-eyebrow{
      position:relative; display:inline-block;
      font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
      color:#5546FF; background:#EEEBFF; padding:7px 16px 7px 26px; border-radius:20px;
      margin-bottom:22px; border:1px solid rgba(85,70,255,0.18);
    }
    .sxlg-eyebrow::before{
      content:''; position:absolute; left:12px; top:50%; width:7px; height:7px; margin-top:-3.5px; border-radius:50%;
      background:#14C8B4; box-shadow:0 0 0 3px rgba(20,200,180,0.25); animation:sxlg-pulseDot 2s ease-in-out infinite;
    }
    @keyframes sxlg-pulseDot{ 0%,100%{ box-shadow:0 0 0 3px rgba(20,200,180,0.25);} 50%{ box-shadow:0 0 0 6px rgba(20,200,180,0.10);} }

    .sxlg-title{
      font-family:'Space Grotesk',sans-serif; font-size:clamp(26px,4vw,34px); font-weight:700;
      line-height:1.25; margin:0 0 14px; letter-spacing:-0.5px;
      background:linear-gradient(112deg,#5546FF 8%, #FF3D9A 45%, #FF6A3D 72%, #FFB020 100%);
      -webkit-background-clip:text; background-clip:text; color:transparent; background-size:160% 100%;
    }
    .sxlg-msg{ font-size:14.5px; color:#6C7086; line-height:1.6; margin:0 0 28px; }
    .sxlg-msg strong{ color:#5546FF; font-weight:700; }

    .sxlg-countdown{ display:flex; justify-content:center; gap:10px; margin-bottom:30px; flex-wrap:wrap; }
    .sxlg-cd-box{
      background:#F5F6FC; border:1px solid #E7E9F4; border-radius:14px; padding:12px 16px; min-width:64px;
    }
    .sxlg-cd-box span{
      display:block; font-family:'JetBrains Mono',monospace; font-size:24px; font-weight:700; color:#5546FF;
    }
    .sxlg-cd-box label{ display:block; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#6C7086; margin-top:4px; }
    .sxlg-cd-sep{ font-size:22px; color:#D2D6E8; align-self:center; font-family:'JetBrains Mono',monospace; }

    .sxlg-btn{
      font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:600;
      padding:15px 34px; border-radius:13px; border:1.5px solid #E7E9F4; cursor:not-allowed;
      background:#FFFFFF; color:#A6ABC2; letter-spacing:0.3px;
      transition:all .3s ease; width:100%; max-width:320px;
    }
    .sxlg-btn.sxlg-unlocked{
      cursor:pointer; color:#fff; border:1px solid rgba(255,255,255,0.25); position:relative; overflow:hidden;
      background:linear-gradient(100deg,#5546FF,#FF3D9A 100%);
      box-shadow:0 0 0 1px rgba(85,70,255,0.10), 0 18px 38px -14px rgba(85,70,255,0.30);
      animation:sxlg-pulse 1.8s ease-in-out infinite;
    }
    .sxlg-btn.sxlg-unlocked:hover{ transform:translateY(-1px); box-shadow:0 22px 46px -14px rgba(85,70,255,0.45), 0 0 0 1px rgba(85,70,255,0.12); }
    .sxlg-btn.sxlg-unlocked::after{
      content:''; position:absolute; top:0; left:-75%; width:45%; height:100%;
      background:linear-gradient(120deg,transparent,rgba(255,255,255,0.45),transparent); transform:skewX(-20deg);
      transition:left .55s ease;
    }
    .sxlg-btn.sxlg-unlocked:hover::after{ left:130%; }
    @keyframes sxlg-pulse{
      0%,100%{ box-shadow:0 0 0 1px rgba(85,70,255,0.10), 0 18px 38px -14px rgba(85,70,255,0.30);}
      50%{ box-shadow:0 0 0 1px rgba(85,70,255,0.14), 0 18px 46px -10px rgba(85,70,255,0.42);}
    }

    .sxlg-quote-wrap{ margin-top:32px; padding-top:22px; border-top:1px solid #E7E9F4; min-height:54px; }
    .sxlg-quote{
      font-size:13.5px; font-style:italic; color:#6C7086; line-height:1.6; margin:0;
      transition:opacity .4s ease, transform .4s ease;
    }
    .sxlg-quote.sxlg-fade-out{ opacity:0; transform:translateY(6px); }

    @media (max-width:480px){
      .sxlg-card{ padding:36px 22px; }
      .sxlg-cd-box{ min-width:52px; padding:10px 10px; }
      .sxlg-cd-box span{ font-size:19px; }
    }
  `;

  function injectStyles(){
    const style = document.createElement('style');
    style.id = 'sxlg-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function buildMarkup(){
    const wrap = document.createElement('div');
    wrap.id = 'sxlg-overlay';
    wrap.innerHTML = `
      <div class="sxlg-card">
        <div class="sxlg-logo">
          <svg width="26" height="26" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="sxlgGrad" x1="0" y1="40" x2="40" y2="0">
              <stop offset="0" stop-color="#5546FF"/><stop offset="0.55" stop-color="#FF6A3D"/><stop offset="1" stop-color="#14C8B4"/>
            </linearGradient></defs>
            <rect x="4" y="22" width="6" height="14" rx="2" fill="url(#sxlgGrad)"/>
            <rect x="14" y="14" width="6" height="22" rx="2" fill="url(#sxlgGrad)" opacity="0.85"/>
            <rect x="24" y="6" width="6" height="30" rx="2" fill="url(#sxlgGrad)" opacity="0.7"/>
            <circle cx="33" cy="8" r="4" fill="url(#sxlgGrad)"/>
          </svg>
          <span>STATIX</span>
        </div>
        <div class="sxlg-eyebrow">Coming Soon</div>
        <h1 class="sxlg-title">Something powerful is almost here.</h1>
        <p class="sxlg-msg" id="sxlg-msg">This website will be launched on <strong>${LAUNCH_LABEL}</strong></p>
        <div class="sxlg-countdown" id="sxlg-countdown">
          <div class="sxlg-cd-box"><span id="sxlg-days">00</span><label>Days</label></div>
          <div class="sxlg-cd-sep">:</div>
          <div class="sxlg-cd-box"><span id="sxlg-hours">00</span><label>Hours</label></div>
          <div class="sxlg-cd-sep">:</div>
          <div class="sxlg-cd-box"><span id="sxlg-mins">00</span><label>Minutes</label></div>
          <div class="sxlg-cd-sep">:</div>
          <div class="sxlg-cd-box"><span id="sxlg-secs">00</span><label>Seconds</label></div>
        </div>
        <button id="sxlg-btn" class="sxlg-btn" disabled>🔒 Launch Locked</button>
        <div class="sxlg-quote-wrap"><p id="sxlg-quote" class="sxlg-quote">${QUOTES[0]}</p></div>
      </div>
    `;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
  }

  function pad(n){ return String(n).padStart(2, '0'); }

  function unlock(){
    const btn = document.getElementById('sxlg-btn');
    const msg = document.getElementById('sxlg-msg');
    btn.disabled = false;
    btn.textContent = '🚀 Launch STATIX';
    btn.classList.add('sxlg-unlocked');
    msg.innerHTML = 'STATIX is ready. Click below to enter.';
  }

  function startCountdown(){
    let timer = null;

    function tick(){
      const diff = LAUNCH_DATE - new Date();
      if(diff <= 0){
        if(timer) clearInterval(timer);
        ['sxlg-days','sxlg-hours','sxlg-mins','sxlg-secs'].forEach(id=>{
          document.getElementById(id).textContent = '00';
        });
        unlock();
        return;
      }
      const days  = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins  = Math.floor((diff % 3600000) / 60000);
      const secs  = Math.floor((diff % 60000) / 1000);
      document.getElementById('sxlg-days').textContent  = pad(days);
      document.getElementById('sxlg-hours').textContent = pad(hours);
      document.getElementById('sxlg-mins').textContent  = pad(mins);
      document.getElementById('sxlg-secs').textContent  = pad(secs);
    }

    tick();
    if(LAUNCH_DATE - new Date() > 0){
      timer = setInterval(tick, 1000);
    }
  }

  function startQuotes(){
    const el = document.getElementById('sxlg-quote');
    let idx = 0;
    setInterval(()=>{
      idx = (idx + 1) % QUOTES.length;
      el.classList.add('sxlg-fade-out');
      setTimeout(()=>{
        el.textContent = QUOTES[idx];
        el.classList.remove('sxlg-fade-out');
      }, 400);
    }, 15000);
  }

  function wireButton(){
    document.getElementById('sxlg-btn').addEventListener('click', function(){
      if(this.disabled) return;
      const overlay = document.getElementById('sxlg-overlay');
      overlay.classList.add('sxlg-closing');
      document.body.style.overflow = '';
      setTimeout(()=> overlay.remove(), 650);
    });
  }

  function init(){
    if(checkDevBypass()){
      showDevBadge();
      return;
    }
    injectStyles();
    buildMarkup();
    startCountdown();
    startQuotes();
    wireButton();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

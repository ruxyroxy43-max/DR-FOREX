/* SPA with optional server-backed API (falls back to localStorage) */
(function(){
  const STORAGE_KEY = 'trade_journal_trades_v1';
  let trades = [];
  let editId = null;
  let useServer = false;

  // DOM refs
  const navDashboard = document.getElementById('nav-dashboard');
  const navJournal = document.getElementById('nav-journal');
  const views = document.querySelectorAll('.view');
  const tableBody = document.querySelector('#trade-table tbody');
  const menuToggle = document.querySelector('.menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const sidebarBackdrop = document.querySelector('.sidebar-backdrop');
  const sidebarClose = document.querySelector('.sidebar-close');
  const allTradesWrap = document.getElementById('all-trades');
  const calendarEl = document.getElementById('calendar');
  const panelNarrative = document.getElementById('panel-narrative');
  const panelEmotionBefore = document.getElementById('panel-emotion-before');
  const panelEmotionAfter = document.getElementById('panel-emotion-after');
  const panelMistakes = document.getElementById('panel-mistakes');
  const panelLesson = document.getElementById('panel-lesson');

  // Display mode management
  let displayMode = 'dollar';
  const dropdownBtn = document.querySelector('.dropdown-btn');
  const dropdownMenu = document.querySelector('.dropdown-menu');
  const modeButtons = document.querySelectorAll('.dropdown-menu button');

  function $(s){return document.querySelector(s)}

  // navigation
  navDashboard.addEventListener('click', ()=>showView('dashboard'));
  navJournal.addEventListener('click', ()=>showView('journal'));
  function closeSidebar(){
    if(sidebar) sidebar.classList.remove('open');
    if(sidebarBackdrop) sidebarBackdrop.classList.remove('show');
    document.body.classList.remove('sidebar-open');
  }
  function openSidebar(){
    if(sidebar) sidebar.classList.add('open');
    if(sidebarBackdrop) sidebarBackdrop.classList.add('show');
    document.body.classList.add('sidebar-open');
  }
  function showView(id){
    views.forEach(v=>v.id===id?v.classList.remove('hidden'):v.classList.add('hidden'));
    document.querySelectorAll('.sidebar nav button').forEach(b=>b.classList.remove('active'));
    const btn = document.getElementById('nav-'+id);
    if(btn) btn.classList.add('active');
    closeSidebar();
  }
  if(menuToggle){menuToggle.addEventListener('click', ()=>{
    if(window.innerWidth > 760){
      sidebar?.classList.toggle('sidebar-collapsed');
      return;
    }
    if(sidebar?.classList.contains('open')) closeSidebar(); else openSidebar();
  });}
  if(sidebarClose){sidebarClose.addEventListener('click', closeSidebar);}
  if(sidebarBackdrop){sidebarBackdrop.addEventListener('click', closeSidebar);}
  document.querySelectorAll('.sidebar nav button, .sidebar nav a').forEach(link=>link.addEventListener('click', closeSidebar));
  window.addEventListener('resize', ()=>{ if(window.innerWidth > 760) closeSidebar(); });

  // Dropdown mode toggle
  if(dropdownBtn){
    dropdownBtn.addEventListener('click', ()=>dropdownMenu.classList.toggle('show'));
  }
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.display-mode-dropdown')) dropdownMenu?.classList.remove('show');
  });
  modeButtons.forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      displayMode = e.target.dataset.mode;
      dropdownBtn.textContent = displayMode==='dollar'?'$ Dollar':'% Percentage';
      modeButtons.forEach(b=>b.classList.remove('active'));
      e.target.classList.add('active');
      dropdownMenu.classList.remove('show');
      refreshAll();
    });
  });
  if(modeButtons.length>0) modeButtons[0].classList.add('active');

  // detect server
  async function detectServer(){
    try{
      const controller = new AbortController();
      const id = setTimeout(()=>controller.abort(), 800);
      const res = await fetch('/api/trades',{method:'GET',signal:controller.signal});
      clearTimeout(id);
      if(res.ok){ useServer = true; return true }
    }catch(e){}
    useServer = false; return false;
  }

  // storage helpers
  async function load(){
    if(useServer){
      try{const res=await fetch('/api/trades');trades=await res.json();return}catch(e){useServer=false}}
    try{trades = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');}catch(e){trades=[]}
  }
  async function save(){
    if(useServer){
      // sync all trades by upserting individually (simple approach)
      for(const t of trades){
        try{
          const exists = await fetch(`/api/trades`).then(r=>r.json()).then(list=>list.some(x=>x.id===t.id));
          if(exists){await fetch(`/api/trades/${t.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)});} else {await fetch('/api/trades',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)});}          
        }catch(e){console.warn('sync failed',e);}
      }
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  }

  // render cards
  function renderStats(){
    const net = trades.reduce((s,t)=>s+(Number(t.pnl)||0),0);
    const wins = trades.filter(t=>Number(t.pnl)>0).length;
    const total = trades.length;
    const winRate = total?Math.round((wins/total)*100):0;
    const profitFactor = computeProfitFactor();
    
    // Format based on display mode
    let netDisplay, profitFactorDisplay;
    if(displayMode==='percentage'){
      // Always show percentage when in percentage mode
      const costBasis = trades.reduce((s,t)=>s+(Math.abs(Number(t.entryPrice)||0)),0);
      netDisplay = costBasis>0? ((net/costBasis)*100).toFixed(2)+'%': '0.00%';
      profitFactorDisplay = profitFactor.toFixed(2);
    } else {
      // Show dollar amount in dollar mode
      netDisplay = `$${net.toFixed(2)}`;
      profitFactorDisplay = profitFactor.toFixed(2);
    }
    
    $('#netpnl').textContent = netDisplay;
    $('#netpnl-sub').textContent = `${total} closed trades`;
    $('#winrate').textContent = `${winRate}%`;
    $('#profitfactor').textContent = profitFactorDisplay;
    $('#totaltrades').textContent = `${total}`;
    $('#avgwl').textContent = computeAvgWL();
    $('#daywin').textContent = computeDayWinRate() + '%';
    $('#avgrr').textContent = computeAvgRR();
    // update donut gauge
    const donut = document.getElementById('win-donut');
    if(donut){
      const angle = (winRate/100)*360;
      donut.style.background = `conic-gradient(#10b981 0deg ${angle}deg, #111827 ${angle}deg 360deg)`;
    }
  }

  function computeAvgWL(){
    // naive: average absolute win / average absolute loss
    const wins = trades.filter(t=>t.pnl>0).map(t=>Math.abs(Number(t.pnl)||0));
    const losses = trades.filter(t=>t.pnl<0).map(t=>Math.abs(Number(t.pnl)||0));
    const avgW = wins.length? (wins.reduce((s,v)=>s+v,0)/wins.length):0;
    const avgL = losses.length? (losses.reduce((s,v)=>s+v,0)/losses.length):0;
    if(avgL===0) return '—';
    return `${(avgW/avgL).toFixed(2)}:1`;
  }

  function computeDayWinRate(){
    // count unique days with positive pnl vs total days with trades
    const dayMap = {};
    trades.forEach(t=>{const d=(new Date(t.entryDate)).toDateString();dayMap[d]=(dayMap[d]||0)+(Number(t.pnl)||0)});
    const days = Object.keys(dayMap);
    if(!days.length) return 0;
    const winDays = days.filter(d=>dayMap[d]>0).length;
    return Math.round((winDays/days.length)*100);
  }

  function computeAvgRR(){
    return '1:2';
  }
  function computeProfitFactor(){
    const grossProfit = trades.filter(t=>t.pnl>0).reduce((s,t)=>s+Number(t.pnl),0);
    const grossLoss = Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+Number(t.pnl),0));
    if(grossLoss===0) return grossProfit?999:0;
    return grossProfit/grossLoss;
  }

  // render table
  function renderTable(){
    tableBody.innerHTML='';
    const recent = trades.slice().sort((a,b)=>new Date(b.entryDate)-new Date(a.entryDate)).slice(0,20);
    recent.forEach(t=>{
      const tr = document.createElement('tr');
      tr.dataset.id = t.id;
      tr.innerHTML = `<td>${t.instrument}</td><td>${t.direction}</td><td>${t.entryPrice||''}</td><td>${t.exitPrice||''}</td><td>${t.pnl||''}</td><td>${(t.notes||'').slice(0,80)}</td><td><button data-id="${t.id}" class="del">Del</button></td>`;
      tableBody.appendChild(tr);
    });
    tableBody.querySelectorAll('.del').forEach(b=>b.addEventListener('click',e=>deleteTrade(e.target.dataset.id)));
    // row click to view notes
    tableBody.querySelectorAll('tr').forEach(r=>r.addEventListener('click',e=>{
      const id = r.dataset.id; if(!id) return; showTradeInPanel(id);
    }));
  }

  function renderAllTrades(){
    allTradesWrap.innerHTML='';
    const list = trades.slice().sort((a,b)=>new Date(b.entryDate)-new Date(a.entryDate));
    list.forEach(t=>{
      const el = document.createElement('div');
      el.className='trade-item';
      el.innerHTML = `<strong>${t.instrument}</strong> ${t.direction} • ${t.entryDate.split('T')[0]} • PnL: ${t.pnl||0}`;
      allTradesWrap.appendChild(el);
    });
  }

  function showTradeInPanel(id){
    const t = trades.find(x=>x.id===id); if(!t) return;
    panelNarrative.textContent = t.notes || '—';
    panelEmotionBefore.textContent = 'Calm';
    panelEmotionAfter.textContent = t.pnl>0 ? 'Satisfied' : 'Disappointed';
    panelMistakes.textContent = '—';
    panelLesson.textContent = (t.notes && t.notes.slice(0,140)) || 'No lesson recorded';
  }

  // calendar
  function renderCalendar(){
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const daySums = {};
    const dayCounts = {};
    trades.forEach(t=>{
      const d = new Date(t.entryDate);
      if(d.getMonth()===month && d.getFullYear()===year){
        const key = d.getDate();
        daySums[key] = (daySums[key]||0) + (Number(t.pnl)||0);
        dayCounts[key] = (dayCounts[key]||0) + 1;
      }
    });
    calendarEl.innerHTML='';
    // pad days
    for(let i=0;i<startDay;i++){const el=document.createElement('div');el.className='day';calendarEl.appendChild(el)}
    for(let d=1;d<=daysInMonth;d++){
      const el=document.createElement('div');el.className='day';
      const pnl = daySums[d]||0;
      const count = dayCounts[d]||0;
      if(pnl>0) el.classList.add('positive');
      else if(pnl<0) el.classList.add('negative');
      const pnlText = pnl? (pnl>0?'+':'')+pnl.toFixed(2):'';
      // highlight today
      const today = new Date();
      if(d===today.getDate() && today.getMonth()===month && today.getFullYear()===year) el.classList.add('today');
      // compose inner tile when there are trades
      if(count>0){
        el.innerHTML = `<div class="tile" data-day="${d}" data-pnl="${pnl}" data-count="${count}"><div class="amount">${pnl>=1000? ('$'+(pnl/1000).toFixed(1)+'K'): (pnl? '$'+pnl.toFixed(2): '$0')}</div><div class="count">${count} trade${count>1?'s':''}</div><div class="delta">${pnl? (pnl>0?'+':'')+pnl.toFixed(2):''}</div></div>`;
      } else {
        el.innerHTML = `<div class="date" style="color:var(--muted)">${d}</div>`;
      }
      calendarEl.appendChild(el);
    }
    renderWeeklySummaries(daySums,dayCounts,startDay,daysInMonth);

    // attach tooltip handlers
    attachCalendarTooltips();
  }

  function attachCalendarTooltips(){
    let tooltip = document.querySelector('.tooltip');
    if(!tooltip){ tooltip = document.createElement('div'); tooltip.className='tooltip'; document.body.appendChild(tooltip);}    
    document.querySelectorAll('.calendar .tile').forEach(tile=>{
      tile.addEventListener('mouseenter', e=>{
        const day = tile.dataset.day; const pnl = tile.dataset.pnl; const count = tile.dataset.count;
        tooltip.innerHTML = `<strong>${day}</strong><div>${count} trade${count>1?'s':''}</div><div style="color:${pnl>=0? '#34d399':'#f87171'}">${pnl>=0?'+':''}${Number(pnl).toFixed(2)}</div>`;
        tooltip.style.display='block';
      });
      tile.addEventListener('mousemove', e=>{ tooltip.style.left = (e.pageX+12)+'px'; tooltip.style.top = (e.pageY+12)+'px'; });
      tile.addEventListener('mouseleave', e=>{ tooltip.style.display='none'; });
      tile.addEventListener('click', e=>{ const day = tile.dataset.day; showDrilldownForDay(Number(day)); });
    });
  }

  function showDrilldownForDay(day){
    // show list of trades for the clicked day in right panel
    const list = trades.filter(t=>{ const d = new Date(t.entryDate); return d.getDate()===day; });
    const panel = document.querySelector('.panel-card');
    if(!panel) return;
    let html = `<h3>Trades on ${day}</h3>`;
    if(!list.length) html += '<div>No trades</div>';
    list.forEach(t=>{ html += `<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,0.02)"><strong>${t.instrument}</strong> ${t.direction} • PnL: ${t.pnl||0}<div style="font-size:12px;color:#9ca3af">${t.notes||''}</div></div>`});
    panel.innerHTML = html;
  }

  function renderWeeklySummaries(daySums,dayCounts,startDay,daysInMonth){
    const weeks = [];
    let week = 0; let weekTotal=0; let dayIndex=1-startDay;
    while(dayIndex<=daysInMonth){
      weekTotal = 0;
      for(let i=0;i<7;i++){
        const d = dayIndex + i;
        if(d>=1 && d<=daysInMonth) weekTotal += (daySums[d]||0);
      }
      weeks.push(weekTotal);
      dayIndex+=7; week++;
    }
    const container = document.getElementById('weekly-summaries');
    container.innerHTML='';
    weeks.forEach((w,i)=>{
      const el = document.createElement('div');el.className='week';el.innerHTML = `<div>Week ${i+1}</div><div style="font-size:14px;margin-top:6px;color:${w>=0? '#34d399':'#f87171'}">${w? (w>0?'+':'')+w.toFixed(2):'$0'}</div>`;container.appendChild(el);
    });
    // month total
    const monthTotal = Object.values(daySums).reduce((s,v)=>s+v,0);
    const monthEl = document.getElementById('month-pnl'); if(monthEl) monthEl.textContent = `$${monthTotal.toFixed(2)}`;
  }

  // create id
  function nextId(){return 't_'+Date.now()+Math.floor(Math.random()*999)}

  // Add/edit form removed; keep delete behavior
  async function deleteTrade(id){
    if(!confirm('Delete trade?')) return;
    trades = trades.filter(t=>t.id!==id);
    if(useServer){
      try{ await fetch(`/api/trades/${id}`,{method:'DELETE'}); }catch(e){}
    }
    await save(); await load(); refreshAll();
  }

  // exports
  $('#btn-export-csv').addEventListener('click', exportCSV);
  $('#btn-export-pdf').addEventListener('click', exportPDF);
  function exportCSV(){
    const rows = [['id','instrument','direction','entryPrice','exitPrice','pnl','entryDate','exitDate','notes']];
    trades.forEach(t=>rows.push([t.id,t.instrument,t.direction,t.entryPrice,t.exitPrice,t.pnl,t.entryDate,t.exitDate,`"${(t.notes||'').replace(/"/g,'""')}"`]))
    const csv = rows.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const url = URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='trades.csv';a.click();URL.revokeObjectURL(url);
  }
  function exportPDF(){
    const { jsPDF } = window.jspdf || window.jsPDF||{};
    if(!jsPDF){alert('PDF export requires jsPDF (loaded from CDN)');return}
    const doc = new jsPDF({unit:'pt',format:'a4'});
    const margin = 40; let y = 60;
    doc.setFontSize(18);doc.text('Trade Journal',margin,y); y+=24;
    doc.setFontSize(10);
    const rows = trades.slice().sort((a,b)=>new Date(b.entryDate)-new Date(a.entryDate));
    // header
    doc.setFontSize(11); doc.text('Date',margin,y); doc.text('Instrument',margin+80,y); doc.text('Dir',margin+220,y); doc.text('Entry',margin+260,y); doc.text('Exit',margin+320,y); doc.text('PnL',margin+380,y);
    y+=14;
    rows.forEach((t,idx)=>{
      if(y>750){doc.addPage();y=60}
      const date = (t.entryDate||'').split('T')[0];
      doc.setFontSize(10);
      doc.text(date,margin,y);
      doc.text(String(t.instrument||''),margin+80,y);
      doc.text(String(t.direction||''),margin+220,y);
      doc.text(String(t.entryPrice||''),margin+260,y);
      doc.text(String(t.exitPrice||''),margin+320,y);
      doc.text(String(t.pnl||''),margin+380,y);
      y+=14;
    });
    doc.save('trades.pdf');
  }

  function refreshAll(){renderStats();renderTable();renderAllTrades();renderCalendar()}

  // init
  async function init(){
    // ensure nothing is focused on init
    try{ if(document.activeElement) document.activeElement.blur(); }catch(e){}
    await detectServer();
    await load();
    refreshAll();
  }
  init();
})();

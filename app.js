/* SPA with optional server-backed API (falls back to localStorage) */
(function(){
  const STORAGE_KEY = 'trade_journal_trades_v1';
  const SESSION_KEY = 'ruxy_session_v1';
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  const currentUserId = session ? session.id : null;
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
  const monthPicker = document.getElementById('month-picker');
  const yearPicker = document.getElementById('year-picker');
  const calendarMonthLabel = document.getElementById('calendar-month-label');
  const panelNarrative = document.getElementById('panel-narrative');
  const panelEmotionBefore = document.getElementById('panel-emotion-before');
  const panelEmotionAfter = document.getElementById('panel-emotion-after');
  const panelMistakes = document.getElementById('panel-mistakes');
  const panelLesson = document.getElementById('panel-lesson');
  const tradeDrawer = document.getElementById('trade-drawer');
  const tradeDrawerBackdrop = document.getElementById('trade-drawer-backdrop');

  // Display mode management
  let displayMode = 'dollar';
  const dropdownBtn = document.querySelector('.dropdown-btn');
  const dropdownMenu = document.querySelector('.dropdown-menu');
  const modeButtons = document.querySelectorAll('.dropdown-menu button');

  // Image modal
  const imageModal = document.getElementById('image-modal');
  const modalImg = document.getElementById('modal-img');
  const modalClose = document.getElementById('modal-close');
  const modalPrev = document.getElementById('modal-prev');
  const modalNext = document.getElementById('modal-next');
  const modalCounter = document.getElementById('modal-counter');
  let currentModalImages = [];
  let currentModalIndex = 0;

  function openImageModal(imageSrc, allImages, index) {
    currentModalImages = allImages;
    currentModalIndex = index;
    modalImg.src = imageSrc;
    modalCounter.textContent = `${index + 1} / ${allImages.length}`;
    imageModal.style.display = 'flex';
  }

  function closeImageModal() {
    imageModal.style.display = 'none';
    currentModalImages = [];
    currentModalIndex = 0;
  }

  modalClose.addEventListener('click', closeImageModal);
  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) closeImageModal();
  });

  modalNext.addEventListener('click', () => {
    if (currentModalImages.length === 0) return;
    currentModalIndex = (currentModalIndex + 1) % currentModalImages.length;
    modalImg.src = currentModalImages[currentModalIndex];
    modalCounter.textContent = `${currentModalIndex + 1} / ${currentModalImages.length}`;
  });

  modalPrev.addEventListener('click', () => {
    if (currentModalImages.length === 0) return;
    currentModalIndex = (currentModalIndex - 1 + currentModalImages.length) % currentModalImages.length;
    modalImg.src = currentModalImages[currentModalIndex];
    modalCounter.textContent = `${currentModalIndex + 1} / ${currentModalImages.length}`;
  });

  document.addEventListener('keydown', (e) => {
    if (imageModal.style.display === 'flex') {
      if (e.key === 'ArrowRight') modalNext.click();
      if (e.key === 'ArrowLeft') modalPrev.click();
      if (e.key === 'Escape') closeImageModal();
    }
  });

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
    menuToggle.classList.toggle('active');
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

  let currentCalendarDate = new Date();

  function populateCalendarSelectors(){
    if(!monthPicker || !yearPicker) return;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    monthPicker.innerHTML = monthNames.map((name, index) => `<option value="${index}">${name}</option>`).join('');
    monthPicker.value = String(currentCalendarDate.getMonth());

    const currentYear = currentCalendarDate.getFullYear();
    const years = Array.from({length: 7}, (_, i) => currentYear - 3 + i);
    yearPicker.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
    yearPicker.value = String(currentYear);
  }

  function updateCalendarHeader(){
    if(calendarMonthLabel){
      calendarMonthLabel.textContent = new Intl.DateTimeFormat('en-US',{month:'long', year:'numeric'}).format(new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), 1));
    }
    if(monthPicker) monthPicker.value = String(currentCalendarDate.getMonth());
    if(yearPicker) yearPicker.value = String(currentCalendarDate.getFullYear());
  }

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

  function normalizeScreenshots(trade){
    let screenshots = [];
    if(Array.isArray(trade.screenshots)) screenshots = trade.screenshots.filter(Boolean);
    else if(Array.isArray(trade.screenshot)) screenshots = trade.screenshot.filter(Boolean);
    else if(typeof trade.screenshot === 'string'){
      try{
        const parsed = JSON.parse(trade.screenshot);
        if(Array.isArray(parsed)) screenshots = parsed.filter(Boolean);
        else if(trade.screenshot.startsWith('data:')) screenshots = [trade.screenshot];
      }catch(e){
        if(trade.screenshot.startsWith('data:')) screenshots = [trade.screenshot];
      }
    }

    screenshots = screenshots.slice(0, 8);
    trade.screenshots = screenshots;
    trade.screenshot = screenshots[0] || '';
    return trade;
  }

  // storage helpers
  async function load(){
    if(useServer){
      try{
        const res = await fetch('/api/trades');
        trades = await res.json();
        trades = trades.filter(t => !currentUserId || !t.userId || t.userId === currentUserId).map(normalizeScreenshots);
        return;
      }catch(e){useServer=false}
    }
    try{trades = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');}catch(e){trades=[]}
    trades = trades.filter(t => !currentUserId || !t.userId || t.userId === currentUserId).map(normalizeScreenshots);
  }
  async function save(){
    const payload = trades.map(trade => {
      const normalized = normalizeScreenshots({ ...trade });
      normalized.screenshot = normalized.screenshots.length ? JSON.stringify(normalized.screenshots) : null;
      return normalized;
    });

    if(useServer){
      for(const t of payload){
        try{
          const exists = await fetch(`/api/trades`).then(r=>r.json()).then(list=>list.some(x=>x.id===t.id));
          if(exists){await fetch(`/api/trades/${t.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)});} else {await fetch('/api/trades',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)});}          
        }catch(e){console.warn('sync failed',e);}
      }
      return;
    }
    const userScoped = payload.map(t => ({ ...t, userId: t.userId || currentUserId }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userScoped));
  }

  function formatModeValue(value, costBasis){
    if(displayMode === 'percentage'){
      return costBasis > 0 ? `${((value / costBasis) * 100).toFixed(2)}%` : '0.00%';
    }
    return value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
  }

  function getTradesForSelectedMonth(){
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    return trades.filter(t => {
      const d = new Date(t.entryDate);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }

  // render cards
  function renderStats(){
    const monthTrades = getTradesForSelectedMonth();
    const net = monthTrades.reduce((s,t)=>s+(Number(t.pnl)||0),0);
    const wins = monthTrades.filter(t=>Number(t.pnl)>0).length;
    const total = monthTrades.length;
    const winRate = total?Math.round((wins/total)*100):0;
    const profitFactor = computeProfitFactor(monthTrades);
    const costBasis = monthTrades.reduce((s,t)=>s+(Math.abs(Number(t.entryPrice)||0)),0);
    
    // Format based on display mode
    let netDisplay, profitFactorDisplay;
    if(displayMode==='percentage'){
      netDisplay = formatModeValue(net, costBasis);
      profitFactorDisplay = profitFactor.toFixed(2);
    } else {
      netDisplay = `$${net.toFixed(2)}`;
      profitFactorDisplay = profitFactor.toFixed(2);
    }
    
    $('#netpnl').textContent = netDisplay;
    $('#netpnl-sub').textContent = `${total} closed trades`;
    $('#winrate').textContent = `${winRate}%`;
    $('#profitfactor').textContent = profitFactorDisplay;
    $('#totaltrades').textContent = `${total}`;
    $('#avgwl').textContent = computeAvgWL(monthTrades);
    $('#daywin').textContent = computeDayWinRate(monthTrades) + '%';
    $('#avgrr').textContent = computeAvgRR(monthTrades);
    // update donut gauge
    const donut = document.getElementById('win-donut');
    if(donut){
      const angle = (winRate/100)*360;
      donut.style.background = `conic-gradient(#10b981 0deg ${angle}deg, #111827 ${angle}deg 360deg)`;
    }
  }

  function computeAvgWL(monthTrades){
    // naive: average absolute win / average absolute loss
    const wins = monthTrades.filter(t=>t.pnl>0).map(t=>Math.abs(Number(t.pnl)||0));
    const losses = monthTrades.filter(t=>t.pnl<0).map(t=>Math.abs(Number(t.pnl)||0));
    const avgW = wins.length? (wins.reduce((s,v)=>s+v,0)/wins.length):0;
    const avgL = losses.length? (losses.reduce((s,v)=>s+v,0)/losses.length):0;
    if(avgL===0) return '—';
    return `${(avgW/avgL).toFixed(2)}:1`;
  }

  function computeDayWinRate(monthTrades){
    // count unique days with positive pnl vs total days with trades
    const dayMap = {};
    monthTrades.forEach(t=>{const d=(new Date(t.entryDate)).toDateString();dayMap[d]=(dayMap[d]||0)+(Number(t.pnl)||0)});
    const days = Object.keys(dayMap);
    if(!days.length) return 0;
    const winDays = days.filter(d=>dayMap[d]>0).length;
    return Math.round((winDays/days.length)*100);
  }

  function computeAvgRR(monthTrades){
    const rrValues = [];

    monthTrades.forEach(t => {
      const entry = Number(t.entryPrice);
      const stop = Number(t.stopLoss);
      const target = Number(t.takeProfit);

      if(!entry || !stop || !target) return;

      const risk = Math.abs(entry - stop);
      const reward = Math.abs(target - entry);

      if(risk > 0 && reward > 0){
        rrValues.push(reward / risk);
      }
    });

    if(!rrValues.length) return '—';

    const avgRR = rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length;
    if(avgRR === 0) return '—';

    return avgRR >= 1 ? `1:${avgRR.toFixed(2)}` : `${(1 / avgRR).toFixed(2)}:1`;
  }
  function computeProfitFactor(monthTrades){
    const grossProfit = monthTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+Number(t.pnl),0);
    const grossLoss = Math.abs(monthTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+Number(t.pnl),0));
    if(grossLoss===0) return grossProfit?999:0;
    return grossProfit/grossLoss;
  }

  // render table
  function renderTable(){
    tableBody.innerHTML='';
    const recent = getTradesForSelectedMonth().slice().sort((a,b)=>new Date(b.entryDate)-new Date(a.entryDate)).slice(0,20);
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

  function openTradeDrawer(){
    if(tradeDrawer){
      tradeDrawer.classList.add('open');
      tradeDrawer.setAttribute('aria-hidden', 'false');
    }
    if(tradeDrawerBackdrop){
      tradeDrawerBackdrop.classList.add('show');
    }
  }

  function closeTradeDrawer(){
    if(tradeDrawer){
      tradeDrawer.classList.remove('open');
      tradeDrawer.setAttribute('aria-hidden', 'true');
    }
    if(tradeDrawerBackdrop){
      tradeDrawerBackdrop.classList.remove('show');
    }
  }

  if(tradeDrawerBackdrop){
    tradeDrawerBackdrop.addEventListener('click', closeTradeDrawer);
  }

  // calendar
  function renderCalendar(){
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
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
        const amountClass = pnl < 0 ? 'amount negative' : 'amount';
        const deltaClass = pnl < 0 ? 'delta negative' : 'delta';
        el.innerHTML = `<div class="tile" data-day="${d}" data-pnl="${pnl}" data-count="${count}"><div class="date">${d}</div><div class="${amountClass}">${pnl>=1000? ('$'+(pnl/1000).toFixed(1)+'K'): (pnl? '$'+pnl.toFixed(2): '$0')}</div><div class="count">${count} trade${count>1?'s':''}</div><div class="${deltaClass}">${pnl? (pnl>0?'+':'')+pnl.toFixed(2):''}</div></div>`;
      } else {
        el.innerHTML = `<div class="tile empty" data-day="${d}"><div class="date">${d}</div></div>`;
      }
      calendarEl.appendChild(el);
    }
    renderWeeklySummaries(daySums, dayCounts, startDay, daysInMonth, year, month);
    updateCalendarHeader();

    // attach tooltip handlers
    attachCalendarTooltips();
  }

  if(monthPicker){
    monthPicker.addEventListener('change', () => {
      currentCalendarDate.setMonth(Number(monthPicker.value));
      refreshAll();
    });
  }

  if(yearPicker){
    yearPicker.addEventListener('change', () => {
      currentCalendarDate.setFullYear(Number(yearPicker.value));
      refreshAll();
    });
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
      tile.addEventListener('click', e=>{ const day = tile.dataset.day; showTradeDrawerForDay(Number(day)); });
    });
  }

  function showDrilldownForDay(day){
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    const list = trades.filter(t => {
      const d = new Date(t.entryDate);
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year;
    });

    const panel = document.getElementById('trade-day-panel');
    if(panel) panel.classList.remove('hidden');

    if(!list.length){
      if(panel){ panel.innerHTML = `<h3>No trades on ${day}</h3><div class="muted">There are no journal entries for this day.</div>`; }
      return;
    }

    if(panel){
      panel.innerHTML = `<h3>Trades on ${day}</h3><div class="trade-list">${list.map(t => `
        <div class="trade-card" data-id="${t.id}">
          <div class="trade-card-header">
            <strong>${t.instrument}</strong>
            <span>${t.direction}</span>
          </div>
          <div class="trade-meta">
            <div><strong>Entry</strong><br>${t.entryPrice || '—'}</div>
            <div><strong>Exit</strong><br>${t.exitPrice || '—'}</div>
            <div><strong>PnL</strong><br>${t.pnl || '—'}</div>
            <div><strong>RR</strong><br>${t.stopLoss && t.takeProfit && t.entryPrice ? `${Math.abs(t.takeProfit - t.entryPrice).toFixed(2)}:${Math.abs(t.entryPrice - t.stopLoss).toFixed(2)}` : '—'}</div>
          </div>
          <div class="muted">${t.notes || 'No notes'}</div>
          <div class="trade-actions">
            <button class="js-edit-trade" data-id="${t.id}">Edit</button>
            <button class="btn-secondary js-delete-trade" data-id="${t.id}">Delete</button>
          </div>
          ${t.screenshot ? `<img class="trade-screenshot" src="${t.screenshot}" alt="Trade screenshot" style="cursor: pointer;" data-trade-images='${JSON.stringify(t.screenshots || [t.screenshot]).replace(/'/g, "&apos;")}' data-trade-index="0" />` : ''}
          <label class="screenshot-input">
            <span class="muted">Upload screenshot</span>
            <input type="file" accept="image/*" class="js-upload-screenshot" data-id="${t.id}">
          </label>
        </div>
      `).join('')}</div>`;

      panel.querySelectorAll('.js-edit-trade').forEach(btn => {
        btn.addEventListener('click', () => renderTradeEditor(btn.dataset.id));
      });
      panel.querySelectorAll('.js-delete-trade').forEach(btn => {
        btn.addEventListener('click', async () => { await deleteTrade(btn.dataset.id); showDrilldownForDay(day); });
      });
      panel.querySelectorAll('.js-upload-screenshot').forEach(input => {
        input.addEventListener('change', async e => {
          const file = e.target.files[0];
          if(!file) return;
          const reader = new FileReader();
          reader.onload = async () => {
            const trade = trades.find(t => t.id === input.dataset.id);
            if(!trade) return;
            trade.screenshot = reader.result;
            await save();
            showDrilldownForDay(day);
          };
          reader.readAsDataURL(file);
        });
      });
      panel.querySelectorAll('.trade-screenshot').forEach(img => {
        img.addEventListener('click', () => {
          try {
            const images = JSON.parse(img.dataset.tradeImages || '[]');
            const index = parseInt(img.dataset.tradeIndex || '0');
            openImageModal(img.src, images.filter(Boolean).length ? images : [img.src], index);
          } catch (e) {
            openImageModal(img.src, [img.src], 0);
          }
        });
      });
    }
  }

  function showTradeDrawerForDay(day){
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    const list = trades.filter(t => {
      const d = new Date(t.entryDate);
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year;
    });

    if(!tradeDrawer) return;
    openTradeDrawer();

    const displayDate = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    tradeDrawer.innerHTML = `
      <div class="drawer-header">
        <div>
          <p class="muted">Edit trade day</p>
          <h3 class="drawer-title">${displayDate}</h3>
        </div>
        <button class="drawer-close" type="button">Close</button>
      </div>
      ${list.length ? `<div class="drawer-list">${list.map(t => `
        <div class="drawer-card">
          <div class="drawer-card-header">
            <strong>${t.instrument || 'Trade'}</strong>
            <span>${t.direction || '—'}</span>
          </div>
          <div class="status-pill status-${(t.tradeStatus || 'WIN').toLowerCase()}">${t.tradeStatus || 'WIN'}</div>
          <div class="metas">
            <div><strong>Entry</strong><br>${t.entryPrice || '—'}</div>
            <div><strong>Exit</strong><br>${t.exitPrice || '—'}</div>
            <div><strong>PnL</strong><br>${t.pnl || '—'}</div>
            <div><strong>RR</strong><br>${t.stopLoss && t.takeProfit && t.entryPrice ? `${Math.abs(t.takeProfit - t.entryPrice).toFixed(2)}:${Math.abs(t.entryPrice - t.stopLoss).toFixed(2)}` : '—'}</div>
          </div>
          <div class="drawer-actions">
            <button type="button" class="js-open-trade-editor" data-id="${t.id}">Edit in full form</button>
            <button type="button" class="btn-secondary js-delete-trade" data-id="${t.id}">Delete</button>
          </div>
        </div>
      `).join('')}</div>` : `<div class="drawer-empty">No trades were recorded for this day.</div>`}
    `;

    tradeDrawer.querySelector('.drawer-close')?.addEventListener('click', closeTradeDrawer);
    tradeDrawer.querySelectorAll('.js-open-trade-editor').forEach(btn => btn.addEventListener('click', () => renderTradeEditorInDrawer(btn.dataset.id, day)));
    tradeDrawer.querySelectorAll('.js-delete-trade').forEach(btn => {
      btn.addEventListener('click', async () => {
        await deleteTrade(btn.dataset.id);
        showTradeDrawerForDay(day);
      });
    });
  }

  function renderTradeEditorInDrawer(id, day){
    const trade = trades.find(t => t.id === id);
    if(!tradeDrawer || !trade) return;

    const statusClass = `trade-status-${(trade.tradeStatus || 'WIN').toLowerCase()}`;
    const screens = Array.isArray(trade.screenshots) ? trade.screenshots : [];

    tradeDrawer.innerHTML = `
      <div class="drawer-header">
        <div>
          <p class="muted">Edit trade</p>
          <h3 class="drawer-title">${trade.instrument || 'Trade'}</h3>
        </div>
        <button class="drawer-close" type="button">Close</button>
      </div>
      <form class="drawer-editor" data-id="${trade.id}">
        <label>Instrument<input name="instrument" value="${trade.instrument || ''}"></label>
        <label>Direction<select name="direction"><option ${trade.direction === 'LONG' ? 'selected' : ''}>LONG</option><option ${trade.direction === 'SHORT' ? 'selected' : ''}>SHORT</option></select></label>
        <label>Outcome<select name="tradeStatus" class="trade-status-select ${statusClass}"><option value="WIN" ${trade.tradeStatus === 'WIN' || !trade.tradeStatus ? 'selected' : ''}>WIN</option><option value="LOSE" ${trade.tradeStatus === 'LOSE' ? 'selected' : ''}>LOSE</option><option value="BREAKEVEN" ${trade.tradeStatus === 'BREAKEVEN' ? 'selected' : ''}>BREAKEVEN</option></select></label>
        <label>Entry Price<input name="entryPrice" type="number" step="any" value="${trade.entryPrice || ''}"></label>
        <label>Stop Loss<input name="stopLoss" type="number" step="any" value="${trade.stopLoss || ''}"></label>
        <label>Take Profit<input name="takeProfit" type="number" step="any" value="${trade.takeProfit || ''}"></label>
        <label>Exit Price<input name="exitPrice" type="number" step="any" value="${trade.exitPrice || ''}"></label>
        <label>PnL<input name="pnl" type="number" step="any" value="${trade.pnl || ''}"></label>
        <label>Entry Date<input name="entryDate" type="date" value="${(trade.entryDate || '').split('T')[0]}"></label>
        <label>Exit Date<input name="exitDate" type="date" value="${(trade.exitDate || '').split('T')[0]}"></label>
        <label>Emotions<select name="emotion" class="emotion-select"><option value="">Select emotion</option><option value="Calm" ${trade.emotion === 'Calm' ? 'selected' : ''}>Calm</option><option value="Focused" ${trade.emotion === 'Focused' ? 'selected' : ''}>Focused</option><option value="Anxious" ${trade.emotion === 'Anxious' ? 'selected' : ''}>Anxious</option><option value="Confident" ${trade.emotion === 'Confident' ? 'selected' : ''}>Confident</option><option value="Frustrated" ${trade.emotion === 'Frustrated' ? 'selected' : ''}>Frustrated</option><option value="Overconfident" ${trade.emotion === 'Overconfident' ? 'selected' : ''}>Overconfident</option><option value="Stressed" ${trade.emotion === 'Stressed' ? 'selected' : ''}>Stressed</option></select></label>
        <label>Notes<textarea name="notes">${trade.notes || ''}</textarea></label>
        <div class="drawer-upload-section">
          <div class="upload-section-head">
            <div class="upload-title">SCREENSHOTS / CHART IMAGES</div>
            <div class="upload-subtitle">Upload up to 8 charts for this playback</div>
          </div>
          <div class="upload-grid">
            ${Array.from({length: 8}, (_, index) => {
              const src = screens[index];
              return `<label class="upload-slot ${src ? 'filled' : ''}" data-slot="${index + 1}">
                <span>Image ${index + 1}</span>
                <small>${src ? 'Uploaded' : 'Click or drag'}</small>
                <input type="file" accept="image/*" class="js-upload-screenshot-in-drawer" data-index="${index}">
                ${src ? `<img class="upload-slot-thumb" src="${src}" alt="Trade screenshot ${index + 1}">` : ''}
              </label>`;
            }).join('')}
          </div>
        </div>
        <div class="drawer-actions">
          <button type="submit">Save</button>
          <button type="button" class="btn-secondary js-back-to-day">Back to day</button>
        </div>
      </form>
    `;

    tradeDrawer.querySelector('.drawer-close')?.addEventListener('click', closeTradeDrawer);
    tradeDrawer.querySelector('.js-back-to-day')?.addEventListener('click', () => showTradeDrawerForDay(day ?? Number((trade.entryDate || '').split('-')[2] || new Date(trade.entryDate).getDate())));

    tradeDrawer.querySelector('.drawer-editor').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const index = trades.findIndex(t => t.id === trade.id);
      if(index >= 0){
        trades[index] = normalizeScreenshots({
          ...trades[index],
          instrument: data.instrument,
          direction: data.direction,
          tradeStatus: data.tradeStatus || 'WIN',
          emotion: data.emotion || '',
          entryPrice: data.entryPrice ? Number(data.entryPrice) : null,
          stopLoss: data.stopLoss ? Number(data.stopLoss) : null,
          takeProfit: data.takeProfit ? Number(data.takeProfit) : null,
          exitPrice: data.exitPrice ? Number(data.exitPrice) : null,
          pnl: data.pnl ? Number(data.pnl) : (data.exitPrice && data.entryPrice ? Number(data.exitPrice) - Number(data.entryPrice) : 0),
          entryDate: data.entryDate || trades[index].entryDate,
          exitDate: data.exitDate || null,
          notes: data.notes
        });

        await save();
        await load();
        refreshAll();
        showTradeDrawerForDay(Number((data.entryDate || trade.entryDate).split('-')[2]));
      }
    });

    const screenshotInputs = tradeDrawer.querySelectorAll('.js-upload-screenshot-in-drawer');
    screenshotInputs.forEach((input) => {
      input.addEventListener('change', async e => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const tradeRef = trades.find(t => t.id === trade.id);
          if(!tradeRef) return;
          const screenshotIndex = Number(input.dataset.index || 0);
          const existing = Array.isArray(tradeRef.screenshots) ? [...tradeRef.screenshots] : [];
          existing[screenshotIndex] = reader.result;
          tradeRef.screenshots = existing.filter(Boolean).slice(0, 8);
          tradeRef.screenshot = tradeRef.screenshots[0] || '';
          await save();
          await load();
          renderTradeEditorInDrawer(trade.id, day);
        };
        reader.readAsDataURL(file);
      });
    });

    tradeDrawer.querySelectorAll('.upload-slot').forEach((slot) => {
      const input = slot.querySelector('input[type="file"]');
      const img = slot.querySelector('.upload-slot-thumb');
      let clickTimer = null;

      slot.addEventListener('click', (e) => {
        if(!input) return;
        if(!img?.src){
          input.click();
          return;
        }

        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          input.click();
        }, 220);
      });

      slot.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(clickTimer);
        if(img?.src) {
          window.open(img.src, '_blank', 'noopener');
        }
      });
    });
  }

  function renderTradeEditor(id){
    const trade = trades.find(t => t.id === id);
    const panel = document.getElementById('trade-day-panel');
    if(!panel || !trade) return;

    panel.innerHTML = `<h3>Edit Trade</h3>
      <form class="trade-edit-form" data-id="${trade.id}">
        <label>Instrument<input name="instrument" value="${trade.instrument || ''}"></label>
        <label>Direction<select name="direction"><option ${trade.direction === 'LONG' ? 'selected' : ''}>LONG</option><option ${trade.direction === 'SHORT' ? 'selected' : ''}>SHORT</option></select></label>
        <label>Entry Price<input name="entryPrice" type="number" step="any" value="${trade.entryPrice || ''}"></label>
        <label>Stop Loss<input name="stopLoss" type="number" step="any" value="${trade.stopLoss || ''}"></label>
        <label>Take Profit<input name="takeProfit" type="number" step="any" value="${trade.takeProfit || ''}"></label>
        <label>Exit Price<input name="exitPrice" type="number" step="any" value="${trade.exitPrice || ''}"></label>
        <label>PnL<input name="pnl" type="number" step="any" value="${trade.pnl || ''}"></label>
        <label>Entry Date<input name="entryDate" type="date" value="${(trade.entryDate || '').split('T')[0]}"></label>
        <label>Exit Date<input name="exitDate" type="date" value="${(trade.exitDate || '').split('T')[0]}"></label>
        <label>Notes<textarea name="notes">${trade.notes || ''}</textarea></label>
        <div class="trade-actions">
          <button type="submit">Save</button>
          <button type="button" class="btn-secondary js-cancel-edit">Cancel</button>
        </div>
      </form>`;

    panel.querySelector('.trade-edit-form').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const index = trades.findIndex(t => t.id === trade.id);
      if(index >= 0){
        trades[index] = {
          ...trades[index],
          instrument: data.instrument,
          direction: data.direction,
          entryPrice: data.entryPrice ? Number(data.entryPrice) : null,
          stopLoss: data.stopLoss ? Number(data.stopLoss) : null,
          takeProfit: data.takeProfit ? Number(data.takeProfit) : null,
          exitPrice: data.exitPrice ? Number(data.exitPrice) : null,
          pnl: data.pnl ? Number(data.pnl) : (data.exitPrice && data.entryPrice ? Number(data.exitPrice) - Number(data.entryPrice) : 0),
          entryDate: data.entryDate || trades[index].entryDate,
          exitDate: data.exitDate || null,
          notes: data.notes
        };
        await save();
        await load();
        refreshAll();
        showDrilldownForDay(Number((data.entryDate || trade.entryDate).split('-')[2]));
      }
    });

    panel.querySelector('.js-cancel-edit').addEventListener('click', () => showDrilldownForDay(new Date(trade.entryDate).getDate()));
  }

  function formatDisplayValue(value){
    if(displayMode === 'percentage'){
      const costBasis = trades.reduce((s,t)=>s+(Math.abs(Number(t.entryPrice)||0)),0);
      if(costBasis === 0) return '0.00%';
      return `${((value / costBasis) * 100).toFixed(2)}%`;
    }
    return value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
  }

  function renderWeeklySummaries(daySums, dayCounts, startDay, daysInMonth, year, month){
    const weeks = [];
    const weekCostBasis = [];
    let week = 0;
    let dayIndex = 1 - startDay;

    while(dayIndex <= daysInMonth){
      let weekTotal = 0;
      let weekBasis = 0;

      for(let i = 0; i < 7; i++){
        const d = dayIndex + i;
        if(d >= 1 && d <= daysInMonth){
          weekTotal += (daySums[d] || 0);

          const dayTrades = trades.filter(t => {
            const tradeDate = new Date(t.entryDate);
            return tradeDate.getDate() === d && tradeDate.getMonth() === month && tradeDate.getFullYear() === year;
          });

          weekBasis += dayTrades.reduce((sum, t) => sum + (Math.abs(Number(t.entryPrice) || 0)), 0);
        }
      }

      weeks.push(weekTotal);
      weekCostBasis.push(weekBasis);
      dayIndex += 7;
      week++;
    }

    const container = document.getElementById('weekly-summaries');
    container.innerHTML = '';

    weeks.forEach((w, i) => {
      const displayValue = displayMode === 'percentage'
        ? (weekCostBasis[i] > 0 ? `${((w / weekCostBasis[i]) * 100).toFixed(2)}%` : '0.00%')
        : (w >= 0 ? `+$${w.toFixed(2)}` : `-$${Math.abs(w).toFixed(2)}`);

      const el = document.createElement('div');
      el.className = 'week';
      el.innerHTML = `<div>Week ${i + 1}</div><div style="font-size:14px;margin-top:6px;color:${w >= 0 ? '#34d399' : '#f87171'}">${displayValue}</div>`;
      container.appendChild(el);
    });

    const monthTotal = Object.values(daySums).reduce((s, v) => s + v, 0);
    const monthCostBasis = trades.reduce((s, t) => {
      const tradeDate = new Date(t.entryDate);
      return tradeDate.getMonth() === month && tradeDate.getFullYear() === year ? s + (Math.abs(Number(t.entryPrice) || 0)) : s;
    }, 0);

    const monthEl = document.getElementById('month-pnl');
    if(monthEl) {
      monthEl.textContent = formatModeValue(monthTotal, monthCostBasis);
    }
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
    
    // Display username in header
    if (session && session.username) {
      const usernameDisplay = document.getElementById('username-display');
      if (usernameDisplay) {
        usernameDisplay.textContent = session.username;
      }
    }
    
    populateCalendarSelectors();
    updateCalendarHeader();
    await detectServer();
    await load();
    refreshAll();
  }
  init();
})();

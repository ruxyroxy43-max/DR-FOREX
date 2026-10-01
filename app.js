const STORAGE_KEY = 'openbook-data-v1';
const SESSION_KEY = 'openbook-session-v1';
const ADMIN_NAME = 'STYVE';
const ADMIN_PASSWORD = 'admin';
const app = document.querySelector('#app');
let supabaseClient = null;
let backendUnavailable = false;
let authMessage = '';
let authMode = 'login';

const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const stored = JSON.parse(saved);
      if (!Array.isArray(stored.notebookNotes)) stored.notebookNotes = [];
      if (!Array.isArray(stored.sessionPreps)) stored.sessionPreps = [];
      return stored;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const initial = {
    notebookNotes: [],
    sessionPreps: [],
    users: [
      { username: 'MAYA', password: '4821', status: 'approved', createdAt: daysAgo(30) },
      { username: 'JORDAN', password: '7214', status: 'pending', createdAt: daysAgo(1) },
      { username: 'TAYLOR', password: '3906', status: 'pending', createdAt: daysAgo(0) },
    ],
    trades: [
      { id: 'trade-1', username: 'MAYA', ticker: 'NVDA', direction: 'Long', result: 'Win', pnl: 420, date: daysAgo(0), notes: 'Breakout retest' },
      { id: 'trade-2', username: 'MAYA', ticker: 'EUR/USD', direction: 'Short', result: 'Win', pnl: 185, date: daysAgo(1), notes: 'London session pullback' },
      { id: 'trade-3', username: 'MAYA', ticker: 'AAPL', direction: 'Long', result: 'Loss', pnl: -125, date: daysAgo(2), notes: 'Stopped below support' },
      { id: 'trade-4', username: 'MAYA', ticker: 'TSLA', direction: 'Short', result: 'Win', pnl: 315, date: daysAgo(4), notes: 'Failed gap fill' },
    ],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

let data = { users: [], trades: [], notebookNotes: [], sessionPreps: [] };
let session = readSession();
let activeView = 'dashboard';
let toastTimer;
let calendarOffset = 0;
let activityTab = 'recent';
let editingTradeId = null;
let addNoteAfterTradeSave = false;
let editingNotebookNoteId = null;
let notebookEditorRange = null;
let uploadedScreenshots = [];
let screenshotDragIndex = null;
let sessionPrepDate = localDateKey();
let sessionPrepLoadedKey = '';
let sessionPrepImages = [];
let sessionPrepSaveTimer;
let journalFilters = { query: '', status: 'Latest', pair: 'All pairs', account: 'All accounts', from: '', to: '' };

function saveData(next = data) {
  data = next;
  if (supabaseClient) {
    if (session?.role !== 'user' || !session.id) return;
    const workspace = {
      trades: data.trades.filter((trade) => trade.username === session.username),
      notebookNotes: data.notebookNotes.filter((note) => note.username === session.username),
      sessionPreps: data.sessionPreps.filter((prep) => prep.username === session.username),
      accountSize: data.users.find((user) => user.id === session.id)?.accountSize || null,
    };
    supabaseClient.from('user_workspaces').upsert({ user_id: session.id, workspace, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) {
          console.error('Workspace sync failed:', error.message);
          showToast('Could not sync this change. Check your connection and try again.');
        }
      });
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function initials(username) {
  return escapeHtml(username.slice(0, 2).toUpperCase());
}

function formatMoney(amount, compact = false) {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    notation: compact && Math.abs(value) >= 10000 ? 'compact' : 'standard',
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 2800);
}

function setNotice(message, isError = false) {
  const container = document.querySelector('#auth-notice');
  if (!container) return;
  container.innerHTML = message ? `<div class="notice${isError ? ' error' : ''}" role="status">${escapeHtml(message)}</div>` : '';
}

async function loadSupabaseSession(authUser) {
  const profileResult = await supabaseClient.from('profiles').select('*').eq('id', authUser.id).single();
  if (profileResult.error || !profileResult.data) {
    await supabaseClient.auth.signOut();
    session = null;
    authMessage = 'Your profile could not be loaded. Contact the administrator.';
    renderAuth();
    return;
  }
  const ownProfile = profileResult.data;
  if (ownProfile.status !== 'approved') {
    await supabaseClient.auth.signOut();
    session = null;
    authMessage = ownProfile.status === 'rejected'
      ? 'This account was not approved. Contact your administrator.'
      : 'Your account is waiting for admin approval.';
    renderAuth();
    return;
  }

  const workspaceResult = ownProfile.role === 'admin'
    ? await supabaseClient.from('user_workspaces').select('user_id, workspace')
    : await supabaseClient.from('user_workspaces').select('user_id, workspace').eq('user_id', authUser.id).maybeSingle();
  if (workspaceResult.error) throw workspaceResult.error;

  let profiles = [ownProfile];
  let workspaces = Array.isArray(workspaceResult.data) ? workspaceResult.data : workspaceResult.data ? [workspaceResult.data] : [];
  if (ownProfile.role === 'admin') {
    const profilesResult = await supabaseClient.from('profiles').select('*');
    if (profilesResult.error) throw profilesResult.error;
    profiles = profilesResult.data || [];
  } else if (!workspaces.length) {
    const emptyWorkspace = { trades: [], notebookNotes: [], sessionPreps: [] };
    const insertResult = await supabaseClient.from('user_workspaces').upsert({ user_id: authUser.id, workspace: emptyWorkspace });
    if (insertResult.error) throw insertResult.error;
    workspaces = [{ user_id: authUser.id, workspace: emptyWorkspace }];
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const workspacesById = new Map(workspaces.map((entry) => [entry.user_id, entry.workspace || {}]));
  const users = profiles.map((profile) => ({
    id: profile.id,
    username: profile.username,
    status: profile.status,
    role: profile.role,
    createdAt: profile.created_at,
    accountSize: workspacesById.get(profile.id)?.accountSize || null,
  }));
  const trades = [];
  const notebookNotes = [];
  const sessionPreps = [];
  workspaces.forEach((entry) => {
    const profile = profileById.get(entry.user_id);
    if (!profile) return;
    const ownerWorkspace = entry.workspace || {};
    trades.push(...(ownerWorkspace.trades || []).map((trade) => ({ ...trade, username: profile.username })));
    notebookNotes.push(...(ownerWorkspace.notebookNotes || []).map((note) => ({ ...note, username: profile.username })));
    sessionPreps.push(...(ownerWorkspace.sessionPreps || []).map((prep) => ({ ...prep, username: profile.username })));
  });

  data = { users, trades, notebookNotes, sessionPreps };
  session = { id: authUser.id, email: authUser.email, username: ownProfile.username, role: ownProfile.role };
  activeView = 'dashboard';
  activityTab = 'recent';
  sessionPrepLoadedKey = '';
  renderWorkspace();
}

async function initializeBackend() {
  const localDemo = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!localDemo) {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      const config = response.ok ? await response.json() : { configured: false };
      if (config.configured && config.url && config.anonKey) {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        supabaseClient = createClient(config.url, config.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        data = { users: [], trades: [], notebookNotes: [], sessionPreps: [] };
        session = null;
        const { data: { session: authSession }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (authSession?.user) {
          await loadSupabaseSession(authSession.user);
          return;
        }
        renderAuth();
        return;
      }
      backendUnavailable = true;
      authMessage = 'Supabase is not configured for this deployment. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.';
    } catch (error) {
      backendUnavailable = true;
      authMessage = 'Could not connect to Supabase. Check the Vercel configuration and try again.';
      console.error('Supabase initialization failed:', error.message);
    }
    data = { users: [], trades: [], notebookNotes: [], sessionPreps: [] };
    session = null;
    renderAuth();
    return;
  }

  data = loadData();
  session = readSession();
  render();
}

function renderAuth(mode = 'login') {
  const registering = mode === 'register';
  authMode = mode;
  const backendAuth = Boolean(supabaseClient) || backendUnavailable;
  const identityFields = backendAuth
    ? `${registering ? '<div class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username" minlength="2" maxlength="24" placeholder="Choose a username" required /></div>' : ''}<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></div>`
    : '<div class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username" minlength="2" maxlength="24" placeholder="Your username" required /></div>';
  const passwordLength = backendAuth ? 'minlength="8" maxlength="72"' : registering ? 'maxlength="4" minlength="4"' : 'maxlength="32"';
  const passwordHint = registering
    ? backendAuth ? 'Use at least 8 characters. New accounts need admin approval.' : 'Choose exactly 4 characters. Your account needs admin approval before sign-in.'
    : '';
  app.innerHTML = `
    <main class="auth-screen">
      <section class="auth-art" aria-label="Market overview">
        <a class="brand" href="#" data-action="home"><span class="brand-mark">O</span>openbook</a>
        <div class="art-copy">
          <div class="eyebrow"><span class="live-dot"></span> YOUR EDGE, ON THE RECORD</div>
          <h1>Make every<br />trade <span>count.</span></h1>
          <p>A clear head and a good journal. Track your decisions, learn from the numbers, and keep getting better.</p>
          <div class="market-card">
            <div class="market-head">
              <div><span class="market-label">S&amp;P 500 · TODAY</span><strong class="market-value">5,842.47</strong></div>
              <span class="market-change">+1.24%</span>
            </div>
            <svg class="market-chart" viewBox="0 0 520 115" role="img" aria-label="S&amp;P 500 intraday price chart">
              <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fca9a" stop-opacity=".22"/><stop offset="1" stop-color="#9fca9a" stop-opacity="0"/></linearGradient></defs>
              <path class="chart-grid" d="M0 20H520M0 55H520M0 90H520" />
              <path class="chart-area" d="M0 88L30 81 57 85 84 63 110 71 139 51 167 60 194 41 222 50 250 29 280 43 307 30 336 41 365 25 394 34 422 13 450 24 480 10 520 16V115H0Z" />
              <path class="chart-line" d="M0 88L30 81 57 85 84 63 110 71 139 51 167 60 194 41 222 50 250 29 280 43 307 30 336 41 365 25 394 34 422 13 450 24 480 10 520 16" />
            </svg>
            <div class="market-stats"><div><span>OPEN</span><strong>5,771.02</strong></div><div><span>HIGH</span><strong>5,851.19</strong></div><div><span>LOW</span><strong>5,764.80</strong></div><div><span>VOLUME</span><strong>2.8B</strong></div></div>
          </div>
        </div>
        <div class="art-foot"><span>BUILT FOR BETTER DECISIONS</span><span>01 / 01</span></div>
      </section>
      <section class="auth-side">
        <div class="auth-box">
          <a class="brand auth-mobile-brand" href="#" data-action="home"><span class="brand-mark">O</span>openbook</a>
          <h2>${registering ? 'Create your account' : 'Welcome back'}</h2>
          <p class="auth-intro">${registering ? 'Start building a clearer picture of every trade.' : 'Sign in to your trading journal and pick up where you left off.'}</p>
          <form id="auth-form" novalidate>
            ${identityFields}
            <div class="field"><label for="password">Password</label><div class="password-wrap"><input id="password" name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" ${passwordLength} placeholder="${backendAuth ? 'At least 8 characters' : registering ? '4 characters' : 'Enter your password'}" required /><button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password">SHOW</button></div>${passwordHint ? `<span class="field-hint">${passwordHint}</span>` : ''}</div>
            <div id="auth-notice" aria-live="polite"></div>
            <button class="primary-button full-button" type="submit"${backendUnavailable ? ' disabled' : ''}>${registering ? 'Create account' : 'Sign in'} <span aria-hidden="true">&#8594;</span></button>
          </form>
          <p class="auth-switch">${registering ? 'Already have an account?' : 'New to Openbook?'} <button class="text-button" type="button" data-action="auth-mode" data-mode="${registering ? 'login' : 'register'}">${registering ? 'Sign in' : 'Create an account'}</button></p>
        </div>
      </section>
    </main>`;
  if (authMessage) {
    setNotice(authMessage, backendUnavailable);
    authMessage = '';
  }
}

function currentUserTrades() {
  if (session?.role !== 'user') return [];
  return data.trades.filter((trade) => trade.username === session.username).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function makePerformanceChart(trades) {
  const sorted = trades.filter((trade) => trade.result !== 'Open').sort((a, b) => new Date(a.date) - new Date(b.date));
  const width = 540;
  const height = 174;
  const left = 39;
  const right = 518;
  const top = 13;
  const bottom = 137;
  const pnlValues = sorted.reduce((values, trade) => {
    values.push((values.at(-1) || 0) + Number(trade.pnl));
    return values;
  }, [0]);
  while (pnlValues.length < 6) pnlValues.unshift(pnlValues[0] || 0);
  const min = Math.min(0, ...pnlValues);
  const max = Math.max(100, ...pnlValues);
  const range = max - min || 1;
  const points = pnlValues.map((value, index) => {
    const x = left + (right - left) * index / Math.max(pnlValues.length - 1, 1);
    const y = bottom - ((value - min) / range) * (bottom - top);
    return [x, y];
  });
  const pointString = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaString = `${left},${bottom} ${pointString} ${right},${bottom}`;
  const horizontalLines = [top, top + (bottom - top) / 3, top + (bottom - top) * 2 / 3, bottom];
  const labels = [max, min + range * 2 / 3, min + range / 3, min].map((value) => formatMoney(value, true));
  const dateLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Today'];
  return `<svg class="performance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative trading performance chart">
    <defs><linearGradient id="performance-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#62a37f" stop-opacity=".21"/><stop offset="1" stop-color="#62a37f" stop-opacity="0"/></linearGradient></defs>
    ${horizontalLines.map((y, index) => `<line class="gridline" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="axis-label" x="0" y="${y + 3}">${labels[index]}</text>`).join('')}
    <polygon class="area" points="${areaString}"/><polyline class="line" points="${pointString}"/>
    ${points.length > 1 ? `<circle class="point" cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="4"/>` : ''}
    ${dateLabels.map((label, index) => `<text class="axis-label" text-anchor="${index === 0 ? 'start' : index === dateLabels.length - 1 ? 'end' : 'middle'}" x="${left + (right - left) * index / (dateLabels.length - 1)}" y="160">${label}</text>`).join('')}
  </svg>`;
}

function tradeRows(trades) {
  if (!trades.length) return '<tr><td colspan="6"><div class="empty-state"><strong>No trades yet</strong>Log your first trade to start building your journal.</div></td></tr>';
  return trades.map((trade) => {
    const isOpen = trade.result === 'Open';
    const resultClass = isOpen ? 'open' : trade.result === 'Win' ? 'win' : trade.result === 'Loss' ? 'loss' : 'breakeven';
    return `<tr>
      <td>${formatDate(trade.date)}</td><td class="ticker-cell mono">${escapeHtml(trade.ticker)}</td>
      <td>${escapeHtml(trade.direction)}</td><td><span class="badge ${resultClass}">${escapeHtml(trade.result)}</span></td>
      <td class="mono ${Number(trade.pnl) >= 0 ? 'positive' : 'negative'}">${isOpen ? '—' : `${Number(trade.pnl) > 0 ? '+' : ''}${formatMoney(trade.pnl)}`}</td>
      <td>${escapeHtml(trade.notes || '—')}</td>
    </tr>`;
  }).join('');
}

function journalContent(trades) {
  const pairs = [...new Set(trades.map((trade) => trade.ticker))].sort();
  const accounts = [...new Set(trades.map((trade) => trade.account || 'Main account'))].sort();
  const query = journalFilters.query.trim().toLowerCase();
  const filtered = [...trades].filter((trade) => {
    const matchesStatus = journalFilters.status === 'Latest'
      || (journalFilters.status === 'Wins' && trade.result === 'Win')
      || (journalFilters.status === 'Losses' && trade.result === 'Loss')
      || (journalFilters.status === 'Breakeven' && trade.result === 'Breakeven')
      || (journalFilters.status === 'Open' && trade.result === 'Open');
    const matchesQuery = !query || [trade.ticker, trade.model, trade.session, trade.notes, trade.narrative].some((value) => String(value || '').toLowerCase().includes(query));
    const matchesDay = new Date(trade.date).toISOString().slice(0, 10);
    return matchesStatus && matchesQuery
      && (journalFilters.pair === 'All pairs' || trade.ticker === journalFilters.pair)
      && (journalFilters.account === 'All accounts' || (trade.account || 'Main account') === journalFilters.account)
      && (!journalFilters.from || matchesDay >= journalFilters.from)
      && (!journalFilters.to || matchesDay <= journalFilters.to);
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
  const cards = filtered.length ? filtered.map((trade) => {
    const resultClass = trade.result === 'Win' ? 'win' : trade.result === 'Loss' ? 'loss' : trade.result === 'Open' ? 'open' : 'breakeven';
    const amountClass = Number(trade.pnl) > 0 ? 'positive' : Number(trade.pnl) < 0 ? 'negative' : 'neutral';
    const noteCount = data.notebookNotes.filter((note) => note.tradeId === trade.id && note.username === session.username).length;
    return `<article class="journal-trade-card" role="button" tabindex="0" aria-label="View details for ${escapeAttribute(trade.ticker)} trade" data-action="view-trade" data-trade="${escapeAttribute(trade.id)}"><div class="journal-card-status ${resultClass}">${escapeHtml(trade.result)}</div><div class="journal-card-body"><div class="journal-card-title"><div><strong>${escapeHtml(trade.ticker)}</strong><span>${formatDate(trade.date)}</span></div><button class="journal-edit-button" type="button" data-action="edit-trade" data-trade="${escapeAttribute(trade.id)}" aria-label="Edit ${escapeAttribute(trade.ticker)} trade">&#9998;</button></div><div class="journal-card-meta"><span class="direction-tag ${trade.direction === 'Long' ? 'long' : 'short'}">${escapeHtml(trade.direction.toUpperCase())}</span><span>${escapeHtml(trade.session || 'Session not set')}</span></div><div class="journal-card-pnl"><span>REALIZED P&amp;L</span><strong class="${amountClass}">${trade.result === 'Open' ? '—' : `${Number(trade.pnl) > 0 ? '+' : ''}${formatMoney(trade.pnl)}`}</strong></div><div class="journal-card-model"><span>MODEL</span><strong>${escapeHtml(trade.model || 'Not set')}</strong></div>${trade.notes || trade.narrative ? `<p class="journal-card-note">${escapeHtml(trade.notes || trade.narrative)}</p>` : ''}<button class="journal-note-button" type="button" data-action="add-trade-note" data-trade="${escapeAttribute(trade.id)}">&#9998; Add note${noteCount ? ` · ${noteCount}` : ''}</button></div></article>`;
  }).join('') : '<div class="journal-empty"><strong>No trades match these filters.</strong><span>Try another pair, result, or date range.</span></div>';
  const statusOptions = ['Latest', 'Wins', 'Losses', 'Breakeven', 'Open'];
  return `<div class="page-heading journal-heading"><div><h1>Journal</h1><p>Find and edit your trades.</p></div><button class="primary-button" type="button" data-action="add-trade"><span aria-hidden="true">+</span> Add trade</button></div>
    <section class="journal-toolbar" aria-label="Filter trades"><label class="journal-search"><span aria-hidden="true">⌕</span><input id="journal-search" type="search" value="${escapeAttribute(journalFilters.query)}" placeholder="Search trades..." /></label><label class="journal-filter-select"><span class="visually-hidden">Pair</span><select id="journal-pair"><option>All pairs</option>${pairs.map((pair) => `<option${journalFilters.pair === pair ? ' selected' : ''}>${escapeHtml(pair)}</option>`).join('')}</select></label><label class="journal-filter-select"><span class="visually-hidden">Account</span><select id="journal-account"><option>All accounts</option>${accounts.map((account) => `<option${journalFilters.account === account ? ' selected' : ''}>${escapeHtml(account)}</option>`).join('')}</select></label><label class="journal-date-filter"><span class="visually-hidden">From date</span><input id="journal-from" type="date" value="${journalFilters.from}" /></label><label class="journal-date-filter"><span class="visually-hidden">To date</span><input id="journal-to" type="date" value="${journalFilters.to}" /></label><button class="journal-clear" type="button" data-action="clear-journal-filters">Clear</button></section>
    <div class="journal-status-filters" role="group" aria-label="Filter by result">${statusOptions.map((status) => `<button class="journal-status-filter${journalFilters.status === status ? ' active' : ''}" type="button" data-action="journal-status" data-status="${status}">${status}</button>`).join('')}</div>
    <section class="local-journal-banner"><div class="local-journal-copy"><span class="local-journal-label">LOCAL JOURNAL</span><strong>Your journal is saved in this browser</strong><p>Trade edits are stored on this device. Public sharing requires a connected backend.</p></div><div class="local-journal-actions"><button type="button" data-action="save-journal">Update</button><button type="button" data-action="publish-info">Re-publish</button><button type="button" class="copy-link-button" data-action="copy-journal-link">Copy link</button></div></section>
    <div class="journal-results-heading"><span>${filtered.length} ${filtered.length === 1 ? 'TRADE' : 'TRADES'}</span><span>${journalFilters.status === 'Latest' ? 'LATEST FIRST' : escapeHtml(journalFilters.status.toUpperCase())}</span></div><section class="journal-card-grid" aria-label="Journal trades">${cards}</section>`;
}

function tradeDetailField(label, value) {
  const displayValue = value === 0 ? '0' : value || 'Not recorded';
  return `<div class="trade-detail-field"><span>${label}</span><strong>${escapeHtml(displayValue)}</strong></div>`;
}

function openTradeDetails(tradeId) {
  const trade = data.trades.find((entry) => entry.id === tradeId && entry.username === session.username);
  if (!trade) return;
  const resultClass = trade.result === 'Win' ? 'win' : trade.result === 'Loss' ? 'loss' : trade.result === 'Open' ? 'open' : 'breakeven';
  const risk = Math.abs(Number(trade.entryPrice) - Number(trade.stopLoss));
  const reward = Math.abs(Number(trade.takeProfit) - Number(trade.entryPrice));
  const riskReward = risk && reward ? `1:${(reward / risk).toFixed(2)}` : null;
  const notesCount = (data.notebookNotes || []).filter((note) => note.tradeId === trade.id && note.username === session.username).length;
  const fields = (items) => items.map(([label, value]) => tradeDetailField(label, value)).join('');
  const screenshots = (trade.screenshots || []).map((image, index) => `<button class="trade-detail-screenshot" type="button" data-action="view-trade-image" data-trade="${escapeAttribute(trade.id)}" data-index="${index}" aria-label="View screenshot ${index + 1}"><img src="${escapeAttribute(image.data)}" alt="Trade screenshot ${index + 1}"/></button>`).join('');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop trade-detail-backdrop';
  backdrop.innerHTML = `<section class="trade-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="trade-detail-title">
    <header class="trade-detail-header"><div><div class="trade-detail-identity"><h2 id="trade-detail-title">${escapeHtml(trade.ticker)}</h2><span class="direction-tag ${trade.direction === 'Long' ? 'long' : 'short'}">${escapeHtml(trade.direction.toUpperCase())}</span></div><p>${new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(trade.date))} · ${escapeHtml(trade.session || 'Session not set')} · ${escapeHtml(trade.timeframe || 'Timeframe not set')}</p></div><button class="modal-close" type="button" data-action="close-trade-detail" aria-label="Close trade details">&times;</button></header>
    <div class="trade-detail-summary"><span class="badge ${resultClass}">${escapeHtml(trade.result)}</span><strong class="${Number(trade.pnl) > 0 ? 'positive' : Number(trade.pnl) < 0 ? 'negative' : 'neutral'}">${trade.result === 'Open' ? 'Open position' : `${Number(trade.pnl) > 0 ? '+' : ''}${formatMoney(trade.pnl)}`}</strong></div>
    <div class="trade-detail-content"><section class="trade-detail-section"><h3>Trade details</h3><div class="trade-detail-grid">${fields([['Entry', trade.entryPrice], ['Stop loss', trade.stopLoss], ['Take profit', trade.takeProfit], ['Lot size', trade.lotSize], ['R:R', riskReward], ['Account', trade.account], ['Open time', trade.openTime], ['Close time', trade.closeTime]])}</div></section>
      <section class="trade-detail-section"><h3>ICT setup</h3><div class="trade-detail-grid">${fields([['HTF bias', trade.htfBias], ['Market structure', trade.structure], ['Sweep / liquidity raid', trade.liquiditySweep], ['Entry model', trade.model], ['Target / draw on liquidity', trade.targetLiquidity], ['Session', trade.session], ['Entry timeframe', trade.timeframe], ['Confluences', trade.confluences]])}</div></section>
      <section class="trade-detail-section"><h3>Psychology</h3><div class="trade-detail-grid">${fields([['Emotion before', trade.emotionBefore], ['Emotion after', trade.emotionAfter], ['Followed rules', trade.ruleAdherence], ['Discipline', trade.disciplineRating], ['Emotion during trade', trade.emotionDuring], ['Assessment', trade.psychologyAssessment]])}</div></section>
      ${trade.narrative ? `<section class="trade-detail-section"><h3>Narrative</h3><p class="trade-detail-copy">${escapeHtml(trade.narrative)}</p></section>` : ''}
      ${trade.mistakes ? `<section class="trade-detail-section"><h3>Mistakes</h3><p class="trade-detail-copy">${escapeHtml(trade.mistakes)}</p></section>` : ''}
      ${trade.lessonLearned ? `<section class="trade-detail-section"><h3>Lesson</h3><p class="trade-detail-copy">${escapeHtml(trade.lessonLearned)}</p></section>` : ''}
      ${trade.riskNotes ? `<section class="trade-detail-section"><h3>Risk management</h3><p class="trade-detail-copy">${escapeHtml(trade.riskNotes)}</p></section>` : ''}
      ${trade.strategyTags?.length ? `<section class="trade-detail-section"><h3>Additional strategies</h3><div class="trade-detail-tags">${trade.strategyTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></section>` : ''}
      ${screenshots ? `<section class="trade-detail-section"><h3>Screenshots</h3><div class="trade-detail-screenshots">${screenshots}</div></section>` : ''}
    </div><footer class="trade-detail-actions"><button class="ghost-button" type="button" data-action="add-trade-note" data-trade="${escapeAttribute(trade.id)}">&#9998; Add note${notesCount ? ` · ${notesCount}` : ''}</button><span></span><button class="primary-button" type="button" data-action="edit-detail-trade" data-trade="${escapeAttribute(trade.id)}">Edit trade</button></footer>
  </section>`;
  app.append(backdrop);
}

function openTradeImageViewer(tradeId, index) {
  const trade = data.trades.find((entry) => entry.id === tradeId && entry.username === session.username);
  const image = trade?.screenshots?.[index];
  if (!image) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop trade-image-backdrop';
  backdrop.innerHTML = `<figure class="trade-image-viewer"><button type="button" data-action="close-modal" aria-label="Close image">&times;</button><img src="${escapeAttribute(image.data)}" alt="${escapeAttribute(trade.ticker)} screenshot ${index + 1}"/><figcaption>${escapeHtml(trade.ticker)} · Screenshot ${index + 1} of ${trade.screenshots.length}</figcaption></figure>`;
  app.append(backdrop);
}

function userMetrics(trades) {
  const closedTrades = trades.filter((trade) => trade.result !== 'Open');
  const decisiveTrades = closedTrades.filter((trade) => trade.result === 'Win' || trade.result === 'Loss');
  const pnl = closedTrades.reduce((total, trade) => total + Number(trade.pnl), 0);
  const wins = closedTrades.filter((trade) => trade.result === 'Win').length;
  const winRate = decisiveTrades.length ? Math.round(wins / decisiveTrades.length * 100) : 0;
  const best = closedTrades.length ? Math.max(...closedTrades.map((trade) => Number(trade.pnl))) : 0;
  const worst = closedTrades.length ? Math.min(...closedTrades.map((trade) => Number(trade.pnl))) : 0;
  const losses = closedTrades.filter((trade) => trade.result === 'Loss');
  const grossWins = closedTrades.filter((trade) => trade.result === 'Win').reduce((total, trade) => total + Number(trade.pnl), 0);
  const grossLosses = Math.abs(losses.reduce((total, trade) => total + Number(trade.pnl), 0));
  const orderedTrades = [...closedTrades].sort((a, b) => new Date(a.date) - new Date(b.date));
  let balance = 0;
  let peak = 0;
  let maxDrawdown = 0;
  orderedTrades.forEach((trade) => {
    balance += Number(trade.pnl);
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak - balance);
  });
  const latestResult = orderedTrades.at(-1)?.result;
  const streakResult = latestResult === 'Win' || latestResult === 'Loss' ? latestResult : null;
  const currentStreak = streakResult ? orderedTrades.slice().reverse().findIndex((trade) => trade.result !== streakResult) : 0;
  const streak = streakResult ? (currentStreak === -1 ? orderedTrades.length : currentStreak) : 0;
  const tradingDays = new Map();
  closedTrades.forEach((trade) => {
    const dateKey = new Date(trade.date).toDateString();
    tradingDays.set(dateKey, (tradingDays.get(dateKey) || 0) + Number(trade.pnl));
  });
  const profitableDays = [...tradingDays.values()].filter((dayPnl) => dayPnl > 0).length;
  const consistency = tradingDays.size ? Math.round(profitableDays / tradingDays.size * 100) : 0;
  const winLossRatio = losses.length && wins ? grossWins / wins / (grossLosses / losses.length) : 0;
  const radarValues = [
    winRate,
    Math.min(100, winLossRatio / 2 * 100),
    grossLosses ? Math.min(100, grossWins / grossLosses / 2 * 100) : grossWins ? 100 : 0,
    consistency,
    grossWins + maxDrawdown ? Math.round(grossWins / (grossWins + maxDrawdown) * 100) : 0,
  ];
  const performanceScore = decisiveTrades.length ? Math.round(radarValues.reduce((total, value) => total + value, 0) / radarValues.length) : 0;
  return {
    pnl, wins, winRate, best, worst, losses: losses.length, grossWins, grossLosses, maxDrawdown,
    openCount: trades.filter((trade) => trade.result === 'Open').length,
    breakevens: closedTrades.filter((trade) => trade.result === 'Breakeven').length,
    streak, streakResult, consistency, performanceScore, radarValues,
    averageWin: wins ? grossWins / wins : null,
    averageLoss: losses.length ? grossLosses / losses.length : null,
    winLossRatio,
    profitFactor: grossLosses ? (grossWins / grossLosses).toFixed(2) : '—',
  };
}

function performanceRadar(metrics) {
  const axes = [
    { label: 'Win %', value: metrics.winRate },
    { label: 'Avg win/loss', value: Math.min(100, metrics.winLossRatio / 2 * 100) },
    { label: 'Profit factor', value: metrics.radarValues[2] },
    { label: 'Consistency', value: metrics.consistency },
    { label: 'Drawdown', value: metrics.radarValues[4] },
  ];
  const center = { x: 150, y: 105 };
  const radius = 66;
  const pointFor = (value, index, scale = 1) => {
    const angle = (-90 + index * 72) * Math.PI / 180;
    const distance = radius * scale * value / 100;
    return `${(center.x + Math.cos(angle) * distance).toFixed(1)},${(center.y + Math.sin(angle) * distance).toFixed(1)}`;
  };
  const outerPoints = axes.map((_, index) => pointFor(100, index)).join(' ');
  const scorePoints = axes.map((axis, index) => pointFor(axis.value, index)).join(' ');
  const labels = axes.map((axis, index) => {
    const angle = (-90 + index * 72) * Math.PI / 180;
    const x = center.x + Math.cos(angle) * (radius + 24);
    const y = center.y + Math.sin(angle) * (radius + 21);
    return `<text class="radar-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle"><tspan>${axis.label}</tspan><tspan class="radar-value" x="${x.toFixed(1)}" dy="11">${Math.round(axis.value)}%</tspan></text>`;
  }).join('');
  const rings = [0.25, 0.5, 0.75, 1].map((scale) => `<polygon class="radar-ring" points="${axes.map((_, index) => pointFor(100, index, scale)).join(' ')}"/>`).join('');
  const spokes = axes.map((_, index) => {
    const [x, y] = pointFor(100, index).split(',');
    return `<line class="radar-spoke" x1="${center.x}" y1="${center.y}" x2="${x}" y2="${y}"/>`;
  }).join('');
  const dots = axes.map((axis, index) => `<circle class="radar-dot" cx="${pointFor(axis.value, index).split(',')[0]}" cy="${pointFor(axis.value, index).split(',')[1]}" r="3.5"/>`).join('');
  return `<svg class="radar-chart" viewBox="0 0 300 205" role="img" aria-label="Trading performance profile: ${axes.map((axis) => `${axis.label} ${Math.round(axis.value)} percent`).join(', ')}">${rings}${spokes}<polygon class="radar-area" points="${scorePoints}"/>${dots}${labels}</svg>`;
}

function progressTracker(metrics) {
  const factors = [
    ['Win rate', metrics.radarValues[0]],
    ['Avg win/loss', Math.round(metrics.radarValues[1])],
    ['Profit factor', Math.round(metrics.radarValues[2])],
    ['Consistency', metrics.radarValues[3]],
    ['Drawdown control', metrics.radarValues[4]],
  ];
  return `<section class="panel progress-panel"><div class="panel-head"><h2>Progress tracker</h2><span class="panel-kicker">SCORE FACTORS</span></div><div class="tracker-list">${factors.map(([label, value]) => `<div class="tracker-row"><span>${label}</span><div class="tracker-track"><i style="width:${value}%"></i></div><strong>${value}%</strong></div>`).join('')}</div><div class="tracker-total"><span>Your trading score</span><strong>${metrics.performanceScore}<small>/100</small></strong></div></section>`;
}

function winRatePanel(trades, field, title) {
  const closed = trades.filter((trade) => trade.result === 'Win' || trade.result === 'Loss');
  const groups = new Map();
  closed.forEach((trade) => {
    const label = trade[field] || 'Unassigned';
    const group = groups.get(label) || { wins: 0, total: 0 };
    group.total += 1;
    if (trade.result === 'Win') group.wins += 1;
    groups.set(label, group);
  });
  const rows = [...groups.entries()].sort((a, b) => b[1].total - a[1].total).map(([label, group]) => {
    const rate = Math.round(group.wins / group.total * 100);
    return `<div class="rate-row"><span class="rate-label">${escapeHtml(label)}</span><div class="rate-track"><span class="rate-fill" style="width:${rate}%"></span></div><strong class="rate-value">${rate}%</strong><span class="rate-count">${group.total}</span></div>`;
  }).join('');
  return `<section class="panel breakdown-panel"><div class="panel-head"><h2>${title}</h2><span class="panel-kicker">${closed.length} DECISIVE</span></div><div class="rate-list">${rows || '<div class="empty-state">Close a trade to see this breakdown.</div>'}</div></section>`;
}

function weekdayPanel(trades) {
  const closed = trades.filter((trade) => trade.result !== 'Open');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => ({ label, pnl: 0, count: 0 }));
  closed.forEach((trade) => {
    const day = days[new Date(trade.date).getDay()];
    day.pnl += Number(trade.pnl);
    day.count += 1;
  });
  const max = Math.max(1, ...days.map((day) => Math.abs(day.pnl)));
  const rows = days.map((day) => {
    const width = Math.abs(day.pnl) / max * 45;
    const left = day.pnl < 0 ? 50 - width : 50;
    return `<div class="weekday-row"><span class="weekday-label">${day.label}</span><span class="weekday-track"><i class="weekday-bar ${day.pnl < 0 ? 'is-negative' : ''}" style="left:${left}%;width:${width}%"></i></span><strong class="weekday-value ${day.pnl > 0 ? 'positive' : day.pnl < 0 ? 'negative' : ''}">${day.pnl > 0 ? '+' : ''}${formatMoney(day.pnl, true)}</strong><span class="weekday-count">${day.count}</span></div>`;
  }).join('');
  return `<section class="panel breakdown-panel weekday-panel"><div class="panel-head"><h2>Performance by day of week</h2><span class="panel-kicker">${closed.length} CLOSED TRADES</span></div><div class="weekday-list">${rows}</div></section>`;
}

function recentActivityPanel(trades) {
  const openTrades = trades.filter((trade) => trade.result === 'Open');
  const recentTrades = trades.filter((trade) => trade.result !== 'Open').slice(0, 8);
  const shownTrades = activityTab === 'open' ? openTrades : recentTrades;
  const rows = shownTrades.length ? shownTrades.map((trade) => {
    const isOpen = trade.result === 'Open';
    const resultClass = isOpen ? 'open' : trade.result === 'Win' ? 'win' : trade.result === 'Loss' ? 'loss' : 'breakeven';
    return `<tr><td>${formatDate(trade.date)}</td><td class="ticker-cell mono">${escapeHtml(trade.ticker)}</td><td><span class="direction-tag ${trade.direction === 'Long' ? 'long' : 'short'}">${escapeHtml(trade.direction.toUpperCase())}</span></td><td><span class="badge ${resultClass}">${escapeHtml(trade.result)}</span></td><td class="mono ${isOpen ? '' : Number(trade.pnl) >= 0 ? 'positive' : 'negative'}">${isOpen ? '—' : `${Number(trade.pnl) > 0 ? '+' : ''}${formatMoney(trade.pnl)}`}</td><td>${escapeHtml(trade.model || '—')}</td><td>${isOpen ? `<button class="close-trade-button" type="button" data-action="close-position" data-trade="${escapeAttribute(trade.id)}">Close</button>` : escapeHtml(trade.session || '—')}</td></tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state"><strong>${activityTab === 'open' ? 'No open positions' : 'No recent trades'}</strong>${activityTab === 'open' ? 'Open trades you add will appear here.' : 'Closed trades will show here once you log them.'}</div></td></tr>`;
  return `<section class="panel activity-panel"><div class="panel-head"><div><h2>Recent activity</h2><span class="panel-kicker">${activityTab === 'open' ? `${openTrades.length} OPEN` : `${recentTrades.length} RECENT`}</span></div><button class="ghost-button" type="button" data-view="journal">View all</button></div>
    <div class="activity-tabs" role="tablist" aria-label="Trade activity"><button class="activity-tab${activityTab === 'recent' ? ' active' : ''}" type="button" role="tab" aria-selected="${activityTab === 'recent'}" data-action="activity-recent">Recent trades <span>${recentTrades.length}</span></button><button class="activity-tab${activityTab === 'open' ? ' active' : ''}" type="button" role="tab" aria-selected="${activityTab === 'open'}" data-action="activity-open">Open positions <span>${openTrades.length}</span></button></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Pair</th><th>Dir</th><th>Result</th><th>P&amp;L</th><th>Model</th><th>${activityTab === 'open' ? 'Action' : 'Session'}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function monthCalendar(trades) {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + calendarOffset, 1);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthTrades = trades.filter((trade) => {
    const date = new Date(trade.date);
    return date.getFullYear() === year && date.getMonth() === monthIndex && trade.result !== 'Open';
  });
  const byDay = new Map();
  const weeks = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) }, () => ({ pnl: 0, trades: 0 }));
  monthTrades.forEach((trade) => {
    const day = new Date(trade.date).getDate();
    const dailyTrades = byDay.get(day) || [];
    dailyTrades.push(trade);
    byDay.set(day, dailyTrades);
    const week = weeks[Math.floor((firstWeekday + day - 1) / 7)];
    week.pnl += Number(trade.pnl);
    week.trades += 1;
  });

  const blanks = Array.from({ length: firstWeekday }, () => '<div class="calendar-day calendar-empty" aria-hidden="true"></div>').join('');
  const dates = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dailyTrades = byDay.get(day) || [];
    const pnl = dailyTrades.reduce((total, trade) => total + Number(trade.pnl), 0);
    const tone = pnl > 0 ? 'day-positive' : pnl < 0 ? 'day-negative' : '';
    const summary = dailyTrades.length
      ? `<span class="calendar-trades">${dailyTrades.length} ${dailyTrades.length === 1 ? 'trade' : 'trades'}</span><strong class="calendar-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl > 0 ? '+' : ''}${formatMoney(pnl, true)}</strong>`
      : '';
    return `<div class="calendar-day ${tone}" aria-label="${month.toLocaleString('en-US', { month: 'long' })} ${day}${dailyTrades.length ? `, ${dailyTrades.length} trades, ${formatMoney(pnl)} net` : ', no trades'}"><span class="calendar-day-number">${day}</span>${summary}</div>`;
  }).join('');
  const monthPnl = monthTrades.reduce((total, trade) => total + Number(trade.pnl), 0);
  const monthWins = monthTrades.filter((trade) => trade.result === 'Win').length;
  const decisiveTrades = monthTrades.filter((trade) => trade.result === 'Win' || trade.result === 'Loss');
  const monthWinRate = decisiveTrades.length ? Math.round(monthWins / decisiveTrades.length * 100) : 0;
  const monthLabel = month.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return `<section class="panel calendar-panel" aria-label="Monthly trading calendar">
    <div class="calendar-header"><div class="calendar-month-control"><div class="calendar-nav"><button class="calendar-arrow" type="button" data-action="calendar-prev" aria-label="Previous month">&#8249;</button><h2>${monthLabel}</h2><button class="calendar-arrow" type="button" data-action="calendar-next" aria-label="Next month">&#8250;</button></div><button class="calendar-today" type="button" data-action="calendar-current">This month</button></div>
      <div class="calendar-month-summary"><span>MONTHLY · STATS: <strong class="${monthPnl >= 0 ? 'positive' : 'negative'}">${monthPnl > 0 ? '+' : ''}${formatMoney(monthPnl)}</strong></span><span class="calendar-rate">${monthWinRate}% win rate · ${monthTrades.length} trades</span></div></div>
    <div class="calendar-body"><div class="calendar-main"><div class="calendar-weekdays">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<span>${day}</span>`).join('')}</div><div class="calendar-grid">${blanks}${dates}</div><div class="calendar-legend"><span><i class="legend-positive"></i> Profitable day</span><span><i class="legend-negative"></i> Losing day</span></div></div>
      <aside class="weekly-summary"><div class="weekly-title">WEEKLY P&amp;L</div>${weeks.map((week, index) => `<div class="weekly-card"><span>Week ${index + 1}</span><strong class="${week.pnl > 0 ? 'positive' : week.pnl < 0 ? 'negative' : ''}">${week.pnl > 0 ? '+' : ''}${formatMoney(week.pnl, true)}</strong><span>${week.trades} ${week.trades === 1 ? 'trade' : 'trades'}</span></div>`).join('')}</aside></div>
  </section>`;
}

function sanitizeNotebookHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H1', 'H2', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'IMG']);
  const clean = (parent) => {
    [...parent.childNodes].forEach((node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (!allowed.has(node.tagName)) {
        node.replaceWith(document.createTextNode(node.textContent || ''));
        return;
      }
      const imageSource = node.tagName === 'IMG' ? node.getAttribute('src') || '' : '';
      [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
      if (node.tagName === 'IMG') {
        if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(imageSource)) {
          node.remove();
          return;
        }
        node.setAttribute('src', imageSource);
        node.setAttribute('alt', 'Notebook image');
        return;
      }
      clean(node);
    });
  };
  clean(parsed.body);
  return parsed.body.innerHTML;
}

function notebookContent() {
  const notes = (data.notebookNotes || []).filter((note) => note.username === session.username).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const noteCards = notes.length ? notes.map((note) => {
    const linkedTrade = data.trades.find((trade) => trade.id === note.tradeId);
    const preview = new DOMParser().parseFromString(sanitizeNotebookHtml(note.content), 'text/html').body.textContent.trim();
    return `<article class="notebook-note-card"><div class="notebook-note-card-head"><div><span class="notebook-note-date">${formatDate(note.updatedAt)}</span><h2>${escapeHtml(note.title)}</h2></div><div class="notebook-note-card-actions"><button type="button" data-action="edit-notebook-note" data-note="${escapeAttribute(note.id)}" aria-label="Edit note">&#9998;</button><button type="button" data-action="delete-notebook-note" data-note="${escapeAttribute(note.id)}" aria-label="Delete note">&times;</button></div></div><p>${escapeHtml(preview || 'No note text')}</p><span class="notebook-linked-trade">${linkedTrade ? `${escapeHtml(linkedTrade.ticker)} · ${escapeHtml(linkedTrade.result)} · ${formatDate(linkedTrade.date)}` : 'No linked trade'}</span></article>`;
  }).join('') : '<div class="notebook-empty"><strong>Your notebook is empty</strong><span>Add a trade note to keep your reasoning and lessons in one place.</span></div>';
  return `<div class="page-heading notebook-heading"><div><h1>Notebook</h1><p>Trade notes, reflections, and lessons learned.</p></div><button class="primary-button" type="button" data-action="new-notebook-note">+ New note</button></div><section class="notebook-notes-grid" aria-label="Trade notebook">${noteCards}</section>`;
}

function openNotebookNoteModal(noteId = null, tradeId = null) {
  const note = noteId ? (data.notebookNotes || []).find((entry) => entry.id === noteId && entry.username === session.username) : null;
  if (noteId && !note) return;
  const userTrades = currentUserTrades();
  const linkedTradeId = note?.tradeId || tradeId || '';
  const linkedTrade = data.trades.find((trade) => trade.id === linkedTradeId);
  const linkedSummary = linkedTrade
    ? `Linked trade: ${escapeHtml(linkedTrade.ticker)} · ${formatDate(linkedTrade.date)} · ${escapeHtml(linkedTrade.result)} · P&amp;L ${formatMoney(linkedTrade.pnl)}`
    : 'Linked trade: none';
  const defaultTitle = linkedTrade ? `Trade Note — ${linkedTrade.ticker} | ${formatDate(linkedTrade.date)} | ${linkedTrade.result}` : '';
  const tradeOptions = userTrades.map((trade) => `<option value="${escapeAttribute(trade.id)}"${trade.id === linkedTradeId ? ' selected' : ''}>${escapeHtml(trade.ticker)} · ${formatDate(trade.date)} · ${escapeHtml(trade.result)}</option>`).join('');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="modal notebook-note-modal" role="dialog" aria-modal="true" aria-labelledby="notebook-note-title-heading">
      <header class="notebook-modal-header">
        <div>
          <h2 id="notebook-note-title-heading">${note ? 'Edit Trade Note' : 'Add Trade Note'}</h2>
          <p class="notebook-linked-summary">${linkedSummary}</p>
        </div>
        <button class="modal-close" type="button" data-action="close-modal" aria-label="Close">&times;</button>
      </header>
      <form id="notebook-note-form">
        <div class="notebook-note-fields">
          <label class="editor-field"><span>Note title</span><input name="title" maxlength="100" value="${escapeAttribute(note?.title || defaultTitle)}" placeholder="Give this note a title" required /></label>
          <label class="editor-field"><span>Linked trade</span><select name="tradeId"><option value="">No linked trade</option>${tradeOptions}</select></label>
        </div>
        <div class="notebook-toolbar" role="toolbar" aria-label="Note formatting">
          <button type="button" data-note-command="bold" aria-label="Bold"><strong>B</strong></button>
          <button type="button" data-note-command="italic" aria-label="Italic"><em>I</em></button>
          <button type="button" data-note-command="underline" aria-label="Underline"><u>U</u></button><span></span>
          <button type="button" data-note-command="insertUnorderedList" aria-label="Bulleted list">&#8226;</button>
          <button type="button" data-note-command="insertOrderedList" aria-label="Numbered list">1.</button><span></span>
          <button type="button" data-note-command="formatBlock" data-note-value="H1" aria-label="Heading 1">H1</button>
          <button type="button" data-note-command="formatBlock" data-note-value="H2" aria-label="Heading 2">H2</button>
          <button type="button" data-note-command="formatBlock" data-note-value="BLOCKQUOTE" aria-label="Quote">&#8220;</button><span></span>
          <button type="button" data-action="choose-note-image">Images</button>
        </div>
        <input id="notebook-note-image" type="file" accept="image/*" hidden />
        <div id="notebook-note-content" class="notebook-note-content" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note" data-placeholder="Write your note here...">${sanitizeNotebookHtml(note?.content || '')}</div>
        <footer class="notebook-modal-actions">
          <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          <button class="primary-button" type="submit">Save to Notebook</button>
        </footer>
      </form>
    </section>`;
  app.append(backdrop);
  backdrop.querySelector('#notebook-note-content').focus();
}

function localDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function saveSessionPrep(announce = false) {
  const form = document.querySelector('#session-prep-form');
  if (!form || session?.role !== 'user') return;
  const gamePlan = form.elements.gamePlan.value.trim();
  const htfAnalysis = form.elements.htfAnalysis.value.trim();
  const bias = form.elements.bias.value;
  const keyLevels = form.elements.keyLevels.value.trim();
  const newsToWatch = form.elements.newsToWatch.value.trim();
  const now = new Date().toISOString();
  let prep = data.sessionPreps.find((entry) => entry.username === session.username && entry.date === sessionPrepDate);
  if (!prep) {
    prep = { id: `prep-${session.username}-${sessionPrepDate}`, username: session.username, date: sessionPrepDate };
    data.sessionPreps.push(prep);
  }
  Object.assign(prep, { gamePlan, htfAnalysis, bias, keyLevels, newsToWatch, screenshots: sessionPrepImages, updatedAt: now });
  const dateLabel = formatDate(new Date(`${sessionPrepDate}T12:00:00`));
  const lines = [
    '<h2>Pre-Market Game Plan</h2>', `<p>${escapeHtml(gamePlan).replace(/\n/g, '<br>') || 'No game plan recorded.'}</p>`,
    '<h2>HTF Analysis</h2>', `<p><strong>Bias:</strong> ${escapeHtml(bias || 'Not set')}</p>`, `<p>${escapeHtml(htfAnalysis).replace(/\n/g, '<br>') || 'No HTF analysis recorded.'}</p>`,
    `<p><strong>Key levels:</strong> ${escapeHtml(keyLevels || 'Not set')}</p>`, `<p><strong>News to watch:</strong> ${escapeHtml(newsToWatch || 'None recorded')}</p>`,
    ...sessionPrepImages.map((image) => `<p><img src="${image.data}" alt="Session preparation screenshot"></p>`),
  ];
  const notebookNoteId = `session-prep-${session.username}-${sessionPrepDate}`;
  const note = data.notebookNotes.find((entry) => entry.id === notebookNoteId);
  const notebookNote = {
    ...(note || {}),
    id: notebookNoteId,
    username: session.username,
    tradeId: '',
    type: 'session-prep',
    title: `Session Prep — ${dateLabel}`,
    content: lines.join(''),
    createdAt: note?.createdAt || now,
    updatedAt: now,
  };
  if (note) Object.assign(note, notebookNote);
  else data.notebookNotes.push(notebookNote);
  saveData();
  const status = document.querySelector('#session-prep-save-state');
  if (status) status.textContent = `Saved to Notebook · ${new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(now))}`;
  if (announce) showToast('Session prep saved to your Notebook on this device.');
}

function scheduleSessionPrepSave() {
  const status = document.querySelector('#session-prep-save-state');
  if (status) status.textContent = 'Saving…';
  clearTimeout(sessionPrepSaveTimer);
  sessionPrepSaveTimer = setTimeout(() => saveSessionPrep(false), 650);
}

async function addSessionPrepImages(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, 6 - sessionPrepImages.length));
  try {
    sessionPrepImages.push(...await Promise.all(files.map(encodeScreenshot)));
    const gallery = document.querySelector('.session-prep-gallery');
    if (gallery) gallery.innerHTML = sessionPrepImageMarkup();
    saveSessionPrep(false);
  } catch {
    showToast('One or more screenshots could not be loaded.');
  }
}

function sessionPrepImageMarkup() {
  return sessionPrepImages.map((image, index) => `<figure class="session-prep-image"><img src="${escapeAttribute(image.data)}" alt="Session prep screenshot ${index + 1}"><button type="button" data-action="remove-session-prep-image" data-index="${index}" aria-label="Remove screenshot">&times;</button></figure>`).join('');
}

function sessionPreparationContent(trades) {
  const prep = data.sessionPreps.find((entry) => entry.username === session.username && entry.date === sessionPrepDate);
  const prepKey = `${session.username}:${sessionPrepDate}`;
  if (prepKey !== sessionPrepLoadedKey) {
    sessionPrepImages = [...(prep?.screenshots || [])];
    sessionPrepLoadedKey = prepKey;
  }
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${sessionPrepDate}T12:00:00`));
  return `<div class="page-heading session-prep-heading"><div><h1>Session Preparation</h1><p>Plan the session, mark your higher-timeframe view, and keep your process consistent.</p></div><label class="session-date-control"><span>Prep date</span><input id="session-prep-date" type="date" value="${sessionPrepDate}"></label></div>
    <div class="session-prep-layout"><div class="session-prep-main"><form id="session-prep-form" class="session-prep-form">
      <section class="session-prep-card"><header class="session-prep-card-header"><span class="prep-icon">&#128640;</span><div><h2>Pre-Market Game Plan</h2><p>Levels, bias &amp; news to watch before the bell</p></div><div class="prep-save-meta"><span>Today: ${dateLabel}</span><span id="session-prep-save-state">${prep?.updatedAt ? 'Saved to Notebook' : 'Not saved yet'}</span></div></header>
        <div class="prep-toolbar"><button class="prep-template-tab active" type="button" data-action="prep-template">&#128640; Game Plan</button><button class="prep-new-button" type="button" data-action="new-session-prep">+ New Session Prep</button><span></span><button class="prep-save-button" type="submit">Save</button></div>
        <label class="session-prep-text-label"><span>PRE-MARKET GAME PLAN</span><textarea name="gamePlan" id="session-game-plan" rows="8" placeholder="What is your daily bias? What liquidity is price drawing toward? What would invalidate the plan?">${escapeHtml(prep?.gamePlan || '')}</textarea></label>
      </section>
      <section class="session-prep-card htf-prep-card"><header class="session-prep-card-header"><span class="prep-icon htf-icon">&#128200;</span><div><h2>HTF Analysis</h2><p>Attach screenshots and explain your bias before the session</p></div></header>
        <div class="prep-context-fields"><label><span>HTF BIAS</span><select name="bias"><option${!prep?.bias || prep.bias === 'Neutral' ? ' selected' : ''}>Neutral</option><option${prep?.bias === 'Bullish' ? ' selected' : ''}>Bullish</option><option${prep?.bias === 'Bearish' ? ' selected' : ''}>Bearish</option><option${prep?.bias === 'Waiting' ? ' selected' : ''}>Waiting for confirmation</option></select></label><label><span>KEY LEVELS</span><input name="keyLevels" value="${escapeAttribute(prep?.keyLevels || '')}" placeholder="PDH, PDL, PWH, PWL, Asia range" /></label><label class="session-news-field"><span>HIGH-IMPACT NEWS / TIMES</span><input name="newsToWatch" value="${escapeAttribute(prep?.newsToWatch || '')}" placeholder="Events and times to avoid or monitor" /></label></div>
        <label class="session-prep-text-label"><span>HIGHER-TIMEFRAME READ</span><textarea name="htfAnalysis" id="session-htf-analysis" rows="6" placeholder="HTF structure, dealing range, premium/discount, liquidity draw...">${escapeHtml(prep?.htfAnalysis || '')}</textarea></label>
        <input id="session-prep-images" type="file" accept="image/*" multiple hidden><button class="session-prep-dropzone" type="button" data-action="choose-session-prep-images"><span class="prep-cloud">&#8679;</span><strong>Drop screenshots here</strong><span>or choose up to 6 chart images</span><b>+ Add HTF screenshot</b></button><div class="session-prep-gallery">${sessionPrepImageMarkup()}</div>
      </section>
    </form></div><aside class="session-prep-side">${weekdayPanel(trades)}</aside></div>`;
}

function userContent(view) {
  const trades = currentUserTrades();
  const metrics = userMetrics(trades);
  if (view === 'add-trade' || view === 'edit-trade') return tradeEditorContent();
  if (view === 'notebook') return notebookContent();
  if (view === 'session-prep') return sessionPreparationContent(trades);
  const streakValue = metrics.streak ? `${metrics.streakResult === 'Loss' ? '-' : '+'}${metrics.streak}` : '—';
  const streakClass = metrics.streakResult === 'Loss' ? 'negative' : 'positive';
  const streakNote = metrics.streakResult ? `${metrics.streakResult.toLowerCase()} streak` : metrics.breakevens && trades.at(0)?.result === 'Breakeven' ? 'Last trade was breakeven' : 'No active streak';
  const metricCards = `${metricCard('Net P&amp;L', formatMoney(metrics.pnl), 'Realized · closed trades', metrics.pnl >= 0 ? 'positive' : 'negative')}${metricCard('Avg win', metrics.averageWin === null ? '—' : formatMoney(metrics.averageWin), `${metrics.wins} winning trades`)}${metricCard('Win rate', `${metrics.winRate}%`, `${metrics.wins}W · ${metrics.losses}L · ${metrics.breakevens}BE`)}${metricCard('Profit factor', metrics.profitFactor, 'Gross wins ÷ gross losses')}${metricCard('Max drawdown', formatMoney(-metrics.maxDrawdown), 'Peak to trough', metrics.maxDrawdown ? 'negative' : '')}${metricCard('Avg loss', metrics.averageLoss === null ? '—' : formatMoney(-metrics.averageLoss), `${metrics.losses} losing trades`)}${metricCard('Current streak', streakValue, streakNote, streakClass)}${metricCard('Best trade', formatMoney(metrics.best), 'Highest realized P&amp;L', 'positive')}${metricCard('Worst trade', formatMoney(metrics.worst), 'Lowest realized P&amp;L', metrics.worst < 0 ? 'negative' : '')}${metricCard('ROI', '—', 'Add account size to calculate')}${metricCard('Total trades', trades.length, `${trades.length - metrics.openCount} closed · ${metrics.openCount} open`)}${metricCard('Open positions', metrics.openCount, 'Unrealized P&amp;L not included')}`;
  if (view === 'analytics') return `
    <div class="page-heading"><div><h1>Analytics</h1><p>Your decisions, measured over time.</p></div></div>
    <section class="metric-grid" aria-label="Trading performance summary">${metricCards}</section>
    <section class="panel section-panel"><div class="panel-head"><h2>Performance over time</h2><span class="panel-kicker">CUMULATIVE P&amp;L</span></div><div class="chart-wrap">${makePerformanceChart(trades)}<div class="chart-legend"><span class="legend-dot"></span>Net realized P&amp;L</div></div></section>
    <section class="panel section-panel"><div class="panel-head"><h2>Trade outcomes</h2><span class="panel-kicker">${trades.length} TOTAL</span></div><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Direction</th><th>Result</th><th>Net P&amp;L</th><th>Date</th></tr></thead><tbody>${trades.length ? trades.map((trade) => `<tr><td class="ticker-cell mono">${escapeHtml(trade.ticker)}</td><td>${escapeHtml(trade.direction)}</td><td><span class="badge ${trade.result === 'Open' ? 'open' : trade.result === 'Win' ? 'win' : trade.result === 'Loss' ? 'loss' : 'breakeven'}">${trade.result}</span></td><td class="mono ${Number(trade.pnl) >= 0 ? 'positive' : 'negative'}">${trade.result === 'Open' ? '—' : formatMoney(trade.pnl)}</td><td>${formatDate(trade.date)}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">Your trade history will appear here.</div></td></tr>'}</tbody></table></div></section>`;

  if (view === 'journal') return journalContent(trades);

  return `
    <div class="page-heading"><div><h1>Good ${greeting()}, ${escapeHtml(session.username.toLowerCase())}.</h1><p>Here's your trading activity at a glance.</p></div><div class="heading-actions"><button class="ghost-button start-day-button" type="button" data-view="session-prep">&#10022; Start my day</button><button class="primary-button" type="button" data-action="add-trade"><span aria-hidden="true">+</span> <span class="button-word">Log a trade</span></button></div></div>
    <div class="trader-overview-grid"><section class="metric-grid trader-metrics" aria-label="Trading performance summary">${metricCards}</section>${monthCalendar(trades)}</div>
    <div class="score-insights-grid"><div class="score-column"><section class="panel performance-score-panel"><div class="panel-head"><div><h2>Performance score</h2><span class="panel-kicker">JOURNAL METRICS</span></div><span class="panel-kicker">5 FACTORS</span></div><div class="score-content">${performanceRadar(metrics)}<div class="score-result"><strong>${metrics.performanceScore}</strong><span>YOUR SCORE</span><b>${metrics.performanceScore >= 80 ? 'Strong habits' : metrics.performanceScore >= 60 ? 'Building consistency' : metrics.performanceScore ? 'Room to improve' : 'Log closed trades to begin'}</b></div></div><p class="score-disclaimer">Composite of win rate, average win/loss, profit factor, profitable days, and drawdown control.</p></section>${progressTracker(metrics)}</div><div class="insights-stack">${recentActivityPanel(trades)}<div class="breakdown-grid">${winRatePanel(trades, 'model', 'Win rate by model')}${winRatePanel(trades, 'session', 'Win rate by session')}</div>${weekdayPanel(trades)}</div></div>`;
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

function metricCard(label, value, note, valueClass = '') {
  if (label === 'ROI' && session?.role === 'user') {
    const user = data.users.find((entry) => entry.username === session.username);
    if (user?.accountSize > 0) {
      const netPnl = currentUserTrades().filter((trade) => trade.result !== 'Open').reduce((total, trade) => total + Number(trade.pnl), 0);
      const roi = netPnl / user.accountSize * 100;
      value = `${roi.toFixed(2)}%`;
      note = `On ${formatMoney(user.accountSize)} account`;
      valueClass = roi >= 0 ? 'positive' : 'negative';
    } else {
      note = '<button class="metric-link" type="button" data-action="set-account-size">Set account size</button>';
    }
  }
  return `<div class="metric"><span class="metric-label">${label}</span><strong class="metric-value ${valueClass}">${value}</strong><span class="metric-note">${note}</span></div>`;
}

function adminContent(view) {
  const pending = data.users.filter((user) => user.status === 'pending');
  const approved = data.users.filter((user) => user.status === 'approved');
  const inactive = approved.filter((user) => !data.trades.some((trade) => trade.username === user.username));
  const recentUsers = [...data.users].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const activity = view === 'verification' ? pending : recentUsers;
  const title = view === 'verification' ? 'Account verification' : view === 'accounts' ? 'User accounts' : 'Admin overview';
  const subtitle = view === 'verification' ? 'Review new sign-ups before granting dashboard access.' : view === 'accounts' ? 'See account status and journal activity in one place.' : 'A clear view of access requests and trader activity.';
  const rows = activity.length ? activity.map((user) => `<tr>
    <td class="ticker-cell">${escapeHtml(user.username)}</td><td>${view === 'accounts' ? data.trades.filter((trade) => trade.username === user.username).length : formatDate(user.createdAt)}</td>
    <td><span class="badge ${escapeAttribute(user.status)}">${escapeHtml(user.status)}</span></td>
    <td>${user.status === 'pending' ? `<div class="approval-actions"><button class="approve-button" type="button" data-action="approve" data-user="${escapeAttribute(user.username)}">Approve</button><button class="reject-button" type="button" data-action="reject" data-user="${escapeAttribute(user.username)}">Decline</button></div>` : `<span class="status-note">${user.status === 'approved' ? 'Access granted' : 'Access declined'}</span>`}</td>
  </tr>`).join('') : `<tr><td colspan="4"><div class="empty-state"><strong>All caught up</strong>${view === 'verification' ? 'There are no accounts waiting for review.' : 'No accounts to display yet.'}</div></td></tr>`;
  const recommendations = `<section class="panel recommendations-panel"><div class="panel-head"><h2>Recommended actions</h2><span class="panel-kicker">BASED ON ACCOUNT ACTIVITY</span></div><div class="recommendation-list">
    <article class="recommendation"><span class="recommendation-icon priority">!</span><div class="recommendation-copy"><strong>${pending.length ? `Review ${pending.length} pending ${pending.length === 1 ? 'request' : 'requests'}` : 'No accounts awaiting approval'}</strong><span>${pending.length ? 'New users are waiting for access to their journals.' : 'All new account requests have been handled.'}</span></div><button class="recommendation-link" type="button" data-view="verification">${pending.length ? 'Review requests' : 'View queue'} &#8594;</button></article>
    <article class="recommendation"><span class="recommendation-icon">&#8599;</span><div class="recommendation-copy"><strong>${inactive.length ? `Welcome ${inactive.length} approved ${inactive.length === 1 ? 'trader' : 'traders'}` : 'Trader activity is underway'}</strong><span>${inactive.length ? 'These approved accounts have not logged a journal entry yet.' : 'Every approved account has at least one journal entry.'}</span></div><button class="recommendation-link" type="button" data-view="accounts">View accounts &#8594;</button></article>
  </div></section>`;
  const columnLabel = view === 'accounts' ? 'Journal entries' : 'Requested';
  return `
    <div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${view === 'verification' ? '' : '<button class="ghost-button" type="button" data-view="verification">Review requests <span class="nav-count">' + pending.length + '</span></button>'}</div>
    <section class="metric-grid" aria-label="Account summary">${metricCard('Awaiting review', pending.length, 'Accounts need your decision', pending.length ? 'negative' : 'positive')}${metricCard('Approved users', approved.length, 'Active dashboard access')}${metricCard('All accounts', data.users.length, 'Including declined requests')}${metricCard('Journal entries', data.trades.length, 'Across all users')}</section>
    ${view === 'dashboard' ? recommendations : ''}
    <section class="panel table-panel"><div class="panel-head"><h2>${view === 'verification' ? 'Pending accounts' : 'User accounts'}</h2><span class="panel-kicker">${activity.length} ${view === 'verification' ? 'AWAITING REVIEW' : 'TOTAL'}</span></div><div class="table-wrap"><table><thead><tr><th>Username</th><th>${columnLabel}</th><th>Status</th><th>${view === 'verification' ? 'Decision' : 'Access'}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderWorkspace() {
  if (!session) return renderAuth();
  const isAdmin = session.role === 'admin';
  const items = isAdmin
    ? [{ id: 'dashboard', icon: '⌂', label: 'Overview' }, { id: 'accounts', icon: '◎', label: 'Accounts' }, { id: 'verification', icon: '✓', label: 'Verification', count: data.users.filter((user) => user.status === 'pending').length }]
    : [{ id: 'dashboard', icon: '⌂', label: 'Dashboard' }, { id: 'journal', icon: '≡', label: 'Trade journal' }, { id: 'analytics', icon: '↗', label: 'Analytics' }, { id: 'notebook', icon: '▤', label: 'Notebook' }, { id: 'session-prep', icon: '◷', label: 'Session Prep' }];
  if (!items.some((item) => item.id === activeView) && !['add-trade', 'edit-trade'].includes(activeView)) activeView = 'dashboard';
  const title = activeView === 'add-trade' ? 'Add trade' : activeView === 'edit-trade' ? 'Edit trade' : items.find((item) => item.id === activeView)?.label || 'Dashboard';
  const userLabel = isAdmin ? 'Administrator' : 'Trader account';
  app.innerHTML = `
    <main class="workspace${isAdmin ? '' : ' trader-theme'}">
      <aside class="sidebar">
        <a class="brand" href="#" data-action="home"><span class="brand-mark">O</span>openbook</a>
        <div class="sidebar-section">Workspace</div>
        <nav class="nav-list ${isAdmin ? 'admin-nav' : 'user-nav'}" aria-label="Main navigation">${items.map((item) => `<button class="nav-item${activeView === item.id ? ' active' : ''}" type="button" data-view="${item.id}"${activeView === item.id ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${item.icon}</span>${item.label}${item.count ? `<span class="nav-count">${item.count}</span>` : ''}</button>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="profile"><span class="avatar${isAdmin ? ' coral' : ''}">${initials(session.username)}</span><span class="profile-copy"><strong>${escapeHtml(session.username)}</strong><span>${userLabel}</span></span><button class="logout-button" type="button" data-action="logout" title="Sign out" aria-label="Sign out">&#8599;</button></div></div>
      </aside>
      <section class="main-area">
        <header class="topbar"><span class="mobile-brand"><span class="brand-mark">O</span>openbook</span><span class="topbar-label">${escapeHtml(title)}</span><span class="topbar-date">${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}</span></header>
        <div class="content">${isAdmin ? adminContent(activeView) : userContent(activeView)}</div>
      </section>
    </main>`;
}

function render() {
  if (!session) renderAuth();
  else renderWorkspace();
}

async function handleLogin(form) {
  if (backendUnavailable) return setNotice(authMessage || 'Backend is not configured.', true);
  if (supabaseClient) {
    const { data: authResult, error } = await supabaseClient.auth.signInWithPassword({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
    });
    if (error) return setNotice('Email or password was not recognized.', true);
    try {
      await loadSupabaseSession(authResult.user);
    } catch (workspaceError) {
      console.error('Workspace load failed:', workspaceError.message);
      await supabaseClient.auth.signOut();
      session = null;
      authMessage = 'Could not load your workspace. Check the Supabase schema and policies.';
      renderAuth();
    }
    return;
  }
  const username = form.elements.username.value.trim().toUpperCase();
  const password = form.elements.password.value;
  if (username === ADMIN_NAME && password === ADMIN_PASSWORD) {
    session = { username: ADMIN_NAME, role: 'admin' };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    activeView = 'dashboard';
    activityTab = 'recent';
    render();
    return;
  }
  const user = data.users.find((entry) => entry.username.toUpperCase() === username);
  if (!user || user.password !== password) return setNotice('That username and password combination was not recognized.', true);
  if (user.status === 'pending') return setNotice('Your account is waiting for admin approval. Please try again later.');
  if (user.status === 'rejected') return setNotice('This account was not approved. Contact your administrator.', true);
  session = { username: user.username, role: 'user' };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  activeView = 'dashboard';
  activityTab = 'recent';
  render();
}

async function handleRegistration(form) {
  const username = form.elements.username.value.trim().toUpperCase();
  const password = form.elements.password.value;
  if (!/^[A-Z0-9_]{2,24}$/.test(username)) return setNotice('Use 2–24 letters, numbers, or underscores for your username.', true);
  if (supabaseClient) {
    if (username === ADMIN_NAME) return setNotice('That username is reserved for the administrator.', true);
    const email = form.elements.email.value.trim().toLowerCase();
    if (password.length < 8) return setNotice('Choose a password with at least 8 characters.', true);
    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { username }, emailRedirectTo: location.origin },
    });
    if (error) return setNotice(error.message, true);
    renderAuth('login');
    setNotice('Check your email to confirm the account. Admin approval is also required before access.');
    return;
  }
  if (backendUnavailable) return setNotice(authMessage || 'Backend is not configured.', true);
  if (username === ADMIN_NAME || username === 'MAYA' || data.users.some((user) => user.username.toUpperCase() === username)) {
    return setNotice('That username is unavailable. Please choose another.', true);
  }
  if (password.length !== 4) return setNotice('Your password must be exactly 4 characters.', true);
  data.users.push({ username, password, status: 'pending', createdAt: new Date().toISOString() });
  saveData();
  renderAuth('login');
  setNotice('Account created. An admin must approve it before you can sign in.');
}

function localDateTimeValue(value) {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function tradeEditorContent() {
  const trade = editingTradeId ? data.trades.find((entry) => entry.id === editingTradeId) : null;
  const value = (key, fallback = '') => trade?.[key] ?? fallback;
  const textField = (name, label, placeholder = '', type = 'text', step = '') => `<label class="editor-field"><span>${label}</span><input name="${name}" type="${type}" ${step ? `step="${step}"` : ''} value="${escapeAttribute(value(name))}" placeholder="${escapeAttribute(placeholder)}" /></label>`;
  const selectField = (name, label, options, fallback = '') => {
    const selected = value(name, fallback);
    const choices = selected && !options.includes(selected) ? [selected, ...options] : options;
    return `<label class="editor-field"><span>${label}</span><select name="${name}">${choices.map((option) => `<option value="${escapeAttribute(option)}"${selected === option ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  };
  const textArea = (name, label, placeholder = '', wide = false) => `<label class="editor-field${wide ? ' editor-field-wide' : ''}"><span>${label}</span><textarea name="${name}" rows="3" placeholder="${escapeAttribute(placeholder)}">${escapeHtml(value(name))}</textarea></label>`;
  const sessionOptions = ['Not set', 'Asia', 'London', 'New York AM', 'New York PM', 'Other'];
  const modelOptions = ['1C CISD', 'Not set', 'FVG', 'Inversion FVG', 'BPR', 'Order Block', 'Breaker Block', 'Mitigation Block', 'Rejection Block', 'Unicorn Model', 'OTE', 'Silver Bullet', 'Judas Swing', '2022 Model', 'Power of 3', 'SMT Divergence', 'Turtle Soup', 'Other'];
  const strategyOptions = ['Supply & Demand', 'Support & Resistance', 'VWAP', 'RSI', 'Elliott Waves', 'Price Action', 'Moving Averages', 'Trendlines'];
  const selectedStrategies = new Set(value('strategyTags', []));
  const resultOptions = ['Win', 'Loss', 'Breakeven', 'Open'];
  const screenshots = screenshotPreviewMarkup();
  return `<div class="trade-editor-page"><div class="page-heading trade-editor-heading"><div><h1>${trade ? 'Edit trade' : 'Add trade'}</h1><p>Record the setup, execution, and review while they’re fresh.</p></div><button class="ghost-button" type="button" data-view="journal">&#8592; Back to journal</button></div>
    <form id="trade-form" class="trade-editor-form"><div class="trade-editor-grid">
      <section class="editor-panel basics-panel"><div class="editor-panel-heading"><span class="editor-icon">01</span><div><h2>Trade basics</h2><p>Instrument, risk, and result</p></div></div><div class="editor-fields">
        ${textField('ticker', 'Instrument / pair', 'e.g. NAS100')}${selectField('direction', 'Direction', ['Long', 'Short'], 'Long')}${textField('account', 'Broker / account', 'Main account')}
        ${textField('entryPrice', 'Entry price', '0.00', 'number', 'any')}${textField('stopLoss', 'Stop loss', '0.00', 'number', 'any')}${textField('takeProfit', 'Take profit', '0.00', 'number', 'any')}
        ${textField('lotSize', 'Lot size / contracts', 'Optional', 'number', 'any')}<label class="editor-field"><span>R:R ratio (auto)</span><input id="risk-reward" type="text" value="${trade?.entryPrice && trade?.stopLoss && trade?.takeProfit ? (Math.abs(Number(trade.takeProfit) - Number(trade.entryPrice)) / Math.abs(Number(trade.entryPrice) - Number(trade.stopLoss))).toFixed(2) : '—'}" readonly /></label>${textField('pnl', 'Realized P&amp;L ($)', 'Optional for open / breakeven', 'number', 'any')}
        ${selectField('result', 'Result', resultOptions, 'Win')}<label class="editor-field"><span>Entry date &amp; time</span><input name="entryDate" type="datetime-local" value="${localDateTimeValue(value('date'))}" /></label>${textField('openTime', 'Open time', '', 'time')}${textField('closeTime', 'Close time', '', 'time')}
      </div></section>
      <section class="editor-panel ict-panel"><div class="editor-panel-heading"><span class="editor-icon ict-icon">02</span><div><h2>ICT setup</h2><p>Context, liquidity, and entry model</p></div></div><div class="editor-fields">
        ${selectField('session', 'Session', sessionOptions, 'Not set')}${selectField('timeframe', 'Entry timeframe', ['Not set', '1 Minute', '3 Minutes', '5 Minutes', '15 Minutes', '30 Minutes', '1 Hour', '4 Hours', 'Daily', 'Weekly'], 'Not set')}
        ${selectField('htfBias', 'HTF bias', ['Bullish', 'Bearish', 'Neutral', 'Not set'], 'Not set')}${selectField('structure', 'Market structure', ['MSS — Bullish', 'MSS — Bearish', 'BOS — Bullish', 'BOS — Bearish', 'CHOCH', 'Displacement', 'Premium', 'Discount', 'Equilibrium', 'Not set'], 'Not set')}
        ${selectField('liquiditySweep', 'Sweep / liquidity raid', ['BSL — Buy-side liquidity', 'SSL — Sell-side liquidity', 'Equal highs (EQH)', 'Equal lows (EQL)', 'Previous day high (PDH)', 'Previous day low (PDL)', 'Previous week high (PWH)', 'Previous week low (PWL)', 'Asia high / low', 'London high / low', 'SMT divergence', 'Turtle Soup', 'None / not set'], 'None / not set')}
        ${selectField('model', 'Entry model / confirmation', modelOptions, 'Not set')}${selectField('targetLiquidity', 'Target / draw on liquidity', ['Not set', 'BSL — Buy-side liquidity', 'SSL — Sell-side liquidity', 'PDH / PDL', 'PWH / PWL', 'EQH / EQL', 'Opposing FVG', 'Opposing order block', 'External liquidity', 'Internal liquidity', 'Other'], 'Not set')}${textField('confluences', 'Confluences', 'e.g. SMT, displacement, OTE')}
      </div><div class="ict-tip"><strong>ICT journal prompt</strong><span>Record your higher-timeframe draw, liquidity taken, displacement, market-structure shift, and the PD array used for entry. These are review tags, not guaranteed signals.</span></div></section>
      <section class="editor-panel psychology-panel"><div class="editor-panel-heading"><span class="editor-icon review-icon">03</span><div><h2>Notes &amp; psychology</h2><p>Capture the decision process</p></div></div><div class="editor-fields editor-fields-single">
        ${textArea('narrative', 'Trade narrative', 'Why did you take this setup?', true)}
        ${selectField('emotionBefore', 'Emotion before entry', ['Calm', 'Confident', 'Anxious', 'Fearful', 'FOMO', 'Frustrated', 'Neutral'], 'Neutral')}${selectField('emotionAfter', 'Emotion after trade', ['Calm', 'Confident', 'Relieved', 'Disappointed', 'Frustrated', 'Neutral'], 'Neutral')}
        ${selectField('ruleAdherence', 'Did you follow your rules?', ['Yes — fully', 'Mostly', 'No'], 'Yes — fully')}${textField('mistakes', 'Mistakes made (if any)', 'None')}
        ${textArea('lessonLearned', 'Lesson learned', 'What will you repeat or change?', true)}
      </div></section>
      <section class="editor-panel review-panel"><div class="editor-panel-heading"><span class="editor-icon review-icon">04</span><div><h2>Post-trade review</h2><p>Discipline and risk review</p></div></div><div class="editor-fields editor-fields-single">
        ${selectField('psychologyAssessment', 'Psychology assessment', ['Good — followed my plan', 'Mixed — minor lapse', 'Poor — broke my rules'], 'Good — followed my plan')}
        ${selectField('disciplineRating', 'Discipline rating (1–10)', Array.from({ length: 10 }, (_, index) => `${index + 1} — ${['Needs work', 'Needs work', 'Developing', 'Developing', 'Steady', 'Steady', 'Strong', 'Strong', 'Excellent', 'Excellent'][index]}`), '7 — Strong')}
        ${selectField('emotionDuring', 'Emotional state during trade', ['Calm', 'Focused', 'Anxious', 'Fearful', 'Greedy', 'Impatient', 'Neutral'], 'Neutral')}
        ${textArea('riskNotes', 'Risk management notes', 'Was your risk planned and respected?', true)}
      </div></section>
    </div>
    <div class="editor-secondary-grid"><section class="editor-panel strategies-panel"><div class="editor-panel-heading"><span class="editor-icon strategy-icon">05</span><div><h2>Additional strategies</h2><p>Supplementary confluences used in this trade</p></div></div><div class="strategy-chips">${strategyOptions.map((strategy) => `<label class="strategy-chip"><input type="checkbox" name="strategyTags" value="${escapeAttribute(strategy)}"${selectedStrategies.has(strategy) ? ' checked' : ''}/><span>${escapeHtml(strategy)}</span></label>`).join('')}</div></section>
      <section class="editor-panel screenshots-panel"><div class="editor-panel-heading"><span class="editor-icon screenshot-icon">06</span><div><h2>Trade screenshots</h2><p>Before entry, setup, and result · up to 6 images</p></div></div><input id="trade-screenshots" type="file" accept="image/*" multiple hidden/><button class="screenshot-dropzone" type="button" data-action="choose-screenshots"><strong>Choose or drop chart images</strong><span>Images are resized and saved with this trade in your browser.</span></button><div class="screenshot-previews">${screenshots}</div></section></div>
    <div class="trade-editor-actions"><button class="ghost-button" type="button" data-action="add-trade-note">&#9998; Add note</button><span class="editor-action-spacer"></span><button class="ghost-button" type="button" data-action="clear-trade-form">Clear form</button><button class="primary-button save-trade-button" type="submit">${trade ? 'Update trade' : 'Save trade'} <span aria-hidden="true">&#8594;</span></button></div></form></div>`;
}

async function encodeScreenshot(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bitmap.width, 900 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { name: file.name, data: canvas.toDataURL('image/jpeg', 0.72) };
}

function screenshotPreviewMarkup() {
  return uploadedScreenshots.map((image, index) => `<figure class="editor-screenshot" draggable="true" data-screenshot-index="${index}"><img src="${escapeAttribute(image.data)}" alt="Trade screenshot ${index + 1}"/><input class="screenshot-replace-input" type="file" accept="image/*" data-replace-index="${index}" hidden/><figcaption class="screenshot-actions"><button class="screenshot-replace" type="button" data-action="replace-screenshot" data-index="${index}" title="Replace screenshot ${index + 1}">Replace</button><span class="screenshot-drag-handle" aria-hidden="true" title="Drag to rearrange">&#8942;&#8942;</span><button class="screenshot-remove" type="button" data-action="remove-screenshot" data-index="${index}" aria-label="Remove screenshot ${index + 1}">&times;</button></figcaption></figure>`).join('');
}

async function addScreenshotFiles(fileList, input, replaceIndex = null) {
  const selectedFiles = [...fileList].filter((file) => file.type.startsWith('image/'));
  if (replaceIndex !== null) {
    if (!selectedFiles.length) {
      if (input) input.value = '';
      return;
    }
    try {
      uploadedScreenshots[replaceIndex] = await encodeScreenshot(selectedFiles[0]);
      const preview = document.querySelector('.screenshot-previews');
      if (preview) preview.innerHTML = screenshotPreviewMarkup();
      showToast(`Screenshot ${replaceIndex + 1} replaced.`);
    } catch {
      showToast('Screenshot could not be loaded.');
    }
    if (input) input.value = '';
    return;
  }
  const files = selectedFiles.slice(0, Math.max(0, 6 - uploadedScreenshots.length));
  if (selectedFiles.length > files.length) showToast('A trade can include up to 6 screenshots.');
  try {
    uploadedScreenshots.push(...await Promise.all(files.map(encodeScreenshot)));
    const preview = document.querySelector('.screenshot-previews');
    if (preview) preview.innerHTML = screenshotPreviewMarkup();
  } catch {
    showToast('One or more screenshots could not be loaded.');
  }
  if (input) input.value = '';
}

function openAccountSizeModal() {
  const user = data.users.find((entry) => entry.username === session.username);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="account-size-title"><div class="modal-head"><div><h2 id="account-size-title">Set account size</h2><p>Used to calculate ROI from your realized P&amp;L.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="account-size-form"><div class="field"><label for="account-size">Starting account size (USD)</label><input id="account-size" name="accountSize" type="number" min="0.01" step="0.01" value="${user?.accountSize || ''}" required placeholder="e.g. 10000" /></div><div class="modal-actions"><button class="ghost-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Save account size</button></div></form></section>`;
  app.append(backdrop);
  backdrop.querySelector('#account-size').focus();
}

function openCloseTradeModal(tradeId) {
  const trade = data.trades.find((entry) => entry.id === tradeId && entry.result === 'Open');
  if (!trade) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="close-trade-title"><div class="modal-head"><div><h2 id="close-trade-title">Close ${escapeHtml(trade.ticker)}</h2><p>Enter the realized outcome for this position.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">&times;</button></div>
    <form id="close-trade-form"><input type="hidden" name="tradeId" value="${escapeAttribute(trade.id)}"/><div class="field"><label for="close-result">Result</label><select id="close-result" name="result"><option>Win</option><option>Loss</option><option>Breakeven</option></select></div><div class="field"><label for="close-pnl">Realized P&amp;L (USD)</label><input id="close-pnl" name="pnl" type="number" step="0.01" placeholder="Leave blank for breakeven" /></div><div class="modal-actions"><button class="ghost-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Save result</button></div></form></section>`;
  app.append(backdrop);
  backdrop.querySelector('#close-pnl').focus();
}

function logout() {
  if (supabaseClient) supabaseClient.auth.signOut().catch((error) => console.error('Sign out failed:', error.message));
  sessionStorage.removeItem(SESSION_KEY);
  session = null;
  activeView = 'dashboard';
  activityTab = 'recent';
  renderAuth();
}

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'auth-form') {
    if (backendUnavailable) return setNotice(authMessage || 'Backend is not configured.', true);
    if (authMode === 'register') await handleRegistration(form);
    else await handleLogin(form);
  }
  if (form.id === 'trade-form') {
    const openNoteAfterSaving = addNoteAfterTradeSave;
    addNoteAfterTradeSave = false;
    const formData = new FormData(form);
    const result = String(formData.get('result'));
    const enteredPnl = Math.abs(Number(formData.get('pnl')));
    if ((result === 'Win' || result === 'Loss') && (!enteredPnl || !Number.isFinite(enteredPnl))) return showToast('Enter a non-zero realized P&L amount.');
    const existingTrade = editingTradeId ? data.trades.find((trade) => trade.id === editingTradeId && trade.username === session.username) : null;
    const entryDate = formData.get('entryDate');
    const updatedTrade = {
      ...(existingTrade || {}),
      id: existingTrade?.id || `trade-${Date.now()}`,
      username: session.username,
      ticker: String(formData.get('ticker')).trim().toUpperCase(),
      direction: String(formData.get('direction')),
      result,
      pnl: result === 'Win' ? enteredPnl : result === 'Loss' ? -enteredPnl : 0,
      account: String(formData.get('account')).trim() || 'Main account',
      entryPrice: String(formData.get('entryPrice')).trim(),
      stopLoss: String(formData.get('stopLoss')).trim(),
      takeProfit: String(formData.get('takeProfit')).trim(),
      lotSize: String(formData.get('lotSize')).trim(),
      model: String(formData.get('model')),
      session: String(formData.get('session')),
      timeframe: String(formData.get('timeframe')),
      htfBias: String(formData.get('htfBias')),
      structure: String(formData.get('structure')),
      liquiditySweep: String(formData.get('liquiditySweep')),
      targetLiquidity: String(formData.get('targetLiquidity')),
      confluences: String(formData.get('confluences')).trim(),
      narrative: String(formData.get('narrative')).trim(),
      emotionBefore: String(formData.get('emotionBefore')),
      emotionAfter: String(formData.get('emotionAfter')),
      ruleAdherence: String(formData.get('ruleAdherence')),
      mistakes: String(formData.get('mistakes')).trim(),
      lessonLearned: String(formData.get('lessonLearned')).trim(),
      psychologyAssessment: String(formData.get('psychologyAssessment')),
      disciplineRating: String(formData.get('disciplineRating')),
      emotionDuring: String(formData.get('emotionDuring')),
      riskNotes: String(formData.get('riskNotes')).trim(),
      strategyTags: formData.getAll('strategyTags'),
      screenshots: uploadedScreenshots,
      openTime: String(formData.get('openTime')),
      closeTime: String(formData.get('closeTime')),
      date: entryDate ? new Date(entryDate).toISOString() : existingTrade?.date || new Date().toISOString(),
      notes: String(formData.get('narrative')).trim() || String(formData.get('lessonLearned')).trim(),
    };
    if (existingTrade) Object.assign(existingTrade, updatedTrade);
    else data.trades.push(updatedTrade);
    saveData();
    editingTradeId = null;
    uploadedScreenshots = [];
    activeView = 'journal';
    renderWorkspace();
    showToast(existingTrade ? 'Trade updated in your journal.' : 'Trade added to your journal.');
    if (openNoteAfterSaving) openNotebookNoteModal(null, updatedTrade.id);
  }
  if (form.id === 'close-trade-form') {
    const formData = new FormData(form);
    const trade = data.trades.find((entry) => entry.id === formData.get('tradeId') && entry.result === 'Open');
    const enteredPnl = Math.abs(Number(formData.get('pnl')));
    const result = String(formData.get('result'));
    if (!trade || ((result === 'Win' || result === 'Loss') && (!enteredPnl || !Number.isFinite(enteredPnl)))) return showToast('Enter a non-zero realized P&L amount.');
    trade.result = result;
    trade.pnl = result === 'Win' ? enteredPnl : result === 'Loss' ? -enteredPnl : 0;
    trade.date = new Date().toISOString();
    saveData();
    document.querySelector('.modal-backdrop')?.remove();
    renderWorkspace();
    showToast(`${trade.ticker} position closed.`);
  }
  if (form.id === 'account-size-form') {
    const user = data.users.find((entry) => entry.username === session.username);
    const accountSize = Number(new FormData(form).get('accountSize'));
    if (!user || !Number.isFinite(accountSize) || accountSize <= 0) return showToast('Enter an account size greater than zero.');
    user.accountSize = accountSize;
    saveData();
    document.querySelector('.modal-backdrop')?.remove();
    renderWorkspace();
    showToast('Account size saved and ROI recalculated.');
  }
  if (form.id === 'notebook-note-form') {
    const formData = new FormData(form);
    const title = String(formData.get('title')).trim();
    const content = sanitizeNotebookHtml(document.querySelector('#notebook-note-content').innerHTML);
    const plainText = new DOMParser().parseFromString(content, 'text/html').body.textContent.trim();
    if (!title) return showToast('Add a title for this note.');
    if (!plainText && !content.includes('<img')) return showToast('Write something in your note before saving.');
    const requestedTradeId = String(formData.get('tradeId'));
    const linkedTrade = data.trades.find((trade) => trade.id === requestedTradeId && trade.username === session.username);
    const now = new Date().toISOString();
    const existingNote = editingNotebookNoteId
      ? data.notebookNotes.find((note) => note.id === editingNotebookNoteId && note.username === session.username)
      : null;
    const updatedNote = {
      ...(existingNote || {}),
      id: existingNote?.id || `note-${Date.now()}`,
      username: session.username,
      tradeId: linkedTrade?.id || '',
      title,
      content,
      createdAt: existingNote?.createdAt || now,
      updatedAt: now,
    };
    if (existingNote) Object.assign(existingNote, updatedNote);
    else data.notebookNotes.push(updatedNote);
    saveData();
    editingNotebookNoteId = null;
    notebookEditorRange = null;
    document.querySelector('.modal-backdrop')?.remove();
    renderWorkspace();
    showToast(existingNote ? 'Notebook note updated.' : 'Note saved to your notebook.');
  }
  if (form.id === 'session-prep-form') saveSessionPrep(true);
});

app.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    activeView = viewButton.dataset.view;
    renderWorkspace();
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === 'view-trade') openTradeDetails(actionButton.dataset.trade);
  if (action === 'edit-detail-trade') {
    const tradeId = actionButton.dataset.trade;
    document.querySelector('.trade-detail-backdrop')?.remove();
    editingTradeId = tradeId;
    uploadedScreenshots = [...(data.trades.find((trade) => trade.id === tradeId)?.screenshots || [])];
    activeView = 'edit-trade';
    renderWorkspace();
  }
  if (action === 'close-trade-detail') actionButton.closest('.trade-detail-backdrop')?.remove();
  if (action === 'view-trade-image') openTradeImageViewer(actionButton.dataset.trade, Number(actionButton.dataset.index));
  if (action === 'auth-mode') renderAuth(actionButton.dataset.mode);
  if (action === 'toggle-password') {
    const input = document.querySelector('#password');
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    actionButton.textContent = visible ? 'SHOW' : 'HIDE';
    actionButton.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
  }
  if (action === 'logout' || action === 'home') {
    event.preventDefault();
    logout();
  }
  if (action === 'add-trade') {
    editingTradeId = null;
    addNoteAfterTradeSave = false;
    uploadedScreenshots = [];
    activeView = 'add-trade';
    renderWorkspace();
  }
  if (action === 'edit-trade') {
    editingTradeId = actionButton.dataset.trade;
    addNoteAfterTradeSave = false;
    const trade = data.trades.find((entry) => entry.id === editingTradeId);
    uploadedScreenshots = [...(trade?.screenshots || [])];
    activeView = 'edit-trade';
    renderWorkspace();
  }
  if (action === 'choose-screenshots') document.querySelector('#trade-screenshots')?.click();
  if (action === 'replace-screenshot') {
    const input = document.querySelector(`.screenshot-replace-input[data-replace-index="${actionButton.dataset.index}"]`);
    if (input) {
      input.value = '';
      input.click();
    }
  }
  if (action === 'remove-screenshot') {
    uploadedScreenshots.splice(Number(actionButton.dataset.index), 1);
    const preview = document.querySelector('.screenshot-previews');
    if (preview) preview.innerHTML = screenshotPreviewMarkup();
  }
  if (action === 'add-trade-note') {
    const tradeId = actionButton.dataset.trade || editingTradeId;
    if (!tradeId) {
      const tradeForm = document.querySelector('#trade-form');
      if (!tradeForm) return showToast('Open a trade before adding a linked note.');
      if (!tradeForm.reportValidity()) return;
      addNoteAfterTradeSave = true;
      tradeForm.requestSubmit();
      return;
    }
    editingNotebookNoteId = null;
    actionButton.closest('.trade-detail-backdrop')?.remove();
    openNotebookNoteModal(null, tradeId);
  }
  if (action === 'new-notebook-note') {
    editingNotebookNoteId = null;
    openNotebookNoteModal();
  }
  if (action === 'new-session-prep') {
    sessionPrepDate = localDateKey();
    sessionPrepLoadedKey = '';
    renderWorkspace();
  }
  if (action === 'choose-session-prep-images') document.querySelector('#session-prep-images')?.click();
  if (action === 'remove-session-prep-image') {
    sessionPrepImages.splice(Number(actionButton.dataset.index), 1);
    const gallery = document.querySelector('.session-prep-gallery');
    if (gallery) gallery.innerHTML = sessionPrepImageMarkup();
    saveSessionPrep(false);
  }
  if (action === 'edit-notebook-note') {
    editingNotebookNoteId = actionButton.dataset.note;
    openNotebookNoteModal(editingNotebookNoteId);
  }
  if (action === 'delete-notebook-note') {
    const noteId = actionButton.dataset.note;
    data.notebookNotes = data.notebookNotes.filter((note) => note.id !== noteId || note.username !== session.username);
    saveData();
    renderWorkspace();
    showToast('Notebook note deleted.');
  }
  if (action === 'note-command') {
    document.querySelector('#notebook-note-content')?.focus();
    document.execCommand(actionButton.dataset.command, false, actionButton.dataset.value || null);
  }
  if (action === 'choose-note-image') {
    const selection = window.getSelection();
    if (selection?.rangeCount) notebookEditorRange = selection.getRangeAt(0).cloneRange();
    document.querySelector('#notebook-note-image')?.click();
  }
  if (action === 'clear-trade-form') {
    document.querySelector('#trade-form')?.reset();
    const trade = editingTradeId ? data.trades.find((entry) => entry.id === editingTradeId) : null;
    uploadedScreenshots = [...(trade?.screenshots || [])];
    const preview = document.querySelector('.screenshot-previews');
    if (preview) preview.innerHTML = screenshotPreviewMarkup();
    updateRiskReward();
  }
  if (action === 'journal-status') {
    journalFilters.status = actionButton.dataset.status;
    renderWorkspace();
  }
  if (action === 'clear-journal-filters') {
    journalFilters = { query: '', status: 'Latest', pair: 'All pairs', account: 'All accounts', from: '', to: '' };
    renderWorkspace();
  }
  if (action === 'save-journal') {
    saveData();
    showToast('Journal updates saved on this device.');
  }
  if (action === 'publish-info') showToast('Public publishing requires a connected backend.');
  if (action === 'copy-journal-link') {
    navigator.clipboard?.writeText(location.href)
      .then(() => showToast('Page link copied. Trades remain stored in this browser.'))
      .catch(() => showToast('Copy unavailable here. Trade data remains local to this browser.'));
  }
  if (action === 'set-account-size') openAccountSizeModal();
  if (action === 'calendar-prev') { calendarOffset -= 1; renderWorkspace(); }
  if (action === 'calendar-next') { calendarOffset += 1; renderWorkspace(); }
  if (action === 'calendar-current') { calendarOffset = 0; renderWorkspace(); }
  if (action === 'activity-recent' || action === 'activity-open') {
    activityTab = action === 'activity-open' ? 'open' : 'recent';
    renderWorkspace();
  }
  if (action === 'close-position') openCloseTradeModal(actionButton.dataset.trade);
  if (action === 'close-modal') actionButton.closest('.modal-backdrop')?.remove();
  if (action === 'approve' || action === 'reject') {
    const user = data.users.find((entry) => entry.username === actionButton.dataset.user);
    if (!user || user.status !== 'pending') return;
    const status = action === 'approve' ? 'approved' : 'rejected';
    if (supabaseClient) {
      supabaseClient.from('profiles').update({ status }).eq('id', user.id).then(({ error }) => {
        if (error) {
          showToast('Could not update account access. Check admin permissions.');
          return;
        }
        user.status = status;
        renderWorkspace();
        showToast(`${user.username} ${action === 'approve' ? 'approved' : 'declined'}.`);
      });
    } else {
      user.status = status;
      saveData();
      renderWorkspace();
      showToast(`${user.username} ${action === 'approve' ? 'approved' : 'declined'}.`);
    }
  }
});

app.addEventListener('keydown', (event) => {
  if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches('.journal-trade-card')) return;
  event.preventDefault();
  openTradeDetails(event.target.dataset.trade);
});

function updateRiskReward() {
  const entry = Number(document.querySelector('[name="entryPrice"]')?.value);
  const stop = Number(document.querySelector('[name="stopLoss"]')?.value);
  const target = Number(document.querySelector('[name="takeProfit"]')?.value);
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const field = document.querySelector('#risk-reward');
  if (field) field.value = risk && reward ? `1:${(reward / risk).toFixed(2)}` : '—';
}

app.addEventListener('input', (event) => {
  if (event.target.id === 'journal-search') {
    const cursor = event.target.selectionStart;
    journalFilters.query = event.target.value;
    renderWorkspace();
    const search = document.querySelector('#journal-search');
    search?.focus({ preventScroll: true });
    search?.setSelectionRange(cursor, cursor);
    return;
  }
  if (['entryPrice', 'stopLoss', 'takeProfit'].includes(event.target.name)) updateRiskReward();
  if (event.target.closest('#session-prep-form')) scheduleSessionPrepSave();
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'session-prep-date') {
    sessionPrepDate = event.target.value || localDateKey();
    sessionPrepLoadedKey = '';
    renderWorkspace();
    return;
  }
  if (event.target.id === 'session-prep-images') {
    addSessionPrepImages(event.target.files);
    event.target.value = '';
    return;
  }
  if (event.target.closest('#session-prep-form')) {
    scheduleSessionPrepSave();
    return;
  }
  if (event.target.id === 'notebook-note-image') {
    const file = event.target.files?.[0];
    if (!file) return;
    encodeScreenshot(file).then((image) => {
      const editor = document.querySelector('#notebook-note-content');
      const selection = window.getSelection();
      editor?.focus();
      if (editor && notebookEditorRange) {
        selection?.removeAllRanges();
        selection?.addRange(notebookEditorRange);
      }
      document.execCommand('insertImage', false, image.data);
      notebookEditorRange = null;
      event.target.value = '';
    }).catch(() => showToast('Image could not be added to the note.'));
    return;
  }
  if (event.target.id === 'trade-screenshots' || event.target.matches('.screenshot-replace-input')) {
    const replaceIndex = event.target.dataset.replaceIndex;
    addScreenshotFiles(event.target.files, event.target, replaceIndex === undefined ? null : Number(replaceIndex));
    return;
  }
  const filterNames = { 'journal-pair': 'pair', 'journal-account': 'account', 'journal-from': 'from', 'journal-to': 'to' };
  const filterName = filterNames[event.target.id];
  if (!filterName) return;
  journalFilters[filterName] = event.target.value;
  renderWorkspace();
});

app.addEventListener('mousedown', (event) => {
  const button = event.target.closest('[data-note-command], [data-action="choose-note-image"]');
  if (!button) return;
  const selection = window.getSelection();
  if (selection?.rangeCount) notebookEditorRange = selection.getRangeAt(0).cloneRange();
  if (button.hasAttribute('data-note-command')) event.preventDefault();
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-note-command]');
  if (!button) return;
  const editor = document.querySelector('#notebook-note-content');
  const selection = window.getSelection();
  editor?.focus();
  if (editor && notebookEditorRange) {
    selection?.removeAllRanges();
    selection?.addRange(notebookEditorRange);
  }
  const command = button.dataset.noteCommand;
  const value = command === 'formatBlock' ? `<${button.dataset.noteValue.toLowerCase()}>` : null;
  document.execCommand(command, false, value);
  const updatedSelection = window.getSelection();
  notebookEditorRange = updatedSelection?.rangeCount ? updatedSelection.getRangeAt(0).cloneRange() : null;
});

app.addEventListener('dragover', (event) => {
  const prepDropzone = event.target.closest('.session-prep-dropzone');
  if (prepDropzone) {
    event.preventDefault();
    prepDropzone.classList.add('is-dragging');
    return;
  }
  const screenshot = event.target.closest('.editor-screenshot');
  if (screenshot) {
    event.preventDefault();
    screenshot.classList.add('is-drop-target');
    return;
  }
  if (!event.target.closest('.screenshot-dropzone')) return;
  event.preventDefault();
  event.target.closest('.screenshot-dropzone').classList.add('is-dragging');
});

app.addEventListener('dragleave', (event) => {
  event.target.closest('.session-prep-dropzone')?.classList.remove('is-dragging');
  event.target.closest('.editor-screenshot')?.classList.remove('is-drop-target');
  event.target.closest('.screenshot-dropzone')?.classList.remove('is-dragging');
});

app.addEventListener('dragstart', (event) => {
  const screenshot = event.target.closest('.editor-screenshot');
  if (!screenshot) return;
  screenshotDragIndex = Number(screenshot.dataset.screenshotIndex);
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(screenshotDragIndex));
  screenshot.classList.add('is-dragging');
});

app.addEventListener('dragend', () => {
  screenshotDragIndex = null;
  document.querySelectorAll('.editor-screenshot').forEach((screenshot) => screenshot.classList.remove('is-dragging', 'is-drop-target'));
});

app.addEventListener('drop', (event) => {
  const prepDropzone = event.target.closest('.session-prep-dropzone');
  if (prepDropzone) {
    event.preventDefault();
    prepDropzone.classList.remove('is-dragging');
    addSessionPrepImages(event.dataTransfer.files);
    return;
  }
  const targetScreenshot = event.target.closest('.editor-screenshot');
  if (targetScreenshot && screenshotDragIndex !== null) {
    event.preventDefault();
    const targetIndex = Number(targetScreenshot.dataset.screenshotIndex);
    const [screenshot] = uploadedScreenshots.splice(screenshotDragIndex, 1);
    uploadedScreenshots.splice(targetIndex, 0, screenshot);
    screenshotDragIndex = null;
    targetScreenshot.classList.remove('is-drop-target');
    const preview = document.querySelector('.screenshot-previews');
    if (preview) preview.innerHTML = screenshotPreviewMarkup();
    return;
  }
  if (targetScreenshot && event.dataTransfer.files.length) {
    event.preventDefault();
    addScreenshotFiles(event.dataTransfer.files);
    return;
  }
  const dropzone = event.target.closest('.screenshot-dropzone');
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.remove('is-dragging');
  if (screenshotDragIndex !== null) {
    const [screenshot] = uploadedScreenshots.splice(screenshotDragIndex, 1);
    uploadedScreenshots.push(screenshot);
    screenshotDragIndex = null;
    const preview = document.querySelector('.screenshot-previews');
    if (preview) preview.innerHTML = screenshotPreviewMarkup();
    return;
  }
  addScreenshotFiles(event.dataTransfer.files);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') [...document.querySelectorAll('.modal-backdrop')].at(-1)?.remove();
});

initializeBackend();

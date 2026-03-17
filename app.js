// ── SUPABASE ──
const SUPABASE_URL = 'https://psefgnjgdkrlhxqdqmyz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzZWZnbmpnZGtybGh4cWRxbXl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjkxMTIsImV4cCI6MjA4OTAwNTExMn0.jhLYQReM3qQUEN63lW-tjBttsp6YlfhtiuA8HfnTDRU';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STATE ──
let user         = null;
let profile      = { full_name: '', hourly_rate: 50, currency: 'CAD' };
let appState     = 'idle'; // 'idle' | 'working' | 'break'
let workStart    = null;
let breakStart   = null;
let totalWorkMs  = 0;
let totalBreakMs = 0;
let breakCount   = 0;
let sessionStart = null;
let rafId        = null;
let logRows      = [];

// ── AUTH ──
function authTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) =>
    b.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='signup')));
  document.getElementById('loginForm').style.display  = tab==='login'  ? 'block' : 'none';
  document.getElementById('signupForm').style.display = tab==='signup' ? 'block' : 'none';
  document.getElementById('authMsg').style.display    = 'none';
}

function showMsg(msg, type='error') {
  const el = document.getElementById('authMsg');
  el.textContent   = msg;
  el.className     = `auth-msg ${type}`;
  el.style.display = 'block';
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  if (!email || !pass) { showMsg('Please fill in both fields.'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) showMsg(error.message);
}

async function doSignup() {
  const name  = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const pass  = document.getElementById('signupPass').value;
  if (!name)           { showMsg('Please enter your name.'); return; }
  if (!email || !pass) { showMsg('Please fill in all fields.'); return; }
  if (pass.length < 6) { showMsg('Password must be at least 6 characters.'); return; }

  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) { showMsg(error.message); return; }

  if (data?.user) {
    await sb.from('profiles').upsert({
      id:          data.user.id,
      full_name:   name,
      hourly_rate: 50,
      currency:    'CAD'
    });
  }

  showMsg('✓ Account created! Check your email to confirm.', 'success');
}

// async function doLogout() {
//   if (appState !== 'idle') {
//     if (!confirm('You have an active session. Stop and sign out?')) return;
//     cancelAnimationFrame(rafId);
//     appState = 'idle';
//   }
//   await sb.auth.signOut();
//   user    = null;
//   logRows = [];
//   document.getElementById('appScreen').style.display  = 'none';
//   document.getElementById('authScreen').style.display = 'flex';
// }

async function doLogout() {
  if (appState !== 'idle') await saveActiveTimer();  // save instead of stopping
  cancelAnimationFrame(rafId);
  rafId = null;
  appState = 'idle';
  user = null;
  logRows = [];
  await sb.auth.signOut();
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
}

// ── INIT ──
async function init() {
  const timeout = setTimeout(() => {
    document.getElementById('loading').style.display    = 'none';
    document.getElementById('authScreen').style.display = 'flex';
  }, 6000);

  try {
    const { data: { session } } = await sb.auth.getSession();
    clearTimeout(timeout);
    document.getElementById('loading').style.display = 'none';

    if (session?.user) {
      user = session.user;
      await loadProfile();
      showApp();  
      //document.getElementById('authScreen').style.display = 'none';
      //document.getElementById('appScreen').style.display  = 'block';
    } else {
      document.getElementById('authScreen').style.display = 'flex';
    }
  } catch(e) {
    clearTimeout(timeout);
    document.getElementById('loading').style.display    = 'none';
    document.getElementById('authScreen').style.display = 'flex';
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      user = session.user;
      await loadProfile(); 
      document.getElementById('authScreen').style.display = 'none';
      showApp(); 
      //document.getElementById('appScreen').style.display  = 'block';
    } else if (event === 'SIGNED_OUT') {
      document.getElementById('appScreen').style.display  = 'none';
      document.getElementById('authScreen').style.display = 'flex';
    }
  });
}

// function showApp() {
//   document.getElementById('appScreen').style.display = 'block';
//   updateRateUI();
//   resetDisplays();
//   renderLog();
// }

async function showApp() {
  document.getElementById('appScreen').style.display = 'block';
  updateRateUI();
  const restored = await restoreActiveTimer();
  if (restored) {
    updateRateUI();
    if (appState === 'working') setUIWorking();
    if (appState === 'break')   setUIBreak();
    addLog('Session resumed', null);
    rafId = requestAnimationFrame(tick);
    showToast('⏱ Timer resumed — it kept running while you were away');
  } else {
    resetDisplays();
    renderLog();
  }
}

// ── TOAST ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── NAV ──
function goPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.textContent.trim().toLowerCase() === page));

  document.querySelectorAll('.mobile-tab').forEach(t => {
    const label = t.querySelector('.tab-label');
    t.classList.toggle('active', label && label.textContent.trim().toLowerCase() === page);
  });

  const pageEl = document.getElementById(
    'page' + page.charAt(0).toUpperCase() + page.slice(1)
  );
  if (pageEl) pageEl.classList.add('active');
  if (page === 'history')  loadHistory();
  if (page === 'settings') loadSettingsForm();
}

// ── HELPERS ──
const SYMS = { CAD:'$', USD:'$', EUR:'€', GBP:'£', AUD:'$', JPY:'¥' };
const sym  = () => SYMS[profile.currency] || '$';

function fmtHMS(ms) {
  const t = Math.floor(ms / 1000);
  return [Math.floor(t/3600), Math.floor((t%3600)/60), t%60]
    .map(n => String(n).padStart(2,'0')).join(':');
}

function fmtMoney(amount) {
  const v = Math.floor(amount * 100) / 100;
  return {
    dollars: Math.floor(v).toLocaleString(),
    cents:   String(Math.floor(v * 100) % 100).padStart(2,'0')
  };
}

function calcEarnings(ms) {
  return Math.floor((ms / 3_600_000) * profile.hourly_rate * 100) / 100;
}

// ── TRACKER ──
async function startWork() {
  if (appState !== 'idle') return;

  const inputRate = parseFloat(document.getElementById('rateInput').value);
  if (!inputRate || inputRate <= 0) {
    showToast('⚠️ Set your hourly rate first!');
    return;
  }
  profile.hourly_rate = inputRate;

  appState     = 'working';
  workStart    = Date.now();
  sessionStart = new Date();
  totalWorkMs  = 0;
  totalBreakMs = 0;
  breakCount   = 0;

  setUIWorking();
  addLog('Session started', null);
  rafId = requestAnimationFrame(tick);
  await saveActiveTimer();
}

async function toggleBreak() {
  if (appState === 'working') {
    totalWorkMs += Date.now() - workStart;
    breakStart   = Date.now();
    appState     = 'break';
    breakCount++;
    setUIBreak();
    addLog(`Break #${breakCount} started`, null);
  } else if (appState === 'break') {
    totalBreakMs += Date.now() - breakStart;
    workStart     = Date.now();
    appState      = 'working';
    setUIWorking();
    addLog(`Break #${breakCount} ended`, null);
  }
  await saveActiveTimer();
}

async function stopWork() {
  if (appState === 'idle') return;
  cancelAnimationFrame(rafId);

  const now = Date.now();
  if (appState === 'working') totalWorkMs  += now - workStart;
  if (appState === 'break')   totalBreakMs += now - breakStart;

  const earned = calcEarnings(totalWorkMs);
  addLog(`Session ended — ${fmtHMS(totalWorkMs)} worked`, earned);
  setUIIdle();
  appState = 'idle';
  await clearActiveTimer();

  if (user) {
    try {
      await sb.from('sessions').insert({
        user_id:           user.id,
        started_at:        sessionStart.toISOString(),
        ended_at:          new Date().toISOString(),
        work_duration_ms:  Math.round(totalWorkMs),
        break_duration_ms: Math.round(totalBreakMs),
        break_count:       breakCount,
        hourly_rate:       profile.hourly_rate,
        currency:          profile.currency,
        total_earned:      Math.floor(earned * 10000) / 10000,
        client_name:       'Default',
        notes:             null,
      });
      showToast('✓ Session saved!');
    } catch(e) {
      console.error(e);
      showToast('Session ended but could not save.');
    }
  }

  resetDisplays();
}

// ── TICK LOOP ──
function tick() {
  const now = Date.now();
  let workMs, elapsed;

  if (appState === 'working') {
    workMs  = totalWorkMs + (now - workStart);
    elapsed = workMs + totalBreakMs;
  } else if (appState === 'break') {
    workMs  = totalWorkMs;
    elapsed = workMs + totalBreakMs + (now - breakStart);
  } else return;

  const timerEl = document.getElementById('timerDisplay');
  if (timerEl) timerEl.textContent = fmtHMS(elapsed);

  const earned = calcEarnings(workMs);
  const { dollars, cents } = fmtMoney(earned);
  const s = sym();

  const moneyEl = document.getElementById('moneyNum');
  if (moneyEl) moneyEl.innerHTML =
    `<span class="sym">${s}</span>${dollars}<span class="cts">.${cents}</span>`;

  const subEl = document.getElementById('moneySub');
  if (subEl) subEl.textContent =
    `${s}${(profile.hourly_rate/3600).toFixed(5)} / sec  ·  ${s}${profile.hourly_rate.toFixed(2)} / hr`;

  const swEl = document.getElementById('statWork');
  if (swEl) swEl.textContent = fmtHMS(workMs);

  const sbEl = document.getElementById('statBreak');
  if (sbEl) sbEl.textContent = fmtHMS(
    appState === 'break' ? totalBreakMs + (now - breakStart) : totalBreakMs
  );

  const spEl = document.getElementById('statPerMin');
  if (spEl) spEl.textContent = `${s}${(profile.hourly_rate/60).toFixed(3)}`;

  rafId = requestAnimationFrame(tick);
}

// ── UI STATES ──
function setUIWorking() {
  document.getElementById('moneyNum').className      = 'money-number working';
  document.getElementById('timerDisplay').className  = 'timer-display';
  document.getElementById('statusPill').className    = 'status-pill working';
  document.getElementById('statusLabel').textContent = 'Working';
  document.getElementById('btnStart').disabled       = true;
  document.getElementById('btnBreak').disabled       = false;
  document.getElementById('btnBreak').textContent    = '⏸ Break';
  document.getElementById('btnStop').disabled        = false;
}

function setUIBreak() {
  document.getElementById('moneyNum').className      = 'money-number on-break';
  document.getElementById('timerDisplay').className  = 'timer-display on-break';
  document.getElementById('statusPill').className    = 'status-pill break';
  document.getElementById('statusLabel').textContent = 'On Break';
  document.getElementById('btnBreak').textContent    = '▶ Resume';
}

function setUIIdle() {
  document.getElementById('moneyNum').className      = 'money-number idle';
  document.getElementById('timerDisplay').className  = 'timer-display';
  document.getElementById('statusPill').className    = 'status-pill idle';
  document.getElementById('statusLabel').textContent = 'Idle';
  document.getElementById('btnStart').disabled       = false;
  document.getElementById('btnBreak').disabled       = true;
  document.getElementById('btnBreak').textContent    = '⏸ Break';
  document.getElementById('btnStop').disabled        = true;
}

function resetDisplays() {
  const s = sym();
  const mn = document.getElementById('moneyNum');
  if (mn) mn.innerHTML = `<span class="sym">${s}</span>0<span class="cts">.00</span>`;
  const td = document.getElementById('timerDisplay');
  if (td) td.textContent = '00:00:00';
  const ms = document.getElementById('moneySub');
  if (ms) ms.textContent = 'set your rate and press start';
  ['statWork','statBreak'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '00:00:00';
  });
  const sp = document.getElementById('statPerMin');
  if (sp) sp.textContent = '—';
}

// ── LOG ──
function addLog(event, earned) {
  logRows.unshift({ time: new Date().toTimeString().slice(0,8), event, earned });
  renderLog();
}

function renderLog() {
  const box = document.getElementById('logBox');
  if (!box) return;
  const s = sym();
  if (!logRows.length) {
    box.innerHTML = '<div class="log-empty">No activity yet — press Start</div>';
    return;
  }
  box.innerHTML = logRows.map(r => `
    <div class="log-row">
      <span class="log-time">${r.time}</span>
      <span class="log-event">${r.event}</span>
      <span class="log-earn">${r.earned !== null ? s + r.earned.toFixed(4) : ''}</span>
    </div>
  `).join('');
}

function clearLog() { logRows = []; renderLog(); }

// ── HISTORY ──
async function loadHistory() {
  if (!user) return;
  const listEl = document.getElementById('sessionsList');
  if (listEl) listEl.innerHTML = '<div class="no-sessions">Loading...</div>';

  const { data, error } = await sb
    .from('sessions').select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) {
    if (listEl) listEl.innerHTML = '<div class="no-sessions">Could not load sessions.</div>';
    return;
  }

  const totalEarned = data.reduce((a, r) => a + parseFloat(r.total_earned || 0), 0);
  const totalMs     = data.reduce((a, r) => a + parseInt(r.work_duration_ms || 0), 0);
  const s           = sym();

  const he = document.getElementById('histEarned');
  if (he) he.textContent = `${s}${totalEarned.toFixed(2)}`;

  const hh = document.getElementById('histHours');
  if (hh) hh.textContent =
    `${Math.floor(totalMs/3600000)}h ${Math.floor((totalMs%3600000)/60000)}m`;

  const hc = document.getElementById('histCount');
  if (hc) hc.textContent = data.length;

  if (!data.length) {
    if (listEl) listEl.innerHTML =
      '<div class="no-sessions">No sessions yet — start your first session!</div>';
    return;
  }

  if (listEl) listEl.innerHTML = data.map(row => {
    const d     = new Date(row.started_at);
    const date  = d.toLocaleDateString('en-CA', { month:'short', day:'numeric', year:'numeric' });
    const time  = d.toLocaleTimeString('en-CA', { hour:'2-digit', minute:'2-digit' });
    const dur   = fmtHMS(parseInt(row.work_duration_ms || 0));
    const earn  = parseFloat(row.total_earned || 0).toFixed(2);
    const notes = row.notes || '—';
    return `
      <div class="session-row">
        <span class="s-date">${date}<br>${time}</span>
        <span class="s-notes">${notes}</span>
        <span class="s-dur">${dur}</span>
        <span class="s-earn">${s}${earn}</span>
        <button class="btn-del" onclick="deleteSession('${row.id}')" title="Delete">×</button>
      </div>
    `;
  }).join('');
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  const { error } = await sb.from('sessions').delete()
    .eq('id', id).eq('user_id', user.id);
  if (error) { showToast('Could not delete.'); return; }
  showToast('Session deleted.');
  loadHistory();
}

// ── PROFILE ──
async function loadProfile() {
  if (!user) return;
  const { data } = await sb.from('profiles')
    .select('*').eq('id', user.id).single();
  if (data) {
    profile.full_name   = data.full_name   || '';
    profile.hourly_rate = data.hourly_rate || 50;
    profile.currency    = data.currency    || 'CAD';
  }
}

async function saveSettings() {
  const name     = document.getElementById('setName').value.trim();
  const rate     = parseFloat(document.getElementById('setRate').value) || 50;
  const currency = document.getElementById('setCurrency').value;

  profile.full_name   = name;
  profile.hourly_rate = rate;
  profile.currency    = currency;

  if (user) {
    const { error } = await sb.from('profiles').upsert({
      id:          user.id,
      full_name:   name,
      hourly_rate: rate,
      currency:    currency
    });
    if (error) { showToast('Could not save settings.'); return; }
  }

  updateRateUI();

  const el = document.getElementById('saveMsg');
  el.textContent = '✓ Settings saved to your account!';
  setTimeout(() => el.textContent = '', 3000);
}

function updateRateUI() {
  const s = sym();
  const rateEl = document.getElementById('rateInput');
  if (rateEl) rateEl.value = profile.hourly_rate;
  const rateSymEl = document.getElementById('rateSym');
  if (rateSymEl) rateSymEl.textContent = s;
  const moneySymEl = document.getElementById('moneySym');
  if (moneySymEl) moneySymEl.textContent = s;
  const rateSuffixEl = document.getElementById('rateSuffix');
  if (rateSuffixEl) rateSuffixEl.textContent = `/ hr · ${profile.currency}`;
  const greetEl = document.getElementById('navGreeting');
  if (greetEl && profile.full_name)
    greetEl.textContent = `Hi, ${profile.full_name.split(' ')[0]} 👋`;
}

function loadSettingsForm() {
  const nameEl = document.getElementById('setName');
  if (nameEl) nameEl.value = profile.full_name;
  const rateEl = document.getElementById('setRate');
  if (rateEl) rateEl.value = profile.hourly_rate;
  const currEl = document.getElementById('setCurrency');
  if (currEl) currEl.value = profile.currency;
}

// ── ACTIVETIMER ──
async function saveActiveTimer() {
  if (!user) return;
  await sb.from('profiles').update({
    active_timer: {
      appState, workStart, breakStart,
      totalWorkMs, totalBreakMs, breakCount,
      sessionStart: sessionStart ? sessionStart.toISOString() : null,
      hourly_rate: profile.hourly_rate,
      currency: profile.currency,
    }
  }).eq('id', user.id);
}

async function clearActiveTimer() {
  if (!user) return;
  await sb.from('profiles').update({ active_timer: null }).eq('id', user.id);
}

async function restoreActiveTimer() {
  if (!user) return false;
  const { data } = await sb.from('profiles').select('active_timer').eq('id', user.id).single();
  const s = data?.active_timer;
  if (!s || !s.appState || s.appState === 'idle') return false;
  appState = s.appState;
  workStart = s.workStart;
  breakStart = s.breakStart;
  totalWorkMs = s.totalWorkMs || 0;
  totalBreakMs = s.totalBreakMs || 0;
  breakCount = s.breakCount || 0;
  sessionStart = s.sessionStart ? new Date(s.sessionStart) : new Date();
  profile.hourly_rate = s.hourly_rate || profile.hourly_rate;
  profile.currency = s.currency || profile.currency;
  return true;
}

init();
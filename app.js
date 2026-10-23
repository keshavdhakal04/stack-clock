// ── SUPABASE ──
const SUPABASE_URL = 'https://psefgnjgdkrlhxqdqmyz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzZWZnbmpnZGtybGh4cWRxbXl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjkxMTIsImV4cCI6MjA4OTAwNTExMn0.jhLYQReM3qQUEN63lW-tjBttsp6YlfhtiuA8HfnTDRU';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY); // anon key: safe only with correct RLS

// ── HELPERS ──
const $ = id => document.getElementById(id);
const SYMS = { CAD: '$', USD: '$', EUR: '€', GBP: '£', AUD: '$', JPY: '¥' };
const symFor = c => SYMS[c] || '$';
const pad = n => String(n).padStart(2, '0');

// Safe DOM builder: strings become text nodes, never HTML.
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().filter(c => c != null && c !== false).forEach(c => n.append(c));
  return n;
}

function fmtHMS(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map(pad).join(':');
}

// Money is computed in integer cents to avoid float drift.
function calcCents(ms, rate) {
  return Math.floor((Math.max(0, ms) * Math.round(rate * 100)) / 3_600_000);
}
function splitCents(c) {
  return { dollars: Math.floor(c / 100).toLocaleString(), cents: pad(c % 100) };
}
function fmtCur(amount, currency) {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(amount);
  } catch { return `${symFor(currency)}${Number(amount).toFixed(2)}`; }
}
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── STATE ──
let user = null, appUserId = null, entering = null;
let profile = { full_name: '', hourly_rate: 50, currency: 'CAD' };
let appState = 'idle';          // 'idle' | 'working' | 'break'
let workStart = null, breakStart = null;   // epoch ms of the CURRENT segment only
let totalWorkMs = 0, totalBreakMs = 0;     // accumulated, completed segments
let breakCount = 0, sessionStart = null;
let sessionRate = 0, sessionCurrency = 'CAD'; // frozen for the whole session
let rafId = null, busy = false, saveChain = Promise.resolve();
let logRows = [];
const LONG_SEGMENT_MS = 16 * 3_600_000;

const nowWorkMs = (now = Date.now()) => totalWorkMs + (appState === 'working' ? Math.max(0, now - workStart) : 0);
const nowBreakMs = (now = Date.now()) => totalBreakMs + (appState === 'break' ? Math.max(0, now - breakStart) : 0);
const activeRate = () => (appState === 'idle' ? profile.hourly_rate : sessionRate);
const activeCurrency = () => (appState === 'idle' ? profile.currency : sessionCurrency);

function resetTimerState() {
  appState = 'idle'; workStart = breakStart = sessionStart = null;
  totalWorkMs = totalBreakMs = breakCount = 0;
}

// ── AUTH ──
function authTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) =>
    b.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'signup')));
  $('loginForm').style.display = tab === 'login' ? 'block' : 'none';
  $('signupForm').style.display = tab === 'signup' ? 'block' : 'none';
  $('authMsg').style.display = 'none';
}

function showMsg(msg, type = 'error') {
  const e = $('authMsg');
  e.textContent = msg;
  e.className = `auth-msg ${type}`;
  e.style.display = 'block';
}

async function doLogin() {
  const email = $('loginEmail').value.trim();
  const pass = $('loginPass').value;
  if (!email || !pass) { showMsg('Please fill in both fields.'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) showMsg(error.message);
}

async function doSignup() {
  const name = $('signupName').value.trim();
  const email = $('signupEmail').value.trim();
  const pass = $('signupPass').value;
  if (!name) { showMsg('Please enter your name.'); return; }
  if (!email || !pass) { showMsg('Please fill in all fields.'); return; }
  if (pass.length < 6) { showMsg('Password must be at least 6 characters.'); return; }

  // Name travels in user metadata so it survives email-confirmation flows
  // (no session exists yet, so a profiles upsert here would be blocked by RLS).
  const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { full_name: name } } });
  if (error) { showMsg(error.message); return; }
  if (data?.session) {
    await sb.from('profiles').upsert({ id: data.user.id, full_name: name, hourly_rate: 50, currency: 'CAD' });
  }
  showMsg('✓ Account created! Check your email to confirm.', 'success');
}

async function doLogout() {
  if (busy) return;
  busy = true;
  try {
    if (appState !== 'idle') {
      const ok = await persist(); // never drop a running timer silently
      if (!ok && !confirm('Could not sync your running timer. Sign out anyway? It will be restored from this device.')) return;
    }
    await sb.auth.signOut();
    leaveApp();
  } finally { busy = false; }
}

function showAuth() {
  $('loading').style.display = 'none';
  $('authScreen').style.display = 'flex';
}

function leaveApp() {
  stopLoop();
  resetTimerState();
  user = null; appUserId = null; logRows = [];
  renderState(); resetDisplays(); renderLog();
  $('appScreen').style.display = 'none';
  showAuth();
}

// Single entry point: ignores duplicate SIGNED_IN events (tab refocus, init + listener overlap).
function enterApp(u) {
  if (appUserId === u.id) return Promise.resolve();
  if (entering) return entering;
  entering = (async () => {
    user = u;
    await loadProfile();
    $('loading').style.display = 'none';
    $('authScreen').style.display = 'none';
    await showApp();
    appUserId = u.id;
  })().finally(() => { entering = null; });
  return entering;
}

async function init() {
  const timeout = setTimeout(showAuth, 6000);
  try {
    const { data: { session } } = await sb.auth.getSession();
    clearTimeout(timeout);
    if (session?.user) await enterApp(session.user);
    else showAuth();
  } catch (e) {
    clearTimeout(timeout);
    console.error(e);
    showAuth();
  }

  // Do not await Supabase calls inside this callback (can deadlock the client): defer.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) setTimeout(() => enterApp(session.user).catch(console.error), 0);
    else if (event === 'SIGNED_OUT') setTimeout(leaveApp, 0);
  });
}

async function showApp() {
  $('appScreen').style.display = 'block';
  const restored = await restoreActiveTimer();
  updateRateUI();
  renderState();

console.log('[StackClock restore]', {
  state: appState,
  restored,
  stopDisabled: $('btnStop').disabled,
  breakDisabled: $('btnBreak').disabled,
  activeTimer: snapshot()
});
  if (restored) {
    addLog('Session resumed', null);
    startLoop();
    const seg = Date.now() - (appState === 'working' ? workStart : breakStart);
    showToast(seg > LONG_SEGMENT_MS
      ? '⚠ This timer has run for over 16 hours. Stop it to review.'
      : '⏱ Timer resumed. It kept running while you were away.');
  } else {
    resetDisplays();
    renderLog();
  }
}

// ── NAV ──
function goPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => {
    const on = t.textContent.trim().toLowerCase() === page;
    t.classList.toggle('active', on);
    on ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current');
  });
  document.querySelectorAll('.mobile-tab').forEach(t => {
    const label = t.querySelector('.tab-label');
    const on = !!label && label.textContent.trim().toLowerCase() === page;
    t.classList.toggle('active', on);
    on ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current');
  });
  const pageEl = $('page' + page.charAt(0).toUpperCase() + page.slice(1));
  if (pageEl) pageEl.classList.add('active');
  if (page === 'history') loadHistory();
  if (page === 'settings') loadSettingsForm();
}

// ── TIMER PERSISTENCE ──
const localKey = uid => `stackclock.timer.${uid}`;

function snapshot() {
  if (appState === 'idle') return null;
  return {
    appState, workStart, breakStart, totalWorkMs, totalBreakMs, breakCount,
    sessionStart: sessionStart ? sessionStart.toISOString() : null,
    hourly_rate: sessionRate, currency: sessionCurrency, savedAt: Date.now(),
  };
}

function writeLocal(uid, snap, unsynced) {
  try {
    if (snap) localStorage.setItem(localKey(uid), JSON.stringify({ ...snap, unsynced }));
    else localStorage.removeItem(localKey(uid));
  } catch { /* storage unavailable: remote copy still applies */ }
}
function readLocal(uid) {
  try { return JSON.parse(localStorage.getItem(localKey(uid)) || 'null'); } catch { return null; }
}

async function writeRemote(uid, snap) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const { error } = await sb.from('profiles').update({ active_timer: snap }).eq('id', uid);
    if (!error) return;
    lastErr = error;
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  throw lastErr;
}

// Writes are chained so older snapshots can never overwrite newer ones.
function persist(snap = snapshot()) {
  if (!user) return Promise.resolve(true);
  const uid = user.id;
  writeLocal(uid, snap, true);
  saveChain = saveChain.then(async () => {
    try {
      await writeRemote(uid, snap);
      writeLocal(uid, snap, false);
      return true;
    } catch (e) {
      console.error(e);
      showToast('⚠ Could not sync timer. Saved on this device.');
      return false;
    }
  });
  return saveChain;
}

// Returns a sanitised snapshot or null. Segment start must be a plausible epoch ms.
function validateSnap(s) {
  if (!s || (s.appState !== 'working' && s.appState !== 'break')) return null;
  const now = Date.now();
  const ms = v => (Number.isFinite(+v) && +v >= 0 ? +v : null);
  const seg = ms(s.appState === 'working' ? s.workStart : s.breakStart);
  if (seg === null || seg < 1e12) return null;
  const rate = +s.hourly_rate > 0 ? +s.hourly_rate : profile.hourly_rate;
  return {
    appState: s.appState,
    workStart: s.appState === 'working' ? Math.min(seg, now) : null,
    breakStart: s.appState === 'break' ? Math.min(seg, now) : null,
    totalWorkMs: ms(s.totalWorkMs) ?? 0,
    totalBreakMs: ms(s.totalBreakMs) ?? 0,
    breakCount: Math.floor(ms(s.breakCount) ?? 0),
    sessionStart: s.sessionStart && !isNaN(new Date(s.sessionStart)) ? new Date(s.sessionStart) : new Date(Math.min(seg, now)),
    rate,
    currency: SYMS[s.currency] ? s.currency : profile.currency,
  };
}

async function restoreActiveTimer() {
  if (!user) return false;
  let remote = null, remoteOk = true;
  try {
    const { data, error } = await sb.from('profiles').select('active_timer').eq('id', user.id).maybeSingle();
    if (error) throw error;
    remote = data?.active_timer || null;
  } catch (e) {
    remoteOk = false;
    console.error(e);
    showToast('⚠ Could not reach server. Using this device’s copy.');
  }
  const local = readLocal(user.id);
  // Server is authoritative, unless this device holds a newer change that never synced.
  const newerLocal = local && local.unsynced && (local.savedAt || 0) >= ((remote && remote.savedAt) || 0);
  const raw = remoteOk ? (newerLocal ? local : remote) : local;
  if (!raw) { writeLocal(user.id, null); return false; }

  const v = validateSnap(raw);
  if (!v) {
    showToast('Saved timer data was invalid and was discarded.');
    await persist(null);
    return false;
  }
  appState = v.appState; workStart = v.workStart; breakStart = v.breakStart;
  totalWorkMs = v.totalWorkMs; totalBreakMs = v.totalBreakMs; breakCount = v.breakCount;
  sessionStart = v.sessionStart; sessionRate = v.rate; sessionCurrency = v.currency;
  if (newerLocal) persist(); // push the device copy up
  return true;
}

// ── TIMER ACTIONS ──
function startLoop() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick); }
function stopLoop() { cancelAnimationFrame(rafId); rafId = null; }

async function startWork() {
  if (busy || appState !== 'idle') return;
  const rate = parseFloat($('rateInput').value);
  if (!(rate > 0)) { showToast('⚠ Set your hourly rate first.'); return; }
  busy = true;
  try {
    const now = Date.now();
    profile.hourly_rate = rate;
    sessionRate = rate; sessionCurrency = profile.currency;
    appState = 'working'; workStart = now; breakStart = null;
    totalWorkMs = totalBreakMs = breakCount = 0;
    sessionStart = new Date(now);
    renderState();
    addLog('Session started', null);
    startLoop();
    await persist();
  } finally { busy = false; }
}

async function toggleBreak() {
  if (busy || appState === 'idle') return;
  busy = true;
  try {
    const now = Date.now();
    if (appState === 'working') {
      totalWorkMs += Math.max(0, now - workStart);
      breakStart = now; workStart = null; appState = 'break'; breakCount++;
      addLog(`Break #${breakCount} started`, null);
    } else {
      totalBreakMs += Math.max(0, now - breakStart);
      workStart = now; breakStart = null; appState = 'working';
      addLog(`Break #${breakCount} ended`, null);
    }
    renderState();
    startLoop();
    await persist();
  } finally { busy = false; }
}

async function stopWork() {
  if (busy || appState === 'idle') return;
  busy = true;
  try {
    // Totals are computed without mutating state, so a failed save leaves the timer intact.
    const now = Date.now();
    const workMs = Math.round(nowWorkMs(now));
    const breakMs = Math.round(nowBreakMs(now));
    const cents = calcCents(workMs, sessionRate);

    if (workMs >= 1000) {
      const { error } = await sb.from('sessions').insert({
        user_id: user.id,
        started_at: sessionStart.toISOString(),
        ended_at: new Date(now).toISOString(),
        work_duration_ms: workMs,
        break_duration_ms: breakMs,
        break_count: breakCount,
        hourly_rate: sessionRate,
        currency: sessionCurrency,
        total_earned: cents / 100,
        client_name: 'Default',
        notes: null,
      });
      if (error) {
        console.error(error);
        showToast('⚠ Could not save the session. Timer is still running, try Stop again.');
        return;
      }
      showToast('✓ Session saved.');
    } else {
      showToast('Session under 1 second. Not saved.');
    }

    addLog(`Session ended: ${fmtHMS(workMs)} worked`, cents / 100);
    stopLoop();
    resetTimerState();
    renderState();
    resetDisplays();
    await persist(null); // clear only after the session is safely stored
  } finally { busy = false; }
}

// ── TICK ──
let lastMoney = '';
function tick() {
  if (appState === 'idle') { rafId = null; return; }
  const now = Date.now();
  const workMs = nowWorkMs(now), breakMs = nowBreakMs(now);
  const s = symFor(sessionCurrency);

  $('timerDisplay').textContent = fmtHMS(workMs + breakMs);
  const { dollars, cents } = splitCents(calcCents(workMs, sessionRate));
  const money = `${s}|${dollars}|${cents}`;
  if (money !== lastMoney) {
    lastMoney = money;
    $('moneyNum').innerHTML = `<span class="sym" id="moneySym">${s}</span>${dollars}<span class="cts">.${cents}</span>`;
  }
  $('moneySub').textContent = `${s}${(sessionRate / 3600).toFixed(5)} / sec  ·  ${s}${sessionRate.toFixed(2)} / hr`;
  $('statWork').textContent = fmtHMS(workMs);
  $('statBreak').textContent = fmtHMS(breakMs);
  $('statPerMin').textContent = `${s}${(sessionRate / 60).toFixed(3)}`;
  rafId = requestAnimationFrame(tick);
}

// ── RENDER ──
// One function sets every control explicitly, so no state can inherit a stale disabled flag.
function renderState() {
  const st = appState;
  $('moneyNum').className = 'money-number ' + (st === 'working' ? 'working' : st === 'break' ? 'on-break' : 'idle');
  $('timerDisplay').className = 'timer-display' + (st === 'break' ? ' on-break' : '');
  $('statusPill').className = 'status-pill ' + (st === 'working' ? 'working' : st === 'break' ? 'break' : 'idle');
  $('statusLabel').textContent = st === 'working' ? 'Working' : st === 'break' ? 'On Break' : 'Idle';
  $('btnStart').disabled = st !== 'idle';
  $('btnBreak').disabled = st === 'idle';
  $('btnBreak').textContent = st === 'break' ? '▶ Resume' : '⏸ Break';
  $('btnStop').disabled = st === 'idle';
  $('rateInput').disabled = st !== 'idle';
  lastMoney = '';
}

function resetDisplays() {
  const s = symFor(profile.currency);
  $('moneyNum').innerHTML = `<span class="sym" id="moneySym">${s}</span>0<span class="cts">.00</span>`;
  $('timerDisplay').textContent = '00:00:00';
  $('moneySub').textContent = 'set your rate and press start';
  $('statWork').textContent = '00:00:00';
  $('statBreak').textContent = '00:00:00';
  $('statPerMin').textContent = '—';
}

function updateRateUI() {
  $('rateInput').value = activeRate();
  $('rateSym').textContent = symFor(activeCurrency());
  const ms = $('moneySym'); if (ms) ms.textContent = symFor(activeCurrency());
  $('rateSuffix').textContent = `/ hr · ${activeCurrency()}`;
  if (profile.full_name) $('navGreeting').textContent = `Hi, ${profile.full_name.split(' ')[0]} 👋`;
}

// ── LOG ──
function addLog(event, earned) {
  logRows.unshift({ time: new Date().toTimeString().slice(0, 8), event, earned, cur: activeCurrency() });
  renderLog();
}
function renderLog() {
  const box = $('logBox');
  if (!logRows.length) { box.replaceChildren(el('div', { class: 'log-empty' }, 'No activity yet. Press Start.')); return; }
  box.replaceChildren(...logRows.map(r => el('div', { class: 'log-row' },
    el('span', { class: 'log-time' }, r.time),
    el('span', { class: 'log-event' }, r.event),
    el('span', { class: 'log-earn' }, r.earned !== null ? fmtCur(r.earned, r.cur) : ''))));
}
function clearLog() { logRows = []; renderLog(); }

// ── DIALOGS ──
function makeDialog(title, ...body) {
  const d = el('dialog', { 'aria-label': title }, el('h2', { class: 'settings-card-header' }, title), ...body);
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

function confirmDialog(title, msg, okLabel) {
  return new Promise(resolve => {
    let ok = false;
    const d = makeDialog(title,
      el('p', { style: 'margin:16px 0;font-size:14px' }, msg),
      el('div', { class: 'controls', style: 'grid-template-columns:1fr 1fr;margin:0' },
        el('button', { type: 'button', class: 'btn-ctrl', onclick: () => d.close() }, 'Cancel'),
        el('button', { type: 'button', class: 'btn-ctrl btn-stop', onclick: () => { ok = true; d.close(); } }, okLabel)));
    d.addEventListener('close', () => resolve(ok));
  });
}

function field(id, label, attrs) {
  const input = el('input', { id, ...attrs });
  return { input, node: el('div', { class: 'field' }, el('label', { for: id }, label), input) };
}

// Create (row = null) or edit a session. Currency is preserved; earnings are recalculated
// from the edited duration and rate. Break time is subtracted from the span to get work time.
function openSessionDialog(row) {
  const editing = !!row;
  const cur = row?.currency || profile.currency;
  const end0 = row ? new Date(row.ended_at || row.started_at) : new Date();
  const start0 = row ? new Date(row.started_at) : new Date(end0.getTime() - 3_600_000);
  const f = {
    start: field('fStart', 'Start', { type: 'datetime-local', value: toLocalInput(start0) }),
    end: field('fEnd', 'End', { type: 'datetime-local', value: toLocalInput(end0) }),
    brk: field('fBreak', 'Break (minutes)', { type: 'number', min: '0', step: '1', value: String(Math.round((row?.break_duration_ms || 0) / 60000)) }),
    rate: field('fRate', `Hourly rate (${cur})`, { type: 'number', min: '0', step: '0.01', value: String(row?.hourly_rate ?? profile.hourly_rate) }),
    notes: field('fNotes', 'Notes', { type: 'text', maxlength: '200', value: row?.notes || '' }),
  };
  const msg = el('div', { class: 'auth-msg error', role: 'alert' });
  const err = t => { msg.textContent = t; msg.style.display = 'block'; };
  const saveBtn = el('button', { type: 'button', class: 'btn-primary' }, editing ? 'Save changes' : 'Add session');

  const d = makeDialog(editing ? 'Edit session' : 'Add session',
    el('div', { style: 'margin-top:16px' }, ...Object.values(f).map(x => x.node)),
    msg, saveBtn,
    el('div', { style: 'display:flex;justify-content:space-between;margin-top:14px' },
      el('button', { type: 'button', class: 'btn-clear', onclick: () => d.close() }, 'Cancel'),
      editing ? el('button', { type: 'button', class: 'btn-clear', onclick: () => { d.close(); deleteSession(row.id); } }, 'Delete session') : null));

  saveBtn.addEventListener('click', async () => {
    msg.style.display = 'none';
    const s = new Date(f.start.input.value), e = new Date(f.end.input.value);
    if (isNaN(s) || isNaN(e)) return err('Enter a valid start and end time.');
    if (e <= s) return err('End must be after start.');
    if (e.getTime() > Date.now() + 60_000) return err('End time is in the future.');
    const brk = Math.round(parseFloat(f.brk.input.value || '0') * 60_000);
    if (!(brk >= 0)) return err('Break cannot be negative.');
    const span = e - s;
    if (brk >= span) return err('Break must be shorter than the session.');
    const rate = parseFloat(f.rate.input.value);
    if (!(rate >= 0)) return err('Enter a valid hourly rate.');
    const work = span - brk;
    const payload = {
      started_at: s.toISOString(), ended_at: e.toISOString(),
      work_duration_ms: work, break_duration_ms: brk,
      hourly_rate: rate, total_earned: calcCents(work, rate) / 100,
      notes: f.notes.input.value.trim() || null,
    };
    saveBtn.disabled = true;
    let res;
    if (editing) {
      res = await sb.from('sessions').update(payload).eq('id', row.id).eq('user_id', user.id).select('id');
      if (!res.error && !res.data?.length) res = { error: new Error('No row updated') };
    } else {
      res = await sb.from('sessions').insert({
        ...payload, user_id: user.id, currency: cur,
        break_count: brk > 0 ? 1 : 0, client_name: 'Default',
      });
    }
    saveBtn.disabled = false;
    if (res.error) { console.error(res.error); return err('Could not save. Please try again.'); }
    d.close();
    showToast(editing ? '✓ Session updated.' : '✓ Session added.');
    loadHistory();
  });
}

// ── HISTORY ──
let historyRows = [], historyShown = 0;
const HISTORY_FETCH = 500, HISTORY_PAGE = 50;

function ensureHistoryTools() {
  if ($('btnAddSession')) return;
  const btn = el('button', { type: 'button', class: 'btn-save', id: 'btnAddSession', style: 'margin-bottom:22px', onclick: () => openSessionDialog(null) }, '+ Add manual session');
  document.querySelector('.history-page .summary-row').before(btn);
}

async function loadHistory() {
  if (!user) return;
  ensureHistoryTools();
  const listEl = $('sessionsList');
  listEl.replaceChildren(el('div', { class: 'no-sessions' }, 'Loading…'));

  const { data, error } = await sb.from('sessions').select('*')
    .eq('user_id', user.id).order('started_at', { ascending: false }).limit(HISTORY_FETCH);
  if (error || !data) {
    console.error(error);
    listEl.replaceChildren(el('div', { class: 'no-sessions' }, 'Could not load sessions.'));
    return;
  }
  historyRows = data; historyShown = 0;

  // Totals are never mixed across currencies.
  const byCur = new Map();
  let totalMs = 0;
  data.forEach(r => {
    const c = r.currency || 'CAD';
    byCur.set(c, (byCur.get(c) || 0) + parseFloat(r.total_earned || 0));
    totalMs += parseInt(r.work_duration_ms || 0, 10);
  });
  $('histEarned').textContent = byCur.size
    ? [...byCur].map(([c, v]) => fmtCur(v, c)).join(' + ')
    : fmtCur(0, profile.currency);
  $('histHours').textContent = `${Math.floor(totalMs / 3_600_000)}h ${Math.floor((totalMs % 3_600_000) / 60_000)}m`;
  $('histCount').textContent = data.length >= HISTORY_FETCH ? `${data.length}+` : String(data.length);

  renderHistoryMore(true);
}

function renderHistoryMore(reset) {
  const listEl = $('sessionsList');
  if (!historyRows.length) {
    listEl.replaceChildren(el('div', { class: 'no-sessions' }, 'No sessions yet. Start your first session or add one manually.'));
    return;
  }
  if (reset) listEl.replaceChildren();
  listEl.querySelector('.more-row')?.remove();

  historyRows.slice(historyShown, historyShown + HISTORY_PAGE).forEach(r => listEl.append(sessionRow(r)));
  historyShown = Math.min(historyRows.length, historyShown + HISTORY_PAGE);

  if (historyShown < historyRows.length || historyRows.length >= HISTORY_FETCH) {
    const more = historyShown < historyRows.length;
    listEl.append(el('div', { class: 'no-sessions more-row' },
      more ? el('button', { type: 'button', class: 'btn-clear', onclick: () => renderHistoryMore(false) }, `Show more (${historyRows.length - historyShown} left)`)
        : `Showing your latest ${HISTORY_FETCH} sessions.`));
  }
}

function sessionRow(r) {
  const d = new Date(r.started_at);
  const date = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
  const open = () => openSessionDialog(r);
  const row = el('div', {
    class: 'session-row', role: 'button', tabindex: '0',
    'aria-label': `Edit session from ${date} ${time}`, style: 'cursor:pointer',
    onclick: open,
    onkeydown: e => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } },
  },
    el('span', { class: 's-date' }, date, document.createElement('br'), time),
    el('span', { class: 's-notes' }, r.notes || '—'),
    el('span', { class: 's-dur' }, fmtHMS(parseInt(r.work_duration_ms || 0, 10))),
    el('span', { class: 's-earn' }, fmtCur(parseFloat(r.total_earned || 0), r.currency || 'CAD')),
    el('button', {
      type: 'button', class: 'btn-del', title: 'Delete', 'aria-label': `Delete session from ${date} ${time}`,
      onclick: e => { e.stopPropagation(); deleteSession(r.id); },
    }, '×'));
  return row;
}

async function deleteSession(id) {
  const ok = await confirmDialog('Delete session', 'This permanently deletes the session. This cannot be undone.', 'Delete');
  if (!ok) return;
  // .select() lets us detect a silent no-op (e.g. a row RLS did not allow us to delete).
  const { data, error } = await sb.from('sessions').delete().eq('id', id).eq('user_id', user.id).select('id');
  if (error || !data?.length) { console.error(error); showToast('⚠ Could not delete the session.'); return; }
  showToast('Session deleted.');
  loadHistory();
}

// ── PROFILE / SETTINGS ──
async function loadProfile() {
  if (!user) return;
  const { data, error } = await sb.from('profiles').select('full_name,hourly_rate,currency').eq('id', user.id).maybeSingle();
  if (error) { console.error(error); showToast('⚠ Could not load your profile. Using defaults.'); }
  if (data) {
    profile.full_name = data.full_name || '';
    profile.hourly_rate = Number(data.hourly_rate) > 0 ? Number(data.hourly_rate) : 50;
    profile.currency = SYMS[data.currency] ? data.currency : 'CAD';
  } else if (!error) {
    // Missing profile row (e.g. email-confirmed signup): create it from signup metadata.
    profile.full_name = user.user_metadata?.full_name || '';
    const { error: e2 } = await sb.from('profiles').upsert({ id: user.id, full_name: profile.full_name, hourly_rate: 50, currency: 'CAD' });
    if (e2) console.error(e2);
  }
}

async function saveSettings() {
  const name = $('setName').value.trim();
  const rate = parseFloat($('setRate').value);
  const currency = $('setCurrency').value;
  if (!(rate > 0)) { showToast('⚠ Enter a valid hourly rate.'); return; }

  if (user) {
    const { error } = await sb.from('profiles').upsert({ id: user.id, full_name: name, hourly_rate: rate, currency });
    if (error) { console.error(error); showToast('⚠ Could not save settings.'); return; }
  }
  profile.full_name = name; profile.hourly_rate = rate; profile.currency = currency;
  updateRateUI();
  if (appState === 'idle') resetDisplays();

  const m = $('saveMsg');
  m.textContent = appState === 'idle'
    ? '✓ Settings saved to your account.'
    : '✓ Saved. The running session keeps its original rate and currency.';
  setTimeout(() => { m.textContent = ''; }, 4000);
}

function loadSettingsForm() {
  $('setName').value = profile.full_name;
  $('setRate').value = profile.hourly_rate;
  $('setCurrency').value = profile.currency;
}

init();
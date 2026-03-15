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

async function doLogout() {
  if (appState !== 'idle') {
    if (!confirm('You have an active session. Stop and sign out?')) return;
    cancelAnimationFrame(rafId);
    appState = 'idle';
  }
  await sb.auth.signOut();
  user    = null;
  logRows = [];
  document.getElementById('appScreen').style.display  = 'none';
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
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appScreen').style.display  = 'block';
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
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appScreen').style.display  = 'block';
    } else if (event === 'SIGNED_OUT') {
      document.getElementById('appScreen').style.display  = 'none';
      document.getElementById('authScreen').style.display = 'flex';
    }
  });
}

init();
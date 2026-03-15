// ── SUPABASE ──
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
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

// ── INIT ──
async function init() {
  console.log('StackClock loaded');
}

init();
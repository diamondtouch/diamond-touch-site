/* ============================================================
   DIAMOND TOUCH DETAILING — auth.js
   Shared auth utilities: session management, redirects, user state
   ============================================================ */

const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── Get current session ──────────────────────────────────── */
async function getSession() {
  const { data: { session } } = await _supabase.auth.getSession();
  return session;
}

/* ─── Get current user + profile ──────────────────────────── */
async function getUserProfile() {
  const session = await getSession();
  if (!session) return null;

  const { data: profile } = await _supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  return profile;
}

/* ─── Auth guard: redirect if not logged in ───────────────── */
async function requireAuth(redirectTo = '/portal/login.html') {
  const session = await getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

/* ─── Auth guard: redirect if not admin ───────────────────── */
async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;

  const profile = await getUserProfile();
  if (!profile || !profile.is_admin) {
    window.location.href = '/portal/dashboard.html';
    return null;
  }
  return profile;
}

/* ─── Sign out ─────────────────────────────────────────────── */
async function signOut() {
  await _supabase.auth.signOut();
  window.location.href = '/portal/login.html';
}

/* ─── Render nav auth state (main site) ───────────────────── */
async function updateNavAuthState() {
  const session = await getSession();

  const ids = [
    ['nav-account-link', 'nav-dash-link'],
    ['mobile-account-link', 'mobile-dash-link']
  ];

  for (const [accountId, dashId] of ids) {
    const accountLink = document.getElementById(accountId);
    const dashLink = document.getElementById(dashId);
    if (!accountLink || !dashLink) continue;

    if (session) {
      accountLink.style.display = 'none';
      dashLink.style.display = '';
    } else {
      accountLink.style.display = '';
      dashLink.style.display = 'none';
    }
  }
}

/* ─── Format cents as dollars ─────────────────────────────── */
function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(0);
}

/* ─── Format date ─────────────────────────────────────────── */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

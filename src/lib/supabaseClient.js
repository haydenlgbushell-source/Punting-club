// Google / Apple sign-in via Supabase Auth.
//
// The browser only uses Supabase for the sign-in hand-off (OAuth with PKCE).
// All data still goes through the Netlify functions; the public key here can't
// read any tables because Row Level Security denies everything to it
// (see supabase/migrations/20261108020000_lock_down_rls.sql).
//
// Enable by setting these in Netlify (they are public values):
//   VITE_SUPABASE_URL        https://<project>.supabase.co
//   VITE_SUPABASE_ANON_KEY   the project's anon / publishable key
//   VITE_AUTH_PROVIDERS      google,apple   (whichever are set up in Supabase)

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STORAGE_KEY = 'pc_oauth';

export const oauthProviders = String(import.meta.env.VITE_AUTH_PROVIDERS || '')
  .split(',').map(s => s.trim().toLowerCase())
  .filter(p => p === 'google' || p === 'apple');

const supabase = url && key
  ? createClient(url, key, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: false, // we exchange the code ourselves
        autoRefreshToken: false,   // the app refreshes tokens itself (api.js)
        persistSession: true,      // needed to keep the PKCE verifier across the redirect
        storageKey: STORAGE_KEY,
      },
    })
  : null;

export const oauthEnabled = !!supabase && oauthProviders.length > 0;

const clearSupabaseStorage = () => {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(STORAGE_KEY)).forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
};

// Send the browser to Google / Apple. It comes back to /?oauth=1&code=…
export async function startOAuth(provider) {
  if (!supabase) throw new Error('Google/Apple sign-in is not configured.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/?oauth=1` },
  });
  if (error) throw error;
}

export const isOAuthReturn = () => {
  try { return new URLSearchParams(window.location.search).has('oauth'); } catch { return false; }
};

// On return from Google / Apple: swap the one-time code for tokens and tidy the
// address bar. Returns { accessToken, refreshToken }.
export async function finishOAuthFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const providerError = params.get('error_description') || params.get('error');
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  if (providerError) throw new Error(providerError.replace(/\+/g, ' '));
  if (!code) throw new Error('Sign-in was cancelled.');
  if (!supabase) throw new Error('Google/Apple sign-in is not configured.');
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  clearSupabaseStorage(); // tokens now live in the app's own session store
  if (error || !data?.session) throw error || new Error('Sign-in failed. Please try again.');
  return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
}

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Ensures the e2e login user exists in the LOCAL Supabase before tests run. A
// `supabase db reset` wipes the auth schema, so a hand-made Studio user disappears
// on every reset — this recreates it automatically and idempotently.
//
// Uses only the anon key (local, not a secret) + signUp. For the signed-up user to
// be immediately usable, the local stack must have email confirmations OFF — set in
// supabase/config.toml ([auth.email] enable_confirmations = false). Hard guard:
// refuses any non-local URL, so it can never create a user against prod.
function fromDotenv(key: string): string | undefined {
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const m = txt.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return m ? m[1].trim() : undefined;
  } catch { return undefined; }
}

export default async function globalSetup() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) return; // specs self-skip without creds

  const url = process.env.VITE_SUPABASE_URL || fromDotenv('VITE_SUPABASE_URL') || 'http://127.0.0.1:54321';
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    console.warn('[global-setup] non-local Supabase URL — refusing to touch users:', url);
    return;
  }
  const anon = process.env.VITE_SUPABASE_ANON_KEY || fromDotenv('VITE_SUPABASE_ANON_KEY');
  if (!anon) { console.warn('[global-setup] no anon key found; skipping user seed'); return; }

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  // Already usable? Done.
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (!signInErr) {
    console.log('[global-setup] test user already present:', email);
    await supabase.auth.signOut();
    return;
  }

  const { error: signUpErr } = await supabase.auth.signUp({ email, password });
  if (signUpErr && !/already registered|already exists/i.test(signUpErr.message)) {
    console.warn('[global-setup] could not create test user:', signUpErr.message,
      '\n  (local email confirmations must be OFF — supabase/config.toml [auth.email] enable_confirmations = false, then `supabase stop && supabase start`)');
  } else {
    console.log('[global-setup] test user ready:', email);
  }
  await supabase.auth.signOut();
}

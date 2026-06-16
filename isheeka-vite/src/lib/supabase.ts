import { createClient } from "@supabase/supabase-js";

// Config comes from build-time env vars (Vite exposes VITE_* to the client).
// Local dev: put these in a .env file (gitignored). CI: set as repo secrets/vars.
// The anon key is meant to be public (RLS protects the data) — same model as today.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

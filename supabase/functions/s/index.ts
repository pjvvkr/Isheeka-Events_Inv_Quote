// ============================================================================
// Isheeka ERP — s  (short-link redirect, Supabase Edge Function, Deno)
//
// Resolves a short code to a private Storage object and 302-redirects the visitor
// to a freshly-minted signed URL. The link the client receives looks like
//   https://<project>.supabase.co/functions/v1/s/a3f9b2c
// and never expires — the signed URL is regenerated on every click (1-hour TTL),
// so the underlying `quotations` bucket can stay private.
//
// PUBLIC: clients have no Supabase JWT. Deploy with JWT verification OFF:
//   supabase functions deploy s --no-verify-jwt
// (also pinned in config.toml: [functions.s] verify_jwt = false)
//
// Auto-injected env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const SIGNED_TTL = 60 * 60; // 1 hour — long enough to open, short enough to not leak.

function notFound(msg: string) {
  // Supabase's gateway renders this response as text regardless of content-type, so we
  // send a clean plain-text message (no HTML tags) that reads well as-is.
  const body =
    'This link is not available.\n\n' +
    msg + '\n\n' +
    'Please contact Isheeka Events for an updated link.';
  return new Response(body, {
    status: 404,
    headers: new Headers({ "content-type": "text/plain; charset=utf-8" }),
  });
}

Deno.serve(async (req) => {
  try {
    // Path is /functions/v1/s/<code> (or /s/<code> when served locally). Take the last segment.
    const code = new URL(req.url).pathname.split("/").filter(Boolean).pop();
    if (!code || code === "s") return notFound("No link code was provided.");

    const { data: link, error } = await db
      .from("short_links")
      .select("bucket, path")
      .eq("code", code)
      .maybeSingle();
    if (error || !link) return notFound("The link has expired or is invalid.");

    const { data: signed, error: sErr } = await db.storage
      .from(link.bucket)
      .createSignedUrl(link.path, SIGNED_TTL);
    if (sErr || !signed?.signedUrl) return notFound("The document could not be opened.");

    return Response.redirect(signed.signedUrl, 302);
  } catch (_e) {
    return notFound("Something went wrong opening this link.");
  }
});

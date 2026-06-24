// push-send — sends Web Push to a set of users' subscriptions (Phase 2).
// Callers: the rfq-gateway (server-to-server, via x-internal-secret) and the app
// (staff JWT). Deploy: supabase functions deploy push-send --no-verify-jwt
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, PUSH_INTERNAL_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:isheekaevents@gmail.com";
const INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "push_unconfigured" }, 503);

  // Auth: internal secret (gateway) OR a valid staff JWT (app).
  let authed = !!INTERNAL_SECRET && (req.headers.get("x-internal-secret") || "") === INTERNAL_SECRET;
  if (!authed) {
    const tok = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (tok) { try { const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${tok}` } } }); const { data: { user } } = await sb.auth.getUser(); authed = !!user; } catch { /* noop */ } }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const userIds: string[] = Array.isArray(body.user_ids) ? body.user_ids.filter(Boolean) : [];
  const payload = body.payload || {};
  if (!userIds.length) return json({ ok: true, sent: 0 });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const { data: subs } = await db.from("push_subscriptions").select("subscription_id,subscription").in("user_id", userIds).eq("is_deleted", false);
  const data = JSON.stringify({ title: payload.title || "Isheeka Events", body: payload.body || "", url: payload.url || "/", tag: payload.tag || "" });

  let sent = 0;
  for (const s of (subs || [])) {
    try { await webpush.sendNotification(s.subscription, data); sent++; }
    catch (e: any) { const code = e && e.statusCode; if (code === 404 || code === 410) { try { await db.from("push_subscriptions").update({ is_deleted: true }).eq("subscription_id", s.subscription_id); } catch { /* noop */ } } }
  }
  return json({ ok: true, sent });
});

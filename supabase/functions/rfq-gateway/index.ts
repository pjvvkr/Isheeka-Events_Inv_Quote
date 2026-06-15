// ============================================================================
// Isheeka ERP — rfq-gateway  (Supabase Edge Function, Deno)
//
// The ONLY public door to the RFQ tables. The public page (rfq.html) calls this
// and nothing else; it holds no keys. This function validates a per-link token
// + a PIN (staff-shared) or an email OTP, mints a short-lived signed session,
// and uses the service_role key to read/write — always scoped to ONE rfq_id.
//
// Deploy PUBLIC (no JWT): supabase functions deploy rfq-gateway --no-verify-jwt
// (the function does its own auth; clients have no Supabase JWT).
//
// Auto-injected env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Secrets to set:    SESSION_SECRET (required), RESEND_API_KEY + EMAIL_FROM (email),
//                    optional: LINK_TTL_DAYS=21, OTP_TTL_MIN=10, MAX_ATTEMPTS=5,
//                    ALLOWED_ORIGIN (CORS; default "*").
// Spec: docs/rfq-portal-spec.md §F.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, otpEmail } from "./email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SESSION_SECRET = Deno.env.get("SESSION_SECRET") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const LINK_TTL_DAYS = parseInt(Deno.env.get("LINK_TTL_DAYS") ?? "21", 10);
const OTP_TTL_MIN = parseInt(Deno.env.get("OTP_TTL_MIN") ?? "10", 10);
const MAX_ATTEMPTS = parseInt(Deno.env.get("MAX_ATTEMPTS") ?? "5", 10);
const SESSION_TTL_MIN = 120;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ── helpers ────────────────────────────────────────────────────────────────
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const enc = new TextEncoder();

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b64url(new Uint8Array(sig));
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function mintSession(rfqId: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MIN * 60_000;
  const payload = b64url(enc.encode(JSON.stringify({ rfq_id: rfqId, exp })));
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}
async function readSession(token: string): Promise<{ rfq_id: string } | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expect = await hmac(payload);
  if (!timingSafeEqual(sig, expect)) return null;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!data.exp || Date.now() > data.exp) return null;
    return { rfq_id: data.rfq_id };
  } catch {
    return null;
  }
}
function gen6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
async function logActivity(rfqId: string, actor: string, action: string, notes?: string) {
  await db.from("rfq_activity").insert({ rfq_id: rfqId, actor, action, notes: notes ?? null });
}
// Public-safe projection of an RFQ (never leak hashes/tokens).
function publicRfq(r: Record<string, unknown>) {
  return {
    rfq_id: r.rfq_id, ref_number: r.ref_number, status: r.status,
    contact_name: r.contact_name, contact_email: r.contact_email, contact_phone: r.contact_phone,
    event_type: r.event_type, event_date: r.event_date, location: r.location,
    guest_count: r.guest_count, budget: r.budget, notes: r.notes,
    revision_number: r.revision_number,
  };
}
async function rfqByToken(token: string) {
  if (!token) return null;
  const token_hash = await sha256hex(token);
  const { data } = await db.from("rfqs").select("*").eq("token_hash", token_hash).eq("is_deleted", false).maybeSingle();
  return data;
}
function linkExpired(r: Record<string, unknown>): boolean {
  return !!r.token_expires_at && new Date(r.token_expires_at as string).getTime() < Date.now();
}

// ── main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SESSION_SECRET) return json({ error: "server_misconfigured", detail: "SESSION_SECRET not set" }, 500);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "ping":
        return json({ ok: true, ts: Date.now() });

      // ── request an emailed OTP ───────────────────────────────────────────
      case "request_otp": {
        const r = await rfqByToken(body.token);
        if (!r) return json({ error: "invalid_link" }, 404);
        if (linkExpired(r)) return json({ error: "link_expired" }, 410);
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!email) return json({ error: "email_required" }, 400);
        if (!r.contact_email || email !== String(r.contact_email).trim().toLowerCase())
          return json({ error: "email_mismatch" }, 403); // OTP only to the address on file
        // rate limit: max 3 codes / 15 min for this rfq
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { count } = await db.from("rfq_otp").select("otp_id", { count: "exact", head: true })
          .eq("rfq_id", r.rfq_id).gte("created_at", since);
        if ((count ?? 0) >= 3) return json({ error: "rate_limited" }, 429);

        const code = gen6();
        await db.from("rfq_otp").insert({
          rfq_id: r.rfq_id, email, code_hash: await sha256hex(code),
          expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
        });
        const tpl = otpEmail(code, r.ref_number as string | null);
        const sent = await sendEmail({ to: email, ...tpl });
        await logActivity(r.rfq_id as string, "client", "otp_sent", sent.stubbed ? "stub (no provider key)" : email);
        return json({ ok: true, stubbed: sent.stubbed });
      }

      // ── verify an emailed OTP → session ──────────────────────────────────
      case "verify_otp": {
        const r = await rfqByToken(body.token);
        if (!r) return json({ error: "invalid_link" }, 404);
        if (linkExpired(r)) return json({ error: "link_expired" }, 410);
        const email = String(body.email ?? "").trim().toLowerCase();
        const code = String(body.code ?? "").trim();
        const { data: otp } = await db.from("rfq_otp").select("*")
          .eq("rfq_id", r.rfq_id).eq("email", email).is("consumed_at", null)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!otp) return json({ error: "no_code" }, 400);
        if (new Date(otp.expires_at).getTime() < Date.now()) return json({ error: "code_expired" }, 410);
        if (otp.attempts >= MAX_ATTEMPTS) return json({ error: "locked" }, 429);
        if (!timingSafeEqual(otp.code_hash, await sha256hex(code))) {
          await db.from("rfq_otp").update({ attempts: otp.attempts + 1 }).eq("otp_id", otp.otp_id);
          return json({ error: "wrong_code", attempts_left: Math.max(0, MAX_ATTEMPTS - otp.attempts - 1) }, 401);
        }
        await db.from("rfq_otp").update({ consumed_at: new Date().toISOString() }).eq("otp_id", otp.otp_id);
        await logActivity(r.rfq_id as string, "client", "otp_verified");
        return json({ ok: true, session: await mintSession(r.rfq_id as string), rfq: publicRfq(r) });
      }

      // ── verify a staff-shared PIN → session (no email needed) ────────────
      case "verify_pin": {
        const r = await rfqByToken(body.token);
        if (!r) return json({ error: "invalid_link" }, 404);
        if (linkExpired(r)) return json({ error: "link_expired" }, 410);
        if (r.access_mode !== "pin" || !r.access_pin_hash) return json({ error: "pin_not_set" }, 400);
        // lock after MAX_ATTEMPTS failures in 15 min (tracked via activity log)
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { count: fails } = await db.from("rfq_activity").select("activity_id", { count: "exact", head: true })
          .eq("rfq_id", r.rfq_id).eq("action", "pin_failed").gte("created_at", since);
        if ((fails ?? 0) >= MAX_ATTEMPTS) return json({ error: "locked" }, 429);
        const pin = String(body.pin ?? "").trim();
        if (!pin || !timingSafeEqual(r.access_pin_hash as string, await sha256hex(pin))) {
          await logActivity(r.rfq_id as string, "client", "pin_failed");
          return json({ error: "wrong_pin", attempts_left: Math.max(0, MAX_ATTEMPTS - (fails ?? 0) - 1) }, 401);
        }
        await logActivity(r.rfq_id as string, "client", "pin_verified");
        return json({ ok: true, session: await mintSession(r.rfq_id as string), rfq: publicRfq(r) });
      }

      // ── fetch the RFQ + items (+ catalog) for the form ───────────────────
      case "get_rfq": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const { data: r } = await db.from("rfqs").select("*").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        const { data: items } = await db.from("rfq_items").select("*").eq("rfq_id", s.rfq_id).eq("is_deleted", false).order("sort_order");
        // best-effort catalog from event templates for this event type (optional; M3 uses it more)
        let catalog: unknown[] = [];
        try {
          const { data: tpl } = await db.from("event_templates").select("*").eq("is_deleted", false);
          catalog = tpl ?? [];
        } catch { /* templates optional */ }
        return json({ ok: true, rfq: publicRfq(r), items: items ?? [], catalog });
      }

      // ── autosave / resume: write details + replace items ─────────────────
      case "save_rfq": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const { data: r } = await db.from("rfqs").select("status").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        if (!["draft", "sent", "in_progress"].includes(r.status))
          return json({ error: "not_editable", status: r.status }, 409);

        const f = body.fields ?? {};
        const patch: Record<string, unknown> = { status: "in_progress" };
        for (const k of ["contact_name", "contact_phone", "event_type", "event_date", "location", "guest_count", "budget", "notes"]) {
          if (k in f) patch[k] = f[k] === "" ? null : f[k];
        }
        await db.from("rfqs").update(patch).eq("rfq_id", s.rfq_id);

        if (Array.isArray(body.items)) {
          await db.from("rfq_items").delete().eq("rfq_id", s.rfq_id); // simple replace; revision snapshots are M4
          const rows = body.items
            .filter((it: any) => (it?.description ?? "").trim())
            .map((it: any, i: number) => ({
              rfq_id: s.rfq_id,
              sub_event_name: it.sub_event_name ?? null,
              description: String(it.description).trim(),
              quantity: it.quantity ?? 1,
              unit: it.unit ?? null,
              source: it.source ?? "custom",
              sort_order: i,
            }));
          if (rows.length) await db.from("rfq_items").insert(rows);
        }
        await logActivity(s.rfq_id, "client", "saved");
        return json({ ok: true });
      }

      // ── client submits → locks editing pending staff review ──────────────
      case "submit_rfq": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const { data: r } = await db.from("rfqs").select("status").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        if (!["sent", "in_progress", "draft", "changes_requested"].includes(r.status))
          return json({ error: "not_submittable", status: r.status }, 409);
        await db.from("rfqs").update({ status: "submitted", client_submitted_at: new Date().toISOString() }).eq("rfq_id", s.rfq_id);
        await logActivity(s.rfq_id, "client", "submitted");
        return json({ ok: true });
      }

      default:
        return json({ error: "unknown_action", action }, 400);
    }
  } catch (e) {
    console.error("[rfq-gateway] error", action, e);
    return json({ error: "server_error" }, 500);
  }
});

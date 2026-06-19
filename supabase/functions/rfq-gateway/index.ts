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
//                    ANTHROPIC_API_KEY (for extract_items: attachment/photo → item list),
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
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";   // for extract_items (attachment → item list)
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

// extract_* helpers: build a Claude content block per file, and validate an uploaded set.
function fileBlock(f: any) {
  return f.media_type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
    : { type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } };
}
function validateFiles(files: any[]): string | null {
  if (files.length > 6) return "too_many";
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  for (const f of files) {
    if (!f || !f.data || !f.media_type) return "no_file";
    if (!allowed.includes(f.media_type)) return "bad_type";
    if (f.data.length > 8_000_000) return "too_large";
  }
  return null;
}
function fileErrStatus(code: string): number {
  return code === "bad_type" ? 415 : (code === "too_large" || code === "too_many") ? 413 : 400;
}

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
    contact_name: r.contact_name, contact_first_name: r.contact_first_name, contact_last_name: r.contact_last_name,
    contact_email: r.contact_email, contact_phone: r.contact_phone,
    secondary_contact_name: r.secondary_contact_name, secondary_contact_phone: r.secondary_contact_phone,
    event_type: r.event_type, event_date: r.event_date, location: r.location, city: r.city,
    guest_count: r.guest_count, budget: r.budget, budget_range: r.budget_range,
    sub_events: r.sub_events, notes: r.notes,
    revision_number: r.revision_number,
    party_type: r.party_type ?? "client",
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
        // catalog = template items for this RFQ's event type (grouped client-side by sub_event_name)
        let catalog: unknown[] = [];
        try {
          const { data: tpls } = await db.from("event_templates")
            .select("template_id,event_type").eq("is_deleted", false).eq("is_active", true);
          let chosen = tpls ?? [];
          const et = String(r.event_type || "").toLowerCase().trim();
          if (et) { const m = chosen.filter((t: any) => String(t.event_type || "").toLowerCase().trim() === et); if (m.length) chosen = m; }
          const ids = chosen.map((t: any) => t.template_id);
          if (ids.length) {
            const { data: tis } = await db.from("event_template_items")
              .select("sub_event_name,description,default_quantity").in("template_id", ids).order("sort_order");
            catalog = tis ?? [];
          }
        } catch { /* templates optional */ }
        let change_note: string | null = null;
        try {
          const { data: ca } = await db.from("rfq_activity").select("notes")
            .eq("rfq_id", s.rfq_id).eq("action", "changes_requested").order("created_at", { ascending: false }).limit(1).maybeSingle();
          change_note = ca ? ca.notes : null;
        } catch { /* ignore */ }
        // configured sub-event suggestions for this event type (Settings → Sub-events)
        let subevent_suggestions: string[] = [];
        try {
          if (r.event_type) {
            const { data: et } = await db.from("event_types").select("event_type_id").ilike("label", String(r.event_type)).limit(1).maybeSingle();
            if (et) {
              const { data: subs } = await db.from("event_type_subevents").select("name").eq("event_type_id", et.event_type_id).eq("is_active", true).order("sort_order");
              subevent_suggestions = (subs ?? []).map((x: any) => x.name);
            }
          }
        } catch { /* optional */ }
        let event_types: string[] = [];
        try { const { data: ets } = await db.from("event_types").select("label").eq("is_active", true).order("sort_order"); event_types = (ets ?? []).map((x: any) => x.label).filter(Boolean); } catch { /* optional */ }
        return json({ ok: true, rfq: publicRfq(r), items: items ?? [], catalog, change_note, subevent_suggestions, event_types });
      }

      // ── autosave / resume: write details + replace items ─────────────────
      case "save_rfq": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const { data: r } = await db.from("rfqs").select("status, party_type").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        // editable until staff lock it; clients may revise even after submitting
        if (["approved", "converted", "withdrawn"].includes(r.status))
          return json({ error: "not_editable", status: r.status }, 409);

        // ── vendor mode: update per-item costs only; the frozen item list is never replaced ──
        if (r.party_type === "vendor") {
          if (Array.isArray(body.items)) {
            for (const it of body.items) {
              if (!it || !it.rfq_item_id) continue;
              const supplies = it.can_supply !== false;
              await db.from("rfq_items").update({
                can_supply: supplies,
                unit_cost: (!supplies || it.unit_cost === "" || it.unit_cost == null) ? null : Number(it.unit_cost),
                item_note: (it.item_note ?? "") === "" ? null : String(it.item_note),
              }).eq("rfq_item_id", it.rfq_item_id).eq("rfq_id", s.rfq_id);
            }
          }
          const vf = body.fields ?? {};
          const vpatch: Record<string, unknown> = { status: "in_progress" };
          if ("notes" in vf) vpatch.notes = vf.notes === "" ? null : vf.notes; // vendor's overall note
          await db.from("rfqs").update(vpatch).eq("rfq_id", s.rfq_id);
          await logActivity(s.rfq_id, "vendor", "saved");
          return json({ ok: true });
        }

        const f = body.fields ?? {};
        const patch: Record<string, unknown> = { status: "in_progress" };
        for (const k of ["contact_name", "contact_first_name", "contact_last_name", "contact_phone", "secondary_contact_name", "secondary_contact_phone",
                         "event_type", "event_date", "location", "city", "guest_count", "budget", "budget_range", "notes"]) {
          if (k in f) patch[k] = f[k] === "" ? null : f[k];
        }
        if ("sub_events" in f) patch.sub_events = f.sub_events ?? null; // jsonb [{name, planned_date}]
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
        const { data: r } = await db.from("rfqs").select("*").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        if (["approved", "converted", "withdrawn"].includes(r.status))
          return json({ error: "not_submittable", status: r.status }, 409);
        // snapshot this submission as a revision (item-for-item history)
        const { data: its } = await db.from("rfq_items")
          .select("sub_event_name,description,quantity,unit,source,sort_order,unit_cost,can_supply,item_note").eq("rfq_id", s.rfq_id).eq("is_deleted", false).order("sort_order");
        const revNo = (r.revision_number || 0) + 1;
        const snapshot = {
          details: {
            contact_name: r.contact_name, contact_first_name: r.contact_first_name, contact_last_name: r.contact_last_name,
            contact_phone: r.contact_phone, contact_email: r.contact_email,
            secondary_contact_name: r.secondary_contact_name, secondary_contact_phone: r.secondary_contact_phone,
            event_type: r.event_type, event_date: r.event_date, location: r.location, city: r.city,
            guest_count: r.guest_count, budget_range: r.budget_range, notes: r.notes,
          },
          sub_events: r.sub_events || [],
          items: its || [],
        };
        const who = (r.party_type === "vendor") ? "vendor" : "client";
        await db.from("rfq_revisions").insert({ rfq_id: s.rfq_id, revision_number: revNo, snapshot, submitted_by: who });
        await db.from("rfqs").update({ status: "submitted", revision_number: revNo, client_submitted_at: new Date().toISOString() }).eq("rfq_id", s.rfq_id);
        await logActivity(s.rfq_id, who, "submitted", "Revision " + revNo);
        return json({ ok: true, revision_number: revNo });
      }

      // ── attachment → item list (Claude vision). Session-gated; returns items for REVIEW. ──
      case "extract_items": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        if (!ANTHROPIC_API_KEY) return json({ error: "extract_unavailable" }, 503);
        const text = (typeof body.text === "string") ? body.text.trim() : "";   // pasted message / list — optional
        const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);  // one or more photos/PDFs
        if (!text && !files.length) return json({ error: "no_input" }, 400);
        if (text && text.length > 20000) return json({ error: "too_large" }, 413);
        if (!text) { const v = validateFiles(files); if (v) return json({ error: v }, fileErrStatus(v)); }

        const prompt =
          "You are reading a customer's event-requirements list (it may be typed, printed, or handwritten, " +
          "possibly a phone photo). Extract the requested items. Return ONLY a JSON array — no prose, no code fences — " +
          "of objects: {\"description\": string, \"quantity\": number, \"sub_event\": string|null}. " +
          "description = the item/service requested. quantity = the number requested (use 1 if not stated). " +
          "sub_event = the function/section it belongs to if the list is grouped (e.g. \"Mehendi\", \"Reception\"), else null. " +
          "The list may be in English, Telugu, Hindi or a mix (Hinglish/Tenglish) and may be handwritten — read it faithfully; " +
          "give each description as a short clear label in English where the meaning is obvious, otherwise keep the original wording. " +
          "For quantity, read counts like \"2 tubs\", \"200 chairs\", \"8x12 backdrop\" as the number (2, 200, 1) and keep any size/spec in the description. " +
          "Ignore prices, money, totals, headings, page numbers and contact details. If you cannot read any items, return [].";

        const content: any[] = text
          ? [{ type: "text", text: prompt + "\n\nHere is the message / list to read:\n\n" + text }]
          : [...files.map(fileBlock), { type: "text", text: prompt }];

        let aiText = "";
        try {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 1500,
              messages: [{ role: "user", content }],
            }),
          });
          if (!resp.ok) { const t = await resp.text(); console.error("[extract_items] anthropic", resp.status, t); return json({ error: "extract_failed", status: resp.status }, 502); }
          const data = await resp.json();
          aiText = ((data?.content || []) as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
        } catch (e) { console.error("[extract_items] fetch", e); return json({ error: "extract_failed" }, 502); }

        let items: any[] = [];
        try {
          let t = aiText.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
          const a = t.indexOf("["), b = t.lastIndexOf("]");
          if (a >= 0 && b > a) t = t.slice(a, b + 1);
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed)) items = parsed;
        } catch (e) { console.error("[extract_items] parse", aiText); return json({ error: "extract_unreadable" }, 422); }

        const clean = items.map((it: any) => ({
          description: String(it.description ?? it.item ?? "").trim().slice(0, 300),
          quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
          sub_event: it.sub_event ? String(it.sub_event).trim().slice(0, 80) : null,
        })).filter((it: any) => it.description);

        return json({ ok: true, items: clean });
      }

      // ── vendor: price list (photo/PDF/text) → match to the fixed items, fill costs (for REVIEW) ──
      case "extract_costs": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        if (!ANTHROPIC_API_KEY) return json({ error: "extract_unavailable" }, 503);
        const text = (typeof body.text === "string") ? body.text.trim() : "";
        const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);
        if (!text && !files.length) return json({ error: "no_input" }, 400);
        if (text && text.length > 20000) return json({ error: "too_large" }, 413);
        if (!text) { const v = validateFiles(files); if (v) return json({ error: v }, fileErrStatus(v)); }
        // the fixed items the vendor is pricing
        const { data: its } = await db.from("rfq_items").select("rfq_item_id,description,quantity").eq("rfq_id", s.rfq_id).eq("is_deleted", false).order("sort_order");
        const itemRows = its || [];
        if (!itemRows.length) return json({ error: "no_items" }, 400);
        const itemList = itemRows.map((it) => ({ id: it.rfq_item_id, description: it.description, quantity: it.quantity }));

        const prompt =
          "You are matching a vendor's price list to a FIXED list of items the customer needs. " +
          "ITEMS (JSON): " + JSON.stringify(itemList) + ". " +
          "Read the vendor's price document/message and, for each item id above, find the vendor's matching PER-UNIT price. " +
          "The vendor's list may be in English, Telugu, Hindi or a mix and may be handwritten — read it faithfully. " +
          "Return ONLY a JSON array (no prose, no code fences) of objects: " +
          "{\"rfq_item_id\": string, \"unit_cost\": number|null, \"can_supply\": boolean, \"confidence\": \"high\"|\"low\", \"source\": string}. " +
          "unit_cost = per-unit price as a plain number (no currency symbols); if only a line total is given, divide by that item's quantity. " +
          "source = a short snippet of the vendor's own line that this price came from (e.g. \"Stage decor - 45k\"), or \"\" if none. " +
          "confidence = \"high\" when the vendor's line clearly corresponds to the item; \"low\" when the match is a guess or the wording differs a lot. " +
          "If the vendor marks an item unavailable, set can_supply=false and unit_cost=null. " +
          "If you cannot match an item at all, set unit_cost=null, can_supply=true, confidence=\"low\". " +
          "Use ONLY the rfq_item_id values provided — never invent items.";

        const content2: any[] = text
          ? [{ type: "text", text: prompt + "\n\nVendor's price list:\n\n" + text }]
          : [...files.map(fileBlock), { type: "text", text: prompt }];

        let aiText2 = "";
        try {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: content2 }] }),
          });
          if (!resp.ok) { const t = await resp.text(); console.error("[extract_costs] anthropic", resp.status, t); return json({ error: "extract_failed", status: resp.status }, 502); }
          const data = await resp.json();
          aiText2 = ((data?.content || []) as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
        } catch (e) { console.error("[extract_costs] fetch", e); return json({ error: "extract_failed" }, 502); }

        let parsed2: any[] = [];
        try {
          let t = aiText2.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
          const a = t.indexOf("["), b = t.lastIndexOf("]");
          if (a >= 0 && b > a) t = t.slice(a, b + 1);
          const p = JSON.parse(t);
          if (Array.isArray(p)) parsed2 = p;
        } catch (e) { console.error("[extract_costs] parse", aiText2); return json({ error: "extract_unreadable" }, 422); }

        const valid = new Set(itemRows.map((it) => String(it.rfq_item_id)));
        const costs = parsed2.filter((c: any) => c && valid.has(String(c.rfq_item_id))).map((c: any) => ({
          rfq_item_id: String(c.rfq_item_id),
          unit_cost: (c.unit_cost == null || c.unit_cost === "") ? null : Math.max(0, Math.round(Number(c.unit_cost) || 0)),
          can_supply: c.can_supply !== false,
          confidence: (c.confidence === "low") ? "low" : "high",
          source: c.source ? String(c.source).trim().slice(0, 120) : "",
        }));
        return json({ ok: true, costs, matched: costs.filter((c) => c.unit_cost != null).length, total: itemRows.length });
      }

      default:
        return json({ error: "unknown_action", action }, 400);
    }
  } catch (e) {
    console.error("[rfq-gateway] error", action, e);
    return json({ error: "server_error" }, 500);
  }
});
